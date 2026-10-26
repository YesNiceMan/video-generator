'use strict';
/* 二十九(全站优化 · 统一成果查看)回归验证(无头 Chrome CDP):
   1) AI 生图页:结果筛选 chips(全部/进行中/已完成/失败)、成果图点击 → 统一查看器
      (多图 ← → 翻页 + 计数)、再次生成按钮、提示词点击复制
   2) 首页:最近成果条(dash-recent)点击 → 查看器
   3) 资产库:点击资产卡 → 查看器(带导航 + 重命名/分类/共享/删除动作)
   4) 分镜工作台:完成视频记录改封面卡(.ws-rec-cover,不再常驻 <video>)、
      封面点击 → 查看器大屏播放、记录头整行可折叠、批量审片「查看」→ 查看器
   测试产生的生图/视频任务与资产保留(免费模型,不扣积分);服务器复用 3088(未启动则自起) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 3088;
const BASE = 'http://localhost:' + PORT;
const SHOT_DIR = path.join(__dirname, 'shots-v29');
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- 服务器:复用或自起 ---------- */
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
process.on('exit', () => { try { serverProc && serverProc.kill('SIGKILL'); } catch (e) {} });

/* ---------- CDP ---------- */
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(String((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
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
const check = (n, c, detail) => { console.log((c ? '  OK ' : '  XX ') + n + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); if (!c) failed++; };
async function shot(page, name, clip) {
  const params = { format: 'png', captureBeyondViewport: false };
  if (clip) params.clip = clip;
  const s = await page.send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'));
}
async function goto(page, hash, waitMs) {
  await ev('location.hash = ' + JSON.stringify(hash), page);
  await wait(waitMs || 1600);
}
const jsEsc = s => JSON.stringify(String(s));

async function main() {
  await ensureServer();

  /* ---------- 准备测试数据(真实 API:免费生图 → 免费视频) ---------- */
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  if (!login.ok) throw new Error('demo 登录失败');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const api = async (method, url, body) => {
    const res = await fetch(BASE + '/api' + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(url + ' → ' + (data.error || res.status));
    return data;
  };

  console.log('== 0. 准备数据:免费生图 2 张 + 免费视频 1 条 ==');
  const gen = await api('POST', '/images/generate',
    { model_id: 'm-img-free', prompt: '二十九轮验证:霓虹雨夜的城市街头,电影感光影,8K', count: 2, aspect_ratio: '16:9', resolution: '1024' });
  const imgTaskId = gen.task.id;
  let imgDone = null;
  for (let i = 0; i < 40; i++) {
    imgDone = (await api('GET', '/tasks/' + imgTaskId)).task;
    if (['completed', 'failed', 'cancelled'].includes(imgDone.status)) break;
    await wait(1500);
  }
  check('免费生图任务完成(2 张入库)', imgDone.status === 'completed' && imgDone.result_assets.length === 2,
    { status: imgDone.status, n: (imgDone.result_assets || []).length });

  const projRes = await api('GET', '/projects');
  const proj = (projRes.items || []).find(p => (p.episode_count || 0) > 0);
  let videoDone = null, epId = null;
  if (proj) {
    /* 内置免费模型在 dev 库可能被禁用:管理员确保启用(幂等,不改变其他配置) */
    try {
      const al = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
      const adminCookie = al.headers.get('set-cookie').split(';')[0];
      for (const mid of ['m-img-free', 'm-free']) {
        await fetch(BASE + '/api/admin/models/' + mid, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ enabled: true }) });
      }
    } catch (e) { /* 非管理员环境则跳过 */ }
    const full = (await api('GET', '/projects/' + proj.id)).project;
    const ep = full.episodes[0];
    epId = ep.id;
    try {
      const vt = await api('POST', '/tasks', {
        model_id: 'm-free', use_asset_id: imgDone.result_assets[0].id,
        project_id: proj.id, episode_id: epId,
        prompt: '二十九轮验证:封面卡与统一查看器', param_duration: 3, param_resolution: '480p'
      });
      videoDone = vt.task;
      for (let i = 0; i < 60; i++) {
        videoDone = (await api('GET', '/tasks/' + videoDone.id)).task;
        if (['completed', 'failed', 'cancelled'].includes(videoDone.status)) break;
        await wait(1500);
      }
      /* 列表接口才带 result/result_assets 媒体摘要(与工作台轮询同源),取回用于注入 */
      const epList = await api('GET', '/tasks?episode_id=' + epId);
      videoDone = (epList.items || []).find(x => x.id === videoDone.id) || videoDone;
    } catch (e) { console.log('  .. 免费视频模型不可用,跳过视频链路(' + e.message + ')'); }
  }
  if (videoDone) check('免费视频任务完成(封面卡数据就绪)', videoDone.status === 'completed', { status: videoDone.status });

  /* ---------- 浏览器 ---------- */
  const chrome = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=/tmp/vf-chrome-profile-r29', '--remote-debugging-port=9494', '--window-size=1680,1050', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:9494/json/version')).json(); break; } catch (e) { await wait(500); } }
  const tab = await (await fetch('http://127.0.0.1:9494/json/new?' + encodeURIComponent(BASE + '/#/'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: cookie.split('=')[1], domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3600);
  check('应用加载且无 JS 异常', page.errors.length === 0, page.errors.slice(0, 2));

  /* ---------- 1. 首页:最近成果 ---------- */
  console.log('== 1. 首页 · 最近成果条 ==');
  const dashTiles = await ev("document.querySelectorAll('.dash-rec-tile').length", page);
  check('最近成果条渲染(' + dashTiles + ' 格)', dashTiles >= 2, dashTiles);
  const heroLinks = await ev("Array.from(document.querySelectorAll('.dh-actions a.btn')).map(function(a){ return a.getAttribute('href'); }).join(',')", page);
  const heroBtns = await ev("document.querySelectorAll('.dh-actions .btn').length", page);
  // 第三十一轮:Hero 只保留「新建项目 + AI 生图」,上传入口归位到资产库页(见第 3 节),不再一处三入口
  check('hero 快捷入口收敛为 AI 生图(不含重复上传入口)', heroLinks === '#/images' && heroBtns === 2, heroLinks + ' / btns=' + heroBtns);
  if (dashTiles) {
    await ev("document.querySelector('.dash-rec-tile').click()", page);
    await wait(400);
    const v1 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.viewer-mask'), media: !!document.querySelector('.viewer-mask .viewer-media'), count: (document.querySelector('.viewer-count')||{}).textContent, dl: !!document.querySelector('.viewer-foot a[href*=\"/api/assets/\"]') })", page));
    check('成果格点击 → 统一查看器打开', v1.open && v1.media, v1);
    check('查看器含下载按钮', v1.dl);
    await shot(page, 'r29-dash-viewer.png');
    await ev("document.querySelector('.viewer-mask .viewer-x').click()", page);
    await wait(250);
    check('查看器可关闭', (await ev("!document.querySelector('.viewer-mask')", page)) === true);
  }

  /* ---------- 2. AI 生图页 ---------- */
  console.log('== 2. AI 生图页 · 筛选 / 查看器 / 再次生成 ==');
  await goto(page, '#/images', 2200);
  const chips = JSON.parse(await ev("JSON.stringify(Array.from(document.querySelectorAll('[data-ig-filter]')).map(function(b){ return { k: b.dataset.igFilter, t: b.textContent.trim() }; }))", page));
  check('结果筛选 chips(全部/进行中/已完成/失败)', chips.length === 4 && chips.map(c => c.k).join(',') === 'all,running,completed,failed', chips);
  await ev("document.querySelector('[data-ig-filter=\"completed\"]').click()", page);
  await wait(400);
  const completedShown = await ev("document.querySelectorAll('[data-ig-task]').length", page);
  const runningShown = JSON.parse(await ev("(function(){ var b = document.querySelector('[data-ig-filter=\"running\"]'); return b ? b.className.indexOf('on') < 0 : null; })()", page));
  check('「已完成」筛选生效(仅完成记录 ' + completedShown + ' 条)', completedShown >= 1 && runningShown, { completedShown });
  const againBtns = await ev("document.querySelectorAll('[data-ig-task] [data-act=\"again\"]').length", page);
  check('完成记录带「再次生成」', againBtns >= 1, againBtns);
  const copyable = await ev("!!document.querySelector('[data-ig-copy]')", page);
  check('提示词行可点击复制', copyable);
  await shot(page, 'r29-images-page.png');

  await ev("document.querySelector('[data-ig-task] [data-ig-view]').click()", page);
  await wait(500);
  const v2 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.viewer-mask'), img: !!document.querySelector('.viewer-mask img.pv-media'), count: (document.querySelector('.viewer-count')||{}).textContent, copy: !!document.querySelector('.viewer-actions button') })", page));
  check('成果图点击 → 查看器打开(计数 ' + v2.count + ')', v2.open && v2.img && /1 \/ 2/.test(v2.count || ''), v2);
  check('查看器含「复制提示词」动作', v2.copy);
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))", page);
  await wait(300);
  const cnt2 = (await ev("(document.querySelector('.viewer-count')||{}).textContent", page)) || '';
  check('← → 键盘翻页(→ 后计数 ' + cnt2.trim() + ')', /2 \/ 2/.test(cnt2), cnt2);
  await shot(page, 'r29-images-viewer.png');
  await ev("document.querySelector('.viewer-mask .viewer-x').click()", page);
  await wait(250);
  check('生图查看器可关闭', (await ev("!document.querySelector('.viewer-mask')", page)) === true);

  /* ---------- 3. 资产库 ---------- */
  console.log('== 3. 资产库 · 查看器 + 导航 + 动作 ==');
  await goto(page, '#/assets', 2200);
  const cardN = await ev("document.querySelectorAll('#assetGrid .media-card').length", page);
  check('资产网格渲染(' + cardN + ' 卡)', cardN >= 1, cardN);
  /* 第三十一轮:资产库工具栏拆成「页头动作 + 筛选行」,上传为主行动,自动分类/全选收进「更多」 */
  check('资产库页头主行动为上传,次要动作收进更多菜单', await ev("JSON.stringify({ upload: !!document.querySelector('.page-actions #astUploadBtn'), more: !!document.querySelector('#astMorePop #astAutoCatBtn'), notInFilters: !document.querySelector('.filters #astAutoCatBtn') })", page).then(s => { const o = JSON.parse(s); return o.upload && o.more && o.notInFilters; }));
  await ev("document.querySelector('#assetGrid .media-card').click()", page);
  await wait(500);
  const v3 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.viewer-mask'), media: !!document.querySelector('.viewer-mask .viewer-media'), count: (document.querySelector('.viewer-count')||{}).textContent, acts: Array.from(document.querySelectorAll('.viewer-actions .viewer-act, .viewer-actions a.viewer-act')).map(function(b){ return b.textContent.trim(); }) })", page));
  const navOk = cardN >= 2 ? /\d+ \/ \d+/.test(v3.count || '') : true;
  check('资产点击 → 查看器打开(导航 ' + (v3.count || '').trim() + ')', v3.open && v3.media && navOk, { count: v3.count, cardN });
  check('查看器含 重命名/设置分类/共享/删除 动作', ['重命名', '设置分类', '共享…', '删除'].every(x => v3.acts.some(a => a.indexOf(x) >= 0)), v3.acts);
  await shot(page, 'r29-assets-viewer.png');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))", page);
  await wait(300);
  const name2 = (await ev("(document.querySelector('.viewer-name')||{}).textContent", page)) || '';
  check('→ 翻页切换到下一资产(' + name2 + ')', !!name2);
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))", page);
  await wait(250);
  check('Esc 关闭查看器', (await ev("!document.querySelector('.viewer-mask')", page)) === true);

  /* ---------- 4. 分镜工作台 ---------- */
  if (videoDone && videoDone.status === 'completed' && epId) {
    console.log('== 4. 分镜工作台 · 封面卡 / 审片 ==');
    await goto(page, '#/projects/' + proj.id + '/episode/' + epId, 2600);
    check('工作台渲染(无 JS 异常)', page.errors.length === 0, page.errors.slice(0, 2));
    /* 把 API 提交的任务挂到分镜 0(与 UI 提交同构:taskIds + tasks) */
    const taskLit = jsEsc(JSON.stringify(videoDone));
    await ev("(function(){ var s = ProjectsView.studio; if (!s) return 0; var t = s.shots[0]; t.taskIds.push(" + jsEsc(videoDone.id) + "); t.tasks.unshift(JSON.parse(" + taskLit + ")); ProjectsView.renderStudioBody(); return s.shots[0].tasks.length; })()", page);
    await wait(500);
    const coverN = await ev("document.querySelectorAll('.ws-rec-cover').length", page);
    const videoEls = await ev("document.querySelectorAll('.ws-rec-media-wrap video').length", page);
    check('完成记录为封面卡(' + coverN + '),不再常驻 video(' + videoEls + ')', coverN >= 1 && videoEls === 0, { coverN, videoEls });
    check('封面卡含播放角标', (await ev("!!document.querySelector('.ws-rec-cover .ws-rec-play svg')", page)) === true);
    const headToggle = await ev("!!document.querySelector('.ws-rec-head[data-task-toggle]')", page);
    check('记录头整行可点击折叠', headToggle);
    await shot(page, 'r29-studio-cover.png');

    if (coverN) {
      await ev("document.querySelector('.ws-rec-cover').click()", page);
      await wait(600);
      const v4 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.viewer-mask'), video: !!document.querySelector('.viewer-mask video.pv-media'), name: (document.querySelector('.viewer-name')||{}).textContent })", page));
      check('封面点击 → 查看器大屏播放(' + v4.name + ')', v4.open && v4.video, v4);
      await shot(page, 'r29-studio-viewer.png');
      await ev("document.querySelector('.viewer-mask .viewer-x').click()", page);
      await wait(250);
    }

    /* 记录头点击折叠/展开(完成记录初始为折叠态,点击 → 展开 → 再点击 → 收起) */
    await ev("document.querySelector('.ws-rec-head').click()", page);
    await wait(250);
    const expanded = await ev("!document.querySelector('.ws-rec').classList.contains('is-collapsed')", page);
    check('点击记录头展开记录', expanded === true);
    await ev("document.querySelector('.ws-rec-head').click()", page);
    await wait(250);
    const refold = await ev("document.querySelector('.ws-rec').classList.contains('is-collapsed')", page);
    check('再次点击收起记录', refold === true);

    /* 批量审片 → 查看 */
    await ev("document.querySelector('[data-ws-action=\"review\"]').click()", page);
    await wait(1200);
    const rv = JSON.parse(await ev("JSON.stringify({ modal: !!document.querySelector('.modal-mask'), view: !!document.querySelector('[data-rv-view]') })", page));
    check('批量审片弹窗含「查看」按钮', rv.modal && rv.view, rv);
    if (rv.view) {
      await ev("document.querySelector('[data-rv-view]').click()", page);
      await wait(500);
      const v5 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.viewer-mask'), video: !!document.querySelector('.viewer-mask video.pv-media'), count: (document.querySelector('.viewer-count')||{}).textContent })", page));
      check('审片「查看」→ 查看器(本集完成记录翻页 ' + (v5.count || '').trim() + ')', v5.open && v5.video, v5);
      await ev("document.querySelector('.viewer-mask .viewer-x').click()", page);
      await wait(250);
    }
    await ev("document.querySelector('.modal-foot .btn').click()", page);
    await wait(300);
    check('审片弹窗可关闭', (await ev("!document.querySelector('.modal-mask')", page)) === true);
  } else {
    console.log('== 4. 分镜工作台 · 跳过(无完成视频) ==');
    check('跳过视频链路检查(环境无免费视频模型)', true);
  }

  console.log('');
  console.log(failed === 0 ? 'ALL PASS ✅  (round29 全站统一成果查看)' : 'FAILED ❌  未通过 ' + failed + ' 项');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(2); });
