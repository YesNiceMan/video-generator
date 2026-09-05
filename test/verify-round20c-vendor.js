'use strict';
/* 二十·续验证:跃数等中转网关诊断能力
   1) detectProtocol:as-sd2.0-fast / sora-v3 → openai-video(不再误判 agnes-v2);agnes- 模型保持原判
   2) openAiCreate 创建路径自动试探:404 换候选 → /videos/generations 成功;显式配置不回退
   3) 服务商"not supported"应答 → 报错含行动建议
   4) REST 查询候选:createPath/{id} */
const http = require('http');
const adapters = require('../server/adapters');
let PASS = 0, FAIL = 0;
function eq(a, b, msg) { if (a === b) { PASS++; console.log('  ✓ ' + msg); } else { FAIL++; console.log('  ✗ ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); } }
function okFn(v, msg, detail) { if (v) { PASS++; console.log('  ✓ ' + msg); } else { FAIL++; console.log('  ✗ ' + msg + (detail ? '  [' + detail + ']' : '')); } }

/* mock 网关:/videos 404(纯文本),/videos/generations 创建成功并可查询 */
function startMock() {
  return new Promise(resolve => {
    const jobs = new Map();
    let seq = 0;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.method === 'POST' && url.pathname === '/v1/videos') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 page not found'); return; }
        if (req.method === 'POST' && url.pathname === '/v1/videos/generations') {
          const j = JSON.parse(body || '{}');
          if (j.model === 'bad-model') { send(404, { error: { message: 'Videos API is not supported for this platform', type: 'not_found_error' } }); return; }
          const id = 'job-' + (++seq);
          jobs.set(id, { status: 'completed', url: 'http://x/fake.mp4' });
          send(200, { id, status: 'queued' });
          return;
        }
        const mJob = url.pathname.match(/^\/v1\/videos\/generations\/([^/]+)$/);
        if (req.method === 'GET' && mJob) {
          const j = jobs.get(mJob[1]);
          if (j) send(200, j); else send(404, { error: { message: 'job not found' } });
          return;
        }
        if (req.method === 'GET' && url.pathname.startsWith('/models')) { send(200, { data: [{ id: 'm1' }] }); return; }
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 page not found');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  console.log('== 1) detectProtocol 修正 ==');
  const base = 'https://gateway.example.com/v1';
  eq(adapters.detectProtocol({ id: 'a', api_base: base, api_key: 'k', model_id: 'as-sd2.0-fast' }), 'openai-video', 'sd2.0 → openai-video');
  eq(adapters.detectProtocol({ id: 'b', api_base: base, api_key: 'k', model_id: 'sora-v3-431-fast' }), 'openai-video', 'sora-v3 → openai-video');
  eq(adapters.detectProtocol({ id: 'c', api_base: base, api_key: 'k', model_id: 'wan2.7-image' }), 'openai-video', 'wan2.7 → openai-video');
  eq(adapters.detectProtocol({ id: 'd', api_base: base, api_key: 'k', model_id: 'agnes-video-2.5-flash' }), 'agnes-flash', 'agnes flash 保持');
  eq(adapters.detectProtocol({ id: 'e', api_base: base, api_key: 'k', model_id: 'agnes-video-v2.0' }), 'agnes-v2', 'agnes v2 保持');
  eq(adapters.detectProtocol({ id: 'f', api_base: 'https://apihub.agnes-ai.com/v1', api_key: 'k', model_id: 'foo-2.0' }), 'openai-video', 'agnes 域名 + 非闪模型 → openai-video');

  console.log('== 2) 创建路径自动试探 ==');
  const { server, port } = await startMock();
  const gw = 'http://127.0.0.1:' + port + '/v1';
  const modelAuto = { id: 'm-auto', api_base: gw, api_key: 'k', model_id: 'good-model', rules: '' };
  const create = await adapters.openAiCreate(adapters.normalizeRules(modelAuto), modelAuto, { model: 'good-model', prompt: 'p' });
  eq(create.videoId.startsWith('job-'), true, '自动试探命中 /videos/generations 并创建成功');
  const modelExplicit = { id: 'm-explicit', api_base: gw, api_key: 'k', model_id: 'good-model', rules: JSON.stringify({ create: { path: '/videos' } }) };
  let explicitErr = '';
  try { await adapters.openAiCreate(adapters.normalizeRules(modelExplicit), modelExplicit, { model: 'good-model', prompt: 'p' }); }
  catch (e) { explicitErr = e.message; }
  okFn(explicitErr.includes('/videos') && explicitErr.includes('404'), '显式配置 create.path 时不回退,报错包含路径与原因', explicitErr.slice(0, 120));

  console.log('== 3) not supported 行动建议 ==');
  const modelBad = { id: 'm-bad', api_base: gw, api_key: 'k', model_id: 'bad-model', rules: '' };
  let badErr = '';
  try { await adapters.openAiCreate(adapters.normalizeRules(modelBad), modelBad, { model: 'bad-model', prompt: 'p' }); }
  catch (e) { badErr = e.message; }
  okFn(/not supported/.test(badErr) && /服务商/.test(badErr), 'not supported 应答 → 报错含服务商建议', badErr.slice(0, 160));

  console.log('== 4) REST 查询候选 ==');
  const queried = await adapters.openAiQuery(adapters.normalizeRules(modelAuto), modelAuto, create.videoId);
  eq(queried.status, 'completed', 'REST 查询 createPath/{id} 拿到状态');
  eq(queried.videoUrl, 'http://x/fake.mp4', 'REST 查询拿到视频地址');

  server.close();
  console.log('\nRESULT: ' + PASS + ' pass, ' + FAIL + ' fail');
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('FAIL', e.message); process.exit(1); });
