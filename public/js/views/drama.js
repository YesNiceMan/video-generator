'use strict';
/* 短剧工作流(第五十轮 · 需求三十)
 * 五个阶段一条链:剧本 → 角色·场景 → 分镜 → 全局提示词 → 下发。
 * 页只做「读状态 + 发意图」,分段、扣费、组装、回写全在服务端;
 * 生成进度不建第二套状态 —— 分镜卡上的角标来自 /api/drama/:id 里那份 tasks 实况。
 */
const DramaView = {
  STAGES: [
    { key: 'script', label: '剧本', icon: 'scroll-text', hint: '贴剧本 · 选画风 · 跑分析' },
    { key: 'entities', label: '角色·场景', icon: 'users', hint: '设定卡与生图底稿' },
    { key: 'shots', label: '分镜', icon: 'clapperboard', hint: '逐镜双提示词与状态延续' },
    { key: 'prompts', label: '全局提示词', icon: 'palette', hint: '画风 × 槽位矩阵' },
    { key: 'dispatch', label: '下发', icon: 'workflow', hint: '批量出图出片与进度' }
  ],

  state: null,

  /* ---------- 入口 ---------- */
  async render(root, params) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    this.state = {
      root: root,
      id: params && params.id ? String(params.id) : '',
      stage: (params && params.stage) || 'script',
      list: [], opts: null, drama: null, entities: [], shots: [], episodes: [], tasks: [],
      presets: [], presetStyles: {}, sel: new Set(), ep: null, kind: 'all', q: '',
      polling: null, sig: '', dirty: false, saveTimer: null, saveState: 'idle',
      importing: false, analyzing: false
    };
    try {
      this.state.opts = await API.get('/drama/options');
      await CreditCenter.refresh().catch(() => { });
      if (this.state.id) await this.loadDrama();
      else await this.loadList();
      this.paint();
    } catch (e) {
      /* 任何一步失败都要落地成可读的空态,而不是把用户留在转圈里 */
      root.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('triangle-alert') + '</div><h3>' + esc(e.message) + '</h3></div>';
      return;
    }
    return () => this.teardown();
  },

  teardown() {
    this.stopPolling();
    if (this.state && this.state.saveTimer) { clearTimeout(this.state.saveTimer); this.state.saveTimer = null; }
    document.body.classList.remove('page-fill');
  },

  async loadList() {
    const res = await API.get('/drama');
    this.state.list = res.items || [];
  },

  async loadDrama() {
    const s = this.state;
    const ep = s.ep === null ? '' : ('&episode_no=' + s.ep);
    const res = await API.get('/drama/' + s.id + '?limit=400' + (s.stage === 'shots' ? ep : ''));
    s.drama = res.drama;
    s.entities = res.entities || [];
    s.shots = res.shots || [];
    s.shotsTotal = res.shots_total || 0;
    s.episodes = res.episodes || [];
    s.tasks = res.tasks || [];
    s.readiness = res.readiness || {};
    if (s.stage === 'prompts' || !s.presets.length) await this.loadPresets();
    /* 关联体检:只在「卡/分镜」阶段取一次摘要,用来在按钮上标异常数 */
    if (s.stage === 'entities' || s.stage === 'shots') {
      try { s.diag = await API.get('/drama/' + s.id + '/diagnose'); } catch (e) { s.diag = null; }
    }
    /* 分镜页要按集加载:第一趟还不知道有哪些集,拿到 episodes 后再补一次带筛选的请求,
       否则筛选计数和「全选本集」都会按整部剧(含 400 条上限)算 */
    if (s.stage === 'shots' && s.ep === null && s.episodes.length) {
      s.ep = s.episodes[0].episode_no;
      const r2 = await API.get('/drama/' + s.id + '?limit=400&episode_no=' + s.ep);
      s.shots = r2.shots || [];
      s.shotsTotal = r2.shots_total || 0;
      s.episodes = r2.episodes || s.episodes;
      s.readiness = r2.readiness || s.readiness;
    }
  },

  async loadPresets() {
    const res = await API.get('/drama/presets');
    this.state.presets = res.items || [];
    this.state.presetStyles = res.byStyle || {};
  },

  /* ---------- 整页绘制 ---------- */
  paint() {
    const s = this.state;
    if (!s.id) return this.paintList();
    if (!s.drama) {
      s.root.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('circle-alert') + '</div><h3>这部剧不存在或已删除</h3></div>';
      return;
    }
    document.body.classList.add('page-fill');
    s.root.innerHTML = this.shellHTML();
    this.renderRail();
    this.renderStage();
    this.startPolling();
  },

  shellHTML() {
    return '<div class="dw">'
      + '<aside class="dw-rail" id="dwRail"></aside>'
      + '<section class="dw-main" id="dwMain"></section>'
      + '</div>';
  },

  /* ---------- 左栏:阶段导航 + 跑批进度 ---------- */
  /* 每阶段的「就绪 / 待做」:读服务端 readiness,页面各处不再各算一套 */
  stageStatus() {
    const s = this.state, r = s.readiness || {};
    const sc = r.script || {}, en = r.entities || {}, sh = r.shots || {};
    return {
      script: sc.chars ? (sc.analyzed ? 'ok' : 'todo') : 'todo',
      entities: en.total ? (en.with_image >= en.total ? 'ok' : 'part') : 'todo',
      shots: sh.total ? (sh.with_image >= sh.total ? 'ok' : (sh.with_image ? 'part' : 'todo')) : 'todo',
      prompts: s.drama.style ? (s.presets.some(p => p.enabled && p.slot === '视频') ? 'ok' : 'part') : 'todo',
      dispatch: (sh.with_video || 0) > 0 ? 'ok' : ((sh.with_image || 0) > 0 ? 'part' : 'todo')
    };
  },

  renderRail() {
    const s = this.state, d = s.drama;
    const stats = d.stats || {};
    const run = d.status === 'analyzing';
    const st8 = this.stageStatus();
    const box = s.root.querySelector('#dwRail');
    const html = '<a class="dw-back" href="#/workflow">' + icon('chevron-left') + '<span>我的短剧</span></a>'
      + '<div class="dw-rail-head"><div class="dw-name">' + esc(d.title) + '</div>'
      + '<div class="dw-sub">' + esc(d.style || '未选画风') + ' · ' + (stats.shots || 0) + ' 镜 / ' + (stats.episodes || 0) + ' 集</div>'
      + '<div class="dw-sub dim">' + esc(d.aspect_ratio || '16:9') + ' · ' + esc(d.video_resolution || '720p') + ' · ' + (Number(d.fps) || 24) + 'fps · 单镜 ' + (Number(d.shot_duration) || 10) + 's</div></div>'
      + '<nav class="dw-stages">' + this.STAGES.map(st => {
        const n = st.key === 'entities' ? (stats.entities || 0) : st.key === 'shots' ? (stats.shots || 0)
          : st.key === 'prompts' ? (s.presets || []).length : st.key === 'dispatch' ? s.tasks.filter(t => t.status === 'completed').length : 0;
        const flag = st8[st.key] || 'todo';
        return '<a class="dw-stage' + (s.stage === st.key ? ' active' : '') + '" href="#/workflow/' + s.id + '/' + st.key + '" data-stage="' + st.key + '" data-flag="' + flag + '">'
          + icon(st.icon) + '<span class="dw-stage-label">' + esc(st.label)
          + '<i class="dw-stage-dot" title="' + ({ ok: '已完成', part: '部分完成', todo: '待做' }[flag]) + '"></i></span>'
          + '<span class="dw-stage-hint">' + esc(st.hint) + '</span>'
          + (n ? '<span class="dw-stage-n">' + n + '</span>' : '') + '</a>';
      }).join('') + '</nav>'
      + '<div class="dw-rail-foot">'
      + (run || d.progress > 0 && d.status !== 'draft' ? '<div class="dw-prog" data-run="' + (run ? 1 : 0) + '">'
        + '<div class="dw-prog-top"><span>' + esc(d.stage || (d.status === 'failed' ? '已中断' : '空闲')) + '</span><b class="gold-num">' + (d.progress || 0) + '%</b></div>'
        + '<div class="dw-prog-bar"><i style="width:' + (d.progress || 0) + '%"></i></div>'
        + (d.error ? '<div class="dw-prog-err">' + esc(errBrief(d.error, 120)) + '</div>' : '')
        + '</div>' : '')
      + '<div class="dw-balance">' + icon('coins') + '<span>积分 <b id="dwBal">' + CreditCenter.cache.balance + '</b></span>'
      + (s.opts ? '<span class="dw-free">文本模型 ' + esc(this.textModelLabel()) + '</span>' : '') + '</div>'
      + '</div>';
    /* 内容没变就别碰 DOM:轮询时侧栏不闪、也不打断点击 */
    if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; this.bindShell(); }
  },

  textModelLabel() {
    const o = this.state.opts;
    const id = (this.state.drama && this.state.drama.text_model_id) || o.defaultTextModel || (o.textModels[0] && o.textModels[0].id) || '';
    const m = o.textModels.find(x => x.id === id);
    return m ? m.name + (m.is_free ? '(免费)' : ' ' + m.price_per_call + '分/段') : '未绑定';
  },

  bindShell() {
    const s = this.state;
    s.root.querySelectorAll('#dwRail [data-stage]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const key = a.dataset.stage;
      if (key === s.stage) return;
      s.stage = key; s.sel.clear(); s.ep = key === 'shots' ? (s.ep !== null ? s.ep : (s.episodes[0] ? s.episodes[0].episode_no : 0)) : null;
      location.hash = '#/workflow/' + s.id + '/' + key;
      this.reload();
    }));
  },

  /* 所有写操作之后统一走这里:重取 + 重绘,避免各处漏 paint */
  async reload() {
    try { await this.loadDrama(); } catch (e) { toast(e.message, 'err'); return; }
    this.paint();
  },

  /* ---------- 列表页 ---------- */
  paintList() {
    const s = this.state, o = s.opts;
    document.body.classList.remove('page-fill');
    const dir = o.sampleDir;
    s.root.innerHTML = '<div class="page-head"><div class="page-head-main">'
      + '<span class="page-eyebrow">' + icon('scroll-text') + '短剧工作流</span>'
      + '<h1 class="page-title">从一部剧本,走到一批成片</h1>'
      + '<p class="page-sub">分析人物与场景卡 → 逐镜拆出图片/视频提示词 → 用全局画风组装 → 批量下发到生图与图生视频</p>'
      + '</div><div class="page-actions">'
      + '<button class="btn" id="dwImport">' + icon('upload') + '<span>导入文件</span></button>'
      + '<button class="btn btn-primary" id="dwNew">' + icon('plus') + '<span>新建工作流</span></button>'
      + '</div></div>'
      + (dir.exists ? '<div class="dw-tip">' + icon('folder-open') + '<span>参考数据目录 <code>' + esc(dir.path) + '</code> 有 ' + dir.files.length + ' 份文件</span>'
        + '<button class="btn btn-xs" id="dwSamples">' + icon('sparkles') + '<span>一键导入参考成品</span></button></div>'
        : '<div class="dw-tip dim">' + icon('folder-open') + '<span>参考数据目录不存在(' + esc(dir.path) + '),可直接上传 docx / xlsx / txt</span></div>')
      + '<div class="grid grid-cards" id="dwList"></div>';
    this.renderListGrid();
    s.root.querySelector('#dwNew').addEventListener('click', () => this.createDrama());
    s.root.querySelector('#dwImport').addEventListener('click', () => this.pickAndImport());
    const sb = s.root.querySelector('#dwSamples');
    if (sb) sb.addEventListener('click', () => this.importSamples(sb));
  },

  renderListGrid() {
    const s = this.state, box = s.root.querySelector('#dwList');
    if (!box) return;
    if (!s.list.length) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-ico">' + icon('clapperboard') + '</div>'
        + '<h3>还没有短剧工作流</h3><p>新建一部并贴入剧本,或用「导入文件」上传 剧本.docx / 分析-分镜.xlsx</p></div>';
      return;
    }
    box.innerHTML = s.list.map(d => {
      const st = d.stats || {};
      const badge = { draft: 'status-queued', analyzing: 'status-processing', review: 'status-completed', ready: 'status-completed', failed: 'status-failed', cancelled: 'status-cancelled' }[d.status] || 'status-queued';
      return '<a class="media-card dw-drama-card" href="#/workflow/' + d.id + '/script">'
        + '<div class="dw-drama-cover">' + icon('film') + '<span class="dw-drama-badge status ' + badge + '">' + esc(this.statusLabel(d)) + '</span></div>'
        + '<div class="dw-drama-body"><div class="dw-drama-title clamp-1">' + esc(d.title) + '</div>'
        + '<div class="dw-drama-meta">' + (st.entities || 0) + ' 张卡 · ' + (st.shots || 0) + ' 镜 · ' + (st.episodes || 0) + ' 集</div>'
        + '<div class="dw-drama-meta dim">' + icon('palette') + ' ' + esc(d.style || '未选画风') + ' · ' + ((d.script_chars || 0) / 10000).toFixed(1) + ' 万字'
        + (d.done_episodes && d.done_episodes.length ? ' · 已分析 ' + d.done_episodes.length + ' 段' : '') + '</div>'
        + '<div class="dw-drama-ops"><span class="btn btn-xs" data-edit-drama="' + d.id + '">' + icon('pen-line') + '重命名</span>'
        + '<span class="btn btn-xs danger" data-del-drama="' + d.id + '">' + icon('trash-2') + '</span></div>'
        + '</div></a>';
    }).join('');
    box.querySelectorAll('[data-edit-drama]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      const d = s.list.find(x => x.id === b.dataset.editDrama);
      const v = await formModal({ title: '重命名工作流', fields: [{ key: 'title', label: '标题', value: d.title }], onSubmit: async val => { await API.patch('/drama/' + d.id, { title: val.title }); } });
      if (v) { await this.loadList(); this.paintList(); }
    }));
    box.querySelectorAll('[data-del-drama]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      const d = s.list.find(x => x.id === b.dataset.delDrama);
      if (!await confirmDlg('删除《' + d.title + '》及其角色卡、分镜?已生成的资产会保留在资产库。', { danger: true, okText: '删除' })) return;
      try { await API.del('/drama/' + d.id); toast('已删除', 'ok'); await this.loadList(); this.paintList(); } catch (err) { toast(err.message, 'err'); }
    }));
  },

  statusLabel(d) {
    if (d.status === 'analyzing') return '分析中 ' + (d.progress || 0) + '%';
    return { draft: '待分析', review: '待复核', ready: '已就绪', failed: '分析中断', cancelled: '已停止' }[d.status] || d.status;
  },

  /* ---------- 新建 / 导入 ---------- */
  async createDrama(preset) {
    const s = this.state, o = s.opts;
    const fields = [
      { key: 'title', label: '剧名', value: (preset && preset.title) || '', placeholder: '例如:万古仙族' },
      { key: 'brief', label: '全片设定(喂给模型的背景)', type: 'textarea', value: (preset && preset.brief) || '', placeholder: '世界/居所/人物关系/注意事项,越具体越不容易跑偏' },
      { key: 'style', label: '画风', type: 'select', value: (o.styles[0] && o.styles[0].name) || '', options: [{ value: '', label: '(暂不选)' }].concat(o.styles.map(x => ({ value: x.name, label: x.name + '(' + x.enabled + '/' + x.rows + ' 槽位)' }))) },
      { key: 'text_model_id', label: '分析用文本模型', type: 'select', value: o.defaultTextModel || '', options: o.textModels.map(m => ({ value: m.id, label: m.name + (m.is_free ? '(免费)' : ' ' + m.price_per_call + '分/段') + (m.has_key ? '' : ' · 未配 Key') })) },
      { key: 'script', label: '剧本原文', type: 'textarea', value: (preset && preset.script) || '', placeholder: '可直接粘贴;分集标记「===== 第1集 =====」会自动切段' }
    ];
    const v = await formModal({
      title: '新建短剧工作流', fields, size: 'modal-lg', submitText: '创建并开始',
      onSubmit: async val => {
        const r = await API.post('/drama', { title: val.title, brief: val.brief, style: val.style, text_model_id: val.text_model_id, script: val.script });
        location.hash = '#/workflow/' + r.drama.id + '/script';
        setTimeout(() => this.reload(), 60);
      }
    });
    return v;
  },

  /* 上传 → /parse 识别 → /import 落库(服务端暂存解析结果,不重复上传) */
  pickAndImport(targetDramaId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.docx,.xlsx,.csv,.txt,.md';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      this.state.importing = true;
      toast('正在解析 ' + f.name + '…');
      try {
        const p = await uploadFile('/drama/parse', f);
        const label = { script: '剧本', entities: '人物/场景卡', shots: '分镜表', styles: '全局提示词' }[p.kind] || p.kind;
        const counts = p.counts || {};
        const n = (counts.chars || 0) + (counts.entities || 0) + (counts.shots || 0) + (counts.styles || 0);
        const okKind = await confirmDlg('识别为「' + label + '」:'
          + (counts.chars ? counts.chars + ' 字 · ' : '')
          + (counts.entities ? counts.entities + ' 张卡 · ' : '')
          + (counts.shots ? counts.shots + ' 镜 · ' : '')
          + (counts.styles ? counts.styles + ' 条画风 · ' : '')
          + '确认导入到' + (targetDramaId ? '当前这部剧' : '新建的工作流') + '?', { title: '解析结果', danger: false, okText: '导入' });
        if (!okKind) return;
        const imp = await API.post('/drama/import', { token: p.token, kind: p.kind, drama_id: targetDramaId || undefined, title: f.name.replace(/\.[^.]+$/, '') });
        toast('导入完成:' + (imp.script_chars ? imp.script_chars + ' 字剧本' : '') + (imp.entities ? ' · ' + imp.entities + ' 张卡' : '') + (imp.shots ? ' · ' + imp.shots + ' 镜' : '') + (imp.added ? ' · ' + imp.added + ' 条画风' : ''), 'ok');
        if (p.kind === 'styles' && !targetDramaId) { location.hash = '#/workflow'; await this.loadList(); this.paint(); return; }
        if (targetDramaId) { await this.reload(); return; }
        location.hash = '#/workflow/' + imp.drama_id + '/' + (p.kind === 'entities' ? 'entities' : p.kind === 'shots' ? 'shots' : 'script');
        setTimeout(() => this.reload(), 60);
      } catch (e) { toast(e.message, 'err'); }
      this.state.importing = false;
    });
    inp.click();
  },

  async importSamples(btn) {
    btn.disabled = true;
    try {
      const r = await API.post('/drama/samples', {});
      toast('参考成品已导入:' + r.entities + ' 张卡 · ' + r.shots + ' 镜 · ' + r.script_chars + ' 字', 'ok');
      location.hash = '#/workflow/' + r.drama_id + '/entities';
      setTimeout(() => this.reload(), 60);
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  },

  /* ---------- 阶段路由 ---------- */
  renderStage() {
    const s = this.state;
    const box = s.root.querySelector('#dwMain');
    if (s.stage === 'entities') return this.stageEntities(box);
    if (s.stage === 'shots') return this.stageShots(box);
    if (s.stage === 'prompts') return this.stagePrompts(box);
    if (s.stage === 'dispatch') return this.stageDispatch(box);
    return this.stageScript(box);
  },

  headHTML(eyebrow, title, sub, actions) {
    return '<div class="page-head"><div class="page-head-main">'
      + '<span class="page-eyebrow">' + icon('workflow') + esc(eyebrow) + '</span>'
      + '<h1 class="page-title">' + esc(title) + '</h1>'
      + '<p class="page-sub">' + sub + '</p></div><div class="page-actions">' + actions + '</div></div>';
  },

  /* ===== 阶段 1:剧本 ===== */
  stageScript(box) {
    const s = this.state, d = s.drama, o = s.opts;
    const units = this.guessUnits(d.script || '');
    box.innerHTML = this.headHTML('阶段 1 · 剧本', d.title, '剧本越长越要分段喂;每段带上「已建立卡 + 上一镜末状态」,角色才不会演到第三集换脸。',
      '<button class="btn" id="dwUp">' + icon('upload') + '<span>上传剧本/表格</span></button>'
      + '<button class="btn btn-primary" id="dwRun"' + (d.status === 'analyzing' ? ' disabled' : '') + '>' + icon('sparkles') + '<span>' + (d.status === 'analyzing' ? '分析中…' : '开始分析') + '</span></button>')
      + '<div class="dw-grid2">'
      + '<div class="dw-col"><div class="field"><label>剧名</label><input class="input" id="dwTitle" value="' + esc(d.title) + '" maxlength="80"></div>'
      + '<div class="field"><label>全片设定(背景,喂给模型)</label><textarea class="textarea" id="dwBrief" rows="5" placeholder="例如:林家在山谷灵溪谷,不在玄天城;九位嫂子性格/容貌/发色要区分开">' + esc(d.brief || '') + '</textarea>'
      + '<div class="hint">' + (d.brief || '').length + ' 字 · 这段每轮分析都会原样带给模型</div></div>'
      + '<div class="field"><label>剧本原文</label><textarea class="textarea dw-script" id="dwScript" rows="12" placeholder="粘贴剧本;「===== 第N集 =====」会被识别成分集标记">' + esc(d.script || '') + '</textarea>'
      + '<div class="hint" id="dwScriptHint"></div></div>'
      + '<div class="dw-drop" id="dwDrop"></div></div>'
      + '<div class="dw-col"><div class="form-sect"><div class="section-title">分析参数</div>'
      + '<div class="form-row"><div class="field grow"><label>画风(组装时追加的全局提示词)</label><select class="select" id="dwStyle">'
      + '<option value="">(不追加)</option>' + o.styles.map(x => '<option value="' + esc(x.name) + '"' + (d.style === x.name ? ' selected' : '') + '>' + esc(x.name) + '(' + x.enabled + ' 个槽位启用)</option>').join('')
      + '</select></div>'
      + '<div class="field grow"><label>文本模型</label><select class="select" id="dwTextModel">'
      + (o.textModels.length ? '' : '<option value="">后台还没有文本模型</option>')
      + o.textModels.map(m => '<option value="' + m.id + '"' + ((d.text_model_id || o.defaultTextModel) === m.id ? ' selected' : '') + '>' + esc(modelOptionLabel(m)) + ' · ' + (m.is_free ? '免费' : m.price_per_call + ' 分/段') + '</option>').join('')
      + '</select></div></div>'
      + '<div class="form-row"><div class="field grow"><label>生图模型(设定图/分镜图)</label><select class="select" id="dwImageModel">'
      + o.imageModels.map(m => '<option value="' + m.id + '"' + ((d.image_model_id || o.defaults.image) === m.id ? ' selected' : '') + '>' + esc(m.name) + ' · ' + (m.is_free ? '免费' : m.price_per_image + ' 分/张') + (d.image_model_id ? '' : ' (自动)') + '</option>').join('')
      + '</select></div>'
      + '<div class="field grow"><label>视频模型(分镜出片)</label><select class="select" id="dwVideoModel">'
      + o.videoModels.map(m => '<option value="' + m.id + '"' + ((d.video_model_id || o.defaults.video) === m.id ? ' selected' : '') + '>' + esc(m.name) + (m.is_free ? ' · 免费' : '') + (d.video_model_id ? '' : ' (自动)') + '</option>').join('')
      + '</select></div></div>'
      + '<div class="field"><label>关联项目(下发任务挂到这个项目,便于导出)</label><select class="select" id="dwProject">'
      + '<option value="">(不关联)</option>' + (App.projects || []).map(p => '<option value="' + p.id + '"' + (d.project_id === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('')
      + '</select><div class="hint">换绑项目会把出片规格带成该项目的(比例/分辨率/帧率/单镜时长)</div></div></div>'
      + this.specSectionHTML(d, o)
      + '<div class="form-sect"><div class="section-title">跑批</div>'
      + '<div class="dw-runline"><span class="dw-metric">' + icon('layers') + '约 <b>' + units + '</b> 段</span>'
      + '<span class="dw-metric">' + icon('coins') + '每段 <b>' + this.textPricePer() + '</b> 分</span>'
      + '<label class="dw-check"><input type="checkbox" id="dwCover"><span>覆盖重跑(默认只跑没分析过的段)</span></label></div>'
      + '<div class="dw-runrow"><button class="btn btn-primary" id="dwRun2"' + (d.status === 'analyzing' ? ' disabled' : '') + '>' + icon('play') + '<span>' + (d.status === 'analyzing' ? '正在跑…' : '分析全部') + '</span></button>'
      + '<button class="btn hidden" id="dwStop">' + icon('x') + '<span>停止</span></button>'
      + '<select class="select dw-epick" id="dwEpPick"><option value="">只跑某一集…</option>'
      + (this.episodeNos(d.script) || []).map(n => '<option value="' + n + '">第 ' + n + ' 集</option>').join('') + '</select>'
      + '<button class="btn btn-xs" id="dwRunOne">' + icon('play') + '<span>跑这一集</span></button></div>'
      + '<div class="hint">' + (d.done_episodes && d.done_episodes.length ? '已分析 ' + d.done_episodes.length + ' 段;失败中断后可直接续跑,不重复扣费' : '一段一次调用,中断不丢已完成内容') + '</div>'
      + (d.error ? '<div class="dw-err">' + icon('triangle-alert') + '<span>' + esc(d.error) + '</span></div>' : '')
      + '</div>'
      + '<div class="form-sect"><div class="section-title">已入库内容</div>'
      + '<div class="dw-stats-row"><span class="alib-count">' + (d.stats.entities || 0) + '</span>张设定卡'
      + '<span class="alib-count">' + (d.stats.shots || 0) + '</span>个分镜'
      + '<span class="alib-count">' + (d.stats.episodes || 0) + '</span>集</div>'
      + '<div class="dw-jump"><a class="btn btn-xs" href="#/workflow/' + d.id + '/entities">' + icon('users') + '<span>看角色·场景</span></a>'
      + '<a class="btn btn-xs" href="#/workflow/' + d.id + '/shots">' + icon('clapperboard') + '<span>看分镜</span></a>'
      + '<a class="btn btn-xs" href="#/workflow/' + d.id + '/prompts">' + icon('palette') + '<span>调画风</span></a></div></div>'
      + '</div></div>';
    this.bindScript(box);
  },

  textPricePer() {
    const o = this.state.opts, d = this.state.drama;
    const m = o.textModels.find(x => x.id === (d.text_model_id || o.defaultTextModel));
    return m ? (m.is_free ? 0 : m.price_per_call) : '—';
  },

  /* 出片规格:剧级一处设定,下发时三个口径(设定图/分镜图/成片)都读它 */
  specSectionHTML(d, o) {
    const sp = o.specOptions || {};
    const ratios = sp.ratios || ['16:9'];
    const tiers = sp.imageTiers || ['1K', '2K', '4K'];
    const vres = sp.videoResolutions || ['720p'];
    const fpsList = sp.fps || [24];
    const opt = (v, cur, label) => '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(label == null ? String(v) : label) + '</option>';
    return '<div class="form-sect"><div class="section-title">出片规格<span class="hint">剧级默认;单镜可覆盖时长 / 帧率 / 视频分辨率</span></div>'
      + '<div class="dw-spec-row"><div class="field"><label>画幅比例</label><select class="select" id="dwRatio">'
      + ratios.map(v => opt(v, d.aspect_ratio || '16:9')).join('') + '</select></div>'
      + '<div class="field"><label>图片分辨率</label><select class="select" id="dwImgRes">'
      + tiers.map(v => opt(v, d.image_resolution || tiers[0])).join('') + '</select></div>'
      + '<div class="field"><label>视频分辨率(成片)</label><select class="select" id="dwVidRes">'
      + vres.map(v => opt(v, d.video_resolution || vres[0], v.toUpperCase() + ' · ' + videoWH(v, d.aspect_ratio || '16:9').w + '×' + videoWH(v, d.aspect_ratio || '16:9').h)).join('') + '</select></div></div>'
      + '<div class="dw-spec-row"><div class="field"><label>帧率</label><select class="select" id="dwFps">'
      + fpsList.map(v => opt(v, d.fps || 24)).join('') + '</select></div>'
      + '<div class="field"><label>单镜时长(秒)</label><input type="number" class="input" id="dwShotDur" min="3" max="25" step="1" value="' + (d.shot_duration || 10) + '">'
      + '<div class="hint">新补的分镜按这个时长建;已有分镜在阶段 3 各自改</div></div></div>'
      + '<div class="dw-spec-hint" id="dwSpecHint"></div></div>';
  },

  updateSpecHint() {
    const b = this.root.querySelector('#dwSpecHint');
    if (!b) return;
    const ratio = (this.root.querySelector('#dwRatio') || {}).value || '16:9';
    const imgRes = (this.root.querySelector('#dwImgRes') || {}).value || '1K';
    const vidRes = (this.root.querySelector('#dwVidRes') || {}).value || '720p';
    const img = imgSizeFrom(ratio, imgRes);
    const vid = videoWH(vidRes, ratio);
    const fps = (this.root.querySelector('#dwFps') || {}).value || '24';
    b.innerHTML = icon('frame') + '<span>设定图/分镜图 <b>' + img.w + '×' + img.h + '</b>'
      + ' · 成片 <b>' + vid.w + '×' + vid.h + '</b> @ ' + esc(fps) + 'fps'
      + ' · 比例 <b>' + esc(ratio) + '</b></span>';
  },

  episodeNos(script) {
    if (!script) return [];
    const set = [];
    String(script).split('\n').forEach(l => {
      const m = /^={0,12}\s*[-—·]?\s*第\s*([0-9０-９]{1,4})\s*[集话話]/.exec(l.trim());
      if (m && !set.includes(Number(m[1]))) set.push(Number(m[1]));
    });
    return set;
  },

  /* 前端只做粗估(服务端按模型 max_chars 精切),目的是让用户点之前知道要跑多少段 */
  guessUnits(script) {
    if (!script) return 0;
    const o = this.state.opts;
    const m = o.textModels.find(x => x.id === (this.state.drama.text_model_id || o.defaultTextModel));
    const limit = Math.max(1200, (m ? m.max_chars : 20000) - 3600);
    const lines = String(script).split('\n');
    const marks = [];
    lines.forEach((l, i) => { if (/^={0,12}\s*[-—·]?\s*第\s*[0-9零一二三四五六七八九十百]{1,5}\s*[集话話]/.test(l.trim())) marks.push(i); });
    if (!marks.length) return Math.max(1, Math.ceil(script.length / limit));
    let n = marks[0] > 0 ? 1 : 0;
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1] : lines.length;
      const len = lines.slice(marks[i], end).join('\n').length;
      n += Math.max(1, Math.ceil(len / limit));
    }
    return n;
  },

  bindScript(box) {
    const s = this.state, d = s.drama;
    const hint = () => {
      const t = box.querySelector('#dwScript').value;
      box.querySelector('#dwScriptHint').textContent = t.length.toLocaleString() + ' 字 · 约 ' + this.guessUnits(t) + ' 段待分析'
        + (t && !/第\s*[0-9一二三四五六七八九十]+\s*集/.test(t) ? ' · 没找到分集标记,将按字数切段' : '');
    };
    hint();
    const save = async (patch, quiet) => {
      try { await API.patch('/drama/' + d.id, patch); if (!quiet) toast('已保存', 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
    /* 剧本正文很长,失焦再存;顶栏切页前 flush 一次 */
    const ta = box.querySelector('#dwScript');
    ta.addEventListener('input', hint);
    ta.addEventListener('blur', () => { if (ta.value !== (d.script || '')) save({ script: ta.value }, true); });
    box.querySelector('#dwTitle').addEventListener('change', e => save({ title: e.target.value }).then(() => this.renderRail()));
    box.querySelector('#dwBrief').addEventListener('blur', e => save({ brief: e.target.value }, true));
    /* 下拉改了立刻落库;画风切换会同时影响所有「组装」结果 */
    [[ '#dwStyle', 'style' ], ['#dwTextModel', 'text_model_id'], ['#dwImageModel', 'image_model_id'],
      ['#dwVideoModel', 'video_model_id']].forEach(([id, field]) => {
      const ctl = box.querySelector(id);
      if (ctl) ctl.addEventListener('change', e => save({ [field]: e.target.value }, true));
    });
    /* 换绑项目:服务端会把规格继承成新项目的,所以要重取一次再重绘,否则页面还显示旧值 */
    const proj = box.querySelector('#dwProject');
    if (proj) proj.addEventListener('change', async e => {
      try { await API.patch('/drama/' + d.id, { project_id: e.target.value }); await this.reload(); toast('已按项目规格对齐', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
    });
    /* 出片规格:改完即存,并同步右侧的宽高换算 */
    [['#dwRatio', 'aspect_ratio', String], ['#dwImgRes', 'image_resolution', String],
      ['#dwVidRes', 'video_resolution', String], ['#dwFps', 'fps', Number], ['#dwShotDur', 'shot_duration', Number]].forEach(([id, field, cast]) => {
      const ctl = box.querySelector(id);
      if (!ctl) return;
      ctl.addEventListener('change', () => {
        const v = cast === Number ? Number(ctl.value) : ctl.value;
        this.updateSpecHint();
        save({ [field]: v }, true);
      });
    });
    this.updateSpecHint();
    box.querySelector('#dwUp').addEventListener('click', () => this.pickAndImport(d.id));
    box.querySelector('#dwDrop') && this.mountDropzone(box.querySelector('#dwDrop'));
    const run = () => this.analyze({ cover: box.querySelector('#dwCover').checked ? true : false });
    box.querySelector('#dwRun').addEventListener('click', run);
    box.querySelector('#dwRun2').addEventListener('click', run);
    box.querySelector('#dwRunOne').addEventListener('click', () => {
      const v = box.querySelector('#dwEpPick').value;
      if (v === '') return toast('先在下拉里选择要跑的集', 'err');
      this.analyze({ episode_nos: [Number(v)], cover: true });
    });
    box.querySelector('#dwStop').addEventListener('click', () => this.stopAnalyze());
    box.querySelector('#dwStop').classList.toggle('hidden', d.status !== 'analyzing');
  },

  mountDropzone(host) {
    const self = this;
    const dz = makeDropzone({
      text: '把 剧本.docx / 分析-人物场景.xlsx / 分析-分镜.xlsx / 各种全局提示词.docx 拖进来',
      multiple: false,
      onFiles: files => { if (files[0]) self.pickAndImportDirect(files[0]); }
    });
    host.appendChild(dz);
  },

  async pickAndImportDirect(f) {
    const s = this.state;
    toast('正在解析 ' + f.name + '…');
    try {
      const p = await uploadFile('/drama/parse', f);
      const imp = await API.post('/drama/import', { token: p.token, kind: p.kind, drama_id: s.id, replace: p.kind === 'script' ? 1 : 0 });
      toast('已导入:' + (p.kind === 'script' ? imp.script_chars + ' 字' : p.kind === 'entities' ? imp.entities + ' 张卡' : p.kind === 'shots' ? imp.shots + ' 镜' : imp.added + ' 条画风'), 'ok');
      await this.reload();
    } catch (e) { toast(e.message, 'err'); }
  },

  async analyze(extra) {
    const s = this.state;
    try {
      const r = await API.post('/drama/' + s.id + '/analyze', Object.assign({ maxUnits: 40 }, extra || {}));
      toast('开始分析 ' + r.total + ' 段(还剩 ' + r.remaining + ' 段),模型 ' + r.model.name, 'ok');
      await this.reload();
    } catch (e) { toast(e.message, 'err'); }
  },

  async stopAnalyze() {
    try { await API.post('/drama/' + this.state.id + '/analyze/stop', {}); toast('已请求停止,当前段跑完即止'); } catch (e) { toast(e.message, 'err'); }
  },

  /* ===== 阶段 2:角色·场景 ===== */
  stageEntities(box) {
    const s = this.state;
    const kinds = [['all', '全部'], ['character', '人物'], ['scene', '场景'], ['prop', '道具']];
    const cnt = k => k === 'all' ? s.entities.length : s.entities.filter(e => e.kind === k).length;
    box.innerHTML = this.headHTML('阶段 2 · 设定卡', '角色·场景', '卡名是身份锚(「林平生（青年·通用）」这种全名),分镜引用必须逐字一致;底稿只写长相,画风在阶段 4 统一追加。',
      '<button class="btn" id="dwEntAdd">' + icon('plus') + '<span>新建卡</span></button>'
      + this.repairBtnHTML()
      + '<button class="btn btn-primary" id="dwEntGen">' + icon('image-plus') + '<span>生成选中的设定图</span></button>')
      + '<div class="filters"><div class="cat-chips" id="dwKindChips">'
      + kinds.map(([k, l]) => '<button class="cat-chip' + (s.kind === k ? ' on' : '') + '" data-kind="' + k + '">' + esc(l) + '<span class="chip-n">' + cnt(k) + '</span></button>').join('')
      + '</div><div class="search-box grow"><input class="input" id="dwEntQ" placeholder="搜索卡名 / 提示词" value="' + esc(s.q) + '"></div>'
      + '<div class="filters-divider"></div><span class="hint">勾选后批量出图;已有图的卡会自动当成分镜参考图</span></div>'
      + '<div class="grid grid-cards dw-ent-grid" id="dwEntGrid"></div>'
      + '<div class="ast-batchbar hidden" id="dwEntBatch"></div>';
    const rp = box.querySelector('#dwRepair');
    if (rp) rp.addEventListener('click', () => this.openRepair());
    box.querySelector('#dwEntAdd').addEventListener('click', () => this.editEntity(null));
    box.querySelector('#dwEntGen').addEventListener('click', () => {
      /* 有勾选就只发勾选的;一张都没勾才按当前筛选结果下发,并把范围说清楚 */
      const ids = s.sel.size ? [...s.sel] : this.visibleEntities().map(e => e.id);
      if (!ids.length) return toast('没有可生成的设定卡', 'err');
      if (!s.sel.size) toast('未勾选,按当前筛选的 ' + ids.length + ' 张下发');
      this.dispatchEntities(ids);
    });
    box.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { s.kind = b.dataset.kind; this.renderEntGrid(); this.syncChips(); }));
    let t = null;
    box.querySelector('#dwEntQ').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { s.q = e.target.value; this.renderEntGrid(); }, 280); });
    this.renderEntGrid();
  },

  syncChips() {
    this.root.querySelectorAll('#dwKindChips .cat-chip').forEach(c => c.classList.toggle('on', c.dataset.kind === this.state.kind));
  },

  visibleEntities() {
    const s = this.state, q = s.q.trim().toLowerCase();
    return s.entities.filter(e => (s.kind === 'all' || e.kind === s.kind)
      && (!q || e.name.toLowerCase().includes(q) || String(e.prompt || '').toLowerCase().includes(q)));
  },

  renderEntGrid() {
    const s = this.state, box = s.root.querySelector('#dwEntGrid');
    const items = this.visibleEntities();
    if (!items.length) {
      box.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-ico">' + icon('users') + '</div><h3>没有符合的设定卡</h3><p>先在阶段 1 跑分析,或点「新建卡」手工补</p></div>';
      this.updateEntBatch();
      return;
    }
    box.innerHTML = items.map(e => {
      const sel = s.sel.has(e.id);
      const a = e.asset;
      const composed = this.composePreview(e);
      return '<div class="media-card dw-ent' + (sel ? ' sel' : '') + '" data-ent="' + e.id + '">'
        + '<div class="dw-ent-media' + (a ? ' has' : '') + '"' + (a ? ' data-preview="' + e.id + '"' : '') + '>'
        + (a ? '<img src="' + esc(a.thumb_path || ('/api/assets/' + a.id + '/file')) + '" alt="" loading="lazy">'
          : '<span class="dw-ent-ph">' + icon(e.kind === 'scene' ? 'mountain' : 'user-round') + '<em>' + esc({ character: '人物', scene: '场景', prop: '道具' }[e.kind]) + '待定稿</em></span>')
        + '<span class="asset-check' + (sel ? ' on' : '') + '" data-ent-check="' + e.id + '">' + (sel ? icon('check') : '') + '</span>'
        + (a ? '<span class="dw-ent-replace" data-ent-replace="' + e.id + '" title="替换这张定稿图(可上传)">' + icon('upload') + '</span>' : '')
        + (composed.missing ? '<span class="media-type-badge warn" title="该画风缺这个槽位的全局提示词">缺画风</span>' : '')
        + '</div>'
        + '<div class="dw-ent-body">'
        + '<div class="dw-ent-name clamp-1" title="' + esc(e.name) + '">' + esc(e.name) + '</div>'
        + '<div class="dw-ent-profile clamp-2">' + esc(e.profile || '（还没有设定说明）') + '</div>'
        + '<div class="dw-ent-prompt clamp-2">' + esc(e.prompt || '（底稿为空,下发前补上）') + '</div>'
        + '<div class="dw-ent-foot"><span class="dw-ent-count">'
          + (e.ref_count ? '在 ' + e.ref_count + ' 个分镜中引用' : '还没被分镜引用')
          + (e.asset ? '' : ' · 缺定稿图') + '</span>'
        + '<span class="table-ops"><button class="btn btn-xs" data-ent-edit="' + e.id + '">' + icon('pen-line') + '</button>'
        + (e.kind === 'character' ? '<button class="btn btn-xs" data-ent-clone="' + e.id + '" title="给这个角色加一套新造型(换装/年龄跨度)">' + icon('layers') + '</button>' : '')
        + '<button class="btn btn-xs" data-ent-gen="' + e.id + '">' + icon('image-plus') + '</button>'
        + '<button class="btn btn-xs danger" data-ent-del="' + e.id + '">' + icon('trash-2') + '</button></span></div>'
        + '</div></div>';
    }).join('');
    box.querySelectorAll('[data-ent]').forEach(c => c.addEventListener('click', ev => {
      if (ev.target.closest('[data-ent-check]')) { this.toggleEnt(c.dataset.ent); ev.preventDefault(); return; }
      /* 「替换」按钮压在缩略图上,必须先于「点图放预览」判断,否则永远只会打开大图 */
      const rep = ev.target.closest('[data-ent-replace]');
      if (rep) {
        ev.preventDefault(); ev.stopPropagation();
        const ent = s.entities.find(x => x.id === rep.dataset.entReplace);
        this.pickAndReplaceImage('entity', rep.dataset.entReplace, ent && ent.asset_id, ent && ent.kind === 'scene' ? '场景' : '角色');
        return;
      }
      if (ev.target.closest('[data-preview]')) { this.previewAsset(c.querySelector('[data-preview]').dataset.preview); return; }
      const btn = ev.target.closest('[data-ent-edit],[data-ent-gen],[data-ent-del],[data-ent-clone]');
      if (!btn) return;
      ev.preventDefault();
      if (btn.dataset.entEdit) this.editEntity(s.entities.find(x => x.id === btn.dataset.entEdit));
      else if (btn.dataset.entClone) this.cloneLook(s.entities.find(x => x.id === btn.dataset.entClone));
      else if (btn.dataset.entGen) this.dispatchEntities([btn.dataset.entGen]);
      else if (btn.dataset.entDel) this.deleteEntities([btn.dataset.entDel]);
    }));
    this.updateEntBatch();
  },

  composePreview(e) {
    const s = this.state;
    const slot = e.kind === 'scene' ? '场景图片' : e.kind === 'prop' ? '道具图片' : '人物图片';
    const rows = (s.presetStyles[s.drama.style] || []).filter(p => p.slot === slot && p.enabled);
    const fb = !rows.length && e.kind !== 'character' ? [] : rows;
    const text = fb.map(p => p.content).join('\n');
    return { appended: text ? String(text) : '', missing: !text && !!s.drama.style, slot };
  },

  toggleEnt(id) {
    const s = this.state;
    if (s.sel.has(id)) s.sel.delete(id); else s.sel.add(id);
    this.applyEntSel();
  },

  applyEntSel() {
    const s = this.state;
    s.root.querySelectorAll('[data-ent]').forEach(c => {
      const on = s.sel.has(c.dataset.ent);
      c.classList.toggle('sel', on);
      const chk = c.querySelector('[data-ent-check]');
      chk.classList.toggle('on', on);
      chk.innerHTML = on ? icon('check') : '';
    });
    this.updateEntBatch();
  },

  updateEntBatch() {
    const s = this.state, bar = s.root.querySelector('#dwEntBatch');
    if (!bar) return;
    const n = s.sel.size;
    bar.classList.toggle('hidden', !n);
    if (!n) return;
    bar.innerHTML = '<span>已选 <b class="gold-num">' + n + '</b> 张</span>'
      + '<button class="btn btn-xs" data-b="all">' + icon('check-check') + '<span>全选当前结果</span></button>'
      + '<button class="btn btn-xs" data-b="clear">' + icon('x') + '<span>清空</span></button>'
      + '<button class="btn btn-xs btn-primary" data-b="gen">' + icon('image-plus') + '<span>生成设定图</span></button>'
      + '<button class="btn btn-xs danger" data-b="del">' + icon('trash-2') + '<span>删除</span></button>';
    bar.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.b;
      if (k === 'all') { this.visibleEntities().forEach(e => s.sel.add(e.id)); this.applyEntSel(); }
      else if (k === 'clear') { s.sel.clear(); this.applyEntSel(); }
      else if (k === 'gen') this.dispatchEntities([...s.sel]);
      else if (k === 'del') this.deleteEntities([...s.sel]);
    }));
  },

  async editEntity(e) {
    const s = this.state;
    const isNew = !e;
    const base = e || { kind: 'character', name: '', age_stage: '青年', costume: '通用', profile: '', prompt: '' };
    const v = await formModal({
      title: isNew ? '新建设定卡' : '编辑 ' + base.name, size: 'modal-lg',
      fields: [
        { key: 'kind', label: '类型', type: 'select', value: base.kind, options: [{ value: 'character', label: '人物' }, { value: 'scene', label: '场景' }, { value: 'prop', label: '道具' }] },
        { key: 'name', label: '本名(人物会自动拼成「名字（年龄段·服装）」)', value: String(base.name).replace(/[（(].+[)）]\s*$/, '') },
        { key: 'age_stage', label: '年龄段', value: base.age_stage || '青年' },
        { key: 'costume', label: '服装版本', value: base.costume || '通用' },
        { key: 'profile', label: '设定说明', type: 'textarea', value: base.profile || '', placeholder: '身份、性格、居所 —— 给模型看的,不进提示词' },
        { key: 'prompt', label: '生图底稿(不含画风)', type: 'textarea', value: base.prompt || '', placeholder: '性别/年龄/身高/体型/发型/脸型/瞳孔肤色/服装面料/神态姿势 + 角色全身标准像,白底背景' }
      ],
      onSubmit: async val => {
        const body = { kind: val.kind, name: val.name.trim(), age_stage: val.age_stage.trim(), costume: val.costume.trim(), profile: val.profile, prompt: val.prompt };
        if (isNew) await API.post('/drama/' + s.id + '/entities', { items: [body] });
        else await API.patch('/drama/entities/' + e.id, body);
      }
    });
    if (v) { await this.reload(); toast('已保存', 'ok'); }
  },

  /* 体检按钮:标出「可自动修」的异常数 */
  repairBtnHTML() {
    const s = this.state;
    const sm = (s.diag && s.diag.summary) || null;
    const n = sm ? (sm.missing + sm.stale + sm.junk + sm.variant + (sm.duplicates || 0)) : 0;
    return '<button class="btn" id="dwRepair" title="检查引用名与图片是否对得上">' + icon('scan') + '<span>修复关联</span>'
      + (n ? '<span class="dw-badge-warn">' + n + '</span>' : '') + '</button>';
  },

  async openRepair() {
    const s = this.state;
    let dg;
    try { dg = await API.get('/drama/' + s.id + '/diagnose'); } catch (e) { return toast(e.message, 'err'); }
    s.diag = dg;
    const sm = dg.summary || {};
    const body = el('<div class="dw-repair"></div>');
    const sect = (title, hint, rows, cls, total) => rows.length
      ? '<div class="dw-repair-sect ' + (cls || '') + '"><div class="dw-repair-title">' + esc(title) + '<em>' + (total || rows.length) + '</em></div>'
        + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + rows.join('')
        + (total > rows.length ? '<div class="hint">以下只列前 ' + rows.length + ' 条,修复会处理全部</div>' : '') + '</div>'
      : '';
    const row = (left, right) => '<div class="dw-repair-row"><span>' + left + '</span><em>' + esc(right) + '</em></div>';
    const kindLabel = k => (k === 'scene' ? '场景' : '人物');
    const nothing = !sm.missing && !sm.stale && !sm.variant && !sm.no_asset && !sm.junk && !sm.duplicates;
    body.innerHTML =
      (nothing ? '<div class="empty" style="padding:18px"><div class="empty-ico">' + icon('circle-check') + '</div><h3>没有问题</h3><p>引用名都能对上卡,卡也都有定稿图</p></div>' : '')
      + sect('引用里混进了「无 / 暂无」这类噪声', '会直接从分镜引用里删掉',
        dg.junk.map(j => row(esc(j.name), kindLabel(j.kind) + ' · ' + j.shots + ' 镜')), '', dg.junk.length)
      + sect('引用名找不到对应的卡', '会建卡(角色补「青年·通用」),并把分镜里的引用改成卡全名',
        dg.missing.slice(0, 30).map(m => row(esc(m.name), kindLabel(m.kind) + ' · ' + m.shots + ' 镜 · ' + m.ref_count + ' 次引用')), '', dg.missing.length)
      + sect('引用没带括号,可与现有卡对齐', '改成卡的全名,不新建卡',
        dg.stale.slice(0, 20).map(st => row(esc(st.from) + ' → <b>' + esc(st.to) + '</b>', st.label)), '', dg.stale.length)
      + sect('引用的造型与现有卡不同(老年 / 中年 这类)', '不是错别字,是另一套造型 —— 默认按引用另建一张造型卡;也可以对齐到现有卡(会共用那张定稿图)',
        dg.variant.slice(0, 20).map(v => row(esc(v.name), kindLabel(v.kind) + ' · 现有卡 ' + v.card + ' · ' + v.ref_count + ' 次引用')), 'warn', dg.variant.length)
      + (dg.variant.length ? '<div class="dw-repair-pick"><label>这类怎么处理</label><select class="select" id="dwVariantMode">'
        + '<option value="align" selected>对齐到现有卡(共用现有定稿图,不会多出重复形象)</option>'
        + '<option value="create">按引用另建造型卡(真的换装/年龄跨度才选,否则会拆出一堆重复卡)</option>'
        + '<option value="skip">暂不处理</option></select></div>' : '')
      + sect('同名卡重复(可合并)', '修复时误建的造型卡会堆在这里:合并只保留一张(优先有定稿图的),引用改到保留卡;已生成的图不删',
        (dg.duplicates || []).slice(0, 12).map(g => row(esc(g.names.join(' / ')), kindLabel(g.kind) + ' · ' + g.refs + ' 次引用 · ' + g.with_asset + ' 张有图')), 'warn', (dg.duplicates || []).length)
      + sect('同基名有多张卡、不知道该对哪张', '只报告,不动数据',
        dg.ambiguous.slice(0, 10).map(a => row(esc(a.name), a.label + ' · 候选 ' + a.candidates.join(' / '))), '', dg.ambiguous.length)
      + sect('卡在,但没有定稿图', '「提示词里有人物/场景、关联图片却是空的」多数是这个原因 —— 给这些卡出设定图就能关联上',
        dg.noAsset.slice(0, 20).map(e => row(esc(e.name), kindLabel(e.kind) + ' · 被 ' + e.ref_count + ' 镜引用')), '', dg.noAsset.length);

    const closeBtn = el('<button class="btn">关闭</button>');
    const extra = [];
    const fixCount = sm.junk + sm.missing + sm.stale + sm.variant;
    if (fixCount) {
      const fix = el('<button class="btn btn-primary">修复 ' + fixCount + ' 处引用</button>');
      fix.onclick = async () => {
        const modeEl = body.querySelector('#dwVariantMode');
        fix.disabled = true;
        try {
          const r = await API.post('/drama/' + s.id + '/repair', { variant_mode: modeEl ? modeEl.value : 'create' });
          toast('已修:删噪声 ' + r.removed + ' 镜 · 新卡 ' + r.created + ' 张 · 引用对齐 ' + r.relinked + ' 处', 'ok');
          m.close(); await this.reload();
        } catch (e) { toast(e.message, 'err'); fix.disabled = false; }
      };
      extra.push(fix);
    }
    if (sm.duplicates) {
      const mg = el('<button class="btn">合并同名卡(' + sm.duplicates + ' 组)</button>');
      mg.onclick = async () => {
        if (!await confirmDlg('把同名卡按「本名」合并:' + sm.duplicates + ' 组,每组只留一张(优先保留有定稿图的),其余卡的引用改到保留卡后删除。已生成的图片仍留在资产库。', { title: '合并同名卡', danger: true, okText: '合并' })) return;
        mg.disabled = true;
        try {
          const r = await API.post('/drama/' + s.id + '/entities/merge', {});
          toast('已合并 ' + r.groups + ' 组 · 删除 ' + r.removed + ' 张重复卡 · 改写 ' + r.relinked + ' 处引用', 'ok');
          m.close(); await this.reload();
        } catch (e) { toast(e.message, 'err'); mg.disabled = false; }
      };
      extra.push(mg);
    }
    if (sm.no_asset) {
      const gen = el('<button class="btn' + (fixCount ? '' : ' btn-primary') + '">给缺图卡生成设定图(' + Math.min(sm.no_asset, 60) + ')</button>');
      gen.onclick = () => { m.close(); this.dispatchEntities(dg.noAsset.slice(0, 60).map(e => e.id)); };
      extra.push(gen);
    }
    /* footer 必须走 openModal 参数,否则 .modal-foot 不会创建 */
    const m = openModal({ title: '关联体检与修复', body: body, size: 'modal-lg', footer: [closeBtn].concat(extra) });
    closeBtn.onclick = () => m.close();
  },

  /* 替换图片:上传本地图 或 从资产库挑;原来那张留在资产库,不删 */
  async pickAndReplaceImage(kind, id, currentId, category) {
    const body = el('<div class="dw-replace"></div>');
    body.innerHTML = '<div class="hint">上传本地图片,或从资产库挑一张。原来那张不会被删除,仍然留在资产库。</div>'
      + '<div class="dw-replace-actions">'
      + '<button class="btn btn-primary" id="dwRepUp">' + icon('upload') + '<span>上传本地图片</span></button>'
      + '<button class="btn" id="dwRepPick">' + icon('images') + '<span>从资产库选</span></button></div>';
    const m = openModal({ title: '替换图片', body: body, size: 'modal-sm' });
    const apply = async (assetId) => {
      try {
        if (kind === 'entity') await API.patch('/drama/entities/' + id, { asset_id: assetId });
        else await API.patch('/drama/shots/' + id, { image_asset_id: assetId });
        m.close();
        toast('已替换 —— 关联图片与提示词里的参考图会跟着更新', 'ok');
        await this.reload();
      } catch (e) { toast(e.message, 'err'); }
    };
    body.querySelector('#dwRepUp').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        toast('正在上传 ' + f.name + '…');
        try {
          const r = await uploadFile('/assets/upload', f, { category: category || '' });
          await apply(r.asset.id);
        } catch (e) { toast(e.message, 'err'); }
      };
      inp.click();
    };
    body.querySelector('#dwRepPick').onclick = () => {
      m.close();
      ImagesView.pickRefAssetsFor({
        multi: false,
        selected: currentId ? [currentId] : [],
        onPick: l => { if (l[0]) apply(l[0].id); }
      });
    };
  },

  /* 给已有角色加一套新造型:底稿整份带过来,只改服装与年龄段。
     默认一个角色只有一张「通用」卡 —— 多形象是显式动作,不让分析阶段自由发挥。 */
  async cloneLook(e) {
    if (!e) return;
    const s = this.state;
    const base = String(e.name).replace(/[（(].+[)）]\s*$/, '');
    const exists = s.entities.map(x => x.name);
    const v = await formModal({
      title: '给「' + base + '」加一套新形象', size: 'modal-md', submitText: '建卡',
      fields: [
        { key: 'age_stage', label: '年龄段', value: e.age_stage || '青年' },
        { key: 'costume', label: '造型名(必填)', value: '', placeholder: '婚礼服 / 素缟 / 夜行衣 / 三年后' },
        { key: 'prompt', label: '生图底稿(已带入通用形象,按新造型改服装)', type: 'textarea', value: e.prompt || '' },
        { key: 'profile', label: '设定说明', type: 'textarea', value: e.profile || '' }
      ],
      onSubmit: async val => {
        const costume = String(val.costume || '').trim();
        if (!costume) { toast('请写清是哪一套造型(会拼进卡名,如「' + base + '（青年·婚礼服）」)', 'err'); return false; }
        const name = base + '（' + (String(val.age_stage || '').trim() || '青年') + '·' + costume + '）';
        if (exists.includes(name)) { toast('「' + name + '」已经存在,换个造型名', 'err'); return false; }
        await API.post('/drama/' + s.id + '/entities', { items: [{ kind: 'character', name: base, age_stage: val.age_stage, costume, profile: val.profile, prompt: val.prompt }] });
      }
    });
    if (v) { await this.reload(); toast('新形象已建卡 —— 记得给它出定稿图,分镜才会带对脸', 'ok'); }
  },

  async deleteEntities(ids) {
    if (!await confirmDlg('删除 ' + ids.length + ' 张设定卡?分镜里对它的引用会失效,已生成的图仍留在资产库。', { danger: true, okText: '删除' })) return;
    try { await API.post('/drama/entities/batch-delete', { ids }); this.state.sel.clear(); await this.reload(); toast('已删除', 'ok'); } catch (e) { toast(e.message, 'err'); }
  },

  async dispatchEntities(ids) {
    if (!ids.length) return toast('先勾选要生成的设定卡', 'err');
    const s = this.state;
    if (!s.drama.style) toast('还没选画风,生图会只有底稿', 'info');
    const r = await this.dispatch({ target: 'entity-image', ids });
    if (r) toast('已下发 ' + r.created.length + ' 张设定图' + (r.skipped.length ? ' · 跳过 ' + r.skipped.length + '(' + errBrief(r.skipped[0].reason, 40) + ')' : '') + ' · 消耗 ' + r.cost + ' 分', 'ok');
  },

  /* 统一下发口:先算钱、再问覆盖,最后才发 */
  existingCount(target, ids) {
    const s = this.state;
    const has = (list) => list.length > 0;
    if (target === 'entity-image') return s.entities.filter(e => ids.includes(e.id) && e.asset_id).length;
    if (target === 'shot-image') return s.shots.filter(x => ids.includes(x.id) && has(x.image_asset_ids || [])).length;
    if (target === 'shot-video') return s.shots.filter(x => ids.includes(x.id) && has(x.video_asset_ids || [])).length;
    return 0;
  },

  async dispatch(payload) {
    const s = this.state;
    try {
      const est = await API.post('/drama/' + s.id + '/estimate', Object.assign({}, payload, { ids: payload.ids }));
      const label = payload.target === 'entity-image' ? '设定图' : payload.target === 'shot-image' ? '分镜图' : '分镜成片';
      const exist = this.existingCount(payload.target, payload.ids);
      let msg = '为 ' + est.items + ' 个对象生成' + label + ',预计消耗 ' + est.cost + ' 积分(余额 ' + est.balance + ')'
        + (est.free ? ',该模型免费' : '') + (est.enough ? '' : ' —— 余额不足,先去积分中心申请');
      if (exist) msg = '其中 ' + exist + ' 个已经有' + label + ',继续会覆盖分镜上关联的结果(旧' + label + '仍留在资产库)。\n' + msg;
      if (!await confirmDlg(msg, { title: exist ? '覆盖已有结果?' : '确认下发', danger: exist > 0, okText: exist ? '覆盖并下发' : '下发' })) return null;
      const r = await API.post('/drama/' + s.id + '/dispatch', Object.assign({}, payload, { replace: exist ? 1 : 0 }));
      s.sel.clear();
      await this.reload();
      return r;
    } catch (e) { toast(e.message, 'err'); return null; }
  },

  previewAsset(entityId) {
    const e = this.state.entities.find(x => x.id === entityId);
    if (!e || !e.asset) return;
    Viewer.open([{ id: e.asset.id, type: 'image', name: e.name, url: '/api/assets/' + e.asset.id + '/file', thumb: e.asset.thumb_path }], 0, {});
  },

  /* ===== 阶段 3:分镜 ===== */
  stageShots(box) {
    const s = this.state;
    if (s.ep === null) s.ep = s.episodes.length ? s.episodes[0].episode_no : 0;
    box.innerHTML = this.headHTML('阶段 3 · 分镜', '分镜表（' + s.shotsTotal + ' 镜 / ' + s.episodes.length + ' 集）',
      '每镜两条提示词:图片提示词出静帧,视频提示词带「继承上镜末状态」让站位不跳。改动即时保存,失焦即落库。',
      '<button class="btn" id="dwShotAdd">' + icon('plus') + '<span>补一镜</span></button>'
      + this.repairBtnHTML()
      + '<button class="btn" id="dwShotImg">' + icon('image-plus') + '<span>选中镜生图</span></button>'
      + '<button class="btn btn-primary" id="dwShotVid">' + icon('film') + '<span>选中镜出片</span></button>')
      + '<div class="dw-saveline"><span class="dw-save" data-state="idle"></span><span class="hint">' + icon('info') + '点正文即可改,失焦或 ⌘/Ctrl+Enter 落库</span></div>'
      + '<div class="filters dw-shot-filters"><div class="cat-chips" id="dwShotChips"></div>'
      + '<div class="search-box grow"><input class="input" id="dwShotQ" placeholder="搜索镜号 / 剧本原文 / 提示词" value="' + esc(s.shotQ || '') + '"></div>'
      + '<span class="hint" id="dwShotMeta"></span></div>'
      + '<div class="dw-ws">'
      + '<aside class="dw-eps"><div class="dw-eps-head"><span>集数</span><b class="gold-num">' + s.episodes.length + '</b></div><div class="dw-eps-list" id="dwEps"></div></aside>'
      + '<div class="dw-shots" id="dwShots"></div>'
      + '</div>'
      + '<div class="ast-batchbar hidden" id="dwShotBatch"></div>';
    this.renderEps();
    this.renderShotChips();
    this.renderShotList();
    const rp2 = box.querySelector('#dwRepair');
    if (rp2) rp2.addEventListener('click', () => this.openRepair());
    box.querySelector('#dwShotAdd').addEventListener('click', () => this.addShot());
    box.querySelector('#dwShotImg').addEventListener('click', () => this.dispatchShots('shot-image'));
    box.querySelector('#dwShotVid').addEventListener('click', () => this.dispatchShots('shot-video'));
    let qt = null;
    box.querySelector('#dwShotQ').addEventListener('input', e => {
      clearTimeout(qt);
      qt = setTimeout(() => { s.shotQ = e.target.value; this.renderShotList(); this.renderShotChips(); }, 220);
    });
  },

  /* 本集筛选:未出图 / 未出片 / 失败 —— 734 镜时靠它才找得到要补的镜 */
  renderShotChips() {
    const s = this.state, box = s.root.querySelector('#dwShotChips');
    if (!box) return;
    const f = s.shotFilter || 'all';
    const cnt = {
      all: s.shots.length,
      noimg: s.shots.filter(x => !(x.image_asset_ids || []).length).length,
      novid: s.shots.filter(x => !(x.video_asset_ids || []).length).length,
      failed: s.shots.filter(x => this.shotState(x).cls === 'is-bad').length
    };
    box.innerHTML = [['all', '全部'], ['noimg', '未出图'], ['novid', '未出片'], ['failed', '失败']]
      .map(([k, l]) => '<button class="cat-chip' + (f === k ? ' on' : '') + '" data-sfilter="' + k + '">' + l + '<span class="chip-n">' + cnt[k] + '</span></button>').join('');
    box.querySelectorAll('[data-sfilter]').forEach(b => b.addEventListener('click', () => {
      s.shotFilter = b.dataset.sfilter; this.renderShotChips(); this.renderShotList();
    }));
  },

  renderEps() {
    const s = this.state, box = s.root.querySelector('#dwEps');
    if (!box) return;
    box.innerHTML = s.episodes.map(e => '<button class="dw-ep' + (Number(e.episode_no) === Number(s.ep) ? ' active' : '') + '" data-ep="' + e.episode_no + '">'
      + '<span>' + (Number(e.episode_no) === 0 ? '设定/前情' : '第 ' + e.episode_no + ' 集') + '</span>'
      + '<i class="dw-ep-prog" title="已出图 / 全镜">' + (Number(e.images) || 0) + '/' + e.shots + '</i></button>').join('')
      || '<div class="hint">还没有分镜,回阶段 1 跑分析</div>';
    box.querySelectorAll('[data-ep]').forEach(b => b.addEventListener('click', async () => {
      s.ep = Number(b.dataset.ep); s.sel.clear();
      await this.reload();
    }));
  },

  filteredShots() {
    const s = this.state;
    const q = String(s.shotQ || '').trim().toLowerCase();
    const f = s.shotFilter || 'all';
    return s.shots.filter(sh => {
      if (q) {
        const hay = (sh.shot_no + ' ' + (sh.script_text || '') + ' ' + (sh.video_prompt || '') + ' ' + (sh.scene_ref || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (f === 'noimg') return !(sh.image_asset_ids || []).length;
      if (f === 'novid') return !(sh.video_asset_ids || []).length;
      if (f === 'failed') return this.shotState(sh).cls === 'is-bad';
      return true;
    });
  },

  renderShotList() {
    const s = this.state, box = s.root.querySelector('#dwShots');
    if (!box) return;
    if (!s.shots.length) {
      box.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('clapperboard') + '</div><h3>这一集还没有分镜</h3><p>回阶段 1 跑分析,或点「补一镜」手工写</p></div>';
      return;
    }
    const items = this.filteredShots();
    const meta = this.root.querySelector('#dwShotMeta');
    if (meta) {
      meta.textContent = '显示 ' + items.length + ' / ' + s.shots.length + ' 镜 · 已出图 '
        + s.shots.filter(x => (x.image_asset_ids || []).length).length + ' · 已出片 '
        + s.shots.filter(x => (x.video_asset_ids || []).length).length;
    }
    if (!items.length) {
      box.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('search-x') + '</div><h3>没有符合条件的镜</h3><p>换个关键词,或把筛选切回「全部」</p></div>';
      return;
    }
    box.innerHTML = items.map(sh => this.shotCardHTML(sh)).join('');
    box.querySelectorAll('[data-shot]').forEach(c => this.bindShotCard(c));
    this.updateShotBatch();
  },

  shotCardHTML(sh) {
    const s = this.state;
    const sel = s.sel.has(sh.id);
    const st = this.shotState(sh);
    const img = (sh.image_assets || [])[0];
    const vid = (sh.video_assets || [])[0];
    const scene = sh.scene_ref || '未定场景';
    const canVid = ((sh.image_asset_ids || []).length + (sh.effective_refs || []).length) > 0;
    const results = (sh.image_assets || []).map(a => ({ a: a, kind: 'image' }))
      .concat((sh.video_assets || []).map(a => ({ a: a, kind: 'video' })));
    return '<div class="dw-shot' + (sel ? ' sel' : '') + (st.cls ? ' ' + st.cls : '') + '" data-shot="' + sh.id + '">'
      + '<div class="dw-shot-head">'
      + '<span class="asset-check dw-shot-check' + (sel ? ' on' : '') + '" data-shot-check="' + sh.id + '">' + (sel ? icon('check') : '') + '</span>'
      + '<span class="dw-shot-idx">' + sh.shot_no + '</span>'
      + '<span class="dw-shot-scene">' + icon('mountain') + esc(scene) + '</span>'
      + '<span class="dw-shot-dur"><input class="input dw-dur" type="number" min="3" max="25" step="1" value="' + sh.duration + '" data-shot-dur="' + sh.id + '"> 秒</span>'
      + ((Number(sh.fps) || sh.video_resolution) ? '<span class="dw-shot-spec" title="单镜覆盖(未覆盖的跟随剧级)">'
        + esc(sh.video_resolution || s.drama.video_resolution || '720p') + '·' + (Number(sh.fps) || Number(s.drama.fps) || 24) + 'fps</span>' : '')
      + '<span class="dw-shot-stat">' + st.html + '</span></div>'
      + (sh.script_text ? '<div class="dw-shot-script clamp-2" title="双击展开">' + esc(sh.script_text) + '</div>' : '')
      /* 只留一个提示词:生图的画面从它派生(场景卡底稿 + 本镜画面),不再让人维护两份 */
      + '<div class="dw-cell dw-cell-solo"><div class="dw-cell-cap">' + icon('film') + '镜头提示词<span class="dw-cell-n">' + sh.video_prompt.length + '</span>'
      + '<span class="dw-cell-tip" title="图片提示词由「场景卡底稿 + 这段画面」自动拼装,不需要单独维护">生图与出片共用</span></div>'
      + '<textarea class="textarea dw-cell-ta" data-shot-video="' + sh.id + '" rows="4">' + esc(sh.video_prompt) + '</textarea>'
      + this.anchorsHTML(sh) + '</div>'
      + this.shotRefsHTML(sh)
      + (results.length ? '<div class="dw-results">' + '<span class="dw-refs-cap">' + icon('image-check') + '成果</span>'
        + results.map((r, i) => '<span class="dw-res-thumb" data-shot-preview="' + sh.id + '" data-res-idx="' + i + '" title="' + esc(r.a.name || '') + '">'
          + '<img src="' + esc(r.a.thumb_path || ('/api/assets/' + r.a.id + '/file')) + '" alt="" loading="lazy">'
          + '<i>' + icon(r.kind === 'video' ? 'play' : 'image') + '</i></span>').join('')
        + '<span class="dw-res-name clamp-1">' + esc(results[results.length - 1].a.name || '') + '</span>' + '</div>' : '')
      + '<div class="dw-shot-ops"><button class="btn btn-xs" data-shot-img="' + sh.id + '">' + icon('image-plus') + '<span>' + (img ? '重出静帧' : '生成静帧') + '</span></button>'
      + '<button class="btn btn-xs' + (canVid && !vid ? ' btn-primary' : '') + '" data-shot-vid="' + sh.id + '"' + (canVid ? '' : ' disabled title="还没有任何图片:先挂参考图或生成静帧"') + '>' + icon('play') + '<span>' + (vid ? '重出成片' : '出片') + '</span></button>'
      + (img ? '<button class="btn btn-xs" data-shot-replace="' + sh.id + '">' + icon('upload') + '<span>替换静帧</span></button>' : '')
      + '<button class="btn btn-xs" data-shot-spec="' + sh.id + '">' + icon('sliders-horizontal') + '<span>规格</span></button>'
      + '<button class="btn btn-xs" data-shot-compose="' + sh.id + '">' + icon('layers') + '<span>组装预览</span></button>'
      + '<button class="btn btn-xs danger" data-shot-del="' + sh.id + '">' + icon('trash-2') + '</button></div>'
      + (sh.end_state ? '<div class="dw-shot-end"><span class="dw-end-cap">本镜末状态</span>' + esc(sh.end_state) + '</div>' : '')
      + '</div>';
  },

  /* 关联标记:唯一一处展示「下发时会附加什么」—— 人物/场景用可点的芯片,
     带定稿图的打「图」标;输入框里只放正文,不再重复一遍锚点。 */
  anchorsHTML(sh) {
    const cast = sh.char_refs || [];
    const refs = sh.effective_refs || [];
    const castImg = new Set(refs.filter(r => r.source === 'character').map(r => r.label));
    const sceneImg = refs.some(r => r.source === 'scene');
    const extras = refs.filter(r => r.source === 'manual');
    if (!cast.length && !sh.scene_ref) return '';
    const chip = (name, has) => '<span class="pl-chip' + (this.cardExists(name) ? ' ok' : '') + (has ? ' dw-chip-img' : '') + '" data-cast="' + esc(name) + '" title="' + esc(has ? '已关联定稿图' : '暂无定稿图,点开补一张') + '">'
      + esc(name) + (has ? ' · 图' : '') + '</span>';
    return '<div class="dw-anchors">'
      + '<span class="dw-anchor"><b>人物参考</b>' + (cast.length ? cast.map(n => chip(n, castImg.has(n))).join('') : '<em>未关联人物</em>')
      + (extras.length ? '<i class="dw-anchor-extra">补充参考图 ' + extras.length + ' 张</i>' : '') + '</span>'
      + '<span class="dw-anchor"><b>场景锚点</b>' + (sh.scene_ref ? chip(sh.scene_ref, sceneImg) : '<em>未关联场景</em>') + '</span>'
      + '<span class="dw-anchor-tip">' + icon('info') + '下发时自动附在提示词末尾</span></div>';
  },

  cardExists(name) {
    return (this.state.entities || []).some(e => e.name === name);
  },

  /* 当前生图模型最多能吃几张参考图(多图合成 4 / 图生图 1 / 纯文生图 0) */
  refCap() {
    const o = this.state.opts, d = this.state.drama;
    const id = d.image_model_id || (o.defaults && o.defaults.image);
    const m = (o.imageModels || []).find(x => x.id === id);
    return m ? Number(m.max_refs || 0) : 0;
  },
  castRefsFor(sh) {
    return (sh.char_refs || [])
      .map(n => (this.state.entities || []).find(e => e.name === n))
      .filter(e => e && e.asset_id);
  },

  /* 关联图片:场景定稿图 → 角色定稿图 → 手动图;每张可单独摘掉。
     自动来源的摘掉记进排除表(ref_exclude_ids),不会下次又被自动补回来。 */
  shotRefsHTML(sh) {
    const cap = Number(sh.ref_cap != null ? sh.ref_cap : this.refCap());
    const list = sh.effective_refs || [];
    const excluded = (sh.ref_exclude_ids || []).length;
    const srcLabel = { scene: '场景定稿图', character: '角色定稿图', manual: '手动挂的图' };
    const cnt = { scene: 0, character: 0, manual: 0 };
    for (const r of list) cnt[r.source] = (cnt[r.source] || 0) + 1;
    const tags = [cnt.scene ? '场景图 ' + cnt.scene : '', cnt.character ? '角色图 ' + cnt.character : '', cnt.manual ? '手动 ' + cnt.manual : ''].filter(Boolean).join(' · ');
    return '<div class="dw-refs">'
      + '<span class="dw-refs-cap">' + icon('images') + '关联图片 <b>' + list.length + '</b>/' + (cap || 0) + (tags ? '<em class="dw-refs-tags">' + esc(tags) + '</em>' : '') + '</span>'
      + list.map(r => '<span class="dw-ref-chip" data-ref-preview="' + r.id + '" title="' + esc((srcLabel[r.source] || '') + ' · ' + (r.label || '')) + '">'
        + '<img src="' + esc((r.asset && (r.asset.thumb_path || ('/api/assets/' + r.id + '/file'))) || '') + '" alt="" loading="lazy">'
        + '<b data-ref-x="' + r.id + '" data-ref-src="' + r.source + '" title="摘掉这张">×</b></span>').join('')
      + '<button class="btn btn-xs" data-ref-add="' + sh.id + '"' + (cap ? '' : ' disabled title="当前生图模型不支持参考图"') + '>'
      + icon('plus') + '<span>挂图</span></button>'
      + (excluded ? '<button class="btn btn-xs" data-ref-reset="' + sh.id + '" title="把摘掉的自动参考图补回来">' + icon('rotate-ccw') + '<span>恢复自动(' + excluded + ')</span></button>' : '')
      + '<span class="dw-refs-cap-n">' + (cap ? '手动优先,超上限自动截断' : '该模型不支持参考图') + '</span>'
      + '</div>';
  },

  async patchShot(id, body) {
    try {
      const r = await API.patch('/drama/shots/' + id, body);
      const i = this.state.shots.findIndex(x => x.id === id);
      if (i >= 0 && r.shot) this.state.shots[i] = Object.assign({}, this.state.shots[i], r.shot);
      this.renderShotList();
    } catch (e) { toast(e.message, 'err'); }
  },

  addShotRefs(shotId) {
    const sh = this.state.shots.find(x => x.id === shotId);
    if (!sh) return;
    const cap = this.refCap();
    if (!cap) return toast('当前生图模型不支持参考图,换一个支持多图/图生图的模型', 'err');
    ImagesView.pickRefAssetsFor({
      multi: cap > 1,
      selected: sh.ref_asset_ids || [],
      onPick: picked => {
        const ids = picked.map(a => a.id);
        if (ids.length > cap) toast('该模型最多 ' + cap + ' 张参考图,只取前 ' + cap + ' 张', 'info');
        this.patchShot(shotId, { ref_asset_ids: ids.slice(0, cap) });
      }
    });
  },

  /* 角标来自 tasks 实况(排队/生成中/完成/失败),不在分镜行上再存一份状态 */
  shotState(sh) {
    const s = this.state;
    const mine = s.tasks.filter(t => { try { return (t.params && t.params.drama_shot_id) === sh.id; } catch (e) { return false; } });
    const img = mine.filter(t => t.type === 'text-to-image');
    const vid = mine.filter(t => t.type === 'image-to-video');
    const pick = arr => arr.length ? arr[0] : null;
    const ti = pick(img), tv = pick(vid);
    const running = [ti, tv].filter(Boolean).find(t => t.status === 'queued' || t.status === 'processing');
    let html = '', cls = '';
    if (running) {
      /* 进度是要看的:排队 0%、处理中按适配器回报 */
      const pct = running.status === 'queued' ? 0 : Math.max(0, Math.min(100, Number(running.progress) || 0));
      html = '<span class="status status-processing"><span class="status-dot"></span>' + (running.type === 'text-to-image' ? '出图' : '出片') + ' ' + pct + '%</span>'
        + '<span class="dw-mini-bar"><i style="width:' + pct + '%"></i></span>';
      cls = 'is-run';
    }
    else if (sh.image_asset_ids.length && sh.video_asset_ids.length) html = statusBadge('completed');
    else if (sh.image_asset_ids.length) html = '<span class="status status-completed">' + icon('circle-check') + '有图待出片</span>';
    else if ((ti && ti.status === 'failed') || (tv && tv.status === 'failed')) { html = statusBadge('failed'); cls = 'is-bad'; }
    else html = '<span class="status status-queued">' + icon('timer') + '待生成</span>';
    return { html, cls };
  },

  bindShotCard(c) {
    const s = this.state, id = c.dataset.shot;
    const patch = (body) => {
      clearTimeout(s.saveTimer);
      this.setSaveState('pending');
      s.saveTimer = setTimeout(async () => {
        this.setSaveState('saving');
        try { await API.patch('/drama/shots/' + id, body); this.setSaveState('saved'); }
        catch (e) { this.setSaveState('error'); toast(e.message, 'err'); }
      }, 700);
    };
    ['video'].forEach(k => {
      const ta = c.querySelector('[data-shot-' + k + ']');
      if (ta) {
        ta.addEventListener('input', () => {
          const sh = s.shots.find(x => x.id === id);
          if (sh) sh[k === 'image' ? 'image_prompt' : 'video_prompt'] = ta.value;
          const n = c.querySelector('[data-shot-' + k + ']');
          const cap = n.closest('.dw-cell').querySelector('.dw-cell-n');
          if (cap) cap.textContent = ta.value.length;
          patch({ [k === 'image' ? 'image_prompt' : 'video_prompt']: ta.value });
        });
        /* Cmd/Ctrl+Enter 立即落库:防抖那一发还挂着,先撤掉再直发,免得同一份文本存两次 */
        ta.addEventListener('keydown', ev => {
          if (!(ev.metaKey || ev.ctrlKey) || ev.key !== 'Enter') return;
          if (s.saveTimer) { clearTimeout(s.saveTimer); s.saveTimer = null; }
          this.setSaveState('saving');
          API.patch('/drama/shots/' + id, { [k === 'image' ? 'image_prompt' : 'video_prompt']: ta.value })
            .then(() => this.setSaveState('saved')).catch(e => { this.setSaveState('error'); toast(e.message, 'err'); });
        });
      }
    });
    const dur = c.querySelector('[data-shot-dur]');
    if (dur) dur.addEventListener('change', () => { const sh = s.shots.find(x => x.id === id); if (sh) sh.duration = Number(dur.value); patch({ duration: Number(dur.value) }); });
    c.addEventListener('click', async ev => {
      const chk = ev.target.closest('[data-shot-check]');
      if (chk) { if (s.sel.has(id)) s.sel.delete(id); else s.sel.add(id); this.applyShotSel(); return; }
      /* 参考图:先判「摘掉」,再判「预览」,否则点 × 会先命中外层缩略图 */
      const del = ev.target.closest('[data-ref-x]');
      if (del) {
        const sh = s.shots.find(x => x.id === id);
        if (!sh) return;
        if (del.dataset.refSrc === 'manual') {
          this.patchShot(id, { ref_asset_ids: (sh.ref_asset_ids || []).filter(a => a !== del.dataset.refX) });
        } else {
          /* 自动来源(场景/角色定稿图):记进排除表,下次不再自动带 */
          const ex = [...new Set([...(sh.ref_exclude_ids || []), del.dataset.refX])];
          this.patchShot(id, { ref_exclude_ids: ex });
        }
        return;
      }
      const reset = ev.target.closest('[data-ref-reset]');
      if (reset) { this.patchShot(id, { ref_exclude_ids: [], use_cast_refs: 1 }); return; }
      const res = ev.target.closest('[data-shot-preview]');
      if (res) {
        const sh = s.shots.find(x => x.id === id);
        const arr = [].concat(sh.image_assets || [], sh.video_assets || []);
        if (arr.length) Viewer.open(arr.map(a => ({ id: a.id, type: a.type, name: a.name, url: '/api/assets/' + a.id + '/file', thumb: a.thumb_path })), Number(res.dataset.resIdx) || 0, {});
        return;
      }
      const pv = ev.target.closest('[data-ref-preview]');
      if (pv) {
        const sh = s.shots.find(x => x.id === id);
        const arr = (sh.ref_assets || []).filter(a => a.id === pv.dataset.refPreview);
        if (arr.length) Viewer.open(arr.map(a => ({ id: a.id, type: 'image', name: a.name, url: '/api/assets/' + a.id + '/file', thumb: a.thumb_path })), 0, {});
        return;
      }
      const addRef = ev.target.closest('[data-ref-add]');
      if (addRef) { this.addShotRefs(id); return; }
      const repShot = ev.target.closest('[data-shot-replace]');
      if (repShot) {
        const sh = s.shots.find(x => x.id === id);
        const cur = sh && (sh.image_assets || [])[0];
        this.pickAndReplaceImage('shot', id, cur && cur.id, '分镜');
        return;
      }
      const btn = ev.target.closest('[data-shot-img],[data-shot-vid],[data-shot-del],[data-shot-compose],[data-shot-spec],[data-view-shot],[data-cast]');
      if (!btn) return;
      if (btn.dataset.viewShot) { this.previewShotAsset(btn.dataset.viewShot, 'image'); return; }
      if (btn.dataset.cast) { this.locateCard(btn.dataset.cast); return; }
      const ids = [id];
      if (btn.dataset.shotImg) { const r = await this.dispatch({ target: 'shot-image', ids }); if (r && r.created.length) this.afterDispatch(r, '分镜图'); }
      else if (btn.dataset.shotVid) { const r = await this.dispatch({ target: 'shot-video', ids }); if (r && r.created.length) this.afterDispatch(r, '分镜成片'); else if (r && r.skipped.length) toast(r.skipped[0].reason, 'err'); }
      else if (btn.dataset.shotSpec) this.overrideShotSpec(s.shots.find(x => x.id === id));
      else if (btn.dataset.shotCompose) this.composeDialog('shot', ids, 'both');
      else if (btn.dataset.shotDel) {
        if (await confirmDlg('删除这一镜?', { danger: true, okText: '删除' })) { await API.post('/drama/shots/batch-delete', { ids }); await this.reload(); }
      }
    });
    const castOn = c.querySelector('[data-cast-on]');
    if (castOn) castOn.addEventListener('change', () => this.patchShot(id, { use_cast_refs: castOn.checked ? 1 : 0 }));
    const sc = c.querySelector('.dw-shot-script');
    if (sc) sc.addEventListener('dblclick', () => sc.classList.toggle('clamp-2'));
  },

  afterDispatch(r, label) {
    this.setSaveState('saved');
    const ok = (r.created || []).length, sk = (r.skipped || []).length;
    if (ok) toast('已下发 ' + ok + ' 个' + label + ' · ' + r.cost + ' 分' + (r.refs_used ? ' · 带 ' + r.refs_used + ' 张参考图' : ''), 'ok');
    /* 跳过的按原因归并,别只报第一条 —— 混合批次里「哪几镜被跳、为什么」才是用户要的 */
    if (sk) {
      const reasons = [...new Set(r.skipped.map(x => x.reason))].slice(0, 2).join(';');
      toast((ok ? '另有 ' : '') + sk + ' 个被跳过:' + errBrief(reasons, 80), ok ? 'info' : 'err');
    }
    this.startPolling();
  },

  setSaveState(st) {
    const elx = this.root.querySelector('.dw-save');
    if (!elx) return;
    elx.dataset.state = st;
    elx.textContent = { pending: '未保存…', saving: '保存中…', saved: '已保存', error: '保存失败' }[st] || '';
  },

  flushSave() { if (this.state.saveTimer) { clearTimeout(this.state.saveTimer); this.state.saveTimer = null; } },

  applyShotSel() {
    const s = this.state;
    s.root.querySelectorAll('[data-shot]').forEach(c => {
      const on = s.sel.has(c.dataset.shot);
      c.classList.toggle('sel', on);
      const chk = c.querySelector('[data-shot-check]');
      chk.classList.toggle('on', on);
      chk.innerHTML = on ? icon('check') : '';
    });
    this.updateShotBatch();
  },

  updateShotBatch() {
    const s = this.state, bar = s.root.querySelector('#dwShotBatch');
    if (!bar) return;
    bar.classList.toggle('hidden', !s.sel.size);
    if (!s.sel.size) return;
    bar.innerHTML = '<span>本集已选 <b class="gold-num">' + s.sel.size + '</b> 镜</span>'
      + '<button class="btn btn-xs" data-b="all">' + icon('check-check') + '<span>全选本集</span></button>'
      + '<button class="btn btn-xs" data-b="clear">' + icon('x') + '<span>清空</span></button>'
      + '<button class="btn btn-xs btn-primary" data-b="img">' + icon('image-plus') + '<span>批量生图</span></button>'
      + '<button class="btn btn-xs btn-primary" data-b="vid">' + icon('film') + '<span>批量出片</span></button>'
      + '<button class="btn btn-xs" data-b="compose">' + icon('layers') + '<span>组装预览</span></button>'
      + '<button class="btn btn-xs danger" data-b="del">' + icon('trash-2') + '<span>删除</span></button>';
    bar.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.b, ids = [...s.sel];
      if (k === 'all') { s.shots.forEach(x => s.sel.add(x.id)); this.applyShotSel(); }
      else if (k === 'clear') { s.sel.clear(); this.applyShotSel(); }
      else if (k === 'img') { const r = await this.dispatch({ target: 'shot-image', ids }); if (r) this.afterDispatch(r, '分镜图'); }
      else if (k === 'vid') {
        /* 没分镜图的镜在这一步就挡掉并说清数量,不把整批丢给服务端再逐条 skip */
        const hasImg = x => (x.image_asset_ids || []).length + (x.effective_refs || []).length > 0;
        const ready = s.shots.filter(x => s.sel.has(x.id) && hasImg(x));
        const lacking = s.sel.size - ready.length;
        if (!ready.length) { toast('选中的 ' + s.sel.size + ' 镜都还没有图片:先挂参考图或批量生成静帧', 'err'); return; }
        if (lacking > 0) toast('跳过 ' + lacking + ' 镜(没有任何图片)', 'info');
        const r = await this.dispatch({ target: 'shot-video', ids: ready.map(x => x.id) }); if (r) this.afterDispatch(r, '分镜成片');
      }
      else if (k === 'compose') this.composeDialog('shot', ids, 'both');
      else if (k === 'del') {
        if (!await confirmDlg('删除 ' + ids.length + ' 个分镜?已生成的图与片会留在资产库。', { danger: true, okText: '删除' })) return;
        await API.post('/drama/shots/batch-delete', { ids }); s.sel.clear(); await this.reload();
      }
    }));
  },

  async dispatchShots(target) {
    const s = this.state;
    let ids = s.sel.size ? [...s.sel] : s.shots.map(x => x.id);
    if (!ids.length) return toast('这一集没有分镜', 'err');
    if (target === 'shot-video') {
      const hasImg = x => (x.image_asset_ids || []).length + (x.effective_refs || []).length > 0;
      const ready = s.shots.filter(x => ids.includes(x.id) && hasImg(x));
      if (!ready.length) return toast('这 ' + ids.length + ' 镜都还没有图片:先挂参考图或生成静帧', 'err');
      if (ready.length < ids.length) toast('跳过 ' + (ids.length - ready.length) + ' 镜(没有任何图片)', 'info');
      ids = ready.map(x => x.id);
    }
    const r = await this.dispatch({ target, ids });
    if (r) this.afterDispatch(r, target === 'shot-video' ? '分镜成片' : '分镜图');
  },

  /* 单镜覆盖帧率/分辨率/时长:空值或 0 = 跟随剧级。镜像逻辑在服务端 videoSpec()。 */
  async overrideShotSpec(sh) {
    if (!sh) return;
    const s = this.state, d = s.drama;
    const sp = s.opts.specOptions || {};
    const v = await formModal({
      title: '单镜规格 · 第' + sh.episode_no + '集 镜' + sh.shot_no, size: 'modal-md', submitText: '保存',
      fields: [
        { key: 'duration', label: '时长(秒,3~25)', type: 'number', value: sh.duration },
        { key: 'fps', label: '帧率', type: 'select', value: String(Number(sh.fps) || 0), options: [{ value: '0', label: '跟随剧级(' + (Number(d.fps) || 24) + ')' }].concat((sp.fps || []).map(f => ({ value: String(f), label: String(f) }))) },
        { key: 'video_resolution', label: '视频分辨率', type: 'select', value: sh.video_resolution || '', options: [{ value: '', label: '跟随剧级(' + (d.video_resolution || '720p') + ')' }].concat((sp.videoResolutions || []).map(x => ({ value: x, label: videoResLabel(x) }))) }
      ],
      onSubmit: async val => {
        await API.patch('/drama/shots/' + sh.id, {
          duration: Number(val.duration), fps: Number(val.fps),
          video_resolution: String(val.video_resolution || '')
        });
      }
    });
    if (v) await this.reload();
  },

  async addShot() {
    const s = this.state;
    const v = await formModal({
      title: '补一个分镜', size: 'modal-md',
      fields: [
        { key: 'shot_no', label: '镜号', type: 'number', value: (s.shots.length ? Math.max.apply(null, s.shots.map(x => x.shot_no)) + 1 : 1) },
        { key: 'duration', label: '秒数', type: 'number', value: Math.round(Number(s.drama.shot_duration) || 10) },
        { key: 'scene_ref', label: '场景锚点', value: '', placeholder: '林家·祠堂' },
        { key: 'script_text', label: '剧本原文', type: 'textarea', value: '' },
        { key: 'image_prompt', label: '图片提示词', type: 'textarea', value: '' },
        { key: 'video_prompt', label: '视频提示词', type: 'textarea', value: '' }
      ],
      onSubmit: async val => {
        await API.post('/drama/' + s.id + '/shots', { items: [{ episode_no: s.ep, shot_no: Number(val.shot_no), duration: Number(val.duration), scene_ref: val.scene_ref, script_text: val.script_text, image_prompt: val.image_prompt, video_prompt: val.video_prompt }] });
      }
    });
    if (v) await this.reload();
  },

  previewShotAsset(shotId, kind) {
    const sh = this.state.shots.find(x => x.id === shotId);
    if (!sh) return;
    const arr = kind === 'video' ? sh.video_assets : sh.image_assets;
    if (!arr || !arr.length) return;
    Viewer.open(arr.map(a => ({ id: a.id, type: a.type, name: a.name, url: '/api/assets/' + a.id + '/file', thumb: a.thumb_path })), 0, {});
  },

  /* 从分镜的角色 chip 跳到设定卡:直接就地切阶段并带上搜索词,
     走 location.hash 会触发路由重渲染,刚写进去的关键词会被新 state 冲掉 */
  locateCard(name) {
    const s = this.state;
    const e = s.entities.find(x => x.name === name);
    if (!e) return toast('卡「' + name + '」不在本剧设定卡里 —— 回阶段 2 补一张', 'err');
    s.stage = 'entities'; s.q = name; s.kind = e.kind; s.sel.clear();
    history.replaceState(null, '', '#/workflow/' + s.id + '/entities');
    this.reload();
  },

  /* ---------- 组装预览:底稿 + 画风,可固定回底稿(删减关键词后落库) ---------- */
  async composeDialog(kind, ids, target) {
    const s = this.state;
    let data;
    try { data = await API.post('/drama/' + s.id + '/compose', { kind, ids, target }); } catch (e) { return toast(e.message, 'err'); }
    const items = data.items || [];
    if (!items.length) return toast('没有可预览的对象', 'err');
    const one = items.length === 1;
    const body = el('<div class="dw-compose"></div>');
    body.innerHTML = '<div class="dw-compose-cap">' + icon('palette') + '画风 <b>' + esc(data.style || '未选') + '</b> · ' + items.length + ' 个对象'
      + (data.missing ? '<span class="dw-miss">' + icon('triangle-alert') + data.missing + ' 个缺该槽位画风</span>' : '')
      + (one ? '<div class="dw-compose-tips">画风段是整段追加的;觉得太长就在下面删掉多余的排版段,再点「固定为底稿」,以后这条卡就带着删减结果走。</div>' : '')
      + '</div>'
      + items.map((it, i) => '<div class="dw-compose-item"><div class="dw-compose-name clamp-1">' + esc(it.name) + ' · ' + esc(it.composed.slot)
        + (it.composed.via && it.composed.via !== it.composed.slot ? '(退到 ' + esc(it.composed.via) + ')' : '') + '</div>'
        + '<div class="dw-compose-base">' + esc(it.composed.base || '（底稿为空）') + '</div>'
        + '<div class="dw-compose-plus">' + esc(it.composed.appended || '（该画风这个槽位还没有内容）') + '</div>'
        + (one ? '<textarea class="textarea dw-compose-ta" rows="8">' + esc(it.composed.prompt) + '</textarea>' : '')
        + (it.composed.note ? '<div class="hint">' + esc(it.composed.note) + '</div>' : '')
        + (it.composed.negative ? '<div class="dw-compose-neg">负面词:' + esc(it.composed.negative) + '</div>' : '')
        + '</div>').join('');
    const foot = [el('<button class="btn">关闭</button>')];
    if (one) {
      const pin = el('<button class="btn btn-primary">固定为底稿</button>');
      pin.addEventListener('click', async () => {
        const ta = body.querySelector('.dw-compose-ta');
        pin.disabled = true;
        try {
          await API.post('/drama/' + s.id + '/compose/apply', { kind, target: target === 'video' ? 'video' : 'image', edits: [{ id: items[0].id, text: ta.value }] });
          toast('已把组装结果写回底稿 —— 下次组装不再重复追加画风', 'ok');
          body.closest('.modal-mask').querySelector('.modal-x').click();
          await this.reload();
        } catch (e) { toast(e.message, 'err'); pin.disabled = false; }
      });
      foot.push(pin);
    }
    const m = openModal({ title: '组装预览(下发时用的就是这份文本)', body: body, size: 'modal-lg', footer: foot });
    foot[0].addEventListener('click', () => m.close());
  },

  /* ===== 阶段 4:全局提示词 ===== */
  stagePrompts(box) {
    const s = this.state, d = s.drama, o = s.opts;
    const names = Object.keys(s.presetStyles);
    const active = s.activeStyle && names.includes(s.activeStyle) ? s.activeStyle : (d.style && names.includes(d.style) ? d.style : names[0] || '');
    box.innerHTML = this.headHTML('阶段 4 · 全局提示词', '画风矩阵', '一套画风按槽位拆:人物图片 / 场景图片 / 道具图片 / 分镜图片 / 视频。生图与出片时,系统把对应槽位整段追加到底稿后面 —— 底稿不带画风词,画风只改这里。',
      '<button class="btn" id="dwPReset">' + icon('rotate-ccw') + '<span>恢复内置画风</span></button>'
      + '<button class="btn" id="dwPImport">' + icon('upload') + '<span>导入画风文档</span></button>'
      + '<button class="btn btn-primary" id="dwPAdd">' + icon('plus') + '<span>新增槽位</span></button>')
      + '<div class="filters"><div class="cat-chips" id="dwStyleChips">'
      + names.map(n => '<button class="cat-chip' + (n === active ? ' on' : '') + '" data-style="' + esc(n) + '">' + esc(n)
        + (this.regionOf(n) ? '<em>' + esc(this.regionOf(n)) + '</em>' : '')
        + '<span class="chip-n">' + (s.presetStyles[n] || []).filter(p => p.enabled).length + '</span></button>').join('')
      + '</div><div class="filters-divider"></div>'
      + '<label class="dw-check"><input type="checkbox" id="dwUseStyle"' + (d.style === active ? ' checked' : '') + '><span>设为这部剧当前画风</span></label>'
      + '<div class="dw-region"><span class="hint">地域</span><select class="select" id="dwRegion">'
      + '<option value="">无约束</option>' + (o.regions || []).map(reg => '<option value="' + reg.key + '"' + (this.regionKey(active) === reg.key ? ' selected' : '') + '>' + esc(reg.label) + '</option>').join('')
      + '</select></div>'
      + (o.sampleDir.exists ? '<span class="hint">参考:' + esc(o.sampleDir.path) + '</span>' : '') + '</div>'
      + '<div id="dwPresetRows"></div>';
    this.renderPresetRows(active);
    box.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => { s.activeStyle = b.dataset.style; this.paint(); }));
    box.querySelector('#dwUseStyle').addEventListener('change', async e => {
      try { await API.patch('/drama/' + d.id, { style: e.target.checked ? active : '' }); toast(e.target.checked ? '当前画风已切换为「' + active + '」' : '已取消画风', 'ok'); await this.reload(); } catch (err) { toast(err.message, 'err'); }
    });
    box.querySelector('#dwRegion').addEventListener('change', async e => {
      try {
        await API.post('/drama/presets/style-region', { style_name: active, region: e.target.value });
        const lab = { overseas: '海外:画面禁中式元素、台词写英文', cn: '国内:画面禁西式元素、台词写中文', '': '已取消地域约束' }[e.target.value];
        toast('「' + active + '」' + lab, 'ok');
        await this.loadPresets(); await this.reload();
      } catch (err) { toast(err.message, 'err'); }
    });
    box.querySelector('#dwPAdd').addEventListener('click', () => this.editPreset(null, active));
    box.querySelector('#dwPReset').addEventListener('click', async () => {
      const r = await API.post('/drama/presets/restore', {});
      toast(r.added ? '补回 ' + r.added + ' 条内置画风' : '内置画风已在(共 ' + r.total + ' 条)', r.added ? 'ok' : 'info');
      await this.loadPresets(); this.paint();
    });
    box.querySelector('#dwPImport').addEventListener('click', () => this.pickAndImport(s.id));
  },

  renderPresetRows(styleName) {
    const s = this.state, box = s.root.querySelector('#dwPresetRows');
    const rows = (s.presetStyles[styleName] || []).slice().sort((a, b) => s.opts.slots.indexOf(a.slot) - s.opts.slots.indexOf(b.slot));
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><div class="empty-ico">' + icon('palette') + '</div><h3>这套画风还没有内容</h3><p>点「新增槽位」写第一条,或「导入画风文档」上传 各种全局提示词.docx</p></div>';
      return;
    }
    box.innerHTML = '<div class="dw-preset-head"><span>槽位</span><span>提示词内容</span><span>启用</span><span></span></div>'
      + rows.map(p => {
        const paras = String(p.content || '').split('\n').filter(Boolean);
        return '<div class="dw-preset-row' + (p.enabled ? '' : ' off') + '" data-preset="' + p.id + '">'
          + '<div class="dw-slot"><b>' + esc(p.slot) + '</b>' + (p.is_system ? '<span class="tag tag-cat">内置</span>' : '') + (p.note ? '<span class="hint">' + esc(p.note) + '</span>' : '') + '</div>'
          + '<div class="dw-preset-body">'
          + '<div class="dw-preset-text clamp-2">' + esc(paras[0] || '（空）') + '</div>'
          + '<div class="dw-preset-meta">' + paras.length + ' 段 · ' + String(p.content || '').length + ' 字'
          + (paras.length > 6 ? '<em class="dw-warn-long">段落偏多,下发时每镜都会带满;' + icon('pen-line') + '里删掉不用的排版段更稳</em>' : '')
          + (p.negative ? '<span class="dw-preset-neg">负面词 ' + esc(p.negative.slice(0, 28)) + (p.negative.length > 28 ? '…' : '') + '</span>' : '') + '</div></div>'
          + '<label class="dw-switch"><input type="checkbox" data-p-on="' + p.id + '"' + (p.enabled ? ' checked' : '') + '><span></span></label>'
          + '<div class="table-ops"><button class="btn btn-xs" data-p-edit="' + p.id + '">' + icon('pen-line') + '</button>'
          + '<button class="btn btn-xs" data-p-copy="' + p.id + '">' + icon('layers') + '</button>'
          + '<button class="btn btn-xs danger" data-p-del="' + p.id + '">' + icon('trash-2') + '</button></div>'
          + '</div>';
      }).join('');
    box.querySelectorAll('[data-p-on]').forEach(i => i.addEventListener('change', async () => {
      try { await API.patch('/drama/presets/' + i.dataset.pOn, { enabled: i.checked ? 1 : 0 }); await this.loadPresets(); this.paint(); } catch (e) { toast(e.message, 'err'); }
    }));
    box.querySelectorAll('[data-p-edit]').forEach(b => b.addEventListener('click', () => this.editPreset(this.findPreset(b.dataset.pEdit))));
    box.querySelectorAll('[data-p-copy]').forEach(b => b.addEventListener('click', async () => {
      const p = this.findPreset(b.dataset.pCopy);
      await API.post('/drama/presets', { style_name: p.style_name, slot: p.slot, content: p.content, negative: p.negative, note: p.note });
      await this.loadPresets(); this.paint(); toast('已复制一份,可改成另一套排版', 'ok');
    }));
    box.querySelectorAll('[data-p-del]').forEach(b => b.addEventListener('click', async () => {
      if (!await confirmDlg('删除这条提示词?', { danger: true, okText: '删除' })) return;
      await API.del('/drama/presets/' + b.dataset.pDel); await this.loadPresets(); await this.reload();
    }));
  },

  findPreset(id) { return this.state.presets.find(p => p.id === id); },

  regionKey(styleName) {
    const st = (this.state.opts.styles || []).find(x => x.name === styleName);
    return st ? (st.region || '') : '';
  },
  regionOf(styleName) {
    const key = this.regionKey(styleName);
    if (!key) return '';
    const r = (this.state.opts.regions || []).find(x => x.key === key);
    return r ? r.label : key;
  },

  async editPreset(p, styleName) {
    const s = this.state;
    const v = await formModal({
      title: p ? '编辑 ' + p.style_name + ' · ' + p.slot : '新增全局提示词', size: 'modal-lg',
      fields: [
        { key: 'style_name', label: '画风名', value: p ? p.style_name : (styleName || '') },
        { key: 'slot', label: '槽位', type: 'select', value: p ? p.slot : s.opts.slots[0], options: s.opts.slots.map(x => ({ value: x, label: x })) },
        { key: 'note', label: '备注(如「按情况删减关键词」)', value: p ? p.note : '' },
        { key: 'content', label: '提示词内容(一段一行)', type: 'textarea', value: p ? p.content : '', placeholder: '电影级 3D 国漫质感,PBR 物理材质渲染…' },
        { key: 'negative', label: '负面词(该画风共用)', type: 'textarea', value: p ? p.negative : '' }
      ],
      onSubmit: async val => {
        if (!val.style_name.trim()) { toast('画风名不能为空', 'err'); return false; }
        if (p) await API.patch('/drama/presets/' + p.id, { style_name: val.style_name.trim(), slot: val.slot, note: val.note, content: val.content, negative: val.negative });
        else await API.post('/drama/presets', { style_name: val.style_name.trim(), slot: val.slot, note: val.note, content: val.content, negative: val.negative });
      }
    });
    if (v) { await this.loadPresets(); await this.reload(); }
  },

  /* ===== 阶段 5:下发 ===== */
  stageDispatch(box) {
    const s = this.state, d = s.drama;
    /* 骨架只画一次:数字、批次计数、任务表都走局部刷新。
       以前 loadPending() 回来又调 stageDispatch(),等于无限重绘 —— 文字闪、按钮点不中。 */
    box.innerHTML = this.headHTML('阶段 5 · 下发', '批量出图与出片', '顺序是角色定稿 → 场景定稿 → 分镜静帧(自动带本镜角色的定稿图当参考) → 分镜成片。任务走平台同一套队列,可在任务中心取消、重试。',
      '<a class="btn" href="#/workflow/' + d.id + '/shots">' + icon('clapperboard') + '<span>去分镜逐镜看</span></a>'
      + '<button class="btn hidden" id="dwDStop">' + icon('x') + '<span>停止分析</span></button>')
      + '<div class="stat-cards dw-nums" id="dwDStats"></div>'
      + '<div class="form-sect"><div class="section-title">一键批次<span class="hint">每批最多 60 个,超出再点一次</span></div><div class="dw-batch-grid">'
      + this.batchBtn('chars', 'user-round', '人物设定图')
      + this.batchBtn('scenes', 'mountain', '场景设定图')
      + this.batchBtn('shotimg', 'image', '分镜静帧')
      + this.batchBtn('shotvid', 'film', '分镜成片')
      + '</div><div class="hint">' + icon('info')
      + '生图 <b>' + esc(this.imageModelName()) + '</b> · 出片 <b>' + esc(this.videoModelName()) + '</b> · 画风 <b>' + esc(d.style || '未选') + '</b>'
      + (d.project_id ? ' · 挂到项目 ' + esc((App.projects.find(p => p.id === d.project_id) || {}).name || d.project_id) : ' · 未关联项目(成果仍进资产库)')
      + (d.style ? '' : ' —— 没选画风时,提示词只有底稿,质感会不稳') + '</div>'
      + '<div class="dw-spec-line">' + icon('frame') + '<span>比例 <b>' + esc(d.aspect_ratio || '16:9') + '</b>'
      + ' · 图片 <b>' + esc(d.image_resolution || '1K') + '</b>(' + imgSizeFrom(d.aspect_ratio || '16:9', d.image_resolution || '1K').w + '×' + imgSizeFrom(d.aspect_ratio || '16:9', d.image_resolution || '1K').h + ')'
      + ' · 成片 <b>' + esc(d.video_resolution || '720p') + '</b>(' + videoWH(d.video_resolution || '720p', d.aspect_ratio || '16:9').w + '×' + videoWH(d.video_resolution || '720p', d.aspect_ratio || '16:9').h + ')'
      + ' · <b>' + (Number(d.fps) || 24) + 'fps</b></span>'
      + '<a class="btn btn-xs" href="#/workflow/' + d.id + '/script">' + icon('sliders-horizontal') + '<span>改规格</span></a></div></div>'
      + '<div class="form-sect"><div class="section-title">任务实况</div><div id="dwDTasks"></div></div>';
    box.querySelectorAll('[data-batch]').forEach(b => b.addEventListener('click', () => this.runBatch(b.dataset.batch)));
    const stop = box.querySelector('#dwDStop');
    if (stop) stop.addEventListener('click', () => this.stopAnalyze());
    /* 委托绑在不会重建的容器上:表格每 4 秒重画,按钮照样能点 */
    box.querySelector('#dwDTasks').addEventListener('click', async ev => {
      const rt = ev.target.closest('[data-retry]');
      if (rt) {
        try { await API.post('/tasks/' + rt.dataset.retry + '/retry', {}); toast('已重新入队', 'ok'); await this.reload(); } catch (e) { toast(e.message, 'err'); }
        return;
      }
      const op = ev.target.closest('[data-open-task]');
      if (op) {
        const t = s.tasks.find(x => x.id === op.dataset.openTask);
        if (!t || !t.results || !t.results.length) return toast('这个任务还没有成果资产', 'err');
        Viewer.open(t.results.map(a => ({ id: a.id, type: a.type, name: a.name, url: '/api/assets/' + a.id + '/file', thumb: a.thumb_path })), 0, {});
      }
    });
    this.renderDispatchStats();
    this.renderDispatchTable();
    this.renderDispatchCounts();
    this.loadPending();
  },

  /* 下面三个都是「同 HTML 就不动 DOM」—— 轮询时零闪烁 */
  paintIfChanged(sel, html) {
    const n = this.root.querySelector(sel);
    if (!n || n.dataset.sig === html) return;
    n.dataset.sig = html;
    n.innerHTML = html;
  },

  renderDispatchStats() {
    if (!this.root.querySelector('#dwDStats')) return;
    const s = this.state, st = s.drama.stats || {};
    const run = s.tasks.filter(t => t.status === 'queued' || t.status === 'processing');
    const done = s.tasks.filter(t => t.status === 'completed').length;
    const bad = s.tasks.filter(t => t.status === 'failed').length;
    const card = (v, l) => '<div class="stat-card"><div class="stat-value">' + v + '</div><div class="stat-label">' + l + '</div></div>';
    this.paintIfChanged('#dwDStats', card(st.entities || 0, '设定卡') + card(st.shots || 0, '分镜')
      + card(done, '已完成任务') + card(run.length, '进行中') + card(bad, '失败'));
    /* 「停止分析」只对跑批有意义:媒体任务在跑时显示它会让人以为能停出片 */
    const stop = this.root.querySelector('#dwDStop');
    if (stop) stop.classList.toggle('hidden', s.drama.status !== 'analyzing');
  },

  renderDispatchCounts() {
    const s = this.state, st = s.drama.stats || {};
    const pend = s.pending || {};
    const todo = k => ((pend.entities || []).find(x => x.kind === k) || {}).todo || 0;
    const set = (k, text) => {
      const n = this.root.querySelector('[data-batch-sub="' + k + '"]');
      if (n && n.textContent !== text) n.textContent = text;
    };
    set('chars', todo('character') + ' 张待出 / 共 ' + (st.character || 0));
    set('scenes', todo('scene') + ' 张待出 / 共 ' + (st.scene || 0));
    set('shotimg', (pend.image || []).length + ' 镜待出图');
    set('shotvid', (pend.video || []).length + ' 镜可出片(有图或已挂图)');
  },

  renderDispatchTable() {
    const s = this.state;
    const html = s.tasks.length
      ? '<div class="card" style="padding:0;overflow-x:auto"><table class="table"><thead><tr><th>类型</th><th>对象</th><th>状态</th><th>进度</th><th>消耗</th><th>耗时</th><th></th></tr></thead><tbody>'
        + s.tasks.slice(0, 60).map(t => {
          const p = t.params || {};
          const obj = p.drama_shot_id ? ('分镜 ' + p.drama_shot_id.slice(0, 8)) : p.drama_entity_id ? ('设定卡 ' + p.drama_entity_id.slice(0, 8)) : '—';
          const ms = t.finished_at ? (t.finished_at - t.created_at) : 0;
          return '<tr><td>' + (t.type === 'text-to-image' ? icon('image') + '生图' : icon('film') + '出片') + '</td>'
            + '<td class="dim">' + esc(obj) + '</td><td>' + statusBadge(t.status) + '</td>'
            + '<td class="dw-progcell">' + (t.status === 'processing' || t.status === 'queued'
              ? '<span class="dw-mini-bar wide"><i style="width:' + (Number(t.progress) || 0) + '%"></i></span><em>' + (Number(t.progress) || 0) + '%</em>'
              : (t.status === 'completed' ? '<em class="ok">100%</em>' : '—')) + '</td>'
            + '<td>' + (t.cost || 0) + ' 分</td><td class="dim">' + (ms ? (ms / 1000).toFixed(0) + 's' : '—') + '</td>'
            + '<td><div class="table-ops">' + (t.status === 'failed' ? '<button class="btn btn-xs" data-retry="' + t.id + '">' + icon('rotate-ccw') + '重试</button>' : '')
            + (t.results && t.results.length ? '<button class="btn btn-xs" data-open-task="' + t.id + '">' + icon('eye') + '查看</button>' : '')
            + '</div></td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="empty"><div class="empty-ico">' + icon('workflow') + '</div><h3>还没有下发任务</h3><p>上面选一个批次即可;失败可重试,扣的分会自动退</p></div>';
    this.paintIfChanged('#dwDTasks', html);
  },

  /* 待生成清单要跨全剧统计,不能只看已加载的那一页分镜 */
  async loadPending() {
    try {
      this.state.pending = await API.get('/drama/' + this.state.id + '/pending?limit=60');
      this.renderDispatchCounts();
    } catch (e) { /* 计数拿不到不影响按钮可用 */ }
  },

  imageModelName() {
    const o = this.state.opts, d = this.state.drama;
    const id = d.image_model_id || (o.defaults && o.defaults.image);
    const m = o.imageModels.find(x => x.id === id);
    if (!m) return '没有可用生图模型';
    /* 模型名里常自带「(免费)」,价格后缀只在非免费模型上补,免得读出「免费(免费)」 */
    return m.name + (m.is_free || m.name.includes('免费') ? '' : ' ' + m.price_per_image + ' 分/张') + (d.image_model_id ? '' : ' · 自动');
  },
  videoModelName() {
    const o = this.state.opts, d = this.state.drama;
    const id = d.video_model_id || (o.defaults && o.defaults.video);
    const m = o.videoModels.find(x => x.id === id);
    if (!m) return '没有可用视频模型';
    return m.name + (d.video_model_id ? '' : ' · 自动');
  },

  batchBtn(key, ic, label) {
    return '<button class="btn dw-batch" data-batch="' + key + '">' + icon(ic)
      + '<span>' + esc(label) + '<em data-batch-sub="' + key + '">—</em></span></button>';
  },

  async runBatch(key) {
    const s = this.state;
    const pend = s.pending || {};
    if (key === 'chars' || key === 'scenes') {
      const kind = key === 'chars' ? 'character' : 'scene';
      /* 已经定过稿的卡不重复出图 —— 按钮上写的是「待出」,点下去就得对得上这个数 */
      const ids = s.entities.filter(e => e.kind === kind && !e.asset_id).map(e => e.id);
      if (!ids.length) return toast('这类设定卡都已出过图', 'info');
      return this.dispatchEntities(ids);
    }
    if (key === 'shotimg') {
      const ids = (pend.image || []).slice(0, 60);
      if (!ids.length) return toast('分镜静帧都已出图', 'info');
      const r = await this.dispatch({ target: 'shot-image', ids }); if (r) this.afterDispatch(r, '分镜图');
      return;
    }
    if (key === 'shotvid') {
      const ids = (pend.video || []).slice(0, 60);
      if (!ids.length) return toast('没有「已出图待出片」的分镜 —— 先出分镜静帧', 'err');
      const r = await this.dispatch({ target: 'shot-video', ids }); if (r) this.afterDispatch(r, '分镜成片');
    }
  },

  /* ---------- 轮询:分析进度 + 任务实况 ---------- */
  startPolling() {
    const s = this.state;
    this.stopPolling();
    s.polling = setInterval(() => this.tick(), 4000);
  },
  stopPolling() { if (this.state && this.state.polling) { clearInterval(this.state.polling); this.state.polling = null; } },

  async tick() {
    const s = this.state;
    if (!s.id || !s.drama) return;
    const busy = s.drama.status === 'analyzing' || s.tasks.some(t => t.status === 'queued' || t.status === 'processing');
    if (!busy) return;
    /* 有人正在输入、或对话框开着时不要抢重绘 */
    const act = document.activeElement;
    if (act && s.root.contains(act) && /INPUT|TEXTAREA|SELECT/.test(act.tagName)) return;
    if (document.querySelector('.modal-mask, .ctx-menu, .menu-pop:not(.hidden)')) return;
    try {
      const ep = s.ep === null ? '' : ('&episode_no=' + s.ep);
      const res = await API.get('/drama/' + s.id + '?limit=400' + (s.stage === 'shots' ? ep : ''));
      const sig = (res.tasks || []).map(t => t.id + ':' + t.status + ':' + t.progress).join('|')
        + '#' + res.drama.status + ':' + res.drama.progress + ':' + (res.drama.done_episodes || []).length;
      if (sig === s.sig) return;
      s.sig = sig;
      s.drama = res.drama; s.entities = res.entities || []; s.shots = res.shots || [];
      s.shotsTotal = res.shots_total || 0; s.episodes = res.episodes || []; s.tasks = res.tasks || [];
      s.readiness = res.readiness || {};
      this.renderRail();
      if (s.stage === 'shots') { this.renderEps(); this.renderShotList(); }
      else if (s.stage === 'entities') this.renderEntGrid();
      else if (s.stage === 'dispatch') { this.renderDispatchStats(); this.renderDispatchTable(); this.renderDispatchCounts(); }
      else this.renderStage();
    } catch (e) { /* 轮询失败静默,下一次再试 */ }
  },

  /* ---------- 命令面板入口 ---------- */
  actNew() { this.createDrama(); },

  /* 供 ⌘K 直达某阶段 */
  gotoStage(stage) {
    if (!this.state || !this.state.id) return;
    location.hash = '#/workflow/' + this.state.id + '/' + stage;
    this.reload();
  }
};
