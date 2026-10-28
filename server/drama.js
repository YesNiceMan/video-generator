'use strict';
/* 短剧工作流引擎(第五十轮 · 需求三十)
 * 剧本 → 分段 → 逐段 LLM 分析(人物/场景卡 + 分镜) → 组装全局画风提示词 → 下发。
 *
 * 三条从 data/workflow 参考数据里学到的规则,决定了这里的写法:
 *  1) 卡名是身份锚:「林平生（青年·通用）」这种「名字（年龄段·服装）」全名在人物卡、
 *     分镜元素、提示词引用里必须一字不差地复用,否则一致性就断了 —— 所以卡名由服务端
 *     拼装,模型只给零件;场景名同理(「林家·祠堂」这种「地点·子场景」)。
 *  2) 底稿不带画风:分析表的提示词只写「这个人/这个场景长什么样」,画风由全局提示词
 *     矩阵按槽位追加(生成-人物场景.xlsx = 分析底稿 + 画风段,正是这一步的产物)。
 *  3) 状态要延续:参考表的视频提示词带「继承【场景】末状态…本分镜末状态[…]」,
 *     这是同一场景连续镜头不跳位的关键 —— 上一镜末状态服务端已经知道,不必让模型猜。
 */
const { db, getSettings } = require('./db');
const { uid, now, httpError } = require('./util');
const textgen = require('./textgen');
const credits = require('./credits');

const SLOTS = ['人物图片', '场景图片', '道具图片', '分镜图片', '视频'];
/* 分镜图缺画风时退回场景图:短剧每一镜都是「在这个场景里」,构图词同源 */
const SLOT_FALLBACK = { 分镜图片: '场景图片' };
const KIND_SLOT = { character: '人物图片', scene: '场景图片', prop: '道具图片' };
const KIND_CN = { character: '人物', scene: '场景', prop: '道具' };

/* ---------- 地域(第五十轮 · 需求七) ----------
   画风带地域时,画面元素与台词语言要跟着走:海外画风不出现中式元素、台词写英文;
   国内画风反之。**卡名不翻译** —— 卡名是身份锚,一翻全剧引用就断。 */
const REGIONS = {
  overseas: {
    key: 'overseas', label: '海外',
    visual: '欧美/西方背景与人物:西式或现代都市建筑、西方面孔与妆发、英文招牌;严禁中式元素(飞檐斗拱、宫灯、牌匾、汉服、马面裙、水墨画、中文字幕/招牌)',
    language: '台词一律写英文(可在括号里附一句中文意译),人名用拼音;剧本原文(script)字段保持原样不翻译',
    negative: '中式建筑,飞檐,宫灯,牌匾,汉服,古装,水墨画,中文字幕,中文招牌,亚洲面孔'
  },
  cn: {
    key: 'cn', label: '国内',
    visual: '中式或现代国内背景与东方面孔、中文招牌;严禁明显西式元素(欧式城堡、教堂、西方面孔、英文招牌与字幕)',
    language: '台词写中文,保留剧本原有的口语与称谓',
    negative: '欧式建筑,城堡,教堂,西方面孔,英文字幕,英文招牌'
  }
};
function regionOfStyle(styleName) {
  if (!styleName) return null;
  const row = db.prepare("SELECT region FROM prompt_presets WHERE style_name=? AND region<>'' LIMIT 1").get(String(styleName));
  return row && REGIONS[row.region] ? REGIONS[row.region] : null;
}

/* ---------- 一、分段 ---------- */
const CN_NUM = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 百: 100 };
function toEpisodeNo(raw) {
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10));
  let n = 0, cur = 0;
  for (const ch of s) {
    const v = CN_NUM[ch];
    if (v == null) continue;
    if (v >= 100) { n += (cur || 1) * v; cur = 0; }
    else if (v === 10) { n += (cur || 1) * 10; cur = 0; }
    else cur = v;
  }
  return n + cur;
}
/* 「===== 第1集 =====」「第 1 集」「第一集」都算分集标记 */
const EP_MARK = /^={0,12}\s*[-—·]?\s*第\s*([0-9０-９]{1,4}|[零一二三四五六七八九十百]{1,5})\s*[集话話]\s*[-—·]?\s*={0,12}$/;

/* 按段落把超长文本再切块:优先在空行处断开,保持镜头组完整 */
function chunkByParagraphs(text, maxChars) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const blocks = clean.split(/\n{2,}/);
  const out = [];
  let buf = '';
  for (let b of blocks) {
    if (b.length > maxChars) {
      /* 单块就超限:退到按行切 */
      const lines = b.split('\n');
      b = '';
      for (const ln of lines) {
        if ((b + '\n' + ln).length > maxChars && b) { out.push(b.trim()); b = ''; }
        b += (b ? '\n' : '') + ln;
      }
    }
    if ((buf + '\n\n' + b).length > maxChars && buf) { out.push(buf.trim()); buf = ''; }
    buf += (buf ? '\n\n' : '') + b;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* 返回 [{episode_no, part, parts, text}];ep 0 表示分集标记之前的「主要人物介绍 / 全片注意事项」 */
function splitEpisodes(script, maxChars) {
  const lines = String(script || '').replace(/\r\n/g, '\n').split('\n');
  const marks = [];
  lines.forEach((l, i) => { const m = EP_MARK.exec(l.trim()); if (m) marks.push({ i, no: toEpisodeNo(m[1]) }); });
  const units = [];
  if (marks.length) {
    const head = lines.slice(0, marks[0].i).join('\n').trim();
    if (head) units.push({ episode_no: 0, text: head });
    marks.forEach((mk, k) => {
      const end = k + 1 < marks.length ? marks[k + 1].i : lines.length;
      const body = lines.slice(mk.i, end).join('\n').trim();
      if (body) units.push({ episode_no: mk.no, text: body });
    });
  } else {
    const all = lines.join('\n').trim();
    if (all) units.push({ episode_no: 1, text: all });
  }
  const out = [];
  for (const u of units) {
    const parts = chunkByParagraphs(u.text, maxChars);
    parts.forEach((t, idx) => out.push({ episode_no: u.episode_no, part: idx + 1, parts: parts.length, text: t }));
  }
  return out;
}

/* ---------- 二、提示词模板(全在服务端,前端只能选集数) ---------- */
const ANALYST_SYSTEM = [
  '你是短剧制作的「美术设定 + 分镜」助手。输入是剧本的一部分(通常是一集)。',
  '你要同时产出两样东西:这一段里新出现的人物/场景/道具设定卡,以及这一段的分镜表。',
  '只输出一个 JSON 对象,不要 markdown 代码块,不要任何解释文字。结构严格如下:',
  '{"entities":[{"kind":"character|scene|prop","name":"不带括号的本名或地点名","age_stage":"少年|青年|中年|老年|未知","costume":"通用(换装时才写别的)","profile":"身份与性格一句话","prompt":"生图提示词底稿"}],',
  '"shots":[{"no":1,"script":"这一镜对应的剧本原文,保留原有台词与动作行","scene":"场景名(地点·子场景)",',
  '"characters":["出场人物的卡名,必须逐字复用【已建立人物卡】里的写法"],"visual":"画面描述:景别+运镜+主体动作+表情,60~160字",',
  '"dialogue":"本镜台词,没有就填 无","end_state":"本镜结束时每个出场角色的位置与朝向","duration":15}]}',
  '',
  '规则:',
  '1. 卡名格式固定为「本名（年龄段·服装）」,用全角括号,例如「林平生（青年·通用）」。凡【已建立人物卡】里已有的角色,一律沿用完全一致的卡名,禁止新建同音/近义/换行的重复卡。',
  '1.1 默认一个角色只有一张「通用」卡。只有剧本明确写了换装(婚服/素缟/夜行衣)、伪装或明显年龄跨度(十年后/少年时期)时,才为该角色另建一张造型卡,costume 必须写清是哪一套;没有明确描写就复用现有的「通用」卡,不要按心情换衣服。',
  '2. 场景名格式固定为「地点·子场景」,例如「林家·祠堂」「灵溪谷·月湖居」;同一地点每次都用同一个写法。场景卡不需要年龄段,卡名就是场景名。',
  '3. prompt 底稿只写「这个人物/场景本身长什么样」,严禁写画风词(3D、国漫、UE5、胶片、电影机、渲染之类)—— 画风由系统按全局提示词统一追加,写进去会打架。',
  '4. 人物 prompt 依次写:性别、约几岁、身高、体型、发型与发色、脸型五官、瞳孔与肤色、服装款式面料与配饰、神态与姿势,末尾固定接「角色全身标准像,包含正面、侧面、背面多视图,白底背景」。',
  '5. 场景 prompt 依次写:时间、光源与光线走向、空间布局、核心道具与陈设、氛围与天气,末尾固定接「纯净场景,无人物」。',
  '6. duration 是 3~25 的整数秒,按台词长度与动作量估;每段最多 12 镜,同一场景连续动作可合并成一镜。',
  '7. end_state 形如「林战天位于祠堂上首，面向众人；林平生位于祠堂中央，面向上首」,用中文分号分隔,必须覆盖本镜所有出场角色。',
  '8. 有【承接状态】时,本段第一镜的站位与动作必须接得住它,不要凭空改变人物位置。',
  '9. 台词、旁白、字幕提示都留在 script 原文里,visual 只描述画面。',
  '10. 有【地域与语言】时必须服从它:visual 里不得出现它禁止的元素,costume/道具/陈设要符合它的地域;dialogue 的语言按它要求写,但 script 字段始终保留剧本原文、不要翻译;卡名(name)一律不翻译。'
].join('\n');

function nameCard(e) {
  const base = String(e.name || '').trim();
  if (!base) return '';
  if (/[（(].+[)）]\s*$/.test(base)) return base; /* 模型已经给了全名,尊重它 */
  if (e.kind !== 'character') return base;
  const age = String(e.age_stage || '').trim() || '青年';
  const costume = String(e.costume || '').trim() || '通用';
  return base + '（' + age + '·' + costume + '）';
}

/* 上下文里给模型的已知卡,控制在千字内,否则模型会被名单吃掉额度 */
function cardList(names, limit = 60) {
  const arr = names.slice(0, limit);
  const rest = names.length - arr.length;
  return (arr.join('、') || '（暂无）') + (rest > 0 ? '…等 ' + names.length + ' 张' : '');
}

function buildAnalyzeMessages(drama, unit, known, carry, maxChars) {
  const region = regionOfStyle(drama.style);
  const head = [
    drama.brief ? '【全局设定(仅供理解,不要复述)】\n' + String(drama.brief).slice(0, 1200) : '',
    drama.style ? '【当前画风】' + drama.style + '(不要把它写进任何 prompt 底稿)' : '',
    region ? '【地域与语言 · ' + region.label + '】\n画面与道具:' + region.visual + '\n台词:' + region.language : '',
    '【已建立人物卡】\n' + cardList(known.characters),
    '【已建立场景卡】\n' + cardList(known.scenes),
    carry ? '【承接状态】上一镜末状态:' + String(carry).slice(0, 400) : ''
  ].filter(Boolean).join('\n\n');
  const room = Math.max(800, maxChars - head.length - 600);
  const body = unit.text.length > room ? unit.text.slice(0, room) : unit.text;
  const label = unit.episode_no === 0 ? '全片设定/人物介绍' : ('第' + unit.episode_no + '集')
    + (unit.parts > 1 ? (' 第' + unit.part + '/' + unit.parts + '块') : '');
  return [
    { role: 'system', content: ANALYST_SYSTEM },
    { role: 'user', content: head + '\n\n【' + label + '剧本原文】\n' + body }
  ];
}

/* ---------- 三、容错 JSON ---------- */
function sliceBalanced(s, from) {
  const open = s[from];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return s.slice(from, i + 1); }
  }
  return null;
}

/* 模型爱在 JSON 前后加话,也爱截断;所以先整体解析,失败再逐键抢救 */
function parseAnalysisJson(raw) {
  let s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  if (start < 0) throw new Error('模型没有返回 JSON 对象');
  let obj = null;
  const whole = sliceBalanced(s, start);
  if (whole) { try { obj = JSON.parse(whole); } catch (e) { obj = null; } }
  if (!obj) {
    obj = {};
    for (const key of ['entities', 'shots']) {
      const k = s.indexOf('"' + key + '"');
      if (k < 0) continue;
      const a = s.indexOf('[', k);
      const seg = a >= 0 ? sliceBalanced(s, a) : null;
      if (!seg) continue;
      try { obj[key] = JSON.parse(seg); } catch (e) { /* 截断的数组救不回来,跳过该键 */ }
    }
    if (!obj.shots && !obj.entities) throw new Error('模型返回的 JSON 解析失败(输出可能被截断,可缩小单段字数后重试)');
  }
  if (Array.isArray(obj)) obj = { shots: obj };
  return obj;
}

/* ---------- 四、落库 ---------- */
function knownCards(dramaId) {
  /* prompt/profile 也要带上:派生图片提示词要用场景卡底稿,不能只拿名字 */
  const rows = db.prepare('SELECT id, name, kind, prompt, profile, asset_id FROM drama_entities WHERE drama_id=?').all(dramaId);
  const known = { characters: [], scenes: [], props: [], all: new Map() };
  for (const r of rows) {
    const bucket = r.kind === 'scene' ? 'scenes' : r.kind === 'prop' ? 'props' : 'characters';
    known[bucket].push(r.name);
    known.all.set(r.name, r);
  }
  return known;
}

/* 卡名归一:全名优先,退到「本名」前缀(模型偶尔漏括号) */
function findCard(known, name, kind) {
  const exact = known.all.get(name);
  if (exact) return exact;
  const base = name.replace(/[（(].+[)）]\s*$/, '');
  for (const [k, v] of known.all) if (v.kind === kind && (k === base || k.startsWith(base + '（'))) return v;
  return null;
}

function upsertEntity(dramaId, raw, sortBase) {
  const kind = raw.kind === 'scene' ? 'scene' : raw.kind === 'prop' ? 'prop' : 'character';
  const name = nameCard(raw);
  if (!name) return null;
  const existed = db.prepare('SELECT * FROM drama_entities WHERE drama_id=? AND name=? AND kind=?').get(dramaId, name, kind);
  const prompt = String(raw.prompt || raw.description || '').trim().slice(0, 4000);
  const profile = String(raw.profile || raw.note || '').trim().slice(0, 1000);
  if (existed) {
    /* 已生成过设定图的卡不能被分析覆盖掉人工改过的提示词 */
    const patch = {};
    if (!existed.prompt && prompt) patch.prompt = prompt;
    if (!existed.profile && profile) patch.profile = profile;
    if (Object.keys(patch).length) {
      db.prepare('UPDATE drama_entities SET prompt=?, profile=?, updated_at=? WHERE id=?')
        .run(patch.prompt != null ? patch.prompt : existed.prompt, patch.profile != null ? patch.profile : existed.profile, now(), existed.id);
    }
    return existed.id;
  }
  const id = uid('de-');
  db.prepare(`INSERT INTO drama_entities(id,drama_id,kind,name,age_stage,costume,profile,prompt,sort_index,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, dramaId, kind, name, String(raw.age_stage || '').slice(0, 20), String(raw.costume || '').slice(0, 40),
      profile, prompt, sortBase, now(), now());
  return id;
}

/* 把服务端已知信息补回提示词,产出参考表那种带锚点与状态的形态 */
/* 图片提示词不再由人写:场景卡底稿定「在哪」、本镜画面定「看到什么」、锚点定「谁」。
   只有「组装预览 → 固定为底稿」过的镜(image_locked=1)才用人工版本。 */
function castOf(shot) {
  if (Array.isArray(shot.char_refs)) return shot.char_refs.filter(Boolean);
  try { return JSON.parse(shot.char_refs || '[]').filter(Boolean); } catch (e) { return []; }
}
function sceneBaseOf(card) {
  return String((card && (card.prompt || card.profile)) || '')
    .replace(/纯净场景[，,]?\s*无人物[。.]?/g, '')
    .replace(/无人物[，,。]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/* 从视频提示词里剥出「画面」:去掉建立场景/继承状态首句、台词、末状态与 ## 锚点段 */
function visualFromVideo(videoPrompt, fallback) {
  let s = String(videoPrompt || '').split('\n## ')[0];
  s = s.replace(/^建立场景：【[^】]*】。/, '');
  s = s.replace(/^继承【[^】]*】末状态：[^。]*。/, '');
  s = s.replace(/台词：[\s\S]*$/, '');
  s = s.replace(/本分镜末状态：[\s\S]*$/, '');
  s = s.trim();
  return s || String(fallback || '').trim();
}
/* 锚点里把「真的会带上的参考图」写出来 —— 关联图片之后,提示词里要看得见 */
function anchorLines(scene, cast, refNames) {
  const rn = refNames || {};
  const castLine = cast.map(n => (rn.cast && rn.cast[n] ? n + '(参考图 ' + rn.cast[n] + ')' : n));
  const extra = rn.extra && rn.extra.length ? '；补充参考图：' + rn.extra.join('、') : '';
  const out = [];
  if (castLine.length) out.push('## 人物参考：' + castLine.join(', '));
  if (scene || extra) out.push('## 场景锚点：' + (scene || '未定场景') + (rn.scene ? '(参考图 ' + rn.scene + ')' : '') + extra);
  return out.length ? '\n\n' + out.join('\n\n') : '';
}

function composeShotText(shot, opt) {
  opt = opt || {};
  const scene = shot.scene_ref;
  const cast = castOf(shot);
  const anchor = anchorLines(scene, cast, opt.refNames);
  const carry = shot.prev_state && (!shot.prev_scene || shot.prev_scene === scene)
    ? '继承【' + shot.prev_scene + '】末状态：' + shot.prev_state + '。' : '';
  const visual = String(shot.visual || '').trim();
  const video = '建立场景：【' + (scene || '未定场景') + '】。' + carry
    + (visual || String(shot.script || '').trim())
    + '台词：' + (String(shot.dialogue || '').trim() || '无') + '。'
    + (shot.end_state ? '\n本分镜末状态：[' + shot.end_state + ']' : '') + anchor;
  const sceneBase = sceneBaseOf(opt.sceneCard);
  const bits = [];
  if (scene) bits.push(scene + '，');
  if (sceneBase) bits.push(/[。]$/.test(sceneBase) ? sceneBase : sceneBase + '。');
  if (visual) bits.push(/[。]$/.test(visual) ? visual : visual + '。');
  const image = (bits.join('') || String(shot.script || '').trim()) + anchor;
  return { video, image };
}

function persistShots(dramaId, unit, shots, known, sortBase, state) {
  const ins = db.prepare(`INSERT INTO drama_shots(id,drama_id,episode_no,shot_no,script_text,image_prompt,video_prompt,duration,
    scene_ref,char_refs,end_state,sort_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let maxNo = state.lastNo;
  for (const s of shots) {
    if (!s || typeof s !== 'object') continue;
    const visual = String(s.visual || s.description || '').trim().slice(0, 1500);
    const scriptText = String(s.script || s.text || visual).trim().slice(0, 3000);
    if (!visual && !scriptText) continue;
    const sceneRaw = String(s.scene || s.scene_name || '').trim().replace(/[（(].+[)）]\s*$/, '');
    const sceneCard = sceneRaw ? findCard(known, sceneRaw, 'scene') : null;
    const scene_ref = sceneCard ? sceneCard.name : sceneRaw;
    const listed = Array.isArray(s.characters) ? s.characters : Array.isArray(s.elements) ? s.elements : [];
    const refs = [];
    for (const n of listed.map(x => String(x || '').trim()).filter(Boolean)) {
      const hit = findCard(known, n, 'character');
      if (hit) { refs.push(hit.name); continue; }
      /* 模型新建了卡但没在 entities 里给全名的兜底:按它写的名字建卡,后面人工补提示词 */
      const nid = upsertEntity(dramaId, { kind: 'character', name: n }, known.all.size + 1);
      if (nid) refs.push(db.prepare('SELECT name FROM drama_entities WHERE id=?').get(nid).name);
    }
    maxNo = Math.max(maxNo, 0) + 1;
    const no = Number(s.no) || maxNo;
    const part = {
      scene_ref, char_refs: refs, visual, script: scriptText,
      dialogue: String(s.dialogue || s.lines || '').trim().slice(0, 1500),
      end_state: String(s.end_state || s.state || '').trim().slice(0, 1200),
      prev_scene: state.lastScene, prev_state: state.lastState
    };
    const composed = composeShotText(part, { sceneCard });
    let dur = Math.round(Number(s.duration != null ? s.duration : s.seconds));
    if (!Number.isFinite(dur)) dur = 0;
    dur = Math.max(3, Math.min(25, dur || 10));
    ins.run(uid('ds-'), dramaId, unit.episode_no, no, scriptText || visual, composed.image, stripAnchors(composed.video), dur,
      scene_ref, JSON.stringify(refs), part.end_state, sortBase++, now(), now());
    state.lastNo = no;
    state.lastState = part.end_state || state.lastState;
    state.lastScene = scene_ref || state.lastScene;
  }
  return sortBase;
}

/* ---------- 五、跑批 ---------- */
const runner = { job: null };

function currentJob(dramaId) { return runner.job && (!dramaId || runner.job.dramaId === dramaId) ? runner.job : null; }

function pickTextModel(id) {
  if (id) {
    const m = db.prepare("SELECT * FROM models WHERE id=? AND type='text-generation'").get(String(id));
    if (!m) throw httpError(400, '绑定的文本模型不存在');
    if (!m.enabled) throw httpError(400, '绑定的文本模型「' + m.name + '」已被禁用');
    if (!m.api_base || !m.api_key) throw httpError(400, '文本模型「' + m.name + '」还没配 API 地址或 Key');
    return m;
  }
  const def = String(getSettings().defaultTextModel || '');
  const m = (def ? db.prepare("SELECT * FROM models WHERE id=? AND enabled=1 AND type='text-generation'").get(def) : null)
    || db.prepare("SELECT * FROM models WHERE enabled=1 AND type='text-generation' ORDER BY created_at").get();
  if (!m) throw httpError(400, '还没有可用的文本模型：请到后台「模型管理」添加一个「文本处理」模型');
  if (!m.api_base || !m.api_key) throw httpError(400, '文本模型「' + m.name + '」还没配 API 地址或 Key');
  return m;
}

function dramaRow(id) {
  const d = db.prepare('SELECT * FROM dramas WHERE id=?').get(id);
  if (!d) throw httpError(404, '短剧工作流不存在');
  return d;
}

function refreshStats(dramaId) {
  const e = db.prepare('SELECT kind, COUNT(*) AS c FROM drama_entities WHERE drama_id=? GROUP BY kind').all(dramaId);
  const stats = { character: 0, scene: 0, prop: 0 };
  for (const x of e) stats[x.kind] = x.c;
  const s = db.prepare('SELECT COUNT(*) AS shots, COUNT(DISTINCT episode_no) AS episodes FROM drama_shots WHERE drama_id=?').get(dramaId);
  stats.entities = stats.character + stats.scene + stats.prop;
  stats.shots = s.shots; stats.episodes = s.episodes;
  db.prepare('UPDATE dramas SET stats=?, updated_at=? WHERE id=?').run(JSON.stringify(stats), now(), dramaId);
  return stats;
}

function setProgress(dramaId, patch) {
  db.prepare('UPDATE dramas SET ' + Object.keys(patch).map(k => k + '=?').join(',') + ', updated_at=? WHERE id=?')
    .run(...Object.values(patch), now(), dramaId);
}

/* 一次调用 = 一个分段;每段都独立扣费/落任务/失败退分,便于中断后续跑 */
const TASK_COLS = ['id', 'user_id', 'type', 'model_id', 'params', 'prompt', 'status', 'progress',
  'cost', 'created_at', 'started_at', 'finished_at', 'error', 'result_asset_ids', 'linked_asset_ids', 'drama_id'];
const TASK_DEFAULTS = { type: 'text-generation', progress: 0, result_asset_ids: '[]', linked_asset_ids: '[]' };
function writeTask(row) {
  const vals = TASK_COLS.map(c => row[c] !== undefined && row[c] !== null ? row[c] : (TASK_DEFAULTS[c] !== undefined ? TASK_DEFAULTS[c] : null));
  db.prepare('INSERT INTO tasks(' + TASK_COLS.join(',') + ') VALUES(' + TASK_COLS.map(() => '?').join(',') + ')').run(...vals);
}

async function analyzeUnit(drama, unit, index, total, model, perCall) {
  const dramaId = drama.id;
  const known = knownCards(dramaId);
  const last = db.prepare("SELECT end_state, scene_ref FROM drama_shots WHERE drama_id=? AND end_state<>'' ORDER BY episode_no DESC, shot_no DESC LIMIT 1").get(dramaId);
  const rules = textgen.normalizeRules(model);
  const maxChars = (rules.limits || {}).max_chars || 20000;
  const messages = buildAnalyzeMessages(drama, unit, known, last && last.end_state ? last.end_state + '（场景：' + last.scene_ref + '）' : '', maxChars);
  const taskId = uid('t-');
  const began = Date.now();
  if (perCall > 0 && !credits.deduct(drama.owner_id, perCall, '短剧分析 · 第' + unit.episode_no + '集', taskId)) {
    throw httpError(402, '积分不足：本次分析需 ' + perCall + ' 积分/段，余额 ' + credits.getBalance(drama.owner_id) + '，请先申请积分或改用免费文本模型');
  }
  const charsIn = messages[1].content.length;
  let out, parsed;
  try {
    out = await textgen.complete(model, messages, {
      temperature: 0.3, timeout_ms: 180000,
      max_tokens: Number((rules.limits || {}).max_output_tokens) || 4096
    });
    /* 解析失败也算这一段的失败:模型返回散文时钱已经扣了,不退就是「花了钱什么也没拿到」 */
    parsed = parseAnalysisJson(out.content);
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 500);
    writeTask({ id: taskId, user_id: drama.owner_id, model_id: model.id, drama_id: dramaId,
      params: JSON.stringify({ engine: 'drama', drama_id: dramaId, episode_no: unit.episode_no, part: unit.part, chars_in: charsIn, chars_out: out ? (out.content || '').length : 0 }),
      prompt: unit.text.slice(0, 2000), status: 'failed', cost: perCall,
      created_at: began, started_at: began, finished_at: Date.now(), error: msg });
    if (perCall > 0) credits.refundTask(taskId, '短剧分析失败');
    throw new Error('第' + unit.episode_no + '集' + (unit.parts > 1 ? '第' + unit.part + '块' : '') + '分析失败：' + msg);
  }
  const entities = Array.isArray(parsed.entities) ? parsed.entities : [];
  const shots = Array.isArray(parsed.shots) ? parsed.shots : [];
  let sortBase = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_entities WHERE drama_id=?').get(dramaId).m) + 1;
  for (const e of entities) upsertEntity(dramaId, e, sortBase++);
  const known2 = knownCards(dramaId);
  const sBase = (db.prepare('SELECT COALESCE(MAX(sort_index),0) AS m FROM drama_shots WHERE drama_id=?').get(dramaId).m) + 1;
  const state = {
    lastNo: (db.prepare('SELECT MAX(shot_no) AS n FROM drama_shots WHERE drama_id=? AND episode_no=?').get(dramaId, unit.episode_no).n) || 0,
    lastState: '', lastScene: ''
  };
  persistShots(dramaId, unit, shots.slice(0, 12), known2, sBase, state);
  writeTask({ id: taskId, user_id: drama.owner_id, model_id: model.id, drama_id: dramaId,
    params: JSON.stringify({
      engine: 'drama', drama_id: dramaId, episode_no: unit.episode_no, part: unit.part,
      chars_in: charsIn, chars_out: (out.content || '').length, entities: entities.length,
      shots: Math.min(shots.length, 12), usage: out.usage || null, ms: Date.now() - began
    }),
    prompt: unit.text.slice(0, 2000), status: 'completed', cost: perCall,
    created_at: began, started_at: began, finished_at: Date.now(), error: null });
  return { taskId, entities: entities.length, shots: Math.min(shots.length, 12) };
}

async function runAnalysis(dramaId, units) {
  const job = runner.job;
  const drama = dramaRow(dramaId);
  const model = pickTextModel(drama.text_model_id);
  const perCall = textgen.pricePerCall(model);
  /* 完成标记按「集:块」记,重跑某一集时不能把其它集已完成的进度冲掉 */
  const doneSet = new Set(JSON.parse(drama.done_episodes || '[]'));
  setProgress(dramaId, { status: 'analyzing', stage: '分析中', progress: 0, error: null });
  for (let i = 0; i < units.length; i++) {
    if (!job || job.cancelled) {
      setProgress(dramaId, { status: 'cancelled', stage: '', error: '已在第 ' + (i + 1) + '/' + units.length + ' 段处停止(已分析的内容保留)' });
      break;
    }
    job.unitIndex = i;
    try {
      await analyzeUnit(drama, units[i], i, units.length, model, perCall);
      doneSet.add(unitKey(units[i]));
      setProgress(dramaId, {
        progress: Math.round(((i + 1) / units.length) * 100),
        stage: '第 ' + (i + 1) + '/' + units.length + ' 段 · 第' + units[i].episode_no + '集',
        done_episodes: JSON.stringify([...doneSet]),
        status: 'analyzing', error: null
      });
      refreshStats(dramaId);
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 500);
      setProgress(dramaId, { status: 'failed', error: msg + (units.length - i - 1 > 0 ? '(后面 ' + (units.length - i - 1) + ' 段未跑,可续跑)' : ''), progress: Math.round((i / units.length) * 100) });
      break;
    }
  }
  const cur = dramaRow(dramaId);
  if (cur.status === 'analyzing') {
    refreshStats(dramaId);
    const st = JSON.parse(cur.stats || '{}');
    setProgress(dramaId, { status: st.shots ? 'review' : 'draft', stage: '', progress: 100 });
  }
  runner.job = null;
}

/* 入口:校验 + 占坑,真正跑批在后台(不阻塞响应,前端轮询 GET /drama/:id) */
const unitKey = u => u.episode_no + ':' + u.part;

function startAnalysis(dramaId, opts) {
  opts = opts || {};
  const drama = dramaRow(dramaId);
  if (runner.job) throw httpError(409, '「' + runner.job.title + '」正在分析中,请等它跑完或先点停止');
  if (!String(drama.script || '').trim()) throw httpError(400, '还没有剧本:先在「剧本」阶段粘贴或上传');
  const model = pickTextModel(drama.text_model_id);
  const maxChars = (textgen.normalizeRules(model).limits || {}).max_chars || 20000;
  const units = splitEpisodes(drama.script, Math.max(1200, maxChars - 3600));
  if (!units.length) throw httpError(400, '剧本切不出任何分段');
  const wanted = Array.isArray(opts.episode_nos) ? opts.episode_nos.map(Number).filter(Number.isFinite) : [];
  const doneSet = opts.cover ? new Set() : new Set(JSON.parse(drama.done_episodes || '[]'));
  let picked = units
    .filter(u => !wanted.length || wanted.includes(u.episode_no))
    .filter(u => !doneSet.has(unitKey(u)));
  if (!picked.length) {
    throw httpError(400, doneSet.size ? '没有待分析的段落(全部已分析过;要重新分析请勾选「覆盖重跑」)' : '没有匹配到要分析的段落');
  }
  const cap = Math.max(1, Math.min(200, Number(opts.maxUnits) || 40));
  picked = picked.slice(0, cap);
  const remain = units.filter(u => !doneSet.has(unitKey(u))).length - picked.length;
  runner.job = { dramaId, title: drama.title, cancelled: false, unitIndex: 0, began: Date.now() };
  runAnalysis(dramaId, picked).catch(e => {
    setProgress(dramaId, { status: 'failed', error: '跑批异常：' + String(e && e.message || e).slice(0, 400) });
    runner.job = null;
  });
  return {
    total: picked.length, perCall: textgen.pricePerCall(model), balance: credits.getBalance(drama.owner_id),
    model: { id: model.id, name: model.name }, episodes: [...new Set(picked.map(u => u.episode_no))],
    /* 一次跑批有上限,剩余段数告诉前端好显示「继续」按钮 */
    remaining: Math.max(0, remain)
  };
}

function stopAnalysis(dramaId) {
  if (!runner.job) return { stopped: false };
  if (dramaId && runner.job.dramaId !== dramaId) throw httpError(400, '当前跑批不属于这部剧');
  runner.job.cancelled = true;
  return { stopped: true };
}

/* ---------- 六、全局画风与组装 ---------- */
function presetMap(styleName) {
  const rows = db.prepare('SELECT * FROM prompt_presets WHERE style_name=? AND enabled=1 ORDER BY sort_index').all(String(styleName || ''));
  const map = {};
  for (const r of rows) {
    map[r.slot] = map[r.slot] || { content: [], negative: [], notes: [] };
    if (String(r.content || '').trim()) map[r.slot].content.push(String(r.content).trim());
    if (String(r.negative || '').trim()) map[r.slot].negative.push(String(r.negative).trim());
    if (String(r.note || '').trim()) map[r.slot].notes.push(String(r.note).trim());
  }
  return map;
}

/* 底稿 + 画风 = 生成提示词(与 生成-人物场景.xlsx 同构);缺该槽位时按 SLOT_FALLBACK 退一档 */
function composePrompt(drama, base, slot) {
  const map = presetMap(drama.style);
  let used = map[slot];
  let via = slot;
  if (!used && SLOT_FALLBACK[slot]) { used = map[SLOT_FALLBACK[slot]]; via = SLOT_FALLBACK[slot]; }
  const clean = String(base || '').trim();
  const extra = used ? used.content.join('\n') : '';
  const region = regionOfStyle(drama.style);
  const negs = used ? used.negative.slice() : [];
  if (region) negs.push(region.negative);
  const negative = negs.length ? [...new Set(negs)].join('，') : '';
  return {
    prompt: extra ? (clean + (clean ? '\n' : '') + extra) : clean,
    base: clean, appended: extra, negative,
    style: drama.style || '', slot: slot, via: extra ? via : '',
    missing: !extra, note: used && used.notes.length ? used.notes.join('；') : ''
  };
}

function composeForEntity(drama, entity) {
  return composePrompt(drama, entity.prompt || entity.profile, KIND_SLOT[entity.kind] || '场景图片');
}
/* 锚点段是派生的:入库只存正文,展示/下发时按「这一镜当前的人物 + 关联图片」重新拼。
   以前锚点是存下来的文本 —— 挂了人、挂图之后提示词不跟着变,还会和场景卡对不上。 */
function stripAnchors(prompt) {
  const s0 = String(prompt || '');
  const i = s0.search(/\n## (人物参考|场景锚点)：/);
  return (i >= 0 ? s0.slice(0, i) : s0).trimEnd();
}
function withRefAnchors(prompt, scene, cast, refNames) {
  let body = stripAnchors(prompt);
  /* 「建立场景：【X】」也跟着场景卡走:改了场景锚点,别让正文还写着旧地点 */
  if (scene) body = body.replace(/^建立场景：【[^】]*】。/, '建立场景：【' + scene + '】。');
  return body + anchorLines(scene, cast, refNames);
}

/* 单独的锚点文本(前端只在「关联标记」里显示这一份,输入框只放正文) */
function shotAnchors(shot, refs) {
  const cast = castOf(shot);
  const refNames = { cast: {}, extra: [] };
  for (const r of (refs || [])) {
    if (r.source === 'scene') refNames.scene = (r.asset && r.asset.name) || r.label;
    else if (r.source === 'character') refNames.cast[r.label] = (r.asset && r.asset.name) || r.label;
    else refNames.extra.push((r.asset && r.asset.name) || r.label);
  }
  return anchorLines(shot.scene_ref, cast, refNames).trim();
}

/* 给接口层用:按 effective_refs 把参考图文件名写进锚点 */
function shotVideoPrompt(shot, refs) {
  const cast = castOf(shot);
  const refNames = { cast: {}, extra: [] };
  for (const r of (refs || [])) {
    if (r.source === 'scene') refNames.scene = (r.asset && r.asset.name) || r.label;
    else if (r.source === 'character') refNames.cast[r.label] = (r.asset && r.asset.name) || r.label;
    else refNames.extra.push((r.asset && r.asset.name) || r.label);
  }
  return withRefAnchors(shot.video_prompt, shot.scene_ref, cast, refNames);
}

function composeForShot(drama, shot, kind, refNames) {
  const scene = shot.scene_ref;
  const cast = castOf(shot);
  if (kind === 'video') return composePrompt(drama, withRefAnchors(shot.video_prompt, scene, cast, refNames), '视频');
  /* 图片提示词派生:场景卡底稿 + 本镜画面;人工固定过的(image_locked)直接用存储值 */
  let base = withRefAnchors(shot.image_prompt, scene, cast, refNames);
  if (!Number(shot.image_locked)) {
    const sceneCard = scene
      ? db.prepare("SELECT prompt, profile FROM drama_entities WHERE drama_id=? AND kind='scene' AND name=?").get(drama.id, scene)
      : null;
    const visual = visualFromVideo(shot.video_prompt, shot.script_text);
    base = composeShotText(Object.assign({}, shot, { visual }), { sceneCard, refNames }).image;
  }
  return composePrompt(drama, base, '分镜图片');
}

/* ---------- 七、表格导入(参考数据的列名兼容) ---------- */
function normHeader(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
function colIndexBy(row, names) {
  for (let i = 0; i < row.length; i++) if (names.some(n => normHeader(row[i]) === n || normHeader(row[i]).includes(n))) return i;
  return -1;
}

/* 分析-人物场景.xlsx: 类型/名称/生图提示词 */
function mapEntitySheet(rows) {
  if (!rows || rows.length < 2) throw new Error('表里没有数据行');
  const head = rows[0];
  const cType = colIndexBy(head, ['类型', 'kind', '类别']);
  const cName = colIndexBy(head, ['名称', 'name', '角色', '卡名']);
  const cPrompt = colIndexBy(head, ['生图提示词', '图片提示词', '提示词', 'prompt']);
  const cProfile = colIndexBy(head, ['设定', '描述', '小传', 'profile']);
  if (cName < 0 && cPrompt < 0) throw new Error('找不到「名称」或「提示词」列,表头是：' + head.join(' / '));
  const out = [];
  for (const r of rows.slice(1)) {
    const name = String(r[cName] || '').trim();
    if (!name) continue;
    const typeRaw = String(r[cType] || '').trim();
    const kind = /场景/.test(typeRaw) ? 'scene' : /道具/.test(typeRaw) ? 'prop' : /人物|角色/.test(typeRaw) ? 'character' : (/（.+·.+）/.test(name) ? 'character' : 'scene');
    out.push({ kind, name, prompt: String(r[cPrompt] || '').trim(), profile: String(r[cProfile] || '').trim() });
  }
  if (!out.length) throw new Error('表里没有可导入的卡');
  return out;
}

/* 分析-分镜.xlsx: 镜号/集数/剧本原文/视频提示词/图片提示词/秒数/元素 */
function mapShotSheet(rows) {
  if (!rows || rows.length < 2) throw new Error('表里没有数据行');
  const head = rows[0];
  const cNo = colIndexBy(head, ['镜号', 'no', '序号']);
  const cEp = colIndexBy(head, ['集数', '集', 'episode']);
  const cScript = colIndexBy(head, ['剧本原文', '原文', 'script']);
  const cVideo = colIndexBy(head, ['视频提示词', '视频', 'video']);
  const cImage = colIndexBy(head, ['图片提示词', '图片', 'image']);
  const cDur = colIndexBy(head, ['秒数', '时长', 'duration']);
  const cElem = colIndexBy(head, ['元素', '角色', 'entities']);
  if (cVideo < 0 && cImage < 0) throw new Error('找不到「视频提示词」或「图片提示词」列,表头是：' + head.join(' / '));
  const out = [];
  for (const r of rows.slice(1)) {
    const video = String(r[cVideo] || '').trim();
    const image = String(r[cImage] || '').trim();
    if (!video && !image) continue;
    const scene = /## 场景锚点：([^\n]+)/.exec(video || image);
    const cast = /## 人物参考：([^\n]+)/.exec(video);
    const endState = /本分镜末状态：\[([^\]]*)\]/.exec(video);
    let dur = Math.round(Number(r[cDur]));
    if (!Number.isFinite(dur)) dur = 10;
    const elements = String(r[cElem] || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);
    out.push({
      episode_no: Number(r[cEp]) || 1,
      shot_no: Number(r[cNo]) || out.length + 1,
      script_text: String(r[cScript] || '').trim(),
      video_prompt: video, image_prompt: image,
      duration: Math.max(3, Math.min(25, dur)),
      scene_ref: scene ? scene[1].trim() : (elements[elements.length - 1] || ''),
      char_refs: cast ? cast[1].split(/[,，]/).map(x => x.trim()).filter(Boolean) : elements.filter(x => /（.+·.+）/.test(x)),
      end_state: endState ? endState[1].trim() : ''
    });
  }
  if (!out.length) throw new Error('表里没有可导入的分镜行');
  return out;
}

/* 各种全局提示词.docx:画风 × 槽位;原文每块粘了两遍,折叠掉才不是一个 2 倍的怪物 */
const STYLE_HEAD = /^(真人画风|3D画风|2D画风|国风|写实风)/;
const SLOT_HEAD = /^(人物图片|场景图片|道具图片|分镜图片|人物|场景|道具|视频)(（[^）]*）)?[:：]?\s*$/;
const SLOT_ALIAS = { 人物: '人物图片', 场景: '场景图片', 道具: '道具图片' };
function collapseDupBlocks(a) {
  for (;;) {
    let changed = false;
    for (let i = 0; i < a.length && !changed; i++) {
      for (let L = 1; i + 2 * L <= a.length; L++) {
        if (a.slice(i, i + L).join('\n') === a.slice(i + L, i + 2 * L).join('\n')) {
          a.splice(i + L, L); changed = true; break;
        }
      }
    }
    if (!changed) return a;
  }
}
function parseStyleMatrix(lines) {
  const rows = [];
  let style = null, negatives = {};
  for (const raw of lines.map(x => String(x).trim()).filter(Boolean)) {
    if (/^各种全局提示词$/.test(raw)) continue;
    if (STYLE_HEAD.test(raw)) { style = raw.replace(/\s+/g, ''); continue; }
    if (!style) continue;
    if (/^负面词[:：]/.test(raw)) { const t = raw.replace(/^负面词[:：]\s*/, ''); (negatives[style] = negatives[style] || []).push(t); continue; }
    const hd = SLOT_HEAD.exec(raw);
    if (hd) {
      const s = SLOT_ALIAS[hd[1]] || hd[1];
      const note = /（([^）]*)）/.exec(raw);
      if (rows.length && rows[rows.length - 1].style === style && rows[rows.length - 1].slot === s) continue;
      rows.push({ style, slot: s, content: [], note: note ? note[1] : '' });
      continue;
    }
    let cur = rows[rows.length - 1];
    /* 没有槽位小标题的正文(如「3D画风-古代」整段就是视频提示词)归到视频 */
    if (!cur || cur.style !== style) { cur = { style, slot: '视频', content: [], note: '' }; rows.push(cur); }
    cur.content.push(raw);
  }
  return rows.map(r => ({
    style: r.style, slot: r.slot, note: r.note,
    negative: (negatives[r.style] || []).join(''),
    content: collapseDupBlocks(r.content).join('\n')
  })).filter(r => r.content || r.negative);
}

/* 从 data/workflow 一键导入:目录可被 WORKFLOW_DIR 覆盖(data/ 不进版本库) */
function workflowDir() {
  const path = require('node:path');
  const { DATA_DIR } = require('./db');
  return process.env.WORKFLOW_DIR ? path.resolve(process.env.WORKFLOW_DIR) : path.join(DATA_DIR, 'workflow');
}

module.exports = {
  SLOTS, KIND_SLOT, KIND_CN, SLOT_FALLBACK,
  splitEpisodes, chunkByParagraphs, toEpisodeNo, EP_MARK,
  parseAnalysisJson, nameCard, knownCards, findCard, upsertEntity, composeShotText, persistShots,
  visualFromVideo, sceneBaseOf, anchorLines, regionOfStyle, REGIONS,
  stripAnchors, withRefAnchors, shotVideoPrompt, shotAnchors,
  analyzeUnit, startAnalysis, stopAnalysis, currentJob, pickTextModel, refreshStats, setProgress, dramaRow,
  presetMap, composePrompt, composeForEntity, composeForShot,
  mapEntitySheet, mapShotSheet, parseStyleMatrix, collapseDupBlocks, workflowDir,
  runner
};
