/* Browser UI regression for the original ten-rival dossier and new career gates. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4252;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch { /* boot */ }
    if (i === 159) throw Error('preview did not start');
    await new Promise(r => setTimeout(r, 150));
  }
  browser = await puppeteer.launch({
    args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(),
    defaultViewport: { width: 915, height: 412 },
  });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free'); g.state.markBlacklistIntroSeen();
    g.state.progress.blacklistDefeated = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    g.state.progress.blacklistNextRank = 1;
    g.state.progress.rep = 100000;
    g.state.progress.blacklistTasks.push('1:race', '1:fare', '1:escape');
    g.openBlacklist('hud');
    const card = document.querySelector('.blacklist-card[data-rank="1"]');
    const button = card?.querySelector('button[data-rival-rank="1"]');
    const meters = card?.querySelectorAll('progress') ?? [];
    const locked = button?.disabled === true && meters.length === 3;
    g.state.progress.blacklistRaceWins['1'] = 4;
    g.state.progress.blacklistBounty = 2100;
    g.ui.openBlacklistView('hud');
    const updated = document.querySelector('.blacklist-card[data-rank="1"]');
    updated?.scrollIntoView();
    const unlocked = updated?.querySelector('button[data-rival-rank="1"]')?.disabled === false;
    const allGates = [...(updated?.querySelectorAll('progress') ?? [])].every(m => m.value === m.max);
    const bounds = updated?.getBoundingClientRect();
    return { locked, unlocked, allGates, cardCount: document.querySelectorAll('.blacklist-card').length,
      mobileWidth: window.innerWidth, cardWidth: bounds?.width, screenWidth: document.documentElement.scrollWidth };
  });
  // The free-ride entry toast is unrelated to the rank dossier capture.
  await page.evaluate(() => document.querySelector('.toast-stack')?.remove());
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts', 'blacklist-rank-one.png') });
  if (errors.length || !result.locked || !result.unlocked || !result.allGates ||
      result.cardCount !== 10 || result.screenWidth > result.mobileWidth + 2) {
    throw Error(JSON.stringify({ result, errors }));
  }
  console.log('PASS original Dhaka rival rank gates on landscape mobile', JSON.stringify(result));
} finally { await teardownHarness(browser, server); }
