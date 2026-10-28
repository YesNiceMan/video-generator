'use strict';
/* 应用入口：引导、路由、统一外壳(顶栏 + 上下文区) */
const App = {
  user: null,
  projects: [],
  currentRoute: '',
  viewCleanup: null,

  currentScheme() { return document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark'; },

  applyScheme(scheme, persist) {
    document.documentElement.dataset.scheme = scheme;
    if (persist) { try { localStorage.setItem('vf-scheme', scheme); } catch (e) { /* 忽略 */ } }
    const btn = document.getElementById('schemeBtn');
    if (btn) {
      /* 显示"将要切到"的那一侧图标，避免两套图标同时出现 */
      btn.innerHTML = scheme === 'light' ? icon('moon') : icon('sun');
      btn.title = scheme === 'light' ? '切换到深色模式' : '切换到浅色模式';
    }
  },

  toggleScheme() {
    const next = this.currentScheme() === 'light' ? 'dark' : 'light';
    this.applyScheme(next, true);
    toast(next === 'light' ? '已切换到浅色模式' : '已切换到深色模式', 'ok', 1600);
  },

  async boot() {
    try {
      const { user } = await API.get('/auth/me');
      if (!user) return this.showAuth();
      this.user = user;
      if (location.hash === '#/login' || location.hash === '#/register') {
        history.replaceState(null, '', location.pathname + location.search);
      }
      document.getElementById('authRoot').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      this.renderShell();
      this.route();
      this.startPolling();
    } catch (e) {
      this.showAuth();
    }
  },

  showAuth() {
    this.user = null;
    clearInterval(this._pollTimer);
    document.body.classList.remove('immersive', 'wb-batch', 'page-fill');
    document.getElementById('app').classList.add('hidden');
    const root = document.getElementById('authRoot');
    root.classList.remove('hidden');
    AuthView.render(root);
  },

  renderShell() {
    const u = this.user;
    document.getElementById('topUserName').textContent = u.name;
    document.getElementById('topAvatar').textContent = avatar(u.name);
    document.getElementById('tuName').textContent = u.name;
    document.getElementById('tuRole').textContent = u.role === 'admin' ? '管理员' : '普通用户';
    document.getElementById('tuCredits').textContent = u.credits || 0;
    document.querySelector('.nav-admin').classList.toggle('hidden', u.role !== 'admin');
    this.renderUserStorage();
    this.refreshProjects();
    CreditCenter.refresh();
    this.applyScheme(this.currentScheme(), false);
    this.bindShellEvents();
  },

  renderUserStorage() {
    const u = this.user;
    const used = u.storage_used || 0, quota = u.storage_quota || 1;
    document.getElementById('tuStorage').textContent = `${fmtBytes(used)} / ${fmtBytes(quota)}`;
    document.getElementById('tuStorageFill').style.width = Math.min(100, used / quota * 100) + '%';
    const txt = document.getElementById('tuStorageText');
    if (txt) txt.textContent = `存储 ${fmtBytes(used)} / ${fmtBytes(quota)}`;
  },

  /* 顶栏交互只绑定一次：重复登录会再次 renderShell,叠加监听会让弹层被 toggle 两次而打不开 */
  bindShellEvents() {
    if (this._shellBound) return;
    this._shellBound = true;

    document.getElementById('topLogoutBtn').addEventListener('click', async () => {
      await API.post('/auth/logout');
      location.hash = '#/login';
      this.boot();
    });
    document.getElementById('creditChip').addEventListener('click', () => CreditCenter.open());
    document.getElementById('creditCenterBtn').addEventListener('click', () => { this.closePops(); CreditCenter.open(); });
    document.getElementById('myProjectsBtn').addEventListener('click', () => { this.closePops(); location.hash = '#/projects'; });
    document.getElementById('notifBtn').addEventListener('click', e => { e.stopPropagation(); this.toggleNotifs(); });
    document.getElementById('schemeBtn').addEventListener('click', () => this.toggleScheme());
    document.getElementById('topUserBtn').addEventListener('click', e => {
      e.stopPropagation();
      const pop = document.getElementById('topUserPop');
      this.closePops(pop);
      pop.classList.toggle('hidden');
    });
    const moreBtn = document.getElementById('navMoreBtn');
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      const pop = document.getElementById('navMorePop');
      this.closePops(pop);
      pop.classList.toggle('hidden');
      if (!pop.classList.contains('hidden')) this.renderNavMore();
    });

    /* 点在弹层自身(标题栏 / 内边距 / 滚动区)不算「点了外部」，
       否则通知面板会被自己的头部点掉，用户正要点进去看第二条 */
    document.addEventListener('click', e => {
      if (e.target.closest && e.target.closest('#topUserPop, #notifPanel, #navMorePop')) return;
      this.closePops();
    });
    window.addEventListener('hashchange', () => this.closePops());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closePops(); });
  },

  /* 同一时刻只允许一个弹层展开 */
  closePops(except) {
    ['topUserPop', 'notifPanel', 'navMorePop'].forEach(id => {
      const n = document.getElementById(id);
      if (n && n !== except) n.classList.add('hidden');
    });
  },

  /* 窄屏「导航」下拉：与主导航共用同一批入口(读 data- 属性，不依赖已被 lucide 替换掉的 <i>) */
  renderNavMore() {
    const pop = document.getElementById('navMorePop');
    const path = this.currentRoute || '/';
    const links = [...document.querySelectorAll('.top-nav .top-link')].filter(a => !a.classList.contains('hidden'));
    pop.innerHTML = links.map(a => {
      const r = a.dataset.route;
      const active = r === path || (r === '/projects' && path.startsWith('/projects'));
      return `<a class="menu-item${active ? ' active' : ''}" href="${a.getAttribute('href')}">${icon(a.dataset.ico)}<span>${esc(a.dataset.label)}</span></a>`;
    }).join('');
    pop.querySelectorAll('.menu-item').forEach(n => n.addEventListener('click', () => pop.classList.add('hidden')));
  },

  /* ---------- 上下文区：项目 / 分集层级接管顶栏左侧 ----------
     cfg: { back:{href,label}, eyebrow, title, tabs:[{key,label,icon}], tools:Node|null } */
  setContext(cfg) {
    const bar = document.getElementById('ctxBar');
    bar.classList.remove('hidden');
    document.querySelector('.top-nav').classList.add('hidden');
    document.getElementById('navMore').style.visibility = 'hidden';
    if (cfg.back) {
      const b = document.getElementById('ctxBack');
      b.href = cfg.back.href; b.classList.remove('hidden');
      document.getElementById('ctxBackLabel').textContent = cfg.back.label || '返回';
    } else {
      document.getElementById('ctxBack').classList.add('hidden');
    }
    document.getElementById('ctxEyebrow').textContent = cfg.eyebrow || '';
    const title = document.getElementById('ctxTitle');
    title.textContent = cfg.title || '';
    title.title = cfg.title || '';

    const tabs = document.getElementById('ctxTabs');
    tabs.innerHTML = '';
    if (cfg.tabs && cfg.tabs.length) {
      tabs.classList.remove('hidden');
      cfg.tabs.forEach((t, i) => {
        const b = el(`<button class="ctx-tab${t.active ? ' active' : ''}">${icon(t.icon, 'ico-sm')}<span>${esc(t.label)}</span></button>`);
        b.addEventListener('click', () => {
          tabs.querySelectorAll('.ctx-tab').forEach((x, j) => x.classList.toggle('active', j === i));
          t.onClick && t.onClick(t.key);
        });
        tabs.appendChild(b);
      });
    } else tabs.classList.add('hidden');
    this._ctx = cfg;
  },

  clearContext() {
    document.getElementById('ctxBar').classList.add('hidden');
    document.querySelector('.top-nav').classList.remove('hidden');
    document.getElementById('navMore').style.visibility = '';
    this._ctx = null;
  },

  /* 沉浸页(工作台)由内容自身滚动 */
  setImmersive(on) {
    document.body.classList.toggle('immersive', !!on);
    if (!on) document.body.classList.remove('wb-batch');
  },

  /* ---------- 通知 ---------- */
  async pollNotifs() {
    try {
      const { unread } = await API.get('/auth/notifications');
      const badge = document.getElementById('notifBadge');
      badge.textContent = unread;
      badge.classList.toggle('hidden', !unread);
    } catch (e) { /* 忽略 */ }
  },

  async toggleNotifs() {
    const panel = document.getElementById('notifPanel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    this.closePops(panel);
    const { items } = await API.get('/auth/notifications');
    panel.innerHTML = items.length
      ? `<div class="pop-label">通知 · ${items.length} 条</div>` + items.map(n => `
        <div class="notif-item${n.read ? '' : ' unread'}" data-pid="${n.task_project_id || ''}" data-eid="${n.task_episode_id || ''}" data-task="${n.task_id || ''}"
             title="${n.task_episode_id ? '点击进入该集分镜工作台' : '点击查看项目分集'}">
          <div class="n-title">${n.read ? '' : '<span class="n-dot"></span>'}${esc(n.title)}</div>
          <div class="n-body">${esc(n.body)}</div>
          <div class="n-time">${fmtAgo(n.created_at)}</div>
        </div>`).join('')
      : '<div class="notif-empty">暂无通知</div>';
    panel.classList.remove('hidden');
    await API.post('/auth/notifications/read');
    this.pollNotifs();
    panel.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        panel.classList.add('hidden');
        const { pid, eid } = item.dataset;
        if (pid && eid) location.hash = `#/projects/${pid}/episode/${eid}`;
        else if (pid) location.hash = '#/projects/' + pid;
        else if (item.dataset.task) location.hash = '#/projects';
      });
    });
  },

  startPolling() {
    clearInterval(this._pollTimer);
    this.pollNotifs();
    this._pollTimer = setInterval(() => {
      this.pollNotifs();
      CreditCenter.refresh(); // 余额随任务消耗实时刷新
    }, 15000);
  },

  async refreshProjects() {
    try {
      const res = await API.get('/projects');
      this.projects = res.items || [];
    } catch (e) { /* 静默 */ }
  },

  /* ---------- 路由 ---------- */
  route() {
    if (!this.user) { this.showAuth(); return; }
    this.clearContext();
    this.setImmersive(false);
    /* 右击菜单挂在 body 上,只靠「下一次点击」自毁;换路由往往没有点击(前进/后退、⌘K 跳转),
       不主动收掉就会飘到下一个页面盖上内容。 */
    document.querySelectorAll('.ctx-menu').forEach(x => x.remove());
    let hash = location.hash || '#/';
    let path = hash.replace(/^#/, '') || '/';
    let segs = path.split('/').filter(Boolean);
    let view, params = {};

    if (segs[0] === 'login' || segs[0] === 'register') {
      history.replaceState(null, '', location.pathname + location.search);
      hash = '#/'; path = '/'; segs = [];
    }
    /* 创作工坊已取消：旧链接回到项目分集 */
    if (segs[0] === 'create') { location.replace('#/projects'); return; }

    if (segs[0] === 'projects' && segs[1] && segs[2] === 'episode' && segs[3]) { view = ProjectsView; params = { id: segs[1], episodeId: segs[3] }; }
    else if (segs[0] === 'projects' && segs[1]) { view = ProjectsView; params = { id: segs[1] }; }
    else if (segs[0] === 'projects') { view = ProjectsView; }
    else if (segs[0] === 'assets') { view = AssetsView; }
    else if (segs[0] === 'workflow' && segs[1]) { view = DramaView; params = { id: segs[1], stage: segs[2] || 'script' }; }
    else if (segs[0] === 'workflow') { view = DramaView; }
    else if (segs[0] === 'styles') { view = StylesView; }
    else if (segs[0] === 'images') { view = ImagesView; }
    else if (segs[0] === 'admin') { view = AdminView; params = { tab: segs[1] || '' }; }
    else { view = DashboardView; }

    document.querySelectorAll('.top-link').forEach(n => {
      const r = n.dataset.route;
      /* 子路径(#/admin/tasks、#/projects/xx)也要让顶部导航保持高亮 */
      n.classList.toggle('active', path === r || (r === '/projects' && segs[0] === 'projects')
        || (r === '/workflow' && segs[0] === 'workflow')
        || (r === '/admin' && segs[0] === 'admin'));
    });
    /* 主导航收起时把当前页面名放进「导航」按钮，避免用户失去位置感 */
    const cur = document.querySelector('.top-link.active');
    const moreLabel = document.querySelector('#navMoreBtn span');
    if (moreLabel) moreLabel.textContent = cur ? cur.dataset.label : '导航';
    document.getElementById('navMoreBtn').classList.toggle('has-active', !!cur && cur.dataset.route !== '/');

    const root = document.getElementById('view');
    /* 27·2:资产库 / AI 生图 用填充式布局 —— 页头与筛选行固定不动,内容栏各自滚动 */
    document.body.classList.toggle('page-fill', path === '/assets' || path === '/images');
    root.innerHTML = '';
    if (this.viewCleanup) { try { this.viewCleanup(); } catch (e) { /* 忽略 */ } this.viewCleanup = null; }
    this.currentRoute = path;

    const cleanup = view.render(root, params);
    if (typeof cleanup === 'function') this.viewCleanup = cleanup;
  }
};

window.addEventListener('hashchange', () => App.route());
window.addEventListener('DOMContentLoaded', () => App.boot());

/* 兜底：异步回调遗漏 try/catch 时统一弹 toast,避免"点了没反应" */
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  const msg = r && r.message ? r.message : (typeof r === 'string' && r ? r : '操作失败，请重试');
  try { toast(msg, 'err'); } catch (err) { /* DOM 未就绪 */ }
});
