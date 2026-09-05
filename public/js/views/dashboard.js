'use strict';
/* 首页:用户欢迎区 + 仪表盘统计 + 项目分集(仅保留这两个板块) */
const DashboardView = {
  async render(root) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    try {
      const [assetsRes, tasksRes, projectsRes, creditsRes] = await Promise.all([
        API.get('/assets?folder_id=root&type=all'),
        API.get('/tasks?status=all'),
        API.get('/projects'),
        API.get('/credits').catch(() => null)
      ]);
      if (creditsRes) { CreditCenter.cache.balance = creditsRes.balance; CreditCenter.cache.pricing = creditsRes.pricing; }
      const assets = assetsRes.items, tasks = tasksRes.items, projects = projectsRes.items;
      const balance = (creditsRes && creditsRes.balance) ?? (App.user.credits || 0);
      const active = tasks.filter(t => ['queued', 'processing'].includes(t.status)).length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      const u = App.user;
      const usedGB = (u.storage_used || 0) / 1024 ** 3;
      const quotaGB = (u.storage_quota || 1) / 1024 ** 3;
      const hour = new Date().getHours();
      const hello = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

      root.innerHTML = `
      <!-- 欢迎区:用户 -->
      <div class="dash-hero">
        <div class="dh-avatar">${avatar(u.name)}</div>
        <div class="dh-main">
          <div class="dh-title">${hello},${esc(u.name)}</div>
          <div class="dh-sub">从下方选择一个项目进入分集列表,开启今天的视频创作</div>
        </div>
        <div class="dh-actions">
          <button class="btn btn-primary btn-sm" id="dashHeroNew">${iconText('plus', '新建项目')}</button>
          <button class="btn btn-sm" id="dashHeroJoin">${iconText('user-plus', '邀请码加入')}</button>
        </div>
        <div class="dh-storage">
          <div class="storage-label"><span>存储空间</span><span>${fmtBytes(u.storage_used || 0)} / ${fmtBytes(u.storage_quota || 1)}</span></div>
          <div class="storage-bar"><div class="storage-fill" style="width:${Math.min(100, (u.storage_used || 0) / (u.storage_quota || 1) * 100)}%"></div></div>
        </div>
      </div>

      <!-- 板块一:仪表盘 -->
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-value">${projects.reduce((s, p) => s + (p.episode_count || 0), 0)}</div><div class="stat-label">分集总数</div></div>
        <div class="stat-card"><div class="stat-value">${completed}<span style="font-size:14px;margin-left:4px">/ ${tasks.length}</span></div><div class="stat-label">已完成任务</div></div>
        <div class="stat-card"><div class="stat-value">${active}</div><div class="stat-label">进行中任务</div></div>
        <div class="stat-card"><div class="stat-value">${assets.length}</div><div class="stat-label">资产总数</div></div>
        <div class="stat-card" id="creditStatCard" title="点击打开积分中心" style="cursor:pointer">
          <div class="stat-value">${balance}</div><div class="stat-label">积分余额 · 点击申请/明细</div>
          <div style="font-size:10.5px;color:var(--text-faint);margin-top:4px">免费模型不消耗积分</div>
        </div>
        <div class="stat-card"><div class="stat-value">${usedGB.toFixed(1)}<span style="font-size:14px;margin-left:2px">GB</span></div><div class="stat-label">存储用量 / ${quotaGB} GB</div></div>
      </div>

      <!-- 板块二:项目分集 -->
      <div class="dash-projects-head">
        <div class="dph-title">项目分集</div>
        <div style="display:flex;gap:8px;align-items:center">
          <a class="dph-more" href="#/projects">${icon('arrow-right', 'ico-sm')} 管理全部</a>
        </div>
      </div>
      <div class="grid grid-cards" id="dashProjGrid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))"></div>`;

      root.querySelector('#creditStatCard')?.addEventListener('click', () => CreditCenter.open());
      root.querySelector('#dashHeroNew')?.addEventListener('click', () => DashboardView.newProjectDialog());
      root.querySelector('#dashHeroJoin')?.addEventListener('click', () => ProjectsView.joinProjectDialog());
      this.renderProjects(root.querySelector('#dashProjGrid'), projects);
    } catch (e) {
      root.innerHTML = `<div class="empty"><div class="empty-ico">${icon('triangle-alert')}</div><h3>${esc(e.message)}</h3></div>`;
    }
  },

  renderProjects(grid, projects) {
    if (!grid) return;
    let html = `<button class="dash-new-card" id="dashNewProject" title="新建项目"><span class="dn-plus">${icon('plus')}</span>新建项目</button>`;
    if (!projects.length) {
      html += `<div class="empty" style="grid-column:1/-1;padding:40px 20px"><div class="empty-ico">${icon('clapperboard')}</div><h3>还没有项目</h3><p style="font-size:13px">创建剧集项目,或用管理员分享的邀请码加入协作</p></div>`;
    } else {
      html += projects.map(p => `
        <a class="dash-proj-card" href="#/projects/${p.id}">
          <span class="dp-arrow">${icon('arrow-right')}</span>
          <div style="display:flex;justify-content:space-between;align-items:center;width:100%">
            <div class="dp-ico">${icon('clapperboard')}</div>
            ${p.my_role === 'owner'
              ? `<span class="proj-code-badge" data-dash-code="${esc(p.code || '')}" title="项目编号 · 点击复制">${icon('hash')}${esc(p.code || '')}</span>`
              : '<span class="member-tag">已加入</span>'}
          </div>
          <div class="dp-name">${esc(p.name)}</div>
          <div class="dp-desc">${esc(p.description || '暂无描述')}</div>
          <div class="dp-foot"><span><b>${p.episode_count}</b> 分集</span><span>${p.task_count} 任务</span><span>ID:${esc(p.id.slice(0, 8))}</span></div>
        </a>`).join('');
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-dash-code]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.dashCode); toast('邀请码已复制:' + b.dataset.dashCode, 'ok'); }
      catch (err) { toast('邀请码:' + b.dataset.dashCode, 'ok'); }
    }));
    grid.querySelector('#dashNewProject').addEventListener('click', () => DashboardView.newProjectDialog());
  }
};
/* 新建项目对话框(hero 与网格新建卡共用) */
DashboardView.newProjectDialog = async function () {
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
    toast(`项目已创建 · 邀请码 ${project.code}`, 'ok');
    location.hash = '#/projects/' + project.id;
  }
};