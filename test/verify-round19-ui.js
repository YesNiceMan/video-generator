'use strict';
/* 十九轮验证:素面金按钮 + 浅色「画廊白」配色 —— 双模式计算样式审计与截图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9371;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PROFILE = '/tmp/vf-chrome-profile-r19-' + Date.now();
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl); let msgId = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}
async function main() {
  let version;
  for (let i = 0; i < 40; i++) { try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  if (!version) throw new Error('chrome not ready');
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const projs = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + token } })).json();
  let target = null;
  for (const p of (projs.items || [])) {
    const d = await (await fetch('http://localhost:3088/api/projects/' + p.id, { headers: { cookie: 'vf_sid=' + token } })).json();
    const eps = (d.project && d.project.episodes) || d.episodes || [];
    if (eps.length) { target = { pid: p.id, eid: eps[0].id }; break; }
  }
  async function shot(name, hash, scheme, expr, waitMs = 4200) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await wait(1100);
    await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + scheme + '")}catch(e){}', returnByValue: true });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(waitMs);
    const r = await page.send('Runtime.evaluate', { expression: 'JSON.stringify(' + expr + ')', returnByValue: true });
    const sf = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(sf.data, 'base64'));
    console.log('[' + name + '] ' + r.result.value);
    page.ws.close();
  }
  const dashExpr = '(() => { const b = document.querySelector(".btn-primary"); const cs = b ? getComputedStyle(b) : null;' +
    'return { scheme: document.documentElement.dataset.scheme, bodyBg: getComputedStyle(document.body).backgroundColor,' +
    ' btnBg: cs ? cs.backgroundColor : null, btnImage: cs ? cs.backgroundImage : null, btnColor: cs ? cs.color : null,' +
    ' btnShadow: cs ? cs.boxShadow : null, gradVar: getComputedStyle(document.documentElement).getPropertyValue("--grad").trim().slice(0, 70) }; })()';
  const studioExpr = '(() => { const g = document.querySelector(".ws-gen-btn"); const cs = g ? getComputedStyle(g) : null;' +
    'const card = document.querySelector(".ws-card");' +
    'const sel = [...document.querySelectorAll("select[data-shot-fps]")][0];' +
    'return { scheme: document.documentElement.dataset.scheme,' +
    ' genBg: cs ? cs.backgroundColor : null, genImage: cs ? cs.backgroundImage : null, genColor: cs ? cs.color : null,' +
    ' genShadow: cs ? cs.boxShadow : null, afterDisplay: g ? getComputedStyle(g, "::after").display : null,' +
    ' wsGold: getComputedStyle(document.querySelector(".ws")).getPropertyValue("--ws-gold").trim(),' +
    ' cardBg: card ? getComputedStyle(card).backgroundColor : null,' +
    ' fps: sel ? sel.options.length + "档 当前" + sel.value : null }; })()';
  for (const scheme of ['dark', 'light']) await shot('r19-dash-' + scheme, '#/', scheme, dashExpr);
  if (target) for (const scheme of ['dark', 'light']) await shot('r19-studio-' + scheme, '#/projects/' + target.pid + '/episode/' + target.eid, scheme, studioExpr);
  console.log('DONE');
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
