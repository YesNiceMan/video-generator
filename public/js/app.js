'use strict';
/* 应用入口:引导、路由、外壳交互 */
const App = {
  user: null,
  projects: [],
  currentRoute: '',
  viewCleanup: null,
  PAGE_TITLES: {
    '/': '首页', '/assets': '资产库',
    '/projects': '项目分集', '/styles': '风格库', '/admin': '后台管理'
  },

  /* 十八·2 浅色模式:初始方案由 index.html 早期脚本确定,这里提供切换与持久化 */
  currentScheme() {
    return document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark';
  },

  applyScheme(scheme, persist) {
    document.documentElement.dataset.scheme = scheme;
    if (persist) {
      try { localStorage.setItem('vf-scheme', scheme); } catch (e) { /* 忽略 */ }
    }
  },

  toggleScheme() {
    const next = this.currentScheme() === 'light' ? 'dark' : 'light';
    this.applyScheme(next, true);
    toast(next === 'light' ? '已切换到浅色模式' : '已切换到深色模式', 'ok', 1800);
  },

  async boot() {
    try {
      const { user } = await API.get('/auth/me');
      if (!user) return this.showAuth();
      this.user = user;
      /* 已登录时不应停留在登录/注册页:清掉 hash(不触发多余路由),回到仪表盘 */
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
    document.body.classList.remove('wb-mode', 'wb-batch');
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
    const adminNav = document.querySelector('.nav-admin');
    if (adminNav) adminNav.style.display = u.role === 'admin' ? '' : 'none';
    this.renderUserStorage();
    this.refreshProjects();
    CreditCenter.refresh();
    this.bindShellEvents();
  },

  /* 顶栏交互只绑定一次:退出再登录会重复调用 boot() → renderShell(),
     若每次都叠加 click 监听,点一次"右上角菜单"会被 toggle 两次导致永远弹不出来 */
  bindShellEvents() {
    if (this._shellBound) return;
    this._shellBound = true;
    const pop = id => document.getElementById(id);
    document.getElementById('topLogoutBtn').addEventListener('click', async () => {
      await API.post('/auth/logout');
      location.hash = '#/login';
      this.boot();
    });
    document.getElementById('creditChip').addEventListener('click', () => CreditCenter.open());
    document.getElementById('creditCenterBtn').addEventListener('click', () => {
      pop('topUserPop').classList.add('hidden');
      CreditCenter.open();
    });
    document.getElementById('notifBtn').addEventListener('click', () => this.toggleNotifs());
    const schemeBtn = document.getElementById('schemeBtn');
    if (schemeBtn) schemeBtn.addEventListener('click', () => this.toggleScheme());
    document.getElementById('topUserBtn').addEventListener('click', e => {
      e.stopPropagation();
      pop('topUserPop').classList.toggle('hidden');
      pop('projSwitchPop').classList.add('hidden');
    });
    document.getElementById('projSwitchBtn').addEventListener('click', e => {
      e.stopPropagation();
      pop('projSwitchPop').classList.toggle('hidden');
      pop('topUserPop').classList.add('hidden');
    });
    /* 点击空白处收起弹层:用委托并阻止与按钮 toggle 冲突(按钮已 stopPropagation) */
    document.addEventListener('click', e => {
      if (!e.target.closest('#topUser')) pop('topUserPop').classList.add('hidden');
      if (!e.target.closest('#projSwitch')) pop('projSwitchPop').classList.add('hidden');
    });
    /* 路由切换/Escape 键也能收起,避免弹层残留 */
    window.addEventListener('hashchange', () => {
      pop('topUserPop').classList.add('hidden');
      pop('projSwitchPop').classList.add('hidden');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        pop('topUserPop').classList.add('hidden');
        pop('projSwitchPop').classList.add('hidden');
        const np = pop('notifPanel'); if (np) np.classList.add('hidden');
      }
    });
  },

  renderUserStorage() {
    const u = this.user;
    const used = u.storage_used || 0, quota = u.storage_quota || 1;
    document.getElementById('tuStorage').textContent = `${fmtBytes(used)} / ${fmtBytes(quota)}`;
    document.getElementById('tuStorageFill').style.width = Math.min(100, used / quota * 100) + '%';
  },

  /* 拉取项目列表(顶栏项目切换器 + 首页共用) */
  async refreshProjects() {
    try {
      const res = await API.get('/projects');
      this.projects = res.items || [];
      this.renderProjectSwitch();
    } catch (e) { /* 静默失败 */ }
  },

  renderProjectSwitch() {
    const pop = document.getElementById('projSwitchPop');
    const name = document.getElementById('projSwitchName');
    if (!pop) return;
    const path = (this.currentRoute || location.hash).replace(/^#/, '') || '/';
    const segs = path.split('/').filter(Boolean);
    const curId = segs[0] === 'projects' ? segs[1] : null;
    const cur = this.projects.find(p => p.id === curId);
    if (cur) name.textContent = cur.name;
    else if (curId) name.textContent = '项目 ' + String(curId).slice(0, 8);
    else name.textContent = this.projects.length ? '选择项目' : '暂无项目';

    const needSearch = this.projects.length > 5;
    pop.innerHTML = `
      <div class="ps-pop-head">${cur ? '当前项目' : '切换项目'} · ${this.projects.length} 个</div>
      ${needSearch ? '<input class="ps-search" id="psSearch" placeholder="输入名称筛选…" autocomplete="off">' : ''}
      <div class="ps-pop-list" id="psList"></div>
      <a class="ps-pop-item ps-pop-all" href="#/projects">${icon('film', 'ps-pop-ico')}<span>全部项目分集</span></a>`;
    const listEl = pop.querySelector('#psList');
    const bindItems = () => {
      listEl.querySelectorAll('[data-proj]').forEach(a => a.addEventListener('click', () => pop.classList.add('hidden')));
    };
    const drawList = kw => {
      kw = (kw || '').trim().toLowerCase();
      const shown = kw ? this.projects.filter(p => (p.name || '').toLowerCase().includes(kw)) : this.projects;
      const items = shown.slice(0, 12).map(p => `
        <a class="ps-pop-item${p.id === curId ? ' cur' : ''}" href="#/projects/${p.id}" data-proj="${p.id}">
          ${icon('clapperboard', 'ps-pop-ico')}
          <span class="ps-pop-name">${esc(p.name)}</span>
          <span class="ps-pop-meta">${p.episode_count} 集</span>
        </a>`).join('');
      listEl.innerHTML = items
        || (this.projects.length ? '<div class="ps-pop-item" style="color:var(--text-faint);cursor:default">没有匹配的项目</div>'
                                 : '<div class="ps-pop-item" style="color:var(--text-faint);cursor:default">暂无项目，去创建第一个吧</div>');
      bindItems();
    };
    drawList('');
    const search = pop.querySelector('#psSearch');
    if (search) search.addEventListener('input', () => drawList(search.value));
  },

  /* 通知 */
  async pollNotifs() {
    try {
      const { unread } = await API.get('/auth/notifications');
      const badge = document.getElementById('notifBadge');
      badge.textContent = unread;
      badge.style.display = unread ? '' : 'none';
    } catch (e) {}
  },

  async toggleNotifs() {
    const panel = document.getElementById('notifPanel');
    if (!panel.classList.contains('hidden')) { panel.classList.add('hidden'); return; }
    const { items } = await API.get('/auth/notifications');
    panel.innerHTML = '';
    if (!items.length) panel.innerHTML = '<div class="notif-empty">暂无通知</div>';
    for (const n of items) {
      panel.appendChild(el(`
        <div class="notif-item${n.read ? '' : ' unread'}" data-task="${n.task_id || ''}">
          <div class="n-title">${n.read ? '' : '<span class="n-dot"></span>'}${esc(n.title)}</div>
          <div class="n-body">${esc(n.body)}</div>
          <div class="n-time">${fmtAgo(n.created_at)}</div>
        </div>`));
    }
    panel.classList.remove('hidden');
    await API.post('/auth/notifications/read');
    this.pollNotifs();
    panel.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const tid = item.dataset.task;
        panel.classList.add('hidden');
        if (tid) location.hash = '#/projects';
      });
    });
  },

  startPolling() {
    clearInterval(this._pollTimer);
    this.pollNotifs();
    this._pollTimer = setInterval(() => {
      this.pollNotifs();
      CreditCenter.refresh(); // 积分余额随任务消耗实时刷新
    }, 15000);
  },

  /* 路由 */
  route() {
    if (!this.user) { this.showAuth(); return; }
    document.body.classList.remove('wb-mode', 'wb-batch');
    let hash = location.hash || '#/';
    let path = hash.replace(/^#/, '') || '/';
    let segs = path.split('/').filter(Boolean);
    let view, params = {};

    /* 已登录用户访问登录/注册页 → 清掉 hash 回到仪表盘(修复登录成功后不跳转) */
    if (segs[0] === 'login' || segs[0] === 'register') {
      history.replaceState(null, '', location.pathname + location.search);
      hash = '#/'; path = '/'; segs = [];
    }

    /* 创作工坊已取消:视频创作只保留在项目分集内,旧链接统一回到项目分集 */
    if (segs[0] === 'create') {
      location.replace('#/projects');
      return;
    }

    if (segs[0] === 'projects' && segs[1] && segs[2] === 'episode' && segs[3]) { view = ProjectsView; params = { id: segs[1], episodeId: segs[3] }; }
    else if (segs[0] === 'projects' && segs[1]) { view = ProjectsView; params = { id: segs[1] }; }
    else if (segs[0] === 'projects') { view = ProjectsView; }
    else if (segs[0] === 'assets') { view = AssetsView; }
    else if (segs[0] === 'styles') { view = StylesView; }
    else if (segs[0] === 'admin') { view = AdminView; }
    else { view = DashboardView; }

    const root = document.getElementById('view');
    root.innerHTML = '';
    if (this.viewCleanup) { try { this.viewCleanup(); } catch (e) {} this.viewCleanup = null; }

    /* 顶栏导航高亮 */
    document.querySelectorAll('.top-link').forEach(n => {
      const r = n.dataset.route;
      n.classList.toggle('active', path === r || (r === '/projects' && segs[0] === 'projects'));
    });

    if (!view) { this.showAuth(); return; }

    // 顶栏标题与项目上下文
    if (segs[0] === 'projects' && segs[1]) {
      document.getElementById('pageTitle').textContent = '项目分集';
    } else {
      document.getElementById('pageTitle').textContent = this.PAGE_TITLES['/' + segs[0]] || '仪表盘';
    }
    document.getElementById('projSwitchPop').classList.add('hidden');
    document.getElementById('topUserPop').classList.add('hidden');
    this.renderProjectSwitch();

    const cleanup = view.render(root, params);
    if (typeof cleanup === 'function') this.viewCleanup = cleanup;
    this.currentRoute = path;
  }
};

window.addEventListener('hashchange', () => App.route());
window.addEventListener('DOMContentLoaded', () => App.boot());
