'use strict';
/* 十七·2 终检(适配删除确认弹窗 + 生成记录分区):cost-hint / 增删分镜 / 折叠摘要 / 左栏折叠 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9381;
const SHOT_DIR = path.join(__dirname, 'shots-v17');
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r178','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  const errors = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(String(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r), errors };
}
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
let failed = 0;
const check = (n, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + n); if (!c) failed++; };
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/e-5a6bbbf41d5c2bad'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3800);
  console.log('== 终检 ==');
  const o = JSON.parse(await ev(`JSON.stringify({
    costHint: (document.querySelector('[data-shot-cost]') || {}).textContent || '',
    costCls: document.querySelector('[data-shot-cost]') ? document.querySelector('[data-shot-cost]').className : '',
    cards0: document.querySelectorAll('.ws-card').length
  })`, page));
  check('积分提示渲染: ' + o.costHint.trim().slice(0, 14) + ' [' + o.costCls + ']', o.costHint.length > 2);
  check('初始分镜数 ' + o.cards0, o.cards0 >= 1);
  /* 追加分镜 */
  await ev(`document.querySelector('.ws-main-bar [data-ws-action=addshot]').click()`, page);
  await wait(700);
  const cards2 = await ev(`document.querySelectorAll('.ws-card').length`, page);
  check('追加分镜 → ' + cards2 + ' 张卡', cards2 === o.cards0 + 1);
  check('新卡有标题输入框', await ev(`!!document.querySelectorAll('.ws-shot-title')[1]`, page));
  /* 删除:确认弹窗(取消 → 保留;确认 → 删除) */
  await ev(`(function(){ const b = document.querySelectorAll('[data-shot-del]'); b[b.length-1].click(); })()`, page);
  await wait(500);
  check('删除弹出确认弹窗', await ev(`!!document.querySelector('.modal .btn-danger')`, page));
  await ev(`(function(){ const c = document.querySelector('.modal .btn'); if (c) c.click(); })()`, page);
  await wait(500);
  check('取消后分镜保留', (await ev(`document.querySelectorAll('.ws-card').length`, page)) === o.cards0 + 1);
  await ev(`(function(){ const b = document.querySelectorAll('[data-shot-del]'); b[b.length-1].click(); })()`, page);
  await wait(500);
  await ev(`(function(){ const b = document.querySelector('.modal .btn-danger'); if (b) b.click(); })()`, page);
  await wait(600);
  check('确认后删除恢复 → ' + (await ev(`document.querySelectorAll('.ws-card').length`, page)) + ' 张卡',
    (await ev(`document.querySelectorAll('.ws-card').length`, page)) === o.cards0);
  /* 折叠摘要 / 全部折叠展开 */
  const oc = JSON.parse(await ev(`JSON.stringify({
    collapseAll: (function(){ document.querySelector('[data-ws-action=collapseall]').click(); return document.querySelectorAll('.ws-card.is-collapsed').length; })(),
    summaryShown: !!document.querySelector('.ws-card-summary'),
    expandAll: (function(){ document.querySelector('[data-ws-action=expandall]').click(); return document.querySelectorAll('.ws-card.is-collapsed').length; })(),
    foldLeft: (function(){ document.querySelector('[data-ws-action=toggleleft]').click(); return document.querySelector('.ws-left').classList.contains('folded'); })(),
    unfoldLeft: (function(){ document.querySelector('[data-ws-action=toggleleft]').click(); return !document.querySelector('.ws-left').classList.contains('folded'); })()
  })`, page));
  check('全部折叠生效', oc.collapseAll === o.cards0 && oc.summaryShown);
  check('全部展开恢复', oc.expandAll === 0);
  check('左栏折叠/展开', oc.foldLeft && oc.unfoldLeft);
  const shots = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'studio-final.png'), Buffer.from(shots.data, 'base64'));
  check('无控制台错误(' + page.errors.length + ')', page.errors.length === 0);
  console.log(failed ? 'RESULT: FAIL ' + failed : 'RESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
