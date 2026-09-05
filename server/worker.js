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
  db.prepare("UPDATE tasks SET status='queued', progress=0, error=NULL WHERE id=?").run(taskId);
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
  db.prepare("UPDATE tasks SET status='processing', started_at=?, progress=2 WHERE id=?").run(started, task.id);
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
    while (running.size < max) {
      const task = db.prepare("SELECT * FROM tasks WHERE status='queued' ORDER BY created_at ASC LIMIT 1").get();
      if (!task) break;
      if (running.has(task.id)) continue;
      running.set(task.id, true);
      processTask(task)
        .catch(e => {
          try { markFailed(task.id, errText(e)); } catch (err) {}
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
