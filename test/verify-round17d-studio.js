'use strict';
/* 十七(续)验证:
   ① 参考资产折叠态改为全高竖轨卡(图标+数量徽标+竖排标签);规格四项(画幅比例/分辨率/帧率/时长)统一下拉两行两列(十七·6:单行四列过于拥挤,放宽为 2×2)
   ② 剧本文案占位符高亮改为下方 chips 的「圆角矩形 + 图 + 文字」芯片样式(镜像层置顶 + 不透明芯片覆盖原文) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9391;
const SHOT_DIR = path.join(__dirname, 'shots-v17d');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r17d','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
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
const check = (n, c) => { console.log((c ? '  OK ' : '  XX ') + n); if (!c) failed++; };
async function shot(page, name, clip) {
  const params = { format: 'png', captureBeyondViewport: false };
  if (clip) params.clip = clip;
  const s = await page.send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(s.data, 'base64'));
}
async function clipOf(page, sel, pad = 8, scale = 2) {
  const r = JSON.parse(await ev('(function(){ var el = document.querySelector(\'' + sel + '\'); if(!el) return \'null\'; var b = el.getBoundingClientRect(); return JSON.stringify({x:Math.max(0,b.left-' + pad + '),y:Math.max(0,b.top-' + pad + '),width:b.width+' + (pad * 2) + ',height:b.height+' + (pad * 2) + '}); })()', page));
  if (r === 'null') return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height, scale };
}

const EXPR_GRID = "JSON.stringify((function(){ var g = document.querySelector('.ws-param-grid'); if(!g) return null; var cells = g.querySelectorAll('.ws-pcell'); var sels = g.querySelectorAll('select'); var labels = Array.prototype.map.call(g.querySelectorAll('.ws-pcell > label'), function(l){ return l.textContent.trim(); }); var r1 = cells[0].getBoundingClientRect(), r2 = cells[1].getBoundingClientRect(), r3 = cells[2].getBoundingClientRect(); return { cells: cells.length, sels: sels.length, labels: labels, twoPerRow: Math.abs(r1.top - r2.top) < 3 && (r3.top - r1.top) > 8, cellW: Math.round(r1.width) }; })())";
const EXPR_FOLDED = "JSON.stringify((function(){ var left = document.querySelector('.ws-left'); var open = document.querySelector('.ws-left-open'); if(!open) return null; var ob = open.getBoundingClientRect(); return { folded: left.classList.contains('folded'), openH: Math.round(ob.height), ico: !!open.querySelector('.ws-left-open-ico svg'), count: (open.querySelector('.ws-left-open-count')||{}).textContent, label: (open.querySelector('.ws-left-open-label')||{}).textContent }; })())";
const EXPR_CHIP = [
  "(async function(){",
  "  var sh0 = ProjectsView.studio.shots[0];",
  "  window.__prevScript = sh0.script;",
  "  window.__prevRefs = JSON.parse(JSON.stringify(ProjectsView.studio.refs));",
  // 二十二·1:占位符仅链接「参考资产」——用库内真实图片资产注入参考面板
  "  var imgs = ProjectsView.studio.assets.filter(function(a){ return a.type === 'image'; }).sort(function(a, b){ return String(a.name).length - String(b.name).length; }).slice(0, 2);",
  "  if (imgs.length < 2) return JSON.stringify({ skipped: true });",
  "  ProjectsView.studio.refs = imgs.map(function(a, i){ return Object.assign({}, a, { refType: i === 0 ? '角色' : '场景' }); });",
  "  ProjectsView.renderStudioBody();",
  "  var clean = function(n){ return String(n).replace(/\\.[^.]+$/, ''); };",
  "  var ta = document.querySelector('.ws-script');",
  "  ta.value = '[' + clean(imgs[0].name) + '] 在晨光里研磨药草,镜头缓缓推近 [' + clean(imgs[1].name) + '] 的纹理,远处的 [未录入] 隐约可见。';",
  "  ta.dispatchEvent(new Event('input', { bubbles: true }));",
  "  await new Promise(function(r){ setTimeout(r, 350); });",
  "  var mirror = document.querySelector('.pl-mirror');",
  "  var ok = mirror.querySelectorAll('.pl-token.ok');",
  "  var no = mirror.querySelectorAll('.pl-token.no');",
  "  var t0 = ok[0];",
  "  var img = t0 ? t0.querySelector('img.pl-timg') : null;",
  "  var name = t0 ? t0.querySelector('.pl-tname') : null;",
  "  if (img && !img.complete) { await new Promise(function(r){ img.onload = img.onerror = r; setTimeout(r, 1500); }); }",
  "  var probe = document.createElement('span');",
  "  probe.textContent = t0 ? t0.textContent.slice(0, t0.textContent.indexOf(']') + 1) : '';",
  "  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';",
  "  mirror.appendChild(probe);",
  "  var pw = probe.getBoundingClientRect().width;",
  "  probe.remove();",
  "  var tr = t0 ? t0.getBoundingClientRect() : { width: 0 };",
  "  var taRect = ta.getBoundingClientRect(), mRect = mirror.getBoundingClientRect();",
  "  return JSON.stringify({ okCount: ok.length, noCount: no.length, hasIco: !!(t0 && t0.classList.contains('has-ico')), imgLoaded: !!(img && img.complete && img.naturalWidth > 0), nameText: name ? name.textContent : null, nameFs: name ? parseFloat(getComputedStyle(name).fontSize) : null, nameClipped: name ? name.scrollWidth > name.clientWidth + 0.5 : null, chipW: +tr.width.toFixed(1), rawW: +pw.toFixed(1), chipH: t0 ? +tr.height.toFixed(1) : 0, lineH: parseFloat(getComputedStyle(ta).lineHeight), mirrorAbove: parseFloat(getComputedStyle(mirror).zIndex) > parseFloat(getComputedStyle(ta).zIndex), mirrorAligned: Math.abs(mRect.left - taRect.left) < 1 && Math.abs(mRect.width - taRect.width) < 2 });",
  "})()",
].join("\n");
const EXPR_CARET = "(function(){ var ta = document.querySelector('.ws-script'); ta.focus(); ta.setSelectionRange(1, 2); document.dispatchEvent(new Event('selectionchange')); var wrap = document.querySelector('.pl-wrap'); var inside = wrap.classList.contains('pl-caret-in'); var bg = getComputedStyle(wrap.querySelector('.pl-token.ok')).backgroundColor; ta.blur(); wrap.classList.remove('pl-caret-in'); return JSON.stringify({ inside: inside, translucent: bg.indexOf('rgba') === 0 }); })()";

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
  const cardCount = await ev("document.querySelectorAll('.ws-card').length", page);
  check('工作台渲染出分镜卡(' + cardCount + ')', cardCount > 0);

  console.log('== A. 规格四项下拉(画幅比例/分辨率/帧率/时长)两行两列 ==');
  const grid = JSON.parse(await ev(EXPR_GRID, page));
  check('规格网格存在且含 4 个下拉', grid && grid.cells === 4 && grid.sels === 4);
  check('标签为 ' + JSON.stringify(grid && grid.labels), grid && grid.labels.join(',') === '画幅比例,分辨率,帧率,时长');
  check('两行两列且不拥挤(每行两项,格宽 ' + (grid && grid.cellW) + 'px ≥ 120)', grid && grid.twoPerRow && grid.cellW >= 120);
  check('无残留分段单选 seg-group', (await ev("document.querySelectorAll('.seg-group').length", page)) === 0);
  const setVal = (sel, v) => ev("(function(){ var s = document.querySelector('" + sel + "'); s.value = '" + v + "'; s.dispatchEvent(new Event('change', {bubbles:true})); })()", page);
  await setVal('select[data-shot-fps]', '60');
  check('帧率下拉写入状态(60)', (await ev('ProjectsView.studio.shots[0].fps === 60', page)) === true);
  await setVal('select[data-shot-ratio]', '9:16');
  check('画幅比例下拉写入状态(9:16)', (await ev("ProjectsView.studio.shots[0].ratio === '9:16'", page)) === true);
  const resv = await ev("document.querySelector('select[data-shot-resolution]').value", page); /* 二十轮起分辨率由后台白名单下发,取当前档验证 */
  await setVal('select[data-shot-resolution]', resv);
  check('分辨率下拉写入状态(' + resv + ')', (await ev("ProjectsView.studio.shots[0].resolution === " + JSON.stringify(resv), page)) === true);
  await setVal('select[data-shot-duration]', '7');
  check('时长下拉写入状态(7s)', (await ev('ProjectsView.studio.shots[0].duration === 7', page)) === true);
  check('时长档位 13 档(3-15s)', (await ev("document.querySelector('select[data-shot-duration]').options.length", page)) === 13);
  const paramsClip = await clipOf(page, '.ws-card .ws-shot-params', 10, 2);
  if (paramsClip) await shot(page, 'params-row.png', paramsClip);

  console.log('== B. 参考资产折叠态:全高竖轨卡 ==');
  const refsN = await ev('ProjectsView.studio.refs.length', page);
  await ev("document.querySelector('[data-ws-action=toggleleft]').click()", page);
  await wait(500);
  const folded = JSON.parse(await ev(EXPR_FOLDED, page));
  check('面板折叠类生效', folded && folded.folded);
  check('竖轨卡全高(' + folded.openH + 'px ≥ 420)', folded && folded.openH >= 420);
  check('含展开图标', folded && folded.ico);
  check('数量徽标 = ' + refsN, folded && String(folded.count) === String(refsN));
  check('竖排标签「参考资产」', folded && folded.label === '参考资产');
  await shot(page, 'left-folded.png');
  await ev("document.querySelector('[data-ws-action=toggleleft]').click()", page);
  await wait(500);
  check('再次点击展开恢复', (await ev("!document.querySelector('.ws-left').classList.contains('folded')", page)) === true);
  await shot(page, 'studio-expanded.png');

  console.log('== C. 剧本文案占位符高亮:圆角矩形 + 图 + 文字 芯片 ==');
  const c = JSON.parse(await ev(EXPR_CHIP, page));
  check('已链接占位符渲染为芯片(ok × ' + c.okCount + ')', c.okCount === 2);
  check('未链接占位符保持虚线样式(no × ' + c.noCount + ')', c.noCount === 1);
  check('镜像层位于输入框之上(承载不透明芯片)', c.mirrorAbove === true);
  check('镜像层与输入框几何对齐', c.mirrorAligned === true);
  check('带图令牌缩略图加载成功/窄令牌让图保字号', (!c.hasIco && c.nameFs >= 11.5 && c.nameClipped === false) || (c.hasIco && c.imgLoaded === true));
  check('芯片含资产名且字号 ≥ 11.5(二十二·3 放大后)', c.nameText && c.nameFs >= 11.5 && c.nameClipped === false);
  check('芯片宽度贴合原文(diff ' + (c.chipW - c.rawW).toFixed(1) + 'px ≤ 1.2px)', Math.abs(c.chipW - c.rawW) <= 1.2);
  check('资产名逐级降字号后完整显示无截断', c.nameClipped === false);
  check('芯片高度不撑行(' + c.chipH + ' ≤ 行高 ' + c.lineH + ')', c.chipH > 0 && c.chipH <= c.lineH + 1.5);
  const chipClip = await clipOf(page, '.ws-script-wrap', 6, 2.5);
  if (chipClip) await shot(page, 'token-chips.png', chipClip);
  const chipsBelow = JSON.parse(await ev("JSON.stringify({ chips: (document.querySelector('.ws-card .ws-pl-chips') || document.querySelector('.ws-card')).querySelectorAll('.pl-chip').length })", page));
  check('下方已链接 chips 同步(含重名资产去重前 × ' + chipsBelow.chips + ' ≥ 2)', chipsBelow.chips >= 2);

  console.log('== D. 光标进入芯片让位 + 还原数据 ==');
  const caret = JSON.parse(await ev(EXPR_CARET, page));
  check('光标进入占位符时芯片让位', caret.inside === true && caret.translucent === true);
  await ev("(function(){ ProjectsView.studio.refs = window.__prevRefs; ProjectsView.renderStudioBody(); ProjectsView.studio.shots[0].script = window.__prevScript; var ta = document.querySelector('.ws-script'); ta.value = window.__prevScript || ''; ta.dispatchEvent(new Event('input', {bubbles:true})); })()", page);
  await ev("(function(){ var s0 = ProjectsView.studio.shots[0]; s0.fps = 24; s0.ratio = '16:9'; s0.resolution = '720p'; s0.duration = 10; })()", page);
  await setVal('select[data-shot-fps]', '24');
  await setVal('select[data-shot-ratio]', '16:9');
  await setVal('select[data-shot-resolution]', '720p');
  await setVal('select[data-shot-duration]', '10');

  console.log('== E. 无 JS 异常 ==');
  check('页面无未捕获异常(' + page.errors.length + ')', page.errors.length === 0);
  page.errors.forEach(e => console.log('   !', e.split('\n')[0]));

  console.log(failed === 0 ? 'ALL PASS' : ('FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
