/* Real application WebGL vehicle presentation fixtures. Positions/camera are
 * staged for inspection, NOT a driven race or Android/device verification. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6)||'after';
const out=path.join(root,'artifacts',`vehicle-${tag}`);fs.mkdirSync(out,{recursive:true});
const port=4243,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
  let ready=false;
  for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,150));}
  if(!ready)throw Error('preview unavailable (build first)');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:640}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(()=>{
    const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');
    g.debugSetTimeForTest(12,0);g.settings.set({weatherPreference:'sunny'});g.applySettings();
    g.debugSetQuality('balanced');g.ui.show(null);g.debugFreeCamera=true;
    g.renderer.setAnimationLoop(null);g.traffic.debugSetSimulationFrozen(true);
    g.peds.group.visible=false;g.traffic.group.visible=false;
    g.debugTeleport(42,106,0);
  });
  async function capture(name,fn,arg){
    const result=await page.evaluate(fn,arg);
    if(!result.png?.startsWith('data:image/png;base64,'))throw Error('no rendered image: '+name);
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(result.png.split(',')[1],'base64'));
    delete result.png;return result;
  }
  const records=[];
  for(const [view,angle] of [['front',0],['side',Math.PI/2],['rear',Math.PI],['quarter',Math.PI/4]]){
    const r=await capture(`player-${view}`,a=>{
      const g=window.__banglarTesla,r=g.player.rig,p=g.player.root.position;
      g.player.root.visible=true;g.traffic.group.visible=false;
      r.applyDynamics({steerAngle:0,wheelSpin:0,pedalPhase:0,roll:0,pitch:0,nightFactor:0});
      g.camera.position.set(p.x+Math.sin(a)*4.7,p.y+1.75,p.z+Math.cos(a)*4.7);
      g.camera.lookAt(p.x,p.y+1.15,p.z);g.camera.fov=40;g.camera.updateProjectionMatrix();
      g.renderer.render(g.scene,g.camera);
      return {view:a,hands:r.driverArms.length,triangles:g.renderer.info.render.triangles,
        calls:g.renderer.info.render.calls,png:g.renderer.domElement.toDataURL('image/png')};
    },angle);records.push({kind:'player',view,...r});
  }
  for(const kind of ['rickshaw','cng','easybike','car','bus','motorbike','truck','van']){
    for(const lod of ['near','far']){
      const r=await capture(`${kind}-${lod}`,([type,level])=>{
        const g=window.__banglarTesla,t=g.traffic;
        g.player.root.visible=false;g.traffic.group.visible=true;
        for(const a of t.agents)a.visible=false;
        const a=t.agents[0];
        a.kind=type;a.arch=t.fleet.layers.get(type).arch;a.variant=0;
        a.x=42;a.z=106;a.y=g.city.heightAt(42,106);a.yaw=0;
        a.visible=true;a.nearLod=level==='near';a.steerAngle=0;a.wheelSpin=1.2;
        t.fleet.sync(t.agents);
        const distance=a.arch.halfLength>2.6?9:6;
        g.camera.position.set(42+distance*0.58,2.7+distance*0.13,106+distance*0.86);
        g.camera.lookAt(42,1.05,106);g.camera.fov=48;g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene,g.camera);
        return {kind:type,lod:level,wheels:a.arch.wheelMounts.length,
          wheelRadius:a.arch.wheelRadius,triangles:g.renderer.info.render.triangles,
          calls:g.renderer.info.render.calls,png:g.renderer.domElement.toDataURL('image/png')};
      },[kind,lod]);records.push(r);
    }
  }
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({records,errors},null,2));
  if(errors.length||records.length!==20||records.some(r=>r.wheels!==undefined&&r.wheels<2))throw Error(JSON.stringify({records,errors}));
  console.log('PASS rendered 4 player angles + 8 NPC kinds near/far',JSON.stringify(records));
}finally{await teardownHarness(browser,server);}
