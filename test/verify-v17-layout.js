'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9372;
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-v17h','--remote-debugging-port=' + PORT, '--window-size=1600,1000','about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  ws.onmessage = e => { const msg = JSON.parse(e.data); if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3500);
  // 用 canvas 加载截图文件分析?截图在本地。改为:直接在页面里分析各区域背景色像素(用 getComputedStyle 已做过)。
  // 这里做「布局健全性」检查:无横向溢出、hero/stat/cards 高度合理、无零尺寸异常
  const r = JSON.parse(await ev("JSON.stringify((function(){var c=document.querySelector('.content'); var hero=document.querySelector('.dash-hero'); var stat=document.querySelector('.stat-cards'); var cards=[].slice.call(document.querySelectorAll('.dash-proj-card')).slice(0,3); var overflowX=document.documentElement.scrollWidth > document.documentElement.clientWidth; function box(e){if(!e)return null; var r=e.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height)};} return {overflowX:overflowX, hero:box(hero), stat:box(stat), statCards:[].slice.call(document.querySelectorAll('.stat-cards .stat-card')).map(function(s){return box(s);}), projCards:cards.map(function(s){return box(s);}), zeroEls:[].slice.call(document.querySelectorAll('#view *')).filter(function(e){var b=e.getBoundingClientRect(); return b.width===0&&b.height===0&&e.children.length===0&&!e.tagName.match(/BR|SCRIPT|STYLE|LINK/);}).length};})())", page));
  console.log('LAYOUT:', JSON.stringify(r, null, 1));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
