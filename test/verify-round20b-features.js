'use strict';
/* 二十·功能验证:资产日期时间 / 模型每秒积分消耗 / 后台可配置生成视频尺寸(480p、720p、960p、2k)
   纯 API 层验证(不启浏览器):
   1) /api/config 下发 videoResolutions + defaultResolution
   2) 模型 credit_per_second:创建(2.5) → 列表可见 → 删除;PATCH 免标再还原
   3) /admin/settings videoResolutions 白名单校验(合法/空/未知值)
   4) 任务提交 param_resolution 白名单回退(免费模型 + 提交后立即取消退还)
   5) 资产列表返回 created_at */
const BASE = 'http://localhost:3088';
let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  ✓ ' + name + (detail !== undefined ? '  [' + JSON.stringify(detail) + ']' : '')); }
  else { FAIL++; console.log('  ✗ ' + name + '  [' + JSON.stringify(detail) + ']'); }
}
async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { cookie: 'vf_sid=' + token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
async function login(email, password) {
  const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error('登录失败 ' + res.status);
  return res.headers.get('set-cookie').split(';')[0].split('=')[1];
}
async function main() {
  console.log('== 登录 ==');
  const admin = await login('admin@videoforge.cn', 'admin123');
  const demo = await login('demo@videoforge.cn', 'demo123');
  check('admin 登录', !!admin); check('demo 登录', !!demo);

  console.log('== 1) /api/config 生成尺寸下发 ==');
  let r = await api('GET', '/api/config', undefined, demo);
  check('GET /api/config 200', r.status === 200, r.status);
  check('默认尺寸 = 480p/720p/960p/2k', JSON.stringify(r.data && r.data.videoResolutions) === JSON.stringify(['480p', '720p', '960p', '2k']), r.data && r.data.videoResolutions);
  check('默认档 defaultResolution = 720p', (r.data || {}).defaultResolution === '720p', r.data && r.data.defaultResolution);
  let anon = await api('GET', '/api/config');
  check('未登录访问 /api/config 被拒(401)', anon.status === 401, anon.status);

  console.log('== 2) 模型每秒积分消耗 ==');
  r = await api('POST', '/api/admin/models', { name: 'TEST-CPS模型(临时)', credit_per_second: 2.5, type: 'image-to-video' }, admin);
  check('创建模型带 credit_per_second=2.5', r.status === 200 && r.data.model.credit_per_second === 2.5, r.data && r.data.model && r.data.model.credit_per_second);
  const tmpModelId = r.data && r.data.model && r.data.model.id;
  r = await api('GET', '/api/styles/models', undefined, admin);
  const tmp = (r.data.items || []).find(m => m.id === tmpModelId);
  check('模型列表可见 credit_per_second', !!tmp && tmp.credit_per_second === 2.5, tmp && tmp.credit_per_second);
  r = await api('PATCH', '/api/admin/models/' + tmpModelId, { credit_per_second: 3 }, admin);
  check('PATCH 修改为 3', r.status === 200 && r.data.model.credit_per_second === 3, r.data.model && r.data.model.credit_per_second);
  r = await api('PATCH', '/api/admin/models/' + tmpModelId, { credit_per_second: -5 }, admin);
  check('负值被钳制为 0', r.data.model.credit_per_second === 0, r.data.model.credit_per_second);
  r = await api('DELETE', '/api/admin/models/' + tmpModelId, undefined, admin);
  check('清理临时模型', r.status === 200, r.status);

  // agnes 模型临时设单价再还原,验证普通模型列表同样带出该字段
  r = await api('PATCH', '/api/admin/models/m-agnes-flash', { credit_per_second: 1.5 }, admin);
  check('m-agnes-flash 设 1.5', r.status === 200 && r.data.model.credit_per_second === 1.5, r.data.model && r.data.model.credit_per_second);
  r = await api('PATCH', '/api/admin/models/m-agnes-flash', { credit_per_second: 0 }, admin);
  check('m-agnes-flash 还原 0(全局定价)', r.data.model.credit_per_second === 0, r.data.model.credit_per_second);

  console.log('== 3) 系统设置 videoResolutions 校验 ==');
  r = await api('PATCH', '/api/admin/settings', { videoResolutions: ['960p', '480p', '960p'] }, admin);
  check('乱序+重复 → 归一化为 480p/960p', JSON.stringify(r.data.settings.videoResolutions) === JSON.stringify(['480p', '960p']), r.data.settings && r.data.settings.videoResolutions);
  r = await api('PATCH', '/api/admin/settings', { videoResolutions: [] }, admin);
  check('空数组 → 400', r.status === 400, r.status);
  r = await api('PATCH', '/api/admin/settings', { videoResolutions: ['1080p', '4k'] }, admin);
  check('未知值全部被滤掉 → 400', r.status === 400, r.status);
  r = await api('PATCH', '/api/admin/settings', { videoResolutions: ['480p', '720p', '960p', '2k'] }, admin);
  check('恢复默认四档', JSON.stringify(r.data.settings.videoResolutions) === JSON.stringify(['480p', '720p', '960p', '2k']), r.data.settings.videoResolutions);
  r = await api('PATCH', '/api/admin/settings', { videoResolutions: ['480p'] }, demo);
  check('普通用户不能改设置(403/404)', r.status === 403 || r.status === 404 || r.status === 401, r.status);

  console.log('== 4) 任务提交分辨率白名单回退 ==');
  // 取 admin 名下一张图片资产;没有则用 ffmpeg 自检图(跳过)
  r = await api('GET', '/api/assets?type=image', undefined, admin);
  const img = ((r.data.items || []).find(a => a.type === 'image') || null);
  if (img) {
    // 选一个可用的免费模型(不扣积分);没有启用中的免费模型就临时启用 m-free 并在用后还原
    let models = (await api('GET', '/api/styles/models', undefined, admin)).data.items || [];
    let freeModel = models.find(m => m.is_free && m.enabled);
    let restoreDisabled = false;
    if (!freeModel) {
      const mf = models.find(m => m.id === 'm-free');
      if (mf) { await api('PATCH', '/api/admin/models/m-free', { enabled: true }, admin); freeModel = mf; restoreDisabled = true; }
    }
    if (!freeModel) {
      console.log('  - 跳过(库中没有免费模型可用)');
    } else {
      r = await api('POST', '/api/tasks', {
        model_id: freeModel.id, use_asset_id: img.id, prompt: '二十轮验证:分辨率白名单回退',
        param_duration: 2, param_resolution: '1080p', param_aspect_ratio: '16:9'
      }, admin);
      check('提交成功(旧值 1080p 回退)', r.status === 200, r.status + ' ' + (r.data.error || ''));
      const taskId = r.data.task && r.data.task.id;
      check('params.resolution 回退为 720p', r.data.task && r.data.task.params.resolution === '720p', r.data.task && r.data.task.params.resolution);
      if (taskId) {
        const c = await api('POST', '/api/tasks/' + taskId + '/cancel', {}, admin);
        check('取消验证任务', c.status === 200, c.status);
      }
      if (restoreDisabled) await api('PATCH', '/api/admin/models/m-free', { enabled: false }, admin);
    }
  } else {
    console.log('  - 跳过(无可用图片资产)');
  }

  console.log('== 5) 资产 created_at ==');
  r = await api('GET', '/api/assets?type=all', undefined, demo);
  const withTs = (r.data.items || []).filter(a => a.created_at);
  check('资产列表带 created_at', r.data.items.length === 0 || withTs.length === r.data.items.length, withTs.length + '/' + (r.data.items || []).length);
  if (withTs.length) check('created_at 为毫秒时间戳', withTs[0].created_at > 1000000000000, withTs[0].created_at);

  console.log('\n结果: ' + PASS + ' 通过, ' + FAIL + ' 失败');
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
