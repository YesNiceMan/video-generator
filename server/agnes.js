'use strict';
/* Agnes Video 兼容 API 客户端(依据 doc/Agnes Video 2.5 Flash API.md)
 *
 * 接入要点(Flash 专属约束,创建前先本地校验,避免白白报 400):
 *   - 模型 ID:agnes-video-2.5-flash
 *   - size 固定字符串 "720P"(其他值 HTTP 400)
 *   - reference 模式 images 最多 5 张;不支持 videos 字段
 *   - seconds 为字符串 "4"-"12";n 固定 1
 *   - 轮询:推荐 GET {base}/agnesapi?video_id=<ID>&model_name=<model>(三种模式通用)
 *   - 所有媒体 URL 需公网可访问 → 本地文件优先用 PUBLIC_BASE_URL 生成签名直链,
 *     未配置公网地址时回退 base64 data URI(部分网关同样接受)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { db } = require('./db');
const { run } = require('./ffmpeg');

const FLASH_MODEL_ID = 'agnes-video-2.5-flash';
const POLL_INTERVAL_MS = 1500;      // 文档建议 1~2 秒查询一次
const POLL_TIMEOUT_MS = 15 * 60e3;  // 单任务最长等待 15 分钟

/* 创建任务的网络超时与重试:大图经 base64 内嵌时请求体可达数 MB,
   30 秒常不足以完成上传(历史报错「无法连接视频 API(请求超时)」),
   因此放宽到 120 秒并自动重试。 */
const CREATE_TIMEOUT_MS = 120e3;
const CREATE_ATTEMPTS = 3;

function appSecret() {
  return process.env.APP_SECRET || 'videoforge-local-secret';
}

function hmac(data) {
  return crypto.createHmac('sha256', appSecret()).update(String(data)).digest('base64url');
}

/* 为资产生成限时签名访问参数(供 Agnes 服务匿名拉取本站素材) */
function signAssetToken(assetId, ttlMs = 2 * 3600e3) {
  const exp = Date.now() + ttlMs;
  return 'exp=' + exp + '&sig=' + hmac(assetId + '.' + exp);
}

function verifyAssetToken(assetId, exp, sig) {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now()) return false;
  const expect = hmac(assetId + '.' + e);
  try {
    return crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expect));
  } catch (err) { return false; }
}

/* 公网基础地址:环境变量优先,其次系统设置 publicBaseUrl */
function publicBaseUrl() {
  let base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/[/]+$/, '');
  if (base) return base;
  try {
    const s = db.prepare("SELECT value FROM settings WHERE key='publicBaseUrl'").get();
    if (s) base = String(JSON.parse(s.value) || '').trim().replace(/[/]+$/, '');
  } catch (e) { /* 忽略 */ }
  return base || '';
}

/* 把本地资产转成 API 可用的媒体引用:
 *   1) 配置了公网地址 → http(s) 签名直链(文档推荐方式)
 *   2) 否则 → base64 data URI(多数 OpenAI 兼容网关支持)
 * 已是 http(s) 的引用原样返回。 */
function mediaRef(assetOrPath) {
  if (!assetOrPath) throw new Error('媒体引用为空');
  /* 注意:入参可能是 node:sqlite 返回的资产行(原型为 null),
     一旦参与正则匹配/字符串拼接会抛 "Cannot convert object to primitive value",
     因此先取字段,只对原始值做类型转换。 */
  const isObj = typeof assetOrPath === 'object';
  const asStr = isObj ? '' : String(assetOrPath);
  if (asStr && /^https?:[/]/i.test(asStr)) return asStr;
  let p = isObj ? (assetOrPath.path || assetOrPath.url || '') : asStr;
  if (!p) throw new Error('媒体引用缺少文件路径或 URL');
  p = String(p);
  if (/^https?:[/]/i.test(p)) return p;
  if (!fs.existsSync(p)) throw new Error('媒体文件不存在: ' + p);
  const pub = publicBaseUrl();
  if (pub && isObj && assetOrPath.id) {
    return pub + '/api/open/assets/' + assetOrPath.id + '/file?' + signAssetToken(assetOrPath.id);
  }
  const mime = (isObj && assetOrPath.mime) || guessMime(p);
  return 'data:' + mime + ';base64,' + fs.readFileSync(p).toString('base64');
}

function guessMime(p) {
  const ext = (path.extname(p).split('.').pop() || '').toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' })[ext] || 'image/jpeg';
}

/* ---------- 大图压缩(降低 base64 请求体体积,避免上传超时) ---------- */
let imgSeq = 0;
let TMP_IMG_DIR = null;
function imgTmpDir() {
  if (!TMP_IMG_DIR) TMP_IMG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-img-'));
  return TMP_IMG_DIR;
}

/* 对较大的位图做缩放压缩(最长边 ≤ 1024px + JPEG),返回 {path, mime};
   压缩失败/无收益时原样返回原图。GIF(动图)不压缩以保留动画。 */
async function prepareImage(p, mime) {
  const mt = String(mime || '').toLowerCase();
  if (!/^image\/(jpe?g|png|webp)$/.test(mt)) return { path: p, mime: mt };
  let size = 0;
  try { size = fs.statSync(p).size; } catch (e) { return { path: p, mime: mt }; }
  if (!size || size <= 256 * 1024) return { path: p, mime: mt }; // 小图直接内嵌
  const out = path.join(imgTmpDir(), 'img-' + (++imgSeq) + '.jpg');
  try {
    await run(['-y', '-i', p, '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', '-q:v', '5', out], { timeout: 60000 });
    if (fs.existsSync(out) && fs.statSync(out).size > 0 && fs.statSync(out).size < size) return { path: out, mime: 'image/jpeg' };
  } catch (e) { /* 压缩失败则回退原图 */ }
  try { fs.unlinkSync(out); } catch (e) {}
  return { path: p, mime: mt };
}

/* 异步版媒体引用:与 mediaRef 相同逻辑,但 base64 回退前先压缩大图 */
async function mediaRefAsync(assetOrPath) {
  if (!assetOrPath) throw new Error('媒体引用为空');
  const isObj = typeof assetOrPath === 'object';
  const asStr = isObj ? '' : String(assetOrPath);
  if (asStr && /^https?:[/]/i.test(asStr)) return asStr;
  let p = isObj ? (assetOrPath.path || assetOrPath.url || '') : asStr;
  if (!p) throw new Error('媒体引用缺少文件路径或 URL');
  p = String(p);
  if (/^https?:[/]/i.test(p)) return p;
  if (!fs.existsSync(p)) throw new Error('媒体文件不存在: ' + p);
  const pub = publicBaseUrl();
  if (pub && isObj && assetOrPath.id) {
    return pub + '/api/open/assets/' + assetOrPath.id + '/file?' + signAssetToken(assetOrPath.id);
  }
  const mime = (isObj && assetOrPath.mime) || guessMime(p);
  const src = await prepareImage(p, mime);
  return 'data:' + src.mime + ';base64,' + fs.readFileSync(src.path).toString('base64');
}

/* V2.0 家族(如 agnes-video-v2.0):image / extra_body.keyframes / width / height / num_frames */
function isV2Model(modelId) { return /v2(\.0)?$/i.test(String(modelId || '')) || /2\.0/.test(String(modelId || '')); }

/* V2.0 分辨率档位(第二十三轮):按「分辨率档 × 画幅比例」计算宽高,
   服务端会自动标准化到最近的预设档位(480p/720p/1080p) */
const V2_RES_HEIGHT = { '480p': 480, '720p': 720, '960p': 960, '1080p': 1080, '2k': 1440 };

/* 由画幅比例与分辨率档计算偶数宽高:档位作用于短边 ——
   720p/16:9 → 1280x720、720p/9:16 → 720x1280、720p/1:1 → 720x720 */
function v2Dimensions(aspectRatio, resolution) {
  const ratio = String(aspectRatio || '16:9');
  const m = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(ratio);
  const ar = m ? (Number(m[1]) / Number(m[2])) : (16 / 9);
  const tier = Math.max(256, Math.round((V2_RES_HEIGHT[String(resolution || '').toLowerCase()] || 720) / 2) * 2);
  let width, height;
  if (ar >= 1) { height = tier; width = tier * ar; }
  else { width = tier; height = tier / ar; }
  width = Math.max(256, Math.min(2560, Math.round(width / 2) * 2));
  height = Math.max(256, Math.min(2560, Math.round(height / 2) * 2));
  return [width, height];
}

async function v2Body(o) {
  const fps = Math.min(60, Math.max(1, Number(o.fps) || 24));
  const dur = Math.max(1, Number(o.seconds) || 5);
  /* num_frames ≤ 441 且遵循 8n+1 规则(V2.0 文档约束)。
     第二十三轮修复「设 5s 出 4s」:此前 Math.floor 把帧数向下取(5s@24fps=113 帧≈4.7s),
     现按文档推荐改为向上凑 8n+1(5s@24fps=121 帧≈5.04s,与官方示例一致),
     保证实际时长 ≥ 用户设置时长 */
  let frames = Math.round(dur * fps);
  frames = Math.min(441, Math.max(9, Math.ceil((frames - 1) / 8) * 8 + 1));
  const wh = v2Dimensions(o.aspectRatio, o.resolution);
  const body = {
    model: o.model,
    prompt: String(o.prompt || ''),
    width: wh[0], height: wh[1],
    num_frames: frames, frame_rate: fps
  };
  if (Number(o.seed) >= 0) body.seed = Number(o.seed);
  if (o.negativePrompt) body.negative_prompt = String(o.negativePrompt).slice(0, 500);
  const imgs = [];
  for (const im of (o.images || [])) imgs.push(await mediaRefAsync(im));
  if (imgs.length > 1) {
    /* 多图 → 关键帧动画(extra_body.keyframes) */
    body.extra_body = { image: imgs.slice(0, 5), mode: 'keyframes' };
  } else if (imgs.length === 1) {
    body.image = imgs[0]; // 图生视频:单张图片 URL
  } else if (o.firstFrame) {
    body.image = await mediaRefAsync(o.firstFrame);
  }
  return body;
}

/* 2.5 / Flash 家族:mode text|keyframe|reference + seconds + size=720P + images[] */
async function flashBody(o) {
  const body = {
    model: o.model || FLASH_MODEL_ID,
    prompt: String(o.prompt || ''),
    mode: o.mode,                       // text | keyframe | reference
    seconds: String(Math.min(12, Math.max(4, Number(o.seconds) || 5))),
    n: 1
  };
  /* Flash:size 只接受 "720P" */
  if ((o.model || '').includes('flash')) body.size = '720P';
  else if (o.size) body.size = o.size;
  if (o.aspectRatio) body.aspect_ratio = o.aspectRatio;

  if (o.mode === 'keyframe') {
    if (!o.firstFrame && !o.lastFrame) throw new Error('keyframe 模式需要 first_frame / last_frame 至少一个');
    /* 首尾帧同样要转成可公网访问的 URL / base64 data URI(不能把资产行对象直接塞进请求体) */
    if (o.firstFrame) body.first_frame = await mediaRefAsync(o.firstFrame);
    if (o.lastFrame) body.last_frame = await mediaRefAsync(o.lastFrame);
  } else if (o.mode === 'reference') {
    const imgs = (o.images || []).slice(0, 5); // Flash 最多 5 张
    if (!imgs.length) throw new Error('reference 模式需要至少一张参考图');
    body.images = [];
    for (const im of imgs) body.images.push(await mediaRefAsync(im));
    if (Array.isArray(o.audios) && o.audios.length) {
      body.audios = [];
      for (const a of o.audios) body.audios.push(await mediaRefAsync(a));
    }
    /* Flash 不支持 videos:刻意不传该字段 */
  }
  return body;
}

/* 把网关返回的错误详情安全转成文本:detail/error 可能是对象或数组,
   直接字符串拼接会得到 "[object Object]" 甚至抛 TypeError */
function detailText(v, fallback) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 400);
  try { const s = JSON.stringify(v); return s ? s.slice(0, 400) : (fallback || ''); }
  catch (e) { return fallback || ''; }
}

/* 创建视频任务,返回 {video_id} —— 按模型 ID 自动适配两代接口 */
async function createVideoTask(o) {
  const base = String(o.apiBase || '').replace(/[/]+$/, '');
  if (!base) throw new Error('API 地址未配置');
  if (!o.apiKey) throw new Error('API Key 未配置,请在后台「模型管理」中填写');
  const body = isV2Model(o.model) ? await v2Body(o) : await flashBody(o);

  /* 网络抖动/大图上传慢:自动重试(HTTP 校验错误、缺少 video_id 不重试) */
  let lastReason = '';
  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(base + '/videos', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + o.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS)
      });
    } catch (e) {
      const reason = e.name === 'TimeoutError' ? '请求超时' : '网络错误(' + e.message + ')';
      if (attempt < CREATE_ATTEMPTS) { lastReason = reason; await sleep(1200 * attempt); continue; }
      throw new Error('无法连接视频 API(' + reason + '),已自动重试 ' + (attempt - 1) + ' 次仍失败');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* 保留原文 */ }
    if (!res.ok) {
      const rawDetail = data && data.detail != null ? data.detail : (data && data.error != null
        ? (typeof data.error === 'object' ? (data.error.message ?? data.error) : data.error) : null);
      const detail = detailText(rawDetail) || text.slice(0, 200);
      throw new Error('创建任务失败(HTTP ' + res.status + '): ' + detail);
    }
    const videoId = data && (data.video_id || data.id || data.task_id);
    if (!videoId) throw new Error('创建任务响应缺少 video_id: ' + text.slice(0, 200));
    return { videoId, raw: data };
  }
  throw new Error('无法连接视频 API(' + lastReason + ')');
}

/* 查询任务(文档推荐的 video_id + model_name 方式,三种模式通用) */
async function queryVideoTask(o) {
  const base = String(o.apiBase || '').replace(/[/]+$/, '');
  const qs = new URLSearchParams({ video_id: String(o.videoId) });
  if (o.model) qs.set('model_name', o.model); // keyframe/reference 模式必须带 model_name
  /* 文档约定:查询端点挂在主机根路径 /agnesapi,不带 /v1 版本前缀 */
  let queryBase;
  try { queryBase = new URL(base).origin; }
  catch (e) { queryBase = base.replace(/\/+$/, '').replace(/\/v\d+$/, ''); }
  let res;
  try {
    res = await fetch(queryBase + '/agnesapi?' + qs.toString(), {
      headers: { Authorization: 'Bearer ' + o.apiKey },
      signal: AbortSignal.timeout(30e3)
    });
  } catch (e) {
    throw new Error('查询任务失败(' + (e.name === 'TimeoutError' ? '超时' : e.message) + ')');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
  if (!res.ok) {
    const rawDetail = data && (data.detail != null ? data.detail : data.error);
    const detail = detailText(rawDetail) || text.slice(0, 160);
    throw new Error('查询失败(HTTP ' + res.status + '): ' + detail);
  }
  return normalizeStatus(data);
}

/* 归一化不同网关返回的任务状态与结果地址 */
function normalizeStatus(data) {
  const d = data && typeof data === 'object' ? data : {};
  const payload = d.data && typeof d.data === 'object' ? d.data : d;
  const raw = String(payload.status || d.status || '').toLowerCase();
  let status = 'processing';
  if (['completed', 'succeeded', 'success', 'done'].includes(raw)) status = 'completed';
  else if (['failed', 'error', 'cancelled', 'canceled'].includes(raw)) status = 'failed';
  else if (raw === 'queued' || raw === 'pending') status = 'queued';
  const progress = Number(payload.progress ?? d.progress ?? NaN);
  return {
    status,
    raw,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null,
    error: (payload.error && typeof payload.error === 'object'
      ? (payload.error.message || detailText(payload.error))
      : (payload.error || '')) || payload.failure_reason || detailText(d.error) || '',
    videoUrl: pickVideoUrl(payload) || pickVideoUrl(d),
    videoId: payload.video_id || payload.id || d.video_id || ''
  };
}

function pickVideoUrl(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const cands = [obj.url, obj.video_url, obj.videoUrl, obj.download_url, obj.result_url,
    obj.metadata && obj.metadata.url, // Agnes Video V2.0:结果地址在 metadata.url
    obj.output && (typeof obj.output === 'string' ? obj.output : obj.output.url),
    Array.isArray(obj.videos) && obj.videos[0] && (obj.videos[0].url || obj.videos[0]),
    Array.isArray(obj.outputs) && obj.outputs[0]];
  for (const c of cands) if (typeof c === 'string' && /^https?:[/]/i.test(c)) return c;
  return '';
}

/* 轮询直到完成/失败/超时,onTick(statusInfo) 用于进度回写 */
async function pollUntilDone(o, onTick) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await queryVideoTask(o);
    if (onTick) onTick(last);
    if (last.status === 'completed' || last.status === 'failed') return last;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('视频生成超时(超过 ' + Math.round(POLL_TIMEOUT_MS / 60000) + ' 分钟)');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 下载结果视频到本地输出路径 */
async function downloadVideo(url, outFile) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120e3) });
  if (!res.ok) throw new Error('下载结果视频失败(HTTP ' + res.status + ')');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outFile, buf);
  return outFile;
}

module.exports = {
  FLASH_MODEL_ID, mediaRef, mediaRefAsync, prepareImage, signAssetToken, verifyAssetToken, publicBaseUrl,
  createVideoTask, queryVideoTask, pollUntilDone, downloadVideo, normalizeStatus
};
