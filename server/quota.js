'use strict';
/* 免费额度余量(第三十九轮)
 * 额度总量登记在模型 rules.quota = { total, unit };unit 省略时按模型类型推断
 * (生图 = 张,视频 = 秒)。已用量只统计「经本平台提交且成功」的任务:直连网关的
 * 调用与控制台里的历史用量平台看不到,所以界面一律标注「平台内已消耗」,
 * 也不做余额拦截(超出由服务商自己拒,百炼已开「用完即停」)。
 */
const { db } = require('./db');

const UNIT_TEXT = { image: '张', second: '秒' };

/* rules.quota 合法则返回 { total, unit },否则 null */
function declaredQuota(model) {
  let q = null;
  try { q = JSON.parse(model.rules || '{}').quota; } catch (e) { return null; }
  const total = Math.floor(Number(q && q.total));
  if (!Number.isFinite(total) || total <= 0) return null;
  const unit = (q.unit === 'second' || q.unit === 'image') ? q.unit
    : (model.type === 'text-to-image' ? 'image' : 'second');
  return { total, unit };
}

function usedOf(unit, rows) {
  let n = 0;
  for (const r of rows) {
    let p = {};
    try { p = JSON.parse(r.params || '{}'); } catch (e) { continue; }
    if (unit === 'image') n += Math.max(1, Math.floor(Number(p.count) || 1));
    else n += Math.max(0, Math.floor(Number(p.duration != null ? p.duration : p.seconds) || 0));
  }
  return n;
}

/* 一批模型的余量 → Map(modelId → info);登记了额度的免费模型才查库,一次取回 */
function quotaIndex(models) {
  const out = new Map();
  const withQuota = [];
  for (const m of models) {
    if (!m || !m.is_free) continue;
    const q = declaredQuota(m);
    if (q) withQuota.push([m, q]);
  }
  if (!withQuota.length) return out;
  const ids = withQuota.map(([m]) => m.id);
  const rows = db.prepare(
    `SELECT model_id, params FROM tasks WHERE status='completed' AND model_id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);
  const byModel = new Map();
  for (const r of rows) {
    if (!byModel.has(r.model_id)) byModel.set(r.model_id, []);
    byModel.get(r.model_id).push(r);
  }
  for (const [m, q] of withQuota) {
    const used = usedOf(q.unit, byModel.get(m.id) || []);
    out.set(m.id, {
      declared: true, unit: q.unit, unit_text: UNIT_TEXT[q.unit],
      total: q.total, used, remaining: Math.max(0, q.total - used), exhausted: used >= q.total
    });
  }
  return out;
}

/* 单模型版:免费但未登记额度 → { declared:false },前端只显示「免费」 */
function freeQuota(model) {
  if (!model) return null;
  if (!model.is_free) return null;
  return quotaIndex([model]).get(model.id) || { declared: false };
}

module.exports = { declaredQuota, quotaIndex, freeQuota };
