'use strict';
/* 项目分集:项目列表 + 漫剧创作工作台(分集列表/剧本录入/批量管理/AI 分集) */

/* 十八·3 常见帧率:覆盖电影 / 电视(PAL·NTSC)/ 高帧率等主流规格,
   下拉选项与工作记录恢复校验共用这一份表,新增规格只改这里 */
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
      document.body.classList.add('wb-mode');
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
    h.innerHTML = `
    <div class="toolbar" style="align-items:center;justify-content:space-between">
      ${breadcrumb([{ label: '项目分集', tag: 'PROJECTS' }])}
      <div style="display:flex;gap:10px;align-items:center">
        <div class="join-box">
          <input class="input" id="joinCodeInput" placeholder="输入项目邀请码" maxlength="12">
          <button class="btn" id="joinBtn">${iconText('user-plus', '加入项目')}</button>
        </div>
        <button class="btn" id="projSelectAllBtn" title="选中当前全部项目">${iconText('check-check', '全选')}</button>
        <button class="btn btn-primary" id="newProjectBtn">${iconText('plus', '新建项目')}</button>
      </div>
    </div>
    <div class="grid grid-cards" id="projGrid"></div>
    <div class="ast-batchbar hidden" id="projBatchBar">
      <span>已选 <b id="projSelCount">0</b> 个项目</span>
      <button class="btn btn-sm btn-danger" id="projBatchDel">${iconText('trash-2', '删除选中')}</button>
      <button class="btn btn-sm" id="projBatchCancel">取消</button>
    </div>`;
    const grid = h.querySelector('#projGrid');
    if (!this.state.projects.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">${icon('film')}</div><h3>还没有项目</h3><p>创建剧集项目,或使用管理员分享的邀请码加入</p></div>`;
    } else {
      grid.innerHTML = this.state.projects.map(p => `
        <div class="card proj-card${this.selected.has(p.id) ? ' sel' : ''}" style="text-decoration:none;color:var(--text);display:block;position:relative;cursor:pointer" data-proj-link="${p.id}">
          <div style="display:flex;align-items:center;gap:8px">
            ${p.my_role === 'owner' || (App && App.user && App.user.role === 'admin')
              ? `<span class="asset-check proj-check${this.selected.has(p.id) ? ' on' : ''}" data-proj-check="${p.id}">${icon('check', 'ico-xs')}</span>`
              : ''}
            <div class="proj-card-ico">${icon('clapperboard')}</div>
            <div style="flex:1"></div>
            ${p.my_role === 'owner' || (App && App.user && App.user.role === 'admin')
              ? `<span class="proj-code-badge" title="项目唯一编号 · 点击复制" data-copy-code="${esc(p.code || '')}">${icon('hash')}${esc(p.code || '')}</span>`
              : '<span class="member-tag">已加入</span>'}
          </div>
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;margin-top:8px">${esc(p.name)}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">${esc(p.description || '暂无描述')}</div>
          <div style="font-size:11px;color:var(--text-faint)">ID:${esc(p.id.slice(0, 12))}… · ${p.episode_count} 个分集 · ${p.task_count} 个任务</div>
          ${p.my_role === 'owner' || (App && App.user && App.user.role === 'admin')
            ? `<div class="proj-ops">
                <button class="proj-edit-btn" data-proj-edit="${p.id}" title="编辑项目">${icon('pencil', 'ico-xs')}</button>
                <button class="proj-del-btn" data-proj-del="${p.id}" title="删除项目">${icon('trash-2', 'ico-xs')}</button>
              </div>`
            : ''}
        </div>`).join('');
    }
    h.querySelector('#newProjectBtn').addEventListener('click', () => this.newProjectDialog());
    h.querySelector('#joinBtn').addEventListener('click', () => this.joinProjectDialog(h.querySelector('#joinCodeInput').value));
    h.querySelector('#joinCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.joinProjectDialog(e.target.value); });
    grid.querySelectorAll('[data-copy-code]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.copyCode); toast('邀请码已复制:' + b.dataset.copyCode, 'ok'); }
      catch (err) { toast('邀请码:' + b.dataset.copyCode, 'ok'); }
    }));
    /* 点击项目卡片 → 进入项目详情;编辑/删除按钮单独处理 */
    grid.querySelectorAll('[data-proj-link]').forEach(card => card.addEventListener('click', e => {
      if (e.target.closest('[data-proj-edit]') || e.target.closest('[data-proj-del]') || e.target.closest('[data-copy-code]')) return;
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
    /* 项目勾选(全选/复选框/批量删除) */
    h.querySelector('#projSelectAllBtn').addEventListener('click', () => this.selectAllProjects());
    h.querySelector('#projBatchDel').addEventListener('click', () => this.applyProjBatchDelete());
    h.querySelector('#projBatchCancel').addEventListener('click', () => { this.selected.clear(); this.updateProjBatchBar(); this.renderList(); });
    grid.querySelectorAll('[data-proj-check]').forEach(box => box.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      this.toggleProjSelect(box.dataset.projCheck);
    }));
  },

  /* 编辑自己创建的项目(名称/描述) */
  async editProjectDialog(projectId) {
    const p = this.state.projects.find(x => x.id === projectId);
    if (!p) return toast('项目不存在', 'err');
    const vals = await formModal({
      title: `${icon('pencil', 'ico-sm')} 编辑项目 · ${esc(p.name)}`,
      fields: [
        { key: 'name', label: '项目名称', value: p.name, placeholder: '如: 《山海录》第一季' },
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
    if (!await confirmDlg(`确认删除项目「${p.name}」?分集与场景结构将一并删除(资产文件保留)。`)) return;
    try {
      await API.del('/projects/' + projectId);
      toast('项目已删除', 'ok');
      if (window.App && App.refreshProjects) App.refreshProjects();
      const res = await API.get('/projects');
      this.state.projects = res.items;
      this.renderList();
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 全选:选中当前列表中的全部项目(可删除的) */
  selectAllProjects() {
    const selectable = this.state.projects.filter(p => p.my_role === 'owner' || (App && App.user && App.user.role === 'admin'));
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
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 个项目?分集与场景结构将一并删除(资产文件保留)。`)) return;
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

  async newProjectDialog() {
    const vals = await formModal({
      title: '新建项目',
      fields: [
        { key: 'name', label: '项目名称', placeholder: '如: 《山海录》第一季', value: '' },
        { key: 'description', label: '项目描述', type: 'textarea', placeholder: '选填', value: '' }
      ],
      submitText: '创建'
    });
    if (vals) {
      const { project } = await API.post('/projects', vals);
      toast('项目已创建', 'ok');
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
     分镜设计工作台:点击分集进入 → 视频生成(模型 / 风格 / 融生视频)
     ============================================================ */
  studio: null,

  async renderEpisodeStudio(projectId, episodeId) {
    const [projRes, modelsRes, stylesRes, assetsRes, stateRes, cfgRes] = await Promise.all([
      API.get('/projects/' + projectId),
      API.get('/styles/models'),
      API.get('/styles'),
      API.get('/assets?type=all'), /* 不再限定根目录:全部资产(含子文件夹)都可链接/引用 */
      API.get('/episodes/' + episodeId + '/studio').catch(() => ({ state: null, saved_at: null })),
      /* 第二十轮:生成视频尺寸由后台「系统设置 → 生成视频尺寸」下发(480p/720p/960p/2k 勾选) */
      API.get('/config').catch(() => null)
    ]);
    const project = projRes.project;
    const episode = project.episodes.find(e => e.id === episodeId);
    if (!episode) { toast('分集不存在', 'err'); location.hash = '#/projects/' + projectId; return; }
    this.state.project = project; // 供 settingsDialog / exportDialog 复用
    const models = modelsRes.items.filter(m => m.enabled !== 0);
    this.studio = {
      projectId, episodeId, project, episode,
      models, styles: stylesRes.items,
      assets: assetsRes.items,
      refs: [], shots: [], tasks: [],
      tab: 'storyboard', leftCollapsed: false, recsCollapsed: false,
      selRef: null, selModel: models[0] || null,
      /* 后台下发的生成尺寸白名单与默认档(接口异常时用兜底值) */
      resolutions: (cfgRes && Array.isArray(cfgRes.videoResolutions) && cfgRes.videoResolutions.length)
        ? cfgRes.videoResolutions : ['480p', '720p', '960p', '2k'],
      defaultResolution: (cfgRes && cfgRes.defaultResolution) || '720p',
      taskSig: '', pollTimer: null, uidSeed: 0,
      renderedOnce: false, dirty: false, saveTimer: null
    };
    await CreditCenter.refresh();
    /* 恢复上次保存的工作记录(分镜文案/参数/任务关联/参考资产),实现"工作记录后保存" */
    const saved = stateRes && stateRes.state;
    if (saved && Array.isArray(saved.shots) && saved.shots.length) {
      for (const rs of saved.shots) {
        const sh = this.newShot(this.studio.shots.length + 1);
        sh.title = String(rs.title || sh.title).slice(0, 80);
        sh.script = String(rs.script || '');
        sh.duration = Math.min(15, Math.max(3, Number(rs.duration) || 10));
        sh.neg = String(rs.neg || '');
        sh.modelId = models.some(m => m.id === rs.modelId) ? rs.modelId : sh.modelId;
        sh.styleId = this.studio.styles.some(x => x.id === rs.styleId) ? rs.styleId : '';
        sh.tab = 'fusion';
        sh.fps = isCommonFps(rs.fps) ? Number(rs.fps) : 30;
        sh.motion = Math.min(1, Math.max(0, Number(rs.motion) || 0.6));
        sh.seed = Number.isFinite(Number(rs.seed)) ? Number(rs.seed) : -1;
        sh.ratio = ['9:16', '16:9'].includes(rs.ratio) ? rs.ratio : (sh.ratio || '16:9');
        /* 分辨率:仅接受后台配置的尺寸,历史值(如 1080p)不在名单内时回退默认档 */
        sh.resolution = this.studio.resolutions.includes(rs.resolution)
          ? rs.resolution : this.studio.defaultResolution;
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
    if (!n) return;
    const map = {
      idle: '自动保存已开启',
      pending: '有未保存更改 · 点击立即保存',
      saving: '正在保存工作记录…',
      saved: ts ? ('工作记录已保存 · ' + fmtTime(ts)) : '工作记录已保存',
      error: '保存失败 · 点击重试'
    };
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

  /* 视图卸载/关闭页面时的尽力保存:sendBeacon 或 keepalive fetch */
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

  newShot(idx) {
    const m = (this.studio.models[0] || {}).id || '';
    const s = this.studio;
    // 如果已有分镜,复制上一个分镜的参数(除文案外)
    const prev = s.shots.length > 0 ? s.shots[s.shots.length - 1] : null;
    return {
      key: 'shot-' + (++this.studio.uidSeed),
      title: '新分镜 ' + idx,
      script: '', duration: 10, neg: '',
      modelId: prev ? prev.modelId : m, styleId: prev ? prev.styleId : '',
      tab: 'fusion',
      fps: prev ? prev.fps : 30, motion: prev ? prev.motion : 0.6, seed: prev ? prev.seed : -1,
      ratio: prev ? prev.ratio : '16:9',
      resolution: (prev && this.studio.resolutions.includes(prev.resolution)) ? prev.resolution : this.studio.defaultResolution,
      taskIds: [], tasks: [],
      collapsed: false, recsCollapsed: false
    };
  },

  getShot(key) { return (this.studio.shots || []).find(sh => sh.key === key); },

  /* ---------- 外壳:单行顶部导航(层级选择 · 视图切换 · 工具动作 · 保存状态) + 主体 + 底部 ----------
     十七·2:工具栏并入顶栏,省出一整行高度给创作区;主区改为「创作左 / 参数右」双栏 */
  renderStudioShell() {
    const s = this.studio;
    const nn = String(s.episode.order_index + 1).padStart(2, '0');
    const projName = s.project.name || '未命名项目';
    this.root.innerHTML = `
    <div class="ws" id="wsRoot">
      <nav class="ws-nav">
        <div class="ws-nav-left">
          <span class="ws-ep-badge" title="当前分集">EP ${nn}</span>
          <nav class="ws-crumb" aria-label="层级选择">
            <a href="#/projects">项目分集</a><i class="sep">/</i>
            <a href="#/projects/${s.projectId}" title="返回「${esc(projName)}」分集列表">${esc(projName)} · 分集列表</a><i class="sep">/</i>
            <b title="当前层级">第${nn}集 · 视频创作</b>
          </nav>
        </div>
        <div class="ws-nav-tabs">
          <button class="ws-tab${s.tab === 'storyboard' ? ' active' : ''}" data-ws-tab="storyboard">${icon('layout-template', 'ico-sm')}分镜设计</button>
          <button class="ws-tab${s.tab === 'edit' ? ' active' : ''}" data-ws-tab="edit">${icon('monitor-play', 'ico-sm')}剪辑预览</button>
        </div>
        <div class="ws-nav-right">
          <div class="ws-nav-tools">
            <button class="ws-tbtn" data-ws-action="script" title="编辑本集剧本文案">${iconText('file-text', '录入原文')}</button>
            <button class="ws-tbtn" data-ws-action="review" title="查看本集全部生成任务">${iconText('clapperboard', '批量审片')}</button>
            <button class="ws-tbtn" data-ws-action="log" title="查看提交记录与异常">${iconText('scroll-text', '工作日志')}</button>
            <button class="ws-tbtn accent" data-ws-action="supply" title="上传素材入库">${iconText('zap', '补给资产')}</button>
          </div>
          <span class="ws-save-state" id="wsSaveState" data-state="idle" title="工作记录会自动保存到服务器">自动保存已开启</span>
        </div>
      </nav>

      <div class="ws-body" id="wsBody"></div>

      <div class="ws-foot">
        <button class="ws-add-shot" data-ws-action="addshot">${iconText('plus', '追加新分镜')}</button>
      </div>
    </div>`;
    this.renderStudioBody();
    this.bindStudioEvents();
  },

  renderStudioBody() {
    const body = this.root.querySelector('#wsBody');
    if (!body) return;
    const s = this.studio;
    /* 轮询重渲染前记住滚动位置,避免任务进度刷新时列表跳动 */
    const prevMain = body.querySelector('.ws-main');
    const scrollTop = prevMain ? prevMain.scrollTop : 0;
    body.innerHTML = s.tab === 'storyboard' ? this.storyboardHTML() : this.editPreviewHTML();
    /* 入场动画只在首次进入时播放;之后的重渲染(轮询/切参)不再重放,
       否则多分镜时会看到"只有中间分镜在滑"的错觉 */
    if (s.renderedOnce) body.classList.add('no-anim');
    else s.renderedOnce = true;
    if (s.tab === 'storyboard') {
      const main = body.querySelector('.ws-main');
      if (main && scrollTop) main.scrollTop = scrollTop;
      /* 每个分镜的剧本文案启用 [占位符] 自动链接 + 高亮 + 已链接资源 chips
         二十二·1:参考资产门控 —— 仅左侧「参考资产」可被 [占位符] 引用,
         资产库同名但未引入的一律按未链接渲染,悬停提示先引入再引用 */
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
  },

  /* 分镜下方"已链接资源"chips(带签名去重,避免轮询重绘闪烁)
     二十二·1:chips 与提示只来自参考资产;二十二·2:点击 chips 放大查看 */
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

  /* 二十二·2 放大查看:提示词下方引用 chips 与左侧参考资产共用的大图预览
     图片/视频直接大图播放,音频给播放器,附名称 / 规格 / 参考状态与下载 */
  openAssetPreview(asset) {
    if (!asset) return;
    const s = this.studio;
    const fileUrl = '/api/assets/' + asset.id + '/file';
    const typeTxt = asset.type === 'image' ? '图片' : asset.type === 'video' ? '视频' : asset.type === 'audio' ? '音频' : '文件';
    let media;
    if (asset.type === 'image') {
      media = '<img class="preview-media pv-media" src="' + fileUrl + '" alt="' + esc(asset.name) + '">';
    } else if (asset.type === 'video') {
      const poster = asset.thumb_path ? '/api/assets/' + asset.id + '/thumbnail' : '';
      media = '<video class="preview-media pv-media pv-video" src="' + fileUrl + '"' + (poster ? ' poster="' + poster + '"' : '') + ' controls autoplay muted playsinline></video>';
    } else {
      media = '<div class="pv-audio-box">' + icon('music') + '<audio class="pv-audio" src="' + fileUrl + '" controls></audio></div>';
    }
    const meta = [typeTxt, fmtBytes(asset.size),
      asset.width ? asset.width + '×' + asset.height : '',
      asset.duration ? fmtDuration(asset.duration) : ''].filter(Boolean).join(' · ');
    const inRefs = s && s.refs.some(r => r.id === asset.id);
    const refTag = inRefs
      ? '<span class="pv-tag">' + icon('circle-check', 'ico-xs') + '已加入参考资产' + (asset.refType ? ' · ' + esc(asset.refType) : '') + '</span>'
      : '';
    const closeBtn = el('<button class="btn">关闭</button>');
    const dlBtn = el('<a class="btn btn-primary" href="' + fileUrl + '" download="' + esc(asset.name) + '">' + iconText('download', '下载素材') + '</a>');
    let m;
    closeBtn.addEventListener('click', () => m.close());
    m = openModal({
      title: icon('zoom-in', 'ico-sm') + ' ' + esc(String(asset.name || '').replace(/\.[^.]+$/, '')),
      size: 'modal-lg',
      body: '<div class="pv-stage">' + media + '</div>' +
        '<div class="pv-meta"><b class="pv-name">' + esc(asset.name || '未命名') + '</b><span>' + esc(meta) + '</span>' + refTag + '</div>',
      footer: [closeBtn, dlBtn]
    });
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
    /* 若无匹配,提示该占位符链接的来源不在当前参考列表 */
    if (!matched) {
      const first = this.root.querySelector('.ws-ref-list [data-ref-sel]');
      if (first && first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    }
  },

  /* 第二十三轮:模型 params_schema 限定时长范围时把显示时长收敛到范围内,
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
      const dur = this.effDuration(model, sh.duration);
      const cost = CreditCenter.costFor(dur, model);
      if (!model || cost === 0) { el.className = 'cost-hint free'; el.innerHTML = `${icon('gift', 'ico-xs')} 免费`; }
      else if ((CreditCenter.cache.balance || 0) < cost) { el.className = 'cost-hint insufficient'; el.innerHTML = `${icon('coins', 'ico-xs')} 需 ${cost} 分 · 余额不足`; }
      else { el.className = 'cost-hint'; el.innerHTML = `${icon('coins', 'ico-xs')} ${dur}s · ${cost} 积分`; }
    });
  },

  /* ---------- 分镜设计:左参考资产 · 右分镜创作(卡片内「创作左 / 参数右」双栏) ---------- */
  storyboardHTML() {
    const s = this.studio;
    const folded = s.leftCollapsed ? ' folded' : '';
    const running = s.shots.reduce((n, sh) => n + (sh.tasks || []).filter(t => t.status === 'queued' || t.status === 'processing').length, 0);
    return `
    <aside class="ws-left${folded}">
      <div class="ws-ref">
        <div class="ws-ref-head">
          <span class="ws-ref-kicker">REFERENCE</span>
          <span class="ws-ref-title">融合参考资产</span>
          <span class="ws-ref-head-right"><span class="ws-ref-count">${s.refs.length}</span>
          <button class="ws-ref-fold" data-ws-action="toggleleft" title="折叠参考资产">${icon('chevrons-left', 'ico-xs')}</button></span>
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
            : '<button class="ws-ref-empty" data-ref-pick="角色">暂无参考资产<br><span>点击上方分类或此处,从资产库多选引入</span></button>'}
        </div>
      </div>
      <button class="ws-left-open" data-ws-action="toggleleft" title="展开参考资产面板">
        <span class="ws-left-open-ico">${icon('chevrons-right', 'ico-sm')}</span>
        <span class="ws-left-open-count" title="已引入 ${s.refs.length} 项参考资产">${s.refs.length}</span>
        <span class="ws-left-open-label">参考资产</span>
      </button>
    </aside>
    <main class="ws-main">
      <div class="ws-main-bar">
        <span class="mbar-count">分镜 <b class="mbar-num">${String(s.shots.length).padStart(2, '0')}</b></span>
        ${running ? '<span class="mbar-running">' + icon('loader', 'ico-xs') + '生成中 ' + running + '</span>' : ''}
        <span class="mbar-hint">${icon('keyboard', 'ico-xs')} Ctrl+Enter 快速生成</span>
        <button class="ws-mbtn" data-ws-action="reccollapse" title="一键折叠/展开全部生成记录(进行中的任务保持展开)">${s.recsCollapsed ? icon('eye', 'ico-xs') + ' 展开记录' : icon('eye-off', 'ico-xs') + ' 折叠记录'}</button>
        <button class="ws-mbtn" data-ws-action="collapseall" title="全部折叠">${icon('chevrons-up-down', 'ico-xs')} 折叠</button>
        <button class="ws-mbtn" data-ws-action="expandall" title="全部展开">${icon('chevrons-down-up', 'ico-xs')} 展开</button>
        <button class="ws-mbtn gold" data-ws-action="addshot">${icon('plus', 'ico-xs')} 追加分镜</button>
      </div>
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
    /* 用 div 而非 button 作为容器:内部还要放"移除"按钮,避免按钮嵌套
       二十二·2:卡片右下角常驻放大镜角标,点击整卡即放大查看 */
    return `<div class="ws-ref-item${sel ? ' sel' : ''}" data-ref-sel="${r.id}" title="${esc(r.name)} · 点击放大查看,右侧分镜将闪动提示">
      ${thumb}<span class="ws-ref-name">${esc(r.name)}</span>${tag}
      <span class="ws-ref-zoom" title="放大查看">${icon('zoom-in', 'ico-xs')}</span>
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
    toast('已移除参考资产:' + name, 'ok');
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

  /* 分镜卡片:头部(编号 + 行内标题 + 操作) + 双栏主体(左创作 / 右参数) + 生成记录 */
  shotCardHTML(sh) {
    const s = this.studio;
    const idx = s.shots.indexOf(sh);
    const collapsed = !!sh.collapsed;
    const first = idx === 0, last = idx === s.shots.length - 1;
    const modelOpts = s.models.map(m => `<option value="${m.id}" ${sh.modelId === m.id ? 'selected' : ''}>${esc(m.name)} (${esc(m.version)})</option>`).join('');
    const styleOpts = '<option value="">不套用风格</option>' + s.styles.map(st => `<option value="${st.id}" ${sh.styleId === st.id ? 'selected' : ''}>${esc(st.name)}</option>`).join('');
    const toggleIco = collapsed ? 'chevrons-down-up' : 'chevrons-up-down';
    const toggleTitle = collapsed ? '展开该分镜' : '折叠该分镜';
    /* 十七·6:规格四项(画幅比例 / 分辨率 / 帧率 / 时长)统一下拉,2×2 两行两列
       —— 单行四列在 300px 参数栏里每格不足 70px 过于拥挤,放宽为每行两项;
       沿用 change 事件委托(select.value 即参数值),时长 3-15s 整档可选(10s 标注默认) */
    const mkSel = (attr, options) => '<select class="ws-select ws-select-sm" data-shot-' + attr + '="' + sh.key + '">' +
      options.map(o => '<option value="' + o.v + '"' + (String(sh[attr]) === String(o.v) ? ' selected' : '') + '>' + o.t + '</option>').join('') + '</select>';
    const durOpts = Array.from({ length: 13 }, (_, i) => i + 3).map(v => ({ v, t: v === 10 ? '10s · 默认' : v + 's' }));
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
            <div class="ws-pcell"><label title="画幅比例">${icon('frame', 'ico-xs')}画幅比例</label>${mkSel('ratio', [{ v: '16:9', t: '16:9 横屏' }, { v: '9:16', t: '9:16 竖屏' }])}</div>
            <div class="ws-pcell"><label title="分辨率">${icon('scan', 'ico-xs')}分辨率</label>${mkSel('resolution', (s.resolutions || ['480p', '720p', '960p', '2k']).map(v => ({ v, t: v })))}</div>
            <div class="ws-pcell"><label title="帧率">${icon('gauge', 'ico-xs')}帧率</label>${mkSel('fps', COMMON_FPS)}</div>
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
            <textarea class="ws-script" data-shot-script="${sh.key}" placeholder="输入剧本文案,支持 [资产名] 占位符自动链接左侧参考资产(如 [女主]),成功后金色高亮…&#10;Ctrl + Enter 快速提交生成">${esc(sh.script)}</textarea>
          </div>
          <div class="ws-pl-chips" data-shot-pl="${sh.key}"></div>
          <div class="ws-genbar">
            <input class="ws-neg" data-shot-neg="${sh.key}" placeholder="补充要求 / 负向词…" value="${esc(sh.neg)}">
            <span class="cost-hint" data-shot-cost="${sh.key}"></span>
            <button class="ws-gen-btn" data-shot-gen="${sh.key}">${iconText('sparkles', '生成融生视频')}</button>
          </div>
        </section>
      </div>
      <div class="ws-preview" data-shot-preview="${sh.key}">
        ${this.shotPreviewHTML(sh)}
      </div>
      </div>
    </div>`;
  },  /* 折叠态摘要:剧本摘要 + 链接来源数量 + 生成状态
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
    return '剧本:' + (String(sh.script || '').trim().slice(0, 48) || '—') +
      ' · 时长 ' + sh.duration + 's' +
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

  recordHTML(t, shotIdx) {
    const s = this.studio;
    const model = s.models.find(m => m.id === t.model_id);
    const isCompleted = t.status === 'completed' && t.result;
    let media;
    let downloadName = 'video-' + (t.created_at || Date.now()) + '.mp4';
    if (isCompleted) {
      const ts = t.created_at ? new Date(t.created_at).getTime() : Date.now();
      downloadName = (shotIdx != null && shotIdx >= 0 ? '分镜' + (shotIdx + 1) + '-' : '视频-') + ts + '.mp4';
      media = `<video src="/api/assets/${t.result.id}/file" poster="/api/assets/${t.result.id}/thumbnail" controls muted playsinline></video>`;
    } else if (t.status === 'queued' || t.status === 'processing') {
      media = `<div class="ws-rec-progress"><div class="ws-rec-bar"><i style="width:${t.progress}%"></i></div><span>${t.progress}%</span></div>`;
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
      <div class="ws-rec-head">
        <div class="ws-rec-info">
          <div class="ws-rec-title">${esc(t.prompt || '—')}</div>
          <div class="ws-rec-sub">#${esc(t.id.slice(0, 8))}${model ? ' · ' + esc(model.name) : ''}${t.params && t.params.duration != null ? ' · ' + t.params.duration + 's' : ''} · ${fmtTime(t.created_at)}</div>
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

  /* ---------- 剪辑预览 ---------- */
  editPreviewHTML() {
    const s = this.studio;
    const scenes = s.episode.scenes || [];
    if (!scenes.length) {
      return `<div class="ws-edit-preview"><div class="ws-preview-empty" style="height:100%;border-radius:12px">暂无剪辑内容,先在「分镜设计」中生成视频片段</div></div>`;
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
      const ref = e.target.closest('[data-ref-sel]');
      if (ref) {
        const asset = this.studio.refs.find(r => r.id === ref.dataset.refSel) || null;
        this.studio.selRef = asset;
        this.markDirty();
        this.flashShots(); /* 右侧分镜闪动反馈 */
        this.renderStudioBody();
        if (asset) this.openAssetPreview(asset); /* 二十二·2:点击左侧参考资产放大查看 */
        return;
      }
      const rp = e.target.closest('[data-ref-pick]');
      if (rp) { this.pickRefAsset(rp.dataset.refPick); return; }
      const saveSt = e.target.closest('#wsSaveState');
      if (saveSt) { if (this.studio && (this.studio.dirty || saveSt.dataset.state === 'error')) this.saveStudioState(); return; }
      const tab = e.target.closest('[data-ws-tab]');
      if (tab) {
        this.studio.tab = tab.dataset.wsTab;
        ws.querySelectorAll('[data-ws-tab]').forEach(b => b.classList.toggle('active', b.dataset.wsTab === this.studio.tab));
        this.markDirty();
        this.renderStudioBody();
        return;
      }
      const del = e.target.closest('[data-shot-del]');
      if (del) { this.removeShot(del.dataset.shotDel); return; }
      const up = e.target.closest('[data-shot-up]');
      if (up) { this.moveShot(up.dataset.shotUp, -1); return; }
      const dn = e.target.closest('[data-shot-down]');
      if (dn) { this.moveShot(dn.dataset.shotDown, 1); return; }
      if (e.target.closest('.ws-shot-title')) return; /* 标题行内编辑,不触发折叠 */
      const dice = e.target.closest('[data-shot-dice]');
      if (dice) { this.randomizeSeed(dice.dataset.shotDice); return; }
      const stog = e.target.closest('[data-shot-toggle]');
      if (stog) { this.toggleShot(stog.dataset.shotToggle); return; }
      const gen = e.target.closest('[data-shot-gen]');
      if (gen) { const sh = this.getShot(gen.dataset.shotGen); if (sh) this.generateShot(sh); return; }
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
    ws.addEventListener('change', e => {
      const el = e.target;
      const shot = this.getShot(el.dataset.shotModel || el.dataset.shotStyle || el.dataset.shotFps || el.dataset.shotRatio || el.dataset.shotResolution || el.dataset.shotDuration || el.dataset.shotSeed);
      if (!shot) return;
      if (el.dataset.shotModel !== undefined) { shot.modelId = el.value; this.updateShotCostHints(); }
      else if (el.dataset.shotStyle !== undefined) {
        shot.styleId = el.value;
        const st = this.studio.styles.find(x => x.id === el.value);
        if (st && st.model_id) { shot.modelId = st.model_id; this.markDirty(); this.renderStudioBody(); return; }
      }
      else if (el.dataset.shotFps !== undefined) shot.fps = Number(el.value);
      else if (el.dataset.shotRatio !== undefined) shot.ratio = el.value;
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

  /* 骰子:一键随机种子(写入状态并同步输入框,不打断编辑) */
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
      case 'addshot': return this.addShot();
      case 'frame': return this.pickRefAsset('视频帧');
      case 'toggleleft': return this.toggleLeft();
      case 'collapseall': return this.collapseAll(true);
      case 'expandall': return this.collapseAll(false);
      case 'reccollapse': return this.toggleRecsCollapsed();
    }
  },

  /* 录入原文:编辑分集剧本 */
  async episodeScriptDialog() {
    const s = this.studio;
    const vals = await formModal({
      title: `${icon('file-text', 'ico-sm')} 录入原文 · ${esc(s.episode.title)}`,
      fields: [{ key: 'script', label: '分集原文(剧本)', type: 'textarea', value: s.episode.script || '', placeholder: '粘贴本集的剧本原文,用于分镜拆解与视频生成…' }],
      submitText: '保存原文'
    });
    if (vals) {
      await API.patch('/episodes/' + s.episode.id, { script: vals.script });
      s.episode.script = vals.script;
      toast('原文已保存', 'ok');
    }
  },

  /* 批量审片:该分集全部生成任务 */
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
            ${t.status === 'completed' && t.result ? `<a class="ws-rec-act" href="/api/assets/${t.result.id}/file" download>下载</a>` : ''}
            ${t.status === 'failed' ? `<button class="ws-rec-act" data-rv-retry="${t.id}">重试</button>` : ''}
            ${t.status === 'queued' || t.status === 'processing' ? `<button class="ws-rec-act" data-rv-cancel="${t.id}">取消</button>` : ''}
            ${['completed', 'failed', 'cancelled'].includes(t.status) ? `<button class="ws-rec-act danger" data-rv-del="${t.id}" title="删除该条生成记录">删除记录</button>` : ''}
          </div>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-rv-retry]').forEach(b => b.addEventListener('click', async () => {
        await API.post('/tasks/' + b.dataset.rvRetry + '/retry'); toast('已重新排队', 'ok'); render();
      }));
      list.querySelectorAll('[data-rv-cancel]').forEach(b => b.addEventListener('click', async () => {
        await API.post('/tasks/' + b.dataset.rvCancel + '/cancel'); toast('已取消', 'ok'); render();
      }));
      list.querySelectorAll('[data-rv-del]').forEach(b => b.addEventListener('click', async () => {
        if (!await confirmDlg('确认删除这条生成记录?已生成的视频资产仍会保留。')) return;
        try { await API.del('/tasks/' + b.dataset.rvDel); toast('记录已删除', 'ok'); render(); }
        catch (e) { toast(e.message, 'err'); }
      }));
    };
    const refreshBtn = el('<button class="btn">刷新</button>');
    const closeBtn = el('<button class="btn">关闭</button>');
    /* 之前「关闭」按钮没有绑定任何事件,点击无反应 */
    closeBtn.addEventListener('click', () => m.close());
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = icon('loader', 'ico-xs') + ' 刷新中…';
      try { await render(); }
      catch (e) { toast('刷新失败:' + (e.message || e), 'err'); }
      finally { refreshBtn.disabled = false; refreshBtn.textContent = '刷新'; }
    });
    let m;
    m = openModal({ title: `${icon('eye', 'ico-sm')} 批量审片 · ${esc(s.episode.title)}`, size: 'modal-lg', body, footer: [closeBtn, refreshBtn] });
    render().catch(e => toast('加载生成记录失败:' + (e.message || e), 'err'));
  },

  /* 工作日志:该分集全部任务提交记录(提示词 / 状态 / 正常或异常 / 模型 / 积分 / 时间) */
  async workLogDialog() {
    const s = this.studio;
    const body = el('<div></div>');
    /* 筛选:全部 / 正常(排队/生成中/已完成) / 异常(失败/已取消) */
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
          if (p.duration != null) parts.push('时长: ' + p.duration + 's');
          if (p.fps) parts.push('帧率: ' + p.fps + 'fps');
          if (p.motion != null) parts.push('运动: ' + p.motion);
          if (p.seed != null) parts.push('种子: ' + p.seed);
          if (p.aspect_ratio) parts.push('比例: ' + p.aspect_ratio);
          if (p.resolution) parts.push('分辨率: ' + p.resolution);
          if (parts.length) detailRows += '<div class="wl-detail-row"><b>参数:</b> ' + parts.join(' · ') + '</div>';
        }
        if (t.negative_prompt) detailRows += '<div class="wl-detail-row"><b>负向词:</b> ' + esc(t.negative_prompt) + '</div>';
        if (model) detailRows += '<div class="wl-detail-row"><b>模型:</b> ' + esc(model.name) + '</div>';
        if (t.cost) detailRows += '<div class="wl-detail-row"><b>消耗积分:</b> ' + t.cost + '</div>';
        if (t.error) detailRows += '<div class="wl-detail-row"><b>错误信息:</b> <span class="wl-detail-err">' + esc(String(t.error)) + '</span></div>';
        if (t.result) detailRows += '<div class="wl-detail-row"><b>结果资产:</b> <a href="/api/assets/' + t.result.id + '/file" target="_blank">' + esc(t.result.name || '查看') + '</a></div>';
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
        await API.post('/tasks/' + b.dataset.wlRetry + '/retry'); toast('已重新排队', 'ok'); reload();
      }); });
      list.querySelectorAll('[data-wl-cancel]').forEach(function(b) { b.addEventListener('click', async function(e) {
        e.stopPropagation();
        await API.post('/tasks/' + b.dataset.wlCancel + '/cancel'); toast('已取消', 'ok'); reload();
      }); });
      list.querySelectorAll('[data-wl-del]').forEach(function(b) { b.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (!await confirmDlg('确认删除这条生成记录?已生成的视频资产仍会保留。')) return;
        try { await API.del('/tasks/' + b.dataset.wlDel); toast('记录已删除', 'ok'); reload(); }
        catch (e2) { toast(e2.message, 'err'); }
      }); });
    };
    const reload = async function() {
      try {
        var res = await API.get('/tasks?episode_id=' + s.episodeId);
        items = res.items || [];
        render();
      } catch (e) { toast('加载工作日志失败:' + (e.message || e), 'err'); }
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

  /* 补给资产:上传素材入库 */
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
     点击左侧资源类型时弹出:与资产库页面同款交互(文件夹树 / 分类 chips / 名称搜索 / 类型筛选)
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
      </div>`;
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
        renderCats(); renderGrid();
      }));
    };

    const updateCount = list => {
      countBox.innerHTML = '共 ' + all.length + ' 项素材' + (multi ? ' · 已选 <b style="color:var(--accent)">' + sel.size + '</b> 项' : '');
      if (okBtn) { okBtn.disabled = sel.size === 0; okBtn.innerHTML = iconText('check', '导入选中 (' + sel.size + ')'); }
    };

    const renderGrid = () => {
      const list = all.filter(a => matchesType(a) && matchesCat(a) && matchesFolder(a) && matchesQ(a));
      updateCount(list);
      if (!list.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
      empty.classList.add('hidden');
      grid.innerHTML = list.map(a => this.alibCardHTML(a, sel, multi)).join('');
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

    searchInp.addEventListener('input', () => { q = searchInp.value.trim().toLowerCase(); renderGrid(); });
    typeSel.addEventListener('change', () => { curType = typeSel.value; renderCats(); renderGrid(); });

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

  /* 资产卡片(资产库窗口内,与资产库页面同款) */
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

  /* 点击左侧资源类型(+角色/+场景/…) → 弹出资产库窗口,多选导入 */
  pickRefAsset(kind) {
    const s = this.studio;
    const CATS = ['角色', '场景', '物品', '分镜', '音频', '视频'];
    const typeMap = { '音频': 'audio', '视频': 'video', '视频帧': 'video' };
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
    /* 新分镜出现后滚动到位,方便直接编辑 */
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
      '确认删除「' + (sh.title || '未命名分镜') + '」?该分镜的剧本文案与参数将一并移除,已生成的视频资产不受影响。',
      { title: '删除分镜', okText: '删除' }
    );
    if (!ok) return;
    s.shots = s.shots.filter(x => x.key !== key);
    this.markDirty();
    this.renderStudioBody();
  },

  /* 分镜排序:上移 / 下移 */
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

  /* 生成记录一键全部折叠/展开(分镜分区级,状态持久化) */
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

  async generateShot(shot) {
    const s = this.studio;
    const model = s.models.find(m => m.id === shot.modelId) || s.selModel;
    if (!model) return toast('请先选择视频模型', 'err');
    if (!String(shot.script || '').trim()) return toast('请先输入剧本文案', 'err');
    /* 优先使用 [占位符] 成功链接的资产作为源图(二十二·1 起,链接结果必属于参考资产) */
    const ta = this.root.querySelector(`[data-shot-script="${shot.key}"]`);
    const plLinked = ta && ta._pl ? ta._pl.getLinked() : [];
    let ref = null;
    const imgLinked = plLinked.find(a => a.type === 'image');
    if (imgLinked) ref = imgLinked;
    if (!ref) ref = s.selRef && s.selRef.type === 'image' ? s.selRef : s.refs.find(r => r.type === 'image');
    if (!ref) return toast('请先在左侧引入参考图或在文案中输入 [资产名] 占位链接', 'err');
    /* 第二十三轮:与后端一致的时长收敛 + 积分校验(显示即实扣) */
    const effDur = this.effDuration(model, shot.duration);
    const cost = CreditCenter.costFor(effDur, model);
    if (cost > 0 && (CreditCenter.cache.balance || 0) < cost) {
      return toast(`积分不足:本次需 ${cost},余额 ${CreditCenter.cache.balance}。可到积分中心申请或选择免费模型`, 'err');
    }
    const btn = this.root.querySelector(`[data-shot-gen="${shot.key}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner spinner-sm"></span>已提交,排队中…'; }
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
        param_aspect_ratio: shot.ratio || '16:9',
        param_resolution: s.resolutions.includes(shot.resolution) ? shot.resolution : s.defaultResolution
      });
      if (cr) { CreditCenter.cache.balance = cr.balance; App.user.credits = cr.balance; CreditCenter.refresh(); }
      shot.taskIds.push(task.id);
      shot.tasks.unshift(task);
      shot.recsCollapsed = false; /* 新任务入列,自动展开该分区显示进度 */
      toast(`任务已提交: #${task.id.slice(0, 8)}${cr && cr.cost ? `(消耗 ${cr.cost} 积分)` : '(免费)'}`, 'ok');
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

  /* 删除某条生成记录(仅终态:已完成/失败/已取消) */
  async deleteTaskRecord(id) {
    if (!await confirmDlg('确认删除这条生成记录?已生成的视频资产仍会保留在资产库中。')) return;
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
  },

  async refreshStudioTasks() {
    const s = this.studio;
    if (!s) return;
    const res = await API.get('/tasks?episode_id=' + s.episodeId);
    const items = res.items;
    const sig = items.map(t => t.id + ':' + t.status + ':' + t.progress).join('|');
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
    this.renderStudioBody();
  },

  renderWorkbench() {
    const p = this.state.project;
    const h = this.root;
    const u = (App && App.user) || {};
    const eps = p.episodes;
    h.innerHTML = `
    <div class="wb">
      <nav class="wb-nav">
        <div class="wb-nav-left">
          <div class="wb-brand"><span class="wb-brand-logo"><i data-lucide="clapperboard"></i></span>视界引擎</div>
          <div class="wb-crumb">
            <a href="#/projects">项目分集</a><span class="sep">/</span>
            <b title="${esc(p.name)}">${esc(p.name)} · 分集列表</b>
          </div>
        </div>
        <div class="wb-nav-right">
          <button class="wb-btn-yellow" id="wbNewProject">${iconText('plus', '新建项目')}</button>
          <div class="wb-account">
            <button class="wb-account-btn" id="wbAccountBtn">
              <span class="wb-avatar">${avatar(u.name)}</span>
              <span>${esc(u.name || '账号')}</span><span class="wb-acc-caret"><i data-lucide="chevron-down"></i></span>
            </button>
            <div class="wb-account-pop hidden" id="wbAccountPop">
              <div class="wb-acc-head">
                <div class="wb-acc-name">${esc(u.name || '—')}</div>
                <div class="wb-acc-role">${u.role === 'admin' ? '管理员' : '普通用户'}</div>
                <div class="wb-acc-storage">
                  <div class="storage-label"><span>存储空间</span><span>${fmtBytes(u.storage_used || 0)} / ${fmtBytes(u.storage_quota || 1)}</span></div>
                  <div class="storage-bar"><div class="storage-fill" style="width:${Math.min(100, (u.storage_used || 0) / (u.storage_quota || 1) * 100)}%"></div></div>
                </div>
              </div>
              <a class="wb-acc-item" href="#/">${icon('home', 'ico-sm')} 返回仪表盘</a>
              <a class="wb-acc-item" href="#/assets">${icon('folder-open', 'ico-sm')} 资产库</a>
              <button class="wb-acc-item danger" id="wbLogout">${icon('log-out', 'ico-sm')} 退出登录</button>
            </div>
          </div>
        </div>
      </nav>

      <div class="wb-toolbar">
        <button class="wb-tbtn active" id="wbSettingsBtn">${iconText('settings', '项目设置')}</button>
        <button class="wb-tbtn" id="wbBatchBtn">${iconText('list-checks', '批量管理')}</button>
        <div class="wb-search">${icon('search', 'search-ico')}<input id="wbSearch" placeholder="搜索分集…"></div>
        <div class="wb-total">总集数 <span class="wb-total-chip"><b>${String(eps.length).padStart(2, '0')}</b> 集</span></div>
      </div>

      <div class="wb-canvas"><div class="wb-grid" id="wbGrid"></div></div>

      <div class="wb-ai">
        <div class="wb-ai-inner">
          <span class="wb-ai-tag">AI</span>
          <input class="wb-ai-input" id="wbAiInput" placeholder="输入剧情方向,AI 为你生成新分集…" maxlength="80">
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
      </a>
      <button class="wb-card wb-new" id="wbAddEpCard">
        <span class="wb-plus">${icon('plus')}</span>
        <span class="wb-new-txt">新建分集</span>
      </button>`;

    if (!eps.length) {
      html += '<div class="wb-empty">还没有分集,点击「新建分集」或使用底部 AI 输入框开始创作</div>';
    } else {
      html += eps.map(ep => this.episodeCardHTML(ep, query)).join('');
    }
    grid.innerHTML = html;

    grid.querySelector('#wbAddEpCard').addEventListener('click', () => this.addEpisodeDialog());
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

    h.querySelector('#wbAccountBtn').addEventListener('click', e => {
      e.stopPropagation();
      h.querySelector('#wbAccountPop').classList.toggle('hidden');
    });
    const closeAccount = e => {
      const pop = h.querySelector('#wbAccountPop');
      if (!pop) { document.removeEventListener('click', closeAccount); return; }
      if (!pop.classList.contains('hidden') && !e.target.closest('.wb-account')) pop.classList.add('hidden');
    };
    document.addEventListener('click', closeAccount);
    h.querySelector('#wbLogout').addEventListener('click', async () => {
      await API.post('/auth/logout');
      location.hash = '#/login';
      App.boot();
    });

    h.querySelector('#wbNewProject').addEventListener('click', () => this.newProjectDialog());
    h.querySelector('#wbSettingsBtn').addEventListener('click', () => this.settingsDialog());
    h.querySelector('#wbBatchBtn').addEventListener('click', () => this.toggleBatch());

    const search = h.querySelector('#wbSearch');
    search.addEventListener('input', () => { this._query = search.value; this.renderGrid(); });

    h.querySelector('#wbAiSend').addEventListener('click', () => this.aiCreateEpisode());
    h.querySelector('#wbAiInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.aiCreateEpisode(); });

    h.querySelector('#wbBatchDel').addEventListener('click', () => this.deleteSelected());
    h.querySelector('#wbBatchCancel').addEventListener('click', () => this.toggleBatch(false));
  },

  /* 项目设置(高亮选中的工具按钮) */
  settingsDialog() {
    const p = this.state.project;
    const isOwner = p.my_role === 'owner' || (App.user.role === 'admin');
    const body = el('<div></div>');
    body.appendChild(el(`<div class="field"><label>项目名称</label><input class="input" id="setName" value="${esc(p.name)}" ${isOwner ? '' : 'disabled'}></div>`));
    body.appendChild(el(`<div class="field"><label>项目描述</label><textarea class="textarea" id="setDesc" placeholder="选填" ${isOwner ? '' : 'disabled'}>${esc(p.description || '')}</textarea></div>`));
    body.appendChild(el(`<div class="field"><label>项目唯一编号(ID)</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="input" value="${esc(p.id)}" readonly style="font-family:var(--mono);font-size:11.5px;color:var(--text-dim)">
      </div></div>`));
    if (isOwner) {
      body.appendChild(el(`<div class="field"><label>分享邀请码(把此码发给成员,对方即可加入项目)</label>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="proj-code-badge" style="font-size:15px;padding:6px 14px">${icon('hash')}${esc(p.code || '—')}</span>
          <button class="btn btn-sm" id="copyCodeBtn">${iconText('copy', '复制')}</button>
          <button class="btn btn-sm" id="rotateCodeBtn">${iconText('refresh-cw', '重置邀请码')}</button>
        </div>
        <div class="hint">重置后旧邀请码立即失效</div></div>`));
      const memberBox = el('<div class="field"><label>项目成员</label><div id="memberList" style="font-size:12.5px;color:var(--text-dim)">加载中…</div></div>');
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
    cancelBtn.addEventListener('click', () => m && m.close()); // 修复:取消按钮原先未绑定事件
    m = openModal({ title: `${icon('settings', 'ico-sm')} 项目设置`, size: 'modal-md', body, footer: foot });
    if (!isOwner) saveBtn.classList.add('hidden');
    if (isOwner) {
      body.querySelector('#copyCodeBtn').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(p.code || ''); toast('邀请码已复制', 'ok'); }
        catch (e) { toast('邀请码:' + p.code, 'ok'); }
      });
      body.querySelector('#rotateCodeBtn').addEventListener('click', async () => {
        try {
          const { project } = await API.patch('/projects/' + p.id, { rotate_code: true });
          this.state.project.code = project.code;
          toast('邀请码已重置:' + project.code, 'ok');
          m.close(); this.settingsDialog();
        } catch (e) { toast(e.message, 'err'); }
      });
      API.get('/projects/' + p.id + '/members').then(res => {
        const box = body.querySelector('#memberList');
        if (!box) return;
        box.innerHTML = res.items.length
          ? res.items.map(u => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span class="avatar" style="width:22px;height:22px;font-size:10px">${avatar(u.name)}</span>${esc(u.name)} <span style="color:var(--text-faint);font-size:11px">${esc(u.email)}</span></div>`).join('')
          : '<span style="color:var(--text-faint)">暂无成员,分享上方邀请码即可邀请协作</span>';
      }).catch(() => {});
    } else {
      body.querySelector('#leaveProjectBtn')?.addEventListener('click', async () => {
        if (!await confirmDlg('确认退出该项目?退出后将无法访问')) return;
        try {
          await API.post('/projects/' + p.id + '/leave');
          toast('已退出项目', 'ok'); m.close();
          if (window.App && App.refreshProjects) App.refreshProjects();
          location.hash = '#/projects';
        } catch (e) { toast(e.message, 'err'); }
      });
    }
    saveBtn.addEventListener('click', async () => {
      await API.patch('/projects/' + p.id, {
        name: body.querySelector('#setName').value,
        description: body.querySelector('#setDesc').value
      });
      toast('设置已保存', 'ok');
      m.close();
      if (window.App && App.refreshProjects) App.refreshProjects();
      this.renderDetail(p.id);
    });
    exportBtn.addEventListener('click', () => { m.close(); this.exportDialog(true); });
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (await confirmDlg('确认删除整个项目?分集与场景结构将一并删除(资产文件保留)。')) {
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
    const btn = this.root.querySelector('#wbBatchBtn');
    btn.classList.toggle('on', this.batchMode);
    btn.innerHTML = iconText('list-checks', this.batchMode ? '批量管理(进行中)' : '批量管理');
    this.root.querySelector('#wbBatchBar').classList.toggle('hidden', !this.batchMode);
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
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 个分集?场景将一并删除。`)) return;
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
      fields: [{ key: 'title', label: '分集标题', placeholder: '如: 第 05 集 · 转折', value: '第 ' + (p.episodes.length + 1) + ' 集' }],
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
    if (await confirmDlg('确认删除该分集?')) {
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

  /* AI 分集创作(本地模拟:剧情方向 → 新分集) */
  async aiCreateEpisode() {
    const input = this.root.querySelector('#wbAiInput');
    const text = (input.value || '').trim();
    if (!text) return toast('请输入剧情方向', 'err');
    const btn = this.root.querySelector('#wbAiSend');
    btn.disabled = true;
    try {
      await API.post('/projects/' + this.state.project.id + '/episodes', { title: text.slice(0, 80) });
      toast('AI 已生成新分集:「' + text.slice(0, 24) + (text.length > 24 ? '…' : '') + '」', 'ok');
      input.value = '';
      this.renderDetail(this.state.project.id);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  },

  /* ---------- 分集详情(场景/片段编排) ---------- */
  openEpisodeDetail(epId) {
    const ep = this.state.project.episodes.find(e => e.id === epId);
    if (!ep) return;
    const body = el('<div></div>');
    const num = String(ep.order_index + 1).padStart(2, '0');
    let m = null;

    const reload = async () => {
      const { project } = await API.get('/projects/' + this.state.project.id);
      this.state.project = project;
      const fresh = project.episodes.find(e => e.id === epId);
      if (!fresh) { m.close(); return; }
      renderBody(fresh);
    };

    const renderBody = freshEp => {
      body.innerHTML = `
        <div class="episode-scenes">
          ${freshEp.scenes.map(sc => this.sceneHTML(freshEp, sc)).join('') ||
            '<div style="color:var(--text-faint);font-size:12.5px;padding:16px 2px;text-align:center">暂无场景,点击「+ 场景」开始编排</div>'}
        </div>`;
      body.querySelectorAll('[data-add-scene]').forEach(b => b.addEventListener('click', async () => {
        const vals = await formModal({ title: '添加场景', fields: [{ key: 'title', label: '场景标题', placeholder: '如: 夜战天台', value: '场景 ' + (freshEp.scenes.length + 1) }], submitText: '添加' });
        if (vals) { await API.post('/episodes/' + epId + '/scenes', vals); await reload(); }
      }));
      body.querySelectorAll('[data-del-scene]').forEach(b => b.addEventListener('click', async () => {
        if (await confirmDlg('确认删除该场景?')) { await API.del('/scenes/' + b.dataset.delScene); await reload(); }
      }));
      body.querySelectorAll('[data-copy-ep]').forEach(b => b.addEventListener('click', () => this.copySceneDialog(b.dataset.copyEp, reload)));
      body.querySelectorAll('[data-add-clip]').forEach(b => b.addEventListener('click', () => this.addClipDialog(b.dataset.addClip, reload)));
      body.querySelectorAll('[data-del-clip]').forEach(b => b.addEventListener('click', async () => {
        await API.del('/clips/' + b.dataset.delClip);
        await reload();
      }));
    };

    renderBody(ep);

    const scriptBtn = el(`<button class="btn btn-sm ${(ep.script && String(ep.script).trim()) ? 'btn-primary' : ''}">${iconText('pen-line', '剧本录入')}</button>`);
    const exportBtn = el(`<button class="btn btn-sm">${iconText('download', '导出该集')}</button>`);
    const delBtn = el(`<button class="btn btn-sm btn-danger">${iconText('trash-2', '删除分集')}</button>`);
    const closeEpBtn = el('<button class="btn btn-sm">关闭</button>');
    m = openModal({
      title: `第 ${num} 集 · ${esc(this.epMainTitle(ep))}`,
      size: 'modal-lg',
      body,
      footer: [delBtn, exportBtn, scriptBtn, closeEpBtn],
      onClose: () => { if (this.state.project) this.renderDetail(this.state.project.id); }
    });
    closeEpBtn.addEventListener('click', () => m.close()); // 修复:关闭按钮原先未绑定事件
    scriptBtn.addEventListener('click', () => { m.close(); this.scriptDialog(epId); });
    exportBtn.addEventListener('click', () => { m.close(); this.exportDialog(false, epId); });
    delBtn.addEventListener('click', async () => {
      if (await confirmDlg('确认删除该分集?')) {
        await API.del('/episodes/' + epId);
        m.close();
      }
    });
  },

  sceneHTML(ep, sc) {
    return `<div class="scene-box">
      <div class="scene-head">
        <span style="font-weight:600;font-size:13px">${icon('layers', 'ico-sm')} ${esc(sc.title)}</span>
        <span style="font-size:11px;color:var(--text-faint)">${sc.clips.length} 片段</span>
        <div style="flex:1"></div>
        <button class="btn btn-xs" data-add-clip="${sc.id}">${iconText('plus', '添加片段')}</button>
        <button class="btn btn-xs" data-del-scene="${sc.id}" title="删除场景">${icon('trash-2')}</button>
      </div>
      <div class="clip-strip">
        ${sc.clips.map(c => this.clipHTML(c)).join('') || '<div style="color:var(--text-faint);font-size:11.5px;padding:4px 2px">暂无片段,从资产库或生成结果添加</div>'}
      </div>
    </div>`;
  },

  clipHTML(c) {
    const src = c.asset_path ? `/api/assets/${c.asset_id}/file` : '';
    const thumb = c.asset_type === 'video' && c.thumb_path ? `/api/assets/${c.asset_id}/thumbnail` : src;
    return `<div class="clip-item">
      ${thumb ? `<img src="${thumb}" loading="lazy">` : '<div style="height:82px;background:var(--bg-soft)"></div>'}
      <div class="clip-meta">${esc(c.title || c.asset_name || '片段')}<br>${c.duration ? fmtDuration(c.duration) : '—'}</div>
      <button class="clip-del" data-del-clip="${c.id}">${icon('x', 'ico-xs')}</button>
    </div>`;
  },

  /* 复制场景到其他分集 */
  copySceneDialog(sourceSceneId, after) {
    const sc = this.state.project.episodes.flatMap(e => e.scenes).find(s => s.id === sourceSceneId);
    if (!sc) return;
    const body = el('<div><div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">将场景 <b style="color:var(--text)">' + esc(sc.title) + '</b> 复制到:</div></div>');
    const sel = el('<select class="select"></select>');
    sel.innerHTML = this.state.project.episodes
      .filter(e => !e.scenes.some(s => s.id === sourceSceneId))
      .map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('') || '<option value="">(无其他分集)</option>';
    body.appendChild(sel);
    const okBtn = el('<button class="btn btn-primary">复制</button>');
    const cancelBtn = el('<button class="btn">取消</button>');
    let m;
    cancelBtn.addEventListener('click', () => m && m.close()); // 修复:取消按钮原先未绑定事件
    m = openModal({ title: '复制场景', size: 'modal-sm', body, footer: [cancelBtn, okBtn] });
    okBtn.addEventListener('click', async () => {
      if (!sel.value) return toast('没有可复制到的分集', 'err');
      await API.post('/scenes/' + sourceSceneId + '/copy', { episode_id: sel.value });
      toast('场景已复制', 'ok');
      m.close();
      if (typeof after === 'function') after();
      else this.renderDetail(this.state.project.id);
    });
  },

  /* 添加片段:从资产/生成结果中选择 */
  async addClipDialog(sceneId, after) {
    const body = el('<div></div>');
    body.appendChild(el('<div style="font-size:12px;color:var(--text-dim);margin-bottom:10px">选择要加入片段的资产(图片/视频):</div>'));
    const grid = el('<div style="max-height:44vh;overflow-y:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>');
    const usable = this.state.assets.filter(a => a.type === 'image' || a.type === 'video');
    if (!usable.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;color:var(--text-faint);text-align:center;padding:20px">资产库为空,请先上传素材或生成视频</div>';
    } else {
      grid.innerHTML = usable.map(a => `
        <div class="sel-item asset-pick" data-id="${a.id}" style="text-align:center;padding:8px">
          ${a.type === 'image' ? `<img src="/api/assets/${a.id}/file" style="width:100%;height:60px;object-fit:cover;border-radius:6px">` : `<img src="/api/assets/${a.id}/thumbnail" style="width:100%;height:60px;object-fit:cover;border-radius:6px">`}
          <div style="font-size:10.5px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</div>
        </div>`).join('');
    }
    body.appendChild(grid);
    const m = openModal({ title: '添加片段', body, size: '' });
    grid.querySelectorAll('.asset-pick').forEach(item => item.addEventListener('click', async () => {
      const a = this.state.assets.find(x => x.id === item.dataset.id);
      await API.post('/scenes/' + sceneId + '/clips', { asset_id: a.id, title: a.name, duration: a.duration || undefined });
      toast('片段已添加', 'ok');
      m.close();
      if (typeof after === 'function') after();
      else this.renderDetail(this.state.project.id);
    }));
  },

  /* 导出 */
  exportDialog(all, presetEpId) {
    const eps = this.state.project.episodes;
    const body = el('<div></div>');
    body.appendChild(el(`<div style="font-size:13px;color:var(--text-dim);margin-bottom:12px">${all ? '导出整季' : '导出单个分集'},所有片段将按场景顺序拼接为 MP4(最高 4K)。</div>`));
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
    const status = el('<div style="font-size:12px;color:var(--text-dim);margin-top:10px"></div>');
    body.appendChild(status);
    const exportCancelBtn = el('<button class="btn">取消</button>');
    let m;
    exportCancelBtn.addEventListener('click', () => { if (m && !okBtn.disabled) m.close(); }); // 修复:取消按钮原先未绑定事件
    m = openModal({ title: all ? '导出整季' : '导出分集', size: 'modal-sm', body, footer: [exportCancelBtn, okBtn] });
    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true;
      status.textContent = '正在拼接导出,请稍候…';
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
