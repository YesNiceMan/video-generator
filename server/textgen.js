'use strict';
/* 文本模型(第四十二轮 · 剧本与文字处理)
 * 与视频/生图同一套思路:按模型 rules 适配,不写死任何一家网关。
 * 协议 openai-chat = POST {api_base}/chat/completions,非流式,取 choices[0].message.content。
 * 「剧本处理」的提示词模板全部在这里(服务端),前端只能选 task 枚举,
 * 不能塞任意 system —— 避免把这套接口变成通用代理。
 */
const { db } = require('./db');

const DEFAULT_RULES = {
  protocol: 'openai-chat',
  label: 'OpenAI Chat 兼容协议(规则可配)',
  create: {
    path: '/chat/completions',
    method: 'POST',
    body: { model: '<model_id>', messages: '<messages>', temperature: '<temperature>', max_tokens: '<max_tokens>' },
    timeout_ms: 120000
  },
  response: { content_path: 'choices.0.message.content', usage_path: 'usage' },
  limits: { max_chars: 20000, max_output_tokens: 4096 }
};

/* 内置任务模板:label 给界面用,instruction 给模型用 */
const TASKS = {
  polish: {
    label: '润色剧本',
    instruction: '在保留原意、人物关系与剧情走向的前提下润色这段剧本：对白更口语、动作更具体、节奏更紧。只输出改写后的剧本文本，不要标题、不要解释。'
  },
  expand: {
    label: '扩写细节',
    instruction: '把这段剧本扩写到约 1.5~2 倍长度，补充镜头能表现的动作、环境与情绪细节，不得改变剧情走向与人物设定。只输出剧本文本。'
  },
  condense: {
    label: '压缩精简',
    instruction: '把这段剧本压缩到原长度的一半以内，保留关键情节、人物动机与转折。只输出剧本文本。'
  },
  to_video_prompt: {
    label: '转成视频提示词',
    instruction: '把这段剧本改写成一条可直接用于 AI 视频生成的中文画面提示词：主体 + 外观 + 动作 + 镜头运动 + 景别 + 光线 + 风格，60~160 字，一段话，不分点，不解释。'
  },
  split_shots: {
    label: '拆成分镜',
    json: true,
    instruction: '把这份剧本拆成分镜列表。只输出严格 JSON 数组，每项形如 {"title":"镜头短名","script":"一句画面描述","duration":5}；'
      + 'duration 是 3~15 的整数秒；最多 24 镜；不要 markdown 代码块，不要任何额外文字。'
  }
};
const TASK_IDS = Object.keys(TASKS);

function parseRules(model) {
  if (!model || !model.rules) return {};
  try { return JSON.parse(model.rules) || {}; } catch (e) { return {}; }
}
function normalizeRules(model) {
  const user = parseRules(model);
  const out = JSON.parse(JSON.stringify(DEFAULT_RULES));
  out.protocol = user.protocol || out.protocol;
  if (user.label) out.label = user.label;
  for (const k of ['create', 'response', 'limits']) {
    if (user[k] && typeof user[k] === 'object') Object.assign(out[k] || (out[k] = {}), user[k]);
  }
  return out;
}
function detectProtocol(model) {
  const r = parseRules(model);
  if (r.protocol) return r.protocol;
  return 'openai-chat';
}

function getPath(obj, p) {
  if (!obj || !p) return undefined;
  let cur = obj;
  for (const seg of String(p).split('.')) {
    if (cur == null) return undefined;
    cur = /^\d+$/.test(seg) ? cur[Number(seg)] : cur[seg];
  }
  return cur;
}

function fillTemplate(tpl, vars) {
  if (typeof tpl === 'string') {
    const key = tpl.replace(/^<|>$/g, '');
    if (tpl.startsWith('<') && tpl.endsWith('>') && Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    let out = tpl;
    for (const k of Object.keys(vars)) out = out.split('<' + k + '>').join(String(vars[k] == null ? '' : vars[k]));
    return out;
  }
  if (Array.isArray(tpl)) return tpl.map(x => fillTemplate(x, vars));
  if (tpl && typeof tpl === 'object') {
    const o = {};
    for (const k of Object.keys(tpl)) o[k] = fillTemplate(tpl[k], vars);
    return o;
  }
  return tpl;
}

function errText(e) { return e instanceof Error ? (e.message || String(e)) : String(e || ''); }

/* 组装 messages:system 只来自服务端模板 */
function buildMessages(taskId, text, ctx) {
  const t = TASKS[taskId];
  const sys = '你是影视剧本与分镜助手。' + t.instruction;
  const userText = (ctx && ctx.context)
    ? '【全片设定(仅供理解，不要复述)】\n' + String(ctx.context).slice(0, 2000) + '\n\n【待处理文本】\n' + text
    : text;
  return [{ role: 'system', content: sys }, { role: 'user', content: userText }];
}

/* 调一次 chat/completions,返回 { content, usage } */
async function complete(model, messages, opts) {
  opts = opts || {};
  const rules = normalizeRules(model);
  const create = rules.create || {};
  if (!model.api_base) throw new Error('「' + (model.name || '') + '」未配置 API 地址');
  if (!model.api_key) throw new Error('「' + (model.name || '') + '」未配置 API Key');
  const base = String(model.api_base).replace(/[/]+$/, '');
  const url = base + String(create.path || '/chat/completions').replace(/^\/?/, '/');
  const vars = {
    model_id: model.model_id || '',
    messages,
    temperature: Number.isFinite(Number(opts.temperature)) ? Number(opts.temperature) : (Number.isFinite(Number(create.temperature)) ? Number(create.temperature) : 0.7),
    max_tokens: Math.min(Number(opts.max_tokens) || Number(create.max_tokens) || 2048, Number(rules.limits && rules.limits.max_output_tokens) || 4096)
  };
  const body = fillTemplate(create.body || DEFAULT_RULES.create.body, vars);
  const headers = Object.assign({ Authorization: 'Bearer ' + model.api_key, 'Content-Type': 'application/json' }, create.headers || {});
  const ms = Number(opts.timeout_ms) > 0 ? Number(opts.timeout_ms)
    : (Number(create.timeout_ms) > 0 ? Number(create.timeout_ms) : 120000);
  const began = Date.now();
  let res, text;
  try {
    res = await fetch(url, { method: create.method || 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    text = await res.text();
  } catch (e) {
    const sec = Math.round((Date.now() - began) / 1000);
    const msg = e.message || String(e.name || '');
    if (e.name === 'TimeoutError' || /terminated|abort|socket hang up|ETIMEDOUT/i.test(msg)) {
      throw new Error('文本请求在 ' + sec + 's 后中断(' + (e.name === 'TimeoutError' ? '超时未返回完整响应' : msg)
        + ')；服务方可能已计入用量，请先核账再重试');
    }
    throw new Error('文本请求失败(网络错误:' + msg + ')');
  }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { }
  if (!res.ok) {
    const raw = data && data.error != null ? data.error : (data && data.message) || null;
    const detail = raw && typeof raw === 'object' ? (raw.message || JSON.stringify(raw)) : String(raw || text || '').slice(0, 200);
    throw new Error('文本模型返回错误(HTTP ' + res.status + '): ' + detail);
  }
  if (!data) throw new Error('文本模型响应不是合法 JSON: ' + String(text).slice(0, 160));
  const resp = rules.response || {};
  let content = getPath(data, resp.content_path || 'choices.0.message.content');
  if (typeof content !== 'string' || !content.trim()) {
    /* 兼容少数网关把内容挂在别处的写法 */
    const alt = getPath(data, resp.alt_content_path || 'choices.0.delta.content');
    if (typeof alt === 'string' && alt.trim()) content = alt;
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('文本响应里没有内容: ' + String(JSON.stringify(data)).slice(0, 200));
  }
  return { content: content.trim(), usage: getPath(data, resp.usage_path || 'usage') || null };
}

/* 拆分镜的 JSON 容错解析:剥 ``` 围栏、截首个数组、逐条校验 */
function parseShotsJson(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let arr;
  try { arr = JSON.parse(s); } catch (e) {
    throw new Error('模型没有返回合法 JSON 数组(可能是提示词被改写或输出被截断): ' + errText(e).slice(0, 120));
  }
  if (!Array.isArray(arr) || !arr.length) throw new Error('模型返回的镜头列表为空');
  const shots = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const script = String(it.script || it.description || it.content || '').trim();
    if (!script) continue;
    let d = Math.round(Number(it.duration != null ? it.duration : it.seconds));
    if (!Number.isFinite(d)) d = 5;
    shots.push({
      title: String(it.title || it.name || '').trim().slice(0, 80) || script.slice(0, 12),
      script: script.slice(0, 2000),
      duration: Math.max(1, Math.min(60, d))
    });
  }
  if (!shots.length) throw new Error('模型返回的 JSON 里没有可用镜头项');
  return shots.slice(0, 24);
}

/* 一次剧本处理:模板 → 调用 → 按任务类型整形输出 */
async function runTask(model, taskId, text, ctx) {
  const t = TASKS[taskId];
  if (!t) throw new Error('未知的文本处理任务: ' + taskId);
  const rules = normalizeRules(model);
  const maxChars = Number(rules.limits && rules.limits.max_chars) || 20000;
  const clean = String(text || '').trim();
  if (!clean) throw new Error('请输入要处理的文本');
  if (clean.length > maxChars) throw new Error('文本过长(' + clean.length + ' 字)，上限 ' + maxChars + ' 字，请分段处理');
  const { content, usage } = await complete(model, buildMessages(taskId, clean, ctx), { temperature: t.json ? 0.2 : 0.7 });
  if (t.json) return { kind: 'shots', shots: parseShotsJson(content), usage, chars_in: clean.length, chars_out: content.length };
  return { kind: 'text', text: content, usage, chars_in: clean.length, chars_out: content.length };
}

/* 文本单价(积分/次):免费模型 0;模型价(credit_per_second 字段对文本即「每次价格」)优先;否则全局 creditPerText */
function pricePerCall(model, settings) {
  if (model && model.is_free) return 0;
  if (model) {
    const mp = Math.max(0, Number(model.credit_per_second) || 0);
    if (mp > 0) return Math.round(mp * 100) / 100;
  }
  const s = settings || require('./db').getSettings();
  return Math.max(0, Number(s.creditPerText ?? 1));
}

module.exports = {
  DEFAULT_RULES, TASKS, TASK_IDS, normalizeRules, parseRules, detectProtocol,
  buildMessages, complete, runTask, parseShotsJson, pricePerCall, getPath
};
