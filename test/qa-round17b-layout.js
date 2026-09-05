'use strict';
/* 布局 QA:溢出 / 重叠 / 挤压检测(1680 宽正常 + 1100 窄屏) */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9379;
const chrome = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--mute-audio','--hide-scrollbars',
  '--user-data-dir=/tmp/vf-chrome-profile-r174','--remote-debugging-port=' + PORT, '--window-size=1680,1050','about:blank'], { stdio: 'ignore' });
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
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/e-5a6bbbf41d5c2bad'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(800);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3800);

  const audit = () => `(function(){
    const out = {};
    const ws = document.querySelector('.ws');
    out.pageHScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    out.wsHScroll = ws.scrollWidth > ws.clientWidth + 1;
    const nav = document.querySelector('.ws-nav');
    out.navOverflow = nav.scrollWidth > nav.clientWidth + 1;
    const card = document.querySelector('.ws-card');
    out.cardOverflow = card.scrollWidth > card.clientWidth + 1;
    const grid = document.querySelector('.ws-card-grid');
    const editor = grid.querySelector('.ws-shot-editor').getBoundingClientRect();
    const params = grid.querySelector('.ws-shot-params').getBoundingClientRect();
    out.cols = { paramsW: Math.round(params.width), editorW: Math.round(editor.width), paramsFirst: params.left < editor.left, stacked: Math.round(params.width) === Math.round(editor.width) };
    const seg = document.querySelector('.seg');
    out.segClickH = Math.round(seg.getBoundingClientRect().height);
    const gen = document.querySelector('.ws-gen-btn');
    const gr = gen.getBoundingClientRect();
    out.genBtn = { w: Math.round(gr.width), h: Math.round(gr.height), visible: gr.top >= 0 && gr.bottom <= innerHeight + 40 };
    const script = document.querySelector('.ws-script');
    out.scriptW = Math.round(script.getBoundingClientRect().width);
    const refPanel = document.querySelector('.ws-ref').getBoundingClientRect();
    out.refPanel = { w: Math.round(refPanel.width), h: Math.round(refPanel.height) };
    const quick = document.querySelectorAll('.ws-ref-quick button');
    out.quickBtns = quick.length + 'x' + Math.round(quick[0].getBoundingClientRect().height);
    const save = document.getElementById('wsSaveState').getBoundingClientRect();
    out.saveVisible = save.right <= innerWidth && save.width > 0;
    out.viewport = innerWidth + 'x' + innerHeight;
    return JSON.stringify(out);
  })()`;

  for (const [w, h] of [[1680, 1050], [1440, 900], [1100, 900]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await wait(500);
    console.log('viewport ' + w + 'x' + h + ':', await ev(audit(), page));
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });