'use strict';
// SQLite 数据库初始化、建表与种子数据
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    storage_quota INTEGER NOT NULL DEFAULT 5368709120,
    storage_used INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('image','video','audio')),
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime TEXT,
    path TEXT NOT NULL,
    thumb_path TEXT,
    width INTEGER,
    height INTEGER,
    duration REAL,
    tags TEXT DEFAULT '[]',
    source TEXT DEFAULT 'upload',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assets_owner ON assets(owner_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS asset_shares (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL DEFAULT 'read',
    created_at INTEGER NOT NULL,
    UNIQUE(asset_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'image-to-video',
    version TEXT DEFAULT 'v1',
    description TEXT DEFAULT '',
    endpoint TEXT DEFAULT '',
    params_schema TEXT DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    concurrency INTEGER NOT NULL DEFAULT 1,
    success_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    avg_duration_ms INTEGER NOT NULL DEFAULT 0,
    total_duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS styles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
    prompt_template TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    params TEXT DEFAULT '{}',
    preview_asset_id TEXT,
    category TEXT DEFAULT '通用',
    tags TEXT DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
    author_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    favorites_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS style_favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    style_id TEXT NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, style_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'image-to-video',
    model_id TEXT,
    style_id TEXT,
    source_asset_id TEXT,
    params TEXT DEFAULT '{}',
    prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    result_asset_id TEXT,
    duration_ms INTEGER,
    project_id TEXT,
    episode_id TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    cover_asset_id TEXT,
    code TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );
  /* 项目成员:通过管理员/房主分享的邀请码加入 */
  CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE(project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    script TEXT DEFAULT '',
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    title TEXT DEFAULT '',
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    duration REAL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT DEFAULT 'task',
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    task_id TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  /* 积分体系:申请 / 流水 */
  CREATE TABLE IF NOT EXISTS credit_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    created_at INTEGER NOT NULL,
    handled_at INTEGER,
    handled_by TEXT
  );
  CREATE TABLE IF NOT EXISTS credit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    task_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `);

  // 增量迁移:为已存在的数据库补充 episodes.script 列
  const epCols = db.prepare("SELECT name FROM pragma_table_info('episodes')").all().map(r => r.name);
  if (!epCols.includes('script')) db.exec("ALTER TABLE episodes ADD COLUMN script TEXT DEFAULT ''");

  // 增量迁移:为已存在的数据库补充 assets.category 列(资产分类:角色/场景/物品/分镜/音频/视频)
  const assetCols = db.prepare("SELECT name FROM pragma_table_info('assets')").all().map(r => r.name);
  if (!assetCols.includes('category')) db.exec("ALTER TABLE assets ADD COLUMN category TEXT DEFAULT ''");

  // 增量迁移(第四轮):项目邀请码 / 用户积分 / 任务积分与占位链接 / 模型有效性检测
  const projCols = db.prepare("SELECT name FROM pragma_table_info('projects')").all().map(r => r.name);
  if (!projCols.includes('code')) db.exec('ALTER TABLE projects ADD COLUMN code TEXT');
  if (db.prepare('SELECT COUNT(*) AS c FROM pragma_index_list(\'projects\') WHERE "unique"=1').get().c === 0) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code ON projects(code)');
  }
  const userCols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map(r => r.name);
  if (!userCols.includes('credits')) db.exec('ALTER TABLE users ADD COLUMN credits INTEGER NOT NULL DEFAULT 100');
  const taskCols = db.prepare("SELECT name FROM pragma_table_info('tasks')").all().map(r => r.name);
  if (!taskCols.includes('cost')) db.exec('ALTER TABLE tasks ADD COLUMN cost INTEGER NOT NULL DEFAULT 0');
  if (!taskCols.includes('refunded')) db.exec('ALTER TABLE tasks ADD COLUMN refunded INTEGER NOT NULL DEFAULT 0');
  if (!taskCols.includes('linked_asset_ids')) db.exec("ALTER TABLE tasks ADD COLUMN linked_asset_ids TEXT DEFAULT '[]'");
  const modelCols = db.prepare("SELECT name FROM pragma_table_info('models')").all().map(r => r.name);
  if (!modelCols.includes('is_free')) db.exec('ALTER TABLE models ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0');
  if (!modelCols.includes('check_status')) db.exec("ALTER TABLE models ADD COLUMN check_status TEXT NOT NULL DEFAULT 'unknown'");
  if (!modelCols.includes('check_message')) db.exec("ALTER TABLE models ADD COLUMN check_message TEXT DEFAULT ''");
  if (!modelCols.includes('checked_at')) db.exec('ALTER TABLE models ADD COLUMN checked_at INTEGER');
  /* 第五轮:API 模型配置(OpenAI 兼容)——API 地址 / API Key / 模型 ID */
  if (!modelCols.includes('api_base')) db.exec("ALTER TABLE models ADD COLUMN api_base TEXT DEFAULT ''");
  if (!modelCols.includes('api_key')) db.exec("ALTER TABLE models ADD COLUMN api_key TEXT DEFAULT ''");
  if (!modelCols.includes('model_id')) db.exec("ALTER TABLE models ADD COLUMN model_id TEXT DEFAULT ''");
  /* 第十二轮:模型适配规则(protocol + 请求/轮询/限制模板,空串=自动识别) */
  if (!modelCols.includes('rules')) db.exec("ALTER TABLE models ADD COLUMN rules TEXT DEFAULT ''");
  /* 第二十轮:模型每秒积分消耗(0 = 跟随系统设置里的全局定价) */
  if (!modelCols.includes('credit_per_second')) db.exec('ALTER TABLE models ADD COLUMN credit_per_second REAL NOT NULL DEFAULT 0');

  /* 第五轮:分镜工作台工作记录(自动保存),按分集存 JSON */
  const epCols5 = db.prepare("SELECT name FROM pragma_table_info('episodes')").all().map(r => r.name);
  if (!epCols5.includes('studio_state')) db.exec("ALTER TABLE episodes ADD COLUMN studio_state TEXT DEFAULT ''");
  if (!epCols5.includes('studio_saved_at')) db.exec('ALTER TABLE episodes ADD COLUMN studio_saved_at INTEGER');

  // 为缺少邀请码的历史项目补码(幂等)
  for (const row of db.prepare('SELECT id FROM projects WHERE code IS NULL OR code=?').all('')) {
    let code; let tries = 0;
    do { code = genProjectCode(); tries++; } while (tries < 20 && db.prepare('SELECT 1 FROM projects WHERE code=?').get(code));
    db.prepare('UPDATE projects SET code=? WHERE id=?').run(code, row.id);
  }
}

/* 项目邀请码:VF- + 6 位无易混淆字符大写字母数字 */
function genProjectCode() {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return 'VF-' + s;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, JSON.stringify(value));
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const now = Date.now();
  if (count === 0) {
    const adminId = 'u-admin';
    const demoId = 'u-demo';
    db.prepare('INSERT INTO users(id,email,password_hash,name,role,storage_quota,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(adminId, 'admin@videoforge.cn', bcrypt.hashSync('admin123', 10), '平台管理员', 'admin', 10737418240, now);
    db.prepare('INSERT INTO users(id,email,password_hash,name,role,storage_quota,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(demoId, 'demo@videoforge.cn', bcrypt.hashSync('demo123', 10), '演示用户', 'user', 5368709120, now);

    // 默认模型
    const models = [
      { id: 'm-svd', name: 'Stable Video Diffusion', type: 'image-to-video', version: 'X1.0', endpoint: 'gpu://cluster-a/svd-x', concurrency: 2,
        params_schema: [{ key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 10, step: 1, default: 5 },
          { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 30 },
          { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.6 },
          { key: 'seed', label: '随机种子', type: 'number', default: -1 }],
        description: '高保真图生视频扩散模型,擅长自然运动与光影过渡。' },
      { id: 'm-animatediff', name: 'AnimateDiff', type: 'image-to-video', version: 'v3.5', endpoint: 'gpu://cluster-b/animatediff', concurrency: 3,
        params_schema: [{ key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 8, step: 1, default: 4 },
          { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 30 },
          { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.7 },
          { key: 'seed', label: '随机种子', type: 'number', default: -1 }],
        description: '动画风格图生视频模型,适合二次元与卡通风格。' },
      { id: 'm-runway', name: 'Runway Gen-3', type: 'image-to-video', version: 'Turbo', endpoint: 'api://runway/gen3', concurrency: 1,
        params_schema: [{ key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 10, step: 1, default: 5 },
          { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 30 },
          { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
          { key: 'seed', label: '随机种子', type: 'number', default: -1 }],
        description: '影视级画质生成,电影镜头语言能力强。' },
      { id: 'm-kling', name: 'Kling 可灵', type: 'image-to-video', version: '1.6', endpoint: 'api://kling/1.6', concurrency: 1,
        params_schema: [{ key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 10, step: 1, default: 5 },
          { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 30 },
          { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.4 },
          { key: 'seed', label: '随机种子', type: 'number', default: -1 }],
        description: '快手出品的图生视频模型,物理运动自然。' },
      { id: 'm-free', name: 'FreeTest 免费模型', type: 'image-to-video', version: 'free-1.0', endpoint: 'local://ffmpeg/freetest', concurrency: 2, is_free: 1,
        params_schema: [{ key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 10, step: 1, default: 2 },
          { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 24 },
          { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.3 },
          { key: 'seed', label: '随机种子', type: 'number', default: -1 }],
        description: '免费体验模型:不消耗积分,用于连通性与效果测试。' }
    ];
    const insModel = db.prepare('INSERT INTO models(id,name,type,version,endpoint,params_schema,enabled,concurrency,is_free,description,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    for (const m of models) insModel.run(m.id, m.name, m.type, m.version, m.endpoint, JSON.stringify(m.params_schema), 1, m.concurrency, m.is_free || 0, m.description, now);

    // 默认风格库
    const styles = [
      { id: 's-cinema', name: '电影感', category: '影视', model_id: 'm-runway', prompt_template: 'cinematic film still, shallow depth of field, dramatic lighting, anamorphic lens, 35mm film grain, high contrast color grading, {subject}', negative_prompt: 'lowres, blurry, watermark, oversaturated, cartoon', params: { motion: 0.5 }, tags: ['电影', '高级感'], visibility: 'public' },
      { id: 's-cyber', name: '赛博朋克', category: '科幻', model_id: 'm-svd', prompt_template: 'cyberpunk cityscape, neon lights, rain reflections, futuristic, volumetric fog, {subject}', negative_prompt: 'sunlight, daytime, clean modern architecture', params: { motion: 0.6, seed: 42 }, tags: ['霓虹', '科幻'], visibility: 'public' },
      { id: 's-ink', name: '水墨意境', category: '国风', model_id: 'm-animatediff', prompt_template: 'chinese ink wash painting, flowing brush strokes, misty mountains, elegant, {subject}', negative_prompt: 'photo realistic, colorful, cartoon', params: { motion: 0.3 }, tags: ['国风', '艺术'], visibility: 'public' },
      { id: 's-anime', name: '二次元动漫', category: '动画', model_id: 'm-animatediff', prompt_template: 'anime style, vibrant colors, detailed background, studio quality, {subject}', negative_prompt: 'realistic photo, 3d render, blurry', params: { motion: 0.7 }, tags: ['动漫', '二次元'], visibility: 'public' },
      { id: 's-doc', name: '纪录大片', category: '影视', model_id: 'm-kling', prompt_template: 'documentary nature footage, 8k, national geographic style, slow pan, {subject}', negative_prompt: 'animation, cartoon, text overlay', params: { motion: 0.4 }, tags: ['纪录片', '自然'], visibility: 'public' },
      { id: 's-ad', name: '广告大片', category: '商业', model_id: 'm-runway', prompt_template: 'commercial product video, studio lighting, clean background, premium feel, {subject}', negative_prompt: 'dirty, noisy, amateur', params: { motion: 0.45 }, tags: ['商业', '产品'], visibility: 'public' }
    ];
    const insStyle = db.prepare('INSERT INTO styles(id,name,description,category,model_id,prompt_template,negative_prompt,params,tags,visibility,author_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const s of styles) insStyle.run(s.id, s.name, s.description || '', s.category, s.model_id, s.prompt_template, s.negative_prompt, JSON.stringify(s.params), JSON.stringify(s.tags), s.visibility, 'u-admin', now);

    // 演示项目:项目→分集→场景→片段
    const p = 'p-demo';
    db.prepare('INSERT INTO projects(id,owner_id,name,description,created_at) VALUES(?,?,?,?,?)')
      .run(p, demoId, '《山海录》第一季', '演示用的奇幻剧集项目', now);
    const eps = [
      { id: 'e-01', title: '第 01 集 · 觉醒', scenes: [['s-0101', '开篇 · 古城迷雾'], ['s-0102', '主角登场'], ['s-0103', '觉醒时刻']] },
      { id: 'e-02', title: '第 02 集 · 入山', scenes: [['s-0201', '山门之外'], ['s-0202', '第一次交手']] },
      { id: 'e-03', title: '第 03 集 · 抉择', scenes: [['s-0301', '暗流涌动'], ['s-0302', '内心之战']] },
      { id: 'e-04', title: '第 04 集 · 决战', scenes: [['s-0401', '众神归位'], ['s-0402', '最终之战']] }
    ];
    const insEp = db.prepare('INSERT INTO episodes(id,project_id,title,order_index,created_at) VALUES(?,?,?,?,?)');
    const insScene = db.prepare('INSERT INTO scenes(id,episode_id,title,order_index,created_at) VALUES(?,?,?,?,?)');
    eps.forEach((ep, ei) => {
      insEp.run(ep.id, p, ep.title, ei, now);
      ep.scenes.forEach((sc, si) => insScene.run(sc[0], ep.id, sc[1], si, now));
    });
  }

  // 增量迁移:为已存在的演示项目补充第 03 / 04 集(幂等)
  const demoProj = db.prepare('SELECT id FROM projects WHERE id=?').get('p-demo');
  if (demoProj && db.prepare('SELECT COUNT(*) AS c FROM episodes WHERE project_id=?').get('p-demo').c === 2) {
    const has03 = db.prepare('SELECT 1 FROM episodes WHERE id=?').get('e-03');
    if (!has03) {
      const now2 = Date.now();
      db.prepare('INSERT INTO episodes(id,project_id,title,order_index,created_at) VALUES(?,?,?,?,?)')
        .run('e-03', 'p-demo', '第 03 集 · 抉择', 2, now2);
      db.prepare('INSERT INTO episodes(id,project_id,title,order_index,created_at) VALUES(?,?,?,?,?)')
        .run('e-04', 'p-demo', '第 04 集 · 决战', 3, now2);
    }
  }

  // 增量迁移:为已存在的库补充免费体验模型(幂等)
  if (!db.prepare('SELECT 1 FROM models WHERE id=?').get('m-free')) {
    db.prepare('INSERT INTO models(id,name,type,version,endpoint,params_schema,enabled,concurrency,is_free,description,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('m-free', 'FreeTest 免费模型', 'image-to-video', 'free-1.0', 'local://ffmpeg/freetest',
        JSON.stringify([
          { key: 'duration', label: '时长(秒)', type: 'range', min: 2, max: 10, step: 1, default: 2 },
          { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 24 },
          { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.3 },
          { key: 'seed', label: '随机种子', type: 'number', default: -1 }
        ]), 1, 2, 1, '免费体验模型:不消耗积分,用于连通性与效果测试。', Date.now());
  }

  // 增量迁移:Agnes Video 2.5 Flash 在线模型(幂等)
  //   按 doc/Agnes Video 2.5 Flash API.md 合理设置:
  //   · size 固定 720P / seconds 4-12 / reference 参考图 ≤ 5 张 / 不支持 videos
  //   · 现价 $0/秒(限时免费)→ is_free=1 不扣积分
  //   · API Key 留空,由管理员在后台「模型管理」中填写后即走在线生成
  if (!db.prepare('SELECT 1 FROM models WHERE id=?').get('m-agnes-flash')) {
    db.prepare(`INSERT INTO models(id,name,type,version,endpoint,params_schema,enabled,concurrency,is_free,api_base,model_id,rules,description,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('m-agnes-flash', 'Agnes Video 2.5 Flash', 'image-to-video', '2.5-flash', 'api://agnes/video-2.5-flash',
        JSON.stringify([
          { key: 'duration', label: '时长(秒)', type: 'range', min: 4, max: 12, step: 1, default: 5 },
          { key: 'aspect_ratio', label: '画幅比例', type: 'select', options: ['16:9', '21:9', '4:3', '1:1', '3:4', '9:16'], default: '16:9' },
          { key: 'seed', label: '随机种子(-1 随机)', type: 'number', default: -1 }
        ]),
        1, 2, 1,
        'https://apihub.agnes-ai.com/v1',
        'agnes-video-2.5-flash',
        JSON.stringify({ protocol: 'agnes-flash', modes: ['text', 'keyframe', 'reference'], limits: { max_images: 5, min_seconds: 4, max_seconds: 12, fixed_size: '720P', seconds_type: 'string' } }),
        'Agnes 官方图生视频模型:720P 输出,支持参考图/首尾帧控制,限时免费($0/秒)。需在后台配置 API Key。',
        Date.now());
  }
  /* 第十二轮:为历史库中的 Agnes Flash 模型补写显式适配规则(幂等) */
  db.prepare(`UPDATE models SET rules=? WHERE id='m-agnes-flash' AND (rules IS NULL OR rules='')`)
    .run(JSON.stringify({ protocol: 'agnes-flash', modes: ['text', 'keyframe', 'reference'], limits: { max_images: 5, min_seconds: 4, max_seconds: 12, fixed_size: '720P', seconds_type: 'string' } }));

  /* 第二十三轮:为「API 模型接入」添加的空参数模板模型补写标准参数 schema(幂等)
     此前这类模型 params_schema='[]',提交任务时 时长/帧率 等参数被整段丢弃:
    ① 积分按默认 5s 计价(显示 30 实扣 50);② 生成不走用户设置的时长/帧率/分辨率。
    补写后后台可编辑参数,任务参数照常读取;已配置 schema 的模型不受影响 */
  const STD_PARAM_SCHEMA = [
    { key: 'duration', label: '时长(秒)', type: 'range', min: 1, max: 20, step: 1, default: 5 },
    { key: 'fps', label: '帧率', type: 'select', options: [23.976, 24, 25, 29.97, 30, 48, 50, 60], default: 24 },
    { key: 'motion', label: '运动强度', type: 'range', min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: 'seed', label: '随机种子(-1 随机)', type: 'number', default: -1 }
  ];
  {
    const emptyModels = db.prepare("SELECT id, name FROM models WHERE params_schema IS NULL OR TRIM(params_schema)='' OR params_schema='[]'").all();
    for (const m of emptyModels) {
      db.prepare('UPDATE models SET params_schema=? WHERE id=?').run(JSON.stringify(STD_PARAM_SCHEMA), m.id);
      console.log('[迁移] 模型「' + m.name + '」参数模板为空,已补写标准参数(时长/帧率/运动/种子)');
    }
  }

  // 默认系统设置
  const s = getSettings();
  if (!s.maxConcurrentTasks) setSetting('maxConcurrentTasks', 2);
  if (!s.defaultQuotaGB) setSetting('defaultQuotaGB', 5);
  if (!s.gpuPool) setSetting('gpuPool', '8× NVIDIA A100 80G | 节点: cluster-a, cluster-b');
  if (!s.maxUploadMB) setSetting('maxUploadMB', 2048);
  // API 模型回传素材用的公网地址(也可用环境变量 PUBLIC_BASE_URL,优先级更高)
  if (s.publicBaseUrl === undefined) setSetting('publicBaseUrl', '');
  // 积分定价:每秒单价 + 常用段时长覆盖价(管理员后台可改)
  if (s.creditPerSecond === undefined) setSetting('creditPerSecond', 5);
  if (!s.creditOverrides) setSetting('creditOverrides', { '3': 15, '5': 25, '10': 50 });
  if (s.freeCredits === undefined) setSetting('freeCredits', 100);
  /* 第二十轮:生成视频尺寸可配置(480p/720p/960p/2k);分辨率参数提交时以此白名单校验 */
  if (!Array.isArray(s.videoResolutions) || !s.videoResolutions.length) setSetting('videoResolutions', ['480p', '720p', '960p', '2k']);
}

migrate();
seed();

module.exports = { db, getSettings, setSetting, genProjectCode, DATA_DIR, DB_PATH };
