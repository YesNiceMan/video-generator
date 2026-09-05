'use strict';
/* 二十二(视频创作优化)回归验证(无头 Chrome CDP):
   1) 22·1 参考资产门控:参考资产为空时,提示词 [资产名] 不再链接资产库素材(虚线未链接 + 引导文案);
      引入后仅参考资产可链接,库内同名未引入素材仍不可引用
   2) 22·2 点击提示词下方(圆角矩形)引用 chips / 左侧参考资产 → 弹出放大查看预览
   3) 22·3 引用字体与形状放大:正文 15px/1.85、令牌名 13.5px 起步、缩略图 14px、chips 26px 头像
   纯前端行为验证,结束恢复现场并触发自动保存 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9393;
const SHOT_DIR = path.join(__dirname, 'shots-v22');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r22','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
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
const check = (n, c, detail) => { console.log((c ? '  OK ' : '  XX ') + n + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); if (!c) failed++; };
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

const EXPR_TOKENS = [
  '(async function(){',
  '  var ta = document.querySelector(\'.ws-script\');',
  '  var mirror = document.querySelector(\'.pl-mirror\');',
  '  var ok = mirror.querySelectorAll(\'.pl-token.ok\');',
  '  var no = mirror.querySelectorAll(\'.pl-token.no\');',
  '  var box = document.querySelector(\'[data-shot-pl]\');',
  '  var chips = box ? box.querySelectorAll(\'.pl-chip.ok\') : [];',
  '  var hints = box ? box.querySelectorAll(\'.pl-hint-name\') : [];',
  '  var none = box ? box.querySelector(\'.pl-chip-none\') : null;',
  '  var t0 = ok[0];',
  '  var img = t0 ? t0.querySelector(\'img.pl-timg\') : null;',
  '  var name = t0 ? t0.querySelector(\'.pl-tname\') : null;',
  '  if (img && !img.complete) { await new Promise(function(r){ img.onload = img.onerror = r; setTimeout(r, 1500); }); }',
  '  var probe = document.createElement(\'span\');',
  '  var raw0 = t0 ? t0.textContent.slice(0, t0.textContent.indexOf(\']\') + 1) : \'\';',
  '  probe.textContent = raw0;',
  '  probe.style.cssText = \'position:absolute;visibility:hidden;white-space:pre;\';',
  '  mirror.appendChild(probe);',
  '  var pw = probe.getBoundingClientRect().width;',
  '  probe.remove();',
  '  var tr = t0 ? t0.getBoundingClientRect() : { width: 0, height: 0 };',
  '  var taRect = ta.getBoundingClientRect(), mRect = mirror.getBoundingClientRect();',
  '  var nr = name ? name.getBoundingClientRect() : null;',
  '  return JSON.stringify({',
  '    okCount: ok.length, noCount: no.length,',
  '    chipCount: chips.length, hintCount: hints.length,',
  '    noneText: none ? none.textContent : null,',
  '    hasIco: !!(t0 && t0.classList.contains(\'has-ico\')),',
  '    imgLoaded: !!(img && img.complete && img.naturalWidth > 0),',
  '    imgW: img ? getComputedStyle(img).width : null,',
  '    nameFs: name ? parseFloat(getComputedStyle(name).fontSize) : null,',
  '    nameText: name ? name.textContent : null,',
  '    nameVisible: nr ? nr.width > 2 : false,',
  '    nameClipped: name ? name.scrollWidth > name.clientWidth + 0.5 : null,',
  '    chipW: +tr.width.toFixed(1), rawW: +pw.toFixed(1), chipH: +tr.height.toFixed(1),',
  '    lineH: parseFloat(getComputedStyle(ta).lineHeight), taFs: getComputedStyle(ta).fontSize,',
  '    padL: getComputedStyle(t0 || mirror).paddingLeft, radius: getComputedStyle(t0 || mirror).borderRadius,',
  '    mirrorAligned: Math.abs(mRect.left - taRect.left) < 1 && Math.abs(mRect.width - taRect.width) < 2',
  '  });',
  '})()'
].join('\n');

const EXPR_SET = (refsExpr, script) => '(function(){'
  + 'ProjectsView.studio.refs = (' + refsExpr + ');'
  + 'ProjectsView.studio.shots[0].script = ' + JSON.stringify(script) + ';'
  + 'ProjectsView.renderStudioBody();'
  + 'return ProjectsView.studio.refs.length; })()';

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

  /* 备份现场 */
  await ev("(function(){ window.__oRefs = JSON.parse(JSON.stringify(ProjectsView.studio.refs)); window.__oScript0 = ProjectsView.studio.shots[0].script; window.__oSel = ProjectsView.studio.selRef ? ProjectsView.studio.selRef.id : null; })()", page);
  const libNames = JSON.parse(await ev("JSON.stringify(ProjectsView.studio.assets.slice(0, 60).map(function(a){ return a.name; }))", page));
  console.log('资产库名称样例: ' + libNames.slice(0, 8).join(' / '));
  const hasName = n => libNames.includes(n);

  console.log('== A. 22·1 参考资产门控:参考资产为空时不可引用 ==');
  const refExpr0 = '[]';
  const n0 = await ev(EXPR_SET(refExpr0, '[1] 特写镜头 [2]'), page);
  await wait(400);
  check('参考面板置空(' + n0 + ' 项)且重渲染成功', n0 === 0);
  const a0 = JSON.parse(await ev(EXPR_TOKENS, page));
  check('库内素材 [1]/[2] 不再链接(ok × ' + a0.okCount + ')', a0.okCount === 0, { ok: a0.okCount });
  check('未链接按虚线令牌渲染(no × ' + a0.noCount + ')', a0.noCount === 2, { no: a0.noCount });
  check('下方无已链接 chips(' + a0.chipCount + ')', a0.chipCount === 0);
  check('下方无可用占位提示(' + a0.hintCount + ')', a0.hintCount === 0);
  check('显示引导文案(含「参考资产」)', !!a0.noneText && a0.noneText.indexOf('参考资产') >= 0, a0.noneText);

  console.log('== B. 22·1 引入参考资产后:仅参考资产可引用 ==');
  const refExpr1 = "ProjectsView.studio.assets.filter(function(a){ return ['1.png','2.png'].indexOf(a.name) >= 0; }).map(function(a,i){ return Object.assign({}, a, { refType: i === 0 ? '角色' : '场景' }); })";
  const n1 = await ev(EXPR_SET(refExpr1, '[1] 特写镜头 [2] [3] [未引入]'), page);
  await wait(400);
  check('引入 2 项参考资产(' + n1 + ')', n1 === 2);
  const b0 = JSON.parse(await ev(EXPR_TOKENS, page));
  check('参考资产 [1]/[2] 成功链接(ok × ' + b0.okCount + ')', b0.okCount === 2, { ok: b0.okCount });
  check('库内同名未引入 [3] 不可链接(no × ' + b0.noCount + ')', b0.noCount === 2, { no: b0.noCount });
  check('下方已链接 chips 同步(' + b0.chipCount + ')', b0.chipCount === 2);
  check('可用占位提示仅来自参考资产(' + b0.hintCount + ')', b0.hintCount === 2);
  check('chips 标题含「点击放大查看」', (await ev("document.querySelector('.pl-chip.ok').title.indexOf('点击放大查看') >= 0", page)) === true);
  check('chips 带放大镜角标', (await ev("!!document.querySelector('.pl-chip.ok .pl-chip-zoom svg')", page)) === true);
  const chipClip = await clipOf(page, '.ws-script-wrap', 6, 2.5);
  if (chipClip) await shot(page, 'token-chips.png', chipClip);
  const chipsClip = await clipOf(page, '[data-shot-pl]', 10, 2.5);
  if (chipsClip) await shot(page, 'linked-chips.png', chipsClip);

  console.log('== C. 22·2 点击 chips / 左侧参考资产 → 放大查看 ==');
  await ev("document.querySelector('.pl-chip.ok').click()", page);
  await wait(450);
  const m1 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.modal-mask'), media: !!(document.querySelector('.modal-mask img.pv-media')), name: (document.querySelector('.pv-meta .pv-name')||{}).textContent, tag: (document.querySelector('.pv-tag')||{}).textContent, dl: !!document.querySelector('.modal-foot a[href*=\"/api/assets/\"]') })", page));
  check('点击 chip 弹出放大预览', m1.open && m1.media, m1);
  check('预览显示资产名与参考标记', m1.name === '1.png' && String(m1.tag || '').indexOf('已加入参考资产') >= 0, { name: m1.name, tag: m1.tag });
  check('预览含下载按钮', m1.dl);
  await shot(page, 'preview-chip.png');
  await ev("document.querySelector('.modal-mask .modal-x').click()", page);
  await wait(350);
  check('预览可关闭', (await ev("!document.querySelector('.modal-mask')", page)) === true);

  await ev("document.querySelector('.ws-ref-item').click()", page);
  await wait(500);
  const m2 = JSON.parse(await ev("JSON.stringify({ open: !!document.querySelector('.modal-mask'), media: !!(document.querySelector('.modal-mask img.pv-media')), name: (document.querySelector('.pv-meta .pv-name')||{}).textContent })", page));
  check('点击左侧参考资产弹出放大预览', m2.open && m2.media, m2);
  check('选用状态同步(selRef 指向点击项)', (await ev("ProjectsView.studio.selRef && ProjectsView.studio.selRef.name", page)) === '2.png');
  check('左侧参考卡带放大镜角标', (await ev("document.querySelectorAll('.ws-ref-item .ws-ref-zoom svg').length", page)) === 2);
  await shot(page, 'preview-ref.png');
  await ev("document.querySelector('.modal-mask .modal-x').click()", page);
  await wait(350);
  check('预览可关闭(2/2)', (await ev("!document.querySelector('.modal-mask')", page)) === true);

  console.log('== D. 22·3 引用字体与形状放大 ==');
  const refExpr2 = "ProjectsView.studio.assets.filter(function(a){ return ['1.png','2.png'].indexOf(a.name) >= 0; }).map(function(a,i){ return Object.assign({}, a, { refType: i === 0 ? '角色' : '场景' }); }).concat([{ id: 'a-fake-typo', name: '女主角之觉醒.png', type: 'image', refType: '角色' }])";
  const n2 = await ev(EXPR_SET(refExpr2, '[1] 晨光 [女主角之觉醒] [2]'), page);
  await wait(400);
  check('注入长名参考资产(' + n2 + ' 项)', n2 === 3);
  const d0 = JSON.parse(await ev(EXPR_TOKENS, page));
  const dLong = JSON.parse(await ev("(function(){ var toks = document.querySelectorAll('.pl-mirror .pl-token.ok'); var t = null; toks.forEach(function(x){ if (x.getAttribute('data-pl-name').indexOf('女主角') === 0) t = x; }); if (!t) return 'null'; var img = t.querySelector('img.pl-timg'); var name = t.querySelector('.pl-tname'); return JSON.stringify({ hasIco: t.classList.contains('has-ico'), nameFs: parseFloat(getComputedStyle(name).fontSize), clipped: name.scrollWidth > name.clientWidth + 0.5, imgW: img ? getComputedStyle(img).width : null }); })()", page));
  check('textarea 正文字号 15px(' + d0.taFs + ')', d0.taFs === '15px', d0.taFs);
  check('行高放大至 1.85(' + d0.lineH + 'px ≥ 25)', d0.lineH >= 25, d0.lineH);
  check('短令牌引用名 ≥ 12.5px(' + d0.nameFs + ')', d0.nameFs >= 12.5, d0.nameFs);
  check('短令牌引用名完整可见', d0.nameVisible === true && d0.nameClipped === false);
  check('长名令牌保留缩略图 + ≥13px 字号', dLong && dLong.hasIco && dLong.nameFs >= 13, dLong);
  check('长名令牌无截断', dLong && dLong.clipped === false);
  check('令牌缩略图放大 10 → 14px(' + (dLong.imgW || d0.imgW) + ')', (dLong.imgW || d0.imgW) === '14px');
  check('令牌圆角 9px(' + d0.radius + ')', d0.radius === '9px', d0.radius);
  check('令牌水平占宽不变(paddingLeft ' + d0.padL + ')', d0.padL === '0px');
  check('芯片宽度贴合原文(diff ' + Math.abs(d0.chipW - d0.rawW).toFixed(1) + 'px ≤ 1.2)', Math.abs(d0.chipW - d0.rawW) <= 1.2, { chipW: d0.chipW, rawW: d0.rawW });
  check('芯片高度不撑行(' + d0.chipH + ' ≤ 行高 ' + d0.lineH + ' + 2)', d0.chipH >= 18 && d0.chipH <= d0.lineH + 2, { chipH: d0.chipH, lineH: d0.lineH });
  check('镜像层与输入框严格对齐', d0.mirrorAligned === true);
  check('下方 chips 头像放大 26px', (await ev("getComputedStyle(document.querySelector('.pl-chip.ok img')).width", page)) === '26px');
  check('下方 chips 字号 12.5px', (await ev("getComputedStyle(document.querySelector('.pl-chip.ok')).fontSize", page)) === '12.5px');
  check('占位提示名 12px', (await ev("getComputedStyle(document.querySelector('.pl-hint-name')).fontSize", page)) === '12px');
  const tokenClip = await clipOf(page, '.ws-script-wrap', 6, 2.5);
  if (tokenClip) await shot(page, 'token-large.png', tokenClip);

  console.log('== E. 恢复现场 + 无 JS 异常 ==');
  await ev("(function(){ ProjectsView.studio.refs = window.__oRefs; ProjectsView.studio.shots[0].script = window.__oScript0; ProjectsView.studio.selRef = ProjectsView.studio.refs.find(function(r){ return r.id === window.__oSel; }) || ProjectsView.studio.refs[0] || null; ProjectsView.markDirty(); ProjectsView.renderStudioBody(); })()", page);
  await wait(1700);
  check('现场已恢复(参考资产 ' + (await ev('ProjectsView.studio.refs.length', page)) + ' 项,文案还原)', (await ev("ProjectsView.studio.shots[0].script", page)) === (await ev("window.__oScript0", page)));
  check('页面无未捕获异常(' + page.errors.length + ')', page.errors.length === 0);
  if (page.errors.length) console.log(page.errors.slice(0, 5).join('\n'));

  console.log('\n' + (failed ? '✗ ' + failed + ' 项未通过' : '✓ 全部通过') + ' · 截图目录 test/shots-v22/');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('VERIFY_ERROR', e); process.exit(2); });
