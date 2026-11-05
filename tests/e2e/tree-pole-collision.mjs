/* Browser-physics regression: the rendered trunks/utility columns are solid,
 * and their colliders do not turn lamps into unbreakable obstacles. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4248;
const server = spawn(path.join(root, 'node_modules/.bin/vite'),
  ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 150));
  }
  if (!ready) throw Error('preview did not start');
  browser = await puppeteer.launch({
    args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(),
    defaultViewport: { width: 900, height: 506 },
  });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free');
    g.renderer.setAnimationLoop(null);
    const colliders = g.city.colliders, boxAt = (x, z, half) => colliders.find(c =>
      c.kind === 'prop' && c.breakableId === undefined && !c.disabled &&
      Math.abs(c.cx - x) < .0001 && Math.abs(c.cz - z) < .0001 &&
      Math.abs(c.halfX - half) < .0001 && Math.abs(c.halfZ - half) < .0001);
    const treesMatched = g.city.treeSites.filter(t => !!boxAt(t.x, t.z, .20)).length;
    const polesMatched = g.city.utilityPoleSites.filter(p => !!boxAt(p.x, p.z, .14)).length;
    // Probe at a site's center. This exercises the same spatial hash and
    // response as gameplay, not just an isolated mathematical overlap helper.
    const probe = (site, half) => {
      const c = boxAt(site.x, site.z, half);
      const ctrl = g.controller;
      ctrl.reset(site.x, site.z, 0);
      ctrl.speed = 4;
      const before = { x: ctrl.x, z: ctrl.z };
      const hit = ctrl.resolveWorldCollisions(true);
      return { found: !!c, magnitude: hit.magnitude, moved: Math.hypot(ctrl.x - before.x, ctrl.z - before.z),
        speed: ctrl.speed, disabled: c?.disabled === true };
    };
    const tree = probe(g.city.treeSites.find(t => boxAt(t.x, t.z, .20)), .20);
    const pole = probe(g.city.utilityPoleSites.find(p => boxAt(p.x, p.z, .14)), .14);
    const lampsStillBreakable = g.city.breakableLamps.every(l =>
      l.collider.breakableId === l.id && !l.collider.disabled);
    return { trees: g.city.treeCount, treesMatched, poles: g.city.utilityPoleSites.length,
      polesMatched, tree, pole, lampsStillBreakable };
  });
  if (errors.length || result.trees < 10 || result.trees !== result.treesMatched ||
      result.poles < 10 || result.poles !== result.polesMatched || !result.lampsStillBreakable ||
      [result.tree, result.pole].some(p => !p.found || p.magnitude <= 0 || p.moved <= .1 || p.speed >= 4 || p.disabled)) {
    throw Error(JSON.stringify({ result, errors }));
  }
  console.log('PASS trunk and utility-pole collision through static spatial grid', JSON.stringify(result));
} finally { await teardownHarness(browser, server); }
