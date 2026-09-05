'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9347;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r18',
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
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome debug port not ready');

  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];

  async function shot(name, hash, opts = {}) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await wait(1500);
    await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    if (opts.scheme) {
      await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + opts.scheme + '")}catch(e){}; document.documentElement.dataset.scheme="' + opts.scheme + '"', returnByValue: true });
    }
    await page.send('Page.reload', { ignoreCache: true });
    await wait(3800);
    if (opts.clickScheme) {
      await page.send('Runtime.evaluate', { expression: 'document.getElementById("schemeBtn").click()', returnByValue: true });
      await wait(600);
    }
    const evalRes = await page.send('Runtime.evaluate', {
      expression: 'JSON.stringify(' + (opts.checks || '({})') + ')',
      returnByValue: true
    });
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shotFile.data, 'base64'));
    console.log('[' + name + '] ' + evalRes.result.value);
    page.ws.close();
  }

  const schemeChecks = '(() => { const cs = getComputedStyle(document.body); return { scheme: document.documentElement.dataset.scheme, bodyBg: cs.backgroundColor, bodyColor: cs.color, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(), grad: getComputedStyle(document.documentElement).getPropertyValue("--grad").trim().slice(0, 90), schemeBtn: !!document.getElementById("schemeBtn") }; })()';

  // 1) 深色仪表盘(默认)
  await shot('r18-dashboard-dark', '#/', { checks: schemeChecks });
  // 2) 点击按钮 → 切到浅色
  await shot('r18-dashboard-light-toggle', '#/', { clickScheme: true, checks: schemeChecks });
  // 3) 直接以浅色启动(持久化验证)
  await shot('r18-dashboard-light', '#/', { scheme: 'light', checks: schemeChecks });
  // 4) 浅色登录页(登出状态看不到,直接对 #/login 注入;登录页由 auth 渲染,需要无 cookie——改为直接查 authRoot 不现实,跳过,用工作台代替)
  // 5) 浅色项目工作台(帧率下拉)
  const projects = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + demoToken } })).json();
  const pid = (projects.items && projects.items[0] && projects.items[0].id) || '';
  let eps = [];
  if (pid) {
    const detail = await (await fetch('http://localhost:3088/api/projects/' + pid, { headers: { cookie: 'vf_sid=' + demoToken } })).json();
    eps = (detail.episodes && detail.episodes.map(e => e.id)) || [];
  }
  if (pid && eps.length) {
    const fpsChecks = '(() => { const sel = [...document.querySelectorAll("select[data-shot-fps]")][0]; return { scheme: document.documentElement.dataset.scheme, fpsOptions: sel ? [...sel.options].map(o => o.value + "|" + o.text) : null, val: sel ? sel.value : null }; })()';
    await shot('r18-studio-light', '#/projects/' + pid + '/episode/' + eps[0], { scheme: 'light', checks: fpsChecks });
    await shot('r18-studio-dark', '#/projects/' + pid + '/episode/' + eps[0], { scheme: 'dark', checks: fpsChecks });
  } else {
    console.log('[studio] skipped - no project/episode');
  }
  console.log('DONE');
}

main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
