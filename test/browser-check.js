'use strict';
/* 浏览器渲染验证:通过 CDP 驱动本机 Chrome 无头模式截图各页面 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9340;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-v',
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

async function loginToken(email, password) {
  const res = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  const demoToken = await loginToken('demo@videoforge.cn', 'demo123');
  const adminToken = await loginToken('admin@videoforge.cn', 'admin123');

  const pages = [
    ['dashboard', '#/', demoToken],
    ['redirect-create', '#/create', demoToken],
    ['assets', '#/assets', demoToken],
    ['projects', '#/projects', demoToken],
    ['styles', '#/styles', demoToken],
    ['admin', '#/admin', adminToken],
    ['login', '#/login', null]
  ];

  for (const [name, hash, token] of pages) {
    const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:3088/' + hash)}`, { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await wait(2200);
    if (token) {
      await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
      await page.send('Page.reload', { ignoreCache: true });
      await wait(3400);
    }
    const evalRes = await page.send('Runtime.evaluate', {
      expression: `JSON.stringify({ user: typeof App!=='undefined' && App.user ? App.user.email : 'NOT_SET', viewErr: (document.querySelector('#view').innerText||'').slice(0,60), appVisible: !document.getElementById('app').classList.contains('hidden') })`,
      returnByValue: true
    });
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log(`[${name}]`, evalRes.result.value);
    page.ws.close();
  }

  console.log('\n截图已保存到 test/shots/');
}

main().catch(e => { console.error('验证失败:', e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
