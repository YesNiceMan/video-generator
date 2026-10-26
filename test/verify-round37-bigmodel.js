'use strict';
/* 第三十七轮补充:智谱 bigmodel(cogvideox-flash)视频契约回归
 * 覆盖 rules 驱动的接入:顶层 image_url 注入、GET /paas/v4/async-result/<video_id> 轮询、
 * SUCCESS + video_url 取回、FAIL 时 {error:{code,message}} 不被打印成 [object Object]、
 * 以及繁忙 429 走「可重试」信号(交给 worker 延后重投,见第三十六轮)。
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FF = path.join(ROOT, 'tools', 'ffmpeg');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-bigmodel-'));
const adapters = require(path.join(ROOT, 'server/adapters'));

let PASS = 0, FAIL = 0;
const ok = (c, label, extra) => {
  if (c) { PASS++; console.log('  ✓ ' + label); }
  else { FAIL++; console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 220) : '')); }
};

const CLIP = path.join(TMP, 'clip.mp4');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=1920x1080:d=0.6 -pix_fmt yuv420p -c:v libx264 "${CLIP}"`);
const IMG = path.join(TMP, 'cat.png');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=1024x576 -frames:v 1 "${IMG}"`);

let PORT = 0;
const seen = { body: null, pollPaths: [], mode: 'success' };
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && u.pathname === '/api/paas/v4/videos/generations') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      seen.body = JSON.parse(b || '{}');
      if (seen.mode === 'busy') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: '1305', message: '该模型当前访问量过大，请您稍后再试' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'bm-task-1', model: 'cogvideox-flash', created_at: Date.now(), task_status: 'PROCESSING' }));
    });
    return;
  }
  const m = /^\/api\/paas\/v4\/async-result\/([^/]+)$/.exec(u.pathname);
  if (req.method === 'GET' && m) {
    seen.pollPaths.push(u.pathname);
    const first = seen.pollPaths.length < 2;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (first) return res.end(JSON.stringify({ id: m[1], task_status: 'PROCESSING' }));
    if (seen.mode === 'fail') {
      return res.end(JSON.stringify({ id: m[1], task_status: 'FAIL', error: { code: '1302', message: '内容审核未通过' } }));
    }
    return res.end(JSON.stringify({
      id: m[1], task_status: 'SUCCESS', model: 'cogvideox-flash',
      video_url: 'http://127.0.0.1:' + PORT + '/clip.mp4'
    }));
  }
  if (req.method === 'GET' && u.pathname === '/clip.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return fs.createReadStream(CLIP).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code: '404', message: 'not found' } }));
});

const RULES = {
  protocol: 'openai-video',
  create: {
    path: '/paas/v4/videos/generations',
    method: 'POST',
    first_frame_field: 'image_url',
    body: {
      model: '<model_id>', prompt: '<prompt>', size: '1920x1080',
      aspect_ratio: '<aspect_ratio>', duration: '<seconds>', movement_amplitude: 'auto'
    }
  },
  query: {
    path: '/paas/v4/async-result/<video_id>', use_origin: false, method: 'GET', params: {},
    status_field: 'task_status',
    status_values: { completed: ['success'], failed: ['fail'] },
    video_url_field: 'video_url', error_field: 'error'
  },
  limits: { min_seconds: 5, max_seconds: 5, seconds_type: 'number' }
};
const MODEL = {
  id: 'm-bm-mock', type: 'image-to-video', is_free: 1,
  api_base: 'https://open.bigmodel.cn/api', api_key: 'sk-mock-bm',
  model_id: 'cogvideox-flash', rules: JSON.stringify(RULES)
};
const SRC = { id: 'a-cat', name: 'cat.png', path: IMG, mime: 'image/png', width: 1024, height: 576 };

function ctx(outFile) {
  const params = { duration: 5, fps: 30, motion: 0.5, seed: -1, resolution: '1080p', aspect_ratio: '16:9' };
  return {
    model: MODEL, params, src: SRC, linked: [], outFile, styleGrade: null,
    task: { id: 't-bm-mock', prompt: '一只橘猫坐在窗台上看雨，电影感', negative_prompt: '', params: JSON.stringify(params) },
    onProgress: () => {}, recordRemote: id => { ctx.remote = id; }
  };
}

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  PORT = mock.address().port;
  MODEL.api_base = 'http://127.0.0.1:' + PORT + '/api';

  console.log('\n-- 成功链路 --');
  const out = path.join(TMP, 'out.mp4');
  const c1 = ctx(out);
  const produced = await adapters.run(MODEL, c1);
  const b = seen.body || {};
  ok(produced === out && fs.existsSync(out), '成片产出并下载', produced);
  ok(b.model === 'cogvideox-flash', 'model 令牌', b.model);
  ok(b.duration === 5, 'duration 是数字 5(模型只支持 5s)', b.duration);
  ok(b.size === '1920x1080', 'size 按规则固定 1920x1080', b.size);
  ok(b.aspect_ratio === '16:9' && b.movement_amplitude === 'auto', '画幅与运动幅度按规则发出', { r: b.aspect_ratio, m: b.movement_amplitude });
  ok(typeof b.image_url === 'string' && (b.image_url.startsWith('data:image/') || /^https?:/.test(b.image_url)),
    'first_frame_field=image_url 自动注入源图(URL 或 Base64)', String(b.image_url).slice(0, 32));
  ok(ctx.remote === 'bm-task-1', '顶层 id 作为远端任务 ID 记录', ctx.remote);
  ok(seen.pollPaths.length >= 2 && seen.pollPaths.every(p => p === '/api/paas/v4/async-result/bm-task-1'),
    '轮询走 GET /paas/v4/async-result/<video_id>', seen.pollPaths);
  const info = require(path.join(ROOT, 'server/ffmpeg')).probe(out);
  ok(info.width === 1920 && info.height === 1080, '结果 video_url 下载并按 1920×1080 入库', info);

  console.log('\n-- 失败链路:错误对象不能变成 [object Object] --');
  seen.mode = 'fail'; seen.pollPaths.length = 0;
  let msg = '';
  try { await adapters.run(MODEL, ctx(path.join(TMP, 'fail.mp4'))); } catch (e) { msg = e.message; }
  ok(/内容审核未通过/.test(msg) && !/\[object Object\]/.test(msg), 'FAIL 时透出 code/message 文本', msg.slice(0, 160));

  console.log('\n-- 繁忙 429:必须作为可重试信号交给 worker --');
  seen.mode = 'busy';
  let err = null;
  try { await adapters.run(MODEL, ctx(path.join(TMP, 'busy.mp4'))); } catch (e) { err = e; }
  ok(!!err && err.retryable === true, '429 抛出 retryable(第三十六轮自动延后重投)', err && { msg: err.message.slice(0, 90), retryable: err.retryable } );

  console.log('\n================ 结果 ================');
  console.log('通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项');
  mock.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); mock.close(); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(2); });
