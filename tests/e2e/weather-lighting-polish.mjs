/* Scripted weather/time and camera fixtures in rendered Chromium. Clock and
 * weather overrides are deliberate; not a continuous 24h drive or Android test. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4239;
const server = spawn(path.join(root,'node_modules/.bin/vite'), ['preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:'ignore'});
let browser;
try {
  let ready=false;
  for(let i=0;i<160;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}
  if(!ready)throw Error('preview not ready (run npm run build first)');
  browser=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env:ensureChromiumEnv(),defaultViewport:{width:960,height:540}});
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla');
  await page.evaluate(()=>{const g=window.__banglarTesla;g.debugStartMode('free');g.debugSetTimeForTest(12,0);g.settings.set({rainMode:'dynamic',rainDensity:'medium'});g.applySettings();});
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  const palette=[];
  for(const name of ['sunny','overcast','windy','rain','storm']){
    const state=await page.evaluate(name=>{
      const g=window.__banglarTesla;
      g.settings.set({weatherPreference:name});g.applySettings();g.debugStepSim(0.5);
      return {name,weather:g.env.getWeather(),wind:g.env.getWindStrength(),rain:g.env.activeRainDrops,
        zenith:g.env.skyUniforms.uZenith.value.getHSL({h:0,s:0,l:0}).l,
        lamp:g.env.lamps[0].intensity,geometries:g.renderer.info.memory.geometries,
        textures:g.renderer.info.memory.textures};
    },name);
    if(state.weather!==name)throw Error('weather override failed: '+JSON.stringify(state));
    palette.push(state);
  }
  const rain=await page.evaluate(()=>{
    const g=window.__banglarTesla;g.settings.set({weatherPreference:'rain'});g.applySettings();g.debugStepSim(1);
    const sizes=[...document.querySelectorAll('.rain-drop')].map(el=>getComputedStyle(el).width);
    return {count:document.querySelectorAll('.rain-drop.on').length,sizes:[...new Set(sizes)],
      tracks:[...document.querySelectorAll('.rain-drop')].map(el=>el.style.getPropertyValue('--trail')),
      opacity:getComputedStyle(g.ui.root).getPropertyValue('--rain-opacity').trim()};
  });
  await new Promise(r=>setTimeout(r,400));
  await page.screenshot({path:path.join(root,'artifacts','weather-polish-rain.png')});
  const flashCapture=await page.evaluate(()=>{
    const g=window.__banglarTesla;
    g.debugSetTimeForTest(0,10);g.settings.set({weatherPreference:'storm'});g.applySettings();
    g.debugStepSim(0.25);const baseline=g.env.sun.intensity;
    g.env.strike(1,true);g.env.update(1/60,g.tmpPlayerVec);
    const peak=g.env.sun.intensity;
    const fog=g.scene.fog.color.getHSL({h:0,s:0,l:0}).l;
    g.renderer.render(g.scene,g.camera);
    return {baseline,peak,night:g.env.nightFactor,fog,
      png:g.renderer.domElement.toDataURL('image/png')};
  });
  const {png,...flash}=flashCapture;
  fs.writeFileSync(path.join(root,'artifacts','weather-polish-midnight-flash.png'),Buffer.from(png.split(',')[1],'base64'));
  flash.after=await page.evaluate(()=>{const g=window.__banglarTesla;g.debugStepSim(1);return g.env.sun.intensity;});
  await new Promise(r=>setTimeout(r,400));
  await page.screenshot({path:path.join(root,'artifacts','weather-polish-midnight-storm.png')});
  // Morning after storm: one continuous fixed-pool transition rather than a
  // forgotten screen obstruction or a flash that remains in the world lights.
  const cleared=await page.evaluate(()=>{
    const g=window.__banglarTesla;
    g.debugSetTimeForTest(6,30);g.settings.set({weatherPreference:'sunny'});g.applySettings();g.debugStepSim(7);
    return {night:g.env.nightFactor,rain:g.env.activeRainDrops,
      drops:document.querySelectorAll('.rain-drop.on').length,wet:g.env.wetness,
      puddles:g.city.group.children.filter(x=>x.name.startsWith('roads.puddles')&&x.visible).length};
  });
  await new Promise(r=>setTimeout(r,500));
  await page.screenshot({path:path.join(root,'artifacts','weather-polish-dawn-clear.png')});
  // A real browser camera switch; mirrors must be visible only in the cockpit.
  await page.evaluate(()=>window.__banglarTesla.setCameraMode('cockpit'));
  await new Promise(r=>setTimeout(r,1200));
  const cockpit=await page.evaluate(()=>window.__banglarTesla.debugSnapshot().mirrorRenders);
  await page.screenshot({path:path.join(root,'artifacts','weather-polish-cockpit-dawn.png')});
  await page.evaluate(()=>window.__banglarTesla.setCameraMode('chase'));
  const switched=await page.evaluate(()=>window.__banglarTesla.debugSnapshot().mirrorRenders);
  await new Promise(r=>setTimeout(r,800));
  const chase=await page.evaluate(()=>window.__banglarTesla.debugSnapshot().mirrorRenders);
  // Persisted manual preference survives an actual browser page reload.
  await page.evaluate(()=>{const g=window.__banglarTesla;g.settings.set({weatherPreference:'windy'});g.applySettings();});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction('!!window.__banglarTesla');
  const persisted=await page.evaluate(()=>window.__banglarTesla.settings.get().weatherPreference);
  const auto=await page.evaluate(()=>{const g=window.__banglarTesla;g.settings.set({weatherPreference:'auto'});g.applySettings();return g.settings.get().weatherPreference;});
  if(!(palette[0].rain===0&&palette[1].rain===0&&palette[2].rain===0&&
    palette[3].rain>100&&palette[4].rain>=palette[3].rain&&palette[4].wind>palette[3].wind&&
    palette[4].zenith<palette[0].zenith&&
    rain.count===10&&rain.sizes.length>=3&&rain.tracks.length===10&&
    flash.peak>flash.baseline&&flash.peak<flash.baseline+2&&Math.abs(flash.after-flash.baseline)<0.03&&
    flash.night===1&&flash.fog<0.28&&cleared.rain===0&&cleared.drops===0&&cleared.puddles===0&&
    cleared.night<1&&cockpit>0&&chase===switched&&persisted==='windy'&&auto==='auto'&&
    palette.every(x=>x.geometries===palette[0].geometries&&x.textures===palette[0].textures))||errors.length)
    throw Error(JSON.stringify({palette,rain,flash,cleared,cockpit,switched,chase,persisted,auto,errors}));
  console.log('PASS rendered weather/light/time/camera fixtures and persisted manual/auto settings',JSON.stringify({palette,rain,flash,cleared,cockpit,switched,chase,persisted,auto}));
}finally{await teardownHarness(browser,server);}
