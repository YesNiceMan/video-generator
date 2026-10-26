'use strict';
// 应用入口:Express 服务器 + 静态资源 + API 路由 + 任务队列
const path = require('path');
const express = require('express');
const { session } = require('./auth');
const { httpError } = require('./util');
const { recover, pump } = require('./worker');

const app = express();
const PORT = Number(process.env.PORT || 3088);

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 简易 cookie 解析
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) req.cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  next();
});

app.use(session);

// API 路由
app.use('/api/auth', require('./api/auth'));
app.use('/api/assets', require('./api/assets'));
app.use('/api/styles', require('./api/styles'));
app.use('/api/tasks', require('./api/tasks'));
app.use('/api/images', require('./api/images')); // 第二十五轮:AI 生图
app.use('/api/credits', require('./api/credits'));
app.use('/api', require('./api/projects'));
app.use('/api/admin', require('./api/admin'));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// 签名素材直链:供 Agnes 等在线视频服务公网拉取本站图片(限时 HMAC 令牌,见 server/agnes.js)
const { verifyAssetToken } = require('./agnes');
const { db } = require('./db');
const fs = require('fs');
app.get('/api/open/assets/:id/file', (req, res) => {
  const { exp, sig } = req.query;
  if (!verifyAssetToken(req.params.id, exp, sig)) return res.status(403).json({ error: '签名无效或已过期' });
  const a = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
  if (!a || !fs.existsSync(a.path)) return res.status(404).json({ error: '资产不存在' });
  res.setHeader('Content-Type', a.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=600');
  fs.createReadStream(a.path).pipe(res);
});

// 静态资源(前端)
app.use(express.static(path.join(__dirname, '..', 'public')));

// 错误处理
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

// 任务队列恢复与启动
recover();
pump();
setInterval(pump, 2000).unref();

app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  视频生成平台已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log('  管理员:   admin@videoforge.cn / admin123');
  console.log('  演示用户: demo@videoforge.cn / demo123');
  console.log('==============================================');
});
