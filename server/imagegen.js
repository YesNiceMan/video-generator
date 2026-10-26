'use strict';
/* AI 生图适配器注册中心(第二十五轮 · 二十三/1)
 *
 * 与 server/adapters.js(视频)同一设计:管理员在后台配置模型的
 * 「生成规则」(rules JSON + api_base/api_key/model_id)后,worker 自动按该
 * 模型的协议适配生图(请求体 / 响应解析 / 参考图注入),后续接入新的生图
 * 模型 API 无需改代码 —— 填配置即可;全新协议在 ADAPTERS 中注册适配器。
 *
 * 内置协议(protocol):
 *   - openai-image : OpenAI Images 兼容协议(POST /images/generations;
 *                    图生图走 /images/edits multipart,可 rules 自定义)
 *   - gemini-image : Google Gemini generateContent(gemini-2.5-flash-image /
 *                    imagen 等,responseModalities 含 IMAGE)
 *   - img-ffmpeg   : 本地占位生图(ffmpeg 渲染,免费测试 / 演示用)
 *
 * 规则自动识别:rules.protocol 显式指定优先;未指定时按 model_id 特征自动
 * 匹配(含 gemini/imagen 走 gemini-image;配了 api_base 走 openai-image;
 * 其余走 img-ffmpeg 本地占位)。
 *
 * 模型能力(第二十六轮):rules.caps = { t2i, i2i, compose } 分别声明
 * 文生图 / 图生图(1 张参考)/ 多图合成(≥2 张参考图);未声明时按参考图
 * 数量自动推断(0 张=t2i,1 张=i2i,≥2 张=compose)。
 */
const fs = require('fs');
const ffmpegRun = require('./ffmpeg').run;
const agnes = require('./agnes');

/* 生图是同步长请求:gpt-image 一类模型/中转站实测单张要 30s~5min,
   900s 是「上游还在排队但没断」的兜底上限;可按模型 rules.create.timeout_ms 覆盖 */
const CREATE_TIMEOUT_MS = 900e3;
const DOWNLOAD_TIMEOUT_MS = 180e3;   /* 拉取已生成的图片,断了可以安全重试(不再计费) */

/* ---------- 安全错误文本(null 原型对象兼容,与 adapters 同款) ---------- */
function errText(e) {
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'string') return e;
  try { return String(e); } catch (_) {}
  try { return JSON.stringify(e); } catch (_) { return '未知错误'; }
}

/* ---------- 规则解析 / 归一化(与 adapters.parseRules 同款) ---------- */
function parseRules(model) {
  if (!model) return {};
  try {
    const v = JSON.parse(model.rules || '');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) { return {}; }
}

const DEFAULT_RULES = {
  'openai-image': {
    protocol: 'openai-image',
    label: 'OpenAI 生图兼容协议(规则可配)',
    create: {
      path: '/images/generations',       // 文生图(纯文本提示词)
      edit_path: '/images/edits',        // 图生图(带参考图;置空串禁用)
      /* 图生图形态:'multipart'(OpenAI 表单) | 'json'(同一 JSON 端点 + images_field)
         Agnes 等「单端点 + image:[url|base64]」网关填 json,并把 images_field 设为 image */
      edit: 'multipart',
      images_field: 'image',
      body: { model: '<model_id>', prompt: '<prompt>', n: '<n>', size: '<size>' },
      /* response_format:留空跟随网关默认;可配 'url' / 'b64_json' */
      response_format: ''
    },
    response: {
      data_path: 'data',                 // 结果数组所在字段
      url_field: 'url',
      b64_field: 'b64_json'
    },
    /* limits.sizes 只在模板真的发 <size> 时参与就近吸附(见 api/images.js resolveSize);
       limits.resolutions 声明该网关支持的分辨率档位(如 ['1K','2K','4K']) */
    limits: { max_count: 4, sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'] }
  },
  'gemini-image': {
    protocol: 'gemini-image',
    label: 'Google Gemini 生图(generateContent)',
    create: {
      path: '/models/<model_id>:generateContent',
      /* imageConfig:aspectRatio 由画幅自动注入(置 false 禁用) */
      aspect_ratio: true,
      /* imageConfig:imageSize 由分辨率档(1K/2K/4K)注入(置 false 禁用) */
      image_size: true
    },
    response: {
      candidates_path: 'candidates',
      parts_path: 'content.parts',
      inline_field: 'inlineData'
    },
    limits: { max_count: 4, aspect_ratios: ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'] }
  },
  'img-ffmpeg': {
    protocol: 'img-ffmpeg',
    label: '本地占位生图(免费测试)',
    limits: { max_count: 4 }
  }
};

/* 合并用户规则与协议默认值(浅合并:create/response/limits 二级键合并) */
function normalizeRules(model) {
  const user = parseRules(model);
  const protocol = user.protocol || detectProtocol(model);
  const base = DEFAULT_RULES[protocol] || DEFAULT_RULES['openai-image'];
  const out = JSON.parse(JSON.stringify(base));
  out.protocol = protocol;
  if (user.label) out.label = user.label;
  for (const k of ['create', 'response', 'limits']) {
    if (user[k] && typeof user[k] === 'object') Object.assign(out[k] || (out[k] = {}), user[k]);
  }
  return out;
}

/* 自动识别协议:rules.protocol > model_id 特征 > api_base 通用协议 > 本地占位 */
function detectProtocol(model) {
  if (!model) return 'img-ffmpeg';
  const rules = parseRules(model);
  if (rules.protocol && DEFAULT_RULES[rules.protocol]) return rules.protocol;
  const mid = String(model.model_id || '').toLowerCase();
  if (mid.includes('gemini') || mid.includes('imagen')) return 'gemini-image';
  if (model.api_base && model.model_id) return 'openai-image';
  return 'img-ffmpeg';
}

/* ---------- 尺寸 / 画幅工具 ---------- */
function sizeToWH(size) {
  const m = /^([0-9]{2,5})[xX×]\s*([0-9]{2,5})$/.exec(String(size || '').trim());
  if (!m) return null;
  const w = Math.max(64, Math.min(4096, parseInt(m[1], 10)));
  const h = Math.max(64, Math.min(4096, parseInt(m[2], 10)));
  return { w, h };
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function whToAspect(w, h) {
  const d = gcd(w, h) || 1;
  return (w / d) + ':' + (h / d);
}

/* 把画幅映射到该网关支持的档位(清单来自 rules.limits.aspect_ratios,默认 Gemini 官方六档) */
const GEMINI_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'];
function geminiAspect(ratio, supported) {
  const list = (Array.isArray(supported) && supported.length) ? supported.map(String) : GEMINI_ASPECTS;
  const r = String(ratio || '').trim();
  if (list.includes(r)) return r;
  const m = /^([0-9.]+)\s*[:/／]\s*([0-9.]+)$/.exec(r);
  if (!m) return '';
  const w = parseFloat(m[1]); const h = parseFloat(m[2]);
  if (!w || !h) return '';
  /* 就近吸附到最接近的支持档位(3:2 → 16:9 等) */
  const target = w / h;
  let best = '';
  let bestDiff = Infinity;
  for (const s of list) {
    const sm = /^([0-9.]+)\s*[:/／]\s*([0-9.]+)$/.exec(String(s));
    if (!sm) continue;
    const sw = parseFloat(sm[1]);
    const sh = parseFloat(sm[2]);
    if (!sw || !sh) continue;
    const diff = Math.abs(sw / sh - target);
    if (diff < bestDiff) { bestDiff = diff; best = String(s); }
  }
  return best;
}

/* 第二十六轮:把画幅比例换算成 OpenAI 类协议的常用尺寸
 * 1:1 → 1024x1024;横图 → 1536x1024;竖图 → 1024x1536(模型给了 size 时不用它) */
function sizeFromRatio(ratio) {
  const m = /^([0-9.]+)\s*:\s*([0-9.]+)$/.exec(String(ratio || '').trim());
  if (!m) return '';
  const w = parseFloat(m[1]); const h = parseFloat(m[2]);
  if (!w || !h) return '';
  if (Math.abs(w - h) < 1e-6) return '1024x1024';
  return w > h ? '1536x1024' : '1024x1536';
}

/* 通用「画幅吸附」别名:清单由 rules.limits.aspect_ratios 提供,不限于 Gemini */
const snapAspect = geminiAspect;

/* 第三十三轮:分辨率档 → 该网关支持的档位字符串
 * 支持清单来自 rules.limits.resolutions(缺省 1K/2K/4K);
 * 档位可写成 1K/2K/4K 这类叫法,也可直接写像素数(1024),按就近像素值吸附 */
function resolutionToPx(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return 0;
  const k = /^([0-9]+(?:\.[0-9]+)?)\s*k/.exec(s);
  if (k) return Math.round(parseFloat(k[1]) * 1024);
  const px = Math.round(Number(s));
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/* 通用「档位吸附」:把用户选的分辨率档收敛到该网关支持的清单
 * (清单来自 rules.limits.resolutions,缺省 1K/2K/4K;档位可写 1K 叫法或直接写像素) */
function snapTier(value, allowed) {
  const list = (Array.isArray(allowed) && allowed.length) ? allowed.map(String) : ['1K', '2K', '4K'];
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const exact = list.find(x => x.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  const px = resolutionToPx(s);
  if (!px) return list[0];
  let best = '', bestDiff = Infinity;
  for (const x of list) {
    const xp = resolutionToPx(x);
    if (!xp) continue;
    const d = Math.abs(xp - px);
    if (d < bestDiff) { bestDiff = d; best = x; }
  }
  return best;
}
/* Gemini 的 imageSize 字段就是这套档位(1K/2K/4K),保留语义别名 */
const geminiImageSize = snapTier;

/* 第二十六轮:模型能力声明(rules.caps)
 * caps 缺省视为纯文生图;多图合成蕴含图生图(1 张参考同样可走) */
const CAP_T2I = 'text-to-image';
const CAP_I2I = 'image-to-image';
const CAP_MULTI = 'multi-image';
function modelCaps(model) {
  const raw = parseRules(model).caps;
  const arr = Array.isArray(raw) ? raw.map(v => String(v).trim()).filter(Boolean) : [];
  const out = [];
  /* 多图合成的模型必然支持文生图与图生图(能力蕴含) */
  if (!arr.length || arr.includes(CAP_T2I) || arr.includes(CAP_MULTI)) out.push(CAP_T2I);
  if (arr.includes(CAP_I2I) || arr.includes(CAP_MULTI)) out.push(CAP_I2I);
  if (arr.includes(CAP_MULTI)) out.push(CAP_MULTI);
  return [...new Set(out)];
}

/* ---------- 模型「出图规格」元信息(需求 26·9) ----------
 * 前端的比例 / 分辨率下拉、以及「该网关按像素还是按档位出图」的提示,全部来自这里:
 * 优先模型参数模板 params_schema,其次生成规则 rules.limits,代码不预设任何网关的参数写法。 */

/* 该模型的尺寸形态:模板里出现 <size>/<width>/<height>(或走 OpenAI multipart 图生图)→ 像素尺寸;
   否则 → 档位字符串。用宽高令牌的网关(如百炼 size:"宽*高")同样需要按 limits.sizes 吸附。 */
function sizeModeOf(model) {
  const create = (normalizeRules(model).create) || {};
  const tmpl = JSON.stringify(create.body || {});
  if (/<size>|<width>|<height>/.test(tmpl)) return 'pixels';
  const edit = String(create.edit
    || (create.edit_path === '' || create.edit_path === false ? '' : 'multipart')).toLowerCase();
  return edit === 'multipart' ? 'pixels' : 'tier';
}

/* params_schema 里某个 select 的清单;没有则回退 rules.limits 的清单;都没有 → null */
function schemaOptions(model, keys) {
  let schema = [];
  try { schema = JSON.parse(model.params_schema || '[]'); } catch (e) { return null; }
  if (!Array.isArray(schema)) return null;
  const d = schema.find(x => x && keys.includes(x.key));
  return d && Array.isArray(d.options) && d.options.length ? d.options.map(String) : null;
}
function limitsList(model, key) {
  const list = (normalizeRules(model).limits || {})[key];
  return Array.isArray(list) && list.length ? list.map(String) : null;
}
function tiersOf(model) {
  return schemaOptions(model, ['resolution']) || limitsList(model, 'resolutions');
}
function ratiosOf(model) {
  return schemaOptions(model, ['ratio', 'aspect_ratio']) || limitsList(model, 'aspect_ratios');
}
function imageSpecMeta(model) {
  const rules = normalizeRules(model);
  return {
    protocol: rules.protocol,
    caps: modelCaps(model),
    size_mode: sizeModeOf(model),
    supported_sizes: (rules.limits && rules.limits.sizes) || null,
    res_tiers: tiersOf(model),
    ratio_options: ratiosOf(model)
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function detailText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 400);
  try { const s = JSON.stringify(v); return s ? s.slice(0, 400) : ''; } catch (e) { return ''; }
}

/* ---------- 通用请求(错误详情提取 + 重试) ----------
   读响应体必须和 fetch 同在 try 里:网关已扣费但连接被切断时,undici 抛的是
   TypeError("terminated"),留在 try 外就会把任务错误写成光秃秃一个词,无法排查。 */

/* 发请求并读完响应体;中断/超时给出「可能已扣费」的可读提示(生图是计费动作,不自动重试) */
async function fetchText(url, init, label) {
  const began = Date.now();
  try {
    const res = await fetch(url, init);
    return { res, text: await res.text() };
  } catch (e) {
    const sec = Math.round((Date.now() - began) / 1000);
    const msg = e.message || String(e.name || '');
    if (e.name === 'TimeoutError' || /terminated|abort|socket hang up|ETIMEDOUT/i.test(msg)) {
      throw new Error(label + '在 ' + sec + 's 后中断(' + (e.name === 'TimeoutError' ? '超时未返回完整响应' : msg) + ')'
        + ';网关可能已经出图并扣费,请先在服务商处核对账单再决定是否重试(重试可能重复计费)');
    }
    throw new Error(label + '失败(网络错误:' + msg + '): ' + url);
  }
}

async function postJSON(url, headers, body, timeoutMs) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : CREATE_TIMEOUT_MS;
  const { res, text } = await fetchText(url, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms)
  }, '生图请求');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!res.ok) throw new Error('生图 API 返回错误(HTTP ' + res.status + '): ' + errDetail(data, text));
  if (!data) throw new Error('生图 API 响应不是合法 JSON: ' + text.slice(0, 200));
  return data;
}

/* 兼容 {error:{message}} / {error:"..."} / {message} / {detail} / 纯文本 */
function errDetail(data, text) {
  const raw = data && typeof data === 'object'
    ? (data.error != null ? data.error : data.message != null ? data.message : data.detail != null ? data.detail : null)
    : null;
  if (raw && typeof raw === 'object') {
    const m = raw.message != null ? raw.message : raw;
    return detailText(m) || detailText(raw) || String(text || '').slice(0, 200);
  }
  return detailText(raw) || String(text || '').slice(0, 200);
}

/* 下载远程图片 → 本地文件(自动重试),返回带正确扩展名的路径 */
async function downloadImage(url, basePath) {
  const attempts = 3;
  let lastErr = '';
  for (let i = 1; i <= attempts; i++) {
    let res;
    let buf;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      /* 读体同样要在 try 内:CDN 断流时 undici 抛 "terminated",外层不接就变成无意义报错 */
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      const msg = e.message || String(e.name || '');
      lastErr = /^HTTP /.test(msg) ? msg : (e.name === 'TimeoutError' ? '下载超时' : ('网络错误(' + msg + ')'));
      if (i < attempts) { await sleep(800 * i); continue; }
      throw new Error('下载生成图片失败(' + lastErr + '): ' + String(url).slice(0, 160));
    }
    return writeImageBuffer(buf, basePath, res.headers.get('content-type') || '');
  }
  throw new Error('下载生成图片失败:' + lastErr);
}

/* 按字节嗅探图片类型并写盘(PNG/JPEG/WEBP/GIF) */
function writeImageBuffer(buf, basePath, mimeHint) {
  let ext = 'png';
  const mime = String(mimeHint || '').toLowerCase();
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) ext = 'png';
  else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) ext = 'jpg';
  else if (buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
  else if (buf.length > 6 && buf.slice(0, 3).toString('ascii') === 'GIF') ext = 'gif';
  else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
  else if (mime.includes('webp')) ext = 'webp';
  else if (mime.includes('gif')) ext = 'gif';
  const file = basePath + '.' + ext;
  fs.writeFileSync(file, buf);
  return file;
}

function hasNegative(neg) { return String(neg || '').trim().length > 0; }

/* 按点分路径取值:'content.parts' → obj.content.parts;单段路径直接取 */
function getPath(obj, dotted) {
  let cur = obj;
  for (const seg of String(dotted).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/* ---------- 适配器:OpenAI Images 兼容 ---------- */
/* 请求上下文令牌表:rules.create.body 里写 <size> 走「像素尺寸」网关,
   写 <resolution> 走「档位字符串」网关(如 Agnes:size=1K/2K/4K + ratio=16:9),
   两者都由规则决定,代码不预设某个网关只吃哪一种 */
function openaiCtxMap(ctx) {
  const { params, count, negativePrompt } = ctx;
  const ratio = params.aspect_ratio || params.ratio || '';
  const resolution = params.resolution != null ? String(params.resolution) : '';
  const wh = sizeToWH(params.size) || sizeToWH(sizeFromRatio(ratio)) || null;
  return {
    model_id: ctx.model.model_id || '',
    prompt: ctx.prompt,
    negative_prompt: negativePrompt || '',
    n: count || 1,
    size: params.size || (wh ? wh.w + 'x' + wh.h : ''),
    resolution,
    /* 画幅比例:不同网关字段名不一(ratio / aspect_ratio),模板里想用哪个由管理员决定 */
    ratio,
    aspect_ratio: ratio,
    /* 长边 / 短边像素:供只接受单边数字的网关(如 size: <max_side>) */
    width: wh ? wh.w : '',
    height: wh ? wh.h : '',
    max_side: wh ? Math.max(wh.w, wh.h) : '',
    min_side: wh ? Math.min(wh.w, wh.h) : '',
    quality: params.quality || '',
    seed: params.seed != null && params.seed !== '' ? params.seed : -1,
    style: params.style || ''
  };
}

/* 模板填充:递归处理数组/嵌套对象,令牌可出现在任意深度
   (如百炼 input.messages[0].content[0].text = "<prompt>") */
function fillTemplate(value, ctxMap) {
  if (typeof value === 'string') {
    let out = value;
    let any = false;
    for (const [k, v] of Object.entries(ctxMap)) {
      if (out.includes('<' + k + '>')) { out = out.split('<' + k + '>').join(String(v)); any = true; }
    }
    if (!any) return value;
    if (out === '<none>' || out === '') return '<__DROP__>';
    const full = /^<([^>]+)>$/.exec(value);
    if (full && ctxMap[full[1]] !== undefined) return ctxMap[full[1]];
    return out;
  }
  if (Array.isArray(value)) {
    const arr = [];
    for (const v of value) { const r = fillTemplate(v, ctxMap); if (r !== '<__DROP__>') arr.push(r); }
    return arr;
  }
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) {
      const r = fillTemplate(v, ctxMap);
      if (r !== '<__DROP__>') o[k] = r;
    }
    return o;
  }
  return value;
}

function dropSentinel(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '<__DROP__>') continue;
    out[k] = v;
  }
  return out;
}

function openaiBodyFromTemplate(ctx) {
  const create = ctx.rules.create || {};
  const body = dropSentinel(JSON.parse(JSON.stringify(create.body || {})));
  const cmap = openaiCtxMap(ctx);
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    const replaced = fillTemplate(v, cmap);
    if (replaced === '<__DROP__>') continue;
    out[k] = replaced;
  }
  if (create.response_format) out.response_format = create.response_format;
  return out;
}

/* 解析 OpenAI 风格响应:{data:[{url}|{b64_json}]}(字段名由 rules.response 配置) */
async function saveOpenAiImages(data, rules, outBase, onProgress) {
  const resp = rules.response || {};
  let list = data;
  if (resp.data_path) {
    const next = getPath(data, resp.data_path);
    if (next !== undefined) list = next;
  }
  if (!Array.isArray(list) || !list.length) {
    /* 兼容顶层直接给 url / b64 的网关 */
    const urlKey = resp.url_field || 'url';
    const b64Key = resp.b64_field || 'b64_json';
    const one = data && (data[urlKey] || data.image_url || data.image);
    if (typeof one === 'string' && /^https?:[/]/i.test(one)) list = [{ [urlKey]: one }];
    else if (typeof one === 'string' && one.length > 64) list = [{ [b64Key]: one }];
    else throw new Error('生图响应中没有结果图片: ' + detailText(data).slice(0, 200));
  }
  const files = [];
  let i = 0;
  for (const item of list) {
    i++;
    if (!item || typeof item !== 'object') {
      if (typeof item === 'string' && /^https?:[/]/i.test(item)) {
        files.push(await downloadImage(item, outBase + '-' + i));
      } else if (typeof item === 'string' && item.length > 64) {
        files.push(writeImageBuffer(Buffer.from(item.replace(/^data:[^;]+;base64,/, ''), 'base64'), outBase + '-' + i, ''));
      }
      continue;
    }
    const url = item[resp.url_field || 'url'];
    const b64 = item[resp.b64_field || 'b64_json'];
    if (b64) {
      files.push(writeImageBuffer(Buffer.from(String(b64).replace(/^data:[^;]+;base64,/, ''), 'base64'), outBase + '-' + i, ''));
    } else if (typeof url === 'string' && /^https?:[/]/i.test(url)) {
      files.push(await downloadImage(url, outBase + '-' + i));
    }
    if (onProgress) onProgress(Math.min(90, 20 + Math.round(files.length / Math.max(1, list.length) * 70)));
  }
  if (!files.length) throw new Error('生图响应中没有可用的结果图片: ' + detailText(data).slice(0, 200));
  return files;
}

async function generateOpenAiImage(ctx) {
  const { model, rules, params, count, outBase, onProgress } = ctx;
  const base = String(model.api_base || '').replace(/[/]+$/, '');
  if (!base) throw new Error('API 地址未配置');
  if (!model.api_key) throw new Error('API Key 未配置,请在后台「模型管理」中填写');
  const create = rules.create || {};
  const headers = { Authorization: 'Bearer ' + model.api_key };

  /* 参考图列表(第二十六轮:多图合成支持 ≥2 张;兼容旧 refAsset 单图) */
  const refAssets = (Array.isArray(ctx.refAssets) && ctx.refAssets.length)
    ? ctx.refAssets.filter(a => a && a.path)
    : (ctx.refAsset && ctx.refAsset.path ? [ctx.refAsset] : []);

  /* 图生图的两种网关形态,由规则决定而不是猜:
     - create.edit:"multipart"(默认)→ POST edit_path 表单(OpenAI /images/edits,image / image[] 字段)
     - create.edit:"json"            → 仍走 create.path 的 JSON 请求,参考图写入 create.images_field
                                        (Agnes 这类「一个端点 + image:[url|base64]」的兼容网关)
     - create.edit_path:"" / false   → 该网关没有图生图端点,带参考图时按文生图提交 */
  const editMode = String(create.edit
    || (create.edit_path === '' || create.edit_path === false ? '' : 'multipart')).toLowerCase();

  if (refAssets.length && editMode === 'json') {
    const body = openaiBodyFromTemplate(ctx);
    const field = String(create.images_field || 'image');
    const refs = [];
    for (const ra of refAssets) {
      try { refs.push(await agnes.mediaRefAsync({ id: ra.id, name: ra.name, path: ra.path, mime: ra.mime })); }
      catch (e) { throw new Error('参考图无法提供给该网关(' + (ra.name || ra.id) + '):' + errText(e)); }
    }
    body[field] = (refs.length === 1 && create.images_single_string === true) ? refs[0] : refs;
    if (onProgress) onProgress(15);
    const data = await postJSON(base + String(create.path || '/images/generations').replace(/^\/?/, '/'),
      { ...headers, 'Content-Type': 'application/json' }, body);
    return saveOpenAiImages(data, rules, outBase, onProgress);
  }

  /* 图生图 / 多图合成:带参考图且规则未禁用 edit_path → multipart /images/edits */
  if (refAssets.length && editMode === 'multipart' && create.edit_path !== '' && create.edit_path !== false) {
    const editPath = String(create.edit_path || '/images/edits').replace(/^\/?/, '/');
    const fd = new FormData();
    for (let ri = 0; ri < refAssets.length; ri++) {
      const ra = refAssets[ri];
      let imgPath = ra.path;
      let mime = ra.mime || 'image/png';
      try {
        const pre = await agnes.prepareImage(imgPath, mime); // 大图压缩,降低请求体
        imgPath = pre.path; mime = pre.mime;
      } catch (e) { /* 压缩失败用原图 */ }
      const ext = (String(mime).split('/')[1] || 'png').replace('jpeg', 'jpg');
      /* 单参考图用 image;多参考图用 image[](OpenAI gpt-image-1 多图合成约定) */
      const fieldName = refAssets.length > 1 ? 'image[]' : 'image';
      fd.append(fieldName, new Blob([fs.readFileSync(imgPath)], { type: mime }),
        'reference-' + (ri + 1) + '.' + ext);
    }
    fd.append('model', model.model_id || '');
    fd.append('prompt', hasNegative(ctx.negativePrompt)
      ? ctx.prompt + '。避免:' + ctx.negativePrompt
      : ctx.prompt);
    fd.append('n', String(count || 1));
    const effSize = params.size || sizeFromRatio(params.aspect_ratio) || '';
    if (effSize && effSize !== 'auto') fd.append('size', effSize);
    if (create.response_format) fd.append('response_format', create.response_format);
    if (onProgress) onProgress(15);
    const { res, text } = await fetchText(base + editPath, {
      method: 'POST', headers, body: fd, signal: AbortSignal.timeout(Number(create.timeout_ms) > 0 ? create.timeout_ms : CREATE_TIMEOUT_MS)
    }, '图生图请求');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) throw new Error('图生图请求失败(HTTP ' + res.status + '): ' + errDetail(data, text));
    return saveOpenAiImages(data, rules, outBase, onProgress);
  }

  /* 文生图:JSON 请求体(rules.create.body 模板驱动) */
  if (onProgress) onProgress(15);
  const body = openaiBodyFromTemplate(ctx);
  const data = await postJSON(base + String(create.path || '/images/generations').replace(/^\/?/, '/'),
    { ...headers, 'Content-Type': 'application/json' }, body, create.timeout_ms);
  return saveOpenAiImages(data, rules, outBase, onProgress);
}

/* ---------- 适配器:Google Gemini generateContent ---------- */
async function generateGeminiImage(ctx) {
  const { model, rules, params, refAsset, count, prompt, negativePrompt, outBase, onProgress } = ctx;
  const base = String(model.api_base || 'https://generativelanguage.googleapis.com/v1beta').replace(/[/]+$/, '');
  if (!model.api_key) throw new Error('API Key 未配置,请在后台「模型管理」中填写');
  const create = rules.create || {};
  const url = base + String(create.path || '/models/<model_id>:generateContent')
    .replace(/^\/?/, '/')
    .split('<model_id>').join(model.model_id || '');

  const parts = [{ text: prompt }];
  if (hasNegative(negativePrompt)) parts.push({ text: 'Avoid: ' + negativePrompt });
  /* 参考图列表(第二十六轮:多图合成按顺序注入多份 inlineData) */
  const refAssets = (Array.isArray(ctx.refAssets) && ctx.refAssets.length)
    ? ctx.refAssets.filter(a => a && a.path)
    : (refAsset && refAsset.path ? [refAsset] : []);
  for (const ra of refAssets) {
    let p = ra.path;
    let mime = ra.mime || 'image/png';
    try { const pre = await agnes.prepareImage(p, mime); p = pre.path; mime = pre.mime; } catch (e) { /* 用原图 */ }
    parts.push({ inlineData: { mimeType: mime, data: fs.readFileSync(p).toString('base64') } });
  }
  const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
  /* 画幅比例 + 分辨率档都写进 imageConfig —— 此前 Gemini 只带 aspectRatio,
     「分辨率」下拉对该协议完全不起作用(第三十三轮) */
  const imageConfig = {};
  if (create.aspect_ratio !== false) {
    /* 优先显式比例,无比例时按尺寸换算;可吸附的档位清单来自 rules.limits.aspect_ratios */
    const wh = sizeToWH(params.size);
    const ar = geminiAspect(params.aspect_ratio || (wh ? whToAspect(wh.w, wh.h) : ''),
      rules.limits && rules.limits.aspect_ratios);
    if (ar) imageConfig.aspectRatio = ar;
  }
  if (create.image_size !== false) {
    const ks = geminiImageSize(params.resolution, rules.limits && rules.limits.resolutions);
    if (ks) imageConfig.imageSize = ks;
  }
  if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig;

  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': model.api_key };
  const resp = rules.response || {};
  const files = [];
  const n = Math.max(1, Math.min(Number(count) || 1, (rules.limits && rules.limits.max_count) || 4));
  for (let i = 1; i <= n; i++) {
    if (onProgress) onProgress(Math.min(90, Math.round(10 + (i - 1) / n * 80)));
    const data = await postJSON(url, headers, { contents: [{ parts }], generationConfig });
    let candidates = data;
    if (resp.candidates_path) {
      const next = getPath(data, resp.candidates_path);
      if (next !== undefined) candidates = next;
    }
    const cand = Array.isArray(candidates) ? candidates[0] : null;
    let partList = cand;
    if (cand && resp.parts_path) {
      const next = getPath(cand, resp.parts_path);
      if (next !== undefined) partList = next;
    }
    const inlineField = resp.inline_field || 'inlineData';
    let saved = false;
    for (const part of (Array.isArray(partList) ? partList : [])) {
      const inline = part && typeof part === 'object' ? (part[inlineField] || part.inlineData) : null;
      if (inline && inline.data) {
        files.push(writeImageBuffer(Buffer.from(String(inline.data), 'base64'), outBase + '-' + i, inline.mimeType || ''));
        saved = true;
        break;
      }
    }
    if (!saved) {
      const reason = cand && cand.finishReason ? cand.finishReason : '';
      const block = data && data.promptFeedback && data.promptFeedback.blockReason ? data.promptFeedback.blockReason : '';
      throw new Error('Gemini 响应中没有图片' + (reason ? '(finishReason: ' + reason + ')' : '') + (block ? '(拦截原因: ' + block + ')' : ''));
    }
  }
  if (onProgress) onProgress(95);
  return files;
}

/* ---------- 适配器:本地占位生图(ffmpeg 渲染,免费测试) ----------
 * 由提示词哈希确定性生成渐变+噪点占位图,不调用外部 API、不消耗积分;
 * 用于生图链路连通性测试与离线演示。 */
async function generateFfmpegImage(ctx) {
  const { params, count, prompt, outBase, onProgress } = ctx;
  /* 尺寸缺省时按画幅比例换算(第二十六轮:比例/分辨率参数平级) */
  const wh = sizeToWH(params.size) || sizeToWH(sizeFromRatio(params.aspect_ratio)) || { w: 1024, h: 1024 };
  let hash = 7;
  for (const ch of String(prompt || '')) hash = ((hash * 131) + ch.charCodeAt(0)) >>> 0;
  /* 第二十七轮:种子为 -1/空 = 每次随机刷新(同提示词重生成也会出新图);固定种子仍可复现 */
  const wantedSeed = Number(params.seed);
  const seed = (Number.isFinite(wantedSeed) && wantedSeed >= 0)
    ? (wantedSeed % 100000)
    : Math.floor((hash + Math.floor(Math.random() * 100000)) % 100000);
  const files = [];
  const n = Math.max(1, Math.min(Number(count) || 1, 4));
  for (let i = 1; i <= n; i++) {
    const file = outBase + '-' + i + '.png';
    const args = ['-y', '-f', 'lavfi',
      '-i', 'gradients=s=' + wh.w + 'x' + wh.h +
        ':c0=0x' + hueHex((seed + i * 37) % 360) +
        ':c1=0x' + hueHex((seed * 2 + i * 91) % 360) +
        ':c2=0x' + hueHex((seed * 3 + i * 53) % 360) +
        ':x0=' + ((seed + i) % wh.w) + ':y0=' + ((seed * 3 + i) % wh.h) +
        ':nb_colors=3:seed=' + ((seed + i) % 4294967295) + ':speed=0.02:d=0.5',
      '-vf', 'noise=alls=6:all_seed=' + ((seed + i) % 2147483647) + ':allf=t,gblur=sigma=1.2,format=rgb24',
      '-frames:v', '1', file];
    try {
      await ffmpegRun(args, { timeout: 60000 });
    } catch (e) {
      /* 老版 ffmpeg 无 gradients 滤镜 → 回退纯色 + 噪点 */
      await ffmpegRun(['-y', '-f', 'lavfi',
        '-i', 'color=c=0x' + hueHex((seed + i * 37) % 360) + ':s=' + wh.w + 'x' + wh.h + ':d=0.1',
        '-vf', 'noise=alls=22:all_seed=' + ((seed + i) % 2147483647) + ':allf=t,format=rgb24',
        '-frames:v', '1', file], { timeout: 60000 });
    }
    files.push(file);
    if (onProgress) onProgress(Math.round(10 + i / n * 85));
  }
  return files;
}

/* hue(0-359) → RRGGBB */
function hueHex(hue) {
  const f = n => {
    const k = (n + hue / 60) % 6;
    const v = 1 - Math.max(0, Math.min(Math.min(k, 4 - k), 1));
    return Math.round(255 * (1 - 0.45 * v)).toString(16).padStart(2, '0');
  };
  return f(5) + f(3) + f(1);
}

/* ---------- 适配器注册表 ---------- */
const ADAPTERS = {
  'openai-image': { id: 'openai-image', label: DEFAULT_RULES['openai-image'].label, generate: generateOpenAiImage },
  'gemini-image': { id: 'gemini-image', label: DEFAULT_RULES['gemini-image'].label, generate: generateGeminiImage },
  'img-ffmpeg': { id: 'img-ffmpeg', label: DEFAULT_RULES['img-ffmpeg'].label, generate: generateFfmpegImage }
};

function resolve(model) {
  const protocol = detectProtocol(model);
  const adapter = ADAPTERS[protocol];
  if (!adapter) throw new Error('未知的生图适配器: ' + protocol + '(模型 ' + (model && model.id) + ')');
  return adapter;
}

/* worker 顶层入口:按模型规则自动适配生图,返回生成的图片文件路径数组 */
async function run(model, ctx) {
  const adapter = resolve(model);
  const rules = normalizeRules(model);
  /* model 放在 ctx 之后,保证 ctx.model(若有)不会遮蔽适配器入参 */
  return adapter.generate({ ...ctx, rules, model });
}

function listAdapters() {
  return Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label }));
}

module.exports = {
  ADAPTERS, resolve, run, listAdapters,
  parseRules, normalizeRules, detectProtocol, errText,
  fillTemplate, sizeToWH, whToAspect, downloadImage, writeImageBuffer,
  modelCaps, sizeFromRatio, geminiAspect, snapAspect, geminiImageSize, snapTier, resolutionToPx,
  sizeModeOf, tiersOf, ratiosOf, imageSpecMeta
};



