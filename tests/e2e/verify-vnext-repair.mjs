/** Focused vNext repair smoke test. Teleports are explicit test fixtures for
 * reaching pickup/drop/checkpoints; they are NOT evidence of a driven race. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4202, base = `http://127.0.0.1:${PORT}`;
const artifacts = path.join(root, 'artifacts');
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
}
async function waitFor(url) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
fs.mkdirSync(artifacts, { recursive: true });
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
if (!(await waitFor(base))) { server.kill(); throw new Error('preview failed to start'); }
let browser;
try {
  browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(),
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__banglarTesla.audio.init());

  const initial = await page.evaluate(async () => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free'); g.eventDirector.clearAll();
    g.startRivalEvent('bl_boss_10');
    const locked = !g.raceSystem.isActive;
    // Explicit fixture: approach different existing crowd slots and force only
    // the call-probability roll. No new pedestrian is manufactured by the test.
    window.__repairFindCaller = () => {
      const originalRandom = Math.random;
      Math.random = () => 0.1;
      try {
        const anchors = [[42,106,0],[-126,-136,0],[118,84,0],[-98,54,0],
          ...g.peds.peds.slice(0, g.peds.activePedestrianCount).map((p) => [p.worldX-18,p.worldZ,Math.PI/2])];
        for (const [x,z,yaw] of anchors) {
          g.debugTeleport(x,z,yaw); g.roadsideNextAt = 0; g.updateRoadsideRequest();
          if (g.roadsideRequest) return g.roadsideRequest;
        }
        return null;
      } finally { Math.random = originalRandom; }
    };
    const request = window.__repairFindCaller();
    if (!request) return { locked, found: false };
    g.hudTick = 1; g.updateHud();
    const waitingHint = document.querySelector('.hud-hint')?.textContent;
    const waitingMarker = g.ui.minimapMarker;
    const voiceText = g.debugSnapshot().speechLastText;
    const assetBn = await fetch('./audio/dialogue/roadside-call-bn.wav');
    const assetEn = await fetch('./audio/dialogue/roadside-call-en.wav');
    g.debugTeleport(request.stop.pickup.x, request.stop.pickup.z, 0);
    g.updateRoadsideRequest();
    return {
      locked, found: true, voiceText, bnAsset: assetBn.ok, enAsset: assetEn.ok,
      crowdReserved: g.peds.peds[request.pedestrianId].roadsideReserved,
      crowdInstanceHidden: [0, 5, 10].every((n) => g.peds.body.instanceMatrix.array[request.pedestrianId * 16 + n] === 0),
      labels: Array.from(document.querySelectorAll('#roadside-offer button')).map((b) => b.textContent.trim()),
      visible: !!document.getElementById('roadside-offer'),
      initialFare: request.negotiation.fare,
      destination: request.offer.dropName,
      destinationText: document.querySelector('#roadside-offer h3')?.textContent,
      waitingHint,
      waitingMarker: waitingMarker && Math.hypot(waitingMarker.x - request.stop.pickup.x, waitingMarker.z - request.stop.pickup.z) < 0.01,
      paused: g.debugSnapshot().paused,
    };
  });
  check('Locked boss cannot be launched before its checklist', initial.locked, JSON.stringify(initial));
  check('A nearby crowd caller has a stop hint/marker, localized destination and the three exact Bangla actions', initial.found && initial.crowdReserved && initial.crowdInstanceHidden && initial.visible && initial.paused && initial.voiceText === 'মামা যাবেন?' && initial.bnAsset && initial.enAsset && initial.waitingHint === 'কাছে ধীরে থামুন' && initial.waitingMarker && initial.destinationText && !initial.destinationText.includes('place.') && JSON.stringify(initial.labels) === JSON.stringify(['ওঠেন','বাতিল','দামাদামি']), JSON.stringify(initial));
  if (initial.visible) await page.screenshot({ path: path.join(artifacts, 'vnext-roadside-offer.png') });

  const boarded = await page.evaluate(() => {
    const g = window.__banglarTesla;
    const originalRandom = Math.random;
    Math.random = () => 0.25;
    document.querySelector('[data-roadside="bargain"]')?.click();
    Math.random = originalRandom;
    const request = g.roadsideRequest;
    const revised = request?.negotiation.fare ?? 0;
    const disabled = document.querySelector('[data-roadside="bargain"]')?.disabled;
    document.querySelector('[data-roadside="board"]')?.click();
    const passenger = g.missions.passenger;
    g.update(1/60); // enter boarding at the stopped pickup
    const p0 = {x:g.controller.x,z:g.controller.z};
    const a0 = passenger ? {x:passenger.group.position.x,z:passenger.group.position.z} : null;
    g.debugInput = {throttle:1,steer:0,brake:0};
    g.debugStepSim(0.5);
    const held = Math.hypot(g.controller.x-p0.x,g.controller.z-p0.z) < 0.2;
    const walked = passenger && a0 && Math.hypot(passenger.group.position.x-a0.x,passenger.group.position.z-a0.z) > 0.2;
    g.debugInput = null;
    const reached = g.debugStepUntil(() => g.missions.state === 'toDropoff', 12);
    return { revised, disabled, reached, held, walked, samePassenger: passenger === g.missions.passenger, agreed: g.missions.offer?.agreedFare, dropId: g.missions.offer?.dropId };
  });
  check('One successful bargain revises fare, disables reroll and boards the same passenger', boarded.reached && boarded.held && boarded.walked && boarded.samePassenger && boarded.disabled && boarded.revised > initial.initialFare && boarded.agreed === boarded.revised, JSON.stringify(boarded));

  const delivered = await page.evaluate(() => {
    const g = window.__banglarTesla;
    const before = g.state.balance;
    g.debugTeleportToDropoff(); g.debugStepSim(0.2);
    const after = g.state.balance, rides = g.state.progress.rides, tasks = [...g.state.progress.blacklistTasks];
    g.debugStepSim(1);
    const stable = g.state.balance === after && g.state.progress.rides === rides;
    const result = g.ui.currentScreen;
    g.enterFreeRide();
    return { before, after, rides, tasks, stable, result };
  });
  check('Passenger drop-off pays the agreed fare once and records the fare prerequisite', delivered.after - delivered.before === boarded.agreed && delivered.stable && delivered.tasks.includes('10:fare'), JSON.stringify(delivered));

  const rejection = await page.evaluate(() => {
    const g = window.__banglarTesla; g.eventDirector.clearAll();
    const req = window.__repairFindCaller();
    if (!req) return { found: false };
    const actor = req.actor;
    g.debugTeleport(req.stop.pickup.x,req.stop.pickup.z,0); g.updateRoadsideRequest();
    const old = Math.random; Math.random = () => 0.75;
    const x = actor.group.position.x, z = actor.group.position.z;
    document.querySelector('[data-roadside="bargain"]')?.click(); Math.random = old;
    const gone = !g.roadsideRequest && !document.getElementById('roadside-offer');
    const unpaused = !g.debugSnapshot().paused;
    g.debugStepSim(1);
    const walked = !!actor.group.parent && Math.hypot(actor.group.position.x-x, actor.group.position.z-z) > 0.3;
    g.debugStepSim(4);
    return { found: true, gone, walked, removed: !actor.group.parent, unpaused, returnedToCrowd: !g.peds.peds[req.pedestrianId].roadsideReserved };
  });
  check('A failed bargain makes the caller walk away and cleans up without rerolls', rejection.found && rejection.gone && rejection.walked && rejection.removed && rejection.unpaused && rejection.returnedToCrowd, JSON.stringify(rejection));

  const decline = await page.evaluate(() => {
    const g = window.__banglarTesla; g.eventDirector.clearAll();
    const req = window.__repairFindCaller();
    if (!req) return { found:false };
    const actor = req.actor, x=actor.group.position.x, z=actor.group.position.z, balance=g.state.balance;
    g.debugTeleport(req.stop.pickup.x,req.stop.pickup.z,0); g.updateRoadsideRequest();
    document.querySelector('[data-roadside="cancel"]')?.click();
    const gone = !g.roadsideRequest && !document.getElementById('roadside-offer');
    g.debugStepSim(1);
    const walked = !!actor.group.parent && Math.hypot(actor.group.position.x-x,actor.group.position.z-z)>0.3;
    g.debugStepSim(4);
    return {found:true,gone,walked,removed:!actor.group.parent,unpaid:g.state.balance===balance,returnedToCrowd:!g.peds.peds[req.pedestrianId].roadsideReserved};
  });
  check('Declining also walks the caller away without payment or an orphan', Object.values(decline).every(Boolean), JSON.stringify(decline));

  const races = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.startRivalEvent('ev_duel_ring');
    const optional = g.raceSystem.participantCount;
    g.debugStepSim(3.2);
    for (const cp of g.raceSystem.checkpoints.slice()) { g.debugTeleport(cp.x,cp.z,cp.yaw); g.debugStepSim(0.12); }
    const optionalWon = g.state.progress.blacklistTasks.includes('10:race');
    g.exitRaceToFreeRide();
    g.startRivalEvent('bl_boss_10');
    const boss = g.raceSystem.participantCount;
    const ai = g.raceSystem.getAiRacersSnapshot();
    const before = g.state.balance;
    g.debugStepSim(3.2);
    for (const cp of g.raceSystem.checkpoints.slice()) { g.debugTeleport(cp.x,cp.z,cp.yaw); g.debugStepSim(0.12); }
    const after = g.state.balance, rank = g.state.blacklistRank;
    const pose = g.player.rig.poseMode;
    const thumb = g.scrapbook.snapshot.records.find((r) => r.id === 'photo:win:bl_boss_10')?.photoThumb;
    g.exitRaceToFreeRide(); g.startRivalEvent('bl_boss_10'); g.debugStepSim(3.2);
    for (const cp of g.raceSystem.checkpoints.slice()) { g.debugTeleport(cp.x,cp.z,cp.yaw); g.debugStepSim(0.12); }
    const repeatPaid = g.state.balance - after;
    const photos = g.scrapbook.snapshot.records.filter((r) => r.id === 'photo:win:bl_boss_10').length;
    return { optional, optionalWon, boss, ai: ai.map((a) => a.id), before, after, rank, pose, thumb: typeof thumb === 'string' && thumb.startsWith('data:image/jpeg'), repeatPaid, photos };
  });
  check('Optional race remains 4-player; unlocked boss is 1v1 and reward/photo are idempotent', races.optional === 4 && races.optionalWon && races.boss === 2 && races.ai.length === 1 && races.rank === 9 && races.after > races.before && races.repeatPaid === 0 && races.photos === 1 && races.pose === 'victory' && races.thumb, JSON.stringify(races));

  const police = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.exitRaceToFreeRide(); g.eventDirector.clearAll();
    g.state.progress.blacklistNextRank = 7; g.state.progress.blacklistDefeated = [10,9,8];
    g.state.progress.blacklistTasks = ['7:race','7:fare']; g.state.progress.rep = 5000;
    g.debugTeleport(-126,-136,0);
    const escapeBySimulation = () => {
      const px = g.controller.x, pz = g.controller.z;
      for (const u of g.police.units) if (u.active) { u.x = px - 138; u.z = pz; u.speed = 0; }
      for (let i=0; i<600 && g.police.isActive; i++) g.police.update(1/60,px,pz,0,0,false);
      return !g.police.isActive;
    };
    g.debugStartPursuitForTest(2);
    const ordinaryEscaped = escapeBySimulation();
    const ordinaryDidNotCount = !g.state.progress.blacklistTasks.includes('7:escape');
    g.startBlacklistEscape(7);
    const challengeStarted = g.police.isActive && g.activeBlacklistEscapeRank === 7;
    const challengeEscaped = escapeBySimulation();
    const counted = g.state.progress.blacklistTasks.includes('7:escape');
    g.state.progress.blacklistNextRank = 6; g.state.progress.blacklistDefeated.push(7);
    g.pendingOffer = {};
    g.startBlacklistEscape(6);
    const busyRejected = !g.police.isActive && g.activeBlacklistEscapeRank === null;
    g.pendingOffer = null;
    g.startBlacklistEscape(6);
    const bustStarted = g.police.isActive;
    const px = g.controller.x, pz = g.controller.z;
    for (let i=0; i<260 && g.police.isActive; i++) {
      for (const u of g.police.units) if (u.active) { u.x = px + 0.5; u.z = pz; u.speed = 0; }
      g.police.update(1/60,px,pz,0,0,false);
    }
    const bustDidNotCount = !g.state.progress.blacklistTasks.includes('6:escape') && !g.police.isActive;
    g.state.progress.blacklistNextRank = 5; g.state.progress.blacklistDefeated.push(6);
    g.returnToMenu(); g.startBlacklistEscape(5);
    const menuStarted = g.mode === 'free' && g.police.isActive && g.activeBlacklistEscapeRank === 5;
    g.police.stopPursuit(true); g.activeBlacklistEscapeRank = null;
    return { ordinaryEscaped, ordinaryDidNotCount, challengeStarted, challengeEscaped, counted, busyRejected, bustStarted, bustDidNotCount, menuStarted };
  });
  check('Only the manually started pursuit escape counts; bust, busy and menu paths behave correctly', Object.values(police).every(Boolean), JSON.stringify(police));
  check('No uncaught browser errors', errors.length === 0, JSON.stringify(errors));
} finally {
  if (browser) await teardownHarness(browser, server);
  else server.kill('SIGTERM');
}
if (failures.length) process.exitCode = 1;
