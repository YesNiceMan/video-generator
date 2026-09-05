'use strict';
/* 优化验证:
   1) 在 #/login 登录成功后必须跳转到仪表盘(原 bug 场景)
   2) 已登录访问 #/login 自动回到仪表盘
   3) Lucide 图标全部完成 SVG 渲染
   4) 关键页面截图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-opt',
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

async function newPage(url) {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  return page;
}

async function evalJson(page, expr) {
  const res = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (res.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(res.exceptionDetails.exception));
  return JSON.parse(res.result.value);
}

async function shot(page, name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
}

let failed = 0;
function check(label, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; }
    catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  /* ===== 场景 1:登录页图标与表单渲染 ===== */
  const p1 = await newPage('http://localhost:3088/#/login');
  await wait(2500);
  const s1 = await evalJson(p1, `JSON.stringify({
    authVisible: !document.getElementById('authRoot').classList.contains('hidden'),
    appHidden: document.getElementById('app').classList.contains('hidden'),
    svgIcons: document.querySelectorAll('svg.lucide').length,
    pendingIcons: document.querySelectorAll('i[data-lucide]').length,
    hasLoginBtn: !!document.getElementById('afSubmit')
  })`);
  check('登录页显示且应用壳隐藏', s1.authVisible && s1.appHidden);
  check('Lucide 图标已渲染为 SVG 且无残留占位', s1.svgIcons > 0 && s1.pendingIcons === 0, `svg=${s1.svgIcons}, 待转换=${s1.pendingIcons}`);
  check('登录按钮存在', s1.hasLoginBtn);
  await shot(p1, 'opt-login');

  /* ===== 场景 2:核心 bug — 在 #/login 提交登录后必须跳转 ===== */
  await p1.send('Runtime.evaluate', { expression: `
    document.getElementById('afEmail').value = 'demo@videoforge.cn';
    document.getElementById('afPass').value = 'demo123';
    document.getElementById('afSubmit').click();
  `});
  await wait(3000);
  const s2 = await evalJson(p1, `JSON.stringify({
    appVisible: !document.getElementById('app').classList.contains('hidden'),
    authHidden: document.getElementById('authRoot').classList.contains('hidden'),
    hash: location.hash || '(空)',
    user: App.user ? App.user.email : 'null',
    viewText: (document.getElementById('view').innerText || '').slice(0, 40),
    dashCards: document.querySelectorAll('.stat-card').length
  })`);
  check('登录成功后应用壳可见', s2.appVisible && s2.authHidden);
  check('URL 不再停留在 #/login', !/login|register/.test(s2.hash), `hash=${s2.hash}`);
  check('进入仪表盘并渲染统计卡', s2.dashCards > 0, `stat-cards=${s2.dashCards}`);
  await shot(p1, 'opt-after-login');
  p1.ws.close();

  /* ===== 场景 3:已登录状态访问 #/login 应自动回仪表盘 ===== */
  const p2 = await newPage('http://localhost:3088/#/login');
  await wait(2600);
  const s3 = await evalJson(p2, `JSON.stringify({
    appVisible: !document.getElementById('app').classList.contains('hidden'),
    hash: location.hash || '(空)',
    dashCards: document.querySelectorAll('.stat-card').length
  })`);
  check('已登录访问 #/login 自动跳转仪表盘', s3.appVisible && !/login/.test(s3.hash) && s3.dashCards > 0, `hash=${s3.hash}`);
  await p2.ws.close();

  /* ===== 场景 4:各页面图标渲染 + 截图 ===== */
  const demoToken = (await (await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  })).headers.get('set-cookie')).split(';')[0].split('=')[1];

  for (const [name, hash] of [['opt-dashboard', '#/'], ['opt-projects', '#/projects'], ['opt-redirect-create', '#/create'], ['opt-assets', '#/assets'], ['opt-styles', '#/styles']]) {
    const p = await newPage('http://localhost:3088/');
    await p.send('Network.enable');
    try { await p.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }); } catch (e) {}
    await p.send('Runtime.evaluate', { expression: `location.hash = '${hash}'` });
    await wait(2400);
    const st = await evalJson(p, `JSON.stringify({
      svg: document.querySelectorAll('svg.lucide').length,
      pending: document.querySelectorAll('i[data-lucide]').length,
      viewEmpty: document.getElementById('view').children.length === 0
    })`);
    check(`${name} 视图渲染且图标完整`, !st.viewEmpty && st.pending === 0, `svg=${st.svg}, 待转换=${st.pending}`);
    await shot(p, name);
    p.ws.close();
  }

  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过 ✓');
}

main().then(() => process.exit(failed ? 1 : 0)).catch(e => {
  console.error('验证失败:', e.message);
  process.exit(1);
});
