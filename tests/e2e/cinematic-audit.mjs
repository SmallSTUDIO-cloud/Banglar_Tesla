/* Matched, staged renderer audit. Identical fixture for --tag=before/after.
 * Headless Chromium SwiftShader is NOT a mobile GPU; no simulated FPS claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6)||'after';
if(!/^[a-z0-9-]+$/.test(tag))throw Error('invalid tag');
const out=path.join(root,'artifacts',`cinematic-realism-${tag}`);fs.mkdirSync(out,{recursive:true});
const port=4271,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
  let ready=false;for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
  if(!ready)throw Error('preview unavailable (build first)');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:540,deviceScaleFactor:1}});
  const page=await browser.newPage(),diagnostics=[];
  page.on('console',m=>{if(['warning','error'].includes(m.type()))diagnostics.push({kind:m.type(),text:m.text().slice(0,500)})});
  page.on('pageerror',e=>diagnostics.push({kind:'pageerror',text:String(e)}));
  page.on('requestfailed',r=>diagnostics.push({kind:'requestfailed',url:r.url(),reason:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)diagnostics.push({kind:'http',status:r.status(),url:r.url()})});
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla',{timeout:60000});
  await page.evaluate(async()=>{await document.fonts.ready;const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');g.stop();g.ui.show(null);g.debugFreeCamera=true;g.peds.group.visible=false;g.traffic.debugSetSimulationFrozen(true);g.debugSetQuality('balanced');g.settings.set({weatherPreference:'sunny'});g.applySettings();g.debugTeleport(42,106,0)});
  const scenes=[
    {name:'commercial-day',eye:[42,2.5,112],look:[55,1.6,95],hour:12,weather:'sunny',fov:58},
    {name:'residential-day',eye:[-115,2.6,-133],look:[0,2,-167],hour:12,weather:'sunny',fov:58},
    {name:'drmc-day',eye:[20.2,5.8,-47.9],look:[37.4,3.8,-61.37],hour:12,weather:'sunny',fov:48},
    {name:'road-close',eye:[42,1.55,106],look:[42,0,92],hour:12,weather:'sunny',fov:53},
    {name:'golden-hour',eye:[42,2.5,112],look:[55,1.6,95],hour:17.5,weather:'sunny',fov:58},
    {name:'dusk',eye:[42,2.5,112],look:[55,1.6,95],hour:18.5,weather:'sunny',fov:58},
    {name:'night',eye:[42,2.5,112],look:[55,1.6,95],hour:0,weather:'sunny',fov:58},
    {name:'rain-day',eye:[42,2.5,112],look:[55,1.6,95],hour:12,weather:'rain',fov:58},
    {name:'storm-night',eye:[42,2.5,112],look:[55,1.6,95],hour:0,weather:'storm',fov:58},
    {name:'hero-day',eye:[45.4,1.86,109.9],look:[42,1.0,106],hour:12,weather:'sunny',fov:40},
    {name:'environment-far',eye:[42,4,148],look:[42,2,50],hour:12,weather:'sunny',fov:55},
  ];
  const results=[];
  for(const s of scenes){
    const r=await page.evaluate(s=>{
      const g=window.__banglarTesla;
      g.debugSetTimeForTest(Math.floor(s.hour),Math.round((s.hour%1)*60));
      g.env.setWeather(s.weather);g.env.update(s.weather==='sunny'?10:4,g.tmpPlayerVec);
      g.city.setNight(g.env.nightFactor);
      g.camera.position.set(...s.eye);g.camera.lookAt(...s.look);g.camera.fov=s.fov;g.camera.updateProjectionMatrix();
      const callbacks=[];g.scene.traverse(o=>{if(o.isMesh||o.isLine||o.isPoints||o.isSprite){const previous=o.onBeforeRender;callbacks.push([o,previous]);o.onBeforeRender=function(...args){window.__cinematicSeen.add(o);previous?.apply(this,args)}}});
      window.__cinematicSeen=new Set();
      const times=[];for(let i=0;i<13;i++){window.__cinematicSeen.clear();const start=performance.now();g.renderer.render(g.scene,g.camera);if(i>=3)times.push(performance.now()-start)}
      times.sort((a,b)=>a-b);
      const gl=g.renderer.getContext(),err=gl.getError();
      const info=g.renderer.info;
      const textures=new Set(),materials=new Set();g.scene.traverse(o=>{if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v)}}});
      let texBytes=0;for(const t of textures){const img=t.image;if(img&&Number.isFinite(img.width)&&Number.isFinite(img.height))texBytes+=img.width*img.height*4*(t.generateMipmaps?4/3:1)}
      for(const [o,previous] of callbacks)o.onBeforeRender=previous;
      return {name:s.name,camera:s.eye,look:s.look,fov:s.fov,hour:s.hour,weather:s.weather,quality:g.settings.get().quality,viewport:[innerWidth,innerHeight],calls:info.render.calls,triangles:info.render.triangles,renderables:window.__cinematicSeen.size,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length,materials:materials.size,estimatedSceneTextureMiB:Math.round(texBytes/1048576*100)/100,renderWallMs:{p50:times[4],p95:times[9],max:times[9]},glError:err,nightFactor:g.env.nightFactor,wetness:g.env.wetness,png:g.renderer.domElement.toDataURL('image/png')};
    },s);
    fs.writeFileSync(path.join(out,`${s.name}.png`),Buffer.from(r.png.split(',')[1],'base64'));
    delete r.png;results.push(r);
  }
  fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify({environment:'Chromium headless SwiftShader software WebGL; render wall time includes synchronous GL and is not GPU/FPS',seed:'city mulberry32(20261207); fixed traffic after boot',results,diagnostics},null,2));
  if(results.some(r=>r.glError)||diagnostics.some(d=>['pageerror','requestfailed','http'].includes(d.kind)))throw Error('runtime errors: '+JSON.stringify(diagnostics));
  console.log(tag,results.map(r=>`${r.name}:${r.calls}/${r.triangles}`).join(' '),'diagnostics',diagnostics.length);
}finally{await teardownHarness(browser,server)}
