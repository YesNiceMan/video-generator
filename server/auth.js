'use strict';
// 会话认证:注册 / 登录 / 登出 / 中间件
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { uid, now, httpError } = require('./util');

const SESSION_DAYS = 7;
const COOKIE = 'vf_sid';

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    storage_quota: u.storage_quota, storage_used: u.storage_used,
    credits: u.credits || 0,
    banned: !!u.banned, created_at: u.created_at
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = now() + SESSION_DAYS * 86400 * 1000;
  db.prepare('INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(token, userId, now(), expires);
  return { token, expires };
}

function register({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, '邮箱格式不正确');
  if (!password || password.length < 6) throw httpError(400, '密码至少 6 位');
  name = String(name || '').trim().slice(0, 40);
  if (!name) name = email.split('@')[0];
  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (exists) throw httpError(409, '该邮箱已被注册');
  const id = uid('u-');
  let quota = 5;
  try { quota = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='defaultQuotaGB'").get()?.value || '5'); } catch (e) {}
  let freeCredits = 100;
  try {
    const { getSettings } = require('./db');
    freeCredits = Number(getSettings().freeCredits ?? 100);
  } catch (e) {}
  db.prepare('INSERT INTO users(id,email,password_hash,name,role,storage_quota,credits,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id, email, bcrypt.hashSync(password, 10), name, 'user', quota * 1024 ** 3, freeCredits, now());
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}

function login({ email, password }) {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) throw httpError(401, '邮箱或密码错误');
  if (u.banned) throw httpError(403, '账号已被禁用,请联系管理员');
  return publicUser(u);
}

function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
}

function getUserByToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (s.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!u || u.banned) return null;
  return u;
}

// Express 中间件:解析会话
function session(req, res, next) {
  const token = req.cookies?.[COOKIE] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  req.user = getUserByToken(token) || null;
  req.token = token;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(httpError(401, '请先登录'));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(httpError(401, '请先登录'));
  if (req.user.role !== 'admin') return next(httpError(403, '需要管理员权限'));
  next();
}

module.exports = { COOKIE, register, login, logout, createSession, publicUser, session, requireAuth, requireAdmin };
