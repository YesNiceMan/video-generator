'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9370;
const SHOT_DIR = path.join(__dirname, 'shots-v17');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-v17f','--remote-debugging-port=' + PORT, '--window-size=1600,1000','about:blank'], { stdio: 'ignore' });
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
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3200);
  let failures = 0;
  const ok = (cond, label, detail) => { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' — ' + detail : '')); if (!cond) failures++; };
  // 打开任务监控 tab
  await ev("document.querySelector('[data-tab=\"tasks\"]').click()", page);
  await wait(1800);
  const st1 = JSON.parse(await ev("JSON.stringify({len: document.querySelector('#adminBody').innerHTML.length, hasCards: !!document.querySelector('#adminBody .stat-cards'), rows: document.querySelectorAll('#adminBody tbody tr').length})", page));
  ok(st1.hasCards, '任务监控页正常渲染', 'rows=' + st1.rows);
  // 等两轮轮询(3s x2),DOM 应保持稳定(签名未变 → 不重绘)
  const html1 = await ev("document.querySelector('#adminBody').innerHTML.length", page);
  await wait(6600);
  const st2 = JSON.parse(await ev("JSON.stringify({len: document.querySelector('#adminBody').innerHTML.length, silent: document.querySelector('#adminBody').classList.contains('silent-render'), anim: (function(){var e=document.querySelector('#adminBody .stat-card'); return e?getComputedStyle(e).animationName:'no-el'})()})", page));
  ok(st2.len === st1.len || st2.silent, '轮询期间无闪烁(签名跳过或静默渲染)', 'len ' + st1.len + ' → ' + st2.len + ' silent=' + st2.silent);
  ok(st2.anim === 'riseIn' || st2.anim === 'none', 'stat-card 动画状态受控', st2.anim);
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'v17-admin-tasks.png'), Buffer.from(s.data, 'base64'));
  console.log('[shot] v17-admin-tasks.png');
  console.log(failures ? 'FAILURES: ' + failures : 'ADMIN ALL PASS');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
