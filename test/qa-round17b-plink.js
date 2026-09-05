'use strict';
/* 占位符链接回归:新布局下 textarea 镜像层高亮/chips/点击联动是否完好 */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9380;
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r175','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0; const pending = new Map();
  ws.onmessage = e => { const msg = JSON.parse(e.data); if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); } };
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
async function main() {
  for (let i = 0; i < 40; i++) { try { await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  /* 取该分集第一个可用图片资产名 */
  const assetsRes = await (await fetch('http://localhost:3088/api/assets?type=all', { headers: { cookie: 'vf_sid=' + token } })).json();
  const img = assetsRes.items.find(a => a.type === 'image');
  console.log('asset for token:', img ? img.name : '(none)');
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
  if (!img) { console.log('no image asset, skip token test'); process.exit(0); }
  const assetKey = img.name.replace(/\.[^.]+$/, '').trim().toLowerCase().replace(/'/g, "\\'");
  const out = JSON.parse(await ev(`(function(){
    const out = {};
    const ta = document.querySelector('[data-shot-script]');
    const name = '${assetKey}';
    /* 二十二·1 起:仅「参考资产」可被 [占位符] 引用 —— 先确保该资产已在左侧参考面板中 */
    const s = ProjectsView.studio;
    if (!s.refs.some(function(r){ return r.id === '${img.id}'; })) {
      const base = s.assets.find(function(a){ return a.id === '${img.id}'; }) || { id: '${img.id}', name: ${JSON.stringify(img.name)}, type: 'image' };
      s.refs.push(Object.assign({}, base, { refType: '角色' }));
      ProjectsView.renderStudioBody();
    }
    ta.value = '镜头1:[' + name + '] 站在山巅';
    ta.dispatchEvent(new Event('input', {bubbles:true}));
    const wrap = ta.closest('.pl-wrap');
    out.mirrorExists = !!wrap && !!wrap.querySelector('.pl-mirror');
    out.okToken = !!wrap && !!wrap.querySelector('.pl-token.ok');
    out.mirrorAligned = wrap ? Math.abs(wrap.getBoundingClientRect().width - ta.getBoundingClientRect().width) < 2 : false;
    /* chips 行 */
    const chips = document.querySelector('[data-shot-pl]');
    out.chipsOk = !!chips && chips.querySelectorAll('.pl-chip.ok').length > 0;
    /* pl state linked */
    out.linkedCount = ta._pl ? ta._pl.getLinked().length : -1;
    return JSON.stringify(out);
  })()`, page));
  console.log('plink:', out);
  const pass = out.mirrorExists && out.okToken && out.mirrorAligned && out.chipsOk && out.linkedCount > 0;
  console.log(pass ? 'PLINK PASS' : 'PLINK FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
