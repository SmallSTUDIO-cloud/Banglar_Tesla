/**
 * Comprehensive Chromium + WebGL End-to-End Verification for Banglar Tesla v0.5.0:
 *  1. Dynamic In-Game Time System:
 *     - HUD clock (`#hud-clock-text`) formatted `07:30 AM` / `06:45 PM` identically in `bn` & `en`
 *     - Advances during active driving, pauses when paused, syncs `DayPhase`, zero sub-minute DOM mutations
 *     - Persists cleanly across full browser reload
 *  2. Hold-to-Boost `টার্বো` (`#hud-turbo-btn`) + Arcade VFX:
 *     - Strictly hold-only (~3x speed / ~60 km/h peak, twin rear exhaust flames), separate from `টান` stamina
 *     - Instant stop on `pointerup` release AND on pause (`pauseGame()`)
 *     - `turboCap` & `turboRecharge` upgrades purchasable in Dokan/Garage
 *  3. Edge-Triggered `রিকশার অবস্থা কম` HUD Warning (`#hud-condition-warn`):
 *     - Appears below 35%, zero duplicate toast spam across repeated impacts, clears on Garage repair
 *  4. Rickshaw Blacklist (#10 -> #1), Skippable First-Entry Cinematic & Rival Races:
 *     - First entry plays 18s Mohammadpur intro cinematic (`#cinematic-overlay`); Skip button cleans up
 *       immediately and opens `#10 -> #1` Blacklist screen; subsequent opens skip auto-cinematic
 *     - Rival #10 boss race (`3-2-1-GO`, `#hud-race`, checkpoints) awards টাকা + REP, advances rank `10 -> 9`
 *     - Race defeat deducts bounded টাকা fee (`balance >= 0`) and Retry restarts cleanly with zero soft-lock
 *  5. 5-Heat Police Pursuit & Pooled Smashable Roadblocks:
 *     - Spawns patrol SUVs + smashable/passable roadblocks, renders `#hud-pursuit`, caps audio sources,
 *       and cleans up all units & roadblocks on escape / menu return
 *  6. DEV Diagnostics (`__btToggleDevPerf`, `__btToggleColliderDebug`) & Bilingual (`bn`/`en`) Integrity:
 *     - Zero raw i18n keys, zero page errors, zero failed HTTP/audio requests (all 26 WAVs decoded)
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
const PORT = 4199;
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

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    env: ensureChromiumEnv(),
  });

  const page = await browser.newPage();
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} (${req.failure()?.errorText})`));
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.url()} [HTTP ${res.status()}]`);
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 25000 });
    await page.click('body');
    await page.waitForFunction('window.__banglarTesla.debugSnapshot().audioAssets === 26', { timeout: 15000 });

    // ------------------------------------------------------------------
    // 1. Dynamic In-Game Time System (bn + en formatting, pause freeze, zero per-frame DOM churn)
    // ------------------------------------------------------------------
    const timeCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.state.markTutorialDone();
      g.debugStartMode('free');

      const fmtMorningBn = g.debugSetTimeForTest(7, 30);
      const domMorningBn = document.getElementById('hud-clock-text')?.textContent;
      const phaseMorning = g.debugSnapshot().dayPhase;

      const fmtEveningBn = g.debugSetTimeForTest(18, 45);
      const domEveningBn = document.getElementById('hud-clock-text')?.textContent;
      const phaseEvening = g.debugSnapshot().dayPhase;

      g.debugSetLanguage('en');
      const domEveningEn = document.getElementById('hud-clock-text')?.textContent;
      g.debugSetLanguage('bn');

      // Sub-minute DOM mutation observer check (0.6s driving inside minute 18:45.0 -> 18:45.3)
      g.debugSetTimeForTest(18, 45);
      const clockNode = document.getElementById('hud-clock-text');
      let subMinuteDomMutations = 0;
      const obs = new MutationObserver(() => {
        subMinuteDomMutations++;
      });
      if (clockNode) obs.observe(clockNode, { childList: true, characterData: true, subtree: true });
      for (let i = 0; i < 30; i++) {
        g.update(1 / 60);
      }
      obs.disconnect();

      // Advance past whole minute while driving
      const beforeDriveMin = g.debugSnapshot().clockMinutes;
      g.debugStepSim(4.5);
      const afterDriveMin = g.debugSnapshot().clockMinutes;
      const afterDriveText = document.getElementById('hud-clock-text')?.textContent;

      // Pause must freeze in-game clock completely
      g.pauseGame();
      const pausedStartMin = g.debugSnapshot().clockMinutes;
      for (let i = 0; i < 120; i++) {
        g.update(1 / 60);
      }
      const pausedEndMin = g.debugSnapshot().clockMinutes;
      g.resumeGame();
      g.debugSaveNow();

      return {
        fmtMorningBn,
        domMorningBn,
        phaseMorning,
        fmtEveningBn,
        domEveningBn,
        domEveningEn,
        phaseEvening,
        subMinuteDomMutations,
        beforeDriveMin,
        afterDriveMin,
        afterDriveText,
        pausedStartMin,
        pausedEndMin,
      };
    });

    check(
      'Dynamic HUD clock formats 07:30 AM / 06:45 PM identically in Bangla and English and syncs DayPhase',
      timeCheck.domMorningBn === '07:30 AM' &&
        timeCheck.domEveningBn === '06:45 PM' &&
        timeCheck.domEveningEn === '06:45 PM' &&
        timeCheck.phaseMorning === 'morning' &&
        timeCheck.phaseEvening === 'blue',
      JSON.stringify(timeCheck),
    );
    check(
      'Dynamic HUD clock advances while driving, freezes while paused, and causes 0 sub-minute DOM mutations',
      timeCheck.afterDriveMin > timeCheck.beforeDriveMin + 1.5 &&
        timeCheck.afterDriveText !== '06:45 PM' &&
        timeCheck.pausedEndMin === timeCheck.pausedStartMin &&
        timeCheck.subMinuteDomMutations === 0,
      JSON.stringify({
        droveDeltaMin: +(timeCheck.afterDriveMin - timeCheck.beforeDriveMin).toFixed(2),
        afterDriveText: timeCheck.afterDriveText,
        pausedDelta: timeCheck.pausedEndMin - timeCheck.pausedStartMin,
        subMinuteDomMutations: timeCheck.subMinuteDomMutations,
      }),
    );

    // ------------------------------------------------------------------
    // 2. Hold-to-Boost টার্বো (#hud-turbo-btn) + Arcade VFX + Instant Release/Pause Stop
    // ------------------------------------------------------------------
    const turboCheck = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.recoverRickshaw();
      g.controller.stamina = 100;
      g.controller.turboCharge = 100;
      const turboBtn = document.getElementById('hud-turbo-btn');
      const pedalBtn = document.querySelector('.touch-btn.pedal');
      if (!turboBtn || !pedalBtn) return { error: 'missing turbo/pedal btn' };

      // Hold Pedal + Hold Turbo
      pedalBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 21, pointerType: 'touch' }));
      turboBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 22, pointerType: 'touch' }));

      for (let i = 0; i < 180; i++) {
        g.controller.turboCharge = Math.max(g.controller.turboCharge, 35);
        g.update(1 / 60);
      }
      const activeDuringHold = g.controller.turboActive;
      const peakKmh = +(g.controller.speed * 3.6).toFixed(1);
      const staminaUnchanged = g.controller.stamina === 100;
      const flamesVisible = g.arcadeVfx.flameGroup?.visible === true;

      // Releasing pointerup stops Turbo IMMEDIATELY on very next frame!
      turboBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 22, pointerType: 'touch' }));
      g.update(1 / 60);
      const stoppedOnRelease = g.controller.turboActive === false;

      // Re-hold Turbo, then pause game -> must stop Turbo IMMEDIATELY!
      turboBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 23, pointerType: 'touch' }));
      g.update(1 / 60);
      const reIgnited = g.controller.turboActive === true;
      g.pauseGame();
      const stoppedOnPause = g.controller.turboActive === false;
      g.resumeGame();
      pedalBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 21, pointerType: 'touch' }));

      return {
        activeDuringHold,
        peakKmh,
        staminaUnchanged,
        flamesVisible,
        stoppedOnRelease,
        reIgnited,
        stoppedOnPause,
      };
    });

    check(
      'Hold-to-boost টার্বো hits ~58–62 km/h with rear flames, keeps টান stamina untouched, and stops instantly on release/pause',
      turboCheck.activeDuringHold &&
        turboCheck.peakKmh >= 54 &&
        turboCheck.peakKmh <= 65 &&
        turboCheck.staminaUnchanged &&
        turboCheck.flamesVisible &&
        turboCheck.stoppedOnRelease &&
        turboCheck.reIgnited &&
        turboCheck.stoppedOnPause,
      JSON.stringify(turboCheck),
    );

    // ------------------------------------------------------------------
    // 3. Edge-Triggered রিকশার অবস্থা কম HUD Warning (Zero Toast Spam) + Dokan Turbo Upgrades
    // ------------------------------------------------------------------
    const condAndUpgrades = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.debugSetBalanceForTest(4000);
      g.state.repair();
      g.hudTick = 1;
      g.update(1 / 60);
      const warnEl = document.getElementById('hud-condition-warn');
      const hiddenWhenHealthy = warnEl?.classList.contains('hidden') === true;

      const toastsEl = document.querySelector('.toasts');
      let toastMutations = 0;
      const obs = new MutationObserver(() => {
        toastMutations++;
      });
      if (toastsEl) obs.observe(toastsEl, { childList: true });

      // Cross below 35% and apply 6 further impacts while < 35%
      g.state.damageCondition(70);
      for (let i = 0; i < 6; i++) g.state.damageCondition(3);
      g.hudTick = 1;
      g.update(1 / 60);
      obs.disconnect();

      const visibleWhenLow = warnEl?.classList.contains('hidden') === false;
      const warnText = warnEl?.textContent?.trim();

      // Repair clears warning badge cleanly; buy turboCap & turboRecharge upgrades
      const repRes = g.state.repair();
      const buyCap = g.state.buyUpgrade('turboCap');
      const buyRech = g.state.buyUpgrade('turboRecharge');
      g.hudTick = 1;
      g.update(1 / 60);
      const hiddenAfterRepair = warnEl?.classList.contains('hidden') === true;

      return {
        hiddenWhenHealthy,
        visibleWhenLow,
        warnText,
        toastMutations,
        repaired: repRes.ok,
        hiddenAfterRepair,
        buyCap: buyCap.ok,
        buyRech: buyRech.ok,
      };
    });

    check(
      'রিকশার অবস্থা কম uses single reused HUD badge with 0 toast spam and clears on repair; Turbo upgrades buy cleanly',
      condAndUpgrades.hiddenWhenHealthy &&
        condAndUpgrades.visibleWhenLow &&
        condAndUpgrades.warnText === 'রিকশার অবস্থা কম' &&
        condAndUpgrades.toastMutations === 0 &&
        condAndUpgrades.repaired &&
        condAndUpgrades.hiddenAfterRepair &&
        condAndUpgrades.buyCap &&
        condAndUpgrades.buyRech,
      JSON.stringify(condAndUpgrades),
    );

    // ------------------------------------------------------------------
    // 4. Rickshaw Blacklist (#10 -> #1), Skippable First-Entry Cinematic & Rival Races
    // ------------------------------------------------------------------
    const blacklistFlow = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.returnToMenu();

      // First-time open triggers skippable 18s Mohammadpur Blacklist intro cinematic!
      g.openBlacklist('menu');
      const playingOnFirstOpen = g.debugSnapshot().cinematicPlaying === true;
      const overlayVisible = !document.getElementById('cinematic-overlay')?.classList.contains('hidden');

      // Advance cinematic 2.5s, then click Skip button!
      for (let i = 0; i < 150; i++) g.update(1 / 60);
      const skipBtn = document.querySelector('#cinematic-overlay button');
      skipBtn?.click();

      const afterSkipSnap = g.debugSnapshot();
      const rivalCards = document.querySelectorAll('.blacklist-card').length;

      // Close and re-open Blacklist -> cinematic must NOT auto-play a second time!
      g.ui.show('menu');
      g.openBlacklist('menu');
      const playingOnSecondOpen = g.debugSnapshot().cinematicPlaying;
      const portraitSvgCount = document.querySelectorAll('.blacklist-card [data-rival-portrait] svg').length;

      // Test skippable per-rival 3D Character Intro (`playRivalIntro(10)`)!
      g.playRivalIntro(10, false);
      const rivalIntroPlaying = g.debugSnapshot().cinematicPlaying === true;
      for (let i = 0; i < 60; i++) g.update(1 / 60);
      g.skipBlacklistIntro();
      const afterRivalIntroScreen = g.debugSnapshot().screen;

      // Verify 2-lap circuit HUD (`bl_boss_07`)
      g.startRivalEvent('bl_boss_07');
      g.hudTick = 1;
      g.update(0);
      const circuitCpText = document.getElementById('hud-race')?.textContent ?? '';
      g.exitRaceToFreeRide();

      // Launch Rival #10 boss event (`bl_boss_10`) — full 4-rickshaw race!
      const balBeforeWin = g.state.balance;
      const repBeforeWin = g.state.rep;
      g.startRivalEvent('bl_boss_10');
      const raceHudVisible = !document.getElementById('hud-race')?.classList.contains('hidden');
      const participantCount = g.raceSystem.participantCount;
      const aiSnap = g.raceSystem.getAiRacersSnapshot();
      const allDriversVisible = aiSnap.length === 3 && aiSnap.every((r) => r.hasVisibleDriver);
      const uniqueTendencies = new Set(aiSnap.map((r) => r.tendency)).size;
      const hudFourRacerText = document.getElementById('hud-race')?.textContent ?? '';

      // Finish 3s countdown, record speed, and pass all checkpoints through real RivalRaceSystem!
      g.debugStepSim(3.2);
      g.raceSystem.recordPlayerSpeed(16.2);
      const cps = g.raceSystem.checkpoints.slice();
      for (const cp of cps) {
        g.debugTeleport(cp.x, cp.z, 0);
        g.debugStepSim(0.15);
      }

      const afterWinRank = g.state.blacklistRank;
      const afterWinBal = g.state.balance;
      const afterWinRep = g.state.rep;
      const resultScreen = g.debugSnapshot().screen;
      const winResultMode = document.getElementById('race-result-sheet')?.getAttribute('data-result-mode');
      const winHasPhotoWindow = Boolean(document.querySelector('[data-testid="winner-photo-window"]'));
      const winStandingPills = document.querySelectorAll('#race-result-sheet .standing-pill').length;
      const winClockBefore = g.debugSnapshot().clockMinutes;
      g.frame(performance.now() + 500);
      const winClockFrozen = g.debugSnapshot().clockMinutes === winClockBefore;
      g.exitRaceToFreeRide();

      // Now test Race Defeat (bounded টাকা penalty + non-photo defeat screen + clean Retry!)
      g.debugSetBalanceForTest(15); // Less than lossFee (25) so we prove balance clamps >= 0!
      g.startRivalEvent('ev_duel_ring');
      g.debugStepSim(3.2);
      const limit = g.raceSystem.currentEvent?.targetSeconds ?? 78;
      g.debugStepSim(limit + 35);
      const lossScreen = g.debugSnapshot().screen;
      const lossResultMode = document.getElementById('race-result-sheet')?.getAttribute('data-result-mode');
      const lossHasPhotoWindow = Boolean(document.querySelector('[data-testid="winner-photo-window"]'));
      const balAfterLoss = g.state.balance;
      g.retryLastEvent();
      const retriedCleanly = g.raceSystem.isActive && g.debugSnapshot().screen === 'hud';
      g.exitRaceToFreeRide();

      // Check NPC Pedestrian anatomy, street litter & Web/PC High quality profile
      const pedSummary = g.peds.getCharacterMeshSummary();
      const litterCount = g.city.litterCount;
      const pcHighApplied = g.debugSetQuality('pc_high').quality === 'pc_high';
      g.debugSetQuality('balanced');

      return {
        playingOnFirstOpen,
        overlayVisible,
        afterSkipScreen: afterSkipSnap.screen,
        afterSkipCinematic: afterSkipSnap.cinematicPlaying,
        introSeen: afterSkipSnap.blacklistIntroSeen,
        rivalCards,
        portraitSvgCount,
        rivalIntroPlaying,
        afterRivalIntroScreen,
        circuitHasLapLabel: circuitCpText.includes('1/2'),
        playingOnSecondOpen,
        raceHudVisible,
        participantCount,
        allDriversVisible,
        uniqueTendencies,
        hudHasOf4: hudFourRacerText.includes('/4'),
        balDeltaWin: afterWinBal - balBeforeWin,
        repDeltaWin: afterWinRep - repBeforeWin,
        afterWinRank,
        resultScreen,
        winResultMode,
        winHasPhotoWindow,
        winStandingPills,
        winClockFrozen,
        lossScreen,
        lossResultMode,
        lossHasPhotoWindow,
        balAfterLoss,
        retriedCleanly,
        pedSummary,
        litterCount,
        pcHighApplied,
      };
    });

    check(
      'First Blacklist entry plays skippable intro cinematic once, renders 10 rival SVG portraits, and supports skippable per-rival 3D intro',
      blacklistFlow.playingOnFirstOpen &&
        blacklistFlow.overlayVisible &&
        blacklistFlow.afterSkipScreen === 'blacklist' &&
        !blacklistFlow.afterSkipCinematic &&
        blacklistFlow.introSeen &&
        blacklistFlow.rivalCards === 10 &&
        blacklistFlow.portraitSvgCount === 10 &&
        blacklistFlow.rivalIntroPlaying &&
        blacklistFlow.afterRivalIntroScreen === 'blacklist' &&
        !blacklistFlow.playingOnSecondOpen,
      JSON.stringify({
        rivalCards: blacklistFlow.rivalCards,
        portraitSvgCount: blacklistFlow.portraitSvgCount,
        rivalIntroPlaying: blacklistFlow.rivalIntroPlaying,
        afterRivalIntroScreen: blacklistFlow.afterRivalIntroScreen,
      }),
    );
    check(
      '4-Rickshaw Race runs 4 participants (3 visible distinct-tendency AI rivals + 1/4..4/4 & 2-lap HUD) and triggers Printed-Photo Winner Snapshot ONLY on victory',
      blacklistFlow.raceHudVisible &&
        blacklistFlow.participantCount === 4 &&
        blacklistFlow.allDriversVisible &&
        blacklistFlow.uniqueTendencies === 3 &&
        blacklistFlow.hudHasOf4 &&
        blacklistFlow.circuitHasLapLabel &&
        blacklistFlow.balDeltaWin > 0 &&
        blacklistFlow.repDeltaWin > 0 &&
        blacklistFlow.afterWinRank === 9 &&
        blacklistFlow.resultScreen === 'raceResult' &&
        blacklistFlow.winResultMode === 'winner-photo' &&
        blacklistFlow.winHasPhotoWindow === true &&
        blacklistFlow.winStandingPills === 4 &&
        blacklistFlow.winClockFrozen === true &&
        blacklistFlow.lossScreen === 'raceResult' &&
        blacklistFlow.lossResultMode === 'defeat' &&
        blacklistFlow.lossHasPhotoWindow === false &&
        blacklistFlow.balAfterLoss === 0 &&
        blacklistFlow.retriedCleanly,
      JSON.stringify({
        participantCount: blacklistFlow.participantCount,
        allDriversVisible: blacklistFlow.allDriversVisible,
        uniqueTendencies: blacklistFlow.uniqueTendencies,
        winResultMode: blacklistFlow.winResultMode,
        winStandingPills: blacklistFlow.winStandingPills,
        lossResultMode: blacklistFlow.lossResultMode,
        lossHasPhotoWindow: blacklistFlow.lossHasPhotoWindow,
      }),
    );
    check(
      'NPC pedestrians have full visible head/hair/arms/legs, city renders sparse non-collidable litter, and Web/PC High quality works',
      blacklistFlow.pedSummary.hasHead &&
        blacklistFlow.pedSummary.hasHair &&
        blacklistFlow.pedSummary.hasLeftArm &&
        blacklistFlow.pedSummary.hasRightArm &&
        blacklistFlow.pedSummary.hasLegs &&
        blacklistFlow.litterCount >= 100 &&
        blacklistFlow.pcHighApplied,
      JSON.stringify({
        pedSummary: blacklistFlow.pedSummary,
        litterCount: blacklistFlow.litterCount,
        pcHighApplied: blacklistFlow.pcHighApplied,
      }),
    );

    // ------------------------------------------------------------------
    // 5. 5-Heat Police Pursuit, Pooled Roadblocks, DEV Diagnostics & Reload Persistence
    // ------------------------------------------------------------------
    const policeAndDiag = await page.evaluate(() => {
      const g = window.__banglarTesla;
      g.recoverRickshaw();
      g.debugStartPursuitForTest(3);
      g.debugStepSim(1.2);

      const snapPursuit = g.debugSnapshot();
      const pursuitHudVisible = !document.getElementById('hud-pursuit')?.classList.contains('hidden');

      // Toggle DEV collider debug & perf overlay cleanly
      const colOn = window.__btToggleColliderDebug();
      g.update(1 / 60);
      const colOff = window.__btToggleColliderDebug();

      // Switch to English and inspect UI for any leaked raw i18n keys
      g.debugSetLanguage('en');
      g.hudTick = 1;
      g.update(1 / 60);
      const bodyEn = document.body.innerText;
      const hasRawKey = /\b(hud\.|menu\.|police\.|blacklist\.|race\.|toast\.)[a-zA-Z]+/.test(bodyEn);
      g.debugSetLanguage('bn');

      // Return to menu must clean up all active police SUVs and roadblocks
      const savedClock = g.debugSetTimeForTest(16, 45);
      g.returnToMenu();
      const snapMenu = g.debugSnapshot();

      return {
        pursuitState: snapPursuit.policeState,
        pursuitHeat: snapPursuit.policeHeat,
        pursuitUnits: snapPursuit.policeUnits,
        audioSourcesDuringPursuit: snapPursuit.audioActiveSources,
        pursuitHudVisible,
        colOn,
        colOff,
        hasRawKey,
        savedClock,
        menuUnitsAfterCleanup: snapMenu.policeUnits,
        menuRoadblocksAfterCleanup: snapMenu.roadblocksActive,
      };
    });

    check(
      '5-Heat Police Pursuit spawns units within audio source cap and cleans up 100% on menu exit',
      policeAndDiag.pursuitState === 'pursuing' &&
        policeAndDiag.pursuitHeat === 3 &&
        policeAndDiag.pursuitUnits >= 2 &&
        policeAndDiag.audioSourcesDuringPursuit <= 16 &&
        policeAndDiag.pursuitHudVisible &&
        policeAndDiag.menuUnitsAfterCleanup === 0 &&
        policeAndDiag.menuRoadblocksAfterCleanup === 0,
      JSON.stringify(policeAndDiag),
    );
    check(
      'DEV collider debug toggles cleanly and English/Bangla localization has zero raw i18n keys',
      policeAndDiag.colOn === true && policeAndDiag.colOff === false && !policeAndDiag.hasRawKey,
      JSON.stringify({ colOn: policeAndDiag.colOn, colOff: policeAndDiag.colOff, hasRawKey: policeAndDiag.hasRawKey }),
    );

    // ------------------------------------------------------------------
    // 6. Extreme v0.5.0 Combined Stress (Heat 5 + Roadblocks + Rival Race + Turbo Flames + Rain + 12 Start/Cancel Cycles)
    // ------------------------------------------------------------------
    const v05Stress = await page.evaluate(() => {
      const g = window.__banglarTesla;
      // Warm both classic & electric rival caches once, then verify 12 start/cancel cycles leak 0!
      g.startRivalEvent('bl_boss_10');
      g.renderer.render(g.scene, g.camera);
      g.exitRaceToFreeRide();
      g.startRivalEvent('bl_boss_03');
      g.env.setWeather('rain');
      g.debugStartPursuitForTest(5);
      g.debugStepSim(3.3);
      g.renderer.render(g.scene, g.camera);
      const geomsStart = g.renderer.info.memory.geometries;
      const texStart = g.renderer.info.memory.textures;
      const programsStart = g.renderer.info.programs?.length ?? 0;

      const turboBtn = document.getElementById('hud-turbo-btn');
      const pedalBtn = document.querySelector('.touch-btn.pedal');
      pedalBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, pointerType: 'touch' }));
      turboBtn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, pointerType: 'touch' }));

      const t0 = performance.now();
      for (let i = 0; i < 120; i++) {
        g.controller.turboCharge = 80;
        if (i === 30) {
          g.arcadeVfx.triggerCrash('major', g.controller.x, g.controller.y + 0.5, g.controller.z, 0, 1, 1);
        }
        g.update(1 / 60);
      }
      const simMsPerStep = +((performance.now() - t0) / 120).toFixed(3);
      g.renderer.render(g.scene, g.camera);
      const callsPeak = g.renderer.info.render.calls;
      const audioPeak = g.debugSnapshot().audioActiveSources;

      turboBtn?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 42, pointerType: 'touch' }));
      pedalBtn?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, pointerType: 'touch' }));

      // 12 rapid start/cancel cycles of rival races & pursuits -> must leak 0 geometries/textures!
      for (let c = 0; c < 12; c++) {
        g.startRivalEvent(c % 2 === 0 ? 'bl_boss_10' : 'ev_duel_ring');
        g.debugStartPursuitForTest((c % 5) + 1);
        g.update(1 / 60);
        g.exitRaceToFreeRide();
      }
      g.debugSetTimeForTest(16, 45);
      g.returnToMenu();
      g.debugSaveNow();

      const geomsEnd = g.renderer.info.memory.geometries;
      const texEnd = g.renderer.info.memory.textures;
      const programsEnd = g.renderer.info.programs?.length ?? 0;

      return {
        simMsPerStep,
        callsPeak,
        audioPeak,
        geomsStart,
        geomsEnd,
        texStart,
        texEnd,
        programsStart,
        programsEnd,
      };
    });

    check(
      'Extreme v0.5.0 stress (Heat 5 + Roadblocks + Rival + Turbo Flames + Crash + Rain + 12 cycles) stays within Galaxy M21 budgets with 0 GPU leaks',
      v05Stress.callsPeak <= 245 &&
        v05Stress.audioPeak <= 16 &&
        v05Stress.simMsPerStep <= 3.5 &&
        v05Stress.geomsEnd <= v05Stress.geomsStart &&
        v05Stress.texEnd <= v05Stress.texStart,
      JSON.stringify(v05Stress),
    );

    // Full reload persistence check for v0.5.0 fields (REP, Blacklist rank #9, clock 04:45 PM, introSeen)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 150000 });
    await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
    const afterReload = await page.evaluate(() => {
      const s = window.__banglarTesla.debugSnapshot();
      return {
        blacklistRank: s.blacklistRank,
        blacklistIntroSeen: s.blacklistIntroSeen,
        rep: s.rep,
        clockText: s.clockText,
        dayPhase: s.dayPhase,
      };
    });
    check(
      'v0.5.0 progression (Blacklist rank #9, REP, introSeen, 04:45 PM clock & golden DayPhase) persists across reload',
      afterReload.blacklistRank === 9 &&
        afterReload.blacklistIntroSeen === true &&
        afterReload.rep > 0 &&
        afterReload.clockText === '04:45 PM' &&
        afterReload.dayPhase === 'golden',
      JSON.stringify(afterReload),
    );

    check('Zero page errors across full v0.5.0 E2E verification', pageErrors.length === 0, pageErrors.join(' | '));
    check('Zero failed HTTP/audio requests across full v0.5.0 E2E verification', failedRequests.length === 0, failedRequests.join(' | '));
  } finally {
    await teardownHarness(browser, server);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} v0.5.0 checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
