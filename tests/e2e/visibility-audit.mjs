/* Repeatable browser-only renderer audit. Run on an existing production build:
 * node tests/e2e/visibility-audit.mjs --tag=before|after
 * Captures actual render callbacks, not Object3D.visible guesses. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tag=process.argv.find(a=>a.startsWith('--tag='))?.split('=')[1]||'after';
const port=4248,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try {
  let ready=false;for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  if(!ready)throw Error('preview did not start');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:640}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla');
  const result=await page.evaluate(()=>{
    const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');
    g.debugSetTimeForTest(12,0);g.settings.set({weatherPreference:'sunny'});g.applySettings();
    g.debugSetQuality('balanced');g.ui.show(null);g.debugFreeCamera=true;
    g.renderer.setAnimationLoop(null);g.traffic.debugSetSimulationFrozen(true);
    g.peds.group.visible=false;g.debugTeleport(42,106,0);
    const all=[];g.scene.traverse(o=>{if(o.isMesh||o.isLine||o.isPoints||o.isSprite)all.push(o)});
    const cb=new Map(),seen=new Set();
    for(const o of all){cb.set(o,o.onBeforeRender);o.onBeforeRender=function(...args){seen.add(o);cb.get(o)?.apply(this,args)}}
    const snapshots=[];
    function render(label,x,z,lookX,lookZ){
      seen.clear();g.camera.position.set(x,3,z);g.camera.lookAt(lookX,1,lookZ);
      g.camera.fov=55;g.camera.updateProjectionMatrix();
      // Three's renderer.info.autoReset=true; one render gives per-view totals.
      const start=performance.now();g.renderer.render(g.scene,g.camera);const cpuMs=performance.now()-start;
      const info=g.renderer.info;
      const vehicles=[...seen].filter(o=>o.name.startsWith('traffic.')).map(o=>o.name);
      const counts={label,calls:info.render.calls,triangles:info.render.triangles,
        visibleMeshes:seen.size,totalMeshes:all.length,vehicleLayers:vehicles,
        cpuMs,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length};
      snapshots.push(counts);return counts;
    }
    // Freeze simulation but populate vehicle matrices at fixed world positions.
    const t=g.traffic,kinds=['rickshaw','cng','car','bus','motorbike','truck','van'];
    for(const a of t.agents)a.visible=false;
    kinds.forEach((kind,i)=>{const a=t.agents[i];a.kind=kind;a.arch=t.fleet.layers.get(kind).arch;
      a.x=42+(i-3)*3.5;a.z=100;a.y=g.city.heightAt(a.x,a.z);
      a.yaw=0;a.wheelSpin=1.3;a.nearLod=true;a.visible=true;});
    t.fleet.sync(t.agents);g.player.root.visible=true;
    render('front',42,116,42,100);
    render('turn-left',42,116,25,105);
    render('behind',42,116,42,132);
    render('front-again',42,116,42,100);
    for(const o of all)o.onBeforeRender=cb.get(o);
    return {snapshots,errors:[],fleetVisible:kinds.length};
  });
  result.frustum=await page.evaluate(()=>{
    const g=window.__banglarTesla;
    const sample=g.traffic.fleet.layers.get('car').primary;
    const Scene=g.scene.constructor,Camera=g.camera.constructor;
    const scene=new Scene(),camera=new Camera(60,1,0.1,150);
    camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateProjectionMatrix();
    const car=sample.clone(false);car.count=1;
    car.setMatrixAt(0,new car.matrix.constructor());car.computeBoundingSphere();
    const worldMeshes=[];g.city.group.traverse(o=>{if(o.isMesh&&!o.isInstancedMesh&&Number.isFinite(o.geometry?.boundingSphere?.radius))worldMeshes.push(o)});
    if(!worldMeshes.length)throw Error('no bounded world object for frustum fixture');
    worldMeshes.sort((a,b)=>a.geometry.boundingSphere.radius-b.geometry.boundingSphere.radius);
    const world=worldMeshes[0];
    const boxes=[];
    const names=['front','partial','left','right','behind','above','below'];
    const places=[[0,0,-10],[4.5,0,-8],[-500,0,-8],[500,0,-8],[0,0,500],[0,500,-8],[0,-500,-8]];
    for(let i=0;i<names.length;i++){
      const src=i%2===0?car:world;
      const obj=src.clone(false);obj.name=names[i];obj.frustumCulled=true;obj.matrixAutoUpdate=true;
      if(src===world){obj.geometry=src.geometry.clone();obj.geometry.translate(-src.geometry.boundingSphere.center.x,-src.geometry.boundingSphere.center.y,-src.geometry.boundingSphere.center.z);obj.geometry.computeBoundingSphere();obj.scale.setScalar(Math.min(1,2/obj.geometry.boundingSphere.radius))}
      obj.position.set(...places[i]);scene.add(obj);boxes.push(obj);
    }
    const drawn=[];for(const o of boxes)o.onBeforeRender=()=>drawn.push(o.name);
    g.renderer.render(scene,camera);const first=[...drawn];
    boxes[2].position.set(-3,0,-8);drawn.length=0;g.renderer.render(scene,camera);
    const entry=[...drawn];
    for(const o of boxes)if(o.geometry!==world.geometry&&o.geometry!==car.geometry)o.geometry.dispose();
    if(!first.includes('front')||!first.includes('partial')||first.some(n=>['left','right','behind','above','below'].includes(n))||!entry.includes('left'))throw Error(JSON.stringify({first,entry}));
    return {first,entry,worldSource:world.name||world.parent?.name};
  });
  result.cycles=await page.evaluate(()=>{
    const g=window.__banglarTesla,t=g.traffic;
    const resources=()=>({geometries:g.renderer.info.memory.geometries,
      textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs.length,
      fleetChildren:t.group.children.length});
    const start=resources(),agent=t.agents[0];
    for(let i=0;i<12;i++){
      agent.visible=false;t.fleet.sync(t.agents);g.renderer.render(g.scene,g.camera);
      agent.visible=true;t.fleet.sync(t.agents);g.renderer.render(g.scene,g.camera);
    }
    const end=resources();
    if(Object.keys(start).some(k=>start[k]!==end[k]))throw Error(JSON.stringify({start,end}));
    return {repetitions:12,start,end};
  });
  result.conditions=await page.evaluate(()=>{
    const g=window.__banglarTesla,t=g.traffic,rows=[];
    const scenarios=[
      ['performance','low',12,'sunny'],['balanced','balanced',12,'sunny'],
      ['high','high',12,'sunny'],['custom','balanced',12,'sunny'],
      ['dusk','balanced',18,'sunny'],['night','balanced',0,'sunny'],
      ['rain','balanced',12,'rain'],['storm','balanced',0,'storm'],
    ];
    for(const [label,preset,hour,weather] of scenarios){
      g.debugSetQuality(preset);g.settings.set({graphicsProfile:label==='performance'?'performance':label==='high'?'high':'balanced'});g.applySettings();if(label==='custom'){
        g.settings.set({graphicsProfile:'custom',renderScale:0.9});g.applySettings();
      }
      g.debugSetTimeForTest(hour,0);
      g.settings.set({weatherPreference:weather});g.applySettings();g.debugStepSim(1);
      for(const a of t.agents)a.visible=false;
      const a=t.agents[0];a.kind='car';a.arch=t.fleet.layers.get('car').arch;
      a.x=42;a.z=100;a.y=g.city.heightAt(42,100);a.yaw=0;a.visible=true;a.nearLod=true;
      t.fleet.sync(t.agents);
      const body=t.group.getObjectByName('traffic.car.primary');
      const views=[];
      for(const [view,z,lookZ] of [['front',116,100],['back',116,132]]){
        let rendered=0;const old=body.onBeforeRender;body.onBeforeRender=()=>rendered++;
        g.camera.position.set(42,3,z);g.camera.lookAt(42,1,lookZ);
        g.camera.fov=55;g.camera.updateProjectionMatrix();
        g.renderer.render(g.scene,g.camera);body.onBeforeRender=old;
        views.push({view,rendered,calls:g.renderer.info.render.calls});
      }
      if(views[0].rendered!==1||views[1].rendered!==0)throw Error(JSON.stringify({label,views}));
      rows.push({label,quality:g.settings.get().quality,profile:g.settings.get().graphicsProfile,weather,night:g.env.nightFactor,
        rain:g.env.activeRainDrops,views});
    }
    g.setCameraMode('cockpit');
    const prior=g.driverMirrors.renderCount;
    g.driverMirrors.update(performance.now()+200,true,42,0,106,0,g.player.root);
    const cockpit=g.driverMirrors.renderCount-prior;
    const priorChase=g.driverMirrors.renderCount;
    g.setCameraMode('chase');
    g.driverMirrors.update(performance.now()+400,false,42,0,106,0,g.player.root);
    const chase=g.driverMirrors.renderCount-priorChase;
    if(cockpit!==2||chase!==0)throw Error(JSON.stringify({cockpit,chase}));
    return {rows,cockpitMirrorRenders:cockpit,chaseMirrorRenders:chase};
  });
  result.inventory=await page.evaluate(()=>{
    const g=window.__banglarTesla,exceptions=[],large=[];
    let total=0,native=0,instanced=0,skinned=0,casters=0;
    g.scene.traverse(o=>{
      if(!(o.isMesh||o.isLine||o.isPoints||o.isSprite))return;
      total++;if(o.frustumCulled)native++;else exceptions.push(o.name||o.type);
      if(o.isInstancedMesh)instanced++;if(o.isSkinnedMesh)skinned++;if(o.castShadow)casters++;
      const radius=o.geometry?.boundingSphere?.radius;
      if(Number.isFinite(radius)&&radius>100)large.push({name:o.name,radius:+radius.toFixed(1)});
    });
    return {total,native,disabled:exceptions.length,instanced,skinned,casters,
      exceptions,large:large.slice(0,20)};
  });
  result.errors.push(...errors);
  const dir=path.join(root,'artifacts',`visibility-${tag}`);fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(result,null,2));
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify(result));
}finally{await teardownHarness(browser,server);}
