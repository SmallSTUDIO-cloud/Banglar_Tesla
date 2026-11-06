/* Browser collision audit with live Game.update; controlled road setup, no mocked collision. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6)||'after';
const out=path.join(root,'artifacts',`aaa-${tag}`);fs.mkdirSync(out,{recursive:true});
const port=4262,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
  let ready=false;for(let i=0;i<180;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
  if(!ready)throw Error('preview unavailable');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:540}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});await page.waitForFunction('!!window.__banglarTesla');
  const rows=[];
  for(const kind of ['car','cng','rickshaw','bus']){
    const result=await page.evaluate(kind=>{
      const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');g.renderer.setAnimationLoop(null);
      g.debugSetTimeForTest(12,0);g.settings.set({weatherPreference:'sunny'});g.applySettings();
      g.traffic.debugSetSimulationFrozen(true);g.peds.group.visible=false;g.ui.show(null);g.debugFreeCamera=true;
      // Authored clear-road setup: positioning is a fixture only; the contact
      // itself below uses normal Game.update and the production capsule solver.
      const t=g.traffic, yaw=-2.7656316997184875;
      const index=t.debugPositionAgentForTest(kind,3.7059505748115384,-3.720562924436794,yaw,0);
      if(index<0)throw Error('no '+kind+' fixture');
      const a=t.agents[index],fx=Math.sin(yaw),fz=Math.cos(yaw);
      g.debugTeleport(a.x-fx*2,a.z-fz*2,yaw);
      const before={x:a.x,z:a.z,s:a.s,yaw:a.yaw,speed:a.speed};
      const frame=()=>{g.camera.position.set(a.x+5.0,3.8,a.z+5.8);g.camera.lookAt(a.x,1,a.z);
        g.camera.fov=48;g.camera.updateProjectionMatrix();g.renderer.render(g.scene,g.camera)};
      frame();
      const first=g.renderer.domElement.toDataURL('image/png');
      g.controller.speed=3.1;
      g.debugInput={throttle:1,brake:0,steer:0};g.debugStepSim(0.45);g.debugInput=null;
      frame();
      const contact=g.renderer.domElement.toDataURL('image/png');
      const pushed={x:a.x,z:a.z,s:a.s,speed:a.speed,delta:Math.hypot(a.x-before.x,a.z-before.z)};
      const trace=[];
      if(kind==='car'){
        // Continued real throttle against the same stationary car, not a
        // sequence of teleport/reset helper invocations.
        // Keep AI stepping: a frozen traffic system intentionally freezes its
        // contact cooldown too, which would falsely rule out sustained pushing.
        t.debugSetSimulationFrozen(false);
        g.debugInput={throttle:1,brake:0,steer:0};
        for(let step=0;step<90;step++){
          g.debugStepSim(1/60);
          if(step%6===0)trace.push({t:step/60,playerSpeed:g.controller.speed,
            playerX:g.controller.x,playerZ:g.controller.z,carX:a.x,carZ:a.z,
            gap:Math.hypot(g.controller.x-a.x,g.controller.z-a.z),travel:a.contactTravel,hits:g.controller.hits});
        }
        g.debugInput=null;
      }
      const sustained={delta:Math.hypot(a.x-before.x,a.z-before.z),travel:a.contactTravel??0};
      g.controller.speed=0;g.debugTeleport(a.x+20,a.z+20,0);
      t.debugSetSimulationFrozen(false);g.debugStepSim(2.5);
      frame();
      const recovery=g.renderer.domElement.toDataURL('image/png');
      const settled={x:a.x,z:a.z,s:a.s,speed:a.speed,yaw:a.yaw,delta:Math.hypot(a.x-before.x,a.z-before.z),
        lane:a.lane?.id,finite:[a.x,a.z,a.s,a.speed,a.yaw].every(Number.isFinite),
        renderer:{geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs.length}};
      return {kind,index,before,pushed,sustained,trace,settled,first,contact,recovery};
    },kind);
    for(const name of ['first','contact','recovery']){fs.writeFileSync(path.join(out,`contact-${kind}-${name}.png`),Buffer.from(result[name].split(',')[1],'base64'));delete result[name]}
    if(!result.settled.finite || !result.settled.lane ||
      (tag==='after' && kind==='car' && (result.pushed.delta<0.06 || result.settled.speed<=0)) || errors.length)
      throw Error(JSON.stringify({result,errors}));
    rows.push(result);
  }
  fs.writeFileSync(path.join(out,'contact.json'),JSON.stringify({rows,errors},null,2));
  console.log('CONTACT',JSON.stringify(rows));
}finally{await teardownHarness(browser,server)}
