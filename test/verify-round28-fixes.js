'use strict';
setTimeout(() => { console.error('WATCHDOG-TIMEOUT: test hung'); process.exit(2); }, 120000);

/* 第二十八轮验证:项目优化修复
 * 1) AI 生图「画幅比例 × 分辨率档」→ 服务端换算具体尺寸(新参数路径)
 * 2) 固定尺寸清单(rules.limits.sizes)就近吸附:同方向优先、面积最近
 * 3) 旧路径兼容:客户端显式 size 仍按模板清单收敛
 * 4) 无比例提交时由最终尺寸反推 aspect_ratio
 * 采用 img-ffmpeg 本地协议(不起外部请求),结束时清理自建模型与任务 */
const path = require('path');
const { spawn } = require('child_process');

const WORK = path.join(__dirname, '..');
let ok = 0, fail = 0;
function eq(a, b, msg) { if (a === b) ok++; else { fail++; console.error('FAIL: ' + msg + ' — expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); } }
function okFn(v, msg) { if (v) ok++; else { fail++; console.error('FAIL: ' + msg); } }

async function main() {
  const PORT = 4289;
  const srv = spawn(process.execPath, [path.join(WORK, 'server/index.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', 'pipe', 'pipe']
  });
  srv.stderr.on('data', c => process.stderr.write('[srv] ' + c));
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
  let up = false;
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://localhost:' + PORT + '/'); if (r.ok) { up = true; break; } } catch (e) {} await new Promise(r => setTimeout(r, 400)); }
  okFn(up, 'server up');
  const B = 'http://localhost:' + PORT;
  const jfetch = async (url, opts) => {
    const r = await fetch(url, opts);
    const text = await r.text();
    try { return { status: r.status, headers: r.headers, json: JSON.parse(text) }; }
    catch (e) { throw new Error('非 JSON(' + r.status + '): ' + url + ' → ' + text.slice(0, 100)); }
  };

  // 管理员登录
  let r = await jfetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' }) });
  const sid = /vf_sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  okFn(!!sid, 'admin login');
  const H = { 'Content-Type': 'application/json', Cookie: 'vf_sid=' + (sid ? sid[1] : '') };

  // 建两个本地生图模型:A 无尺寸清单(自由换算);B 带固定尺寸清单(就近吸附)
  const mkModel = async (name, sizes) => {
    const body = {
      name, type: 'text-to-image', enabled: true,
      params_schema: [
        { key: 'ratio', label: '画幅比例', type: 'select', options: ['1:1', '16:9', '9:16', '4:5'], default: '1:1' },
        { key: 'resolution', label: '分辨率(短边)', type: 'select', options: ['512', '768', '1024', '1280', '1536', '2048'], default: '1024' }
      ],
      rules: Object.assign({ protocol: 'img-ffmpeg', caps: ['text-to-image', 'image-to-image', 'multi-image'], limits: { max_count: 2 } },
        sizes && sizes.length ? { limits: { max_count: 2, sizes } } : {})
    };
    const res = await jfetch(B + '/api/admin/models', { method: 'POST', headers: H, body: JSON.stringify(body) });
    okFn(res.json && res.json.model, 'create model ' + name);
    return res.json.model.id;
  };
  const modelA = await mkModel('R28换算模型', null);
  const modelB = await mkModel('R28吸附模型', ['1024x1024', '1536x1024', '1024x1536', '3136x1344']);

  const gen = async (model_id, payload) => {
    const res = await jfetch(B + '/api/images/generate', { method: 'POST', headers: H, body: JSON.stringify(Object.assign({ model_id, prompt: 'R28 验证', count: 1 }, payload)) });
    if (res.status !== 200) throw new Error('generate failed: ' + JSON.stringify(res.json));
    return res.json.task;
  };

  // 1) 比例 × 分辨率 → 尺寸换算
  let t = await gen(modelA, { resolution: '2048', aspect_ratio: '16:9' });
  eq(t.params.size, '3072x2048', '2048×16:9 → 3072x2048');
  eq(t.params.resolution, '2048', 'params.resolution recorded');
  eq(t.params.aspect_ratio, '16:9', 'params.aspect_ratio recorded');

  t = await gen(modelA, { resolution: '768', aspect_ratio: '9:16' });
  eq(t.params.size, '768x1152', '768×9:16 → 768x1152(竖图短边 768)');

  t = await gen(modelA, { resolution: '1024', aspect_ratio: '1:1' });
  eq(t.params.size, '1024x1024', '1024×1:1 → 1024x1024');

  // 2) 固定尺寸清单就近吸附(同方向优先,面积最近)
  t = await gen(modelB, { resolution: '2048', aspect_ratio: '16:9' });
  eq(t.params.size, '3136x1344', '吸附:2048×16:9 → 3136x1344(同向横图面积最近)');
  t = await gen(modelB, { resolution: '512', aspect_ratio: '1:1' });
  eq(t.params.size, '1024x1024', '吸附:512×1:1 → 1024x1024(同向方图)');

  // 3) 旧路径:显式 size 在模板清单内 → 原样收敛
  t = await gen(modelA, { size: '1536x1024' });
  eq(t.params.size, '1536x1024', '旧路径:显式 size 直接生效');
  // 显式 size 不在清单 → 回退默认档(此处无 size 模板,走派生:无比例 → 方图)
  t = await gen(modelA, {});
  eq(t.params.size, '1024x1024', '缺省:无比例无分辨率 → 1024x1024');
  eq(t.params.aspect_ratio, '1:1', '缺省:由尺寸反推 aspect_ratio=1:1');

  // 清理:删除自建模型与任务
  for (const mid of [modelA, modelB]) {
    await jfetch(B + '/api/admin/models/' + mid, { method: 'DELETE', headers: H }).catch(() => {});
  }
  const dbmod = require(path.join(WORK, 'server/db'));
  const d = dbmod.db.prepare("DELETE FROM tasks WHERE prompt='R28 验证'").run();
  console.log('清理 R28 验证任务:', d.changes, '条');

  console.log('\n第二十八轮验证: ' + ok + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
