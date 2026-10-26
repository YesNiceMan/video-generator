'use strict';
// 生成任务 API:提交图生视频任务、查询历史、取消、重试、重新生成
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now, clamp, ensureDir } = require('../util');
const { db, getSettings, DATA_DIR } = require('../db');
const { snapAspect, snapTier } = require('../imagegen');
const { enqueue, pump } = require('../worker');
const credits = require('../credits');

const r = Router();
r.use(requireAuth);

const TMP = path.join(DATA_DIR, 'tmp');
ensureDir(TMP);

/* 模型侧硬约束:画幅比例 / 分辨率按该模型声明的清单就近吸附
   (清单来源:params_schema 的 aspect_ratio/ratio 选项 + rules.limits.aspect_ratios /
    fixed_size / resolutions —— 新增网关只改后台规则,不改这段代码) */
function applyModelSpec(model, params) {
  if (!model || !params) return params;
  let rules = {}, schema = [];
  try { rules = JSON.parse(model.rules || '{}') || {}; } catch (e) { rules = {}; }
  try { schema = JSON.parse(model.params_schema || '[]') || []; } catch (e) { schema = []; }
  if (!rules || typeof rules !== 'object') rules = {};
  if (!Array.isArray(schema)) schema = [];
  const lim = rules.limits || {};
  const arDef = schema.find(d => d && (d.key === 'aspect_ratio' || d.key === 'ratio')
    && Array.isArray(d.options) && d.options.length);
  const arList = ((arDef ? arDef.options : (Array.isArray(lim.aspect_ratios) ? lim.aspect_ratios : [])) || [])
    .map(String).filter(Boolean);
  if (params.aspect_ratio && arList.length && !arList.includes(String(params.aspect_ratio))) {
    const snapped = snapAspect(String(params.aspect_ratio), arList);
    if (snapped) params.aspect_ratio = snapped;
  }
  const fixed = String(lim.fixed_size || '').trim();
  if (params.resolution) {
    if (fixed) {
      if (String(params.resolution).toUpperCase() !== fixed.toUpperCase()) params.resolution = fixed.toLowerCase();
    } else if (Array.isArray(lim.resolutions) && lim.resolutions.length) {
      const t = snapTier(String(params.resolution), lim.resolutions);
      if (t) params.resolution = t;
    }
  }
  return params;
}

const TYPE_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP),
  filename: (req, file, cb) => cb(null, uid('tmp-') + '.' + (TYPE_BY_MIME[file.mimetype] || 'bin'))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

function taskJSON(t) {
  const linkedIds = JSON.parse(t.linked_asset_ids || '[]');
  const linked = linkedIds
    .map(id => db.prepare('SELECT id,type,name,thumb_path FROM assets WHERE id=?').get(id))
    .filter(Boolean);
  /* 第二十五轮:生图任务的多图结果(result_asset_ids JSON 数组) */
  let resultAssets = [];
  try {
    resultAssets = JSON.parse(t.result_asset_ids || '[]')
      .map(id => db.prepare('SELECT id,type,name,thumb_path,width,height FROM assets WHERE id=?').get(id))
      .filter(Boolean);
  } catch (e) { resultAssets = []; }
  return { ...t, params: JSON.parse(t.params || '{}'), linked_asset_ids: linkedIds, linked_assets: linked, result_assets: resultAssets };
}

/* 校验占位符链接的资源(必须本人拥有或共享给我) */
function validateLinkedAssets(userId, ids) {
  const out = [];
  const seen = new Set();
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 20)) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const a = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
    if (!a) continue;
    if (a.owner_id !== userId && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a.id, userId)) continue;
    out.push(a.id);
  }
  return out;
}

// 提交任务:body {model_id, style_id?, params:{...}, prompt?, negative_prompt?, project_id?, episode_id?, use_asset_id?} 或 multipart 上传图片
r.post('/', upload.single('image'), asyncRoute(async (req, res) => {
  const b = req.body || {};
  const model = db.prepare('SELECT * FROM models WHERE id=?').get(b.model_id);
  if (!model) throw httpError(400, '模型不存在');
  if (!model.enabled) throw httpError(400, '该模型已被禁用');
  /* 在线 API 模型必须已配置 Key 才允许提交:保证引擎选择明确,
     避免用户以为在用 API 模型、实际却走了本地 ffmpeg(需求1) */
  if (model.api_base && model.model_id && !model.api_key) {
    throw httpError(400, '「' + model.name + '」是在线 API 模型,但管理员还未配置 API Key;请先选择其他模型或联系管理员');
  }
  if (model.type !== 'image-to-video') throw httpError(400, '该模型不是图生视频模型');

  let sourceAssetId = b.use_asset_id || null;
  if (req.file) {
    // 上传新图片作为源
    const { probe } = require('../ffmpeg');
    const info = probe(req.file.path);
    const id = uid('a-');
    const dir = path.join(DATA_DIR, 'uploads', req.user.id);
    ensureDir(dir);
    const finalPath = path.join(dir, id + '.' + (TYPE_BY_MIME[req.file.mimetype] || 'bin'));
    fs.renameSync(req.file.path, finalPath);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (user.storage_used + req.file.size > user.storage_quota) { fs.unlinkSync(finalPath); throw httpError(413, '存储配额不足'); }
    db.prepare(`INSERT INTO assets(id,owner_id,type,name,size,mime,path,width,height,duration,tags,source,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.user.id, 'image', req.file.originalname || '上传图片.jpg', req.file.size, req.file.mimetype, finalPath,
        info.width, info.height, info.duration, JSON.stringify(['i2v-source']), 'upload', now());
    db.prepare('UPDATE users SET storage_used=storage_used+? WHERE id=?').run(req.file.size, req.user.id);
    sourceAssetId = id;
  }
  if (!sourceAssetId) throw httpError(400, '请选择或上传源图片');
  const src = db.prepare('SELECT * FROM assets WHERE id=?').get(sourceAssetId);
  if (!src) throw httpError(404, '源图片不存在');
  if (src.owner_id !== req.user.id) {
    const sh = db.prepare('SELECT * FROM asset_shares WHERE asset_id=? AND user_id=?').get(src.id, req.user.id);
    if (!sh) throw httpError(403, '无权使用该图片');
  }

  const schema = JSON.parse(model.params_schema || '[]');
  const params = {};
  for (const def of schema) {
    let v = b['param_' + def.key] !== undefined ? b['param_' + def.key] : def.default;
    if (def.type === 'range' || def.type === 'number') params[def.key] = clamp(Number(v), def.min ?? -1e9, def.max ?? 1e9, def.default);
    else if (def.type === 'select') {
      const ok = def.options.some(o => String(o) === String(v));
      params[def.key] = ok ? (typeof def.options[0] === 'number' ? Number(v) : v) : def.default;
    }
  }
  /* 第二十三轮·标准参数兜底:「API 模型接入」快速添加的模型 params_schema 为空,
     此前 时长/帧率/运动/种子 会被整段丢弃 → 计分错误(显示 30 实扣 50)、
     生成不走用户设置的时长/帧率(设 5s 出 4s)。现对所有模型统一兜底读取标准参数:
    模型 schema 已定义的键仍以 schema 的范围校验为准,后续新增任意模型任务参数开箱可用 */
  const schemaKeys = new Set(schema.map(d => d && d.key));
  const STD_DEFS = [
    { key: 'duration', type: 'range', min: 1, max: 60, default: 5 },
    { key: 'fps', type: 'range', min: 1, max: 60, default: 24 },
    { key: 'motion', type: 'range', min: 0, max: 1, default: 0.5 },
    { key: 'seed', type: 'number', min: -1, max: 2147483647, default: -1 }
  ];
  for (const def of STD_DEFS) {
    if (schemaKeys.has(def.key)) continue;
    const v = b['param_' + def.key] !== undefined ? b['param_' + def.key] : def.default;
    params[def.key] = clamp(Number(v), def.min, def.max, def.default);
  }
  /* 额外参数:画幅比例 / 分辨率(前端分镜创作页设置,不依赖模型 params_schema)
     分辨率按后台「系统设置 → 生成视频尺寸」白名单校验,不在名单内回退到默认档 */
  if (b.param_aspect_ratio !== undefined) params['aspect_ratio'] = String(b.param_aspect_ratio);
  if (b.param_resolution !== undefined) {
    const resList = Array.isArray(getSettings().videoResolutions) && getSettings().videoResolutions.length
      ? getSettings().videoResolutions : ['480p', '720p', '960p', '2k'];
    const want = String(b.param_resolution);
    params['resolution'] = resList.includes(want) ? want : resList.includes('720p') ? '720p' : resList[0];
  }
  /* 模型侧硬约束(需求 26·9):画幅比例与分辨率最终以「该模型声明的清单」为准收敛 ——
     平台白名单只管到「允许选哪些」,网关只吃 720P 之类的模型自己写在 rules.limits 里,
     否则用户设了 2K 提交到固定 720P 的模型就会吃一个 HTTP 400。 */
  applyModelSpec(model, params);

  // 风格覆盖参数
  let style = null;
  if (b.style_id) {
    style = db.prepare('SELECT * FROM styles WHERE id=?').get(b.style_id);
    if (style && (style.visibility === 'public' || style.author_id === req.user.id || req.user.role === 'admin')) {
      Object.assign(params, JSON.parse(style.params || '{}'));
    } else style = null;
  }

  /* 提示词准确提交:用户显式输入(含空串)优先,未提供时才回退风格模板 */
  const prompt = b.prompt !== undefined && b.prompt !== null
    ? String(b.prompt).slice(0, 2000)
    : String(style?.prompt_template || '');

  // 项目归属校验
  let projectId = b.project_id || null;
  if (projectId) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!p) throw httpError(404, '目标项目不存在');
    const allowed = p.owner_id === req.user.id || req.user.role === 'admin'
      || db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(p.id, req.user.id);
    if (!allowed) throw httpError(403, '无权向该项目提交任务');
  }

  // 占位符链接的资源
  const linkedIds = validateLinkedAssets(req.user.id, b.linked_asset_ids);

  /* 积分:按段时长计价,免费模型不扣分;余额不足拒绝提交 */
  const cost = credits.computeCost(params.duration || 5, model);
  const id = uid('t-');
  if (cost > 0) {
    const ok = credits.deduct(req.user.id, cost, `视频生成 ${params.duration || 5}s × ${model.name}`, id);
    if (!ok) throw httpError(402, `积分不足:本次需 ${cost} 积分,当前余额 ${credits.getBalance(req.user.id)},可申请积分或选择免费模型`);
  }
  db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,style_id,source_asset_id,params,prompt,negative_prompt,status,progress,project_id,episode_id,cost,linked_asset_ids,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, 'image-to-video', model.id, style ? style.id : null, sourceAssetId,
      JSON.stringify(params), prompt,
      String(b.negative_prompt !== undefined && b.negative_prompt !== null ? b.negative_prompt : (style?.negative_prompt || '')).slice(0, 2000),
      'queued', 0, projectId, b.episode_id || null, cost, JSON.stringify(linkedIds), now());
  enqueue(id);
  pump();
  res.json({
    task: taskJSON(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)),
    credits: { cost, balance: credits.getBalance(req.user.id) }
  });
}));

// 任务列表(含源图与结果图信息)
r.get('/', asyncRoute(async (req, res) => {
  const { status, project_id, episode_id } = req.query;
  const params = [req.user.id];
  let sql = 'SELECT * FROM tasks WHERE user_id=?';
  if (status && status !== 'all') { sql += ' AND status=?'; params.push(status); }
  if (project_id) { sql += ' AND project_id=?'; params.push(project_id); }
  if (episode_id) { sql += ' AND episode_id=?'; params.push(episode_id); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params).map(taskJSON);
  const withMedia = rows.map(t => {
    const src = t.source_asset_id ? db.prepare('SELECT id,type,name,path,thumb_path,width,height FROM assets WHERE id=?').get(t.source_asset_id) : null;
    const resA = t.result_asset_id ? db.prepare('SELECT id,type,name,path,thumb_path,width,height,duration FROM assets WHERE id=?').get(t.result_asset_id) : null;
    return { ...t, source: src, result: resA };
  });
  res.json({ items: withMedia });
}));

r.get('/:id', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) throw httpError(404, '任务不存在');
  res.json({ task: taskJSON(t) });
}));

r.post('/:id/cancel', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) throw httpError(404, '任务不存在');
  if (!['queued', 'processing'].includes(t.status)) throw httpError(400, '只有进行中或排队中的任务可以取消');
  db.prepare("UPDATE tasks SET status='cancelled', finished_at=?, progress=0 WHERE id=?").run(now(), t.id);
  const refunded = credits.refundTask(t.id, '任务取消');
  res.json({ ok: true, refunded });
}));

r.post('/:id/retry', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) throw httpError(404, '任务不存在');
  if (!['failed', 'cancelled'].includes(t.status)) throw httpError(400, '只有失败或已取消的任务可以重试');
  /* 已退还过积分的任务重试时重新扣减 */
  if (t.cost > 0 && t.refunded) {
    const ok = credits.deduct(req.user.id, t.cost, `重试任务 #${t.id.slice(0, 8)} 积分`, t.id);
    if (!ok) throw httpError(402, `积分不足:重试需 ${t.cost} 积分`);
    db.prepare('UPDATE tasks SET refunded=0 WHERE id=?').run(t.id);
  }
  db.prepare("UPDATE tasks SET status='queued', progress=0, error=NULL, started_at=NULL, finished_at=NULL WHERE id=?").run(t.id);
  enqueue(t.id);
  pump();
  res.json({ ok: true });
}));

/* 删除任务记录(仅已完成/失败/已取消;进行中需先取消)
   只删任务记录本身,生成的视频资产仍保留在资产库中不受影响 */
r.delete('/:id', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t || (t.user_id !== req.user.id && req.user.role !== 'admin')) throw httpError(404, '任务不存在');
  if (['queued', 'processing'].includes(t.status)) throw httpError(400, '任务进行中,请先取消再删除记录');
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
  db.prepare('DELETE FROM notifications WHERE task_id=?').run(t.id);
  res.json({ ok: true });
}));

// 以相同参数重新生成(新任务,重新计价扣分)
r.post('/:id/regenerate', asyncRoute(async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t || t.user_id !== req.user.id) throw httpError(404, '任务不存在');
  const model = db.prepare('SELECT * FROM models WHERE id=?').get(t.model_id);
  if (!model || !model.enabled) throw httpError(400, '原模型不可用');
  if (!model.is_free && t.cost > 0 && t.refunded === 0) {
    /* 原任务未退还过积分(已成功),重新生成按新任务计价 */
  }
  const params = JSON.parse(t.params || '{}');
  const cost = credits.computeCost(params.duration || 5, model);
  const id = uid('t-');
  if (cost > 0) {
    const ok = credits.deduct(t.user_id, cost, `重新生成 ${params.duration || 5}s × ${model.name}`, id);
    if (!ok) throw httpError(402, `积分不足:本次需 ${cost} 积分`);
  }
  db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,style_id,source_asset_id,params,prompt,negative_prompt,status,progress,project_id,episode_id,cost,linked_asset_ids,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, t.user_id, t.type, t.model_id, t.style_id, t.source_asset_id, t.params, t.prompt, t.negative_prompt,
      'queued', 0, t.project_id, t.episode_id, cost, t.linked_asset_ids || '[]', now());
  enqueue(id);
  pump();
  res.json({ task: taskJSON(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)) });
}));

module.exports = r;
