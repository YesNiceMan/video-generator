'use strict';
// 任务队列 worker:消费 queued 任务
//   通过适配器注册中心(server/adapters.js)按模型规则自动选择引擎:
//   - 配置了 API(api_base + api_key + model_id)的模型 → 适配器自动识别协议
//   - 其余模型 → 系统默认本地 ffmpeg 渲染管线
const path = require('path');
const fs = require('fs');
const { db, getSettings, DATA_DIR } = require('./db');
const { uid, now } = require('./util');
const { probe, makeThumb } = require('./ffmpeg');
const adapters = require('./adapters');
const credits = require('./credits');

const GENERATED_DIR = path.join(DATA_DIR, 'generated');
fs.mkdirSync(GENERATED_DIR, { recursive: true });

/* 安全错误文本:String() 对 null 原型对象会抛 "Cannot convert object to primitive value" */
function errText(e) {
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'string') return e;
  try { return String(e); } catch (_) { /* 继续尝试 JSON */ }
  try { return JSON.stringify(e); } catch (_) { return '未知错误'; }
}

const running = new Map(); // taskId -> { proc: true }

function enqueue(taskId) {
  /* 重新入队 = 新的排队预算:清掉上一轮网关拥堵的累计等待,否则重试会立刻被判死 */
  let p = {};
  try { p = JSON.parse((db.prepare('SELECT params FROM tasks WHERE id=?').get(taskId) || {}).params || '{}'); } catch (e) { p = {}; }
  if (p.busy_since || p.busy_attempts) {
    delete p.busy_since; delete p.busy_attempts;
    db.prepare('UPDATE tasks SET params=? WHERE id=?').run(JSON.stringify(p), taskId);
  }
  db.prepare("UPDATE tasks SET status='queued', progress=0, error=NULL, next_at=NULL WHERE id=?").run(taskId);
}

/* 网关排队已满(video_queue_full 等)不等于失败:拥堵是分钟级的,原地退避只会白占任务槽,
   所以把任务放回队列并延后 next_at,由 pump 到点再取;累计等待超过预算才判死退积分。 */
const BUSY_LADDER = [60e3, 120e3, 180e3, 240e3, 300e3];
const BUSY_BUDGET_MS = 60 * 60e3;

/* 重试节奏可按模型调:「生成规则」里写 busy:{hold_ms:[...], budget_ms:...},不写用默认阶梯 */
function busyConfig(modelId) {
  const def = { ladder: BUSY_LADDER, budget: BUSY_BUDGET_MS };
  if (!modelId) return def;
  try {
    const m = db.prepare('SELECT rules FROM models WHERE id=?').get(modelId);
    const b = m && JSON.parse(m.rules || '{}').busy;
    if (!b) return def;
    const ladder = Array.isArray(b.hold_ms)
      ? b.hold_ms.map(n => Number(n) || 0).filter(n => n >= 1000)
      : (Number(b.hold_ms) >= 1000 ? [Number(b.hold_ms)] : null);
    return {
      ladder: ladder && ladder.length ? ladder : def.ladder,
      budget: Number(b.budget_ms) >= 5000 ? Number(b.budget_ms) : def.budget
    };
  } catch (e) { return def; }
}

function failTask(task, err) {
  const e = err instanceof Error ? err : new Error(errText(err));
  if (!e.retryable) return markFailed(task.id, e);
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id);
  if (!t || t.status !== 'processing') return; /* 等待期间已被取消 */
  const cfg = busyConfig(t.model_id);
  const p = JSON.parse(t.params || '{}');
  if (!p.busy_since) p.busy_since = now();
  const waited = now() - p.busy_since;
  const hold = e.holdMs || cfg.ladder[Math.min(p.busy_attempts || 0, cfg.ladder.length - 1)];
  if (waited + hold > cfg.budget) {
    return markFailed(task.id, new Error('视频网关排队已满(' + Math.round(waited / 1000) + 's 内已自动重试 ' +
      (p.busy_attempts || 0) + ' 次): ' + e.message + ';请稍后点「重试」'));
  }
  p.busy_attempts = (p.busy_attempts || 0) + 1;
  db.prepare("UPDATE tasks SET status='queued', progress=5, params=?, error=NULL, started_at=NULL, next_at=? WHERE id=?")
    .run(JSON.stringify(p), now() + hold, task.id);
  if (p.busy_attempts === 1) {
    notify(t.user_id, '网关排队中',
      `任务 ${t.id.slice(0, 8)} 遇视频网关排队已满,已自动延后重试(${Math.round(hold / 1000)}s 后,最长等待 ${Math.round(cfg.budget / 60000)} 分钟)`, t.id);
  }
}

function markFailed(taskId, error) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!t) return;
  const msg = errText(error);
  db.prepare("UPDATE tasks SET status='failed', error=?, finished_at=? WHERE id=?").run(msg.slice(0, 500), now(), taskId);
  credits.refundTask(taskId, '任务失败'); // 失败退还积分
  if (t.model_id) updateModelStats(t.model_id, false);
  notify(t.user_id, '生成失败', `任务 ${t.id.slice(0, 8)} 生成失败:${msg.slice(0, 120)},已退还积分`, taskId);
  pump();
}

function updateModelStats(modelId, ok, durationMs) {
  const m = db.prepare('SELECT * FROM models WHERE id=?').get(modelId);
  if (!m) return;
  const success = (m.success_count || 0) + (ok ? 1 : 0);
  const fail = (m.fail_count || 0) + (ok ? 0 : 1);
  const total = (m.total_duration_ms || 0) + (durationMs || 0);
  const avg = success ? Math.round(total / success) : 0;
  db.prepare('UPDATE models SET success_count=?, fail_count=?, total_duration_ms=?, avg_duration_ms=? WHERE id=?')
    .run(success, fail, total, avg, modelId);
}

function notify(userId, title, body, taskId) {
  db.prepare('INSERT INTO notifications(id,user_id,kind,title,body,task_id,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(uid('n-'), userId, 'task', title, body, taskId || null, now());
}

/* 生图结果资产入库:source='imggen',分类默认「分镜」;返回资产 ID */
function resultImageAsset(task, filePath, idx, total) {
  const p = probe(filePath);
  const assetId = uid('a-');
  const ext = (filePath.split('.').pop() || 'png').toLowerCase();
  const stored = path.join(DATA_DIR, 'uploads', task.user_id, assetId + '.' + ext);
  fs.mkdirSync(path.dirname(stored), { recursive: true });
  fs.copyFileSync(filePath, stored);
  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  const mime = mimeMap[ext] || 'image/png';
  const thumbId = uid('t-');
  const thumbPath = path.join(DATA_DIR, 'thumbs', thumbId + '.jpg');
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
  /* 图片缩略图:等比缩到 480 宽 */
  const { run: ffRun } = require('./ffmpeg');
  try { ffRun(['-y', '-i', stored, '-vf', 'scale=480:-2', '-frames:v', '1', '-q:v', '4', thumbPath], { timeout: 60000 }); } catch (e) { thumbPath && 0; }
  const suffix = total > 1 ? '_' + idx : '';
  const name = 'AI生图_' + task.id.slice(0, 6) + suffix + '.' + ext;
  db.prepare(`INSERT INTO assets(id,owner_id,folder_id,type,name,size,mime,path,thumb_path,width,height,duration,tags,category,source,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(assetId, task.user_id, null, 'image', name, fs.statSync(stored).size, mime, stored,
      fs.existsSync(thumbPath) ? thumbPath : null, p.width, p.height, null,
      JSON.stringify(['imggen', 'generated']), '分镜', 'imggen', now());
  db.prepare('UPDATE users SET storage_used = storage_used + ? WHERE id=?').run(fs.statSync(stored).size, task.user_id);
  return assetId;
}

function resultAsset(task, filePath) {
  // 生成结果作为资产存入用户资产库
  const p = probe(filePath);
  const ext = 'mp4';
  const assetId = uid('a-');
  const stored = path.join(DATA_DIR, 'uploads', task.user_id, assetId + '.' + ext);
  fs.mkdirSync(path.dirname(stored), { recursive: true });
  fs.copyFileSync(filePath, stored);
  const thumbId = uid('t-');
  const thumbPath = path.join(DATA_DIR, 'thumbs', thumbId + '.jpg');
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
  try { makeThumb(stored, thumbPath).catch(() => {}); } catch (e) {}
  db.prepare(`INSERT INTO assets(id,owner_id,folder_id,type,name,size,mime,path,thumb_path,width,height,duration,tags,source,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(assetId, task.user_id, null, 'video', `生成结果_${task.id.slice(0, 6)}.mp4`, fs.statSync(stored).size, 'video/mp4', stored, thumbPath, p.width, p.height, p.duration, JSON.stringify(['generated']), 'generated', now());
  db.prepare('UPDATE users SET storage_used = storage_used + ? WHERE id=?').run(fs.statSync(stored).size, task.user_id);
  return assetId;
}

async function processTask(task) {
  const started = now();
  db.prepare("UPDATE tasks SET status='processing', started_at=?, progress=2, next_at=NULL WHERE id=?").run(started, task.id);
  const params = JSON.parse(task.params || '{}');
  const outFile = path.join(GENERATED_DIR, task.id + '.mp4');

  if (task.type === 'image-to-video') {
    const src = db.prepare('SELECT * FROM assets WHERE id=?').get(task.source_asset_id);
    if (!src || !fs.existsSync(src.path)) throw new Error('源图片资产不存在');
    const model = task.model_id ? db.prepare('SELECT * FROM models WHERE id=?').get(task.model_id) : null;

    // 获取关联的参考资产(占位符链接)
    const linked = [];
    for (const id of JSON.parse(task.linked_asset_ids || '[]')) {
      const a = db.prepare('SELECT * FROM assets WHERE id=?').get(id);
      if (a && fs.existsSync(a.path)) linked.push(a);
    }

    // 风格等级(用于本地 ffmpeg 调色)
    let styleGrade = null;
    if (task.style_id) {
      const st = db.prepare('SELECT * FROM styles WHERE id=?').get(task.style_id);
      styleGrade = st ? st.category : null;
    }

    // 构造上下文 → 适配器调度
    const ctx = {
      model, task, params, src, linked, outFile, styleGrade,
      onProgress: pct => db.prepare('UPDATE tasks SET progress=? WHERE id=?').run(pct, task.id),
      recordRemote: videoId => {
        const p = JSON.parse(task.params || '{}');
        p.engine = 'api';
        p.remote_video_id = videoId;
        db.prepare('UPDATE tasks SET params=? WHERE id=?').run(JSON.stringify(p), task.id);
      }
    };
    await adapters.run(model, ctx);
  } else if (task.type === 'text-to-image') {
    /* 第二十五轮(AI 生图):生图任务分支 —— 由 server/imagegen.js 适配器
       按模型规则自动适配(openai-image / gemini-image / img-ffmpeg),
       生成图片逐张入库,多张时 result_asset_id 记录首张,其余见 result_asset_ids */
    const imagegen = require('./imagegen');
    const model = task.model_id ? db.prepare('SELECT * FROM models WHERE id=?').get(task.model_id) : null;
    if (!model) throw new Error('生图模型不存在');
    /* 参考图(第二十六轮):params.ref_asset_ids 多图合成;source_asset_id 兼容旧单图 */
    const refIds = Array.isArray(params.ref_asset_ids) && params.ref_asset_ids.length
      ? params.ref_asset_ids
      : (task.source_asset_id ? [task.source_asset_id] : []);
    const refAssets = [];
    for (const rid of refIds.slice(0, 8)) {
      const a = db.prepare('SELECT * FROM assets WHERE id=?').get(String(rid));
      if (a && a.type === 'image' && fs.existsSync(a.path)) refAssets.push(a);
    }
    const refAsset = refAssets[0] || null;
    const outBase = path.join(GENERATED_DIR, task.id);
    const files = await imagegen.run(model, {
      task, params, model,
      prompt: task.prompt || '',
      negativePrompt: task.negative_prompt || '',
      count: Math.max(1, Math.min(Number(params.count) || 1, 4)),
      refAssets,
      refAsset,
      outBase,
      onProgress: pct => db.prepare('UPDATE tasks SET progress=? WHERE id=?').run(Math.max(3, Math.min(95, Math.round(pct))), task.id)
    });
    if (!files || !files.length) throw new Error('生图引擎没有返回结果图片');
    const ids = [];
    for (let i = 0; i < files.length; i++) {
      ids.push(resultImageAsset(task, files[i], i + 1, files.length));
    }
    db.prepare('UPDATE tasks SET result_asset_ids=? WHERE id=?').run(JSON.stringify(ids), task.id);
    const firstId = ids[0];
    const durationMs0 = now() - started;
    db.prepare("UPDATE tasks SET status='completed', progress=100, result_asset_id=?, duration_ms=?, finished_at=? WHERE id=?")
      .run(firstId, durationMs0, now(), task.id);
    if (task.model_id) updateModelStats(task.model_id, true, durationMs0);
    const n = ids.length;
    notify(task.user_id, '生图完成', n > 1
      ? `生图任务 ${task.id.slice(0, 8)} 已完成,共 ${n} 张图片已存入资产库`
      : `生图任务 ${task.id.slice(0, 8)} 已完成,图片已存入资产库`, task.id);
    pump();
    return;
  } else if (task.type === 'export') {
    const ep = db.prepare('SELECT * FROM episodes WHERE id=?').get(task.episode_id);
    if (!ep) throw new Error('分集不存在');
    const exportMod = require('./ffmpeg');
    const clips = db.prepare(`SELECT c.id, c.duration, c.asset_id, a.path FROM clips c JOIN scenes s ON c.scene_id=s.id JOIN assets a ON c.asset_id=a.id
      WHERE s.episode_id=? ORDER BY s.order_index, c.order_index`).all(task.episode_id);
    if (!clips.length) throw new Error('该分集还没有可导出的片段');
    await exportMod.exportEpisode({
      clips: clips.map(c => ({ path: c.path, duration: c.duration })),
      output: outFile,
      onProgress: () => {}
    });
  } else {
    throw new Error('不支持的任务类型: ' + task.type);
  }

  const assetId = resultAsset(task, outFile);
  const durationMs = now() - started;
  db.prepare("UPDATE tasks SET status='completed', progress=100, result_asset_id=?, duration_ms=?, finished_at=? WHERE id=?")
    .run(assetId, durationMs, now(), task.id);
  if (task.model_id) updateModelStats(task.model_id, true, durationMs);
  notify(task.user_id, '生成完成', `视频任务 ${task.id.slice(0, 8)} 已完成,点击查看结果`, task.id);
  pump();
}

async function pump() {
  if (pump.busy) return;
  pump.busy = true;
  try {
    const settings = getSettings();
    const max = Number(settings.maxConcurrentTasks || 2);
    const cutoff = now();
    while (running.size < max) {
      /* next_at 未到点的排队任务(网关拥堵延后)不占任务槽 */
      const task = db.prepare("SELECT * FROM tasks WHERE status='queued' AND (next_at IS NULL OR next_at<=?) ORDER BY COALESCE(next_at, created_at) ASC, created_at ASC LIMIT 1").get(cutoff);
      if (!task) break;
      if (running.has(task.id)) continue;
      running.set(task.id, true);
      processTask(task)
        .catch(e => {
          try { failTask(task, e); } catch (err) {}
        })
        .finally(() => running.delete(task.id));
    }
  } finally {
    pump.busy = false;
  }
}

// 服务器启动时:把遗留的 processing 任务重置为 queued,以便恢复
function recover() {
  db.prepare("UPDATE tasks SET status='queued', progress=0, started_at=NULL WHERE status='processing'").run();
}

module.exports = { pump, recover, enqueue, running, GENERATED_DIR };
