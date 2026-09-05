'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9349;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r18b',
  '--remote-debugging-port=' + PORT, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });

const wait = ms => new Promise(r => setTimeout(r, ms));

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}

async function main() {
  let version;
  for (let i = 0; i < 30; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome not ready');

  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const projs = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + demoToken } })).json();
  const pid = projs.items[0].id;
  const detail = await (await fetch('http://localhost:3088/api/projects/' + pid, { headers: { cookie: 'vf_sid=' + demoToken } })).json();
  const eid = detail.project.episodes[0].id;
  console.log('studio target:', pid, eid);

  const fpsChecks = '(() => { const sel = [...document.querySelectorAll("select[data-shot-fps]")][0]; return { scheme: document.documentElement.dataset.scheme, fpsCount: sel ? sel.options.length : 0, fpsOptions: sel ? [...sel.options].map(o => o.value) : null, val: sel ? sel.value : null }; })()';

  for (const scheme of ['light', 'dark']) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/' + pid + '/episode/' + eid), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await wait(1200);
    await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + scheme + '")}catch(e){}', returnByValue: true });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(5000);
    const evalRes = await page.send('Runtime.evaluate', { expression: 'JSON.stringify(' + fpsChecks + ')', returnByValue: true });
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'r18-studio-' + scheme + '.png'), Buffer.from(shotFile.data, 'base64'));
    console.log('[r18-studio-' + scheme + ']', evalRes.result.value.slice(0, 400));
    page.ws.close();
  }
  console.log('DONE');
}

main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
