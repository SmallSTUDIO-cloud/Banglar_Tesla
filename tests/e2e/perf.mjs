import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { ensureChromiumEnv, teardownHarness } from './chromium-env.mjs';
const PORT=4197, BASE=`http://127.0.0.1:${PORT}`;
const env = await ensureChromiumEnv();
const srv=spawn('npx',['vite','preview','--host','127.0.0.1','--port',String(PORT),'--strictPort'],{cwd:'/home/user/Banglar_Tesla',stdio:'ignore'});
for(let i=0;i<80;i++){try{if((await fetch(BASE)).ok)break}catch{} await new Promise(r=>setTimeout(r,250));}
const b=await puppeteer.launch({args:[...chromium.args,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],executablePath:await chromium.executablePath(),headless:'shell',env,defaultViewport:{width:900,height:506}});
const p=await b.newPage();
await p.goto(BASE,{waitUntil:'networkidle2',timeout:60000});
await p.waitForFunction('!!window.__banglarTesla',{timeout:60000});
await new Promise(r=>setTimeout(r,1500));
const stats = await p.evaluate(()=>{
  const g=window.__banglarTesla;
  g.debugStartMode('free');
  return new Promise(res=>setTimeout(()=>{
    const r=g.renderer.info;
    res({calls:r.render.calls, tris:r.render.triangles, geoms:r.memory.geometries, textures:r.memory.textures, programs:r.programs?.length});
  },2500));
});
console.log('RENDER STATS (balanced, free ride):', JSON.stringify(stats));
const q = await p.evaluate(()=>{const g=window.__banglarTesla; g.debugSetQuality('low'); return new Promise(r=>setTimeout(()=>{const i=g.renderer.info; r({calls:i.render.calls,tris:i.render.triangles})},2000));});
console.log('RENDER STATS (low):', JSON.stringify(q));
await teardownHarness(b, srv);
