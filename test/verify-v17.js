'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9369;
const SHOT_DIR = path.join(__dirname, 'shots-v17');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-v17e',
  '--remote-debugging-port=' + PORT, '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.exceptionThrown') console.log('[page-exception]', (msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || JSON.stringify(msg.params).slice(0,400));
    if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); }
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
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await wait(300);
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3800);
  console.log('AUTH CHECK:', await ev("fetch('/api/auth/me').then(r=>r.json()).then(j=>JSON.stringify({user: !!j.user, name: j.user && j.name})).catch(e=>'ERR '+e.message)", page));
  let failures = 0;
  const ok = (cond, label, detail) => { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' — ' + detail : '')); if (!cond) failures++; };

  console.log('BOOT DBG:', await ev("JSON.stringify({hash: location.hash, viewLen: document.getElementById('view').innerHTML.length, appHidden: document.getElementById('app').className, authHidden: document.getElementById('authRoot').className, userSet: !!window.App && !!App.user, cookie: document.cookie.slice(0,20)})", page));
  console.log('API PROBE:', await ev("fetch('/api/assets?folder_id=root&type=all').then(r=>r.status).then(s=>('assets '+s)).catch(e=>'assets ERR '+e.message)", page));

  /* === v17 断言(首页) === */
  const dbg = await ev("JSON.stringify({hasTopbar: !!document.querySelector('.topbar'), hasOrb: !!document.querySelector('.bg-orb-1'), hasHero: !!document.querySelector('.dh-title'), hasStat: !!document.querySelector('.stat-value'), hasBtn: !!document.querySelector('.btn-primary'), bodyCls: document.body.className, viewLen: document.getElementById('view').innerHTML.length})", page);
  console.log('DBG:', dbg);
  const dash = JSON.parse(await ev("JSON.stringify({topbarH: document.querySelector('.topbar').offsetHeight, linkPad: getComputedStyle(document.querySelector('.top-link')).padding, orbAnim: getComputedStyle(document.querySelector('.bg-orb-1')).animationName, orbFilter: getComputedStyle(document.querySelector('.bg-orb-1')).filter, heroFont: getComputedStyle(document.querySelector('.dh-title')).fontFamily.slice(0,30), heroSize: getComputedStyle(document.querySelector('.dh-title')).fontSize, statFont: getComputedStyle(document.querySelector('.stat-value')).fontSize, statColor: getComputedStyle(document.querySelector('.stat-value')).color, cardBg: getComputedStyle(document.querySelector('.stat-cards')).backgroundColor, cardBorder: getComputedStyle(document.querySelector('.stat-cards')).borderTopColor, heroAfter: getComputedStyle(document.querySelector('.dash-hero'), '::after').content.slice(0,4), heroBefore: getComputedStyle(document.querySelector('.dash-hero'), '::before').content, btnPrimaryBg: getComputedStyle(document.querySelector('.btn-primary')).backgroundImage.slice(0,60), contentMax: getComputedStyle(document.querySelector('.content')).maxWidth})", page));
  ok(dash.topbarH === 72, '顶栏 72px 大幕', 'h=' + dash.topbarH);
  ok(dash.orbAnim === 'none', '氛围 orb 无限动画已移除(闪屏治理)', dash.orbAnim);
  ok(dash.orbFilter === 'none', 'orb blur 滤镜已移除', dash.orbFilter);
  ok(dash.heroSize === '30px', 'Hero 衬线大标题 30px', dash.heroSize);
  ok(/Georgia|Songti|serif/i.test(dash.heroFont), 'Hero 使用衬线字体', dash.heroFont);
  ok(dash.statFont === '30px', '读数条大数字 30px', dash.statFont);
  ok(dash.statColor.indexOf('242, 231, 207') >= 0, '读数数字象牙白', dash.statColor);
  ok(dash.cardBg === 'rgba(0, 0, 0, 0)', '读数条外盒已移除(编辑部级联)', dash.cardBg);
  ok(dash.cardBorder.indexOf('217, 189, 130') >= 0, '读数条顶部金色细线', dash.cardBorder);
  ok(dash.heroAfter === '"映"', 'Hero 巨型水印字「映」', dash.heroAfter);
  ok(dash.heroBefore !== 'none', 'Hero 取景括号层', dash.heroBefore.slice(0,20));
  ok(dash.btnPrimaryBg.indexOf('linear-gradient') >= 0, '主按钮鎏金渐变底', dash.btnPrimaryBg.slice(0,40));
  ok(dash.contentMax === '1520px', '版心 1520px', dash.contentMax);
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'v17-dashboard.png'), Buffer.from(shot.data, 'base64'));
  console.log('[shot] v17-dashboard.png');

  /* === 项目分集页 === */
  await ev('location.hash = "#/projects"; true', page);
  await wait(2200);
  const proj = JSON.parse(await ev("JSON.stringify({name: (function(){var e=document.querySelector('.proj-name,.dp-name,.card-title'); return e?getComputedStyle(e).fontFamily.slice(0,26):'none'})(), cards: document.querySelectorAll('.proj-card,.dash-proj-card').length})", page));
  console.log('projects:', JSON.stringify(proj));
  const shot2 = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'v17-projects.png'), Buffer.from(shot2.data, 'base64'));
  console.log('[shot] v17-projects.png');

  /* === 资产库 === */
  await ev('location.hash = "#/assets"; true', page);
  await wait(2200);
  const shot3 = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'v17-assets.png'), Buffer.from(shot3.data, 'base64'));
  console.log('[shot] v17-assets.png');

  /* === 后台任务监控(闪屏修复验证) === */
  const adminNav = await ev("!!(window.App && App.user && App.user.role === 'admin')", page);
  if (adminNav) {
    await ev('location.hash = "#/admin"; true', page);
    await wait(2000);
    await ev("(function(){var t=document.querySelector('[data-tab=\"tasks\"]'); if(t) t.click(); return 1;})()", page);
    await wait(1800);
    const admin = JSON.parse(await ev("JSON.stringify({sig1: (window.__v17sig=performance.now(), document.querySelector('#adminBody').innerHTML.length), cls: document.querySelector('#adminBody').classList.contains('silent-render')})", page));
    console.log('admin first paint len:', admin.sig1, 'silent:', admin.cls);
    await wait(3500); /* 等一次轮询 */
    const admin2 = JSON.parse(await ev("JSON.stringify({len2: document.querySelector('#adminBody').innerHTML.length, still: !!document.querySelector('#adminBody .stat-cards'), anim: (function(){var e=document.querySelector('#adminBody .stat-card'); return e?getComputedStyle(e).animationName:'none'})()})", page));
    ok(admin2.still, '任务监控正常渲染', 'len=' + admin2.len2);
    ok(admin2.anim === 'none' || !admin.silent_ok, '静默重渲染不重播入场动画', admin2.anim);
    const shot4 = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, 'v17-admin-tasks.png'), Buffer.from(shot4.data, 'base64'));
    console.log('[shot] v17-admin-tasks.png');
  }
  console.log(failures ? 'FAILURES: ' + failures : 'ALL PASS');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
