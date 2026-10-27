'use strict';
/* 第四十四轮验证(需求二十九 · 浅色模式全站适配 + 资产库「更多」面板被覆盖)
 *
 * A. CSS 静态契约:浅色模式不再靠「逐条覆盖组件底色」实现(--film 令牌),
 *    并且不留「属性+类 权重压过组件状态规则」的选择器 —— 那正是主按钮/选中态在浅色下变白的原因。
 * B. 运行时量测(无头 Chrome · 深浅两套主题 × 全站页面):
 *    文字对比度、控件与所在表面同色、被别的内容盖住的控件、文字裁切、文档横向溢出。
 * C. 三个「更多」下拉 + 右键菜单:每一项的中心点都必须命中菜单自身(29·2 的回归点)。
 * D. 页头入场动画结束后不得残留 transform(非 none 的 transform = 层叠上下文 = 面板被压在内容下)。
 * 只读验证:不建项目、不发任务、不消耗积分。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIVE = 'http://127.0.0.1:' + (process.env.PORT || 3088);
const CDP_PORT = Number(process.env.CDP_PORT || 9551);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-r44-'));
const SHOT_DIR = path.join(ROOT, 'test', 'shots-v44');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let PASS = 0, FAIL = 0;
const ok = (label, cond, extra) => {
  if (cond) { PASS++; console.log('  OK ' + label); }
  else { FAIL++; console.log('  XX ' + label + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 300) + ']' : '')); }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const css = fs.readFileSync(path.join(ROOT, 'public/css/app.css'), 'utf8');
const cssLines = css.split('\n');
const lightStart = cssLines.findIndex(l => l.includes('29. 浅色模式'));
const lightCss = cssLines.slice(lightStart).join('\n');
const baseCss = cssLines.slice(0, lightStart).join('\n');
/* 取某条规则的声明块(按选择器全文匹配) */
const ruleBody = sel => {
  const i = baseCss.indexOf('\n' + sel + ' {');
  if (i < 0) return '';
  return baseCss.slice(i, baseCss.indexOf('}', i) + 1);
};

/* ---------------- A. CSS 静态契约 ---------------- */
function partA() {
  console.log('== A. CSS 静态契约 ==');
  ok(':root 定义 --film(薄雾底色)', /--film:\s*255, *255, *255/.test(baseCss));
  ok('浅色段把 --film 翻成墨色(不能还是白雾)', /--film:\s*(?!255, *255, *255)\d+, *\d+, *\d+/.test(lightCss), (lightCss.match(/--film:[^;]+/g)||[]));
  ok('组件底色不再硬写 rgba(255,255,255,.0x) 白雾(浅色下等于不存在)',
    !(baseCss.match(/background:\s*rgba\(255, *255, *255, *\.[01]\d*\)/g) || []).length,
    (baseCss.match(/background:\s*rgba\(255, *255, *255, *\.[01]\d*\)/g) || []).slice(0, 4));
  ok('rgba(var(--film), a) 已被实际使用', (css.match(/rgba\(var\(--film\)/g) || []).length >= 30,
    (css.match(/rgba\(var\(--film\)/g) || []).length);
  /* 权重陷阱:html[data-scheme=light] + 类 = (0,2,1),会盖过 .btn-primary / .cat-chip.on 这类状态规则 */
  const landmines = [...lightCss.matchAll(/html\[data-scheme="light"\]\s+\.([\w-]+)\s*\{/g)].map(m => m[1]);
  for (const cls of ['btn', 'cat-chip', 'icon-btn', 'wb-tbtn', 'ws-tbtn', 'em-size-tag', 'input', 'select', 'textarea']) {
    ok('浅色段不再整条覆盖 .' + cls + '(把它的填充/选中态留给组件自己)', !landmines.includes(cls), landmines);
  }
  /* 48·需求三十一续:压在图片上的浮层改由 --scrim-ink/--scrim-line/--scrim-accent 四个令牌统一翻色,
     浅色段不再逐条列选择器补白字 —— 那种写法漏一个就是一个读不出来的角标。 */
  ok('浮层字色/描边已收进 --scrim-* 令牌(浅色段不再逐条覆盖)',
    !/\.media-type-badge|\.asset-check|\.ws-ref-tag/.test(lightCss.replace(/\/\*[\s\S]*?\*\//g, ''))
    && /--scrim-ink:\s*#ffffff/.test(lightCss) && /--scrim-line:/.test(lightCss) && /--scrim-accent:/.test(lightCss),
    (lightCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/html\[data-scheme="light"\][^{]*\{/) || []).slice(0, 8));
  const scrimRules = [...baseCss.matchAll(/([^{}]+)\{([^{}]*rgba\(var\(--scrim-rgb\)[^{}]*)\}/g)];
  ok('每个深底浮层组件的字色都走 --scrim-ink(不允许 var(--ink) 压深底)',
    scrimRules.length >= 10 && scrimRules.every(m => !/color:\s*var\(--ink\)/.test(m[2])),
    scrimRules.filter(m => /color:\s*var\(--ink\)/.test(m[2])).map(m => m[1].replace(/\s+/g, ' ').trim().slice(0, 40)));
  ok('勾选态在两套主题都回到强调色(基础规则自带,浅色无需补丁)',
    /\.asset-check\.on \{[^}]*background: var\(--gold\)[^}]*color: var\(--gold-ink\)/.test(baseCss.replace(/\n\s*/g, ' '))
    && /\.wb-check\.on \{[^}]*background: var\(--gold\)/.test(baseCss.replace(/\n\s*/g, ' ')));
  ok('浅色段不再给语义状态芯片单独补字色(权重会压过角标的实底规则)',
    !/html\[data-scheme="light"\][^{]*\.status-[a-z]+\s*\{[^}]*color:/.test(lightCss),
    (lightCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]*\.status-[a-z]+[^{}]*\{[^{}]*\}/g) || []));
  ok('没有 html[data-scheme=light] 自嵌套的失效选择器', !/html\[data-scheme="light"\]\s+html\[data-scheme="light"\]/.test(css));
  ok('语义色块上的字色走令牌(--ok-ink/--warn-ink)',
    /--ok-ink:\s*#04120b/.test(baseCss) && /--ok-ink:\s*#ffffff/.test(lightCss) && /\.tm-active-tag[^}]*color: var\(--ok-ink\)/.test(baseCss));
  const goldTextRules = ['.avatar', '.ws-ref-count', '.ig-res-title b', '.ws-param > label b', '.pl-chip', '.ws-add-shot'];
  for (const s of goldTextRules) ok('小号强调色文字走 --gold-text:' + s, /color: var\(--gold-text\)/.test(ruleBody(s)), ruleBody(s).replace(/\n\s*/g, ' ').slice(0, 120));
  /* 29·需求三十:浅色整族换成黛蓝 · 素白 —— 品牌色必须是冷色(b 通道最高),且不能再出现暖金令牌值 */
  const lg = (lightCss.match(/--gold(?:-fill|-text|-deep|-soft)?:\s*#[0-9a-f]{6}/g) || []).map(x => x.match(/#([0-9a-f]{6})/i)[1]);
  ok('浅色品牌色全部是冷色(蓝族)', lg.length >= 5 && lg.every(h => parseInt(h.slice(4, 6), 16) > parseInt(h.slice(0, 2), 16)), lg);
  ok('浅色强调底上的字色是白字', /--gold-ink:\s*#ffffff/.test(lightCss));
  ok('浅色段不再出现旧鎏金字面值', !/#(a8823c|8a6a2c|b8a884|c9b892|a99b79|c1a878|201a0c|a38e6a|b8945a|f7f0dd|6e5726)/i.test(lightCss),
    (lightCss.match(/#(a8823c|8a6a2c|b8a884|c9b892|a99b79|c1a878|201a0c|a38e6a|b8945a|f7f0dd|6e5726)/gi) || []));
  const accentUses = (baseCss.match(/rgba\(var\(--accent/g) || []).length;
  ok('品牌色雾/描边/聚焦环走 --accent*-rgb', accentUses >= 18, accentUses);
  ok('深色品牌令牌仍是鎏金(两套主题互不影响)', /--gold:\s*#e3b45e/.test(baseCss) && /--accent-rgb:\s*227, 180, 94/.test(baseCss));
  /* 需求三十再迭代「青白 · 疏朗」:浅色靠空间与层级立住,不是靠换色 */
  const tok = (src, name) => { const m = src.match(new RegExp('--' + name + ':\\s*([^;]+);')); return m && m[1].trim(); };
  const lumOf = hex => { const v = hex.replace('#', ''); const p = i => { const c = parseInt(v.slice(i, i + 2), 16) / 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
    return .2126 * p(0) + .7152 * p(2) + .0722 * p(4); };
  const lbg = tok(lightCss, 'bg'), lcard = tok(lightCss, 'surface');
  ok('浅色画布与卡片差出一档(有层次才不是一张白纸)', lbg && lcard && Math.abs(lumOf(lbg) - lumOf(lcard)) >= .02, [lbg, lcard]);
  ok('浅色卡片靠影子浮起', tok(lightCss, 'card-shadow') && tok(lightCss, 'card-shadow') !== 'none', tok(lightCss, 'card-shadow'));
  ok('深色卡片不受影响(--card-shadow 仍为 none)', tok(baseCss, 'card-shadow') === 'none');
  const px = v => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
  const resolve = (src, val) => { const v = /^var\((--[\w-]+)\)$/.exec(val || ''); return v ? (tok(src, v[1].slice(2)) || val) : val; };
  for (const t of ['gap', 'pad-card', 'row-py', 'pad-page', 'fs-page-title']) {
    const d = px(resolve(baseCss, tok(baseCss, t))), l = px(tok(lightCss, t));
    ok('浅色空间放宽:' + t + ' (' + d + '→' + l + 'px)', l > d, [tok(baseCss, t), tok(lightCss, t)]);
  }
  ok('浅色圆角更柔', tok(lightCss, 'r-md') !== tok(baseCss, 'r-md'), [tok(baseCss, 'r-md'), tok(lightCss, 'r-md')]);
  ok('选中态与主行动分离(浅色淡蓝底,深色仍鎏金实底)',
    tok(baseCss, 'sel-fill') === 'var(--gold-fill)' && /^#[0-9a-f]{6}$/i.test(tok(lightCss, 'sel-fill'))
    && lumOf(tok(lightCss, 'sel-fill')) > .8, [tok(baseCss, 'sel-fill'), tok(lightCss, 'sel-fill')]);
  ok('选中态文字在其淡底上达 AA(≥4.5)',
    (lumOf(tok(lightCss, 'sel-fill')) + .05) / (lumOf(tok(lightCss, 'sel-ink')) + .05) >= 4.5,
    [+((lumOf(tok(lightCss, 'sel-fill')) + .05) / (lumOf(tok(lightCss, 'sel-ink')) + .05)).toFixed(2)]);
  ok('选中态规则真的走 --sel-*', /\.cat-chip\.on \{ background: var\(--sel-fill\)/.test(baseCss)
    && /\.pg-btn\.on \{ background: var\(--sel-fill\)/.test(baseCss) && /\.ctx-tab\.active \{ background: var\(--sel-fill\)/.test(baseCss));
  const alphaOf = v => { const m = /([\d.]+)\s*\)\s*$/.exec(v || ''); return m ? parseFloat(m[1]) : 1; };
  ok('浅色描边比深色更淡(靠留白不靠线)', alphaOf(tok(lightCss, 'line')) < alphaOf(resolve(baseCss, tok(baseCss, 'line'))), [tok(baseCss, 'line'), tok(lightCss, 'line')]);
  ok('.page-head 抬到内容栏之上', /\.page-head\s*\{[^}]*z-index: 30/.test(baseCss.replace(/\n\s*/g, ' ')) ||
    /z-index: 30/.test(ruleBody('.page-head')), ruleBody('.page-head').replace(/\n\s*/g, ' ').slice(0, 160));
  ok('入场动画不用 fill-mode:both(会残留 transform)',
    !/\.content > \*:first-child\s*\{[^}]*animation:[^;}]* both/.test(baseCss.replace(/\n/g, ' ')));

  /* ---------------- 需求三十一续(48 轮):语义色与状态徽标不得写死某套主题的色板 ---------------- */
  const SEM = { ok: '65, 207, 144', warn: '251, 191, 36', danger: '240, 84, 76', info: '122, 167, 217' };
  for (const [n, lit] of Object.entries(SEM)) {
    ok('语义色底纹不再写死深色的 rgba(' + lit + ')',
      !(css.match(new RegExp('rgba\\(' + lit.replace(/, /g, ', *') + ',', 'g')) || []).length);
    ok('--' + n + '-rgb 三元组已被组件实际使用',
      (css.match(new RegExp('rgba\\(var\\(--' + n + '-rgb\\)', 'g')) || []).length >= 2,
      (css.match(new RegExp('rgba\\(var\\(--' + n + '-rgb\\)', 'g')) || []).length);
  }
  ok('浅色段给全套语义三元组(底纹跟着主题翻)',
    ['ok', 'warn', 'danger', 'info'].every(n => new RegExp('--' + n + '-rgb:').test(lightCss)),
    (lightCss.match(/--(ok|warn|danger|info)-rgb:[^;]+/g) || []));
  ok('没有暖黑字面值 rgba(8,6,4)/rgba(22,16,8)', !/rgba\(8, *6, *4|rgba\(22, *16, *8/.test(css),
    (css.match(/rgba\(8, *6, *4[^)]*\)|rgba\(22, *16, *8[^)]*\)/g) || []));
  /* 「进行中」不是警告:浅色下它是主色蓝,深色下才沿用琥珀 */
  ok('--proc 族在两套主题各自定义', /--proc:\s*var\(--warn\)/.test(baseCss) && /--proc:\s*var\(--gold-fill\)/.test(lightCss)
    && /--proc-text:\s*var\(--gold-text\)/.test(lightCss), [tok(baseCss, 'proc'), tok(lightCss, 'proc')]);
  ok('.status-processing 走 --proc 而不是 --warn',
    /\.status-processing \{ background: var\(--proc-soft\); color: var\(--proc-text\); \}/.test(baseCss)
    && /\.ig-card-flag \.status-processing \{ background: var\(--proc\); color: var\(--proc-ink\)/.test(baseCss),
    ruleBody('.status-processing').replace(/\n\s*/g, ' '));
  ok('待处理计数药丸也走 --proc', /\.cc-pending[^}]*background: var\(--proc\)/.test(baseCss.replace(/\n\s*/g, ' ')));
  ok('真正的警告仍用 --warn(前置条件提示 / 积分减少)',
    /color: var\(--warn\)/.test(ruleBody('.ws-need-src')) && /\.cc-delta\.minus \{ color: var\(--warn\); \}/.test(baseCss));
  /* 还没出图的卡片,角标底下是占位灰块而不是照片 —— 浅色下必须是浅底药丸 */
  ok('占位块角标走 --flag-idle 三件套',
    /\.ig-card-flag \.status-queued, \.ig-card-flag \.status-cancelled \{[^}]*background: var\(--flag-idle\)[^}]*color: var\(--flag-idle-ink\)/
    .test(baseCss.replace(/\n\s*/g, ' ')) && /^--flag-idle: #ffffff/.test('' + (lightCss.match(/--flag-idle: [^;]+/) || '')),
    [tok(baseCss, 'flag-idle'), tok(lightCss, 'flag-idle')]);
  ok('.ig-card-foot 的 margin-top 拼写正确(历史上写成 margintop 就一直是空转)',
    /\.ig-card-foot \{[^}]*margin-top: auto/.test(baseCss.replace(/\n\s*/g, ' ')) && !/margintop/.test(css));

  /* ---------------- 需求三十一:元素族与阶梯统一 ---------------- */
  const left = re => (baseCss.match(re) || []);
  ok('圆角不再出现 6px / 7px 字面值(收进 --r-xs / --r-sm)', !left(/border-radius:\s*[67]px/g).length, left(/border-radius:\s*[67]px/g).slice(0, 3));
  ok('微间距不再出现 5/6/7px 字面值(收进 --gap-xs)', !left(/gap:\s*[567]px/g).length, left(/gap:\s*[567]px/g).slice(0, 4));
  ok('图片浮层底色统一走 --scrim-rgb(不再三套暖黑配方)', !left(/rgba\(7, *6, *4|rgba\(10, *8, *5/g).length, left(/rgba\(7, *6, *4|rgba\(10, *8, *5/g).slice(0, 3));
  ok('聚焦环只有一个配方 --ring', left(/box-shadow: var\(--ring\)/g).length >= 6 && !left(/box-shadow: 0 0 0 3px rgba\(/g).length,
    [left(/box-shadow: var\(--ring\)/g).length, left(/box-shadow: 0 0 0 3px rgba\(/g)]);
  const flat = baseCss.replace(/\n\s*/g, ' ');
  const weakMissing = ['.top-link.active', '.folder-item.active', '.wb-tbtn.active', '.em-size-tag.on', '.icon-btn.on', '.cmdk-item.sel']
    .filter(s => !new RegExp('[^{}]*' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{[^}]*--sel-soft').test(flat));
  ok('弱选中态六处统一走 --sel-soft(浅色收敛成同一种淡蓝)', weakMissing.length === 0, weakMissing);
  const strongMissing = ['.cat-chip.on', '.pg-btn.on', '.wpk-chip.on', '.ctx-tab.active']
    .filter(s => !new RegExp('[^{}]*' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{[^}]*--sel-fill').test(flat));
  ok('强选中态四处统一走 --sel-fill', strongMissing.length === 0, strongMissing);
  ok('卡片选中环统一 --sel-ring(5 处硬编 box-shadow 已收)',
    left(/box-shadow: var\(--sel-ring\)/g).length >= 5 && !left(/box-shadow: 0 0 0 1px var\(--gold\)/g).length,
    [left(/box-shadow: var\(--sel-ring\)/g).length, left(/box-shadow: 0 0 0 1px var\(--gold\)/g).length]);
  ok('`.on` 不再同时表示「选中」和「危险」(死规则 .wb-tbtn.on 已删)', !/\.wb-tbtn\.on\b/.test(baseCss));
  ok('徽标族字重统一(.tag / .tag-cat 不再漏 font-weight)',
    /font-weight: 700/.test(ruleBody('.tag')) && /font-weight: 700/.test(ruleBody('.tag-cat')), [ruleBody('.tag').replace(/\n\s*/g, ' ').slice(0, 90)]);
  ok('重复选择器已清理(.ig-form .field / .ig-foot-row .ig-go 各只剩一处)',
    left(/^\.ig-form \.field \{/gm).length === 1 && left(/^\.ig-foot-row \.ig-go \{/gm).length === 1
    && !left(/^\.table \.muted \{/gm).length, [left(/^\.ig-form \.field \{/gm).length, left(/^\.ig-foot-row \.ig-go \{/gm).length]);
  ok('--pl-name-fs 已声明(此前被消费却从未定义,浅色无法调)', /--pl-name-fs:/.test(baseCss) && /var\(--pl-name-fs[,)]/.test(baseCss));
  ok('阶梯令牌齐备', ['--r-xs', '--h-2xs', '--h-xs', '--sq-sm', '--sq-md', '--gap-xs', '--scrim-rgb', '--sel-soft', '--sel-ring', '--ring']
    .every(t => baseCss.includes(t + ':')));
}

/* ---------------- 页面量测函数 ---------------- */
const AUDIT = `(function(){
  var parse=function(c){var m=(c||'').match(/[\\d.]+/g);if(!m)return null;return {r:+m[0],g:+m[1],b:+m[2],a:m.length>3?+m[3]:1};};
  var lin=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  var lum=function(c){return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);};
  var ratio=function(a,b){var l1=lum(a),l2=lum(b);if(l1<l2){var t=l1;l1=l2;l2=t;}return (l1+0.05)/(l2+0.05);};
  var mix=function(fg,bg){var a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a),a:1};};
  var d3=function(x,y){return Math.max(Math.abs(x.r-y.r),Math.abs(x.g-y.g),Math.abs(x.b-y.b));};
  var sel=function(n){var s=n.tagName.toLowerCase();if(n.id)return s+'#'+n.id;
    if(n.className&&typeof n.className==='string'){var c=n.className.trim().split(/\\s+/).filter(function(x){return x.length<24;}).slice(0,2).join('.');if(c)s+='.'+c;}
    return s;};
  var chain=function(n){var out=[],c=n;for(var i=0;i<4&&c;i++){out.push(sel(c));c=c.parentElement;}return out.join(' < ');};
  var bgOf=function(n){var c=n;
    while(c&&c.nodeType===1){var cs=getComputedStyle(c);var b=parse(cs.backgroundColor);
      if(b&&b.a>=0.85)return b;
      if(b&&b.a>0.05){var up=bgOf(c.parentElement||document.documentElement);return mix(b,up);}
      c=c.parentElement;}
    return parse(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1};};
  var visible=function(n){if(!n.getClientRects().length)return false;var cs=getComputedStyle(n);
    if(cs.visibility==='hidden'||+cs.opacity<0.05)return false;var r=n.getBoundingClientRect();
    if(r.width<3||r.height<3)return false;
    if(n.closest&&n.tagName.toLowerCase()!=='summary'&&n.closest('details:not([open])'))return false;
    if(r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth)return false;return true;};
  var rgb=function(c){return 'rgb('+[(c.r|0),(c.g|0),(c.b|0)].join(',')+')';};
  var out={darkBg:[],lowText:[],flat:[],clipped:[],noHit:[],warm:[]};
  /* 浅色主题「不许残留鎏金」:按旧金色清单逐个比对(比按色相判断准,琥珀是语义色不能误伤) */
  var GOLD={'rgb(168,130,60)':1,'rgb(138,106,44)':1,'rgb(184,168,132)':1,'rgb(201,184,146)':1,'rgb(169,155,121)':1,
    'rgb(193,168,120)':1,'rgb(163,142,106)':1,'rgb(184,148,90)':1,'rgb(32,26,12)':1,'rgb(25,19,7)':1,'rgb(227,180,94)':1,
    'rgb(240,212,154)':1,'rgb(245,208,126)':1,'rgb(184,165,120)':1,'rgb(222,163,69)':1,'rgb(239,202,133)':1,'rgb(192,138,48)':1,
    'rgb(244,217,162)':1,'rgb(110,87,38)':1,'rgb(247,240,221)':1,'rgb(122,100,54)':1,'rgb(150,120,60)':1};
  /* 「本来就是深色」的品牌 / 语义填充(积分与通知徽章、状态点…)不算未适配:按令牌值白名单排除;
     当前主题自己的品牌色也不能算「残留」(深色下 --gold 本来就在金色清单里)。 */
  var allow={};
  ['danger','ok','warn','info','gold','gold-fill','gold-deep','gold-soft','gold-ink','ink','bg-deep','surface-3'].forEach(function(t){
    var p=document.createElement('span');p.style.display='none';p.style.color='var(--'+t+')';document.body.appendChild(p);
    var c=parse(getComputedStyle(p).color);if(c){allow[rgb(c)]=1;GOLD[rgb(c)]=0;}p.remove();});
  var SKIP=/^(svg|path|rect|circle|line|polyline|polygon|g|defs|use|clippath|mask|ellipse)$/;
  var light=document.documentElement.dataset.scheme==='light';
  var all=document.querySelectorAll('#app *, #authRoot *, .modal, .toast, .ctx-menu, .menu-pop, .cmdk');
  for(var i=0;i<all.length;i++){var n=all[i];
    if(SKIP.test(n.tagName.toLowerCase()))continue;
    if(!visible(n))continue;
    var cs=getComputedStyle(n);
    var own=0;for(var k=0;k<n.childNodes.length;k++){var t=n.childNodes[k];if(t.nodeType===3&&t.textContent.trim())own+=t.textContent.trim().length;}
    var bg=bgOf(n);
    /* 「深色残留」指的是整块表面没翻过来:小尺寸的状态点/色板样本不算(它们本来就该是实色) */
    var rr=n.getBoundingClientRect();
    if(light&&lum(bg)<0.16&&rr.width>=20&&rr.height>=20&&rgb(bg)===rgb(parse(cs.backgroundColor)||bg)&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'
      &&!allow[rgb(bg)]
      &&!n.closest('.tm-swatches')&&!n.closest('.viewer-mask')&&!n.closest('.media-thumb')&&!n.closest('.ig-img-cell')
      &&!n.closest('.ws-rec-cover')&&!n.closest('.ws-ref-item'))
      out.darkBg.push({where:chain(n),bg:rgb(bg),txt:(n.textContent||'').trim().slice(0,16)});
    if(own){var col=parse(cs.color);
      if(col&&col.a>0.05){var eff=col.a<1?mix(col,bg):col;var cr=ratio(eff,bg);
        var need=(parseFloat(cs.fontSize)>=18&&parseInt(cs.fontWeight)>=700)?3:4.5;
        if(cr<need)out.lowText.push({where:chain(n),cr:+cr.toFixed(2),fg:cs.color,bg:rgb(bg),fs:cs.fontSize,txt:(n.textContent||'').trim().slice(0,16)});}}
    if(isCtl(n)&&own&&!/ghost|btn-link|menu-item|ctx-item|notif|close|dismiss|tab$/i.test(n.className||'')){
      var ob=parse(cs.backgroundColor);
      if(ob&&n.parentElement){var pbg=bgOf(n.parentElement),obm=ob.a<1?mix(ob,pbg):ob;
        var bw=Math.max(parseFloat(cs.borderTopWidth)||0,parseFloat(cs.borderBottomWidth)||0,parseFloat(cs.borderLeftWidth)||0,parseFloat(cs.borderRightWidth)||0);
        var bc=parse(cs.borderTopColor);
        if(d3(obm,pbg)<14&&!(bw>0&&bc&&bc.a>0.02&&d3(bc,pbg)>14)&&(!cs.boxShadow||cs.boxShadow==='none'))
          out.flat.push({where:chain(n),bg:rgb(obm),parent:rgb(pbg),txt:(n.textContent||'').trim().slice(0,16)});}}
    if(own&&n.scrollWidth>n.clientWidth+2&&cs.textOverflow!=='ellipsis'&&!n.getAttribute('title'))
      out.clipped.push({where:chain(n),sw:n.scrollWidth,cw:n.clientWidth,txt:(n.textContent||'').trim().slice(0,16)});
    if(light&&!n.closest('.tm-swatches')){
      var probe=[['color',cs.color],['background',cs.backgroundColor],['border',cs.borderTopColor],['outline',cs.outlineColor]];
      for(var q=0;q<probe.length;q++){var pc=parse(probe[q][1]);
        if(pc&&pc.a>0.55&&GOLD[rgb(pc)])out.warm.push({where:chain(n),via:probe[q][0],v:probe[q][1],txt:(n.textContent||'').trim().slice(0,14)});}}
  }
  function isCtl(n){try{return n.matches('button, a.btn, .cat-chip, .tab, .ctx-tab, .wb-tbtn, select, input, .pill, .chip');}catch(e){return false;}}
  var hits=document.querySelectorAll('#app button, #app a, #authRoot button, #authRoot a, #app .cat-chip, #app .ctx-tab');
  for(var j=0;j<hits.length;j++){var m=hits[j];if(!visible(m)||m.disabled)continue;
    var r2=m.getBoundingClientRect(),x=r2.left+Math.min(r2.width/2,r2.right-2),y=r2.top+r2.height/2;
    var top=document.elementFromPoint(x,y);
    if(top&&top!==m&&!m.contains(top)&&!top.contains(m)&&!top.closest('.modal-mask,.cmdk-mask,.viewer-mask'))
      out.noHit.push({where:chain(m),hit:chain(top),txt:(m.textContent||'').trim().slice(0,14)});}
  out.docOverflowX=document.documentElement.scrollWidth-document.documentElement.clientWidth;
  out.scheme=document.documentElement.dataset.scheme;out.route=location.hash;
  return out;})()`;

/* 「更多」下拉:每一项都要能点到 */
const MENU_CHECK = `(function(sel){var b=document.querySelector(sel);if(!b)return {missing:true};
  var r=b.getBoundingClientRect();b.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+5,clientY:r.top+5}));
  var p=b.parentElement.querySelector('.menu-pop');if(!p)return {noPop:true};
  var pr=p.getBoundingClientRect();
  var items=[].slice.call(p.querySelectorAll('.menu-item,.ctx-sep')).map(function(it){var ir=it.getBoundingClientRect();
    var top=document.elementFromPoint(ir.left+ir.width/2,ir.top+Math.min(ir.height/2,ir.height-2));
    return {label:(it.textContent||'').trim().slice(0,12),inside:!!(top&&top.closest('.menu-pop')===p),
      belowFold:Math.round(ir.bottom-pr.top),hit:top?(top.className||top.tagName)+'':'null'};});
  var clip=[];var c=p.parentElement;
  while(c&&c!==document.documentElement){var cs=getComputedStyle(c);
    if(/auto|hidden|scroll|clip/.test(cs.overflowX+cs.overflowY))clip.push((c.className||c.tagName)+':'+cs.overflowX+'/'+cs.overflowY);
    c=c.parentElement;}
  return {open:!p.classList.contains('hidden'),rect:[Math.round(pr.left),Math.round(pr.top),Math.round(pr.width),Math.round(pr.height)],
    items:items,clippers:clip};})`;

/* 控件填充是否可见:自身底色 vs 所在表面 */
const FILL_CHECK = `(function(sels){return sels.map(function(s){var n=document.querySelector(s[0]);if(!n)return {sel:s[0],missing:true};
  var cs=getComputedStyle(n),bg=n.parentElement?getComputedStyle(n.parentElement).backgroundColor:'transparent';
  var p=n.parentElement;while(p&&getComputedStyle(p).backgroundColor==='rgba(0, 0, 0, 0)')p=p.parentElement;
  return {sel:s[0],bg:cs.backgroundColor,border:cs.borderTopColor+' '+cs.borderTopWidth,parent:p?getComputedStyle(p).backgroundColor:'none',
    label:(s[1]||'')};});})`;

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
    '--user-data-dir=' + path.join(TMP, 'chrome'), '--remote-debugging-port=' + CDP_PORT,
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) { } });
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    await wait(300);
    try { target = (await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()).find(p => p.type === 'page'); } catch (e) { }
  }
  if (!target) throw new Error('无法连接无头 Chrome');
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
  await send('Page.enable'); await send('Runtime.enable');
  const login = await fetch(LIVE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@videoforge.cn', password: 'admin123' })
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (login.status !== 200) throw new Error('登录失败 ' + login.status);
  await send('Network.enable');
  await send('Network.setCookie', { name: cookie.split('=')[0], value: cookie.split('=')[1], domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' });

  await send('Page.navigate', { url: LIVE + '/' }); await wait(1600);
  const pj = await ev(`(async()=>{const r=await (await fetch('/api/projects')).json();const p=(r.items||[])[0];if(!p)return null;
    const d=await (await fetch('/api/projects/'+p.id)).json();const ep=(d.project.episodes||[])[0];return ep?{pid:p.id,eid:ep.id}:null})()`);
  if (!pj) throw new Error('库里没有可用的项目/分集');

  partA();

  const ROUTES = ['#/', '#/projects', '#/assets', '#/styles', '#/images', '#/admin', '#/admin/users',
    '#/admin/settings', '#/admin/themes', '#/admin/credits', '#/admin/tasks', '#/studio'];
  for (const scheme of ['light', 'dark']) {
    await ev(`localStorage.setItem('vf-scheme','${scheme}');1`);
    await send('Page.reload', { ignoreCache: true }); await wait(2600);
    console.log('\n== B. 运行时量测 · ' + (scheme === 'light' ? '浅色' : '深色') + ' ==');
    for (const r of ROUTES) {
      const hash = r === '#/studio' ? `#/projects/${pj.pid}/episode/${pj.eid}` : r;
      await ev(`location.hash='${hash}';1`); await wait(2000);
      const a = await ev(AUDIT);
      const tag = hash.replace(/[^a-z0-9]+/gi, '_').slice(0, 28);
      ok('[' + scheme + '] ' + hash + ' · 无深色残留', !a.darkBg.length, a.darkBg.slice(0, 3));
      if (scheme === 'light') ok('[light] ' + hash + ' · 无鎏金残留(浅色已换黛蓝)', !a.warm.length, a.warm.slice(0, 4));
      ok('[' + scheme + '] ' + hash + ' · 文字对比度达标', !a.lowText.length, a.lowText.slice(0, 3));
      ok('[' + scheme + '] ' + hash + ' · 控件与所在表面可分辨', !a.flat.length, a.flat.slice(0, 3));
      ok('[' + scheme + '] ' + hash + ' · 文字未被自身容器裁切', !a.clipped.length, a.clipped.slice(0, 3));
      ok('[' + scheme + '] ' + hash + ' · 可见控件都能点到', !a.noHit.length, a.noHit.slice(0, 3));
      ok('[' + scheme + '] ' + hash + ' · 无横向溢出', a.docOverflowX <= 1, a.docOverflowX);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOT_DIR, scheme + tag + '.png'), Buffer.from(shot.data, 'base64'));
    }
  }

  /* ---------------- C. 三个「更多」下拉 + 右键菜单 ---------------- */
  console.log('\n== C. 下拉面板遮挡回归(29·2) ==');
  for (const scheme of ['light', 'dark']) {
    await ev(`localStorage.setItem('vf-scheme','${scheme}');1`);
    await send('Page.reload', { ignoreCache: true }); await wait(2400);
    const cases = [];
    await ev(`location.hash='#/assets';1`); await wait(2000);
    cases.push(['资产库 · 更多', await ev(MENU_CHECK + `('#astMoreBtn')`)]);
    /* 关掉资产库菜单再开右键菜单 */
    const ctx = await ev(`(function(){var c=document.querySelector('.media-card');var r=c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+40}));
      var m=document.querySelector('.ctx-menu');if(!m)return {noMenu:true};
      var items=[].slice.call(m.querySelectorAll('.ctx-item')).map(function(it){var ir=it.getBoundingClientRect();
        var top=document.elementFromPoint(ir.left+ir.width/2,ir.top+ir.height/2);
        return {label:(it.textContent||'').trim().slice(0,8),inside:!!(top&&top.closest('.ctx-menu'))};});
      return {open:true,items:items};})()`);
    cases.push(['资产库 · 右击快捷菜单', ctx]);
    await ev(`location.hash='#/admin';1`); await wait(2400);
    cases.push(['后台 · 维护', await ev(MENU_CHECK + `('#mdMoreBtn')`)]);
    await ev(`location.hash='#/projects/${pj.pid}';1`); await wait(2400);
    cases.push(['分集工作台 · 更多', await ev(MENU_CHECK + `('#wbMoreBtn')`)]);
    for (const [label, res] of cases) {
      ok(label + '(' + scheme + ') 面板已展开', res && res.open === true, res);
      ok(label + '(' + scheme + ') 每一项都命中面板自身',
        !!res && Array.isArray(res.items) && res.items.length > 0 && res.items.every(it => it.inside), res && res.items);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, scheme + '-menus.png'), Buffer.from(shot.data, 'base64'));
  }

  /* ---------------- D. 层叠上下文与主行动按钮 ---------------- */
  console.log('\n== D. 页头层叠 / 主按钮填充 ==');
  await ev(`localStorage.setItem('vf-scheme','light');1`);
  await send('Page.reload', { ignoreCache: true }); await wait(2400);
  await ev(`location.hash='#/assets';1`); await wait(2200);
  const head = await ev(`(function(){var h=document.querySelector('.page-head');var cs=getComputedStyle(h);
    return {transform:cs.transform,anim:cs.animationName+' '+cs.animationFillMode,z:cs.zIndex,pos:cs.position};})()`);
  ok('.page-head 动画结束后不残留 transform(否则页头自成层叠上下文)', head.transform === 'none', head);
  ok('.page-head 有 position+z-index 兜底', head.pos !== 'static' && Number(head.z) >= 30, head);
  const fills = await ev(FILL_CHECK + `([['#astUploadBtn','主按钮'],['#astMoreBtn','次按钮'],['.cat-chip.on','选中分类'],['.cat-chip:not(.on)','未选分类'],['.pg-btn.on','当前页']])`);
  const by = {}; fills.forEach(f => { by[f.label] = f; });
  const distinct = (x, y) => by[x] && by[y] && by[x].bg !== by[y].bg;
  ok('浅色 · 主按钮是实心的(与所在表面不同色)', by['主按钮'] && by['主按钮'].bg !== by['主按钮'].parent, by['主按钮']);
  ok('浅色 · 主按钮比次按钮更醒目', distinct('主按钮', '次按钮'), [by['主按钮'], by['次按钮']]);
  ok('浅色 · 「已选中」分类芯片与未选中可分辨', distinct('选中分类', '未选分类'), [by['选中分类'], by['未选分类']]);
  ok('浅色 · 分页当前页可分辨', by['当前页'] && by['当前页'].bg !== by['当前页'].parent, by['当前页']);
  /* .asset-check 有 transition:all .15s —— 刚加上 .on 立刻读计算样式会读到过渡起点,先关掉动效 */
  const checked = await ev(`(function(){var st=document.createElement('style');st.id='r44-notrans';
    st.textContent='*,*::before,*::after{transition:none !important;animation:none !important}';document.head.appendChild(st);
    var c=document.querySelector('.asset-check');if(!c)return {missing:true};
    var g=function(n){var s=getComputedStyle(n);return s.backgroundColor+'|'+s.color;};
    var base=g(c);c.classList.add('on');var on=g(c);c.classList.remove('on');
    document.getElementById('r44-notrans').remove();
    return {base:base,on:on};})()`);
  ok('浅色 · 勾选中的方框与未勾选不同色', !!checked.on && checked.on !== checked.base, checked);
  ok('浅色 · 未勾选的方框对勾是隐藏的(color: transparent,否则满屏都像已选中)',
    /rgba\(0, 0, 0, 0\)/.test((checked.base || '').split('|')[1] || ''), checked);
  const stale = await ev(`(function(){var c=document.querySelector('.media-card');var r=c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+40}));
    var before=!!document.querySelector('.ctx-menu');
    location.hash='#/styles';return new Promise(function(res){setTimeout(function(){
      res({before:before,afterRoute:!!document.querySelector('.ctx-menu')});},900);});})()`);
  ok('切换路由会收掉挂在 body 上的右击菜单', stale.before === true && stale.afterRoute === false, stale);

  /* ---------------- E. 窄屏 / 矮屏(填充式布局回退整页滚动)---------------- */
  console.log('\n== E. 窄屏与矮屏回退 ==');
  await ev(`localStorage.setItem('vf-scheme','light');1`);
  for (const vp of [{ w: 980, h: 620, tag: '窄屏 980×620' }, { w: 1440, h: 560, tag: '矮屏 1440×560' }]) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
    await send('Page.reload', { ignoreCache: true }); await wait(2400);
    await ev(`location.hash='#/assets';1`); await wait(2200);
    const m = await ev(MENU_CHECK + `('#astMoreBtn')`);
    ok(vp.tag + ' · 更多面板展开且每一项可点',
      m.open === true && m.items.length > 0 && m.items.every(i => i.inside), m);
    const lay = await ev(`(function(){var c=document.querySelector('.content');var cs=getComputedStyle(c);
      return {fill:document.body.classList.contains('page-fill'),ov:cs.overflowY,
        side:getComputedStyle(document.querySelector('.ast-side')).position,
        main:getComputedStyle(document.querySelector('.ast-main')).overflowY};})()`);
    ok(vp.tag + ' · 布局回退为整页滚动(两栏不再各自滚)',
      lay.ov === 'auto' && lay.main === 'visible', lay);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, 'light-' + vp.w + 'x' + vp.h + '.png'), Buffer.from(shot.data, 'base64'));
  }
  await send('Emulation.clearDeviceMetricsOverride');

  /* ---------------- G. 元素族几何统一(需求三十一) ---------------- */
  console.log('\n== G. 同族元素几何统一 ==');
  await ev(`localStorage.setItem('vf-scheme','dark');1`);
  await send('Page.reload', { ignoreCache: true }); await wait(2400);
  const GEO = `(function(sels){var out={};sels.forEach(function(s){var n=document.querySelector(s);if(!n)return;
    var c=getComputedStyle(n);out[s]={h:parseFloat(c.height),r:c.borderRadius,fs:parseFloat(c.fontSize),fw:c.fontWeight,pad:c.padding};});return out;})`;
  const FAMILIES = {
    pill: ['.cat-chip', '.pg-btn', '.ig-cap-chip', '.cost-hint', '.em-size-tag', '.wpk-chip'],
    badge: ['.tag', '.tag-cat', '.status', '.mc-badge', '.free-badge', '.tag-api'],
    square: ['.icon-btn', '.ws-icon-btn', '.modal-x', '.fav-btn', '.ws-ref-fold']
  };
  const seen = { pill: {}, badge: {}, square: {} };
  for (const route of ['#/assets', '#/admin', '#/images', '#/styles', `#/projects/${pj.pid}/episode/${pj.eid}`]) {
    await ev(`location.hash='${route}';1`); await wait(2000);
    const all = await ev(GEO + '(' + JSON.stringify([].concat(...Object.values(FAMILIES))) + ')');
    for (const fam of Object.keys(FAMILIES)) for (const s of FAMILIES[fam]) if (all[s] && !seen[fam][s]) seen[fam][s] = all[s];
  }
  const ladder = [22, 26, 28, 30, 36, 44];
  for (const fam of ['pill', 'badge', 'square']) {
    const got = seen[fam];
    const keys = Object.keys(got);
    ok(`族「${fam}」至少采到 3 个成员(共 ${keys.length})`, keys.length >= 3, keys);
    const radii = [...new Set(keys.map(k => got[k].r))];
    ok(`族「${fam}」圆角只有一个值: ${radii.join('|')}`, radii.length === 1, radii);
    if (fam === 'badge') {
      /* 徽标不是控件,高度由 11px 字 + 2px 内边距撑出来 —— 统一的是内边距,不是高度 */
      const pads = [...new Set(keys.map(k => got[k].pad))];
      ok('徽标族内边距统一', pads.length === 1, pads);
    } else {
      const hs = [...new Set(keys.map(k => got[k].h))].filter(Boolean);
      ok(`族「${fam}」高度全部落在阶梯上: ${hs.join('/')}`, hs.every(h => ladder.some(l => Math.abs(h - l) <= 1.5)), hs);
    }
    if (fam === 'badge') {
      const fs = [...new Set(keys.map(k => got[k].fs))], fw = [...new Set(keys.map(k => got[k].fw))];
      ok('徽标族字号统一 11px', fs.length === 1 && fs[0] === 11, fs);
      ok('徽标族字重统一 700', fw.length === 1 && fw[0] === '700', fw);
    }
  }

  /* 卡片网格等高:同一行里媒体块高度差必须为 0(32·需求三十一续:成果卡按真实比例撑高,
     短图卡片底部一片死白) */
  const EVEN = `(function(){function g(sel,cs){var grid=document.querySelector(sel);if(!grid)return {sel:sel,missing:true};
    var cards=Array.prototype.slice.call(grid.children).filter(function(c){return c.matches(cs)}).slice(0,12);
    var rows={};cards.forEach(function(c){var r=c.getBoundingClientRect();var m=c.firstElementChild;
      var k=Math.round(r.top);(rows[k]=rows[k]||[]).push([Math.round(r.height),m?Math.round(m.getBoundingClientRect().height):0,Math.round(r.bottom)]);});
    return {sel:sel,rows:Object.keys(rows).map(function(k){var v=rows[k];
      var sp=function(i){return Math.max.apply(0,v.map(function(x){return x[i]}))-Math.min.apply(0,v.map(function(x){return x[i]}))};
      return {n:v.length,hSpan:sp(0),mediaSpan:sp(1),bottomSpan:sp(2)};})};}
    return [g('.ig-res-grid','.ig-card'),g('#assetGrid','.media-card'),g('#styleGrid','.card'),g('#projGrid','.proj-card')];})()`;
  for (const scheme of ['light', 'dark']) {
    await ev(`localStorage.setItem('vf-scheme','${scheme}');1`);
    await send('Page.reload', { ignoreCache: true }); await wait(2400);
    for (const route of ['#/images', '#/assets', '#/styles', '#/projects']) {
      await ev(`location.hash='${route}';1`); await wait(2100);
      const grids = await ev(EVEN);
      for (const gr of grids) {
        if (gr.missing || !gr.rows.length) continue;
        const bad = gr.rows.filter(r => r.mediaSpan > 2 || r.hSpan > 2 || r.bottomSpan > 2);
        ok(`[${scheme}] ${route} · ${gr.sel} 每行卡片等高且媒体块同高`, bad.length === 0, bad);
      }
    }
  }

  /* 分页条不得压在滚动区上 + 每页排满整数行(32·需求三十一续) */
  const PACK = `(function(){var out=[];
    function one(name,gridSel,scrollerSel,pagerSel,minVar){
      var g=document.querySelector(gridSel);if(!g)return {name:name,missing:true};
      var cards=Array.prototype.slice.call(g.children).filter(function(c){return c.getBoundingClientRect().height>0});
      var cols=getComputedStyle(g).gridTemplateColumns.split(' ').filter(function(x){return x&&x!=='none'}).length;
      var rows={};cards.forEach(function(c){var k=Math.round(c.getBoundingClientRect().top);rows[k]=(rows[k]||0)+1});
      var ks=Object.keys(rows).map(Number).sort(function(a,b){return a-b});
      var ragged=ks.filter(function(k,i){return i<ks.length-1&&rows[k]!==cols}).map(function(k){return rows[k]});
      var pg=document.querySelector(pagerSel),sc=document.querySelector(scrollerSel);
      var pr=pg&&pg.getBoundingClientRect(),sr=sc&&sc.getBoundingClientRect();
      out.push({name:name,cards:cards.length,cols:cols,ragged:ragged,
        overlap:sr&&pr?Math.round(sr.bottom-pr.top):-1});}
    one('资产库','#assetGrid','.ast-scroll','#astPager','--card-min');
    one('生图记录','.ig-res-grid','.ig-res-scroll','#igResPager','--ig-card-min');
    return out;})()`;
  await ev(`localStorage.setItem('vf-scheme','light');1`);
  await send('Page.reload', { ignoreCache: true }); await wait(2400);
  for (const route of ['#/assets', '#/images']) {
    await ev(`location.hash='${route}';1`); await wait(2200);
    for (const g of await ev(PACK)) {
      if (g.missing) continue;
      ok(`${g.name} · 每页排满整数行(${g.cards} 张 / ${g.cols} 列,非末行无缺格)`, g.ragged.length === 0, g);
      ok(`${g.name} · 分页条不压在卡片区上`, g.overlap <= 1, g);
    }
  }

  /* ---------------- H. 状态徽标族(48 轮:浅色下不再有棕色实心 / 深底浮层) ---------------- */
  /* 现场不一定有「进行中 / 已取消」的记录,也不能为了看颜色去发一个耗积分的任务,
     所以把徽标族做成固定样本注入量测,量完即删。 */
  console.log('\n== H. 状态徽标族配色契约 ==');
  const FIXTURE = `(function(){
    var host=document.createElement('div');host.id='r49fix';
    host.style.cssText='position:fixed;left:16px;top:96px;z-index:9999;width:360px';
    var flags=['processing','queued','cancelled','failed','completed'].map(function(s){
      var label={processing:'生成中',queued:'排队中',cancelled:'已取消',failed:'失败',completed:'已完成'}[s];
      return '<div class="ig-card-media" style="height:56px;margin-bottom:6px">'
        +'<span class="ig-card-flag"><span class="status status-'+s+'">'
        +(s==='processing'?'<i class="status-dot"></i>':'')+label+'</span></span></div>';}).join('');
    host.innerHTML='<div class="card" style="padding:14px">'+flags
      +'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
      +['queued','processing','completed','failed','cancelled'].map(function(s){
        return '<span class="status status-'+s+'">列表'+s+'</span>';}).join('')+'</div>'
      +'<div class="ws-need-src" style="margin:10px 0 0">融生视频需要一张源图</div>'
      +'<div style="margin-top:10px"><span class="cc-pending">7</span></div></div>';
    document.body.appendChild(host);
    function parse(c){var m=String(c).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;
      var p=m[1].split(',').map(parseFloat);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
    function over(f,b){var a=f.a;return {r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1};}
    function bgOf(n){var c=parse(getComputedStyle(n).backgroundColor);
      if(c&&c.a>.02)return c.a<1?over(c,bgOf(n.parentElement||document.documentElement)):c;
      return n===document.documentElement?{r:255,g:255,b:255,a:1}:bgOf(n.parentElement||document.documentElement);}
    function hsl(c){var r=c.r/255,g=c.g/255,b=c.b/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,h=0;
      if(d){if(mx===r)h=(g-b)/d+(g<b?6:0);else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}
      var l=(mx+mn)/2,s=d?d/(1-Math.abs(2*l-1)):0;return {h:Math.round(h),s:+s.toFixed(2),l:+l.toFixed(2)};}
    function lin(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}
    function L(c){return .2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);}
    function cr(a,b){var x=L(a),y=L(b);return +(((Math.max(x,y)+.05)/(Math.min(x,y)+.05))).toFixed(2);}
    var rows=[];
    host.querySelectorAll('.status, .ws-need-src, .cc-pending').forEach(function(n){
      var bg=bgOf(n),own=parse(getComputedStyle(n).backgroundColor);
      var eff=own&&own.a>.02?(own.a<1?over(own,bgOf(n.parentElement)):own):bg;
      var h=hsl(eff),col=parse(getComputedStyle(n).color);
      var t=(n.textContent||'').trim().slice(0,10);
      rows.push({kind:(n.className||'')+'|'+t,bg:'rgb('+[eff.r|0,eff.g|0,eff.b|0].join(',')+')',
        hue:h.h,sat:h.s,lum:+h.l.toFixed(2),cr:col?cr(col.a<1?over(col,eff):col,eff):null});});
    document.getElementById('r49fix').remove();
    return {rows:rows,scheme:document.documentElement.dataset.scheme};})()`;
  for (const scheme of ['light', 'dark']) {
    await ev(`localStorage.setItem('vf-scheme','${scheme}');1`);
    await send('Page.reload', { ignoreCache: true }); await wait(2400);
    await ev(`location.hash='#/images';1`); await wait(1800);
    const fx = await ev(FIXTURE);
    const row = k => fx.rows.find(r => r.kind.includes(k));
    console.log('   ' + fx.rows.map(r => `${r.kind.split('|')[0].replace('status status-', '')} ${r.bg} h${r.hue} L${r.lum} ${r.cr}`).join('\n   '));
    ok(`[${scheme}] 徽标族文字对比度全部达 AA`, fx.rows.every(r => r.cr === null || r.cr >= 4.5),
      fx.rows.filter(r => r.cr !== null && r.cr < 4.5));
    if (scheme === 'light') {
      ok('[light] 「生成中」角标不再是棕色实心(走主色蓝)',
        row('status-processing|生成中').hue > 180, row('status-processing|生成中'));
      ok('[light] 列表里的「进行中」芯片同样不暖',
        row('status-processing|列表').hue > 180, row('status-processing|列表'));
      ok('[light] 排队 / 已取消角标是浅底药丸,不是深色主题残留的深底浮层',
        row('status-queued|排队中').lum > .7 && row('status-cancelled|已取消').lum > .7,
        [row('status-queued|排队中'), row('status-cancelled|已取消')]);
      ok('[light] 待处理计数药丸不暖', row('cc-pending').hue > 180, row('cc-pending'));
      ok('[light] 真正的警告仍保留琥珀(前置条件提示)',
        row('ws-need-src').hue >= 12 && row('ws-need-src').hue <= 78, row('ws-need-src'));
    } else {
      ok('[dark] 「生成中」仍是琥珀(鎏金身份未动)',
        row('status-processing|生成中').hue >= 25 && row('status-processing|生成中').hue <= 55,
        row('status-processing|生成中'));
      ok('[dark] 排队 / 已取消角标仍是深底浮层',
        row('status-cancelled|已取消').lum < .3, row('status-cancelled|已取消'));
    }
  }

  /* ---------------- I. 失败原因文案(errBrief) ---------------- */
  console.log('\n== I. 上游报错不再是一整坨 JSON ==');
  const EB = await ev(`({
    json: errBrief('{"created":1793009906,"data":[{"id":"creative_06f","status":"queued"}]}'),
    msg: errBrief('{"error":{"message":"quota exceeded"}}'),
    plain: errBrief('connection reset by peer'),
    broken: errBrief('{"not json at all'),
    long: errBrief('x'.repeat(200)),
    nil: errBrief(null)
  })`);
  ok('响应体 JSON → 概括成「上游返回 status=queued」', /status=queued/.test(EB.json) && !/[{}"]/.test(EB.json), EB.json);
  ok('error.message 直接取用', EB.msg === 'quota exceeded', EB.msg);
  ok('普通文字原样保留', EB.plain === 'connection reset by peer', EB.plain);
  ok('残缺 JSON 不抛异常,原样退回(不吞掉用户的报错)', EB.broken === '{"not json at all', EB.broken);
  ok('超长串截断加省略号', EB.long.length === 91 && /…$/.test(EB.long), EB.long.length);
  ok('空值返回空串(让调用方的兜底文案生效)', EB.nil === '', JSON.stringify(EB.nil));
  const usesEB = ['public/js/views/images.js', 'public/js/views/projects.js', 'public/js/views/admin.js']
    .reduce((n, f) => n + (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/errBrief\(/g) || []).length, 0);
  ok('卡片 / 时间线 / toast 三类站点都改走 errBrief', usesEB >= 5, usesEB);

  /* ---------------- F. 登录页(未登录外壳) ---------------- */
  console.log('\n== F. 登录页 · 浅色 ==');
  await ev(`localStorage.setItem('vf-scheme','light');1`);
  await send('Network.clearBrowserCookies');
  await send('Page.navigate', { url: LIVE + '/?r44=1#/login' }); await wait(2600);
  const auth = await ev(AUDIT);
  ok('登录页 · 文字对比度达标', !auth.lowText.length, auth.lowText.slice(0, 3));
  ok('登录页 · 无鎏金残留', !auth.warm.length, auth.warm.slice(0, 4));
  ok('登录页 · 无横向溢出', auth.docOverflowX <= 1, auth.docOverflowX);
  const authShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'light-auth.png'), Buffer.from(authShot.data, 'base64'));

  if (errors.length) { console.log('\nXX 未捕获异常 ' + errors.length + ' 条:'); errors.slice(0, 6).forEach(e => console.log('   ' + e)); FAIL += 1; }
  console.log('\n===== 通过 ' + PASS + ' / 失败 ' + FAIL + ' =====');
  ws.close(); chrome.kill('SIGKILL');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.error('FAIL', e); process.exit(1); });
