/* Actual browser renderer callbacks + continuous camera/player sweep through
 * the traffic system's real 76–86 m LOD hysteresis. Not a gameplay drive. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=path.join(root,'artifacts/cinematic-gap-closure/lod');fs.mkdirSync(dir,{recursive:true});
const port=4274,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
  let ok=false;for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
  if(!ok)throw Error('preview unavailable');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:640}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(()=>{const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');g.debugSetTimeForTest(12,0);g.settings.set({weatherPreference:'sunny'});g.applySettings();g.ui.show(null);g.debugFreeCamera=true;g.renderer.setAnimationLoop(null);g.peds.group.visible=false;g.player.root.visible=false;});
  const rows=[];
  const selected=process.argv.find(a=>a.startsWith('--kind='))?.split('=')[1];
  for(const kind of ['rickshaw','cng','easybike','car','bus','motorbike','truck','van'].filter(k=>!selected||k===selected)){
    const result=await page.evaluate(async kind=>{
      const g=window.__banglarTesla,t=g.traffic;
      t.debugSetSimulationFrozen(false);
      // Real traffic update drives LOD; unrelated agents are excluded from this
      // controlled visual fixture, not from production simulation.
      const isolated=t.agents[0];t.agents=[isolated];
      t.debugPositionAgentForTest(kind,42,106,0,3);const agent=t.agents[0];
      agent.speed=3;agent.cruise=5;agent.dwellTimer=0;agent.roadRageHold=0;
      const wheel=t.group.getObjectByName(`traffic.wheels.${agent.arch.spokedWheels?'spoked':'disc'}`);
      const body=t.group.getObjectByName(`traffic.${kind}.primary`);
      const driverLayers=t.fleet.steeringLayers.get(kind);
      const bodyMaterial=body.material.uuid,wheelMaterial=wheel.material.uuid;
      const dist=[20,30,40,50,60,70,78,82,86,90,95,100,105,100,95,90,86,82,78,74,70,60,50,40,30,20];
      const path=[];let prevSpin=agent.wheelSpin;
      for(let i=0;i<dist.length;i++){
        const d=dist[i];t.setPlayer(agent.x,agent.z+d,0);t.update(1/30);
        // Inspection camera tracks the vehicle while the player moves through
        // the real distance-based LOD band; it does not travel into buildings.
        g.camera.position.set(agent.x+5.2+(d-20)*0.005,4.0,agent.z+7.75+(d-20)*0.005);
        g.camera.lookAt(agent.x,1,agent.z);g.camera.fov=48;g.camera.updateProjectionMatrix();
        let bodies=0,wheels=0;const oldBody=body.onBeforeRender,oldWheel=wheel.onBeforeRender;
        body.onBeforeRender=()=>{bodies++};wheel.onBeforeRender=()=>{wheels++};
        g.renderer.render(g.scene,g.camera);
        body.onBeforeRender=oldBody;wheel.onBeforeRender=oldWheel;
        const driver=driverLayers?.find(layer=>layer.count>0);
        const driverAligned=!driver||Math.hypot(driver.instanceMatrix.array[12]-agent.x,driver.instanceMatrix.array[14]-agent.z)<0.02;
        const r={distance:d,lod:agent.nearLod?'near':'far',bodies,wheels,
          wheelCount:wheel.count,wheelSpin:agent.wheelSpin,visible:agent.visible,
          driverCount:driver?.count??0,driverAligned,castShadow:body.castShadow,
          geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,
          programs:g.renderer.info.programs.length};
        if(!agent.visible||bodies===0||wheels===0||wheel.count<agent.arch.wheelMounts.length||r.wheelSpin<prevSpin||
          !driverAligned||(driverLayers&&!driver)||body.material.uuid!==bodyMaterial||wheel.material.uuid!==wheelMaterial||!body.castShadow||
          (path.length>0&&(r.geometries!==path[0].geometries||r.textures!==path[0].textures||r.programs!==path[0].programs)))
          throw Error(kind+' transition '+JSON.stringify(r));
        prevSpin=r.wheelSpin;path.push(r);
        if([0,6,11,17,25].includes(i))r.png=g.renderer.domElement.toDataURL('image/png');
      }
      return path;
    },kind);
    for(const [i,r] of result.entries()){
      if(r.png){fs.writeFileSync(path.join(dir,`${kind}-${i}.png`),Buffer.from(r.png.split(',')[1],'base64'));delete r.png}
    }
    if(!result.some(r=>r.lod==='far')||result[0].lod!=='near'||result.at(-1).lod!=='near')throw Error(kind+' did not cross both LOD thresholds');
    rows.push({kind,path:result});
    fs.writeFileSync(path.join(dir,`${kind}.json`),JSON.stringify(result,null,2));
  }
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({rows,errors},null,2));
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS real traffic LOD sweep near/far/near:',rows.map(r=>`${r.kind} ${r.path.length} samples`).join(', '));
}finally{await teardownHarness(browser,server)}
