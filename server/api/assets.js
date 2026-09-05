'use strict';
// 资产库 API:上传 / 文件夹 / 标签 / 预览 / 共享
const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now, cleanTags, ensureDir, clamp } = require('../util');
const { db, DATA_DIR, getSettings } = require('../db');
const { probe, makeThumb, FFMPEG } = require('../ffmpeg');

const r = Router();
r.use(requireAuth);

const UPLOADS = path.join(DATA_DIR, 'uploads');
const THUMBS = path.join(DATA_DIR, 'thumbs');
ensureDir(UPLOADS); ensureDir(THUMBS);

const TYPE_BY_MIME = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image', 'image/bmp': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video', 'video/x-msvideo': 'video',
  'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/x-wav': 'audio', 'audio/mp3': 'audio', 'audio/webm': 'audio'
};
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'weba'
};

// 资产分类(业务语义分类,与文件类型 type 相互独立)
const CATEGORIES = ['角色', '场景', '物品', '分镜', '音频', '视频'];

function normalizeCategory(v) {
  const s = String(v || '').trim();
  return CATEGORIES.includes(s) ? s : '';
}

/* 按文件名关键词自动分类:
   - 音/视频按类型归类
   - 图片按文件名关键词打分归类(角色/场景/物品/分镜)
   用于上传时自动归类与「自动分类」批量操作 */
const CATEGORY_KEYWORDS = {
  '角色': ['角色', '人物', '主角', '女主', '男主', '公主', '王子', '皇后', '太后', '太子', '少女', '少年', '老人', '士兵', '将军', '刺客', '侠客', '书生', '侠女', '公子', '小姐', '神仙', '精灵', '骑士', '国王', '肖像', '半身', '头像', '美人', '仙君', '掌门', '徒弟', '师父', '娘子', '相公', '丫鬟', '反派', '长老', '护卫', '猎人', '捕快', '神医', '诗人', '舞姬', '歌姬', 'person', 'character', 'portrait', 'avatar', 'hero', 'heroine', 'woman', 'man', 'girl', 'boy'],
  '场景': ['场景', '山', '海', '森林', '城市', '街道', '街头', '室内', '室外', '天空', '云', '沙漠', '雪', '湖', '河', '江', '田野', '草原', '天台', '屋顶', '宫殿', '城堡', '桥', '码头', '市场', '夜景', '日景', '清晨', '黄昏', '竹林', '树林', '瀑布', '客栈', '庭院', '花海', '星空', '雨', '海边', '湖畔', '城楼', '战场', '营地', '洞穴', '地宫', '雪山', '街巷', '小巷', '郊外', '庄园', '阁楼', '凉亭', '长廊', '园林', '桃源', 'scene', 'landscape', 'background', 'environment', 'street', 'city', 'room', 'mountain', 'sea', 'forest', 'sky', 'desert', 'castle', 'river', 'field'],
  '物品': ['物品', '道具', '剑', '刀', '枪', '盾', '弓', '箭', '杯', '壶', '瓶', '碗', '盘', '书', '信', '手机', '电脑', '车', '船', '桌', '椅', '灯', '花', '伞', '琴', '戒指', '玉', '令牌', '药', '香', '蜡烛', '珠宝', '面具', '扇子', '佩剑', '长枪', '弯刀', '战马', '马车', '瓷器', '画卷', '棋', '珠', '腰牌', '绣帕', '锦囊', '钱袋', '武器', '法宝', '仙器', '兵器', 'item', 'prop', 'weapon', 'sword', 'cup', 'book', 'phone', 'car', 'chair', 'lamp', 'flower', 'jewelry'],
  '分镜': ['分镜', '分镜图', '镜头', '概念图', '草图', '设定', '原画', '剧本', '画面', '分镜1', '分镜2', '分镜3', '分镜4', '分镜5', 'storyboard', 'frame', 'concept', 'sketch', 'design', 'story', 'script', 'shot']
};

function autoCategorize(name, type) {
  // 音/视频:按文件类型自动归类
  if (type === 'audio') return '音频';
  if (type === 'video') return '视频';
  if (type !== 'image') return '';
  const base = String(name || '')
    .replace(/\.[^.]+$/, '')   // 去扩展名
    .replace(/[_\-—\s（）()\[\]【】.]+/g, '') // 去掉分隔符
    .toLowerCase();
  if (!base) return '';
  let best = '', bestScore = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) {
      const k = kw.toLowerCase();
      if (base.includes(k)) {
        score += k.length >= 2 ? (k.length === 2 ? 1 : 2) : 1; // 短词权重低
      }
    }
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS, req.user.id);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uid('f-') + '.' + (EXT_BY_MIME[file.mimetype] || 'bin'))
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 ** 3 }, // 单文件最大 2GB
  fileFilter: (req, file, cb) => {
    if (!TYPE_BY_MIME[file.mimetype]) return cb(httpError(400, '不支持的文件类型:' + file.mimetype));
    cb(null, true);
  }
});

function assetJSON(a) {
  return { ...a, tags: JSON.parse(a.tags || '[]'), storage_path: undefined };
}

function assertCanRead(req, a) {
  if (!a) throw httpError(404, '资产不存在');
  if (a.owner_id === req.user.id) return;
  const share = db.prepare('SELECT * FROM asset_shares WHERE asset_id=? AND user_id=?').get(a.id, req.user.id);
  if (!share) throw httpError(403, '没有该资产的访问权限');
}

function assertCanEdit(req, a) {
  assertCanRead(req, a);
  if (a.owner_id !== req.user.id) {
    const share = db.prepare("SELECT * FROM asset_shares WHERE asset_id=? AND user_id=? AND permission='edit'").get(a.id, req.user.id);
    if (!share) throw httpError(403, '只有可编辑权限才能修改');
  }
}

function addStorage(userId, bytes) {
  db.prepare('UPDATE users SET storage_used = storage_used + ? WHERE id=?').run(bytes, userId);
}

/* 修复 multer/busboy 以 latin1 解析 UTF-8 文件名的乱码问题(中文文件名场景):
   还原后若出现 CJK 字符则采用还原结果,否则保持原名(不破坏 café 等拉丁字符) */
function decodeUploadName(name) {
  const s = String(name || '');
  if (!/[-ÿ]/.test(s)) return s;
  try {
    const decoded = Buffer.from(s, 'latin1').toString('utf8');
    if (/[一-鿿]/.test(decoded)) return decoded;
  } catch (e) { /* 忽略 */ }
  return s;
}

// ---------- 上传 ----------
r.post('/upload', upload.single('file'), asyncRoute(async (req, res) => {
  const file = req.file;
  if (!file) throw httpError(400, '未收到文件');
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const maxUpload = (getSettings().maxUploadMB || 2048) * 1024 ** 2;
  if (file.size > maxUpload) { fs.unlinkSync(file.path); throw httpError(400, '超出单文件大小上限'); }
  if (user.storage_used + file.size > user.storage_quota) {
    fs.unlinkSync(file.path);
    throw httpError(413, '存储配额不足,请清理或升级配额');
  }
  const type = TYPE_BY_MIME[file.mimetype];
  const info = probe(file.path);
  let thumbPath = null;
  if (type === 'video') {
    const t = path.join(THUMBS, uid('t-') + '.jpg');
    try { await makeThumb(file.path, t); thumbPath = t; } catch (e) {}
  }
  const id = uid('a-');
  const finalPath = path.join(UPLOADS, req.user.id, id + '.' + (EXT_BY_MIME[file.mimetype] || 'bin'));
  fs.renameSync(file.path, finalPath);
  const folderId = req.body.folder_id || null;
  if (folderId) {
    const f = db.prepare('SELECT * FROM folders WHERE id=? AND owner_id=?').get(folderId, req.user.id);
    if (!f) throw httpError(400, '目标文件夹不存在');
  }
  // 分类:优先取上传时指定,否则按文件类型 / 文件名关键词自动归类(角色/场景/物品/分镜/音频/视频)
  const originalName = decodeUploadName(file.originalname);
  const category = normalizeCategory(req.body.category) || autoCategorize(originalName, type);
  db.prepare(`INSERT INTO assets(id,owner_id,folder_id,type,name,size,mime,path,thumb_path,width,height,duration,tags,category,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, folderId, type, originalName, file.size, file.mimetype, finalPath, thumbPath, info.width, info.height, info.duration, JSON.stringify(cleanTags(req.body.tags)), category, now());
  addStorage(req.user.id, file.size);
  res.json({ asset: assetJSON(db.prepare('SELECT * FROM assets WHERE id=?').get(id)) });
}));

// 用户可访问的资产列表(自己 + 共享给我的)
r.get('/', asyncRoute(async (req, res) => {
  const { folder_id, type, q, tag, shared } = req.query;
  const params = [req.user.id];
  let sql = 'SELECT a.*, 0 AS is_shared FROM assets a WHERE a.owner_id=?';
  if (folder_id === 'root') { sql += ' AND a.folder_id IS NULL'; }
  else if (folder_id) { sql += ' AND a.folder_id=?'; params.push(folder_id); }
  if (type && type !== 'all') { sql += ' AND a.type=?'; params.push(type); }
  // 分类筛选:category=角色/场景/… 或 category=none(未分类)
  const cat = req.query.category;
  if (cat === 'none') { sql += " AND (a.category IS NULL OR a.category='')"; }
  else if (cat && cat !== 'all' && CATEGORIES.includes(cat)) { sql += ' AND a.category=?'; params.push(cat); }
  if (tag) { sql += ' AND a.tags LIKE ?'; params.push('%' + tag + '%'); }
  if (q) { sql += ' AND a.name LIKE ?'; params.push('%' + q + '%'); }
  if (shared === '1') {
    sql = `SELECT a.*, 1 AS is_shared FROM assets a JOIN asset_shares sh ON sh.asset_id=a.id WHERE sh.user_id=?`;
    params.length = 1;
    if (q) { sql += ' AND a.name LIKE ?'; params.push('%' + q + '%'); }
  }
  sql += ' ORDER BY a.created_at DESC';
  const rows = db.prepare(sql).all(...params).map(assetJSON);
  // 计算每项对我的权限
  const mine = new Set(db.prepare('SELECT id FROM assets WHERE owner_id=?').all(req.user.id).map(x => x.id));
  const sharedEditable = new Set(db.prepare("SELECT asset_id FROM asset_shares WHERE user_id=? AND permission='edit'").all(req.user.id).map(x => x.asset_id));
  res.json({ items: rows.map(a => ({ ...a, my_permission: mine.has(a.id) ? 'owner' : (sharedEditable.has(a.id) ? 'edit' : 'read') })) });
}));

r.get('/shared-with-me', asyncRoute(async (req, res) => {
  const rows = db.prepare(`SELECT a.*, sh.permission, sh.created_at AS shared_at, u.name AS shared_by_name
    FROM asset_shares sh JOIN assets a ON sh.asset_id=a.id JOIN users u ON u.id=a.owner_id
    WHERE sh.user_id=? ORDER BY sh.created_at DESC`).all(req.user.id).map(assetJSON);
  res.json({ items: rows });
}));

// 文件夹树
r.get('/folders', asyncRoute(async (req, res) => {
  const rows = db.prepare('SELECT * FROM folders WHERE owner_id=? ORDER BY name').all(req.user.id);
  res.json({ items: rows });
}));

r.post('/folders', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) throw httpError(400, '文件夹名称不能为空');
  const parent = req.body.parent_id || null;
  if (parent) {
    const p = db.prepare('SELECT * FROM folders WHERE id=? AND owner_id=?').get(parent, req.user.id);
    if (!p) throw httpError(400, '父文件夹不存在');
  }
  const id = uid('d-');
  db.prepare('INSERT INTO folders(id,owner_id,parent_id,name,created_at) VALUES(?,?,?,?,?)').run(id, req.user.id, parent, name, now());
  res.json({ folder: db.prepare('SELECT * FROM folders WHERE id=?').get(id) });
}));

r.patch('/folders/:id', asyncRoute(async (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=? AND owner_id=?').get(req.params.id, req.user.id);
  if (!f) throw httpError(404, '文件夹不存在');
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) throw httpError(400, '名称不能为空');
  db.prepare('UPDATE folders SET name=? WHERE id=?').run(name, f.id);
  res.json({ folder: db.prepare('SELECT * FROM folders WHERE id=?').get(f.id) });
}));

r.delete('/folders/:id', asyncRoute(async (req, res) => {
  const f = db.prepare('SELECT * FROM folders WHERE id=? AND owner_id=?').get(req.params.id, req.user.id);
  if (!f) throw httpError(404, '文件夹不存在');
  const count = db.prepare('SELECT COUNT(*) c FROM assets WHERE folder_id=?').get(f.id).c;
  if (count > 0) throw httpError(400, '文件夹非空,请先移出其中的资产');
  db.prepare('DELETE FROM folders WHERE id=?').run(f.id);
  res.json({ ok: true });
}));

// ---------- 资产操作 ----------
r.patch('/:id', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanEdit(req, a);
  const fields = {};
  if (req.body.name !== undefined) fields.name = String(req.body.name).trim().slice(0, 120) || a.name;
  if (req.body.tags !== undefined) fields.tags = JSON.stringify(cleanTags(req.body.tags));
  if (req.body.category !== undefined) fields.category = normalizeCategory(req.body.category);
  if (req.body.folder_id !== undefined) {
    const fid = req.body.folder_id || null;
    if (fid) {
      const f = db.prepare('SELECT * FROM folders WHERE id=? AND owner_id=?').get(fid, req.user.id);
      if (!f) throw httpError(400, '目标文件夹不存在');
    }
    fields.folder_id = fid;
  }
  for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE assets SET ${k}=? WHERE id=?`).run(v, a.id);
  res.json({ asset: assetJSON(db.prepare('SELECT * FROM assets WHERE id=?').get(a.id)) });
}));

// 批量删除:删除选中的资产(本人或可编辑权限;删除文件并扣减存储)
r.post('/batch-delete', asyncRoute(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(x => typeof x === 'string').slice(0, 100) : [];
  if (!ids.length) throw httpError(400, '未选择任何资产');
  let deleted = 0, errors = 0;
  for (const id of ids) {
    try {
      const a = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
      if (!a) continue;
      assertCanEdit(req, a);
      try { fs.unlinkSync(a.path); } catch (e) {}
      try { if (a.thumb_path) fs.unlinkSync(a.thumb_path); } catch (e) {}
      db.prepare('DELETE FROM assets WHERE id=?').run(a.id);
      if (a.owner_id === req.user.id) {
        db.prepare('UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id=?').run(a.size, a.owner_id);
      }
      deleted++;
    } catch (e) { errors++; }
  }
  res.json({ ok: true, deleted, errors });
}));

// 批量分类:把选中的资产设为同一分类
r.post('/batch-category', asyncRoute(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) throw httpError(400, '未选择任何资产');
  const category = normalizeCategory(req.body.category);
  let updated = 0;
  for (const id of ids) {
    const a = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
    try { assertCanEdit(req, a); } catch (e) { continue; }
    db.prepare('UPDATE assets SET category=? WHERE id=?').run(category, a.id);
    updated++;
  }
  res.json({ ok: true, updated, category });
}));

// 自动分类:按文件类型/文件名关键词给未分类(或指定 ids)的资产自动归类
r.post('/auto-categorize', asyncRoute(async (req, res) => {
  const force = !!req.body.force;
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(x => typeof x === 'string') : null;
  let rows;
  if (ids && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    rows = db.prepare('SELECT * FROM assets WHERE owner_id=? AND id IN (' + placeholders + ')').all(req.user.id, ...ids);
  } else {
    rows = force
      ? db.prepare('SELECT * FROM assets WHERE owner_id=?').all(req.user.id)
      : db.prepare("SELECT * FROM assets WHERE owner_id=? AND (category IS NULL OR category='')").all(req.user.id);
  }
  const summary = {};
  let updated = 0;
  for (const a of rows) {
    const cat = autoCategorize(a.name, a.type);
    if (!cat || cat === a.category) continue;
    db.prepare('UPDATE assets SET category=? WHERE id=?').run(cat, a.id);
    updated++;
    summary[cat] = (summary[cat] || 0) + 1;
  }
  res.json({ ok: true, updated, summary, scanned: rows.length });
}));

r.delete('/:id', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanEdit(req, a);
  try { fs.unlinkSync(a.path); } catch (e) {}
  try { if (a.thumb_path) fs.unlinkSync(a.thumb_path); } catch (e) {}
  db.prepare('DELETE FROM assets WHERE id=?').run(a.id);
  if (a.owner_id === req.user.id) {
    db.prepare('UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id=?').run(a.size, a.owner_id);
  }
  res.json({ ok: true });
}));

// 共享
r.post('/:id/share', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanRead(req, a);
  const target = req.body.user_id
    ? db.prepare('SELECT * FROM users WHERE id=?').get(req.body.user_id)
    : db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').trim().toLowerCase());
  if (!target) throw httpError(404, '目标用户不存在');
  if (target.id === a.owner_id) throw httpError(400, '不能共享给自己');
  const permission = req.body.permission === 'edit' ? 'edit' : 'read';
  db.prepare(`INSERT INTO asset_shares(id,asset_id,user_id,permission,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(asset_id,user_id) DO UPDATE SET permission=excluded.permission`)
    .run(uid('s-'), a.id, target.id, permission, now());
  res.json({ ok: true, shared_with: target.email, permission });
}));

r.delete('/:id/share/:userId', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanRead(req, a);
  db.prepare('DELETE FROM asset_shares WHERE asset_id=? AND user_id=?').run(a.id, req.params.userId);
  res.json({ ok: true });
}));

r.get('/:id/shares', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanRead(req, a);
  const rows = db.prepare(`SELECT sh.permission, sh.created_at, u.id AS user_id, u.email, u.name FROM asset_shares sh JOIN users u ON u.id=sh.user_id WHERE sh.asset_id=?`).all(a.id);
  res.json({ items: rows });
}));

// ---------- 文件服务 ----------
r.get('/:id/file', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanRead(req, a);
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.name)}"`);
  fs.createReadStream(a.path).pipe(res);
}));

r.get('/:id/thumbnail', asyncRoute(async (req, res) => {
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  assertCanRead(req, a);
  if (a.type === 'image') return res.redirect('/api/assets/' + a.id + '/file');
  let tp = a.thumb_path;
  if (!tp && a.type === 'video') {
    const t = path.join(THUMBS, uid('t-') + '.jpg');
    try { await makeThumb(a.path, t); db.prepare('UPDATE assets SET thumb_path=? WHERE id=?').run(t, a.id); tp = t; } catch (e) { return res.status(404).end(); }
  }
  if (!tp) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'max-age=3600');
  fs.createReadStream(tp).pipe(res);
}));

module.exports = r;
