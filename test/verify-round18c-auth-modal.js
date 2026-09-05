'use strict';
/* 十八轮补充:登录页双模式 + 弹层(#modalRoot)ws 变量浅色覆盖检查 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9363;
const SHOT_DIR = path.join(__dirname, 'shots');
const PROFILE = '/tmp/vf-chrome-profile-r18c-' + Date.now();
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
async function main() {
  let version;
  for (let i = 0; i < 40; i++) { try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); } }
  if (!version) throw new Error('chrome not ready');
  async function shot(name, hash, scheme, expr) {
    const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/' + hash), { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable'); await page.send('Runtime.enable');
    await wait(1000);
    if (scheme) await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","' + scheme + '")}catch(e){}', returnByValue: true });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(3600);
    const r = await page.send('Runtime.evaluate', { expression: 'JSON.stringify(' + expr + ')', returnByValue: true });
    const sf = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(sf.data, 'base64'));
    console.log('[' + name + '] ' + r.result.value);
    page.ws.close();
  }
  const loginExpr = '(() => { const c = document.querySelector(".auth-card"); return { scheme: document.documentElement.dataset.scheme, bodyBg: getComputedStyle(document.body).backgroundColor, card: c ? getComputedStyle(c).backgroundColor : null, titleGrad: (t => t ? getComputedStyle(t).backgroundImage.slice(0, 70) : null)(document.querySelector(".auth-title")) }; })()';
  await shot('r18c-login-dark', '#/login', 'dark', loginExpr);
  await shot('r18c-login-light', '#/login', 'light', loginExpr);
  // 登录后打开积分中心弹窗,检查 #modalRoot 的 ws 变量
  const login = await fetch('http://localhost:3088/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' }) });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable'); await page.send('Runtime.enable'); await page.send('Network.enable');
  await wait(1000);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Runtime.evaluate', { expression: 'try{localStorage.setItem("vf-scheme","light")}catch(e){}', returnByValue: true });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(4200);
  const modal = await page.send('Runtime.evaluate', {
    expression: '(async () => { document.getElementById("creditChip").click(); await new Promise(r => setTimeout(r, 900));' +
      'const root = document.getElementById("modalRoot"); const cs = getComputedStyle(root);' +
      'const m = document.querySelector(".modal");' +
      'return JSON.stringify({ modalGold: cs.getPropertyValue("--ws-gold").trim(), modalBg: m ? getComputedStyle(m).backgroundColor : null }); })()',
    returnByValue: true
  });
  console.log('[modal-light]', modal.result.value);
  const sf = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'r18c-modal-light.png'), Buffer.from(sf.data, 'base64'));
  page.ws.close();
  console.log('DONE');
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
