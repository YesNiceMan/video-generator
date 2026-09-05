'use strict';
/* 第五轮验证:API 模型(检测可用模型)/ 工作记录保存 / 删除功能 */
const http = require('http');
const { execSync } = require('child_process');
const BASE = 'http://localhost:3088/api';
const COOKIE = '/tmp/vf_cookies5.txt';
const FF = '/Users/a123/Desktop/test/video-generator/tools/ffmpeg';

/* 异步 fetch + 内存 cookie(mock 与请求同进程,绝不能用阻塞的 execSync/curl) */
let COOKIE_STR = '';
async function curl(url, { method, headers = {}, body } = {}) {
  const res = await fetch(url, {
    method: method || 'GET',
    headers: { ...(COOKIE_STR ? { Cookie: COOKIE_STR } : {}), ...headers,
      ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body))
  });
  const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of setc) { COOKIE_STR = c.split(';')[0]; }
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; }
  catch (e) { throw new Error('非 JSON 响应: ' + String(text).slice(0, 200) + ' @ ' + url); }
}
const get = u => curl(u);
const jpost = (u, b) => curl(u, { method: 'POST', body: b || {} });
const jput = (u, b) => curl(u, { method: 'PUT', body: b || {} });
const jdel = u => curl(u, { method: 'DELETE' });
const upload = async filePath => {
  const fd = new FormData();
  const p = require('path');
  const mime = p.extname(filePath) === '.png' ? 'image/png' : 'image/jpeg';
  fd.append('file', new Blob([require('fs').readFileSync(filePath)], { type: mime }), p.basename(filePath));
  fd.append('tags', 'r5');
  return curl(BASE + '/assets/upload', { method: 'POST', body: fd });
};
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.log('  ❌', label); } }

/* 本地 mock 一个 OpenAI 兼容 /v1/models 服务 */
const MOCK_PORT = 3999;
const mock = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.includes('/v1/models')) {
    if ((req.headers.authorization || '') === 'Bearer sk-good') {
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-video-1' }, { id: 'mock-video-2' }, { id: 'mock-video-3' }] }));
    } else {
      res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'bad key' } }));
    }
    return;
  }
  res.statusCode = 404; res.end('{}');
});

(async () => {
  await new Promise(r => mock.listen(MOCK_PORT, r));
  console.log('mock OpenAI 兼容服务已启动 :' + MOCK_PORT);

  console.log('== 问题2:后台 API 模型 + 检测可用模型 ==');
  await jpost(BASE + '/auth/login', { email: 'admin@videoforge.cn', password: 'admin123' });

  /* 检测:正确地址+Key */
  let det = await jpost(BASE + '/admin/models/detect', { api_base: `http://127.0.0.1:${MOCK_PORT}/v1`, api_key: 'sk-good' });
  ok(det.ok && det.count === 3 && det.items.includes('mock-video-1'), '检测可用模型返回 3 个(mock-video-*)');

  /* 检测:错误 Key → 明确报错 */
  det = await jpost(BASE + '/admin/models/detect', { api_base: `http://127.0.0.1:${MOCK_PORT}/v1`, api_key: 'sk-bad' });
  ok(det.error && det.error.includes('鉴权失败'), '错误 API Key 提示鉴权失败');

  /* 检测:不可达地址 → 网络错误提示 */
  det = await jpost(BASE + '/admin/models/detect', { api_base: 'http://127.0.0.1:59999/v1', api_key: 'x' });
  ok(det.error && det.error.includes('无法连接'), '不可达地址提示无法连接');

  /* 创建 API 模型(填 地址/Key/模型ID) */
  const created = await jpost(BASE + '/admin/models', {
    name: 'MockAPI 视频模型', type: 'image-to-video', version: 'v1',
    api_base: `http://127.0.0.1:${MOCK_PORT}/v1`, api_key: 'sk-good', model_id: 'mock-video-1',
    description: '第五轮验证用'
  });
  const mid = created.model.id;
  ok(!!mid, '创建 API 模型成功(' + mid.slice(0, 8) + ')');
  ok(created.model.has_api_key === true && !created.model.api_key, '列表不回传 Key 明文,仅标记已配置');

  /* 编辑场景:use_saved_key 复用已存 Key 检测 */
  det = await jpost(BASE + '/admin/models/detect', { api_base: `http://127.0.0.1:${MOCK_PORT}/v1`, use_saved_key: true, id: mid });
  ok(det.ok && det.count === 3, '编辑时复用已保存 Key 检测成功');

  /* 自动有效性检查应包含 API 连通信息且通过 */
  const chk = await jpost(BASE + `/admin/models/${mid}/check`);
  ok(chk.ok && chk.message.includes('API 可用') && chk.message.includes('mock-video-1'), '有效性检查含 API 连通信息并通过');
  ok(chk.model.has_api_key === true, '检查结果脱敏返回');

  /* 清理测试模型 */
  await jdel(BASE + '/admin/models/' + mid);

  console.log('== 问题5:工作记录保存 ==');
  await jpost(BASE + '/auth/login', { email: 'demo@videoforge.cn', password: 'demo123' });
  const st0 = await get(BASE + '/episodes/e-01/studio');
  ok('saved_at' in st0, '读取工作记录接口可用(saved_at=' + st0.saved_at + ')');
  const state = {
    v: 1, tab: 'storyboard', selRefId: null,
    refs: [],
    shots: [{ title: '新分镜 1', script: '[女主] 回眸 [场景A]', duration: 5, quality: '跟随项目 (巅峰480p)', neg: '', modelId: 'm-free', styleId: '', tab: 'fusion', fps: 30, motion: 0.6, seed: -1, taskIds: [] }]
  };
  const putRes = await jput(BASE + '/episodes/e-01/studio', { state });
  ok(putRes.ok && putRes.saved_at > 0, 'PUT 保存工作记录成功');
  const st1 = await get(BASE + '/episodes/e-01/studio');
  ok(st1.state && st1.state.shots.length === 1 && st1.state.shots[0].script.includes('[女主]'), '重新打开可恢复分镜文案与参数');

  console.log('== 问题3:删除功能(任务记录)==');
  execSync(`${FF} -y -f lavfi -i gradients=s=320x180 -frames:v 1 -loglevel error /tmp/test_r5.png`);
  const up = await upload('/tmp/test_r5.png');
  const task = await jpost(BASE + '/tasks', { model_id: 'm-free', use_asset_id: up.asset.id, prompt: 'r5 删除测试', param_duration: 2, param_fps: 24 });
  const tid = task.task.id;
  await wait(500);
  await jpost(BASE + `/tasks/${tid}/cancel`); /* 取消 → 终态才允许删 */
  await wait(300);
  const delRes = await jdel(BASE + '/tasks/' + tid);
  ok(delRes.ok, '删除已取消任务记录成功');
  const list = await get(BASE + '/tasks?status=all');
  ok(!list.items.some(t => t.id === tid), '删除后任务列表不再包含该记录');
  await jpost(BASE + '/auth/login', { email: 'admin@videoforge.cn', password: 'admin123' });
  const delAgain = await jdel(BASE + '/tasks/' + tid);
  ok(delAgain && delAgain.error, '重复删除返回错误');

  console.log('\n========== 结果:${pass} 通过 / ${fail} 失败 =========='.replace('${pass}', pass).replace('${fail}', fail));
  mock.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试中断:', e.message); mock.close(); process.exit(1); });
