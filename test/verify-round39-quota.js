'use strict';
/* 第三十九轮回归(智谱 CogView-3-Flash 接入 + 免费额度余量标注)
 * A. 额度统计口径:隔离库(DATA_DIR)单测 server/quota.js —— 生图按 params.count 计张、
 *    视频按 params.duration 计秒、非成功任务不计、未登记/非法 rules 不报错、耗尽置 exhausted。
 * B. 真实库 API 契约:/api/styles/models 与 /api/images/models 的 free_quota 字段
 *    (与直接 SQL 统计交叉核对,并确认百炼 6 个免费额度模型全部登记)。
 * C. 界面(无头 Chrome):生图页模型下拉与模型提示行显示余量、管理端「积分」列显示额度、
 *    共享文案函数 modelOptionLabel 的视频形态。
 * 全程不调用任何付费模型,也不提交真实生成任务。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT || 3088);
const BASE = 'http://127.0.0.1:' + PORT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-round39-'));
const SHOT_DIR = path.join(__dirname, 'shots-v39');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- A. 额度统计口径(隔离库) ---------------- */
function partA() {
  console.log('== A. server/quota.js 统计口径(隔离库 ' + TMP + ') ==');
  const { db } = require('../server/db');
  const { freeQuota, quotaIndex } = require('../server/quota');
  const now = Date.now();
  const insModel = db.prepare('INSERT INTO models(id,name,type,rules,is_free,enabled,created_at) VALUES(?,?,?,?,?,?,?)');
  const insTask = db.prepare("INSERT INTO tasks(id,user_id,type,model_id,params,status,cost,created_at) VALUES(?,?,?,?,?,?,0,?)");
  const m = (id, rules, type, is_free) => { insModel.run(id, id, type || 'text-to-image', rules, is_free == null ? 1 : is_free, 1, now); return db.prepare('SELECT * FROM models WHERE id=?').get(id); };
  const t = (modelId, params, status) => insTask.run('t-' + Math.random().toString(36).slice(2, 10), 'u-admin', 'text-to-image', modelId, JSON.stringify(params), status || 'completed', now);

  const img = m('q-img', JSON.stringify({ quota: { total: 10, unit: 'image' } }));
  t('q-img', { count: 3 }); t('q-img', { count: 1 }); t('q-img', { count: 5 }, 'failed'); t('q-img', { count: 5 }, 'cancelled');
  const q1 = freeQuota(img);
  ok('生图按 params.count 累加,失败/取消任务不计', q1.used === 4 && q1.remaining === 6 && q1.unit_text === '张', q1);

  const vid = m('q-vid', JSON.stringify({ quota: { total: 30 } }), 'image-to-video');
  t('q-vid', { duration: 2 }); t('q-vid', { duration: 5 }); t('q-vid', {});
  const q2 = freeQuota(vid);
  ok('视频按 duration 计秒 · unit 缺省按类型推断为秒', q2.unit === 'second' && q2.used === 7 && q2.remaining === 23, q2);

  const over = m('q-over', JSON.stringify({ quota: { total: 2, unit: 'image' } }));
  t('q-over', { count: 1 }); t('q-over', { count: 1 }); t('q-over', { count: 1 });
  const q3 = freeQuota(over);
  ok('超出登记额度时 remaining 归零并置 exhausted', q3.used === 3 && q3.remaining === 0 && q3.exhausted === true, q3);

  ok('未登记 quota 的免费模型 → declared:false', freeQuota(m('q-none', '{}')).declared === false);
  ok('rules 非法 JSON 不抛异常', freeQuota(m('q-bad', '{not json')).declared === false);
  ok('quota.total 为 0/负数/非数字 → 视为未登记',
    freeQuota(m('q-zero', JSON.stringify({ quota: { total: 0 } }))).declared === false
    && freeQuota(m('q-nan', JSON.stringify({ quota: { total: 'abc' } }))).declared === false);
  ok('非免费模型一律不返回额度', freeQuota(m('q-paid', JSON.stringify({ quota: { total: 5 } }), 'text-to-image', 0)) === null);
  const idx = quotaIndex([img, vid, m('q-none2', '{}')]);
  ok('quotaIndex 一次返回多模型且跳过未登记', idx.size === 2 && idx.get('q-img').total === 10 && idx.get('q-none2') === undefined, [...idx.keys()]);
}

/* ---------------- B. 真实库 API 契约 ---------------- */
async function partB() {
  console.log('== B. 模型列表接口 free_quota(真实库 @' + PORT + ') ==');
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  if (!login.ok) throw new Error('管理员登录失败 HTTP ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const get = async url => {
    const r = await fetch(BASE + url, { headers: { Cookie: cookie } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(url + ' → ' + (j.error || r.status));
    return j;
  };
  const all = (await get('/api/styles/models')).items;
  const imgs = (await get('/api/images/models')).items;
  const byName = n => all.find(x => x.name === n);

  const wan = byName('百炼 Wan3.0-Video（免费额度）');
  ok('百炼视频模型登记 30 秒额度', !!(wan && wan.free_quota && wan.free_quota.declared && wan.free_quota.total === 30 && wan.free_quota.unit_text === '秒'), wan && wan.free_quota);
  const q = wan.free_quota;
  ok('remaining = total - used 且不为负', q.remaining === Math.max(0, q.total - q.used) && q.remaining >= 0, q);

  for (const name of ['百炼 Qwen-Image 3.0（免费额度）', '百炼 Qwen-Image 3.0 Pro（免费额度）',
    '百炼 Qwen-Image 2.1 Pro（免费额度）', '百炼 Qwen-Image 2.1 Turbo（免费额度）']) {
    const mm = byName(name);
    ok(name + ' → 10 张额度已登记', !!(mm && mm.free_quota && mm.free_quota.declared && mm.free_quota.total === 10), mm && mm.free_quota);
    const im = imgs.find(x => x.id === (mm && mm.id));
    ok('  生图列表与模型列表的余量一致', !!im && im.free_quota && im.free_quota.used === mm.free_quota.used, { styles: mm.free_quota, images: im && im.free_quota });
  }
  const cv = byName('智谱 CogView-3-Flash（免费）');
  ok('CogView-3-Flash 已注册且标记免费', !!cv && cv.is_free === 1 && cv.model_id === 'cogview-3-flash', cv && { is_free: cv.is_free, model_id: cv.model_id });
  ok('未登记额度的免费模型 → declared:false(界面显示「未登记额度」)', cv.free_quota && cv.free_quota.declared === false, cv.free_quota);
  ok('付费模型不带 free_quota', (byName('gpt-image-2') || {}).free_quota == null);

  /* 交叉核对:接口 used 与直接 SQL 统计一致(只读连接,不碰服务的迁移逻辑) */
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'), { readOnly: true });
  for (const mm of all.filter(x => x.is_free && x.free_quota && x.free_quota.declared)) {
    const rows = db.prepare("SELECT params FROM tasks WHERE status='completed' AND model_id=?").all(mm.id);
    let expect = 0;
    for (const r of rows) {
      const p = JSON.parse(r.params || '{}');
      expect += mm.free_quota.unit === 'image' ? Math.max(1, Number(p.count) || 1) : Math.max(0, Math.floor(Number(p.duration) || 0));
    }
    ok('SQL 交叉核对 ' + mm.name, expect === mm.free_quota.used, { expect, api: mm.free_quota.used });
  }
  db.close();
}

/* ---------------- C. 界面 ---------------- */
async function partC() {
  console.log('== C. 界面标注(无头 Chrome) ==');
  const port = 9499;
  const chrome = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=' + path.join(TMP, 'chrome'), '--remote-debugging-port=' + port, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(300);
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find(p => p.type === 'page');
    } catch (e) { /* Chrome 还没起来 */ }
  }
  if (!target) throw new Error('无法连接无头 Chrome');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const f = pending.get(msg.id); pending.delete(msg.id); f(msg); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(String((msg.params.exceptionDetails.exception || {}).description || msg.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(res => { const id = ++msgId; pending.set(id, m => res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  await new Promise(r => ws.onopen = r);
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');

  /* 登录(同域 fetch 拿到会话 Cookie 后整页重载,应用才会以已登录态启动) */
  await send('Page.navigate', { url: BASE + '/' });
  await wait(1800);
  const code = await ev(`(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@videoforge.cn',password:'admin123'})});return r.status})()`);
  ok('浏览器内登录成功', code === 200, code);

  /* 生图页:带 query 的整页导航(同文档 hash 跳转 + reload 会抢在 hash 生效前重载到首页) */
  await send('Page.navigate', { url: BASE + '/?v39=1#/images' });
  await wait(3200);
  const opts = await ev(`Array.from(document.querySelectorAll('#igModel option')).map(o=>o.textContent)`);
  const wan3 = opts.find(x => x.indexOf('百炼 Qwen-Image 3.0（免费额度）') === 0);
  ok('生图页模型下拉带余量', !!wan3 && /剩 \d+\/10张/.test(wan3), wan3);
  const freeNoQuota = opts.find(x => x.indexOf('智谱 CogView-3-Flash') === 0);
  ok('名称已含「免费」的模型不再重复标注,未登记额度时文案原样', freeNoQuota === '智谱 CogView-3-Flash（免费）', freeNoQuota);
  /* 默认选中的是「本地占位生图」(未登记额度) → 提示行本就无额度;切到百炼模型再看 */
  await ev(`(function(){var s=document.querySelector('#igModel');
    var o=Array.from(s.options).find(function(x){return x.textContent.indexOf('百炼 Qwen-Image 3.0（免费额度）')===0;});
    if(!o)return 'no-option'; s.value=o.value; s.dispatchEvent(new Event('change')); return s.value;})()`);
  await wait(1200);
  const hint = await ev(`(document.querySelector('#igModelHint')||{}).textContent`);
  ok('切到有登记额度的模型 → 提示行显示额度与平台内已用', /额度剩 \d+\/10张\(平台内已用 \d+张\)/.test(hint || ''), hint);
  await send('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFileSync(path.join(SHOT_DIR, 'images-page.png'), Buffer.from(s.data, 'base64')));

  /* 共享文案函数的两种形态(工作台视频下拉与生图下拉走同一条路径) */
  const label = await ev(`modelOptionLabel({name:'Wan3.0-Video',is_free:1,free_quota:{declared:true,total:30,used:17,remaining:13,unit_text:'秒'}})`);
  ok('名称不含「免费」→ 名称(免费 · 剩 13/30秒)', label === 'Wan3.0-Video(免费 · 剩 13/30秒)', label);
  const label2 = await ev(`modelOptionLabel({name:'百炼 Wan3.0-Video（免费额度）',is_free:1,free_quota:{declared:true,total:30,used:17,remaining:13,unit_text:'秒'}})`);
  ok('名称已含「免费」→ 只追加余量,不重复标注', label2 === '百炼 Wan3.0-Video（免费额度） · 剩 13/30秒', label2);
  const paid = await ev(`modelOptionLabel({name:'gpt-image-2',is_free:0,free_quota:null})`);
  ok('付费模型下拉文案不变', paid === 'gpt-image-2', paid);

  /* 管理端模型管理 */
  await send('Page.navigate', { url: BASE + '/#/admin' });
  await send('Page.reload');
  await wait(3200);
  await ev(`(function(){var b=document.querySelector('.tab[data-tab="models"]');b&&b.click();})()`);
  await wait(1800);
  const cells = await ev(`Array.from(document.querySelectorAll('table tbody tr')).map(tr=>{var t=tr.querySelector('td:nth-child(5)');return t?t.textContent.replace(/\\s+/g,' ').trim():''}).filter(Boolean)`);
  const wanCell = cells.find(x => x.indexOf('免费') === 0 && x.indexOf('额度 剩') > 0);
  ok('管理端「积分」列显示额度余量', !!wanCell, cells.slice(0, 6));
  const unregCell = cells.find(x => /未登记额度/.test(x));
  ok('未登记额度的免费模型显示「未登记额度」', !!unregCell, unregCell);
  /* tooltip 里含 JSON 引号:若属性被引号截断,getAttribute 就拿不到完整 title */
  const tip = await ev(`(function(){var ss=Array.from(document.querySelectorAll('table tbody tr td:nth-child(5) span[title]'));
    var s=ss.find(function(x){return /quota/.test(x.getAttribute('title')||'')});return s?s.getAttribute('title'):''})()`);
  ok('额度 tooltip 的 title 属性完整(含 quota JSON)', /"quota":\{"total":30,"unit":"second"\}/.test(tip || ''), tip);
  const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  ok('页面无横向溢出', Number(overflow) <= 2, overflow);
  ok('无未捕获异常', errors.length === 0, errors.slice(0, 3));
  await send('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFileSync(path.join(SHOT_DIR, 'admin-quota.png'), Buffer.from(s.data, 'base64')));
  try { chrome.kill('SIGKILL'); } catch (e) {}
}

async function main() {
  process.env.DATA_DIR = TMP;      /* A 段用隔离库;B/C 段走 HTTP 读真实库 */
  partA();
  delete process.env.DATA_DIR;
  await partB();
  await partC();
  console.log('\n通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项(截图见 ' + SHOT_DIR + ')');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('运行失败:', e && e.stack || e); process.exit(1); });
