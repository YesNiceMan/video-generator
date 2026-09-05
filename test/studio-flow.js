'use strict';
/* 交互流程验证:引入参考图 → 输入剧本 → 生成融生视频 → 预览出现记录 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-flow',
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

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];

  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:3088/#/projects/p-demo/episode/e-01')}`, { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await wait(2000);
  await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3500);

  const evalJs = async expr => {
    const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result.value;
  };

  // 1. 点击 +角色 → 打开素材选择弹窗 → 选择第一张图
  const pick = await evalJs(`(async () => {
    document.querySelector('[data-ref-pick="角色"]').click();
    await new Promise(r => setTimeout(r, 900));
    const items = [...document.querySelectorAll('.ws-pick-item')];
    if (!items.length) return 'NO_PICK_ITEMS';
    items[0].click();
    await new Promise(r => setTimeout(r, 600));
    const refs = document.querySelectorAll('.ws-ref-item');
    return JSON.stringify({ picked: items.length, refs: refs.length, name: refs[0] ? refs[0].querySelector('.ws-ref-name').textContent : '', tag: refs[0] ? refs[0].querySelector('.ws-ref-tag').textContent : '' });
  })()`);
  console.log('[pick-ref]', pick);

  // 2. 输入剧本 + 负向词 → 点击生成
  const gen = await evalJs(`(async () => {
    const ta = document.querySelector('[data-shot-script]');
    const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(ta, '古城长街,少年阿离在晨雾中醒来,镜头缓慢推近,电影质感');
    const neg = document.querySelector('[data-shot-neg]');
    const s2 = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s2.call(neg, '低清,模糊,水印'); neg.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-shot-gen]').click();
    await new Promise(r => setTimeout(r, 1200));
    const recs = document.querySelectorAll('.ws-rec');
    const btn = document.querySelector('[data-shot-gen]');
    return JSON.stringify({ recs: recs.length, btnText: btn.textContent, recInfo: recs[0] ? recs[0].querySelector('.ws-rec-title').textContent : '' });
  })()`);
  console.log('[generate]', gen);

  // 3. 等待任务完成 → 预览出现视频记录
  let done = false;
  for (let i = 0; i < 14; i++) {
    await wait(2500);
    const st = await evalJs(`(() => { const r = document.querySelector('.ws-rec'); return r ? r.textContent : ''; })()`);
    console.log('[poll' + i + ']', st.slice(0, 60));
    if (st.includes('已完成')) { done = true; break; }
  }
  const shotFile = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(SHOT_DIR, 'studio-generated.png'), Buffer.from(shotFile.data, 'base64'));
  console.log('[result]', done ? '任务完成,预览已刷新为视频记录' : '超时未完成');
  page.ws.close();
  process.exit(0);
}

main().catch(e => { console.error('验证失败:', e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
