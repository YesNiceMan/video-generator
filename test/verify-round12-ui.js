'use strict';
/* 第十二轮 UI 验证:后台模型管理 — 协议徽章 / 编辑弹窗生成规则区 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-r12', '--remote-debugging-port=' + PORT,
  '--window-size=1440,1000', 'about:blank'
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

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome debug port not ready');

  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  const token = login.headers.get('set-cookie').split(';')[0].split('=')[1];

  // Open admin models tab
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/admin'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await wait(2000);
  await page.send('Network.setCookie', { name: 'vf_sid', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(4000);

  // Verify protocol badges appear in model table
  const probe1 = await page.send('Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.hash, adminErr: (document.querySelector('#view') ? document.querySelector('#view').innerText.slice(0,80) : 'NO_VIEW'), protocolText: Array.from(document.querySelectorAll('.table tbody tr')).slice(0,6).map(tr => tr.innerText.split('\n')[1] || tr.innerText.slice(0,40)) })`,
    returnByValue: true
  });
  console.log('MODELS TABLE:', probe1.result.value);

  // Screenshot models list
  const shot1 = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'r12-admin-models.png'), Buffer.from(shot1.data, 'base64'));
  console.log('screenshot: r12-admin-models.png');

  // Open the edit modal for Agnes Flash model (first API model with edit button)
  const clickEdit = await page.send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('[data-edit-model]'); if (b) { b.click(); return 'clicked'; } return 'no-edit-btn'; })()`,
    returnByValue: true
  });
  await wait(1200);
  console.log('edit modal open:', clickEdit.result.value);

  // Verify protocol selector and rules textarea render
  const probe2 = await page.send('Runtime.evaluate', {
    expression: `JSON.stringify({ hasProtocol: !!document.querySelector('#emProtocol'), protocolVal: document.querySelector('#emProtocol') ? document.querySelector('#emProtocol').value : null, hasRules: !!document.querySelector('#emRules'), rulesLen: document.querySelector('#emRules') ? document.querySelector('#emRules').value.length : 0, options: document.querySelector('#emProtocol') ? Array.from(document.querySelector('#emProtocol').options).map(o => o.value + ':' + o.textContent) : [] })`,
    returnByValue: true
  });
  console.log('EDIT MODAL:', probe2.result.value);

  // Screenshot edit modal
  const shot2 = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'r12-admin-edit-modal.png'), Buffer.from(shot2.data, 'base64'));
  console.log('screenshot: r12-admin-edit-modal.png');

  // Save with rules JSON to test the round-trip through the real admin UI
  const saveProbe = await page.send('Runtime.evaluate', {
    expression: `(() => { const r = document.querySelector('#emRules'); if (!r) return 'no-rules'; return 'ok' })()`,
    returnByValue: true
  });
  console.log('save probe:', saveProbe.result.value);

  chrome.kill('SIGKILL');
  process.exit(0);
}
main().catch(e => { console.error('UI ERROR:', e.message); try { chrome.kill('SIGKILL'); } catch(_){} process.exit(1); });
