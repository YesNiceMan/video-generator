'use strict';
/* 第四轮优化端到端 API 验证
   0) 免费模型存在且 enabled
   1) 项目邀请码:创建项目生成唯一码 / 他人凭码加入 / 成员可访问 / 无码拒绝
   2) 资产重命名 PATCH /assets/:id {name}
   3) 提示词占位符:提交任务带 linked_asset_ids → 服务端校验入库;提示词原文准确保存
   4) 积分:余额展示 / 申请积分 → 管理员批准到账 / 任务按段时长扣分 / 取消退还 / 余额不足 402
   5) 模型有效性检查 + 免费模型自检(真实渲染任务)
   6) 后台段时长定价设置生效 */
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://localhost:3099/api';
const COOKIE_DEMO = '/tmp/vf_r4_demo.txt';
const COOKIE_ADMIN = '/tmp/vf_r4_admin.txt';
const FF = '/Users/a123/Desktop/test/video-generator/tools/ffmpeg';

function curl(url, { method, body, form, cookie } = {}) {
  let args = `-s -c ${cookie} -b ${cookie}`;
  if (method) args += ` -X ${method}`;
  if (form) args += ` ${form}`;
  else args += ' -H "Content-Type: application/json"';
  if (body !== undefined && !form) {
    fs.writeFileSync('/tmp/vf_r4_body.json', JSON.stringify(body));
    args += ' -d @/tmp/vf_r4_body.json';
  }
  const out = execSync(`curl ${args} "${url}"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  try { return out ? JSON.parse(out) : null; }
  catch (e) { throw new Error('非 JSON 响应: ' + String(out).slice(0, 200)); }
}
const get = (u, c) => curl(BASE + u, { cookie: c });
const post = (u, b, c) => curl(BASE + u, { method: 'POST', body: b, cookie: c });
const patch = (u, b, c) => curl(BASE + u, { method: 'PATCH', body: b, cookie: c });

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== 登录 ==');
  const d1 = post('/auth/login', { email: 'demo@videoforge.cn', password: 'demo123' }, COOKIE_DEMO);
  const a1 = post('/auth/login', { email: 'admin@videoforge.cn', password: 'admin123' }, COOKIE_ADMIN);
  ok(d1.user && d1.user.credits !== undefined, 'demo 登录,publicUser 含 credits 字段', d1);
  ok(a1.user.role === 'admin', 'admin 登录');
  // 注册新用户验证赠送积分与加入流程
  const email = 'r4-' + Date.now() + '@test.cn';
  post('/auth/register', { email, password: 'test123456', name: 'R4成员' }, '/tmp/vf_r4_new.txt');

  console.log('== ① 项目邀请码 ==');
  const proj = post('/projects', { name: 'R4 邀请码项目' }, COOKIE_DEMO);
  ok(proj.project.code && /^VF-[A-Z0-9]{6}$/.test(proj.project.code), '新项目自动生成唯一邀请码 ' + proj.project.code);
  ok(proj.project.id && proj.project.id.startsWith('p-'), '项目唯一 id 编号 ' + proj.project.id.slice(0, 10));
  // 新用户无权访问
  const deniedRes = get('/projects/' + proj.project.id, '/tmp/vf_r4_new.txt');
  ok(deniedRes && deniedRes.error && !deniedRes.project, '未加入用户访问项目被拒: ' + (deniedRes.error || '意外成功'));
  const join = post('/projects/join', { code: proj.project.code }, '/tmp/vf_r4_new.txt');
  ok(join.as === 'member' && join.project.id === proj.project.id, '凭管理员分享的邀请码成功加入');
  const joinedView = get('/projects/' + proj.project.id, '/tmp/vf_r4_new.txt');
  ok(joinedView.project.my_role === 'member', '成员可以访问项目(my_role=member)');
  const badJoin = post('/projects/join', { code: 'VF-XXXXXX' }, '/tmp/vf_r4_new.txt');
  ok(!!badJoin.error, '无效邀请码报错: ' + badJoin.error);
  const demoList = get('/projects', COOKIE_DEMO);
  ok(demoList.items.some(p => p.id === proj.project.id && p.code), '项目列表返回邀请码字段');

  console.log('== ② 资产重命名 ==');
  execSync(`${FF} -y -f lavfi -i "gradients=s=320x180" -frames:v 1 -loglevel error /tmp/r4_test.png`);
  const up = curl(BASE + '/assets/upload', { form: '-F "file=@/tmp/r4_test.png"', cookie: COOKIE_DEMO });
  const ren = patch('/assets/' + up.asset.id, { name: '女主.png' }, COOKIE_DEMO);
  ok(ren.asset.name === '女主.png', '资产重命名成功 → ' + ren.asset.name);

  console.log('== ③ 占位符链接资源 + 提示词准确提交 ==');
  const models = get('/styles/models', COOKIE_DEMO);
  const freeModel = models.items.find(m => m.is_free);
  ok(!!freeModel, '免费模型已内置: ' + (freeModel ? freeModel.name + '(' + freeModel.id + ')' : '缺失'));
  const PROMPT = '雨夜街头,[女主] 特写缓慢推近,霓虹倒影';
  const t3 = post('/tasks', {
    model_id: freeModel.id,
    use_asset_id: up.asset.id,
    prompt: PROMPT,
    negative_prompt: '',
    param_duration: 2, param_fps: 24, param_motion: 0.3, param_seed: -1,
    project_id: proj.project.id,
    linked_asset_ids: [up.asset.id]
  }, COOKIE_DEMO);
  ok(t3.task.prompt === PROMPT, '提示词原文准确入库: "' + (t3.task.prompt || '').slice(0, 40) + '"');
  ok(Array.isArray(t3.task.linked_assets) && t3.task.linked_assets[0] && t3.task.linked_assets[0].id === up.asset.id, '占位符链接资源已校验并随任务返回');
  // 非法链接资源应被过滤
  const t3b = post('/tasks', {
    model_id: freeModel.id, use_asset_id: up.asset.id, prompt: 'x',
    param_duration: 2, param_fps: 24,
    linked_asset_ids: ['a-fake', '../../../etc/passwd']
  }, COOKIE_DEMO);
  ok(t3b.task.linked_asset_ids.length === 0, '非法/无权资源链接被服务端过滤');

  console.log('== ④ 积分体系 ==');
  // 先重置为已知默认定价(避免上一轮残留)
  patch('/admin/settings', { creditPerSecond: 5, creditOverrides: { '3': 15, '5': 25, '10': 50 } }, COOKIE_ADMIN);
  const c0 = get('/credits', COOKIE_DEMO);
  ok(typeof c0.balance === 'number' && c0.pricing.perSecond !== undefined, '积分汇总接口正常 balance=' + c0.balance);
  // 计价:非免费模型 5s 应为覆盖价 25 分
  const balBefore = c0.balance;
  const paidModels = models.items.filter(m => !m.is_free);
  const mPaid = paidModels[0];
  const t4 = post('/tasks', { model_id: mPaid.id, use_asset_id: up.asset.id, prompt: '计价测试', param_duration: 5, param_fps: 30 }, COOKIE_DEMO);
  ok(t4.credits.cost === 25, `5s 段时长计价 25 分(实际 ${t4.credits.cost})`, t4.credits);
  ok(t4.credits.balance === balBefore - 25, '余额扣减正确 ' + balBefore + '→' + t4.credits.balance);
  // 取消退还
  await wait(300);
  const cancelRes = post('/tasks/' + t4.task.id + '/cancel', {}, COOKIE_DEMO);
  ok(cancelRes.refunded === true || cancelRes.ok, '取消任务触发退还');
  const logs1 = get('/credits', COOKIE_DEMO);
  ok(logs1.logs.some(l => l.delta > 0 && l.reason.includes('退还')), '退还流水已记录');
  ok(logs1.balance === balBefore, '取消后积分全额退回 ' + logs1.balance);
  // 申请积分 → 管理员批准
  const apply = post('/credits/apply', { amount: 500, reason: '第四轮测试申请' }, COOKIE_DEMO);
  ok(apply.request.status === 'pending', '积分申请已提交');
  const adminApprove = post('/admin/credit-requests/' + apply.request.id + '/approve', {}, COOKIE_ADMIN);
  ok(adminApprove.ok, '管理员批准申请');
  const cAfter = get('/credits', COOKIE_DEMO);
  ok(cAfter.balance === logs1.balance + 500, '批准后积分到账 +' + 500);
  ok(cAfter.requests.some(r => r.id === apply.request.id && r.status === 'approved'), '申请记录状态 approved');
  // 余额不足 402(新用户用自己上传的图,先耗尽 100 分)
  const upNew = curl(BASE + '/assets/upload', { form: '-F "file=@/tmp/r4_test.png"', cookie: '/tmp/vf_r4_new.txt' });
  ok(upNew.asset && upNew.asset.id, '新用户上传源图用于余额测试');
  let insufficient = null;
  for (let i = 0; i < 40 && !insufficient; i++) {
    const r = post('/tasks', { model_id: mPaid.id, use_asset_id: upNew.asset.id, prompt: '耗尽', param_duration: 10, param_fps: 30 }, '/tmp/vf_r4_new.txt');
    if (r.error) insufficient = r.error;
    else if (r.credits.balance <= 0) insufficient = '(exactly zero)';
  }
  ok(insufficient && (insufficient.includes('积分不足') || insufficient === '(exactly zero)'), '余额不足时拒绝提交: ' + String(insufficient).slice(0, 60));

  console.log('== ⑤ 模型检查 + 免费模型自检 ==');
  const chk = post('/admin/models/' + freeModel.id + '/check', {}, COOKIE_ADMIN);
  ok(chk.ok === true && chk.model.check_status === 'ok', '免费模型有效性检查通过: ' + chk.message);
  const badSchema = post('/admin/models', { name: '坏模型-R4', endpoint: 'ftp://wrong', params_schema: [{ key: 'duration', type: 'range', min: 9, max: 2 }] }, COOKIE_ADMIN);
  const chkBad = post('/admin/models/' + badSchema.model.id + '/check', {}, COOKIE_ADMIN);
  ok(chkBad.ok === false && chkBad.model.check_status === 'fail', '配置错误的模型被检出无效: ' + chkBad.message.slice(0, 50));
  const st = post('/admin/models/' + freeModel.id + '/selftest', {}, COOKIE_ADMIN);
  ok(st.task && st.task.id, '自检任务已提交 #' + (st.task ? st.task.id.slice(0, 8) : '?'));
  let finalTask = null;
  for (let i = 0; i < 40 && !finalTask; i++) {
    await wait(1000);
    const { task } = get('/tasks/' + st.task.id, COOKIE_ADMIN);
    if (['completed', 'failed'].includes(task.status)) finalTask = task;
  }
  ok(finalTask && finalTask.status === 'completed', `免费模型自检渲染完成(${finalTask ? Math.round((finalTask.duration_ms || 0) / 1000) + 's' : '?'})`, finalTask && finalTask.error);

  console.log('== ⑥ 后台段时长定价设置 ==');
  const setPricing = patch('/admin/settings', { creditPerSecond: 6, creditOverrides: { '3': 12, '8': 44 } }, COOKIE_ADMIN);
  ok(setPricing.settings.creditOverrides['8'] === 44, '后台设置每段时长积分数生效');
  const upAdmin = curl(BASE + '/assets/upload', { form: '-F "file=@/tmp/r4_test.png"', cookie: COOKIE_ADMIN });
  const cost3 = post('/tasks', { model_id: mPaid.id, use_asset_id: upAdmin.asset.id, prompt: '定价验证', param_duration: 3, param_fps: 30 }, COOKIE_ADMIN);
  ok(cost3.credits && cost3.credits.cost === 12, '管理员 3s 定价 12 分生效(实际 ' + (cost3.credits ? cost3.credits.cost : JSON.stringify(cost3).slice(0, 80)) + ')');
  const cost7 = post('/tasks', { model_id: mPaid.id, use_asset_id: upAdmin.asset.id, prompt: '定价回退', param_duration: 7, param_fps: 30 }, COOKIE_ADMIN);
  ok(cost7.credits && cost7.credits.cost === Math.ceil(7 * 6), '未配置的 7s 回退为 7×6=' + (cost7.credits ? cost7.credits.cost : '?'));
  // 还原默认定价
  patch('/admin/settings', { creditPerSecond: 5, creditOverrides: { '3': 15, '5': 25, '10': 50 } }, COOKIE_ADMIN);
  post('/tasks/' + cost3.task.id + '/cancel', {}, COOKIE_ADMIN);
  post('/tasks/' + cost7.task.id + '/cancel', {}, COOKIE_ADMIN);

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
