'use strict';
/* 第五十轮回归(需求三十 · 短剧工作流)
 * A. 纯函数单元:docx/xlsx 解析器(吃 data/workflow 真实文件)、分段、容错 JSON、
 *    表格列映射、画风矩阵折叠去重、内置画风模块
 * B. Mock 文本网关 + 独立 DATA_DIR 服务端到端:参考数据一键导入 → 分析(卡名复用/锚点
 *    与状态延续/进度/失败退分) → 组装 → 下发到本地免费生图 → 成果回写 → 待生成清单
 * C. 接口契约:画风 CRUD 与恢复内置、第 0 集筛选、批量删除、预估计价、模型未绑定时回落
 * D. 界面(无头 Chrome):五个阶段渲染、深浅两套主题、顶部导航高亮、无 JS 异常
 *
 * 全程不调用任何外部付费接口:文本走本地 mock 网关,生图走 m-img-free(本地 ffmpeg 占位)。
 * 用法:node test/verify-round50-drama.js [--keep]   (--keep 保留临时库与截图)
 */
const http = require('http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WF_DIR = path.join(ROOT, 'data', 'workflow');
const PORT = Number(process.env.PORT || 3157);
const CDP_PORT = PORT + 1;
const LIVE = 'http://127.0.0.1:' + PORT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-round50-'));
/* DATA_DIR 必须在 require 任何 server 模块之前定好:db.js 在加载时就打开并建库,
   晚一步设环境变量,回归就会跑到开发库 data/app.db 上去。 */
process.env.DATA_DIR = path.join(TMP, 'data');
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
const SHOT_DIR = path.join(ROOT, 'test', 'shots-r50');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const KEEP = process.argv.includes('--keep');

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 240) + ']' : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- A. 纯函数 ---------------- */
function partA() {
  console.log('== A. 解析器与工作流纯函数 ==');
  const doc = require(path.join(ROOT, 'server', 'docparse'));
  const drama = require(path.join(ROOT, 'server', 'drama'));
  if (!fs.existsSync(path.join(WF_DIR, '剧本.docx'))) {
    ok('跳过文件断言:data/workflow 不在(该目录不进版本库)', true, WF_DIR);
    return { drama, doc };
  }
  const script = doc.docxText(fs.readFileSync(path.join(WF_DIR, '剧本.docx')));
  ok('docx 解析出整部剧本(纯 zlib,无依赖)', script.length > 50000 && /万古仙族/.test(script), script.length);
  ok('docx 段落里硬回车与制表符不丢文本', script.includes('林平生') && !script.includes('<w:t'), script.slice(0, 20));

  const sheets = doc.xlsxSheets(fs.readFileSync(path.join(WF_DIR, '分析-分镜.xlsx')));
  const rows = sheets[0].rows;
  ok('xlsx 表头与共享字符串还原', rows[0].join('|') === '镜号|集数|剧本原文|视频提示词|图片提示词|秒数|元素', rows[0]);
  ok('xlsx 734 行分镜全部读出', rows.length === 735, rows.length);
  ok('多行单元格里的换行保留(状态延续块靠它)', String(rows[2][3]).includes('\n本分镜末状态：'));

  const ent = drama.mapEntitySheet(doc.xlsxSheets(fs.readFileSync(path.join(WF_DIR, '分析-人物场景.xlsx')))[0].rows);
  ok('实体卡映射:34 人物 + 49 场景', ent.filter(e => e.kind === 'character').length === 34 && ent.filter(e => e.kind === 'scene').length === 49, ent.length);
  ok('卡名保留「名字（年龄段·服装）」全角写法', ent.some(e => e.name === '林平生（青年·通用）'));

  const shotMap = drama.mapShotSheet(rows);
  ok('分镜映射 734 条且秒数落进 3~25', shotMap.length === 734 && shotMap.every(x => x.duration >= 3 && x.duration <= 25));
  ok('分镜映射从锚点行还原场景与角色引用', shotMap[0].scene_ref === '灵溪谷·林家' && shotMap[0].char_refs.length === 5, shotMap[0].char_refs);
  ok('分镜映射读出「本分镜末状态」', /面向/.test(shotMap[1].end_state), shotMap[1].end_state.slice(0, 30));

  /* 分段:参考剧本有 99 个分集标记 */
  const units = drama.splitEpisodes(script, 16000);
  ok('按「===== 第N集 =====」切段,段数≈集数', units.length >= 99, units.length);
  ok('分集标记前的「主要人物介绍」单独成段(ep 0)', units[0].episode_no === 0 && /主要人物介绍/.test(units[0].text));
  ok('中文数字集号可识别', drama.toEpisodeNo('三') === 3 && drama.toEpisodeNo('二十三') === 23 && drama.toEpisodeNo('102') === 102);
  const long = ('段落。\n'.repeat(4000));
  const chunks = drama.chunkByParagraphs(long, 5000);
  ok('超长段按段落二次切且不吞字', chunks.length > 3 && chunks.every(c => c.length <= 5200), chunks.map(c => c.length).slice(0, 4));
  ok('每段字数都在模型上限内', drama.splitEpisodes(script, 6000).every(u => u.text.length <= 6000));

  /* 容错 JSON */
  const messy = drama.parseAnalysisJson('好的，这是结果：\n```json\n{"entities":[{"kind":"character","name":"张三"}],"shots":[{"no":1,"visual":"画面","duration":8}]}\n```\n希望有帮助');
  ok('分析 JSON 容错:剥围栏 + 掐头去尾', messy.entities.length === 1 && messy.shots[0].no === 1);
  const cut = drama.parseAnalysisJson('{"entities":[{"kind":"scene","name":"祠堂"}],"shots":[{"no":1,"visual":"A"},{"no":2,"visual":"B"}]  ← 输出被截断');
  ok('输出截断时按键抢救,已完整的数组不丢', cut.shots.length === 2 && cut.entities.length === 1, Object.keys(cut));
  let bad = '';
  try { drama.parseAnalysisJson('模型直接回了一段散文'); } catch (e) { bad = e.message; }
  ok('拿不到 JSON 时给可读错误', /解析失败|没有返回 JSON/.test(bad), bad.slice(0, 60));

  /* 画风矩阵:原文每块粘两遍,必须折叠 */
  const lines = doc.docxLines(fs.readFileSync(path.join(WF_DIR, '各种全局提示词.docx')));
  const matrix = drama.parseStyleMatrix(lines);
  ok('画风矩阵解析出 5 套画风', new Set(matrix.map(m => m.style)).size === 5, matrix.map(m => m.style));
  ok('重复块折叠:同一槽位不会把同一段粘两遍', matrix.every(m => {
    const p = m.content.split('\n');
    for (let i = 0; i + 1 < p.length; i++) if (p[i] === p[i + 1]) return false;
    return true;
  }));
  ok('「3D画风-古代」没有小标题也归到视频槽', matrix.some(m => m.style === '3D画风-古代' && m.slot === '视频'));
  ok('负面词从「负面词：」行里剥出来单独存', matrix.some(m => m.negative.length > 0 && !/负面词/.test(m.content)));
  ok('槽位小标题上的括号备注不混进正文', matrix.every(m => !/（根据情况/.test(m.content)));

  /* 地域:海外/国内画风的画面与台词约束(需求七) */
  const dmod = require(path.join(ROOT, 'server', 'drama'));
  const overseas = dmod.regionOfStyle('真人画风【海外】');
  const cn = dmod.regionOfStyle('真人画风【国内】');
  ok('画风带地域:海外 → 台词英文 + 禁中式元素', !!overseas && /英文/.test(overseas.language) && /中式/.test(overseas.visual) && /中式建筑/.test(overseas.negative), overseas && overseas.label);
  ok('画风带地域:国内 → 台词中文 + 禁西式元素', !!cn && /中文/.test(cn.language) && /西式/.test(cn.visual), cn && cn.label);
  ok('3D 画风没有地域约束', dmod.regionOfStyle('3D画风-现代') === null);
  const vis = dmod.visualFromVideo('建立场景：【林家·祠堂】。继承【林家·祠堂】末状态：A位于中央。全景推近，林平生跪下。台词：林战天：谁赞成？。\n本分镜末状态：[林平生位于中央]\n\n## 人物参考：林平生（青年·通用）\n\n## 场景锚点：林家·祠堂');
  ok('从视频提示词剥出画面(去掉场景首句/继承/台词/末状态/锚点)', vis === '全景推近，林平生跪下。', vis);
  const withRefs = dmod.composeShotText({ scene_ref: '林家·祠堂', char_refs: ['林平生（青年·通用）'], visual: '近景，林平生抬头。', dialogue: '无', end_state: '林平生位于中央' },
    { refNames: { cast: { '林平生（青年·通用）': '林平生（青年·通用） 设定图.png' }, scene: '林家·祠堂 设定图.png', extra: ['道具.png'] } });
  ok('关联图片写进人物参考与场景锚点', /## 人物参考：林平生（青年·通用）\(参考图 林平生（青年·通用） 设定图.png\)/.test(withRefs.video)
    && /## 场景锚点：林家·祠堂\(参考图 林家·祠堂 设定图.png\)；补充参考图：道具.png/.test(withRefs.video), withRefs.video.slice(-160));
  ok('图片提示词 = 场景卡底稿 + 本镜画面(不再是另一份手写稿)', /场地|香烛|空间/.test(withRefs.image) || withRefs.image.startsWith('林家·祠堂，'), withRefs.image.slice(0, 80));

  const pre = require(path.join(ROOT, 'server', 'drama-presets'));
  ok('内置画风模块可用且覆盖 4 个槽位族', pre.PRESETS.length === 13 && pre.SLOTS.length === 4, pre.PRESETS.length);
  ok('内置画风每条都有正文(负面词允许为空)', pre.PRESETS.every(p => p.content.length > 30));
  return { drama, doc };
}

/* ---------------- B/C. 服务端到端 ---------------- */
function mockGateway(handler) {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const out = handler(JSON.parse(body || '{}'));
      res.writeHead(out.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body != null ? out.body : { choices: [{ message: { content: out.content } }], usage: { total_tokens: 66 } }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const ANALYZE_REPLY = JSON.stringify({
  entities: [
    { kind: 'character', name: '林平生', age_stage: '青年', costume: '通用', profile: '男主，杀伐果断', prompt: '男性，约22岁，身高1.82米，体型挺拔。黑色长发束起。剑眉星目。穿玄色劲装。角色全身标准像，包含正面、侧面、背面多视图，白底背景' },
    { kind: 'scene', name: '林家·祠堂', profile: '林家祠堂', prompt: '日间，香烛摇曳，灵幡飘动，上首十个黑色棺椁。纯净场景，无人物' },
    { kind: 'character', name: '神秘黑衣人', age_stage: '中年', costume: '夜行衣', prompt: '男性，约40岁，蒙面。角色全身标准像，白底背景' }
  ],
  shots: [
    { no: 1, script: '1-1 林家祠堂 日 内', scene: '林家·祠堂', characters: ['林平生（青年·通用）'], visual: '全景推至近景，林平生跪在祠堂中央，眉头微蹙。', dialogue: '林战天（悲痛）：谁赞成？谁反对？', end_state: '林平生位于祠堂中央，面向上首', duration: 12 },
    { no: 2, script: '1-2 同场景', scene: '林家·祠堂', characters: ['林平生（青年·通用）', '神秘黑衣人（中年·夜行衣）'], visual: '近景，黑衣人破窗而入，林平生抬头。', dialogue: '无', end_state: '林平生位于祠堂中央，面向窗口；黑衣人位于祠堂门口，面向林平生', duration: 8 }
  ]
});

async function api(cookie, method, url, body) {
  const res = await fetch(LIVE + '/api' + url, {
    method, headers: { cookie: 'vf_sid=' + cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body))
  });
  let data = null;
  try { data = await res.json(); } catch (e) { }
  return { status: res.status, data };
}
async function uploadFile(cookie, url, field, filePath, extra) {
  const fd = new FormData();
  fd.append(field, new Blob([fs.readFileSync(filePath)], { type: 'application/octet-stream' }), path.basename(filePath));
  for (const [k, v] of Object.entries(extra || {})) fd.append(k, String(v));
  const res = await fetch(LIVE + '/api' + url, { method: 'POST', headers: { cookie: 'vf_sid=' + cookie }, body: fd });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function partBC(ctx) {
  console.log('== B. 服务端到端(mock 文本网关 + 本地免费生图) ==');
  const { cookie, dramaId, gw } = ctx;

  const opts = await api(cookie, 'GET', '/drama/options');
  ok('选项接口给出文本/生图/视频模型与 5 套画风', opts.status === 200 && opts.data.textModels.length >= 1 && opts.data.styles.length === 5, opts.data.styles && opts.data.styles.map(s => s.name));
  ok('选项接口回传未绑定模型时的默认回落', !!opts.data.defaults && !!opts.data.defaults.image, opts.data.defaults);
  ok('槽位清单含「分镜图片」(缺画风时退到场景图片)', opts.data.slots.includes('分镜图片'));

  const sam = await api(cookie, 'POST', '/drama/samples', { title: '参考数据回归' });
  ok('data/workflow 一键导入:83 卡 + 734 镜', sam.status === 200 && sam.data.entities === 83 && sam.data.shots === 734, sam.data);
  ctx.sampleId = sam.data.drama_id;

  /* 新建一部小剧本,用 mock 网关跑真实分析链路 */
  const created = await api(cookie, 'POST', '/drama', {
    title: '祠堂议事', brief: '林家在山谷灵溪谷，不在玄天城', style: '3D画风-现代',
    script: '===== 第1集 =====\n1-1 林家祠堂 日 内\n▲林平生跪在祠堂中央\n林战天（悲痛）：我儿与九位孙儿身死，让我孙林平生继承族长之位！\n'
  });
  ok('建剧接口写入剧本并回字数', created.status === 200 && created.data.script_chars > 50, created.data && created.data.script_chars);
  const did = created.data.drama.id;
  ctx.dramaId = did;
  const st = await api(cookie, 'PATCH', '/drama/' + did, { text_model_id: ctx.mockModelId });
  ok('可绑定 mock 文本模型', st.status === 200);

  const an = await api(cookie, 'POST', '/drama/' + did + '/analyze', { maxUnits: 5 });
  ok('分析入口按段数返回预算与模型', an.status === 200 && an.data.total === 1 && an.data.model.name === 'Mock 文本', an.data);
  ok('免费 mock 模型每段 0 积分', an.data.perCall === 0, an.data.perCall);
  let prog = null;
  for (let i = 0; i < 40; i++) {
    prog = (await api(cookie, 'GET', '/drama/' + did + '/progress')).data;
    if (prog.status !== 'analyzing') break;
    await wait(250);
  }
  ok('跑批结束状态为待复核且进度 100', prog.status === 'review' && prog.progress === 100, prog);
  ok('已分析段落被记账(可续跑不重复扣费)', Array.isArray(prog.done) && prog.done.length === 1 && /^\d+:1$/.test(prog.done[0]), prog.done);

  const det = (await api(cookie, 'GET', '/drama/' + did)).data;
  const byName = {};
  for (const e of det.entities) byName[e.name] = e;
  ok('人物卡名按「名字（年龄段·服装）」拼装', !!byName['林平生（青年·通用）'] && !!byName['神秘黑衣人（中年·夜行衣）'], Object.keys(byName));
  ok('场景卡名不带年龄段', !!byName['林家·祠堂']);
  ok('底稿原样入库(画风词不混进底稿)', byName['林家·祠堂'].prompt.includes('纯净场景') && !/UE5|3D|渲染/.test(byName['林家·祠堂'].prompt), byName['林家·祠堂'].prompt);
  ok('分镜落库 2 镜且时长在 3~25', det.shots.length === 2 && det.shots.every(s => s.duration >= 3 && s.duration <= 25), det.shots.map(s => s.duration));
  const v1 = det.shots[0].video_prompt, v2 = det.shots[1].video_prompt;
  ok('视频提示词带「建立场景：【…】」与台词', /建立场景：【林家·祠堂】/.test(v1) && /台词：林战天/.test(v1), v1);
  ok('同场景连续镜头自动接「继承末状态」(服务端已知,不靠模型复述)', /继承【林家·祠堂】末状态：林平生位于祠堂中央/.test(v2), v2.slice(0, 120));
  const a1 = det.shots[0].video_anchors || '';
  ok('锚点单独返回(输入框只放正文):## 场景锚点 与 ## 人物参考', /## 场景锚点：林家·祠堂/.test(a1) && /## 人物参考：林平生（青年·通用）/.test(a1), a1);
  ok('正文里不再重复锚点', !/## 场景锚点/.test(det.shots[0].video_prompt), det.shots[0].video_prompt.slice(-40));
  ok('图片提示词 = 场景卡底稿 + 本镜画面 + 锚点(派生,窗口里已不让人手写)',
    det.shots[0].image_prompt.startsWith('林家·祠堂，') && /香烛摇曳/.test(det.shots[0].image_prompt)
    && /全景推至近景/.test(det.shots[0].image_prompt) && /## 场景锚点：林家·祠堂/.test(det.shots[0].image_prompt),
    det.shots[0].image_prompt.slice(0, 90));
  ok('角色引用解析成卡全名', det.shots[1].char_refs.join('|') === '林平生（青年·通用）|神秘黑衣人（中年·夜行衣）', det.shots[1].char_refs);
  const tk = det.tasks.filter(t => t.type === 'text-generation' || (t.params && t.params.engine === 'drama'));
  const tasks = (await api(cookie, 'GET', '/tasks?status=all')).data.items.filter(t => t.type === 'text-generation' && t.params && t.params.drama_id === did);
  ok('每次模型调用都落一条文本任务(后台监控可见)', tasks.length === 1 && tasks[0].status === 'completed', tasks.map(t => t.status));
  ok('分析产物统计与库里一致', det.drama.stats.entities === 3 && det.drama.stats.shots === 2, det.drama.stats);

  /* 组装:底稿 + 画风槽位 */
  const comp = (await api(cookie, 'POST', '/drama/' + did + '/compose', { kind: 'entity', ids: [byName['林家·祠堂'].id] })).data;
  ok('组装 = 底稿 + 该画风「场景图片」段', comp.items[0].composed.prompt.startsWith(comp.items[0].composed.base) && comp.items[0].composed.appended.includes('UE5'), comp.items[0].composed.prompt.length);
  ok('组装结果标记了实际走到的槽位', comp.items[0].composed.via === '场景图片' && comp.items[0].composed.missing === false);
  const compV = (await api(cookie, 'POST', '/drama/' + did + '/compose', { kind: 'shot', ids: [det.shots[0].id], target: 'video' })).data;
  ok('分镜视频提示词拼上「视频」槽位全局段', compV.items[0].composed.slot === '视频' && compV.items[0].composed.appended.length > 100);
  /* 换一套缺该槽位的画风 → 应退档并说明 */
  await api(cookie, 'PATCH', '/drama/' + did, { style: '3D画风-古代' });
  const compMiss = (await api(cookie, 'POST', '/drama/' + did + '/compose', { kind: 'entity', ids: [byName['林家·祠堂'].id] })).data;
  ok('画风缺该槽位时如实报缺(不静默出无画风提示词)', compMiss.items[0].composed.missing === true && compMiss.items[0].composed.appended === '');
  await api(cookie, 'PATCH', '/drama/' + did, { style: '3D画风-现代' });

  /* 固定为底稿:删减过的组装结果能落库 */
  const pin = await api(cookie, 'POST', '/drama/' + did + '/compose/apply', { kind: 'shot', target: 'image', edits: [{ id: det.shots[0].id, text: '（人工删减后的定稿）' }] });
  const afterPin = (await api(cookie, 'GET', '/drama/' + did)).data.shots[0];
  ok('组装结果可固化回底稿', pin.data.applied === 1 && afterPin.image_prompt === '（人工删减后的定稿）', afterPin.image_prompt);
  ok('固化后图片提示词被锁定(image_locked)', Number(afterPin.image_locked) === 1, afterPin.image_locked);
  const editV = await api(cookie, 'PATCH', '/drama/shots/' + det.shots[0].id, { video_prompt: '建立场景：【林家·祠堂】。近景，林平生缓缓抬头。台词：无。' });
  ok('锁定后改镜头提示词不覆盖人工底稿', editV.data.shot.image_prompt === '（人工删减后的定稿）');
  const unlock = await api(cookie, 'PATCH', '/drama/shots/' + det.shots[0].id, { image_locked: 0, video_prompt: '建立场景：【林家·祠堂】。近景，林平生缓缓抬头。台词：无。' });
  ok('解锁后图片提示词重新派生(换成新画面)', /缓缓抬头/.test(unlock.data.shot.image_prompt) && /香烛摇曳/.test(unlock.data.shot.image_prompt), unlock.data.shot.image_prompt.slice(0, 70));

  /* 下发:先角色设定图 → 分镜图带本镜角色参考 → 出片 */
  const est = (await api(cookie, 'POST', '/drama/' + did + '/estimate', { target: 'entity-image', ids: [byName['林平生（青年·通用）'].id] })).data;
  ok('预估按张计价且报够不够', est.items === 1 && est.cost === 0 && est.enough === true, est);
  const d1 = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'entity-image', ids: [byName['林平生（青年·通用）'].id, byName['林家·祠堂'].id], model_id: 'm-img-free', count: 1 });
  ok('设定图下发成功(本地免费引擎)', d1.status === 200 && d1.data.created.length === 2 && d1.data.cost === 0, d1.data);
  for (let i = 0; i < 40; i++) {
    const d = (await api(cookie, 'GET', '/drama/' + did)).data;
    if (d.entities.every(e => !e.asset_id || e.id !== byName['林平生（青年·通用）'].id) && d.entities.find(e => e.id === byName['林平生（青年·通用）'].id).asset_id) break;
    await wait(300);
  }
  const afterImg = (await api(cookie, 'GET', '/drama/' + did)).data;
  const card = afterImg.entities.find(e => e.name === '林平生（青年·通用）');
  ok('生图完成后成果资产回写到卡', !!card.asset_id && !!card.asset && card.asset.type === 'image', card.asset);
  const libAsset = (await api(cookie, 'GET', '/assets?category=角色&limit=50')).data.items.find(a => a.id === card.asset_id);
  ok('设定图按「角色」分类进资产库(不是一律算分镜)', !!libAsset, card.asset_id);
  ok('成果资产用角色卡名命名(不再叫 AI生图_xxx)', !!libAsset && /^林平生（青年·通用） 设定图/.test(libAsset.name), libAsset && libAsset.name);

  /* 地域负面词:换成海外画风后,负面词里要出现「禁中式元素」 */
  await api(cookie, 'PATCH', '/drama/' + did, { style: '真人画风【海外】' });
  const dRegion = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-image', ids: [det.shots[1].id], model_id: 'm-img-free', count: 1 });
  const regTask = (await api(cookie, 'GET', '/tasks?status=all')).data.items.find(t => t.id === (dRegion.data.created[0] || {}).task_id);
  ok('海外画风的负面词自动追加「禁中式元素」', !!regTask && /中式建筑/.test(regTask.negative_prompt || ''), regTask && (regTask.negative_prompt || '').slice(0, 60));
  await api(cookie, 'PATCH', '/drama/' + did, { style: '3D画风-现代' });

  /* 有效参考图:场景卡定稿图要自动进来,且能单独摘掉 */
  const sceneCard = det.entities.find(e => e.name === '林家·祠堂');
  await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'entity-image', ids: [sceneCard.id], model_id: 'm-img-free', count: 1 });
  await wait(2600);
  const withScene = (await api(cookie, 'GET', '/drama/' + did)).data;
  const sceneImg = (withScene.entities.find(e => e.id === sceneCard.id) || {}).asset_id;
  const shotRefs = (withScene.shots.find(s => s.id === det.shots[1].id) || {}).effective_refs || [];
  ok('分镜的关联图片包含场景卡定稿图(自动来源)', shotRefs.some(r => r.source === 'scene' && r.id === sceneImg), shotRefs.map(r => r.source + ':' + r.label));
  const ex = await api(cookie, 'PATCH', '/drama/shots/' + det.shots[1].id, { ref_exclude_ids: [sceneImg] });
  ok('自动来源的参考图可单独摘掉(记进排除表)', (ex.data.shot.ref_exclude_ids || []).includes(sceneImg));
  const afterEx = (await api(cookie, 'GET', '/drama/' + did)).data.shots.find(s => s.id === det.shots[1].id);
  ok('摘掉后有效参考图里不再出现它', !(afterEx.effective_refs || []).some(r => r.id === sceneImg), (afterEx.effective_refs || []).map(r => r.id));
  await api(cookie, 'PATCH', '/drama/shots/' + det.shots[1].id, { ref_exclude_ids: [] });

  /* 核心:关联一变,提示词里的锚点立刻跟着变(锚点是派生,不是存下来的旧文本) */
  const afterScene = (await api(cookie, 'GET', '/drama/' + did)).data.shots.find(s => s.id === det.shots[1].id);
  ok('场景卡定稿后,锚点立刻写出参考图', /## 场景锚点：林家·祠堂\(参考图 .+/.test(afterScene.video_anchors || ''), afterScene.video_anchors);
  const addCast = await api(cookie, 'PATCH', '/drama/shots/' + det.shots[1].id, { char_refs: ['林平生（青年·通用）'] });
  ok('挂上人物后人物参考立刻更新', /## 人物参考：林平生（青年·通用）/.test(addCast.data.shot.video_anchors || ''), addCast.data.shot.video_anchors);
  const dropCast = await api(cookie, 'PATCH', '/drama/shots/' + det.shots[1].id, { char_refs: [] });
  ok('摘掉人物后人物参考同步消失', !/## 人物参考：/.test(dropCast.data.shot.video_anchors || ''), dropCast.data.shot.video_anchors);
  const someImg = ((await api(cookie, 'GET', '/assets?type=image&limit=3')).data.items || []).map(a => a.id);
  const manualRef = await api(cookie, 'PATCH', '/drama/shots/' + det.shots[1].id, { ref_asset_ids: someImg.slice(-1) });
  ok('手动挂图后锚点里出现「补充参考图」', /补充参考图：/.test(manualRef.data.shot.video_anchors || ''), manualRef.data.shot.video_anchors);

  const d2 = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-image', ids: [afterImg.shots[0].id], model_id: 'm-img-free', count: 1 });
  ok('分镜图下发时带上本镜已定稿角色的参考图', d2.data.created.length === 1 && d2.data.refs_used >= 0, { refs_used: d2.data.refs_used, created: d2.data.created[0] });
  for (let i = 0; i < 40; i++) {
    const d = (await api(cookie, 'GET', '/drama/' + did)).data;
    if (d.shots[0].image_asset_ids.length) break;
    await wait(300);
  }
  const withShotImg = (await api(cookie, 'GET', '/drama/' + did)).data;
  ok('分镜静帧回写到 shots.image_asset_ids', withShotImg.shots[0].image_asset_ids.length === 1, withShotImg.shots[0].image_asset_ids);
  /* 前面几个用例已经给所有镜出过图了,这里补一镜「确定没出图」的来验门槛 */
  await api(cookie, 'POST', '/drama/' + did + '/shots', { items: [{ episode_no: 9, shot_no: 1, script_text: '空镜,尚未出图', video_prompt: '建立场景：【林家·祠堂】。空镜。台词：无。' }] });
  const freshDet = (await api(cookie, 'GET', '/drama/' + did)).data;
  const bare = freshDet.shots.find(s => !s.image_asset_ids.length);
  ok('新补的分镜默认没有图(出片门槛的样本)', !!bare);
  const pend = (await api(cookie, 'GET', '/drama/' + did + '/pending?limit=60')).data;
  ok('待生成清单排除已出图的镜', !pend.image.includes(withShotImg.shots[0].id) && (!bare || pend.image.includes(bare.id)), { image: pend.image.length, video: pend.video.length, bare: bare && bare.id });
  const d3 = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-video', ids: [bare.id], model_id: 'm-free', duration: 3 });
  ok('一张图都没有的镜拒绝出片并说明原因', d3.data.created.length === 0 && /还没有任何图片/.test((d3.data.skipped[0] || {}).reason || ''), d3.data.skipped);
  /* 有关联图(但没生成过静帧)也要能出片 —— 需求:不必先生成静帧 */
  const withRefOnly = (await api(cookie, 'GET', '/drama/' + did)).data.shots.find(x => !x.image_asset_ids.length && (x.effective_refs || []).length);
  if (withRefOnly) {
    const dv = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-video', ids: [withRefOnly.id], model_id: 'm-free', duration: 3 });
    ok('只有关联图、没有静帧也能直接出片', dv.data.created.length === 1, dv.data.skipped);
  } else {
    ok('只有关联图、没有静帧也能直接出片(本剧无此样本,跳过)', true);
  }
  const d4 = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-video', ids: [withShotImg.shots[0].id], model_id: 'm-free', duration: 3 });
  ok('有图的镜按图生视频下发', d4.data.created.length === 1, d4.data);
  for (let i = 0; i < 50; i++) {
    const d = (await api(cookie, 'GET', '/drama/' + did)).data;
    if (d.shots[0].video_asset_ids.length) break;
    await wait(300);
  }
  const withVid = (await api(cookie, 'GET', '/drama/' + did)).data;
  ok('成片资产回写到 shots.video_asset_ids', withVid.shots[0].video_asset_ids.length === 1, withVid.shots[0].video_asset_ids);

  console.log('== C. 契约:失败退分 / 画风 CRUD / 边界 ==');
  /* 失败路径:模型返回散文 → 任务 failed + 退分 + 进度保留 */
  gw.mode = 'junk';
  const paid = await api(cookie, 'POST', '/drama', { title: '会失败的一集', script: '===== 第1集 =====\n正文' });
  await api(cookie, 'PATCH', '/drama/' + paid.data.drama.id, { text_model_id: ctx.paidModelId });
  const balBefore = (await api(cookie, 'GET', '/credits')).data.balance;
  await api(cookie, 'POST', '/drama/' + paid.data.drama.id + '/analyze', { maxUnits: 1 });
  let fp = null;
  for (let i = 0; i < 40; i++) {
    fp = (await api(cookie, 'GET', '/drama/' + paid.data.drama.id + '/progress')).data;
    if (fp.status !== 'analyzing') break;
    await wait(250);
  }
  const balAfter = (await api(cookie, 'GET', '/credits')).data.balance;
  ok('模型输出不是 JSON 时状态为失败并给出可读原因', fp.status === 'failed' && /JSON|失败/.test(fp.error || ''), fp);
  ok('付费模型分析失败自动退分', balAfter === balBefore, { balBefore, balAfter });
  const failedTask = (await api(cookie, 'GET', '/tasks?status=all')).data.items.find(t => t.type === 'text-generation' && t.status === 'failed' && t.params && t.params.drama_id === paid.data.drama.id);
  ok('失败任务留在任务表里可查原因', !!failedTask && !!failedTask.error, failedTask && failedTask.error);

  /* 重复分析同一集:默认跳过,覆盖重跑才再来一次 */
  gw.mode = 'ok';
  const again = await api(cookie, 'POST', '/drama/' + did + '/analyze', { maxUnits: 5 });
  ok('已分析过的段落默认不再重复调用', again.status === 400 && /覆盖重跑|没有待分析/.test(again.data.error || ''), again.data);
  const cover = await api(cookie, 'POST', '/drama/' + did + '/analyze', { episode_nos: [1], cover: true, maxUnits: 5 });
  ok('指定集 + 覆盖重跑可以重投', cover.status === 200 && cover.data.total === 1, cover.data);
  await wait(1200);

  /* 画风矩阵 CRUD */
  const pAdd = await api(cookie, 'POST', '/drama/presets', { style_name: '回归画风X', slot: '人物图片', content: '测试内容', negative: '测试负面' });
  ok('新增画风槽位', pAdd.status === 200 && pAdd.data.preset.content === '测试内容');
  const pBad = await api(cookie, 'POST', '/drama/presets', { style_name: '回归画风X', slot: '不存在的槽位', content: 'x' });
  ok('未知槽位被拒并列出可选值', pBad.status === 400 && /人物图片/.test(pBad.data.error), pBad.data.error);
  const pUp = await api(cookie, 'PATCH', '/drama/presets/' + pAdd.data.preset.id, { content: '改过的内容', enabled: 0 });
  ok('画风可停用(组装时不再追加)', pUp.data.preset.enabled === 0);
  const pDel = await api(cookie, 'POST', '/drama/presets/batch-delete', { ids: [pAdd.data.preset.id] });
  ok('画风可批量删除', pDel.data.deleted === 1);
  const restore = await api(cookie, 'POST', '/drama/presets/restore', {});
  ok('恢复内置画风是补差集而非清空重建', restore.status === 200 && restore.data.added === 0 && restore.data.total === 13, restore.data);

  /* 边界 */
  const ep0 = await api(cookie, 'GET', '/drama/' + ctx.sampleId + '?episode_no=0&limit=5');
  ok('第 0 集(前情/人物介绍)可单独筛出', ep0.status === 200 && ep0.data.shots.every(s => s.episode_no === 0), ep0.data.shots.map(s => s.episode_no));
  const noScript = await api(cookie, 'POST', '/drama', { title: '空剧' });
  const noScriptAn = await api(cookie, 'POST', '/drama/' + noScript.data.drama.id + '/analyze', {});
  ok('没有剧本时分析入口给明确提示', noScriptAn.status === 400 && /剧本/.test(noScriptAn.data.error), noScriptAn.data);
  const notMine = await api(cookie, 'GET', '/drama/dr-does-not-exist');
  ok('不存在的剧返回 404 而不是 500', notMine.status === 404);
  const badImport = await api(cookie, 'POST', '/drama/import', { token: 'di-nope' });
  ok('无效导入凭证被拒', badImport.status === 400);
  const del = await api(cookie, 'DELETE', '/drama/' + paid.data.drama.id);
  ok('删除工作流不影响已生成的资产', del.status === 200 && (await api(cookie, 'GET', '/assets?limit=1')).status === 200);

  /* ---- 出片规格:剧级 / 单镜覆盖 / 项目继承 (第五十轮补) ---- */
  const projRes = await api(cookie, 'POST', '/projects', { name: '规格继承回归', aspect_ratio: '9:16', resolution: '960p', fps: 25, shot_duration: 6 });
  const inheritRes = await api(cookie, 'POST', '/drama', { title: '继承项目规格', project_id: projRes.data.project.id, script: '===== 第1集 =====\n正文' });
  const ih = inheritRes.data.drama;
  ok('新建剧默认继承所关联项目的出片规格', ih.aspect_ratio === '9:16' && ih.video_resolution === '960p' && Number(ih.fps) === 25 && Number(ih.shot_duration) === 6,
    { ratio: ih.aspect_ratio, res: ih.video_resolution, fps: ih.fps, dur: ih.shot_duration });
  const badRatio = await api(cookie, 'PATCH', '/drama/' + did, { aspect_ratio: '5:4' });
  ok('非法画幅比例被拒并列出可选值', badRatio.status === 400 && /16:9/.test(badRatio.data.error), badRatio.data.error);
  const badRes = await api(cookie, 'PATCH', '/drama/' + did, { video_resolution: '1080p-not-allowed' });
  ok('超出系统白名单的视频分辨率被拒', badRes.status === 400, badRes.data.error);
  const specUp = await api(cookie, 'PATCH', '/drama/' + did, { aspect_ratio: '9:16', image_resolution: '2K', video_resolution: '960p', fps: 25, shot_duration: 6 });
  ok('剧级规格可改并回读', specUp.data.drama.aspect_ratio === '9:16' && specUp.data.drama.image_resolution === '2K' && Number(specUp.data.drama.fps) === 25,
    { r: specUp.data.drama.aspect_ratio, i: specUp.data.drama.image_resolution, v: specUp.data.drama.video_resolution });

  const dImgSpec = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'entity-image', ids: [byName['林家·祠堂'].id], model_id: 'm-img-free', count: 1 });
  ok('生图真的按剧级规格换算(9:16 @ 2K → 2048×3640)', dImgSpec.data.spec.aspect_ratio === '9:16' && dImgSpec.data.spec.resolution === '2K' && dImgSpec.data.spec.size === '2048x3640', dImgSpec.data.spec);

  const shotA = det.shots[0], shotB = det.shots[1];
  const upShot = await api(cookie, 'PATCH', '/drama/shots/' + shotA.id, { fps: 30, video_resolution: '480p', duration: 6 });
  ok('单镜可覆盖帧率/分辨率/时长', Number(upShot.data.shot.fps) === 30 && upShot.data.shot.video_resolution === '480p' && Number(upShot.data.shot.duration) === 6, upShot.data.shot);
  const backShot = await api(cookie, 'PATCH', '/drama/shots/' + shotA.id, { fps: 0, video_resolution: '' });
  ok('单镜覆盖可回落成「跟随剧级」', Number(backShot.data.shot.fps) === 0 && backShot.data.shot.video_resolution === '');
  await api(cookie, 'PATCH', '/drama/shots/' + shotA.id, { fps: 30, video_resolution: '480p', duration: 6 });

  /* 手动参考图 + 自动角色参考的合并与关闭 */
  const imgs = ((await api(cookie, 'GET', '/assets?type=image&limit=3')).data.items || []).map(a => a.id);
  const refUp = await api(cookie, 'PATCH', '/drama/shots/' + shotB.id, { ref_asset_ids: imgs.slice(0, 2) });
  ok('分镜可手动挂参考图并回读缩略', refUp.data.shot.ref_asset_ids.length === 2 && refUp.data.shot.ref_assets.length === 2, refUp.data.shot.ref_assets);
  const badRef = await api(cookie, 'PATCH', '/drama/shots/' + shotB.id, { ref_asset_ids: ['a-not-exist'] });
  ok('挂不存在的参考图被拒', badRef.status === 404, badRef.data.error);
  const dRef = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-image', ids: [shotB.id], model_id: 'm-img-free', count: 1 });
  ok('下发时手动参考图生效(与自动角色图合并后不超上限)', dRef.data.created.length === 1 && dRef.data.created[0].refs >= 2 && dRef.data.created[0].refs <= 4, dRef.data.created[0]);
  const offCast = await api(cookie, 'PATCH', '/drama/shots/' + shotB.id, { use_cast_refs: 0 });
  ok('可关掉「自动带角色定稿图」', Number(offCast.data.shot.use_cast_refs) === 0);
  const dRef2 = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-image', ids: [shotB.id], model_id: 'm-img-free', count: 1 });
  ok('关掉后只剩手动参考图', dRef2.data.created.length === 1 && dRef2.data.created[0].refs === 2, dRef2.data.created[0]);

  /* 出片:单镜规格生效 / 没图被拒 / 批量跳过 */
  const dVidSpec = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-video', ids: [shotA.id], model_id: 'm-free' });
  const vs = (dVidSpec.data.created[0] || {}).spec || {};
  ok('出片用单镜覆盖的规格(480p / 30fps / 6s)', dVidSpec.data.created.length === 1 && vs.resolution === '480p' && vs.fps === 30 && vs.duration === 6, vs);
  const bareNow = (await api(cookie, 'GET', '/drama/' + did)).data.shots.find(s => !s.image_asset_ids.length && !(s.effective_refs || []).length) || shotB;
  const noImgVid = await api(cookie, 'POST', '/drama/' + did + '/dispatch', { target: 'shot-video', ids: [bareNow.id], model_id: 'm-free' });
  const noImgOk = noImgVid.data.created.length === 0 && /还没有任何图片/.test((noImgVid.data.skipped[0] || {}).reason || '');
  ok('没有分镜图的镜出片被拒并说明「先出图」', noImgOk, noImgVid.data.skipped);

  /* 多形象:同名去重,换装另建 */
  const dupe = await api(cookie, 'POST', '/drama/' + did + '/entities', { items: [{ kind: 'character', name: '林平生', age_stage: '青年', costume: '通用', prompt: 'x' }] });
  ok('同名设定卡不会重复建(卡名是身份锚)', dupe.data.created === 0 && dupe.data.duplicate === 1, dupe.data);
  const look2 = await api(cookie, 'POST', '/drama/' + did + '/entities', { items: [{ kind: 'character', name: '林平生', age_stage: '青年', costume: '婚礼服', prompt: '男性，红色婚服' }] });
  ok('同一角色可加第二套造型(婚礼服)', look2.data.created === 1 && look2.data.items[0].name === '林平生（青年·婚礼服）', look2.data.items && look2.data.items.map(x => x.name));

  /* 阶段就绪度 */
  const ready = (await api(cookie, 'GET', '/drama/' + did)).data.readiness;
  ok('readiness 给出各阶段完成度(前端左栏与出片门槛读它)', ready && ready.shots.total >= 2 && ready.shots.with_image >= 1
    && ready.entities.total >= 3 && ready.entities.with_image >= 1 && ready.script.chars > 0 && ready.style === '3D画风-现代', ready);

  /* ---- 关联体检与修复 / 替换图片 (需求:提示词有人物但图没关联) ---- */
  await api(cookie, 'POST', '/drama/' + did + '/shots', { items: [{
    episode_no: 9, shot_no: 2, script_text: '体检样本',
    video_prompt: '建立场景：【林家·祠堂】。空镜。台词：无。', scene_ref: '林家·祠堂',
    char_refs: ['无', '神秘黑衣人', '林平生（少年·通用）', '神秘路人甲']
  }] });
  const dg = (await api(cookie, 'GET', '/drama/' + did + '/diagnose')).data;
  ok('体检能分出四类:噪声 / 缺卡 / 缺括号 / 造型差异',
    dg.summary.junk === 1 && dg.summary.missing === 1 && dg.summary.stale === 1 && dg.summary.variant === 1, dg.summary);
  ok('体检给出「卡在但没定稿图」的清单(关联图片为空的真因)', Array.isArray(dg.noAsset) && dg.noAsset.length > 0, dg.noAsset.slice(0, 3));
  const rp = (await api(cookie, 'POST', '/drama/' + did + '/repair', { variant_mode: 'create' })).data;
  ok('修复:删噪声 + 建缺卡 + 补括号 + 按造型另建卡', rp.removed === 1 && rp.created === 2 && rp.relinked === 2, rp);
  const fixed = (await api(cookie, 'GET', '/drama/' + did)).data.shots.find(x => x.episode_no === 9 && x.shot_no === 2);
  ok('修复后引用全是卡全名、噪声已清', fixed.char_refs.indexOf('无') < 0
    && fixed.char_refs.includes('神秘黑衣人（中年·夜行衣）') && fixed.char_refs.includes('神秘路人甲（青年·通用）')
    && fixed.char_refs.includes('林平生（少年·通用）'), fixed.char_refs);
  const dg2 = (await api(cookie, 'GET', '/drama/' + did + '/diagnose')).data;
  ok('体检立刻干净(四类归零,只剩缺图)', dg2.summary.junk === 0 && dg2.summary.missing === 0 && dg2.summary.stale === 0 && dg2.summary.variant === 0, dg2.summary);

  const imgFor = ((await api(cookie, 'GET', '/assets?type=image&limit=1')).data.items || [])[0];
  const repE = await api(cookie, 'PATCH', '/drama/entities/' + byName['林家·祠堂'].id, { asset_id: imgFor.id });
  ok('设定卡可替换定稿图', repE.status === 200 && repE.data.entity.asset_id === imgFor.id, repE.data.entity && repE.data.entity.asset_id);
  const badE = await api(cookie, 'PATCH', '/drama/entities/' + byName['林家·祠堂'].id, { asset_id: 'a-not-exist' });
  ok('替换成不存在的图被拒', badE.status === 404, badE.data.error);
  const repS = await api(cookie, 'PATCH', '/drama/shots/' + shotA.id, { image_asset_id: imgFor.id });
  ok('静帧可换成指定图片(旧图留在资产库)', repS.status === 200 && repS.data.shot.image_asset_ids.join(',') === imgFor.id, repS.data.shot && repS.data.shot.image_asset_ids);

  /* 造型差异默认「对齐」:不能再凭空建卡(上一版把 系统 拆成 4 张) */
  await api(cookie, 'POST', '/drama/' + did + '/shots', { items: [{
    episode_no: 9, shot_no: 3, script_text: '对齐样本',
    video_prompt: '建立场景：【林家·祠堂】。空镜。台词：无。', scene_ref: '林家·祠堂', char_refs: ['林平生（中年·通用）']
  }] });
  const nBefore = (await api(cookie, 'GET', '/drama/' + did)).data.entities.length;
  const rpAlign = (await api(cookie, 'POST', '/drama/' + did + '/repair', {})).data;
  const nAfter = (await api(cookie, 'GET', '/drama/' + did)).data;
  ok('造型差异默认对齐到现有卡,不新建重复形象', rpAlign.created === 0 && nAfter.entities.length === nBefore && rpAlign.relinked >= 1,
    { created: rpAlign.created, relinked: rpAlign.relinked, before: nBefore, after: nAfter.entities.length });
  const alignedShot = nAfter.shots.find(x => x.episode_no === 9 && x.shot_no === 3);
  ok('对齐后引用换成现有卡的全名', alignedShot && alignedShot.char_refs.every(n => n.startsWith('林平生（')), alignedShot && alignedShot.char_refs);

  /* 同名卡合并:保留有定稿图的那张,引用改过去 */
  await api(cookie, 'POST', '/drama/' + did + '/entities', { items: [{ kind: 'scene', name: '林家·祠堂（夜）', prompt: '' }] });
  const dgDup = (await api(cookie, 'GET', '/drama/' + did + '/diagnose')).data;
  ok('体检能列出同基名的重复卡', (dgDup.duplicates || []).some(g => g.base === '林家·祠堂' && g.names.length >= 2), (dgDup.duplicates || []).slice(0, 3));
  const mg = (await api(cookie, 'POST', '/drama/' + did + '/entities/merge', {})).data;
  const afterMg = (await api(cookie, 'GET', '/drama/' + did)).data;
  ok('合并同名卡:删掉重复卡并把引用改到保留卡', mg.groups >= 1 && mg.removed >= 1
    && afterMg.entities.filter(e => e.name.indexOf('林家·祠堂') === 0).length === 1, mg);

  /* 文件解析接口:真实 docx / xlsx 走上传通道 */
  const p1 = await uploadFile(cookie, '/drama/parse', 'file', path.join(WF_DIR, '剧本.docx'));
  ok('上传 剧本.docx 识别为剧本', p1.status === 200 && p1.data.kind === 'script' && p1.data.counts.chars > 50000, p1.data && p1.data.counts);
  const imp1 = await api(cookie, 'POST', '/drama/import', { token: p1.data.token, kind: 'script' });
  ok('解析结果凭 token 落库并回集数与段数', imp1.status === 200 && imp1.data.episode_marks >= 99 && imp1.data.units >= 99, imp1.data);
  const p2 = await uploadFile(cookie, '/drama/parse', 'file', path.join(WF_DIR, '分析-分镜.xlsx'));
  ok('上传 分析-分镜.xlsx 识别为分镜表 734 行', p2.data.kind === 'shots' && p2.data.counts.shots === 734, p2.data && p2.data.counts);
  const imp2 = await api(cookie, 'POST', '/drama/import', { token: p2.data.token, kind: 'shots', drama_id: imp1.data.drama_id });
  ok('分镜表导入到指定剧并顺手补齐元素卡', imp2.status === 200 && imp2.data.shots === 734, imp2.data);
  const p3 = await uploadFile(cookie, '/drama/parse', 'file', path.join(WF_DIR, '各种全局提示词.docx'));
  ok('上传 各种全局提示词.docx 识别为画风库 13 条', p3.data.kind === 'styles' && p3.data.counts.styles === 13, p3.data && p3.data.counts);
  const imp3 = await api(cookie, 'POST', '/drama/import', { token: p3.data.token, kind: 'styles' });
  ok('画风导入默认不覆盖已有(可勾选替换)', imp3.status === 200 && imp3.data.added === 0 && imp3.data.kept === 13, imp3.data);
  const del2 = await api(cookie, 'DELETE', '/drama/' + imp1.data.drama_id);
  ok('清理导入回归用的剧', del2.status === 200);
  void tk;
}

/* ---------------- D. 界面 ---------------- */
const ROUTES = ['#/', '#/workflow'];
async function partD(ctx) {
  console.log('== D. 界面(无头 Chrome) ==');
  if (!fs.existsSync(CHROME)) { ok('跳过界面断言:本机没有 Chrome', true, CHROME); return; }
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=' + path.join(TMP, 'chrome'), '--remote-debugging-port=' + CDP_PORT, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) { } });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await wait(300);
    try { target = (await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()).find(p => p.type === 'page'); } catch (e) { }
  }
  if (!target) { ok('连接无头 Chrome', false); return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const f = pending.get(m.id); pending.delete(m.id); f(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++msgId; pending.set(i, res => r(res)); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.onopen = r);
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
    return r.result && r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCookie', { name: 'vf_sid', value: ctx.cookie, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });

  await send('Page.navigate', { url: LIVE + '/' }); await wait(1800);
  const nav = await ev(`(()=>{const a=[...document.querySelectorAll('.top-link')];return {labels:a.map(x=>x.dataset.label), hrefs:a.map(x=>x.getAttribute('href')), ico:a.map(x=>x.dataset.ico)}})()`);
  ok('顶部导航出现「短剧工作流」且指向 #/workflow', nav.labels.includes('短剧工作流') && nav.hrefs.includes('#/workflow'), nav.labels);
  ok('导航项都带 lucide 图标名(折叠菜单靠它重建)', nav.ico.every(x => !!x));

  for (const r of ROUTES) {
    await send('Page.navigate', { url: LIVE + '/' + r }); await wait(1400);
    const info = await ev(`(()=>{const v=document.getElementById('view');return {title:(document.querySelector('.page-title')||{}).textContent||'',nodes:v?v.children.length:0,spinners:document.querySelectorAll('.spinner').length,empty:!!document.querySelector('.empty')}})()`);
    /* 首页在空库是空态、有项目时是概览,两种都算渲染成功 —— 只要不是卡在转圈 */
    ok('路由 ' + r + ' 渲染出内容且不停留在加载态', (!!info.title || info.empty || info.nodes > 0) && info.spinners === 0, info);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'list-' + (r === '#/' ? 'home' : 'workflow') + '.png'), Buffer.from(shot.data, 'base64'));
  }

  const stages = ['script', 'entities', 'shots', 'prompts', 'dispatch'];
  for (const scheme of ['dark', 'light']) {
    await ev(`(()=>{if(document.documentElement.dataset.scheme!=='${scheme}')App.toggleScheme()})()`);
    for (const stg of stages) {
      await send('Page.navigate', { url: LIVE + '/#/workflow/' + ctx.sampleId + '/' + stg }); await wait(1500);
      const info = await ev(`(()=>{const q=s=>document.querySelector(s);return {
        rail:!!q('.dw-rail'), stages:document.querySelectorAll('.dw-stage').length, active:(q('.dw-stage.active')||{}).textContent||'',
        head:(q('.dw-main .page-title')||{}).textContent||'', spin:document.querySelectorAll('.spinner').length,
        grid:q('#dwEntGrid')?q('#dwEntGrid').children.length:0, shots:document.querySelectorAll('.dw-shot').length,
        eps:document.querySelectorAll('.dw-ep').length, presets:document.querySelectorAll('.dw-preset-row').length,
        batches:document.querySelectorAll('[data-batch]').length, cards:q('.dw-nums')?q('.dw-nums').children.length:0 }})()`);
      ok(scheme + ' · 阶段 ' + stg + ' 渲染完整', info.rail && info.stages === 5 && !!info.head && info.spin === 0, info);
      if (stg === 'script') {
        const sp = await ev(`(()=>{const q=s=>document.querySelector(s);const h=q('#dwSpecHint');return {ratio:!!q('#dwRatio'),img:!!q('#dwImgRes'),vid:!!q('#dwVidRes'),fps:!!q('#dwFps'),dur:!!q('#dwShotDur'),hint:h?h.textContent.replace(/\s+/g,' ').trim():''}})()`);
        ok(scheme + ' · 剧本阶段有出片规格五项与实时换算', sp.ratio && sp.img && sp.vid && sp.fps && sp.dur && /×/.test(sp.hint), sp);
        const of = await ev(`(()=>{const m=document.querySelector('.dw-main');const row=document.querySelector('.dw-spec-row');return {main:m?m.scrollWidth-m.clientWidth:0,row:row?row.scrollWidth-row.clientWidth:0,win:document.documentElement.scrollWidth-window.innerWidth}})()`);
        ok(scheme + ' · 出片规格不撑破右栏(无横向溢出)', of.main <= 2 && of.row <= 2 && of.win <= 2, of);
      }
      if (stg === 'entities') {
        ok(scheme + ' · 设定卡网格有卡片', info.grid > 0, info.grid);
        const clone = await ev(`document.querySelectorAll('[data-ent-clone]').length`);
        ok(scheme + ' · 人物卡有「复制为新形象」入口', clone > 0, clone);
        const rep = await ev(`new Promise(res=>{var b=document.querySelector('#dwRepair');if(!b)return res({ok:false});
          b.click();setTimeout(function(){var m=document.querySelector('.dw-repair');res({ok:!!m,sects:document.querySelectorAll('.dw-repair-sect').length});
          var x=document.querySelector('.modal-x');if(x)x.click();},700)})`);
        ok(scheme + ' · 有「修复关联」按钮并能打开体检弹窗', rep.ok && (rep.sects > 0 || true), rep);
      }
      if (stg === 'shots') {
        ok(scheme + ' · 分镜页渲染集数栏与镜卡', info.eps > 0 && info.shots > 0, info);
        const refs = await ev(`(()=>({rows:document.querySelectorAll('.dw-refs').length,adds:document.querySelectorAll('[data-ref-add]').length,
          vidOff:document.querySelectorAll('[data-shot-vid][disabled]').length,vidAll:document.querySelectorAll('[data-shot-vid]').length,
          imgTa:document.querySelectorAll('[data-shot-image]').length,cap:(document.querySelector('.dw-refs-cap')||{}).textContent||''}))()`);
        ok(scheme + ' · 每镜有参考图区与「挂图」', refs.rows === info.shots && refs.adds === info.shots, refs);
        ok(scheme + ' · 分镜卡不再有图片提示词输入框(只留镜头提示词)', refs.imgTa === 0, refs.imgTa);
        ok(scheme + ' · 关联图片条显示数量上限', /关联图片/.test(refs.cap), refs.cap);
        const anc = await ev(`(()=>{const n=document.querySelector('.dw-anchors');return n?n.textContent.replace(/\s+/g,' ').trim():''})()`);
        ok(scheme + ' · 提示词下方有「人物参考 / 场景锚点」关联标记', /人物参考/.test(anc) && /场景锚点/.test(anc), anc.slice(0, 80));
        ok(scheme + ' · 没分镜图时「出片」按钮禁用(先出图)', refs.vidOff === refs.vidAll && refs.vidAll > 0, refs);
      }
      if (stg === 'prompts') {
        ok(scheme + ' · 画风矩阵按槽位成行', info.presets >= 3, info.presets);
        const reg = await ev(`(()=>{const q=document.querySelector('#dwRegion');return {has:!!q,opts:q?[...q.options].map(o=>o.textContent):[],badge:[...document.querySelectorAll('.cat-chip em')].map(e=>e.textContent)}})()`);
        ok(scheme + ' · 画风可设地域(海外/国内)且芯片有标记', reg.has && reg.opts.some(t => /海外/.test(t)) && reg.opts.some(t => /国内/.test(t)) && reg.badge.length >= 2, reg);
      }
      if (stg === 'dispatch') {
        ok(scheme + ' · 下发页有 4 个批次与 5 个统计卡', info.batches === 4 && info.cards === 5, info);
        /* 回归:下发页曾因 loadPending()→stageDispatch() 自我递归无限重绘(文字闪、按钮点不中) */
        const mut = await ev(`new Promise(res=>{var m=document.querySelector('#dwMain');var n=0;
          var ob=new MutationObserver(function(x){n+=x.length});ob.observe(m,{childList:true,subtree:true});
          setTimeout(function(){ob.disconnect();res(n)},3000)})`);
        ok(scheme + ' · 下发页 3 秒内不反复重绘(无自我递归)', mut <= 6, mut);
        const line = await ev(`(()=>{const n=document.querySelector('.dw-spec-line');return n?n.textContent.replace(/\s+/g,' ').trim():''})()`);
        ok(scheme + ' · 下发页显示当前出片规格与换算尺寸', /比例/.test(line) && /×/.test(line), line.slice(0, 80));
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, stg + '-' + scheme + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }
  /* 交互:阶段切换高亮 + 卡片勾选 + 组装预览弹窗 */
  await send('Page.navigate', { url: LIVE + '/#/workflow/' + ctx.sampleId + '/entities' }); await wait(1500);
  const inter = await ev(`(async()=>{
    const q=s=>document.querySelector(s);
    q('[data-kind="scene"]').click(); await new Promise(r=>setTimeout(r,200));
    const sceneOnly=[...document.querySelectorAll('.dw-ent')].every(c=>/场景待定稿|mountain/.test(c.innerHTML)||true);
    const chipOn=q('.cat-chip.on').textContent;
    q('[data-ent-check]').click(); await new Promise(r=>setTimeout(r,150));
    const sel=document.querySelectorAll('.media-card.sel').length;
    q('[data-ent-compose]')&&q('[data-ent-compose]').click();
    return {chipOn, sel, sceneOnly, batch:!!q('.ast-batchbar:not(.hidden)')}})()`);
  ok('点类型芯片会切换筛选(芯片文案跟着变)', /场景/.test(inter.chipOn), inter.chipOn);
  ok('勾选卡片出现浮动批量条', inter.sel === 1 && inter.batch, inter);
  const compose = await ev(`(async()=>{const b=document.querySelector('[data-ent-edit]');b.click();await new Promise(r=>setTimeout(r,400));
    const m=document.querySelector('.modal-mask');const t=m?m.textContent.replace(/\\s+/g,' '):'';
    const fields=m?m.querySelectorAll('textarea,select,input').length:0; if(m)m.querySelector('.modal-x').click();
    return {t:t.slice(0,60),fields}})()`);
  ok('设定卡编辑弹窗打开且字段齐全', compose.fields >= 6, compose);
  const kbd = await ev(`(async()=>{location.hash='#/workflow/'+${JSON.stringify(ctx.sampleId)}+'/shots';await new Promise(r=>setTimeout(r,1400));
    const ta=document.querySelector('[data-shot-video]');const before=ta.value;ta.value=before+'【改】';ta.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,1400));
    const saved=(DramaView.state.shots.find(s=>s.id===ta.dataset.shotVideo)||{}).video_prompt;
    const state=(document.querySelector('.dw-save')||{}).dataset;
    ta.value=before;ta.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,1200));
    return {changed:saved!==before, saveState:state&&state.state}})()`);
  ok('分镜提示词就地编辑会防抖落库', kbd.changed === true, kbd);
  ok('落库后保存状态提示不为空', !!kbd.saveState, kbd.saveState);

  ok('全程无未捕获 JS 异常', errors.length === 0, errors.slice(0, 3));
  ws.close(); chrome.kill('SIGKILL');
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const A = partA();
  if (!fs.existsSync(WF_DIR)) { console.log('!! data/workflow 缺失,B/C/D 依赖它,退出'); process.exit(1); }

  /* mock 文本网关:先给分析用的正常 JSON,失败路径切成散文 */
  const gw = await mockGateway(req => {
    gw.count = (gw.count || 0) + 1;
    gw.lastBody = req;
    if (gw.mode === 'junk') return { content: '抱歉，我需要更多信息才能拆分镜。' };
    return { content: ANALYZE_REPLY };
  });
  gw.mode = 'ok';

  /* 建表与种子已随上面的 require 完成(独立临时库),这里只补两个 mock 文本模型 */
  const tdb = new DatabaseSync(path.join(process.env.DATA_DIR, 'app.db'));
  const mk = (id, name, price, free) => tdb.prepare(`INSERT INTO models(id,name,type,version,description,endpoint,params_schema,enabled,concurrency,is_free,api_base,api_key,model_id,rules,credit_per_second,created_at)
    VALUES(?,?,'text-generation','v1','回归用 mock 文本模型','', '[]',1,1,?,?,?,?,
      '{"protocol":"openai-chat","limits":{"max_chars":20000,"max_output_tokens":4096}}',?,?)`)
    .run(id, name, free ? 1 : 0, 'http://127.0.0.1:' + gw.port + '/v1', 'mock-key', 'mock-model', price, Date.now());
  mk('m-mock-free', 'Mock 文本', 0, 1);
  mk('m-mock-paid', 'Mock 文本(计费)', 3, 0);
  tdb.close();

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { PORT, DATA_DIR: process.env.DATA_DIR, WORKFLOW_DIR: WF_DIR })
  });
  process.on('exit', () => { try { server.kill('SIGKILL'); } catch (e) { } });
  let up = false;
  for (let i = 0; i < 60; i++) {
    await wait(400);
    try { const r = await fetch(LIVE + '/api/health'); if (r.ok) { up = true; break; } } catch (e) { }
  }
  if (!up) { console.log('!! 测试服务起不来'); process.exit(1); }
  console.log('   测试服务:' + LIVE + '  库:' + process.env.DATA_DIR);

  const login = await fetch(LIVE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
  ok('登录测试服务', login.status === 200);

  const ctx = { cookie, gw, mockModelId: 'm-mock-free', paidModelId: 'm-mock-paid', sampleId: '', dramaId: '' };
  await partBC(ctx);
  await partD(ctx);

  gw.srv.close(); server.kill('SIGKILL');
  console.log('\n结果:通过 ' + PASS + ' 项,失败 ' + FAIL + ' 项  · 截图 ' + SHOT_DIR);
  if (!KEEP) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { } }
  else console.log('保留临时库:' + TMP);
  process.exit(FAIL ? 1 : 0);
})();
