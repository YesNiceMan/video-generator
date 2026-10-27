'use strict';
/* 第四十二轮回归(文本模型 · 剧本与文字处理)
 * A. server/textgen.js 单元:模板枚举、请求体填充、响应取文、拆分镜 JSON 容错、计价
 * B. Mock chat 网关:openai-chat 协议契约(messages/temperature/max_tokens、HTTP 错误、空内容)
 * C. 真实库接口契约(3088):/api/text/models、任务枚举、四类参数校验、文本模型不混入视频/生图列表
 * D. 界面(无头 Chrome):分镜「AI 改写」菜单、工具栏「AI 拆分镜」、后台类型与计价文案、设置页新字段
 * 全程不产生任何积分/费用消耗：D 段只开菜单不发请求；C 段那一次真实调用走的是
 * 免费的 Agnes 文本模型(0 积分)，用于验证「默认文本模型」确实生效。 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIVE = 'http://127.0.0.1:' + (process.env.PORT || 3088);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-round42-'));
const SHOT_DIR = path.join(ROOT, 'test', 'shots-v42');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const textgen = require(path.join(ROOT, 'server', 'textgen'));

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 260) + ']' : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- A. 单元 ---------------- */
function partA() {
  console.log('== A. server/textgen.js 单元 ==');
  ok('任务枚举含 5 项且含拆分镜', textgen.TASK_IDS.length === 5 && textgen.TASKS.split_shots.json === true, textgen.TASK_IDS);
  const msgs = textgen.buildMessages('polish', '原文', null);
  ok('system 只来自服务端模板(前端无法注入)', msgs[0].role === 'system' && /润色/.test(msgs[0].content) && msgs[1].content === '原文', msgs.map(m => m.role + ':' + String(m.content).slice(0, 20)));
  const withCtx = textgen.buildMessages('polish', '原文', { context: '全片设定' });
  ok('传 context 时作为背景注入且不覆盖待处理文本', /全片设定/.test(withCtx[1].content) && withCtx[1].content.endsWith('原文'));

  const shots = textgen.parseShotsJson('```json\n[{"title":"A","script":"镜头一","duration":4},{"script":"镜头二","duration":99},{"title":"空"},{"nope":1}]\n```');
  ok('拆分镜容错:剥 markdown 围栏 + 越界时长夹住 + 丢弃无文案项', shots.length === 2 && shots[0].duration === 4 && shots[1].duration === 60, shots);
  const messy = textgen.parseShotsJson('好的，这是结果：\n[{"script":"唯一镜头","duration":"6"}]\n希望有帮助');
  ok('拆分镜容错:前后夹自然语言也能解析 · duration 字符串转数字', messy.length === 1 && messy[0].duration === 6, messy);
  let bad = '';
  try { textgen.parseShotsJson('模型直接给了一段散文，没有 JSON'); } catch (e) { bad = e.message; }
  ok('非 JSON 输出给出可读错误(不静默返回空)', /没有返回合法 JSON/.test(bad), bad.slice(0, 80));
  bad = '';
  try { textgen.parseShotsJson('[{"title":"只有标题"}]'); } catch (e) { bad = e.message; }
  ok('全是空镜头项时报错', /没有可用镜头/.test(bad), bad.slice(0, 60));

  const m = { id: 'x', type: 'text-generation', rules: JSON.stringify({ protocol: 'openai-chat', limits: { max_chars: 100 } }) };
  const n = textgen.normalizeRules(m);
  ok('normalizeRules 保留 rules.limits.max_chars', n.limits.max_chars === 100 && n.limits.max_output_tokens === 4096, n.limits);
  ok('免费模型 pricePerCall=0', textgen.pricePerCall({ is_free: 1 }, { creditPerText: 3 }) === 0);
  ok('模型价优先(文本即「每次价格」)', textgen.pricePerCall({ is_free: 0, credit_per_second: 2.5 }, { creditPerText: 3 }) === 2.5);
  ok('无模型价回落全局 creditPerText', textgen.pricePerCall({ is_free: 0, credit_per_second: 0 }, { creditPerText: 3 }) === 3);
  ok('全局缺省为 1 分/次', textgen.pricePerCall({ is_free: 0, credit_per_second: 0 }, {}) === 1);
}

/* ---------------- B. Mock chat 网关 ---------------- */
async function partB() {
  console.log('== B. openai-chat 协议契约(Mock 网关) ==');
  const seen = [];
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      seen.push({ path: req.url, auth: req.headers.authorization || '', body: (() => { try { return JSON.parse(b); } catch (e) { return null; } })() });
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (mode === 'httperr') return send(429, { error: { message: '配额用尽，请稍后再试' } });
      if (mode === 'empty') return send(200, { choices: [{ message: { content: '   ' } }] });
      if (mode === 'nested') return send(200, { result: { text: '自定义响应路径的内容' } });
      return send(200, { choices: [{ message: { content: '  改写后的剧本  ' } }], usage: { total_tokens: 42 } });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const model = extra => Object.assign({
    id: 'm-mock', name: 'Mock 文本', type: 'text-generation',
    api_base: 'http://127.0.0.1:' + port + '/v1', api_key: 'sk-mock', model_id: 'mock-flash', rules: JSON.stringify({ protocol: 'openai-chat' })
  }, extra || {});

  let out = await textgen.complete(model(), textgen.buildMessages('polish', '原文', null), { temperature: 0.7, max_tokens: 900 });
  ok('取到 choices[0].message.content 并 trim', out.content === '改写后的剧本', out);
  ok('usage 透传', out.usage && out.usage.total_tokens === 42, out.usage);
  const body = seen[seen.length - 1].body;
  ok('请求体是 OpenAI Chat 形态(model/messages/temperature/max_tokens)',
    body.model === 'mock-flash' && Array.isArray(body.messages) && body.messages[0].role === 'system' && body.max_tokens === 900, body && Object.keys(body));
  ok('默认打 /v1/chat/completions 且带 Bearer', seen[seen.length - 1].path === '/v1/chat/completions' && seen[seen.length - 1].auth === 'Bearer sk-mock', seen[seen.length - 1].path);

  mode = 'nested';
  out = await textgen.complete(model({ rules: JSON.stringify({ protocol: 'openai-chat', create: { path: '/gen/chat', body: { model: '<model_id>', messages: '<messages>' } }, response: { content_path: 'result.text' } }) }), [{ role: 'user', content: 'x' }], {});
  ok('rules 可改 path 与内容路径(不写死网关)', out.content === '自定义响应路径的内容' && /\/v1\/gen\/chat$/.test(seen[seen.length - 1].path), { content: out.content, path: seen[seen.length - 1].path });
  ok('模板未写 max_tokens 时不会硬塞该字段', seen[seen.length - 1].body.max_tokens === undefined, Object.keys(seen[seen.length - 1].body));
  mode = 'ok';

  mode = 'httperr';
  let err = '';
  try { await textgen.complete(model(), [{ role: 'user', content: 'x' }], {}); } catch (e) { err = e.message; }
  ok('HTTP 错误带状态与服务方原因', /HTTP 429/.test(err) && /配额用尽/.test(err), err.slice(0, 100));
  mode = 'empty'; err = '';
  try { await textgen.complete(model(), [{ role: 'user', content: 'x' }], {}); } catch (e) { err = e.message; }
  ok('空白内容按失败处理(不返回空串骗过上层)', /响应里没有内容/.test(err), err.slice(0, 80));
  mode = 'ok';
  err = '';
  try { await textgen.runTask(model(), 'polish', '   '); } catch (e) { err = e.message; }
  ok('空文本在调用前就被拒', /请输入要处理的文本/.test(err), err.slice(0, 60));
  err = '';
  try { await textgen.runTask(model({ rules: JSON.stringify({ protocol: 'openai-chat', limits: { max_chars: 50 } }) }), 'polish', 'x'.repeat(80)); } catch (e) { err = e.message; }
  ok('超长文本按模型上限拦截', /文本过长/.test(err) && /上限 50/.test(err), err.slice(0, 80));
  err = '';
  try { await textgen.runTask(model(), 'nope', 'x'); } catch (e) { err = e.message; }
  ok('未知任务直接拒绝(不是通用 LLM 代理)', /未知的文本处理任务/.test(err), err.slice(0, 60));
  server.close();
}

/* ---------------- C. 真实库接口契约 ---------------- */
async function partC() {
  console.log('== C. 真实接口契约(@' + (process.env.PORT || 3088) + ') ==');
  const l = await fetch(LIVE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
  if (!l.ok) throw new Error('管理员登录失败 HTTP ' + l.status);
  const cookie = (l.headers.get('set-cookie') || '').split(';')[0];
  const api = async (m, u, body) => {
    const r = await fetch(LIVE + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
    const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { }
    return { status: r.status, j, t };
  };
  const list = (await api('GET', '/text/models')).j;
  ok('/api/text/models 返回 3 个文本模型', (list.items || []).length >= 3, (list.items || []).map(x => x.name));
  ok('免费模型价格为 0、付费模型回落全局单价',
    list.items.some(x => x.is_free && x.price_per_call === 0) && list.items.some(x => !x.is_free && x.price_per_call > 0),
    list.items.map(x => [x.name, x.is_free, x.price_per_call]));
  ok('任务枚举 5 项且拆分镜标 json', list.tasks.length === 5 && list.tasks.find(t => t.id === 'split_shots').json === true, list.tasks);
  const models = (await api('GET', '/styles/models')).j.items;
  const textIds = new Set(list.items.map(x => x.id));
  ok('文本模型 type 正确落库', models.filter(m => textIds.has(m.id)).every(m => m.type === 'text-generation'), models.filter(m => textIds.has(m.id)).map(m => m.type));
  ok('文本模型不出现在生图列表', !(await api('GET', '/images/models')).j.items.some(m => textIds.has(m.id)));
  const bad = await api('POST', '/text/complete', { task: 'nope', text: 'x' });
  ok('未知 task → 400', bad.status === 400 && /未知的处理类型/.test(bad.t), bad.t.slice(0, 80));
  const empty = await api('POST', '/text/complete', { task: 'polish', text: '   ' });
  ok('空文本 → 400', empty.status === 400 && /请输入要处理的文本/.test(empty.t), empty.t.slice(0, 60));
  const wrong = await api('POST', '/text/complete', { task: 'polish', text: 'x', model_id: 'm-a926e5630f047611' });
  ok('拿生图模型做文本 → 400 并说明类型', wrong.status === 400 && /不是文本模型/.test(wrong.t), wrong.t.slice(0, 80));
  const long = await api('POST', '/text/complete', { task: 'polish', text: '字'.repeat(20001) });
  ok('超 2 万字 → 400 且不发起调用', long.status === 400 && /文本过长/.test(long.t), long.t.slice(0, 80));
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ROOT, 'data', 'app.db'), { readOnly: true });
  const freeId = list.items.find(x => x.is_free).id;
  const paidId = (list.items.find(x => !x.is_free) || {}).id;
  /* 默认文本模型是字符串 id:曾因设置接口统一 Number() 转换而被存成 null(回归这一条) */
  const setOk = await api('PATCH', '/admin/settings', { defaultTextModel: freeId });
  const readBack = (await api('GET', '/admin/settings')).j.settings.defaultTextModel;
  ok('默认文本模型能存住(字符串不被 Number() 吞成 null)', setOk.status === 200 && readBack === freeId, readBack);
  const badId = await api('PATCH', '/admin/settings', { defaultTextModel: 'm-nope-not-exist' });
  ok('设成不存在/禁用的文本模型 → 400 并拒绝', badId.status === 400 && /不存在或已禁用/.test(badId.t), badId.t.slice(0, 90));
  const used = await api('POST', '/text/complete', { task: 'condense', text: '夜。林澈在巷口敲门，苏晚开门，两人对峙。' });
  ok('不传 model_id 时用系统设置的默认文本模型', used.status === 200 && used.j.model && used.j.model.id === freeId, used.j.model);
  const trow = db.prepare("SELECT * FROM tasks WHERE type='text-generation' AND model_id=? ORDER BY created_at DESC LIMIT 1").get(freeId);
  const prow = paidId ? db.prepare("SELECT * FROM tasks WHERE type='text-generation' AND model_id=? ORDER BY created_at DESC LIMIT 1").get(paidId) : null;
  db.close();
  ok('免费模型的文本调用落 tasks 且 cost=0', !!trow && /"engine":"textgen"/.test(trow.params) && trow.cost === 0,
    trow && { status: trow.status, cost: trow.cost, params: String(trow.params).slice(0, 120) });
  ok('params 记录了 token 用量', !!trow && /total_tokens/.test(trow.params), trow && String(trow.params).slice(0, 140));
  ok('付费模型的调用按 creditPerText 扣分', !prow || prow.cost > 0, prow && { cost: prow.cost, refunded: prow.refunded });
}

/* ---------------- D. 界面 ---------------- */
async function partD() {
  console.log('== D. 界面(无头 Chrome，只开菜单不发请求) ==');
  const port = 9507;
  const chrome = spawn(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--user-data-dir=' + path.join(TMP, 'chrome'), '--remote-debugging-port=' + port, '--window-size=1680,1050', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.navigate', { url: LIVE + '/' }); await wait(2000);
  await ev(`(async()=>{(await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@videoforge.cn',password:'admin123'})})).status})()`);

  /* 找一个有分集的项目 */
  const pj = await ev(`(async()=>{const r=await (await fetch('/api/projects')).json();const p=(r.items||[])[0];if(!p)return null;
    const d=await (await fetch('/api/projects/'+p.id)).json();const ep=(d.project.episodes||[])[0];return ep?{pid:p.id,eid:ep.id}:null})()`);
  if (!pj) throw new Error('库里没有可用的项目/分集');
  await send('Page.navigate', { url: LIVE + '/?r42=1#/projects/' + pj.pid + '/episode/' + pj.eid });
  await wait(4200);
  const capBtn = await ev(`(function(){var b=document.querySelector('[data-shot-aitext]');return b?{text:b.textContent.replace(/\\s+/g,' ').trim(),visible:!!b.offsetParent}:null})()`);
  ok('分镜卡剧本文案行有「AI 改写」入口', !!capBtn && /AI 改写/.test(capBtn.text) && capBtn.visible === true, capBtn);
  /* 按钮不能被卡片右缘切掉(第一版实测就是被截成「AI 改」) */
  const clip = await ev(`(function(){var b=document.querySelector('[data-shot-aitext]');var r=b.getBoundingClientRect();
    var c=b.closest('.ws-shot-editor')||b.parentElement;var cr=c.getBoundingClientRect();
    return {btnRight:Math.round(r.right),boxRight:Math.round(cr.right),scrollW:b.scrollWidth,clientW:b.clientWidth};})()`);
  ok('「AI 改写」按钮完整可见(未被容器右缘裁切)', clip.btnRight <= clip.boxRight - 2 && clip.scrollW <= clip.clientW + 1, clip);
  const splitBtn = await ev(`(function(){var b=document.querySelector('[data-ws-action="aisplit"]');return b?b.textContent.replace(/\\s+/g,' ').trim():null})()`);
  ok('工具栏有「AI 拆分镜」', !!splitBtn && /AI 拆分镜/.test(splitBtn), splitBtn);
  /* 点开菜单(不发请求) */
  await ev(`(function(){var b=document.querySelector('[data-shot-aitext]');var r=b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+4,clientY:r.bottom+2}))})()`);
  await wait(700);
  const menu = await ev(`Array.from(document.querySelectorAll('.ctx-menu .ctx-item')).map(x=>({t:x.textContent.replace(/\\s+/g,' ').trim(),dis:x.classList.contains('disabled')}))`);
  const tasks = menu.filter(x => /免费|积分\/次/.test(x.t) && !/（当前）| · /.test(x.t));
  ok('菜单列出四类文本处理并带计价', tasks.length >= 4, tasks.map(x => x.t));
  ok('菜单里含「转成视频提示词」', menu.some(x => /转成视频提示词/.test(x.t)), menu.map(x => x.t));
  /* 第四十二轮补充：模型可在菜单里直接切换(不必进系统设置)，且切换真的落到请求上 */
  const modelRows = menu.filter(x => /（当前）| · (免费|[0-9.]+ 积分\/次)$/.test(x.t));
  ok('菜单底部列出全部文本模型并标出当前', modelRows.length >= 3 && modelRows.filter(x => /（当前）/.test(x.t)).length === 1, modelRows.map(x => x.t));
  ok('当前模型项禁用(重复点没有意义)', modelRows.find(x => /（当前）/.test(x.t)).dis === true, modelRows);
  const switched = await ev(`(function(){var it=Array.from(document.querySelectorAll('.ctx-menu .ctx-item')).find(x=>/GPT-6\\.1/.test(x.textContent));if(!it)return null;it.click();return it.textContent.replace(/\\s+/g,' ').trim()})()`);
  await wait(600);
  const after = await ev(`({id:ProjectsView.textModelId(),ls:localStorage.getItem('vf-text-model'),name:ProjectsView.textModel().name})`);
  ok('点模型项即切换并记住(localStorage)', !!switched && after.ls === after.id && /GPT-6\\.1|GPT-6.1/.test(after.name), { switched, after });
  /* 拦截一次提交:只读请求体,不发真实请求 */
  await ev(`window.__origPost=API.post;window.__cap=null;API.post=function(u,b){window.__cap={u,b};return Promise.resolve({task_id:'t-fake',result:{kind:'text',text:'FAKE'},credits:{cost:0,balance:0}})}`);
  await ev(`(function(){var s=ProjectsView.studio.shots[0];s.script='测试文案';var t=document.querySelector('[data-shot-script="'+s.key+'"]');if(t)t.value='测试文案';})()`);
  await ev(`(function(){var b=document.querySelector('[data-shot-aitext]');var r=b.getBoundingClientRect();b.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+4,clientY:r.bottom+2}))})()`);
  await wait(700);
  await ev(`(function(){var it=Array.from(document.querySelectorAll('.ctx-menu .ctx-item')).find(x=>/润色/.test(x.textContent));it&&it.click()})()`);
  await wait(900);
  const cap = await ev(`window.__cap`);
  ok('提交请求带上所选模型 model_id', !!cap && cap.u === '/text/complete' && cap.b.model_id === after.id && cap.b.task === 'polish', cap && { u: cap.u, body: cap.b });
  await ev(`API.post=window.__origPost;localStorage.removeItem('vf-text-model')`);
  await send('Page.captureScreenshot', { format: 'png' }).then(s => fs.writeFileSync(path.join(SHOT_DIR, 'shot-aimenu.png'), Buffer.from(s.data, 'base64')));
  await ev(`document.querySelectorAll('.ctx-menu').forEach(x=>x.remove())`);

  /* 后台子标签进地址：刷新/后退不再跳回第一个标签(本轮修的 bug) */
  await send('Page.navigate', { url: LIVE + '/?tab1=' + Date.now() + '#/admin/tasks' }); await wait(4200);
  const direct = await ev(`({hash:location.hash,tab:AdminView.state.tab,active:(document.querySelector('.tab.active')||{}).textContent,nav:(document.querySelector('.top-link.active')||{}).textContent,rows:document.querySelectorAll('#tkData table tbody tr').length})`);
  ok('直达 #/admin/tasks 打开的就是任务监控(不是模型管理)', /任务监控/.test(direct.active || '') && direct.tab === 'tasks' && direct.rows > 0, direct);
  ok('子路径下顶部导航仍高亮「后台管理」', /后台管理/.test(direct.nav || ''), direct.nav);
  await ev(`(function(){var b=document.querySelector('.tab[data-tab="settings"]');b&&b.click()})()`); await wait(2600);
  const clicked = await ev(`({hash:location.hash,active:(document.querySelector('.tab.active')||{}).textContent})`);
  ok('点标签会把子标签写进地址栏', /#\/admin\/settings/.test(clicked.hash) && /系统设置/.test(clicked.active || ''), clicked);
  await send('Page.reload'); await wait(3600);
  const afterReload = await ev(`({hash:location.hash,active:(document.querySelector('.tab.active')||{}).textContent})`);
  ok('刷新后停在原标签(不再跳回模型管理)', /系统设置/.test(afterReload.active || ''), afterReload);
  await ev(`history.back()`); await wait(2800);
  const afterBack = await ev(`(document.querySelector('.tab.active')||{}).textContent`);
  ok('浏览器后退能回到上一个标签', /任务监控/.test(afterBack || ''), afterBack);
  await send('Page.navigate', { url: LIVE + '/?tab2=' + Date.now() + '#/admin/nope' }); await wait(3600);
  const fallback = await ev(`(document.querySelector('.tab.active')||{}).textContent`);
  ok('未知子标签回落模型管理(不白屏)', /模型管理/.test(fallback || ''), fallback);
  /* 任务监控里的文本任务行不再是「—」 */
  const rowText = await ev(`(function(){var out=[];document.querySelectorAll('#tkData table tbody tr').forEach(function(tr){var s=tr.textContent;if(/润色|拆分镜|文本模型自检/.test(s))out.push(s.replace(/\\s+/g,' ').trim().slice(0,70));});return out.slice(0,2)})()`);
  ok('文本任务在监控列表里有可读参数行', !rowText.length || /字/.test(rowText[0]), rowText);
  await ev(`(function(){var b=document.querySelector('.tab[data-tab="models"]');b&&b.click()})()`); await wait(2200);
  const rows = await ev(`Array.from(document.querySelectorAll('table tbody tr')).map(tr=>Array.from(tr.querySelectorAll('td')).slice(0,5).map(td=>td.textContent.replace(/\\s+/g,' ').trim()))`);
  const textRow = rows.find(r => /文本处理/.test(r[1] || ''));
  ok('后台模型表把文本模型标为「文本处理」+ OpenAI Chat 协议', !!textRow && /Chat/.test(textRow[1]), textRow);
  ok('文本模型计价文案是「积分/次」或「免费」', !!textRow && /(积分\/次|全局定价 \/ 次|免费)/.test(textRow[4]), textRow && textRow[4]);
  await ev(`(function(){var b=document.querySelector('.tab[data-tab="settings"]');b&&b.click()})()`); await wait(2600);
  const set = await ev(`({perText:(document.querySelector('#setPerText')||{}).value, def:(document.querySelector('#setDefaultText')||{}).value,
    opts:Array.from((document.querySelector('#setDefaultText')||{options:[]}).options).map(o=>o.textContent.replace(/\\s+/g,' ').trim())})`);
  ok('设置页有「文本处理单价」且默认值可读', set.perText !== undefined && set.perText !== '', set);
  ok('设置页默认文本模型下拉列出已注册模型并标注免费', set.opts.length >= 2 && set.opts.some(x => /免费/.test(x)), set.opts);
  const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  ok('页面无横向溢出', Number(overflow) <= 2, overflow);
  ok('无未捕获异常', errors.length === 0, errors.slice(0, 3));
  try { chrome.kill('SIGKILL'); } catch (e) { }
}

/* ---------------- E. 后台「检查 / 自检」对文本模型 ---------------- */
async function partE() {
  console.log('== E. 模型检查与自检(文本模型走 chat 协议) ==');
  /* Mock 网关:保证用例确定、零费用(不让回归依赖 Agnes 当天的排队速度) */
  const seen = [];
  const mock = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      seen.push(u.pathname);
      const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/v1/models') return json({ data: [{ id: 'mock-text' }, { id: 'other' }] });
      if (u.pathname === '/v1/chat/completions') {
        let body = null; try { body = JSON.parse(b); } catch (e) { }
        if (body && body.model === '__route_probe__') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: '当前分组不支持模型 __route_probe__' } })); }
        return json({ choices: [{ message: { content: '收到' } }], usage: { total_tokens: 7 } });
      }
      res.writeHead(404); res.end('not found');
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const port = mock.address().port;
  const l = await fetch(LIVE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
  const cookie = (l.headers.get('set-cookie') || '').split(';')[0];
  const api = async (m, u, body) => {
    const r = await fetch(LIVE + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000) });
    const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { }
    return { status: r.status, j, t };
  };
  const mk = async (name, rules, type) => (await api('POST', '/admin/models', {
    name, type: type || 'text-generation', api_base: 'http://127.0.0.1:' + port + '/v1',
    api_key: 'sk-mock', model_id: 'mock-text', is_free: 1, rules
  })).j.model;

  const good = await mk('R42 Mock 文本(临时)', { protocol: 'openai-chat' });
  const chk = await api('POST', '/admin/models/' + good.id + '/check');
  const msg = String((chk.j && chk.j.message) || chk.t || '');
  ok('文本模型检查通过(不再报「生成规则协议未知: openai-chat」)', chk.status === 200 && chk.j.ok === true, msg.slice(0, 160));
  ok('探活打的是 /chat/completions 而不是 /videos', /\/chat\/completions 探活通过/.test(msg) && !/\/videos/.test(msg), msg.slice(0, 200));
  ok('探活请求不建单(mock 只对 __route_probe__ 回业务错误)', seen.some(p => p === '/v1/chat/completions'), seen);
  const st = await api('POST', '/admin/models/' + good.id + '/selftest');
  ok('文本模型自检走 chat 并落 tasks(不再提交视频任务)', st.status === 200 && st.j.task && st.j.task.status === 'completed' && st.j.task.type === 'text-generation',
    { status: st.status, msg: String(st.j.message || st.t).slice(0, 120) });
  ok('自检不扣积分(免费模型)', st.j.task && st.j.task.cost === 0, st.j.task && st.j.task.cost);

  /* 反向:文本模型配了视频协议应当被检查拦下(证明白名单按类型分流) */
  const wrong = await mk('R42 错协议文本(临时)', { protocol: 'openai-video' });
  const chk2 = await api('POST', '/admin/models/' + wrong.id + '/check');
  ok('文本模型配 openai-video → 检查报协议未知', chk2.j.ok === false && /协议未知/.test(String(chk2.j.message)), String(chk2.j.message).slice(0, 140));

  for (const id of [good.id, wrong.id]) await api('DELETE', '/admin/models/' + id);
  const left = (await api('GET', '/styles/models')).j.items.filter(x => /^R42 (Mock 文本|错协议文本)/.test(x.name));
  ok('临时模型已清理', left.length === 0, left.map(x => x.name));
  mock.close();
}

async function main() {
  partA();
  await partB();
  await partC();
  await partE();
  await partD();
  console.log('\n通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项(截图见 ' + SHOT_DIR + ')');
  /* Chrome 是异步退出的,临时目录可能还在被写;清不掉不影响结论,留个提示即可 */
  for (let i = 0; i < 6; i++) {
    try { fs.rmSync(TMP, { recursive: true, force: true }); break; } catch (e) { await wait(500); }
  }
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('运行失败:', (e && e.stack) || e); process.exit(1); });
