'use strict';
setTimeout(() => { console.error('WATCHDOG-TIMEOUT: test hung'); process.exit(2); }, 120000);

/* 第二十五轮端到端验证:AI 生图(二十三/1)
 * 适配器注册中心 + OpenAI 生图兼容协议(含图生图 multipart)+ Gemini 协议 + 本地占位生图
 * 启动 Mock 网关 → 验证请求体 / 响应解析 / 图片落盘 / 协议自动识别 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const WORK = path.join(__dirname, '..');
const imagegen = require(path.join(WORK, 'server/imagegen'));

let ok = 0, fail = 0;
function eq(a, b, msg) {
  if (a === b) { ok++; }
  else { fail++; console.error('FAIL: ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
}
function okFn(v, msg) { if (v) ok++; else { fail++; console.error('FAIL: ' + msg); } }

/* 1x1 红色 PNG(标准 base64) */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  /* ---------- 0. 协议识别 / 规则解析 ---------- */
  eq(imagegen.detectProtocol({ id: 'a', model_id: 'gemini-2.5-flash-image', api_key: 'k', api_base: '' }), 'gemini-image', 'detect gemini by model_id');
  eq(imagegen.detectProtocol({ id: 'b', model_id: 'imagen-4' }), 'gemini-image', 'detect imagen');
  eq(imagegen.detectProtocol({ id: 'c', model_id: 'gpt-image-1', api_base: 'https://api.openai.com/v1', api_key: 'k' }), 'openai-image', 'detect openai-image by api_base');
  eq(imagegen.detectProtocol({ id: 'd', model_id: '', api_base: '' }), 'img-ffmpeg', 'detect local fallback');
  eq(imagegen.detectProtocol({ id: 'e', rules: JSON.stringify({ protocol: 'openai-image' }) }), 'openai-image', 'explicit rules protocol');

  const nr = imagegen.normalizeRules({ id: 'f', model_id: 'gpt-image-1', api_base: 'https://x/v1', rules: '' });
  eq(nr.protocol, 'openai-image', 'normalize protocol');
  eq(nr.create.path, '/images/generations', 'normalize default create path');
  eq(nr.response.data_path, 'data', 'normalize response data_path');
  okFn(Array.isArray(nr.limits.sizes), 'normalize limits sizes');

  eq(JSON.stringify(imagegen.sizeToWH('1024x1024')), JSON.stringify({ w: 1024, h: 1024 }), 'sizeToWH parse');
  eq(imagegen.whToAspect(1536, 1024), '3:2', 'whToAspect');
  eq(imagegen.fillTemplate('<n>', { n: 2 }), 2, 'fillTemplate full-token keeps type');
  eq(imagegen.fillTemplate('a <prompt> b', { prompt: 'x' }), 'a x b', 'fillTemplate inline');

  /* ---------- 1. Mock 生图网关 ---------- */
  const MOCK_PORT = 4217;
  const seen = { generations: [], edits: [], gemini: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && u.pathname === '/v1/images/generations') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        seen.generations.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ created: 1, data: [
          { b64_json: PNG_1X1.toString('base64') },
          { url: 'http://localhost:' + MOCK_PORT + '/files/a.png' }
        ] }));
      });
    } else if (req.method === 'POST' && u.pathname === '/v1/images/drop') {
      /* 网关已受理(会扣费)却在回传响应体中途掐断连接 —— 平台必须给出可读错误 */
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{"created":1,"data":[{"b64_json":"');
        setTimeout(() => res.destroy(), 60);
      });
    } else if (req.method === 'POST' && u.pathname === '/v1/images/edits') {
      const parts = [];
      req.on('data', c => parts.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(parts).toString('utf8');
        seen.edits.push({
          hasImage: raw.includes('name="image"'),
          hasModel: raw.includes('name="model"'),
          hasPrompt: raw.includes('name="prompt"'),
          hasN: raw.includes('name="n"'),
          nValue: (raw.split('name="n"')[1] || '').replace(/^\r\n/, '').split('\r\n')[0] || ''
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }));
      });
    } else if (req.method === 'POST' && u.pathname === '/v1beta/models/gemini-2.5-flash-image:generateContent') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        seen.gemini.push({ auth: req.headers['x-goog-api-key'] || '', body: JSON.parse(body) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [
          { text: 'ok' },
          { inlineData: { mimeType: 'image/png', data: PNG_1X1.toString('base64') } }
        ] } }] }));
      });
    } else if (req.method === 'GET' && u.pathname === '/files/a.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PNG_1X1);
    } else {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise(r => server.listen(MOCK_PORT, r));
  console.log('Mock image gateway on :' + MOCK_PORT);

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-r25-'));
  const mOpen = {
    id: 'm-r25-open', name: 'GPT-Image(Mock)', type: 'text-to-image',
    api_base: 'http://localhost:' + MOCK_PORT + '/v1', api_key: 'sk-test', model_id: 'gpt-image-1',
    rules: JSON.stringify({ protocol: 'openai-image' })
  };
  const progress = [];
  let files = await imagegen.run(mOpen, {
    task: { prompt: 'a golden lighthouse at dusk' },
    params: { size: '1024x1024' },
    prompt: 'a golden lighthouse at dusk',
    negativePrompt: 'blurry',
    count: 1, refAsset: null,
    outBase: path.join(TMP, 'open-1'),
    onProgress: p => progress.push(p)
  });
  eq(files.length, 2, 'openai-image returns 2 images (b64 + url)');
  okFn(files[0] && files[0].endsWith('.png'), 'b64 image saved as .png');
  okFn(fs.existsSync(files[0]) && fs.statSync(files[0]).size > 0, 'b64 image file exists');
  okFn(fs.readFileSync(files[1]).slice(0, 4).toString('hex') === '89504e47', 'url-downloaded image is PNG (magic bytes)');
  eq(seen.generations.length, 1, 'mock received 1 generations request');
  const sent = seen.generations[0] || {};
  eq(sent.model, 'gpt-image-1', 'openai body model');
  eq(sent.prompt, 'a golden lighthouse at dusk', 'openai body prompt');
  eq(sent.n, 1, 'openai body n');
  eq(sent.size, '1024x1024', 'openai body size');
  okFn(progress.length > 0, 'onProgress invoked');

  /* ---------- 3b. 响应中途断流:错误必须可读且提示可能已扣费 ---------- */
  const mDrop = {
    id: 'm-r25-drop', name: '断流网关(Mock)', type: 'text-to-image',
    api_base: 'http://localhost:' + MOCK_PORT + '/v1', api_key: 'sk-test', model_id: 'gpt-image-2',
    rules: JSON.stringify({ protocol: 'openai-image', create: { path: '/images/drop' } })
  };
  let dropErr = '';
  try {
    await imagegen.run(mDrop, {
      task: { prompt: 'x' }, params: { size: '1024x1024' }, prompt: 'x',
      negativePrompt: '', count: 1, refAsset: null,
      outBase: path.join(TMP, 'drop-1'), onProgress: () => {}
    });
  } catch (e) { dropErr = e.message; }
  okFn(/中断/.test(dropErr) && /核对账单/.test(dropErr), '断流时报错说明「中断 + 可能已扣费」: ' + dropErr.slice(0, 90));
  okFn(dropErr.trim() !== 'terminated', '不再把裸 "terminated" 当任务错误: ' + JSON.stringify(dropErr.slice(0, 40)));

  /* ---------- 4. gemini-image(2 张 → 2 次请求) ---------- */
  const mGem = {
    id: 'm-r25-gem', name: 'Gemini 生图(Mock)', type: 'text-to-image',
    api_base: 'http://localhost:' + MOCK_PORT + '/v1beta', api_key: 'g-key', model_id: 'gemini-2.5-flash-image',
    rules: ''
  };
  files = await imagegen.run(mGem, {
    task: { prompt: 'neon city rain' },
    params: { size: '1536x1024' },
    prompt: 'neon city rain',
    negativePrompt: 'lowres',
    count: 2, refAsset: null,
    outBase: path.join(TMP, 'gem-1'),
    onProgress: () => {}
  });
  eq(files.length, 2, 'gemini returns 2 images for count=2');
  eq(seen.gemini.length, 2, 'gemini sent 2 requests');
  eq(seen.gemini[0].auth, 'g-key', 'gemini x-goog-api-key header');
  const gBody = seen.gemini[0].body;
  okFn(Array.isArray(gBody.contents) && gBody.contents[0].parts[0].text === 'neon city rain', 'gemini contents prompt part');
  okFn(JSON.stringify(gBody.generationConfig).includes('responseModalities'), 'gemini responseModalities');
  okFn(gBody.generationConfig.imageConfig && gBody.generationConfig.imageConfig.aspectRatio === '4:3', 'gemini aspect ratio from size (3:2 snaps to nearest supported 4:3)');

  /* ---------- 5. img-ffmpeg 本地占位生图 ---------- */
  const mLocal = { id: 'm-r25-local', name: '本地占位生图', type: 'text-to-image', api_base: '', model_id: '', rules: JSON.stringify({ protocol: 'img-ffmpeg' }) };
  files = await imagegen.run(mLocal, {
    task: { prompt: 'placeholder test' },
    params: { size: '512x512' },
    prompt: 'placeholder test',
    negativePrompt: '',
    count: 2, refAsset: null,
    outBase: path.join(TMP, 'loc-1'),
    onProgress: () => {}
  });
  eq(files.length, 2, 'img-ffmpeg returns 2 images');
  for (const f of files) {
    okFn(fs.existsSync(f) && fs.statSync(f).size > 0, 'placeholder file exists: ' + path.basename(f));
    okFn(fs.readFileSync(f).slice(0, 4).toString('hex') === '89504e47', 'placeholder is PNG: ' + path.basename(f));
  }

  /* ---------- 6. API 路由 / 迁移 / 种子 ---------- */
  const imagesApi = require(path.join(WORK, 'server/api/images'));
  okFn(typeof imagesApi === 'function', 'api/images router loads');
  const dbMod = require(path.join(WORK, 'server/db'));
  const freeImg = dbMod.db.prepare("SELECT * FROM models WHERE id='m-img-free'").get();
  okFn(freeImg && freeImg.type === 'text-to-image', 'seeded free image model m-img-free');
  const perImg = dbMod.db.prepare("SELECT value FROM settings WHERE key='creditPerImage'").get();
  okFn(!!perImg, 'setting creditPerImage present');
  const taskCols = dbMod.db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map(r => r.name);
  okFn(taskCols.includes('result_asset_ids'), 'tasks.result_asset_ids column migrated');

  /* ---------- cleanup ---------- */
  server.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

  console.log('');
  console.log('Round25 ImageGen Results: ' + ok + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('E2E ERROR:', e); process.exit(1); });


console.log('boot');