'use strict';
/* 窄屏 1180px + 剪辑预览标签页截图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9378;
const SHOT_DIR = path.join(__dirname, 'shots-v17');
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r173','--remote-debugging-port=' + PORT, '--window-size=1280,900','about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  ws.onmessage = e => { const msg = JSON.parse(e.data); if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
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
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/e-5a6bbbf41d5c2bad'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 920, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3600);
  const narrow = await ev(`JSON.stringify({
    stacked: getComputedStyle(document.querySelector('.ws-card-grid')).gridTemplateColumns.split(' ').length === 1,
    navH: document.querySelector('.ws-nav').getBoundingClientRect().height,
    tabsVisible: document.querySelector('.ws-nav-tabs').getBoundingClientRect().width > 0
  })`, page);
  console.log('narrow@1180:', narrow);
  const s1 = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'studio-after-narrow.png'), Buffer.from(s1.data, 'base64'));
  /* 切到剪辑预览 */
  await ev(`(function(){ const t = document.querySelector('[data-ws-tab="edit"]'); t.click(); })()`, page);
  await wait(600);
  const s2 = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'studio-after-edit.png'), Buffer.from(s2.data, 'base64'));
  const editOk = await ev(`!!document.querySelector('.ws-edit-preview')`, page);
  console.log('edit preview rendered:', editOk);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
