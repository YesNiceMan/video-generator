'use strict';
// 后台管理 API:用户管理 / 任务监控 / 模型管理(有效性检查+自检) / 系统设置 / 积分审批
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../auth');
const { asyncRoute, httpError, uid, now, clamp, ensureDir } = require('../util');
const multer = require('multer');
const { execFile } = require('child_process');
const { db, getSettings, setSetting, DATA_DIR } = require('../db');
const { enqueue, pump, running } = require('../worker');
const credits = require('../credits');

const r = Router();
r.use(requireAdmin);

function userJSON(u) {
  return { ...u, password_hash: undefined };
}

/* API Key 不回传明文:只给"是否已配置 + 尾号 4 位" */
const { parseRules, detectProtocol, normalizeRules } = require('../adapters');
function modelJSON(m) {
  const rules = parseRules(m);
  return {
    ...m, api_key: undefined, has_api_key: !!m.api_key, api_key_tail: m.api_key ? m.api_key.slice(-4) : '',
    rules, protocol: detectProtocol(m), effective_rules: normalizeRules(m)
  };
}

/* 校验并规范化规则 JSON:非法或非对象时抛 400 */
function normalizeRulesInput(raw) {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && raw.trim() === '') return '';
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { throw httpError(400, '生成规则不是合法的 JSON:' + e.message); } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw httpError(400, '生成规则必须是 JSON 对象');
  /* 第二十五轮:并入生图协议(openai-image / gemini-image / img-ffmpeg) */
  const known = ['agnes-flash', 'agnes-v2', 'openai-video', 'ffmpeg', 'openai-image', 'gemini-image', 'img-ffmpeg'];
  if (v.protocol && !known.includes(v.protocol)) throw httpError(400, '未知的生成协议: ' + v.protocol + '(可选:' + known.join('/') + ')');
  return JSON.stringify(v);
}

/* 第二十六轮:生图模型能力勾选(t2i / i2i / 多图合成)→ rules.caps 规范化。
 * caps 为空数组时从 rules 中剔除(视为「仅文生图」默认能力) */
const IMAGE_CAPS = ['text-to-image', 'image-to-image', 'multi-image'];
function mergeImageCaps(rulesRaw, capsRaw) {
  let rules = {};
  const normalized = normalizeRulesInput(rulesRaw);
  if (normalized) { try { rules = JSON.parse(normalized); } catch (e) { rules = {}; } }
  if (capsRaw === undefined) return rules;
  const arr = Array.isArray(capsRaw) ? capsRaw.map(x => String(x || '').trim()).filter(Boolean) : [];
  const caps = IMAGE_CAPS.filter(c => arr.includes(c));
  if (caps.length) rules.caps = caps;
  else delete rules.caps;
  return rules;
}

/* 规范化 API 地址(去掉尾斜杠),Key 与模型 ID 截断 */
function normalizeApiConfig(b = {}) {
  const out = {};
  if (b.api_base !== undefined) {
    let base = String(b.api_base || '').trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    out.api_base = base.slice(0, 300);
  }
  if (b.model_id !== undefined) out.model_id = String(b.model_id || '').trim().slice(0, 120);
  /* api_key 仅在传了非空字符串时更新;'-' 表示清除 */
  if (typeof b.api_key === 'string') {
    const k = b.api_key.trim();
    out.api_key = k === '-' ? '' : k.slice(0, 200);
  }
  return out;
}

/* ---------- 调用 OpenAI 兼容 /models 端点,拉取可用模型列表 ---------- */
async function detectAvailableModels({ apiBase, apiKey, timeoutMs = 12000 } = {}) {
  let base = String(apiBase || '').trim().replace(/\/+$/, '');
  if (!base) throw httpError(400, '请先填写 API 地址');
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  let url;
  try { url = new URL(base); } catch (e) { throw httpError(400, 'API 地址不是有效 URL'); }
  if (!/\/v\d+$/.test(url.pathname) && !url.pathname.endsWith('/models')) {
    url.pathname = (url.pathname.replace(/\/+$/, '')).replace(/\/+$/, '') + '/v1/models';
  } else if (!url.pathname.endsWith('/models')) {
    url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
  }
  const headers = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw httpError(502, '无法连接 API 地址(' + (e.name === 'TimeoutError' ? '请求超时' : '网络错误') + '),请检查地址与网络');
  }
  if (!res.ok) {
    const detail = res.status === 401 || res.status === 403
      ? '鉴权失败(HTTP ' + res.status + '),请检查 API Key'
      : '服务返回 HTTP ' + res.status;
    throw httpError(400, '检测失败:' + detail);
  }
  let data;
  try { data = await res.json(); }
  catch (e) { throw httpError(400, '检测失败:响应不是合法 JSON,请确认这是 OpenAI 兼容接口'); }
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (Array.isArray(data.data)) list = data.data;
  else if (Array.isArray(data.models)) list = data.models;
  const ids = list.map(x => typeof x === 'string' ? x : (x && (x.id || x.name || x.model))).filter(Boolean).map(String);
  return [...new Set(ids)].sort();
}

// ---------- 概览统计 ----------
r.get('/stats', asyncRoute(async (req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const assets = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
  const storage = db.prepare('SELECT COALESCE(SUM(size),0) s FROM assets').get().s;
  const tasks = db.prepare('SELECT status, COUNT(*) c FROM tasks GROUP BY status').all();
  const byStatus = {}; tasks.forEach(t => byStatus[t.status] = t.c);
  const models = db.prepare('SELECT COUNT(*) c FROM models WHERE enabled=1').get().c;
  const styles = db.prepare('SELECT COUNT(*) c FROM styles').get().c;
  res.json({ stats: { users, assets, storage, models, styles, tasks: byStatus, running: running.size } });
}));

// ---------- 用户管理 ----------
r.get('/users', asyncRoute(async (req, res) => {
  const { q, role } = req.query;
  const params = [];
  let sql = 'SELECT * FROM users';
  const where = [];
  if (q) { where.push('(email LIKE ? OR name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  if (role) { where.push('role=?'); params.push(role); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  res.json({ items: db.prepare(sql).all(...params).map(userJSON) });
}));

r.patch('/users/:id', asyncRoute(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw httpError(404, '用户不存在');
  if (u.id === req.user.id && (req.body.banned || req.body.role === 'user')) throw httpError(400, '不能对自己执行该操作');
  const b = req.body || {};
  if (b.banned !== undefined) db.prepare('UPDATE users SET banned=? WHERE id=?').run(b.banned ? 1 : 0, u.id);
  if (b.role !== undefined) db.prepare("UPDATE users SET role=? WHERE id=? AND role!='admin'").run(b.role === 'admin' ? 'admin' : 'user', u.id);
  if (b.storage_quota !== undefined) db.prepare('UPDATE users SET storage_quota=? WHERE id=?').run(clamp(Number(b.storage_quota), 0, 1e14, u.storage_quota), u.id);
  res.json({ user: userJSON(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
}));

// ---------- 任务监控 ----------
r.get('/tasks', asyncRoute(async (req, res) => {
  const { status, q } = req.query;
  const params = [];
  const from = 'FROM tasks t JOIN users u ON u.id=t.user_id LEFT JOIN models m ON m.id=t.model_id';
  const where = [];
  if (status && status !== 'all') { where.push('t.status=?'); params.push(status); }
  if (q) {
    where.push('(t.id LIKE ? OR u.email LIKE ? OR u.name LIKE ? OR m.name LIKE ? OR t.prompt LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like, like, like, like);
  }
  const cond = where.length ? ' WHERE ' + where.join(' AND ') : '';
  /* 清单只取最近 200 条，但统计必须按全量算：
     此前卡片显示的是「最近 200 条里已完成多少个」，任务一多就永远卡在 200，等于没信息 */
  const rows = db.prepare(`SELECT t.*, u.email AS user_email, u.name AS user_name, m.name AS model_name ${from}${cond} ORDER BY t.created_at DESC LIMIT 200`)
    .all(...params).map(t => ({ ...t, params: JSON.parse(t.params || '{}') }));
  const counts = {};
  db.prepare(`SELECT t.status AS s, COUNT(*) AS c ${from}${cond} GROUP BY t.status`)
    .all(...params).forEach(g => { counts[g.s] = g.c; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({ items: rows, running: running.size, counts, total });
}));

r.post('/tasks/:id/cancel', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t) throw httpError(404, '任务不存在');
  if (!['queued', 'processing'].includes(t.status)) throw httpError(400, '任务状态不允许取消');
  db.prepare("UPDATE tasks SET status='cancelled', finished_at=?, progress=0 WHERE id=?").run(now(), t.id);
  res.json({ ok: true });
}));

r.post('/tasks/:id/retry', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t) throw httpError(404, '任务不存在');
  if (!['failed', 'cancelled'].includes(t.status)) throw httpError(400, '只有失败或已取消的任务可以重试');
  db.prepare("UPDATE tasks SET status='queued', progress=0, error=NULL, started_at=NULL, finished_at=NULL WHERE id=?").run(t.id);
  enqueue(t.id);
  pump();
  res.json({ ok: true });
}));

// ---------- 模型管理 ----------
/* 填入 API 地址 + Key 后检测可用模型列表(OpenAI 兼容 GET /v1/models)
   编辑已保存的模型时可传 use_saved_key+id 复用库里的 Key(无需重新粘贴) */
/* 可用适配器列表(前端「生成协议」下拉) */
r.get('/models/adapters', asyncRoute(async (req, res) => {
  const { listAdapters } = require('../adapters');
  res.json({ items: listAdapters() });
}));

r.post('/models/detect', asyncRoute(async (req, res) => {
  const b = req.body || {};
  let apiKey = typeof b.api_key === 'string' ? b.api_key.trim() : '';
  if (!apiKey && b.use_saved_key && b.id) {
    const m = db.prepare('SELECT * FROM models WHERE id=?').get(String(b.id));
    if (!m) throw httpError(404, '模型不存在');
    apiKey = m.api_key || '';
    if (!apiKey) throw httpError(400, '该模型尚未保存 API Key,请填写后再检测');
  }
  const items = await detectAvailableModels({ apiBase: b.api_base, apiKey });
  res.json({ ok: true, count: items.length, items, message: '检测到 ' + items.length + ' 个可用模型' });
}));

r.post('/models', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw httpError(400, '模型名称不能为空');
  const api = normalizeApiConfig(b);
  /* 第二十五轮:生图模型默认参数模板(尺寸/种子)与视频模型不同 */
  const isImageModel = b.type === 'text-to-image';
  /* 第二十六轮:生图模型能力勾选(text-to-image / image-to-image / multi-image)
     mergeImageCaps 会把 caps 并入 rules,并把 limits.max_count 写入规则 */
  let rules = isImageModel
    ? JSON.stringify(mergeImageCaps(b.rules, b.caps))
    : normalizeRulesInput(b.rules);
  if (isImageModel) {
    /* 张数上限也允许从 rules JSON 覆盖,这里只在 body 显式给 max_count 时写入 */
    const maxCount = Number(b.max_count);
    if (Number.isFinite(maxCount) && maxCount >= 1) {
      const robj = JSON.parse(rules || '{}');
      robj.limits = Object.assign({}, robj.limits, { max_count: Math.min(4, Math.round(maxCount)) });
      rules = JSON.stringify(robj);
    }
  }
  const id = uid('m-');
  /* 模型每秒积分消耗(0/留空 = 跟随系统设置里的全局定价) */
  const creditPerSecond = Math.max(0, Number(b.credit_per_second) || 0);
  /* 第二十三轮:新建模型未提供参数模板时补默认标准参数,
     避免空 schema 导致任务参数(时长/帧率等)读不到、积分按默认 5s 误计 */
  const schemaProvided = Array.isArray(b.params_schema) && b.params_schema.length > 0;
  const effSchema = schemaProvided ? b.params_schema : (isImageModel ? [
    { key: 'size', label: '尺寸', type: 'select', options: ['1024x1024', '1536x1024', '1024x1536', 'auto'], default: '1024x1024' },
    { key: 'seed', label: '随机种子(-1 随机)', type: 'number', default: -1 }
  ] : [
    { key: 'duration', label: '时长(秒)', type: 'range', min: 1, max: 20, step: 1, default: 5 },
    { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 24 },
    { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'seed', label: '随机种子(-1 随机)', type: 'number', default: -1 }
  ]);
  const typeVal = isImageModel ? 'text-to-image' : (b.type === 'text-to-video' ? 'text-to-video' : 'image-to-video');
  db.prepare(`INSERT INTO models(id,name,type,version,description,endpoint,params_schema,enabled,concurrency,api_base,api_key,model_id,rules,credit_per_second,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, typeVal,
      String(b.version || 'v1').slice(0, 20), String(b.description || '').slice(0, 500), String(b.endpoint || '').slice(0, 200),
      JSON.stringify(effSchema), b.enabled === false ? 0 : 1, clamp(Number(b.concurrency) || 1, 1, 64, 1),
      api.api_base || '', api.api_key || '', api.model_id || '', rules || '', creditPerSecond, now());
  res.json({ model: modelJSON(db.prepare('SELECT * FROM models WHERE id=?').get(id)) });
}));

r.patch('/models/:id', asyncRoute(async (req, res) => {
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(req.params.id);
  if (!m) throw httpError(404, '模型不存在');
  const b = req.body || {};
  const sets = [], params = [];
  if (b.name !== undefined) { sets.push('name=?'); params.push(String(b.name).trim().slice(0, 80)); }
  if (b.version !== undefined) { sets.push('version=?'); params.push(String(b.version).slice(0, 20)); }
  if (b.description !== undefined) { sets.push('description=?'); params.push(String(b.description).slice(0, 500)); }
  if (b.endpoint !== undefined) { sets.push('endpoint=?'); params.push(String(b.endpoint).slice(0, 200)); }
  if (b.type !== undefined) { sets.push('type=?'); params.push(b.type === 'text-to-image' ? 'text-to-image' : (b.type === 'text-to-video' ? 'text-to-video' : 'image-to-video')); }
  if (b.enabled !== undefined) { sets.push('enabled=?'); params.push(b.enabled ? 1 : 0); }
  if (b.concurrency !== undefined) { sets.push('concurrency=?'); params.push(clamp(Number(b.concurrency) || 1, 1, 64, 1)); }
  if (b.params_schema !== undefined) { sets.push('params_schema=?'); params.push(JSON.stringify(b.params_schema || [])); }
  /* 模型每秒积分消耗:>=0,0 表示使用全局定价;免费模型恒不扣分 */
  if (b.credit_per_second !== undefined) {
    const cps = Math.max(0, Number(b.credit_per_second) || 0);
    sets.push('credit_per_second=?'); params.push(Math.round(cps * 100) / 100);
  }
  /* 第二十六轮:生图模型能力勾选编辑(仅对生图模型生效;与 rules JSON 同步合并) */
  if (b.caps !== undefined && (m.type === 'text-to-image' || b.type === 'text-to-image')) {
    const effType = b.type !== undefined ? b.type : m.type;
    if (effType === 'text-to-image') {
      const merged = mergeImageCaps(b.rules, b.caps);
      let rulesStr = JSON.stringify(merged);
      const maxCount = Number(b.max_count);
      if (Number.isFinite(maxCount) && maxCount >= 1) {
        merged.limits = Object.assign({}, merged.limits, { max_count: Math.min(4, Math.round(maxCount)) });
        rulesStr = JSON.stringify(merged);
      }
      sets.push('rules=?'); params.push(rulesStr);
    } else {
      const rules = normalizeRulesInput(b.rules);
      if (rules !== undefined) { sets.push('rules=?'); params.push(rules); }
    }
  } else {
    const rules = normalizeRulesInput(b.rules);
    if (rules !== undefined) { sets.push('rules=?'); params.push(rules); }
  }
  Object.assign(b, normalizeApiConfig(b));
  for (const k of ['api_base', 'api_key', 'model_id']) {
    if (b[k] !== undefined) { sets.push(k + '=?'); params.push(String(b[k] || '')); }
  }
  if (sets.length) { params.push(m.id); db.prepare(`UPDATE models SET ${sets.join(',')} WHERE id=?`).run(...params); }
  res.json({ model: modelJSON(db.prepare('SELECT * FROM models WHERE id=?').get(m.id)) });
}));

r.delete('/models/:id', asyncRoute(async (req, res) => {
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(req.params.id);
  if (!m) throw httpError(404, '模型不存在');
  const styles = db.prepare('SELECT COUNT(*) c FROM styles WHERE model_id=?').get(m.id).c;
  if (styles > 0) throw httpError(400, `该模型被 ${styles} 个风格引用,请先移除引用`);
  db.prepare('DELETE FROM models WHERE id=?').run(m.id);
  res.json({ ok: true });
}));

/* ---------- 创建路径探活 ----------
   对 openai-video 通用协议的网关,用"无效模型名 + 极短提示词"探测创建路径:
   - 404 纯文本(路由不存在)→ 换下一个候选;全部 404 → 判定失败并给出建议
   - 400/422(参数校验)或 OpenAI 风格业务错误 → 路由存在,判定通过
   - 明确的"not supported"类应答 → 判定失败并注明需服务商开通 */
const PROBE_CREATE_PATHS = ['/videos', '/videos/generations', '/video/generations'];
async function probeCreatePath(m, nr) {
  const base = String(m.api_base || '').replace(/[/]+$/, '');
  const userPath = (() => { try { const u = JSON.parse(m.rules || '{}'); return u.create && u.create.path ? String(u.create.path) : ''; } catch (e) { return ''; } })();
  const candidates = userPath ? [userPath] : [...new Set([String((nr.create && nr.create.path) || '/videos'), ...PROBE_CREATE_PATHS].map(p => p.replace(/^\/?/, '/')))];
  const payload = { model: '__route_probe__', prompt: 'route probe(not a real request)', seconds: '1' };
  const tried = [];
  for (const p of candidates) {
    let res;
    try {
      res = await fetch(base + p, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + m.api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000)
      });
    } catch (e) {
      tried.push(p + ' → 网络错误(' + (e.name === 'TimeoutError' ? '超时' : e.message) + ')');
      continue;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    const rawDetail = data && data.error != null ? (typeof data.error === 'object' ? (data.error.message ?? data.error) : data.error) : (data && data.detail != null ? data.detail : null);
    const detail = String(rawDetail || '').slice(0, 140) || text.slice(0, 140);
    if (res.ok) {
      return { problem: '', note: '创建路径 ' + p + ' 探活通过(HTTP ' + res.status + ')' };
    }
    if (res.status === 404 && !data) {
      tried.push(p + ' → 404 路由不存在');
      continue; /* 路由不存在 → 换下一候选 */
    }
    if (/videos? api is not supported|not supported for this platform/i.test(detail)) {
      return { problem: '服务商未开放视频 API(网关应答: ' + detail + '),该模型无法通过 API 生成,请联系服务商开通或改用其他模型', note: '' };
    }
    /* 业务层应答(模型不存在/参数校验等)= 路由存在 */
    return { problem: '', note: '创建路径 ' + p + ' 探活通过(网关应答业务校验: ' + detail + ')' };
  }
  return {
    problem: '视频创建路径不可用(已探测 ' + tried.join(' | ') + ')——网关未开放 OpenAI 兼容视频创建接口,提交生成必失败',
    note: ''
  };
}

/* ---------- 模型有效性检查 ----------
   校验参数 schema / 端点格式 / 本地渲染管线(ffmpeg 试渲一帧) */
async function runModelCheck(m) {
  const problems = [];
  let schema = [];
  try {
    schema = JSON.parse(m.params_schema || '[]');
    if (!Array.isArray(schema)) throw new Error('not array');
    for (const def of schema) {
      if (!def || !def.key || !def.type) throw new Error('缺少 key/type');
      /* 单一取值的参数是合法声明(如 cogvideox-flash 只支持 5s):允许 max === min,只禁反向区间 */
      if (def.type === 'range' && Number(def.max) < Number(def.min)) {
        problems.push(`参数 ${def.key}: max 不能小于 min(只支持单一取值时让 max 等于 min 即可)`);
      }
    }
  } catch (e) { problems.push('params_schema 不是合法的 JSON 数组'); }
  /* 第二十五轮:text-to-image(AI 生图)并入合法模型类型 */
  if (!['image-to-video', 'text-to-video', 'text-to-image'].includes(m.type)) problems.push(`未知模型类型: ${m.type}`);
  /* 检验生成规则(rules):视频模型走 adapters,生图模型走 imagegen */
  try {
    const isImage = m.type === 'text-to-image';
    const { normalizeRules } = require(isImage ? '../imagegen' : '../adapters');
    const nr = normalizeRules(m);
    if (!nr.protocol) problems.push('生成规则未指定协议,将自动识别');
    const known = isImage
      ? ['openai-image', 'gemini-image', 'img-ffmpeg']
      : ['agnes-flash', 'agnes-v2', 'openai-video', 'ffmpeg'];
    if (nr.protocol && !known.includes(nr.protocol)) problems.push('生成规则协议未知: ' + nr.protocol);
  } catch (e) { problems.push('生成规则解析失败: ' + (e.message || e)); }
  const ep = String(m.endpoint || '');
  if (ep && !/^(gpu|api|local):\/\//.test(ep)) problems.push('推理端点需以 gpu:// api:// local:// 开头');
  if (/^api:\/\//.test(ep)) {
    try { const u = new URL(ep.slice(6)); if (!u.host) throw new Error('no host'); }
    catch (e) { problems.push('api:// 端点不是有效 URL'); }
  }
  /* API 模型(api_base + api_key):实际请求 /v1/models 验证地址与密钥 */
  let apiNote = '';
  if (m.api_base && m.api_key) {
    try {
      const ids = await detectAvailableModels({ apiBase: m.api_base, apiKey: m.api_key, timeoutMs: 8000 });
      if (!ids.length) {
        if (m.model_id && !problems.some(p => p.includes(m.model_id))) apiNote = 'API 连接成功,但服务未返回模型列表';
        else problems.push('API 连接成功,但服务未返回可用模型');
      } else {
        apiNote = 'API 可用,共 ' + ids.length + ' 个模型' + (m.model_id ? (ids.includes(m.model_id) ? ',目标模型 ' + m.model_id + ' 在列表中' : ',⚠ 目标模型 ' + m.model_id + ' 不在列表中') : '');
        if (m.model_id && !ids.includes(m.model_id)) problems.push('模型 ID ' + m.model_id + ' 不在该 API 的可用列表中');
      }
    } catch (e) {
      const status404 = /HTTP 40[45]/.test(e.message || '');
      /* 部分视频网关(如 Agnes)不提供 /models 列表端点:404/405 时降级为提示而非失败 */
      if (status404 && m.model_id && m.api_key) {
        apiNote = '该网关未提供模型列表端点,已跳过列表校验(目标模型 ' + m.model_id + ')';
      } else {
        const msg = e.status ? e.message : 'API 地址无法访问(' + (e.message || '网络错误') + '),已跳过连通性验证';
        if (e.status) problems.push(msg); else apiNote = msg;
      }
    }
    /* 创建路径探活(仅 openai-video 通用协议):检查阶段即发现"网关不支持视频 API/路径不对",
       避免"检查通过但提交生成必失败"——探测请求用无效模型名,不会产生真实任务 */
    try {
      const { normalizeRules: nr2, detectProtocol: dp, parseRules: pr2 } = require('../adapters');
      if (dp(m) === 'openai-video') {
        const probe = await probeCreatePath(m, nr2(m));
        if (probe.problem) problems.push(probe.problem);
        if (probe.note) apiNote = apiNote ? apiNote + ' · ' + probe.note : probe.note;
      }
    } catch (e) { /* 探活自身异常不影响检查结论 */ }
  } else if (m.api_base || m.api_key) {
    apiNote = '提示:API 地址与 API Key 都填写后才能检测可用模型';
  }
  // 本地/gpu 模型走 ffmpeg 渲染管线 → 实际试渲一段 24 帧视频验证可用
  if (m.type === 'image-to-video' && !/^api:\/\//.test(ep)) {
    try {
      const { FFMPEG } = require('../ffmpeg');
      const tmp = path.join(DATA_DIR, 'tmp', `check-${uid('m')}.mp4`);
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      await require('../ffmpeg').run(['-y', '-f', 'lavfi', '-i', 'gradients=s=256x144:d=0.4',
        '-vf', 'format=yuv420p', '-frames:v', '10', tmp], { timeout: 30000 });
      fs.unlinkSync(tmp);
    } catch (e) {
      problems.push('本地渲染管线不可用(ffmpeg 试渲失败)');
    }
  }
  /* 第二十五轮:生图模型(img-ffmpeg 本地占位协议)→ 实际试渲一张 PNG 验证可用 */
  if (m.type === 'text-to-image' && !m.api_base) {
    try {
      const imagegen = require('../imagegen');
      const tmp = path.join(DATA_DIR, 'tmp', 'imgcheck-' + uid('m'));
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      const files = await imagegen.run(m, {
        task: { prompt: '模型有效性检查' }, params: { size: '512x512' },
        prompt: '模型有效性检查', negativePrompt: '', count: 1, refAsset: null, outBase: tmp,
        onProgress: () => {}
      });
      for (const f of (files || [])) { try { fs.unlinkSync(f); } catch (e) {} }
      if (!files || !files.length) problems.push('本地生图引擎未产出图片');
    } catch (e) {
      problems.push('本地生图引擎不可用(' + (e.message || e) + ')');
    }
  }
  let message = problems.length ? problems.join(';') : '检查通过:配置有效,渲染管线正常';
  if (apiNote) message += ' · ' + apiNote;
  return { ok: problems.length === 0, message: message.slice(0, 480) };
}

r.post('/models/:id/check', asyncRoute(async (req, res) => {
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(req.params.id);
  if (!m) throw httpError(404, '模型不存在');
  const result = await runModelCheck(m);
  db.prepare('UPDATE models SET check_status=?, check_message=?, checked_at=? WHERE id=?')
    .run(result.ok ? 'ok' : 'fail', result.message.slice(0, 500), now(), m.id);
  res.json({ ...result, model: modelJSON(db.prepare('SELECT * FROM models WHERE id=?').get(m.id)) });
}));

/* 自检参数一律取自模型自己的 params_schema 默认值:
   写死 2s/24fps 会让「只支持 5 秒」(cogvideox-flash)或 2–30s(百炼)的模型直接被网关判非法参数 */
function selftestParams(m) {
  let schema = [];
  try { schema = JSON.parse(m.params_schema || '[]'); } catch (e) { schema = []; }
  if (!Array.isArray(schema)) schema = [];
  const p = { motion: 0.3, seed: -1, selftest: true };
  for (const def of schema) {
    if (!def || !def.key) continue;
    if (def.type === 'range' || def.type === 'number') {
      const v = Number(def.default != null ? def.default : def.min);
      if (Number.isFinite(v)) p[def.key] = v;
    } else if (def.type === 'select' && Array.isArray(def.options) && def.options.length) {
      p[def.key] = def.options.some(o => String(o) === String(def.default)) ? def.default : def.options[0];
    }
  }
  if (p.duration == null) p.duration = 5;
  if (p.fps == null) p.fps = 24;
  return p;
}

/* 免费模型端到端自检:按模型参数默认值真实提交一条测试任务走完整队列 */
r.post('/models/:id/selftest', asyncRoute(async (req, res) => {
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(req.params.id);
  if (!m) throw httpError(404, '模型不存在');
  // 先做有效性检查
  const check = await runModelCheck(m);
  db.prepare('UPDATE models SET check_status=?, check_message=?, checked_at=? WHERE id=?')
    .run(check.ok ? 'ok' : 'fail', check.message.slice(0, 500), now(), m.id);
  if (!check.ok) throw httpError(400, '模型检查未通过:' + check.message);

  /* 第二十五轮:生图模型自检 → 提交 text-to-image 任务(无需源图) */
  if (m.type === 'text-to-image') {
    const taskId = uid('t-');
    db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,source_asset_id,params,prompt,negative_prompt,status,progress,cost,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`)
      .run(taskId, req.user.id, 'text-to-image', m.id, null,
        JSON.stringify({ size: '1024x1024', count: 1, selftest: true }),
        '[系统自检] AI 生图连通性测试:一颗金色星辰在午夜海面上升起,电影感光影', '', 'queued', 0, now());
    enqueue(taskId);
    pump();
    return res.json({
      check,
      task: db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId),
      message: `自检任务已提交(${m.name} · 生图),请在任务监控中查看进度`
    });
  }

  // 用 lavfi 生成一张测试源图入资产库(admin 名下)
  const { FFMPEG, probe } = require('../ffmpeg');
  const { ensureDir } = require('../util');
  const imgId = uid('a-');
  const dir = path.join(DATA_DIR, 'uploads', req.user.id);
  ensureDir(dir);
  const imgPath = path.join(dir, `${imgId}.png`);
  await require('../ffmpeg').run(['-y', '-f', 'lavfi', '-i', 'gradients=s=640x360:d=1', '-frames:v', '1', imgPath], { timeout: 30000 });
  const info = probe(imgPath);
  db.prepare(`INSERT INTO assets(id,owner_id,type,name,size,mime,path,width,height,tags,source,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(imgId, req.user.id, 'image', `自检测试图_${new Date().toISOString().slice(11, 19)}.png`,
      fs.statSync(imgPath).size, 'image/png', imgPath, info.width, info.height,
      JSON.stringify(['system-selftest']), 'system', now());

  // 提交真实任务(免费模型不扣积分)
  const taskId = uid('t-');
  const stParams = selftestParams(m);
  db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,source_asset_id,params,prompt,negative_prompt,status,progress,cost,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`)
    .run(taskId, req.user.id, 'image-to-video', m.id, imgId,
      JSON.stringify(stParams),
      '[系统自检] 免费模型连通性测试:镜头缓慢推近,渐变色卡,验证渲染管线', '', 'queued', 0, now());
  enqueue(taskId);
  pump();
  res.json({
    check,
    task: db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId),
    message: `自检任务已提交(${m.name}),请在任务监控中查看进度`
  });
}));

/* ---------- 积分审批 ---------- */
r.get('/credit-requests', asyncRoute(async (req, res) => {
  const { status } = req.query;
  let sql = `SELECT cr.*, u.email AS user_email, u.name AS user_name FROM credit_requests cr JOIN users u ON u.id=cr.user_id`;
  const params = [];
  if (status && status !== 'all') { sql += ' WHERE cr.status=?'; params.push(status); }
  sql += ' ORDER BY cr.created_at DESC LIMIT 100';
  res.json({ items: db.prepare(sql).all(...params), pricing: credits.pricing() });
}));

r.post('/credit-requests/:id/approve', asyncRoute(async (req, res) => {
  const cr = db.prepare('SELECT * FROM credit_requests WHERE id=?').get(req.params.id);
  if (!cr) throw httpError(404, '申请不存在');
  if (cr.status !== 'pending') throw httpError(400, '该申请已处理过');
  credits.grant(cr.user_id, cr.amount, `管理员批准积分申请 +${cr.amount}`);
  db.prepare("UPDATE credit_requests SET status='approved', handled_at=?, handled_by=? WHERE id=?").run(now(), req.user.id, cr.id);
  res.json({ ok: true });
}));

r.post('/credit-requests/:id/reject', asyncRoute(async (req, res) => {
  const cr = db.prepare('SELECT * FROM credit_requests WHERE id=?').get(req.params.id);
  if (!cr) throw httpError(404, '申请不存在');
  if (cr.status !== 'pending') throw httpError(400, '该申请已处理过');
  db.prepare("UPDATE credit_requests SET status='rejected', handled_at=?, handled_by=? WHERE id=?").run(now(), req.user.id, cr.id);
  res.json({ ok: true });
}));

/* 管理员直接调整某用户积分 */
r.post('/users/:id/credits', asyncRoute(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) throw httpError(404, '用户不存在');
  const delta = Math.round(Number(req.body.delta));
  if (!delta) throw httpError(400, '调整数量不能为 0');
  credits.grant(u.id, delta, req.body.reason ? String(req.body.reason).slice(0, 200) : '管理员手动调整');
  res.json({ ok: true, balance: credits.getBalance(u.id) });
}));

// ---------- 系统设置 ----------
r.get('/settings', asyncRoute(async (req, res) => {
  res.json({ settings: getSettings() });
}));

r.patch('/settings', asyncRoute(async (req, res) => {
  const b = req.body || {};
  /* 第二十五轮:creditPerImage = AI 生图每张积分定价(免费生图模型恒 0) */
  const allowed = ['maxConcurrentTasks', 'defaultQuotaGB', 'gpuPool', 'maxUploadMB', 'creditPerSecond', 'freeCredits', 'creditPerImage'];
  for (const k of allowed) {
    if (b[k] !== undefined) setSetting(k, k === 'gpuPool' ? String(b[k]).slice(0, 300) : Number(b[k]));
  }
  /* 段时长积分覆盖表: { "5": 25, ... } */
  if (b.creditOverrides !== undefined && b.creditOverrides && typeof b.creditOverrides === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(b.creditOverrides)) {
      const dur = parseInt(k, 10);
      const pts = Math.max(0, Math.round(Number(v)));
      if (dur > 0 && Number.isFinite(pts)) clean[String(dur)] = pts;
    }
    setSetting('creditOverrides', clean);
  }
  /* 生成视频尺寸白名单(480p/720p/960p/2k):至少保留一项,顺序按固定档位排列 */
  if (b.videoResolutions !== undefined) {
    const KNOWN = ['480p', '720p', '960p', '2k'];
    const list = (Array.isArray(b.videoResolutions) ? b.videoResolutions : [])
      .map(x => String(x).trim().toLowerCase()).filter(x => KNOWN.includes(x));
    const uniq = [...new Set(list)].sort((a, z) => KNOWN.indexOf(a) - KNOWN.indexOf(z));
    if (!uniq.length) throw httpError(400, '生成尺寸至少勾选一项(480p/720p/960p/2k)');
    setSetting('videoResolutions', uniq);
  }
  res.json({ settings: getSettings() });
}));


// ---------- 主题管理:导入 / 导出 / 应用 / 删除 ----------
const THEME_DIR = path.join(__dirname, '..', '..', 'theme');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

/* 主题 ID 白名单:仅允许字母数字与 - _ ,防止路径穿越 */
function safeThemeId(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  if (!safe) throw httpError(400, '主题 ID 不合法(仅允许字母/数字/-/_)');
  return safe;
}

function themeDirSize(dir) {
  let size = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) size += fs.statSync(p).size;
    }
  } catch (e) { /* 忽略 */ }
  return size;
}

function readThemeManifest(dir) {
  const mf = path.join(dir, 'theme.json');
  if (!fs.existsSync(mf)) return null;
  try { return JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { return null; }
}

function listThemes() {
  const out = [];
  if (!fs.existsSync(THEME_DIR)) return out;
  for (const id of fs.readdirSync(THEME_DIR)) {
    const dir = path.join(THEME_DIR, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const m = readThemeManifest(dir);
    /* 提取预览色:供主题卡片展示色板 */
    const tokens = (m && m.tokens) || {};
    const colors = tokens.colors || {};
    out.push({
      id,
      name: (m && m.name) || id,
      description: (m && m.description) || '',
      version: (m && m.version) || '1.0.0',
      type: (m && m.type) || 'dark',
      hasCss: fs.existsSync(path.join(dir, 'app.css')),
      hasLayout: fs.existsSync(path.join(dir, 'layout.html')),
      created: (m && m.created) || null,
      size: themeDirSize(dir),
      colors: {
        accent: colors.accent || '#ffcf4d',
        accent2: colors.accent2 || '#3ddc84',
        bg: colors.bg || '#000000',
        bgSoft: colors.bgSoft || '#0c0c10',
        text: colors.text || '#ffffff'
      }
    });
  }
  return out;
}

function getActiveTheme() {
  return getSettings().activeTheme || 'black-gold';
}

/* CSS 变量映射:theme.json 令牌路径 -> CSS 变量名 */
const CSS_VAR_MAP = {
  'colors.bg': '--bg', 'colors.bgDeep': '--bg-deep', 'colors.bgSoft': '--bg-soft',
  'colors.panel': '--panel', 'colors.panel2': '--panel-2', 'colors.panel3': '--panel-3',
  'colors.border': '--border', 'colors.borderSoft': '--border-soft', 'colors.borderGold': '--border-gold',
  'colors.text': '--text', 'colors.textDim': '--text-dim', 'colors.textFaint': '--text-faint',
  'colors.accent': '--accent', 'colors.accent2': '--accent-2', 'colors.accent3': '--accent-3',
  'colors.ok': '--ok', 'colors.warn': '--warn', 'colors.danger': '--danger',
  'radius.base': '--radius', 'radius.small': '--radius-sm',
  'font.family': '--font', 'font.mono': '--mono',
  'shadow': '--shadow'
};

/* 用令牌覆盖基础 CSS 的 :root 变量块,其余样式保持不变 */
function generateCssFromTokens(baseCss, tokens) {
  if (!tokens || !Object.keys(tokens).length) return baseCss;
  const flat = {};
  (function walk(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue;
      const key = prefix ? prefix + '.' + k : k;
      if (typeof v === 'object' && !Array.isArray(v)) walk(v, key);
      else flat[key] = String(v);
    }
  })(tokens, '');

  const start = baseCss.indexOf(':root {');
  const end = baseCss.indexOf('}', start);
  if (start < 0 || end < 0) return baseCss;

  let rootBlock = baseCss.slice(start, end + 1);
  for (const [tokenKey, val] of Object.entries(flat)) {
    const cssVar = CSS_VAR_MAP[tokenKey];
    if (!cssVar) continue;
    const re = new RegExp('(' + cssVar.replace(/-/g, '\\-') + '\\s*:\\s*)[^;]+(;)');
    if (re.test(rootBlock)) rootBlock = rootBlock.replace(re, '$1' + val + '$2');
  }
  return baseCss.slice(0, start) + rootBlock + baseCss.slice(end + 1);
}

/* 主题列表 */
r.get('/themes', asyncRoute(async (req, res) => {
  res.json({ themes: listThemes(), active: getActiveTheme() });
}));

/* 导出当前页面样式+布局为主题(备份) */
r.post('/themes/export', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const id = safeThemeId(b.id || 'theme-' + Date.now());
  const dir = path.join(THEME_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const cssSrc = path.join(PUBLIC_DIR, 'css', 'app.css');
  const htmlSrc = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(cssSrc)) fs.copyFileSync(cssSrc, path.join(dir, 'app.css'));
  if (fs.existsSync(htmlSrc)) fs.copyFileSync(htmlSrc, path.join(dir, 'layout.html'));

  const existing = readThemeManifest(dir) || {};
  const manifest = {
    id,
    name: String(b.name || existing.name || id).slice(0, 60),
    description: String(b.description || existing.description || '').slice(0, 200),
    version: existing.version || '1.0.0',
    author: existing.author || 'VideoForge Studio',
    created: existing.created || new Date().toISOString().split('T')[0],
    type: existing.type || 'dark',
    layout: 'layout.html',
    stylesheet: 'app.css',
    tokens: existing.tokens || {},
    components: existing.components || {},
    stars: existing.stars || {}
  };
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  setSetting('activeTheme', id);
  res.json({ ok: true, id, theme: listThemes().find(t => t.id === id) });
}));

/* 应用主题:把主题包内的样式+布局复制到 public/ */
r.post('/themes/:id/apply', asyncRoute(async (req, res) => {
  const id = safeThemeId(req.params.id);
  const dir = path.join(THEME_DIR, id);
  if (!fs.existsSync(dir)) throw httpError(404, '主题不存在');
  const applied = [];
  if (fs.existsSync(path.join(dir, 'app.css'))) {
    fs.copyFileSync(path.join(dir, 'app.css'), path.join(PUBLIC_DIR, 'css', 'app.css'));
    applied.push('app.css');
  }
  if (fs.existsSync(path.join(dir, 'layout.html'))) {
    fs.copyFileSync(path.join(dir, 'layout.html'), path.join(PUBLIC_DIR, 'index.html'));
    applied.push('index.html');
  }
  if (!applied.length) throw httpError(400, '主题包为空,没有可应用的文件');
  setSetting('activeTheme', id);
  res.json({ ok: true, id, applied });
}));

/* 导入主题:由 JSON 令牌生成新主题(基于某基础主题的 CSS 派生) */
r.post('/themes/import', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const id = safeThemeId(b.id || 'theme-' + Date.now());
  const dir = path.join(THEME_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  /* 基础 CSS:优先取 baseTheme 主题包,否则用当前线上 CSS */
  let baseCss = '';
  const baseTheme = String(b.baseTheme || 'black-gold');
  const baseDir = path.join(THEME_DIR, baseTheme);
  const baseCssFile = path.join(baseDir, 'app.css');
  if (fs.existsSync(baseCssFile)) baseCss = fs.readFileSync(baseCssFile, 'utf8');
  else if (fs.existsSync(path.join(PUBLIC_DIR, 'css', 'app.css'))) baseCss = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
  if (baseCss) {
    const generated = generateCssFromTokens(baseCss, b.tokens || {});
    fs.writeFileSync(path.join(dir, 'app.css'), generated, 'utf8');
  }

  /* 布局:默认沿用当前布局,允许覆盖 */
  if (typeof b.layout === 'string' && b.layout.trim()) {
    fs.writeFileSync(path.join(dir, 'layout.html'), b.layout, 'utf8');
  } else if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
    fs.copyFileSync(path.join(PUBLIC_DIR, 'index.html'), path.join(dir, 'layout.html'));
  }

  const manifest = {
    id,
    name: String(b.name || id).slice(0, 60),
    description: String(b.description || '').slice(0, 200),
    version: '1.0.0',
    author: String(b.author || 'Admin').slice(0, 60),
    created: new Date().toISOString().split('T')[0],
    type: b.type === 'light' ? 'light' : 'dark',
    layout: 'layout.html',
    stylesheet: 'app.css',
    tokens: b.tokens || {},
    components: b.components || {},
    stars: b.stars || {}
  };
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  res.json({ ok: true, id });
}));


/* 从主题清单内容解析主题 ID(失败返回 '') */
function manifestThemeId(raw) {
  try {
    const m = JSON.parse(raw);
    if (m && typeof m.id === 'string') return safeThemeId(m.id);
  } catch (e) { /* 忽略 */ }
  return '';
}

/* 上传外部主题包:支持 .zip 主题包(内含 theme.json/app.css/layout.html),
   或分别上传 css / layout / manifest 三个文件 */
const themeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 主题包最大 20MB
});
r.post('/themes/upload', themeUpload.fields([
  { name: 'zip', maxCount: 1 },
  { name: 'css', maxCount: 1 },
  { name: 'layout', maxCount: 1 },
  { name: 'manifest', maxCount: 1 }
]), asyncRoute(async (req, res) => {
  const files = req.files || {};
  const zip = (files.zip || [])[0];
  const css = (files.css || [])[0];
  const layout = (files.layout || [])[0];
  const manifestFile = (files.manifest || [])[0];

  if (!zip && !css && !layout && !manifestFile) throw httpError(400, '请上传主题包(.zip)或 app.css / layout.html / theme.json 文件');

  /* 解析目标主题 ID:表单字段 → 单独上传的清单 → (zip 场景在解压后再按 清单 → 压缩包名) */
  let id = '';
  if (req.body && req.body.id) id = safeThemeId(req.body.id);
  if (!id && manifestFile) id = manifestThemeId(manifestFile.buffer.toString('utf8'));
  const zipBase = zip ? path.basename(zip.originalname || '').replace(/\.zip$/i, '') : '';

  const tmpDir = ensureDir(path.join(THEME_DIR, '.tmp-' + uid()));
  try {
    if (zip) {
      /* 解压 zip 到临时目录 */
      const zipPath = path.join(tmpDir, 'theme.zip');
      fs.writeFileSync(zipPath, zip.buffer);
      await new Promise((resolve, reject) => {
        execFile('/usr/bin/unzip', ['-o', '-q', zipPath, '-d', path.join(tmpDir, 'extract')], (err) => err ? reject(httpError(400, '主题包解压失败(仅支持 .zip):' + (err.message || ''))) : resolve());
      });
      /* 在解压目录中寻找主题文件(支持根目录或单层子目录) */
      const searchDirs = [];
      const extractRoot = path.join(tmpDir, 'extract');
      if (fs.existsSync(extractRoot)) {
        searchDirs.push(extractRoot);
        for (const d of fs.readdirSync(extractRoot)) {
          const sub = path.join(extractRoot, d);
          if (fs.statSync(sub).isDirectory()) searchDirs.push(sub);
        }
      }
      const found = { manifest: null, css: null, layout: null };
      for (const dir of searchDirs) {
        if (!found.manifest && fs.existsSync(path.join(dir, 'theme.json'))) found.manifest = path.join(dir, 'theme.json');
        if (!found.css && fs.existsSync(path.join(dir, 'app.css'))) found.css = path.join(dir, 'app.css');
        if (!found.layout && fs.existsSync(path.join(dir, 'layout.html'))) found.layout = path.join(dir, 'layout.html');
      }
      if (!found.manifest && !found.css && !found.layout) throw httpError(400, '压缩包内未找到 theme.json / app.css / layout.html');
      /* 表单字段未指定时:优先取清单 id,其次压缩包名,最后自动生成 */
      if (!id && found.manifest) id = manifestThemeId(fs.readFileSync(found.manifest, 'utf8'));
      if (!id && zipBase) id = safeThemeId(zipBase);
      if (!id) id = safeThemeId('theme-' + Date.now());
      const dir = path.join(THEME_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      if (found.manifest) fs.copyFileSync(found.manifest, path.join(dir, 'theme.json'));
      if (found.css) fs.copyFileSync(found.css, path.join(dir, 'app.css'));
      if (found.layout) fs.copyFileSync(found.layout, path.join(dir, 'layout.html'));
      /* 复制可选 assets 目录 */
      for (const sdir of searchDirs) {
        const assetsSrc = path.join(sdir, 'assets');
        if (fs.existsSync(assetsSrc)) {
          const assetsDst = path.join(dir, 'assets');
          fs.mkdirSync(assetsDst, { recursive: true });
          for (const f of fs.readdirSync(assetsSrc)) {
            const p = path.join(assetsSrc, f);
            if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(assetsDst, f));
          }
        }
      }
      id = safeThemeId(id);
    } else {
      /* 分别上传文件 */
      if (!id) id = safeThemeId('theme-' + Date.now());
      const dir = path.join(THEME_DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      if (css) fs.writeFileSync(path.join(dir, 'app.css'), css.buffer);
      if (layout) fs.writeFileSync(path.join(dir, 'layout.html'), layout.buffer);
      if (manifestFile) fs.writeFileSync(path.join(dir, 'theme.json'), manifestFile.buffer);
    }

    /* 校验:至少有一个文件,且 theme.json 必须是合法 JSON */
    const dir = path.join(THEME_DIR, id);
    const hasCss = fs.existsSync(path.join(dir, 'app.css'));
    const hasLayout = fs.existsSync(path.join(dir, 'layout.html'));
    const hasManifest = fs.existsSync(path.join(dir, 'theme.json'));
    if (!hasCss && !hasLayout) throw httpError(400, '主题包缺少 app.css / layout.html,无法作为主题导入');
    if (hasManifest) {
      try { JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8')); }
      catch (e) { throw httpError(400, 'theme.json 不是合法 JSON:' + e.message); }
    } else {
      /* 生成缺省清单 */
      const manifest = {
        id, name: id, description: '外部导入主题', version: '1.0.0',
        author: 'Admin', created: new Date().toISOString().split('T')[0],
        type: 'dark', layout: 'layout.html', stylesheet: 'app.css',
        tokens: {}, components: {}, stars: {}
      };
      fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }
    res.json({ ok: true, id, hasCss, hasLayout });
  } finally {
    /* 清理临时目录 */
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}));

/* 删除主题 */
r.delete('/themes/:id', asyncRoute(async (req, res) => {
  const id = safeThemeId(req.params.id);
  if (id === 'black-gold') throw httpError(400, '内置默认主题不可删除');
  if (id === getActiveTheme()) throw httpError(400, '当前正在使用的主题不可删除,请先切换其他主题');
  const dir = path.join(THEME_DIR, id);
  if (!fs.existsSync(dir)) throw httpError(404, '主题不存在');
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
  res.json({ ok: true, id });
}));

module.exports = r;
