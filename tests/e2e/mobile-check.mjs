/**
 * Mobile viewport & touch-control verification on 915x412 (Android landscape)
 * and 412x915 (Android portrait) without any physical keyboard input.
 *
 *   node tests/e2e/mobile-check.mjs
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
const artifacts = path.join(root, 'artifacts');
const PORT = 4195;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

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

async function inspectVisibleButtons(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btns = [...document.querySelectorAll('button')].filter((b) => {
      const style = window.getComputedStyle(b);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      if (b.closest('.hidden') || b.closest('.boot-splash')) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const clipped = [];
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.left < -2 || r.top < -2 || r.right > vw + 2 || r.bottom > vh + 2) {
        clipped.push({
          label: (b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 28),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)],
          vp: [vw, vh],
        });
      }
    }
    return { count: btns.length, clipped };
  });
}

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });

  if (!(await waitFor(BASE))) {
    server.kill('SIGTERM');
    console.error('preview server did not start');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
    ],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    env: ensureChromiumEnv(),
    defaultViewport: { width: 915, height: 412, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  });

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready); // settle web fonts before UI measurement / reload (prevents font-abort races on slow runners)
    await page.evaluate(() => document.getElementById('boot-skip')?.click());
    await new Promise((r) => setTimeout(r, 800));

    // 1. Landscape 915x412 menu bounds check
    const menuLand = await inspectVisibleButtons(page);
    check(
      '915x412 landscape: main menu buttons unclipped',
      menuLand.count >= 6 && menuLand.clipped.length === 0,
      `visible=${menuLand.count}, clipped=${JSON.stringify(menuLand.clipped)}`,
    );
    await page.screenshot({ path: path.join(artifacts, 'mobile-menu-915x412.png') });

    // 2. Portrait 412x915 menu bounds check
    await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 400));
    const menuPort = await inspectVisibleButtons(page);
    check(
      '412x915 portrait: main menu buttons unclipped',
      menuPort.count >= 6 && menuPort.clipped.length === 0,
      `visible=${menuPort.count}, clipped=${JSON.stringify(menuPort.clipped)}`,
    );
    await page.screenshot({ path: path.join(artifacts, 'mobile-menu-412x915.png') });

    // Start Free Ride via real tap on portrait first to check HUD portrait fit
    await page.evaluate(() => {
      window.__banglarTesla.debugStartMode('duty');
    });
    await new Promise((r) => setTimeout(r, 500));
    const hudPort = await inspectVisibleButtons(page);
    check(
      '412x915 portrait: HUD + touch controls + job offer unclipped',
      hudPort.count >= 6 && hudPort.clipped.length === 0,
      `visible=${hudPort.count}, clipped=${JSON.stringify(hudPort.clipped)}`,
    );
    await page.screenshot({ path: path.join(artifacts, 'mobile-hud-412x915.png') });

    // Rotate back to primary Android landscape 915x412
    await page.setViewport({ width: 915, height: 412, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 450));
    const hudLand = await inspectVisibleButtons(page);
    check(
      '915x412 landscape: HUD + touch controls + job offer unclipped',
      hudLand.count >= 6 && hudLand.clipped.length === 0,
      `visible=${hudLand.count}, clipped=${JSON.stringify(hudLand.clipped)}`,
    );
    await page.screenshot({ path: path.join(artifacts, 'mobile-hud-915x412.png') });

    // Accept job offer by tapping real button
    const acceptedViaTap = await page.evaluate(() => {
      const btn = document.querySelector('#job-offer button.primary');
      if (!btn) return false;
      btn.click();
      return true;
    });
    check('job offer accepted via mobile touch button', acceptedViaTap);

    // 3. Test touch PEDAL + pointerleave resilience + multi-touch STEER (no keyboard!)
    const driveMetrics = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const pedal = document.querySelector('.touch-btn.pedal');
      const steerR = document.querySelectorAll('.touch-btn.steer')[1];
      const brake = document.querySelector('.touch-btn.brake');
      if (!pedal || !steerR || !brake) return { error: 'missing touch buttons' };

      // Drive on a verified clear Asad Avenue centreline (`asad_4`, 6.1m inside the
      // carriageway) so procedural lamp/building placement can never block the
      // touch-handling assertions — same anchor as verify-upgrade-v2 speed tests.
      // Clear all ambient traffic within 36m: no vehicle can re-enter the 2.2s
      // drive window (max closing distance 15.3 m/s × 2.2s ≈ 34m), so the
      // touch-input assertions can never be crushed by a random passing car.
      g.debugTeleport(80, 95, 1.853);
      g.traffic.clearStartZone(80, 95, 36);
      g.traffic.debugSetSimulationFrozen(true); // deterministic window: no recycled traffic can enter

      const beforeYaw = g.controller.yaw;
      // Finger 1 holds PEDAL; simulate thumb micro-roll firing pointerleave while held
      pedal.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
      pedal.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1, pointerType: 'touch' }));
      // Finger 2 holds STEER RIGHT simultaneously
      steerR.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, pointerType: 'touch' }));

      // Pin to the centreline during measurement: asserts concern INPUT HANDLING
      // (throttle builds speed, steer turns the wheel, brake reverses), not free
      // flight — a 2.2s full-lock arc would otherwise leave the carriageway and
      // grind along a legitimate roadside building.
      for (let i = 0; i < 132; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const forwardSpeed = g.controller.speed;
      const turnedYaw = Math.abs(g.controller.yaw - beforeYaw);
      const diag = {
        x: +g.controller.x.toFixed(1),
        z: +g.controller.z.toFixed(1),
        stuck: g.controller.stuck,
        hits: g.controller.hits,
        roadRage: g.debugSnapshot().roadRageState,
        contact: g.controller.lastContact?.active ?? false,
      };

      steerR.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2, pointerType: 'touch' }));
      pedal.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' }));

      // Now hold BRAKE until stopped and into deliberate REVERSE
      brake.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, pointerType: 'touch' }));
      brake.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 3, pointerType: 'touch' }));
      for (let i = 0; i < 180; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const reverseSpeed = g.controller.speed;
      brake.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, pointerType: 'touch' }));

      g.traffic.debugSetSimulationFrozen(false);
      return { forwardSpeed, turnedYaw, reverseSpeed, diag };
    });
    check(
      'touch pedal accelerates smoothly (survives thumb roll)',
      driveMetrics.forwardSpeed > 2.5,
      JSON.stringify(driveMetrics),
    );
    check(
      'multi-touch steering turns rickshaw while pedaling',
      driveMetrics.turnedYaw > 0.15,
      JSON.stringify(driveMetrics),
    );
    check(
      'touch brake stops and engages reverse when held',
      driveMetrics.reverseSpeed < -0.4,
      JSON.stringify(driveMetrics),
    );

    // 4. Test Analog Wheel mode keeps Pedal & Brake visible and steers + accelerates
    const wheelCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.settings.set({ steering: 'wheel' });
      g.ui.applyControlLayout();
      const pedal = document.querySelector('.touch-btn.pedal');
      const brake = document.querySelector('.touch-btn.brake');
      const wheelWrap = g.ui.hudWheel;
      const ring = wheelWrap?.firstElementChild;
      const pedalVisible = !!pedal && !pedal.classList.contains('hidden') && pedal.getBoundingClientRect().width > 40;
      const brakeVisible = !!brake && !brake.classList.contains('hidden') && brake.getBoundingClientRect().width > 40;
      const wheelVisible = !!wheelWrap && !wheelWrap.classList.contains('hidden') && ring.getBoundingClientRect().width > 80;
      const pr = pedal.getBoundingClientRect();
      const wr = ring.getBoundingClientRect();
      const noOverlap = pr.left > wr.right + 20 || wr.left > pr.right + 20;

      // Multi-touch: reset onto open road, left thumb drags analog wheel, right thumb holds pedal
      g.recoverRickshaw();
      const startYaw = g.controller.yaw;
      ring.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 10, clientX: 100, pointerType: 'touch' }));
      ring.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 10, clientX: 122, pointerType: 'touch' }));
      pedal.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 11, pointerType: 'touch' }));
      // Releasing another pointer must NOT cancel wheel steering
      ring.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 99, pointerType: 'touch' }));
      const pinX = g.controller.x;
      const pinZ = g.controller.z;
      for (let i = 0; i < 132; i++) {
        g.controller.x = pinX;
        g.controller.z = pinZ;
        g.update(1 / 60);
      }
      const speedInWheel = g.controller.speed;
      const yawDeltaInWheel = Math.abs(g.controller.yaw - startYaw);
      pedal.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch' }));
      ring.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 10, pointerType: 'touch' }));

      g.settings.set({ steering: 'buttons' });
      g.ui.applyControlLayout();
      return { pedalVisible, brakeVisible, wheelVisible, noOverlap, speedInWheel, yawDeltaInWheel };
    });
    check(
      'analog wheel mode keeps Pedal & Brake visible without overlap',
      wheelCheck.pedalVisible && wheelCheck.brakeVisible && wheelCheck.wheelVisible && wheelCheck.noOverlap,
      JSON.stringify(wheelCheck),
    );
    check(
      'analog wheel + touch pedal multi-touch drives and steers',
      wheelCheck.speedInWheel > 2.0 && wheelCheck.yawDeltaInWheel > 0.1,
      JSON.stringify(wheelCheck),
    );

    // 5. Camera toggle button on mobile HUD
    const camToggle = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const before = g.settings.get().cameraMode;
      const camBtn = [...document.querySelectorAll('.hud-topright .icon-btn')][1];
      camBtn?.click();
      const after = g.settings.get().cameraMode;
      return { before, after };
    });
    check('mobile HUD camera button toggles chase camera', camToggle.before !== camToggle.after, JSON.stringify(camToggle));

    // 6. Android hardware back-button hook pauses and resumes cleanly
    const backCheck = await page.evaluate(() => {
      const handledPause = window.__banglarTeslaAndroidBack();
      const pausedScreen = window.__banglarTesla.debugSnapshot().screen;
      const handledResume = window.__banglarTeslaAndroidBack();
      const resumedScreen = window.__banglarTesla.debugSnapshot().screen;
      return { handledPause, pausedScreen, handledResume, resumedScreen };
    });
    check(
      'Android hardware back button pauses HUD and resumes from Pause',
      backCheck.handledPause && backCheck.pausedScreen === 'pause' && backCheck.handledResume && backCheck.resumedScreen === 'hud',
      JSON.stringify(backCheck),
    );

    check('zero page errors during mobile verification', errors.length === 0, errors.join(' | '));
  } finally {
    await teardownHarness(browser, server);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} mobile checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('mobile-check crashed:', err);
  process.exit(1);
});
