'use strict';
/* 第四十轮回归(模型计费/额度可手动设置 + 参数模板键名统一)
 * A. 隔离实例(PORT=3097 + DATA_DIR 临时库,跑本轮新代码):
 *    - POST /api/admin/models 直接带 is_free=1 落库(此前该字段只能建完改库)
 *    - PATCH 切换 is_free / credit_per_second,生图提交的实际扣分随之变化
 *    - rules.quota 登记与取消登记 → 列表接口 free_quota 的 used/remaining 正确
 *    - 全程只用本地占位生图(img-ffmpeg),不碰任何外部网关
 * B. 真实页面(3088,静态前端已即时生效):
 *    - 画幅比例控件对 aspect_ratio 与 ratio 两种键名都能渲染(本轮修复的根因)
 *    - 后台编辑器:计费方式回显、免费额度显隐、分辨率档回显、参数模板预览键名
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIVE = 'http://127.0.0.1:' + (process.env.PORT || 3088);
const ISO_PORT = 3097;
const ISO = 'http://127.0.0.1:' + ISO_PORT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-round40-'));
const SHOT_DIR = path.join(__dirname, 'shots-v40');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

async function loginAt(base) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  if (!r.ok) throw new Error('登录失败 ' + base + ' HTTP ' + r.status);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
function mkApi(base, cookie) {
  return async (method, url, body) => {
    const res = await fetch(base + '/api' + url, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000)
    });
    const text = await res.text();
    let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) { }
    if (!res.ok) throw new Error(method + ' ' + url + ' → HTTP ' + res.status + ' ' + text.slice(0, 200));
    return data;
  };
}

/* ---------------- A. 隔离实例:计费与额度可手动设置 ---------------- */
async function partA() {
  console.log('== A. 隔离实例(新代码 @' + ISO_PORT + ',临时库) ==');
  const proc = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')],
    { env: Object.assign({}, process.env, { PORT: String(ISO_PORT), DATA_DIR: TMP }), stdio: 'ignore' });
  process.on('exit', () => { try { proc.kill('SIGKILL'); } catch (e) { } });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await wait(500);
    try { up = !!(await (await fetch(ISO + '/api/health')).ok); } catch (e) { }
  }
  if (!up) throw new Error('隔离实例启动失败');
  const api = mkApi(ISO, await loginAt(ISO));
  const models = () => api('GET', '/styles/models');

  /* 1) 新建时直接带 is_free */
  const created = await api('POST', '/admin/models', {
    name: 'R40 免费占位生图', type: 'text-to-image', api_base: '', model_id: '',
    caps: ['text-to-image'], max_count: 2, is_free: 1,
    rules: { protocol: 'img-ffmpeg', quota: { total: 3, unit: 'image' } }
  });
  const mid = created.model.id;
  ok('POST /admin/models 支持 is_free=1(不再只能建完改库)', created.model.is_free === 1, created.model.is_free);
  let row = (await models()).items.find(x => x.id === mid);
  ok('新模型 free_quota 已登记 total=3', row.free_quota && row.free_quota.declared && row.free_quota.total === 3 && row.free_quota.used === 0, row.free_quota);

  /* 2) 提交任务 → 免费不扣分,已用量按成功任务累加 */
  const gen = await api('POST', '/images/generate', { model_id: mid, prompt: '第四十轮回归:一只纸船漂在静水面上', count: 2, aspect_ratio: '1:1', resolution: '1K' });
  ok('免费模型提交 cost=0', gen.credits.cost === 0 && gen.credits.perImage === 0, gen.credits);
  let task = gen.task;
  for (let i = 0; i < 40 && !['completed', 'failed', 'cancelled'].includes(task.status); i++) {
    await wait(1500);
    task = (await api('GET', '/tasks/' + gen.task.id)).task;
  }
  ok('本地占位生图任务完成(不外呼网关)', task.status === 'completed', { status: task.status, error: task.error });
  row = (await models()).items.find(x => x.id === mid);
  ok('成功任务按张数计入已用(count=2 → used=2)', row.free_quota.used === 2 && row.free_quota.remaining === 1, row.free_quota);

  /* 3) 手动切成按积分 → 单价回落全局定价,且不再报额度 */
  const patched = await api('PATCH', '/admin/models/' + mid, { is_free: 0 });
  ok('PATCH is_free=0 生效', patched.model.is_free === 0, patched.model.is_free);
  row = (await models()).items.find(x => x.id === mid);
  ok('非免费模型不返回 free_quota', row.free_quota === null || row.free_quota === undefined, row.free_quota);
  const gen2 = await api('POST', '/images/generate', { model_id: mid, prompt: '第四十轮回归:改按积分后提交', count: 1, aspect_ratio: '1:1' });
  ok('改按积分后提交会真实扣分', gen2.credits.cost > 0, gen2.credits);
  const t2 = gen2.task.id;
  await api('POST', '/tasks/' + t2 + '/cancel').catch(() => { });

  /* 4) 额度登记/取消登记(编辑器保存时写的就是这两条路径) */
  const back = await api('PATCH', '/admin/models/' + mid, { is_free: 1 });
  ok('再切回免费', back.model.is_free === 1);
  const withQuota = (await models()).items.find(x => x.id === mid);
  ok('切回免费后额度余量恢复(used 仍为 2)', withQuota.free_quota && withQuota.free_quota.used === 2 && withQuota.free_quota.remaining === 1, withQuota.free_quota);
  const rules = Object.assign({}, withQuota.rules); delete rules.quota;
  await api('PATCH', '/admin/models/' + mid, { rules });
  const cleared = (await models()).items.find(x => x.id === mid);
  ok('清空额度输入 = 取消登记 → declared:false', cleared.free_quota && cleared.free_quota.declared === false, cleared.free_quota);

  /* 5) 视频模型的 unit 缺省按类型推断为秒 */
  const v = await api('POST', '/admin/models', {
    name: 'R40 免费占位视频', type: 'image-to-video', endpoint: 'local://ffmpeg/free',
    is_free: 1, rules: { quota: { total: 20 } },
    params_schema: [{ key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 8, step: 1, default: 2 }]
  });
  const vrow = (await models()).items.find(x => x.id === v.model.id);
  ok('视频模型 quota.unit 缺省 → 秒', vrow.free_quota && vrow.free_quota.unit === 'second' && vrow.free_quota.unit_text === '秒', vrow.free_quota);
  try { await api('DELETE', '/admin/models/' + v.model.id); } catch (e) { }
  proc.kill('SIGKILL');
}

/* ---------------- B. 真实页面:参数控件与编辑器 ---------------- */
async function partB() {
  console.log('== B. 参数模板键名统一 + 编辑器控件(真实页面 @3088) ==');
  const port = 9505;
  const chrome = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--user-data-dir=' + path.join(TMP, 'chrome'), '--remote-debugging-port=' + port, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) { } });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(300);
    try { target = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(p => p.type === 'page'); } catch (e) { }
  }
  if (!target) throw new Error('无法连接无头 Chrome');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++msgId; pending.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.onopen = r);
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');

  /* 双键读取(纯函数级) */
  await send('Page.navigate', { url: LIVE + '/' }); await wait(2000);
  const dual = await ev(`({
    ar: (ImagesView.ratioDef({params_schema:[{key:'aspect_ratio',options:['1:1','16:9']}]})||{}).options,
    old: (ImagesView.ratioDef({params_schema:[{key:'ratio',options:['1:1','4:3']}]})||{}).options,
    none: ImagesView.ratioDef({params_schema:[{key:'resolution',options:['1K']}]})
  })`);
  ok('ratioDef 认 aspect_ratio', JSON.stringify(dual.ar) === '["1:1","16:9"]', dual.ar);
  ok('ratioDef 兼容旧键 ratio', JSON.stringify(dual.old) === '["1:1","4:3"]', dual.old);
  ok('无比例清单时返回空(不硬造下拉)', !dual.none, dual.none);

  /* 生图页:两类模型都要能选出画幅比例 */
  await ev(`(async()=>{(await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@videoforge.cn',password:'admin123'})})).status})()`);
  await send('Page.navigate', { url: LIVE + '/?r40=1#/images' }); await wait(3200);
  /* 按前缀找不到就明确报错(模型名可能被管理员改过大小写，不能静默沿用上一个模型的读数) */
  const pick = async re => {
    const hit = await ev(`(function(){var s=document.querySelector('#igModel');
      var re=${JSON.stringify(re)};var rx=new RegExp(re,'i');
      var o=Array.from(s.options).find(function(x){return rx.test(x.textContent);});
      if(!o)return null; s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); return o.textContent;})()`);
    if (!hit) ok('下拉里找到模型 /' + re + '/', false, Array.from(await ev(`Array.from(document.querySelectorAll('#igModel option')).map(o=>o.textContent)`)).slice(0, 6));
    await wait(1200);
    return ev(`(function(){var r=document.querySelector('#igRatio'),rs=document.querySelector('#igRes');
      return {ratio:r?Array.from(r.options).map(function(o){return o.value}):null,
        res:rs?Array.from(rs.options).map(function(o){return o.value}):null,
        spec:(document.querySelector('#igSpecOut')||{}).textContent||''};})()`);
  };
  const cv = await pick('^智谱 CogView-3-Flash');
  ok('aspect_ratio 模型(智谱)生图页出现画幅比例', !!cv.ratio && cv.ratio.length === 5, cv);
  ok('智谱分辨率只剩合法单档 1K', JSON.stringify(cv.res) === '["1K"]', cv.res);
  const bl = await pick('^百炼 Qwen-Image 3.0（免费额度）');
  ok('aspect_ratio 模型(百炼)生图页出现画幅比例', !!bl.ratio && bl.ratio.length === 5, bl);
  const ag = await pick('^agnes-image-2\\.5-flash');
  ok('旧键 ratio 模型不受影响(8 档比例)', !!ag.ratio && ag.ratio.length === 8, ag.ratio);
  await send('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFileSync(path.join(SHOT_DIR, 'images-ratio.png'), Buffer.from(s.data, 'base64')));

  /* 后台编辑器:回显 + 控件联动(只读,不保存) */
  await send('Page.navigate', { url: LIVE + '/?r40b=1#/admin' }); await wait(3200);
  await ev(`(function(){var b=document.querySelector('.tab[data-tab="models"]');b&&b.click();})()`); await wait(1500);
  await ev(`(function(){var b=document.querySelector('[data-edit-model="m-c3e336b531429365"]');b&&b.click();})()`); await wait(1800);
  const ed = await ev(`(function(){var g=function(s){var n=document.querySelector(s);return n?n:null};
    var out={billing:(g('#emBilling')||{}).value, quotaHidden:(g('#emQuotaField')||{}).hidden,
      quotaTotal:(g('#emQuotaTotal')||{}).value, resTiers:(g('#emResTiers')||{}).value,
      cpsDisabled:(g('#emCps')||{}).disabled, cpsHint:(g('#emCpsHint')||{}).textContent,
      ratiosOn:Array.from(document.querySelectorAll('.em-size-tag[data-ratio].on')).map(function(t){return t.dataset.ratio}),
      preview:(g('#emSchemaOut')||{}).textContent};
    return out})()`);
  ok('编辑器回显计费方式=免费', ed.billing === 'free', ed.billing);
  ok('免费时显示额度登记输入', ed.quotaHidden === false && ed.quotaTotal === '', ed);
  ok('分辨率档回显与 rules 对齐(单档 1K)', ed.resTiers === '1K', ed.resTiers);
  ok('免费时积分输入禁用并说明不生效', ed.cpsDisabled === true && /不生效/.test(ed.cpsHint || ''), ed.cpsHint);
  ok('画幅比例标签从 aspect_ratio 键回显', ed.ratiosOn.length === 5, ed.ratiosOn);
  ok('参数模板预览用 aspect_ratio 键名', /aspect_ratio/.test(ed.preview || ''), ed.preview.slice(0, 160));
  /* 切到按积分:额度输入应隐藏 */
  const after = await ev(`(function(){var s=document.querySelector('#emBilling');s.value='paid';
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return {quotaHidden:document.querySelector('#emQuotaField').hidden, cpsDisabled:document.querySelector('#emCps').disabled};})()`);
  ok('切到「按积分」→ 额度输入隐藏、积分输入解禁', after.quotaHidden === true && after.cpsDisabled === false, after);
  await send('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFileSync(path.join(SHOT_DIR, 'editor-billing.png'), Buffer.from(s.data, 'base64')));
  await ev(`(function(){var b=document.querySelector('.modal-close, [data-close]');b&&b.click();})()`);
  const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  ok('页面无横向溢出', Number(overflow) <= 2, overflow);
  ok('无未捕获异常', errors.length === 0, errors.slice(0, 3));
  try { chrome.kill('SIGKILL'); } catch (e) { }
}

async function main() {
  await partA();
  await partB();
  console.log('\n通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项(截图见 ' + SHOT_DIR + ')');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('运行失败:', (e && e.stack) || e); process.exit(1); });
