// Browser rendering test, not a substitute for ESP Wi-Fi/QR and real iPad Safari tests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
const cwd = fileURLToPath(new URL('..',import.meta.url));
const binary=join(mkdtempSync(join(tmpdir(),'loom-card-test-')),'render');
execFileSync(process.env.CC || 'cc',['-std=c11','-Icomponent/test/stubs','-Icomponent/include','-Icomponent','component/snapshot.c','browser/render.c','-o',binary],{cwd});
const [path,cache,csp,...lines]=execFileSync(binary,{encoding:'utf8'}).split('\n');
const body=lines.join('\n'); const visits=[];
const server=createServer((req,res)=>{visits.push(req.url);if(req.method==='GET' && req.url===path)res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':cache,'Content-Security-Policy':csp}).end(body);else res.writeHead(404).end();});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
let browser;
try {
 browser=process.env.TEST_WEBKIT ? await webkit.launch() : await chromium.launch({channel:'chrome'});
 const page=await browser.newPage({viewport:{width:820,height:1180}}); const external=[];
 const origin=`http://127.0.0.1:${server.address().port}`;
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 const r=await page.goto(origin+path);assert.equal(r.status(),200);assert.match(r.headers()['cache-control'],/no-store/);
 assert.equal(await page.locator('h1').innerText(),'我的机器狗');assert.equal(await page.locator('p').innerText(),'看一下转轴');
 assert.equal(await page.locator('script,a[href],img,[onclick]').count(),0);assert.deepEqual(external,[]);assert.equal(visits.includes('/secret'),false);
 console.log(`PASS: ${browser.browserType().name()} ${browser.version()}, iPad-sized viewport, actual firmware-generated Chinese HTML displayed with no external requests or interactive markup (host HTTP fixture)`);
} finally {await browser?.close(); await new Promise(ok=>server.close(ok));}
