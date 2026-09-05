'use strict';
// 用户积分 API:余额 / 消耗与发放流水 / 申请记录 / 申请积分
const { Router } = require('express');
const { requireAuth } = require('../auth');
const { asyncRoute, httpError, uid, now } = require('../util');
const { db } = require('../db');
const credits = require('../credits');

const r = Router();
r.use(requireAuth);

// 汇总:余额 + 定价 + 最近流水 + 我的申请
r.get('/', asyncRoute(async (req, res) => {
  const logs = db.prepare('SELECT * FROM credit_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
  const requests = db.prepare('SELECT * FROM credit_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json({
    balance: credits.getBalance(req.user.id),
    pricing: credits.pricing(),
    logs, requests,
    pending: requests.filter(x => x.status === 'pending').length
  });
}));

// 申请积分
r.post('/apply', asyncRoute(async (req, res) => {
  const amount = Math.round(Number(req.body.amount));
  if (!amount || amount < 1 || amount > 100000) throw httpError(400, '申请数量需为 1 ~ 100000 的整数');
  const openCount = db.prepare("SELECT COUNT(*) c FROM credit_requests WHERE user_id=? AND status='pending'").get(req.user.id).c;
  if (openCount >= 5) throw httpError(429, '已有过多待审批的申请,请等待管理员处理');
  const id = uid('cr-');
  db.prepare('INSERT INTO credit_requests(id,user_id,amount,reason,status,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, req.user.id, amount, String(req.body.reason || '').slice(0, 300), 'pending', now());
  res.json({ request: db.prepare('SELECT * FROM credit_requests WHERE id=?').get(id) });
}));

module.exports = r;
