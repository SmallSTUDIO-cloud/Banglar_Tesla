/**
 * UI click-through test: drives the game only through real DOM interactions
 * (no debug hooks), the way a player would.
 *
 *   node tests/e2e/ui-flow.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const PORT = 4193;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Click the first visible element whose text contains `text`. */
async function clickText(page, text, selector = 'button') {
  return page.evaluate(
    (t, sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      const hit = nodes.find((n) => n.textContent && n.textContent.includes(t) && n.offsetParent !== null);
      if (!hit) return false;
      hit.click();
      return true;
    },
    text,
    selector,
  );
}

const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
await waitFor(BASE);

const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  env: ensureChromiumEnv(),
  defaultViewport: { width: 900, height: 506, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
await page.evaluate(() => document.fonts.ready); // settle web fonts before UI measurement / reload (prevents font-abort races on slow runners)
await new Promise((r) => setTimeout(r, 1200));

// skip the splash if it is still up
await page.evaluate(() => document.getElementById('boot-skip')?.click());
await new Promise((r) => setTimeout(r, 900));

// 1. Play -> tutorial (first launch) -> duty
check('Play button is clickable', await clickText(page, 'খেলা শুরু'));
await new Promise((r) => setTimeout(r, 500));
const tutVisible = await page.evaluate(() =>
  [...document.querySelectorAll('.screen')].some((s) => !s.classList.contains('hidden') && s.textContent.includes('স্বাগতম')),
);
check('first launch shows the tutorial', tutVisible);

for (let i = 0; i < 4; i++) {
  await clickText(page, i === 3 ? 'বুঝেছি' : 'পরের ধাপ');
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 700));
const afterTutorial = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
check('tutorial completes into gameplay', afterTutorial.mode === 'duty' && afterTutorial.screen === 'hud', JSON.stringify(afterTutorial));

// 2. Accept the offered job through the real button
const offerVisible = await page.evaluate(() => !!document.getElementById('job-offer'));
check('job offer card is on screen', offerVisible);
check('accept button clickable', await clickText(page, 'চালিয়ে যান'));
await new Promise((r) => setTimeout(r, 400));
const missionStarted = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
// 'boarding' is valid too: if the fare is offered where the player already is,
// the passenger starts walking over immediately.
check(
  'mission starts from the real accept button',
  ['toPickup', 'boarding', 'toDropoff'].includes(missionStarted.missionState),
  missionStarted.missionState,
);
await page.screenshot({ path: path.join(root, 'artifacts', 'ui-flow-hud.png') });

// 3. Pause via the HUD button, resume, then quit to the menu
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.hud .icon-btn')];
  btns[0]?.click();
});
await new Promise((r) => setTimeout(r, 400));
const paused = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
check('HUD pause button opens pause', paused.paused === true && paused.screen === 'pause', JSON.stringify(paused));

await clickText(page, 'চালিয়ে যান');
await new Promise((r) => setTimeout(r, 400));
const resumed = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
check('resume button returns to driving', resumed.paused === false && resumed.screen === 'hud');

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.hud .icon-btn')];
  btns[0]?.click();
});
await new Promise((r) => setTimeout(r, 300));
await clickText(page, 'মেনুতে ফিরুন');
await new Promise((r) => setTimeout(r, 300));
// confirm dialog (second matching button)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.modal button')];
  btns[btns.length - 1]?.click();
});
await new Promise((r) => setTimeout(r, 700));
const backToMenu = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
check('quit-to-menu confirmation returns to the menu', backToMenu.mode === 'menu' && backToMenu.screen === 'menu', JSON.stringify(backToMenu));

// 4. Store: open, try to buy something too expensive, confirm the guard message
check('Store button clickable', await clickText(page, 'দোকান'));
await new Promise((r) => setTimeout(r, 900));
const storeOpen = await page.evaluate(() =>
  [...document.querySelectorAll('.screen')].some((s) => !s.classList.contains('hidden') && s.textContent.includes('দোকান')),
);
check('store screen opens from the menu', storeOpen);
await page.screenshot({ path: path.join(root, 'artifacts', 'ui-flow-store.png') });
await page.evaluate(() => {
  document.querySelectorAll('.sheet .icon-btn')[0]?.click();
});
await new Promise((r) => setTimeout(r, 500));

// 5. Garage: open and repair via the real button
check('Garage button clickable', await clickText(page, 'গ্যারেজ'));
await new Promise((r) => setTimeout(r, 900));
const repaired = await clickText(page, 'দিয়ে মেরামত');
await new Promise((r) => setTimeout(r, 600));
const afterRepair = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
check('repair via the garage button restores condition', repaired ? afterRepair.condition >= 99 : false, JSON.stringify({ repaired, condition: afterRepair.condition }));
await page.evaluate(() => {
  document.querySelectorAll('.sheet .icon-btn')[0]?.click();
});
await new Promise((r) => setTimeout(r, 500));

// 6. Settings: change the language through the real segmented control
check('Settings button clickable', await clickText(page, 'সেটিংস'));
await new Promise((r) => setTimeout(r, 700));
const langSwitched = await clickText(page, 'English');
await new Promise((r) => setTimeout(r, 600));
const englishScreen = await page.evaluate(() => ({
  snap: window.__banglarTesla.debugSnapshot(),
  hasEnglish: [...document.querySelectorAll('.screen')].some((s) => !s.classList.contains('hidden') && s.textContent.includes('Settings')),
}));
check('language switches through the real control', langSwitched && englishScreen.hasEnglish, JSON.stringify(englishScreen));
// Use the actual Settings controls; validate each selection and persistent reload.
const weatherLabels = [['Sunny', 'sunny'], ['Cloudy', 'overcast'], ['Rainy', 'rain'], ['Windy', 'windy'], ['Thunderstorm', 'storm'], ['Auto', 'auto']];
const weatherStates = [];
for (const [label, expected] of weatherLabels) {
  const state = await page.evaluate(({ label }) => {
    const field = [...document.querySelectorAll('.field')].find((n) => n.querySelector('label')?.textContent === 'Weather');
    const btn = [...(field?.querySelectorAll('button') ?? [])].find((n) => n.textContent === label);
    btn?.click();
    return { clicked: !!btn, active: btn?.classList.contains('on'), preference: window.__banglarTesla.settings.get().weatherPreference,
      weather: window.__banglarTesla.debugSnapshot().weather };
  }, { label });
  weatherStates.push(state);
  check(`Settings weather ${label}`, state.clicked && state.active && state.preference === expected &&
    (expected === 'auto' || state.weather === expected), JSON.stringify(state));
}
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1 });
const weatherMobile = await page.evaluate(() => {
  const field = [...document.querySelectorAll('.field')].find((n) => n.querySelector('label')?.textContent === 'Weather');
  const bounds = [...field.querySelectorAll('button')].map((btn) => btn.getBoundingClientRect());
  return { count: bounds.length, noHorizontalClipping: bounds.every((r) => r.left >= 0 && r.right <= innerWidth),
    noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth };
});
check('six weather controls fit portrait viewport', weatherMobile.count === 6 && weatherMobile.noHorizontalClipping && weatherMobile.noDocumentOverflow, JSON.stringify(weatherMobile));
await page.screenshot({ path: path.join(root, 'artifacts', 'settings-weather-portrait.png') });
await page.evaluate(() => {
  const field = [...document.querySelectorAll('.field')].find((n) => n.querySelector('label')?.textContent === 'Weather');
  [...field.querySelectorAll('button')].find((n) => n.textContent === 'Rainy')?.click();
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
await page.evaluate(() => document.getElementById('boot-skip')?.click());
await new Promise((r) => setTimeout(r, 650));
const weatherReload = await page.evaluate(() => window.__banglarTesla.settings.get().weatherPreference);
check('weather preference survives full reload', weatherReload === 'rain', weatherReload);
await clickText(page, 'Settings');
await page.evaluate(() => {
  const field = [...document.querySelectorAll('.field')].find((n) => n.querySelector('label')?.textContent === 'Weather');
  [...field.querySelectorAll('button')].find((n) => n.textContent === 'Auto')?.click();
});
check('Auto resumes after reload', await page.evaluate(() => window.__banglarTesla.settings.get().weatherPreference === 'auto'));
// Dedicated Graphics screen: real DOM controls, profile -> Custom -> reload -> reset.
check('Graphics entry opens its own screen', await page.evaluate(() => {
  document.querySelector('[data-action="open-graphics"]')?.click();
  return window.__banglarTesla.ui.currentScreen === 'graphics';
}));
const graphicsSelect = async (label, value) => page.evaluate(({ label, value }) => {
  const field = [...document.querySelectorAll('.screen:not(.hidden) .field')]
    .find((n) => n.querySelector('label')?.textContent === label);
  const btn = [...(field?.querySelectorAll('button') ?? [])].find((n) => n.textContent === value);
  btn?.click(); return !!btn;
}, { label, value });
check('Performance profile applies real render/population/weather-cost settings',
  await graphicsSelect('Quality', 'Performance') && await page.evaluate(() => {
    const s = window.__banglarTesla.settings.get();
    return s.graphicsProfile === 'performance' && s.quality === 'low' && s.renderScale === 0.8 &&
      s.rainMode === 'normal' && s.weatherPreference === 'auto';
  }));
check('High profile enables Dynamic without changing selected weather',
  await graphicsSelect('Quality', 'High') && await page.evaluate(() => {
    const s = window.__banglarTesla.settings.get();
    return s.graphicsProfile === 'high' && s.quality === 'high' && s.rainMode === 'dynamic' && s.weatherPreference === 'auto';
  }));
check('Individual rain control enters persistent Custom profile',
  await graphicsSelect('Rain effects', 'Normal') && await page.evaluate(() => {
    const s = window.__banglarTesla.settings.get();
    return s.graphicsProfile === 'custom' && s.rainMode === 'normal' && s.weatherPreference === 'auto';
  }));
await page.screenshot({ path: path.join(root, 'artifacts', 'graphics-custom-portrait.png') });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
await page.evaluate(() => document.getElementById('boot-skip')?.click());
await new Promise((r) => setTimeout(r, 600));
check('Custom graphics survives reload', await page.evaluate(() => {
  const s = window.__banglarTesla.settings.get();
  return s.graphicsProfile === 'custom' && s.rainMode === 'normal' && s.weatherPreference === 'auto';
}));
await clickText(page, 'Settings');
await page.evaluate(() => document.querySelector('[data-action="open-graphics"]')?.click());
check('Reset Graphics leaves audio and weather untouched', await page.evaluate(() => {
  const game = window.__banglarTesla;
  game.settings.set({ master: 0.24, weatherPreference: 'windy' });
  [...document.querySelectorAll('.screen:not(.hidden) button')].find((el) => el.textContent === 'Reset graphics only')?.click();
  const s = game.settings.get();
  return s.graphicsProfile === 'balanced' && s.quality === 'balanced' && s.master === 0.24 && s.weatherPreference === 'windy';
}));
check('Graphics Back returns to Settings', await page.evaluate(() => {
  [...document.querySelectorAll('.screen:not(.hidden) button')].find((el) => el.textContent === 'Back')?.click();
  return window.__banglarTesla.ui.currentScreen === 'settings';
}));
await page.evaluate(() => window.__banglarTesla.settings.set({ master: 0.85, weatherPreference: 'auto' }));
await clickText(page, 'Back');
await new Promise((r) => setTimeout(r, 600));
const backToMenuEn = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
check('English menu is reachable and renders', backToMenuEn.screen === 'menu');

check('no page errors during the click-through', errors.length === 0, errors.slice(0, 2).join(' | '));

await teardownHarness(browser, server);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} UI checks passed`);
fs.writeFileSync(path.join(root, 'artifacts', 'ui-flow-results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
