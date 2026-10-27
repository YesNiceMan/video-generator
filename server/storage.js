'use strict';
/* 素材文件落库路径。
   库里只存相对 DATA_DIR 的键(uploads/u-x/a-y.png,统一正斜杠),读取时再按当前机器解析成绝对路径。
   这样 data/ 换机器或换目录(macOS 开发 → Windows 运行)后,历史资产仍能定位到文件。 */
const path = require('path');
const fs = require('fs');
const { db, DATA_DIR } = require('./db');

const ROOTS = ['uploads', 'thumbs', 'generated', 'exports', 'tmp'];

/* 任意写法(绝对/相对/Windows 反斜杠)→ DATA_DIR 相对键;不在已知子树内的原样返回 */
function toKey(p) {
  if (!p) return p;
  const s = String(p).replace(/\\/g, '/');
  for (const root of ROOTS) {
    const i = s.lastIndexOf('/' + root + '/');
    if (i >= 0) return s.slice(i + 1);
  }
  return s;
}

/* 库里存的键(或历史绝对路径)→ 当前机器的绝对路径 */
function toAbs(p) {
  if (!p) return p;
  const key = toKey(p);
  if (/^[a-z]:[\\/]/i.test(key) || key.startsWith('/')) return key;
  return path.join(DATA_DIR, ...key.split('/').filter(Boolean));
}

function exists(p) {
  const abs = toAbs(p);
  return !!abs && fs.existsSync(abs);
}

function remove(p) {
  try { fs.unlinkSync(toAbs(p)); return true; } catch (e) { return false; }
}

/* 把文件作为 HTTP 响应流出去;文件缺失或读失败只影响这一条请求,不让 stream error 打断进程 */
function streamFile(res, storedPath, { mime, name, attachment } = {}) {
  const abs = toAbs(storedPath);
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).json({ error: '素材文件不存在,可能未随 data/ 目录一起迁移' });
  }
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  if (name || attachment) {
    res.setHeader('Content-Disposition', `${attachment ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name || path.basename(abs))}"`);
  }
  const stream = fs.createReadStream(abs);
  stream.on('error', err => {
    console.error(`[stream] ${err.code || 'ERR'} ${abs}`);
    if (!res.headersSent) res.status(500).json({ error: '素材读取失败' });
    else res.destroy();
  });
  stream.pipe(res);
}

/* 读出的资产行 → path/thumb_path 换成当前机器的绝对路径,供 ffmpeg、适配器直接使用 */
function hydrate(a) {
  if (a) {
    if (a.path != null) a.path = toAbs(a.path);
    if (a.thumb_path != null) a.thumb_path = toAbs(a.thumb_path);
  }
  return a;
}

/* 下发给前端的资产摘要:服务器存储键不外泄,缩略图换成可直接引用的 URL */
function assetBrief(a) {
  if (!a) return a;
  const out = { ...a, thumb_path: a.thumb_path ? `/api/assets/${a.id}/thumbnail` : null };
  delete out.path;
  return out;
}

/* 一次性迁移:把历史遗留的绝对路径改写为相对键(库外路径保持原样) */
function migrateStoredPaths() {
  let moved = 0;
  const upd = db.prepare('UPDATE assets SET path=?, thumb_path=? WHERE id=?');
  for (const a of db.prepare('SELECT id,path,thumb_path FROM assets').all()) {
    const key = toKey(a.path);
    const thumbKey = a.thumb_path ? toKey(a.thumb_path) : a.thumb_path;
    if (key !== a.path || thumbKey !== a.thumb_path) {
      upd.run(key, thumbKey, a.id);
      moved++;
    }
  }
  if (moved) console.log(`[storage] 资产路径已迁存为相对键:${moved} 条(data 目录: ${DATA_DIR})`);
  return moved;
}

module.exports = { toKey, toAbs, exists, remove, streamFile, assetBrief, hydrate, migrateStoredPaths };
