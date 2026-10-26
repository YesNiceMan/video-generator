'use strict';
const { Router } = require('express');
const { register, login, logout, createSession, publicUser, COOKIE, requireAuth } = require('../auth');
const { asyncRoute, httpError } = require('../util');
const { db } = require('../db');

const r = Router();

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400 * 1000, path: '/'
  });
}

r.post('/register', asyncRoute(async (req, res) => {
  const user = register(req.body || {});
  const { token } = createSession(user.id);
  setCookie(res, token);
  res.json({ user });
}));

r.post('/login', asyncRoute(async (req, res) => {
  const user = login(req.body || {});
  const { token } = createSession(user.id);
  setCookie(res, token);
  res.json({ user });
}));

r.post('/logout', asyncRoute(async (req, res) => {
  logout(req.token);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
}));

r.get('/me', asyncRoute(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(u) });
}));

// 站内通知:带上任务所属项目/分集，前端才能直接跳到那一集（此前只能落到项目分集列表）
r.get('/notifications', requireAuth, asyncRoute(async (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, t.project_id AS task_project_id, t.episode_id AS task_episode_id
    FROM notifications n LEFT JOIN tasks t ON t.id = n.task_id
    WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 30`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c;
  res.json({ items: rows, unread });
}));

r.post('/notifications/read', requireAuth, asyncRoute(async (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND read=0").run(req.user.id);
  res.json({ ok: true });
}));

module.exports = r;
