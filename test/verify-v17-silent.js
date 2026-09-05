'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9371;
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-v17g','--remote-debugging-port=' + PORT, '--window-size=1600,1000','about:blank'], { stdio: 'ignore' });
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
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/admin'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3000);
  await ev("document.querySelector('[data-tab=\"tasks\"]').click()", page);
  await wait(1500);
  // 模拟数据变化:直接改 innerHTML 长度后调用一次带 silent 的渲染路径 —— 更直接:加类后验证动画被禁
  const r1 = JSON.parse(await ev("(function(){var b=document.querySelector('#adminBody'); b.classList.add('silent-render'); var e=document.querySelector('#adminBody .stat-card'); var a=e?getComputedStyle(e).animationName:'no-el'; b.classList.remove('silent-render'); var a2=e?getComputedStyle(e).animationName:'no-el'; return JSON.stringify({silentOn:a, silentOff:a2});})()", page));
  console.log('silent-render CSS check:', JSON.stringify(r1));
  let failures = 0;
  if (r1.silentOn !== 'none') { console.log('FAIL | silent-render 类未禁用入场动画'); failures++; } else console.log('PASS | silent-render 禁用入场动画');
  if (r1.silentOff === 'none') { console.log('FAIL | 移除类后动画未恢复'); failures++; } else console.log('PASS | 移除类后动画恢复(' + r1.silentOff + ')');
  console.log(failures ? 'FAILURES: ' + failures : 'SILENT CSS ALL PASS');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
