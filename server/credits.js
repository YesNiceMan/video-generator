'use strict';
// 积分体系核心:计价 / 扣减 / 退还 / 发放 / 流水
const { db, getSettings } = require('./db');
const { uid, now } = require('./util');

/* 读取积分定价设置 */
function pricing() {
  const s = getSettings();
  return {
    perSecond: Number(s.creditPerSecond ?? 5),
    overrides: s.creditOverrides && typeof s.creditOverrides === 'object' ? s.creditOverrides : {},
    freeCredits: Number(s.freeCredits ?? 100)
  };
}

/* 计算某段时长的任务消耗积分数
   优先级:免费模型恒 0 → 模型专属每秒单价(后台模型管理设置,>0 时生效) → 段时长覆盖价 → 全局每秒单价向上取整 */
function computeCost(durationSec, model) {
  if (model && model.is_free) return 0;
  const dur = Math.max(1, Math.round(Number(durationSec) || 5));
  /* 模型专属「每秒积分消耗」:管理员为该模型单独定价,按 秒数×单价 向上取整,忽略全局段时长覆盖价 */
  const modelPerSecond = model ? Number(model.credit_per_second) || 0 : 0;
  if (modelPerSecond > 0) return Math.max(1, Math.ceil(dur * modelPerSecond));
  const p = pricing();
  const key = String(dur);
  if (p.overrides[key] !== undefined) return Math.max(0, Math.round(Number(p.overrides[key]) || 0));
  return Math.max(1, Math.ceil(dur * p.perSecond));
}

function getBalance(userId) {
  const u = db.prepare('SELECT credits FROM users WHERE id=?').get(userId);
  return u ? (u.credits || 0) : 0;
}

/* 记录流水(不修改余额) */
function log(userId, delta, reason, taskId) {
  const balance = getBalance(userId);
  db.prepare('INSERT INTO credit_logs(id,user_id,delta,balance,reason,task_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(uid('cl-'), userId, delta, balance, String(reason || '').slice(0, 200), taskId || null, now());
}

/* 扣减积分(余额不足返回 false) */
function deduct(userId, amount, reason, taskId) {
  if (!amount || amount <= 0) return true;
  const r = db.prepare('UPDATE users SET credits=credits-? WHERE id=? AND credits>=?').run(amount, userId, amount);
  if (!r.changes) return false;
  log(userId, -amount, reason, taskId);
  return true;
}

/* 发放/增加积分(可为负做管理员调整) */
function grant(userId, amount, reason, taskId) {
  if (!amount) return;
  db.prepare('UPDATE users SET credits=MAX(0, credits+?) WHERE id=?').run(amount, userId);
  log(userId, amount, reason, taskId);
}

/* 任务失败/取消后的积分退还(每个任务只退一次) */
function refundTask(taskId, reasonPrefix) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!t || !t.cost || t.cost <= 0 || t.refunded) return false;
  db.prepare('UPDATE tasks SET refunded=1 WHERE id=?').run(taskId);
  grant(t.user_id, t.cost, `${reasonPrefix} #${t.id.slice(0, 8)} 积分退还`, taskId);
  return true;
}

module.exports = { pricing, computeCost, getBalance, deduct, grant, refundTask, log };
