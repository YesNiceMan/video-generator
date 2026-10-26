'use strict';
/* 生图工坊(AI 生图 · 第二十五轮 / 第二十六轮增强)
 * 左侧创作面板：模型 / 提示词 / 负面词 / 参考图(图生图·多图合成)/
 * 画幅比例 / 尺寸 / 质量 / 种子 / 张数 —— 选项全部由模型参数模板驱动；
 * 右侧生成记录：轮询任务进度，结果图预览 / 下载 / 重试 / 删除，已自动存入资产库。
 * 参考图挑选弹窗支持多选与「大图浏览」(上一张 / 下一张 / 选用，方向键翻页)。 */
/* 参考图预览地址：优先缩略图，否则走按需生成缩略图接口(第二十七轮修复参考图不显示) */
function igImgSrc(a) { return (a && a.thumb_path) || ('/api/assets/' + a.id + '/thumbnail'); }

const ImagesView = {
  state: { models: [], tasks: [], timer: null, sig: '', refAssets: [], styles: [], perImage: 2, filter: 'all', rpage: 1 },

  async render(root) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    try {
      const [mRes, tRes, sRes] = await Promise.all([
        API.get('/images/models'),
        API.get('/tasks?status=all'),
        API.get('/styles').catch(() => ({ items: [] }))
      ]);
      await CreditCenter.refresh();
      this.state.models = mRes.items || [];
      this.state.perImage = mRes.perImage != null ? mRes.perImage : 2;
      this.state.styles = (sRes.items || []).filter(s => true);
      this.state.tasks = (tRes.items || []).filter(t => t.type === 'text-to-image');
      this.state.refAssets = [];
    } catch (e) {
      root.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('triangle-alert') + '</div><h3>' + esc(e.message) + '</h3></div>';
      return;
    }
    this.root = root;
    root.innerHTML = this.shellHTML();
    this.renderForm(root);
    this.renderResults(root, false);
    this.startPolling(root);
    return () => this.stopPolling();
  },

  /* ---------- 模型能力 / 参数模板(第二十六轮) ---------- */
  capsOf(m) { return Array.isArray(m && m.caps) && m.caps.length ? m.caps : ['text-to-image']; },
  canRef(m) { const c = this.capsOf(m); return c.includes('image-to-image') || c.includes('multi-image'); },
  canMulti(m) { return this.capsOf(m).includes('multi-image'); },
  schemaDef(m, key) { const s = Array.isArray(m && m.params_schema) ? m.params_schema : []; return s.find(d => d && d.key === key) || null; },
  ratioDef(m) { const d = this.schemaDef(m, 'ratio'); return d && Array.isArray(d.options) && d.options.length ? d : null; },
  sizeDef(m) { const d = this.schemaDef(m, 'size'); return d && Array.isArray(d.options) && d.options.length ? d : null; },
  resDef(m) { const d = this.schemaDef(m, 'resolution'); return d && Array.isArray(d.options) && d.options.length ? d : null; },
  qualityDef(m) { const d = this.schemaDef(m, 'quality'); return d && Array.isArray(d.options) && d.options.length ? d : null; },
  maxCountOf(m) { const mc = m && m.rules && m.rules.limits && Number(m.rules.limits.max_count); return Math.max(1, Math.min(Number.isFinite(mc) ? mc : 4, 4)); },
  /* 每张单价：模型价优先，回退全局(第二十七轮) */
  priceOf(m) {
    if (m && m.is_free) return 0;
    const mp = m && m.price_per_image != null ? Number(m.price_per_image) : (m && Number(m.credit_per_second) || 0);
    return mp > 0 ? mp : (this.state.perImage || 2);
  },

  /* ---------- 布局外壳 ---------- */
  shellHTML() {
    const st = this.state;
    const noModel = !st.models.length;
    return `
    <div class="page-head">
      <div class="page-head-main">
        <div class="page-eyebrow">${icon('image-plus')} Image Lab</div>
        <h1 class="page-title">AI 生图</h1>
        <p class="page-sub">提示词生成 · 图生图 · 多图合成(能力由模型勾选决定);结果自动存入资产库，可直接用作图生视频源图。</p>
      </div>
      <div class="page-actions">
        <span class="cost-hint" title="生图按张计价；模型设置了单价时按模型价，免费生图模型不消耗积分">${icon('coins')} 全局默认 ${st.perImage} 分/张</span>
        <a class="btn" href="#/assets">${iconText('folder-open', '资产库')}</a>
      </div>
    </div>
      <div class="ig-grid">
        <div class="card ig-form" id="igFormCard">${noModel ? this.noModelHTML() : '<div class="loading-wrap"><span class="spinner"></span></div>'}</div>
        <div class="ig-results" id="igResults"></div>
      </div>`;
  },

  noModelHTML() {
    const isAdmin = App.user && App.user.role === 'admin';
    return `
      <div class="empty" style="padding:40px 16px">
        <div class="empty-ico">${icon('image-off')}</div>
        <h3>暂无可用生图模型</h3>
        <p style="font-size:13px;color:var(--ink-2)">请联系管理员在「后台管理 → 模型管理」添加 AI 生图模型<br>(填 API 地址 + Key 后可一键检测可用模型)</p>
        ${isAdmin ? '<a class="btn btn-primary btn-sm" href="#/admin" style="margin-top:10px">' + iconText('settings', '去后台添加') + '</a>' : ''}
      </div>`;
  },

  /* ---------- 创作面板(按模型参数模板动态渲染，第二十六轮) ---------- */
  renderForm(root) {
    const card = root.querySelector('#igFormCard');
    if (!card) return;
    card.dataset.igModel = '';
    this.drawForm(root, card);
  },

  drawForm(root, card) {
    const st = this.state;
    const modelId = card.dataset.igModel || (st.models[0] && st.models[0].id);
    const model = st.models.find(x => x.id === modelId) || st.models[0];
    card.dataset.igModel = model.id;
    /* 重渲染前保留已填内容：换模型 / 选参考图都会重画面板，
       此前只有换模型的路径手动保值，选完参考图回来提示词就被清空了 */
    const prev = {
      prompt: (card.querySelector('#igPrompt') || {}).value || '',
      neg: (card.querySelector('#igNeg') || {}).value || '',
      count: (card.querySelector('#igCount') || {}).value || '1',
      quality: (card.querySelector('#igQuality') || {}).value || '',
      seed: (card.querySelector('#igSeed') || {}).value,
      style: (card.querySelector('#igStyle') || {}).value || ''
    };
    const styleOpts = '<option value="">不使用风格</option>' + st.styles.map(s =>
      '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('');
    const capChips = this.capsOf(model).map(c => '<span class="ig-cap-chip">'
      + icon(c === 'multi-image' ? 'layers' : (c === 'image-to-image' ? 'image' : 'type'), 'ico-xs')
      + (c === 'multi-image' ? '多图合成' : (c === 'image-to-image' ? '图生图' : '文生图')) + '</span>').join('');
    /* 比例 / 分辨率 / 质量 / 种子选项：全部来自模型参数模板(后台可配，第二十六轮) */
    const ratioDef = this.ratioDef(model);
    const sizeDef = this.sizeDef(model);
    const resDef = this.resDef(model);
    const qualityDef = this.qualityDef(model);
    const hasSeed = !!this.schemaDef(model, 'seed');
    const RATIO_LABELS = { '1:1': '方图', '4:3': '横图', '3:4': '竖图', '16:9': '宽幅', '9:16': '全景竖', '3:2': '摄影横', '2:3': '摄影竖', '21:9': '影院宽' };
    const ratioOpts = ratioDef ? ratioDef.options.map(rt =>
      '<option value="' + esc(rt) + '">' + esc(rt) + (RATIO_LABELS[rt] ? ' · ' + RATIO_LABELS[rt] : '') + '</option>').join('') : '';
    /* 画幅比例 + 分辨率两个维度,提交后由服务端按模型规则换算(26·3 / 26·9);
       档位清单优先取模型参数模板,其次取服务端按 rules 算出的 res_tiers —— 前端不预设 1K/2K/4K */
    const resTiers = (resDef && Array.isArray(resDef.options) && resDef.options.length) ? resDef.options.map(String)
      : (Array.isArray(model.res_tiers) && model.res_tiers.length ? model.res_tiers.map(String) : IMG_RES_TIERS);
    const resDefault = resDef && resDef.default != null ? String(resDef.default) : (resTiers.includes('1K') ? '1K' : resTiers[0]);
    const resOpts = resTiers.map(rs =>
      '<option value="' + esc(rs) + '"' + (String(rs) === String(resDefault) ? ' selected' : '') + '>'
      + esc(resTierLabel(rs)) + '</option>').join('');
    const sizeOpts = sizeDef ? sizeDef.options.map(sz =>
      '<option value="' + esc(sz) + '">' + esc(sz) + '</option>').join('') : '';
    const qualityOpts = qualityDef ? '<option value="">' + esc(qualityDef.label || '质量') + ':默认</option>' + qualityDef.options.map(qd =>
      '<option value="' + esc(qd) + '">' + esc(qualityDef.label || '质量') + ':' + esc(qd) + '</option>').join('') : '';
    const maxCount = this.maxCountOf(model);
    const countOpts = Array.from({ length: maxCount }, (_, i) => i + 1).map(n =>
      '<option value="' + n + '">' + n + ' 张</option>').join('');
    const refLabel = this.canMulti(model) ? '参考图 · 图生图 / 多图合成(可多选)' : '参考图 · 图生图(可选)';
    const canRef = this.canRef(model);
    let html = '';
    /* 27·1:面板整体压扁一屏放得下 —— 模型与风格并排一行、提示词与负面提示词合成一个输入区、
       字数计数并入标签行、费用与主按钮并排 */
    html += '<div class="form-sect">模型</div>';
    html += '<div class="form-row">';
    html += '<div class="field ig-f-model"><label>生图模型</label><select class="select" id="igModel">';
    html += st.models.map(mm => '<option value="' + esc(mm.id) + '"' + (mm.id === model.id ? ' selected' : '') + '>' + esc(mm.name) + (mm.is_free ? '(免费)' : '') + '</option>').join('');
    html += '</select><div class="hint" id="igModelHint"></div></div>';
    html += '<div class="field"><label>风格(可选)</label><select class="select" id="igStyle">' + styleOpts + '</select></div>';
    html += '</div>';
    html += '<div class="ig-cap-row" id="igCapRow">' + capChips + '</div>';
    html += '<div class="form-sect">画面描述</div>';
    html += '<div class="field"><label class="ig-prompt-label">提示词<span class="ig-count" id="igPromptCount">0 / 2000</span></label>';
    html += '<textarea class="textarea ig-prompt" id="igPrompt" rows="3" maxlength="2000" placeholder="描述想要的画面，如：金色黄昏下的古代港口，商船进港，电影感光影…"></textarea>';
    html += '<input class="input ig-neg" id="igNeg" autocomplete="off" placeholder="避免出现的元素（负面提示词，可留空）：模糊、水印、文字">';
    html += '</div>';
    html += '<div class="field" id="igRefField"' + (canRef ? '' : ' hidden') + '><label>' + refLabel + '</label>';
    html += '<div class="ig-ref-row" id="igRefRow"></div><div class="hint" id="igRefHint"></div></div>';
    html += '<div class="form-sect">输出规格</div>';
    html += '<div class="form-row">';
    if (ratioDef) html += '<div class="field"><label>画幅比例</label><select class="select" id="igRatio">' + ratioOpts + '</select></div>';
    /* 分辨率：无 resolution 模板且有自定义尺寸清单的旧模型仍显示「尺寸」 */
    if (resDef || !sizeDef) html += '<div class="field"><label>分辨率</label><select class="select" id="igRes">' + resOpts + '</select></div>';
    else html += '<div class="field"><label>尺寸</label><select class="select" id="igSize">' + sizeOpts + '</select></div>';
    html += '<div class="field"><label>生成张数</label><select class="select" id="igCount">' + countOpts + '</select></div>';
    html += '</div>';
    html += '<div class="hint ig-spec-out" id="igSpecOut"></div>';
    /* 质量 / 种子属于低频参数:收进「更多参数」,保证常用地带一屏可见(27·1) */
    if (qualityDef || hasSeed) {
      html += '<details class="ig-more"><summary>' + icon('sliders-horizontal', 'ico-xs') + '更多参数'
        + (qualityDef ? ' · 质量' : '') + (hasSeed ? ' · 种子' : '') + '</summary><div class="form-row">';
      if (qualityDef) html += '<div class="field"><label>质量</label><select class="select" id="igQuality">' + qualityOpts + '</select></div>';
      if (hasSeed) html += '<div class="field"><label>随机种子</label><div class="ig-seed-row"><input class="input" id="igSeed" type="number" value="-1" placeholder="-1 = 随机"><button class="btn btn-sm" id="igSeedBtn" title="随机刷新种子">' + icon('dices', 'ico-xs') + '随机</button></div><div class="hint">固定种子可复现同一张图</div></div>';
      html += '</div></details>';
    }
    html += '<div class="ig-foot-row"><span class="cost-hint" id="igCost"></span>';
    html += '<button class="btn btn-primary ig-go" id="igGo">' + iconText('sparkles', '开始生图') + '</button></div>';
    card.innerHTML = html;
    /* 回填重渲染前已填的内容 */
    const back = (sel, val) => { const n = card.querySelector(sel); if (n && val !== undefined && val !== null && val !== '') n.value = val; };
    back('#igPrompt', prev.prompt);
    back('#igNeg', prev.neg);
    back('#igStyle', prev.style);
    back('#igQuality', prev.quality);
    back('#igSeed', prev.seed);
    const cc = card.querySelector('#igCount');
    if (cc && Array.from(cc.options).some(o => o.value === prev.count)) cc.value = prev.count;
    const q = s => card.querySelector(s);
    const updatePromptCount = () => {
      const p = q('#igPrompt');
      const cnt = q('#igPromptCount');
      if (p && cnt) cnt.textContent = p.value.length + ' / 2000';
    };
    updatePromptCount();
    const updateModelHint = () => {
      const hint = q('#igModelHint');
      if (!hint) return;
      hint.textContent = model.is_free
        ? '免费模型 · 不消耗积分'
        : (model.api_base ? '在线 API 模型 · ' + this.priceOf(model) + ' 积分/张' : '本地模型 · ' + this.priceOf(model) + ' 积分/张');
      if (model.api_base && !model.has_api_key) hint.textContent = '⚠ 管理员还未配置该模型的 API Key,暂不可用';
    };
    const updateCost = () => {
      const el2 = q('#igCost');
      if (!el2) return;
      const n = Number((q('#igCount') || {}).value) || 1;
      const per = this.priceOf(model);
      const cost = per * n;
      el2.innerHTML = cost > 0
        ? '本次预计消耗 <b>' + cost + '</b> 积分(' + per + ' 分/张 × ' + n + ' 张)· 余额 ' + (CreditCenter.cache.balance || 0)
        : '免费模型 · 不消耗积分';
    };
    /* 输出尺寸实时预览(26·3):比例 / 分辨率一改就看到最终宽高,
       这两个参数此前只在服务端悄悄换算,用户完全看不出「改了有没有用」 */
    const updateSpecOut = () => {
      const out = q('#igSpecOut');
      if (!out) return;
      const ratio = ((q('#igRatio') || {}).value || '').trim();
      const res = ((q('#igRes') || {}).value || '').trim();
      const fixed = ((q('#igSize') || {}).value || '').trim();
      if (fixed) {
        out.innerHTML = icon('frame', 'ico-xs') + ' 输出尺寸 <b>' + esc(fixed) + '</b> · 该模型按固定尺寸清单出图';
        return;
      }
      const wh = imgSizeFrom(ratio, res);
      /* 网关按「档位」还是按「像素尺寸」收参数,由服务端从模型规则算出(size_mode) */
      if ((model.size_mode || 'pixels') === 'tier') {
        out.innerHTML = icon('frame', 'ico-xs') + ' 请求参数 <b>size=' + esc(String(res || '').toUpperCase())
          + ' · ratio=' + esc(ratio || '1:1') + '</b>'
          + '<span class="ig-spec-note">(该网关按档位出图,实际像素由服务方决定 · 约 ' + wh.w + '×' + wh.h + ')</span>';
        return;
      }
      const sizes = Array.isArray(model.supported_sizes) ? model.supported_sizes.filter(sx => String(sx).indexOf('x') > 0) : [];
      let txt = icon('frame', 'ico-xs') + ' 输出尺寸 <b>' + wh.w + '×' + wh.h + '</b>'
        + (ratio ? ' · 比例 ' + esc(ratio) : '') + (res ? ' · ' + esc(String(res).toUpperCase()) : '');
      if (sizes.length) txt += '<span class="ig-spec-note">(该模型仅支持 ' + esc(sizes.join(' / ')) + ',提交时就近吸附)</span>';
      out.innerHTML = txt;
    };
    const updateRefRow = () => {
      const row = q('#igRefRow');
      if (!row) return;
      const refs = st.refAssets;
      if (!refs.length) {
        row.innerHTML = '<button class="btn btn-sm" id="igRefPick">' + iconText('image-plus', '选择参考图') + '</button>';
      } else {
        row.innerHTML = refs.map((a, i) =>
          '<span class="ig-ref-chip">'
          + '<img class="ig-ref-thumb" src="' + esc(igImgSrc(a)) + '" alt="">'
          + '<span class="ig-ref-name">' + esc(a.name || '参考图') + '</span>'
          + '<button class="ig-ref-x" data-ref-i="' + i + '" title="移除">' + icon('x', 'ico-xs') + '</button></span>').join('')
          + (this.canMulti(model) && refs.length < 8 ? '<button class="btn btn-sm" id="igRefPick" title="继续添加">' + icon('plus', 'ico-xs') + '</button>' : '');
      }
      const pick = row.querySelector('#igRefPick');
      if (pick) pick.addEventListener('click', () => this.pickRefAssets());
      row.querySelectorAll('.ig-ref-x').forEach(xb => xb.addEventListener('click', () => {
        st.refAssets.splice(Number(xb.dataset.refI), 1);
        updateRefRow();
      }));
      const hintEl = q('#igRefHint');
      if (hintEl) hintEl.textContent = refs.length > 1 ? '已选 ' + refs.length + ' 张参考图，提交后将融合生成' : '';
    };
    const modelSel = q('#igModel');
    modelSel.addEventListener('change', () => {
      /* 切模型：能力 / 参数模板变化 → 重画面板(drawForm 内部已保留提示词等已填内容) */
      card.dataset.igModel = modelSel.value;
      const nm = st.models.find(x => x.id === modelSel.value) || st.models[0];
      if (!this.canRef(nm)) st.refAssets = [];
      else if (!this.canMulti(nm)) st.refAssets = st.refAssets.slice(0, 1);
      this.drawForm(root, card);
    });
    const countEl = q('#igCount');
    if (countEl) countEl.addEventListener('change', updateCost);
    ['#igRatio', '#igRes', '#igSize'].forEach(sel => {
      const n = q(sel);
      if (n) n.addEventListener('change', updateSpecOut);
    });
    /* 随机种子一键刷新(第二十七轮) */
    const seedBtn = q('#igSeedBtn');
    if (seedBtn) seedBtn.addEventListener('click', () => {
      const seedEl = q('#igSeed');
      if (seedEl) seedEl.value = String(Math.floor(Math.random() * 2147483647));
    });
    const promptEl = q('#igPrompt');
    promptEl.addEventListener('input', updatePromptCount);
    promptEl.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') q('#igGo').click();
    });
    q('#igGo').addEventListener('click', () => this.generate(root));
    updateRefRow();
    updateModelHint(); updateCost(); updateSpecOut();
  },

  /* ---------- 参考图挑选：多选 + 大图浏览(第二十六轮) ---------- */
  async pickRefAssets() {
    return this.pickRefAssetsFor({
      multi: this.canMulti(this.currentModel()),
      selected: this.state.refAssets.map(a => a.id),
      onPick: list => {
        this.state.refAssets = list;
        if (this.root) this.drawForm(this.root, this.root.querySelector('#igFormCard'));
      }
    });
  },

  /* 通用挑选弹窗(生图页与分镜工作台共用)
   * opts: { multi:boolean, selected:[id], onPick(list) } */
  async pickRefAssetsFor(opts) {
    const o = opts || {};
    let items = [];
    try { items = (await API.get('/assets?type=image')).items || []; }
    catch (e) { return toast(e.message, 'err'); }
    if (!items.length) {
      return openModal({ title: icon('image-plus', 'ico-sm') + ' 选择参考图', size: 'modal-sm',
        body: '<div class="empty" style="padding:30px 12px"><div class="empty-ico">' + icon('image') + '</div><h3>还没有图片资产</h3><p style="font-size:12.5px;color:var(--ink-2)">先到「资产库」上传图片，或先文生图几张</p></div>' });
    }
    const selected = new Set(o.selected || []);
    const maxPick = o.multi ? 8 : 1;
    const body = el('<div></div>');
    body.innerHTML = '<input class="input" id="igPickSearch" placeholder="搜索图片名称…" style="margin-bottom:10px">'
      + '<div class="ig-pick-grid" id="igPickList"></div><div id="igPickPager"></div>';
    const okBtn = el('<button class="btn btn-primary">' + iconText('check', '使用选中的 ' + selected.size + ' 张') + '</button>');
    const clearBtn = el('<button class="btn">清空选择</button>');
    /* footer 必须走 openModal 参数，否则 .modal-foot 不会创建 */
    const modal = openModal({ title: icon('images', 'ico-sm') + ' 选择参考图(可多选 · 悬停点放大镜可大图浏览)', size: 'modal-xl', body, footer: [clearBtn, okBtn] });
    const listEl = body.querySelector('#igPickList');
    const refreshOk = () => { okBtn.innerHTML = iconText('check', '使用选中的 ' + selected.size + ' 张'); okBtn.disabled = !selected.size; };
    clearBtn.addEventListener('click', () => { selected.clear(); renderList(_kw); refreshOk(); });
    okBtn.addEventListener('click', () => {
      const picked = items.filter(a => selected.has(a.id));
      if (typeof o.onPick === 'function') o.onPick(picked);
      modal.close();
      toast(picked.length ? '已选择 ' + picked.length + ' 张参考图' : '已清空参考图', 'ok');
    });
    /* 大图浏览：在弹出的图片列表中上一张 / 下一张 + 直接选用；← → 方向键翻页 */
    let _lastList = items;
    let _kw = '';
    let _page = 1;
    function renderList(kw) {
      if ((kw || '') !== _kw) _page = 1;   /* 26·1:换关键词回到第 1 页,列表每页 20 张 */
      _kw = kw || '';
      const list = _kw ? items.filter(a => (a.name || '').toLowerCase().includes(_kw.toLowerCase())) : items;
      _lastList = list;
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (_page > pages) _page = pages;
      const start = (_page - 1) * PAGE_SIZE;
      const shown = list.slice(start, start + PAGE_SIZE);
      renderPager(body.querySelector('#igPickPager'), {
        page: _page, total: list.length, onPage: p => { _page = p; renderList(_kw); }
      });
      listEl.innerHTML = shown.length ? shown.map((a, i) =>
        '<div class="ig-pick-item' + (selected.has(a.id) ? ' sel' : '') + '" data-aid="' + esc(a.id) + '" data-idx="' + (start + i) + '" title="点击选中/取消">'
        + '<span class="ig-pick-check">' + icon('check', 'ico-xs') + '</span>'
        + '<img src="' + esc(igImgSrc(a)) + '" loading="lazy" alt="">'
        + '<span class="ig-pick-name">' + esc(a.name || '未命名') + '</span>'
        + '<button class="ig-pick-zoom" data-zoom="' + (start + i) + '" title="大图浏览">' + icon('zoom-in', 'ico-xs') + '</button></div>').join('')
        : '<div class="empty" style="padding:24px;grid-column:1/-1"><h3>没有匹配的图片</h3></div>';
      listEl.querySelectorAll('.ig-pick-item').forEach(itemEl => itemEl.addEventListener('click', e => {
        if (e.target.closest('.ig-pick-zoom')) return;
        const aid = itemEl.dataset.aid;
        if (selected.has(aid)) selected.delete(aid);
        else if (selected.size >= maxPick) { toast('最多选 ' + maxPick + ' 张(该模型不支持多图合成)', 'err'); return; }
        else selected.add(aid);
        itemEl.classList.toggle('sel', selected.has(aid));
        refreshOk();
      }));
      listEl.querySelectorAll('.ig-pick-zoom').forEach(zb => zb.addEventListener('click', e => {
        e.stopPropagation();
        browse(Number(zb.dataset.zoom));
      }));
    }
    function browse(idx) {
      const list = _lastList;
      const a = list[idx];
      if (!a) return;
      const lb = el('<div class="ig-lb-body"></div>');
      lb.innerHTML = '<img class="ig-lb-img" src="/api/assets/' + esc(a.id) + '/file" alt="" onerror="this.style.opacity=.25">';
      lb.innerHTML += '<div class="ig-lb-meta"><b>' + esc(a.name || '未命名') + '</b>'
        + (a.width ? '<span>' + esc(a.width) + '×' + esc(a.height) + '</span>' : '')
        + '<span class="ig-lb-count">' + (idx + 1) + ' / ' + list.length + '</span></div>';
      const navs = el('<div class="ig-lb-navs"></div>');
      const prev = el('<button class="btn btn-sm">' + iconText('chevron-left', '上一张') + '</button>');
      const next = el('<button class="btn btn-sm">' + iconText('chevron-right', '下一张') + '</button>');
      const useBtn = el('<button class="btn btn-primary btn-sm">' + iconText('check', selected.has(a.id) ? '已选中' : '选用这张') + '</button>');
      prev.disabled = idx <= 0;
      next.disabled = idx >= list.length - 1;
      prev.addEventListener('click', () => { closeTopModal(); browse(idx - 1); });
      next.addEventListener('click', () => { closeTopModal(); browse(idx + 1); });
      useBtn.addEventListener('click', () => {
        if (selected.has(a.id)) selected.delete(a.id);
        else if (selected.size >= maxPick) { toast('最多选 ' + maxPick + ' 张(该模型不支持多图合成)', 'err'); return; }
        else selected.add(a.id);
        closeTopModal(); refreshOk(); renderList(_kw);
      });
      navs.append(prev, next, useBtn);
      lb.appendChild(navs);
      openModal({ title: icon('zoom-in', 'ico-sm') + ' 浏览参考图', size: 'modal-lg', body: lb });
    }
    function closeTopModal() {
      const masks = document.querySelectorAll('.modal-mask');
      const top = masks[masks.length - 1];
      if (top) {
        const x = top.querySelector('.modal-x');
        if (x) x.click();
      }
    }
    /* ← → 方向键在大图弹窗内翻页 */
    const keyHandler = e => {
      if (!document.querySelector('.modal-mask .ig-lb-body')) return;
      const cnt = document.querySelector('.ig-lb-count');
      if (!cnt) return;
      const cur = parseInt((cnt.textContent || '').split('/')[0], 10) - 1;
      if (isNaN(cur)) return;
      if (e.key === 'ArrowLeft' && cur > 0) { closeTopModal(); browse(cur - 1); }
      else if (e.key === 'ArrowRight' && cur < _lastList.length - 1) { closeTopModal(); browse(cur + 1); }
      else if (e.key === 'Escape') closeTopModal();
    };
    document.addEventListener('keydown', keyHandler);
    const origClose = modal.close;
    modal.close = () => { document.removeEventListener('keydown', keyHandler); origClose(); };
    body.querySelector('#igPickSearch').addEventListener('input', e => renderList(e.target.value));
    renderList('');
    refreshOk();
  },

  currentModel() {
    const st = this.state;
    const card = this.root && this.root.querySelector('#igFormCard');
    const id = (card && card.dataset.igModel) || (st.models[0] && st.models[0].id);
    return st.models.find(x => x.id === id) || st.models[0];
  },

  /* ---------- 提交生成 ---------- */
  async generate(root) {
    const card = root.querySelector('#igFormCard');
    const q = s => card.querySelector(s);
    const modelId = q('#igModel').value;
    const model = this.state.models.find(m => m.id === modelId);
    if (!model) return toast('请选择生图模型', 'err');
    if (model.api_base && !model.has_api_key) return toast('该在线模型还未配置 API Key,请联系管理员', 'err');
    const prompt = q('#igPrompt').value.trim();
    if (!prompt) { q('#igPrompt').focus(); return toast('请输入生图提示词', 'err'); }
    const count = Number(q('#igCount').value) || 1;
    const per = this.priceOf(model);
    const cost = per * count;
    if (cost > 0 && (CreditCenter.cache.balance || 0) < cost) {
      return toast('积分不足：本次需 ' + cost + ' 积分，余额 ' + (CreditCenter.cache.balance || 0) + ',可到积分中心申请', 'err');
    }
    const btn = q('#igGo');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner-sm"></span>提交中…';
    try {
      const ratioSel = q('#igRatio');
      const resSel = q('#igRes');
      const sizeSel = q('#igSize');
      const qualitySel = q('#igQuality');
      const seedEl = q('#igSeed');
      await API.post('/images/generate', {
        model_id: modelId,
        prompt,
        negative_prompt: q('#igNeg').value.trim(),
        /* 画幅比例 + 分辨率档(服务端换算具体尺寸);旧模型(固定尺寸清单)仍传 size */
        aspect_ratio: ratioSel ? ratioSel.value : undefined,
        resolution: resSel ? resSel.value : undefined,
        size: sizeSel ? sizeSel.value : undefined,
        quality: qualitySel && qualitySel.value ? qualitySel.value : undefined,
        seed: seedEl && seedEl.value !== '' ? Number(seedEl.value) : undefined,
        count,
        ref_asset_ids: this.state.refAssets.length ? this.state.refAssets.map(a => a.id) : undefined,
        style_id: q('#igStyle').value || undefined
      });
      if (cost > 0) { CreditCenter.cache.balance = (CreditCenter.cache.balance || 0) - cost; CreditCenter.refresh(); }
      toast('生图任务已提交' + (cost > 0 ? '(消耗 ' + cost + ' 积分)' : '(免费)'), 'ok');
      this.state.rpage = 1;   /* 新任务排在第 1 页,别停在旧页看不到刚提交的那条 */
      await this.refreshTasks();
      this.renderResults(root, false);
    } catch (e) {
      toast(e.message, 'err');
    }
    btn.disabled = false;
    btn.innerHTML = iconText('sparkles', '开始生图');
  },

  /* ---------- 生成记录 ---------- */
  /* 状态筛选：全部 / 进行中 / 已完成 / 失败(含已取消) */
  FILTER_DEFS: [
    { key: 'all', label: '全部', test: () => true },
    { key: 'running', label: '进行中', test: t => ['queued', 'processing'].includes(t.status) },
    { key: 'completed', label: '已完成', test: t => t.status === 'completed' },
    { key: 'failed', label: '失败', test: t => ['failed', 'cancelled'].includes(t.status) }
  ],
  visibleTasks() {
    const def = this.FILTER_DEFS.find(f => f.key === this.state.filter) || this.FILTER_DEFS[0];
    return this.state.tasks.filter(def.test);
  },

  renderResults(root, silent) {
    const wrap = root.querySelector('#igResults');
    if (!wrap) return;
    const st = this.state;
    const active = st.tasks.filter(t => ['queued', 'processing'].includes(t.status)).length;
    if (silent && !st.tasks.length) return;
    const done = st.tasks.filter(t => t.status === 'completed').length;
    const filtered = this.visibleTasks();
    /* 26·1:生成记录同样每页 20 条(演示账号 50+ 条时右栏一度拉到 3700px 高) */
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    st.rpage = Math.min(Math.max(1, st.rpage || 1), pages);
    const shown = filtered.slice((st.rpage - 1) * PAGE_SIZE, (st.rpage - 1) * PAGE_SIZE + PAGE_SIZE);
    let html = '<div class="ig-res-head">';
    html += '<div class="ig-res-title">' + icon('images', 'ico-sm') + ' 生成记录 <b>' + st.tasks.length + '</b>';
    html += active ? '<i class="ig-res-run">' + active + ' 进行中</i>' : '';
    html += '</div><div class="ig-res-meta">完成 ' + done + ' · 图片已自动存入资产库'
      + (pages > 1 ? ' · 第 ' + st.rpage + '/' + pages + ' 页' : '') + '</div></div>';
    /* 结果筛选 chips(点击过滤，操作更聚焦) */
    html += '<div class="ig-filters">' + this.FILTER_DEFS.map(f => {
      const n = st.tasks.filter(f.test).length;
      return '<button class="cat-chip' + (st.filter === f.key ? ' on' : '') + '" data-ig-filter="' + f.key + '">'
        + f.label + ' <i>' + n + '</i></button>';
    }).join('') + '</div>';
    /* 27·2:记录头与筛选 chips 固定,只有卡片区滚动 */
    html += '<div class="ig-res-scroll"><div class="ig-res-grid">';
    html += shown.length ? shown.map(t => this.taskCardHTML(t)).join('')
      : '<div class="empty" style="grid-column:1/-1;padding:44px 16px"><div class="empty-ico">' + icon('image-plus') + '</div><h3>'
        + (st.tasks.length ? '该筛选下暂无记录' : '还没有生成记录') + '</h3><p style="font-size:13px;color:var(--ink-2)">在左侧输入提示词，点击「开始生图」试试</p></div>';
    html += '</div>';
    html += '<div id="igResPager"></div></div>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-ig-filter]').forEach(btn => btn.addEventListener('click', () => {
      st.filter = btn.dataset.igFilter;
      st.rpage = 1;
      this.renderResults(root, false);
    }));
    renderPager(wrap.querySelector('#igResPager'), {
      page: st.rpage, total: filtered.length,
      onPage: p => { st.rpage = p; this.renderResults(root, false); }
    });
    wrap.querySelectorAll('[data-ig-task]').forEach(cardEl => this.bindTaskCard(cardEl));
  },

  /* 点击成果图 → 全站统一查看器(该任务多张图可 ← → 翻页，支持复制提示词) */
  openTaskImages(taskId, assetId) {
    const t = this.state.tasks.find(x => x.id === taskId);
    if (!t) return;
    const imgs = (t.result_assets || []).filter(a => a && a.id);
    if (!imgs.length) return;
    const items = imgs.map(a => ({
      id: a.id, name: a.name || ('生图-' + t.id.slice(0, 8)), type: 'image',
      width: a.width, height: a.height, created_at: t.created_at
    }));
    const idx = Math.max(0, items.findIndex(x => x.id === assetId));
    const prompt = t.prompt || '';
    openViewer(items, idx, {
      actions: prompt ? [{
        label: '复制提示词', icon: 'copy',
        onClick: async () => {
          try { await navigator.clipboard.writeText(prompt); toast('提示词已复制', 'ok'); }
          catch (e) { toast(prompt.slice(0, 120), 'info', 6000); }
        }
      }] : []
    });
  },

  taskCardHTML(t) {
    const model = this.state.models.find(m => m.id === t.model_id);
    let media;
    if (t.status === 'completed' && (t.result_assets || []).length) {
      /* 单元格按图片真实宽高比呈现:此前一律 1:1 裁切,换了画幅比例也看不出差别 */
      media = '<div class="ig-card-imgs">' + t.result_assets.map(a =>
        '<div class="ig-img-cell" data-ig-view="' + esc(t.id) + '" data-ig-asset="' + esc(a.id) + '" title="点击放大查看(← → 翻页)"'
        + (a.width && a.height ? ' style="aspect-ratio:' + Number(a.width) + ' / ' + Number(a.height) + '"' : '') + '>'
        + '<img src="' + esc(a.thumb_path || ('/api/assets/' + a.id + '/file')) + '" loading="lazy">'
        + '<button class="ig-img-view" data-ig-view="' + esc(t.id) + '" data-ig-asset="' + esc(a.id) + '" title="放大查看">' + icon('zoom-in', 'ico-xs') + '</button></div>').join('') + '</div>';
    } else if (t.status === 'queued' || t.status === 'processing') {
      media = '<div class="ig-card-progress"><div class="ig-card-bar"><i style="width:' + (t.progress || 2) + '%"></i></div><span>' + (t.progress || 2) + '%</span></div>';
    } else {
      media = '<div class="ig-card-fail">' + esc(t.error || (t.status === 'cancelled' ? '已取消' : '生成失败')) + '</div>';
    }
    const canDel = ['completed', 'failed', 'cancelled'].includes(t.status);
    const refCount = t.params && t.params.ref_count ? t.params.ref_count : 0;
    const actions =
      (t.status === 'completed' && t.result_asset_id
        ? '<a class="ig-act" href="/api/assets/' + esc(t.result_asset_id) + '/file" download="' + esc('生图-' + t.id.slice(0, 8) + '.png') + '">' + icon('download', 'ico-xs') + '下载</a>'
        : '')
      + (t.status === 'completed'
        ? '<button class="ig-act" data-act="again" title="按相同提示词与参数再生成一批(新任务重新计价)">' + icon('sparkles', 'ico-xs') + '再次生成</button>' : '')
      + (t.status === 'failed' || t.status === 'cancelled'
        ? '<button class="ig-act" data-act="retry">' + icon('rotate-ccw', 'ico-xs') + '重试</button>' : '')
      + (t.status === 'queued' || t.status === 'processing'
        ? '<button class="ig-act" data-act="cancel">' + icon('x', 'ico-xs') + '取消</button>' : '')
      + (canDel ? '<button class="ig-act danger" data-act="del">' + icon('trash-2', 'ico-xs') + '删除</button>' : '');
    return '<div class="ig-card" data-ig-task="' + esc(t.id) + '">'
      + media
      + '<div class="ig-card-info">'
      +   '<div class="ig-card-prompt ig-card-prompt-copy" data-ig-copy="' + esc(t.id) + '" title="点击复制完整提示词">' + esc((t.prompt || '').slice(0, 60)) + ((t.prompt || '').length > 60 ? '…' : '') + '</div>'
      +   '<div class="ig-card-meta">#' + esc(t.id.slice(0, 8)) + (model ? ' · ' + esc(model.name) : '')
      +     (t.params ? ' · ' + esc([t.params.aspect_ratio,
              t.params.resolution ? String(t.params.resolution).toUpperCase() : '',
              t.params.size].filter(Boolean).join(' · ')) : '')
      +     (t.params && t.params.count > 1 ? ' · ' + t.params.count + ' 张' : '')
      +     (refCount ? ' · 参考 ' + refCount + ' 张' + (refCount > 1 ? '(合成)' : '') : '')
      +     ' · ' + fmtTime(t.created_at) + '</div>'
      +   '<div class="ig-card-foot">' + statusBadge(t.status) + '<div class="ig-acts">' + actions + '</div></div>'
      + '</div></div>';
  },

  bindTaskCard(cardEl) {
    const tid = cardEl.dataset.igTask;
    /* 成果图点击 → 统一查看器(整卡与放大镜都可点，翻页浏览本任务全部图片) */
    cardEl.querySelectorAll('[data-ig-view]').forEach(n => n.addEventListener('click', e => {
      e.stopPropagation();
      this.openTaskImages(n.dataset.igView, n.dataset.igAsset);
    }));
    /* 提示词点击 → 复制 */
    const copyBtn = cardEl.querySelector('[data-ig-copy]');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const t = this.state.tasks.find(x => x.id === tid);
      const p = (t && t.prompt) || '';
      if (!p) return;
      try { await navigator.clipboard.writeText(p); toast('提示词已复制', 'ok'); }
      catch (e) { toast(p.slice(0, 120), 'info', 6000); }
    });
    cardEl.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      try {
        if (act === 'retry') { await API.post('/tasks/' + tid + '/retry'); toast('已重新排队', 'ok'); }
        else if (act === 'again') {
          btn.disabled = true;
          await API.post('/tasks/' + tid + '/regenerate');
          toast('已按相同参数重新提交生成(新任务)', 'ok');
        }
        else if (act === 'cancel') { await API.post('/tasks/' + tid + '/cancel'); toast('已取消', 'ok'); }
        else if (act === 'del') {
          if (!(await confirmDlg('确认删除该条生图记录？已存入资产库的图片不受影响。'))) return;
          await API.del('/tasks/' + tid); toast('记录已删除', 'ok');
        }
        await this.refreshTasks();
        this.renderResults(this.root, false);
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    }));
  },

  /* ---------- 轮询(有进行中任务时每 3s 刷新，签名比对避免闪烁) ---------- */
  startPolling(root) {
    this.stopPolling();
    this.state.timer = setInterval(async () => {
      const st = this.state;
      if (!st.tasks.some(t => ['queued', 'processing'].includes(t.status))) return;
      await this.refreshTasks();
      const sig = st.tasks.map(t => t.id + ':' + t.status + ':' + t.progress).join('|');
      if (sig !== st.sig) { st.sig = sig; this.renderResults(this.root, true); }
    }, 3000);
  },
  stopPolling() { if (this.state.timer) { clearInterval(this.state.timer); this.state.timer = null; } },

  async refreshTasks() {
    try {
      const res = await API.get('/tasks?status=all');
      this.state.tasks = (res.items || []).filter(t => t.type === 'text-to-image');
    } catch (e) { /* 静默 */ }
  },

  /* 供分镜工作台快速生图复用 */
  root: null
};
