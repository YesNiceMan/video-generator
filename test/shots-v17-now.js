'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9368;
const SHOT_DIR = path.join(__dirname, 'shots-v17');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-v17d',
  '--remote-debugging-port=' + PORT, '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  console.log('1 cdp up');
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  console.log('2 login ok');
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  console.log('3 ws open');
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  console.log('4 domains enabled');
  await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  console.log('5 cookie + metrics');
  await page.send('Page.navigate', { url: 'http://localhost:3088/#/' });
  console.log('6 navigated');
  await wait(3500);
  const title = await page.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  console.log('7 title =', title.result.value);
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'now-dashboard.png'), Buffer.from(s.data, 'base64'));
  console.log('8 shot dashboard done');
  for (const [route, name] of [['#/projects', 'projects'], ['#/assets', 'assets'], ['#/styles', 'styles']]) {
    await page.send('Runtime.evaluate', { expression: 'location.hash = "' + route + '"; true' });
    await wait(2200);
    const s2 = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, 'now-' + name + '.png'), Buffer.from(s2.data, 'base64'));
    console.log('shot', name);
  }
  console.log('ALL DONE');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
