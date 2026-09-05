'use strict';
/* 端到端 API 冒烟测试 */
const { execSync } = require('child_process');
const BASE = 'http://localhost:3088/api';
const COOKIE = '/tmp/vf_cookies.txt';
const FF = '/Users/a123/Desktop/test/video-generator/tools/ffmpeg';

function curl(url, { method, headers = {}, body, form } = {}) {
  let args = `-s -c ${COOKIE} -b ${COOKIE}`;
  for (const [k, v] of Object.entries(headers)) args += ` -H "${k}: ${v}"`;
  if (method) args += ` -X ${method}`;
  if (form) args += ` ${form}`;
  if (body) {
    const tmp = '/tmp/vf_body.json';
    require('fs').writeFileSync(tmp, JSON.stringify(body));
    args += ` -d @${tmp}`;
  }
  const out = execSync(`curl ${args} "${url}"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  try {
    return out ? JSON.parse(out) : null;
  } catch (e) {
    console.error('!! 非 JSON 响应, URL:', url, '\n!! 响应原文:', String(out).slice(0, 300));
    throw e;
  }
}
const get = u => curl(u);
const jpost = (u, b) => curl(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b });
const jpatch = (u, b) => curl(u, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: b });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. 登录
  const login = jpost(BASE + '/auth/login', { email: 'demo@videoforge.cn', password: 'demo123' });
  console.log('1. 登录成功:', login.user.name, '| role:', login.user.role);

  // 2. 上传测试图片
  execSync(`${FF} -y -f lavfi -i "gradients=s=640x360" -frames:v 1 -loglevel error /tmp/test_e2e.png`);
  const uploadRes = curl(BASE + '/assets/upload', { form: '-F "file=@/tmp/test_e2e.png" -F "tags=test,e2e"' });
  console.log('2. 上传图片:', uploadRes.asset.id, uploadRes.asset.name);

  // 3. 模型列表
  const models = get(BASE + '/styles/models');
  console.log('3. 模型:', models.items.map(m => m.name).join(' / '));

  // 4. 提交图生视频任务
  const taskRes = jpost(BASE + '/tasks', {
    model_id: 'm-svd', use_asset_id: uploadRes.asset.id, style_id: 's-cinema',
    prompt: 'cinematic test', 'param_duration': 3, 'param_fps': 30, 'param_motion': 0.5
  });
  console.log('4. 任务提交:', taskRes.task.id, '| status:', taskRes.task.status);

  // 5. 等待完成
  let task;
  for (let i = 0; i < 40; i++) {
    await wait(2000);
    task = get(BASE + '/tasks/' + taskRes.task.id);
    if (['completed', 'failed', 'cancelled'].includes(task.task.status)) break;
    if (i % 3 === 0) console.log('   …进度', task.task.progress + '%');
  }
  console.log('5. 任务结果:', task.task.status, task.task.result_asset_id ? '| 结果资产: ' + task.task.result_asset_id : '| 错误: ' + task.task.error);
  if (task.task.status !== 'completed') { console.log('❌ 生成失败,中止'); process.exit(1); }

  // 6. 项目 → 分集 → 场景 → 片段
  const proj = jpost(BASE + '/projects', { name: 'E2E测试项目', description: '端到端验证' });
  const ep = jpost(BASE + '/projects/' + proj.project.id + '/episodes', { title: '第 01 集 · 测试' });
  const sc = jpost(BASE + '/episodes/' + ep.episode.id + '/scenes', { title: '开场场景' });
  const clip = jpost(BASE + '/scenes/' + sc.scene.id + '/clips', { asset_id: task.task.result_asset_id, title: '生成片段', duration: 3 });
  console.log('6. 项目/分集/场景/片段:', proj.project.id, '→', ep.episode.id, '→', sc.scene.id, '→', clip.clip.id);

  // 7. 复制场景
  const ep2 = jpost(BASE + '/projects/' + proj.project.id + '/episodes', { title: '第 02 集 · 副本' });
  const copied = jpost(BASE + '/scenes/' + sc.scene.id + '/copy', { episode_id: ep2.episode.id });
  console.log('7. 场景复制 →', copied.scene.id, copied.scene.title);

  // 8. 管理员登录 + 统计
  jpost(BASE + '/auth/login', { email: 'admin@videoforge.cn', password: 'admin123' });
  const stats = get(BASE + '/admin/stats');
  console.log('8. 管理员统计:', JSON.stringify(stats.stats));
  const users = get(BASE + '/admin/users');
  console.log('   用户数:', users.items.length);

  // 9. 模型管理(改并发 + 切换启用)
  const m0 = models.items[0];
  jpatch(BASE + '/admin/models/' + m0.id, { concurrency: 3, description: '已由E2E测试修改' });
  console.log('9. 模型管理: 已更新', m0.name, '并发→3');

  // 10. 通知
  const notifs = get(BASE + '/auth/notifications');
  console.log('10. 通知数:', notifs.items.length, '| 未读:', notifs.unread);

  console.log('\n✅ 端到端测试全部通过');
})().catch(e => { console.error('❌ 测试失败:', e.message); process.exit(1); });
