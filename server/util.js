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

/* 网关排队/限流(HTTP 429/502/503/504,如 Agnes 的 video_queue_full)是可恢复状态:
   抛带 retryable 标记的错误,由 worker 延迟重投,而不是占用任务槽原地干等 */
const BUSY_STATUS = [429, 502, 503, 504];

function busyError(status, detail, holdMs) {
  const e = new Error('创建任务失败(HTTP ' + status + '): ' + detail);
  e.retryable = true;
  e.holdMs = Math.max(0, Math.min(Number(holdMs) || 0, 300e3));
  return e;
}

/* Retry-After 头(秒或 HTTP 日期),没有则返回 0 由调用方走退避阶梯 */
function retryAfterMs(res) {
  try {
    const h = res.headers && res.headers.get && res.headers.get('retry-after');
    if (!h) return 0;
    const n = Number(h);
    if (Number.isFinite(n) && n > 0) return n * 1000;
    const d = Date.parse(h);
    return Number.isNaN(d) ? 0 : d - Date.now();
  } catch (e) { return 0; }
}

module.exports = { uid, now, httpError, asyncRoute, ensureDir, cleanTags, clamp, BUSY_STATUS, busyError, retryAfterMs };
