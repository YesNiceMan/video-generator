'use strict';
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9352;
const wait = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-probe',
  '--remote-debugging-port=' + PORT,
  '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const p = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    p.set(i, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}

async function loginToken(email, password) {
  const r = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  return r.headers.get('set-cookie').split(';')[0].split('=')[1];
}

async function main() {
  let v;
  for (let i = 0; i < 40; i++) {
    try { v = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; }
    catch (e) { await wait(500); }
  }
  const token = await loginToken('demo@videoforge.cn', 'demo123');
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-demo/episode/e-01'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await wait(1200);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(5000);
  const r = await page.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      hash: location.hash,
      body: document.body.innerText.slice(0, 300),
      viewId: document.getElementById('view') ? document.getElementById('view').innerHTML.slice(0, 300) : 'NO_VIEW',
      hasWs: !!document.querySelector('#wsRoot'),
      hasApp: !document.getElementById('app').classList.contains('hidden'),
      hasAuth: !document.getElementById('authRoot').classList.contains('hidden')
    })`,
    returnByValue: true
  });
  console.log(r.result.value);
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
