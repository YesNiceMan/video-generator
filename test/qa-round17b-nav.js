'use strict';
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9382;
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r177','--remote-debugging-port=' + PORT, '--window-size=1440,900','about:blank'], { stdio: 'ignore' });
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
  if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/e-5a6bbbf41d5c2bad'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3800);
  for (const w of [1366, 1280, 1200, 1150, 1120, 1080]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(350);
    console.log(w, await ev(`JSON.stringify({
      navOver: document.querySelector('.ws-nav').scrollWidth > document.querySelector('.ws-nav').clientWidth + 1,
      crumbTrunc: (function(){ const c = document.querySelector('.ws-crumb'); return c.scrollWidth > c.clientWidth + 1; })(),
      toolsW: Math.round(document.querySelector('.ws-nav-tools').getBoundingClientRect().width),
      tabsW: Math.round(document.querySelector('.ws-nav-tabs').getBoundingClientRect().width),
      saveVis: document.getElementById('wsSaveState').getBoundingClientRect().width > 0
    })`, page));
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
