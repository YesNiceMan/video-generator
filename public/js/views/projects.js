'use strict';
/* 项目分集：项目列表 + 漫剧创作工作台(分集列表/剧本录入/批量管理/AI 分集) */

/* 十八·3 常见帧率：覆盖电影 / 电视(PAL·NTSC)/ 高帧率等主流规格，
   下拉选项与工作记录恢复校验共用这一份表，新增规格只改这里 */
const COMMON_FPS = [
  { v: 23.976, t: '23.976 fps · 电影 NTSC' },
  { v: 24,     t: '24 fps · 电影标准' },
  { v: 25,     t: '25 fps · PAL / 欧洲电视' },
  { v: 29.97,  t: '29.97 fps · NTSC' },
  { v: 30,     t: '30 fps · 默认' },
  { v: 48,     t: '48 fps · 高帧率' },
  { v: 50,     t: '50 fps · PAL 高清' },
  { v: 60,     t: '60 fps · 流畅' }
];
const isCommonFps = v => COMMON_FPS.some(o => Number(o.v) === Number(v));

const ProjectsView = {
  state: { projects: [], project: null, assets: [] },
  batchMode: false,
  selected: new Set(),
  _query: '',

  async render(root, params) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    if (params.id) {
      App.setImmersive(true);
      if (params.episodeId) return this.renderEpisodeStudio(params.id, params.episodeId);
      return this.renderDetail(params.id);
    }
    const res = await API.get('/projects');
    this.state.projects = res.items;
    this.renderList();
  },

  /* ---------- 项目列表 ---------- */
  renderList() {
    const h = this.root;
    const q = (this._listQuery || '').toLowerCase();
    const matched = q ? this.state.projects.filter(p => ((p.name || '') + ' ' + (p.description || '')).toLowerCase().includes(q)) : this.state.projects;
    /* 26·1:与资产库一致,每页 20 条(测试/协作多项目时列表不再无限拉长) */
    const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    this._projPage = Math.min(Math.max(1, this._projPage || 1), pages);
    const shown = matched.slice((this._projPage - 1) * PAGE_SIZE, (this._projPage - 1) * PAGE_SIZE + PAGE_SIZE);
    h.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <div class="page-eyebrow">${icon('film')} Projects</div>
        <h1 class="page-title">项目分集</h1>
        <p class="page-sub">每个项目是一部剧集；进入项目后在分集列表里逐集做分镜设计与视频生成。</p>
      </div>
      <div class="page-actions">
        <button class="btn" id="joinProjectBtn">${iconText('user-plus', '邀请码加入')}</button>
        <button class="btn btn-primary" id="newProjectBtn">${iconText('plus', '新建项目')}</button>
      </div>
    </div>
    <div class="filters">
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="projSearch" placeholder="搜索项目名称或描述…" value="${esc(this._listQuery || '')}"></div>
      <button class="wb-tbtn" id="projSelectAllBtn" title="选中当前全部可删除项目">${iconText('check-check', '全选')}</button>
      <span class="filters-divider"></span>
      <span class="alib-count">共 <b class="gold-num">${this.state.projects.length}</b> 个项目${q ? ' · 匹配 ' + matched.length : ''}${pages > 1 ? ' · 第 ' + this._projPage + '/' + pages + ' 页' : ''}</span>
      <div class="grow"></div>
    </div>
    <div class="grid grid-cards" id="projGrid"></div>
    <div id="projPager"></div>
    <div class="ast-batchbar hidden" id="projBatchBar">
      <span>已选 <b id="projSelCount">0</b> 个项目</span>
      <button class="btn btn-sm btn-danger" id="projBatchDel">${iconText('trash-2', '删除选中')}</button>
      <button class="btn btn-sm" id="projBatchCancel">取消</button>
    </div>`;

    const grid = h.querySelector('#projGrid');
    if (!this.state.projects.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">${icon('film')}</div><h3>还没有项目</h3><p>创建一部剧集，或用管理员分享的邀请码加入协作</p></div>`;
    } else if (!shown.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">${icon('search-x')}</div><h3>没有匹配的项目</h3><p>换个关键词，或清空搜索查看全部 ${this.state.projects.length} 个项目</p></div>`;
    } else {
      grid.innerHTML = shown.map(p => `
        <div class="card proj-card${this.selected.has(p.id) ? ' sel' : ''}" style="cursor:pointer" data-proj-link="${p.id}">
          <div style="display:flex;align-items:center;gap:var(--sp-2)">
            ${this.canManage(p)
              ? `<span class="asset-check proj-check${this.selected.has(p.id) ? ' on' : ''}" data-proj-check="${p.id}" title="勾选">${icon('check', 'ico-xs')}</span>`
              : ''}
            <div class="proj-card-ico">${icon('clapperboard')}</div>
            <div style="flex:1"></div>
            ${this.canManage(p)
              ? `<span class="proj-code-badge" title="项目邀请码 · 点击复制" data-copy-code="${esc(p.code || '')}">${icon('hash')}${esc(p.code || '')}</span>`
              : '<span class="member-tag">已加入</span>'}
          </div>
          <div style="font-weight:700;font-size:var(--fs-lg);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
          <div style="font-size:var(--fs-sm);color:var(--ink-3);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.description || '暂无描述')}</div>
          <div style="font-size:var(--fs-xs);color:var(--ink-3);display:flex;gap:var(--sp-3)">
            <span><b class="gold-num">${p.episode_count}</b> 分集</span>
            <span>${p.task_count} 任务</span>
          </div>
          ${this.canManage(p)
            ? `<div class="proj-ops">
                <button class="proj-edit-btn" data-proj-edit="${p.id}" title="编辑项目">${icon('pencil', 'ico-xs')}</button>
                <button class="proj-del-btn" data-proj-del="${p.id}" title="删除项目">${icon('trash-2', 'ico-xs')}</button>
              </div>`
            : ''}
        </div>`).join('');
    }

    h.querySelector('#newProjectBtn').addEventListener('click', () => this.newProjectDialog());
    h.querySelector('#joinProjectBtn').addEventListener('click', () => this.joinProjectDialog());
    h.querySelector('#projSearch').addEventListener('input', e => {
      this._listQuery = e.target.value;
      this._projPage = 1;
      /* 只重画列表，避免输入时整页失焦 */
      const keep = e.target;
      this.renderList();
      const next = this.root.querySelector('#projSearch');
      next.value = keep.value; next.focus(); next.setSelectionRange(keep.value.length, keep.value.length);
    });
    grid.querySelectorAll('[data-copy-code]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.copyCode); toast('邀请码已复制：' + b.dataset.copyCode, 'ok'); }
      catch (err) { toast('邀请码：' + b.dataset.copyCode, 'ok'); }
    }));
    grid.querySelectorAll('[data-proj-link]').forEach(card => card.addEventListener('click', e => {
      if (e.target.closest('[data-proj-edit],[data-proj-del],[data-copy-code],[data-proj-check]')) return;
      location.hash = '#/projects/' + card.dataset.projLink;
    }));
    grid.querySelectorAll('[data-proj-edit]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      await this.editProjectDialog(b.dataset.projEdit);
    }));
    grid.querySelectorAll('[data-proj-del]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      await this.deleteProject(b.dataset.projDel);
    }));
    h.querySelector('#projSelectAllBtn').addEventListener('click', () => this.selectAllProjects());
    h.querySelector('#projBatchDel').addEventListener('click', () => this.applyProjBatchDelete());
    h.querySelector('#projBatchCancel').addEventListener('click', () => { this.selected.clear(); this.updateProjBatchBar(); this.renderList(); });
    grid.querySelectorAll('[data-proj-check]').forEach(box => box.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      this.toggleProjSelect(box.dataset.projCheck);
    }));
    renderPager(h.querySelector('#projPager'), {
      page: this._projPage, total: matched.length,
      onPage: p => { this._projPage = p; this.renderList(); }
    });
  },

  /* 仅项目创建者或平台管理员可编辑/删除该项目 */
  canManage(p) {
    return p.my_role === 'owner' || (App && App.user && App.user.role === 'admin');
  },

  /* 编辑自己创建的项目(名称/描述) */
  async editProjectDialog(projectId) {
    const p = this.state.projects.find(x => x.id === projectId);
    if (!p) return toast('项目不存在', 'err');
    const vals = await formModal({
      title: `${icon('pencil', 'ico-sm')} 编辑项目 · ${esc(p.name)}`,
      fields: [
        { key: 'name', label: '项目名称', value: p.name, placeholder: '如： 《山海录》第一季' },
        { key: 'description', label: '项目描述', type: 'textarea', value: p.description || '', placeholder: '选填' }
      ],
      submitText: '保存修改'
    });
    if (vals) {
      await API.patch('/projects/' + projectId, { name: vals.name, description: vals.description });
      toast('项目已更新', 'ok');
      if (window.App && App.refreshProjects) App.refreshProjects();
      const res = await API.get('/projects');
      this.state.projects = res.items;
      this.renderList();
    }
  },

  /* 删除自己创建的项目(终态确认) */
  async deleteProject(projectId) {
    const p = this.state.projects.find(x => x.id === projectId);
    if (!p) return toast('项目不存在', 'err');
    if (!await confirmDlg(`确认删除项目「${p.name}」？分集与场景结构将一并删除(资产文件保留)。`)) return;
    try {
      await API.del('/projects/' + projectId);
      toast('项目已删除', 'ok');
      if (window.App && App.refreshProjects) App.refreshProjects();
      const res = await API.get('/projects');
      this.state.projects = res.items;
      this.renderList();
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 全选：选中当前列表中的全部项目(可删除的) */
  selectAllProjects() {
    const selectable = this.state.projects.filter(p => this.canManage(p));
    this.selected = new Set(selectable.map(p => p.id));
    this.renderList();
    this.updateProjBatchBar();
    toast(`已全选 ${this.selected.size} 个项目`, 'ok');
  },

  /* 切换项目选中状态 */
  toggleProjSelect(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.renderList();
    this.updateProjBatchBar();
  },

  /* 更新项目批量操作浮条 */
  updateProjBatchBar() {
    const bar = document.getElementById('projBatchBar');
    if (!bar) return;
    const show = this.selected.size > 0;
    bar.classList.toggle('hidden', !show);
    const n = document.getElementById('projSelCount');
    if (n) n.textContent = this.selected.size;
  },

  /* 批量删除选中项目 */
  async applyProjBatchDelete() {
    const ids = [...this.selected];
    if (!ids.length) return toast('请先勾选要删除的项目', 'err');
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 个项目？分集与场景结构将一并删除(资产文件保留)。`)) return;
    try {
      const res = await API.post('/projects/batch-delete', { ids });
      if (res.deleted) toast(`已删除 ${res.deleted} 个项目${res.errors ? `,${res.errors} 个失败` : ''}`, res.errors ? 'err' : 'ok');
      else toast('没有可删除的项目', 'err');
      this.selected.clear();
      const pRes = await API.get('/projects');
      this.state.projects = pRes.items;
      this.renderList();
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 通过邀请码加入管理员/房主分享的项目 */
  async joinProjectDialog(codePreset) {
    const vals = await formModal({
      title: `${icon('user-plus', 'ico-sm')} 通过邀请码加入项目`,
      fields: [{ key: 'code', label: '项目邀请码', value: codePreset || '', placeholder: '如 VF-A1B2C3(向项目管理员索取)' }],
      submitText: '加入'
    });
    if (!vals) return;
    try {
      const res = await API.post('/projects/join', { code: vals.code });
      toast(res.as === 'owner' ? '这是你自己创建的项目' : `已加入项目「${res.project.name}」`, 'ok');
      if (window.App && App.refreshProjects) App.refreshProjects();
      location.hash = '#/projects/' + res.project.id;
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 新建项目(26·5):建项目时就定好出片规格 —— 画幅比例 / 分辨率 / 帧率 / 单镜时长。
     此后该项目里新增的分镜都按这套参数初始化,提交生成也据此出片
     (此前项目没有任何规格概念:工作台恒为 30fps / 16:9,本地渲染又恒为 1280×720) */
  async newProjectDialog() {
    let cfg = null;
    try { cfg = await API.get('/config'); } catch (e) { cfg = null; }
    const resolutions = (cfg && Array.isArray(cfg.videoResolutions) && cfg.videoResolutions.length)
      ? cfg.videoResolutions : ['480p', '720p', '960p', '2k'];
    const ratios = (cfg && Array.isArray(cfg.aspectRatios) && cfg.aspectRatios.length)
      ? cfg.aspectRatios : VIDEO_RATIOS.map(r => r.v);
    const fpsList = (cfg && Array.isArray(cfg.fpsOptions) && cfg.fpsOptions.length)
      ? cfg.fpsOptions : COMMON_FPS.map(o => o.v);
    const ratioLabel = r => (VIDEO_RATIOS.find(x => x.v === r) || {}).t || r;
    const fpsLabel = f => (COMMON_FPS.find(o => Number(o.v) === Number(f)) || {}).t || (f + ' fps');
    const durOpts = Array.from({ length: 13 }, (_, i) => i + 3).map(d => ({ value: String(d), label: d === 10 ? '10s · 默认' : d + 's' }));
    const vals = await formModal({
      title: '新建项目',
      size: 'modal-md',
      fields: [
        { key: 'name', label: '项目名称', placeholder: '如： 《山海录》第一季', value: '' },
        { key: 'description', label: '项目描述', type: 'textarea', placeholder: '选填', value: '' },
        { key: 'aspect_ratio', label: '画幅比例', type: 'select', value: '16:9',
          options: ratios.map(r => ({ value: r, label: ratioLabel(r) })) },
        { key: 'resolution', label: '分辨率', type: 'select',
          value: resolutions.includes('720p') ? '720p' : resolutions[0],
          options: resolutions.map(r => ({ value: r, label: videoResLabel(r) })) },
        { key: 'fps', label: '帧率', type: 'select', value: '30',
          options: fpsList.map(f => ({ value: String(f), label: fpsLabel(f) })) },
        { key: 'shot_duration', label: '单镜默认时长', type: 'select', value: '10', options: durOpts,
          hint: '新增分镜的初始时长与帧率/画幅都会带上;进入分镜后仍可逐镜调整' }
      ],
      submitText: '创建'
    });
    if (vals) {
      const { project } = await API.post('/projects', vals);
      toast(`项目已创建 · 出片规格 ${project.resolution || '720p'} / ${project.aspect_ratio || '16:9'} / ${project.fps || 30}fps`, 'ok');
      if (window.App && App.refreshProjects) App.refreshProjects();
      location.hash = '#/projects/' + project.id;
    }
  },

  /* ---------- 项目详情(漫剧创作工作台) ---------- */
  async renderDetail(id) {
    const [projRes, assetsRes] = await Promise.all([
      API.get('/projects/' + id), API.get('/assets?type=all&folder_id=root')
    ]);
    this.state.project = projRes.project;
    this.state.assets = assetsRes.items;
    this.batchMode = false;
    this.selected.clear();
    this._query = '';
    this.renderWorkbench();
  },

  /* ============================================================
     分镜设计工作台：点击分集进入 → 视频生成(模型 / 风格 / 融生视频)
     ============================================================ */
  studio: null,

  async renderEpisodeStudio(projectId, episodeId) {
    const [projRes, modelsRes, stylesRes, assetsRes, stateRes, cfgRes] = await Promise.all([
      API.get('/projects/' + projectId),
      API.get('/styles/models'),
      API.get('/styles'),
      API.get('/assets?type=all'), /* 不再限定根目录：全部资产(含子文件夹)都可链接/引用 */
      API.get('/episodes/' + episodeId + '/studio').catch(() => ({ state: null, saved_at: null })),
      /* 第二十轮：生成视频尺寸由后台「系统设置 → 生成视频尺寸」下发(480p/720p/960p/2k 勾选) */
      API.get('/config').catch(() => null)
    ]);
    const project = projRes.project;
    const episode = project.episodes.find(e => e.id === episodeId);
    if (!episode) { toast('分集不存在', 'err'); location.hash = '#/projects/' + projectId; return; }
    this.state.project = project; // 供 settingsDialog / exportDialog 复用
    /* 第二十五轮：生图模型(text-to-image)不进视频模型下拉，单列 imgModels 供「AI 生图」使用 */
    const models = modelsRes.items.filter(m => m.enabled !== 0 && m.type !== 'text-to-image');
    const imgModels = modelsRes.items.filter(m => m.enabled !== 0 && m.type === 'text-to-image');
    /* 后台下发的生成尺寸白名单与默认档(接口异常时用兜底值) */
    const resolutions = (cfgRes && Array.isArray(cfgRes.videoResolutions) && cfgRes.videoResolutions.length)
      ? cfgRes.videoResolutions : ['480p', '720p', '960p', '2k'];
    const defaultResolution = (cfgRes && cfgRes.defaultResolution) || '720p';
    /* 26·5:项目设定的出片规格 → 该项目新增分镜的初始参数(非法值回退到平台默认) */
    const spec = {
      fps: COMMON_FPS.some(o => Number(o.v) === Number(project.fps)) ? Number(project.fps) : 30,
      ratio: VIDEO_RATIOS.some(r => r.v === project.aspect_ratio) ? project.aspect_ratio : '16:9',
      resolution: resolutions.includes(project.resolution) ? project.resolution
        : (resolutions.includes(defaultResolution) ? defaultResolution : resolutions[0]),
      duration: Math.min(15, Math.max(3, Math.round(Number(project.shot_duration) || 10)))
    };
    this.studio = {
      projectId, episodeId, project, episode,
      models, imgModels, styles: stylesRes.items,
      assets: assetsRes.items,
      refs: [], shots: [], tasks: [],
      tab: 'storyboard', leftCollapsed: false, recsCollapsed: false,
      selRef: null,
      resolutions, defaultResolution, spec,
      /* 第二十五轮：生图每张积分(供快捷生图弹窗计价展示) */
      imgPrice: (cfgRes && cfgRes.creditPerImage != null) ? cfgRes.creditPerImage : 2,
      taskSig: '', pollTimer: null, uidSeed: 0,
      renderedOnce: false, dirty: false, saveTimer: null
    };
    await CreditCenter.refresh();
    if (this.studio && this.studio.imgPrice != null) CreditCenter.imgPrice = this.studio.imgPrice;
    /* 恢复上次保存的工作记录(分镜文案/参数/任务关联/参考资产),实现"工作记录后保存" */
    const saved = stateRes && stateRes.state;
    if (saved && Array.isArray(saved.shots) && saved.shots.length) {
      const spec = this.studio.spec;
      for (const rs of saved.shots) {
        const sh = this.newShot(this.studio.shots.length + 1);
        sh.title = String(rs.title || sh.title).slice(0, 80);
        sh.script = String(rs.script || '');
        /* 载入时只放开到平台硬边界,具体范围由 snapShotSpec 按所选模型收敛(如百炼 2–30s) */
        sh.duration = Math.min(120, Math.max(1, Number(rs.duration) || spec.duration));
        sh.neg = String(rs.neg || '');
        sh.modelId = models.some(m => m.id === rs.modelId) ? rs.modelId : sh.modelId;
        sh.styleId = this.studio.styles.some(x => x.id === rs.styleId) ? rs.styleId : '';
        sh.tab = 'fusion';
        /* 工作记录里的历史值可能不在当前名单内(改过项目设置 / 后台收过尺寸白名单) → 回退项目规格 */
        sh.fps = isCommonFps(rs.fps) ? Number(rs.fps) : spec.fps;
        this.snapShotFps(sh);
        sh.motion = Math.min(1, Math.max(0, Number(rs.motion) || 0.6));
        sh.seed = Number.isFinite(Number(rs.seed)) ? Number(rs.seed) : -1;
        sh.ratio = VIDEO_RATIOS.some(r => r.v === rs.ratio) ? rs.ratio : spec.ratio;
        sh.resolution = this.studio.resolutions.includes(rs.resolution) ? rs.resolution : spec.resolution;
        sh.taskIds = Array.isArray(rs.taskIds) ? rs.taskIds.filter(x => typeof x === 'string').slice(0, 50) : [];
        sh.collapsed = !!rs.collapsed;
        sh.recsCollapsed = typeof rs.recsCollapsed === 'boolean' ? rs.recsCollapsed : !!(saved && saved.recsCollapsed);
        this.studio.shots.push(sh);
      }
    }
    if (saved && Array.isArray(saved.refs)) {
      for (const r of saved.refs.slice(0, 60)) {
        const rid = r && r.id;
        const a = rid ? this.studio.assets.find(x => x.id === rid) : null;
        if (a && !this.studio.refs.some(x => x.id === a.id)) this.studio.refs.push({ ...a, refType: (r && r.refType) || '' });
      }
    }
    if (!this.studio.shots.length) this.studio.shots.push(this.newShot(1));
    if (saved && saved.selRefId) this.studio.selRef = this.studio.refs.find(r => r.id === saved.selRefId) || null;
    if (!this.studio.selRef && this.studio.refs.length) this.studio.selRef = this.studio.refs[0];
    if (saved && saved.tab === 'edit') this.studio.tab = 'edit';
    if (saved && typeof saved.leftCollapsed === 'boolean') this.studio.leftCollapsed = saved.leftCollapsed;
    this.studio.recsCollapsed = !!(saved && saved.recsCollapsed);

    this.renderStudioShell();
    this.startStudioPolling();
    /* 离开页面兜底保存 */
    this._onBeforeUnload = () => { if (this.studio && this.studio.dirty) this.flushStudioSave(true); };
    window.addEventListener('beforeunload', this._onBeforeUnload);
    this.setSaveState('saved', stateRes && stateRes.saved_at);
    return () => {
      this.stopStudioPolling();
      this.flushStudioSave();
      if (this._onBeforeUnload) { window.removeEventListener('beforeunload', this._onBeforeUnload); this._onBeforeUnload = null; }
      clearTimeout(this.studio && this.studio.saveTimer);
      if (this._focusOutBound) { document.removeEventListener('focusout', this._onStudioFocusOut); this._focusOutBound = false; }
      this._studioRenderPending = false;
      this.studio = null;
    };
  },

  /* ---------- 工作记录自动保存 ----------
     分镜增删/文案输入/参数调整/参考资产变更都会置脏并防抖保存到服务端 */
  markDirty() {
    const s = this.studio; if (!s) return;
    s.dirty = true;
    this.setSaveState('pending');
    clearTimeout(s.saveTimer);
    s.saveTimer = setTimeout(() => this.saveStudioState(), 900);
  },

  studioPayload() {
    const s = this.studio;
    return {
      v: 1,
      tab: s.tab,
      selRefId: s.selRef ? s.selRef.id : null,
      refs: s.refs.map(r => ({ id: r.id, refType: r.refType || '' })),
      leftCollapsed: !!s.leftCollapsed,
      recsCollapsed: !!s.recsCollapsed,
      shots: s.shots.map(sh => ({
        title: sh.title, script: sh.script, duration: sh.duration, neg: sh.neg,
        modelId: sh.modelId, styleId: sh.styleId, tab: sh.tab, fps: sh.fps, motion: sh.motion, seed: sh.seed,
        ratio: sh.ratio, resolution: sh.resolution,
        collapsed: !!sh.collapsed,
        recsCollapsed: !!sh.recsCollapsed,
        taskIds: sh.taskIds
      }))
    };
  },

  setSaveState(st, ts) {
    const n = document.getElementById('wsSaveState');
    const map = {
      idle: '自动保存已开启',
      pending: '有未保存更改 · 点击立即保存',
      saving: '正在保存工作记录…',
      saved: ts ? ('工作记录已保存 · ' + fmtTime(ts)) : '工作记录已保存',
      error: '保存失败 · 点击重试'
    };
    if (this.studio) this.studio._saveUi = { st, ts };
    if (!n) return;
    n.textContent = map[st] || '';
    n.dataset.state = st;
  },

  async saveStudioState() {
    const s = this.studio; if (!s) return;
    clearTimeout(s.saveTimer); s.saveTimer = null;
    const payload = { state: this.studioPayload() };
    s.dirty = false;
    this.setSaveState('saving');
    try {
      const res = await API.request('PUT', '/episodes/' + s.episodeId + '/studio', payload);
      if (this.studio === s) this.setSaveState('saved', res.saved_at || Date.now());
    } catch (e) {
      if (this.studio === s) { s.dirty = true; this.setSaveState('error'); }
    }
  },

  /* 视图卸载/关闭页面时的尽力保存：sendBeacon 或 keepalive fetch */
  flushStudioSave(useBeacon) {
    const s = this.studio; if (!s) return;
    clearTimeout(s.saveTimer); s.saveTimer = null;
    if (!s.dirty) return;
    s.dirty = false;
    try {
      const json = JSON.stringify({ state: this.studioPayload() });
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/episodes/' + s.episodeId + '/studio', new Blob([json], { type: 'application/json' }));
      } else {
        fetch('/api/episodes/' + s.episodeId + '/studio', {
          method: 'PUT', keepalive: true, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: json
        }).catch(() => {});
      }
    } catch (e) { /* 忽略 */ }
  },

  /* 26·5 + 26·9:分镜的参数档位一律跟随「所选模型」声明的清单 ——
     模型 params_schema 限定了帧率 / 画幅比例,rules.limits 限定了固定输出档时,
     下拉就只给这些值,并把分镜现值收敛进去;否则用户选了不被支持的档位,
     服务端只会静默吸附(设了却没用),正是本轮要消灭的观感。 */
  fpsOptionsOf(model) {
    const d = ((model && model.params_schema) || []).find(x => x && x.key === 'fps' && Array.isArray(x.options) && x.options.length);
    if (!d) return COMMON_FPS;
    return d.options.map(f => ({ v: f, t: (COMMON_FPS.find(o => Number(o.v) === Number(f)) || {}).t || (f + ' fps') }));
  },
  ratioOptionsOf(model) {
    const d = ((model && model.params_schema) || []).find(x => x && (x.key === 'aspect_ratio' || x.key === 'ratio')
      && Array.isArray(x.options) && x.options.length);
    if (!d) return VIDEO_RATIOS;
    return d.options.map(r => ({ v: String(r), t: (VIDEO_RATIOS.find(x => x.v === String(r)) || {}).t || String(r) }));
  },
  /* 分辨率:模型固定输出档(rules.limits.fixed_size)> 模型 params_schema 声明的档位清单
     > rules.limits.resolutions > 平台白名单 —— 与帧率/画幅同一套「跟随模型」口径 */
  resolutionOptionsOf(model) {
    const base = (this.studio && this.studio.resolutions) || ['480p', '720p', '960p', '2k'];
    const lim = (model && model.rules && model.rules.limits) || {};
    const fixed = String(lim.fixed_size || '').trim();
    if (fixed) return [fixed.toLowerCase()];
    const d = ((model && model.params_schema) || []).find(x => x && x.key === 'resolution' && Array.isArray(x.options) && x.options.length);
    if (d) return d.options.map(v => String(v).toLowerCase());
    if (Array.isArray(lim.resolutions) && lim.resolutions.length) {
      const allow = lim.resolutions.map(x => String(x).toLowerCase());
      const hit = base.filter(v => allow.includes(String(v).toLowerCase()));
      if (hit.length) return hit;
    }
    return base;
  },
  shotModelOf(sh) {
    const s = this.studio;
    return (s && s.models || []).find(m => m.id === sh.modelId) || null;
  },
  snapShotSpec(sh) {
    const s = this.studio; if (!s || !sh) return;
    const model = this.shotModelOf(sh);
    const fpsOpts = this.fpsOptionsOf(model);
    if (!fpsOpts.some(o => Number(o.v) === Number(sh.fps))) sh.fps = Number(fpsOpts[0].v);
    const ratioOpts = this.ratioOptionsOf(model);
    if (!ratioOpts.some(o => o.v === String(sh.ratio))) sh.ratio = String(ratioOpts[0].v);
    const resOpts = this.resolutionOptionsOf(model);
    if (!resOpts.some(v => v === String(sh.resolution))) sh.resolution = String(resOpts[0]);
    /* 时长同样收敛到模型声明范围(如百炼 2–30s),否则选了会被服务端改掉 */
    const durDef = ((model && model.params_schema) || []).find(x => x && x.key === 'duration' && x.min != null && x.max != null);
    if (durDef) {
      const lo = Number(durDef.min), hi = Number(durDef.max);
      const cur = Number(sh.duration);
      if (Number.isFinite(cur) && (cur < lo || cur > hi)) sh.duration = Math.min(Math.max(cur, lo), hi);
    }
  },
  /* 兼容旧调用点 */
  snapShotFps(sh) { this.snapShotSpec(sh); },

  newShot(idx) {
    const m = (this.studio.models[0] || {}).id || '';
    const s = this.studio;
    const sp = s.spec || { fps: 30, ratio: '16:9', resolution: s.defaultResolution, duration: 10 };
    // 如果已有分镜，复制上一个分镜的参数(除文案外);第一个分镜用项目设定的出片规格
    const prev = s.shots.length > 0 ? s.shots[s.shots.length - 1] : null;
    const sh = {
      key: 'shot-' + (++this.studio.uidSeed),
      title: '新分镜 ' + idx,
      script: '', duration: prev ? prev.duration : sp.duration, neg: '',
      /* 复制上一镜的模型时校验其仍在可用列表，避免把失效值带进新分镜 */
      modelId: (prev && s.models.some(x => x.id === prev.modelId)) ? prev.modelId : m,
      styleId: prev ? prev.styleId : '',
      tab: 'fusion',
      fps: prev ? prev.fps : sp.fps, motion: prev ? prev.motion : 0.6, seed: prev ? prev.seed : -1,
      ratio: prev ? prev.ratio : sp.ratio,
      resolution: (prev && this.studio.resolutions.includes(prev.resolution)) ? prev.resolution : sp.resolution,
      taskIds: [], tasks: [],
      collapsed: false, recsCollapsed: false
    };
    this.snapShotFps(sh);
    return sh;
  },

  getShot(key) { return (this.studio.shots || []).find(sh => sh.key === key); },

  /* ---------- 外壳：顶栏回答"我在哪一集",页面工具行承载动作与读数 ----------
     v4:取消 ws-nav(重复的品牌/账号/退出),顶栏由 App.setContext 接管 */
  renderStudioShell() {
    const s = this.studio;
    const nn = String(s.episode.order_index + 1).padStart(2, '0');
    App.setContext({
      back: { href: '#/projects/' + s.projectId, label: '分集列表' },
      eyebrow: `EP ${nn} · ${s.project.name || '未命名项目'}`,
      title: this.epMainTitle(s.episode),
      tabs: [
        { key: 'storyboard', label: '分镜设计', icon: 'layout-template', active: s.tab === 'storyboard' },
        { key: 'edit', label: '剪辑预览', icon: 'monitor-play', active: s.tab === 'edit' }
      ]
    });
    /* 顶栏标签点击 → 只重画主体，不整页重绘 */
    document.querySelectorAll('#ctxTabs .ctx-tab').forEach((b, i) => {
      b.addEventListener('click', () => {
        const key = i === 0 ? 'storyboard' : 'edit';
        if (!this.studio || this.studio.tab === key) return;
        this.studio.tab = key;
        this.markDirty();
        this.renderStudioBody();
      });
    });

    this.root.innerHTML = `
    <div class="ws" id="wsRoot">
      <div class="ws-bar" id="wsBar"></div>
      <div class="ws-body" id="wsBody"></div>
      <div class="ws-foot">
        <button class="ws-add-shot" data-ws-action="addshot">${iconText('plus', '追加新分镜')}</button>
      </div>
    </div>`;
    this.renderStudioBody();
    this.bindStudioEvents();
  },

  /* 工具行：读数 + 本集动作 + 列表控制 + 保存状态 */
  renderStudioBar() {
    const s = this.studio;
    const bar = this.root.querySelector('#wsBar');
    if (!bar) return;
    const running = s.shots.reduce((n, sh) => n + (sh.tasks || []).filter(t => t.status === 'queued' || t.status === 'processing').length, 0);
    const allCollapsed = s.shots.every(x => x.collapsed);
    bar.innerHTML = `
      <span class="ws-bar-count">分镜 <b class="mbar-num">${String(s.shots.length).padStart(2, '0')}</b></span>
      ${running ? '<span class="mbar-running">' + icon('loader', 'ico-xs') + '生成中 ' + running + '</span>' : ''}
      <span class="mbar-hint">${icon('keyboard', 'ico-xs')} Ctrl+Enter 快速生成</span>
      <span class="ctx-spacer"></span>
      <button class="ws-tbtn" data-ws-action="script" title="编辑本集剧本文案">${icon('file-text', 'ico-xs')}<span>录入原文</span></button>
      <button class="ws-tbtn" data-ws-action="review" title="查看本集全部生成任务">${icon('clapperboard', 'ico-xs')}<span>批量审片</span></button>
      <button class="ws-tbtn" data-ws-action="log" title="查看提交记录与异常">${icon('scroll-text', 'ico-xs')}<span>工作日志</span></button>
      <button class="ws-tbtn" data-ws-action="supply" title="上传素材入库">${icon('upload', 'ico-xs')}<span>补给资产</span></button>
      <button class="ws-tbtn" data-ws-action="aiimg" title="AI 生图：生成图片并入参考资产">${icon('image-plus', 'ico-xs')}<span>AI 生图</span></button>
      <span class="filters-divider"></span>
      <button class="ws-tbtn" data-ws-action="reccollapse" title="折叠/展开全部生成记录(进行中的任务保持展开)">${s.recsCollapsed ? icon('eye', 'ico-xs') + '<span>展开记录</span>' : icon('eye-off', 'ico-xs') + '<span>折叠记录</span>'}</button>
      ${allCollapsed
        ? `<button class="ws-tbtn" data-ws-action="expandall" title="展开全部分镜">${icon('chevrons-down-up', 'ico-xs')}<span>全部展开</span></button>`
        : `<button class="ws-tbtn" data-ws-action="collapseall" title="折叠全部分镜">${icon('chevrons-up-down', 'ico-xs')}<span>全部折叠</span></button>`}
      <span class="filters-divider"></span>
      <span class="ws-save-state" id="wsSaveState" data-state="idle" title="工作记录会自动保存到服务器；点击可立即保存">自动保存已开启</span>`;
    const st = bar.querySelector('#wsSaveState');
    st.addEventListener('click', () => {
      if (this.studio && (this.studio.dirty || st.dataset.state === 'error')) this.saveStudioState();
    });
    /* 工具行会随轮询重建，保存状态要跟着复原，否则会退回"自动保存已开启" */
    if (s._saveUi) this.setSaveState(s._saveUi.st, s._saveUi.ts);
  },

  renderStudioBody() {
    const body = this.root.querySelector('#wsBody');
    if (!body) return;
    const s = this.studio;
    /* 轮询重渲染前记住滚动位置，避免任务进度刷新时列表跳动 */
    const prevMain = body.querySelector('.ws-main');
    const scrollTop = prevMain ? prevMain.scrollTop : 0;
    this.renderStudioBar();
    body.innerHTML = s.tab === 'storyboard' ? this.storyboardHTML() : this.editPreviewHTML();
    /* 入场动画只在首次进入时播放；之后的重渲染(轮询/切参)不再重放，
       否则多分镜时会看到"只有中间分镜在滑"的错觉 */
    if (s.renderedOnce) body.classList.add('no-anim');
    else s.renderedOnce = true;
    if (s.tab === 'storyboard') {
      const main = body.querySelector('.ws-main');
      if (main && scrollTop) main.scrollTop = scrollTop;
      /* 每个分镜的剧本文案启用 [占位符] 自动链接 + 高亮 + 已链接资源 chips
         二十二·1:参考资产门控 —— 仅左侧「参考资产」可被 [占位符] 引用，
         资产库同名但未引入的一律按未链接渲染，悬停提示先引入再引用 */
      body.querySelectorAll('[data-shot-script]').forEach(ta => {
        const shot = this.getShot(ta.dataset.shotScript);
        attachPlaceholderLinker(ta, () => (this.studio && this.studio.refs) || [], () => (this.studio && this.studio.assets) || []);
        if (shot) ta.value = shot.script || '';
        ta._pl.refresh();
        ta._pl.onChange(linked => this.renderShotChips(ta.dataset.shotScript, linked));
        this.renderShotChips(ta.dataset.shotScript, ta._pl.getLinked());
        /* 点击 [占位符] 高亮 → 左侧参考资产闪动提示 */
        ta.addEventListener('pl-token-click', ev => {
          const ids = ev.detail && ev.detail.assetIds;
          if (!ids || !ids.length) return;
          this.flashRefs(ids);
        });
      });
      this.updateShotCostHints();
    }
    /* 重绘完成后再接上延后重投的倒计时(节点在 DOM 里才谈得上逐秒更新) */
    this.syncWaitTicker();
  },

  /* 分镜下方"已链接资源"chips(带签名去重，避免轮询重绘闪烁)
     二十二·1:chips 与提示只来自参考资产；二十二·2:点击 chips 放大查看 */
  renderShotChips(key, linked) {
    const box = this.root.querySelector('[data-shot-pl="' + key + '"]');
    if (!box) return;
    const refs = (this.studio && this.studio.refs) || [];
    const sig = (linked || []).map(a => a.id).join(',') + '|' + refs.map(r => r.id).join(',');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    renderPlaceholderChips(box, linked || [], refs, name => {
      const ta = this.root.querySelector('[data-shot-script="' + key + '"]');
      if (ta && ta._pl) { ta._pl.insertToken(name); this.markDirty(); }
    }, a => this.openAssetPreview(a));
  },

  /* 二十二·2 放大查看 / 二十九轮统一：点击提示词下方引用 chips 与左侧参考资产
     → 全站统一成果查看器(左侧参考资产列表即翻页上下文，← → 直接切换) */
  viewerItemOf(a, tag) {
    return {
      id: a.id, name: a.name || '未命名', type: a.type || 'image',
      url: a.url,
      poster: a.type === 'video' && a.thumb_path ? '/api/assets/' + a.id + '/thumbnail' : undefined,
      width: a.width, height: a.height, size: a.size, duration: a.duration,
      created_at: a.created_at, tag: tag
    };
  },

  openAssetPreview(asset) {
    if (!asset) return;
    const s = this.studio;
    if (!s || !s.refs.length) return;
    const items = s.refs.map(r => this.viewerItemOf(r, '已加入参考资产' + (r.refType ? ' · ' + r.refType : '')));
    const idx = Math.max(0, s.refs.findIndex(r => r.id === asset.id));
    openViewer(items, idx);
  },

  /* 点击文案中的 [占位符] 链接 → 左侧对应参考资产闪动高亮 + 自动滚动可见(链接来源显示) */
  flashRefs(ids) {
    if (!this.studio) return;
    const items = this.root.querySelectorAll('[data-ref-sel]');
    let matched = 0;
    items.forEach((it, i) => {
      const id = it.dataset.refSel;
      if (!ids.includes(id)) return;
      matched++;
      setTimeout(() => {
        it.classList.remove('ref-flash-item');
        void it.offsetWidth;
        it.classList.add('ref-flash-item');
        setTimeout(() => it.classList.remove('ref-flash-item'), 1200);
        const list = it.closest('.ws-ref-list');
        if (list && it.scrollIntoView) it.scrollIntoView({ block: 'nearest' });
      }, i * 120);
    });
    /* 若无匹配，提示该占位符链接的来源不在当前参考列表 */
    if (!matched) {
      const first = this.root.querySelector('.ws-ref-list [data-ref-sel]');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    }
  },

  /* 第二十三轮：模型 params_schema 限定时长范围时把显示时长收敛到范围内，
     与后端提交时的 clamp 完全一致 —— 杜绝「显示 30 实扣 50」的计价偏差 */
  effDuration(model, duration) {
    let dur = Math.max(1, Math.round(Number(duration) || 5));
    try {
      const def = ((model && model.params_schema) || []).find(x => x && x.key === 'duration');
      if (def) dur = Math.min(def.max ?? 60, Math.max(def.min ?? 1, dur));
    } catch (e) { /* schema 异常时按原时长显示 */ }
    return dur;
  },

  updateShotCostHints() {
    const s = this.studio;
    if (!s) return;
    s.shots.forEach(sh => {
      const el = document.querySelector(`[data-shot-cost="${sh.key}"]`);
      if (!el) return;
      const model = s.models.find(m => m.id === sh.modelId);
      if (!model) {
        el.className = 'cost-hint insufficient';
        el.innerHTML = `${icon('triangle-alert', 'ico-xs')} 模型不可用 · 请重新选择`;
        return;
      }
      const dur = this.effDuration(model, sh.duration);
      const cost = CreditCenter.costFor(dur, model);
      if (cost === 0) { el.className = 'cost-hint free'; el.innerHTML = `${icon('gift', 'ico-xs')} 免费`; }
      else if ((CreditCenter.cache.balance || 0) < cost) { el.className = 'cost-hint insufficient'; el.innerHTML = `${icon('coins', 'ico-xs')} 需 ${cost} 分 · 余额不足`; }
      else { el.className = 'cost-hint'; el.innerHTML = `${icon('coins', 'ico-xs')} ${dur}s · ${cost} 积分`; }
    });
  },

  /* ---------- 分镜设计：左参考资产 · 右分镜创作(卡内「参数左 / 创作右」双栏) ---------- */
  storyboardHTML() {
    const s = this.studio;
    const folded = s.leftCollapsed ? ' folded' : '';
    return `
    <aside class="ws-left${folded}">
      <div class="ws-ref">
        <div class="ws-ref-head">
          <span class="ws-ref-kicker">REFERENCE</span>
          <span class="ws-ref-title">融合参考资产</span>
          <span class="ws-ref-head-right"><span class="ws-ref-count">${s.refs.length}</span>
          <button class="ws-ref-fold" data-ws-action="toggleleft" title="折叠参考资产面板">${icon('chevrons-left', 'ico-xs')}</button></span>
        </div>
        <div class="ws-ref-quick">
          <button data-ref-pick="角色">${icon('user-round', 'ico-xs')}<span>角色</span></button>
          <button data-ref-pick="场景">${icon('mountain', 'ico-xs')}<span>场景</span></button>
          <button data-ref-pick="物品">${icon('gem', 'ico-xs')}<span>物品</span></button>
          <button data-ref-pick="分镜">${icon('layout-template', 'ico-xs')}<span>分镜</span></button>
          <button data-ref-pick="音频">${icon('audio-lines', 'ico-xs')}<span>音频</span></button>
          <button data-ref-pick="视频">${icon('clapperboard', 'ico-xs')}<span>视频</span></button>
        </div>
        <button class="ws-ref-frame" data-ws-action="frame">${iconText('play', '引入视频帧')}</button>
        <div class="ws-ref-list" data-ref-list>
          ${s.refs.length
            ? s.refs.map(r => this.refItemHTML(r)).join('')
            : '<button class="ws-ref-empty" data-ref-pick="角色">暂无参考资产<br><span>点击上方分类或此处，从资产库多选引入</span></button>'}
        </div>
      </div>
      <button class="ws-left-open" data-ws-action="toggleleft" title="展开参考资产面板">
        <span class="ws-left-open-ico">${icon('chevrons-right', 'ico-sm')}</span>
        <span class="ws-left-open-count" title="已引入 ${s.refs.length} 项参考资产">${s.refs.length}</span>
        <span class="ws-left-open-label">参考资产</span>
      </button>
    </aside>
    <main class="ws-main">
      ${s.shots.map(sh => this.shotCardHTML(sh)).join('')}
    </main>`;
  },

  refItemHTML(r) {
    const s = this.studio;
    const sel = s.selRef && s.selRef.id === r.id;
    const thumb = r.type === 'image'
      ? `<img src="/api/assets/${r.id}/file">`
      : r.type === 'video'
        ? `<img src="/api/assets/${r.id}/thumbnail">`
        : `<div class="ws-ref-ico">${icon('music')}</div>`;
    const tag = r.refType ? `<span class="ws-ref-tag">${esc(r.refType)}</span>` : '';
    /* 用 div 而非 button 作为容器：内部还要放"移除"按钮，避免按钮嵌套
       二十二·2:卡片右下角常驻放大镜角标，点击整卡即放大查看 */
    return `<div class="ws-ref-item${sel ? ' sel' : ''}" data-ref-sel="${r.id}" title="${esc(r.name)} · 单击选中（右侧分镜闪动提示），点右下角放大镜看大图">
      ${thumb}<span class="ws-ref-name">${esc(r.name)}</span>${tag}
      <span class="ws-ref-zoom" data-ref-zoom="${r.id}" title="放大查看">${icon('zoom-in', 'ico-xs')}</span>
      <button class="ws-ref-del" data-ref-del="${r.id}" title="移除该参考资产">${icon('x', 'ico-xs')}</button>
    </div>`;
  },

  /* 移除左侧参考资产 */
  removeRef(id) {
    const s = this.studio; if (!s) return;
    const idx = s.refs.findIndex(r => r.id === id);
    if (idx < 0) return;
    const name = s.refs[idx].name;
    s.refs.splice(idx, 1);
    if (s.selRef && s.selRef.id === id) s.selRef = s.refs[0] || null;
    toast('已移除参考资产：' + name, 'ok');
    this.markDirty();
    this.renderStudioBody();
  },

  /* 点击左侧资产 → 右侧分镜卡片依次闪动提示(问题8) */
  flashShots() {
    const cards = this.root.querySelectorAll('[data-shot-card]');
    cards.forEach((c, i) => {
      setTimeout(() => {
        c.classList.remove('ref-flash');
        void c.offsetWidth; /* 重启动画 */
        c.classList.add('ref-flash');
        setTimeout(() => c.classList.remove('ref-flash'), 900);
      }, i * 90);
    });
  },

  /* 分镜卡片：头部(编号 + 行内标题 + 操作) + 双栏主体(左创作 / 右参数) + 生成记录 */
  shotCardHTML(sh) {
    const s = this.studio;
    const idx = s.shots.indexOf(sh);
    const collapsed = !!sh.collapsed;
    const first = idx === 0, last = idx === s.shots.length - 1;
    const modelOpts = s.models.map(m => `<option value="${m.id}" ${sh.modelId === m.id ? 'selected' : ''}>${esc(m.name)} (${esc(m.version)})</option>`).join('');
    const styleOpts = '<option value="">不套用风格</option>' + s.styles.map(st => `<option value="${st.id}" ${sh.styleId === st.id ? 'selected' : ''}>${esc(st.name)}</option>`).join('');
    const toggleIco = collapsed ? 'chevrons-down-up' : 'chevrons-up-down';
    const toggleTitle = collapsed ? '展开该分镜' : '折叠该分镜';
    /* 十七·6:规格四项(画幅比例 / 分辨率 / 帧率 / 时长)统一下拉，2×2 两行两列
       —— 单行四列在 300px 参数栏里每格不足 70px 过于拥挤，放宽为每行两项；
       沿用 change 事件委托(select.value 即参数值),时长 3-15s 整档可选(10s 标注默认) */
    const mkSel = (attr, options) => '<select class="ws-select ws-select-sm" data-shot-' + attr + '="' + sh.key + '">' +
      options.map(o => '<option value="' + o.v + '"' + (String(sh[attr]) === String(o.v) ? ' selected' : '') + '>' + o.t + '</option>').join('') + '</select>';
    const spec = s.spec || { fps: 30, ratio: '16:9', resolution: s.defaultResolution, duration: 10 };
    const shModel = this.shotModelOf(sh);
    const durDef = ((shModel && shModel.params_schema) || []).find(x => x && x.key === 'duration' && x.min != null && x.max != null);
    const dMin = durDef ? Math.max(1, Number(durDef.min) || 3) : 3;
    const dMax = durDef ? Math.min(120, Number(durDef.max) || 15) : 15;
    const durOpts = [];
    for (let v = dMin; v <= dMax; v++) durOpts.push({ v, t: v === spec.duration ? v + 's · 项目默认' : v + 's' });
    if (!durOpts.length) durOpts.push({ v: dMin, t: dMin + 's' });
    /* 档位清单一律跟随所选模型(26·9):分辨率项 title 里带上换算后的成片尺寸,选完就知道出多大;
       模型固定输出(如 Agnes Flash 只有 720P)时下拉只剩那一档,不再给会被服务端改掉的选择 */
    const resOpts = this.resolutionOptionsOf(shModel).map(v => {
      const wh = videoWH(v, sh.ratio || spec.ratio);
      return { v, t: String(v).toUpperCase() + ' ' + wh.w + '×' + wh.h };
    });
    const fpsOpts = this.fpsOptionsOf(shModel);
    const ratioOpts = this.ratioOptionsOf(shModel);
    /* 融生视频必须有源图，源图由文案里的 [资产名] 引用或左侧选中的参考图决定，
       不额外占一行显示；但「一张图片都没有」时提交必然失败，这个前置条件要提前说 */
    const hasSrc = !!this.shotSource(sh, []);
    return `
    <div class="ws-card${collapsed ? ' is-collapsed' : ''}" data-shot-card="${sh.key}" data-shot-idx="${idx}">
      <div class="ws-card-head" data-shot-toggle="${sh.key}" title="${toggleTitle}(点击头部空白处)">
        <div class="ws-card-title">
          <span class="ws-shot-idx">${icon('clapperboard', 'ico-xs')}分镜 ${idx + 1}</span>
          <input class="ws-shot-title" data-shot-title="${sh.key}" value="${esc(sh.title)}" maxlength="80" title="点击编辑分镜标题" spellcheck="false">
        </div>
        <div class="ws-card-actions">
          <button class="ws-icon-btn" data-shot-up="${sh.key}" title="上移分镜" ${first ? 'disabled' : ''}>${icon('chevron-up', 'ico-xs')}</button>
          <button class="ws-icon-btn" data-shot-down="${sh.key}" title="下移分镜" ${last ? 'disabled' : ''}>${icon('chevron-down', 'ico-xs')}</button>
          <button class="ws-icon-btn" data-shot-toggle="${sh.key}" title="${toggleTitle}">${icon(toggleIco, 'ico-xs')}</button>
          <button class="ws-icon-btn danger" data-shot-del="${sh.key}" title="删除该分镜">${icon('x', 'ico-xs')}</button>
        </div>
      </div>
      ${collapsed ? `<div class="ws-card-summary">${this.shotSummaryHTML(sh)}</div>` : ''}
      <div class="ws-card-body">
      <div class="ws-card-grid">
        <aside class="ws-shot-params">
          <div class="ws-param"><label>${icon('cpu', 'ico-xs')}视频模型</label><select class="ws-select" data-shot-model="${sh.key}">${modelOpts}</select></div>
          <div class="ws-param"><label>${icon('palette', 'ico-xs')}视频风格</label><select class="ws-select" data-shot-style="${sh.key}">${styleOpts}</select></div>
          <div class="ws-param ws-param-grid">
            <div class="ws-pcell"><label title="画幅比例(跟随所选模型支持的档位)">${icon('frame', 'ico-xs')}画幅比例</label>${mkSel('ratio', ratioOpts)}</div>
            <div class="ws-pcell"><label title="分辨率(后台白名单 ∩ 模型支持档)">${icon('scan', 'ico-xs')}分辨率</label>${mkSel('resolution', resOpts)}</div>
            <div class="ws-pcell"><label title="帧率">${icon('gauge', 'ico-xs')}帧率</label>${mkSel('fps', fpsOpts)}</div>
            <div class="ws-pcell"><label title="时长">${icon('timer', 'ico-xs')}时长</label>${mkSel('duration', durOpts)}</div>
          </div>
          <div class="ws-param ws-param-motion"><label>${icon('wind', 'ico-xs')}运动强度 <b data-motion-val="${sh.key}">${sh.motion}</b></label>
            <input type="range" min="0" max="1" step="0.05" value="${sh.motion}" data-shot-motion="${sh.key}"></div>
          <div class="ws-param"><label>${icon('dices', 'ico-xs')}种子</label>
            <div class="seed-row">
              <input class="ws-input" type="number" value="${sh.seed}" data-shot-seed="${sh.key}">
              <button class="ws-icon-btn" data-shot-dice="${sh.key}" title="随机种子">${icon('dices', 'ico-xs')}</button>
            </div>
          </div>
        </aside>
        <section class="ws-shot-editor">
          <div class="ws-editor-cap">${icon('pen-line', 'ico-xs')}剧本文案<span>输入 [资产名] 自动链接左侧参考资产</span></div>
          <div class="ws-script-wrap">
            <textarea class="ws-script" data-shot-script="${sh.key}" placeholder="输入剧本文案，支持 [资产名] 占位符自动链接左侧参考资产（如 [女主]），成功后金色高亮…&#10;Ctrl + Enter 快速提交生成">${esc(sh.script)}</textarea>
          </div>
          <div class="ws-pl-chips" data-shot-pl="${sh.key}"></div>
          ${hasSrc ? '' : `<div class="ws-need-src">${icon('circle-alert', 'ico-xs')}
            <span>融生视频需要一张源图 —— 在文案里输入 [资产名] 引用参考图，或点左侧「引入参考图」。</span>
            <button class="btn btn-xs" data-ref-pick="图片参考">${icon('image-plus', 'ico-xs')}引入参考图</button>
            <button class="btn btn-xs" data-shot-imggen="${sh.key}">${icon('sparkles', 'ico-xs')}按本镜文案生图</button>
          </div>`}
          <div class="ws-genbar">
            <input class="ws-neg" data-shot-neg="${sh.key}" placeholder="补充要求 / 负向词…" value="${esc(sh.neg)}">
            <button class="ws-icon-btn" data-shot-imggen="${sh.key}" title="AI 生图：按本镜文案快速生成参考图（可直接作图生视频源图）">${icon('image-plus', 'ico-xs')}</button>
            <span class="cost-hint" data-shot-cost="${sh.key}"></span>
            <button class="ws-gen-btn" data-shot-gen="${sh.key}"${hasSrc ? '' : ' disabled title="先引入一张参考图（见上方提示）"'}>${iconText('sparkles', '生成融生视频')}</button>
          </div>
        </section>
      </div>
      <div class="ws-preview" data-shot-preview="${sh.key}">
        ${this.shotPreviewHTML(sh)}
      </div>
      </div>
    </div>`;
  },  /* 折叠态摘要：剧本摘要 + 链接来源数量 + 生成状态
     二十二·1:链接统计与提示词同口径 —— 只统计「参考资产」中可引用的资产 */
  shotSummaryHTML(sh) {
    const s = this.studio;
    const assets = (s && s.refs) || [];
    const byName = new Map();
    for (const a of assets) {
      const k = String(a.name || '').replace(/\.[^.]+$/, '').trim().toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      const arr = byName.get(k);
      if (!arr.some(x => x.id === a.id)) arr.push(a);
    }
    const seen = new Set();
    const re = /\[([^\[\]\n]{1,60})\]/g;
    let m;
    while ((m = re.exec(sh.script || ''))) {
      const hits = byName.get(m[1].trim().toLowerCase()) || [];
      for (const h of hits) if (!seen.has(h.id)) seen.add(h.id);
    }
    const lastTask = (sh.tasks && sh.tasks[0]) || null;
    const statusTxt = lastTask
      ? (lastTask.status === 'completed' ? '已完成' : (lastTask.status === 'queued' || lastTask.status === 'processing') ? '生成中' : '失败/已取消')
      : '未生成';
    /* 折叠态一眼能看到本镜的出片规格(26·5):不用展开卡片去参数栏确认 */
    const wh = videoWH(sh.resolution, sh.ratio);
    return '剧本：' + (String(sh.script || '').trim().slice(0, 48) || '—') +
      ' · 时长 ' + sh.duration + 's' +
      ' · ' + wh.w + '×' + wh.h + ' · ' + (sh.fps || 30) + 'fps' +
      (seen.size ? ' · 已链接 <b>' + seen.size + '</b> 项' : '') +
      ' · ' + statusTxt;
  },

  shotPreviewHTML(sh) {
    if (!sh.tasks.length) return '<div class="ws-preview-empty">暂无生成记录</div>';
    const s = this.studio;
    const idx = s.shots.indexOf(sh);
    const secCollapsed = !!sh.recsCollapsed;
    const running = sh.tasks.filter(t => t.status === 'queued' || t.status === 'processing').length;
    return `
      <div class="ws-recs-head${secCollapsed ? ' is-collapsed' : ''}" data-recs-toggle="${sh.key}" title="${secCollapsed ? '展开生成记录' : '收起生成记录'}">
        <span class="ws-recs-cap">${icon('film', 'ico-xs')}生成记录<b>${sh.tasks.length}</b>${running ? '<i class="ws-recs-run">' + running + ' 进行中</i>' : ''}</span>
        <span class="ws-recs-toggle">${secCollapsed ? icon('chevron-down', 'ico-xs') + '展开' : icon('chevron-up', 'ico-xs') + '收起'}</span>
      </div>
      <div class="ws-recs-body"${secCollapsed ? ' hidden' : ''}>${sh.tasks.map(t => this.recordHTML(t, idx)).join('')}</div>`;
  },

  /* 生成记录上的成片尺寸/帧率:优先结果资产的真实宽高,回退任务参数(26·5 让设置看得见生效) */
  recSizeText(t) {
    const p = t.params || {};
    const w = (t.result && t.result.width) || p.out_width;
    const h = (t.result && t.result.height) || p.out_height;
    const parts = [];
    if (w && h) parts.push(w + '×' + h);
    else if (p.resolution) parts.push(String(p.resolution).toUpperCase() + (p.aspect_ratio ? ' ' + p.aspect_ratio : ''));
    if (p.fps) parts.push(p.fps + 'fps');
    return parts.join(' · ');
  },

  recordHTML(t, shotIdx) {
    const s = this.studio;
    const model = s.models.find(m => m.id === t.model_id);
    const isCompleted = t.status === 'completed' && t.result;
    let media;
    let downloadName = 'video-' + (t.created_at || Date.now()) + '.mp4';
    if (isCompleted) {
      const ts = t.created_at ? new Date(t.created_at).getTime() : Date.now();
      downloadName = (shotIdx != null && shotIdx >= 0 ? '分镜' + (shotIdx + 1) + '-' : '视频-') + ts + '.mp4';
      /* 二十九轮：完成记录由「常驻 video」改为封面卡 —— 页面更轻、列表更整洁；
         点击封面进全站统一查看器大屏播放(← → 可在本镜完成记录间翻页) */
      media = '<div class="ws-rec-cover" data-task-view="' + esc(t.id) + '" title="点击放大查看(← → 翻页)">'
        + '<img src="/api/assets/' + esc(t.result.id) + '/thumbnail" loading="lazy" alt="">'
        + '<span class="ws-rec-play">' + icon('play') + '</span>'
        + (t.result.duration ? '<span class="ws-rec-dur">' + fmtDuration(t.result.duration) + '</span>' : '')
        + '</div>';
    } else if (t.status === 'queued' || t.status === 'processing') {
      /* 网关排队已满时任务会被延后重投:next_at 未到点显示倒计时,而不是假进度 */
      const waitSec = t.next_at ? Math.ceil((t.next_at - Date.now()) / 1000) : 0;
      media = waitSec > 1
        ? `<div class="ws-rec-progress"><div class="ws-rec-bar"><i style="width:${t.progress}%"></i></div><span data-wait-until="${t.next_at}">${waitSec}s 后重试</span></div>`
        : `<div class="ws-rec-progress"><div class="ws-rec-bar"><i style="width:${t.progress}%"></i></div><span>${t.progress}%</span></div>`;
    } else {
      media = `<div class="ws-rec-fail">${esc(t.error || (t.status === 'cancelled' ? '已取消' : '失败'))}</div>`;
    }
    const canDelete = ['completed', 'failed', 'cancelled'].includes(t.status);
    const actions = (isCompleted
      ? `<button class="ws-rec-act" data-task-download="${t.id}" data-dl-name="${esc(downloadName)}">下载</button>`
      : t.status === 'failed'
        ? `<button class="ws-rec-act" data-task-retry="${t.id}">重试</button>`
        : (t.status === 'queued' || t.status === 'processing')
          ? `<button class="ws-rec-act" data-task-cancel="${t.id}">取消</button>` : '')
      + (canDelete ? `<button class="ws-rec-act danger" data-task-del="${t.id}" title="删除该条生成记录">${icon('trash-2', 'ico-xs')}删除</button>` : '');
    const collapsed = t.status !== 'queued' && t.status !== 'processing';
    return `<div class="ws-rec${collapsed ? ' is-collapsed' : ''}" data-task="${t.id}">
      <div class="ws-rec-head" data-task-toggle="${t.id}" title="点击展开 / 收起该条记录(按钮除外)">
        <div class="ws-rec-info">
          ${isCompleted ? `<img class="ws-rec-thumb" data-task-view="${esc(t.id)}" src="/api/assets/${esc(t.result.id)}/thumbnail" loading="lazy" alt="" title="点击放大查看">` : ''}
          <div>
            <div class="ws-rec-title">${esc(t.prompt || '—')}</div>
            <div class="ws-rec-sub">#${esc(t.id.slice(0, 8))}${model ? ' · ' + esc(model.name) : ''}${t.params && t.params.duration != null ? ' · ' + t.params.duration + 's' : ''}${this.recSizeText(t) ? ' · ' + this.recSizeText(t) : ''}${t.params && t.params.busy_attempts ? ' · 网关排队,已自动重试 ' + t.params.busy_attempts + ' 次' : ''} · ${fmtTime(t.created_at)}</div>
          </div>
        </div>
        <div class="ws-rec-side">
          ${statusBadge(t.status)}
          ${actions ? '<div class="ws-rec-acts">' + actions + '</div>' : ''}
          ${isCompleted ? '<button class="ws-rec-toggle" data-task-toggle="' + t.id + '" title="折叠/展开视频">' + icon('chevron-down', 'ico-xs') + '</button>' : ''}
        </div>
      </div>
      <div class="ws-rec-media-wrap">${media}</div>
    </div>`;
  },

  /* 二十九轮：统一成果查看器 —— 点击封面卡放大播放该分镜的完成视频，
     翻页上下文 = 该分镜全部已完成记录；批量审片 / 工作日志共用 */
  taskViewerItems(list) {
    return (list || []).filter(x => x.status === 'completed' && x.result).map(x => ({
      id: x.result.id,
      name: String(x.prompt || '生成视频').slice(0, 42) || '生成视频',
      type: 'video',
      poster: '/api/assets/' + x.result.id + '/thumbnail',
      width: x.result.width, height: x.result.height,
      duration: x.result.duration, created_at: x.created_at
    }));
  },

  viewTaskMedia(taskId) {
    const s = this.studio; if (!s) return;
    let task = null, host = null;
    for (const sh of s.shots) {
      const t = (sh.tasks || []).find(x => x.id === taskId);
      if (t) { task = t; host = sh; break; }
    }
    if (!task || !task.result) return;
    const items = this.taskViewerItems(host ? host.tasks : [task]);
    openViewer(items, Math.max(0, items.findIndex(x => x.id === task.result.id)));
  },

  /* ---------- 剪辑预览 ---------- */
  editPreviewHTML() {
    const s = this.studio;
    const scenes = s.episode.scenes || [];
    if (!scenes.length) {
      return `<div class="ws-edit-preview"><div class="ws-preview-empty" style="height:100%;border-radius:12px">暂无剪辑内容，先在「分镜设计」中生成视频片段</div></div>`;
    }
    const html = scenes.map(sc => `
      <div class="ws-clip-scene">
        <div class="ws-clip-scene-head"><span>${icon('layers', 'ico-sm')} ${esc(sc.title)}</span><span class="ws-clip-count">${(sc.clips || []).length} 片段</span></div>
        <div class="ws-clip-row">
          ${(sc.clips || []).map(c => c.asset_type === 'video'
            ? `<div class="ws-clip"><video src="/api/assets/${c.asset_id}/file" muted playsinline controls></video><span>${esc(c.title || c.asset_name || '片段')}</span></div>`
            : c.asset_type === 'image'
              ? `<div class="ws-clip"><img src="/api/assets/${c.asset_id}/file"><span>${esc(c.title || c.asset_name || '片段')}</span></div>`
              : '').join('') || '<div class="ws-clip-none">暂无片段</div>'}
        </div>
      </div>`).join('');
    return `<div class="ws-edit-preview">${html}</div>`;
  },

  /* ---------- 事件绑定(委托) ---------- */
  bindStudioEvents() {
    const root = this.root;
    const ws = root.querySelector('#wsRoot');
    ws.addEventListener('click', async e => {
      const act = e.target.closest('[data-ws-action]');
      if (act) { e.preventDefault(); await this.wsAction(act.dataset.wsAction, act); return; }
      const rdel = e.target.closest('[data-ref-del]');
      if (rdel) { e.preventDefault(); e.stopPropagation(); this.removeRef(rdel.dataset.refDel); return; }
      /* 参考资产:单击=选中(右侧分镜闪动提示),点放大镜角标或双击才进全屏查看器。
         此前单击即弹全屏,想安静地换一张源图必须每次关掉遮罩 */
      const rz = e.target.closest('[data-ref-zoom]');
      if (rz) {
        e.preventDefault(); e.stopPropagation();
        const a = this.studio.refs.find(x => x.id === rz.dataset.refZoom);
        if (a) this.openAssetPreview(a);
        return;
      }
      const ref = e.target.closest('[data-ref-sel]');
      if (ref) {
        const asset = this.studio.refs.find(r => r.id === ref.dataset.refSel) || null;
        this.studio.selRef = asset;
        this.markDirty();
        this.flashShots(); /* 右侧分镜闪动反馈 */
        this.renderStudioBody();
        return;
      }
      const rp = e.target.closest('[data-ref-pick]');
      if (rp) { this.pickRefAsset(rp.dataset.refPick); return; }
      const del = e.target.closest('[data-shot-del]');
      if (del) { this.removeShot(del.dataset.shotDel); return; }
      const up = e.target.closest('[data-shot-up]');
      if (up) { this.moveShot(up.dataset.shotUp, -1); return; }
      const dn = e.target.closest('[data-shot-down]');
      if (dn) { this.moveShot(dn.dataset.shotDown, 1); return; }
      if (e.target.closest('.ws-shot-title')) return; /* 标题行内编辑，不触发折叠 */
      const dice = e.target.closest('[data-shot-dice]');
      if (dice) { this.randomizeSeed(dice.dataset.shotDice); return; }
      const stog = e.target.closest('[data-shot-toggle]');
      if (stog) { this.toggleShot(stog.dataset.shotToggle); return; }
      const gen = e.target.closest('[data-shot-gen]');
      if (gen) { const sh = this.getShot(gen.dataset.shotGen); if (sh) this.generateShot(sh); return; }
      /* 第二十五轮：分镜快捷「AI 生图」→ 生成图自动加入参考资产 */
      const igBtn = e.target.closest('[data-shot-imggen]');
      if (igBtn) { const sh = this.getShot(igBtn.dataset.shotImggen); if (sh) this.aiImageDialog(sh); return; }
      const tr = e.target.closest('[data-task-retry]');
      if (tr) { await this.retryTask(tr.dataset.taskRetry); return; }
      const tc = e.target.closest('[data-task-cancel]');
      if (tc) { await this.cancelTask(tc.dataset.taskCancel); return; }
      const tdel = e.target.closest('[data-task-del]');
      if (tdel) { await this.deleteTaskRecord(tdel.dataset.taskDel); return; }
      const dl = e.target.closest('[data-task-download]');
      if (dl) {
        const tId = dl.dataset.taskDownload;
        const name = dl.dataset.dlName || 'video.mp4';
        const s = this.studio;
        const allTasks = s.shots.flatMap(sh => sh.tasks);
        const task = allTasks.find(t => t.id === tId);
        if (task && task.result) {
          download('/api/assets/' + task.result.id + '/file', name);
        }
        return;
      }
      const tv = e.target.closest('[data-task-view]');
      if (tv) { this.viewTaskMedia(tv.dataset.taskView); return; }
      const tg = e.target.closest('[data-task-toggle]');
      if (tg) {
        const rec = tg.closest('.ws-rec');
        if (rec) {
          rec.classList.toggle('is-collapsed');
          const ico = tg.querySelector('svg.lucide');
          if (ico) ico.classList.toggle('rotate');
        }
        return;
      }
      const rt = e.target.closest('[data-recs-toggle]');
      if (rt) { this.toggleShotRecs(rt.dataset.recsToggle); return; }
    });
    ws.addEventListener('dblclick', e => {
      const ref = e.target.closest('[data-ref-sel]');
      if (!ref) return;
      const a = this.studio.refs.find(x => x.id === ref.dataset.refSel);
      if (a) this.openAssetPreview(a);
    });
    ws.addEventListener('change', e => {
      const el = e.target;
      const shot = this.getShot(el.dataset.shotModel || el.dataset.shotStyle || el.dataset.shotFps || el.dataset.shotRatio || el.dataset.shotResolution || el.dataset.shotDuration || el.dataset.shotSeed);
      if (!shot) return;
      if (el.dataset.shotModel !== undefined) {
        shot.modelId = el.value;
        this.snapShotSpec(shot);
        /* 换模型 = 换一套档位:画幅/分辨率/帧率三个下拉立刻按新模型重画(26·9),
           否则界面还停在旧模型的清单上,用户以为没生效 */
        this.markDirty();
        this.renderStudioBody();
        return;
      }
      else if (el.dataset.shotStyle !== undefined) {
        shot.styleId = el.value;
        /* 风格绑定的模型只有在「当前可用视频模型列表」里才联动切换。
           此前无条件写入 st.model_id:绑定的模型被停用/删除(或换成生图模型)后，
           modelId 变成下拉里不存在的值 —— 界面仍显示第一项，提交时却落到另一个模型 */
        const st = this.studio.styles.find(x => x.id === el.value);
        if (st && st.model_id && st.model_id !== shot.modelId && this.studio.models.some(mm => mm.id === st.model_id)) {
          shot.modelId = st.model_id;
          this.markDirty(); this.renderStudioBody(); return;
        }
      }
      else if (el.dataset.shotFps !== undefined) shot.fps = Number(el.value);
      else if (el.dataset.shotRatio !== undefined) {
        shot.ratio = el.value;
        /* 画幅一改,分辨率档里的换算尺寸就变了 → 重画参数栏 */
        this.markDirty(); this.renderStudioBody(); return;
      }
      else if (el.dataset.shotResolution !== undefined) shot.resolution = el.value;
      else if (el.dataset.shotDuration !== undefined) { shot.duration = Math.min(15, Math.max(3, Number(el.value))); this.updateShotCostHints(); }
      else if (el.dataset.shotSeed !== undefined) shot.seed = Number(el.value);
      this.markDirty(); /* 参数变化 → 自动保存工作记录 */
    });
    ws.addEventListener('input', e => {
      const el = e.target;
      const shot = this.getShot(el.dataset.shotScript || el.dataset.shotNeg || el.dataset.shotMotion || el.dataset.shotDuration || el.dataset.shotTitle);
      if (!shot) return;
      if (el.dataset.shotScript !== undefined) shot.script = el.value;
      else if (el.dataset.shotTitle !== undefined) shot.title = el.value;
      else if (el.dataset.shotNeg !== undefined) shot.neg = el.value;
      else if (el.dataset.shotMotion !== undefined) {
        shot.motion = Number(el.value);
        const b = el.closest('.ws-param') && el.closest('.ws-param').querySelector('[data-motion-val]');
        if (b) b.textContent = el.value;
      }
      else if (el.dataset.shotDuration !== undefined) {
        shot.duration = Math.min(15, Math.max(3, Number(el.value)));
        const b = el.closest('.ws-param') && el.closest('.ws-param').querySelector('[data-duration-val]');
        if (b) b.textContent = shot.duration + 's';
        this.updateShotCostHints();
      }
      this.markDirty(); /* 文案/负向词输入 → 防抖自动保存 */
    });
    /* Ctrl/Cmd + Enter:光标在剧本文案内直接提交该分镜生成 */
    ws.addEventListener('keydown', e => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'Enter')) return;
      const ta = e.target.closest('[data-shot-script]');
      if (!ta) return;
      e.preventDefault();
      const sh = this.getShot(ta.dataset.shotScript);
      if (sh) this.generateShot(sh);
    });
  },

  /* 骰子：一键随机种子(写入状态并同步输入框，不打断编辑) */
  randomizeSeed(key) {
    const sh = this.getShot(key); if (!sh) return;
    sh.seed = Math.floor(Math.random() * 999999) + 1;
    const inp = this.root.querySelector('[data-shot-seed="' + key + '"]');
    if (inp) inp.value = sh.seed;
    this.markDirty();
  },

  /* ---------- 顶部工具栏动作 ---------- */
  async wsAction(action, btn) {
    switch (action) {
      case 'script': return this.episodeScriptDialog();
      case 'review': return this.reviewDialog();
      case 'log': return this.workLogDialog();
      case 'supply': return this.supplyAssets();
      case 'aiimg': return this.aiImageDialog(null);
      case 'addshot': return this.addShot();
      case 'frame': return this.pickRefAsset('视频帧');
      case 'toggleleft': return this.toggleLeft();
      case 'collapseall': return this.collapseAll(true);
      case 'expandall': return this.collapseAll(false);
      case 'reccollapse': return this.toggleRecsCollapsed();
    }
  },

  /* 录入原文：编辑分集剧本 */
  async episodeScriptDialog() {
    const s = this.studio;
    const vals = await formModal({
      title: `${icon('file-text', 'ico-sm')} 录入原文 · ${esc(s.episode.title)}`,
      fields: [{ key: 'script', label: '分集原文(剧本)', type: 'textarea', value: s.episode.script || '', placeholder: '粘贴本集的剧本原文，用于分镜拆解与视频生成…' }],
      submitText: '保存原文'
    });
    if (vals) {
      await API.patch('/episodes/' + s.episode.id, { script: vals.script });
      s.episode.script = vals.script;
      toast('原文已保存', 'ok');
    }
  },

  /* 批量审片：该分集全部生成任务 */
  async reviewDialog() {
    const s = this.studio;
    const body = el('<div></div>');
    const list = el('<div class="ws-review-list"></div>');
    body.appendChild(list);
    const render = async () => {
      const res = await API.get('/tasks?episode_id=' + s.episodeId);
      const items = res.items;
      if (!items.length) { list.innerHTML = '<div class="ws-pick-empty">该分集暂无生成记录</div>'; return; }
      list.innerHTML = items.map(t => {
        const model = s.models.find(m => m.id === t.model_id);
        return `<div class="ws-review-item">
          <div class="ws-review-main">
            <div class="ws-review-title">${esc(t.prompt || '—')}</div>
            <div class="ws-review-sub">#${esc(t.id.slice(0, 8))}${model ? ' · ' + esc(model.name) : ''} · ${fmtTime(t.created_at)}</div>
          </div>
          ${statusBadge(t.status)}
          <div class="ws-review-acts">
            ${t.status === 'completed' && t.result ? `<button class="ws-rec-act" data-rv-view="${t.id}" title="放大查看(统一查看器)">查看</button><a class="ws-rec-act" href="/api/assets/${t.result.id}/file" download>下载</a>` : ''}
            ${t.status === 'failed' ? `<button class="ws-rec-act" data-rv-retry="${t.id}">重试</button>` : ''}
            ${t.status === 'queued' || t.status === 'processing' ? `<button class="ws-rec-act" data-rv-cancel="${t.id}">取消</button>` : ''}
            ${['completed', 'failed', 'cancelled'].includes(t.status) ? `<button class="ws-rec-act danger" data-rv-del="${t.id}" title="删除该条生成记录">删除记录</button>` : ''}
          </div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-rv-retry]').forEach(b => b.addEventListener('click', async () => {
        try { await API.post('/tasks/' + b.dataset.rvRetry + '/retry'); toast('已重新排队', 'ok'); render(); }
        catch (e) { toast(e.message, 'err'); }
      }));
      /* 二十九轮：审片内直接放大查看完成视频(统一查看器，← → 翻本集完成记录) */
      list.querySelectorAll('[data-rv-view]').forEach(b => b.addEventListener('click', () => {
        const t = items.find(x => x.id === b.dataset.rvView);
        if (!t || !t.result) return;
        openViewer(this.taskViewerItems(items), Math.max(0, items.findIndex(x => x.id === t.id)));
      }));
      list.querySelectorAll('[data-rv-cancel]').forEach(b => b.addEventListener('click', async () => {
        try { await API.post('/tasks/' + b.dataset.rvCancel + '/cancel'); toast('已取消', 'ok'); render(); }
        catch (e) { toast(e.message, 'err'); }
      }));
      list.querySelectorAll('[data-rv-del]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDlg('确认删除这条生成记录？已生成的视频资产仍会保留。')) return;
        try { await API.del('/tasks/' + b.dataset.rvDel); toast('记录已删除', 'ok'); render(); }
        catch (e) { toast(e.message, 'err'); }
      }));
    };
    const refreshBtn = el('<button class="btn">刷新</button>');
    const closeBtn = el('<button class="btn">关闭</button>');
    /* 之前「关闭」按钮没有绑定任何事件，点击无反应 */
    closeBtn.addEventListener('click', () => m.close());
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = icon('loader', 'ico-xs') + ' 刷新中…';
      try { await render(); }
      catch (e) { toast('刷新失败：' + (e.message || e), 'err'); }
      finally { refreshBtn.disabled = false; refreshBtn.textContent = '刷新'; }
    });
    let m;
    m = openModal({ title: `${icon('eye', 'ico-sm')} 批量审片 · ${esc(s.episode.title)}`, size: 'modal-lg', body, footer: [closeBtn, refreshBtn] });
    render().catch(e => toast('加载生成记录失败：' + (e.message || e), 'err'));
  },

  /* 工作日志：该分集全部任务提交记录(提示词 / 状态 / 正常或异常 / 模型 / 积分 / 时间) */
  async workLogDialog() {
    const s = this.studio;
    const body = el('<div></div>');
    /* 筛选：全部 / 正常(排队/生成中/已完成) / 异常(失败/已取消) */
    body.innerHTML = `
      <div class="ws-log-filter">
        <button class="wpk-chip on" data-log-filter="all">全部</button>
        <button class="wpk-chip" data-log-filter="normal">正常</button>
        <button class="wpk-chip" data-log-filter="abnormal">异常</button>
        <span class="ws-pick-hint" id="wsLogCount" style="margin-left:auto"></span>
      </div>
      <div class="ws-review-list" id="wsLogList"></div>`;
    const list = body.querySelector('#wsLogList');
    const countBox = body.querySelector('#wsLogCount');
    let curFilter = 'all';
    let items = [];

    const isNormal = t => ['queued', 'processing', 'completed'].includes(t.status);
    const render = () => {
      const shown = items.filter(t => curFilter === 'all' ? true : isNormal(t) === (curFilter === 'normal'));
      countBox.textContent = '共 ' + items.length + ' 条提交' + (curFilter !== 'all' ? ' · 当前 ' + shown.length + ' 条' : '');
      if (!shown.length) { list.innerHTML = '<div class="ws-pick-empty">该分集暂无生成提交记录</div>'; return; }
      var _s = s;
      list.innerHTML = shown.map(function(t) {
        var model = _s.models.find(function(m) { return m.id === t.model_id; });
        var normal = isNormal(t);
        var errTxt = t.status === 'failed' && t.error ? ' · ' + esc(String(t.error).slice(0, 80)) : '';
        // 详细信息
        var detailRows = '';
        if (t.params) {
          var p = t.params;
          var parts = [];
          if (p.duration != null) parts.push('时长： ' + p.duration + 's');
          if (p.fps) parts.push('帧率： ' + p.fps + 'fps');
          if (p.motion != null) parts.push('运动： ' + p.motion);
          if (p.seed != null) parts.push('种子： ' + p.seed);
          if (p.aspect_ratio) parts.push('比例： ' + p.aspect_ratio);
          if (p.resolution) parts.push('分辨率： ' + p.resolution);
          if (parts.length) detailRows += '<div class="wl-detail-row"><b>参数：</b> ' + parts.join(' · ') + '</div>';
        }
        if (t.negative_prompt) detailRows += '<div class="wl-detail-row"><b>负向词：</b> ' + esc(t.negative_prompt) + '</div>';
        if (model) detailRows += '<div class="wl-detail-row"><b>模型：</b> ' + esc(model.name) + '</div>';
        if (t.cost) detailRows += '<div class="wl-detail-row"><b>消耗积分：</b> ' + t.cost + '</div>';
        if (t.error) detailRows += '<div class="wl-detail-row"><b>错误信息：</b> <span class="wl-detail-err">' + esc(String(t.error)) + '</span></div>';
        if (t.result) detailRows += '<div class="wl-detail-row"><b>结果资产：</b> <button class="ws-rec-act" data-wl-view="' + esc(t.id) + '" title="放大查看(统一查看器)">' + icon('play', 'ico-xs') + ' 放大查看' + (t.result.duration ? ' · ' + fmtDuration(t.result.duration) : '') + '</button></div>';
        detailRows += '<div class="wl-detail-row"><b>任务 ID:</b> <code>' + esc(t.id) + '</code></div>';
        if (detailRows) detailRows = '<div class="wl-detail" style="display:none">' + detailRows + '</div>';
        return '<div class="ws-log-item' + (normal ? ' is-normal' : ' is-abnormal') + '" data-wl-toggle="' + esc(t.id) + '">' +
          '<div class="ws-log-head">' +
            '<span class="ws-log-state ' + (normal ? 'ok' : 'bad') + '">' + (normal ? '正常' : '异常') + '</span>' +
            statusBadge(t.status) +
            '<span class="ws-log-time">' + fmtTime(t.created_at) + '</span>' +
            '<button class="ws-rec-act wl-detail-btn" data-wl-detail="' + esc(t.id) + '" title="点击显示详细信息">' + icon('info', 'ico-xs') + ' 详情</button>' +
          '</div>' +
          '<div class="ws-review-title">' + esc(t.prompt || '—') + '</div>' +
          '<div class="ws-review-sub">#' + esc(t.id.slice(0, 8)) + (model ? ' · ' + esc(model.name) : '') + (t.params && t.params.duration != null ? ' · ' + t.params.duration + 's' : '') + (t.cost ? ' · ' + t.cost + ' 积分' : ' · 免费') + errTxt + '</div>' +
          '<div class="ws-review-acts">' +
            (t.status === 'completed' && t.result ? '<a class="ws-rec-act" href="/api/assets/' + t.result.id + '/file" download>下载</a>' : '') +
            (t.status === 'failed' ? '<button class="ws-rec-act" data-wl-retry="' + t.id + '">重试</button>' : '') +
            (t.status === 'queued' || t.status === 'processing' ? '<button class="ws-rec-act" data-wl-cancel="' + t.id + '">取消</button>' : '') +
            (['completed', 'failed', 'cancelled'].includes(t.status) ? '<button class="ws-rec-act danger" data-wl-del="' + t.id + '" title="删除该条记录">删除记录</button>' : '') +
          '</div>' + detailRows +
        '</div>';
      }).join('');
      // 点击日志项或详情按钮展开/折叠详细信息
      list.querySelectorAll('[data-wl-detail]').forEach(function(b) { b.addEventListener('click', function(e) {
        e.stopPropagation();
        var item = b.closest('.ws-log-item');
        var detail = item && item.querySelector('.wl-detail');
        if (detail) {
          var hidden = detail.style.display === 'none' || !detail.style.display;
          detail.style.display = hidden ? 'block' : 'none';
          b.innerHTML = hidden ? icon('x', 'ico-xs') + ' 收起' : icon('info', 'ico-xs') + ' 详情';
        }
      }); });
      list.querySelectorAll('.ws-log-item').forEach(function(item) { item.addEventListener('click', function() {
        var detail = item.querySelector('.wl-detail');
        var btn = item.querySelector('[data-wl-detail]');
        if (detail) {
          var hidden = detail.style.display === 'none' || !detail.style.display;
          detail.style.display = hidden ? 'block' : 'none';
          if (btn) btn.innerHTML = hidden ? icon('x', 'ico-xs') + ' 收起' : icon('info', 'ico-xs') + ' 详情';
        }
      }); });
      list.querySelectorAll('[data-wl-retry]').forEach(function(b) { b.addEventListener('click', async function(e) {
        e.stopPropagation();
        try { await API.post('/tasks/' + b.dataset.wlRetry + '/retry'); toast('已重新排队', 'ok'); reload(); }
        catch (e2) { toast(e2.message, 'err'); }
      }); });
      /* 二十九轮：工作日志详情里直接放大查看结果视频(统一查看器) */
      list.querySelectorAll('[data-wl-view]').forEach(function(b) { b.addEventListener('click', function(e) {
        e.stopPropagation();
        var t = items.find(function(x) { return x.id === b.dataset.wlView; });
        if (!t || !t.result) return;
        var done = items.filter(function(x) { return x.status === 'completed' && x.result; });
        var at = Math.max(0, done.findIndex(function(x) { return x.id === t.id; }));
        openViewer(_s.taskViewerItems(done), at);
      }); });
      list.querySelectorAll('[data-wl-cancel]').forEach(function(b) { b.addEventListener('click', async function(e) {
        e.stopPropagation();
        try { await API.post('/tasks/' + b.dataset.wlCancel + '/cancel'); toast('已取消', 'ok'); reload(); }
        catch (e2) { toast(e2.message, 'err'); }
      }); });
      list.querySelectorAll('[data-wl-del]').forEach(function(b) { b.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (!await confirmDlg('确认删除这条生成记录？已生成的视频资产仍会保留。')) return;
        try { await API.del('/tasks/' + b.dataset.wlDel); toast('记录已删除', 'ok'); reload(); }
        catch (e2) { toast(e2.message, 'err'); }
      }); });
    };
    const reload = async function() {
      try {
        var res = await API.get('/tasks?episode_id=' + s.episodeId);
        items = res.items || [];
        render();
      } catch (e) { toast('加载工作日志失败：' + (e.message || e), 'err'); }
    };
    body.querySelectorAll('[data-log-filter]').forEach(function(b) { b.addEventListener('click', function() {
      curFilter = b.dataset.logFilter;
      body.querySelectorAll('[data-log-filter]').forEach(function(x) { x.classList.toggle('on', x === b); });
      render();
    }); });
    const refreshBtn = el('<button class="btn">刷新</button>');
    const closeBtn = el('<button class="btn">关闭</button>');
    let m;
    closeBtn.addEventListener('click', function() { m.close(); });
    refreshBtn.addEventListener('click', reload);
    m = openModal({ title: icon('scroll-text', 'ico-sm') + ' 工作日志 · ' + esc(s.episode.title), size: 'modal-lg', body, footer: [closeBtn, refreshBtn] });
    reload();
  },

  /* 补给资产：上传素材入库 */
  supplyAssets() {
    const dz = makeDropzone({
      text: '点击或拖拽上传图片 / 视频 / 音频素材', multiple: true,
      onFiles: async files => {
        const m = openModal({ title: '上传中…', body: '<div class="loading-wrap"><span class="spinner"></span></div>', size: 'modal-sm' });
        let ok = 0;
        for (const f of files) {
          try { await uploadFile('/assets/upload', f, { folder_id: '' }); ok++; }
          catch (e) { toast(e.message, 'err'); }
        }
        m.close();
        toast('已上传 ' + ok + ' 个素材', 'ok');
      }
    });
    openModal({ title: `${icon('zap', 'ico-sm')} 补给资产`, body: dz });
  },

  /* ---------- 资产库窗口(弹窗) ----------
     点击左侧资源类型时弹出：与资产库页面同款交互(文件夹树 / 分类 chips / 名称搜索 / 类型筛选)
     + 多选导入 */
  async pickAssetModal({ title, type, category, onPick, multi, refType }) {
    let folders = [], all = [];
    try {
      const [folderRes, assetRes] = await Promise.all([
        API.get('/assets/folders'),
        API.get('/assets?type=all')
      ]);
      folders = folderRes.items || [];
      all = assetRes.items || [];
    } catch (e) { toast(e.message, 'err'); return; }
    const CATS = ['角色', '场景', '物品', '分镜', '音频', '视频'];
    const acceptType = type && type !== 'all' ? type : 'all';

    const body = el('<div></div>');
    body.innerHTML = `
      <div class="alib-toolbar">
        <div class="search-box" style="flex:0 1 240px">
          ${icon('search', 'search-ico')}<input class="input" id="alpSearch" placeholder="搜索素材名称…">
        </div>
        <select class="select" id="alpType" style="width:auto">
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="audio">音频</option>
        </select>
        <span class="alib-count" id="alpCount"></span>
        <span class="grow"></span>
        <button class="btn btn-sm" id="alpUpload">${iconText('upload', '上传素材')}</button>
      </div>
      <div class="cat-chips" id="alpCats"></div>
      <div class="alib-body">
        <div class="alib-side">
          <div class="alib-side-head">文件夹</div>
          <div class="folder-tree" id="alpFolders"></div>
        </div>
        <div class="alib-main">
          <div class="grid grid-cards" id="alpGrid"></div>
          <div id="alpEmpty" class="hidden empty"><div class="empty-ico">${icon('folder-open')}</div><h3>暂无资产</h3><p>点击「上传素材」或从其他分类导入</p></div>
        </div>
      </div>
      <div id="alpPager"></div>`;
    const grid = body.querySelector('#alpGrid');
    const empty = body.querySelector('#alpEmpty');
    const catsBox = body.querySelector('#alpCats');
    const countBox = body.querySelector('#alpCount');
    const foldersBox = body.querySelector('#alpFolders');
    const searchInp = body.querySelector('#alpSearch');
    const typeSel = body.querySelector('#alpType');
    let curCat = category && CATS.includes(category) ? category : '';
    let curType = 'all';
    let curFolder = 'root';
    let q = '';
    let pickPage = 1;
    const sel = new Set();

    if (acceptType !== 'all') { typeSel.value = acceptType; typeSel.disabled = true; }

    const matchesType = a => acceptType === 'all' ? (curType === 'all' || a.type === curType) : a.type === acceptType;
    const matchesCat = a => !curCat ? true : (curCat === 'none' ? !a.category : a.category === curCat);
    const matchesFolder = a => curFolder === 'root' ? !a.folder_id : a.folder_id === curFolder;
    const matchesQ = a => !q || String(a.name || '').toLowerCase().includes(q);

    const renderFolders = () => {
      const roots = folders.filter(f => !f.parent_id);
      const childrenOf = pid => folders.filter(f => f.parent_id === pid);
      const node = f => {
        const kids = childrenOf(f.id);
        return `<div class="folder-item${curFolder === f.id ? ' active' : ''}" data-id="${esc(f.id)}" style="cursor:pointer;padding:6px 9px;border-radius:7px;font-size:12.5px;display:flex;align-items:center;gap:6px;margin:1px 0">
          ${icon(f.parent_id ? 'folder' : 'folder-open', 'ico-sm')}<span class="alib-fname">${esc(f.name)}</span>
        </div>` + kids.map(node).join('');
      };
      foldersBox.innerHTML = `<div class="folder-item${curFolder === 'root' ? ' active' : ''}" data-id="root" style="cursor:pointer;padding:6px 9px;border-radius:7px;font-size:12.5px;display:flex;align-items:center;gap:6px;margin:1px 0">
        ${icon('layers', 'ico-sm')}<span class="alib-fname">全部资产</span>
      </div>` + roots.map(node).join('');
      foldersBox.querySelectorAll('.folder-item').forEach(item => item.addEventListener('click', () => {
        curFolder = item.dataset.id;
        pickPage = 1;
        renderFolders(); renderGrid();
      }));
    };

    const renderCats = () => {
      const typed = all.filter(matchesType);
      const counts = {};
      for (const a of typed) counts[a.category || 'none'] = (counts[a.category || 'none'] || 0) + 1;
      const chips = [{ key: '', label: '全部分类' }]
        .concat(CATS.map(c => ({ key: c, label: c })))
        .concat([{ key: 'none', label: '未分类' }]);
      catsBox.innerHTML = chips.map(c => {
        const n = c.key === '' ? typed.length : (counts[c.key] || 0);
        return `<button class="cat-chip${curCat === c.key ? ' on' : ''}" data-cat="${esc(c.key)}">${esc(c.label)} <i style="font-style:normal;opacity:.6;font-size:11px">${n}</i></button>`;
      }).join('');
      catsBox.querySelectorAll('.cat-chip').forEach(b => b.addEventListener('click', () => {
        curCat = b.dataset.cat;
        pickPage = 1;
        renderCats(); renderGrid();
      }));
    };

    const updateCount = list => {
      countBox.innerHTML = '共 <b class="gold-num">' + list.length + '</b> 项素材' + (multi ? ' · 已选 <b class="gold-num">' + sel.size + '</b> 项' : '');
      if (okBtn) { okBtn.disabled = sel.size === 0; okBtn.innerHTML = iconText('check', '导入选中 (' + sel.size + ')'); }
    };

    const renderGrid = () => {
      const list = all.filter(a => matchesType(a) && matchesCat(a) && matchesFolder(a) && matchesQ(a));
      /* 26·1:弹窗内同样每页 20 条 —— 之前整库卡片塞在一个 54vh 的滚动区里,
         与弹窗自身的内容滚动叠成双滚动条,找素材只能拖鼠标 */
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (pickPage > pages) pickPage = pages;
      const shown = list.slice((pickPage - 1) * PAGE_SIZE, (pickPage - 1) * PAGE_SIZE + PAGE_SIZE);
      updateCount(list);
      renderPager(body.querySelector('#alpPager'), {
        page: pickPage, total: list.length,
        onPage: p => { pickPage = p; renderGrid(); }
      });
      if (!list.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      grid.innerHTML = shown.map(a => this.alibCardHTML(a, sel, multi)).join('');
      grid.querySelectorAll('[data-alib-pick]').forEach(card => {
        card.addEventListener('click', () => {
          const a = list.find(x => x.id === card.dataset.alibPick);
          if (!a) return;
          if (multi) {
            if (sel.has(a.id)) sel.delete(a.id); else sel.add(a.id);
            card.classList.toggle('sel', sel.has(a.id));
            const ck = card.querySelector('.asset-check');
            if (ck) ck.classList.toggle('on', sel.has(a.id));
            updateCount(list);
          } else {
            m.close();
            if (onPick) onPick([a]);
          }
        });
      });
    };

    searchInp.addEventListener('input', () => { q = searchInp.value.trim().toLowerCase(); pickPage = 1; renderGrid(); });
    typeSel.addEventListener('change', () => { curType = typeSel.value; pickPage = 1; renderCats(); renderGrid(); });

    body.querySelector('#alpUpload').addEventListener('click', () => {
      const dz = makeDropzone({
        text: '点击或拖拽上传图片 / 视频 / 音频素材', multiple: true,
        onFiles: async files => {
          const up = openModal({ title: '上传中…', body: '<div class="loading-wrap"><span class="spinner"></span></div>', size: 'modal-sm' });
          let okN = 0;
          for (const f of files) {
            try { await uploadFile('/assets/upload', f, { folder_id: '' }); okN++; }
            catch (e) { toast(e.message, 'err'); }
          }
          up.close();
          toast('已上传 ' + okN + ' 个素材', 'ok');
          const res = await API.get('/assets?type=all');
          all = res.items || [];
          pickPage = 1;
          renderFolders(); renderCats(); renderGrid();
        }
      });
      openModal({ title: icon('zap', 'ico-sm') + ' 上传素材', body: dz });
    });

    const cancelBtn = el('<button class="btn">取消</button>');
    let okBtn = null;
    let m;
    if (multi) {
      okBtn = el('<button class="btn btn-primary" disabled>导入选中 (0)</button>');
      cancelBtn.addEventListener('click', () => m.close());
      okBtn.addEventListener('click', () => {
        const picked = all.filter(a => sel.has(a.id));
        if (!picked.length) return toast('请先选择素材', 'err');
        m.close();
        if (onPick) onPick(picked);
      });
    } else {
      cancelBtn.addEventListener('click', () => m.close());
    }
    renderFolders(); renderCats(); renderGrid();
    m = openModal({ title: title || '资产库', size: 'modal-xl', body, footer: [cancelBtn, okBtn].filter(Boolean) });
  },

  /* 资产卡片(资产库窗口内，与资产库页面同款) */
  alibCardHTML(a, sel, multi) {
    const thumb = a.type === 'image' ? '/api/assets/' + a.id + '/file' : (a.type === 'video' ? '/api/assets/' + a.id + '/thumbnail' : '');
    const catBadge = a.category
      ? `<span class="tag-cat">${icon('tag', 'ico-xs')}${esc(a.category)}</span>`
      : '<span class="tag-cat tag-cat-none">未分类</span>';
    const check = multi ? `<span class="asset-check${sel.has(a.id) ? ' on' : ''}">${icon('check', 'ico-xs')}</span>` : '';
    return `<div class="media-card${sel.has(a.id) ? ' sel' : ''}" data-alib-pick="${a.id}" title="${esc(a.name)}">
      ${check}
      <div class="media-type-badge">${icon(a.type === 'image' ? 'image' : a.type === 'video' ? 'clapperboard' : 'music', 'ico-xs')}</div>
      ${thumb ? `<img class="media-thumb" src="${thumb}" loading="lazy">` : '<div class="media-thumb media-thumb-empty">' + icon('music') + '</div>'}
      <div class="media-body">
        <div class="media-name">${esc(a.name || '未命名')}</div>
        <div class="media-meta">${fmtBytes(a.size)}${a.duration ? ' · ' + fmtDuration(a.duration) : ''}${a.created_at ? ' · ' + fmtTime(a.created_at) : ''}</div>
        <div class="media-cat">${catBadge}</div>
      </div>
    </div>`;
  },

  /* 点击左侧资源类型(+角色/+场景/…) → 弹出资产库窗口，多选导入 */
  pickRefAsset(kind) {
    const s = this.studio;
    const CATS = ['角色', '场景', '物品', '分镜', '音频', '视频'];
    const typeMap = { '音频': 'audio', '视频': 'video', '视频帧': 'video', '图片参考': 'image' };
    const isCat = CATS.includes(kind);
    const type = isCat ? (typeMap[kind] || 'image') : (typeMap[kind] || 'all');
    this.pickAssetModal({
      title: kind === '视频帧' ? `${icon('play', 'ico-sm')} 引入视频帧` : `${icon('plus', 'ico-sm')} ${kind} 参考`,
      type, category: isCat ? kind : '', multi: true,
      onPick: list => {
        if (!list || !list.length) return;
        let added = 0;
        for (const a of list) {
          if (s.refs.some(r => r.id === a.id)) continue;
          const ref = { ...a, refType: kind === '视频帧' ? '视频帧' : kind };
          s.refs.push(ref);
          if (!s.selRef && a.type === 'image') s.selRef = ref;
          added++;
        }
        if (!added) return toast('所选素材都已在参考列表中', 'err');
        toast('已引入 ' + added + ' 项素材', 'ok');
        this.markDirty();
        this.flashShots();
        this.renderStudioBody();
      }
    });
  },

  /* ---------- 分镜增删与生成 ---------- */
  addShot() {
    const s = this.studio;
    const shot = this.newShot(s.shots.length + 1);
    s.shots.push(shot);
    this.markDirty();
    this.renderStudioBody();
    /* 新分镜出现后滚动到位，方便直接编辑 */
    requestAnimationFrame(() => {
      const card = this.root.querySelector('[data-shot-card="' + shot.key + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  },

  async removeShot(key) {
    const s = this.studio;
    if (s.shots.length <= 1) return toast('至少保留一个分镜', 'err');
    const sh = this.getShot(key);
    if (!sh) return;
    const ok = await confirmDlg(
      '确认删除「' + (sh.title || '未命名分镜') + '」？该分镜的剧本文案与参数将一并移除，已生成的视频资产不受影响。',
      { title: '删除分镜', okText: '删除' }
    );
    if (!ok) return;
    s.shots = s.shots.filter(x => x.key !== key);
    this.markDirty();
    this.renderStudioBody();
  },

  /* 分镜排序：上移 / 下移 */
  moveShot(key, dir) {
    const s = this.studio; if (!s) return;
    const idx = s.shots.findIndex(x => x.key === key);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= s.shots.length) return;
    const [sh] = s.shots.splice(idx, 1);
    s.shots.splice(to, 0, sh);
    this.markDirty();
    this.renderStudioBody();
    requestAnimationFrame(() => {
      const card = this.root.querySelector('[data-shot-card="' + key + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  },

  /* 单个分镜折叠/展开(状态持久化) */
  toggleShot(key) {
    const sh = this.getShot(key); if (!sh) return;
    sh.collapsed = !sh.collapsed;
    this.markDirty();
    this.renderStudioBody();
  },

  /* 全部折叠 / 全部展开 */
  collapseAll(collapsed) {
    const s = this.studio; if (!s) return;
    s.shots.forEach(sh => { sh.collapsed = !!collapsed; });
    this.markDirty();
    this.renderStudioBody();
  },

  /* 生成记录一键全部折叠/展开(分镜分区级，状态持久化) */
  toggleRecsCollapsed() {
    const s = this.studio; if (!s) return;
    s.recsCollapsed = !s.recsCollapsed;
    s.shots.forEach(sh => { sh.recsCollapsed = s.recsCollapsed; });
    toast(s.recsCollapsed ? '生成记录已全部折叠' : '生成记录已全部展开', 'ok');
    this.markDirty();
    this.renderStudioBody();
  },

  /* 单个分镜的生成记录分区折叠/展开 */
  toggleShotRecs(key) {
    const s = this.studio; if (!s) return;
    const sh = this.getShot(key); if (!sh) return;
    sh.recsCollapsed = !sh.recsCollapsed;
    this.markDirty();
    this.renderStudioBody();
  },

  /* 左侧参考资产面板折叠 / 展开 */
  toggleLeft() {
    const s = this.studio; if (!s) return;
    s.leftCollapsed = !s.leftCollapsed;
    this.markDirty();
    this.renderStudioBody();
  },


  /* ============================================================
     第二十五轮 · AI 生图(分镜工作台快捷入口)
     - 顶栏「AI 生图」：shot=null,生图后自动加入左侧参考资产
     - 分镜 genbar 快捷钮：预填该镜文案，生图后自动加入参考资产
     生图模型走 /api/images/generate(按张计价，免费生图模型 0 分);
     结果图自动存入资产库，可直接选中作为图生视频源图。
     ============================================================ */
  async aiImageDialog(shot) {
    const s = this.studio;
    if (!s.imgModels || !s.imgModels.length) {
      const isAdmin = App.user && App.user.role === 'admin';
      openModal({
        title: icon('image-plus', 'ico-sm') + ' AI 生图',
        size: 'modal-sm',
        body: '<div class="empty" style="padding:26px 12px"><div class="empty-ico">' + icon('image-off') + '</div>'
          + '<h3>暂无可用生图模型</h3><p style="font-size:12.5px;color:var(--ink-2)">请管理员在「后台管理 → 模型管理」添加 AI 生图模型</p>'
          + (isAdmin ? '<a class="btn btn-primary btn-sm" href="#/admin" style="margin-top:10px">' + iconText('settings', '去后台添加') + '</a>' : '')
          + '</div>'
      });
      return;
    }
    const modelOpts = s.imgModels.map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + (m.is_free ? '(免费)' : '') + '</option>').join('');
    /* 第二十六轮：能力 / 参数模板驱动(比例 · 尺寸 · 张数上限 · 多图合成) */
    const capsOf = m => Array.isArray(m && m.caps) && m.caps.length ? m.caps : ['text-to-image'];
    const canRef = m => capsOf(m).includes('image-to-image') || capsOf(m).includes('multi-image');
    const canMulti = m => capsOf(m).includes('multi-image');
    const schemaDef = (m, key) => {
      const sch = Array.isArray(m && m.params_schema) ? m.params_schema : [];
      return sch.find(d => d && d.key === key) || null;
    };
    const maxCountOf = m => {
      const mc = m && m.rules && m.rules.limits && Number(m.rules.limits.max_count);
      return Math.max(1, Math.min(Number.isFinite(mc) ? mc : 4, 4));
    };
    const RATIO_LABELS = { '1:1': '方图', '4:3': '横图', '3:4': '竖图', '16:9': '宽幅', '9:16': '全景竖', '3:2': '摄影横', '2:3': '摄影竖', '21:9': '影院宽' };
    const body = el('<div></div>');
    /* 与「AI 生图」页同一套分组(模型 / 画面描述 / 输出规格),弹窗里字段变多时不再糊成一片 */
    body.innerHTML =
      '<div class="form-sect">模型</div>'
      + '<div class="field"><label>生图模型</label><select class="select" id="igM">' + modelOpts + '</select>'
      + '<div class="hint" id="igMHint"></div></div>'
      + '<div class="form-sect">画面描述</div>'
      + '<div class="field"><label>提示词</label><textarea class="textarea" id="igP" rows="4" maxlength="2000" placeholder="描述想要的画面…(已预填本镜文案)"></textarea></div>'
      + '<div class="field" id="igRefField"><label id="igRefLabel">参考图(图生图，可选)</label><div class="ig-ref-row" id="igRefRow"></div><div class="hint" id="igRefHint"></div></div>'
      + '<div class="form-sect">输出规格</div>'
      + '<div class="form-row" id="igParamRow"></div>'
      + '<div class="hint ig-spec-out" id="igSpecOut"></div>'
      + '<div class="hint" id="igCost" style="text-align:right"></div>';
    const refAssets = (shot && s.selRef && s.selRef.type === 'image') ? [s.selRef] : [];
    /* 每张单价：模型设置过积分消耗则用模型价，否则全局 creditPerImage(第二十七轮) */
    const perImageOf = m => {
      if (m && m.is_free) return 0;
      const mp = m ? Math.max(0, Number(m.credit_per_second) || 0) : 0;
      return mp > 0 ? mp : (CreditCenter.imgPrice || 2);
    };
    const goBtn = el('<button class="btn btn-primary">' + iconText('sparkles', '开始生图') + '</button>');
    const cancelBtn = el('<button class="btn">取消</button>');
    /* footer 必须走 openModal 参数，否则 .modal-foot 不会创建(第二十五轮修复) */
    const modal = openModal({ title: icon('image-plus', 'ico-sm') + ' AI 生图' + (shot ? ' · 分镜 ' + (s.shots.indexOf(shot) + 1) : ''), size: 'modal-md', body, footer: [cancelBtn, goBtn] });
    const q = sel => body.querySelector(sel);
    if (shot && String(shot.script || '').trim()) q('#igP').value = String(shot.script).trim().slice(0, 2000);

    const curModel = () => s.imgModels.find(x => x.id === q('#igM').value) || s.imgModels[0];
    /* 分辨率档(1K/2K/4K)+ 画幅比例 → 服务端换算具体尺寸(26·3,与生图页同口径) */
    /* 参数行按当前模型参数模板重画(比例 / 分辨率 / 张数；旧模型仅配固定尺寸时显示尺寸) */
    const renderParams = () => {
      const m = curModel();
      const ratioDef = schemaDef(m, 'ratio');
      const resDef = schemaDef(m, 'resolution');
      const sizeDef = schemaDef(m, 'size');
      /* 项目设的画幅比例优先(26·5):分镜生图的构图与成片画幅保持一致 */
      const projRatio = s.project && s.project.aspect_ratio;
      let html = '';
      if (ratioDef) {
        const opts = ratioDef.options.map(String);
        const defR = opts.includes(projRatio) ? projRatio : String(ratioDef.default || opts[0]);
        html += '<div class="field"><label>画幅比例</label><select class="select" id="igAR">'
          + opts.map(rt => '<option value="' + esc(rt) + '"' + (rt === defR ? ' selected' : '') + '>'
            + esc(rt) + (RATIO_LABELS[rt] ? ' · ' + RATIO_LABELS[rt] : '') + '</option>').join('')
          + '</select></div>';
      }
      if (resDef || !sizeDef) {
        const tiers = (resDef && Array.isArray(resDef.options) && resDef.options.length) ? resDef.options.map(String)
          : (Array.isArray(m.res_tiers) && m.res_tiers.length ? m.res_tiers.map(String) : IMG_RES_TIERS);
        const defV = resDef && resDef.default != null ? String(resDef.default) : (tiers.includes('1K') ? '1K' : tiers[0]);
        html += '<div class="field"><label>分辨率</label><select class="select" id="igRes">'
          + tiers.map(rs => '<option value="' + esc(rs) + '"' + (String(rs) === defV ? ' selected' : '') + '>'
            + esc(resTierLabel(rs)) + '</option>').join('')
          + '</select></div>';
      } else {
        /* 兼容：管理员给该模型配了固定尺寸清单且未启用分辨率档 */
        const sizeLabels = { auto: '自动' };
        html += '<div class="field"><label>尺寸</label><select class="select" id="igS">'
          + sizeDef.options.map(sz => '<option value="' + esc(sz) + '">' + esc(sz) + (sizeLabels[sz] ? ' · ' + sizeLabels[sz] : '') + '</option>').join('')
          + '</select></div>';
      }
      const maxN = maxCountOf(m);
      html += '<div class="field"><label>张数</label><select class="select" id="igN">'
        + Array.from({ length: maxN }, (_, i) => i + 1).map(n => '<option value="' + n + '">' + n + ' 张</option>').join('')
        + '</select></div>';
      q('#igParamRow').innerHTML = html;
      /* 输出尺寸实时显示,比例/分辨率一改就更新 */
      const specOut = () => {
        const out = q('#igSpecOut');
        if (!out) return;
        const ar = ((q('#igAR') || {}).value || '').trim();
        const rs = ((q('#igRes') || {}).value || '').trim();
        const fixed = ((q('#igS') || {}).value || '').trim();
        if (fixed) { out.innerHTML = icon('frame', 'ico-xs') + ' 输出尺寸 <b>' + esc(fixed) + '</b>'; return; }
        const wh = imgSizeFrom(ar, rs);
        if ((m.size_mode || 'pixels') === 'tier') {
          out.innerHTML = icon('frame', 'ico-xs') + ' 请求参数 <b>size=' + esc(String(rs || '').toUpperCase())
            + ' · ratio=' + esc(ar || '1:1') + '</b>'
            + '<span class="ig-spec-note">(该网关按档位出图 · 约 ' + wh.w + '×' + wh.h + ')</span>';
          return;
        }
        const sizes = Array.isArray(m && m.supported_sizes) ? m.supported_sizes.filter(sx => String(sx).indexOf('x') > 0) : [];
        out.innerHTML = icon('frame', 'ico-xs') + ' 输出尺寸 <b>' + wh.w + '×' + wh.h + '</b>'
          + (ar ? ' · 比例 ' + esc(ar) : '') + (rs ? ' · ' + esc(String(rs).toUpperCase()) : '')
          + (sizes.length ? '<span class="ig-spec-note">(该模型仅支持 ' + esc(sizes.join(' / ')) + ',就近吸附)</span>' : '');
      };
      ['#igAR', '#igRes', '#igS'].forEach(sel => { const n = q(sel); if (n) n.addEventListener('change', specOut); });
      const nSel = q('#igN');
      if (nSel) nSel.addEventListener('change', costHint);
      specOut();
    };

    const costHint = () => {
      const m = curModel();
      const nEl = q('#igN');
      const n = nEl ? (Number(nEl.value) || 1) : 1;
      const per = perImageOf(m);
      const cost = per * n;
      q('#igCost').innerHTML = cost > 0
        ? '预计消耗 <b>' + cost + '</b> 积分(' + per + ' 分/张 × ' + n + ')· 余额 ' + (CreditCenter.cache.balance || 0)
        : '免费模型 · 不消耗积分';
      q('#igMHint').textContent = m && m.api_base && !m.has_api_key ? '⚠ 该在线模型还未配置 API Key,暂不可用' : '';
    };
    const refRow = () => {
      const m = curModel();
      const row = q('#igRefRow');
      q('#igRefField').hidden = !canRef(m);
      q('#igRefLabel').textContent = canMulti(m) ? '参考图 · 图生图 / 多图合成(可多选)' : '参考图 · 图生图(可选)';
      if (!refAssets.length) {
        row.innerHTML = '<button class="btn btn-sm" id="igRefB">' + iconText('image-plus', '选择参考图') + '</button>';
      } else {
        row.innerHTML = refAssets.map((a, i) =>
          '<span class="ig-ref-chip">'
          + '<img class="ig-ref-thumb" src="' + esc(a.thumb_path || ('/api/assets/' + a.id + '/thumbnail')) + '" alt="">'
          + '<span class="ig-ref-name">' + esc(a.name || '参考图') + '</span>'
          + '<button class="ig-ref-x" data-ref-i="' + i + '" title="移除">' + icon('x', 'ico-xs') + '</button></span>').join('')
          + (canMulti(m) && refAssets.length < 8 ? '<button class="btn btn-sm" id="igRefB" title="继续添加">' + icon('plus', 'ico-xs') + '</button>' : '');
      }
      row.querySelectorAll('.ig-ref-x').forEach(xb => xb.addEventListener('click', () => {
        refAssets.splice(Number(xb.dataset.refI), 1);
        refRow();
      }));
      const b = row.querySelector('#igRefB');
      if (b) b.addEventListener('click', () => {
        /* 复用生图页挑选弹窗(支持多选 + 大图浏览),选完回填本弹窗 */
        ImagesView.pickRefAssetsFor({
          multi: canMulti(m),
          selected: refAssets.map(a => a.id),
          onPick: list => {
            refAssets.length = 0;
            list.forEach(a => refAssets.push(a));
            refRow();
          }
        });
      });
      const hintEl = q('#igRefHint');
      if (hintEl) hintEl.textContent = refAssets.length > 1 ? '已选 ' + refAssets.length + ' 张参考图，提交后将融合生成' : '';
    };
    q('#igM').addEventListener('change', () => {
      const m = curModel();
      if (!canRef(m)) refAssets.length = 0;
      else if (!canMulti(m)) refAssets.length = Math.min(refAssets.length, 1);
      renderParams();
      refRow();
      costHint();
    });
    renderParams();
    refRow(); costHint();

    cancelBtn.addEventListener('click', () => modal.close());
    goBtn.addEventListener('click', async () => {
      const m = s.imgModels.find(x => x.id === q('#igM').value);
      const prompt = q('#igP').value.trim();
      if (!m) return toast('请选择生图模型', 'err');
      if (m.api_base && !m.has_api_key) return toast('该在线模型还未配置 API Key', 'err');
      if (!prompt) { q('#igP').focus(); return toast('请输入生图提示词', 'err'); }
      const n = Number(q('#igN').value) || 1;
      const per = perImageOf(m);
      const cost = per * n;
      if (cost > 0 && (CreditCenter.cache.balance || 0) < cost) {
        return toast('积分不足：本次需 ' + cost + ' 积分，余额 ' + (CreditCenter.cache.balance || 0), 'err');
      }
      goBtn.disabled = true;
      goBtn.innerHTML = '<span class="spinner spinner-sm"></span>提交中…';
      try {
        const arSel = q('#igAR');
        const resSel = q('#igRes');
        const sizeSel = q('#igS');
        const genRes = await API.post('/images/generate', {
          model_id: m.id,
          prompt,
          /* 优先分辨率档(服务端按 比例 × 分辨率 换算具体尺寸);
             仅旧模型(管理员配了固定尺寸清单)才带 size */
          resolution: resSel ? resSel.value : undefined,
          size: sizeSel ? sizeSel.value : undefined,
          aspect_ratio: arSel ? arSel.value : undefined,
          count: n,
          ref_asset_ids: refAssets.length ? refAssets.map(a => a.id) : undefined,
          project_id: s.projectId,
          episode_id: s.episodeId
        });
        if (cost > 0) { CreditCenter.cache.balance = (CreditCenter.cache.balance || 0) - cost; CreditCenter.refresh(); }
        toast('生图任务已提交，完成后自动加入参考资产', 'ok');
        modal.close();
        this.watchImageTask(genRes && genRes.task && genRes.task.id);
      } catch (e) { toast(e.message, 'err'); goBtn.disabled = false; goBtn.innerHTML = iconText('sparkles', '开始生图'); }
    });
  },

  /* 看护本工作台提交的生图任务(按任务 ID,可同时跟踪多个),
     完成后把结果图加入左侧参考资产(每个任务只加一次)。
     此前盯着「最新一条」生图任务：连发两个或在生图页同时提交时会跟错、漏加 */
  async watchImageTask(taskId) {
    const s = this.studio;
    if (!s || !taskId) return;
    if (!(s._igWatchIds instanceof Set)) s._igWatchIds = new Set();
    if (s._igWatchIds.has(taskId)) return;
    s._igWatchIds.add(taskId);
    s._igDeadline = Date.now() + 8 * 60e3; /* 有新任务跟进时顺延整体时限 */
    if (this._igTimer) return;
    const tryOnce = async () => {
      if (this._igBusy) return;
      this._igBusy = true;
      try {
        const st = this.studio;
        if (!st || !(st._igWatchIds instanceof Set) || !st._igWatchIds.size) {
          if (this._igTimer) { clearInterval(this._igTimer); this._igTimer = null; }
          return;
        }
        if (Date.now() > (st._igDeadline || 0)) { st._igWatchIds.clear(); return; }
        for (const tid of [...st._igWatchIds]) {
          let t = null;
          try { t = (await API.get('/tasks/' + tid)).task; }
          catch (e) {
            /* 任务已不存在(被删除)→ 停止跟进；其余错误静默下轮重试 */
            if (e && /任务不存在|404/.test(e.message || '')) st._igWatchIds.delete(tid);
            continue;
          }
          if (!t || t.status === 'queued' || t.status === 'processing') continue;
          st._igWatchIds.delete(tid);
          if (t.status !== 'completed') { toast('生图任务失败：' + (t.error || t.status), 'err'); continue; }
          let added = 0;
          for (const a of (t.result_assets || [])) {
            if (st.refs.some(r => r.id === a.id)) continue;
            st.refs.push({ id: a.id, type: 'image', name: a.name || 'AI 生图', thumb_path: a.thumb_path, refType: 'AI 生图' });
            if (!st.selRef) st.selRef = st.refs[st.refs.length - 1];
            added++;
          }
          if (added) {
            toast('已生成 ' + added + ' 张图片并加入参考资产', 'ok');
            this.markDirty();
            this.flashShots();
            this._maybeRenderStudio();
          }
        }
      } finally { this._igBusy = false; }
    };
    await tryOnce();
    if (this.studio && this.studio._igWatchIds && this.studio._igWatchIds.size && !this._igTimer) {
      this._igTimer = setInterval(tryOnce, 3000); /* 全部跟进完/超时后 tick 内部会自行清除 */
    }
  },

  /* 本镜提交时实际用作源图的参考资产：文案 [占位链接] > 左侧已选中 > 列表首张图片。
     linked 传入数组时按给定链接解析（渲染阶段 linker 还没挂上，传 [] 只走后两种来源） */
  shotSource(shot, linked) {
    const s = this.studio; if (!s) return null;
    let imgs = linked;
    if (imgs === undefined) {
      const ta = this.root && this.root.querySelector(`[data-shot-script="${shot.key}"]`);
      imgs = ta && ta._pl ? ta._pl.getLinked() : [];
    }
    const hit = (imgs || []).find(a => a.type === 'image');
    if (hit) return { asset: hit, from: '占位链接' };
    if (s.selRef && s.selRef.type === 'image') return { asset: s.selRef, from: '已选中' };
    const first = (s.refs || []).find(r => r.type === 'image');
    if (first) return { asset: first, from: '列表首张' };
    return null;
  },

  async generateShot(shot) {
    const s = this.studio;
    /* 只用该分镜当前选中的模型。此前找不到时会静默回退 s.selModel(models[0]),
       造成「界面选 A、任务跑在 B」；现在模型失效时直接提示，不再悄悄换模型 */
    const model = s.models.find(m => m.id === shot.modelId);
    if (!model) return toast('当前分镜的视频模型不可用，请重新选择模型后再提交', 'err');
    if (!String(shot.script || '').trim()) return toast('请先输入剧本文案', 'err');
    const src = this.shotSource(shot);
    if (!src) return toast('请先在左侧引入参考图，或在文案中输入 [资产名] 占位链接', 'err');
    const ref = src.asset;
    const ta = this.root.querySelector(`[data-shot-script="${shot.key}"]`);
    const plLinked = ta && ta._pl ? ta._pl.getLinked() : [];
    /* 第二十三轮：与后端一致的时长收敛 + 积分校验(显示即实扣) */
    const effDur = this.effDuration(model, shot.duration);
    const cost = CreditCenter.costFor(effDur, model);
    if (cost > 0 && (CreditCenter.cache.balance || 0) < cost) {
      return toast(`积分不足：本次需 ${cost}，余额 ${CreditCenter.cache.balance}。可到积分中心申请或选择免费模型`, 'err');
    }
    const btn = this.root.querySelector(`[data-shot-gen="${shot.key}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-sm"></span>已提交，排队中…'; }
    try {
      const { task, credits: cr } = await API.post('/tasks', {
        model_id: model.id,
        style_id: shot.styleId || undefined,
        use_asset_id: ref.id,
        project_id: s.projectId,
        episode_id: s.episodeId,
        prompt: shot.script.trim().slice(0, 2000),
        negative_prompt: (shot.neg || '').trim().slice(0, 2000),
        linked_asset_ids: plLinked.map(a => a.id),
        param_duration: effDur,
        param_fps: shot.fps,
        param_motion: shot.motion,
        param_seed: shot.seed,
        param_aspect_ratio: shot.ratio || s.spec.ratio,
        param_resolution: s.resolutions.includes(shot.resolution) ? shot.resolution : s.spec.resolution
      });
      if (cr) { CreditCenter.cache.balance = cr.balance; App.user.credits = cr.balance; CreditCenter.refresh(); }
      shot.taskIds.push(task.id);
      shot.tasks.unshift(task);
      shot.recsCollapsed = false; /* 新任务入列，自动展开该分区显示进度 */
      toast(`任务已提交： #${task.id.slice(0, 8)}${cr && cr.cost ? `(消耗 ${cr.cost} 积分)` : '(免费)'}`, 'ok');
      this.markDirty();
      this.renderStudioBody();
    } catch (e) { toast(e.message, 'err'); this.updateShotCostHints(); }
    if (btn) { btn.disabled = false; btn.innerHTML = iconText('sparkles', '生成融生视频'); }
  },

  async retryTask(id) {
    await API.post('/tasks/' + id + '/retry');
    toast('已重新排队', 'ok');
    await this.refreshStudioTasks();
  },

  async cancelTask(id) {
    await API.post('/tasks/' + id + '/cancel');
    toast('已取消', 'ok');
    await this.refreshStudioTasks();
  },

  /* 删除某条生成记录(仅终态：已完成/失败/已取消) */
  async deleteTaskRecord(id) {
    if (!await confirmDlg('确认删除这条生成记录？已生成的视频资产仍会保留在资产库中。')) return;
    try {
      await API.del('/tasks/' + id);
      const s = this.studio;
      if (s) {
        for (const shot of s.shots) {
          shot.taskIds = shot.taskIds.filter(x => x !== id);
          shot.tasks = shot.tasks.filter(t => t.id !== id);
        }
        toast('生成记录已删除', 'ok');
        this.markDirty();
        this.renderStudioBody();
      }
    } catch (e) { toast(e.message, 'err'); }
  },

  /* ---------- 轮询任务状态 ---------- */
  startStudioPolling() {
    this.stopStudioPolling();
    this.studio.taskSig = '';
    this.studio.pollTimer = setInterval(() => this.refreshStudioTasks(), 2500);
  },

  stopStudioPolling() {
    if (this.studio && this.studio.pollTimer) { clearInterval(this.studio.pollTimer); this.studio.pollTimer = null; }
    stopWaitCountdown(this.studio);
  },

  /* 轮询重渲染调度：用户正在工作台的输入框/下拉里操作时，整页重绘会打断输入
     (光标与输入法丢焦点，任务生成期间尤其明显)—— 先挂起，失焦后立即补渲染 */
  _maybeRenderStudio() {
    const s = this.studio;
    if (!s) { this._studioRenderPending = false; return; }
    const ae = document.activeElement;
    const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '') && ae.closest && ae.closest('#wsBody');
    if (typing) {
      this._studioRenderPending = true;
      if (!this._focusOutBound) {
        this._focusOutBound = true;
        document.addEventListener('focusout', this._onStudioFocusOut = () => {
          /* 延迟到焦点真正落定：可能只是从一个输入框切到另一个 */
          setTimeout(() => {
            const ae2 = document.activeElement;
            const still = ae2 && /^(INPUT|TEXTAREA|SELECT)$/.test(ae2.tagName || '') && ae2.closest && ae2.closest('#wsBody');
            if (still && this.studio) return; /* 仍在输入，监听器保留继续等 */
            this._focusOutBound = false;
            document.removeEventListener('focusout', this._onStudioFocusOut);
            if (this._studioRenderPending && this.studio) { this._studioRenderPending = false; this.renderStudioBody(); }
          }, 0);
        });
      }
      return;
    }
    this._studioRenderPending = false;
    this.renderStudioBody();
  },

  async refreshStudioTasks() {
    const s = this.studio;
    if (!s) return;
    let items;
    try { items = (await API.get('/tasks?episode_id=' + s.episodeId)).items; }
    catch (e) { return; /* 轮询失败静默，下个周期重试 */ }
    const sig = items.map(t => t.id + ':' + t.status + ':' + t.progress + ':' + (t.next_at || 0)).join('|');
    if (sig === s.taskSig) return;
    s.taskSig = sig;
    for (const shot of s.shots) {
      for (const id of shot.taskIds) {
        const t = items.find(x => x.id === id);
        if (t) {
          const idx = shot.tasks.findIndex(x => x.id === id);
          if (idx >= 0) shot.tasks[idx] = t;
          else shot.tasks.unshift(t);
        }
      }
    }
    this._maybeRenderStudio();
  },

  /* 网关排队已满的延后重投:倒计时逐秒变化但轮询签名不变,交给 ui.js 的轻量定时器只改文案节点 */
  syncWaitTicker() {
    const s = this.studio;
    if (!s) return;
    const waiting = s.shots.some(sh => (sh.tasks || []).some(t => t.status === 'queued' && t.next_at > Date.now()));
    if (waiting) ensureWaitCountdown(s, this.root);
    else stopWaitCountdown(s);
  },

  renderWorkbench() {
    const p = this.state.project;
    const h = this.root;
    const eps = p.episodes;

    /* 顶栏只回答"我在哪个项目";项目动作放在页面动作行 */
    App.setContext({
      back: { href: '#/projects', label: '项目分集' },
      eyebrow: `PROJECT · ${p.my_role === 'owner' ? '我创建' : '已加入'}`,
      title: p.name
    });

    h.innerHTML = `
    <div class="wb">
      <div class="wb-toolbar">
        <button class="btn btn-sm btn-primary" id="wbAddEp">${iconText('plus', '新建分集')}</button>
        <button class="btn btn-sm" id="wbBatchBtn">${iconText('list-checks', '批量管理')}</button>
        <div class="menu">
          <button class="btn btn-sm" id="wbMoreBtn">${iconText('more-horizontal', '更多')}${icon('chevron-down', 'ico-xs')}</button>
          <div class="menu-pop hidden" id="wbMorePop">
            <button class="menu-item" id="wbSettingsBtn">${icon('settings', 'ico-sm')}<span>项目设置</span></button>
            <button class="menu-item" id="wbShareBtn">${icon('user-plus', 'ico-sm')}<span>邀请成员(复制邀请码)</span></button>
            <button class="menu-item" id="wbExportBtn">${icon('download', 'ico-sm')}<span>导出整季</span></button>
            <div class="ctx-sep"></div>
            <button class="menu-item" id="wbNewProjectBtn">${icon('folder-plus', 'ico-sm')}<span>新建其他项目</span></button>
          </div>
        </div>
        <span class="filters-divider"></span>
        <div class="wb-search">${icon('search', 'search-ico')}<input id="wbSearch" placeholder="搜索分集标题…" value="${esc(this._query || '')}"></div>
        <span class="alib-count"><b>${eps.length}</b> 集 · 点击分集进入分镜设计</span>
      </div>
      <div class="wb-canvas"><div class="wb-grid" id="wbGrid"></div></div>
      <div class="wb-ai">
        <div class="wb-ai-inner">
          <span class="wb-ai-tag">AI</span>
          <input class="wb-ai-input" id="wbAiInput" placeholder="输入剧情方向，新建一集分集…" maxlength="80">
          <button class="wb-ai-send" id="wbAiSend">${iconText('sparkles', '生成分集')}</button>
        </div>
      </div>
      <div class="wb-batchbar hidden" id="wbBatchBar">
        <span>已选 <b id="wbBatchCount">0</b> 集</span>
        <button class="btn btn-sm btn-danger" id="wbBatchDel">${iconText('trash-2', '删除选中')}</button>
        <button class="btn btn-sm" id="wbBatchCancel">取消</button>
      </div>
    </div>`;

    this.renderGrid();
    this.bindWorkbench();
  },

  /* 邀请成员：单独弹窗展示并复制邀请码，不再占用列表工具栏 */
  async shareCodeDialog() {
    const p = this.state.project;
    const vals = await formModal({
      title: `${icon('user-plus', 'ico-sm')} 邀请成员加入「${esc(p.name)}」`,
      fields: [{ key: 'code', label: '项目邀请码(发给对方即可加入)', value: p.code || '', hint: '重置后旧邀请码立即失效' }],
      submitText: '复制并关闭',
      onSubmit: async v => {
        try { await navigator.clipboard.writeText((v.code || '').trim()); toast('邀请码已复制：' + (v.code || '').trim(), 'ok'); }
        catch (e) { toast('邀请码：' + (v.code || ''), 'ok'); }
        return true;
      }
    });
    if (vals) return;
  },

  /* ---------- 画布卡片 ---------- */
  renderGrid() {
    const grid = this.root.querySelector('#wbGrid');
    if (!grid) return;
    const p = this.state.project;
    const eps = p.episodes;
    const assets = this.state.assets;
    const query = (this._query || '').trim().toLowerCase();
    const imgCount = assets.filter(a => a.type === 'image').length;
    const videoCount = assets.filter(a => a.type === 'video').length;
    const audioCount = assets.filter(a => a.type === 'audio').length;
    const strip = assets.filter(a => a.type === 'image').slice(0, 4);

    let html = `
      <a class="wb-card wb-assets" href="#/assets">
        <span class="wb-go">${icon('arrow-right')}</span>
        <div class="wb-ic">${icon('film')}</div>
        <div class="wb-card-title">全剧资产库</div>
        <div class="wb-card-sub">角色 · 场景 · 道具素材统一管理</div>
        <div class="wb-assets-strip">
          ${strip.map(a => `<img src="/api/assets/${a.id}/file" alt="">`).join('')}
          ${assets.length > strip.length ? `<span class="wb-assets-more">+${assets.length - strip.length}</span>` : ''}
        </div>
        <div class="wb-card-foot"><b>${assets.length}</b> 项资产 · ${imgCount} 图 / ${videoCount} 视频${audioCount ? ' / ' + audioCount + ' 音频' : ''}</div>
      </a>`;

    if (!eps.length) {
      html += '<div class="wb-empty">还没有分集 — 用上方「新建分集」手动建一集，或在底部输入剧情方向由 AI 建集</div>';
    } else {
      html += eps.map(ep => this.episodeCardHTML(ep, query)).join('');
    }
    grid.innerHTML = html;

    grid.querySelectorAll('[data-ep]').forEach(card => card.addEventListener('click', e => {
      if (e.target.closest('[data-check]') || e.target.closest('.wb-ep-ops') || e.target.closest('.wb-script-btn')) return;
      if (this.batchMode) { this.toggleSelect(card.dataset.ep); return; }
      // 点击分集 → 进入分镜设计 · 视频生成工作台
      location.hash = '#/projects/' + this.state.project.id + '/episode/' + card.dataset.ep;
    }));
    grid.querySelectorAll('[data-check]').forEach(cb => cb.addEventListener('click', e => { e.stopPropagation(); this.toggleSelect(cb.dataset.check); }));
    grid.querySelectorAll('[data-rename-ep]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.renameEpisodeDialog(b.dataset.renameEp); }));
    grid.querySelectorAll('[data-del-ep]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.deleteEpisode(b.dataset.delEp); }));
    grid.querySelectorAll('[data-script-ep]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.scriptDialog(b.dataset.scriptEp); }));
  },

  episodeCardHTML(ep, query) {
    const num = String(ep.order_index + 1).padStart(2, '0');
    const main = this.epMainTitle(ep);
    const sceneCount = (ep.scenes || []).length;
    const clipCount = (ep.scenes || []).reduce((s, sc) => s + (sc.clips || []).length, 0);
    const hasScript = !!(ep.script && String(ep.script).trim());
    const full = `第${num}集 ${ep.title} ${main}`.toLowerCase();
    const hide = query && !full.includes(query);
    const sel = this.selected.has(ep.id);
    return `<div class="wb-card wb-ep${hide ? ' hide' : ''}" data-ep="${ep.id}">
      <span class="wb-check${sel ? ' on' : ''}" data-check="${ep.id}">${icon('check', 'ico-xs')}</span>
      <div class="wb-ep-top">
        <span class="wb-ep-num">第 ${num} 集</span>
        <div class="wb-ep-ops">
          <button title="重命名" data-rename-ep="${ep.id}">${icon('pencil', 'ico-xs')}</button>
          <button title="删除" data-del-ep="${ep.id}">${icon('x', 'ico-xs')}</button>
        </div>
      </div>
      <div class="wb-ep-title">${esc(main)}</div>
      <div class="wb-ep-meta"><span><b>${sceneCount}</b> 场景</span><span><b>${clipCount}</b> 片段</span></div>
      <div class="wb-ep-actions">
        <button class="wb-script-btn${hasScript ? ' done' : ''}" data-script-ep="${ep.id}">${icon(hasScript ? 'check' : 'pen-line', 'ico-sm')}<span>${hasScript ? '剧本已录入' : '剧本录入'}</span></button>
      </div>
    </div>`;
  },

  /* 从标题中提取分集主标题(去掉「第 0X 集 · 」前缀) */
  epMainTitle(ep) {
    const t = String(ep.title || '');
    const m = t.match(/^第\s*\d+\s*集[\s·\-—]*/);
    if (m) {
      const rest = t.slice(m[0].length).trim();
      if (rest) return rest;
    }
    return t || '未命名分集';
  },

  /* ---------- 工作台交互 ---------- */
  bindWorkbench() {
    const h = this.root;
    this._batchBtn = h.querySelector('#wbBatchBtn');
    bindMenu(h.querySelector('#wbMoreBtn'), h.querySelector('#wbMorePop'));
    h.querySelector('#wbAddEp').addEventListener('click', () => this.addEpisodeDialog());
    h.querySelector('#wbBatchBtn').addEventListener('click', () => this.toggleBatch());
    h.querySelector('#wbSettingsBtn').addEventListener('click', () => this.settingsDialog());
    h.querySelector('#wbShareBtn').addEventListener('click', () => this.shareCodeDialog());
    h.querySelector('#wbExportBtn').addEventListener('click', () => this.exportDialog(true));
    h.querySelector('#wbNewProjectBtn').addEventListener('click', () => this.newProjectDialog());
    const search = h.querySelector('#wbSearch');
    search.addEventListener('input', () => { this._query = search.value; this.renderGrid(); });
    h.querySelector('#wbAiSend').addEventListener('click', () => this.aiCreateEpisode());
    h.querySelector('#wbAiInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.aiCreateEpisode(); });
    h.querySelector('#wbBatchDel').addEventListener('click', () => this.deleteSelected());
    h.querySelector('#wbBatchCancel').addEventListener('click', () => this.toggleBatch(false));
  },

  /* 项目设置(高亮选中的工具按钮) */
  async settingsDialog() {
    const p = this.state.project;
    const isOwner = p.my_role === 'owner' || (App.user.role === 'admin');
    let cfg = null;
    try { cfg = await API.get('/config'); } catch (e) { cfg = null; }
    const resolutions = (cfg && Array.isArray(cfg.videoResolutions) && cfg.videoResolutions.length)
      ? cfg.videoResolutions : ['480p', '720p', '960p', '2k'];
    const ratios = (cfg && Array.isArray(cfg.aspectRatios) && cfg.aspectRatios.length)
      ? cfg.aspectRatios : VIDEO_RATIOS.map(r => r.v);
    const fpsList = (cfg && Array.isArray(cfg.fpsOptions) && cfg.fpsOptions.length)
      ? cfg.fpsOptions : COMMON_FPS.map(o => o.v);
    const body = el('<div></div>');
    body.appendChild(el(`<div class="field"><label>项目名称</label><input class="input" id="setName" value="${esc(p.name)}" ${isOwner ? '' : 'disabled'}></div>`));
    body.appendChild(el(`<div class="field"><label>项目描述</label><textarea class="textarea" id="setDesc" placeholder="选填" ${isOwner ? '' : 'disabled'}>${esc(p.description || '')}</textarea></div>`));
    /* 26·5:出片规格 —— 保存后对该项目「新增的分镜」与本地渲染出片尺寸生效,已存在的分镜保留自己的参数 */
    const dis = isOwner ? '' : 'disabled';
    const curRes = resolutions.includes(p.resolution) ? p.resolution : (resolutions.includes('720p') ? '720p' : resolutions[0]);
    const curRatio = ratios.includes(p.aspect_ratio) ? p.aspect_ratio : '16:9';
    const curFps = fpsList.some(f => Number(f) === Number(p.fps)) ? Number(p.fps) : 30;
    const curDur = Math.min(15, Math.max(3, Math.round(Number(p.shot_duration) || 10)));
    body.appendChild(el(`<div class="field"><div class="form-sect">出片规格</div>
      <div class="form-row">
        <div class="field"><label>画幅比例</label><select class="select" id="setRatio" ${dis}>
          ${ratios.map(r => `<option value="${esc(r)}"${r === curRatio ? ' selected' : ''}>${esc((VIDEO_RATIOS.find(x => x.v === r) || {}).t || r)}</option>`).join('')}
        </select></div>
        <div class="field"><label>分辨率</label><select class="select" id="setRes" ${dis}>
          ${resolutions.map(r => `<option value="${esc(r)}"${r === curRes ? ' selected' : ''}>${esc(videoResLabel(r))}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>帧率</label><select class="select" id="setFps" ${dis}>
          ${fpsList.map(f => `<option value="${esc(f)}"${Number(f) === curFps ? ' selected' : ''}>${esc((COMMON_FPS.find(o => Number(o.v) === Number(f)) || {}).t || f + ' fps')}</option>`).join('')}
        </select></div>
        <div class="field"><label>单镜默认时长</label><select class="select" id="setDur" ${dis}>
          ${Array.from({ length: 13 }, (_, i) => i + 3).map(d => `<option value="${d}"${d === curDur ? ' selected' : ''}>${d}s</option>`).join('')}
        </select></div>
      </div>
      <div class="hint" id="setSpecOut"></div></div>`));
    const specOut = () => {
      const n = body.querySelector('#setSpecOut');
      if (!n) return;
      const wh = videoWH(body.querySelector('#setRes').value, body.querySelector('#setRatio').value);
      n.innerHTML = icon('frame', 'ico-xs') + ' 按当前设置成片尺寸 <b>' + wh.w + '×' + wh.h + '</b> · '
        + esc(body.querySelector('#setFps').value) + 'fps · 单镜 ' + esc(body.querySelector('#setDur').value) + 's'
        + (isOwner ? ' · 新增分镜与本地渲染按此出片' : ' · 仅房主可修改');
    };
    ['#setRatio', '#setRes', '#setFps', '#setDur'].forEach(sel => {
      const n = body.querySelector(sel);
      if (n) n.addEventListener('change', specOut);
    });
    specOut();
    body.appendChild(el(`<div class="field"><label>项目唯一编号(ID)</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="input" value="${esc(p.id)}" readonly style="font-family:var(--mono);font-size:11.5px;color:var(--ink-2)">
      </div></div>`));
    if (isOwner) {
      body.appendChild(el(`<div class="field"><label>分享邀请码(把此码发给成员，对方即可加入项目)</label>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="proj-code-badge" style="font-size:15px;padding:6px 14px">${icon('hash')}${esc(p.code || '—')}</span>
          <button class="btn btn-sm" id="copyCodeBtn">${iconText('copy', '复制')}</button>
          <button class="btn btn-sm" id="rotateCodeBtn">${iconText('refresh-cw', '重置邀请码')}</button>
        </div>
        <div class="hint">重置后旧邀请码立即失效</div></div>`));
      const memberBox = el('<div class="field"><label>项目成员</label><div id="memberList" style="font-size:12.5px;color:var(--ink-2)">加载中…</div></div>');
      body.appendChild(memberBox);
    } else {
      body.appendChild(el(`<div class="field"><button class="btn btn-sm btn-danger" id="leaveProjectBtn">${iconText('log-out', '退出该项目')}</button></div>`));
    }
    body.appendChild(el(`<div class="field"><div class="hint">创建于 ${fmtTime(p.created_at)} · 共 ${p.episodes.length} 个分集</div></div>`));
    const saveBtn = el('<button class="btn btn-primary">保存设置</button>');
    const exportBtn = el(`<button class="btn">${iconText('download', '导出整季')}</button>`);
    const delBtn = isOwner ? el(`<button class="btn btn-danger">${iconText('trash-2', '删除项目')}</button>`) : null;
    const cancelBtn = el('<button class="btn">取消</button>');
    const foot = [exportBtn, saveBtn, cancelBtn];
    if (delBtn) foot.unshift(delBtn);
    let m;
    cancelBtn.addEventListener('click', () => m && m.close()); // 修复：取消按钮原先未绑定事件
    m = openModal({ title: `${icon('settings', 'ico-sm')} 项目设置`, size: 'modal-md', body, footer: foot });
    if (!isOwner) saveBtn.classList.add('hidden');
    if (isOwner) {
      body.querySelector('#copyCodeBtn').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(p.code || ''); toast('邀请码已复制', 'ok'); }
        catch (e) { toast('邀请码：' + p.code, 'ok'); }
      });
      body.querySelector('#rotateCodeBtn').addEventListener('click', async () => {
        try {
          const { project } = await API.patch('/projects/' + p.id, { rotate_code: true });
          this.state.project.code = project.code;
          toast('邀请码已重置：' + project.code, 'ok');
          m.close(); this.settingsDialog();
        } catch (e) { toast(e.message, 'err'); }
      });
      API.get('/projects/' + p.id + '/members').then(res => {
        const box = body.querySelector('#memberList');
        if (!box) return;
        box.innerHTML = res.items.length
          ? res.items.map(u => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span class="avatar" style="width:22px;height:22px;font-size:10px">${avatar(u.name)}</span>${esc(u.name)} <span style="color:var(--ink-3);font-size:11px">${esc(u.email)}</span></div>`).join('')
          : '<span style="color:var(--ink-3)">暂无成员，分享上方邀请码即可邀请协作</span>';
      }).catch(() => {});
    } else {
      body.querySelector('#leaveProjectBtn')?.addEventListener('click', async () => {
        if (!await confirmDlg('确认退出该项目？退出后将无法访问')) return;
        try {
          await API.post('/projects/' + p.id + '/leave');
          toast('已退出项目', 'ok'); m.close();
          if (window.App && App.refreshProjects) App.refreshProjects();
          location.hash = '#/projects';
        } catch (e) { toast(e.message, 'err'); }
      });
    }
    saveBtn.addEventListener('click', async () => {
      const patch = {
        name: body.querySelector('#setName').value,
        description: body.querySelector('#setDesc').value
      };
      if (isOwner) {
        patch.aspect_ratio = body.querySelector('#setRatio').value;
        patch.resolution = body.querySelector('#setRes').value;
        patch.fps = Number(body.querySelector('#setFps').value);
        patch.shot_duration = Number(body.querySelector('#setDur').value);
      }
      await API.patch('/projects/' + p.id, patch);
      toast('设置已保存 · 新增分镜按新规格初始化', 'ok');
      m.close();
      if (window.App && App.refreshProjects) App.refreshProjects();
      this.renderDetail(p.id);
    });
    exportBtn.addEventListener('click', () => { m.close(); this.exportDialog(true); });
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (await confirmDlg('确认删除整个项目？分集与场景结构将一并删除(资产文件保留)。')) {
        await API.del('/projects/' + p.id);
        toast('项目已删除', 'ok');
        m.close();
        if (window.App && App.refreshProjects) App.refreshProjects();
        location.hash = '#/projects';
      }
    });
  },

  /* 批量管理 */
  toggleBatch(force) {
    this.batchMode = force !== undefined ? force : !this.batchMode;
    document.body.classList.toggle('wb-batch', this.batchMode);
    const btn = this._batchBtn;
    if (btn) {
      btn.classList.toggle('on', this.batchMode);
      btn.innerHTML = iconText('list-checks', this.batchMode ? '批量管理中' : '批量管理');
    }
    const bar = this.root.querySelector('#wbBatchBar');
    if (bar) bar.classList.toggle('hidden', !this.batchMode);
    if (!this.batchMode) this.selected.clear();
    this.renderGrid();
    this.updateBatchBar();
  },

  toggleSelect(epId) {
    if (this.selected.has(epId)) this.selected.delete(epId);
    else this.selected.add(epId);
    this.renderGrid();
    this.updateBatchBar();
  },

  updateBatchBar() {
    const count = this.root.querySelector('#wbBatchCount');
    if (count) count.textContent = this.selected.size;
  },

  async deleteSelected() {
    const ids = [...this.selected];
    if (!ids.length) return toast('请先选择分集', 'err');
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 个分集？场景将一并删除。`)) return;
    for (const id of ids) await API.del('/episodes/' + id);
    toast('已删除 ' + ids.length + ' 个分集', 'ok');
    this.toggleBatch(false);
    this.renderDetail(this.state.project.id);
  },

  /* ---------- 分集操作 ---------- */
  async addEpisodeDialog() {
    const p = this.state.project;
    const vals = await formModal({
      title: '新建分集',
      fields: [{ key: 'title', label: '分集标题', placeholder: '如： 第 05 集 · 转折', value: '第 ' + (p.episodes.length + 1) + ' 集' }],
      submitText: '创建'
    });
    if (vals) {
      await API.post('/projects/' + p.id + '/episodes', vals);
      toast('分集已创建', 'ok');
      this.renderDetail(p.id);
    }
  },

  async renameEpisodeDialog(epId) {
    const ep = this.state.project.episodes.find(e => e.id === epId);
    if (!ep) return;
    const vals = await formModal({ title: '重命名分集', fields: [{ key: 'title', label: '分集标题', value: ep.title }], submitText: '保存' });
    if (vals) {
      await API.patch('/episodes/' + epId, { title: vals.title });
      toast('已保存', 'ok');
      this.renderDetail(this.state.project.id);
    }
  },

  async deleteEpisode(epId) {
    if (await confirmDlg('确认删除该分集？')) {
      await API.del('/episodes/' + epId);
      toast('分集已删除', 'ok');
      this.renderDetail(this.state.project.id);
    }
  },

  /* 剧本录入 */
  async scriptDialog(epId) {
    const ep = this.state.project.episodes.find(e => e.id === epId);
    if (!ep) return;
    const num = String(ep.order_index + 1).padStart(2, '0');
    const vals = await formModal({
      title: `${icon('pen-line', 'ico-sm')} 剧本录入 · 第 ${num} 集`,
      fields: [{
        key: 'script', label: '分集剧本', type: 'textarea', value: ep.script || '',
        placeholder: '编写本集的剧情梗概、关键台词与分镜提示…'
      }],
      submitText: '保存剧本'
    });
    if (vals) {
      await API.patch('/episodes/' + epId, { script: vals.script });
      toast('剧本已保存', 'ok');
      this.renderDetail(this.state.project.id);
    }
  },

  /* AI 分集创作(本地模拟：剧情方向 → 新分集) */
  async aiCreateEpisode() {
    const input = this.root.querySelector('#wbAiInput');
    const text = (input.value || '').trim();
    if (!text) return toast('请输入剧情方向', 'err');
    const btn = this.root.querySelector('#wbAiSend');
    btn.disabled = true;
    try {
      await API.post('/projects/' + this.state.project.id + '/episodes', { title: text.slice(0, 80) });
      toast('AI 已生成新分集：「' + text.slice(0, 24) + (text.length > 24 ? '…' : '') + '」', 'ok');
      input.value = '';
      this.renderDetail(this.state.project.id);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  },

  /* 导出 */
  exportDialog(all, presetEpId) {
    const eps = this.state.project.episodes;
    const body = el('<div></div>');
    body.appendChild(el(`<div style="font-size:13px;color:var(--ink-2);margin-bottom:12px">${all ? '导出整季' : '导出单个分集'}，所有片段将按场景顺序拼接为 MP4(最高 4K)。</div>`));
    const sel = el('<select class="select"></select>');
    if (!all) {
      sel.innerHTML = eps.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
      if (presetEpId) sel.value = presetEpId;
      body.appendChild(sel);
    }
    const resSel = el('<select class="select" style="margin-top:8px"></select>');
    resSel.innerHTML = [
      ['1920', '1080', '1080p (1920×1080)'], ['1280', '720', '720p (1280×720)'], ['3840', '2160', '4K (3840×2160)']
    ].map(r => `<option value="${r[0]}x${r[1]}">${r[2]}</option>`).join('');
    body.appendChild(resSel);
    const okBtn = el('<button class="btn btn-primary">开始导出</button>');
    const status = el('<div style="font-size:12px;color:var(--ink-2);margin-top:10px"></div>');
    body.appendChild(status);
    const exportCancelBtn = el('<button class="btn">取消</button>');
    let m;
    exportCancelBtn.addEventListener('click', () => { if (m && !okBtn.disabled) m.close(); }); // 修复：取消按钮原先未绑定事件
    m = openModal({ title: all ? '导出整季' : '导出分集', size: 'modal-sm', body, footer: [exportCancelBtn, okBtn] });
    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true;
      status.textContent = '正在拼接导出，请稍候…';
      const [w, h] = resSel.value.split('x');
      const qs = `width=${w}&height=${h}${all ? '&all=1' : '&episode_id=' + sel.value}`;
      try {
        const res = await fetch(`/api/projects/${this.state.project.id}/export?${qs}`, { credentials: 'same-origin' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || '导出失败');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        download(url, (all ? '整季' : '分集') + '_' + this.state.project.name + '.mp4');
        URL.revokeObjectURL(url);
        toast('导出完成', 'ok');
        m.close();
      } catch (e) { status.textContent = ''; toast(e.message, 'err'); okBtn.disabled = false; }
    });
  }
};
