'use strict';
/* 模型适配器注册中心(第十二轮)
 *
 * 目标:后续新增其他视频模型无需改代码,管理员只需在后台配置模型的
 *      「生成规则」(rules JSON + api_base/api_key/model_id),提交任务后
 *      worker 会自动按该模型的规则适配生成(请求体 / 轮询 / 结果解析)。
 *
 * 内置适配器(protocol):
 *   - agnes-flash  : Agnes Video 2.5 Flash 兼容(seconds 字符串 + size=720P + images≤5)
 *   - agnes-v2     : Agnes Video V2.0 兼容(image/extra_body.keyframes + num_frames)
 *   - openai-video : 通用 OpenAI 视频兼容协议,请求/轮询规则完全由 rules 驱动(可适配任意网关)
 *   - ffmpeg       : 本地 ffmpeg 渲染管线(默认回退)
 *
 * 规则自动识别:rules.protocol 显式指定优先;未指定时按 model_id 特征自动匹配,
 * 配了 api_base 的模型默认走 openai-video 通用协议 —— 即「无需繁琐配置」。
 */
const agnes = require('./agnes');
const { db } = require('./db');
const { generateI2V } = require('./ffmpeg');

const CREATE_TIMEOUT_MS = 120e3;
const CREATE_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15 * 60e3;
const QUERY_TIMEOUT_MS = 30e3;

/* ---------- 安全错误文本(null 原型对象兼容) ---------- */
function errText(e) {
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'string') return e;
  try { return String(e); } catch (_) {}
  try { return JSON.stringify(e); } catch (_) { return '未知错误'; }
}

/* 把资产行收敛为普通媒体对象(node:sqlite 行是 null 原型,禁止直接做字符串操作) */
function toMedia(a) {
  return { id: a.id, name: a.name, path: a.path, mime: a.mime };
}

/* ---------- 规则解析 / 归一化 ---------- */
function parseRules(model) {
  if (!model) return {};
  try {
    const v = JSON.parse(model.rules || '');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

const DEFAULT_RULES = {
  'agnes-flash': {
    protocol: 'agnes-flash',
    label: 'Agnes Video 2.5 Flash 兼容',
    modes: ['text', 'keyframe', 'reference'],
    limits: { max_images: 5, min_seconds: 4, max_seconds: 12, fixed_size: '720P', seconds_type: 'string' }
  },
  'agnes-v2': {
    protocol: 'agnes-v2',
    label: 'Agnes Video V2.0 兼容',
    modes: ['keyframe', 'reference', 'text'],
    limits: { max_images: 5, min_seconds: 1, max_seconds: 20, max_frames: 441, seconds_type: 'number' }
  },
  'openai-video': {
    protocol: 'openai-video',
    label: 'OpenAI 视频兼容协议(规则可配)',
    modes: ['text', 'keyframe', 'reference'],
    create: {
      path: '/videos',
      method: 'POST',
      body: {
        model: '<model_id>',
        prompt: '<prompt>',
        mode: '<mode>',
        seconds: '<seconds>',
        size: '<size>',
        aspect_ratio: '<aspect_ratio>',
        seed: '<seed>'
      },
      seconds_type: 'string',
      images_field: 'images',
      audios_field: 'audios',
      first_frame_field: 'first_frame',
      last_frame_field: 'last_frame'
    },
    query: {
      path: '/agnesapi',
      use_origin: true,
      method: 'GET',
      params: { video_id: '<video_id>', model_name: '<model_id>' },
      status_field: 'status',
      progress_field: 'progress',
      video_url_field: 'url',
      error_field: 'error'
    },
    limits: { max_images: 5, min_seconds: 1, max_seconds: 60, fixed_size: '720P', seconds_type: 'string' }
  },
  ffmpeg: {
    protocol: 'ffmpeg',
    label: '本地 ffmpeg 渲染',
    modes: [],
    limits: { min_seconds: 2, max_seconds: 10, seconds_type: 'number' }
  }
};

/* 合并用户规则与协议默认值(浅合并:create/query/limits 二级键合并) */
function normalizeRules(model) {
  const user = parseRules(model);
  const protocol = user.protocol || detectProtocol(model);
  const base = DEFAULT_RULES[protocol] || DEFAULT_RULES['openai-video'];
  const out = JSON.parse(JSON.stringify(base));
  out.protocol = protocol;
  if (user.label) out.label = user.label;
  if (Array.isArray(user.modes)) out.modes = user.modes.slice();
  for (const k of ['create', 'query', 'limits']) {
    if (user[k] && typeof user[k] === 'object') Object.assign(out[k] || (out[k] = {}), user[k]);
  }
  return out;
}

/* 自动识别协议:显式 rules.protocol > model_id 特征 > api_base 通用协议 > ffmpeg
   二十轮优化:Agnes 专属协议只在模型 ID 或网关域名明确指向 Agnes 时启用,
   避免 "as-sd2.0-fast"、"sora-v3" 等第三方模型因名字带 "2.0" 被误路由到 Agnes 协议 */
function detectProtocol(model) {
  if (!model) return 'ffmpeg';
  const rules = parseRules(model);
  if (rules.protocol && DEFAULT_RULES[rules.protocol]) return rules.protocol;
  if (model.api_base && model.model_id) {
    const mid = String(model.model_id).toLowerCase();
    let host = '';
    try { host = new URL(model.api_base).hostname.toLowerCase(); } catch (e) {}
    const agnesish = mid.includes('agnes') || host.includes('agnes');
    if (agnesish) {
      if (mid.includes('flash')) return 'agnes-flash';
      if (/v2(.0)?$/.test(mid)) return 'agnes-v2';
    }
    return 'openai-video';
  }
  return 'ffmpeg';
}

/* ---------- 模式与媒体规划(模型规则驱动) ---------- */
function planMode(rules, ctx) {
  const modes = rules.modes || ['text', 'keyframe', 'reference'];
  const linked = (ctx.linked || []).filter(a => a && a.type !== 'audio');
  if (linked.length && modes.includes('reference')) return 'reference';
  if (ctx.src && modes.includes('keyframe')) return 'keyframe';
  return 'text';
}

/* 把 [资产名] 占位符改写为 reference 模式的 <Picture N> 指代 */
function promptForReference(promptText, nameToIndex) {
  return String(promptText || '').replace(/\[([^\[\]\n]{1,60})\]/g, (raw, inner) => {
    const idx = nameToIndex.get(String(inner).trim().toLowerCase());
    return idx ? ('<Picture ' + idx + '>') : raw;
  });
}

/* reference 模式的媒体清单:源图占 Picture 1,参考图随后,上限受模型规则限制 */
function planMedia(ctx, mode, rules) {
  const linked = (ctx.linked || []).filter(a => a && a.type !== 'audio');
  const maxImages = Math.max(1, Number((rules.limits && rules.limits.max_images) || 5));
  const images = [];
  if (ctx.src) images.push(ctx.src);
  for (const a of linked) { if (images.length >= maxImages) break; images.push(a); }
  const audios = (ctx.linked || []).filter(a => a && a.type === 'audio').slice(0, 5);
  const nameToIndex = new Map();
  images.forEach((a, i) => {
    if (a && a.name) nameToIndex.set(String(a.name).replace(/\.[^.]+$/, '').trim().toLowerCase(), i + 1);
  });
  const prompt = mode === 'reference'
    ? promptForReference(ctx.task.prompt, nameToIndex)
    : String(ctx.task.prompt || '');
  return { images, audios, firstFrame: ctx.src, prompt };
}

/* ---------- 轮询(公共):进度回写 + 偶发查询失败容忍 ---------- */
async function pollUntilDone(ctx, queryFn, rules) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const total = Math.max(Number(ctx.params.duration) || 5, 1);
  const began = Date.now();
  let errs = 0;
  let last = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    let st;
    try {
      st = await queryFn();
      errs = 0;
    } catch (e) {
      if (++errs >= 8) throw e;
      continue;
    }
    last = st;
    const pct = st.progress != null ? st.progress
      : Math.min(80, Math.round(((Date.now() - began) / 1000 / total) * 65));
    if (ctx.onProgress) ctx.onProgress(Math.max(5, Math.min(96, Math.round(4 + pct * 0.92))));
    if (st.status === 'completed' || st.status === 'failed') break;
  }
  if (!last) throw new Error('视频生成轮询超时');
  if (last.status === 'failed') throw new Error('API 生成失败: ' + (last.error || '未知原因'));
  if (last.status !== 'completed') throw new Error('视频生成超时(超过 15 分钟)');
  if (!last.videoUrl) throw new Error('生成完成但响应中没有结果视频地址');
  return last;
}

/* ---------- 适配器:Agnes Flash / V2(复用 server/agnes.js 客户端) ---------- */
async function generateAgnes(ctx, family) {
  const { model, task, params, outFile } = ctx;
  const rules = normalizeRules(model);
  const mode = planMode(rules, ctx);
  const { images, audios, firstFrame, prompt } = planMedia(ctx, mode, rules);

  if (ctx.onProgress) ctx.onProgress(5);
  const { videoId } = await agnes.createVideoTask({
    apiBase: model.api_base,
    apiKey: model.api_key,
    model: model.model_id,
    prompt,
    mode,
    seconds: params.duration || 5,
    aspectRatio: params.aspect_ratio || '16:9',
    resolution: params.resolution, /* 第二十三轮:分辨率档传给 V2.0(480p/720p/960p/2k → 宽高) */
    images: mode === 'reference' ? images.map(toMedia) : undefined,
    audios: mode === 'reference' && audios.length ? audios.map(toMedia) : undefined,
    firstFrame: mode === 'keyframe' ? toMedia(firstFrame) : undefined,
    negativePrompt: task.negative_prompt || '',
    seed: params.seed,
    fps: params.fps
  });
  if (ctx.recordRemote) ctx.recordRemote(videoId);

  const last = await pollUntilDone(ctx, () => agnes.queryVideoTask({
    apiBase: model.api_base, apiKey: model.api_key, model: model.model_id, videoId
  }), rules);
  await agnes.downloadVideo(last.videoUrl, outFile);
  return outFile;
}

/* ---------- 适配器:通用 OpenAI 视频兼容协议(完全由 rules 驱动) ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function detailText(v, fallback) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 400);
  try { const s = JSON.stringify(v); return s ? s.slice(0, 400) : (fallback || ''); }
  catch (e) { return fallback || ''; }
}

function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

/* 用上下文替换 body 模板里的 <token> 占位符;
   <none> 或空串占位 → 删除该字段 */
function fillTemplate(value, ctxMap) {
  if (typeof value !== 'string') return value;
  let out = value;
  let any = false;
  for (const [k, v] of Object.entries(ctxMap)) {
    if (out.includes('<' + k + '>')) { out = out.split('<' + k + '>').join(String(v)); any = true; }
  }
  if (!any) return value;
  if (out === '<none>' || out === '') return '<__DROP__>';
  /* 整个字段就是单个占位符(如 "<seed>")→ 返回原始值(保留数字类型) */
  const full = /^<([^>]+)>$/.exec(value);
  if (full && ctxMap[full[1]] !== undefined) return ctxMap[full[1]];
  return out;
}

function dropSentinel(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '<__DROP__>') continue;
    out[k] = v;
  }
  return out;
}

/* 标准上下文:适配器可用的 <token> 全集 */
function ctxMapFor(model, task, params, prompt, mode, media) {
  const limits = normalizeRules(model).limits || {};
  const fixedSize = limits.fixed_size || '';
  /* 第二十三轮:开放协议 <size> 解析优先级 —— 风格显式 size > 用户所选分辨率档(720p→720P) > 规则 fixed_size */
  const size = params.size
    || (params.resolution ? String(params.resolution).toUpperCase() : '')
    || fixedSize;
  const m = {
    model_id: model.model_id || '',
    prompt,
    mode,
    seconds: params.duration || 5,
    size,
    aspect_ratio: params.aspect_ratio || '16:9',
    seed: params.seed != null && params.seed !== '' ? params.seed : -1,
    fps: params.fps != null ? params.fps : 24,
    negative_prompt: task.negative_prompt || '',
    first_frame: media.firstFrame ? '<__MEDIA_FIRST__>' : '<none>',
    last_frame: '<none>',
    images: media.images && media.images.length ? '<__MEDIA_IMAGES__>' : '<none>',
    audios: media.audios && media.audios.length ? '<__MEDIA_AUDIOS__>' : '<none>'
  };
  return m;
}

/* 依据 rules.create.body 模板 + mode 媒体字段构造请求体 */
async function buildOpenAiBody(rules, model, task, params, prompt, mode, media) {
  const create = rules.create || {};
  const body = dropSentinel(deepCopy(create.body || {}));
  const cmap = ctxMapFor(model, task, params, prompt, mode, media);

  /* 1) 标量占位符替换;2) 媒体注入 */
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === create.images_field && mode === 'reference' && media.images.length) {
      out[k] = [];
      for (const im of media.images) out[k].push(await agnes.mediaRefAsync(toMedia(im)));
    } else if (k === create.audios_field && mode === 'reference' && media.audios.length) {
      out[k] = [];
      for (const a of media.audios) out[k].push(await agnes.mediaRefAsync(toMedia(a)));
    } else if (k === create.first_frame_field && mode === 'keyframe' && media.firstFrame) {
      out[k] = await agnes.mediaRefAsync(toMedia(media.firstFrame));
    } else if (k === create.last_frame_field && media.lastFrame) {
      out[k] = await agnes.mediaRefAsync(toMedia(media.lastFrame));
    } else {
      const replaced = fillTemplate(v, cmap);
      if (replaced !== '<__DROP__>') out[k] = replaced;
    }
  }

  /* 模板里没写媒体字段时,按 mode 自动补上(规则未显式配置也开箱即用) */
  if (mode === 'reference' && media.images.length && !(create.images_field in out)) {
    out[create.images_field] = [];
    for (const im of media.images) out[create.images_field].push(await agnes.mediaRefAsync(toMedia(im)));
  }
  if (mode === 'reference' && media.audios.length && create.audios_field && !(create.audios_field in out)) {
    out[create.audios_field] = [];
    for (const a of media.audios) out[create.audios_field].push(await agnes.mediaRefAsync(toMedia(a)));
  }
  if (mode === 'keyframe' && media.firstFrame && create.first_frame_field && !(create.first_frame_field in out)) {
    out[create.first_frame_field] = await agnes.mediaRefAsync(toMedia(media.firstFrame));
  }

  /* seconds 类型:字符串 API(如 Flash)转字符串 */
  if (out.seconds !== undefined && (create.seconds_type === 'string' || (rules.limits && rules.limits.seconds_type === 'string'))) {
    out.seconds = String(out.seconds);
  }
  return out;
}

/* 创建路径候选:自动识别(未显式配置 create.path)时依次试探,兼容
   OpenAI 官方 /videos 与中转网关常用的 /videos/generations、/video/generations;
   记忆已试通的路径,同一进程内后续任务直接命中,不再重复探测 */
const CANDIDATE_CREATE_PATHS = ['/videos', '/videos/generations', '/video/generations'];
const createPathMemo = new Map(); // model.id -> '/videos/...'

function isRouteMissing404(res, data) {
  /* 纯文本 404(如 gin "404 page not found")= 路由不存在,可换候选路径;
     JSON 业务错误(含 error 对象)= 路由存在,是业务层应答,不再换路径 */
  if (!data && (res.status === 404 || res.status === 405)) return true;
  return false;
}

function vendorNotSupported(detail) {
  return /videos? api is not supported/i.test(detail);
}

async function openAiCreate(rules, model, body) {
  const base = String(model.api_base || '').replace(/[/]+$/, '');
  if (!base) throw new Error('API 地址未配置');
  if (!model.api_key) throw new Error('API Key 未配置,请在后台「模型管理」中填写');
  const create = rules.create || {};
  /* 生成路径候选:用户显式配置的 create.path 优先且唯一;否则候选依次试探 */
  const userPath = parseRules(model).create && parseRules(model).create.path;
  const candidates = userPath
    ? [userPath]
    : [...new Set([...(createPathMemo.get(model.id) ? [createPathMemo.get(model.id)] : []),
      (create.path || '/videos'), ...CANDIDATE_CREATE_PATHS].map(p => String(p).replace(/^\/?/, '/')))];
  let lastErr = '';
  const tried = [];
  for (const pathPart of candidates) {
    const url = base + pathPart;
    for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: create.method || 'POST',
          headers: { Authorization: 'Bearer ' + model.api_key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CREATE_TIMEOUT_MS)
        });
      } catch (e) {
        const reason = e.name === 'TimeoutError' ? '请求超时' : '网络错误(' + e.message + ')';
        if (attempt < CREATE_ATTEMPTS) { lastErr = url + ' → ' + reason; await sleep(1200 * attempt); continue; }
        throw new Error('无法连接视频 API(' + reason + '),已自动重试 ' + (attempt - 1) + ' 次仍失败');
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) {}
      if (res.ok) {
        const videoId = data && (data.video_id || data.id || data.task_id);
        if (!videoId) throw new Error('创建任务响应缺少 video_id: ' + text.slice(0, 200));
        createPathMemo.set(model.id, pathPart); /* 记住试通的创建路径 */
        return { videoId, raw: data, path: pathPart };
      }
      const rawDetail = data && data.detail != null ? data.detail
        : (data && data.error != null ? (typeof data.error === 'object' ? (data.error.message ?? data.error) : data.error) : null);
      const detail = detailText(rawDetail) || text.slice(0, 200);
      lastErr = 'HTTP ' + res.status + ' @ ' + pathPart + ': ' + detail;
      tried.push(lastErr);
      if (vendorNotSupported(detail)) {
        throw new Error('创建任务失败(HTTP ' + res.status + '): ' + detail +
          ' —— 服务商未开放该模型的视频 API,请到服务商控制台确认视频生成通道或联系服务商开通;本站接口与 Key 均正常');
      }
      const routeMissing = isRouteMissing404(res, data);
      const isLast = pathPart === candidates[candidates.length - 1];
      /* 路由不存在 → 换下一个候选;业务应答或已是最后一个候选 → 汇总报错 */
      if (!routeMissing || isLast) {
        const hint = !userPath
          ? '(已自动尝试创建路径 ' + candidates.join('、') + ')如服务商控制台确认支持视频生成,请检查 api_base/model_id,或在模型「生成规则」中显式配置 create.path'
          : '(创建路径 ' + candidates[0] + ')如网关支持视频,请核对路径或联系服务商';
        throw new Error('创建任务失败:' + tried.join(' | ') + ' ' + hint);
      }
      break; /* 换下一个候选路径 */
    }
  }
  throw new Error('无法连接视频 API(' + lastErr + ')');
}

/* 从响应里取字段:支持 data_path(如 "data")先解包 + status/progress/videoUrl/error 字段 */
function openAiPick(obj, field, fallback) {
  if (!obj || typeof obj !== 'object') return fallback;
  if (obj[field] !== undefined) return obj[field];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') {
      const r = openAiPick(v, field, undefined);
      if (r !== undefined) return r;
    }
  }
  return fallback;
}

function openAiNormalize(data, rules) {
  const q = rules.query || {};
  let payload = data && typeof data === 'object' ? data : {};
  if (q.data_path) {
    for (const p of (Array.isArray(q.data_path) ? q.data_path : [q.data_path])) {
      const next = payload && payload[p];
      if (next && typeof next === 'object') payload = next;
    }
  }
  const statusField = q.status_field || 'status';
  const raw = String(payload[statusField] || '').toLowerCase();
  let status = 'processing';
  const done = (q.status_values && q.status_values.completed) || ['completed', 'succeeded', 'success', 'done'];
  const failed = (q.status_values && q.status_values.failed) || ['failed', 'error', 'cancelled', 'canceled'];
  if (done.includes(raw)) status = 'completed';
  else if (failed.includes(raw)) status = 'failed';
  else if (raw === 'queued' || raw === 'pending') status = 'queued';
  const progress = Number(payload[q.progress_field || 'progress'] ?? NaN);
  const error = String(payload[q.error_field || 'error'] || payload.failure_reason || '').slice(0, 300);
  const videoUrl = pickVideoUrl(payload, q.video_url_field);
  return {
    status, raw,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null,
    error, videoUrl,
    videoId: payload.video_id || payload.id || ''
  };
}

function pickVideoUrl(obj, videoUrlField) {
  if (!obj || typeof obj !== 'object') return '';
  if (videoUrlField && typeof obj[videoUrlField] === 'string') return obj[videoUrlField];
  const cands = [obj.url, obj.video_url, obj.videoUrl, obj.download_url, obj.result_url,
    obj.metadata && obj.metadata.url,
    obj.output && (typeof obj.output === 'string' ? obj.output : obj.output.url),
    Array.isArray(obj.videos) && obj.videos[0] && (obj.videos[0].url || obj.videos[0]),
    Array.isArray(obj.outputs) && obj.outputs[0]];
  for (const c of cands) if (typeof c === 'string' && /^https?:[/]/i.test(c)) return c;
  return '';
}

async function openAiQuery(rules, model, videoId) {
  const base = String(model.api_base || '').replace(/[/]+$/, '');
  const q = rules.query || {};
  const userQuery = !!parseRules(model).query;
  /* 显式配置 query 规则 → 按配置(旧逻辑);自动识别 → REST 候选:
     创建路径/{id} → /videos/{id} → 旧版 /agnesapi(use_origin) */
  if (userQuery) {
    let url;
    const pathPart = String(q.path || '/agnesapi').replace(/^\/?/, '/');
    if (q.use_origin) {
      try { url = new URL(base).origin + pathPart; }
      catch (e) { url = base.replace(/\/+$/, '').replace(/\/v\d+$/, '') + pathPart; }
    } else {
      url = base + pathPart;
    }
    return openAiQueryOnce(rules, model, videoId, url, q);
  }
  const createPath = createPathMemo.get(model.id) || (rules.create && rules.create.path) || '/videos';
  let originAgnes;
  try { originAgnes = new URL(base).origin + '/agnesapi'; }
  catch (e) { originAgnes = base.replace(/\/v\d+$/, '') + '/agnesapi'; }
  const candidates = [
    { url: base + createPath.replace(/^\/?/, '/') + '/' + encodeURIComponent(videoId), q: { method: 'GET' } },
    { url: base + '/videos/' + encodeURIComponent(videoId), q: { method: 'GET' } },
    { url: originAgnes, q: Object.assign({ method: 'GET' }, q, { params: Object.assign({ video_id: '<video_id>', model_name: '<model_id>' }, q.params) }) }
  ];
  return openAiQueryRest(rules, model, videoId, candidates, 0);
}

/* REST 风格查询:按候选依次尝试,404 换下一候选,全部失败给汇总报错 */
async function openAiQueryRest(rules, model, videoId, candidates, idx) {
  if (idx >= candidates.length) {
    throw new Error('查询失败:任务 ' + String(videoId).slice(0, 20) + ' 在 ' + candidates.length + ' 个查询端点均未找到,请核对网关的查询接口');
  }
  const c = candidates[idx];
  try {
    return await openAiQueryOnce(rules, model, videoId, c.url, c.q);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return openAiQueryRest(rules, model, videoId, candidates, idx + 1);
    throw e;
  }
}

async function openAiQueryOnce(rules, model, videoId, url, q) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(q.params || {})) {
    qs.set(k, String(v).split('<video_id>').join(videoId).split('<model_id>').join(model.model_id || ''));
  }
  const sep = url.includes('?') ? '&' : '?';
  let full = url + (Object.keys(q.params || {}).length ? sep + qs.toString() : '');
  let res;
  try {
    res = await fetch(full, {
      method: q.method || 'GET',
      headers: { Authorization: 'Bearer ' + model.api_key, Accept: 'application/json' },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
    });
  } catch (e) {
    throw new Error('查询任务失败(' + (e.name === 'TimeoutError' ? '超时' : e.message) + ')');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) {
    const rawDetail = data && (data.detail != null ? data.detail : data.error);
    const detail = detailText(rawDetail) || text.slice(0, 160);
    throw new Error('查询失败(HTTP ' + res.status + '): ' + detail);
  }
  return openAiNormalize(data, rules);
}

async function generateOpenAi(ctx) {
  const { model, task, params, outFile } = ctx;
  const rules = normalizeRules(model);
  const mode = planMode(rules, ctx);
  const media = planMedia(ctx, mode, rules);

  if (ctx.onProgress) ctx.onProgress(5);
  const body = await buildOpenAiBody(rules, model, task, params, media.prompt, mode, media);
  const { videoId } = await openAiCreate(rules, model, body);
  if (ctx.recordRemote) ctx.recordRemote(videoId);

  const last = await pollUntilDone(ctx, () => openAiQuery(rules, model, videoId), rules);
  await agnes.downloadVideo(last.videoUrl, outFile);
  return outFile;
}

/* ---------- 适配器:本地 ffmpeg 渲染 ---------- */
async function generateFfmpeg(ctx) {
  const { task, params, src, outFile } = ctx;
  const lp = JSON.parse(task.params || '{}');
  lp.engine = 'ffmpeg-local';
  db.prepare('UPDATE tasks SET params=? WHERE id=?').run(JSON.stringify(lp), task.id);
  await generateI2V({
    input: src.path,
    output: outFile,
    duration: params.duration || 5,
    fps: params.fps || 30,
    motion: params.motion ?? 0.5,
    seed: params.seed,
    grade: ctx.styleGrade,
    onProgress: sec => {
      const total = (params.duration || 5) + 1;
      const p = Math.min(96, Math.round(8 + (sec / total) * 88));
      if (ctx.onProgress) ctx.onProgress(p);
    }
  });
  return outFile;
}

/* ---------- 适配器注册表 ---------- */
const ADAPTERS = {
  'agnes-flash': { id: 'agnes-flash', label: DEFAULT_RULES['agnes-flash'].label, generate: ctx => generateAgnes(ctx, 'flash') },
  'agnes-v2': { id: 'agnes-v2', label: DEFAULT_RULES['agnes-v2'].label, generate: ctx => generateAgnes(ctx, 'v2') },
  'openai-video': { id: 'openai-video', label: DEFAULT_RULES['openai-video'].label, generate: generateOpenAi },
  ffmpeg: { id: 'ffmpeg', label: DEFAULT_RULES.ffmpeg.label, generate: generateFfmpeg }
};

/* 解析模型 → 适配器(规则显式协议优先,否则自动识别) */
function resolve(model) {
  const protocol = detectProtocol(model);
  const adapter = ADAPTERS[protocol];
  if (!adapter) throw new Error('未知的模型适配器: ' + protocol + '(模型 ' + (model && model.id) + ')');
  return adapter;
}

/* worker 顶层入口:提交任务后按模型规则自动适配生成 */
async function run(model, ctx) {
  const adapter = resolve(model);
  return adapter.generate(ctx);
}

function listAdapters() {
  return Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label }));
}

module.exports = {
  ADAPTERS, resolve, run, listAdapters,
  parseRules, normalizeRules, detectProtocol, planMode, planMedia, toMedia,
  buildOpenAiBody, openAiCreate, openAiQuery, openAiNormalize, promptForReference,
  pollUntilDone, errText
};
