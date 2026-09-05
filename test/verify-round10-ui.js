'use strict';
/* 第十轮优化验证:工作日志 / 项目编辑删除 / 生成记录删除 */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
const wait = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-verify', '--remote-debugging-port=' + PORT,
  '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });

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

async function loginToken(email, password) {
  const res = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');
  const token = await loginToken('demo@videoforge.cn', 'demo123');
  const results = [];

  async function openPage(hash, waitMs) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await wait(1200);
    await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(waitMs || 3200);
    return page;
  }

  const ev = (page, expr) => page.send('Runtime.evaluate', { expression: expr, returnByValue: true });

  // 1) 项目列表:检查编辑/删除按钮
  const p1 = await openPage('#/projects');
  const r1 = await ev(p1, `JSON.stringify({
    cardCount: document.querySelectorAll('[data-proj-link]').length,
    editBtns: document.querySelectorAll('[data-proj-edit]').length,
    delBtns: document.querySelectorAll('[data-proj-del]').length,
    firstEdit: !!document.querySelector('[data-proj-edit]'),
    firstDel: !!document.querySelector('[data-proj-del]')
  })`);
  results.push(['项目列表-编辑删除按钮', r1.result.value]);

  // 2) 视频创作页:检查工作日志按钮 + 生成记录删除按钮
  const p2 = await openPage('#/projects/p-3c7b68936ffd2ffd/episode/e-d0be67a6b45e1551');
  const r2 = await ev(p2, `JSON.stringify({
    hasStudio: !!document.querySelector('#wsRoot'),
    hasLogBtn: !!document.querySelector('[data-ws-action="log"]'),
    logBtnText: (document.querySelector('[data-ws-action="log"]')||{}).innerText || '',
    recDeleteBtns: document.querySelectorAll('[data-task-del]').length,
    recCards: document.querySelectorAll('.ws-rec').length
  })`);
  results.push(['视频创作页-工作日志/删除按钮', r2.result.value]);

  // 3) 点击工作日志按钮 → 检查弹窗内容
  await ev(p2, `document.querySelector('[data-ws-action="log"]').click()`);
  await wait(1500);
  const r3 = await ev(p2, `JSON.stringify({
    modalOpen: !!document.querySelector('.modal'),
    modalTitle: (document.querySelector('.modal-title')||{}).innerText || '',
    logItems: document.querySelectorAll('.ws-log-item').length,
    logStates: [...document.querySelectorAll('.ws-log-state')].map(x => x.innerText),
    logPrompts: [...document.querySelectorAll('#wsLogList .ws-review-title')].slice(0,3).map(x => x.innerText),
    filters: [...document.querySelectorAll('[data-log-filter]')].map(x => x.innerText.trim())
  })`);
  results.push(['工作日志弹窗', r3.result.value]);

  // 4) 点击"异常"筛选 → 只显示异常
  await ev(p2, `document.querySelector('[data-log-filter="abnormal"]').click()`);
  await wait(600);
  const r4 = await ev(p2, `JSON.stringify({
    afterAbnormal: [...document.querySelectorAll('.ws-log-state')].map(x => x.innerText),
    abnormalCount: document.querySelectorAll('.ws-log-item.is-abnormal').length
  })`);
  results.push(['工作日志-异常筛选', r4.result.value]);

  for (const [name, val] of results) console.log('== ' + name + ' ==\n' + val);
  process.exit(0);
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });