'use strict';
/* Round 13 UI 验证:资产库窗口(多选导入)/ 取消按钮 / 工作日志详情 / 弹窗样式统一 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9364;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r13d',
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
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
let failures = 0;
function ok(cond, label, detail) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' — ' + detail : '')); if (!cond) failures++; }
async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');
  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const cookieStr = login.headers.get('set-cookie').split(';')[0];

  // 准备:创建分集 + 测试素材
  const epRes = await fetch('http://localhost:3088/api/projects/p-d3e2d9b40bf747e6/episodes', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieStr },
    body: JSON.stringify({ title: '第 1 集 · 测试' })
  }).then(r => r.json());
  const epId = epRes.episode.id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  for (const name of ['女主-白裙.png', '雪山场景.png', '宝剑道具.png', 'bgm配乐.mp3']) {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: name.endsWith('.mp3') ? 'audio/mpeg' : 'image/png' }), name);
    await fetch('http://localhost:3088/api/assets/upload', { method: 'POST', headers: { Cookie: cookieStr }, body: fd });
  }

  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/' + epId), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await wait(1500);
  await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(4000);

  const snap = async name => {
    const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
    console.log('[shot] ' + name + '.png');
  };

  // 1) 已取消的功能按钮不存在
  const shell = await ev("JSON.stringify({tbtns:[...document.querySelectorAll('.ws-tbtn')].map(b=>b.textContent.trim()), hasMode:!!document.querySelector('.ws-mode-toggle'), hasTools:!!document.querySelector('.ws-tools-wrap')})", page);
  const sh = JSON.parse(shell);
  ok(!/补全参考图/.test(sh.tbtns.join('')), '已取消「补全参考图」按钮');
  ok(!/工具箱/.test(sh.tbtns.join('')), '已取消「工具箱」按钮');
  ok(!sh.hasMode, '已取消「简约版/完整版」切换');

  // 2) 点击 +角色 → 资产库窗口(资产库页面同款:文件夹树 + 分类 chips + 媒体卡片)
  await ev("document.querySelector('[data-ref-pick=\"角色\"]').click()", page);
  await wait(1500);
  const pick = await ev("JSON.stringify({open:!!document.querySelector('.modal .alib-body'), folders:!!document.querySelector('.modal #alpFolders'), catChips:document.querySelectorAll('.modal #alpCats .cat-chip').length, mediaCards:document.querySelectorAll('.modal .media-card').length, hasToolbar:!!document.querySelector('.modal .alib-toolbar'), importBtn:document.querySelector('.modal-foot .btn-primary') ? document.querySelector('.modal-foot .btn-primary').textContent.trim() : ''})", page);
  console.log('pick:', pick);
  const pk = JSON.parse(pick);
  ok(pk.open && pk.folders, '弹出资产库窗口(含文件夹树)');
  ok(pk.catChips >= 7, '资产库窗口有分类 chips(全部分类/6 分类/未分类)', 'chips=' + pk.catChips);
  ok(pk.mediaCards > 0, '资产库窗口展示媒体卡片网格', 'cards=' + pk.mediaCards);
  ok(pk.hasToolbar, '资产库窗口有搜索/类型筛选/上传工具条');
  ok(/导入选中/.test(pk.importBtn), '底部有「导入选中」确认按钮');
  await snap('r13-assetlib-popup');

  // 弹窗样式统一:工作台内弹窗使用标准 modal 结构(与新建项目弹窗一致)
  const modalStyle = await ev("JSON.stringify({hasHead:!!document.querySelector('.modal-head'), hasTitle:!!document.querySelector('.modal-title'), hasClose:!!document.querySelector('.modal-x'), footBtns:[...document.querySelectorAll('.modal-foot .btn')].map(b=>b.className)})", page);
  const ms = JSON.parse(modalStyle);
  ok(ms.hasHead && ms.hasTitle && ms.hasClose, '弹窗头部结构统一(标题 + 关闭按钮)');
  ok(ms.footBtns.length === 2 && ms.footBtns[1].includes('btn-primary'), '弹窗底部按钮统一(取消 + 主按钮)');

  // 多选导入
  await ev("const items=[...document.querySelectorAll('.modal .media-card')].slice(0,2); items[0].click(); items[1].click();", page);
  await wait(300);
  const importState = await ev("document.querySelector('.modal-foot .btn-primary').textContent.trim()", page);
  console.log('importState:', importState);
  ok(/导入选中 \(2\)/.test(importState), '多选后按钮计数更新 → ' + importState);
  await ev("document.querySelector('.modal-foot .btn-primary').click()", page);
  await wait(1200);
  const refCount = await ev("document.querySelectorAll('.ws-ref-item').length", page);
  ok(refCount >= 2, '导入后左侧参考列表出现所选资产', 'refCount=' + refCount);
  await snap('r13-after-import');

  // 3) 工作日志点击显示详细信息
  const taskRes = await fetch('http://localhost:3088/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieStr },
    body: JSON.stringify({ model_id: 'm-agnes-flash', use_asset_id: (await (await fetch('http://localhost:3088/api/assets?type=image', { headers: { Cookie: cookieStr } })).json()).items[0].id, project_id: 'p-d3e2d9b40bf747e6', episode_id: epId, prompt: '测试任务日志详情', params: { duration: 3, fps: 24, motion: 0.3 } })
  });
  console.log('task status:', taskRes.status);
  await ev("document.querySelector('[data-ws-action=\"log\"]').click()", page);
  await wait(1800);
  const logState = await ev("JSON.stringify({items:document.querySelectorAll('#wsLogList .ws-log-item').length, hasDetailBtn:!!document.querySelector('#wsLogList .wl-detail-btn')})", page);
  const ls = JSON.parse(logState);
  ok(ls.items > 0 && ls.hasDetailBtn, '工作日志有条目与「详情」按钮', 'items=' + ls.items);
  await ev("document.querySelector('#wsLogList .wl-detail-btn').click()", page);
  await wait(400);
  const detail = await ev("JSON.stringify({visible:getComputedStyle(document.querySelector('#wsLogList .wl-detail')).display !== 'none'})", page);
  ok(JSON.parse(detail).visible, '点击「详情」后展开详细信息');
  await snap('r13-log-detail');

  // 3.5) 工作日志弹窗选中按钮应为金色(弹窗样式统一,ws-* 变量可在弹窗作用域解析)
  const logBtnStyle = await ev("JSON.stringify({hasOn:document.querySelector('[data-log-filter=\"all\"]').classList.contains('on'), bgOn:getComputedStyle(document.querySelector('[data-log-filter=\"all\"]')).background, wsGold:getComputedStyle(document.querySelector('[data-log-filter=\"all\"]')).getPropertyValue('--ws-gold') || 'NOT SET'})", page);
  const lbs = JSON.parse(logBtnStyle);
  ok(lbs.hasOn, '工作日志选中按钮带 .on 类');
  ok(lbs.bgOn.indexOf('255, 207, 77') >= 0 || lbs.bgOn.indexOf('255,207,77') >= 0, '工作日志选中按钮背景为金色', lbs.bgOn);
  ok(lbs.wsGold !== 'NOT SET', '弹窗内可解析 --ws-gold 变量', lbs.wsGold);

  // 3.6) 提示词中的资源占位符采用「可用占位」金色样式(未链接也显示金色下划线)
  await ev("(function(){var ta=document.querySelector('textarea.ws-script'); if(!ta) return 0; var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(ta,'a[bogusToken]'); ta.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()", page);
  await wait(400);
  const tokStyle = await ev("JSON.stringify({no:!!document.querySelector('.pl-mirror .pl-token.no'), noStyle:(function(){var e=document.querySelector('.pl-mirror .pl-token.no'); return e?getComputedStyle(e).borderBottomColor:'none';})()})", page);
  const ts = JSON.parse(tokStyle);
  ok(ts.no, '未链接占位符以 .pl-token.no 渲染');
  ok(ts.noStyle.indexOf('255, 207, 77') >= 0 || ts.noStyle.indexOf('255,207,77') >= 0, '未链接占位符下划线为金色(可用占位样式)', ts.noStyle);

  // 清理测试数据
  await fetch('http://localhost:3088/api/episodes/' + epId, { method: 'DELETE', headers: { Cookie: cookieStr } });
  const assets = await (await fetch('http://localhost:3088/api/assets?type=all', { headers: { Cookie: cookieStr } })).json();
  for (const a of assets.items) {
    if (['女主-白裙.png', '雪山场景.png', '宝剑道具.png', 'bgm配乐.mp3'].includes(a.name)) {
      await fetch('http://localhost:3088/api/assets/' + a.id, { method: 'DELETE', headers: { Cookie: cookieStr } });
    }
  }
  console.log('cleanup done');

  console.log(failures ? '\n' + failures + ' 项未通过' : '\n全部通过 ✓');
}
main().then(() => process.exit(failures ? 1 : 0)).catch(e => { console.error('验证失败:', e.message); process.exit(1); });
