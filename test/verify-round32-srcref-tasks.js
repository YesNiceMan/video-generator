'use strict';
/* 三十二轮(源图引用口径 + 任务监控可用性)回归验证(无头 Chrome CDP):
   1) 分镜工作台:源图不在界面上常驻显示,指定方式就是文案里的 [资产名] 引用 ——
      链接成功后 shotSource() 必须解析到该资产,移除后回落左侧选中/首张;
      单击左侧参考图只切换源图(不弹全屏);一张图片参考都没有时给前置条件提示并禁用生成
   2) 后台 · 任务监控:状态 chips(带全量计数) + 搜索(ID/用户/模型/提示词) + 30 行分页;
      统计卡按全量计数(不再显示「最近 200 条里的数量」);轮询只重绘数据区,不打断搜索框输入
   测试用一次性项目跑完即删,不产生任务、不消耗积分;服务器复用 3088(未启动则自起) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT || 3088);
const CDP = 9362;
const BASE = 'http://localhost:' + PORT;
const SHOT_DIR = path.join(__dirname, 'shots-v32');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ROW_STEP = 30;

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

let serverProc = null;
async function ensureServer() {
  for (let i = 0; i < 10; i++) {
    try { await (await fetch(BASE + '/api/health')).json(); return; } catch (e) { await wait(300); }
  }
  serverProc = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')],
    { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { await (await fetch(BASE + '/api/health')).json(); return; } catch (e) { await wait(300); }
  }
  throw new Error('服务器启动失败(端口 ' + PORT + ')');
}

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
const J = o => 'JSON.stringify(' + o + ')';
let failed = 0;
const check = (n, c, detail) => { console.log((c ? '  OK ' : '  XX ') + n + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); if (!c) failed++; };
async function shot(page, name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'));
}

/* 关屏时 setInterval 会被节流,轮询类断言需要页面「可见」 */
const HOOK = `window.__errs=[];
Object.defineProperty(document,'hidden',{configurable:true,get:function(){return false}});
window.addEventListener('error',function(e){window.__errs.push('ERR:'+(e.message||e.error))});
window.addEventListener('unhandledrejection',function(e){window.__errs.push('REJ:'+((e.reason&&e.reason.message)||e.reason))});`;

async function openTab(cookie, hash) {
  const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl); await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Network.setCookie', { name: 'vf_sid', value: cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.navigate', { url: BASE + '/' + hash });
  await wait(2600);
  await page.send('Runtime.evaluate', { expression: HOOK });
  await wait(300);
  return page;
}

async function main() {
  await ensureServer();
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--user-data-dir=/tmp/vf-chrome-r32', '--remote-debugging-port=' + CDP, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
  for (let i = 0; i < 40; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch (e) { await wait(400); } }

  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
  if (!login.ok) throw new Error('admin 登录失败');
  const cookie = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const H = { 'Content-Type': 'application/json', Cookie: 'vf_sid=' + cookie };
  const api = async (method, url, body) => {
    const res = await fetch(BASE + '/api' + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(url + ' → ' + (data.error || res.status));
    return data;
  };

  /* 一次性项目 + 分集;参考资产直接复用素材库已有图片,不新生成 */
  const proj = (await api('POST', '/projects', { name: '三十二轮验证项目', description: '源图引用 + 任务监控回归' })).project;
  const ep = (await api('POST', '/projects/' + proj.id + '/episodes', { title: '第 1 集' })).episode;

  /* ================= 1. 分镜工作台 · 源图引用与缺图提示 ================= */
  console.log('== 1. 分镜工作台 · 源图引用与缺图提示 ==');
  const page = await openTab(cookie, '#/projects/' + proj.id + '/episode/' + ep.id);
  await wait(1200);
  const R = JSON.parse(await ev(`(function(){var V=ProjectsView,s=V.studio;
    var imgs=(s.assets||[]).filter(function(a){return a.type==='image'});
    s.refs=imgs.slice(0,3).map(function(a,i){return Object.assign({},a,{refType:i===0?'角色':'场景'})});
    s.selRef=null;s.shots.forEach(function(x){x.script=''});V.renderStudioBody();
    return JSON.stringify(s.refs.map(function(a){return a.name}))})()`, page));
  await wait(500);
  check('注入 ' + R.length + ' 张参考图片', R.length >= 2, R);
  const shell = JSON.parse(await ev(J(`{srcRow:document.querySelectorAll('.ws-srcbox,.ws-src').length,
    need:document.querySelectorAll('.ws-need-src').length,
    disabled:[...document.querySelectorAll('.ws-gen-btn')].map(b=>b.disabled)}`), page));
  check('源图不占常驻界面(无源图行、无缺图提示)', shell.srcRow === 0 && shell.need === 0, shell);
  check('有图片参考时生成按钮可用', shell.disabled.length > 0 && shell.disabled.every(d => d === false), shell.disabled);

  /* 指定源图的唯一入口就是文案里的 [资产名] —— 它必须真的决定提交时用的那张图 */
  const key = await ev('ProjectsView.studio.shots[ProjectsView.studio.shots.length-1].key', page);
  const srcOf = `(()=>{const s=ProjectsView.studio;const sh=s.shots[s.shots.length-1];const r=ProjectsView.shotSource(sh);
    return JSON.stringify(r?{name:r.asset.name,from:r.from}:null)})()`;
  await ev(`(function(){var nm=${JSON.stringify(R[1])}.replace(/\\.[a-zA-Z0-9]+$/,'');
    var ta=document.querySelector('[data-shot-script="${key}"]');
    ta.value='夜色中的['+nm+'] 缓缓推近';ta.dispatchEvent(new Event('input',{bubbles:true}))})()`, page);
  await wait(700);
  const c2 = JSON.parse(await ev(srcOf, page));
  check('文案 [资产名] 链接成功后即为该镜源图', c2 && c2.from === '占位链接' && c2.name === R[1], c2);
  await ev(`(function(){var ta=document.querySelector('[data-shot-script="${key}"]');
    ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}))})()`, page);
  await wait(700);
  const c3 = JSON.parse(await ev(srcOf, page));
  check('移除引用后回落到左侧选中/首张', c3 && c3.name === R[0], c3);
  await ev("document.querySelector('[data-ref-sel]').click()", page);
  await wait(700);
  const c4 = JSON.parse(await ev(srcOf, page));
  check('单击左侧参考图切换源图(不弹全屏)', c4 && c4.from === '已选中' && (await ev('!!document.querySelector(".viewer-mask")', page)) === false, c4);
  await shot(page, '02-studio-ref.png');

  await ev("(function(){var V=ProjectsView;V.studio.refs=[];V.studio.selRef=null;V.renderStudioBody()})()", page);
  await wait(700);
  const noSrc = JSON.parse(await ev(J(`{need:document.querySelectorAll('.ws-need-src').length,
    disabled:[...document.querySelectorAll('.ws-gen-btn')].map(b=>b.disabled),
    btns:[...document.querySelectorAll('.ws-need-src .btn')].map(b=>b.textContent.trim())}`), page));
  check('无图片参考 → 前置条件提示 + 生成按钮禁用', noSrc.need > 0 && noSrc.disabled.every(d => d === true), noSrc);
  check('提示内含「引入参考图 / 按本镜文案生图」', noSrc.btns.length === 2 && noSrc.btns[0].indexOf('引入参考图') >= 0, noSrc.btns);
  await shot(page, '03-need-src.png');
  check('工作台无 JS 异常', (await ev('JSON.stringify(window.__errs.splice(0))', page)) === '[]');
  page.ws.close();

  /* ================= 2. 后台 · 任务监控 ================= */
  console.log('== 2. 后台 · 任务监控筛选 / 分页 / 轮询 ==');
  const apiAll = await api('GET', '/admin/tasks?status=all');
  const canPage = apiAll.items.length > ROW_STEP;
  const p2 = await openTab(cookie, '#/admin');
  await ev('document.querySelector(\'[data-tab="tasks"]\').click()', p2);
  await wait(1500);
  const t1 = JSON.parse(await ev(J(`{chips:[...document.querySelectorAll('[data-tk-status]')].map(c=>c.textContent.trim()),
    rows:document.querySelectorAll('#tkData tbody tr').length,more:!!document.querySelector('#tkMore'),
    meta:(document.querySelector('#tkMeta')||{}).textContent}`), p2));
  check('状态 chips 齐全(全部/排队/执行/完成/失败/取消)', t1.chips.length === 6 && t1.chips[0].indexOf('全部') === 0, t1.chips);
  check('默认只渲染前 ' + ROW_STEP + ' 行(接口共 ' + apiAll.items.length + ' 条)',
    t1.rows === Math.min(ROW_STEP, apiAll.items.length), { rows: t1.rows });
  check(t1.more ? '「显示更多」按钮出现' : '数据不足一行,无需「显示更多」', t1.more === canPage, { more: t1.more });
  await shot(p2, '04-tasks-default.png');

  const apiCounts = apiAll.counts;
  const stats = JSON.parse(await ev(J(`[...document.querySelectorAll('#tkData .stat-card')].map(c=>c.querySelector('.stat-value').textContent+'|'+c.querySelector('.stat-label').textContent)`), p2));
  const done = Number((stats.find(s => s.indexOf('已完成') >= 0) || '|').split('|')[0]);
  check('统计卡按全量计数(已完成 ' + done + ' = 接口 ' + apiCounts.completed + '，而非最近 200 条里的数量)', done === apiCounts.completed, stats);
  const chipN = JSON.parse(await ev(J(`[...document.querySelectorAll('[data-cn]')].map(c=>c.dataset.cn+':'+(c.textContent||'-'))`), p2));
  check('chips 计数来自同一份全量统计', chipN.length === 6 && Number(String(chipN[3].split(':')[1] || 0)) === apiCounts.completed, chipN);

  if (canPage) {
    await ev('document.querySelector(\'#tkMore\').click()', p2);
    await wait(900);
    const t2 = JSON.parse(await ev(J(`{rows:document.querySelectorAll('#tkData tbody tr').length,more:(document.querySelector('#tkMore')||{}).textContent}`), p2));
    check('点「显示更多」追加 ' + ROW_STEP + ' 行', t2.rows === Math.min(ROW_STEP * 2, apiAll.items.length), t2);
    await ev(`document.querySelector('[data-tk-status="${(apiCounts.failed ? 'failed' : 'completed')}"]').click()`, p2);
    await wait(900);
    const t3 = JSON.parse(await ev(J(`{rows:document.querySelectorAll('#tkData tbody tr').length,states:[...new Set([...document.querySelectorAll('#tkData tbody tr .status')].map(b=>b.textContent.trim()))],on:(document.querySelector('.cat-chip.on')||{}).textContent}`), p2));
    check('状态筛选后表格只剩该状态', t3.rows > 0 && t3.states.length === 1, t3);
    await ev('document.querySelector(\'[data-tk-status="all"]\').click()', p2);
    await wait(900);
  } else {
    console.log('  -- 接口数据不足 ' + ROW_STEP + ' 条，跳过分页与筛选步骤');
  }

  /* 关键词取真实存在的一条提示词/任务 ID,避免依赖种子数据内容 */
  const sample = (apiAll.items.map(t => String(t.prompt || '')).find(p => p.length > 4) || '').slice(0, 2)
    || String((apiAll.items[0] || {}).id || 'zzz').slice(0, 8);
  await ev(`(()=>{const i=document.querySelector('#tkSearch');i.focus();i.value=${JSON.stringify(sample)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`, p2);
  await wait(3900);
  const t4 = JSON.parse(await ev(J(`{rows:document.querySelectorAll('#tkData tbody tr').length,
    active:(document.activeElement||{}).id,val:(document.querySelector('#tkSearch')||{}).value,
    meta:(document.querySelector('#tkMeta')||{}).textContent}`), p2));
  check('搜索命中「' + sample + '」并走后端过滤', t4.rows >= 1 && t4.rows <= ROW_STEP && String(t4.meta).indexOf('共') === 0, t4);
  check('3s 轮询后搜索框焦点与输入未被重绘打断', t4.active === 'tkSearch' && t4.val === sample, { active: t4.active, val: t4.val });
  await shot(p2, '05-tasks-search.png');

  await ev(`(()=>{const i=document.querySelector('#tkSearch');i.value='zzz不存在';i.dispatchEvent(new Event('input',{bubbles:true}))})()`, p2);
  await wait(1100);
  const t5 = JSON.parse(await ev(J(`{empty:(document.querySelector('.td-empty')||{}).textContent}`), p2));
  check('空结果显示说明文案而不是空白表格', String(t5.empty || '').indexOf('zzz不存在') >= 0, t5);
  await ev(`(()=>{const i=document.querySelector('#tkSearch');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()`, p2);
  await wait(1100);
  check('清空搜索后恢复列表', (await ev('document.querySelectorAll("#tkData tbody tr").length', p2)) === Math.min(ROW_STEP, apiAll.items.length));
  await ev('document.querySelector(\'[data-tab="models"]\').click()', p2);
  await wait(600);
  check('切走标签后停止轮询', (await ev('!!AdminView.state.pollTimer', p2)) === false);
  check('任务监控无 JS 异常', (await ev('JSON.stringify(window.__errs.splice(0))', p2)) === '[]');
  p2.ws.close();

  await api('DELETE', '/projects/' + proj.id);
  console.log('\n临时项目已删除');
  console.log(failed ? 'VERIFY FAILED (' + failed + ' 项)' : 'ALL PASS ✅  (round32 源图引用 + 任务监控)');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('VERIFY_ERROR', e.message); process.exit(1); });
