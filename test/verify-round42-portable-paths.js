'use strict';
/* 第四十二轮回归:资产路径跨机器可移植(Windows 复现)
 * 现象:macOS 上开发的库把 assets.path 存成 /Users/... 绝对路径,整份代码 + data/ 复制到
 *   Windows 后 fs 把 '/Users/...' 解析成当前盘下的 D:\Users\...,文件必然不存在;
 *   而 createReadStream 的 ENOENT 没有 error 监听 → 未捕获 'error' 事件把整个 node 进程打死。
 * 本脚本验证三件事:
 *   A 新写入的资产存 DATA_DIR 相对键,读取按当前机器解析;
 *   B 文件缺失时只影响该请求(404),服务进程继续活着;
 *   C 启动迁移把历史绝对路径(含异机 macOS 路径)改写为相对键并仍能取到文件。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.VERIFY_PORT || 3188);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-round42-'));
const DB_PATH = path.join(DATA_DIR, 'app.db');

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 240) + ']' : '')); }
};

/* 一张手写 8x8 PNG(不依赖 ffmpeg) */
function tinyPng() {
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 8) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc = buf => buf.reduce((c, b) => crcTable[(c ^ b) & 255] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body) >>> 0);
    return Buffer.concat([len, body, c]);
  };
  const W = 8, H = 8, raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = x * 30; raw[o + 1] = y * 30; raw[o + 2] = 128;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let child = null;
function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  child.on('exit', code => { out += '\n[exit ' + code + ']'; });
  return { get log() { return out; }, get killed() { return child && child.exitCode !== null; } };
}

async function waitHealth(proc, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (proc.killed) throw new Error('服务进程提前退出:\n' + proc.log);
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('服务未在 ' + timeoutMs + 'ms 内就绪:\n' + proc.log);
}

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  if (!r.ok) throw new Error('登录失败 ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function uploadPng(cookie, name, bytes) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'image/png' }), name);
  const r = await fetch(BASE + '/api/assets/upload', { method: 'POST', headers: { Cookie: cookie }, body: fd });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('上传失败 ' + r.status + ' ' + JSON.stringify(body).slice(0, 200));
  return body.asset;
}

function withDb(fn) {
  const db = new DatabaseSync(DB_PATH);
  try { return fn(db); } finally { db.close(); }
}

(async () => {
  console.log('隔离 DATA_DIR:', DATA_DIR);
  const proc = startServer();
  await waitHealth(proc);
  const cookie = await login();
  const PNG = tinyPng();

  /* ---- A. 新写入存相对键,并按当前机器读取 ---- */
  console.log('== A. 新资产落库为相对键 ==');
  const a1 = await uploadPng(cookie, 'round42-a.png', PNG);
  const stored = withDb(db => db.prepare('SELECT path FROM assets WHERE id=?').get(a1.id).path);
  ok('入库的是相对键 ' + stored, !stored.startsWith('/') && !/^[a-z]:/i.test(stored) && /^uploads\//.test(stored), stored);
  ok('文件真实落在本次 DATA_DIR 下', fs.existsSync(path.join(DATA_DIR, ...stored.split('/'))));
  const fr = await fetch(BASE + '/api/assets/' + a1.id + '/file', { headers: { Cookie: cookie } });
  ok('GET /file 200', fr.status === 200, { status: fr.status });
  ok('字节一致', Buffer.compare(Buffer.from(await fr.arrayBuffer()), PNG) === 0);
  const listRow = (await (await fetch(BASE + '/api/assets/' + a1.id + '/shares', { headers: { Cookie: cookie } })).json());
  ok('shares 接口可用', !!listRow.items);
  const json = await (await fetch(BASE + '/api/assets?limit=1', { headers: { Cookie: cookie } })).json();
  const first = json.items[0];
  ok('列表不下发服务器路径', first.path === undefined);
  ok('thumb_path 下发为 URL 或空', !first.thumb_path || /^\/api\/assets\//.test(first.thumb_path), first.thumb_path);

  /* ---- B. 文件缺失只 404,不打死进程(原崩溃点) ---- */
  console.log('== B. 缺失文件不再拖垮进程 ==');
  withDb(db => db.prepare('UPDATE assets SET path=? WHERE id=?').run('uploads/u-admin/definitely-missing.png', a1.id));
  const miss = await fetch(BASE + '/api/assets/' + a1.id + '/file', { headers: { Cookie: cookie } });
  ok('缺失文件返回 404', miss.status === 404, { status: miss.status });
  ok('响应说明原因', /不存在/.test((await miss.text()) || ''));
  await waitHealth(proc, 5000);
  ok('服务进程仍在运行', !proc.killed, proc.log.slice(-400));

  /* ---- C. 异机绝对路径 → 启动迁移 ---- */
  console.log('== C. 历史绝对路径启动迁移 ==');
  const a2 = await uploadPng(cookie, 'round42-c.png', PNG);
  const realRel = withDb(db => db.prepare('SELECT path FROM assets WHERE id=?').get(a2.id).path);
  const foreign = '/Users/other-mac/Desktop/video-generator/data/' + realRel;
  withDb(db => db.prepare('UPDATE assets SET path=? WHERE id=?').run(foreign, a2.id));
  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 800));
  const proc2 = startServer();
  await waitHealth(proc2);
  const cookie2 = await login();
  const migrated = withDb(db => db.prepare('SELECT path FROM assets WHERE id=?').get(a2.id).path);
  ok('绝对路径已改写为相对键 ' + migrated, migrated === realRel, { migrated, realRel });
  const r2 = await fetch(BASE + '/api/assets/' + a2.id + '/file', { headers: { Cookie: cookie2 } });
  ok('迁移后仍可取到文件', r2.status === 200 && Buffer.compare(Buffer.from(await r2.arrayBuffer()), PNG) === 0, { status: r2.status });
  ok('启动日志报告迁移', /资产路径已迁存为相对键/.test(proc2.log), proc2.log.split('\n').slice(0, 12));

  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  console.log(`\n结果:PASS ${PASS} · FAIL ${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => {
  console.error('脚本异常:', e);
  if (child) child.kill('SIGKILL');
  process.exit(1);
});
