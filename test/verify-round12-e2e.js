'use strict';
/* 第十二轮端到端验证:适配器注册中心 + 生成规则驱动 + 通用协议
 * 启动 Mock 网关 → 模拟 openai-video 协议 → 验证请求体 / 轮询 / 下载 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const WORK = __dirname;
const adapters = require(path.join(WORK, '..', 'server/adapters'));

let ok = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { ok++; }
  else { fail++; console.error('FAIL: ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
}
function okFn(v, msg) { if (v) ok++; else { fail++; console.error('FAIL: ' + msg); } }

async function main() {
  // 0. 准备结果视频文件(避免依赖 /tmp 残留):用 ffmpeg-static 生成 0.3s 最小 MP4
  const FFMPEG_BIN = require('ffmpeg-static');
  const { execFileSync } = require('child_process');
  const resultMp4 = '/tmp/r12-result.mp4';
  try { fs.unlinkSync(resultMp4); } catch (e) {}
  execFileSync(FFMPEG_BIN, ['-y', '-f', 'lavfi', '-i', 'gradients=s=128x72:d=0.3', '-vf', 'format=yuv420p', '-frames:v', '8', resultMp4], { stdio: 'ignore' });

  // 1. Start mock gateway
  const MOCK_PORT = 4199;
  const createdBodies = [];
  const server = http.createServer((req, res) => {
    const u = url.parse(req.url, true);
    if (req.method === 'POST' && u.pathname === '/v1/videos') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          createdBodies.push(j);
          console.log('MOCK: POST /videos ' + JSON.stringify(j).slice(0, 300));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ video_id: 'mock-vid-e2e', status: 'queued' }));
        } catch (e) {
          res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
        }
      });
    } else if (req.method === 'GET' && u.pathname === '/agnesapi') {
      console.log('MOCK: GET /agnesapi?video_id=' + u.query.video_id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', video_url: 'http://localhost:' + MOCK_PORT + '/result/final.mp4' }));
    } else if (req.method === 'GET' && u.pathname === '/result/final.mp4') {
      const mp4 = fs.readFileSync(resultMp4);
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(mp4);
    } else {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise(r => server.listen(MOCK_PORT, r));
  console.log('Mock gateway on :' + MOCK_PORT);

  // 2. Test openai-video adapter with rules
  const model = {
    id: 'm-test-rules',
    api_base: 'http://localhost:' + MOCK_PORT + '/v1',
    api_key: 'test-key',
    model_id: 'test-model',
    rules: JSON.stringify({
      protocol: 'openai-video',
      create: {
        path: '/videos',
        // override defaults: use custom body template
        body: {
          model: '<model_id>',
          prompt: '<prompt>',
          mode: '<mode>',
          seconds: '<seconds>',
          size: '<size>',
          aspect_ratio: '<aspect_ratio>',
          seed: '<seed>',
          fps: '<fps>',
          negative_prompt: '<negative_prompt>'
        },
        images_field: 'images',
        first_frame_field: 'first_frame',
        seconds_type: 'string'
      },
      query: {
        path: '/agnesapi',
        use_origin: true,
        params: { video_id: '<video_id>', model_name: '<model_id>' }
      },
      limits: { max_images: 3, min_seconds: 1, max_seconds: 30, fixed_size: '720P' }
    })
  };

  // 3. Verify detect protocol
  eq(adapters.detectProtocol(model), 'openai-video', 'e2e detect openai-video');

  // 4. Verify normalizeRules
  const nr = adapters.normalizeRules(model);
  eq(nr.protocol, 'openai-video', 'e2e normalize protocol');
  eq(nr.limits.max_images, 3, 'e2e customize limits');
  okFn(nr.create.body.prompt !== undefined, 'e2e custom body template');

  // 5. Test buildOpenAiBody
  const task = { prompt: 'a test video', negative_prompt: 'no watermarks' };
  const params = { duration: 8, aspect_ratio: '16:9', seed: 123, fps: 30 };
  const tempImg = path.join('/tmp', 'r12-src-' + Date.now() + '.png');
  fs.writeFileSync(tempImg, Buffer.from('fake-png-content'));
  const src = { id: 'a-src', name: 'source.png', path: tempImg, mime: 'image/png' };
  const linked = [{ id: 'a-ref', name: 'ref.jpg', path: tempImg, mime: 'image/jpeg' }];

  const rules = adapters.normalizeRules(model);
  const mode = adapters.planMode(rules, { src, linked });
  eq(mode, 'reference', 'e2e plan mode reference');

  const media = adapters.planMedia({ task, src, linked }, mode, rules);
  eq(media.images.length, 2, 'e2e planMedia images (src + ref)');
  okFn(media.prompt === task.prompt, 'e2e prompt unchanged (no [name] tokens)');

  const body = await adapters.buildOpenAiBody(rules, model, task, params, media.prompt, mode, media);
  okFn(body, 'e2e buildOpenAiBody returned');
  eq(body.model, 'test-model', 'e2e body.model');
  eq(body.prompt, 'a test video', 'e2e body.prompt');
  eq(body.mode, 'reference', 'e2e body.mode');
  eq(body.seconds, '8', 'e2e body.seconds string');
  eq(body.size, '720P', 'e2e body.size fixed');
  eq(body.aspect_ratio, '16:9', 'e2e body.aspect_ratio');
  eq(body.seed, 123, 'e2e body.seed');
  eq(body.fps, 30, 'e2e body.fps');
  eq(body.negative_prompt, 'no watermarks', 'e2e body.negative_prompt');
  okFn(Array.isArray(body.images), 'e2e body.images array');
  eq(body.images.length, 2, 'e2e body.images length');
  okFn(body.images[0].startsWith('data:'), 'e2e body.images[0] base64');

  // 6. Test openAiCreate (real HTTP to mock)
  const { videoId } = await adapters.openAiCreate(rules, model, body);
  eq(videoId, 'mock-vid-e2e', 'e2e create videoId');

  // 7. Verify the mock received the correct body
  okFn(createdBodies.length >= 1, 'e2e mock received at least 1 request');
  if (createdBodies.length > 0) {
    const sent = createdBodies[0];
    eq(sent.model, 'test-model', 'e2e mock received model');
    eq(sent.seconds, '8', 'e2e mock received seconds');
    okFn(Array.isArray(sent.images), 'e2e mock received images array');
  }

  // 8. Test openAiQuery
  const status = await adapters.openAiQuery(rules, model, videoId);
  eq(status.status, 'completed', 'e2e query status');
  okFn(status.videoUrl.includes('localhost'), 'e2e query videoUrl');

  // 9. Test download
  const outFile = '/tmp/r12-downloaded.mp4';
  const agnes = require(path.join(WORK, '..', 'server/agnes'));
  await agnes.downloadVideo(status.videoUrl, outFile);
  okFn(fs.existsSync(outFile) && fs.statSync(outFile).size > 0, 'e2e download success');

  // Cleanup
  server.close();
  try { fs.unlinkSync(tempImg); } catch(e) {}
  try { fs.unlinkSync(outFile); } catch(e) {}

  console.log('\nE2E Results: ' + ok + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('E2E ERROR:', e); process.exit(1); });
