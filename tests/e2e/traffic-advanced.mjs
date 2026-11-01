/* Browser-rendered scripted fixtures against the shipping traffic fleet/graph.
 * The final scenario uses actual free-ride controller input; setup teleports to
 * a repeatable road. Fixtures are NOT natural unscripted gameplay evidence. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4238;
const server = spawn(path.join(root, 'node_modules/.bin/vite'), ['preview','--host','127.0.0.1','--port',String(port),'--strictPort'], {cwd:root,stdio:'ignore'});
let browser;
try {
  let ready = false;
  for (let i=0;i<160;i++) {try {if ((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,150));}
  if (!ready) throw new Error('preview unavailable (run npm run build first)');
  browser = await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:540}});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(()=>window.__banglarTesla.debugStartMode('free'));
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  const cases=['behind','head-on','stopped-player','other-lane','moving-leader','stopped-leader','junction-yield','left','right','blocked-exit','block-recovery','wide-truck','mixed'];
  for (const name of cases) {
    const r=await page.evaluate(name=>{
      const g=window.__banglarTesla,t=g.traffic,graph=t.graph;
      const source=graph.byId.get(name==='right'||name==='wide-truck'?'ring_0:rev':name==='blocked-exit'||name==='block-recovery'?'asad_5:rev':'asad_0:rev');
      const target=graph.byId.get(name==='blocked-exit'||name==='block-recovery'?'post_shahjahan:fwd':name==='right'||name==='wide-truck'?'asad_0:fwd':'ring_0:fwd');
      if(!source||!target) throw Error('fixture lane missing');
      const original=window.__trafficOriginal??=t.agents;
      t.agents=original;
      const a=original[0],b=original[1],c=original[2];
      const kinds={right:'bus','wide-truck':'truck',mixed:'motorbike'};
      function place(agent,kind,lane,s,speed){
        agent.kind=kind;agent.arch=t.fleet.layers.get(kind).arch;agent.variant=0;
        agent.lane=lane;agent.s=s;agent.speed=speed;agent.cruise=kind==='bus'||kind==='truck'?6:7;
        agent.lateralOffset=agent.targetLateral=agent.turnOffsetX=agent.turnOffsetZ=0;
        agent.dwellTimer=agent.dwellCooldown=agent.stuckTimer=agent.roadRageHold=0;
        agent.plannedLaneId=agent.turnLane=null;agent.turnT=0;
        agent.x=lane.ax+lane.ux*s;agent.z=lane.az+lane.uz*s;agent.yaw=lane.yaw;
      }
      const turn=['left','right','wide-truck','junction-yield','blocked-exit','block-recovery'].includes(name);
      place(a,kinds[name]||'car',source,turn?source.length-13:source.length*0.35,turn?4:5);
      if(turn) a.plannedLaneId=target.id;
      const paired=['moving-leader','stopped-leader','blocked-exit','block-recovery','junction-yield','mixed'].includes(name);
      if(paired){
        if(name==='blocked-exit'||name==='block-recovery')place(b,'car',target,1,0);
        else if(name==='junction-yield'){
          const incoming=graph.lanes.find(l=>l.toNode===source.toNode&&l.id!==source.id);
          if(!incoming) throw Error('incoming junction lane missing');
          place(b,'cng',incoming,incoming.length-4,4);
          a.s=source.length-8;a.x=source.ax+source.ux*a.s;a.z=source.az+source.uz*a.s;
        }else place(b,'rickshaw',source,a.s+13, name==='stopped-leader'?0:4);
        if(name==='stopped-leader'||name==='blocked-exit') b.dwellTimer=100;
        if(name==='mixed')place(c,'bus',graph.byId.get('ring_0:rev'),5,3);
      }
      t.agents=paired?(name==='mixed'?[a,b,c]:[a,b]):[a];
      t.populationTick=-999;
      g.debugTeleport(a.x+45,a.z+45,0);
      t.setPlayer(a.x+45,a.z+45,0);
      if(name==='stopped-player'||name==='head-on') t.setPlayer(a.x+source.ux*11,a.z+source.uz*11,name==='head-on'?6:0,source.yaw+Math.PI);
      if(name==='behind') t.setPlayer(a.x-source.ux*4,a.z-source.uz*4,6,source.yaw);
      if(name==='other-lane')t.setPlayer(a.x+source.ux*6+source.uz*3.6,a.z+source.uz*6-source.ux*3.6,4,source.yaw);
      const start=a.s;let maxStep=0,changed=false;
      const n=turn?220: name==='stopped-player'||name==='stopped-leader'?150:85;
      for(let i=0;i<n;i++){
        const x=a.x,z=a.z;
        t.update(1/30);
        maxStep=Math.max(maxStep,Math.hypot(a.x-x,a.z-z));
        if(a.lane.id===target.id)changed=true;
      }
      let ok=true;
      if(name==='behind'||name==='other-lane')ok=a.speed>3&&a.s>start+5;
      if(name==='head-on'||name==='stopped-player')ok=a.speed<2;
      if(name==='moving-leader')ok=a.speed>1&&b.s-a.s>a.arch.halfLength+b.arch.halfLength;
      if(name==='stopped-leader')ok=a.speed<1&&b.s-a.s>a.arch.halfLength+b.arch.halfLength;
      if(name==='blocked-exit')ok=a.lane===source&&a.speed<1;
      if(name==='block-recovery'){
        // Release a physical blocker and let it drive away on the real lane.
        b.dwellTimer=0;
        for(let i=0;i<250;i++)t.update(1/30);
        ok=a.lane.id===target.id;
      }
      if(name==='left'||name==='right'||name==='wide-truck')ok=changed&&maxStep<0.5;
      if(name==='junction-yield')ok=maxStep<0.5&&a.speed>=0;
      if(name==='mixed')ok=t.agents.length===3&&t.agents.every(x=>x.speed>=0&&x.speed<=x.cruise+0.8);
      g.debugFreeCamera=true;g.ui.show(null);
      g.camera.position.set(source.bx-source.ux*13,6.2,source.bz-source.uz*13);
      g.camera.lookAt(source.bx,0.9,source.bz);g.camera.fov=60;g.camera.updateProjectionMatrix();
      const result={name,ok,speed:+a.speed.toFixed(2),lane:a.lane.id,changed,maxStep:+maxStep.toFixed(3)};
      t.fleet.sync(t.agents);
      return result;
    },name);
    if(['left','right','blocked-exit','wide-truck','mixed'].includes(name))await page.screenshot({path:path.join(root,'artifacts',`traffic-advanced-${name}.png`)});
    console.log(`${r.ok?'PASS':'FAIL'} fixture ${name}`,JSON.stringify(r));
    if(!r.ok)throw Error(`traffic fixture failed: ${name}`);
  }
  for(const [kind,fromId,toId] of [['car','asad_0:rev','ring_0:fwd'],['bus','ring_0:rev','asad_0:fwd'],['truck','ring_0:rev','asad_0:fwd']]){
    const mid=await page.evaluate(([kind,fromId,toId])=>{
      const g=window.__banglarTesla,t=g.traffic,l=t.graph.byId.get(fromId);
      t.agents=window.__trafficOriginal;
      const a=t.agents[0];a.kind=kind;a.arch=t.fleet.layers.get(kind).arch;
      a.lane=l;a.s=l.length-13;a.speed=4;a.cruise=6.5;
      a.plannedLaneId=toId;a.turnLane=null;a.turnT=0;
      a.lateralOffset=a.targetLateral=a.turnOffsetX=a.turnOffsetZ=0;
      a.dwellTimer=a.dwellCooldown=a.roadRageHold=a.stuckTimer=0;
      a.x=l.ax+l.ux*a.s;a.z=l.az+l.uz*a.s;a.yaw=l.yaw;
      t.agents=[a];t.populationTick=-999;t.setPlayer(a.x+45,a.z+45,0);
      g.debugFreeCamera=true;g.camera.position.set(l.bx-l.ux*16,8,l.bz-l.uz*16);
      g.camera.lookAt(l.bx,0.6,l.bz);g.camera.fov=65;g.camera.updateProjectionMatrix();
      for(let i=0;i<260;i++){
        t.update(1/30);
        if(a.turnLane&&a.turnT>0.45)break;
      }
      return {kind,active:!!a.turnLane,t:a.turnT,x:a.x,z:a.z,yaw:a.yaw};
    },[kind,fromId,toId]);
    if(!mid.active)throw Error('no mid-turn for '+kind+': '+JSON.stringify(mid));
    await page.screenshot({path:path.join(root,'artifacts',`traffic-advanced-midturn-${kind}.png`)});
    console.log('PASS rendered mid-turn',JSON.stringify(mid));
  }
  // Teleport only to establish a reproducible starting location; after that
  // throttle is applied through normal player controller physics using stepped frames.
  const before=await page.evaluate(()=>{
    const g=window.__banglarTesla,t=g.traffic,l=t.graph.byId.get('asad_0:rev');
    t.agents=window.__trafficOriginal;
    const a=t.agents[0];a.kind='car';a.arch=t.fleet.layers.get('car').arch;
    a.lane=l;a.s=l.length*0.35;a.speed=4;a.cruise=7;a.plannedLaneId=a.turnLane=null;
    a.dwellTimer=a.roadRageHold=0;a.lateralOffset=a.targetLateral=0;
    a.x=l.ax+l.ux*a.s;a.z=l.az+l.uz*a.s;a.yaw=l.yaw;
    t.agents=[a];g.debugFreeCamera=false;
    g.debugTeleport(a.x-l.ux*12,a.z-l.uz*12,l.yaw);
    g.debugInput={throttle:1,brake:0,steer:0};
    return {playerX:g.controller.x,playerZ:g.controller.z,npcSpeed:a.speed};
  });
  const after=await page.evaluate(()=>{
    const g=window.__banglarTesla;
    g.debugStepSim(0.9); // normal game update/controller physics, deterministic frame steps
    g.debugInput=null;
    return {playerX:g.controller.x,playerZ:g.controller.z,npcSpeed:g.traffic.agents[0].speed};
  });
  await page.screenshot({path:path.join(root,'artifacts','traffic-advanced-driven-behind.png')});
  if(Math.hypot(after.playerX-before.playerX,after.playerZ-before.playerZ)<1||after.npcSpeed<2||errors.length)throw Error(JSON.stringify({before,after,errors}));
  console.log('PASS real controller-input stepped drive from scripted start: behind NPC',JSON.stringify({before,after,errors}));
}finally{await teardownHarness(browser,server);}
