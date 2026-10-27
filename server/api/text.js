'use strict';
/* 文本处理 API(第四十二轮 · 剧本与文字)
 * 只暴露内置任务枚举(task),提示词模板在服务端 —— 这个端点不是通用 LLM 代理。
 * 调用同步完成(秒级~十几秒),不进视频/生图队列;但每次都会落一条 tasks 记录,
 * 让后台「任务监控」看得到失败原因与耗时,失败自动退分。 */
const { Router } = require('express');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now } = require('../util');
const { db, getSettings } = require('../db');
const credits = require('../credits');
const textgen = require('../textgen');

const r = Router();
r.use(requireAuth);

function pickModel(modelId) {
  if (modelId) {
    const m = db.prepare('SELECT * FROM models WHERE id=?').get(String(modelId));
    if (!m) throw httpError(400, '模型不存在');
    if (m.type !== 'text-generation') throw httpError(400, '「' + m.name + '」不是文本模型(类型应为 文本处理)');
    if (!m.enabled) throw httpError(400, '该模型已被禁用');
    return m;
  }
  const defId = String(getSettings().defaultTextModel || '');
  const byDef = defId ? db.prepare("SELECT * FROM models WHERE id=? AND enabled=1 AND type='text-generation'").get(defId) : null;
  const m = byDef || db.prepare("SELECT * FROM models WHERE enabled=1 AND type='text-generation' ORDER BY created_at").get();
  if (!m) throw httpError(400, '还没有可用的文本模型：请在后台「模型管理」添加一个类型为「文本处理」的模型');
  return m;
}

/* 可用文本模型 + 支持的处理类型(前端渲染菜单用) */
r.get('/models', asyncRoute(async (req, res) => {
  const rows = db.prepare("SELECT * FROM models WHERE type='text-generation' AND enabled=1 ORDER BY created_at").all();
  const items = rows.map(m => ({
    id: m.id, name: m.name, model_id: m.model_id, api_base: m.api_base, version: m.version,
    is_free: m.is_free, enabled: m.enabled, has_api_key: !!m.api_key, api_key_tail: m.api_key ? m.api_key.slice(-4) : '',
    price_per_call: textgen.pricePerCall(m),
    max_chars: (textgen.normalizeRules(m).limits || {}).max_chars || 20000
  }));
  res.json({
    items,
    tasks: textgen.TASK_IDS.map(id => ({ id, label: textgen.TASKS[id].label, json: !!textgen.TASKS[id].json })),
    perCall: textgen.pricePerCall(null),
    /* 前端「当前模型」的显示依据:管理员设的默认,没设就是列表第一个启用的 */
    defaultModelId: String(getSettings().defaultTextModel || '') || (items[0] ? items[0].id : '')
  });
}));

r.post('/complete', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const task = String(b.task || '');
  if (!textgen.TASKS[task]) throw httpError(400, '未知的处理类型: ' + (task || '(空)'));
  const text = String(b.text || '').trim();
  if (!text) throw httpError(400, '请输入要处理的文本');
  const model = pickModel(b.model_id);
  if (!model.api_base || !model.api_key) {
    throw httpError(400, '「' + model.name + '」是文本模型，但管理员还未配置 API 地址或 Key');
  }
  const maxChars = (textgen.normalizeRules(model).limits || {}).max_chars || 20000;
  if (text.length > maxChars) throw httpError(400, '文本过长(' + text.length + ' 字)，该模型上限 ' + maxChars + ' 字，请分段处理');

  const perCall = textgen.pricePerCall(model);
  const id = uid('t-');
  if (perCall > 0 && !credits.deduct(req.user.id, perCall, '文本处理 · ' + textgen.TASKS[task].label, id)) {
    throw httpError(402, '积分不足：本次需 ' + perCall + ' 积分，当前余额 ' + credits.getBalance(req.user.id));
  }
  const began = Date.now();
  let out = null, fail = null;
  try {
    out = await textgen.runTask(model, task, text, { context: b.context });
  } catch (e) {
    fail = e;
  }
  const params = {
    task, engine: 'textgen', chars_in: text.length,
    chars_out: out ? (out.chars_out || 0) : 0,
    shots: out && out.kind === 'shots' ? out.shots.length : undefined,
    usage: out ? out.usage : null, ms: Date.now() - began
  };
  db.prepare(`INSERT INTO tasks(id,user_id,type,model_id,params,prompt,status,progress,cost,created_at,started_at,finished_at,error,result_asset_ids,linked_asset_ids)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, 'text-generation', model.id, JSON.stringify(params), text.slice(0, 2000),
      out ? 'completed' : 'failed', out ? 100 : 0, perCall, began, began, Date.now(),
      fail ? String(fail.message || fail).slice(0, 500) : null, '[]', '[]');
  if (fail) {
    /* 失败必须把钱退回去:文本调用没产出对用户没有价值 */
    if (perCall > 0) credits.refundTask(id, '文本处理失败');
    throw httpError(502, '文本处理失败：' + (fail.message || String(fail)));
  }
  res.json({
    ok: true, task_id: id, result: out,
    model: { id: model.id, name: model.name },
    credits: { cost: perCall, perCall, balance: credits.getBalance(req.user.id) }
  });
}));

module.exports = r;
