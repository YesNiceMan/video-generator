'use strict';
/* 第三十七轮回归:百炼(DashScope)异步视频契约
 *
 * 覆盖本轮给 server/adapters.js 补的四项规则能力(全部只用 rules 配置,不写死网关):
 *   create.headers   → X-DashScope-Async: enable(缺头网关直接拒)
 *   create.id_path   → 任务 ID 在 output.task_id(嵌套)
 *   query.path       → GET /api/v1/tasks/<video_id>(ID 在路径里)
 *   create.nested_media → input.media:[{type,url}] 这种嵌套媒体结构 + 深填充令牌
 * 另含:status_values/data_path/video_url_field 对 SUCCEEDED + output.video_url 的识别、
 *      duration 保持数字、resolution 出大写档位、空 negative_prompt 字段被丢弃。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FF = path.join(ROOT, 'tools', 'ffmpeg');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vf-round37-'));
const adapters = require(path.join(ROOT, 'server/adapters'));

let PASS = 0, FAIL = 0;
const ok = (c, label, extra) => {
  if (c) { PASS++; console.log('  ✓ ' + label); }
  else { FAIL++; console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 240) : '')); }
};

const CLIP = path.join(TMP, 'clip.mp4');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=320x180:d=0.6 -pix_fmt yuv420p -c:v libx264 "${CLIP}"`);
const IMG = path.join(TMP, 'src.png');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=512x288 -frames:v 1 "${IMG}"`);

const RESOLUTIONS = ['480P', '720P', '1080P'];
const RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'];
const seen = { create: null, createHeaders: null, pollPaths: [], polls: 0, imgBody: null };
const PNG = path.join(TMP, 'gen.png');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=1024x1024 -frames:v 1 "${PNG}"`);

const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  /* 百炼生图:同步 multimodal-generation,结果嵌在 output.choices[0].message.content[].image */
  if (req.method === 'POST' && u.pathname === '/api/v1/services/aigc/multimodal-generation/generation') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      const body = JSON.parse(b || '{}');
      seen.imgBody = body;
      const text = body.input && body.input.messages && body.input.messages[0].content[0].text;
      const size = body.parameters && body.parameters.size;
      if (!text) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 'InvalidParameter', message: 'content text is required' })); }
      if (!/^[0-9]+\*[0-9]+$/.test(String(size || ''))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 'InvalidParameter', message: "Expected format: '<width>*<height>'" }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        output: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ image: 'http://127.0.0.1:' + PORT + '/gen.png', type: 'image' }] } }] },
        usage: { output_image_count: 1, output_width: 1024, output_height: 1024 }, request_id: 'img-1'
      }));
    });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/gen.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return fs.createReadStream(PNG).pipe(res);
  }
  if (req.method === 'POST' && u.pathname === '/api/v1/services/aigc/video-generation/video-synthesis') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      /* 百炼没有异步头就不受理 */
      if (req.headers['x-dashscope-async'] !== 'enable') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 'InvalidParameter', message: 'X-DashScope-Async header is required' }));
      }
      const body = JSON.parse(b || '{}');
      seen.create = body;
      seen.createHeaders = { auth: req.headers.authorization || '' };
      const p = body.parameters || {};
      const err = (!body.input || !body.input.prompt) ? 'prompt is required'
        : !RESOLUTIONS.includes(p.resolution) ? `Input should be '1080P', '720P' or '480P': parameters.resolution`
        : !RATIOS.includes(p.ratio) ? `Input should be one of ratios: parameters.ratio`
        : !(p.duration === -1 || (p.duration >= 2 && p.duration <= 30)) ? 'duration must be -1 or in [2,30]'
        : !Array.isArray(body.input.media) ? 'input.media must be array'
        : body.input.media.some(m => !m || typeof m !== 'object' || !m.type || !m.url) ? 'media item needs type & url' : '';
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ request_id: 'r1', output: { task_id: 't-rejected', task_status: 'PENDING' }, reject: err }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ request_id: 'r1', output: { task_id: 'task-mock-001', task_status: 'PENDING' } }));
    });
    return;
  }
  const m = /^\/api\/v1\/tasks\/([^/]+)$/.exec(u.pathname);
  if (req.method === 'GET' && m) {
    seen.polls++;
    seen.pollPaths.push(u.pathname);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(seen.polls < 2
      ? JSON.stringify({ request_id: 'r2', output: { task_id: m[1], task_status: 'RUNNING' } })
      : JSON.stringify({
        request_id: 'r3',
        output: { task_id: m[1], task_status: 'SUCCEEDED', video_url: 'http://127.0.0.1:' + PORT + '/clip.mp4' },
        usage: { duration: 5, SR: 480, ratio: '16:9', video_count: 1 }
      }));
  }
  if (req.method === 'GET' && u.pathname === '/clip.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return fs.createReadStream(CLIP).pipe(res);
  }
  /* 其余路径按百炼风格回 404,证明轮询没有退回 /videos/{id} */
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'NotFound', message: 'no route ' + u.pathname }));
});
let PORT = 0;

const RULES = {
  protocol: 'openai-video',
  create: {
    path: '/services/aigc/video-generation/video-synthesis',
    method: 'POST',
    headers: { 'X-DashScope-Async': 'enable' },
    id_path: 'output.task_id',
    nested_media: true,
    body: {
      model: '<model_id>',
      input: {
        prompt: '<prompt>',
        negative_prompt: '<negative_prompt>',
        media: [{ type: 'first_frame', url: '<first_frame>' }]
      },
      parameters: { resolution: '<size>', ratio: '<aspect_ratio>', duration: '<seconds>' }
    }
  },
  query: {
    path: '/tasks/<video_id>',
    use_origin: false,
    method: 'GET',
    params: {},
    data_path: 'output',
    status_field: 'task_status',
    status_values: { completed: ['succeeded'], failed: ['failed', 'canceled', 'unknown'] },
    video_url_field: 'video_url',
    error_field: 'message'
  },
  limits: { min_seconds: 2, max_seconds: 30, seconds_type: 'number' }
};

(async () => {
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  PORT = mock.address().port;

  const model = {
    id: 'm-bailian-mock', type: 'image-to-video', is_free: 1,
    api_base: 'http://127.0.0.1:' + PORT + '/api/v1', api_key: 'sk-mock-bailian',
    model_id: 'wan3.0-video', rules: JSON.stringify(RULES)
  };
  const params = { duration: 5, fps: 30, motion: 0.5, seed: -1, resolution: '480p', aspect_ratio: '16:9' };
  const task = { id: 't-bailian-mock', prompt: '镜头缓慢推近，水洼里的纸船漂动', negative_prompt: '', params: JSON.stringify(params) };
  const src = { id: 'a-src', name: 'src.png', path: IMG, mime: 'image/png', width: 512, height: 288 };
  const outFile = path.join(TMP, 'out.mp4');
  const remote = [];
  const ctx = {
    model, task, params, src, linked: [], outFile, styleGrade: null,
    onProgress: () => {}, recordRemote: id => remote.push(id)
  };

  const produced = await adapters.run(model, ctx);
  const body = seen.create || {};
  const p = body.parameters || {};
  const input = body.input || {};
  const media = input.media || [];

  console.log('\n-- 请求体与规则能力 --');
  ok(produced === outFile && fs.existsSync(outFile), '适配器产出成片文件');
  ok(body.model === 'wan3.0-video', 'model 令牌替换', body.model);
  ok(media.length === 1 && media[0].type === 'first_frame', '嵌套 media 结构按规则生成', media);
  ok(/^data:image\//.test(media[0].url || '') || /^https?:/.test(media[0].url || ''), 'first_frame 令牌解析成真实媒体地址', String(media[0].url).slice(0, 40));
  ok(p.duration === 5, 'duration 保持数字类型', p.duration);
  ok(p.resolution === '480P', 'resolution 出大写档位(720p→480P 同源换算)', p.resolution);
  ok(p.ratio === '16:9', 'ratio 取所选画幅', p.ratio);
  ok(!('negative_prompt' in input), '空 negative_prompt 字段被丢弃', input);
  ok(body.reject === undefined, 'mock 未拒绝本次请求(异步头/参数校验全过)', body.reject);
  ok(seen.createHeaders.auth === 'Bearer sk-mock-bailian', 'Authorization 头正常', seen.createHeaders);

  console.log('\n-- 任务 ID 与轮询路径 --');
  ok(remote[0] === 'task-mock-001', 'create.id_path 取到嵌套 output.task_id', remote);
  ok(seen.pollPaths.length >= 2 && seen.pollPaths.every(x => x === '/api/v1/tasks/task-mock-001'), 'query.path 的 <video_id> 生效(未回退 /videos/{id})', seen.pollPaths);
  ok(seen.polls >= 2, 'RUNNING→SUCCEEDED 轮询到终态', { polls: seen.polls });

  console.log('\n-- 成片规格 --');
  const { probe } = require(path.join(ROOT, 'server/ffmpeg'));
  const info = probe(outFile);
  ok(info.width === 320 && info.height === 180, '下载并解析成片 320×180', info);
  ok(fs.statSync(outFile).size > 1000, '成片字节数合理', fs.statSync(outFile).size);

  console.log('\n-- 缺异步头必须失败(反证 create.headers 生效) --');
  const badRules = JSON.parse(JSON.stringify(RULES));
  delete badRules.create.headers;
  const badModel = Object.assign({}, model, { id: 'm-bailian-nobean', rules: JSON.stringify(badRules) });
  let threw = '';
  try {
    await adapters.run(badModel, Object.assign({}, ctx, { model: badModel, outFile: path.join(TMP, 'bad.mp4') }));
  } catch (e) { threw = e.message; }
  ok(/header is required|X-DashScope-Async/i.test(threw), '去掉自定义头后被网关拒绝', threw.slice(0, 120));

  console.log('\n-- 百炼生图(qwen-image):嵌套模板 + 深层结果解析 --');
  const imagegen = require(path.join(ROOT, 'server/imagegen'));
  const imgModel = {
    id: 'm-qwen-mock', type: 'text-to-image', is_free: 1,
    api_base: 'http://127.0.0.1:' + PORT + '/api/v1', api_key: 'sk-mock-bailian',
    model_id: 'qwen-image-3.0',
    rules: JSON.stringify({
      protocol: 'openai-image',
      create: {
        path: '/services/aigc/multimodal-generation/generation',
        edit: 'none',
        body: {
          model: '<model_id>',
          input: { messages: [{ role: 'user', content: [{ text: '<prompt>' }] }] },
          parameters: { size: '<width>*<height>', n: '<n>', negative_prompt: '<negative_prompt>', prompt_extend: false, watermark: false }
        }
      },
      response: { data_path: 'output.choices.0.message.content', url_field: 'image' },
      limits: { max_count: 1, resolutions: ['1K', '2K'], sizes: ['2048x2048', '1024x1024', '1664x928'] }
    })
  };
  const imgCtx = {
    model: imgModel, rules: JSON.parse(imgModel.rules), task: { id: 't-img-mock' },
    params: { resolution: '1K', aspect_ratio: '1:1', size: '1024x1024', seed: -1 },
    prompt: '一只纸船漂在水洼上', negativePrompt: '文字，水印', count: 1,
    refAssets: [], refAsset: null, outBase: path.join(TMP, 'img'), onProgress: () => {}
  };
  const files = await imagegen.run(imgModel, imgCtx);
  const ib = seen.imgBody || {};
  ok(Array.isArray(files) && files.length === 1 && fs.existsSync(files[0]), '生图产出并下载入库文件', files);
  ok(ib.input && ib.input.messages[0].content[0].text === '一只纸船漂在水洼上', '深填充:提示词写到三层嵌套里', ib.input && ib.input.messages[0].content);
  ok(ib.parameters && ib.parameters.size === '1024*1024', '尺寸出成百炼要求的「宽*高」星号格式', ib.parameters && ib.parameters.size);
  ok(ib.parameters.n === 1, 'n 保持数字 1', ib.parameters && ib.parameters.n);
  ok(ib.parameters.negative_prompt === '文字，水印', 'negative_prompt 透传到 parameters', ib.parameters && ib.parameters.negative_prompt);
  ok(ib.parameters.watermark === false && ib.parameters.prompt_extend === false, '水印/智能改写按规则关闭', ib.parameters);
  const imgInfo = require(path.join(ROOT, 'server/ffmpeg')).probe(files[0]);
  ok(imgInfo.width === 1024 && imgInfo.height === 1024, '结果按 data_path + url_field 从深层结构取到并下载', imgInfo);

  console.log('\n================ 结果 ================');
  console.log('通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项');
  mock.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); mock.close(); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(2); });
