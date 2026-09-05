'use strict';
/* UI 改版验证:黑金配色 + 三级面包屑 + 首页精简(仪表盘/项目分集) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9343;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-v2',
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
    await wait(1800);
    await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
    await page.send('Page.reload', { ignoreCache: true });
    await wait(3600);
    const evalRes = await page.send('Runtime.evaluate', {
      expression: `JSON.stringify(${checks})`,
      returnByValue: true
    });
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shotFile.data, 'base64'));
    console.log('[' + name + ']');
    console.log(evalRes.result.value);
    console.log('');
    page.ws.close();
  }

  // 1) 首页:欢迎区 + 统计 + 项目分集(无最近任务/快捷操作)
  await shot('v2-dashboard', '#/', `(() => {
    const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    return {
      hero: !!q('.dash-hero'),
      heroTitle: q('.dh-title') && q('.dh-title').textContent,
      storage: !!q('.dh-storage'),
      statCards: qa('.stat-card .stat-label').map(x => x.textContent),
      projHead: q('.dph-title') && q('.dph-title').textContent,
      projCards: qa('.dash-proj-card .dp-name').map(x => x.textContent),
      hasNewCard: !!q('#dashNewProject'),
      noRecentTasks: !document.body.textContent.includes('最近生成任务'),
      noQuickOps: !document.body.textContent.includes('快捷操作'),
      navItems: qa('#nav .nav-item').map(a => a.textContent.trim()),
      topUser: q('#topUserName') && q('#topUserName').textContent,
      projSwitch: q('#projSwitchName') && q('#projSwitchName').textContent,
      bg: getComputedStyle(document.body).backgroundColor,
      accentVar: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      accent2Var: getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim(),
      err: (window.__err || '')
    };
  })()`);

  // 2) 项目列表页:面包屑 L1
  await shot('v2-projects', '#/projects', `(() => {
    const q = s => document.querySelector(s);
    const c = q('.crumb');
    return {
      crumb: c && c.textContent.replace(/\\s+/g, ' ').trim(),
      curIsProjects: !!q('.crumb .crumb-cur') && q('.crumb .crumb-cur').textContent.includes('项目分集'),
      cards: document.querySelectorAll('#projGrid .card').length,
      bg: getComputedStyle(document.body).backgroundColor
    };
  })()`);

  // 3) 分集列表(工作台):面包屑 L2
  await shot('v2-workbench', '#/projects/p-demo', `(() => {
    const q = s => document.querySelector(s);
    const c = q('.wb-crumb');
    const link = c && c.querySelector('a');
    return {
      crumbLinkText: link && link.textContent,
      crumbLinkHref: link && link.getAttribute('href'),
      crumbCur: c && c.querySelector('b') && c.querySelector('b').textContent,
      epCards: document.querySelectorAll('.wb-card.wb-ep').length,
      totalChip: q('.wb-total-chip') && q('.wb-total-chip').textContent.trim()
    };
  })()`);

  // 4) 视频创作工作台:面包屑 L3 + 原有元素完好
  await shot('v2-studio', '#/projects/p-demo/episode/e-01', `(() => {
    const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
    const c = q('.crumb.in-ws');
    return {
      crumbLinks: c ? qa.call(c, 'a').map(a => a.textContent) : [],
      crumbHrefs: c ? [...c.querySelectorAll('a')].map(a => a.getAttribute('href')) : [],
      crumbCur: c && q('.crumb.in-ws .crumb-cur') && q('.crumb.in-ws .crumb-cur').textContent.replace(/\\s+/g,' ').trim(),
      epNo: q('.ws-ep-no') && q('.ws-ep-no').textContent,
      tabs: qa('.ws-tab').map(b => b.textContent),
      genBtn: q('.ws-gen-btn') && q('.ws-gen-btn').textContent,
      addShot: q('.ws-add-shot') && q('.ws-add-shot').textContent.trim(),
      wsBg: q('.ws') && getComputedStyle(q('.ws')).backgroundColor,
      refTitle: q('.ws-ref-title') && q('.ws-ref-title').textContent
    };
  })()`);

  console.log('截图已保存到 test/shots/v2-*.png');
  process.exit(0);
}

main().catch(e => { console.error('验证失败:', e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });
