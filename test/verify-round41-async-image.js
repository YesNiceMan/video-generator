'use strict';
/* 第四十一轮回归(异步生图收单 rules.async · 中转站 gpt-image-2.5 系列)
 * 实测契约:POST /v1/images/generations 立刻回 {id,status:"queued",data:[]};
 * 取件要再走三段,且全部要求 x-creative-contract-version: 1 头 ——
 *   GET /v1/creative/tasks/<job_id>            任务状态
 *   GET /v1/creative/assets?job_id=<job_id>    素材清单(数字 id)
 *   GET /v1/creative/assets/<asset_id>/content 图片字节
 * 本脚本用 Mock 网关复刻该契约(含缺头 409),不产生任何真实费用。
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-round41-'));
const imagegen = require(path.join(ROOT, 'server', 'imagegen'));

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 300) + ']' : '')); }
};

/* 一张真实 PNG(ffmpeg 可用则用它,否则退回手写 8x8 PNG) */
const PNG = path.join(TMP, 'gen.png');
try {
  const FF = path.join(ROOT, 'tools', 'ffmpeg');
  execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=64x64 -frames:v 1 "${PNG}"`);
} catch (e) {
  const zlib = require('zlib');
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = buf => buf.reduce((c, b) => crcTable[(c ^ b) & 255] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body) >>> 0);
    return Buffer.concat([len, body, c]);
  };
  const W = 8, H = 8, raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = x * 30; raw[o + 1] = y * 30; raw[o + 2] = 128;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(PNG, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const PNG_BYTES = fs.readFileSync(PNG);

const seen = { create: 0, task: 0, assets: 0, content: 0, noHeader: 0, bodies: [] };
let PORT;

function startMock(mode) {
  /* mode: 'happy' 两轮 running 后 completed; 'stuck' 永远 running; 'fail' 直接失败 */
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const hdr = req.headers['x-creative-contract-version'];
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && u.pathname === '/v1/images/generations') {
      let b = ''; req.on('data', c => b += c);
      req.on('end', () => {
        seen.create++;
        try { seen.bodies.push(JSON.parse(b || '{}')); } catch (e) { seen.bodies.push({}); }
        json(200, { created: 1, data: [], id: 'creative_job1', model: 'gpt-image-2.5-sunburst-cpa', object: 'list', status: 'queued' });
      });
      return;
    }
    if (u.pathname.startsWith('/v1/creative/')) {
      if (hdr !== '1') { seen.noHeader++; return json(409, { code: 'CREATIVE_CONTRACT_VERSION_MISMATCH', message: '画布版本与创作服务不兼容，请刷新页面后重试' }); }
      if (u.pathname.startsWith('/v1/creative/tasks/')) {
        seen.task++;
        const st = mode === 'fail' ? 'failed' : (mode === 'stuck' ? 'running' : (seen.task >= 3 ? 'completed' : 'running'));
        return json(200, {
          id: 'creative_job1', media_type: 'image', status: st, output_count: 2, success_count: st === 'completed' ? 2 : 0,
          error: st === 'failed' ? { code: 'content_policy', message: '提示词触发内容审核' } : undefined
        });
      }
      if (u.pathname === '/v1/creative/assets') {
        seen.assets++;
        if (u.searchParams.get('job_id') !== 'creative_job1') return json(200, []);
        return json(200, [{ id: 11, job_id: 'creative_job1', mime_type: 'image/png' }, { id: 12, job_id: 'creative_job1', mime_type: 'image/png' }]);
      }
      const m = /^\/v1\/creative\/assets\/(\d+)\/content$/.exec(u.pathname);
      if (m) { seen.content++; res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG_BYTES); }
    }
    json(404, { error: { message: 'not found' } });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function asyncRules(extra) {
  const base = {
    protocol: 'openai-image',
    create: { path: '/images/generations', edit: 'none', body: { model: '<model_id>', prompt: '<prompt>', n: '<n>', size: '<size>' } },
    async: {
      task_path: '/creative/tasks/<job_id>',
      task_headers: { 'x-creative-contract-version': '1' },
      assets_path: '/creative/assets?job_id=<job_id>',
      content_path: '/creative/assets/<asset_id>/content',
      interval_ms: 1000, timeout_ms: 20000
    }
  };
  const patch = extra || {};
  for (const k of Object.keys(patch)) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) base[k] = Object.assign({}, base[k], patch[k]);
    else base[k] = patch[k];
  }
  return JSON.stringify(base);
}
const model = rules => ({
  id: 'm-r41', name: 'Async Mock', type: 'text-to-image',
  api_base: 'http://127.0.0.1:' + PORT + '/v1', api_key: 'sk-test', model_id: 'gpt-image-2.5-sunburst-cpa',
  rules
});
const ctx = outBase => ({
  task: { prompt: 'p' }, params: { size: '1024x1024' }, prompt: '异步生图回归', negativePrompt: '',
  count: 1, refAsset: null, outBase, onProgress: () => {}
});

async function main() {
  console.log('== A. 单元:async 规则识别 ==');
  const n = imagegen.normalizeRules(model(asyncRules()));
  ok('normalizeRules 保留 rules.async(否则适配器拿不到)', !!(n.async && n.async.task_path), Object.keys(n));
  /* isQueuedResponse 吃的是 normalizeAsync(整份 rules) 补全默认值后的配置 */
  const acfg = imagegen.normalizeAsync(n);
  ok('isQueuedResponse:queued + data 空 → true', imagegen.isQueuedResponse({ status: 'queued', data: [] }, acfg));
  ok('isQueuedResponse:已有 data → false(仍按同步处理)',
    !imagegen.isQueuedResponse({ status: 'completed', data: [{ url: 'https://x/y.png' }] }, acfg));
  ok('isQueuedResponse:无 status 字段 → false', !imagegen.isQueuedResponse({ data: [] }, acfg));
  ok('normalizeAsync 补齐缺省清单(pending/status_values/超时)', imagegen.normalizeAsync({ async: { task_path: '/x' } }).timeout_ms === 600000
    && acfg.timeout_ms === 20000 && acfg.pending_values.includes('queued') && acfg.status_values.completed.includes('succeeded'),
  { own: acfg.timeout_ms, dflt: imagegen.normalizeAsync({ async: { task_path: '/x' } }).timeout_ms });
  ok('fillTokens 对 id 做 URL 编码', imagegen.fillTokens('/t/<job_id>', { job_id: 'a/b c' }) === '/t/a%2Fb%20c', imagegen.fillTokens('/t/<job_id>', { job_id: 'a/b c' }));

  console.log('== B. Mock 网关:正常收单 ==');
  PORT = 0;
  let server = await startMock('happy');
  PORT = server.address().port;
  let files = [];
  const began = Date.now();
  try {
    files = await imagegen.run(model(asyncRules()), ctx(path.join(TMP, 'happy')));
  } catch (e) { ok('正常收单不抛错', false, String(e.message)); }
  ok('取回 2 张图(素材清单里的每一条都落盘)', files.length === 2, files);
  ok('落盘内容是 PNG(魔数校验)', files.every(f => fs.readFileSync(f).slice(0, 4).toString('hex') === '89504e47'), files.map(f => f.slice(-12)));
  ok('轮询到第 3 次才 completed(说明按状态等待)', seen.task >= 3, { task: seen.task });
  ok('任务/清单/内容三类请求都带契约头(mock 缺头会 409)', seen.noHeader === 0, { noHeader: seen.noHeader });
  ok('素材清单按 job_id 过滤', seen.assets === 1 && seen.content === 2, { assets: seen.assets, content: seen.content });
  ok('收单耗时 ≥2s(两轮 running 间隔)', Date.now() - began >= 2000, Date.now() - began);
  ok('提交体仍是 OpenAI 兼容形态(model/prompt/size/n)', seen.bodies[0] && seen.bodies[0].model === 'gpt-image-2.5-sunburst-cpa' && seen.bodies[0].size === '1024x1024', seen.bodies[0]);
  server.close();

  console.log('== C. 失败与超时路径 ==');
  server = await startMock('fail'); PORT = server.address().port;
  let err = '';
  try { await imagegen.run(model(asyncRules()), ctx(path.join(TMP, 'fail'))); } catch (e) { err = e.message; }
  ok('网关判失败时错误带状态与原因', /异步任务失败\(failed\)/.test(err) && /内容审核/.test(err), err.slice(0, 160));
  server.close();

  server = await startMock('stuck'); PORT = server.address().port;
  err = '';
  try {
    await imagegen.run(model(asyncRules({ async: { interval_ms: 500, timeout_ms: 1500 } })), ctx(path.join(TMP, 'stuck')));
  } catch (e) { err = e.message; }
  ok('超时不再无限等,且提示任务仍在服务方', /异步出图超时/.test(err) && /仍在服务方/.test(err), err.slice(0, 160));
  server.close();

  console.log('== D. 未配 async 的可读报错(本轮的原始事故) ==');
  server = await startMock('happy'); PORT = server.address().port;
  err = '';
  try {
    await imagegen.run(model(JSON.stringify({ protocol: 'openai-image', create: { edit: 'none' } })), ctx(path.join(TMP, 'noasync')));
  } catch (e) { err = e.message; }
  ok('错误文案点明「异步受理 + 需补 rules.async」', /网关已受理但响应里没有图片/.test(err) && /rules\.async/.test(err), err.slice(0, 200));
  ok('不再输出误导性的「响应中没有结果图片」', !/响应中没有结果图片/.test(err), err.slice(0, 120));
  server.close();

  console.log('\n通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('运行失败:', (e && e.stack) || e); process.exit(1); });
