'use strict';
/* 第二十七轮验证:生图打磨 —— 模型积分单价 / 图片上传缩略图 / 自定义比例尺寸模板 / 随机种子 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
setTimeout(() => { console.error('WATCHDOG-TIMEOUT'); process.exit(2); }, 150000);
const WORK = path.join(__dirname, '..');
let ok = 0, fail = 0;
function okFn(v, msg) { if (v) ok++; else { fail++; console.error('FAIL: ' + msg); } }
function eq(a, b, msg) { if (a === b) ok++; else { fail++; console.error('FAIL: ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); } }
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function main() {
  const PORT = 4283;
  const srv = spawn(process.execPath, [path.join(WORK, 'server/index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', c => process.stderr.write('[srv] ' + c));
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:' + PORT + '/'); if (r.ok) { up = true; break; } } catch (e) {} await new Promise(r => setTimeout(r, 400)); }
  okFn(up, 'server up');
  const B = 'http://localhost:' + PORT;
  const jfetch = async (url, opts) => {
    const r = await fetch(url, opts);
    const text = await r.text();
    try { return { status: r.status, headers: r.headers, json: JSON.parse(text) }; }
    catch (e) { throw new Error('非 JSON(' + r.status + '): ' + url + ' → ' + text.slice(0, 100)); }
  };
  const login = async (email, pass) => {
    const r = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
    const m = /vf_sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
    okFn(!!m, 'login ' + email);
    return m ? m[1] : '';
  };
  const admin = await login('admin@videoforge.cn', 'admin123');
  const user = await login('demo@videoforge.cn', 'demo123');
  const AH = { Cookie: 'vf_sid=' + admin, 'Content-Type': 'application/json' };
  const UH = { Cookie: 'vf_sid=' + user, 'Content-Type': 'application/json' };

  /* ---- 1. 图片上传生成缩略图(修复参考图不显示) ---- */
  const upRef = async (name) => {
    const fd = new FormData();
    fd.append('file', new Blob([PNG_1X1], { type: 'image/png' }), name);
    fd.append('type', 'image');
    const j = (await jfetch(B + '/api/assets/upload', { method: 'POST', headers: { Cookie: 'vf_sid=' + user }, body: fd })).json;
    const a = j.asset || j;
    okFn(a.id, 'upload ' + name);
    return a;
  };
  const img1 = await upRef('r27-a.png');
  okFn(!!img1.thumb_path, 'image upload has thumb_path (reference previews work)');
  const thumbRes = await fetch(B + '/api/assets/' + img1.id + '/thumbnail', { headers: { Cookie: 'vf_sid=' + user } });
  eq(thumbRes.status, 200, 'thumbnail endpoint 200 for image');

  /* ---- 2. 模型积分单价:模型价优先于全局(credit_per_second 当每张价) ---- */
  const bal0 = (await jfetch(B + '/api/credits', { headers: { Cookie: 'vf_sid=' + user } })).json.balance || 0;
  const cr = await jfetch(B + '/api/admin/models', {
    method: 'POST', headers: AH,
    body: JSON.stringify({
      name: 'R27 定价模型', type: 'text-to-image', endpoint: 'mock://r27', credit_per_second: 3,
      params_schema: [
        { key: 'ratio', label: '画幅比例', type: 'select', options: ['4:5', '1:1'], default: '4:5' },
        { key: 'size', label: '尺寸', type: 'select', options: ['2048x1152', '1024x1024'], default: '2048x1152' },
        { key: 'seed', label: '随机种子', type: 'number', default: -1 }
      ],
      caps: ['text-to-image']
    })
  });
  const model = cr.json.model;
  okFn(model && model.id, 'create pricing model');
  const ml = (await jfetch(B + '/api/images/models', { headers: { Cookie: 'vf_sid=' + user } })).json;
  const listed = (ml.items || []).find(x => x.id === model.id);
  eq(listed && listed.price_per_image, 3, 'models list exposes model price 3 (not global default)');

  /* 余额不够则由管理员给自己发积分(走积分申请 + 审批) */
  if (bal0 < 3) {
    const ap = (await jfetch(B + '/api/credits/apply', { method: 'POST', headers: { Cookie: 'vf_sid=' + admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 100, reason: 'r27 test' }) })).json;
    const reqs = (await jfetch(B + '/api/admin/credit-requests', { headers: AH })).json;
    const mine = (reqs.requests || reqs.items || []).filter(x => x.status === 'pending').sort((a, b) => b.created_at - a.created_at)[0];
    if (mine) await jfetch(B + '/api/admin/credit-requests/' + mine.id + '/approve', { method: 'POST', headers: AH, body: '{}' });
  }
  const bal1 = (await jfetch(B + '/api/credits', { headers: { Cookie: 'vf_sid=' + user } })).json.balance || 0;
  okFn(bal1 >= 3, 'user has enough credits for pricing test', bal1);
  if (bal1 >= 3) {
    const gen = await jfetch(B + '/api/images/generate', {
      method: 'POST', headers: UH,
      body: JSON.stringify({ model_id: model.id, prompt: '定价验证', count: 2, aspect_ratio: '4:5', size: '2048x1152', ref_asset_ids: undefined })
    });
    eq(gen.json.credits && gen.json.credits.perImage, 3, 'charge uses model price 3/张');
    eq(gen.json.credits && gen.json.credits.cost, 6, 'cost = 3 × 2 = 6 (not default 2×2)');
    const tj = ((await jfetch(B + '/api/tasks/' + gen.json.task.id, { headers: { Cookie: 'vf_sid=' + user } })).json).task;
    eq(tj.params && tj.params.aspect_ratio, '4:5', 'custom ratio 4:5 accepted from template');
    okFn(tj.params && tj.params.seed !== undefined, 'seed param carried');
    await jfetch(B + '/api/tasks/' + gen.json.task.id, { method: 'DELETE', headers: { Cookie: 'vf_sid=' + user } });
  }

  /* ---- 3. 随机种子:img-ffmpeg 引擎 seed=-1 两次生成产出不同渐变(随机刷新) ---- */
  const imagegen = require(path.join(WORK, 'server/imagegen'));
  const os = require('os');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-r27-'));
  const freeRow = { id: 'free', model_id: 'free', is_free: 1, rules: JSON.stringify({ protocol: 'img-ffmpeg' }), params_schema: '[]' };
  const ctx = (base) => ({ task: { prompt: 'same prompt' }, params: { size: '256x256', seed: -1 }, prompt: 'same prompt', negativePrompt: '', count: 1, refAssets: [], refAsset: null, outBase: base, onProgress: () => {} });
  const f1 = await imagegen.run(freeRow, ctx(path.join(TMP, 'a')));
  const f2 = await imagegen.run(freeRow, ctx(path.join(TMP, 'b')));
  okFn(f1.length === 1 && f2.length === 1, 'ffmpeg placeholder generated 2 images');
  eq(Buffer.compare(fs.readFileSync(f1[0]), fs.readFileSync(f2[0])) !== 0, true, 'seed -1 regenerates different output (random refresh)');
  const ctxFix = (base) => ({ task: { prompt: 'same prompt' }, params: { size: '256x256', seed: 42 }, prompt: 'same prompt', negativePrompt: '', count: 1, refAssets: [], refAsset: null, outBase: base, onProgress: () => {} });
  const f3 = await imagegen.run(freeRow, ctxFix(path.join(TMP, 'c')));
  const f4 = await imagegen.run(freeRow, ctxFix(path.join(TMP, 'd')));
  eq(Buffer.compare(fs.readFileSync(f3[0]), fs.readFileSync(f4[0])) === 0, true, 'fixed seed 42 reproduces identical output');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

  /* 清理 */
  const del = async (url, h) => { try { await fetch(url, { method: 'DELETE', headers: h }); } catch (e) {} };
  await del(B + '/api/assets/' + img1.id, { Cookie: 'vf_sid=' + user });
  await del(B + '/api/admin/models/' + model.id, { Cookie: 'vf_sid=' + admin });

  console.log('');
  console.log('第二十七轮验证: ' + ok + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });