/* Fixed-camera world material/lighting comparison. Browser SwiftShader only,
 * not an Android benchmark. No gameplay state or production assets are saved. */
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import {ensureChromiumEnv,teardownHarness} from './chromium-env.mjs';
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6);
if(!['before','after','final','review','arch-before','arch-after','arch-final','arch-verified','streetlife-before','streetlife-after','streetlife-verified','streetlife-final'].includes(tag))throw Error('Use an explicit comparison tag');
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'artifacts/world-lighting-pass',tag);
if(fs.existsSync(path.join(out,'metrics.json')))throw Error('Refusing to overwrite existing comparison: '+out);
fs.mkdirSync(out,{recursive:true});
const port=4287,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
 if(!ready)throw Error('Built preview unavailable');
 browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:await ensureChromiumEnv(),defaultViewport:{width:960,height:540,deviceScaleFactor:1}});
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const boot=Date.now();await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction('!!window.__banglarTesla',{timeout:90000});
 const bootMs=Date.now()-boot;
 const env=await page.evaluate(()=>{
  const g=window.__banglarTesla,gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  g.state.markTutorialDone();g.debugStartMode('free');g.stop();g.ui.show(null);g.debugFreeCamera=true;
  g.peds.group.visible=false;g.traffic.group.visible=false;g.debugSetQuality('balanced');g.debugTeleport(42,106,0);
  return {gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),resolution:[g.renderer.domElement.width,g.renderer.domElement.height]};
 });
 const scenes=[
  {name:'street-noon',eye:[42,2.5,112],look:[55,1.6,95],hour:12,weather:'sunny',player:false},
  {name:'street-golden',eye:[42,2.5,112],look:[55,1.6,95],hour:16.5,weather:'sunny',player:false},
  {name:'street-night',eye:[42,2.5,112],look:[55,1.6,95],hour:0,weather:'sunny',player:false},
  {name:'street-rain',eye:[42,2.5,112],look:[55,1.6,95],hour:12,weather:'rain',player:false},
  {name:'hero-noon',eye:[45.4,1.86,109.9],look:[42,1,106],hour:12,weather:'sunny',player:true},
  {name:'facade-close',eye:[42,2.35,112],look:[47,6.1,101],fov:42,hour:12,weather:'sunny',player:false},
 ];
 const result=[];
 for(const scene of scenes){
  const record=await page.evaluate(s=>{
   const g=window.__banglarTesla;
   g.settings.set({weatherPreference:s.weather});g.applySettings();g.debugSetTimeForTest(Math.floor(s.hour),Math.round((s.hour%1)*60));
   g.env.setWeather(s.weather);g.env.update(s.weather==='sunny'?10:4,g.tmpPlayerVec);
   g.city.setNight(g.env.nightFactor);g.player.root.visible=s.player;
   g.camera.position.set(...s.eye);g.camera.lookAt(...s.look);g.camera.fov=s.fov??58;g.camera.updateProjectionMatrix();
   const times=[];for(let i=0;i<7;i++){const t=performance.now();g.renderer.render(g.scene,g.camera);if(i>=2)times.push(performance.now()-t)}
   times.sort((a,b)=>a-b);
   const r=g.renderer.info;
   return {calls:r.render.calls,triangles:r.render.triangles,geometries:r.memory.geometries,textures:r.memory.textures,
     renderWallMedianMs:+times[2].toFixed(2),renderWallMaxMs:+times[4].toFixed(2),
     wetness:g.env.wetness,night:g.env.nightFactor,sunIntensity:g.env.sun.intensity,hemiIntensity:g.env.hemi.intensity,
     exposure:g.renderer.toneMappingExposure,glError:g.renderer.getContext().getError(),png:g.renderer.domElement.toDataURL('image/png')};
  },scene);
  fs.writeFileSync(path.join(out,scene.name+'.png'),Buffer.from(record.png.split(',')[1],'base64'));
  delete record.png;result.push({...scene,...record});
 }
 fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify({env,bootMs,scenes:result,errors},null,2));
 if(errors.length||result.some(r=>r.glError))throw Error(JSON.stringify({errors,glErrors:result.map(r=>r.glError)}));
 console.log(tag,JSON.stringify({env,bootMs,scenes:result.map(({name,calls,triangles,renderWallMedianMs,wetness})=>({name,calls,triangles,renderWallMedianMs,wetness})),errors}));
}finally{await teardownHarness(browser,server)}
