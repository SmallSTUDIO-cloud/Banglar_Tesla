/* Rendered regression checks for the five additive street/action upgrades. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4246;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) throw Error('preview did not start');
  browser = await puppeteer.launch({ args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 540 } });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async () => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free');
    await g.audio.init();
    await g.audio.loadingPromise;
    g.debugSetTimeForTest(12, 0); g.ui.show(null); g.debugFreeCamera = true;
    g.renderer.setAnimationLoop(null);
    const posters = g.city.group.children.filter(o => o.name.includes('.posters'));
    const totalPosterTriangles = posters.reduce((n, o) => n + o.geometry.index.count / 3, 0);
    const acDetails = g.city.group.children.filter(o => o.name.includes('.detail'));
    const nearPed = g.peds.group.children.filter(o => o.isInstancedMesh);
    const building = g.city.colliders.filter(c => c.kind === 'building');
    // For parallel adjacent footprints, measure their projected gap along the
    // tangent; distinct roads and corners cannot be characterized by this.
    const closeGaps = [];
    for (let i = 0; i < building.length; i++) for (let j = i + 1; j < building.length; j++) {
      const a = building[i], b = building[j];
      if (Math.abs(a.yaw - b.yaw) > 0.005 || Math.hypot(a.cx - b.cx, a.cz - b.cz) > 24) continue;
      const u = Math.cos(a.yaw), v = -Math.sin(a.yaw);
      const parallel = Math.abs((a.cx - b.cx) * u + (a.cz - b.cz) * v);
      if (parallel > a.halfX + b.halfX - 0.25) continue;
      const sideGap = Math.abs(-(a.cx - b.cx) * v + (a.cz - b.cz) * u) - a.halfZ - b.halfZ;
      if (sideGap >= 0 && sideGap < 1.5) closeGaps.push(sideGap);
    }
    const music = g.audio;
    g.debugStartPursuitForTest(2); g.debugStepSim(1 / 60);
    const policeAutoKey = music.activeMusic?.key;
    g.startMode('free'); g.debugStepSim(1 / 60);
    const policeRestoredKey = music.activeMusic?.key;
    g.debugStartEventForTest('ev_street_asad'); g.debugStepSim(1 / 60);
    const raceAutoKey = music.activeMusic?.key;
    g.startMode('free'); g.debugStepSim(1 / 60);
    const defaultKey = music.activeMusic?.key;
    music.setActionMusic(true);
    const chaseKey = music.activeMusic?.key;
    const chaseSources = music.activeSourceCount;
    music.setSceneMode('paused');
    const pausedKey = music.activeMusic?.key;
    music.setSceneMode('driving');
    music.setMusicEnabled(false);
    const disabled = music.activeMusic === null;
    music.setMusicEnabled(true);
    music.setActionMusic(false);
    const restoredKey = music.activeMusic?.key;
    const center = posters.find(o => o.geometry.getAttribute('position').getY(0) < 4);
    if (center) {
      const p = center.geometry.getAttribute('position'), norm = center.geometry.getAttribute('normal');
      // The first poster quad in a sector faces along the first vertex normal.
      const x = p.getX(0), y = p.getY(0), z = p.getZ(0);
      g.camera.position.set(x + norm.getX(0) * 3.8, y + 0.5, z + norm.getZ(0) * 3.8);
      g.camera.lookAt(x, y, z);
      g.camera.fov = 42; g.camera.updateProjectionMatrix();
    }
    g.renderer.render(g.scene, g.camera);
    const damageHoles = g.city.potholes.filter(h => g.city.roadDamageAt(h.x, h.z) > .05);
    return { damageHoles: damageHoles.length, allPhysicalHoles: g.city.potholes.length,
      posters: g.city.posterCount, boards: g.city.billboardCount,
      posterSectors: posters.length, totalPosterTriangles, buildingCount: building.length,
      closeGaps: closeGaps.sort((a, b) => a - b).slice(0, 12),
      acDetailSectors: acDetails.length, pedestrianLayers: nearPed.length,
      drawCalls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles,
      policeAutoKey, policeRestoredKey, raceAutoKey,
      defaultKey, chaseKey, pausedKey, disabled, restoredKey, chaseSources,
      audioAssets: music.loadedAssetCount };
  });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts', 'five-additions-poster.png') });
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    const ped = g.peds.peds.find(p => Number.isFinite(p.worldX) && Number.isFinite(p.worldZ));
    g.debugTeleport(ped.worldX + 2.6, ped.worldZ + 2.6, 0);
    g.debugStepSim(1 / 60);
    g.traffic.group.visible = false;
    g.player.root.visible = false;
    g.camera.position.set(ped.worldX + 2.5, 1.65, ped.worldZ + 2.5);
    g.camera.lookAt(ped.worldX, 1.05, ped.worldZ);
    g.camera.fov = 32; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: path.join(root, 'artifacts', 'five-additions-pedestrian.png') });
  await page.evaluate(() => {
    const g = window.__banglarTesla;
    const hole = g.city.potholes.find(h => g.city.roadDamageAt(h.x, h.z) > .4);
    g.debugTeleport(hole.x, hole.z - 8, 0);
    g.peds.group.visible = false;
    g.player.root.visible = false;
    g.camera.position.set(hole.x + 2, 2.1, hole.z + 5.4);
    g.camera.lookAt(hole.x, .05, hole.z);
    g.camera.fov = 57; g.camera.updateProjectionMatrix();
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: path.join(root, 'artifacts', 'street-feel-broken-road.png') });
  if (errors.length || result.damageHoles < 4 || result.allPhysicalHoles < 12 ||
      result.posters < 10 || result.boards < 1 || result.posterSectors < 2 ||
      result.closeGaps.length < 1 || result.closeGaps[0] < 0.26 || result.pedestrianLayers !== 9 ||
      result.policeAutoKey !== 'musicAction' || result.raceAutoKey !== 'musicAction' ||
      result.policeRestoredKey !== 'musicDrive' ||
      result.chaseKey !== 'musicAction' || result.pausedKey !== 'musicAction' || !result.disabled ||
      result.restoredKey !== result.defaultKey || result.chaseSources > 13 || result.audioAssets < 30) {
    throw Error(JSON.stringify({ result, errors }));
  }
  console.log('PASS rendered action/city/pedestrian checks', JSON.stringify(result));
} finally { await teardownHarness(browser, server); }
