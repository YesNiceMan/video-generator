'use strict';
/* 十八轮验证:深/浅双模式表面审计 + 截图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9355;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r18e',
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

const auditExpr = [
  '(() => {',
  '  const q = s => document.querySelector(s);',
  '  const bgOf = s => { const n = q(s); return n ? getComputedStyle(n).backgroundColor : "N/A"; };',
  '  const rgbOf = c => (c || "").match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);',
  '  const isLight = c => { const m = rgbOf(c); if (!m) return false; const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]; return lum > 140; };',
  '  const isDark = c => { const m = rgbOf(c); if (!m) return false; const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]; return lum < 80; };',
  '  const lines = [];',
  '  lines.push("scheme=" + document.documentElement.dataset.scheme);',
  '  lines.push("body: " + (isLight(bgOf("body")) || isDark(bgOf("body")) ? "OK " + bgOf("body") : "CHECK " + bgOf("body")));',
  '  const btn = q(".btn-primary") || q(".dh-actions .btn");',
  '  if (btn) lines.push("btnGrad: " + getComputedStyle(btn).backgroundImage.slice(0, 90));',
  '  const genBtn = q(".ws-gen-btn");',
  '  if (genBtn) lines.push("genBtnGrad: " + getComputedStyle(genBtn).backgroundImage.slice(0, 90));',
  '  const projCard = q(".dash-proj-card");',
  '  if (projCard) lines.push("projCard: " + bgOf(".dash-proj-card"));',
  '  const stat = q(".stat-cards");',
  '  if (stat) lines.push("statCards: " + bgOf(".stat-cards").slice(0, 60));',
  '  const input = q(".ws-select");',
  '  if (input) lines.push("wsSelect: " + getComputedStyle(input).backgroundColor + " color=" + getComputedStyle(input).color);',
  '  const sun = q("#schemeBtn .scheme-ico-sun"), moon = q("#schemeBtn .scheme-ico-moon");',
  '  if (sun || moon) lines.push("icons: sun=" + (sun ? getComputedStyle(sun).display : "?") + " moon=" + (moon ? getComputedStyle(moon).display : "?"));',
  '  return lines.join(" | ");',
  '})()'
].join(String.fromCharCode(10));

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

  for (const scheme of ['dark', 'light']) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/' + pid + '/episode/' + eid), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await wait(1100);
    await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + scheme + '")}catch(e){}', returnByValue: true });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(4800);
    const res = await page.send('Runtime.evaluate', { expression: auditExpr, returnByValue: true });
    console.log('=== ' + scheme.toUpperCase() + ' ===');
    console.log(res.result.value);
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'r18-final-' + scheme + '.png'), Buffer.from(shotFile.data, 'base64'));
    page.ws.close();
  }
  console.log('DONE');
}

main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
