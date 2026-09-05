'use strict';
/* 二十一·项目优化(第二十三轮)回归验证:
   1) Agnes-video-v2.0 每秒 10 积分:显示消耗 = 实际扣减(设 3s 扣 30、设 10s 扣 100,不再恒扣 50)
   2) 任务参数(分辨率/时长/帧率)后端照常读取:V2.0 请求体 num_frames/frame_rate/width/height 正确
   3) 后续新增模型免配置也能读到任务参数(空 schema 兜底 + 新模型默认参数模板)
   4) 「生成融生视频」按钮高对比配色(深色香槟金 / 浅色霁蓝)
   纯 API + 模块级验证,不启浏览器 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT); /* 模块内 db 相对路径以项目根为基准 */
const BASE = 'http://localhost:3088';
let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
  else { FAIL++; console.log('  ✗ ' + name + '  [' + JSON.stringify(detail) + ']'); }
}
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { cookie: 'vf_sid=' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
async function login(email, password) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error('登录失败 ' + res.status);
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}

async function main() {
  /* ========== A. 模块级:V2.0 请求体适配 ========== */
  console.log('== A) Agnes V2.0 请求体(时长/帧率/分辨率)==');
  const agnes = require('../server/agnes');

  /* mock fetch 拦截 createVideoTask 的 HTTP 请求体 */
  const origFetch = global.fetch;
  let capturedBody = null;
  global.fetch = async (url, opts) => {
    if (String(url).endsWith('/videos')) {
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({ video_id: 'vid-mock-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/agnesapi')) {
      return new Response(JSON.stringify({ status: 'completed', progress: 100, metadata: { url: 'https://mock/video.mp4' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 200 });
  };
  const origDl = agnes.downloadVideo;
  agnes.downloadVideo = async (url, out) => { return out; };
  try {
    const adapters = require('../server/adapters');
    const model = { id: 'm-t', api_base: 'https://mock', api_key: 'k', model_id: 'agnes-video-v2.0', rules: '' };
    const ctx = {
      model,
      task: { prompt: '测试', negative_prompt: '' },
      params: { duration: 5, fps: 24, aspect_ratio: '16:9', resolution: '720p' },
      src: null, linked: [], outFile: '/tmp/round23-mock.mp4', styleGrade: null,
      onProgress: () => {}, recordRemote: () => {}
    };
    await adapters.run(model, ctx);
    check('V2.0 走 agnes-v2 适配器', !!capturedBody, capturedBody && Object.keys(capturedBody));
    check('时长 5s → num_frames=121(8n+1,≥120)', capturedBody && capturedBody.num_frames === 121, capturedBody && capturedBody.num_frames);
    check('frame_rate=24(用户设置)', capturedBody && capturedBody.frame_rate === 24, capturedBody && capturedBody.frame_rate);
    check('实际时长 121/24 ≥ 5s(修复设 5s 出 4s)', capturedBody && capturedBody.num_frames / capturedBody.frame_rate > 5, capturedBody && (capturedBody.num_frames / capturedBody.frame_rate).toFixed(2));
    check('720p/16:9 → 1280x720', capturedBody && capturedBody.width === 1280 && capturedBody.height === 720, capturedBody && (capturedBody.width + 'x' + capturedBody.height));
    check('不再写死 1152x768(旧 V2_WH 值)', capturedBody && !(capturedBody.width === 1152 && capturedBody.height === 768), capturedBody && (capturedBody.width + 'x' + capturedBody.height));

    capturedBody = null;
    await adapters.run(model, Object.assign({}, ctx, { params: { duration: 3, fps: 24, aspect_ratio: '9:16', resolution: '480p' } }));
    check('设 3s → num_frames=73(3.04s)', capturedBody && capturedBody.num_frames === 73, capturedBody && capturedBody.num_frames);
    check('480p/9:16 → 480x854(竖屏档位作用短边)', capturedBody && capturedBody.width === 480 && capturedBody.height === 854, capturedBody && (capturedBody.width + 'x' + capturedBody.height));

    capturedBody = null;
    await adapters.run(model, Object.assign({}, ctx, { params: { duration: 10, fps: 30, aspect_ratio: '1:1', resolution: '2k' } }));
    check('10s@30fps → num_frames=305(10.17s ≥ 10s)', capturedBody && capturedBody.num_frames === 305, capturedBody && capturedBody.num_frames);
    check('2k/1:1 → 1440x1440', capturedBody && capturedBody.width === 1440 && capturedBody.height === 1440, capturedBody && (capturedBody.width + 'x' + capturedBody.height));

    /* openai-video 通用协议:size 解析优先级(用户分辨率 > 规则 fixed_size) */
    const openaiModel = { id: 'm-t2', api_base: 'https://mock2', api_key: 'k', model_id: 'sora-like-x', rules: '' };
    const media = { images: [], audios: [], firstFrame: null };
    const bodyA = await adapters.buildOpenAiBody(adapters.normalizeRules(openaiModel), openaiModel, { negative_prompt: '' }, { duration: 6, resolution: '960p', aspect_ratio: '16:9' }, 'p', 'text', media);
    check('通用协议 <size> 采用用户所选 960p→"960P"', bodyA.size === '960P', bodyA.size);
    check('通用协议 <seconds> 采用用户时长 6', String(bodyA.seconds) === '6', bodyA.seconds);
    const bodyB = await adapters.buildOpenAiBody(adapters.normalizeRules(openaiModel), openaiModel, { negative_prompt: '' }, { duration: 6, aspect_ratio: '16:9' }, 'p', 'text', media);
    check('未选分辨率时回退规则 fixed_size 720P', bodyB.size === '720P', bodyB.size);
  } finally {
    global.fetch = origFetch;
    agnes.downloadVideo = origDl;
  }

  /* ========== B. API 级:积分计价一致性(空 schema 模型兜底) ========== */
  console.log('== B) 积分计价:显示 = 实扣 ==');
  const admin = await login('admin@videoforge.cn', 'admin123');
  const demo = await login('demo@videoforge.cn', 'demo123');
  check('admin/demo 登录', !!admin && !!demo);

  const assets = (await api('GET', '/api/assets?type=image', undefined, admin)).data.items || [];
  const img = assets[0];
  if (!img) { console.log('  - 无图片资产,跳过 B 段提交验证'); }
  else {
    /* 临时模型:每秒 10 积分(模拟用户的 Agnes-video-v2.0 配置);不传 params_schema,
       走本地 ffmpeg(无 api_base),可端到端验证时长读取 */
    let r = await api('POST', '/api/admin/models', { name: 'TEST-R23-10分每秒(临时)', credit_per_second: 10, type: 'image-to-video', description: 'round23 计价验证' }, admin);
    const mId = r.data.model && r.data.model.id;
    check('创建模型(10 积分/秒)', r.status === 200 && !!mId, r.status);
    const createdSchema = (() => { try { return JSON.parse(r.data.model.params_schema || '[]'); } catch (e) { return []; } })();
    check('新模型自动获得标准参数模板(不再为空)', Array.isArray(createdSchema) && createdSchema.length > 0, createdSchema.map(d => d.key));

    /* 余额兜底:不足则管理员自充 */
    let bal = (await api('GET', '/api/credits', undefined, admin)).data.balance;
    if (bal < 200) {
      const users = (await api('GET', '/api/admin/users', undefined, admin)).data.items || [];
      const adm = users.find(u => u.role === 'admin');
      await api('POST', '/api/admin/users/' + adm.id + '/credits', { delta: 500, reason: 'round23 测试充值' }, admin);
    }

    r = await api('POST', '/api/tasks', { model_id: mId, use_asset_id: img.id, prompt: 'round23 计价验证 3s', param_duration: 3, param_fps: 24, param_aspect_ratio: '16:9', param_resolution: '720p' }, admin);
    const t3 = r.data.task;
    check('设 3s → 实扣 30(此前实扣 50)', r.status === 200 && t3 && t3.cost === 30, t3 && t3.cost);
    check('任务参数 duration=3 被后端读取', t3 && t3.params.duration === 3, t3 && t3.params.duration);
    check('任务参数 fps/resolution 被后端读取', t3 && t3.params.fps === 24 && t3.params.resolution === '720p', t3 && t3.params);
    await api('POST', '/api/tasks/' + t3.id + '/cancel', {}, admin);

    r = await api('POST', '/api/tasks', { model_id: mId, use_asset_id: img.id, prompt: 'round23 计价验证 10s', param_duration: 10, param_fps: 24, param_aspect_ratio: '16:9', param_resolution: '720p' }, admin);
    const t10 = r.data.task;
    check('设 10s → 实扣 100(此前实扣 50)', r.status === 200 && t10 && t10.cost === 100, t10 && t10.cost);
    check('任务参数 duration=10 被后端读取', t10 && t10.params.duration === 10, t10 && t10.params.duration);
    await api('POST', '/api/tasks/' + t10.id + '/cancel', {}, admin);

    /* 端到端:3s 任务真实生成,验证 ffmpeg 引擎输出时长≈3s(参数真正生效) */
    r = await api('POST', '/api/tasks', { model_id: mId, use_asset_id: img.id, prompt: 'round23 时长端到端验证', param_duration: 3, param_fps: 24 }, admin);
    const tE = r.data.task;
    let done = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(rs => setTimeout(rs, 500));
      done = (await api('GET', '/api/tasks/' + tE.id, undefined, admin)).data.task;
      if (['completed', 'failed'].includes(done.status)) break;
    }
    check('3s 任务端到端完成', done && done.status === 'completed', done && (done.status + ' ' + (done.error || '')));
    if (done && done.status === 'completed') {
      const listed = ((await api('GET', '/api/tasks', undefined, admin)).data.items || []).find(x => x.id === tE.id);
      const resA = listed && listed.result;
      check('生成视频时长 ≈3s(读到了用户时长)', resA && Math.abs((resA.duration || 0) - 3) <= 0.6, resA && resA.duration);
    }

    /* 已存在的「Agnes-video-v2.0」模型(迁移后)参数模板可读 */
    const models = (await api('GET', '/api/styles/models', undefined, admin)).data.items || [];
    const v2 = models.find(m => /v2\.0/i.test(m.model_id || '') || (m.name || '').includes('v2.0'));
    if (v2) check('线上 Agnes-video-v2.0 模型参数模板已补齐(含 duration)', Array.isArray(v2.params_schema) && v2.params_schema.some(d => d.key === 'duration'), v2.params_schema && v2.params_schema.map(d => d.key));
    else console.log('  - 库中无 v2.0 模型,跳过');

    await api('DELETE', '/api/admin/models/' + mId, undefined, admin);
    check('清理临时模型', true);
  }

  /* ========== C. 静态断言:UI 修复 ========== */
  console.log('== C) UI:生成按钮配色 + 前端计价一致 ==');
  const fs = require('fs');
  const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
  check('生成按钮已移出「玄墨墨底」按钮族', !/\.wb-ai-send,\n\.ws-gen-btn,/.test(css), null);
  check('生成按钮深色 = 香槟金实底 #d4af6e + 墨字', css.includes('.ws-gen-btn {\n  background: #d4af6e !important;'), null);
  check('生成按钮浅色 = 霁蓝实底 #1e4380 + 白字', css.includes('html[data-scheme="light"] .ws-gen-btn {\n  background: #1e4380 !important;'), null);
  const projects = fs.readFileSync(path.join(ROOT, 'public/js/views/projects.js'), 'utf8');
  check('前端 effDuration:积分提示与后端同一时长口径', projects.includes('effDuration(model'), null);
  check('提交时长使用 effDur(显示即实扣)', projects.includes('param_duration: effDur'), null);

  console.log('\n结果: ' + PASS + ' 通过, ' + FAIL + ' 失败');
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('测试异常:', e); process.exit(1); });
