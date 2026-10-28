'use strict';
/* 短剧工作流 API(第五十轮 · 需求三十)
 * 一部剧 = dramas 一行 + 若干设定卡(drama_entities) + 若干分镜(drama_shots);
 * 画风矩阵是全局共享的 prompt_presets,按「画风 × 槽位」读。
 * 分析在 server/drama.js 里独立跑批(不占媒体任务队列),这里只做校验、读写与下发。
 * 下发写的是标准 tasks 行,所以取消/重试/删除/后台监控全部复用 /api/tasks 既有能力。 */
const { Router } = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now, clamp } = require('../util');
const { db, getSettings, DATA_DIR } = require('../db');
const credits = require('../credits');
const textgen = require('../textgen');
const drama = require('../drama');
const doc = require('../docparse');
const storage = require('../storage');
const { enqueue, pump } = require('../worker');
const { normalizeRules, sizeModeOf, tiersOf, ratiosOf, snapTier, snapAspect, deriveSize, sizeToWH, snapSize, modelCaps } = require('../imagegen');

const r = Router();
r.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { const dir = path.join(DATA_DIR, 'tmp'); fs.mkdirSync(dir, { recursive: true }); cb(null, dir); },
    filename: (req, file, cb) => cb(null, 'drama-' + uid() + '.bin')
  }),
  limit: { fileSize: 32 * 1024 * 1024 }
});

/* ---------- 权限与序列化 ---------- */
function assertAccess(req, id) {
  const d = db.prepare('SELECT * FROM dramas WHERE id=?').get(id);
  if (!d) throw httpError(404, '短剧工作流不存在');
  if (d.owner_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, '无权访问这部剧');
  return d;
}
function dramaBrief(d, extra) {
  const out = Object.assign({}, d, extra || {});
  try { out.stats = JSON.parse(d.stats || '{}'); } catch (e) { out.stats = {}; }
  try { out.done_episodes = JSON.parse(d.done_episodes || '[]'); } catch (e) { out.done_episodes = []; }
  out.script_chars = String(d.script || '').length;
  /* 列表接口不带 6 万字正文;详情靠 extra 显式带出来 */
  if (!(extra && 'script' in extra)) delete out.script;
  return out;
}
function entityJSON(e, refCounts) {
  return Object.assign({}, e, {
    asset: e.asset_id ? storage.assetBrief(db.prepare('SELECT id,type,name,thumb_path,width,height FROM assets WHERE id=?').get(e.asset_id)) : null,
    /* 这张卡被多少个分镜引用(角色按 char_refs、场景按 scene_ref)—— 比显示字数有用得多 */
    ref_count: refCounts ? (refCounts[e.name] || 0) : undefined
  });
}
/* 参考图上限:按当前生图模型的能力算,前端据此决定「挂参考图」能不能点 */
function imageRefCap(d) {
  const id = d.image_model_id || (db.prepare("SELECT id FROM models WHERE type='text-to-image' AND enabled=1 ORDER BY is_free DESC, created_at").get() || {}).id || '';
  const m = id ? db.prepare('SELECT * FROM models WHERE id=?').get(id) : null;
  if (!m) return 0;
  const caps = modelCaps(m);
  return caps.includes('multi-image') ? 4 : (caps.includes('image-to-image') ? 1 : 0);
}
/* ---------- 出片规格(第五十轮补) ----------
   剧级一套,单镜可覆盖时长 / 帧率 / 视频分辨率;比例与图片分辨率始终跟随剧级 ——
   同一部剧里横竖画幅混着来,导出拼接时会直接失败。 */
const SPEC_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
const SPEC_IMAGE_TIERS = ['1K', '2K', '4K'];
const SPEC_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 60];
function videoResolutionList() {
  const list = getSettings().videoResolutions;
  return Array.isArray(list) && list.length ? list.map(String) : ['480p', '720p', '960p', '2k'];
}
function normSpec(b, base) {
  const out = Object.assign({}, base || {});
  if (b.aspect_ratio !== undefined) {
    const v = String(b.aspect_ratio || '').trim();
    if (!SPEC_RATIOS.includes(v)) throw httpError(400, '画幅比例只能是:' + SPEC_RATIOS.join(' / '));
    out.aspect_ratio = v;
  }
  if (b.image_resolution !== undefined) {
    const v = String(b.image_resolution || '').trim().toUpperCase();
    if (!SPEC_IMAGE_TIERS.includes(v)) throw httpError(400, '图片分辨率档只能是:' + SPEC_IMAGE_TIERS.join(' / '));
    out.image_resolution = v;
  }
  if (b.video_resolution !== undefined) {
    const v = String(b.video_resolution || '').trim();
    const list = videoResolutionList();
    const hit = list.find(x => x.toLowerCase() === v.toLowerCase());
    if (!hit) throw httpError(400, '视频分辨率只能是:' + list.join(' / '));
    out.video_resolution = hit;
  }
  if (b.fps !== undefined) {
    const v = Number(b.fps);
    if (!SPEC_FPS.includes(v)) throw httpError(400, '帧率只能是:' + SPEC_FPS.join(' / '));
    out.fps = v;
  }
  if (b.shot_duration !== undefined) {
    const v = Number(b.shot_duration);
    if (!Number.isFinite(v) || v < 3 || v > 25) throw httpError(400, '单镜时长取 3~25 秒');
    out.shot_duration = v;
  }
  return out;
}

function shotJSON(s) {
  const parse = v => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  const refIds = parse(s.ref_asset_ids);
  return Object.assign({}, s, {
    char_refs: parse(s.char_refs),
    ref_asset_ids: refIds,
    ref_exclude_ids: parse(s.ref_exclude_ids),
    ref_assets: assetsBrief(refIds),
    image_asset_ids: parse(s.image_asset_ids),
    video_asset_ids: parse(s.video_asset_ids),
    image_assets: assetsBrief(parse(s.image_asset_ids)),
    video_assets: assetsBrief(parse(s.video_asset_ids))
  });
}

function ownImageRef(req, id) {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(String(id));
  if (!a || a.type !== 'image') return false;
  return a.owner_id === req.user.id || !!db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a.id, req.user.id);
}

/* 展示用的一镜:锚点按当前关联现算(挂了人/图立刻反映在提示词里) */
function presentShot(d, row, cap) {
  const j = shotJSON(row);
  const refs = effectiveRefs(d, row, cap);
  j.effective_refs = refs;
  j.ref_cap = cap;
  /* 正文给人编辑,锚点单独给一份(下发时自动附在末尾)—— 两处都显示就重复了 */
  j.video_prompt = drama.stripAnchors(row.video_prompt);
  j.video_anchors = drama.shotAnchors(row, refs);
  return j;
}

/* 这一镜「实际会带上的参考图」:手动 + 场景卡定稿图 + 本镜角色定稿图 − 被单独摘掉的,
   按「场景 → 角色 → 手动」的可读顺序返回来源,前端直接渲染缩略图。 */
function effectiveRefs(d, shot, maxRefs) {
  if (!maxRefs) return [];
  const parse = v => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  const excluded = new Set(parse(shot.ref_exclude_ids));
  const brief = id => storage.assetBrief(db.prepare('SELECT id,type,name,thumb_path,width,height FROM assets WHERE id=?').get(String(id)));
  const out = [];
  const push = (id, source, label) => {
    if (!id || excluded.has(String(id)) || out.some(x => x.id === String(id))) return;
    const a = brief(id);
    if (!a || a.type !== 'image') return;
    out.push({ id: String(id), source, label: label || a.name || '', asset: a });
  };
  if (Number(shot.use_cast_refs) !== 0) {
    const sc = shot.scene_ref ? db.prepare("SELECT name, asset_id FROM drama_entities WHERE drama_id=? AND kind='scene' AND name=?").get(d.id, shot.scene_ref) : null;
    if (sc) push(sc.asset_id, 'scene', sc.name);
    for (const n of parse(shot.char_refs)) {
      const e = db.prepare("SELECT name, asset_id FROM drama_entities WHERE drama_id=? AND kind='character' AND name=?").get(d.id, String(n));
      if (e) push(e.asset_id, 'character', e.name);
    }
  }
  for (const id of parse(shot.ref_asset_ids)) push(id, 'manual');
  return out.slice(0, maxRefs);
}
function assetsBrief(ids) {
  const out = [];
  for (const id of (ids || []).slice(0, 8)) {
    const a = storage.assetBrief(db.prepare('SELECT id,type,name,thumb_path,width,height,duration FROM assets WHERE id=?').get(String(id)));
    if (a) out.push(a);
  }
  return out;
}

/* ---------- 选项(模型 / 画风 / 样例目录) ---------- */
r.get('/options', asyncRoute(async (req, res) => {
  const texts = db.prepare("SELECT id,name,model_id,api_base,is_free,enabled,api_key,rules,credit_per_second FROM models WHERE type='text-generation' AND enabled=1 ORDER BY created_at").all();
  const images = db.prepare("SELECT * FROM models WHERE type='text-to-image' AND enabled=1 ORDER BY created_at").all();
  const videos = db.prepare("SELECT * FROM models WHERE type='image-to-video' AND enabled=1 ORDER BY created_at").all();
  const styles = db.prepare("SELECT style_name, COUNT(*) AS c, SUM(enabled) AS on_count, MAX(region) AS region FROM prompt_presets GROUP BY style_name ORDER BY MIN(sort_index)").all();
  const wd = drama.workflowDir();
  res.json({
    textModels: texts.map(m => ({
      id: m.id, name: m.name, model_id: m.model_id, is_free: m.is_free, has_key: !!m.api_key,
      price_per_call: textgen.pricePerCall(m), max_chars: (textgen.normalizeRules(m).limits || {}).max_chars || 20000
    })),
    imageModels: images.map(m => ({
      id: m.id, name: m.name, is_free: m.is_free, has_key: !!m.api_key || !(m.api_base && m.model_id),
      price_per_image: credits.imagePrice(m),
      ratio_options: ratiosOf(m) || [], res_tiers: tiersOf(m) || [], protocol: normalizeRules(m).protocol,
      /* 参考图上限由能力决定:多图合成 4 张、图生图 1 张、纯文生图 0 张 —— 分镜挂参考图时按它挡 */
      max_refs: modelCaps(m).includes('multi-image') ? 4 : (modelCaps(m).includes('image-to-image') ? 1 : 0)
    })),
    videoModels: videos.map(m => ({
      id: m.id, name: m.name, is_free: m.is_free, has_key: !!m.api_key || !(m.api_base && m.model_id),
      max_duration: Number((JSON.parse(m.rules || '{}').limits || {}).max_duration) || 0
    })),
    specOptions: {
      ratios: SPEC_RATIOS, imageTiers: SPEC_IMAGE_TIERS, videoResolutions: videoResolutionList(), fps: SPEC_FPS
    },
    defaultTextModel: String(getSettings().defaultTextModel || ''),
    /* 剧没绑定模型时服务端会退到「免费优先的第一个可用」—— 把这个默认回给前端,页面上说的模型才是真会用的模型 */
    defaults: {
      image: (db.prepare("SELECT id FROM models WHERE type='text-to-image' AND enabled=1 ORDER BY is_free DESC, created_at").get() || {}).id || '',
      video: (db.prepare("SELECT id FROM models WHERE type='image-to-video' AND enabled=1 ORDER BY is_free DESC, created_at").get() || {}).id || ''
    },
    styles: styles.map(s => ({ name: s.style_name, rows: s.c, enabled: Number(s.on || 0), region: s.region || '' })),
    regions: Object.values(drama.REGIONS).map(r => ({ key: r.key, label: r.label })),
    slots: drama.SLOTS,
    /* 参考数据目录不在版本库里(assets/ 被 gitignore),没有就只提示路径,不报错 */
    sampleDir: { path: wd, exists: fs.existsSync(wd), files: fs.existsSync(wd) ? fs.readdirSync(wd).filter(f => !f.startsWith('.')) : [] },
    credits: credits.getBalance(req.user.id)
  });
}));

/* ---------- 画风矩阵 ---------- */
function presetJSON(p) { return p; }
r.get('/presets', asyncRoute(async (req, res) => {
  const rows = db.prepare('SELECT * FROM prompt_presets ORDER BY sort_index, slot').all();
  const byStyle = {};
  for (const p of rows) { (byStyle[p.style_name] = byStyle[p.style_name] || []).push(presetJSON(p)); }
  res.json({ items: rows.map(presetJSON), byStyle, slots: drama.SLOTS });
}));

r.post('/presets', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const style = String(b.style_name || '').trim().slice(0, 60);
  const slot = String(b.slot || '').trim();
  if (!style) throw httpError(400, '请填写画风名');
  if (!drama.SLOTS.includes(slot)) throw httpError(400, '槽位只能是:' + drama.SLOTS.join(' / '));
  const sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM prompt_presets').get().m) + 1;
  const id = uid('pm-');
  const region = String(b.region || '').trim();
  if (region && !drama.REGIONS[region]) throw httpError(400, '地域只能是:' + Object.keys(drama.REGIONS).join(' / '));
  db.prepare(`INSERT INTO prompt_presets(id,style_name,slot,region,content,negative,note,enabled,is_system,sort_index,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,0,?,?,?)`)
    .run(id, style, slot, region, String(b.content || '').slice(0, 20000), String(b.negative || '').slice(0, 4000),
      String(b.note || '').slice(0, 200), b.enabled === 0 ? 0 : 1, sort, now(), now());
  res.json({ preset: db.prepare('SELECT * FROM prompt_presets WHERE id=?').get(id) });
}));

r.patch('/presets/:id', asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM prompt_presets WHERE id=?').get(req.params.id);
  if (!p) throw httpError(404, '提示词不存在');
  const b = req.body || {};
  const next = {
    style_name: b.style_name != null ? String(b.style_name).trim().slice(0, 60) : p.style_name,
    slot: b.slot != null ? String(b.slot) : p.slot,
    content: b.content != null ? String(b.content).slice(0, 20000) : p.content,
    negative: b.negative != null ? String(b.negative).slice(0, 4000) : p.negative,
    note: b.note != null ? String(b.note).slice(0, 200) : p.note,
    enabled: b.enabled != null ? (b.enabled ? 1 : 0) : p.enabled,
    region: b.region != null ? String(b.region).trim() : (p.region || '')
  };
  if (!next.style_name) throw httpError(400, '画风名不能为空');
  if (!drama.SLOTS.includes(next.slot)) throw httpError(400, '槽位只能是:' + drama.SLOTS.join(' / '));
  if (next.region && !drama.REGIONS[next.region]) throw httpError(400, '地域只能是:' + Object.keys(drama.REGIONS).join(' / '));
  db.prepare('UPDATE prompt_presets SET style_name=?, slot=?, region=?, content=?, negative=?, note=?, enabled=?, updated_at=? WHERE id=?')
    .run(next.style_name, next.slot, next.region, next.content, next.negative, next.note, next.enabled, now(), p.id);
  res.json({ preset: db.prepare('SELECT * FROM prompt_presets WHERE id=?').get(p.id) });
}));

r.delete('/presets/:id', asyncRoute(async (req, res) => {
  db.prepare('DELETE FROM prompt_presets WHERE id=?').run(req.params.id);
  res.json({ deleted: true });
}));

r.post('/presets/batch-delete', asyncRoute(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 200);
  if (!ids.length) throw httpError(400, '没有要删除的条目');
  const del = db.prepare('DELETE FROM prompt_presets WHERE id=?');
  for (const id of ids) del.run(id);
  res.json({ deleted: ids.length });
}));

/* 地域是整幅画风的属性:一次改一批,不用逐条 PATCH */
r.post('/presets/style-region', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const style = String(b.style_name || '').trim();
  const region = String(b.region || '').trim();
  if (!style) throw httpError(400, '缺少画风名');
  if (region && !drama.REGIONS[region]) throw httpError(400, '地域只能是:' + Object.keys(drama.REGIONS).join(' / '));
  const r2 = db.prepare('UPDATE prompt_presets SET region=?, updated_at=? WHERE style_name=?').run(region, now(), style);
  res.json({ style_name: style, region, updated: Number(r2.changes || 0) });
}));

/* 恢复内置画风:按 (画风,槽位) 去补,不覆盖用户已经改过的行 */
r.post('/presets/restore', asyncRoute(async (req, res) => {
  const { PRESETS } = require('../drama-presets');
  const have = new Set(db.prepare('SELECT style_name, slot FROM prompt_presets').all().map(x => x.style_name + '\u0000' + x.slot));
  let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM prompt_presets').get().m) + 1;
  let added = 0;
  const ins = db.prepare(`INSERT INTO prompt_presets(id,style_name,slot,content,negative,note,enabled,is_system,sort_index,created_at)
    VALUES(?,?,?,?,?,?,1,1,?,?)`);
  for (const p of PRESETS) {
    if (have.has(p.style + '\u0000' + p.slot)) continue;
    ins.run(uid('pm-'), p.style, p.slot, p.content, p.negative || '', p.note || '', sort++, now());
    added++;
  }
  res.json({ added, total: PRESETS.length });
}));

/* ---------- 列表与详情 ---------- */
r.get('/', asyncRoute(async (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM dramas ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM dramas WHERE owner_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ items: rows.map(d => dramaBrief(d)) });
}));

/* 关联项目时默认沿用它的出片规格(比例/视频分辨率/帧率/单镜时长)—— 工作流出的片
   最终要进项目导出,两处规格不一致会在拼接时露馅 */
function projectSpec(projectId) {
  if (!projectId) return null;
  const p = db.prepare('SELECT fps, aspect_ratio, resolution, shot_duration FROM projects WHERE id=?').get(String(projectId));
  if (!p) return null;
  return {
    aspect_ratio: p.aspect_ratio || '16:9',
    video_resolution: p.resolution || '720p',
    fps: Number(p.fps) || 24,
    shot_duration: Number(p.shot_duration) || 10
  };
}
const DEFAULT_SPEC = { aspect_ratio: '16:9', image_resolution: '1K', video_resolution: '720p', fps: 24, shot_duration: 10 };

r.post('/', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const id = uid('dr-');
  const title = String(b.title || '').trim().slice(0, 80) || '未命名短剧';
  const script = String(b.script || '').slice(0, 400000);
  const style = String(b.style || '').trim().slice(0, 60);
  const projectId = b.project_id ? String(b.project_id) : null;
  /* 显式传了就用传的,没传才继承项目 —— 校验仍走 normSpec,非法值直接 400 */
  const inherit = projectSpec(projectId);
  const base = Object.assign({}, DEFAULT_SPEC, inherit || {});
  if (inherit && !b.video_resolution && b.resolution) b.video_resolution = b.resolution;
  const spec = normSpec(b, base);
  db.prepare(`INSERT INTO dramas(id,owner_id,project_id,title,brief,script,script_chars,style,text_model_id,image_model_id,video_model_id,
      aspect_ratio,image_resolution,video_resolution,fps,shot_duration,status,stage,progress,done_episodes,stats,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft','',0,'[]','{}',?,?)`)
    .run(id, req.user.id, projectId, title, String(b.brief || '').slice(0, 4000),
      script, script.length, style, String(b.text_model_id || ''), String(b.image_model_id || ''), String(b.video_model_id || ''),
      spec.aspect_ratio, spec.image_resolution, spec.video_resolution, spec.fps, spec.shot_duration, now(), now());
  res.json({ drama: dramaBrief(db.prepare('SELECT * FROM dramas WHERE id=?').get(id)), script_chars: script.length });
}));

r.get('/:id', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  /* 第 0 集(分集标记之前的「主要人物介绍」)是合法值,不能拿 0 当「不筛选」 */
  const epRaw = req.query.episode_no;
  const epFilter = (epRaw === undefined || epRaw === '' || !Number.isFinite(Number(epRaw))) ? null : Math.max(0, Math.min(100000, Number(epRaw)));
  const limit = clamp(Number(req.query.limit), 1, 2000, 600);
  const offset = clamp(Number(req.query.offset), 0, 1000000, 0);
  const refCounts = {};
  for (const r of db.prepare("SELECT j.value AS name, COUNT(*) AS c FROM drama_shots s, json_each(s.char_refs) j WHERE s.drama_id=? GROUP BY j.value").all(d.id)) refCounts[r.name] = (refCounts[r.name] || 0) + r.c;
  for (const r of db.prepare("SELECT scene_ref AS name, COUNT(*) AS c FROM drama_shots WHERE drama_id=? AND scene_ref<>'' GROUP BY scene_ref").all(d.id)) refCounts[r.name] = (refCounts[r.name] || 0) + r.c;
  const entities = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? ORDER BY kind, sort_index, name').all(d.id).map(e => entityJSON(e, refCounts));
  const shotRows = epFilter !== null
    ? db.prepare('SELECT * FROM drama_shots WHERE drama_id=? AND episode_no=? ORDER BY shot_no, sort_index LIMIT ? OFFSET ?').all(d.id, epFilter, limit, offset)
    : db.prepare('SELECT * FROM drama_shots WHERE drama_id=? ORDER BY episode_no, shot_no, sort_index LIMIT ? OFFSET ?').all(d.id, limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS c FROM drama_shots WHERE drama_id=?').get(d.id).c;
  const jobs = db.prepare("SELECT id,type,status,progress,error,cost,params,model_id,created_at,finished_at,result_asset_id,result_asset_ids,linked_asset_ids FROM tasks WHERE drama_id=? AND type<>'text-generation' ORDER BY created_at DESC LIMIT 200").all(d.id);
  const running = drama.currentJob(d.id);
  /* 阶段就绪度:前端左栏的「就绪/待做」与出片门槛都读这一份,不各自再算一遍 */
  const cnt = sql => db.prepare(sql).get(d.id).c;
  const readiness = {
    script: { chars: String(d.script || '').length, analyzed: JSON.parse(d.done_episodes || '[]').length, analyzing: d.status === 'analyzing' },
    entities: { total: cnt('SELECT COUNT(*) c FROM drama_entities WHERE drama_id=?'), with_image: cnt('SELECT COUNT(*) c FROM drama_entities WHERE drama_id=? AND asset_id IS NOT NULL') },
    shots: { total, with_image: cnt("SELECT COUNT(*) c FROM drama_shots WHERE drama_id=? AND image_asset_ids<>'[]'"), with_video: cnt("SELECT COUNT(*) c FROM drama_shots WHERE drama_id=? AND video_asset_ids<>'[]'") },
    style: d.style || ''
  };
  res.json({
    drama: dramaBrief(d, {
      script: d.script,
      job: running ? { unit_index: running.unitIndex, total_hint: null, began: running.began, cancelled: running.cancelled } : null
    }),
    entities,
    shots: (() => {
      const cap = imageRefCap(d);
      return shotRows.map(row => presentShot(d, row, cap));
    })(),
    shots_total: total,
    /* 集数导航:每集多少镜,前端据此渲染集数侧栏 */
    episodes: db.prepare(`SELECT episode_no, COUNT(*) AS shots, COALESCE(SUM(duration),0) AS seconds,
      SUM(CASE WHEN image_asset_ids IS NULL OR image_asset_ids IN ('','[]') THEN 0 ELSE 1 END) AS images,
      SUM(CASE WHEN video_asset_ids IS NULL OR video_asset_ids IN ('','[]') THEN 0 ELSE 1 END) AS videos
      FROM drama_shots WHERE drama_id=? GROUP BY episode_no ORDER BY episode_no`).all(d.id),
    readiness,
    tasks: jobs.map(t => Object.assign({}, t, {
      params: (() => { try { return JSON.parse(t.params || '{}'); } catch (e) { return {}; } })(),
      /* 成果资产直接带缩略信息,前端「查看」不用再逐个查一遍 */
      results: (() => {
        try { return assetsBrief(Object.values(JSON.parse(t.result_asset_ids || '[]')).concat(t.result_asset_id || [])); } catch (e) { return []; }
      })()
    }))
  });
}));

r.patch('/:id', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const next = {
    title: b.title != null ? String(b.title).trim().slice(0, 80) : d.title,
    brief: b.brief != null ? String(b.brief).slice(0, 4000) : d.brief,
    style: b.style != null ? String(b.style).trim().slice(0, 60) : d.style,
    project_id: b.project_id !== undefined ? (b.project_id ? String(b.project_id) : null) : d.project_id,
    text_model_id: b.text_model_id != null ? String(b.text_model_id) : d.text_model_id,
    image_model_id: b.image_model_id != null ? String(b.image_model_id) : d.image_model_id,
    video_model_id: b.video_model_id != null ? String(b.video_model_id) : d.video_model_id
  };
  if (!next.title) throw httpError(400, '标题不能为空');
  /* 规格三级优先:本次显式传 → 换绑项目时继承新项目 → 保持原值。
     只想改项目不带规格时也该跟着新项目走,否则「关联项目」这件事对出片没有任何影响。 */
  const inherit = (b.project_id !== undefined && b.project_id && b.project_id !== d.project_id) ? projectSpec(next.project_id) : null;
  const specBase = Object.assign({
    aspect_ratio: d.aspect_ratio || DEFAULT_SPEC.aspect_ratio,
    image_resolution: d.image_resolution || DEFAULT_SPEC.image_resolution,
    video_resolution: d.video_resolution || DEFAULT_SPEC.video_resolution,
    fps: Number(d.fps) || DEFAULT_SPEC.fps,
    shot_duration: Number(d.shot_duration) || DEFAULT_SPEC.shot_duration
  }, inherit || {});
  const spec = normSpec(b, specBase);
  let script = d.script, scriptChars = d.script_chars;
  if (b.script != null) { script = String(b.script).slice(0, 400000); scriptChars = script.length; }
  db.prepare(`UPDATE dramas SET title=?, brief=?, style=?, project_id=?, text_model_id=?, image_model_id=?, video_model_id=?,
      aspect_ratio=?, image_resolution=?, video_resolution=?, fps=?, shot_duration=?, script=?, script_chars=?, updated_at=? WHERE id=?`)
    .run(next.title, next.brief, next.style, next.project_id, next.text_model_id, next.image_model_id, next.video_model_id,
      spec.aspect_ratio, spec.image_resolution, spec.video_resolution, spec.fps, spec.shot_duration, script, scriptChars, now(), d.id);
  res.json({ drama: dramaBrief(db.prepare('SELECT * FROM dramas WHERE id=?').get(d.id), { script }) });
}));

r.delete('/:id', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  db.prepare('DELETE FROM drama_shots WHERE drama_id=?').run(d.id);
  db.prepare('DELETE FROM drama_entities WHERE drama_id=?').run(d.id);
  db.prepare('DELETE FROM dramas WHERE id=?').run(d.id);
  res.json({ deleted: true });
}));

r.post('/batch-delete', asyncRoute(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 100);
  let deleted = 0, errors = [];
  for (const id of ids) {
    try {
      const d = assertAccess(req, id);
      db.prepare('DELETE FROM drama_shots WHERE drama_id=?').run(d.id);
      db.prepare('DELETE FROM drama_entities WHERE drama_id=?').run(d.id);
      db.prepare('DELETE FROM dramas WHERE id=?').run(d.id);
      deleted++;
    } catch (e) { errors.push(id.slice(0, 10) + ':' + e.message); }
  }
  res.json({ deleted, errors });
}));

/* ---------- 分析 ---------- */
r.post('/:id/analyze', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const eps = Array.isArray(b.episode_nos) ? b.episode_nos.map(x => Number(x)).filter(Number.isFinite) : [];
  const out = drama.startAnalysis(d.id, { episode_nos: eps, maxUnits: Number(b.maxUnits) || 40, cover: !!b.cover });
  res.json(out);
}));

r.post('/:id/analyze/stop', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  res.json(drama.stopAnalysis(d.id));
}));

/* 待生成清单:批量按钮要知道「还有哪些镜没出图/没出片」,不能靠前端已加载的那一页 */
r.get('/:id/pending', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const cap = clamp(Number(req.query.limit), 1, 500, 60);
  const image = db.prepare("SELECT id FROM drama_shots WHERE drama_id=? AND (image_asset_ids IS NULL OR image_asset_ids IN ('','[]')) ORDER BY episode_no, shot_no LIMIT ?").all(d.id, cap).map(x => x.id);
  /* 出片待办:有「任意图片」(静帧或关联图)且还没出片的镜 —— 不再只认已生成的静帧 */
  const parseIds = v => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  const cards = new Map(db.prepare('SELECT name, asset_id FROM drama_entities WHERE drama_id=? AND asset_id IS NOT NULL').all(d.id).map(r => [r.name, r.asset_id]));
  const cand = db.prepare("SELECT id, image_asset_ids, ref_asset_ids, char_refs, scene_ref, use_cast_refs FROM drama_shots WHERE drama_id=? AND (video_asset_ids IS NULL OR video_asset_ids IN ('','[]')) ORDER BY episode_no, shot_no LIMIT 1200").all(d.id);
  const video = cand.filter(r => {
    if (parseIds(r.image_asset_ids).length) return true;
    if (parseIds(r.ref_asset_ids).length) return true;
    if (Number(r.use_cast_refs) === 0) return false;
    if (r.scene_ref && cards.has(r.scene_ref)) return true;
    return parseIds(r.char_refs).some(n => cards.has(n));
  }).slice(0, cap).map(r => r.id);
  const ent = db.prepare('SELECT kind, SUM(CASE WHEN asset_id IS NULL THEN 1 ELSE 0 END) AS todo, COUNT(*) AS total FROM drama_entities WHERE drama_id=? GROUP BY kind').all(d.id);
  res.json({ image, video, entities: ent });
}));

r.get('/:id/progress', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const st = drama.refreshStats(d.id);
  res.json({
    status: d.status, stage: d.stage, progress: d.progress, error: d.error,
    done: JSON.parse(d.done_episodes || '[]'), running: !!drama.currentJob(d.id), stats: st,
    updated_at: d.updated_at
  });
}));

/* ---------- 设定卡 ---------- */
r.post('/:id/entities', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!items.length) throw httpError(400, '没有要新增的卡');
  let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_entities WHERE drama_id=?').get(d.id).m) + 1;
  const created = [], dup = [];
  for (const it of items.slice(0, 300)) {
    const kind = it.kind === 'scene' ? 'scene' : it.kind === 'prop' ? 'prop' : 'character';
    const raw = Object.assign({}, it, { kind });
    const name = drama.nameCard(raw);
    if (!name) continue;
    /* 卡名是身份锚:重名不建第二张,直接把已有的还回去,免得同一角色在分镜里分裂成两个 */
    const hit = db.prepare('SELECT id FROM drama_entities WHERE drama_id=? AND kind=? AND name=?').get(d.id, kind, name);
    if (hit) { dup.push(name); continue; }
    const id = uid('de-');
    db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,age_stage,costume,profile,prompt,note,sort_index,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, d.id, kind, name, String(raw.age_stage || '').slice(0, 20), String(raw.costume || '').slice(0, 40),
        String(raw.profile || '').slice(0, 1000), String(raw.prompt || '').slice(0, 4000), String(raw.note || '').slice(0, 500), sort++, now(), now());
    created.push(id);
  }
  drama.refreshStats(d.id);
  res.json({ created: created.length, duplicate: dup.length, duplicate_names: dup.slice(0, 5), items: created.map(id => entityJSON(db.prepare('SELECT * FROM drama_entities WHERE id=?').get(id))) });
}));

r.patch('/entities/:id', asyncRoute(async (req, res) => {
  const e = db.prepare('SELECT * FROM drama_entities WHERE id=?').get(req.params.id);
  if (!e) throw httpError(404, '设定卡不存在');
  assertAccess(req, e.drama_id);
  const b = req.body || {};
  const kind = b.kind != null ? (b.kind === 'scene' ? 'scene' : b.kind === 'prop' ? 'prop' : 'character') : e.kind;
  let name = e.name;
  if (b.name != null || b.age_stage != null || b.costume != null) {
    name = drama.nameCard({
      kind, name: b.name != null ? String(b.name).trim() : e.name.replace(/[（(].+[)）]\s*$/, ''),
      age_stage: b.age_stage != null ? String(b.age_stage).trim() : e.age_stage,
      costume: b.costume != null ? String(b.costume).trim() : e.costume
    });
  }
  if (!name) throw httpError(400, '名称不能为空');
  const next = {
    profile: b.profile != null ? String(b.profile).slice(0, 1000) : e.profile,
    prompt: b.prompt != null ? String(b.prompt).slice(0, 4000) : e.prompt,
    note: b.note != null ? String(b.note).slice(0, 500) : e.note,
    asset_id: b.asset_id !== undefined ? (b.asset_id ? String(b.asset_id) : null) : e.asset_id
  };
  if (b.asset_id) {
    const a2 = db.prepare('SELECT * FROM assets WHERE id=?').get(String(b.asset_id));
    if (!a2) throw httpError(404, '图片不存在');
    if (a2.type !== 'image') throw httpError(400, '「' + (a2.name || '') + '」不是图片');
    if (a2.owner_id !== req.user.id && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a2.id, req.user.id)) {
      throw httpError(403, '无权使用这张图片');
    }
  }
  db.prepare('UPDATE drama_entities SET kind=?, name=?, profile=?, prompt=?, note=?, asset_id=?, updated_at=? WHERE id=?')
    .run(kind, name, next.profile, next.prompt, next.note, next.asset_id, now(), e.id);
  res.json({ entity: entityJSON(db.prepare('SELECT * FROM drama_entities WHERE id=?').get(e.id)) });
}));

r.delete('/entities/:id', asyncRoute(async (req, res) => {
  const e = db.prepare('SELECT * FROM drama_entities WHERE id=?').get(req.params.id);
  if (!e) throw httpError(404, '设定卡不存在');
  assertAccess(req, e.drama_id);
  db.prepare('DELETE FROM drama_entities WHERE id=?').run(e.id);
  drama.refreshStats(e.drama_id);
  res.json({ deleted: true });
}));

r.post('/entities/batch-delete', asyncRoute(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 500);
  if (!ids.length) throw httpError(400, '没有要删除的卡');
  const q = db.prepare('SELECT drama_id FROM drama_entities WHERE id=?');
  const touched = new Set();
  const del = db.prepare('DELETE FROM drama_entities WHERE id=?');
  let n = 0;
  for (const id of ids) {
    const row = q.get(id);
    if (!row) continue;
    assertAccess(req, row.drama_id);
    del.run(id); touched.add(row.drama_id); n++;
  }
  for (const dId of touched) drama.refreshStats(dId);
  res.json({ deleted: n });
}));

/* ---------- 关联体检(需求:提示词里有这个人物/场景,图片却没关联) ----------
   把「引用名 ↔ 设定卡 ↔ 定稿图」三者的裂缝找出来:
   junk      引用名是「无 / 暂无 / —」这类噪声(模型没填对),直接从引用里删掉
   missing   引用名根本没有对应的卡(所以永远关联不到图)→ 可以自动建卡
   stale     引用没带括号,而已有卡是「本名（年龄段·服装）」→ 对齐即可
   variant   引用带了括号但与唯一的同名卡年龄段/服装不同(老年 vs 中年)→ **不能静默改名**,
             要么按引用另建造型卡,要么人工决定
   ambiguous 没带括号但有多个同名卡,不知道该对哪张 → 只报告
   no_asset  卡在、但没有定稿图 → 这才是「关联图片为空」的主因 */
const JUNK_NAME = /^(无|暂无|没有|空|未知|null|none|nil|-{1,2}|—{1,2}|n\/a)$/i;
function baseName(n) { return String(n || '').replace(/[（(].+[)）]\s*$/, '').trim(); }
function hasSuffix(n) { return /[（(].+[)）]\s*$/.test(String(n || '')); }

function diagnoseDrama(d) {
  const ents = db.prepare('SELECT id, name, kind, asset_id FROM drama_entities WHERE drama_id=?').all(d.id);
  const byName = new Map(ents.map(e => [e.name, e]));
  const byBase = new Map();
  for (const e of ents) { const b = baseName(e.name); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(e); }
  const refCount = {};
  for (const r of db.prepare("SELECT j.value AS name, COUNT(*) AS c FROM drama_shots s, json_each(s.char_refs) j WHERE s.drama_id=? GROUP BY j.value").all(d.id)) refCount[r.name] = r.c;
  for (const r of db.prepare("SELECT scene_ref AS name, COUNT(*) AS c FROM drama_shots WHERE drama_id=? AND scene_ref<>'' GROUP BY scene_ref").all(d.id)) refCount[r.name] = (refCount[r.name] || 0) + r.c;

  const shots = db.prepare('SELECT id, episode_no, shot_no, char_refs, scene_ref FROM drama_shots WHERE drama_id=? ORDER BY episode_no, shot_no').all(d.id);
  const junk = new Map(), missing = new Map(), stale = [], variant = new Map(), ambiguous = [];
  const parse = v => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  const label = sh => '第' + sh.episode_no + '集 镜' + sh.shot_no;
  const add = (map, key, obj) => { if (!map.has(key)) map.set(key, obj); return map.get(key); };

  const classify = (name, kind, shot) => {
    const nm = String(name || '').trim();
    if (!nm) return false;
    if (JUNK_NAME.test(nm)) { add(junk, kind + ':' + nm, { kind, name: nm, shots: 0 }).shots++; return false; }
    if (byName.has(nm)) return true;
    const cands = (byBase.get(baseName(nm)) || []).filter(e => e.kind === kind);
    if (!hasSuffix(nm)) {
      if (cands.length === 1) { stale.push({ shot_id: shot.id, kind, from: nm, to: cands[0].name, label: label(shot) }); return true; }
      if (cands.length > 1) { ambiguous.push({ name: nm, kind, label: label(shot), candidates: cands.map(e => e.name) }); return false; }
    } else if (cands.length) {
      /* 带了括号但同名卡的另一套造型:语义不同,交给人工选「另建卡」还是「对齐」 */
      const card = cands[0];
      const row = add(variant, kind + ':' + nm, { kind, name: nm, card: card.name, shots: 0, ref_count: refCount[nm] || 0 });
      row.shots++;
      return false;
    }
    const row = add(missing, kind + ':' + nm, { kind, name: nm, shots: 0, ref_count: refCount[nm] || 0 });
    row.shots++;
    return false;
  };
  let refsNoImage = 0;
  for (const sh of shots) {
    const names = parse(sh.char_refs);
    let ok = true;
    for (const n of names) if (!classify(n, 'character', sh)) ok = false;
    const sc = String(sh.scene_ref || '').trim();
    if (sc && !classify(sc, 'scene', sh)) ok = false;
    if (ok && (names.length || sc) && !effectiveRefs(d, sh, 4).length) refsNoImage++;
  }
  /* 同基名多张卡:修复时若误建了造型卡,这里能看出来并合并 */
  const dupGroups = [];
  for (const [k, list] of (() => {
    const m = new Map();
    for (const e of ents) { const key = e.kind + '|' + baseName(e.name); if (!m.has(key)) m.set(key, []); m.get(key).push(e); }
    return m;
  })()) {
    if (list.length < 2) continue;
    dupGroups.push({
      kind: list[0].kind, base: baseName(list[0].name),
      names: list.map(e => e.name),
      with_asset: list.filter(e => e.asset_id).length,
      refs: list.reduce((n, e) => n + (refCount[e.name] || 0), 0)
    });
  }
  dupGroups.sort((a, b) => b.refs - a.refs);
  const noAsset = ents.filter(e => !e.asset_id)
    .map(e => ({ id: e.id, name: e.name, kind: e.kind, ref_count: refCount[e.name] || 0 }))
    .sort((a, b) => b.ref_count - a.ref_count);
  const missingList = [...missing.values()];
  const variantList = [...variant.values()];
  return {
    junk: [...junk.values()],
    missing: missingList,
    stale: stale.slice(0, 500),
    variant: variantList.slice(0, 300),
    ambiguous: ambiguous.slice(0, 60),
    noAsset,
    duplicates: dupGroups,
    summary: {
      duplicates: dupGroups.length,
      junk: [...junk.values()].reduce((n, x) => n + x.shots, 0),
      missing: missingList.length, stale: stale.length, variant: variantList.length,
      ambiguous: ambiguous.length, no_asset: noAsset.length, refs_no_image: refsNoImage
    }
  };
}

r.get('/:id/diagnose', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  res.json(diagnoseDrama(d));
}));

/* 修复只做「引用对齐」,不生成图:
   junk      删掉引用里的噪声名
   missing   建卡(角色补 青年·通用)+ 引用改成卡全名
   stale     引用补成卡全名
   variant   按 variant_mode:'create'(默认,各建一张造型卡)| 'align'(对齐到现有卡)| 'skip' */
r.post('/:id/repair', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  /* 默认「对齐到现有卡」:建卡会把 系统（虚拟/未知/无形态）这种拆成一堆重复形象,
     用户要的是「图能关联上」,不是多几张卡;真要各出一套造型再显式选 create。 */
  const mode = ['create', 'align', 'skip'].includes(String(b.variant_mode)) ? String(b.variant_mode) : 'align';
  const diag = diagnoseDrama(d);
  const parse = v => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  const allShots = () => db.prepare('SELECT id, char_refs, scene_ref FROM drama_shots WHERE drama_id=?').all(d.id);
  const ensureCard = (kind, name, note) => {
    const raw = kind === 'character'
      ? { kind, name, age_stage: (hasSuffix(name) ? '' : '青年'), costume: (hasSuffix(name) ? '' : '通用'), note }
      : { kind, name, note };
    const canonical = drama.nameCard(raw);
    const hit = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? AND kind=? AND name=?').get(d.id, kind, canonical);
    if (hit) return canonical;
    const sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_entities WHERE drama_id=?').get(d.id).m) + 1;
    db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,age_stage,costume,note,sort_index,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(uid('de-'), d.id, kind, canonical, raw.age_stage || '', raw.costume || '', note, sort, now(), now());
    return canonical;
  };
  const rewrite = (kind, from, to) => {
    let n = 0;
    for (const sh of allShots()) {
      if (kind === 'scene') {
        if (String(sh.scene_ref || '') === from && to !== from) { db.prepare('UPDATE drama_shots SET scene_ref=?, updated_at=? WHERE id=?').run(to, now(), sh.id); n++; }
      } else {
        const names = parse(sh.char_refs);
        if (!names.includes(from)) continue;
        const next = names.map(x => x === from ? to : x);
        db.prepare('UPDATE drama_shots SET char_refs=?, updated_at=? WHERE id=?').run(JSON.stringify(next), now(), sh.id);
        n++;
      }
    }
    return n;
  };

  let removed = 0, created = 0, relinked = 0;
  const createdNames = [];

  /* 噪声引用:直接从引用里删 */
  if (diag.junk.length) {
    const junkSet = new Set(diag.junk.filter(x => x.kind === 'character').map(x => x.name));
    if (junkSet.size) {
      for (const sh of allShots()) {
        const names = parse(sh.char_refs);
        const next = names.filter(x => !junkSet.has(String(x).trim()));
        if (next.length === names.length) continue;
        db.prepare('UPDATE drama_shots SET char_refs=?, updated_at=? WHERE id=?').run(JSON.stringify(next), now(), sh.id);
        removed++;
      }
    }
  }
  /* 缺卡 */
  for (const m of diag.missing) {
    const canonical = ensureCard(m.kind, m.name, '修复关联时自动建卡');
    created++;
    createdNames.push(canonical);
    if (canonical !== m.name) relinked += rewrite(m.kind, m.name, canonical);
  }
  /* 引用没带括号 → 补成卡全名 */
  if (b.fix_stale !== false) for (const st of diag.stale) relinked += rewrite(st.kind, st.from, st.to);
  /* 造型差异 → 按 mode 处理 */
  if (mode === 'create') {
    const seen = new Set();
    for (const v of diag.variant) {
      if (seen.has(v.kind + ':' + v.name)) continue;
      seen.add(v.kind + ':' + v.name);
      const canonical = ensureCard(v.kind, v.name, '按分镜引用补的造型卡');
      created++;
      createdNames.push(canonical);
    }
  } else if (mode === 'align') {
    for (const v of diag.variant) relinked += rewrite(v.kind, v.name, v.card);
  }
  const after = diagnoseDrama(d);
  res.json({ removed, created, relinked, created_names: createdNames.slice(0, 50), variant_mode: mode, remaining: after.summary });
}));

/* 合并同基名的重复卡:保留「有定稿图」的那张(没有则保留被引用最多的),
   其余卡的引用改写到保留卡后删除卡行。已生成的图不动,仍在资产库。 */
r.post('/:id/entities/merge', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const kindOnly = b.kind ? String(b.kind) : '';
  const refCount = {};
  for (const r of db.prepare("SELECT j.value AS name, COUNT(*) AS c FROM drama_shots s, json_each(s.char_refs) j WHERE s.drama_id=? GROUP BY j.value").all(d.id)) refCount[r.name] = (refCount[r.name] || 0) + r.c;
  for (const r of db.prepare("SELECT scene_ref AS name, COUNT(*) AS c FROM drama_shots WHERE drama_id=? AND scene_ref<>'' GROUP BY scene_ref").all(d.id)) refCount[r.name] = (refCount[r.name] || 0) + r.c;
  const ents = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? ORDER BY sort_index, created_at').all(d.id);
  const groups = new Map();
  for (const e of ents) {
    if (kindOnly && e.kind !== kindOnly) continue;
    const k = e.kind + '|' + baseName(e.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const parse = v => { try { return JSON.parse(v || '[]'); } catch (e) { return []; } };
  const report = [];
  let removed = 0, relinked = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keeper = list.find(e => e.asset_id)
      || list.slice().sort((a, b2) => (refCount[b2.name] || 0) - (refCount[a.name] || 0))[0];
    let moved = 0;
    for (const l of list) {
      if (l.id === keeper.id) continue;
      for (const sh of db.prepare('SELECT id, char_refs, scene_ref FROM drama_shots WHERE drama_id=?').all(d.id)) {
        if (l.kind === 'scene') {
          if (String(sh.scene_ref || '') !== l.name) continue;
          db.prepare('UPDATE drama_shots SET scene_ref=?, updated_at=? WHERE id=?').run(keeper.name, now(), sh.id);
          moved++;
        } else {
          const names = parse(sh.char_refs);
          if (!names.includes(l.name)) continue;
          db.prepare('UPDATE drama_shots SET char_refs=?, updated_at=? WHERE id=?').run(JSON.stringify(names.map(n => n === l.name ? keeper.name : n)), now(), sh.id);
          moved++;
        }
      }
      db.prepare('DELETE FROM drama_entities WHERE id=?').run(l.id);
      removed++;
    }
    relinked += moved;
    report.push({ keep: keeper.name, removed: list.filter(e => e.id !== keeper.id).map(e => e.name), refs_moved: moved });
  }
  drama.refreshStats(d.id);
  res.json({ groups: report.length, removed, relinked, detail: report.slice(0, 50) });
}));

/* ---------- 分镜 ---------- */
r.post('/:id/shots', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!items.length) throw httpError(400, '没有要新增的分镜');
  let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_shots WHERE drama_id=?').get(d.id).m) + 1;
  const ins = db.prepare(`INSERT INTO drama_shots(id,drama_id,episode_no,shot_no,script_text,image_prompt,video_prompt,duration,
    scene_ref,char_refs,end_state,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const it of items.slice(0, 500)) {
    const ep = Math.max(0, Math.min(100000, Number(it.episode_no) || 1));
    const no = Math.max(1, Number(it.shot_no) || (n + 1));
    const dur = clamp(Number(it.duration) || 10, 3, 25, 10);
    ins.run(uid('ds-'), d.id, ep, no, String(it.script_text || '').slice(0, 3000), String(it.image_prompt || '').slice(0, 6000),
      String(it.video_prompt || '').slice(0, 6000), dur, String(it.scene_ref || '').slice(0, 120),
      JSON.stringify(Array.isArray(it.char_refs) ? it.char_refs.slice(0, 20) : []), String(it.end_state || '').slice(0, 1200), sort++, now(), now());
    n++;
  }
  drama.refreshStats(d.id);
  res.json({ created: n });
}));

r.patch('/shots/:id', asyncRoute(async (req, res) => {
  const s = db.prepare('SELECT * FROM drama_shots WHERE id=?').get(req.params.id);
  if (!s) throw httpError(404, '分镜不存在');
  assertAccess(req, s.drama_id);
  const b = req.body || {};
  const next = {
    episode_no: b.episode_no != null ? Math.max(0, Number(b.episode_no) || 1) : s.episode_no,
    shot_no: b.shot_no != null ? Math.max(1, Number(b.shot_no) || 1) : s.shot_no,
    script_text: b.script_text != null ? String(b.script_text).slice(0, 3000) : s.script_text,
    image_prompt: b.image_prompt != null ? String(b.image_prompt).slice(0, 6000) : s.image_prompt,
    video_prompt: b.video_prompt != null ? String(b.video_prompt).slice(0, 6000) : s.video_prompt,
    duration: b.duration != null ? clamp(Number(b.duration) || 10, 3, 25, 10) : s.duration,
    scene_ref: b.scene_ref != null ? String(b.scene_ref).slice(0, 120) : s.scene_ref,
    char_refs: b.char_refs != null ? JSON.stringify((Array.isArray(b.char_refs) ? b.char_refs : []).slice(0, 20)) : s.char_refs,
    end_state: b.end_state != null ? String(b.end_state).slice(0, 1200) : s.end_state,
    /* 单镜覆盖:0 / 空串 = 跟随剧级 */
    fps: b.fps != null ? (Number(b.fps) || 0) : s.fps,
    video_resolution: b.video_resolution != null ? String(b.video_resolution).slice(0, 12) : s.video_resolution,
    use_cast_refs: b.use_cast_refs != null ? (b.use_cast_refs ? 1 : 0) : s.use_cast_refs,
    ref_exclude_ids: b.ref_exclude_ids != null
      ? JSON.stringify((Array.isArray(b.ref_exclude_ids) ? b.ref_exclude_ids : []).map(String).slice(0, 12))
      : s.ref_exclude_ids,
    image_locked: b.image_locked != null ? (b.image_locked ? 1 : 0) : s.image_locked,
    image_prompt: b.image_prompt != null ? String(b.image_prompt).slice(0, 6000) : s.image_prompt
  };
  /* 锚点是派生的:前端提交的整段里若带着旧锚点,入库前剥掉,免得越存越长 */
  next.video_prompt = drama.stripAnchors(next.video_prompt);
  if (b.image_prompt != null) next.image_locked = 1;   /* 手改过就不再派生 */
  /* 改了镜头提示词/场景,图片提示词跟着重算 —— 前端已经不显示它了,不能让它烂在旧值上 */
  if ((b.video_prompt != null || b.scene_ref != null || b.char_refs != null) && !Number(next.image_locked)) {
    const sceneCard = next.scene_ref
      ? db.prepare("SELECT prompt, profile FROM drama_entities WHERE drama_id=? AND kind='scene' AND name=?").get(s.drama_id, next.scene_ref)
      : null;
    const visual = drama.visualFromVideo(next.video_prompt, next.script_text);
    next.image_prompt = drama.composeShotText({
      scene_ref: next.scene_ref, char_refs: JSON.parse(next.char_refs || '[]'),
      visual, script: next.script_text, dialogue: '', end_state: next.end_state
    }, { sceneCard }).image;
  }
  if (b.video_resolution) {
    const list = videoResolutionList();
    if (!list.some(x => x.toLowerCase() === next.video_resolution.toLowerCase())) throw httpError(400, '视频分辨率只能是:' + list.join(' / '));
  }
  if (b.fps != null && Number(b.fps) && !SPEC_FPS.includes(Number(b.fps))) throw httpError(400, '帧率只能是:' + SPEC_FPS.join(' / '));
  let refIds = s.ref_asset_ids;
  if (b.ref_asset_ids != null) {
    const ids = (Array.isArray(b.ref_asset_ids) ? b.ref_asset_ids : []).map(String).slice(0, 8);
    for (const rid of ids) {
      const a = db.prepare('SELECT * FROM assets WHERE id=?').get(rid);
      if (!a) throw httpError(404, '参考图不存在: ' + rid.slice(0, 12));
      if (a.type !== 'image') throw httpError(400, '参考图「' + (a.name || '') + '」不是图片');
      if (a.owner_id !== req.user.id && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a.id, req.user.id)) {
        throw httpError(403, '无权使用参考图「' + (a.name || rid.slice(0, 12)) + '」');
      }
    }
    refIds = JSON.stringify([...new Set(ids)]);
  }
  db.prepare(`UPDATE drama_shots SET episode_no=?, shot_no=?, script_text=?, image_prompt=?, video_prompt=?, duration=?,
    scene_ref=?, char_refs=?, end_state=?, ref_asset_ids=?, ref_exclude_ids=?, image_locked=?, fps=?, video_resolution=?, use_cast_refs=?, updated_at=? WHERE id=?`)
    .run(next.episode_no, next.shot_no, next.script_text, next.image_prompt, next.video_prompt, next.duration,
      next.scene_ref, next.char_refs, next.end_state, refIds, next.ref_exclude_ids, next.image_locked,
      next.fps, next.video_resolution, next.use_cast_refs, now(), s.id);
  /* 替换静帧/成片:只换关联,旧图保留在资产库 */
  let imageIds = s.image_asset_ids, videoIds = s.video_asset_ids;
  if (b.image_asset_id !== undefined) {
    const aid = b.image_asset_id ? String(b.image_asset_id) : '';
    if (aid) {
      const a2 = db.prepare('SELECT * FROM assets WHERE id=?').get(aid);
      if (!a2) throw httpError(404, '图片不存在');
      if (a2.type !== 'image') throw httpError(400, '「' + (a2.name || '') + '」不是图片');
      if (a2.owner_id !== req.user.id && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(a2.id, req.user.id)) {
        throw httpError(403, '无权使用这张图片');
      }
    }
    imageIds = JSON.stringify(aid ? [aid] : []);
    db.prepare('UPDATE drama_shots SET image_asset_ids=?, updated_at=? WHERE id=?').run(imageIds, now(), s.id);
  }
  if (b.video_asset_id !== undefined) {
    const aid = b.video_asset_id ? String(b.video_asset_id) : '';
    videoIds = JSON.stringify(aid ? [aid] : []);
    db.prepare('UPDATE drama_shots SET video_asset_ids=?, updated_at=? WHERE id=?').run(videoIds, now(), s.id);
  }
  const dr = db.prepare('SELECT * FROM dramas WHERE id=?').get(s.drama_id);
  res.json({ shot: presentShot(dr, db.prepare('SELECT * FROM drama_shots WHERE id=?').get(s.id), imageRefCap(dr)) });
}));

r.delete('/shots/:id', asyncRoute(async (req, res) => {
  const s = db.prepare('SELECT * FROM drama_shots WHERE id=?').get(req.params.id);
  if (!s) throw httpError(404, '分镜不存在');
  assertAccess(req, s.drama_id);
  db.prepare('DELETE FROM drama_shots WHERE id=?').run(s.id);
  drama.refreshStats(s.drama_id);
  res.json({ deleted: true });
}));

r.post('/shots/batch-delete', asyncRoute(async (req, res) => {
  const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(String).slice(0, 500);
  if (!ids.length) throw httpError(400, '没有要删除的分镜');
  const q = db.prepare('SELECT drama_id FROM drama_shots WHERE id=?');
  const touched = new Set();
  const del = db.prepare('DELETE FROM drama_shots WHERE id=?');
  let n = 0;
  for (const id of ids) {
    const row = q.get(id);
    if (!row) continue;
    assertAccess(req, row.drama_id);
    del.run(id); touched.add(row.drama_id); n++;
  }
  for (const dId of touched) drama.refreshStats(dId);
  res.json({ deleted: n });
}));

/* ---------- 组装预览与固化 ---------- */
/* 画风是整段追加的,底稿里若已有旧画风词就会打架;所以给「把组装结果固化为底稿」留一步,
   让用户删减(玄幻画风文档里那句「根据情况适当删减里面的关键词」)之后能落库。 */
r.post('/:id/compose', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const kind = String(b.kind || 'shot');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 100);
  const target = kind === 'entity' ? null : String(b.target || 'image');
  const out = [];
  if (kind === 'entity') {
    const q = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? AND id=?');
    for (const id of ids) { const e = q.get(d.id, id); if (e) { const c = drama.composeForEntity(d, e); out.push({ id, name: e.name, kind: e.kind, composed: c }); } }
  } else {
    const q = db.prepare('SELECT * FROM drama_shots WHERE drama_id=? AND id=?');
    for (const id of ids) {
      const s = q.get(d.id, id);
      if (!s) continue;
      const c = drama.composeForShot(d, s, target);
      out.push({ id, name: '第' + s.episode_no + '集 镜' + s.shot_no, composed: c });
    }
  }
  res.json({ items: out, style: d.style, missing: out.filter(x => x.composed.missing).length });
}));

r.post('/:id/compose/apply', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const kind = String(b.kind || 'shot');
  const target = String(b.target || 'image');
  const edits = Array.isArray(b.edits) ? b.edits.slice(0, 200) : [];
  let n = 0;
  for (const it of edits) {
    const text = String((it && it.text) || '').trim();
    if (!it || !it.id || !text) continue;
    if (kind === 'entity') {
      const e = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? AND id=?').get(d.id, String(it.id));
      if (!e) continue;
      db.prepare('UPDATE drama_entities SET prompt=?, updated_at=? WHERE id=?').run(text.slice(0, 4000), now(), e.id);
    } else {
      const s = db.prepare('SELECT * FROM drama_shots WHERE drama_id=? AND id=?').get(d.id, String(it.id));
      if (!s) continue;
      const col = target === 'video' ? 'video_prompt' : 'image_prompt';
      /* 固定成人工版本:图片提示词从此不再被派生覆盖,直到用户点「恢复派生」 */
      const lock = target === 'video' ? '' : ', image_locked=1';
      db.prepare('UPDATE drama_shots SET ' + col + '=?, updated_at=?' + lock + ' WHERE id=?').run(text.slice(0, 6000), now(), s.id);
    }
    n++;
  }
  res.json({ applied: n });
}));

/* ---------- 下发 ---------- */
/* 模型没绑定时退到「第一个可用」—— 与 api/text.js 选默认文本模型同一套做法;
   否则新建的剧没选过模型就点下发,只会拿到一句「生图模型不存在」 */
function pickImageModel(id) {
  if (!id) {
    const first = db.prepare("SELECT * FROM models WHERE type='text-to-image' AND enabled=1 ORDER BY is_free DESC, created_at").get();
    if (!first) throw httpError(400, '还没有可用的生图模型:请到后台「模型管理」添加一个类型为「文生图」的模型');
    return first;
  }
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(String(id || ''));
  if (!m) throw httpError(400, '生图模型不存在');
  if (m.type !== 'text-to-image') throw httpError(400, '「' + m.name + '」不是生图模型');
  if (!m.enabled) throw httpError(400, '生图模型「' + m.name + '」已被禁用');
  if (m.api_base && m.model_id && !m.api_key) throw httpError(400, '「' + m.name + '」是在线生图模型,但还没配 API Key');
  return m;
}
function pickVideoModel(id) {
  if (!id) {
    const first = db.prepare("SELECT * FROM models WHERE type='image-to-video' AND enabled=1 ORDER BY is_free DESC, created_at").get();
    if (!first) throw httpError(400, '还没有可用的视频模型:请到后台「模型管理」添加一个类型为「图生视频」的模型');
    return first;
  }
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(String(id || ''));
  if (!m) throw httpError(400, '视频模型不存在');
  if (m.type !== 'image-to-video') throw httpError(400, '「' + m.name + '」不是图生视频模型');
  if (!m.enabled) throw httpError(400, '视频模型「' + m.name + '」已被禁用');
  if (m.api_base && m.model_id && !m.api_key) throw httpError(400, '「' + m.name + '」是在线视频模型,但还没配 API Key');
  return m;
}

/* 出图规格:按模型声明的档位/比例/尺寸清单就近吸附(与 AI 生图同一套换算,同一批函数)。
   没显式传就取剧级规格 —— 此前这里恒为「模型第一档 + 16:9」,用户改了剧级设置也不生效。 */
function imageSpec(model, b, d) {
  const rules = normalizeRules(model);
  const tiers = tiersOf(model);
  const res0 = (d && d.image_resolution) || '';
  const resolution = snapTier(String(b.resolution || res0 || (tiers && tiers[0]) || '1K'), tiers || undefined);
  const ratioList = ratiosOf(model);
  let ratio = String(b.aspect_ratio || (d && d.aspect_ratio) || '').trim();
  if (ratioList && ratioList.length) ratio = snapAspect(ratio || ratioList[0], ratioList) || ratioList[0];
  else ratio = ratio || '16:9';
  const pixelMode = sizeModeOf(model) !== 'tier';
  let size = deriveSize(ratio, resolution);
  const sizes = rules.limits && Array.isArray(rules.limits.sizes) ? rules.limits.sizes : null;
  if (pixelMode && sizes && sizes.length && !sizes.includes(size)) size = snapSize(sizes, size);
  const maxCount = clamp(Number((rules.limits || {}).max_count) || 4, 1, 4, 4);
  return { resolution, aspect_ratio: ratio, size: pixelMode ? size : null, count: clamp(Number(b.count) || 1, 1, maxCount, 1) };
}

/* 出片规格:单镜覆盖 → 剧级 → 默认;分辨率还要落在模型/系统白名单里 */
function videoSpec(model, b, d, shot) {
  const list = videoResolutionList();
  const want = String(b.resolution || (shot && shot.video_resolution) || (d && d.video_resolution) || '720p');
  const res = list.find(x => x.toLowerCase() === want.toLowerCase()) || list[0];
  const fps = Number(b.fps) || Number(shot && shot.fps) || Number(d && d.fps) || 24;
  const dur = clamp(Number(b.duration) || Number(shot && shot.duration) || Number(d && d.shot_duration) || 10, 1, 60, 10);
  return { resolution: res, fps, duration: dur, aspect_ratio: (d && d.aspect_ratio) || '16:9' };
}

/* 下发一张卡/一个镜的生图或生视频任务:组装 → 扣费 → 落 tasks → 入队 */
r.post('/:id/dispatch', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const target = String(b.target || '');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 200);
  if (!ids.length) throw httpError(400, '没有要下发的对象');
  if (!['entity-image', 'shot-image', 'shot-video'].includes(target)) throw httpError(400, '未知的下发类型: ' + target);
  const projectId = d.project_id || null;
  const created = [], skipped = [];
  let costTotal = 0;

  if (target === 'shot-video') {
    const model = pickVideoModel(b.model_id || d.video_model_id);
    const ins = db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,source_asset_id,params,prompt,negative_prompt,status,progress,
      cost,project_id,episode_id,drama_id,linked_asset_ids,result_asset_ids,created_at)
      VALUES(?,?, 'image-to-video', ?,?,?,?,?, 'queued',0, ?,?,?,?, '[]','[]',?)`);
    for (const id of ids) {
      const s = db.prepare('SELECT * FROM drama_shots WHERE drama_id=? AND id=?').get(d.id, id);
      if (!s) { skipped.push({ id, reason: '分镜不存在' }); continue; }
      let imgs = [];
      try { imgs = JSON.parse(s.image_asset_ids || '[]'); } catch (e) { imgs = []; }
      /* 出片不再要求先出静帧:有关联图片就能出(优先用已生成的静帧,否则用第一张关联图) */
      const refList = effectiveRefs(d, s, 4).filter(x => ownImageRef(req, x.id));
      const srcId = String(b.source_asset_id || imgs[0] || (refList[0] && refList[0].id) || '');
      if (!srcId) { skipped.push({ id, reason: '这一镜还没有任何图片:先挂一张参考图(或生成静帧)再出片' }); continue; }
      const src = storage.hydrate(db.prepare('SELECT * FROM assets WHERE id=?').get(srcId));
      if (!src || !fs.existsSync(src.path)) { skipped.push({ id, reason: '源图文件不存在' }); continue; }
      const refNames = { cast: {}, extra: [] };
      for (const r of refList) {
        if (r.source === 'scene') refNames.scene = r.asset.name;
        else if (r.source === 'character') refNames.cast[r.label] = r.asset.name;
        else refNames.extra.push(r.asset.name);
      }
      const composed = drama.composeForShot(d, s, 'video', refNames);
      const vs = videoSpec(model, b, d, s);
      const cost = credits.computeCost(vs.duration, model);
      const taskId = uid('t-');
      if (cost > 0 && !credits.deduct(req.user.id, cost, '短剧分镜出片 · 第' + s.episode_no + '集' + s.shot_no + '镜', taskId)) {
        skipped.push({ id, reason: '积分不足(需 ' + cost + ')' }); continue;
      }
      costTotal += cost;
      const linked = refList.map(x => x.id).filter(x => x !== src.id);
      const params = {
        duration: vs.duration, fps: vs.fps, resolution: vs.resolution,
        motion: clamp(Number(b.motion), 0, 1, 0.5), seed: Number(b.seed) || -1,
        drama_id: d.id, drama_shot_id: s.id, engine: b.engine || 'drama',
        replace: b.replace ? 1 : 0, asset_name: '第' + s.episode_no + '集 镜' + s.shot_no + ' 成片'
      };
      ins.run(taskId, req.user.id, model.id, src.id, JSON.stringify(params), composed.prompt.slice(0, 4000),
        composed.negative.slice(0, 2000), cost, projectId, null, d.id, now());
      if (linked.length) db.prepare('UPDATE tasks SET linked_asset_ids=? WHERE id=?').run(JSON.stringify(linked), taskId);
      enqueue(taskId);
      created.push({ task_id: taskId, shot_id: s.id, cost, prompt_len: composed.prompt.length, missing_style: composed.missing, spec: vs, refs: refList.length });
    }
    pump();
    res.json({ created, skipped, cost: costTotal, balance: credits.getBalance(req.user.id), model: { id: model.id, name: model.name } });
    return;
  }

  const isEntity = target === 'entity-image';
  const model = pickImageModel(b.model_id || d.image_model_id);
  const spec = imageSpec(model, b, d);
  const maxRefs = modelCaps(model).includes('multi-image') ? 4 : (modelCaps(model).includes('image-to-image') ? 1 : 0);
  const ins = db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,source_asset_id,params,prompt,negative_prompt,status,progress,
    cost,project_id,episode_id,drama_id,linked_asset_ids,result_asset_ids,created_at)
    VALUES(?,?, 'text-to-image', ?,?,?,?,?, 'queued',0, ?,?,?,?, '[]','[]',?)`);
  const per = credits.imagePrice(model) * spec.count;
  let refsUsed = 0;
  for (const id of ids) {
    let composed = null, name = '', category = '分镜', tag = {}, refs = [];
    if (isEntity) {
      const e = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? AND id=?').get(d.id, id);
      if (!e) { skipped.push({ id, reason: '设定卡不存在' }); continue; }
      composed = drama.composeForEntity(d, e);
      name = e.name;
      category = e.kind === 'scene' ? '场景' : e.kind === 'prop' ? '物品' : '角色';
      tag = { drama_entity_id: e.id, asset_name: e.name + ' 设定图' };
    } else {
      const s = db.prepare('SELECT * FROM drama_shots WHERE drama_id=? AND id=?').get(d.id, id);
      if (!s) { skipped.push({ id, reason: '分镜不存在' }); continue; }
      name = '第' + s.episode_no + '集 镜' + s.shot_no;
      tag = { drama_shot_id: s.id, asset_name: name + ' 分镜图' };
      /* 场景图优先 → 角色定稿图 → 手动图;被单独摘掉的(排除表)不再自动补回 */
      const refList = effectiveRefs(d, s, maxRefs).filter(x => ownImageRef(req, x.id));
      refs = refList.map(x => x.id);
      const refNames = { cast: {}, extra: [] };
      for (const r of refList) {
        if (r.source === 'scene') refNames.scene = r.asset.name;
        else if (r.source === 'character') refNames.cast[r.label] = r.asset.name;
        else refNames.extra.push(r.asset.name);
      }
      composed = drama.composeForShot(d, s, 'image', refNames);
    }
    const prompt = String(composed.prompt || '').trim().slice(0, 2000);
    if (!prompt) { skipped.push({ id, reason: '提示词为空,请先补底稿' }); continue; }
    const taskId = uid('t-');
    if (per > 0 && !credits.deduct(req.user.id, per, '短剧生图 · ' + name.slice(0, 24), taskId)) {
      skipped.push({ id, reason: '积分不足(需 ' + per + ')' }); continue;
    }
    costTotal += per;
    ins.run(taskId, req.user.id, model.id, refs[0] || null, JSON.stringify(Object.assign({
      size: spec.size, count: spec.count, engine: 'imggen', resolution: spec.resolution,
      size_mode: sizeModeOf(model), aspect_ratio: spec.aspect_ratio, seed: Number(b.seed) || -1,
      asset_category: category, drama_id: d.id
    }, tag)), prompt, composed.negative.slice(0, 2000), per, projectId, null, d.id, now());
    /* 参考图记进 linked,任务详情与占位统计照常看得到 */
    if (refs.length) db.prepare('UPDATE tasks SET linked_asset_ids=? WHERE id=?').run(JSON.stringify(refs), taskId);
    refsUsed += refs.length;
    enqueue(taskId);
    created.push({ task_id: taskId, id, name, cost: per, prompt_len: prompt.length, missing_style: composed.missing, style_via: composed.via, refs: refs.length });
  }
  pump();
  res.json({
    created, skipped, cost: costTotal, balance: credits.getBalance(req.user.id),
    model: { id: model.id, name: model.name }, spec, refs_used: refsUsed
  });
}));

/* 成本预估(下发前给个数,免得用户点了才发现积分不够) */
r.post('/:id/estimate', asyncRoute(async (req, res) => {
  const d = assertAccess(req, req.params.id);
  const b = req.body || {};
  const target = String(b.target || 'shot-image');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String);
  const model = target === 'shot-video' ? pickVideoModel(b.model_id || d.video_model_id) : pickImageModel(b.model_id || d.image_model_id);
  const spec = target === 'shot-video' ? null : imageSpec(model, b, d);
  let total = 0, shots = 0, seconds = 0;
  if (target === 'shot-video') {
    const q = db.prepare('SELECT duration, fps, video_resolution FROM drama_shots WHERE drama_id=? AND id=?');
    for (const id of ids) {
      const s = q.get(d.id, id);
      if (!s) continue;
      const vs = videoSpec(model, b, d, s);
      total += credits.computeCost(vs.duration, model);
      seconds += vs.duration;
      shots++;
    }
  } else {
    total = credits.imagePrice(model) * (spec ? spec.count : 1) * ids.length;
    shots = ids.length;
  }
  res.json({
    items: shots, cost: total, balance: credits.getBalance(req.user.id),
    enough: total <= credits.getBalance(req.user.id), free: model.is_free ? 1 : 0,
    per_unit: target === 'shot-video' ? null : credits.imagePrice(model) * (spec ? spec.count : 1),
    spec, seconds: target === 'shot-video' ? seconds : undefined
  });
}));

/* ---------- 文档解析与导入 ---------- */
function sniffKind(name, rows, text) {
  const n = String(name || '');
  if (rows && rows.length > 1) {
    const head = rows[0].map(x => String(x || '')).join('|');
    if (/镜号/.test(head) || /视频提示词/.test(head)) return 'shots';
    if (/类型/.test(head) && /名称/.test(head)) return 'entities';
  }
  if (rows && rows.length) {
    const head = rows[0].map(x => String(x || '')).join('|');
    if (/镜号/.test(head) || /视频提示词/.test(head)) return 'shots';
    if (/名称/.test(head)) return 'entities';
  }
  if (text && (/^第[0-9零一二三四五六七八九十百]{1,4}集/m.test(text) || /人物介绍|主要人物/.test(text) || text.length > 800)) return 'script';
  if (text && /画风/.test(text)) return 'styles';
  return 'unknown';
}

/* 上传 → 识别类型 → 结果暂存 tmp,返回 token;真正入库走 /import(避免大文本在前后端来回搬两趟) */
r.post('/parse', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw httpError(400, '没有收到文件');
  const p = req.file.path;
  const name = fixName(req.file.originalname);
  const ext = path.extname(name).toLowerCase();
  let out = { file: name, ext, size: req.file.size };
  try {
    if (ext === '.docx') {
      const lines = doc.docxLines(fs.readFileSync(p));
      const matrix = drama.parseStyleMatrix(lines);
      const isStyleDoc = /画风/.test(name) || matrix.length >= 2 && /各种全局提示词/.test(lines.join('\n'));
      if (isStyleDoc) out = Object.assign(out, { kind: 'styles', styles: matrix, preview: matrix.slice(0, 4).map(x => ({ style: x.style, slot: x.slot, chars: x.content.length })) });
      else out = Object.assign(out, { kind: 'script', script: lines.join('\n'), preview: lines.slice(0, 6), chars: lines.join('\n').length });
    } else if (ext === '.xlsx' || ext === '.xlsm') {
      const sheets = doc.xlsxSheets(fs.readFileSync(p));
      const rows = sheets[0].rows;
      const kind = sniffKind(name, rows, null);
      if (kind === 'shots') out = Object.assign(out, { kind, shots: drama.mapShotSheet(rows), preview: rows.slice(0, 3) });
      else if (kind === 'entities') out = Object.assign(out, { kind, entities: drama.mapEntitySheet(rows), preview: rows.slice(0, 3) });
      else throw httpError(400, '识别不出这张表的列(需要「镜号/集数/剧本原文/视频提示词/图片提示词/秒数/元素」或「类型/名称/生图提示词」)');
      out.sheets = sheets.map(s => ({ name: s.name, rows: s.rows.length }));
    } else if (ext === '.csv') {
      const text = fs.readFileSync(p, 'utf8').replace(/^/, '');
      const rows = text.split(/\r?\n/).filter(x => x.trim()).map(x => x.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
      const kind = sniffKind(name, rows, null);
      if (kind === 'shots') out = Object.assign(out, { kind, shots: drama.mapShotSheet(rows), preview: rows.slice(0, 3) });
      else if (kind === 'entities') out = Object.assign(out, { kind, entities: drama.mapEntitySheet(rows), preview: rows.slice(0, 3) });
      else out = Object.assign(out, { kind: 'script', script: text, preview: text.split(/\r?\n/).slice(0, 6), chars: text.length });
    } else if (ext === '.txt' || ext === '.md' || ext === '' || /^(text|application\/octet-stream)$/.test(req.file.mimetype)) {
      const text = fs.readFileSync(p, 'utf8').replace(/^/, '');
      out = Object.assign(out, { kind: sniffKind(null, null, text), script: text, preview: text.split(/\r?\n/).slice(0, 6), chars: text.length });
    } else {
      throw httpError(400, '不支持的文件类型:' + (ext || req.file.mimetype) + '(可用 .docx / .xlsx / .csv / .txt)');
    }
  } finally {
    /* 解析失败的临时文件立即清掉;成功的那份留在 token 目录里等 /import 消费 */
    if (!out.kind || out.kind === 'unknown') { try { fs.unlinkSync(p); } catch (e) { } }
  }
  if (out.kind === 'unknown') throw httpError(400, '没能从这份文件里识别出剧本、设定卡或分镜表');
  const token = uid('di-');
  const dir = path.join(DATA_DIR, 'tmp');
  fs.writeFileSync(path.join(dir, token + '.json'), JSON.stringify({
    kind: out.kind, script: out.script, entities: out.entities, shots: out.shots, styles: out.styles, file: name
  }));
  try { fs.unlinkSync(p); } catch (e) { }
  res.json({
    token, kind: out.kind, file: out.file, size: out.size, sheets: out.sheets,
    counts: {
      chars: out.script ? out.script.length : 0,
      entities: out.entities ? out.entities.length : 0,
      shots: out.shots ? out.shots.length : 0,
      styles: out.styles ? out.styles.length : 0
    },
    preview: out.preview || []
  });
}));

/* docx 上传时中文文件名要按 latin1 → utf8 还原(multer/busboy 的老问题,资产库那边同样处理) */
function fixName(raw) {
  const s = String(raw || '');
  try { return Buffer.from(s, 'latin1').toString('utf8'); } catch (e) { return s; }
}

r.post('/import', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const token = String(b.token || '');
  if (!/^di-[0-9a-f]{16}$/.test(token)) throw httpError(400, '导入凭证无效,请重新上传文件');
  const file = path.join(DATA_DIR, 'tmp', token + '.json');
  if (!fs.existsSync(file)) throw httpError(410, '这份解析结果已过期,请重新上传文件');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kind = String(b.kind || payload.kind);
  let d = null;
  if (kind === 'presets' || kind === 'styles') {
    if (!payload.styles || !payload.styles.length) throw httpError(400, '文件里没有画风提示词');
    let added = 0, kept = 0, replaced = 0;
    const have = db.prepare('SELECT * FROM prompt_presets WHERE style_name=? AND slot=?');
    const ins = db.prepare(`INSERT INTO prompt_presets(id,style_name,slot,content,negative,note,enabled,is_system,sort_index,created_at)
      VALUES(?,?,?,?,?,?,1,0,?,?)`);
    const upd = db.prepare('UPDATE prompt_presets SET content=?, negative=?, note=?, updated_at=? WHERE id=?');
    let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM prompt_presets').get().m) + 1;
    for (const s of payload.styles) {
      const hit = have.get(s.style, s.slot);
      if (!hit) { ins.run(uid('pm-'), s.style, s.slot, s.content, s.negative || '', s.note || '', sort++, now()); added++; }
      else if (b.replace) { upd.run(s.content, s.negative || '', s.note || '', now(), hit.id); replaced++; }
      else kept++;   /* 已有同画风同槽位:默认不动用户的版本,要覆盖请勾「替换已有」 */
    }
    fs.unlinkSync(file);
    res.json({ kind, added, replaced, kept, styles: [...new Set(payload.styles.map(x => x.style))] });
    return;
  }
  if (b.drama_id) d = assertAccess(req, String(b.drama_id));
  else {
    const id = uid('dr-');
    const title = String(b.title || '').trim().slice(0, 80) || (payload.file ? fixName(payload.file).replace(/\.[^.]+$/, '') : '导入的短剧');
    db.prepare(`INSERT INTO dramas(id,owner_id,title,script,script_chars,status,stage,progress,done_episodes,stats,created_at,updated_at)
      VALUES(?,?,?,?,?, 'draft','',0,'[]','{}',?,?)`)
      .run(id, req.user.id, title, kind === 'script' ? String(payload.script || '').slice(0, 400000) : '',
        kind === 'script' ? String(payload.script || '').length : 0, now(), now());
    d = db.prepare('SELECT * FROM dramas WHERE id=?').get(id);
  }
  let result = {};
  if (kind === 'script') {
    const text = String(payload.script || '').slice(0, 400000);
    if (!text.trim()) throw httpError(400, '文件里没有正文');
    /* 换剧本就是一次新的分析:旧的「已分析段落」标记必须一起清掉,否则会跳过没分析的新内容 */
    db.prepare('UPDATE dramas SET script=?, script_chars=?, title=?, done_episodes=?, progress=0, status=?, updated_at=? WHERE id=?')
      .run(text, text.length, d.title, '[]', 'draft', now(), d.id);
    if (b.replace) db.prepare('DELETE FROM drama_shots WHERE drama_id=?').run(d.id);
    result = { script_chars: text.length };
  } else if (kind === 'entities') {
    const items = payload.entities || [];
    let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_entities WHERE drama_id=?').get(d.id).m) + 1;
    let n = 0;
    if (b.replace) db.prepare('DELETE FROM drama_entities WHERE drama_id=?').run(d.id);
    const ins = db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,profile,prompt,sort_index,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const e of items) {
      const name = drama.nameCard(e);
      if (!name) continue;
      if (db.prepare('SELECT 1 FROM drama_entities WHERE drama_id=? AND name=?').get(d.id, name)) continue;
      ins.run(uid('de-'), d.id, e.kind || 'character', name, String(e.profile || '').slice(0, 1000), String(e.prompt || '').slice(0, 4000), sort++, now(), now());
      n++;
    }
    result = { entities: n };
  } else if (kind === 'shots') {
    const items = payload.shots || [];
    if (b.replace) db.prepare('DELETE FROM drama_shots WHERE drama_id=?').run(d.id);
    let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_shots WHERE drama_id=?').get(d.id).m) + 1;
    const ins = db.prepare(`INSERT INTO drama_shots(id,drama_id,episode_no,shot_no,script_text,image_prompt,video_prompt,duration,
      scene_ref,char_refs,end_state,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    /* 导入的分镜表带角色/场景全名,卡不存在就顺手建,否则「元素」点了没得跳 */
    const known = drama.knownCards(d.id);
    let ensureSort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_entities WHERE drama_id=?').get(d.id).m) + 1;
    const ensure = (name, kind2) => {
      if (!name || drama.findCard(known, name, kind2)) return;
      db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .run(uid('de-'), d.id, kind2, name, ensureSort++, now(), now());
      known.all.set(name, { name, kind: kind2 });
      known[kind2 === 'scene' ? 'scenes' : 'characters'].push(name);
    };
    for (const s of items) {
      ensure(s.scene_ref, 'scene');
      for (const c of s.char_refs || []) ensure(c, 'character');
      ins.run(uid('ds-'), d.id, s.episode_no, s.shot_no, s.script_text, s.image_prompt, s.video_prompt, s.duration,
        s.scene_ref, JSON.stringify(s.char_refs || []), s.end_state, sort++, now(), now());
    }
    result = { shots: items.length, episodes: [...new Set(items.map(x => x.episode_no))].length };
  } else {
    fs.unlinkSync(file);
    throw httpError(400, '未知的导入类型: ' + kind);
  }
  /* 剧本导入顺带把「分集标记」数出来告诉前端,用户立刻知道要跑多少段 */
  const fresh = db.prepare('SELECT * FROM dramas WHERE id=?').get(d.id);
  const units = fresh.script ? drama.splitEpisodes(fresh.script, 16000) : [];
  drama.refreshStats(d.id);
  fs.unlinkSync(file);
  res.json({
    drama_id: d.id, kind, ...result,
    episode_marks: [...new Set(units.map(u => u.episode_no))].length,
    units: units.length,
    drama: dramaBrief(db.prepare('SELECT * FROM dramas WHERE id=?').get(d.id))
  });
}));

/* 一键导入 data/workflow 参考数据(剧本 + 实体 + 分镜 + 画风库) */
r.post('/samples', asyncRoute(async (req, res) => {
  const dir = drama.workflowDir();
  if (!fs.existsSync(dir)) throw httpError(404, '样例目录不存在:' + dir + '(可把参考数据放到该目录,或用「导入文件」上传)');
  const find = (...names) => { for (const n of names) { const p = path.join(dir, n); if (fs.existsSync(p)) return p; } return null; };
  const scriptFile = find('剧本.docx', '剧本.txt');
  const entFile = find('分析-人物场景.xlsx', '分析-人物场景.csv');
  const shotFile = find('分析-分镜.xlsx', '分析-分镜.csv');
  const styleFile = find('各种全局提示词.docx');
  if (!scriptFile && !entFile && !shotFile) throw httpError(400, '目录里没有找到「剧本 / 分析-人物场景 / 分析-分镜」任一文件:' + dir);

  const b = req.body || {};
  const id = uid('dr-');
  let script = '';
  if (scriptFile) script = doc.docxText(fs.readFileSync(scriptFile)).slice(0, 400000);
  db.prepare(`INSERT INTO dramas(id,owner_id,project_id,title,brief,script,script_chars,status,stage,progress,done_episodes,stats,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?, 'ready','导入参考数据',100,'[]','{}',?,?)`)
    .run(id, req.user.id, b.project_id ? String(b.project_id) : null,
      String(b.title || '').trim().slice(0, 80) || (script ? (script.split('\n')[0] || '').trim().slice(0, 60) : '参考数据短剧'),
      '由 data/workflow 参考数据导入(其他平台分析好的成品),用于对照工作流的输出格式',
      script, script.length, now(), now());
  let entities = 0, shots = 0, styles = 0;
  if (entFile) {
    const rows = doc.xlsxSheets(fs.readFileSync(entFile))[0].rows;
    const items = drama.mapEntitySheet(rows);
    const ins = db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,profile,prompt,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);
    items.forEach((e, i) => ins.run(uid('de-'), id, e.kind, drama.nameCard(e), e.profile, e.prompt, i + 1, now(), now()));
    entities = items.length;
  }
  if (shotFile) {
    const rows = doc.xlsxSheets(fs.readFileSync(shotFile))[0].rows;
    const items = drama.mapShotSheet(rows);
    const ins = db.prepare(`INSERT INTO drama_shots(id,drama_id,episode_no,shot_no,script_text,image_prompt,video_prompt,duration,
      scene_ref,char_refs,end_state,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    items.forEach((s, i) => ins.run(uid('ds-'), id, s.episode_no, s.shot_no, s.script_text, s.image_prompt, s.video_prompt,
      s.duration, s.scene_ref, JSON.stringify(s.char_refs || []), s.end_state, i + 1, now(), now()));
    shots = items.length;
    if (!entities) {
      /* 只有分镜表时也要有卡:元素列就是卡名清单 */
      const known = new Map();
      const ins2 = db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`);
      let sort = 1;
      for (const s of items) {
        const list = (s.char_refs || []).map(n => [n, 'character']).concat(s.scene_ref ? [[s.scene_ref, 'scene']] : []);
        for (const [n, k] of list) { if (!known.has(n)) { ins2.run(uid('de-'), id, k, n, sort++, now(), now()); known.set(n, 1); } }
      }
      entities = known.size;
    }
  }
  if (styleFile) {
    const matrix = drama.parseStyleMatrix(doc.docxLines(fs.readFileSync(styleFile)));
    const have = new Set(db.prepare('SELECT style_name, slot FROM prompt_presets').all().map(x => x.style_name + '\u0000' + x.slot));
    const ins = db.prepare(`INSERT INTO prompt_presets(id,style_name,slot,content,negative,note,enabled,is_system,sort_index,created_at)
      VALUES(?,?,?,?,?,?,1,1,?,?)`);
    let sort = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM prompt_presets').get().m) + 1;
    for (const s of matrix) { if (!have.has(s.style + '\u0000' + s.slot)) { ins.run(uid('pm-'), s.style, s.slot, s.content, s.negative || '', s.note || '', sort++, now()); styles++; } }
  }
  /* 默认画风取「槽位最全」的那套:画风缺人物/视频槽位时组装会缺一块,选覆盖最广的更可用 */
  const best = db.prepare('SELECT style_name FROM prompt_presets GROUP BY style_name ORDER BY COUNT(*) DESC, MIN(sort_index) LIMIT 1').get();
  db.prepare('UPDATE dramas SET style=? WHERE id=? AND style=?').run(best ? best.style_name : '', id, '');
  const stats = drama.refreshStats(id);
  res.json({ drama_id: id, entities, shots, styles_added: styles, stats, dir, script_chars: script.length });
}));

module.exports = r;
