/* Console-skill fallback: real browser/runtime diagnostics across state transitions.
 * This is a scripted Chromium/SwiftShader audit, not physical Android profiling. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tag=process.argv.find(x=>x.startsWith('--tag='))?.slice(6)||'after';
const port=4272,server=spawn(path.join(root,'node_modules/.bin/vite'),['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try{
  let ok=false;for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,150))}
  if(!ok)throw Error('preview unavailable');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:915,height:412}});
  const page=await browser.newPage(),events=[];
  page.on('console',m=>{if(m.type()==='warning'||m.type()==='error')events.push({kind:m.type(),text:m.text().slice(0,500)})});
  page.on('pageerror',e=>events.push({kind:'pageerror',text:String(e)}));
  page.on('requestfailed',r=>events.push({kind:'requestfailed',url:r.url(),reason:r.failure()?.errorText}));
  page.on('response',r=>{if(r.status()>=400)events.push({kind:'http',status:r.status(),url:r.url()})});
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});await page.waitForFunction('!!window.__banglarTesla',{timeout:60000});
  const stages=await page.evaluate(()=>{
    const g=window.__banglarTesla,rows=[];g.state.markTutorialDone();g.debugStartMode('free');g.stop();g.ui.show(null);
    const snapshot=(name)=>{g.renderer.render(g.scene,g.camera);const gl=g.renderer.getContext();rows.push({name,glError:gl.getError(),geometries:g.renderer.info.memory.geometries,textures:g.renderer.info.memory.textures,programs:g.renderer.info.programs?.length,weather:g.env.getWeather(),night:g.env.nightFactor,mirrors:g.debugSnapshot().mirrorRenders})};
    snapshot('boot-free');
    for(const quality of ['low','balanced','high']){g.debugSetQuality(quality);g.debugStepSim(0.2);snapshot('preset-'+quality)}
    g.debugSetQuality('balanced');
    for(const [hour,weather] of [[12,'sunny'],[18,'sunny'],[0,'sunny'],[6,'sunny'],[12,'rain'],[0,'storm'],[12,'sunny']]){
      g.debugSetTimeForTest(hour,0);g.settings.set({weatherPreference:weather});g.applySettings();g.debugStepSim(0.3);snapshot(`${hour}-${weather}`);
    }
    for(const mode of ['cockpit','chase','cockpit','chase']){g.setCameraMode(mode);g.debugStepSim(0.1);snapshot('camera-'+mode)}
    for(const [x,z] of [[42,106],[-115,-133],[20,-48],[42,106]]){g.debugTeleport(x,z,0);g.debugStepSim(0.1);snapshot('chunk-'+x+'-'+z)}
    for(let i=0;i<3;i++){g.togglePause();g.togglePause();g.debugStepSim(0.1);snapshot('pause-resume-'+i)}
    for(let i=0;i<200;i++)g.debugStepSim(1/60);
    snapshot('traffic-200-frames');return rows;
  });
  const result={environment:'Chromium headless SwiftShader; 915x412; scripted transitions only',stages,events};
  fs.mkdirSync(path.join(root,'artifacts',`cinematic-realism-${tag}`),{recursive:true});
  fs.writeFileSync(path.join(root,'artifacts',`cinematic-realism-${tag}`,'console.json'),JSON.stringify(result,null,2));
  console.log(tag,stages.length,'stages',events.length,'console/request issues',stages.filter(s=>s.glError).length,'WebGL errors');
  if(events.length||stages.some(s=>s.glError))throw Error(JSON.stringify(result).slice(0,2000));
}finally{await teardownHarness(browser,server)}
