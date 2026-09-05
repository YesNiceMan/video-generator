'use strict';
/* 二十·功能 UI 验证(headless Chrome + CDP):
   1) 资产库卡片显示日期时间
   2) 后台系统设置出现「生成视频尺寸」勾选卡(480p/720p/960p/2k)
   3) 后台模型管理表格出现「积分/秒」列;编辑弹窗含每秒积分输入
   4) 分镜工作台分辨率下拉 = 后台配置四档;costFor 遵循模型每秒单价 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9376;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PROFILE = '/tmp/vf-chrome-profile-r20b-' + Date.now();
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=' + PROFILE, '--remote-debugging-port=' + PORT, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl); let msgId = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}
let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
  else { FAIL++; console.log('  ✗ ' + name + '  [' + detail + ']'); }
}
async function login(email, password) {
  const res = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error('登录失败 ' + res.status);
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}
async function audit(name, hash, token, expr, assertions, waitMs = 4200) {
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(900);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(waitMs);
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const sf = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(sf.data, 'base64'));
  let v = {};
  try { v = JSON.parse(r.result.value || '{}'); } catch (e) { v = { _parseError: r.result.value }; }
  console.log('[' + name + ']');
  for (const [label, cond, detail] of assertions(v)) check(label, cond, typeof detail === 'function' ? detail(v) : detail);
  page.ws.close();
}
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const demo = await login('demo@videoforge.cn', 'demo123');
  const admin = await login('admin@videoforge.cn', 'admin123');

  // 1) 资产库:卡片 meta 行带日期时间
  const assetsExpr = '(async () => { const metas = [...document.querySelectorAll("#assetGrid .media-card .media-meta")].map(e => e.textContent.trim());' +
    'return JSON.stringify({ count: metas.length, samples: metas.slice(0, 3), withDate: metas.filter(t => /\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(t)).length }); })()';
  await audit('r20b-assets-date', '#/assets', demo, assetsExpr, v => [
    ['资产卡片已渲染', v.count > 0, v.count],
    ['卡片 meta 含日期时间', v.count > 0 && v.withDate === v.count, v.samples.join(' | ')],
  ]);

  // 2) 后台-系统设置:生成视频尺寸勾选卡
  const settingsExpr = '(async () => { const tabs=[...document.querySelectorAll(".tab")]; const st=tabs.find(t=>t.dataset.tab==="settings"); if(st) st.click();' +
    'for(let i=0;i<40;i++){ if(document.querySelector("#saveResolutions")) break; await new Promise(r=>setTimeout(r,150)); }' +
    'const boxes=[...document.querySelectorAll("[data-vres]")].map(b=>({v:b.dataset.vres,checked:b.checked}));' +
    'return JSON.stringify({ saveBtn:!!document.querySelector("#saveResolutions"), boxes }); })()';
  await audit('r20b-admin-sizes', '#/admin', admin, settingsExpr, v => [
    ['设置页有保存尺寸按钮', v.saveBtn === true, v.saveBtn],
    ['四个尺寸勾选项', Array.isArray(v.boxes) && v.boxes.length === 4, JSON.stringify(v.boxes)],
    ['默认全部勾选', Array.isArray(v.boxes) && v.boxes.length === 4 && v.boxes.every(b => b.checked), JSON.stringify(v.boxes)],
  ], 5200);

  // 3) 后台-模型管理:积分/秒列
  const modelsExpr = '(async () => { const tabs=[...document.querySelectorAll(".tab")]; const st=tabs.find(t=>t.dataset.tab==="models"); if(st) st.click();' +
    'for(let i=0;i<40;i++){ if(document.querySelector("[data-edit-model]")) break; await new Promise(r=>setTimeout(r,150)); }' +
    'const head=[...document.querySelectorAll("th")].map(e=>e.textContent.trim());' +
    'const cells=[...document.querySelectorAll("tbody tr")].map(tr=>{const tds=[...tr.children];return {name:(tds[0]&&tds[0].textContent.trim().slice(0,14)),cps:tds[4]?tds[4].textContent.trim().replace(/\s+/g," "):null};});' +
    'document.querySelector("[data-edit-model]").click(); for(let i=0;i<30;i++){ if(document.querySelector("#emCps")) break; await new Promise(r=>setTimeout(r,120)); }' +
    'const dlg={cpsInput:!!document.querySelector("#emCps"),hint:(document.querySelector("#emCps")||{}).placeholder||""};' +
    'const cancel=[...document.querySelectorAll(".modal-foot .btn")].find(b=>b.textContent.includes("取消")); if(cancel) cancel.click();' +
    'return JSON.stringify({ head, cells, dlg }); })()';
  await audit('r20b-admin-models', '#/admin', admin, modelsExpr, v => [
    ['表头含 积分/秒', (v.head || []).includes('积分/秒'), JSON.stringify(v.head)],
    ['每行显示计价信息(免费/全局/数值)', (v.cells || []).length > 0 && v.cells.every(c => c.cps && c.cps.length > 0), JSON.stringify((v.cells || []).slice(0, 6))],
    ['编辑弹窗有每秒积分输入', v.dlg && v.dlg.cpsInput === true, v.dlg && v.dlg.hint],
  ], 5600);

  // 4) 工作台:分辨率下拉 = 配置四档;costFor 遵循模型单价
  let target = null;
  const projs = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + demo } })).json();
  for (const p of (projs.items || [])) {
    const d = await (await fetch('http://localhost:3088/api/projects/' + p.id, { headers: { cookie: 'vf_sid=' + demo } })).json();
    const eps = (d.project && d.project.episodes) || [];
    if (eps.length) { target = { pid: p.id, eid: eps[0].id }; break; }
  }
  if (!target) { console.log('  - 跳过工作台(无分集)'); }
  else {
    const studioExpr = '(async () => { for(let i=0;i<50;i++){ if(document.querySelector("[data-shot-resolution]")) break; await new Promise(r=>setTimeout(r,150)); }' +
      'const sel=document.querySelector("[data-shot-resolution]");' +
      'const opts=sel?[...sel.options].map(o=>o.value):[];' +
      'const cost13=CreditCenter.costFor(5,{credit_per_second:2.5});' +
      'const cost0=CreditCenter.costFor(5,{});' +
      'const p=CreditCenter.cache.pricing||{};' +
      'const expectGlobal=(p.overrides&&p.overrides["5"]!==undefined)?Math.round(p.overrides["5"]):Math.max(1,Math.ceil(5*(p.perSecond||5)));' +
      'const hint=document.querySelector("[data-shot-cost]");' +
      'return JSON.stringify({ opts, cost13, cost0, expectGlobal, hint:hint?hint.textContent.trim():null }); })()';
    await audit('r20b-studio-res', '#/projects/' + target.pid + '/episode/' + target.eid, demo, studioExpr, v => [
      ['分辨率下拉 = 480p/720p/960p/2k', JSON.stringify(v.opts) === JSON.stringify(['480p', '720p', '960p', '2k']), JSON.stringify(v.opts)],
      ['costFor:模型单价 2.5 × 5s = 13(优先于覆盖价)', v.cost13 === 13, v.cost13],
      ['costFor:无单价跟随全局定价', v.cost0 === v.expectGlobal, v.cost0 + ' vs ' + v.expectGlobal],
      ['成本提示已渲染', !!v.hint, v.hint],
    ], 6200);
  }

  console.log('\nRESULT: ' + PASS + ' pass, ' + FAIL + ' fail');
  console.log('DONE');
  try { chrome.kill('SIGKILL'); } catch (e) {}
  process.exit(FAIL > 0 ? 1 : 0);
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
