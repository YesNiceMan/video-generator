'use strict';
/* 十七·3 验证:参数栏移至提示词左侧 / 时长下拉 / 删除确认弹窗 / 生成记录分区折叠(单镜 + 全局) */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9383;
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r179','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
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
const check = (n, c) => { console.log((c ? '  OK ' : '  XX ') + n); if (!c) failed++; };
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
  console.log('== A. 参数栏在提示词左侧 ==');
  const geo = JSON.parse(await ev("JSON.stringify((function(){ var grid=document.querySelector('.ws-card-grid'); var p=grid.querySelector('.ws-shot-params').getBoundingClientRect(); var ed=grid.querySelector('.ws-shot-editor').getBoundingClientRect(); var ta=grid.querySelector('.ws-script').getBoundingClientRect(); return {paramsLeft:Math.round(p.left), taLeft:Math.round(ta.left), cols:getComputedStyle(grid).gridTemplateColumns, taInsideEditor: ta.left>=ed.left && ta.right<=ed.right+1}; })())", page));
  check('参数栏在提示词左边(' + geo.paramsLeft + ' < 文案 ' + geo.taLeft + ')', geo.paramsLeft < geo.taLeft);
  check('双栏列宽 ' + geo.cols, /300px/.test(geo.cols));
  check('文案区完整位于右侧', geo.taInsideEditor);

  console.log('== B. 时长下拉 ==');
  const dur = JSON.parse(await ev("JSON.stringify({ sel: !!document.querySelector('select[data-shot-duration]'), options: document.querySelector('select[data-shot-duration]').options.length, selects: document.querySelectorAll('select[data-shot-duration]').length, slider: !!document.querySelector('input[type=range][data-shot-duration]'), hasDefaultMark: document.querySelector('select[data-shot-duration]').textContent.indexOf('默认') >= 0 })", page));
  check('时长为下拉(每卡 13 档,共 ' + dur.selects + ' 卡)', dur.sel && dur.options === 13 && !dur.slider);
  check('含「默认」标识', dur.hasDefaultMark);
  await ev("(function(){ var sel = document.querySelector('select[data-shot-duration]'); sel.value = '7'; sel.dispatchEvent(new Event('change', {bubbles:true})); })()", page);
  check('选择 7s 写入状态', (await ev('ProjectsView.studio.shots[0].duration === 7', page)) === true);
  check('积分提示随时长刷新', (await ev("(document.querySelector('[data-shot-cost]').textContent || '').length > 2", page)) === true);

  console.log('== C. 删除分镜确认弹窗 ==');
  await ev("document.querySelector('.ws-main-bar [data-ws-action=addshot]').click()", page);
  await wait(700);
  const before = await ev("document.querySelectorAll('.ws-card').length", page);
  await ev("(function(){ var b = document.querySelectorAll('[data-shot-del]'); b[b.length-1].click(); })()", page);
  await wait(500);
  check('点击删除弹出确认弹窗', (await ev("!!document.querySelector('.modal .btn-danger')", page)) === true);
  await ev("(function(){ var c = document.querySelector('.modal .btn'); if (c) c.click(); })()", page);
  await wait(500);
  check('取消后分镜保留', (await ev("document.querySelectorAll('.ws-card').length", page)) === before);
  await ev("(function(){ var b = document.querySelectorAll('[data-shot-del]'); b[b.length-1].click(); })()", page);
  await wait(500);
  await ev("(function(){ var b = document.querySelector('.modal .btn-danger'); if (b) b.click(); })()", page);
  await wait(600);
  check('确认后分镜删除', (await ev("document.querySelectorAll('.ws-card').length", page)) === before - 1);

  console.log('== D. 生成记录分区折叠 ==');
  await ev("(function(){ var sh = ProjectsView.studio.shots[0]; sh.taskIds = []; sh.tasks = [ { id: 'fake-a', status: 'completed', prompt: '测试记录 A', model_id: '', created_at: new Date().toISOString(), params: { duration: 10 } }, { id: 'fake-b', status: 'processing', progress: 40, prompt: '测试记录 B', model_id: '', created_at: new Date().toISOString(), params: { duration: 10 } } ]; ProjectsView.renderStudioBody(); })()", page);
  await wait(400);
  const sec0 = JSON.parse(await ev("JSON.stringify({ head: !!document.querySelector('.ws-recs-head'), count: (document.querySelector('.ws-recs-head b') || {}).textContent, runTag: !!document.querySelector('.ws-recs-run'), bodyVisible: !document.querySelector('.ws-recs-body').hidden, recs: document.querySelectorAll('.ws-rec').length })", page));
  check('分区头渲染(计数 ' + sec0.count + ',记录 ' + sec0.recs + ' 条)', sec0.head && sec0.count === '2' && sec0.recs === 2);
  check('默认展开且含进行中标记', sec0.bodyVisible && sec0.runTag);
  await ev("document.querySelector('[data-recs-toggle]').click()", page);
  await wait(400);
  check('单镜分区收起(hidden)', (await ev("document.querySelector('.ws-recs-body').hidden", page)) === true);
  check('分区头呈折叠态', (await ev("document.querySelector('.ws-recs-head').classList.contains('is-collapsed')", page)) === true);
  await ev("document.querySelector('[data-ws-action=reccollapse]').click()", page);
  await wait(400);
  const allHidden = await ev("Array.prototype.every.call(document.querySelectorAll('.ws-recs-body'), function(b){ return b.hidden; })", page);
  check('全局「折叠记录」后全部分区收起', allHidden === true);
  check('全局标志持久化到载荷', (await ev("ProjectsView.studioPayload().recsCollapsed === true && ProjectsView.studio.shots.every(function(s){ return s.recsCollapsed; })", page)) === true);
  await ev("document.querySelector('[data-recs-toggle]').click()", page);
  await wait(400);
  check('全局折叠下单镜可独立展开', (await ev("(function(){ var b = document.querySelectorAll('.ws-recs-body'); return b.length >= 1 && !b[0].hidden && (ProjectsView.studio.shots.length < 2 || ProjectsView.studio.shots[1].recsCollapsed === true); })()", page)) === true);
  await ev("document.querySelector('[data-ws-action=reccollapse]').click()", page);
  await wait(400);
  check('全局「展开记录」后全部分区可见', (await ev("Array.prototype.every.call(document.querySelectorAll('.ws-recs-body'), function(b){ return !b.hidden; })", page)) === true);
  await ev("(function(){ ProjectsView.studio.recsCollapsed = false; ProjectsView.studio.shots.forEach(function(s){ s.recsCollapsed = false; s.tasks = []; s.taskIds = []; }); ProjectsView.renderStudioBody(); })()", page);
  check('无控制台错误(' + page.errors.length + ')', page.errors.length === 0);
  console.log(failed ? 'RESULT: FAIL ' + failed : 'RESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
