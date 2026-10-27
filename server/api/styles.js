'use strict';
// 风格库 API + 模型列表
const { Router } = require('express');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now, cleanTags } = require('../util');
const { db } = require('../db');

const r = Router();
r.use(requireAuth);

// 模型列表(user 仅能看到已启用;API Key 不回传明文)
r.get('/models', asyncRoute(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const sql = isAdmin ? 'SELECT * FROM models ORDER BY created_at' : 'SELECT * FROM models WHERE enabled=1 ORDER BY created_at';
  const { parseRules, detectProtocol } = require('../adapters');
  const img = require('../imagegen');
  const txt = require('../textgen');
  const { quotaIndex } = require('../quota');
  const all = db.prepare(sql).all();
  /* 免费额度余量(第三十九轮):一次统计全部模型的「平台内已消耗」 */
  const qIdx = quotaIndex(all);
  const rows = all.map(m => {
    /* 生图模型按生图协议暴露能力 / 档位 / 尺寸形态:分镜工作台的快捷生图与生图页共用这份模型表,
       此前只带视频适配器的 protocol 且没有 caps,弹窗里连「参考图」都不出现 */
    const isImg = m.type === 'text-to-image';
    /* 文本模型(第四十二轮)同样不能走视频适配器探测,否则后台会把 openai-chat 标成 Agnes/openai-video */
    const isText = m.type === 'text-generation';
    return {
      ...m, params_schema: JSON.parse(m.params_schema || '[]'),
      rules: parseRules(m),
      protocol: isImg ? undefined : (isText ? txt.detectProtocol(m) : detectProtocol(m)),
      ...(isImg ? img.imageSpecMeta(m) : {}),
      free_quota: qIdx.get(m.id) || (m.is_free ? { declared: false } : null),
      api_key: undefined, has_api_key: !!m.api_key, api_key_tail: m.api_key ? m.api_key.slice(-4) : ''
    };
  });
  res.json({ items: rows });
}));

// 风格列表:公开 + 自己私有
r.get('/', asyncRoute(async (req, res) => {
  const { category, tag, q, mine } = req.query;
  const params = [req.user.id];
  let sql = `SELECT s.*, u.name AS author_name FROM styles s JOIN users u ON u.id=s.author_id
    WHERE (s.visibility='public' OR s.author_id=?)`;
  if (mine === '1') sql += ' AND s.author_id=?';
  if (category) { sql += ' AND s.category=?'; params.push(category); }
  if (tag) { sql += ' AND s.tags LIKE ?'; params.push('%' + tag + '%'); }
  if (q) { sql += ' AND s.name LIKE ?'; params.push('%' + q + '%'); }
  sql += ' ORDER BY s.favorites_count DESC, s.created_at DESC';
  const favs = new Set(db.prepare('SELECT style_id FROM style_favorites WHERE user_id=?').all(req.user.id).map(x => x.style_id));
  const rows = db.prepare(sql).all(...params).map(s => ({
    ...s, tags: JSON.parse(s.tags || '[]'), params: JSON.parse(s.params || '{}'),
    is_favorite: favs.has(s.id), can_edit: s.author_id === req.user.id || req.user.role === 'admin'
  }));
  res.json({ items: rows });
}));

r.get('/categories', asyncRoute(async (req, res) => {
  const rows = db.prepare("SELECT DISTINCT category FROM styles ORDER BY category").all();
  res.json({ items: rows.map(x => x.category) });
}));

// 新建风格
r.post('/', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw httpError(400, '风格名称不能为空');
  if (b.model_id) {
    const m = db.prepare('SELECT * FROM models WHERE id=?').get(b.model_id);
    if (!m || !m.enabled) throw httpError(400, '关联模型不存在或已禁用');
  }
  const id = uid('s-');
  db.prepare(`INSERT INTO styles(id,name,description,category,model_id,prompt_template,negative_prompt,params,preview_asset_id,tags,visibility,author_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, name, String(b.description || '').slice(0, 300), String(b.category || '通用').slice(0, 20),
      b.model_id || null, String(b.prompt_template || ''), String(b.negative_prompt || ''),
      JSON.stringify(b.params || {}), b.preview_asset_id || null, JSON.stringify(cleanTags(b.tags)),
      b.visibility === 'private' ? 'private' : 'public', req.user.id, now());
  res.json({ style: db.prepare('SELECT * FROM styles WHERE id=?').get(id) });
}));

function assertStyleAccess(req, s) {
  if (!s) throw httpError(404, '风格不存在');
  if (s.visibility === 'private' && s.author_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, '无权访问该风格');
}

r.patch('/:id', asyncRoute(async (req, res) => {
  const s = db.prepare('SELECT * FROM styles WHERE id=?').get(req.params.id);
  assertStyleAccess(req, s);
  if (s.author_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, '只有作者或管理员可以编辑');
  const b = req.body || {};
  const sets = [], params = [];
  const fields = {
    name: v => String(v).trim().slice(0, 60), description: v => String(v).slice(0, 300), category: v => String(v).slice(0, 20),
    prompt_template: v => String(v), negative_prompt: v => String(v),
    model_id: v => v || null, preview_asset_id: v => v || null,
    visibility: v => (v === 'private' ? 'private' : 'public')
  };
  for (const [k, fn] of Object.entries(fields)) {
    if (b[k] !== undefined) { sets.push(`${k}=?`); params.push(fn(b[k])); }
  }
  if (b.tags !== undefined) { sets.push('tags=?'); params.push(JSON.stringify(cleanTags(b.tags))); }
  if (b.params !== undefined) { sets.push('params=?'); params.push(JSON.stringify(b.params || {})); }
  if (sets.length) { params.push(s.id); db.prepare(`UPDATE styles SET ${sets.join(',')} WHERE id=?`).run(...params); }
  res.json({ style: db.prepare('SELECT * FROM styles WHERE id=?').get(s.id) });
}));

r.delete('/:id', asyncRoute(async (req, res) => {
  const s = db.prepare('SELECT * FROM styles WHERE id=?').get(req.params.id);
  assertStyleAccess(req, s);
  if (s.author_id !== req.user.id && req.user.role !== 'admin') throw httpError(403, '只有作者或管理员可以删除');
  db.prepare('DELETE FROM styles WHERE id=?').run(s.id);
  res.json({ ok: true });
}));

// 批量删除风格(仅作者或管理员可删)
r.post('/batch-delete', asyncRoute(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(x => typeof x === 'string').slice(0, 100) : [];
  if (!ids.length) throw httpError(400, '未选择任何风格');
  let deleted = 0, errors = 0;
  for (const id of ids) {
    try {
      const s = db.prepare('SELECT * FROM styles WHERE id=?').get(id);
      if (!s) continue;
      assertStyleAccess(req, s);
      if (s.author_id !== req.user.id && req.user.role !== 'admin') continue;
      db.prepare('DELETE FROM styles WHERE id=?').run(s.id);
      deleted++;
    } catch (e) { errors++; }
  }
  res.json({ ok: true, deleted, errors });
}));

// 收藏
r.post('/:id/favorite', asyncRoute(async (req, res) => {
  const s = db.prepare('SELECT * FROM styles WHERE id=?').get(req.params.id);
  assertStyleAccess(req, s);
  db.prepare('INSERT OR IGNORE INTO style_favorites(user_id,style_id,created_at) VALUES(?,?,?)').run(req.user.id, s.id, now());
  db.prepare('UPDATE styles SET favorites_count = (SELECT COUNT(*) FROM style_favorites WHERE style_id=?) WHERE id=?').run(s.id, s.id);
  res.json({ ok: true, favorites_count: db.prepare('SELECT favorites_count FROM styles WHERE id=?').get(s.id).favorites_count });
}));

r.delete('/:id/favorite', asyncRoute(async (req, res) => {
  const s = db.prepare('SELECT * FROM styles WHERE id=?').get(req.params.id);
  if (s) {
    db.prepare('DELETE FROM style_favorites WHERE user_id=? AND style_id=?').run(req.user.id, s.id);
    db.prepare('UPDATE styles SET favorites_count = (SELECT COUNT(*) FROM style_favorites WHERE style_id=?) WHERE id=?').run(s.id, s.id);
  }
  res.json({ ok: true });
}));

module.exports = r;
