'use strict';
/* 第二十六轮验证:生图模型参数化 + 能力勾选 + 多图合成
 * 1) modelCaps 能力归一化 / sizeFromRatio 比例→尺寸换算
 * 2) Mock 网关:multipart 多图(image[])与 Gemini 多 inlineData + 画幅参数
 * 3) 真实服务 e2e:后台 API 创建带能力勾选与参数模板的生图模型 → 提交 2 图合成任务 → 网关收到 2 张参考图 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
setTimeout(() => { console.error('WATCHDOG-TIMEOUT'); process.exit(2); }, 150000);
const WORK = path.join(__dirname, '..');
const imagegen = require(path.join(WORK, 'server/imagegen'));
let ok = 0, fail = 0;
function eq(a, b, msg) { if (a === b) ok++; else { fail++; console.error('FAIL: ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); } }
function okFn(v, msg) { if (v) ok++; else { fail++; console.error('FAIL: ' + msg); } }
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  /* ---------- 1. 能力归一化 ---------- */
  eq(JSON.stringify(imagegen.modelCaps({})), JSON.stringify(['text-to-image']), 'caps default t2i');
  eq(JSON.stringify(imagegen.modelCaps({ rules: JSON.stringify({ caps: ['text-to-image'] }) })), JSON.stringify(['text-to-image']), 'caps t2i only');
  eq(JSON.stringify(imagegen.modelCaps({ rules: JSON.stringify({ caps: ['text-to-image', 'image-to-image'] }) })), JSON.stringify(['text-to-image', 'image-to-image']), 'caps t2i+i2i');
  eq(JSON.stringify(imagegen.modelCaps({ rules: JSON.stringify({ caps: ['multi-image'] }) })), JSON.stringify(['text-to-image', 'image-to-image', 'multi-image']), 'caps multi implies i2i+t2i');

  /* ---------- 2. 比例→尺寸 ---------- */
  eq(imagegen.sizeFromRatio('1:1'), '1024x1024', 'sizeFromRatio 1:1');
  eq(imagegen.sizeFromRatio('16:9'), '1536x1024', 'sizeFromRatio landscape');
  eq(imagegen.sizeFromRatio('9:16'), '1024x1536', 'sizeFromRatio portrait');
  eq(imagegen.sizeFromRatio('bad'), '', 'sizeFromRatio invalid');

  /* ---------- 3. Mock 网关 ---------- */
  const MOCK_PORT = 4261;
  const seen = { edits: [], gemini: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && u.pathname === '/v1/images/edits') {
      const parts = [];
      req.on('data', c => parts.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(parts);
        const text = raw.toString('latin1');
        seen.edits.push({
          imageFields: (text.match(/name="image\[\]"/g) || []).length,
          singleImage: (text.match(/name="image"/g) || []).length,
          size: ((text.split('name="size"')[1] || '').split('\r\n\r\n')[1] || '').split('\r\n')[0]
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }));
      });
    } else if (req.method === 'POST' && u.pathname === '/v1beta/models/gemini-2.5-flash-image:generateContent') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const j = JSON.parse(body);
        const parts = j.contents[0].parts;
        seen.gemini.push({
          inlineCount: parts.filter(p => p.inlineData).length,
          aspectRatio: (j.generationConfig.imageConfig || {}).aspectRatio || null
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_1X1.toString('base64') } }] } }] }));
      });
    } else { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(MOCK_PORT, r));
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-r26-'));
  const refPath = path.join(TMP, 'ref.png');
  fs.writeFileSync(refPath, PNG_1X1);
  const mkRef = i => ({ id: 'ref' + i, name: 'ref' + i + '.png', path: refPath, mime: 'image/png' });

  /* ---------- 4. openai multipart 多图 ---------- */
  const mOpen = { id: 'm1', model_id: 'gpt-image-1', api_base: 'http://localhost:' + MOCK_PORT + '/v1', api_key: 'k', rules: JSON.stringify({ protocol: 'openai-image' }) };
  let files = await imagegen.run(mOpen, {
    task: { prompt: 'combine' }, params: { size: '1024x1024' },
    prompt: 'combine', negativePrompt: '', count: 1,
    refAssets: [mkRef(1), mkRef(2), mkRef(3)], refAsset: mkRef(1),
    outBase: path.join(TMP, 'open-m'), onProgress: () => {}
  });
  eq(files.length, 1, 'openai multi-ref returns image');
  eq(seen.edits[0].imageFields, 3, 'multipart has 3 image[] fields');
  eq(seen.edits[0].size, '1024x1024', 'multipart size field');

  /* 单参考图仍用 image 字段 */
  files = await imagegen.run(mOpen, {
    task: { prompt: 'single' }, params: { aspect_ratio: '9:16' },
    prompt: 'single', negativePrompt: '', count: 1,
    refAssets: [mkRef(1)], refAsset: mkRef(1),
    outBase: path.join(TMP, 'open-s'), onProgress: () => {}
  });
  eq(seen.edits[1].singleImage >= 1, true, 'single ref uses image field');
  eq(seen.edits[1].size, '1024x1536', 'size derived from ratio 9:16');

  /* ---------- 5. gemini 多 inlineData + 显式画幅 ---------- */
  const mGem = { id: 'm2', model_id: 'gemini-2.5-flash-image', api_base: 'http://localhost:' + MOCK_PORT + '/v1beta', api_key: 'g', rules: '' };
  files = await imagegen.run(mGem, {
    task: { prompt: 'compose two photos' }, params: { aspect_ratio: '16:9' },
    prompt: 'compose two photos', negativePrompt: '', count: 1,
    refAssets: [mkRef(1), mkRef(2)], refAsset: mkRef(1),
    outBase: path.join(TMP, 'gem-m'), onProgress: () => {}
  });
  eq(files.length, 1, 'gemini multi-ref returns image');
  eq(seen.gemini[0].inlineCount, 2, 'gemini got 2 inlineData refs');
  eq(seen.gemini[0].aspectRatio, '16:9', 'gemini explicit aspect ratio');
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

  /* ---------- 6. 真实服务 e2e ---------- */
  const PORT = 4271;
  const srv = spawn(process.execPath, [path.join(WORK, 'server/index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', c => process.stderr.write('[srv] ' + c));
  /* 任何退出路径都杀掉子服务,避免留下孤儿进程 */
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
  srv.on('error', e => { console.error('[srv] spawn error:', e.message); process.exit(2); });
  srv.on('exit', code => { if (code) { console.error('[srv] 提前退出,code=' + code); process.exit(2); } });
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    const ping = async () => {
      while (Date.now() - t0 < 20000) {
        try { const r = await fetch('http://localhost:' + PORT + '/'); if (r.ok) return resolve(); } catch (e) {}
        await new Promise(r => setTimeout(r, 300));
      }
      reject(new Error('server not up'));
    };
    ping();
  });
  const B = 'http://localhost:' + PORT;
  /* 登录走 vf_sid Cookie(响应体只有 user);后续请求带 Cookie */
  const jfetch = async (url, opts) => {
    const r = await fetch(url, opts);
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { throw new Error('非 JSON 响应(' + r.status + '): ' + url + ' → ' + text.slice(0, 120)); }
    return { status: r.status, headers: r.headers, json: j };
  };
  const login = async (email, pass) => {
    const r = await jfetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
    const setCookie = r.headers.get('set-cookie') || '';
    const m = /vf_sid=([^;]+)/.exec(setCookie);
    okFn(!!m && r.json.user, 'login ' + email);
    return m ? m[1] : '';
  };
  const admin = await login('admin@videoforge.cn', 'admin123');
  const user = await login('demo@videoforge.cn', 'demo123');
  const AH = { Cookie: 'vf_sid=' + admin };
  const UH = { Cookie: 'vf_sid=' + user };

  /* 后台创建生图模型:能力只开 t2i + i2i(不开多图),带比例参数模板 + 张数上限 */
  const cr = await jfetch(B + '/api/admin/models', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, AH),
    body: JSON.stringify({
      name: 'R26 合成测试模型', type: 'text-to-image', version: 'r26', endpoint: 'mock://r26',
      params_schema: [
        { key: 'ratio', label: '画幅比例', type: 'select', options: ['1:1', '16:9', '9:16'], default: '16:9' },
        { key: 'size', label: '尺寸', type: 'select', options: ['1024x1024', '1536x1024', '1024x1536', 'auto'], default: '1536x1024' }
      ],
      caps: ['text-to-image', 'image-to-image'],
      max_count: 3
    })
  });
  const createdJ = cr.json;
  const created = createdJ.model || createdJ; /* 响应包 {model} ;modelJSON 已把 rules 解析为对象 */
  okFn(created.id, 'admin create image model');
  const capsStored = (created.rules && created.rules.caps) || [];
  okFn(capsStored.includes('image-to-image') && !capsStored.includes('multi-image'), 'caps stored in rules (no multi)');
  okFn(created.rules && created.rules.limits && created.rules.limits.max_count === 3, 'max_count stored');
  okFn(JSON.parse(created.params_schema || '[]').some(d => d.key === 'ratio'), 'ratio in params_schema');

  /* PATCH 能力勾选:加多图 → 断言;退回仅 t2i → 断言 */
  const p1 = await jfetch(B + '/api/admin/models/' + created.id, {
    method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, AH),
    body: JSON.stringify({ caps: ['text-to-image', 'image-to-image', 'multi-image'] })
  });
  const patched1 = p1.json.model;
  okFn(((patched1.rules || {}).caps || []).includes('multi-image'), 'patch adds multi capability');
  const p2 = await jfetch(B + '/api/admin/models/' + created.id, {
    method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, AH),
    body: JSON.stringify({ caps: ['text-to-image'] })
  });
  const patched2 = p2.json.model;
  eq(JSON.stringify((patched2.rules || {}).caps), JSON.stringify(['text-to-image']), 'patch strips caps back to t2i');

  /* 模型列表暴露 caps(前端能力提示用) */
  const ml = (await jfetch(B + '/api/images/models', { headers: UH })).json;
  const listed = (ml.items || []).find(x => x.id === created.id);
  okFn(listed && JSON.stringify(listed.caps) === JSON.stringify(['text-to-image']), 'images/models exposes caps');

  /* 上传 2 张参考图(用户资产) */
  const upRef = async (name) => {
    const fd = new FormData();
    fd.append('file', new Blob([PNG_1X1], { type: 'image/png' }), name);
    fd.append('type', 'image');
    const j = (await jfetch(B + '/api/assets/upload', { method: 'POST', headers: UH, body: fd })).json;
    const aid = (j.asset && j.asset.id) || j.id;
    okFn(aid, 'upload ref ' + name);
    return aid;
  };
  const refA = await upRef('r26-a.png');
  const refB = await upRef('r26-b.png');

  /* 能力校验:仅 t2i → 带 1 张参考图应 400 */
  const bad1 = await jfetch(B + '/api/images/generate', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, UH),
    body: JSON.stringify({ model_id: created.id, prompt: 'x', count: 1, ref_asset_ids: [refA] })
  });
  eq(bad1.status, 400, 'i2i rejected when capability off');
  const bad1j = bad1.json;
  okFn((bad1j.error || '').includes('图生图'), 'error mentions i2i capability');

  /* 打开 i2i(无 multi)→ 2 张参考图应 400 */
  await fetch(B + '/api/admin/models/' + created.id, {
    method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, AH),
    body: JSON.stringify({ caps: ['text-to-image', 'image-to-image'] })
  });
  const bad2 = await jfetch(B + '/api/images/generate', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, UH),
    body: JSON.stringify({ model_id: created.id, prompt: 'x', count: 1, ref_asset_ids: [refA, refB] })
  });
  eq(bad2.status, 400, 'multi rejected when capability off');

  /* 打开全部能力 → 提交 2 图合成任务;断言任务参数携带 ref_asset_ids / ref_count / aspect_ratio */
  await fetch(B + '/api/admin/models/' + created.id, {
    method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, AH),
    body: JSON.stringify({ caps: ['text-to-image', 'image-to-image', 'multi-image'] })
  });
  const gen = await jfetch(B + '/api/images/generate', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, UH),
    body: JSON.stringify({ model_id: created.id, prompt: '融合两张参考图', count: 1, aspect_ratio: '16:9', ref_asset_ids: [refA, refB] })
  });
  eq(gen.status, 200, 'compose task accepted');
  const genJ = gen.json;
  okFn(genJ.task && genJ.task.id, 'compose task id');
  const tj = ((await jfetch(B + '/api/tasks/' + genJ.task.id, { headers: UH })).json).task || {};
  okFn(tj.params && Array.isArray(tj.params.ref_asset_ids) && tj.params.ref_asset_ids.length === 2, 'task params carry ref_asset_ids');
  okFn(tj.params && tj.params.ref_count === 2, 'task params carry ref_count');
  okFn(tj.params && tj.params.aspect_ratio === '16:9', 'task params carry aspect_ratio from schema');

  /* 清理测试数据(测试模型 / 任务 / 参考资产),不污染开发库 */
  const del = async (url, headers) => { try { await fetch(url, { method: 'DELETE', headers }); } catch (e) {} };
  await del(B + '/api/tasks/' + genJ.task.id, UH);
  await del(B + '/api/assets/' + refA, UH);
  await del(B + '/api/assets/' + refB, UH);
  await del(B + '/api/admin/models/' + created.id, AH);

  /* 免费模型自动带全能力 + 比例参数(幂等迁移生效;管理员列表含停用模型) */
  const allModels = (await jfetch(B + '/api/styles/models', { headers: AH })).json;
  const freeList = allModels.items || [];
  const free = freeList.find(x => x.id === 'm-img-free');
  okFn(free && (((free.rules || {}).caps) || []).includes('multi-image'), 'free model caps migrated');
  okFn(free && JSON.stringify(free.params_schema || []).includes('ratio'), 'free model ratio migrated');

  srv.kill();

  console.log('');
  console.log('第二十六轮验证: ' + ok + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
