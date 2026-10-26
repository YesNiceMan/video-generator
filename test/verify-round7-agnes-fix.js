'use strict';
/* 第七轮修复回归:Agnes 在线模型(Flash / V2.0)生成视频
 *
 * 验证的 bug:node:sqlite 资产行(null 原型对象)流入 server/agnes.js,
 * 字符串强转抛 "Cannot convert object to primitive value" 导致任务必然失败。
 *
 * 本脚本自建一个「Mock Agnes 网关」,再启动真实服务器(端口 3099),
 * 通过 HTTP 完整走 提交任务 → worker 调 API → 轮询 → 下载结果 全链路。
 * 结束后恢复被测试改动的模型配置并清理测试产生的数据。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3099;
const BASE = 'http://127.0.0.1:' + PORT + '/api';
const FF = path.join(ROOT, 'tools', 'ffmpeg');
const execSync = require('child_process').execSync;

let PASS = 0, FAIL = 0;
const ok = (cond, label, extra) => {
  if (cond) { PASS++; console.log('  ✓', label); }
  else { FAIL++; console.log('  ✗', label, extra !== undefined ? '→ ' + JSON.stringify(extra).slice(0, 200) : ''); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 快照将被测试触碰的模型配置,结束后原样恢复 ---------- */
const { db } = require(path.join(ROOT, 'server', 'db'));
function snapModel(id) {
  const r = db.prepare('SELECT api_base, api_key, model_id FROM models WHERE id=?').get(id);
  return r ? { ...r } : null;
}
function restoreModel(id, snap) {
  if (!snap) return;
  db.prepare('UPDATE models SET api_base=?, api_key=?, model_id=? WHERE id=?')
    .run(snap.api_base, snap.api_key, snap.model_id, id);
}
const SNAP_FLASH = snapModel('m-agnes-flash');
const SNAP_V2USER = snapModel('m-4ab959e34f08b208');

/* ---------- Mock Agnes 网关 ---------- */
const captured = [];   // 每次创建任务的 {path, headers, body}
const SAMPLE_MP4 = path.join(os.tmpdir(), 'vf_mock_sample.mp4');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=320x180:d=0.6 -pix_fmt yuv420p -c:v libx264 "${SAMPLE_MP4}"`);
let vidSeq = 0;

const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (req.method === 'POST' && /\/videos$/.test(req.url)) {
      let body = {};
      try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) {}
      if (String(body.prompt || '').includes('__FORCE_400__')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: [{ loc: ['body'], msg: 'size must be 720P', type: 'value_error' }] }));
      }
      const vid = 'vid-' + (++vidSeq);
      captured.push({ t: Date.now(), auth: req.headers.authorization || '', body });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ video_id: vid, status: 'queued' }));
    }
    if (req.method === 'GET' && req.url.startsWith('/agnesapi')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        video_id: new URL(req.url, 'http://x').searchParams.get('video_id'),
        status: 'completed', progress: 100,
        metadata: { url: 'http://127.0.0.1:' + MOCKPORT + '/files/sample.mp4' }
      }));
    }
    if (req.url.startsWith('/files/')) {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end(fs.readFileSync(SAMPLE_MP4));
    }
    res.writeHead(404); res.end('{}');
  });
});
let MOCKPORT = 0;

/* ---------- HTTP 小工具 ---------- */
let COOKIE = '';
async function api(method, p, body, isForm, formBody) {
  const headers = { Cookie: COOKIE };
  let payload;
  if (isForm) { payload = formBody; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (setc.length) COOKIE = setc.map(c => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, json, text };
}
async function uploadPng(file, name) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'image/png' }), name);
  fd.append('category', '分镜');
  return api('POST', '/assets/upload', undefined, true, fd);
}
async function runTask(payload) {
  const sub = await api('POST', '/tasks', payload);
  if (!sub.json || !sub.json.task) return { submit: sub, task: null };
  const id = sub.json.task.id;
  let task = sub.json.task;
  for (let i = 0; i < 60; i++) {
    await wait(1500);
    const r = await api('GET', '/tasks/' + id);
    task = r.json && r.json.task;
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) break;
  }
  return { submit: sub, task };
}

(async () => {
  console.log('== 启动 Mock Agnes 网关与平台服务器(端口 ' + PORT + ',PUBLIC_BASE_URL 已设置以走签名直链)==');
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  MOCKPORT = mock.address().port;

  // 让本机已有服务(若有)不受影响:固定用 3099
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), PUBLIC_BASE_URL: 'http://127.0.0.1:' + PORT },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try { const h = await fetch('http://127.0.0.1:' + PORT + '/api/health'); if (h.ok) { healthy = true; break; } } catch (e) {}
    await wait(250);
  }
  if (!healthy) { console.log('✗ 服务器未能启动'); child.kill(); process.exit(1); }

  try {
    /* 配置两个 Agnes 指向 Mock 网关 */
    const login = await api('POST', '/auth/login', { email: 'admin@videoforge.cn', password: 'admin123' });
    ok(login.json && login.json.user, '管理员登录');
    await api('PATCH', '/admin/models/m-agnes-flash', { api_base: 'http://127.0.0.1:' + MOCKPORT + '/v1', api_key: 'sk-mock-flash' });

    const srcImg = path.join(os.tmpdir(), 'vf_fix_src.png');
    execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=480x270 -frames:v 1 "${srcImg}"`);
    const up = await uploadPng(srcImg, 'seawave.png');
    ok(up.json && up.json.asset, '上传源图', up.text);

    /* 场景 A:Flash · 无参考资产 → keyframe 模式 */
    console.log('\n-- 场景 A:Agnes Video 2.5 Flash(keyframe 图生视频)--');
    const A = await runTask({ model_id: 'm-agnes-flash', use_asset_id: up.json.asset.id, prompt: '海浪缓慢拍岸,镜头推近', param_duration: 4 });
    ok(A.task && A.task.status === 'completed', '任务生成成功', A.task && A.task.error);
    const bA = captured.find(c => c.body.model === 'agnes-video-2.5-flash');
    ok(!!bA, '请求到达 Agnes 兼容网关');
    if (bA) {
      ok(bA.auth === 'Bearer sk-mock-flash', 'Authorization 携带已配置的 Key');
      ok(bA.body.mode === 'keyframe', 'mode=keyframe(无参考资产)', bA.body.mode);
      ok(bA.body.size === '720P', 'size 固定 720P', bA.body.size);
      ok(bA.body.seconds === '4', 'seconds 为字符串 "4"', bA.body.seconds);
      ok(typeof bA.body.first_frame === 'string' && /^https?:[/]/.test(bA.body.first_frame), 'first_frame 是公网可访问 URL(不再是对象)', String(bA.body.first_frame).slice(0, 80));
      const fr = await fetch(bA.body.first_frame);
      ok(fr.ok && (fr.headers.get('content-type') || '').includes('image/png'), '签名直链可匿名拉取源图(HTTP ' + fr.status + ')');
    }

    /* 场景 B:Flash · 有参考资产 → reference 模式 + 占位符改写 */
    console.log('\n-- 场景 B:Agnes Video 2.5 Flash(reference 参考图模式)--');
    const refImg = path.join(os.tmpdir(), 'vf_fix_ref.png');
    execSync(`${FF} -y -loglevel error -f lavfi -i smptebars=s=320x240 -frames:v 1 "${refImg}"`);
    const upRef = await uploadPng(refImg, 'refcat.png');
    const B = await runTask({
      model_id: 'm-agnes-flash', use_asset_id: up.json.asset.id, linked_asset_ids: [upRef.json.asset.id],
      prompt: '[refcat] 保持参考图角色外观,在花田中奔跑', param_duration: 5
    });
    ok(B.task && B.task.status === 'completed', '任务生成成功', B.task && B.task.error);
    const bBs = captured.filter(c => c.body.mode === 'reference');
    const bB = bBs[bBs.length - 1];
    ok(!!bB, '请求使用 reference 模式');
    if (bB) {
      ok(Array.isArray(bB.body.images) && bB.body.images.length === 2, 'images 为 2 个字符串引用(源图+参考图)', bB.body.images);
      ok(bB.body.images.every(u => /^https?:[/]/.test(u)), '所有参考图为公网 URL');
      ok(/<Picture \d>/.test(bB.body.prompt), '[refcat] 占位符已改写为 <Picture N>', bB.body.prompt);
      ok(!('videos' in bB.body) && !('first_frame' in bB.body), 'reference 模式不携带 videos / first_frame');
    }

    /* 场景 C:自定义 Agnes-video-v2.0 模型(V2 接口族)*/
    console.log('\n-- 场景 C:自定义 Agnes-video-v2.0(V2.0 图生视频接口)--');
    const mk = await api('POST', '/admin/models', {
      name: 'agnes-fix-test-v2', type: 'image-to-video',
      api_base: 'http://127.0.0.1:' + MOCKPORT + '/v1', api_key: 'sk-mock-v20', model_id: 'agnes-video-v2.0'
    });
    const v2id = mk.json && mk.json.model && mk.json.model.id;
    ok(!!v2id, '创建自定义 V2.0 模型', mk.text);
    /* 协议回归不该消耗真实积分:测试模型一律置免费(否则 admin 余额不足会 402,断言拿不到任务) */
    if (v2id) db.prepare('UPDATE models SET is_free=1 WHERE id=?').run(v2id);
    const C = await runTask({ model_id: v2id, use_asset_id: up.json.asset.id, prompt: '延时摄影云层流动', param_duration: 5 });
    ok(C.task && C.task.status === 'completed', '任务生成成功', C.task && C.task.error);
    const bC = captured.find(c => c.body.model === 'agnes-video-v2.0');
    ok(!!bC, '请求走 V2.0 接口族');
    if (bC) {
      ok(bC.body.width > 0 && bC.body.height > 0, '携带 width/height', bC.body.width + 'x' + bC.body.height);
      ok(Number.isInteger(bC.body.num_frames) && bC.body.num_frames % 8 === 1 && bC.body.num_frames <= 441, 'num_frames 满足 8n+1 且 ≤441', bC.body.num_frames);
      ok(typeof bC.body.image === 'string' && /^(https?:|data:)/.test(bC.body.image), 'image 是 URL/data URI(不再是对象)', String(bC.body.image).slice(0, 60));
      ok(bC.auth === 'Bearer sk-mock-v20', 'Authorization 正确');
    }

    /* 场景 D:网关返回 400 + 对象数组 detail → 失败原因可读 */
    console.log('\n-- 场景 D:网关 400 错误详情格式化 --');
    const D = await runTask({ model_id: 'm-agnes-flash', use_asset_id: up.json.asset.id, prompt: '__FORCE_400__ 触发网关校验错误', param_duration: 4 });
    ok(D.task && D.task.status === 'failed', '任务按预期失败');
    const err = (D.task && D.task.error) || '';
    ok(err.includes('size must be 720P'), '失败原因包含网关原始信息', err);
    ok(!/\[object/i.test(err) && !/Cannot convert/.test(err), '不再出现 [object Object] / Cannot convert', err);

    console.log('\n================ 结果 ================');
    console.log('通过 ' + PASS + ' 项,' + '失败 ' + FAIL + ' 项');
  } finally {
    child.kill('SIGTERM');
    mock.close();
    await wait(300);
    /* 恢复用户原有配置与清理测试数据 */
    restoreModel('m-agnes-flash', SNAP_FLASH);
    if (SNAP_V2USER) restoreModel('m-4ab959e34f08b208', SNAP_V2USER);
    db.prepare("DELETE FROM models WHERE name='agnes-fix-test-v2'").run();
    db.prepare("DELETE FROM notifications WHERE task_id IN (SELECT id FROM tasks WHERE prompt LIKE '%海浪缓慢拍岸%' OR prompt LIKE '%refcat%' OR prompt LIKE '%__FORCE_400__%' OR prompt LIKE '%延时摄影云层流动%')").run();
    db.prepare("DELETE FROM tasks WHERE prompt LIKE '%海浪缓慢拍岸%' OR prompt LIKE '%refcat%' OR prompt LIKE '%__FORCE_400__%' OR prompt LIKE '%延时摄影云层流动%'").run();
    db.prepare("DELETE FROM assets WHERE name IN ('seawave.png','refcat.png')").run();
    console.log('已恢复模型配置并清理测试数据');
  }
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });