'use strict';
/* 第三十六轮回归:视频网关「排队已满」自动延后重投
 *
 * 覆盖 server/worker.js 的 failTask(队列级延后重投)+ server/util.js 的 retryable 约定:
 *   A. 503 video_queue_full ×2 → 任务回 queued 并带 next_at(不判死/不退款/不写 error),疏通后成功入库
 *   B. 网关回 Retry-After → 按网关提示延后,而不是模型阶梯
 *   C. 持续 503 且等待预算耗尽 → 才终态失败,积分只退一次、模型失败计数只 +1
 *   D. 延后等待期间取消 → 保持 cancelled,不被 pump 复活
 *
 * 用独立 DATA_DIR + 端口 3188 起一份全新库和服务器,不碰常驻服务的队列与数据。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3188;
const BASE = 'http://127.0.0.1:' + PORT + '/api';
const FF = path.join(ROOT, 'tools', 'ffmpeg');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-round36-'));
process.env.DATA_DIR = DATA;            /* 本进程 require 到的 db 也指向隔离库 */
const { db } = require('../server/db');

let PASS = 0, FAIL = 0;
const ok = (c, label, extra) => {
  if (c) { PASS++; console.log('  ✓ ' + label); }
  else { FAIL++; console.log('  ✗ ' + label + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 240) : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Mock 网关:按 prompt 前缀决定 503 次数 ---------- */
const SAMPLE_MP4 = path.join(DATA, 'sample.mp4');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=320x180:d=0.6 -pix_fmt yuv420p -c:v libx264 "${SAMPLE_MP4}"`);
const SRC_PNG = path.join(DATA, 'src.png');
execSync(`${FF} -y -loglevel error -f lavfi -i gradients=s=480x270 -frames:v 1 "${SRC_PNG}"`);

const hits = {}, polls = {};
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);
let MOCKPORT = 0;
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const j = JSON.parse(body || '{}');
      const p = String(j.prompt || '');
      const n = bump(hits, p);
      const busy = /^ALWAYS/.test(p)
        || (/^RETRY_AFTER/.test(p) && n === 1)
        || (/^(THEN_OK|CANCEL)/.test(p) && n <= 2);
      if (busy) {
        const headers = { 'Content-Type': 'application/json' };
        if (/^RETRY_AFTER/.test(p)) headers['Retry-After'] = '2';   /* 网关自己说等多久 */
        res.writeHead(503, headers);
        return res.end(JSON.stringify({ code: 'video_queue_full', message: '视频队列已满，请稍后重试' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'task_mock_' + p.slice(0, 12), object: 'video' }));
    });
    return;
  }
  if (req.method === 'GET' && u.pathname === '/agnesapi') {
    const n = bump(polls, u.searchParams.get('video_id') || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(n < 2
      ? { status: 'in_progress', progress: 20 }
      : { status: 'completed', progress: 100, url: 'http://127.0.0.1:' + MOCKPORT + '/clip.mp4' }));
  }
  if (req.method === 'GET' && u.pathname === '/clip.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return fs.createReadStream(SAMPLE_MP4).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{}');
});

/* ---------- API 客户端 ---------- */
let cookie = '';
async function api(method, p, body, isForm, fd) {
  const init = { method, headers: {} };
  if (cookie) init.headers.Cookie = cookie;
  if (isForm) init.body = fd;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + p, init);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, json, text, headers: res };
}
async function login() {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  cookie = ((res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get('set-cookie')) || '').split(';')[0];
  return res.ok && !!cookie;
}
async function uploadSrc(name) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(SRC_PNG)], { type: 'image/png' }), name);
  fd.append('category', '分镜');
  return api('POST', '/assets/upload', undefined, true, fd);
}
async function untilTask(id, pred, ms) {
  const end = Date.now() + ms;
  let task = null;
  while (Date.now() < end) {
    const r = await api('GET', '/tasks/' + id);
    task = r.json && r.json.task;
    if (task && pred(task)) return task;
    await wait(150);
  }
  return task;
}
const isDone = t => ['completed', 'failed', 'cancelled'].includes(t.status);
const isWaiting = t => t.status === 'queued' && t.next_at > Date.now();

/* 配置模型:指向 Mock 网关 + 排队重投节奏 */
async function configureModel(busy, extra) {
  const rules = Object.assign({ protocol: 'agnes-flash', limits: { fixed_size: '720P', min_seconds: 4, max_seconds: 12, max_images: 5 }, busy }, extra || {});
  const r = await api('PATCH', '/admin/models/m-agnes-flash', {
    api_base: 'http://127.0.0.1:' + MOCKPORT + '/v1',
    api_key: 'sk-mock-busy',
    model_id: 'agnes-video-2.5-flash',
    credit_per_second: 5,
    rules: JSON.stringify(rules)
  });
  if (!r.json || !r.json.model) throw new Error('模型配置失败:' + r.text.slice(0, 200));
  return r.json.model;
}
const credits = () => db.prepare("SELECT credits FROM users WHERE email='admin@videoforge.cn'").get().credits;

(async () => {
  console.log('== 隔离数据目录 ' + DATA + '(Mock 网关 + 服务器端口 ' + PORT + ')==');
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  MOCKPORT = mock.address().port;

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => process.stderr.write('[server] ' + d));
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:' + PORT + '/api/health')).ok) { healthy = true; break; } } catch (e) {}
    await wait(250);
  }
  if (!healthy) { console.log('✗ 服务器未能启动'); child.kill(); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(1); }

  try {
    ok(await login(), '管理员登录');
    /* 种子里 Agnes 是 is_free=1,计费场景需要按秒扣分 */
    db.prepare("UPDATE models SET is_free=0 WHERE id='m-agnes-flash'").run();

    const up = await uploadSrc('busy-src.png');
    ok(!!(up.json && up.json.asset), '上传源图', up.text);
    const SRC = up.json.asset.id;

    /* ---------- A. 排队两次后成功 ---------- */
    console.log('\n-- 场景 A:503 video_queue_full ×2 → 自动延后重投 → 成功入库 --');
    await configureModel({ hold_ms: [4000, 2000], budget_ms: 60000 });
    const subA = await api('POST', '/tasks', {
      model_id: 'm-agnes-flash', use_asset_id: SRC, prompt: 'THEN_OK_a',
      param_duration: 4, param_resolution: '720p', param_aspect_ratio: '16:9'
    });
    const idA = subA.json && subA.json.task && subA.json.task.id;
    ok(!!idA, '任务已提交', subA.text);
    const waitA = await untilTask(idA, isWaiting, 20000);
    ok(!!(waitA && isWaiting(waitA)), '回到 queued 且 next_at 在未来', waitA && { s: waitA.status, next_at: waitA.next_at });
    ok(!!(waitA && waitA.params.busy_attempts >= 1), 'params.busy_attempts 记录自动重试次数', waitA && waitA.params);
    ok(!!(waitA && !waitA.error), '等待期间不写 error(不当成失败)', waitA && waitA.error);
    ok(!!(waitA && waitA.refunded === 0), '等待期间不退积分', waitA && waitA.refunded);
    const balA1 = credits();
    const doneA = await untilTask(idA, isDone, 60000);
    ok(doneA && doneA.status === 'completed', '最终 completed', doneA && { s: doneA.status, e: doneA.error });
    ok(doneA && doneA.params.busy_attempts === 2, '共自动重试 2 次', doneA && doneA.params);
    ok(doneA && /^task_mock_/.test(doneA.params.remote_video_id || ''), '远端任务 ID 已记录', doneA && doneA.params);
    const assetA = doneA && db.prepare('SELECT * FROM assets WHERE id=?').get(doneA.result_asset_id);
    ok(!!assetA && assetA.type === 'video' && assetA.width === 320, '成片入库 320×180', assetA && { w: assetA.width, h: assetA.height });
    ok(doneA && !doneA.next_at, '开跑后 next_at 已清空', doneA && doneA.next_at);
    ok(credits() === balA1, '成功任务不退款也不重复扣分', { bal: credits() });

    /* ---------- B. Retry-After 优先于阶梯 ---------- */
    console.log('\n-- 场景 B:网关 Retry-After: 2 → 按 2s 延后(阶梯配 9s 不生效)--');
    await configureModel({ hold_ms: [9000], budget_ms: 60000 });
    const idB = (await api('POST', '/tasks', { model_id: 'm-agnes-flash', use_asset_id: SRC, prompt: 'RETRY_AFTER_b', param_duration: 4 })).json.task.id;
    const waitB = await untilTask(idB, isWaiting, 20000);
    const delta = waitB ? waitB.next_at - Date.now() : -1;
    ok(waitB && delta > 0 && delta < 6000, '延后取 Retry-After 提示', { delta_ms: Math.round(delta) });
    const doneB = await untilTask(idB, isDone, 60000);
    ok(doneB && doneB.status === 'completed', 'B 场景最终成功', doneB && { s: doneB.status, e: doneB.error });

    /* ---------- C. 预算耗尽才判死 ---------- */
    console.log('\n-- 场景 C:持续 503 + 预算 5s → 终态失败,积分只退一次 --');
    await configureModel({ hold_ms: [2000], budget_ms: 5000 });
    const before = credits();
    const subC = await api('POST', '/tasks', { model_id: 'm-agnes-flash', use_asset_id: SRC, prompt: 'ALWAYS_c', param_duration: 4 });
    const idC = subC.json.task.id;
    ok(subC.json.task.cost > 0, 'C 场景按秒计价 cost=' + subC.json.task.cost);
    ok(credits() === before - subC.json.task.cost, '提交时扣分', { before, now: credits() });
    const doneC = await untilTask(idC, isDone, 60000);
    ok(doneC && doneC.status === 'failed', 'C 场景终态 failed', doneC && doneC.status);
    ok(doneC && /排队已满/.test(doneC.error || ''), '错误文案说明是网关排队已满', doneC && doneC.error);
    ok(doneC && doneC.params.busy_attempts >= 1, '判死前确有自动重试', doneC && doneC.params);
    ok(doneC && doneC.refunded === 1, '积分退还标记', doneC && doneC.refunded);
    ok(credits() === before, '余额回到提交前(只退一次)', { before, now: credits() });
    const logs = db.prepare('SELECT COUNT(*) c FROM credit_logs WHERE task_id=? AND delta>0').get(idC).c;
    ok(logs === 1, '退还流水仅 1 条', { logs });
    const fails = db.prepare("SELECT fail_count FROM models WHERE id='m-agnes-flash'").get().fail_count;
    const aFails = fails; /* A/B 各成功一次,C 判死一次 */
    ok(aFails === 1, '模型失败计数只 +1(排队不计失败)', { fail_count: fails });

    /* ---------- D. 延后等待期间可取消 ---------- */
    console.log('\n-- 场景 D:延后等待期间取消 → 不被 pump 复活 --');
    await configureModel({ hold_ms: [30000], budget_ms: 120000 });
    const idD = (await api('POST', '/tasks', { model_id: 'm-agnes-flash', use_asset_id: SRC, prompt: 'CANCEL_d', param_duration: 4 })).json.task.id;
    const waitD = await untilTask(idD, isWaiting, 20000);
    ok(!!waitD, 'D 进入延后等待', waitD && waitD.status);
    const cancel = await api('POST', '/tasks/' + idD + '/cancel');
    ok(cancel.status === 200, '取消等待中的任务返回 200', { status: cancel.status });
    await wait(9000);
    const rowD = (await api('GET', '/tasks/' + idD)).json.task;
    ok(rowD.status === 'cancelled', '9 秒后仍是 cancelled', { status: rowD.status, next_at: rowD.next_at });

    console.log('\n================ 结果 ================');
    console.log('通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项');
  } catch (e) {
    console.error('脚本异常:', e);
    FAIL++;
  } finally {
    child.kill();
    mock.close();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('已清理隔离数据目录');
  }
  process.exit(FAIL ? 1 : 0);
})();
