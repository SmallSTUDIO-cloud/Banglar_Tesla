/* Browser integration: deterministic event causes, actual game callbacks, no fake device claims. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'artifacts/dhaka-first-pass'); fs.mkdirSync(out, { recursive: true });
const port = 4291, server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 140; i++) { try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 150)); }
  if (!ready) throw Error('preview not ready');
  browser = await puppeteer.launch({ args: [...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell', env: ensureChromiumEnv(), defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 } });
  const page = await browser.newPage(), diagnostics = [];
  page.on('pageerror', e => diagnostics.push(['pageerror',String(e)]));
  page.on('console', m => { if (['warning','error'].includes(m.type())) diagnostics.push(['console',m.text()]); });
  page.on('requestfailed', r => diagnostics.push(['requestfailed',r.url()]));
  page.on('response', r => { if (r.status() >= 400) diagnostics.push(['http',r.status(),r.url()]); });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('!!window.__banglarTesla');
  const result = await page.evaluate(() => {
    const g = window.__banglarTesla;
    g.state.markTutorialDone(); g.debugStartMode('free'); g.stop(); g.eventDirector.clearAll();
    g.debugTeleport(42,106,0);g.ui.show('hud');
    g.settings.set({weatherPreference:'auto'});g.applySettings();
    const ctx = {x:42,z:106,timeMinutes:720,heat:0,trafficDensity:0.8,raining:false,inMission:false,inRace:false,policeActive:false,roadRageActive:false,cinematicActive:false,paused:false,reduceEffects:false,autoWeather:true};
    // A real pre-existing NPC on the authored Asad segment, not a fabricated
    // traffic object created by the event. Stabilize its location for this test.
    const lane = g.traffic.graph.bySegment.get('asad_4')[0], agent=g.traffic.agents[0];
    agent.kind='van';agent.arch=g.traffic.fleet.layers.get('van').arch;
    agent.lane=lane;agent.s=lane.length/2;agent.x=(lane.ax+lane.bx)/2;agent.z=(lane.az+lane.bz)/2;
    agent.visible=true;agent.dwellTimer=agent.dwellCooldown=0;agent.turnLane=null;
    const values = [0,0,0,0];
    const slow = g.eventDirector.update(90,ctx,()=>values.shift() ?? 0);
    const mult = slow && Math.max(g.traffic.getCongestionMultiplier('asad_3'),g.traffic.getCongestionMultiplier('asad_4'));
    const afterSlow = {kind:slow?.kind,site:slow && [slow.x,slow.z],mult,dwell:agent.dwellTimer,active:g.eventDirector.activeCount,glError:g.renderer.getContext().getError()};
    g.eventDirector.clearAll();
    const cleaned = g.eventDirector.activeCount;
    // Respect cooldown and choose weather (pickKind cumulative > slowdown weight).
    const weatherRng = [0,0.99,0,0];
    const weather = g.eventDirector.update(150,ctx,()=>weatherRng.shift() ?? 0);
    const afterWeather = {kind:weather?.kind,weather:g.weatherDirector.currentWeather ?? g.env.getWeather(),active:g.eventDirector.activeCount};
    g.eventDirector.clearAll();
    return {afterSlow,cleaned,afterWeather,finalActive:g.eventDirector.activeCount,files:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures};
  });
  await page.screenshot({path:path.join(out,'live-director.png')});
  const roadwork = await page.evaluate(() => {
    const g=window.__banglarTesla;
    g.settings.set({weatherPreference:'sunny'});g.applySettings();g.weatherDirector.setWeatherImmediate('sunny');
    g.debugTeleport(0,120,Math.PI/2);
    const ctx={x:0,z:120,headingX:1,headingZ:0,timeMinutes:720,heat:0,trafficDensity:0.5,raining:false,
      inMission:false,inRace:false,policeActive:false,roadRageActive:false,cinematicActive:false,paused:false,reduceEffects:false,autoWeather:false};
    const rolls=[0,0.9,0,0];
    const ev=g.eventDirector.update(90,ctx,()=>rolls.shift()??0);
    if(ev){g.debugFreeCamera=true;g.camera.position.set(ev.x-9,3.2,ev.z+6);g.camera.lookAt(ev.x,0.8,ev.z);g.camera.fov=52;g.camera.updateProjectionMatrix();}
    g.render();
    return {kind:ev?.kind,site:ev && [ev.x,ev.z],active:g.roadblocks.activeCount,owner:ev?.id,glError:g.renderer.getContext().getError(),camera:'test-only free camera, 9m west and 6m south of event midpoint'};
  });
  await page.screenshot({path:path.join(out,'live-roadwork.png')});
  const checkpoint = await page.evaluate(owner => {
    const g=window.__banglarTesla;
    g.eventDirector.clearAll();
    const afterRoadwork=g.roadblocks.activeCount;
    const ctx={x:0,z:120,headingX:1,headingZ:0,timeMinutes:720,heat:2,trafficDensity:0.5,raining:false,
      inMission:false,inRace:false,policeActive:false,roadRageActive:false,cinematicActive:false,paused:false,reduceEffects:false,autoWeather:false};
    const rolls=[0,0.9,0,0];
    const ev=g.eventDirector.update(90,ctx,()=>rolls.shift()??0);
    const active=g.roadblocks.activeCount;
    const alienCleanup=g.roadblocks.despawnOwned(owner);
    g.eventDirector.clearAll();
    const again=[0,0.9,0,0];
    g.eventDirector.update(150,{...ctx,heat:0},()=>again.shift()??0);
    const beforeMission=g.roadblocks.activeCount;
    g.startMode('duty');
    return {kind:ev?.kind,active,afterRoadwork,alienCleanup,finalBlocks:g.roadblocks.activeCount,
      beforeMission,afterMission:g.eventDirector.activeCount,missionMode:g.mode,glError:g.renderer.getContext().getError()};
  },roadwork.owner);
  const passenger = await page.evaluate(() => {
    const g=window.__banglarTesla;
    g.debugFreeCamera=false;g.debugStartMode('free');g.stop();
    g.settings.set({weatherPreference:'rain'});g.applySettings();g.weatherDirector.setWeatherImmediate('rain');
    g.env.setWeather('rain');g.debugStepSim(2);
    g.requestJob(false);
    const offer=g.pendingOffer;
    if(!offer)return {error:'no offer'};
    offer.optional='rain';offer.kind='passenger';
    let completed=null;
    g.missions.on('completed', r => {completed={traffic:r.fare.traffic,total:r.fare.total,mood:r.mood,optional:r.offer.optional};});
    g.acceptOffer(offer);
    g.debugTeleportToPickup();g.debugStepUntil(()=>g.missions.state==='toDropoff',12);
    const wet=g.env.wetness;
    const ready=g.missions.state==='toDropoff';
    g.debugTeleportToDropoff();g.debugStepSim(0.2);
    return {ready,wet,completed,rides:g.state.progress.rides};
  });
  const lifecycle = await page.evaluate(() => {
    const g=window.__banglarTesla;
    g.enterFreeRide();g.stop();g.eventDirector.clearAll();g.debugTeleport(0,120,Math.PI/2);
    g.settings.set({weatherPreference:'sunny'});g.applySettings();
    const ctx={x:0,z:120,headingX:1,headingZ:0,timeMinutes:720,heat:0,trafficDensity:0.5,raining:false,
      inMission:false,inRace:false,policeActive:false,roadRageActive:false,cinematicActive:false,paused:false,reduceEffects:false,autoWeather:false};
    const initial={geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs.length,children:g.roadblocks.group.children.length};
    const kinds=[];
    for(let i=0;i<12;i++){
      const rolls=[0,0.9,0,0];const ev=g.eventDirector.update(150,ctx,()=>rolls.shift()??0);
      kinds.push(ev?.kind??null);
      g.render();g.eventDirector.clearAll();g.render();
    }
    return {initial,final:{geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs.length,children:g.roadblocks.group.children.length},kinds,active:g.roadblocks.activeCount,director:g.eventDirector.activeCount,glError:g.renderer.getContext().getError()};
  });
  const evidence={...result,roadwork,checkpoint,passenger,lifecycle,diagnostics,fixture:'Scripted free-roam director and rainy passenger on real Game instance; debug teleports for controlled fixture, not a keyboard drive or Android device'};
  fs.writeFileSync(path.join(out,'live-director.json'),JSON.stringify(evidence,null,2));
  if(result.afterSlow.kind!=='market_slowdown'||result.afterSlow.mult<=1||result.afterSlow.dwell<=0||result.cleaned!==0||result.afterWeather.kind!=='weather_shift'||result.finalActive!==0||result.afterSlow.glError!==0||roadwork.kind!=='construction'||roadwork.active!==1||roadwork.glError!==0||checkpoint.kind!=='police_checkpoint'||checkpoint.active!==1||checkpoint.afterRoadwork!==0||checkpoint.alienCleanup!==0||checkpoint.finalBlocks!==0||checkpoint.beforeMission!==1||checkpoint.afterMission!==0||checkpoint.missionMode!=='duty'||checkpoint.glError!==0||!passenger.ready||passenger.wet<=0.3||passenger.completed?.traffic!==12||lifecycle.kinds.some(k=>k!=='construction')||lifecycle.active!==0||lifecycle.director!==0||lifecycle.glError!==0||JSON.stringify(lifecycle.initial)!==JSON.stringify(lifecycle.final)||diagnostics.length) throw Error(JSON.stringify(evidence));
  console.log('PASS Dhaka-first live Game director',JSON.stringify(evidence));
} finally {await teardownHarness(browser,server);}
