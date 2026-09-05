'use strict';
/* 十七·2 视频创作工作台重设计验证:加载 → DOM 结构断言 → 交互(行内标题/骰子/分段)→ 截图 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9377;
const SHOT_DIR = path.join(__dirname, 'shots-v17');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r172','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
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
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r), errors };
}
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
let failed = 0;
function check(name, cond) { console.log((cond ? '  ✓ ' : '  ✗ ') + name); if (!cond) failed++; }
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/e-5a6bbbf41d5c2bad'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3800);
  console.log('== 结构断言 ==');
  const st = JSON.parse(await ev(`JSON.stringify({
    isStudio: !!document.querySelector('.ws'),
    navMerged: !!document.querySelector('.ws-nav .ws-nav-tools'),
    oldToolbarGone: !document.querySelector('.ws-toolbar'),
    cards: document.querySelectorAll('.ws-card').length,
    cardGrid: document.querySelectorAll('.ws-card-grid').length,
    segGroups: document.querySelectorAll('.seg-group').length,
    titleInputs: document.querySelectorAll('.ws-shot-title').length,
    diceBtns: document.querySelectorAll('[data-shot-dice]').length,
    quickIcons: document.querySelectorAll('.ws-ref-quick button svg').length,
    genBtns: document.querySelectorAll('.ws-gen-btn').length,
    saveState: !!document.getElementById('wsSaveState'),
    footAdd: !!document.querySelector('.ws-add-shot')
  })`, page));
  check('进入分镜工作台', st.isStudio);
  check('工具栏并入顶栏(.ws-nav-tools)', st.navMerged);
  check('旧独立工具栏已移除', st.oldToolbarGone);
  check('分镜卡已渲染(' + st.cards + ')', st.cards >= 1);
  check('卡片双栏布局 .ws-card-grid', st.cardGrid === st.cards);
  check('分段控件组(比例/分辨率/帧率)×3', st.segGroups === st.cards * 3);
  check('行内标题输入框', st.titleInputs === st.cards);
  check('种子骰子按钮', st.diceBtns === st.cards);
  check('左侧分类快选带图标(6)', st.quickIcons === 6);
  check('生成按钮存在', st.genBtns === st.cards);
  check('自动保存状态条', st.saveState);
  check('底部追加分镜条', st.footAdd);
  console.log('== 交互断言 ==');
  const inter = JSON.parse(await ev(`(function(){
    const out = {};
    const title = document.querySelector('.ws-shot-title');
    title.value = '开场·药庐晨雾'; title.dispatchEvent(new Event('input', {bubbles:true}));
    out.titleSet = !!ProjectsView.studio.shots.find(s => s.title === '开场·药庐晨雾');
    const dice = document.querySelector('[data-shot-dice]'); dice.click();
    out.seedRandom = ProjectsView.studio.shots[0].seed > 0;
    const fpsRadio = document.querySelector('input[data-shot-fps][value="60"]'); fpsRadio.click(); fpsRadio.dispatchEvent(new Event('change', {bubbles:true}));
    out.fpsSet = ProjectsView.studio.shots[0].fps === 60;
    const ratioRadio = document.querySelector('input[data-shot-ratio][value="9:16"]'); ratioRadio.click(); ratioRadio.dispatchEvent(new Event('change', {bubbles:true}));
    out.ratioSet = ProjectsView.studio.shots[0].ratio === '9:16';
    /* 行内标题点击不应触发折叠 */
    title.click();
    out.titleClickNoCollapse = !document.querySelector('.ws-card').classList.contains('is-collapsed');
    /* 卡头其他区域点击应折叠,再展开恢复 */
    document.querySelector('.ws-card-head').click();
    out.headClickCollapses = document.querySelector('.ws-card').classList.contains('is-collapsed');
    document.querySelector('.ws-card-head').click();
    out.headClickRestores = !document.querySelector('.ws-card').classList.contains('is-collapsed');
    return JSON.stringify(out);
  })()`, page));
  check('行内标题写入状态', inter.titleSet);
  check('骰子随机种子', inter.seedRandom);
  check('分段切换帧率 60', inter.fpsSet);
  check('分段切换比例 9:16', inter.ratioSet);
  check('标题点击不折叠卡片', inter.titleClickNoCollapse);
  check('卡头点击折叠', inter.headClickCollapses);
  check('再次点击展开', inter.headClickRestores);
  await wait(1400);
  const savedTxt = await ev(`document.getElementById('wsSaveState').textContent`, page);
  check('工作记录自动保存(' + savedTxt.slice(0, 18) + '…)', /已保存|正在保存/.test(savedTxt));
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'studio-after.png'), Buffer.from(s.data, 'base64'));
  console.log('[shot] shots-v17/studio-after.png');
  check('无控制台错误(' + page.errors.length + ')', page.errors.length === 0);
  if (page.errors.length) console.log(page.errors.slice(0, 5).join('\n'));
  console.log(failed ? 'RESULT: FAIL ' + failed : 'RESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
