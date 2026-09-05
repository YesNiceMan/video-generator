
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const WORK = '/Users/a123/Desktop/test/video-generator';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-r12-'));
  const imgPath = path.join(tmp, 'src.png');
  fs.writeFileSync(imgPath, Buffer.from('fake-png'));

  const adapters = require(path.join(WORK, 'server/adapters'));
  let ok = 0, fail = 0;

  function eq(a, b, msg) {
    if (a === b) { ok++; }
    else { fail++; console.error('FAIL: ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
  }
  function okFn(v, msg) { if (v) ok++; else { fail++; console.error('FAIL: ' + msg); } }

  // 1. detectProtocol
  const mFlash = { id: 'x', api_base: 'https://a.com/v1', api_key: 'k', model_id: 'agnes-video-2.5-flash' };
  const mV2 = { id: 'y', api_base: 'https://a.com/v1', api_key: 'k', model_id: 'agnes-video-v2.0' };
  const mCustom = { id: 'z', api_base: 'https://b.com/v1', api_key: 'k', model_id: 'my-model-7' };
  const mFree = { id: 'f', api_base: '', model_id: '' };
  eq(adapters.detectProtocol(mFlash), 'agnes-flash', 'flash auto-detect');
  eq(adapters.detectProtocol(mV2), 'agnes-v2', 'v2 auto-detect');
  eq(adapters.detectProtocol(mCustom), 'openai-video', 'custom auto-detect');
  eq(adapters.detectProtocol(mFree), 'ffmpeg', 'free auto-detect');

  // 2. explicit rules override
  const mExplicit = { ...mCustom, rules: JSON.stringify({ protocol: 'agnes-v2' }) };
  eq(adapters.detectProtocol(mExplicit), 'agnes-v2', 'explicit rules protocol');

  // 3. parseRules
  const pr = adapters.parseRules(mExplicit);
  eq(pr.protocol, 'agnes-v2', 'parseRules');
  eq(adapters.parseRules(mFree).protocol, undefined, 'parseRules empty');

  // 4. normalizeRules
  const nr = adapters.normalizeRules(mFlash);
  eq(nr.protocol, 'agnes-flash', 'normalizeRules protocol');
  eq(nr.limits.max_images, 5, 'normalizeRules limits');
  okFn(Array.isArray(nr.modes), 'normalizeRules modes array');

  // 5. planMode
  const ctxRef = { src: { type: 'image' }, linked: [{ type: 'image' }] };
  const rulesFlash = adapters.normalizeRules(mFlash);
  eq(adapters.planMode(rulesFlash, ctxRef), 'reference', 'planMode reference');
  eq(adapters.planMode(rulesFlash, { src: { type: 'image' }, linked: [] }), 'keyframe', 'planMode keyframe');
  eq(adapters.planMode({ modes: ['text'] }, { src: { type: 'image' }, linked: [{ type: 'image' }] }), 'text', 'planMode text fallback');

  // 6. planMedia & promptForReference
  const task = { prompt: 'a [src] test [other]' };
  const media = adapters.planMedia({ task, src: { id: 'a1', name: 'src.png', path: imgPath, mime: 'image/png' }, linked: [{ id: 'a2', name: '参考图.jpg', path: imgPath, mime: 'image/jpeg' }] }, 'reference', rulesFlash);
  eq(media.images.length, 2, 'planMedia images count');
  okFn(media.prompt.includes('<Picture 1>'), 'planMedia prompt rewrite');
  eq(media.firstFrame.id, 'a1', 'planMedia firstFrame');

  // 7. buildOpenAiBody (pure function using data URI)
  const model = { ...mCustom, rules: '{"protocol":"openai-video"}' };
  const params = { duration: 5, aspect_ratio: '16:9', seed: 42, fps: 24 };
  const pm = adapters.planMedia({ task, src: media.firstFrame, linked: [] }, 'keyframe', adapters.normalizeRules(model));
  const body = await adapters.buildOpenAiBody(adapters.normalizeRules(model), model, task, params, pm.prompt, 'keyframe', pm);
  okFn(body, 'buildOpenAiBody returned');
  eq(body.seconds, '5', 'buildOpenAiBody seconds string');
  eq(body.mode, 'keyframe', 'buildOpenAiBody mode');
  okFn(typeof body.first_frame === 'string', 'buildOpenAiBody first_frame url');
  okFn(body.images === undefined, 'buildOpenAiBody no images in keyframe');

  // 8. openAiNormalize
  const nr2 = adapters.normalizeRules(model);
  const n1 = adapters.openAiNormalize({ status: 'completed', url: 'https://cdn/x.mp4' }, nr2);
  eq(n1.status, 'completed', 'normalize status completed');
  eq(n1.videoUrl, 'https://cdn/x.mp4', 'normalize videoUrl');
  const n2 = adapters.openAiNormalize({ status: 'failed', error: 'bad' }, nr2);
  eq(n2.status, 'failed', 'normalize status failed');
  eq(n2.error, 'bad', 'normalize error');

  // 9. Resolve adapter
  const resolved = adapters.resolve(mFlash);
  eq(resolved.id, 'agnes-flash', 'resolve agnes-flash');
  const resolved2 = adapters.resolve(mFree);
  eq(resolved2.id, 'ffmpeg', 'resolve ffmpeg');

  // 10. listAdapters
  const list = adapters.listAdapters();
  okFn(list.length >= 4, 'listAdapters count');
  okFn(list.some(a => a.id === 'openai-video'), 'listAdapters openai-video');

  // Cleanup
  try { fs.rmSync(tmp, { recursive: true }); } catch(e) {}

  console.log('Results: ' + ok + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
