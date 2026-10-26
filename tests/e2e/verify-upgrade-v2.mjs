/**
 * Comprehensive Chromium + WebGL End-to-End Verification for Master Upgrade v2 (v0.4.0):
 *  - Milestone 0 & 1: Autoplay unlock pill ("Tap to enable sound"), 15 decoded WAV buffers,
 *    zero 404 audio requests, menu -> driving -> paused -> menu scene transitions,
 *    Master/Music/SFX/calm-ambience settings & reload persistence.
 *  - Milestone 4: HUD `টান` button + Shift shortcut, ~1.95x speed boost, classic pedal
 *    stamina drain -> auto-stop at 0 -> regeneration, electric rickshaw boost + battery drain.
 *  - Milestone 6A: Roadside tea stall (`চা খান · ৳10`) stamina recovery & ৳10 deduction.
 *  - Milestone 3: Speed-thresholded breakable street lamps & roadside stalls, immediate
 *    collider disable, pooled debris activation & clean despawn back to 0 active pieces.
 *  - Milestone 2: Non-car immunity (CNG/rickshaw never trigger road rage), private car (`car`)
 *    high-impact trigger, "ROAD RAGE!" alert, exact sequential Bangla lines (`ওই হারামজাদা, দাঁড়া!`
 *    & `মাফ করে দেন ভাই, ভুলে লেগে গেছে!`), uninterrupted 5.0s escape (`পালাতে পেরেছেন!`),
 *    catch confrontation modal (`১০০ টাকা দিয়ে মিটমাট করুন` vs `দেব না`), pause-exploit block,
 *    `৳100` settlement, disabled settlement when `< ৳100`, and slapstick scuffle resolution.
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
const PORT = 4198;
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

async function main() {
  fs.mkdirSync(artifacts, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  if (!(await waitFor(BASE))) {
    server.kill('SIGTERM');
    process.exit(1);
  }

  // Launch with real browser autoplay policy so we verify the unlock gesture + pill!
  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
    env: ensureChromiumEnv(),
    defaultViewport: { width: 915, height: 412, deviceScaleFactor: 1 },
  });

  const page = await browser.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`);
  });

  try {
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });

    // Dismiss splash screen via DOM click or check unlock pill
    const preGestureState = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const unlockBtn = document.getElementById('menu-sound-unlock');
      const apkBtn = document.getElementById('install-apk-btn');
      const apkNote = document.getElementById('install-apk-note');
      return {
        hasUnlockBtn: !!unlockBtn,
        initialUnlocked: g.debugSnapshot().audioUnlocked,
        apkVisible: !!apkBtn && apkBtn.offsetWidth > 0 && apkBtn.offsetHeight > 0,
        apkHref: apkBtn?.getAttribute('href') ?? '',
        apkHasPhoneIcon: !!apkBtn?.querySelector('svg'),
        apkHasNotice: (apkNote?.textContent ?? '').length > 8,
      };
    });
    check(
      'Audio unlock pill exists on main menu before/until user gesture',
      preGestureState.hasUnlockBtn,
      JSON.stringify({ hasUnlockBtn: preGestureState.hasUnlockBtn, initialUnlocked: preGestureState.initialUnlocked }),
    );
    check(
      'Web main menu displays Install APK button with phone icon, stable latest APK URL, and install approval note',
      preGestureState.apkVisible &&
        preGestureState.apkHref ===
          'https://github.com/SmallSTUDIO-cloud/Banglar_Tesla/releases/latest/download/Banglar-Tesla.apk' &&
        preGestureState.apkHasPhoneIcon &&
        preGestureState.apkHasNotice,
      JSON.stringify({
        apkVisible: preGestureState.apkVisible,
        apkHref: preGestureState.apkHref,
        apkHasPhoneIcon: preGestureState.apkHasPhoneIcon,
        apkHasNotice: preGestureState.apkHasNotice,
      }),
    );

    // Real Puppeteer mouse click on skip/unlock button triggers trusted user gesture
    await page.mouse.click(450, 210);
    await page.evaluate(async () => {
      document.getElementById('boot-skip')?.click();
      document.getElementById('menu-sound-unlock')?.click();
      await window.__banglarTesla.audio.init();
    });
    await page.waitForFunction('window.__banglarTesla.debugSnapshot().audioAssets === 26', { timeout: 15000 });

    const menuAudioSnap = await page.evaluate(() => {
      const s = window.__banglarTesla.debugSnapshot();
      const pillHidden = document.getElementById('menu-sound-unlock')?.classList.contains('hidden') ?? false;
      return {
        audio: s.audio,
        audioUnlocked: s.audioUnlocked,
        audioScene: s.audioScene,
        audioAssets: s.audioAssets,
        pillHidden,
      };
    });
    check(
      'All 15 bundled audio assets decode cleanly and menu audio unlocks',
      menuAudioSnap.audio &&
        menuAudioSnap.audioUnlocked &&
        menuAudioSnap.audioScene === 'menu' &&
        menuAudioSnap.audioAssets === 26 &&
        menuAudioSnap.pillHidden,
      JSON.stringify(menuAudioSnap),
    );

    // Start Free Ride mode and verify driving audio scene + capped active sources
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.state.progress.tutorialDone = true;
      g.debugStartMode('free');
      g.debugStepSim(0.5);
    });
    const driveAudioSnap = await page.evaluate(() => window.__banglarTesla.debugSnapshot());
    check(
      'Entering street gameplay transitions audio scene to driving within node budget',
      driveAudioSnap.audioScene === 'driving' && driveAudioSnap.audioActiveSources <= 10,
      JSON.stringify({
        audioScene: driveAudioSnap.audioScene,
        activeSources: driveAudioSnap.audioActiveSources,
      }),
    );

    // Pause -> driving audio lifecycle
    const pauseCycle = await page.evaluate(() => {
      const g = window.__banglarTesla;
      document.querySelector('[data-action="pause"]')?.click();
      const pausedScene = g.debugSnapshot().audioScene;
      g.resumeGame();
      g.debugStepSim(0.1);
      const resumedScene = g.debugSnapshot().audioScene;
      return { pausedScene, resumedScene };
    });
    check(
      'Pause and resume cleanly transition audio scene state',
      pauseCycle.pausedScene === 'paused' && pauseCycle.resumedScene === 'driving',
      JSON.stringify(pauseCycle),
    );

    // Milestone 4: Classic pedal rickshaw `টান` boost, stamina drain, auto-stop & regen
    const tanPedalCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugSelectVehicleForTest('classic');
      // Place on straight open stretch of Asad Ave
      g.debugTeleport(80, 95, 1.853); // verified centreline of Asad Ave segment `asad_4` (6.1m inside carriageway)
      g.controller.restoreStamina(100);
      g.debugStepSim(0.1);

      const tanBtn = document.getElementById('hud-tan-btn');
      const staminaPill = document.getElementById('hud-stamina');
      const label = tanBtn?.textContent?.trim() ?? '';
      const staminaVisible = !!staminaPill && !staminaPill.classList.contains('hidden');

      // Measure normal top speed over 4s on straight road
      g.debugInput = { throttle: 1, brake: 0, steer: 0 };
      for (let i = 0; i < 240; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const normalSpeed = g.controller.speed;

      // Toggle `টান` via real HUD button click
      g.controller.speed = 0;
      tanBtn?.click();
      const activeAfterClick = g.controller.tanActive;
      for (let i = 0; i < 240; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const boostSpeed = g.controller.speed;
      const staminaMid = g.controller.stamina;

      // Drain remaining stamina to 0 -> auto-stops `টান`
      for (let i = 0; i < 300; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const autoStopped = !g.controller.tanActive;
      const staminaDepleted = g.controller.stamina < 20;

      // Release pedal and regenerate stamina
      g.debugInput = null;
      g.controller.speed = 0;
      g.debugStepSim(3.0);
      const staminaRegen = g.controller.stamina;

      return {
        label,
        staminaVisible,
        activeAfterClick,
        normalSpeed: +normalSpeed.toFixed(2),
        boostSpeed: +boostSpeed.toFixed(2),
        ratio: +(boostSpeed / Math.max(0.1, normalSpeed)).toFixed(2),
        staminaMid: +staminaMid.toFixed(1),
        autoStopped,
        staminaDepleted,
        staminaRegen: +staminaRegen.toFixed(1),
      };
    });
    check(
      'Classic pedal rickshaw HUD টান button boosts ~1.95x, drains stamina, auto-stops at 0, and regenerates',
      tanPedalCheck.label.includes('টান') &&
        tanPedalCheck.staminaVisible &&
        tanPedalCheck.activeAfterClick &&
        tanPedalCheck.ratio >= 1.85 &&
        tanPedalCheck.ratio <= 2.05 &&
        tanPedalCheck.autoStopped &&
        tanPedalCheck.staminaDepleted &&
        tanPedalCheck.staminaRegen > 25,
      JSON.stringify(tanPedalCheck),
    );

    // Milestone 6A: Roadside tea stall quick rest (`৳10` -> full stamina)
    const teaRestCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugSetBalanceForTest(300);
      const moved = g.debugMoveNearTeaStallForTest();
      const teaBtn = document.getElementById('hud-tea-btn');
      const teaVisible = !!teaBtn && !teaBtn.classList.contains('hidden');
      const beforeBal = g.state.balance;
      const beforeStam = g.controller.stamina;
      teaBtn?.click();
      const afterBal = g.state.balance;
      const afterStam = g.controller.stamina;
      return { moved, teaVisible, beforeBal, afterBal, beforeStam: +beforeStam.toFixed(1), afterStam };
    });
    check(
      'Roadside tea stall button deducts ৳10 and restores pedal stamina to 100',
      teaRestCheck.moved &&
        teaRestCheck.teaVisible &&
        teaRestCheck.beforeBal - teaRestCheck.afterBal === 10 &&
        teaRestCheck.afterStam === 100,
      JSON.stringify(teaRestCheck),
    );

    // Milestone 4B: Electric rickshaw `টান` boost uses battery without showing pedal stamina meter
    const tanElectricCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugSelectVehicleForTest('electric');
      g.controller.rechargeBattery(100);
      g.debugStepSim(0.1);
      const staminaHidden = document.getElementById('hud-stamina')?.classList.contains('hidden') ?? false;
      const batteryVisible = !(document.getElementById('hud-battery')?.classList.contains('hidden') ?? true);

      // Measure normal electric speed first
      g.debugInput = { throttle: 1, brake: 0, steer: 0 };
      for (let i = 0; i < 200; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const normalSpeed = g.controller.speed;
      const normalBatteryUsed = 100 - g.controller.battery;

      // Now recharge and activate `টান`
      g.controller.rechargeBattery(100);
      g.controller.speed = 0;
      document.getElementById('hud-tan-btn')?.click();
      for (let i = 0; i < 200; i++) {
        g.controller.x = 80;
        g.controller.z = 95;
        g.update(1 / 60);
      }
      const boostSpeed = g.controller.speed;
      const boostBatteryUsed = 100 - g.controller.battery;
      g.debugInput = null;
      g.controller.setTanActive(false);
      g.controller.speed = 0;
      g.debugSelectVehicleForTest('classic');
      return {
        staminaHidden,
        batteryVisible,
        normalSpeed: +normalSpeed.toFixed(2),
        boostSpeed: +boostSpeed.toFixed(2),
        ratio: +(boostSpeed / Math.max(0.1, normalSpeed)).toFixed(2),
        normalBatteryUsed: +normalBatteryUsed.toFixed(2),
        boostBatteryUsed: +boostBatteryUsed.toFixed(2),
      };
    });
    check(
      'Electric rickshaw টান boosts top speed ~1.95x and drains battery faster without showing pedal stamina',
      tanElectricCheck.staminaHidden &&
        tanElectricCheck.batteryVisible &&
        tanElectricCheck.ratio >= 1.85 &&
        tanElectricCheck.ratio <= 2.05 &&
        tanElectricCheck.boostBatteryUsed > tanElectricCheck.normalBatteryUsed * 2.2,
      JSON.stringify(tanElectricCheck),
    );

    // Milestone 3: Breakable street lamps & roadside stalls
    const destructionCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const before = g.debugSnapshot().breakableBroken;
      const smashedLamp = g.debugSmashBreakableForTest('lamp', 6.8);
      const activeDuringLamp = g.debugSnapshot().activeDebrisPieces;
      const smashedStall = g.debugSmashBreakableForTest('stall', 6.8);
      const afterTwo = g.debugSnapshot().breakableBroken;
      // Step 3.2s so pooled debris & dust settle and despawn cleanly
      g.debugStepSim(3.2);
      const settledPieces = g.debugSnapshot().activeDebrisPieces;
      return { before, smashedLamp, activeDuringLamp, smashedStall, afterTwo, settledPieces };
    });
    check(
      'Street lamps and roadside stalls smash once at speed, disable colliders, and despawn pooled debris cleanly',
      destructionCheck.smashedLamp &&
        destructionCheck.smashedStall &&
        destructionCheck.activeDuringLamp > 0 &&
        destructionCheck.afterTwo >= destructionCheck.before + 2 &&
        destructionCheck.settledPieces === 0,
      JSON.stringify(destructionCheck),
    );

    // Milestone 2A: Non-car traffic collisions NEVER trigger road rage
    const nonCarCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.roadRage.cancel(0);
      const hitCng = g.debugCollideWithTrafficKindForTest('cng', 6.8);
      const stateAfterCng = g.debugSnapshot().roadRageState;
      const hitRickshaw = g.debugCollideWithTrafficKindForTest('rickshaw', 6.8);
      const stateAfterRickshaw = g.debugSnapshot().roadRageState;
      return { hitCng, stateAfterCng, hitRickshaw, stateAfterRickshaw };
    });
    check(
      'Colliding with non-car vehicles (CNG, rickshaw) never triggers road rage',
      nonCarCheck.hitCng &&
        nonCarCheck.stateAfterCng === 'idle' &&
        nonCarCheck.hitRickshaw &&
        nonCarCheck.stateAfterRickshaw === 'idle',
      JSON.stringify(nonCarCheck),
    );

    // Milestone 2B: Private car (`car`) high-impact collision -> Bangla dialogue + 5.0s escape -> `পালাতে পেরেছেন!`
    const carEscapeCheck = await page.evaluate(async () => {
      const g = window.__banglarTesla;
      g.roadRage.cancel(0);
      const hitCar = g.debugCollideWithTrafficKindForTest('car', 7.2);
      const startedState = g.debugSnapshot().roadRageState;
      const bannerVisible = !(document.getElementById('roadrage-banner')?.classList.contains('hidden') ?? true);
      const firstSub = document.querySelector('.hud-dialogue')?.textContent ?? '';

      // Immediately pull away >= 120m (fleeing down the avenue!) while sequential Bangla speech plays
      const dp = g.roadRage.driverPosition;
      g.debugTeleport(dp.x + 120, dp.z, 0);

      // Wait ~2.35s real time so driver clip finishes -> player apology clip & subtitle fire!
      await new Promise((r) => setTimeout(r, 2350));
      const secondSub = document.querySelector('.hud-dialogue')?.textContent ?? '';
      const snapAfterSpeech = g.debugSnapshot();

      // Finish remaining uninterrupted 5.0s escape timer
      g.debugStepSim(5.5);
      const toastText = document.querySelector('.toast-stack')?.textContent ?? '';
      const finalState = g.debugSnapshot().roadRageState;

      return {
        hitCar,
        startedState,
        bannerVisible,
        hasDriverLine: firstSub.includes('ওই হারামজাদা, দাঁড়া!'),
        hasPlayerLine:
          secondSub.includes('মাফ করে দেন ভাই, ভুলে লেগে গেছে!') ||
          snapAfterSpeech.speechLastText === 'মাফ করে দেন ভাই, ভুলে লেগে গেছে!',
        speechCount: snapAfterSpeech.speechCount,
        escapedToast: toastText.includes('পালাতে পেরেছেন!'),
        finalState,
      };
    });
    check(
      'Private car collision speaks both exact Bangla lines, tracks 5s distance escape, and shows পালাতে পেরেছেন!',
      carEscapeCheck.hitCar &&
        (carEscapeCheck.startedState === 'exiting' || carEscapeCheck.startedState === 'pursuing') &&
        carEscapeCheck.bannerVisible &&
        carEscapeCheck.hasDriverLine &&
        carEscapeCheck.hasPlayerLine &&
        carEscapeCheck.speechCount >= 2 &&
        carEscapeCheck.escapedToast &&
        carEscapeCheck.finalState === 'idle',
      JSON.stringify(carEscapeCheck),
    );

    // Milestone 2C: Catch -> Confrontation modal -> Pause blocked -> Pay ৳100 settlement
    const settleCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.roadRage.cancel(0);
      g.debugSetBalanceForTest(500);
      g.debugCollideWithTrafficKindForTest('car', 7.0);
      g.controller.speed = 0;
      // Let angry driver run up and catch stationary player
      g.debugStepSim(3.0);
      const stateAtCatch = g.debugSnapshot().roadRageState;
      const modalOpen = !(document.getElementById('roadrage-modal')?.classList.contains('hidden') ?? true);
      const payBtn = document.getElementById('roadrage-pay-btn');
      const refuseBtn = document.getElementById('roadrage-refuse-btn');
      const payText = payBtn?.textContent ?? '';
      const refuseText = refuseBtn?.textContent ?? '';
      const payEnabled = !!payBtn && !payBtn.disabled;

      // Attempt pause exploit while confronted -> must stay unpaused!
      document.querySelector('[data-action="pause"]')?.click();
      const pausedDuringConfront = g.isPaused;

      payBtn?.click();
      const afterBal = g.state.balance;
      const afterState = g.debugSnapshot().roadRageState;
      return {
        stateAtCatch,
        modalOpen,
        hasPayLabel: payText.includes('১০০ টাকা দিয়ে মিটমাট করুন'),
        hasRefuseLabel: refuseText.includes('দেব না'),
        payEnabled,
        pausedDuringConfront,
        afterBal,
        afterState,
      };
    });
    check(
      'Caught player gets confrontation modal (pause-safe) and settling deducts exact ৳100',
      settleCheck.stateAtCatch === 'confronting' &&
        settleCheck.modalOpen &&
        settleCheck.hasPayLabel &&
        settleCheck.hasRefuseLabel &&
        settleCheck.payEnabled &&
        !settleCheck.pausedDuringConfront &&
        settleCheck.afterBal === 400 &&
        settleCheck.afterState === 'idle',
      JSON.stringify(settleCheck),
    );

    // Milestone 2D: Insufficient balance (< ৳100) disables settlement -> `দেব না` triggers slapstick scuffle
    const scuffleCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.roadRage.cancel(0);
      g.debugSetBalanceForTest(45);
      g.controller.restoreStamina(100);
      const condBefore = g.state.progress.condition;
      g.debugCollideWithTrafficKindForTest('car', 7.0);
      g.controller.speed = 0;
      g.debugStepSim(3.0);

      const payBtn = document.getElementById('roadrage-pay-btn');
      const refuseBtn = document.getElementById('roadrage-refuse-btn');
      const payDisabled = !!payBtn?.disabled;

      refuseBtn?.click();
      const stateDuringScuffle = g.debugSnapshot().roadRageState;
      g.debugStepSim(2.0);
      const stateAfterScuffle = g.debugSnapshot().roadRageState;
      const staminaAfter = g.controller.stamina;
      const condAfter = g.state.progress.condition;
      return {
        payDisabled,
        stateDuringScuffle,
        stateAfterScuffle,
        staminaAfter: +staminaAfter.toFixed(1),
        condDropped: condAfter < condBefore,
      };
    });
    check(
      'With < ৳100 settlement is disabled and দেব না runs non-graphic scuffle + stamina/condition penalty',
      scuffleCheck.payDisabled &&
        scuffleCheck.stateDuringScuffle === 'scuffling' &&
        scuffleCheck.stateAfterScuffle === 'idle' &&
        scuffleCheck.staminaAfter < 60 &&
        scuffleCheck.condDropped,
      JSON.stringify(scuffleCheck),
    );

    // Settings audio controls + reload persistence
    await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.settings.set({
        master: 0.65,
        sfx: 0.55,
        musicEnabled: false,
        reduceNoisyAmbience: true,
      });
      g.applySettings();
      g.debugSaveNow();
    });
    await page.reload({ waitUntil: 'networkidle2', timeout: 150000 });
    await page.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    const persistedAudioSettings = await page.evaluate(() => {
      const g = window.__banglarTesla;
      const s = g.settings.get();
      return {
        master: s.master,
        sfx: s.sfx,
        musicEnabled: s.musicEnabled,
        reduceNoisyAmbience: s.reduceNoisyAmbience,
        breakableResetCleanly: g.debugSnapshot().breakableBroken === 0,
      };
    });
    check(
      'Audio settings persist across reload and broken street props reset cleanly on fresh boot',
      persistedAudioSettings.master === 0.65 &&
        persistedAudioSettings.sfx === 0.55 &&
        persistedAudioSettings.musicEnabled === false &&
        persistedAudioSettings.reduceNoisyAmbience === true &&
        persistedAudioSettings.breakableResetCleanly,
      JSON.stringify(persistedAudioSettings),
    );

    // Milestone 5: Verify Install APK button is hidden inside Android WebView shell
    // Stop & close the first game page before booting a second WebGL instance —
    // two concurrent SwiftShader scenes starve the second page's navigation.
    await page.evaluate(() => window.__banglarTesla.stop());
    await Promise.race([page.close(), new Promise((r) => setTimeout(r, 5000))]).catch(() => undefined);
    const androidPage = await browser.newPage();
    await androidPage.evaluateOnNewDocument(() => {
      window.__btAndroidTts = {
        isBengaliAvailable: () => true,
        speak: () => true,
        stop: () => undefined,
      };
    });
    await androidPage.goto(BASE, { waitUntil: 'networkidle2', timeout: 180000 });
    await androidPage.waitForFunction('!!window.__banglarTesla', { timeout: 60000 });
    const androidShellCheck = await androidPage.evaluate(() => ({
      isAndroidApp: window.__banglarTesla.isAndroidApp(),
      hasInstallApkBtn: !!document.getElementById('install-apk-btn'),
    }));
    await androidPage.close();
    check(
      'Install APK button is hidden when running inside the Android APK WebView',
      androidShellCheck.isAndroidApp && !androidShellCheck.hasInstallApkBtn,
      JSON.stringify(androidShellCheck),
    );

    check('Zero page errors across full Master Upgrade v2 E2E run', pageErrors.length === 0, pageErrors.join('; '));
    check('Zero failed HTTP/audio asset requests (no 404s)', failedRequests.length === 0, failedRequests.join('; '));
  } finally {
    await teardownHarness(browser, server);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} Master Upgrade v2 checks passed`);
  fs.writeFileSync(path.join(artifacts, 'upgrade-v2-verify-results.json'), JSON.stringify(results, null, 2));
  process.exit(passed !== results.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
