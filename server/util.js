'use strict';
// 通用工具函数
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

function uid(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function now() {
  return Date.now();
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// 简单错误包装:路由内 throw httpError(...) 即可
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 安全的标签/名称清洗
function cleanTags(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',').map(s => s.trim());
  return [...new Set(arr.filter(Boolean))].slice(0, 20);
}

function clamp(v, min, max, def) {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

module.exports = { uid, now, httpError, asyncRoute, ensureDir, cleanTags, clamp };
