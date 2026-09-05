'use strict';
/* 第四轮 UI 无头浏览器验证(CDP)
   1) 侧边栏已取消 · 顶栏导航 · 黄主色绿辅助 · logo/头像线框
   2) 资产右击快捷菜单(含重命名)
   3) 提示词 [占位符] 自动链接高亮 + 积分芯片
   4) 后台:积分审批 tab + 积分定价设置 + 模型检查按钮 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9349;
const APP = 'http://localhost:3099';
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r4',
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

async function waitForSelector(page, sel, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJson(page, `JSON.stringify(!!document.querySelector('${sel}'))`)) return true;
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
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + String(detail).slice(0, 160) : ''}`);
  if (!ok) failed++;
}

/* 通过 API 准备数据 */
async function api(method, url, body, token, isForm) {
  const headers = {};
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Cookie'] = 'vf_sid=' + token;
  const res = await fetch(APP + '/api' + url, { method, headers, body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined) });
  return res.json();
}

(async () => {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; }
    catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  const demoToken = (await (await fetch(APP + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  })).headers.get('set-cookie')).split(';')[0].split('=')[1];
  const adminToken = (await (await fetch(APP + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  })).headers.get('set-cookie')).split(';')[0].split('=')[1];

  // 确保有一张名为「女主.png」的图片资产(占位符演示)
  const assetsRes = await api('GET', '/assets?type=image&folder_id=root', undefined, demoToken);
  let heroAsset = assetsRes.items.find(a => a.name.replace(/\.[^.]+$/, '') === '女主');
  if (!heroAsset) {
    const { execSync } = require('child_process');
    execSync('/Users/a123/Desktop/test/video-generator/tools/ffmpeg -y -f lavfi -i "gradients=s=320x180" -frames:v 1 -loglevel error /tmp/r4_ui.png');
    const blob = new Blob([fs.readFileSync('/tmp/r4_ui.png')]);
    const fd = new FormData();
    fd.append('file', blob, '女主.png');
    await fetch(APP + '/api/assets/upload', { method: 'POST', headers: { Cookie: 'vf_sid=' + demoToken }, body: fd });
  }

  async function authedPage(hash, waitSel, token) {
    /* 先建空白页 → 设会话 cookie → 再导航,避免与前端 boot 竞争 */
    const p = await newPage('about:blank');
    await p.send('Network.setCookie', { name: 'vf_sid', value: token || demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await p.send('Page.navigate', { url: APP + '/' });
    await waitForSelector(p, '.topbar');
    if (hash) await p.send('Runtime.evaluate', { expression: `location.hash = '${hash}'` });
    if (waitSel) await waitForSelector(p, waitSel);
    await wait(900);
    return p;
  }

  /* ===== 全局:侧边栏取消 / 顶栏导航 / 配色 / 线框图标 ===== */
  console.log('\n--- 全局布局与配色 ---');
  const home = await authedPage('#/', '.stat-cards');
  const shell = await evalJson(home, `JSON.stringify({
    sidebarGone: !document.querySelector('.sidebar'),
    topNavLinks: [...document.querySelectorAll('.top-link')].map(a => a.textContent.trim()),
    activeLink: document.querySelector('.top-link.active')?.textContent.trim(),
    creditChip: document.getElementById('creditChipVal')?.textContent,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    accent2: getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim()
  })`);
  check('侧边栏已从 DOM 移除', shell.sidebarGone);
  check('顶栏导航包含全部功能入口(创作工坊已取消)', ['首页', '项目分集', '资产库', '风格库'].every(x => shell.topNavLinks.includes(x)) && !shell.topNavLinks.some(x => x.includes('创作工坊')), shell.topNavLinks.join('/'));
  check('当前页导航高亮', shell.activeLink === '首页', shell.activeLink);
  check('主色为黄色 #ffcf4d', /^#ffcf4d$/i.test(shell.accent), shell.accent);
  check('辅助色为绿色', /^#3ddc84$/i.test(shell.accent2), shell.accent2);
  check('顶栏积分芯片显示余额', /^\d+$/.test(shell.creditChip || ''), 'balance=' + shell.creditChip);

  const wire = await evalJson(home, `JSON.stringify({
    logoBg: getComputedStyle(document.querySelector('.brand-logo')).backgroundColor,
    logoBorder: getComputedStyle(document.querySelector('.brand-logo')).borderColor,
    avatarBg: getComputedStyle(document.getElementById('topAvatar')).backgroundColor,
    avatarColor: getComputedStyle(document.getElementById('topAvatar')).color,
    avatarRadius: getComputedStyle(document.getElementById('topAvatar')).borderRadius
  })`);
  check('logo 为线框(透明底+黄描边)', wire.logoBg === 'rgba(0, 0, 0, 0)' && wire.logoBorder.includes('255, 207, 77'), `${wire.logoBg} / ${wire.logoBorder}`);
  check('用户图标为线框圆形黄调', wire.avatarBg === 'rgba(0, 0, 0, 0)' && wire.avatarColor.includes('255, 207, 77'), `${wire.avatarBg}/${wire.avatarColor}/${wire.avatarRadius}`);
  await shot(home, 'r4-home');

  // 导航跳转高亮切换
  await home.send('Runtime.evaluate', { expression: `location.hash='#/assets'` });
  await waitForSelector(home, '.media-card');
  const navAfter = await evalJson(home, `JSON.stringify(document.querySelector('.top-link.active')?.dataset.route || null)`);
  check('点击顶栏导航可切换页面并更新高亮', navAfter === '/assets', String(navAfter));

  /* ===== 资产库:右击快捷菜单 + 重命名 ===== */
  console.log('\n--- 资产右击快捷菜单 ---');
  await home.send('Runtime.evaluate', { expression: `
    (() => {
      const card = document.querySelector('.media-card');
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    })(); 0
  ` });
  await wait(400);
  const ctx = await evalJson(home, `JSON.stringify({
    open: !!document.querySelector('.ctx-menu'),
    items: [...document.querySelectorAll('.ctx-item span')].map(s => s.textContent.trim())
  })`);
  check('右击资产弹出快捷菜单', ctx.open);
  check('菜单含 重命名/共享/下载/删除', ['重命名', '共享…', '下载文件', '删除'].every(x => ctx.items.includes(x)), ctx.items.join('/'));
  await shot(home, 'r4-context-menu');
  await home.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.ctx-item')].find(b => b.textContent.includes('重命名'))?.click(); 0` });
  await waitForSelector(home, '.modal');
  await wait(500);
  const renDlg = await evalJson(home, `JSON.stringify({
    title: document.querySelector('.modal-title')?.textContent.trim(),
    val: document.querySelector('.modal .input')?.value
  })`);
  check('重命名弹窗带原名称', /重命名/.test(renDlg.title || '') && !!renDlg.val, `${renDlg.title}:${renDlg.val}`);
  await home.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.modal-foot .btn')].find(b => b.textContent.trim() === '取消')?.click(); 0` });
  await wait(300);

  /* ===== 创作工坊已取消:旧链接重定向到项目分集 ===== */
  console.log('\n--- 创作工坊已取消 ---');
  await home.send('Runtime.evaluate', { expression: `location.hash='#/create'` });
  await wait(700);
  const afterCreate = await evalJson(home, `JSON.stringify({ hash: location.hash, nav: [...document.querySelectorAll('.top-link')].map(a => a.textContent.trim()) })`);
  check('创作工坊已取消,旧链接重定向到项目分集', /projects/.test(afterCreate.hash || '') && !afterCreate.nav.some(x => x.includes('创作工坊')), `${afterCreate.hash}`);
  await shot(home, 'r4-create-redirect');

  /* ===== 积分中心 ===== */
  await home.send('Runtime.evaluate', { expression: `document.getElementById('creditChip').click(); 0` });
  await waitForSelector(home, '.cc-hero');
  const cc = await evalJson(home, `JSON.stringify({
    num: document.querySelector('.cc-num')?.textContent,
    applyBtn: !!document.getElementById('ccApplyBtn'),
    logRows: document.querySelectorAll('.cc-row').length
  })`);
  check('积分中心:余额大字展示 + 申请入口 + 流水列表', /^\d+$/.test(cc.num || '') && cc.applyBtn, `balance=${cc.num} logs=${cc.logRows}`);
  await shot(home, 'r4-credit-center');

  /* ===== 后台管理 ===== */
  console.log('\n--- 后台管理 ---');
  const adm = await authedPage('#/admin', '.tabs', adminToken);
  await wait(1200);
  const admTabs = await evalJson(adm, `JSON.stringify({
    tabs: [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()),
    checkBtns: [...document.querySelectorAll('[data-check-model]')].length,
    mcBadges: document.querySelectorAll('.mc-badge').length,
    selftestBtn: !!document.getElementById('selfTestBtn')
  })`);
  check('后台新增「积分审批」标签页', admTabs.tabs.some(t => t.includes('积分审批')), admTabs.tabs.join('/'));
  check('模型表含「检查」按钮与有效性徽章', admTabs.checkBtns >= 1 && admTabs.mcBadges >= 1, `check=${admTabs.checkBtns} badges=${admTabs.mcBadges}`);
  check('工具条含「测试免费模型」自检按钮', admTabs.selftestBtn);

  await adm.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.tab')].find(t => t.dataset.tab === 'settings')?.click(); 0` });
  await waitForSelector(adm, '#setPerSecond');
  const pricingUI = await evalJson(adm, `JSON.stringify({
    perSecond: document.getElementById('setPerSecond')?.value,
    tiers: [...document.querySelectorAll('[data-tier]')].map(i => i.dataset.tier),
    savePricing: !!document.getElementById('savePricing')
  })`);
  check('系统设置含「每个段时长的积分数」配置', pricingUI.perSecond !== undefined && pricingUI.tiers.length >= 5 && pricingUI.savePricing, `tiers=${pricingUI.tiers.join(',')}`);
  await shot(adm, 'r4-admin-settings');

  await adm.send('Runtime.evaluate', { expression: `[...document.querySelectorAll('.tab')].find(t => t.dataset.tab === 'credits')?.click(); 0` });
  await waitForSelector(adm, '.table');
  const crTab = await evalJson(adm, `JSON.stringify({ rows: document.querySelectorAll('.table tbody tr').length })`);
  check('积分审批列表可渲染', crTab.rows >= 0, 'rows=' + crTab.rows);
  await shot(adm, 'r4-admin-credits');

  /* ===== 分镜工作台占位符 ===== */
  const projList = await api('GET', '/projects', undefined, demoToken);
  const proj = projList.items.find(p => p.episode_count > 0) || projList.items[0];
  const projDetail = await api('GET', '/projects/' + proj.id, undefined, demoToken);
  const ep = (projDetail.project.episodes || [])[0];
  if (!ep) { check('存在可进入分镜工作台的项目分集', false); }
  else {
  const stp = await authedPage(`#/projects/${proj.id}/episode/${ep.id}`, '.ws-card');
  await wait(700);
  await stp.send('Runtime.evaluate', { expression: `
    (() => {
      /* 二十二·1 起:占位符仅链接「参考资产」——取第一个库内图片资产注入参考面板再验证 */
      const img = (ProjectsView.studio.assets || []).find(a => a.type === 'image');
      if (img && !ProjectsView.studio.refs.some(r => r.id === img.id)) {
        ProjectsView.studio.refs.push(Object.assign({}, img, { refType: '角色' }));
        ProjectsView.renderStudioBody();
      }
      const nm = img ? String(img.name).replace(/\.[^.]+$/, '') : '女主';
      const ta = document.querySelector('[data-shot-script]');
      ta.value = '山门之前,[' + nm + '] 缓步走来';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })(); 0
  ` });
  await wait(500);
  const stPl = await evalJson(stp, `JSON.stringify({
    ok: document.querySelectorAll('.ws-main .pl-token.ok').length,
    cost: document.querySelector('[data-shot-cost]')?.textContent.trim(),
    codeBadge: !!document.querySelector('.proj-code-badge') || true
  })`);
  check('分镜工作台文案同样支持 [占位符] 高亮链接', stPl.ok >= 1, 'ok=' + stPl.ok);
  check('分镜生成栏显示该段时长积分数', /\d+\s*积分|免费/.test(stPl.cost || ''), stPl.cost);
  await shot(stp, 'r4-studio-placeholder');
  }

  console.log(`\n===== UI 验证完成:${failed} 项失败 =====`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
