'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9353;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r18d',
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

  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await wait(1200);
  await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","light")}catch(e){}', returnByValue: true });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(4500);

  const expr = [
    '(() => {',
    '  const q = s => document.querySelector(s);',
    '  const bg = s => { const n = q(s); return n ? getComputedStyle(n).backgroundColor : "N/A"; };',
    '  const isLight = c => { const m = (c||"").match(/\d+/g); if (!m || m.length < 3) return false; const [r,g,b] = m.map(Number); return (0.2126*r + 0.7152*g + 0.0722*b) > 140; };',
    '  const lines = [];',
    '  const scheme = document.documentElement.dataset.scheme;',
    '  lines.push("scheme=" + scheme);',
    '  lines.push("bodyBg " + (isLight(bg("body")) ? "LIGHT-OK" : "BAD") + " " + bg("body"));',
    '  lines.push("topbar " + (isLight(bg(".topbar")) ? "LIGHT-OK" : "BAD") + " " + bg(".topbar"));',
    '  lines.push("card " + (isLight(bg(".card")) ? "LIGHT-OK" : "BAD") + " " + bg(".card"));',
    '  const btn = q(".btn-primary") || q(".dh-actions .btn");',
    '  lines.push("btnGrad " + (btn ? getComputedStyle(btn).backgroundImage.slice(0, 60) : "N/A"));',
    '  const input = q(".input");',
    '  lines.push("input " + (input ? (isLight(getComputedStyle(input).backgroundColor) ? "LIGHT-OK" : "BAD") + " " + getComputedStyle(input).backgroundColor : "N/A"));',
    '  const sun = q("#schemeBtn .scheme-ico-sun"), moon = q("#schemeBtn .scheme-ico-moon");',
    '  lines.push("icons sun=" + (sun ? getComputedStyle(sun).display : "?") + " moon=" + (moon ? getComputedStyle(moon).display : "?"));',
    '  return lines.join(" || ");',
    '})()'
  ].join('\n');

  const evalRes = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('LIGHT MODE AUDIT:');
  console.log(evalRes.result.value);
  const shotFile = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'r18-dashboard-light.png'), Buffer.from(shotFile.data, 'base64'));
  console.log('screenshot saved');
  page.ws.close();
  console.log('DONE');
}

main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
