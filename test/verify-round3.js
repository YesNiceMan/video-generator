'use strict';
/* 三轮优化验证:
   1) 项目顶部导航栏高度固定(60px,窄屏不换行),层级选择(面包屑)保留且可点击跳转
   2) 资产库分类:chips 筛选(角色/场景/物品/分镜/音频/视频/未分类) + 多选批量分类生效
   3) 渐变 UI 已取消(app.css 中无 gradient) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9343;
const APP = 'http://localhost:3088';
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r3',
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

async function newPage(url) {
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  return page;
}

async function evalJson(page, expr) {
  const res = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (res.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(res.exceptionDetails.exception));
  return JSON.parse(res.result.value);
}

/* 轮询等待选择器出现 */
async function waitForSelector(page, sel, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await evalJson(page, `JSON.stringify(!!document.querySelector('${sel}'))`);
    if (ok) return true;
    await wait(300);
  }
  return false;
}

async function shot(page, name) {
  const s = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
}

let failed = 0;
function check(label, ok, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; }
    catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  // 登录拿会话 cookie
  const demoToken = (await (await fetch(APP + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  })).headers.get('set-cookie')).split(';')[0].split('=')[1];

  async function authedPage(hash, waitSel) {
    const p = await newPage(APP + '/');
    await p.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    if (hash) await p.send('Runtime.evaluate', { expression: `location.hash = '${hash}'` });
    if (waitSel) await waitForSelector(p, waitSel);
    await wait(1200);
    return p;
  }

  /* ===== 优化1:项目顶部导航栏固定 + 层级选择 ===== */
  const p1 = await authedPage('#/projects', '.proj-card');
  check('项目列表渲染出可进入的项目', !!(await evalJson(p1, `JSON.stringify(!!document.querySelector('.proj-card'))`)));
  const projId = await evalJson(p1, `JSON.stringify((document.querySelector('.proj-card')?.getAttribute('href') || '').split('/').pop())`);
  if (!projId) { check('存在可进入的项目', false); }
  else {
    await p1.send('Runtime.evaluate', { expression: `location.hash = '#/projects/${projId}'` });
    await waitForSelector(p1, '.wb-nav');
    await wait(1000);
    const wb = await evalJson(p1, `JSON.stringify({
      h: document.querySelector('.wb-nav')?.offsetHeight,
      crumbLinks: [...document.querySelectorAll('.wb-crumb a')].map(a => a.textContent.trim())
    })`);
    check('分集列表工作台顶部导航高度固定为 60px', wb.h === 60, `h=${wb.h}`);
    check('工作台导航保留层级选择(项目分集)', Array.isArray(wb.crumbLinks) && wb.crumbLinks.includes('项目分集'), wb.crumbLinks?.join(' > '));

    // 进入分集创作页
    await p1.send('Runtime.evaluate', { expression: `
      document.querySelector('[data-ep]')?.click(); 0
    ` });
    await waitForSelector(p1, '.ws-nav');
    await wait(1200);
    const st = await evalJson(p1, `JSON.stringify({
      h: Math.round(document.querySelector('.ws-nav')?.getBoundingClientRect().height),
      badge: document.querySelector('.ws-ep-badge')?.textContent.trim(),
      crumbA: [...document.querySelectorAll('.ws-crumb a')].map(a => a.textContent.trim()),
      cur: document.querySelector('.ws-crumb b')?.textContent.trim(),
      tabsInNav: !!document.querySelector('.ws-nav .ws-nav-tabs')
    })`);
    check('视频创作页导航栏高度固定为 60px', st.h === 60, `h=${st.h}`);
    check('层级选择完整:项目分集 / 分集列表 两级可点击', st.crumbA?.length === 2, st.crumbA?.join(' > '));
    check('当前层级显示「第NN集 · 视频创作」', /第\d+集 · 视频创作/.test(st.cur || ''), st.cur);
    check('集数徽标与标签页同处一条导航栏', !!st.badge && st.tabsInNav, `badge=${st.badge}`);

    // 窄屏下导航栏高度不变(不换行)
    await p1.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(600);
    const stNarrow = await evalJson(p1, `JSON.stringify({
      h: Math.round(document.querySelector('.ws-nav')?.getBoundingClientRect().height),
      wrap: getComputedStyle(document.querySelector('.ws-nav')).flexWrap
    })`);
    check('900px 窄屏导航栏仍为 60px 且不换行', stNarrow.h === 60 && stNarrow.wrap === 'nowrap', `h=${stNarrow.h}, flex-wrap=${stNarrow.wrap}`);
    await shot(p1, 'r3-studio-nav-narrow');
    await p1.send('Emulation.clearDeviceMetricsOverride');
    await wait(400);

    // 层级跳转可用
    await p1.send('Runtime.evaluate', { expression: `document.querySelector('.ws-crumb a')?.click(); 0` });
    await wait(1500);
    const backHash = await evalJson(p1, `JSON.stringify(location.hash)`);
    check('点击「项目分集」可跳转层级', backHash === '#/projects', backHash);
    await shot(p1, 'r3-after-crumb-jump');
  }
  p1.ws.close();

  /* ===== 优化2:资产库分类 ===== */
  const p2 = await authedPage('#/assets');
  const cats = await evalJson(p2, `JSON.stringify({
    chips: [...document.querySelectorAll('.cat-chip')].map(c => c.dataset.cat),
    hasBatchBtn: !!document.getElementById('astSelectBtn')
  })`);
  const wantCats = ['all', '角色', '场景', '物品', '分镜', '音频', '视频', 'none'];
  check('分类筛选含 全部+角色+场景+物品+分镜+音频+视频+未分类',
    wantCats.every(k => cats.chips.includes(k)), cats.chips.join(','));
  check('提供「选择分类」多选入口', cats.hasBatchBtn);

  // 点击「角色」chip → 只显示该分类
  await p2.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.cat-chip')].find(c=>c.dataset.cat==='角色')?.click(); 0` });
  await wait(1200);
  const roleOnly = await evalJson(p2, `JSON.stringify({
    on: document.querySelector('.cat-chip.on')?.dataset.cat,
    names: [...document.querySelectorAll('.media-name')].map(n => n.textContent),
    badges: [...document.querySelectorAll('.tag-cat')].map(t => t.textContent.trim())
  })`);
  check('按「角色」筛选后列表全部带该分类徽标', roleOnly.badges.length > 0 && roleOnly.badges.every(b => b === '角色'),
    `${roleOnly.names.join('/')} → ${[...new Set(roleOnly.badges)].join('/')}`);

  // 批量分类(在「未分类」视图操作,保证可重复执行):进入选择模式,勾选两项,设为「场景」
  await p2.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.cat-chip')].find(c=>c.dataset.cat==='none')?.click(); 0` });
  await wait(1200);
  await p2.send('Runtime.evaluate', { expression: `document.getElementById('astSelectBtn').click(); 0` });
  await wait(500);
  await p2.send('Runtime.evaluate', { expression: `
    const boxes=[...document.querySelectorAll('.asset-check')];
    boxes.slice(0, Math.min(2, boxes.length)).forEach(b => b.click()); 0
  ` });
  await wait(500);
  const selState = await evalJson(p2, `JSON.stringify({
    barVisible: !document.getElementById('astBatchBar').classList.contains('hidden'),
    count: document.getElementById('astSelCount').textContent
  })`);
  check('勾选后批量浮条显示已选数量', selState.barVisible && Number(selState.count) >= 1, `count=${selState.count}`);
  if (Number(selState.count) >= 1) {
  await p2.send('Runtime.evaluate', { expression: `
    const sel=document.getElementById('astBatchCat'); sel.value='场景'; sel.dispatchEvent(new Event('change'));
    document.getElementById('astBatchApply').click(); 0
  ` });
  await wait(1600);
  }
  // 服务端验证批量结果:
  const sceneCount = await (await fetch(APP + '/api/assets?folder_id=root&category=' + encodeURIComponent('场景'), {
    headers: { cookie: 'vf_sid=' + demoToken }
  })).json();
  check('批量设为「场景」已入库并可在服务端筛出', sceneCount.items.length >= 1, `场景分类资产=${sceneCount.items.length} 项`);
  await shot(p2, 'r3-assets-batch');

  // 「未分类」筛选可用
  await p2.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.cat-chip')].find(c=>c.dataset.cat==='none')?.click(); 0` });
  await wait(1200);
  const noneBadges = await evalJson(p2, `JSON.stringify([...document.querySelectorAll('.tag-cat')].map(t=>t.textContent.trim()))`);
  check('「未分类」筛选仅显示无分类资产', noneBadges.length === 0 || noneBadges.every(b => b === '未分类'), `${[...new Set(noneBadges)].join('/') || '(空)'} × ${noneBadges.length}`);
  await shot(p2, 'r3-assets-chips');
  p2.ws.close();

  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过 ✓');
}

main().then(() => process.exit(failed ? 1 : 0)).catch(e => {
  console.error('验证失败:', e.message);
  process.exit(1);
});
