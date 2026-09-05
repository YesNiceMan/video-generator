'use strict';
/* 二十·续验证:墨金按钮(INK & CHAMPAGNE) + 浅色「墨韵画廊」 + 阴影轻量化
   双模式计算样式审计 + 截图(test/shots/r20-*.png)
   —— 二十一「玄墨·月白」后常量同步:按钮转玄墨底+月白骨字,浅色转瓷白+石墨+黛青 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9373;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const PROFILE = '/tmp/vf-chrome-profile-r20-' + Date.now();
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
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { FAIL++; console.log('  ✗ ' + name + '  [' + detail + ']'); }
}
async function main() {
  let version;
  for (let i = 0; i < 40; i++) { try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  if (!version) throw new Error('chrome not ready');
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const projs = await (await fetch('http://localhost:3088/api/projects', { headers: { cookie: 'vf_sid=' + token } })).json();
  let target = null;
  for (const p of (projs.items || [])) {
    const d = await (await fetch('http://localhost:3088/api/projects/' + p.id, { headers: { cookie: 'vf_sid=' + token } })).json();
    const eps = (d.project && d.project.episodes) || d.episodes || [];
    if (eps.length) { target = { pid: p.id, eid: eps[0].id }; break; }
  }
  async function audit(name, hash, scheme, expr, assertions, waitMs = 4200) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
    await wait(1100);
    await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + scheme + '")}catch(e){}', returnByValue: true });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(waitMs);
    const r = await page.send('Runtime.evaluate', { expression: 'JSON.stringify(' + expr + ')', returnByValue: true });
    const sf = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(sf.data, 'base64'));
    const v = JSON.parse(r.result.value || '{}');
    console.log('[' + name + ']');
    for (const [label, cond, detail] of assertions(v)) check(label, cond, typeof detail === 'function' ? detail(v) : detail);
    page.ws.close();
  }
  const dashExpr = '(() => { const b = document.querySelector(".btn-primary"); const cs = b ? getComputedStyle(b) : null;' +
    'const brand = document.querySelector(".brand-name"); const card = document.querySelector(".card, .stat-card");' +
    'const statV = document.querySelector(".stat-value"); const root = getComputedStyle(document.documentElement);' +
    'return { scheme: document.documentElement.dataset.scheme, bodyBg: getComputedStyle(document.body).backgroundColor,' +
    ' btnBg: cs ? cs.backgroundColor : null, btnImage: cs ? cs.backgroundImage : null, btnColor: cs ? cs.color : null,' +
    ' btnShadow: cs ? cs.boxShadow : null, brandColor: brand ? getComputedStyle(brand).color : null,' +
    ' cardShadow: card ? getComputedStyle(card).boxShadow : null, statColor: statV ? getComputedStyle(statV).color : null,' +
    ' gradVar: root.getPropertyValue("--grad").trim(), shadowVar: root.getPropertyValue("--shadow").trim() }; })()';
  const studioExpr = '(() => { const g = document.querySelector(".ws-gen-btn"); const cs = g ? getComputedStyle(g) : null;' +
    'const card = document.querySelector(".ws-card"); const badge = document.querySelector(".ws-ep-badge");' +
    'return { scheme: document.documentElement.dataset.scheme,' +
    ' genBg: cs ? cs.backgroundColor : null, genImage: cs ? cs.backgroundImage : null, genColor: cs ? cs.color : null,' +
    ' genShadow: cs ? cs.boxShadow : null, afterDisplay: g ? getComputedStyle(g, "::after").display : null,' +
    ' wsGold: document.querySelector(".ws") ? getComputedStyle(document.querySelector(".ws")).getPropertyValue("--ws-gold").trim() : null,' +
    ' cardShadow: card ? getComputedStyle(card).boxShadow : null,' +
    ' badgeBg: badge ? getComputedStyle(badge).backgroundColor : null, badgeColor: badge ? getComputedStyle(badge).color : null }; })()';
  /* 二十三:浅色常量同步第二十二轮「黛金」色板;生成键 = 高对比实底 */
const INK_DARK = 'rgb(26, 24, 20)', INK_LIGHT = 'rgb(22, 41, 77)', INK_TEXT = 'rgb(23, 37, 60)';
const GEN_DASH = s => s === 'dark' ? 'rgb(212, 175, 110)' : 'rgb(30, 67, 128)';
  const CHAMP = s => s === 'dark' ? 'rgb(233, 231, 223)' : 'rgb(237, 241, 248)';
  for (const scheme of ['dark', 'light']) {
    await audit('r20-dash-' + scheme, '#/', scheme, dashExpr, v => [
      ['方案正确', v.scheme === scheme, v.scheme],
      ['主按钮=墨底', v.btnBg === (scheme === 'dark' ? INK_DARK : INK_LIGHT), v.btnBg],
      ['主按钮=月白骨字', v.btnColor === CHAMP(scheme), v.btnColor],
      ['主按钮无渐变', v.btnImage === 'none', v.btnImage],
      ['主按钮无重阴影(哑光内高光)', String(v.btnShadow).includes('inset'), v.btnShadow],
      ['卡片发丝影(浅色)', scheme === 'dark' || (v.cardShadow || '').includes('rgba(16, 28, 50'), v.cardShadow],
      [scheme === 'dark' ? '品牌字=鎏金渐变' : '品牌字=黛韵渐变', scheme === 'dark' ? v.brandColor !== INK_TEXT : v.brandColor === 'rgb(22, 41, 77)', v.brandColor],
      [scheme === 'dark' ? '数值字=鎏金渐变' : '数值字=黛韵渐变', scheme === 'dark' ? true : v.statColor === 'rgb(22, 41, 77)', v.statColor],
      ['--grad=' + (scheme === 'dark' ? '香槟金' : '黛韵'), (v.gradVar || '').includes(scheme === 'dark' ? '#ecd9a8' : '#16294d'), v.gradVar],
      ['--shadow 轻量化', (v.shadowVar || '').match(/rgba\((4, ?3, ?2|24, ?24, ?19|16, ?28, ?50)/) !== null, v.shadowVar],
    ]);
  }
  if (target) for (const scheme of ['dark', 'light']) {
    await audit('r20-studio-' + scheme, '#/projects/' + target.pid + '/episode/' + target.eid, scheme, studioExpr, v => [
      ['方案正确', v.scheme === scheme, v.scheme],
      ['生成键=高对比实底', v.genBg === GEN_DASH(scheme), v.genBg],
      ['生成键=墨字/白字(高对比)', v.genColor === (scheme === 'dark' ? 'rgb(26, 20, 10)' : 'rgb(255, 255, 255)'), v.genColor],
      ['生成键无渐变(哑光内高光)', v.genImage === 'none' && String(v.genShadow).includes('inset'), v.genImage + ' / ' + v.genShadow],
      ['扫光已移除', v.afterDisplay === 'none', v.afterDisplay],
      ['EP票签=墨底骨字', v.badgeBg === (scheme === 'dark' ? INK_DARK : INK_LIGHT) && v.badgeColor === CHAMP(scheme), v.badgeBg + ' / ' + v.badgeColor],
      ['--ws-gold 作用域', v.wsGold === (scheme === 'dark' ? '#d4b87e' : '#1e4380'), v.wsGold],
      ['分镜卡发丝影(浅色)', scheme === 'dark' || (v.cardShadow || '').includes('rgba(16, 28, 50'), v.cardShadow],
    ]);
  }
  console.log('\nRESULT: ' + PASS + ' pass, ' + FAIL + ' fail');
  console.log('DONE');
  if (FAIL > 0) process.exitCode = 1;
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
