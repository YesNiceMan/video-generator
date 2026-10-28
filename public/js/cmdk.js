'use strict';
/* Cmd+K / Ctrl+K 命令面板：快速跳转页面与项目、执行常用操作
   —— 十六·1「操作更加方便」核心交互。自包含，不侵入既有视图逻辑 */
const CmdK = {
  mask: null, input: null, list: null,
  items: [], filtered: [], sel: 0, open: false,

  boot() {
    this.mask = document.createElement('div');
    this.mask.className = 'cmdk-mask';
    this.mask.style.display = 'none';
    this.mask.innerHTML =
      '<div class="cmdk" role="dialog" aria-label="命令面板">'
      + '<div class="cmdk-input-row">'
      + '<i data-lucide="search"></i>'
      + '<input class="cmdk-input" id="cmdkInput" placeholder="搜索页面、项目或输入命令…" autocomplete="off">'
      + '<span style="display:inline-flex;gap:4px"><kbd class="kbd">Esc</kbd></span>'
      + '</div>'
      + '<div class="cmdk-list" id="cmdkList"></div>'
      + '<div class="cmdk-foot">'
      + '<span><kbd class="kbd">\u2191</kbd><kbd class="kbd">\u2193</kbd> 选择</span>'
      + '<span><kbd class="kbd">\u21b5</kbd> 打开</span>'
      + '<span class="cmdk-mark">视界引擎 · Cin\u00e9 Noir</span>'
      + '</div></div>';
    document.body.appendChild(this.mask);
    this.input = this.mask.querySelector('#cmdkInput');
    this.list = this.mask.querySelector('#cmdkList');

    /* 遮罩点击关闭 */
    this.mask.addEventListener('mousedown', e => { if (e.target === this.mask) this.hide(); });

    /* 输入过滤 */
    this.input.addEventListener('input', () => { this.sel = 0; this.render(); });

    /* 键盘：全局快捷键 + 面板内导航(捕获阶段确保优先) */
    document.addEventListener('keydown', e => {
      const k = e.key;
      if ((e.metaKey || e.ctrlKey) && String(k).toLowerCase() === 'k') {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (!this.open) return;
      if (k === 'Escape') { e.preventDefault(); this.hide(); }
      else if (k === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (k === 'Enter') { e.preventDefault(); this.exec(this.filtered[this.sel]); }
    }, true);

    /* 顶栏触发按钮 */
    const btn = document.getElementById('cmdkBtn');
    if (btn) btn.addEventListener('click', () => this.toggle());
  },

  toggle() { if (this.open) this.hide(); else this.show(); },

  show() {
    if (!App.user) return;
    this.open = true;
    this.mask.style.display = '';
    this.input.value = '';
    this.sel = 0;
    this.buildItems();
    this.render();
    setTimeout(() => { try { this.input.focus(); } catch (e) {} }, 0);
    try { window.lucide && lucide.createIcons(); } catch (e) {}
  },

  hide() {
    this.open = false;
    this.mask.style.display = 'none';
    try { this.input.blur(); } catch (e) {}
  },

  buildItems() {
    const admin = App.user && App.user.role === 'admin';
    const mkPage = (label, route, ico, sub) => ({
      group: '页面导航', label: label, sub: sub || '', ico: ico,
      run: () => { location.hash = '#/' + String(route).replace(/^\//, ''); }
    });
    const pages = [
      mkPage('首页 · 创作概览', '/', 'layout-dashboard'),
      mkPage('项目分集', '/projects', 'film'),
      mkPage('短剧工作流', '/workflow', 'scroll-text', '剧本 → 分析 → 分镜 → 画风 → 下发'),
      mkPage('资产库', '/assets', 'folder-open'),
      mkPage('风格库', '/styles', 'palette'),
      mkPage('AI 生图', '/images', 'image-plus')
    ];
    if (admin) pages.push(mkPage('后台管理', '/admin', 'settings'));
    /* 项目跳转：顶栏不再常驻项目切换器，统一由命令面板承担 */
    const projs = (App.projects || []).slice(0, 40).map(p => ({
      group: '项目', label: p.name,
      sub: p.episode_count + ' 集 · ' + (p.task_count || 0) + ' 任务',
      ico: 'clapperboard',
      run: () => { location.hash = '#/projects/' + p.id; }
    }));
    const acts = [
      { group: '快速操作', label: '新建项目', sub: '创建剧集项目并获得邀请码', ico: 'plus', run: () => CmdK.actNewProject() },
      { group: '快速操作', label: '新建短剧工作流', sub: '贴剧本 → 分析人物与分镜', ico: 'scroll-text', run: () => { location.hash = '#/workflow'; setTimeout(() => DramaView.createDrama(), 320); } },
      { group: '快速操作', label: '上传素材到资产库', sub: '图片 / 视频 / 音频', ico: 'upload', run: () => { location.hash = '#/assets'; setTimeout(() => AssetsView.showUploadDialog(), 260); } },
      { group: '快速操作', label: '打开积分中心', sub: () => '余额 ' + ((App.user && App.user.credits) || 0), ico: 'coins', run: () => CreditCenter.open() },
      { group: '快速操作', label: '查看通知', sub: '未读消息与任务提醒', ico: 'bell', run: () => App.toggleNotifs() },
      { group: '快速操作', label: () => (App.currentScheme() === 'light' ? '切换到深色模式' : '切换到浅色模式'), sub: '顶栏右侧也可随时切换', ico: 'sun-moon', run: () => App.toggleScheme() },
      { group: '快速操作', label: '退出登录', sub: App.user ? App.user.name : '', ico: 'log-out', run: async () => {
          await API.post('/auth/logout'); location.hash = '#/login'; App.boot();
        } }
    ];
    this.items = pages.concat(projs).concat(acts);
  },

  actNewProject: null,   // 见文件底部初始化

  filter(q) {
    q = String(q == null ? '' : q).trim().toLowerCase();
    /* label / sub 允许是函数，便于展示随状态变化的文案(如"切换到深色模式"、余额) */
    const resolve = it => ({ it: it, label: typeof it.label === 'function' ? it.label() : it.label, sub: typeof it.sub === 'function' ? it.sub() : (it.sub || '') });
    const all = this.items.map(resolve);
    if (!q) return all;
    const rows = [];
    for (const x of all) {
      const hay = (x.label + ' ' + x.sub).toLowerCase();
      let i = -1, score = 0, streak = 0, firstAt = -1, ok = true;
      for (const ch of q) {
        const j = hay.indexOf(ch, i + 1);
        if (j < 0) { ok = false; break; }
        if (firstAt < 0) firstAt = j;
        streak = (j === i + 1) ? streak + 1 : 1;
        score += streak * 2 + Math.max(0, 6 - j);
        i = j;
      }
      if (!ok) continue;
      rows.push({ it: x.it, label: x.label, sub: x.sub, _score: score - firstAt });
    }
    rows.sort((a, b) => b._score - a._score);
    return rows;
  },

  render() {
    const rows = this.filter(this.input.value);
    this.filtered = rows.map(r => r.it);
    if (!rows.length) {
      this.list.innerHTML = '<div class="cmdk-empty">没有匹配的结果，换个关键词试试</div>';
      return;
    }
    let html = '', lastGroup = null;
    rows.forEach((r, idx) => {
      if (r.it.group !== lastGroup) {
        html += '<div class="cmdk-group-label">' + esc(r.it.group) + '</div>';
        lastGroup = r.it.group;
      }
      html += '<div class="cmdk-item' + (idx === this.sel ? ' sel' : '') + '" data-idx="' + idx + '">'
        + icon(r.it.ico)
        + '<div><div>' + esc(r.label) + '</div>' + (r.sub ? '<div class="ci-sub">' + esc(r.sub) + '</div>' : '') + '</div>'
        + '<span class="ci-go">' + icon('corner-down-left') + '</span>'
        + '</div>';
    });
    this.list.innerHTML = html;
    const self = this;
    this.list.querySelectorAll('.cmdk-item').forEach(node => {
      node.addEventListener('mouseenter', () => { self.sel = Number(node.dataset.idx); self.paintSel(); });
      node.addEventListener('click', () => self.exec(self.filtered[Number(node.dataset.idx)]));
    });
    this.paintSel(true);
    try { window.lucide && lucide.createIcons(); } catch (e) {}
  },

  paintSel(scroll) {
    const idx = this.sel;
    this.list.querySelectorAll('.cmdk-item').forEach(n => n.classList.toggle('sel', Number(n.dataset.idx) === idx));
    const cur = this.list.querySelector('.cmdk-item.sel');
    if (cur && scroll) { try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
  },

  move(d) {
    if (!this.filtered.length) return;
    this.sel = (this.sel + d + this.filtered.length) % this.filtered.length;
    this.paintSel(true);
  },

  exec(item) {
    if (!item) return;
    this.hide();
    setTimeout(() => { try { item.run(); } catch (e) { toast(e.message, 'err'); } }, 30);
  }
};

/* 新建项目：与首页/项目分集页同一套表单(含 26·5 的出片规格设置) */
CmdK.actNewProject = function () { return ProjectsView.newProjectDialog(); };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => CmdK.boot());
else CmdK.boot();
