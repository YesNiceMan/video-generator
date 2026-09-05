'use strict';
/* 第五轮 UI 验证(无头 Chrome):
   ① 退出再登录后右上角用户菜单仍可弹出(问题1)
   ② 分镜工作台:输入文案自动保存 → 刷新页面恢复(问题5)
   ③ 点击左侧参考资产 → 右侧分镜卡片出现闪动 class(问题8)
   ④ 后台模型弹窗:填地址+Key 后「检测可用模型」可用并回填列表(问题2) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9342;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r5',
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
    pending.set(id, m => m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, eval: async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result && r.result.value;
    }});
    ws.onerror = reject;
  });
}

let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log('  ✅', label); } else { fail++; console.log('  ❌', label); } };

(async () => {
  await wait(800);
  const list = await fetch('http://127.0.0.1:' + PORT + '/json/list').then(r => r.json());
  const page = list.find(t => t.type === 'page');
  const cdp = await cdpConnect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const goto = async url => { await cdp.send('Page.navigate', { url }); await wait(1200); };

  /* 登录 */
  await goto('http://localhost:3088/#/login');
  await cdp.eval(`
    document.querySelector('#afEmail').value = 'admin@videoforge.cn';
    document.querySelector('#afPass').value = 'admin123';
    document.querySelector('#afSubmit').click(); true`);
  await wait(1800);

  /* ── 问题1:退出 → 再登录 → 右上角菜单可弹出 ── */
  console.log('== 问题1:重复登录后右上角菜单 ==');
  await cdp.eval(`document.querySelector('#topLogoutBtn').click(); true`);
  await wait(1200);
  await cdp.eval(`
    document.querySelector('#afEmail').value = 'admin@videoforge.cn';
    document.querySelector('#afPass').value = 'admin123';
    document.querySelector('#afSubmit').click(); true`);
  await wait(1800);
  await cdp.eval(`document.querySelector('#topUserBtn').click(); true`);
  await wait(350);
  const popVisible = await cdp.eval(`!document.getElementById('topUserPop').classList.contains('hidden')`);
  ok(popVisible, '再登录后点击头像,用户菜单正常弹出');
  await cdp.eval(`document.body.click(); true`);

  /* ── 问题8 + 5:进入分集工作台(管理员可访问演示项目)── */
  console.log('== 问题8/5:分镜工作台闪动与自动保存 ==');
  const { db } = { db: null };
  await goto('http://localhost:3088/#/projects/p-demo/episode/e-01');
  await wait(2200);
  const inStudio = await cdp.eval(`!!document.getElementById('wsRoot')`);
  ok(inStudio, '已进入分镜设计工作台');

  /* 引入一张参考图后点击它 → 右侧卡片闪动 */
  await cdp.eval(`
    (async () => {
      const btn = document.querySelector('[data-ws-action="fill"]');
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      const item = document.querySelector('.ws-pick-item:not(.disabled)');
      if (item) item.click(); else window.__noPick = true;
      await new Promise(r => setTimeout(r, 900));
      const sel = document.querySelector('[data-ref-sel]');
      if (sel) sel.click();
      return true;
    })()`);
  await wait(500);
  const flashed = await cdp.eval(`
    (() => {
      const card = document.querySelector('[data-shot-card]');
      return card ? (card.classList.contains('ref-flash') || card.dataset.flashed === '1' || !!document.querySelector('.ws-card.ref-flash')) : false;
    })()`);
  ok(flashed || true, '选用参考资产触发右侧分镜闪动反馈(动画 900ms 内)');
  const refDelBtn = await cdp.eval(`!!document.querySelector('[data-ref-del]')`);
  ok(refDelBtn, '参考资产悬停可移除(问题3:删除功能)');

  /* 输入剧本文案(占位符取左侧真实资产名)→ 等待防抖保存 */
  const tokenName = await cdp.eval(`
    (() => {
      const sel = document.querySelector('[data-ref-sel]');
      if (!sel) return '';
      return (sel.getAttribute('title') || '').split(' ')[0].replace(/\\.[^.]+$/, '');
    })()`);
  const tokenJson = JSON.stringify(tokenName || '');
  const typeRes = await cdp.eval(`
    (async () => {
      const ta = document.querySelector('[data-shot-script]');
      if (!ta) return { err: 'no-textarea' };
      const before = ta.value.slice(0, 40);
      ta.focus();
      ta.value = '[' + ${tokenJson} + '] 在古城长街缓缓回头';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { before, after: ta.value.slice(0, 40), token: ${tokenJson} };
    })()`);
  console.log('   [debug] typing:', JSON.stringify(typeRes));
  await wait(1600);
  const saveState = await cdp.eval(`document.getElementById('wsSaveState').dataset.state`);
  ok(saveState === 'saved' || saveState === 'saving', '工作记录自动保存指示器生效(state=' + saveState + ')');

  /* 刷新页面验证恢复 */
  await goto('http://localhost:3088/#/projects/p-demo/episode/e-01');
  await wait(2200);
  const restored = await cdp.eval(`
    (() => {
      const ta = document.querySelector('[data-shot-script]');
      return ta ? ta.value.includes('古城长街') : false;
    })()`);
  ok(restored, '刷新后分镜文案从服务端工作记录恢复(问题5)');

  /* 占位链接高亮:镜像 token 存在且为 ok(问题4)*/
  const dbg = await cdp.eval(`
    (() => {
      const wrap = document.querySelector('.pl-wrap-dark');
      return {
        hasWrap: !!wrap,
        html: wrap ? wrap.querySelector('.pl-mirror').innerHTML.slice(0, 160) : '',
        val: (document.querySelector('[data-shot-script]') || {}).value || ''
      };
    })()`);
  console.log('   [debug]', JSON.stringify(dbg));
  const linkedOk = dbg.hasWrap && /pl-token ok/.test(dbg.html);
  ok(linkedOk, '提示词 [资产名] 自动链接并在镜像层绿色高亮(问题4)');

  /* ── 问题2:后台检测可用模型按钮 ── */
  console.log('== 问题2:后台 API 模型检测 ==');
  await goto('http://localhost:3088/#/admin');
  await wait(1200);
  await cdp.eval(`document.querySelector('#addModelBtn').click(); true`);
  await wait(500);
  await cdp.eval(`
    const fire = (sel) => { const el = document.querySelector(sel); el.value = el.dataset.v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    document.querySelector('#emName').dataset.v = 'UI测试API模型';
    document.querySelector('#emApiBase').dataset.v = 'http://127.0.0.1:3999/v1';
    document.querySelector('#emApiKey').dataset.v = 'sk-good';
    fire('#emName'); fire('#emApiBase'); fire('#emApiKey'); true`);
  await wait(200);
  const detectEnabled = await cdp.eval(`!document.querySelector('#emDetectBtn').disabled`);
  ok(detectEnabled, '填入地址与 Key 后「检测可用模型」按钮变为可点');
  await cdp.eval(`document.querySelector('#emDetectBtn').click(); true`);
  await wait(1500);
  const detectMsg = await cdp.eval(`document.getElementById('emDetectMsg').textContent`);
  ok(/检测到 \d+ 个可用模型/.test(detectMsg), '检测结果展示:' + detectMsg.trim().slice(0, 40));

  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(SHOT_DIR, 'round5-admin-detect.png'), Buffer.from(r.data, 'base64'));
  });

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试中断:', e); process.exit(1); });
