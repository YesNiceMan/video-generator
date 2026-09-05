'use strict';
/* 十八轮复验:双模式全页面审计 + 工作台变量浅色覆盖 + 常见帧率下拉
   —— 每次全新 Chrome profile,排除 localStorage 残留干扰 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9361;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PROFILE = '/tmp/vf-chrome-profile-r18b-' + Date.now();

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=' + PROFILE,
  '--remote-debugging-port=' + PORT, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });

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
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome debug port not ready');

  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];

  // 找一个有分集的项目
  const projs = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + demoToken } })).json();
  let target = null;
  for (const p of (projs.items || [])) {
    const d = await (await fetch('http://localhost:3088/api/projects/' + p.id, { headers: { cookie: 'vf_sid=' + demoToken } })).json();
    const eps = (d.project && d.project.episodes) || d.episodes || [];
    if (eps.length) { target = { pid: p.id, eid: eps[0].id }; break; }
  }
  console.log('[target]', target ? ('#/projects/' + target.pid + '/episode/' + target.eid) : 'none(将只测其他页面)');

  async function shot(name, hash, opts = {}) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await wait(1200);
    if (!opts.noCookie) {
      await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    }
    if (opts.scheme) {
      await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + opts.scheme + '")}catch(e){}', returnByValue: true });
    }
    await page.send('Page.reload', { ignoreCache: true });
    await wait(4200);
    const evalRes = await page.send('Runtime.evaluate', {
      expression: 'JSON.stringify(' + (opts.checks || '({})') + ')',
      returnByValue: true
    });
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shotFile.data, 'base64'));
    console.log('[' + name + '] ' + evalRes.result.value);
    page.ws.close();
  }

  const pageAudit = '(() => {' +
    'const cs = getComputedStyle(document.body);' +
    'const gold = getComputedStyle(document.querySelector(".ws") || document.documentElement).getPropertyValue("--ws-gold").trim();' +
    'const grad = getComputedStyle(document.documentElement).getPropertyValue("--grad").trim().slice(0, 80);' +
    'const btn = document.querySelector(".btn-primary, .dh-actions .btn");' +
    'const gen = document.querySelector(".ws-gen-btn");' +
    'const sel = [...document.querySelectorAll("select[data-shot-fps]")][0];' +
    'return {' +
    '  scheme: document.documentElement.dataset.scheme,' +
    '  bodyBg: cs.backgroundColor,' +
    '  wsGold: gold || "(无.ws作用域)",' +
    '  grad: grad,' +
    '  btnGrad: btn ? getComputedStyle(btn).backgroundImage.slice(0, 80) : null,' +
    '  btnColor: btn ? getComputedStyle(btn).color : null,' +
    '  genBtnGrad: gen ? getComputedStyle(gen).backgroundImage.slice(0, 80) : null,' +
    '  fps: sel ? { n: sel.options.length, vals: [...sel.options].map(o => o.value), cur: sel.value } : null' +
    '};})()';

  for (const scheme of ['dark', 'light']) {
    await shot('r18b-dash-' + scheme, '#/', { scheme, checks: pageAudit });
  }
  if (target) {
    for (const scheme of ['dark', 'light']) {
      await shot('r18b-studio-' + scheme, '#/projects/' + target.pid + '/episode/' + target.eid, { scheme, checks: pageAudit });
    }
  }
  // 登录页(无 cookie):双模式
  for (const scheme of ['dark', 'light']) {
    await shot('r18b-login-' + scheme, '#/login', { scheme, noCookie: true, checks: '(() => ({ scheme: document.documentElement.dataset.scheme, authCard: (n => n ? getComputedStyle(n).backgroundColor : null)(document.querySelector(".auth-card")) })()'});
  }
  console.log('DONE');
}

main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
