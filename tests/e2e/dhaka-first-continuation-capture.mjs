/* Controlled before/after gap-closure captures; no gameplay or renderer edits.
 * Chromium + SwiftShader measurements are NOT Android GPU timings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6)||'before';
if(!/^(before|after)$/.test(tag))throw Error('tag must be before or after');
const only=process.argv.find(x=>x.startsWith('--only='))?.slice(7);
const out=path.join(root,'artifacts/dhaka-first-continuation',tag);fs.mkdirSync(out,{recursive:true});
const port=4273,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
  let ready=false;for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
  if(!ready)throw Error('preview unavailable; build first');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:540,deviceScaleFactor:1}});
  const page=await browser.newPage(),diagnostics=[];
  page.on('console',m=>{if(['warning','error'].includes(m.type()))diagnostics.push({kind:m.type(),text:m.text().slice(0,500)})});
  page.on('pageerror',e=>diagnostics.push({kind:'pageerror',text:String(e)}));
  page.on('requestfailed',r=>diagnostics.push({kind:'requestfailed',url:r.url(),reason:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)diagnostics.push({kind:'http',status:r.status(),url:r.url()})});
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla',{timeout:60000});
  const info=await page.evaluate(async()=>{
    await document.fonts.ready;
    const g=window.__banglarTesla;g.state.markTutorialDone();g.debugStartMode('free');g.stop();g.ui.show(null);g.debugFreeCamera=true;
    g.peds.group.visible=false;g.traffic.debugSetSimulationFrozen(true);g.debugSetQuality('balanced');
    g.settings.set({weatherPreference:'sunny'});g.applySettings();g.debugTeleport(42,106,0);
    // Controlled fleet: no ambient NPC spawn randomness in matched screenshots.
    for(const a of g.traffic.agents)a.visible=false;
    g.traffic.fleet.sync(g.traffic.agents);
    const gl=g.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {userAgent:navigator.userAgent,webglRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),holes:g.city.potholes.map(h=>({x:h.x,z:h.z,radius:h.radius,depth:h.depth,roadId:h.roadId})),colorSpace:g.renderer.outputColorSpace,toneMapping:g.renderer.toneMapping,exposure:g.renderer.toneMappingExposure};
  });
  const h=info.holes[0];if(!h||info.holes.length!==8)throw Error('authored pothole fixture missing');
  const street={eye:[42,2.5,112],look:[55,1.6,95],fov:58};
  const hole={eye:[h.x+2.5,2.8,h.z+3.7],look:[h.x,0,h.z],fov:47};
  const scenes=[
    {name:'road-pothole-day',...hole,hour:12,weather:'sunny',hidePlayer:true},
    {name:'road-pothole-wet',...hole,hour:12,weather:'rain',hidePlayer:true},
    {name:'road-street-day',eye:[42,1.6,108],look:[42,0.2,91],fov:55,hour:12,weather:'sunny',hidePlayer:true},
    {name:'road-street-night',eye:[42,1.6,108],look:[42,0.2,91],fov:55,hour:0,weather:'sunny',hidePlayer:true},
    {name:'road-street-rain-night',eye:[42,1.6,108],look:[42,0.2,91],fov:55,hour:0,weather:'rain',hidePlayer:true},
    {name:'commercial-performance',...street,hour:12,weather:'sunny',quality:'low'},
    {name:'commercial-balanced',...street,hour:12,weather:'sunny',quality:'balanced'},
    {name:'commercial-high',...street,hour:12,weather:'sunny',quality:'high'},
    {name:'commercial-dusk',...street,hour:18.5,weather:'sunny'},
    {name:'commercial-night',...street,hour:0,weather:'sunny'},
    {name:'commercial-rain',...street,hour:12,weather:'rain'},
    {name:'commercial-storm-night',...street,hour:0,weather:'storm'},
    {name:'commercial-clear-after-rain',...street,hour:12,weather:'sunny'},
    {name:'drmc',eye:[20.2,5.8,-47.9],look:[37.4,3.8,-61.37],fov:48,hour:12,weather:'sunny'},
    {name:'residential',eye:[-115,2.1,-133],look:[0,2,-167],fov:58,hour:12,weather:'sunny'},
    {name:'hero-close',eye:[45.4,1.86,109.9],look:[42,1,106],fov:40,hour:12,weather:'sunny'},
    {name:'hero-gameplay',eye:[42,2.5,112],look:[42,1,102],fov:58,hour:12,weather:'sunny'},
    ...['chase','close','wide','low','front','cockpit','side'].map(mode=>({name:'camera-'+mode,mode,hour:12,weather:'sunny'})),
    ...['car','bus','truck','van','cng','easybike','motorbike','rickshaw'].map(kind=>({name:'npc-'+kind,kind,hour:12,weather:'sunny'})),
    ...[20,82,105,82,20].map((distance,i)=>({name:`lod-car-${i}`,kind:'car',distance,hour:12,weather:'sunny'})),
  ];
  const results=[];
  for(const scene of scenes.filter(s=>!only||s.name.includes(only))){
    const r=await page.evaluate(s=>{
      const g=window.__banglarTesla,t=g.traffic;
      g.debugSetQuality(s.quality||'balanced');g.settings.set({weatherPreference:s.weather});g.applySettings();
      g.debugSetTimeForTest(Math.floor(s.hour),Math.round((s.hour%1)*60));
      g.env.setWeather(s.weather);g.env.update(s.weather==='sunny'?10:4,g.tmpPlayerVec);
      g.city.setNight(g.env.nightFactor);
      g.ui.show(s.mode?'hud':null);g.debugFreeCamera=true;g.player.root.visible=!s.hidePlayer;
      for(const a of t.agents)a.visible=false;
      let agent=null;
      if(s.kind){
        agent=t.agents[0];agent.kind=s.kind;agent.arch=t.fleet.layers.get(s.kind).arch;
        agent.x=42;agent.z=98;agent.y=g.city.heightAt(42,98);agent.yaw=0;agent.visible=true;agent.nearLod=!s.distance||s.distance<86;agent.wheelSpin=1.3;
        t.fleet.sync(t.agents);g.player.root.visible=false;
      }else t.fleet.sync(t.agents);
      if(s.mode){
        g.setCameraMode(s.mode);g.debugFreeCamera=false;
        g.debugTeleport(42,106,0);g.chase.snapTo(42,106,0,g.controller.y);
      }else if(s.kind){
        g.camera.position.set(47.2+(s.distance||20)*0.005,3.8,105.8+(s.distance||20)*0.005);
        g.camera.lookAt(42,1,98);g.camera.fov=48;g.camera.updateProjectionMatrix();
      }else{
        g.camera.position.set(...s.eye);g.camera.lookAt(...s.look);g.camera.fov=s.fov;g.camera.updateProjectionMatrix();
      }
      const seen=new Set(),saved=[];g.scene.traverse(o=>{if(o.isMesh||o.isLine||o.isPoints||o.isSprite){const old=o.onBeforeRender;saved.push([o,old]);o.onBeforeRender=function(...args){seen.add(o);old?.apply(this,args)}}});
      const times=[];for(let i=0;i<5;i++){seen.clear();const start=performance.now();g.renderer.render(g.scene,g.camera);if(i>=2)times.push(performance.now()-start)}
      times.sort((a,b)=>a-b);
      const stats={calls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,renderables:seen.size,geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs?.length,renderWallMs:{p50:times[1],max:times[2]},glError:g.renderer.getContext().getError()};
      for(const [o,old] of saved)o.onBeforeRender=old;
      if(s.mode){g.render()}else g.renderer.render(g.scene,g.camera);
      const asphalt=g.city.group.children.find(o=>o.name.startsWith('roads.asphalt'))?.material;
      return {...stats,camera:g.camera.position.toArray(),fov:g.camera.fov,night:g.env.nightFactor,wetness:g.env.wetness,roadFill:asphalt?.emissive?.toArray(),mirrorRenders:g.driverMirrors.renderCount,lod:agent?.nearLod??null,holeDepth:g.city.potholeDepthAt(g.city.potholes[0].x,g.city.potholes[0].z),png:g.renderer.domElement.toDataURL('image/png')};
    },scene);
    fs.writeFileSync(path.join(out,`${scene.name}.png`),Buffer.from(r.png.split(',')[1],'base64'));
    delete r.png;results.push({...scene,...r,viewport:[960,540],preset:scene.quality||'balanced',fixture:'seeded city, zero ambient agents; staged NPC for kind scenes'});
  }
  const result={environment:{node:process.version,browser:info.userAgent,backend:info.webglRenderer,viewport:[960,540],deviceScaleFactor:1,renderer:{colorSpace:info.colorSpace,toneMapping:info.toneMapping,exposure:info.exposure},seed:'city mulberry32(20261207); traffic hidden',potholes:info.holes},results,diagnostics};
  fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(result,null,2));
  if(results.some(r=>r.glError)||diagnostics.some(d=>['pageerror','requestfailed','http'].includes(d.kind)))throw Error('runtime diagnostics: '+JSON.stringify(diagnostics));
  if(tag==='after'&&!only){
    const named=n=>results.find(r=>r.name===n);
    if(named('road-pothole-day')?.holeDepth<0.064 || named('road-pothole-day')?.roadFill?.some(v=>v>0) ||
      named('road-street-night')?.roadFill?.reduce((a,b)=>a+b,0)<0.04 ||
      named('commercial-performance')?.calls>=named('commercial-balanced')?.calls ||
      named('commercial-balanced')?.calls>named('commercial-high')?.calls ||
      named('camera-cockpit')?.mirrorRenders<=named('camera-chase')?.mirrorRenders)
      throw Error('visual-state regression: '+JSON.stringify(results.filter(r=>['road-pothole-day','road-street-night','commercial-performance','commercial-balanced','commercial-high','camera-cockpit','camera-chase'].includes(r.name))));
  }
  console.log(tag,results.length,'scenes',results.map(r=>`${r.name}:${r.calls}/${r.triangles}`).join(' '),'diagnostics',diagnostics.length);
}finally{await teardownHarness(browser,server)}
