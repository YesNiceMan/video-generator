'use strict';
// 分集管理 API:项目 → 分集 → 场景 → 片段,复制与导出
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now, clamp } = require('../util');
const { db, genProjectCode, getSettings, DATA_DIR } = require('../db');
const { exportEpisode } = require('../ffmpeg');
const storage = require('../storage');

const r = Router();

/* 平台配置(登录用户可读):生成视频尺寸白名单,分镜工作台据此渲染分辨率选项 */
r.get('/config', requireAuth, asyncRoute(async (req, res) => {
  const s = getSettings();
  const list = Array.isArray(s.videoResolutions) && s.videoResolutions.length ? s.videoResolutions : ['480p', '720p', '960p', '2k'];
  res.json({
    videoResolutions: list,
    defaultResolution: list.includes('720p') ? '720p' : list[0],
    /* 第三十三轮:项目级出片规格的可选项(与前端 COMMON_FPS / 画幅下拉保持一致) */
    aspectRatios: PROJECT_RATIOS,
    fpsOptions: PROJECT_FPS,
    /* 第二十五轮:生图每张积分定价(前端快捷生图弹窗计价展示用) */
    creditPerImage: Math.max(0, Number(s.creditPerImage ?? 2)),
    /* 第四十二轮:文本处理每次积分(前端剧本工具条计价展示用) */
    creditPerText: Math.max(0, Number(s.creditPerText ?? 1))
  });
}));

/* ---------- 项目级出片规格(第三十三轮 · 项目优化 26·5) ----------
   建项目时就定好 帧率 / 画幅比例 / 分辨率 / 单镜时长;分镜工作台新增分镜按这套参数初始化。
   名单在前端(common.js 的 COMMON_FPS / ProjectsView 的画幅下拉)有同一份,校验口径以此处为准 */
const PROJECT_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', '3:2', '2:3'];
const PROJECT_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 60];
const SPEC_DEFAULT = { fps: 30, aspect_ratio: '16:9', resolution: '720p', shot_duration: 10 };

function resolutionList() {
  const list = Array.isArray(getSettings().videoResolutions) && getSettings().videoResolutions.length
    ? getSettings().videoResolutions : ['480p', '720p', '960p', '2k'];
  return list;
}

/* 逐项校验:非法值回退到默认(分辨率默认优先取白名单里的 720p) */
function normSpec(raw, cur) {
  cur = cur || {};
  const resList = resolutionList();
  const out = {};
  if (raw.fps !== undefined) {
    const f = Number(raw.fps);
    out.fps = PROJECT_FPS.includes(f) ? f : Number(cur.fps) || SPEC_DEFAULT.fps;
  }
  if (raw.aspect_ratio !== undefined) {
    const a = String(raw.aspect_ratio || '').trim();
    out.aspect_ratio = PROJECT_RATIOS.includes(a) ? a : (PROJECT_RATIOS.includes(cur.aspect_ratio) ? cur.aspect_ratio : SPEC_DEFAULT.aspect_ratio);
  }
  if (raw.resolution !== undefined) {
    const rv = String(raw.resolution || '').trim();
    out.resolution = resList.includes(rv) ? rv
      : (resList.includes(cur.resolution) ? cur.resolution
        : (resList.includes('720p') ? '720p' : resList[0]));
  }
  if (raw.shot_duration !== undefined) {
    /* 3–15s:与分镜卡「时长」下拉档位一致 */
    out.shot_duration = clamp(Number(raw.shot_duration), 3, 15, Number(cur.shot_duration) || SPEC_DEFAULT.shot_duration);
  }
  return out;
}

const EXPORTS = path.join(DATA_DIR, 'exports');
fs.mkdirSync(EXPORTS, { recursive: true });

function isMember(projectId, userId) {
  return !!db.prepare('SELECT 1 FROM project_members WHERE project_id=? AND user_id=?').get(projectId, userId);
}

/* 带成员标记的项目行 */
function projectRow(p, userId) {
  const owner = p.owner_id === userId;
  return {
    ...p,
    my_role: owner ? 'owner' : (isMember(p.id, userId) ? 'member' : null),
    member_count: db.prepare('SELECT COUNT(*) c FROM project_members WHERE project_id=?').get(p.id).c
  };
}

function projectWithTree(projectId) {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId);
  if (!p) return null;
  const episodes = db.prepare('SELECT * FROM episodes WHERE project_id=? ORDER BY order_index').all(projectId);
  for (const ep of episodes) {
    ep.scenes = db.prepare('SELECT * FROM scenes WHERE episode_id=? ORDER BY order_index').all(ep.id);
    for (const sc of ep.scenes) {
      sc.clips = db.prepare(`SELECT c.*, a.name AS asset_name, a.type AS asset_type, a.thumb_path
        FROM clips c LEFT JOIN assets a ON a.id=c.asset_id WHERE c.scene_id=? ORDER BY c.order_index`).all(sc.id)
        .map(c => ({ ...c, thumb_path: c.asset_id && c.thumb_path ? `/api/assets/${c.asset_id}/thumbnail` : null }));
    }
  }
  p.episodes = episodes;
  return p;
}

function assertProjectOwner(req, p) {
  if (!req.user) throw httpError(401, '请先登录');
  if (!p) throw httpError(404, '项目不存在');
  if (p.owner_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, '无权访问该项目');
}

/* 访问权限:房主 / 成员 / 管理员 */
function assertProjectAccess(req, p) {
  if (!req.user) throw httpError(401, '请先登录');
  if (!p) throw httpError(404, '项目不存在');
  if (p.owner_id === req.user.id || req.user.role === 'admin' || isMember(p.id, req.user.id)) return;
  throw httpError(403, '无权访问该项目,可向房主索取邀请码加入');
}

/* 编辑权限:房主 / 管理员 / 成员(成员可协作分集与任务,不可删除项目) */
function assertProjectEdit(req, p) {
  assertProjectAccess(req, p);
}

// ---------- 项目 ----------
// 列表:我拥有的 + 我加入的
r.get('/projects', requireAuth, asyncRoute(async (req, res) => {
  const rows = db.prepare(`SELECT DISTINCT p.*,
      (SELECT COUNT(*) FROM episodes e WHERE e.project_id=p.id) AS episode_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count
    FROM projects p
    LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=?
    WHERE p.owner_id=? OR m.user_id=?
    ORDER BY p.created_at DESC`).all(req.user.id, req.user.id, req.user.id);
  res.json({ items: rows.map(p => projectRow(p, req.user.id)) });
}));

r.post('/projects', requireAuth, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) throw httpError(400, '项目名称不能为空');
  const id = uid('p-');
  // 唯一邀请码
  let code; let tries = 0;
  do { code = genProjectCode(); tries++; } while (tries < 30 && db.prepare('SELECT 1 FROM projects WHERE code=?').get(code));
  /* 出片规格:未传则用默认(30fps / 16:9 / 720p / 10s),分辨率默认对齐后台白名单 */
  const spec = normSpec(req.body || {}, { resolution: resolutionList().includes('720p') ? '720p' : resolutionList()[0] });
  db.prepare(`INSERT INTO projects(id,owner_id,name,description,cover_asset_id,code,fps,aspect_ratio,resolution,shot_duration,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, name, String(req.body.description || '').slice(0, 500), req.body.cover_asset_id || null, code,
      spec.fps != null ? spec.fps : SPEC_DEFAULT.fps,
      spec.aspect_ratio || SPEC_DEFAULT.aspect_ratio,
      spec.resolution || (resolutionList().includes('720p') ? '720p' : resolutionList()[0]),
      spec.shot_duration != null ? spec.shot_duration : SPEC_DEFAULT.shot_duration,
      now());
  res.json({ project: { ...projectWithTree(id), ...projectRow(db.prepare('SELECT * FROM projects WHERE id=?').get(id), req.user.id) } });
}));

/* 通过邀请码加入项目 */
r.post('/projects/join', requireAuth, asyncRoute(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  if (!code) throw httpError(400, '请输入项目邀请码');
  const p = db.prepare('SELECT * FROM projects WHERE UPPER(code)=?').get(code);
  if (!p) throw httpError(404, '邀请码无效:未找到对应项目');
  if (p.owner_id === req.user.id) return res.json({ project: projectRow(p, req.user.id), already: true, as: 'owner' });
  if (isMember(p.id, req.user.id)) return res.json({ project: projectRow(p, req.user.id), already: true, as: 'member' });
  db.prepare('INSERT INTO project_members(id,project_id,user_id,created_at) VALUES(?,?,?,?)').run(uid('pm-'), p.id, req.user.id, now());
  res.json({ project: projectRow(p, req.user.id), as: 'member' });
}));

/* 项目成员列表(房主/管理员可见) */
r.get('/projects/:id/members', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  assertProjectOwner(req, p);
  const rows = db.prepare(`SELECT u.id, u.email, u.name, pm.created_at AS joined_at FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=? ORDER BY pm.created_at DESC`).all(p.id);
  res.json({ items: rows });
}));

/* 成员退出项目 */
r.post('/projects/:id/leave', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!p) throw httpError(404, '项目不存在');
  if (p.owner_id === req.user.id) throw httpError(400, '房主不能退出自己的项目');
  const info = db.prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(p.id, req.user.id);
  if (!info.changes) throw httpError(404, '你不是该项目成员');
  res.json({ ok: true });
}));

r.get('/projects/:id', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  assertProjectAccess(req, p);
  res.json({ project: { ...projectWithTree(p.id), ...projectRow(p, req.user.id) } });
}));

r.patch('/projects/:id', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  assertProjectOwner(req, p);
  const b = req.body || {};
  if (b.name !== undefined) db.prepare('UPDATE projects SET name=? WHERE id=?').run(String(b.name).trim().slice(0, 80), p.id);
  if (b.description !== undefined) db.prepare('UPDATE projects SET description=? WHERE id=?').run(String(b.description).slice(0, 500), p.id);
  if (b.cover_asset_id !== undefined) db.prepare('UPDATE projects SET cover_asset_id=? WHERE id=?').run(b.cover_asset_id || null, p.id);
  /* 房主可轮换邀请码 */
  if (b.rotate_code) {
    let code; let tries = 0;
    do { code = genProjectCode(); tries++; } while (tries < 30 && db.prepare('SELECT 1 FROM projects WHERE code=?').get(code));
    db.prepare('UPDATE projects SET code=? WHERE id=?').run(code, p.id);
  }
  /* 出片规格(帧率 / 画幅比例 / 分辨率 / 单镜时长):改后对该项目后续新增的分镜生效 */
  const spec = normSpec(b, p);
  for (const [k, v] of Object.entries(spec)) db.prepare(`UPDATE projects SET ${k}=? WHERE id=?`).run(v, p.id);
  res.json({ project: { ...projectWithTree(p.id), ...projectRow(db.prepare('SELECT * FROM projects WHERE id=?').get(p.id), req.user.id) } });
}));

r.delete('/projects/:id', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  assertProjectOwner(req, p);
  db.prepare('DELETE FROM projects WHERE id=?').run(p.id);
  res.json({ ok: true });
}));

// 批量删除项目(仅本人创建的或被授权编辑的项目;管理元数据,资产文件保留)
r.post('/projects/batch-delete', requireAuth, asyncRoute(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(x => typeof x === 'string').slice(0, 100) : [];
  if (!ids.length) throw httpError(400, '未选择任何项目');
  let deleted = 0, errors = 0;
  for (const id of ids) {
    try {
      const p = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
      if (!p) continue;
      assertProjectOwner(req, p);
      db.prepare('DELETE FROM projects WHERE id=?').run(p.id);
      deleted++;
    } catch (e) { errors++; }
  }
  res.json({ ok: true, deleted, errors });
}));

// ---------- 分集 ----------
r.post('/projects/:id/episodes', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  assertProjectOwner(req, p);
  const title = String(req.body.title || '').trim().slice(0, 80);
  if (!title) throw httpError(400, '分集标题不能为空');
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) m FROM episodes WHERE project_id=?').get(p.id).m;
  const id = uid('e-');
  db.prepare('INSERT INTO episodes(id,project_id,title,order_index,created_at) VALUES(?,?,?,?,?)').run(id, p.id, title, maxOrder + 1, now());
  res.json({ episode: db.prepare('SELECT * FROM episodes WHERE id=?').get(id) });
}));

function assertEpisodeOwner(req, ep) {
  if (!req.user) throw httpError(401, '请先登录');
  if (!ep) throw httpError(404, '分集不存在');
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(ep.project_id);
  assertProjectEdit(req, p);
}

r.patch('/episodes/:id', requireAuth, asyncRoute(async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
  assertEpisodeOwner(req, ep);
  if (req.body.title !== undefined) db.prepare('UPDATE episodes SET title=? WHERE id=?').run(String(req.body.title).trim().slice(0, 80), ep.id);
  if (req.body.script !== undefined) db.prepare('UPDATE episodes SET script=? WHERE id=?').run(String(req.body.script).slice(0, 20000), ep.id);
  if (req.body.order_index !== undefined) db.prepare('UPDATE episodes SET order_index=? WHERE id=?').run(Number(req.body.order_index), ep.id);
  res.json({ episode: db.prepare('SELECT * FROM episodes WHERE id=?').get(ep.id) });
}));

r.delete('/episodes/:id', requireAuth, asyncRoute(async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
  assertEpisodeOwner(req, ep);
  db.prepare('DELETE FROM episodes WHERE id=?').run(ep.id);
  res.json({ ok: true });
}));

/* ---------- 分镜工作台工作记录(自动保存) ----------
   GET  读取;PUT 常规保存;POST 兼容 sendBeacon 离开页面时的兜底上报 */
function readStudioState(ep) {
  if (!ep.studio_state) return null;
  try {
    const v = JSON.parse(ep.studio_state);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
}

r.get('/episodes/:id/studio', requireAuth, asyncRoute(async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
  assertEpisodeOwner(req, ep);
  res.json({ state: readStudioState(ep), saved_at: ep.studio_saved_at || null });
}));

function saveStudioState(req, ep) {
  const s = req.body && req.body.state;
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw httpError(400, '无效的工作记录');
  const json = JSON.stringify(s);
  if (json.length > 200 * 1024) throw httpError(413, '工作记录过大,无法保存');
  db.prepare('UPDATE episodes SET studio_state=?, studio_saved_at=? WHERE id=?').run(json, now(), ep.id);
}

r.put('/episodes/:id/studio', requireAuth, asyncRoute(async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
  assertEpisodeOwner(req, ep);
  saveStudioState(req, ep);
  const fresh = db.prepare('SELECT studio_saved_at FROM episodes WHERE id=?').get(ep.id);
  res.json({ ok: true, saved_at: fresh.studio_saved_at });
}));

r.post('/episodes/:id/studio', requireAuth, asyncRoute(async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
  assertEpisodeOwner(req, ep);
  saveStudioState(req, ep);
  res.json({ ok: true });
}));

// ---------- 场景 ----------
r.post('/episodes/:id/scenes', requireAuth, asyncRoute(async (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(req.params.id);
  assertEpisodeOwner(req, ep);
  const title = String(req.body.title || '').trim().slice(0, 80) || '新场景';
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) m FROM scenes WHERE episode_id=?').get(ep.id).m;
  const id = uid('sc-');
  db.prepare('INSERT INTO scenes(id,episode_id,title,order_index,created_at) VALUES(?,?,?,?,?)').run(id, ep.id, title, maxOrder + 1, now());
  res.json({ scene: db.prepare('SELECT * FROM scenes WHERE id=?').get(id) });
}));

function assertSceneOwner(req, sc) {
  if (!req.user) throw httpError(401, '请先登录');
  if (!sc) throw httpError(404, '场景不存在');
  const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(sc.episode_id);
  assertEpisodeOwner(req, ep);
}

r.patch('/scenes/:id', requireAuth, asyncRoute(async (req, res) => {
  const sc = db.prepare('SELECT * FROM scenes WHERE id=?').get(req.params.id);
  assertSceneOwner(req, sc);
  if (req.body.title !== undefined) db.prepare('UPDATE scenes SET title=? WHERE id=?').run(String(req.body.title).trim().slice(0, 80), sc.id);
  if (req.body.order_index !== undefined) db.prepare('UPDATE scenes SET order_index=? WHERE id=?').run(Number(req.body.order_index), sc.id);
  res.json({ scene: db.prepare('SELECT * FROM scenes WHERE id=?').get(sc.id) });
}));

r.delete('/scenes/:id', requireAuth, asyncRoute(async (req, res) => {
  const sc = db.prepare('SELECT * FROM scenes WHERE id=?').get(req.params.id);
  assertSceneOwner(req, sc);
  db.prepare('DELETE FROM scenes WHERE id=?').run(sc.id);
  res.json({ ok: true });
}));

// 跨分集复制场景(含片段)
r.post('/scenes/:id/copy', requireAuth, asyncRoute(async (req, res) => {
  const sc = db.prepare('SELECT * FROM scenes WHERE id=?').get(req.params.id);
  assertSceneOwner(req, sc);
  const targetEpisodeId = req.body.episode_id;
  const targetEp = db.prepare('SELECT * FROM episodes WHERE id=?').get(targetEpisodeId);
  assertEpisodeOwner(req, targetEp);
  const sourceEp = db.prepare('SELECT * FROM episodes WHERE id=?').get(sc.episode_id);
  if (sourceEp.project_id !== targetEp.project_id) throw httpError(400, '只能复制到同一项目的其他分集');
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) m FROM scenes WHERE episode_id=?').get(targetEp.id).m;
  const newId = uid('sc-');
  db.prepare('INSERT INTO scenes(id,episode_id,title,order_index,created_at) VALUES(?,?,?,?,?)').run(newId, targetEp.id, sc.title + '(副本)', maxOrder + 1, now());
  const clips = db.prepare('SELECT * FROM clips WHERE scene_id=? ORDER BY order_index').all(sc.id);
  const insClip = db.prepare('INSERT INTO clips(id,scene_id,title,asset_id,duration,order_index,created_at) VALUES(?,?,?,?,?,?,?)');
  for (const c of clips) insClip.run(uid('c-'), newId, c.title, c.asset_id, c.duration, c.order_index, now());
  res.json({ scene: db.prepare('SELECT * FROM scenes WHERE id=?').get(newId) });
}));

// ---------- 片段 ----------
r.post('/scenes/:id/clips', requireAuth, asyncRoute(async (req, res) => {
  const sc = db.prepare('SELECT * FROM scenes WHERE id=?').get(req.params.id);
  assertSceneOwner(req, sc);
  const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(req.body.asset_id);
  if (!asset) throw httpError(404, '资产不存在');
  if (asset.owner_id !== req.user.id && !db.prepare('SELECT 1 FROM asset_shares WHERE asset_id=? AND user_id=?').get(asset.id, req.user.id)) {
    throw httpError(403, '无权使用该资产');
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) m FROM clips WHERE scene_id=?').get(sc.id).m;
  const id = uid('c-');
  db.prepare('INSERT INTO clips(id,scene_id,title,asset_id,duration,order_index,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, sc.id, String(req.body.title || '').slice(0, 80), asset.id,
      clamp(Number(req.body.duration), 0.5, 600, asset.duration || 5), maxOrder + 1, now());
  res.json({ clip: db.prepare('SELECT * FROM clips WHERE id=?').get(id) });
}));

function assertClipOwner(req, c) {
  if (!req.user) throw httpError(401, '请先登录');
  if (!c) throw httpError(404, '片段不存在');
  const sc = db.prepare('SELECT * FROM scenes WHERE id=?').get(c.scene_id);
  assertSceneOwner(req, sc);
}

r.patch('/clips/:id', requireAuth, asyncRoute(async (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id);
  assertClipOwner(req, c);
  if (req.body.title !== undefined) db.prepare('UPDATE clips SET title=? WHERE id=?').run(String(req.body.title).slice(0, 80), c.id);
  if (req.body.duration !== undefined) db.prepare('UPDATE clips SET duration=? WHERE id=?').run(clamp(Number(req.body.duration), 0.5, 600, c.duration), c.id);
  if (req.body.order_index !== undefined) db.prepare('UPDATE clips SET order_index=? WHERE id=?').run(Number(req.body.order_index), c.id);
  res.json({ clip: db.prepare('SELECT * FROM clips WHERE id=?').get(c.id) });
}));

r.delete('/clips/:id', requireAuth, asyncRoute(async (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id);
  assertClipOwner(req, c);
  db.prepare('DELETE FROM clips WHERE id=?').run(c.id);
  res.json({ ok: true });
}));

// ---------- 导出(单集/整季) ----------
r.get('/projects/:id/export', requireAuth, asyncRoute(async (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  assertProjectAccess(req, p);
  const episodeId = req.query.episode_id || null;
  const all = req.query.all === '1';
  let episodes = db.prepare('SELECT * FROM episodes WHERE project_id=? ORDER BY order_index').all(p.id);
  if (episodeId) episodes = episodes.filter(e => e.id === episodeId);
  if (!episodes.length) throw httpError(400, '没有可分集');

  const clips = [];
  for (const ep of episodes) {
    const rows = db.prepare(`SELECT c.duration, a.path, a.type FROM clips c JOIN scenes s ON c.scene_id=s.id JOIN assets a ON a.id=c.asset_id
      WHERE s.episode_id=? ORDER BY s.order_index, c.order_index`).all(ep.id);
    for (const c of rows) clips.push({ path: storage.toAbs(c.path), duration: c.duration, type: c.type });
  }
  if (!clips.length) throw httpError(400, '所选分集没有可导出的片段');
  const missing = clips.filter(c => !storage.exists(c.path));
  if (missing.length) throw httpError(400, `${missing.length}/${clips.length} 个片段的素材文件不在 ${DATA_DIR} 下(跨机器迁移请一并复制 data/ 目录)`);

  const width = clamp(Number(req.query.width) || 1920, 640, 3840, 1920);
  const height = clamp(Number(req.query.height) || 1080, 360, 2160, 1080);
  const outFile = path.join(EXPORTS, `${p.id}_${episodeId || 'season'}_${Date.now()}.mp4`);
  await exportEpisode({ clips, output: outFile, width, height });
  storage.streamFile(res, outFile, { mime: 'video/mp4', attachment: true, name: (episodeId ? '分集' : '整季') + '_' + p.name + '.mp4' });
}));

module.exports = r;
