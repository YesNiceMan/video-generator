'use strict';
/* AI 生图 API(第二十五轮 · 二十三/1)
 * 提交生图任务:模型(text-to-image)+ 提示词(+可选参考图 → 图生图)+ 尺寸/张数;
 * 任务进入与视频共用同一队列(server/worker.js),结果图片自动存入资产库。
 * 取消 / 重试 / 删除 / 详情复用 /api/tasks 既有端点。 */
const { Router } = require('express');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now, clamp } = require('../util');
const { db, getSettings } = require('../db');
const { enqueue, pump } = require('../worker');
const credits = require('../credits');
const { parseRules, normalizeRules, modelCaps, sizeFromRatio, sizeToWH,
  snapTier, snapAspect, resolutionToPx, sizeModeOf, tiersOf, ratiosOf, imageSpecMeta } = require('../imagegen');

const r = Router();
r.use(requireAuth);

/* 生图单价(积分/张):免费模型 0;模型设置过积分消耗(credit_per_second 字段,生图模型即「每张价格」)优先用模型价;否则系统设置 creditPerImage(默认 2)(第二十七轮) */
function perImagePrice(model) {
  if (model && model.is_free) return 0;
  if (model) {
    const mp = Math.max(0, Number(model.credit_per_second) || 0);
    if (mp > 0) return Math.round(mp * 100) / 100;
  }
  const s = getSettings();
  return Math.max(0, Number(s.creditPerImage ?? 2));
}

/* 图片资产简要信息(给前端渲染缩略图) */
function assetBrief(id) {
  if (!id) return null;
  return db.prepare('SELECT id,type,name,thumb_path,width,height FROM assets WHERE id=?').get(id) || null;
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function taskJSON(t) {
  const ids = JSON.parse(t.result_asset_ids || '[]');
  return {
    ...t,
    params: JSON.parse(t.params || '{}'),
    result_asset_ids: ids,
    result_assets: ids.map(assetBrief).filter(Boolean)
  };
}

/* 模型尺寸白名单(模型 params_schema 定义了 size 选项时以其为准,否则用协议默认) */
function schemaSizeOptions(model) {
  try {
    const schema = JSON.parse(model.params_schema || '[]');
    const def = Array.isArray(schema) ? schema.find(d => d && d.key === 'size') : null;
    if (def && Array.isArray(def.options) && def.options.length) {
      return { options: def.options.map(String), default: def.default != null ? String(def.default) : null };
    }
  } catch (e) { /* schema 非法则走协议默认 */ }
  return null;
}

/* 分辨率档 × 画幅比例 → 具体尺寸。
   短边 = 分辨率档,长边按真实比例换算(此前非方形一律按 ×1.5,导致选 16:9 还是 4:3 出的图一样大),
   再取偶数并把长边压到 4096 以内。 */
function deriveSize(ratio, resolution) {
  let short = resolutionToPx(resolution) || 1024;
  short = Math.max(64, Math.min(4096, short));
  const m = /^([0-9.]+)\s*[:x/／]\s*([0-9.]+)$/.exec(String(ratio || '').trim());
  let rw = 1, rh = 1;
  if (m) {
    const a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (a > 0 && b > 0) { rw = a; rh = b; }
  }
  let w = rw >= rh ? short * rw / rh : short;
  let h = rw >= rh ? short : short * rh / rw;
  const over = Math.max(w, h) / 4096;
  if (over > 1) { w /= over; h /= over; }
  const even = v => Math.max(16, Math.round(v / 2) * 2);
  return even(w) + 'x' + even(h);
}

/* 尺寸表达形态 / 档位与画幅清单由 server/imagegen.js 的 imageSpecMeta 统一给出
   (模板含 <size> = 像素网关,否则 = 档位网关,如 Agnes images:size=1K/2K/4K + ratio=16:9) */

function orientOf(wh) { return wh.w === wh.h ? 'sq' : (wh.w > wh.h ? 'l' : 'p'); }

/* 在候选尺寸清单里就近吸附:先同方向(横/竖/方),再按面积就近;'auto' 等无法解析的项跳过 */
function snapSize(candidates, wantSize) {
  const wh = sizeToWH(wantSize);
  if (!wh) return (candidates && candidates.length ? candidates[0] : wantSize);
  const area = wh.w * wh.h;
  const parsed = (candidates || []).map(s => ({ s, wh: sizeToWH(s) })).filter(x => x.wh);
  if (!parsed.length) return wantSize;
  const sameOrient = parsed.filter(x => orientOf(x.wh) === orientOf(wh));
  const pool = sameOrient.length ? sameOrient : parsed;
  pool.sort((a, b) => Math.abs(a.wh.w * a.wh.h - area) - Math.abs(b.wh.w * b.wh.h - area));
  return pool[0].s;
}

/* 解析最终尺寸:
 * ① 旧路径:客户端显式给 size → 在 schema/协议清单内收敛;
 * ② 新路径:只给「画幅比例 + 分辨率档」→ 换算具体尺寸,再向模型支持的清单就近吸附;
 * ③ 档位网关(rules 模板用 <resolution> 而非 <size>)不吸附像素,换算值只用于展示与记录。 */
function resolveSize(model, wantSize, opts) {
  opts = opts || {};
  const rules = normalizeRules(model);
  const schemaSizes = schemaSizeOptions(model);
  if (wantSize) {
    let size = String(wantSize);
    if (schemaSizes) {
      if (!schemaSizes.options.some(o => o === size)) size = schemaSizes.default || schemaSizes.options[0];
      return size;
    }
    if (opts.pixelMode === false) return size;
    const sizes = rules.limits && Array.isArray(rules.limits.sizes) ? rules.limits.sizes : null;
    if (sizes && sizes.length && !sizes.includes(size)) return snapSize(sizes, size);
    return size;
  }
  const derived = deriveSize(opts.aspect_ratio, opts.resolution);
  if (opts.pixelMode === false) return derived;
  if (schemaSizes) return snapSize(schemaSizes.options, derived);
  const sizes = rules.limits && Array.isArray(rules.limits.sizes) ? rules.limits.sizes : null;
  if (sizes && sizes.length) return snapSize(sizes, derived);
  return derived;
}

/* 画幅比例:模型声明了清单(params_schema.ratio / rules.limits.aspect_ratios)时按清单就近吸附,
   未声明时原样返回(可能为空) */
function resolveRatioDef(model, wantRatio) {
  const list = ratiosOf(model);
  let ratio = String(wantRatio || '').trim();
  if (list && list.length) {
    if (!ratio || !list.some(x => String(x) === ratio)) ratio = snapAspect(ratio || list[0], list) || list[0];
  }
  return ratio;
}

/* 无显式比例时由最终尺寸反推(如 1536x1024 → 3:2) */
function ratioFromSize(size) {
  const wh = sizeToWH(size);
  if (!wh) return '';
  const g = gcd(wh.w, wh.h) || 1;
  return (wh.w / g) + ':' + (wh.h / g);
}

/* 提交生图任务 */
r.post('/generate', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const model = db.prepare('SELECT * FROM models WHERE id=?').get(String(b.model_id || ''));
  if (!model) throw httpError(400, '模型不存在');
  if (!model.enabled) throw httpError(400, '该模型已被禁用');
  if (model.type !== 'text-to-image') throw httpError(400, '该模型不是生图模型(text-to-image)');
  if (model.api_base && model.model_id && !model.api_key) {
    throw httpError(400, '「' + model.name + '」是在线生图模型,但管理员还未配置 API Key;请先选择其他模型或联系管理员');
  }
  const prompt = String(b.prompt || '').trim().slice(0, 2000);
  if (!prompt) throw httpError(400, '请输入生图提示词');
  const negativePrompt = String(b.negative_prompt || '').trim().slice(0, 2000);

  const rules = parseRules(model);
  const maxCount = Math.max(1, Math.min(Number(rules.limits && rules.limits.max_count) || 4, 4));
  const count = clamp(Number(b.count) || 1, 1, maxCount, 1);
  /* 解析顺序(需求 26·9:一切以模型规则为准,不预设某家网关的参数写法):
     ① 该网关的尺寸形态(模板含 <size> = 像素,否则 = 档位)
     ② 分辨率档按模型清单吸附 → ③ 画幅比例按模型清单吸附 → ④ 换算具体尺寸 */
  const sizeMode = sizeModeOf(model);
  const tiers = tiersOf(model);
  let resolution = String(b.resolution == null ? '' : b.resolution).trim();
  if (resolution || sizeMode === 'tier') {
    resolution = snapTier(resolution || (tiers && tiers[0]) || '1K', tiers || undefined);
  }
  let aspectRatio = resolveRatioDef(model, b.aspect_ratio);
  const size = resolveSize(model, b.size, {
    aspect_ratio: aspectRatio, resolution, pixelMode: sizeMode !== 'tier'
  });
  if (!aspectRatio) aspectRatio = ratioFromSize(size);

  /* 模型能力(第二十六轮):文生图 / 图生图 / 多图合成由后台勾选声明 */
  const caps = modelCaps(model);

  /* 参考图(图生图 / 多图合成):必须本人拥有或共享给我;按能力勾选把关 */
  let refIds = [];
  const reqRefs = Array.isArray(b.ref_asset_ids)
    ? b.ref_asset_ids.map(v => String(v || '').trim()).filter(Boolean)
    : (b.ref_asset_id ? [String(b.ref_asset_id)] : []);
  const seenRef = new Set();
  for (const rid of reqRefs.slice(0, 8)) {
    if (seenRef.has(rid)) continue;
    seenRef.add(rid);
    const a = db.prepare('SELECT * FROM assets WHERE id=?').get(rid);
    if (!a) throw httpError(404, '参考图不存在: ' + rid.slice(0, 12));
    if (a.owner_id !== req.user.id && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a.id, req.user.id)) {
      throw httpError(403, '无权使用参考图「' + (a.name || rid.slice(0, 12)) + '」');
    }
    if (a.type !== 'image') throw httpError(400, '参考图「' + (a.name || '') + '」不是图片资产');
    refIds.push(a.id);
  }
  if (refIds.length === 1 && !caps.includes('image-to-image')) {
    throw httpError(400, '「' + model.name + '」未开启图生图能力(后台模型管理中勾选)');
  }
  if (refIds.length > 1 && !caps.includes('multi-image')) {
    throw httpError(400, '「' + model.name + '」未开启多图合成能力,一次只能用 1 张参考图');
  }
  const refAssetId = refIds[0] || null;

  /* 风格(可选):模板 {subject} 占位 → 用户提示词;负面词回退风格默认 */
  let style = null;
  if (b.style_id) {
    const st = db.prepare('SELECT * FROM styles WHERE id=?').get(String(b.style_id));
    if (st && (st.visibility === 'public' || st.author_id === req.user.id || req.user.role === 'admin')) {
      style = st;
    }
  }
  let finalPrompt = prompt;
  if (style) {
    const tpl = String(style.prompt_template || '');
    if (tpl.trim()) {
      finalPrompt = tpl.indexOf('{subject}') >= 0
        ? tpl.split('{subject}').join(prompt)
        : prompt + ', ' + tpl;
    }
  }
  const finalNegative = negativePrompt || (style ? String(style.negative_prompt || '') : '');

  /* 项目归属校验(可选;供分镜工作台快速生图) */
  let projectId = b.project_id || null;
  if (projectId) {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
    if (!p) throw httpError(404, '目标项目不存在');
    const allowed = p.owner_id === req.user.id || req.user.role === 'admin'
      || db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(p.id, req.user.id);
    if (!allowed) throw httpError(403, '无权向该项目提交任务');
  }

  /* 积分:按张计价,免费模型不扣分;余额不足拒绝提交 */
  const perImage = perImagePrice(model);
  const cost = perImage * count;
  const id = uid('t-');
  if (cost > 0) {
    const reason = 'AI 生图 ×' + count + ' · ' + model.name;
    const ok = credits.deduct(req.user.id, cost, reason, id);
    if (!ok) {
      throw httpError(402, '积分不足:本次需 ' + cost + ' 积分(' + perImage + ' 分/张 × ' + count + ' 张),当前余额 ' + credits.getBalance(req.user.id));
    }
  }

  const params = { size, count, engine: 'imggen' };
  /* 记录「实际生效」的分辨率档(已按模型清单吸附)与该网关的尺寸形态,便于任务详情展示与排障 */
  if (resolution) params.resolution = resolution;
  params.size_mode = sizeMode;
  if (aspectRatio) params.aspect_ratio = aspectRatio;
  /* 种子 / 质量(第二十七轮):按参数模板校验后写入任务参数,worker 传给适配器 */
  try {
    const schema = JSON.parse(model.params_schema || '[]');
    const seedDef = Array.isArray(schema) ? schema.find(d => d && d.key === 'seed') : null;
    if (seedDef) {
      const ws = Number(b.seed);
      params.seed = Number.isFinite(ws) ? Math.trunc(ws) : (seedDef.default != null ? Number(seedDef.default) : -1);
    }
    const qDef = Array.isArray(schema) ? schema.find(d => d && d.key === 'quality') : null;
    if (qDef && Array.isArray(qDef.options) && b.quality && qDef.options.some(o => String(o) === String(b.quality))) {
      params.quality = String(b.quality);
    }
  } catch (e) { /* schema 非法则忽略种子/质量 */ }
  if (refIds.length) { params.ref_asset_ids = refIds; params.ref_count = refIds.length; }
  const SQL_INSERT = 'INSERT INTO tasks(id,user_id,type,model_id,style_id,source_asset_id,params,prompt,negative_prompt,status,progress,project_id,episode_id,cost,linked_asset_ids,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  db.prepare(SQL_INSERT)
    .run(id, req.user.id, 'text-to-image', model.id, style ? style.id : null, refAssetId,
      JSON.stringify(params), finalPrompt, finalNegative, 'queued', 0,
      projectId, b.episode_id || null, cost, '[]', now());
  enqueue(id);
  pump();
  res.json({
    task: taskJSON(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)),
    credits: { cost, balance: credits.getBalance(req.user.id), perImage }
  });
}));

/* 生图模型列表(仅启用;Key 不回传明文) */
r.get('/models', asyncRoute(async (req, res) => {
  const rows = db.prepare("SELECT * FROM models WHERE type='text-to-image' AND enabled=1 ORDER BY created_at").all()
    .map(m => ({
      ...m,
      params_schema: JSON.parse(m.params_schema || '[]'),
      rules: parseRules(m),
      /* protocol / caps / supported_sizes / size_mode / res_tiers / ratio_options
         —— 前端渲染比例与分辨率下拉的唯一依据 */
      ...imageSpecMeta(m),
      api_key: undefined, has_api_key: !!m.api_key, api_key_tail: m.api_key ? m.api_key.slice(-4) : '',
      price_per_image: perImagePrice(m) /* 第二十七轮:模型价优先,供前端费用提示 */
    }));
  res.json({ items: rows, perImage: perImagePrice(null) });
}));

/* 资产简要信息(生图完成后供分镜工作台快速把结果图加入参考资产) */
r.get('/assets/:id', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT id,type,name,thumb_path,width,height FROM assets WHERE id=?').get(String(req.params.id));
  if (!a) throw httpError(404, '资产不存在');
  const full = db.prepare('SELECT owner_id FROM assets WHERE id=?').get(a.id);
  if (full.owner_id !== req.user.id && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a.id, req.user.id)) {
    throw httpError(403, '无权访问该资产');
  }
  res.json({ asset: a });
}));

module.exports = r;

