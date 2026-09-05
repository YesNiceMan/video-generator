'use strict';
/* 分镜设计工作台渲染验证:登录 demo → 进入 p-demo/e-01 工作台 → 截图 + DOM 断言 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9340;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-studio',
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

  async function shot(name, hash, checks) {
    const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:3088/' + hash)}`, { method: 'PUT' })).json();
    const page = cdpConnect(tab.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await wait(2000);
    await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(3500);
    const evalRes = await page.send('Runtime.evaluate', {
      expression: `JSON.stringify(${checks})`,
      returnByValue: true
    });
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shotFile.data, 'base64'));
    console.log('[' + name + ']', evalRes.result.value);
    page.ws.close();
  }

  // 1) 分镜设计工作台(空参考 + 空记录)
  await shot('studio-storyboard', '#/projects/p-demo/episode/e-01', `(() => {
    const q = s => document.querySelector(s);
    return {
      ws: !!q('.ws'),
      epNo: q('.ws-ep-no') && q('.ws-ep-no').textContent,
      epEn: q('.ws-ep-en') && q('.ws-ep-en').textContent,
      activeTab: q('.ws-tab.active') && q('.ws-tab.active').textContent,
      mode: q('.ws-mode-btn.active') && q('.ws-mode-btn.active').textContent,
      toolbar: [...document.querySelectorAll('.ws-tbtn')].map(b => b.textContent.trim()).join('|'),
      refTitle: q('.ws-ref-title') && q('.ws-ref-title').textContent,
      refEmpty: q('.ws-ref-empty') && q('.ws-ref-empty').textContent.replace(/\\s+/g, ' ').trim().slice(0, 30),
      quickBtns: [...document.querySelectorAll('.ws-ref-quick button')].map(b => b.textContent).join(','),
      cardTabs: [...document.querySelectorAll('.ws-card-tab')].map(b => b.textContent).join('|'),
      cardTitle: q('.ws-card-title') && q('.ws-card-title').textContent,
      placeholder: q('.ws-script') && q('.ws-script').placeholder,
      genBtn: q('.ws-gen-btn') && q('.ws-gen-btn').textContent,
      points: q('.ws-points') && q('.ws-points').textContent.trim(),
      previewEmpty: q('.ws-preview-empty') && q('.ws-preview-empty').textContent.trim(),
      addShot: q('.ws-add-shot') && q('.ws-add-shot').textContent.trim(),
      modelOpts: q('[data-shot-model]') ? q('[data-shot-model]').options.length : 0,
      styleOpts: q('[data-shot-style]') ? q('[data-shot-style]').options.length : 0,
      err: (window.__err || '')
    };
  })()`);

  // 2) 完整版切换
  await shot('studio-full', '#/projects/p-demo/episode/e-01', `(() => {
    const btn = [...document.querySelectorAll('.ws-mode-btn')].find(b => b.textContent === '完整版');
    if (btn) btn.click();
    const adv = document.querySelector('[data-adv]');
    return { advVisible: adv && !adv.classList.contains('hidden'), mode: document.querySelector('.ws-mode-btn.active') && document.querySelector('.ws-mode-btn.active').textContent };
  })()`);

  // 3) 加一个分镜
  await shot('studio-addshot', '#/projects/p-demo/episode/e-01', `(() => {
    document.querySelector('[data-ws-action="addshot"]').click();
    return { shots: document.querySelectorAll('.ws-card').length, titles: [...document.querySelectorAll('.ws-card-title')].map(t => t.textContent).join(',') };
  })()`);

  console.log('\n截图已保存到 test/shots/');
  process.exit(0);
}

main().catch(e => { console.error('验证失败:', e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
