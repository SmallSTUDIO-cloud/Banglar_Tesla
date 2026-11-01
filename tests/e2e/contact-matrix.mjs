/* Controlled real Game.update/capsule collision matrix. Authored placement is
 * fixture setup only; no mocked contact, velocity, collision or recovery. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'artifacts/contact-matrix');fs.mkdirSync(dir,{recursive:true});
const port=4264,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try {
  let ready=false;for(let i=0;i<180;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
  if(!ready)throw Error('preview unavailable');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:540}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));

  const kinds=['car','bus','truck','van','cng','easybike','motorbike','rickshaw'];
  const cases=['front-low','front-moderate','rear','side','repeated','moving','braking','junction','mixed','release'];
  const selected=process.argv.find(x=>x.startsWith('--kind='))?.split('=')[1];
  const rows=[];
  for(const kind of kinds.filter(x=>!selected||x===selected)){
    // A fresh world per archetype prevents cross-kind controller/agent state
    // from contaminating the ten scenarios within that kind.
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction('!!window.__banglarTesla');
    await page.evaluate(()=>{const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');g.renderer.setAnimationLoop(null);g.ui.show(null);g.debugFreeCamera=true;g.peds.group.visible=false;g.debugSetTimeForTest(12,0);g.settings.set({weatherPreference:'sunny'});g.applySettings()});
    for(const scenario of cases){
      const result=await page.evaluate(({kind,scenario})=>{
        const g=window.__banglarTesla,t=g.traffic;
        g.debugStartMode('free');g.renderer.setAnimationLoop(null);g.debugFreeCamera=true;g.ui.show(null);g.peds.group.visible=false;
        // Reset authored position at the same tested street segment. Isolate the
        // one primary agent except for the deliberately mixed-traffic case.
        t.agents=[t.agents[0]];t.debugSetSimulationFrozen(true);
        const yaw=-2.7656316997184875;
        t.agents[0].kind=kind;t.agents[0].arch=t.fleet.layers.get(kind).arch;
        const ax=3.7059505748115384,az=-3.720562924436794;
        const nearJunction=scenario==='junction';
        const lane=t.agents[0].lane;
        const x=nearJunction?lane.bx-lane.ux*4:ax,z=nearJunction?lane.bz-lane.uz*4:az;
        t.debugPositionAgentForTest(kind,x,z,yaw,0);
        const a=t.agents[0],fx=Math.sin(yaw),fz=Math.cos(yaw),lx=Math.cos(yaw),lz=-Math.sin(yaw);
        // The placement helper intentionally accepts a requested world point;
        // snap the fixture to its assigned lane before measuring movement.
        a.turnT=0;a.turnLead=0;
        a.x=a.lane.ax+a.lane.ux*a.s+a.lane.uz*a.lateralOffset;
        a.z=a.lane.az+a.lane.uz*a.s-a.lane.ux*a.lateralOffset;
        a.y=g.city.heightAt(a.x,a.z);t.fleet.sync(t.agents);
        a.dwellTimer=scenario==='moving'?0:scenario==='braking'?0.45:3;
        a.speed=scenario==='moving'||scenario==='braking'?2:0;
        a.cruise=Math.max(4,a.cruise);a.roadRageHold=0;
        const moving=scenario==='moving'||scenario==='braking';
        if(scenario==='mixed'){
          const b={...a,kind:'van',arch:t.fleet.layers.get('van').arch,s:a.s+5,
            x:a.x+a.lane.ux*5,z:a.z+a.lane.uz*5,speed:0,dwellTimer:3,contactTravel:0,contactSideTravel:0};
          t.agents.push(b);
        }
        const side=scenario==='side',reverse=scenario==='rear';
        const distance=(side?a.arch.halfWidth:a.arch.halfLength)+1.35;
        const px=side?a.x+lx*distance:reverse?a.x+fx*distance:a.x-fx*distance;
        const pz=side?a.z+lz*distance:reverse?a.z+fz*distance:a.z-fz*distance;
        const pyaw=side?yaw-Math.PI/2:reverse?yaw+Math.PI:yaw;
        g.debugTeleport(px,pz,pyaw);
        const speed=scenario==='front-low'?1.45:scenario==='rear'?2.8:scenario==='side'?2.4:3.3;
        g.controller.speed=speed;
        const before={playerSpeed:g.controller.speed,npcSpeed:a.speed,x:a.x,z:a.z,s:a.s,
          lane:a.lane.id,lateral:a.lateralOffset,geometries:g.renderer.info.memory.geometries,
          textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs.length};
        const images={};const snap=()=>{g.camera.position.set(a.x+5,3.8,a.z+5.8);g.camera.lookAt(a.x,1,a.z);g.camera.fov=48;g.camera.updateProjectionMatrix();g.renderer.render(g.scene,g.camera);return g.renderer.domElement.toDataURL('image/png')};
        const capture=kind==='car'&&['front-moderate','side','rear','repeated','junction','release'].includes(scenario);
        if(capture)images.before=snap();
        t.debugSetSimulationFrozen(false);
        g.debugInput={throttle:1,brake:0,steer:0};
        let firstContact=null,lastContact=null,firstPlayerSpeed=null,firstNpcSpeed=null;
        let maxStep=0,previous={x:a.x,z:a.z},hits=g.controller.hits;
        const initialHits=hits;
        const samples=[];
        for(let i=0;i<135;i++){
          g.debugStepSim(1/60);
          const dx=a.x-previous.x,dz=a.z-previous.z;maxStep=Math.max(maxStep,Math.hypot(dx,dz));
          previous={x:a.x,z:a.z};
          if(g.controller.hits>hits){
            if(firstContact===null){firstContact=i/60;firstPlayerSpeed=g.controller.speed;firstNpcSpeed=a.speed}
            lastContact=i/60;hits=g.controller.hits;
          }
          if(capture&&i===29)images.first=snap();
          if(capture&&i===80)images.continued=snap();
          if(i%30===0)samples.push({t:i/60,playerSpeed:g.controller.speed,npcSpeed:a.speed,
            travel:a.contactTravel,sideTravel:a.contactSideTravel,x:a.x,z:a.z,hits:g.controller.hits-initialHits});
        }
        g.debugInput=null;
        const contact={playerSpeed:g.controller.speed,npcSpeed:a.speed,firstPlayerSpeed,firstNpcSpeed,
          displacement:Math.hypot(a.x-before.x,a.z-before.z),
          pushDistance:a.contactTravel,sideDistance:a.contactSideTravel,
          lateral:a.lateralOffset-before.lateral,duration:firstContact===null?0:lastContact-firstContact+1/60,
          hits:g.controller.hits-initialHits,maxStep};
        if(capture)images.push=snap();
        g.controller.speed=0;g.debugTeleport(a.x+20,a.z+20,0);
        if(capture)images.release=snap();
        let recoveryTime=null;
        for(let i=0;i<180;i++){
          g.debugStepSim(1/60);
          if(recoveryTime===null&&a.speed>0.5)recoveryTime=(i+1)/60;
        }
        const recovered={recoveryTime,speed:a.speed,s:a.s,lane:a.lane.id,finite:[a.x,a.z,a.s,a.speed,a.yaw].every(Number.isFinite),
          distance:Math.hypot(a.x-before.x,a.z-before.z),
          lateral:a.lateralOffset,validRoad:Math.abs(a.lateralOffset)<a.lane.halfRoadWidth-a.arch.halfWidth+0.1,
          geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs.length};
        if(capture)images.recovery=snap();
        return {kind,scenario,before,contact,recovered,samples,images};
      },{kind,scenario});
      for(const [name,png] of Object.entries(result.images))fs.writeFileSync(path.join(dir,`${kind}-${scenario}-${name}.png`),Buffer.from(png.split(',')[1],'base64'));
      delete result.images;
      if(!result.recovered.finite||!result.recovered.validRoad||result.contact.maxStep>2||
        result.contact.hits<1||result.contact.duration<=0||errors.length)
        throw Error(JSON.stringify({result,errors}));
      if(scenario==='front-moderate' &&
        (['bus','truck'].includes(kind) ? result.contact.pushDistance>0.12 : result.contact.pushDistance<0.8))
        throw Error('Unexpected mass-sensitive front push: '+JSON.stringify(result));
      if(scenario==='side' && !['bus','truck'].includes(kind) && result.contact.sideDistance<0.15)
        throw Error('Missing bounded side response: '+JSON.stringify(result));
      rows.push(result);
    }
    fs.writeFileSync(path.join(dir,`${kind}.json`),JSON.stringify(rows.filter(x=>x.kind===kind),null,2));
    console.log('MATRIX',kind,rows.filter(x=>x.kind===kind).map(x=>`${x.scenario}:${x.contact.pushDistance.toFixed(2)}/${x.contact.sideDistance.toFixed(2)}`).join(' '));
  }
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({rows,errors},null,2));
}finally{await teardownHarness(browser,server)}
