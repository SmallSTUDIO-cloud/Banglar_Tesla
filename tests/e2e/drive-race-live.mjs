/* Browser gameplay drive: actual keyboard events + normal Game.update physics and race
 * runtime. The prerequisite task fixture only unlocks #10; NEVER teleport, move
 * the controller directly, increment checkpoints, or call race.update alone.
 * Deterministic fast-forward of simulation frames is not a human-play test. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'artifacts'); fs.mkdirSync(out, { recursive: true });
const port = 4210, base = `http://127.0.0.1:${port}`;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (i === 159) throw new Error('preview failed to start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('Boolean(window.__banglarTesla)', { timeout: 60000 });
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free');
    g.stop(); // no competing RAF; normal fixed-step Game.update is used below
    g.eventDirector.clearAll();
    g.state.recordBlacklistTask('fare', 10);
    g.state.recordBlacklistTask('race', 10); // explicitly prerequisite fixture, not a race win
    const complete = g.raceSystem.onRaceFinished;
    g.raceSystem.onRaceFinished = (summary) => { window.__qaResult = summary; complete(summary); };
    g.startRivalEvent('bl_boss_10'); // production prerequisite/start path
  });
  await page.screenshot({ path: path.join(out, 'live-race-start.png') });
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    const race = g.raceSystem;
    const data = { participantCount: race.participantCount, checkpoints: race.checkpoints.length, deadline: race.currentEvent.targetSeconds, start: { x: g.controller.x, z: g.controller.z, yaw: g.controller.yaw }, gates: [], errors: [], recoveries: 0, maxHits: 0, travelled: 0 };
    if (!race.isActive || data.participantCount !== 2) return { ...data, error: 'Blacklist event did not start as 1v1' };
    const waypoints = race.aiRacers[0].waypoints;
    data.route = waypoints.slice(0, 14).map(({x,z,targetGateIndex})=>({x,z,targetGateIndex}));
    let waypointIndex = 0, previous = { x: g.controller.x, z: g.controller.z };
    let pressed = '', braking = false;
    const changeKey = (code) => {
      if (code === pressed) return;
      if (pressed) window.dispatchEvent(new KeyboardEvent('keyup', { code: pressed, bubbles: true }));
      pressed = code;
      if (code) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    const trace = [];
    let stalled = 0, lastCp = 0;
    for (let n = 0; n < 2100 && race.isActive; n++) {
      const px = g.controller.x, pz = g.controller.z;
      while (waypointIndex < waypoints.length - 1 && Math.hypot(px - waypoints[waypointIndex].x, pz - waypoints[waypointIndex].z) < 3.5) waypointIndex++;
      // A point passed tangentially may be missed; choose the next route point
      // only when it is substantially nearer and in the immediate road corridor.
      if (waypointIndex < waypoints.length - 1) {
        const here = Math.hypot(px - waypoints[waypointIndex].x, pz - waypoints[waypointIndex].z);
        const next = Math.hypot(px - waypoints[waypointIndex + 1].x, pz - waypoints[waypointIndex + 1].z);
        if (next + 7 < here && next < 14) waypointIndex++;
      }
      const directFinish = race.hudSnap.checkpointIndex === data.checkpoints;
      const target = directFinish ? race.checkpoints[data.checkpoints - 1] : waypoints[Math.min(waypointIndex, waypoints.length - 1)];
      const want = Math.atan2(target.x - px, target.z - pz);
      const error = Math.atan2(Math.sin(want - g.controller.yaw), Math.cos(want - g.controller.yaw));
      changeKey(error > 0.035 ? 'KeyA' : error < -0.035 ? 'KeyD' : '');
      const next = directFinish ? target : waypoints[Math.min(waypointIndex + 1, waypoints.length - 1)];
      const cornerYaw = Math.atan2(next.x - target.x, next.z - target.z);
      const cornerAngle = Math.abs(Math.atan2(Math.sin(cornerYaw - want), Math.cos(cornerYaw - want)));
      const toTurn = Math.hypot(px - target.x, pz - target.z);
      const shouldBrake = (toTurn < 14 && cornerAngle > 0.32 && g.controller.speed > 3.5) ||
        (Math.abs(error) > 0.6 && g.controller.speed > 3.5);
      if (shouldBrake !== braking) {
        braking = shouldBrake;
        window.dispatchEvent(new KeyboardEvent(braking ? 'keydown' : 'keyup', { code: 'KeyS', bubbles: true }));
      }
      for (let j = 0; j < 6 && race.isActive; j++) g.debugStepSim(0.016667);
      const moved = Math.hypot(g.controller.x - previous.x, g.controller.z - previous.z);
      data.travelled += moved;
      previous = { x: g.controller.x, z: g.controller.z };
      data.maxHits = Math.max(data.maxHits, g.controller.hits);
      stalled = moved < 0.06 && race.hudSnap.phase === 'racing' ? stalled + 1 : 0;
      if (stalled === 10) data.errors.push({ t:+race.hudSnap.elapsedSeconds.toFixed(1), x:+px.toFixed(1), z:+pz.toFixed(1), target, hits:g.controller.hits, closeColliders:g.city.colliders.filter((c)=>c.minX<px+3&&c.maxX>px-3&&c.minZ<pz+3&&c.maxZ>pz-3).map((c)=>({kind:c.kind,cx:c.cx,cz:c.cz})).slice(0,4), traffic:g.traffic.obstacles().filter((o)=>Math.hypot(o.x-px,o.z-pz)<8).map((o)=>({x:o.x,z:o.z})).slice(0,4)});
      if (stalled > 45) { // invoke game's normal recovery input, never reposition directly
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', bubbles: true }));
        data.recoveries++; stalled = 0;
        waypointIndex = Math.max(0, waypoints.findIndex((w) => w.targetGateIndex === race.hudSnap.checkpointIndex - 1));
      }
      if (race.hudSnap.checkpointIndex !== lastCp) {
        lastCp = race.hudSnap.checkpointIndex;
        data.gates.push({ checkpoint: lastCp, seconds: +race.hudSnap.elapsedSeconds.toFixed(1), x: +g.controller.x.toFixed(1), z: +g.controller.z.toFixed(1) });
      }
      if (n % 60 === 0) trace.push({ t: +race.hudSnap.elapsedSeconds.toFixed(1), cp: race.hudSnap.checkpointIndex, wp: waypointIndex, x: +px.toFixed(1), z: +pz.toFixed(1), yaw: +g.controller.yaw.toFixed(2), speed: +g.controller.speed.toFixed(1), error: +error.toFixed(2) });
    }
    changeKey('');
    if (braking) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    data.nearbyColliders = g.city.colliders.filter((c) => c.minX < g.controller.x + 5 && c.maxX > g.controller.x - 5 && c.minZ < g.controller.z + 5 && c.maxZ > g.controller.z - 5).map((c) => ({kind:c.kind,cx:c.cx,cz:c.cz,halfX:c.halfX,halfZ:c.halfZ,yaw:c.yaw})).slice(0,12);
    data.result = window.__qaResult && { won: window.__qaResult.won, reasonKey: window.__qaResult.reasonKey, standings: window.__qaResult.standings.map((e)=>({id:e.id, finished:e.finished, time:e.timeSeconds})) };
    data.standings = race.getStandings(g.controller.x, g.controller.z).map((e) => ({id:e.id,time:e.timeSeconds,finished:e.finished}));
    g.render();
    return { ...data, trace, final: { phase: race.hudSnap.phase, elapsed: race.hudSnap.elapsedSeconds, index: race.hudSnap.checkpointIndex, mode: g.ui.currentScreen, balance: g.state.balance, rank: g.state.blacklistRank, photo: !!g.scrapbook.snapshot.records.find((r) => r.id === 'photo:win:bl_boss_10')?.photoThumb } };
  });
  await page.screenshot({ path: path.join(out, 'live-race-finish.png') });
  result.browserErrors = errors;
  fs.writeFileSync(path.join(out, 'live-race-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, trace: result.trace?.filter((_, i) => i % 4 === 0) }));
  if (errors.length || !result.result?.standings.some((entry) => entry.id === 'player' && entry.finished) || result.final?.mode !== 'raceResult') process.exitCode = 1;
} finally {
  if (browser) await teardownHarness(browser, server);
  else server.kill('SIGTERM');
}
