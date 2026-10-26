'use strict';
/* 第三十轮 · 全站截图盘点:抓取全部页面(深/浅两套)供 UI 审阅 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DBGPORT = 9799;
const OUT = path.join(__dirname, 'shots-r30-audit');
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl); let msgId = 0; const pending = new Map();
  ws.onmessage = e => { const msg = JSON.parse(e.data); if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  return { send, ready: new Promise(r => ws.onopen = r) };
}
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
async function shot(page, name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, 'base64'));
  console.log('  📷', name);
}
(async () => {
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const chrome = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=/tmp/vf-audit30', '--remote-debugging-port=' + DBGPORT, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => chrome.kill('SIGKILL'));
  await wait(1500);
  let tab = null;
  for (let i = 0; i < 30; i++) { try { tab = await (await fetch('http://127.0.0.1:' + DBGPORT + '/json/new?about:blank', { method: 'PUT' })).json(); break; } catch (e) { await wait(500); } }
  const page = cdpConnect(tab.webSocketDebuggerUrl); await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await wait(600);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  /* 先加载应用一次(about:blank 上改 hash 不会进入应用),并强刷缓存拿最新静态资源 */
  await ev('location.href = "http://localhost:3088/#/"', page);
  await wait(2200);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(2600);

  /* 项目/分集上下文(供工作台截图) */
  const projs = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + token } })).json();
  let target = null;
  for (const p of (projs.items || [])) {
    const d = await (await fetch('http://localhost:3088/api/projects/' + p.id, { headers: { cookie: 'vf_sid=' + token } })).json();
    const eps = (d.project && d.project.episodes) || [];
    if (eps.length) { target = { pid: p.id, eid: eps[0].id, pname: p.name }; break; }
  }
  console.log('target project:', target && target.pname);

  const PAGES = [
    ['auth', '#/login', 1400],
    ['dashboard', '#/', 2600],
    ['projects', '#/projects', 2000],
    ['project-detail', target ? '#/projects/' + target.pid : '#/projects', 2200],
    ['studio', target ? '#/projects/' + target.pid + '/episode/' + target.eid : '#/projects', 3200],
    ['assets', '#/assets', 2400],
    ['styles', '#/styles', 2000],
    ['images', '#/images', 2400],
  ];
  for (const scheme of ['dark', 'light']) {
    for (const [name, hash, waitMs] of PAGES) {
      await ev('location.href = "http://localhost:3088' + (name === 'auth' ? '/#/login' : hash) + '"', page).catch(() => {});
      await wait(waitMs);
      await ev('document.documentElement.dataset.scheme = ' + JSON.stringify(scheme), page).catch(() => {});
      await wait(500);
      await shot(page, scheme + '-' + name + '.png');
    }
  }
  /* 后台管理(管理员登录) */
  const al = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
  const atoken = al.headers.get('set-cookie').split(';')[0].split('=')[1];
  await page.send('Network.setCookie', { name: 'vf_sid', value: atoken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await ev('location.href = "http://localhost:3088/#/admin"', page);
  await wait(1500);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(2600);
  for (const scheme of ['dark']) {
    for (const [name, hash, waitMs] of [['admin-models', '#/admin', 2600], ['admin-tasks', '#/admin', 1500], ['admin-settings', '#/admin', 1500]]) {
      await ev('location.href = "http://localhost:3088' + hash + '"', page).catch(() => {});
      await wait(waitMs);
      if (name !== 'admin-models') {
        const t = name === 'admin-tasks' ? 'tasks' : 'settings';
        await ev("(function(){ var b = document.querySelector('.tab[data-tab=\"" + t + "\"]'); if (b) b.click(); })()", page);
        await wait(1400);
      }
      await shot(page, scheme + '-' + name + '.png');
    }
  }
  console.log('done →', OUT);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
