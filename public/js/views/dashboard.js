'use strict';
/* 首页：用户欢迎区 + 仪表盘统计 + 项目分集(仅保留这两个板块) */
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
      const assetTotal = assetsRes.total != null ? assetsRes.total : assets.length;
      const balance = (creditsRes && creditsRes.balance) ?? (App.user.credits || 0);
      const active = tasks.filter(t => ['queued', 'processing'].includes(t.status)).length;
      const completed = tasks.filter(t => t.status === 'completed').length;
      const u = App.user;
      const hour = new Date().getHours();
      const hello = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
      /* 二十九轮：最近成果(生成成功的图片/视频，点击进统一查看器) */
      const recent = DashboardView.collectRecent(tasks);

      root.innerHTML = `
      <!-- 欢迎区：身份 + 存储 + 唯一主行动 -->
      <div class="dash-hero">
        <div class="dh-avatar">${avatar(u.name)}</div>
        <div class="dh-main">
          <div class="dh-title">${hello}，${esc(u.name)}</div>
          <div class="dh-sub">选择一个项目进入分集列表，或先用 AI 生图补齐参考素材</div>
        </div>
        <div class="dh-actions">
          <button class="btn btn-primary" id="dashHeroNew">${iconText('plus', '新建项目')}</button>
          <a class="btn" href="#/images">${iconText('image-plus', 'AI 生图')}</a>
        </div>
        <div class="dh-storage">
          <div class="storage-label"><span>存储空间</span><span>${fmtBytes(u.storage_used || 0)} / ${fmtBytes(u.storage_quota || 1)}</span></div>
          <div class="storage-bar"><div class="storage-fill" style="width:${Math.min(100, (u.storage_used || 0) / (u.storage_quota || 1) * 100)}%"></div></div>
        </div>
      </div>

      <div class="stat-cards">
        <div class="stat-card"><div class="stat-value">${projects.reduce((s, p) => s + (p.episode_count || 0), 0)}</div><div class="stat-label">分集总数</div></div>
        <div class="stat-card"><div class="stat-value">${completed}<small>/ ${tasks.length}</small></div><div class="stat-label">已完成任务</div></div>
        <div class="stat-card"><div class="stat-value">${active}</div><div class="stat-label">进行中任务</div></div>
        <div class="stat-card"><div class="stat-value">${assetTotal}</div><div class="stat-label">资产总数</div></div>
        <div class="stat-card is-clickable" id="creditStatCard"><div class="stat-value">${balance}</div><div class="stat-label">积分余额</div><div class="stat-hint">点击申请或查看明细</div></div>
      </div>

      ${recent.length ? `
      <div class="section-head">
        <div class="section-title">最近成果</div>
        <a class="section-more" href="#/images">${icon('image-plus', 'ico-sm')} 去 AI 生图</a>
      </div>
      <div class="dash-recent" id="dashRecent">${DashboardView.recentHTML(recent)}</div>` : ''}

      <div class="section-head">
        <div class="section-title">项目分集</div>
        <a class="section-more" href="#/projects">${icon('arrow-right', 'ico-sm')} 管理全部</a>
      </div>
      <div class="grid grid-cards" id="dashProjGrid"></div>`;

      root.querySelector('#creditStatCard')?.addEventListener('click', () => CreditCenter.open());
      root.querySelector('#dashHeroNew')?.addEventListener('click', () => DashboardView.newProjectDialog());
      this.renderProjects(root.querySelector('#dashProjGrid'), projects.slice(0, PAGE_SIZE), projects.length);
      this.bindRecent(root, recent);
    } catch (e) {
      root.innerHTML = `<div class="empty"><div class="empty-ico">${icon('triangle-alert')}</div><h3>${esc(e.message)}</h3></div>`;
    }
  },

  /* 二十九轮：从任务列表收集最近的生成成果(图片按张、视频按条，新→旧) */
  collectRecent(tasks) {
    const out = [];
    for (const t of (tasks || [])) {
      if (t.status !== 'completed') continue;
      if (t.type === 'text-to-image' && (t.result_assets || []).length) {
        for (const a of t.result_assets) {
          if (!a || !a.id) continue;
          out.push({ id: a.id, type: 'image', name: t.prompt || '生图成果', created_at: t.created_at, width: a.width, height: a.height });
        }
      } else if (t.result && t.result.id) {
        out.push({
          id: t.result.id, type: 'video', name: t.prompt || '生成视频', created_at: t.created_at,
          poster: '/api/assets/' + t.result.id + '/thumbnail',
          width: t.result.width, height: t.result.height, duration: t.result.duration
        });
      }
      if (out.length >= 12) break;
    }
    return out.slice(0, 12);
  },

  recentHTML(recent) {
    return recent.map((r, i) => `
      <button class="dash-rec-tile" data-rec-idx="${i}" title="点击放大查看">
        <img src="${r.type === 'video' ? r.poster : '/api/assets/' + r.id + '/file'}" loading="lazy" alt="">
        <span class="dash-rec-badge">${r.type === 'video' ? icon('clapperboard', 'ico-xs') + '视频' : icon('image', 'ico-xs') + '图片'}</span>
      </button>`).join('');
  },

  bindRecent(root, recent) {
    const wrap = root.querySelector('#dashRecent');
    if (!wrap || !recent.length) return;
    const items = recent.map(r => ({
      id: r.id, name: String(r.name || '').slice(0, 42) || '生成成果', type: r.type,
      poster: r.poster, width: r.width, height: r.height, duration: r.duration, created_at: r.created_at
    }));
    wrap.querySelectorAll('[data-rec-idx]').forEach(btn => btn.addEventListener('click', () => {
      openViewer(items, Number(btn.dataset.recIdx) || 0);
    }));
  },

  renderProjects(grid, projects, totalAll) {
    if (!grid) return;
    totalAll = totalAll != null ? totalAll : projects.length;
    let html = `<button class="dash-new-card" id="dashNewProject" title="新建项目"><span class="dn-plus">${icon('plus')}</span>新建项目</button>`;
    if (!projects.length) {
      html += `<div class="empty" style="grid-column:1/-1;padding:var(--sp-8)"><div class="empty-ico">${icon('clapperboard')}</div><h3>还没有项目</h3><p>创建剧集项目，或用管理员分享的邀请码加入协作</p></div>`;
    } else {
      html += projects.map(p => `
        <a class="dash-proj-card" href="#/projects/${p.id}">
          <div class="dp-row">
            <span class="dp-ico">${icon('clapperboard')}</span>
            <span style="flex:1"></span>
            ${p.my_role === 'owner'
              ? `<span class="proj-code-badge" data-dash-code="${esc(p.code || '')}" title="项目邀请码 · 点击复制">${icon('hash')}${esc(p.code || '')}</span>`
              : '<span class="member-tag">已加入</span>'}
          </div>
          <div class="dp-name">${esc(p.name)}</div>
          <div class="dp-desc">${esc(p.description || '暂无描述')}</div>
          <div class="dp-foot"><span><b>${p.episode_count}</b> 分集</span><span>${p.task_count} 任务</span></div>
        </a>`).join('');
      /* 首页概览不铺满全部项目(26·1),超出部分交给「项目分集」页的分页列表 */
      if (totalAll > projects.length) {
        html += `<div class="dash-more" style="grid-column:1/-1">首页仅显示最近 ${projects.length} 个项目 · <a href="#/projects">管理全部 ${totalAll} 个 ${icon('arrow-right', 'ico-xs')}</a></div>`;
      }
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-dash-code]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      try { await navigator.clipboard.writeText(b.dataset.dashCode); toast('邀请码已复制：' + b.dataset.dashCode, 'ok'); }
      catch (err) { toast('邀请码：' + b.dataset.dashCode, 'ok'); }
    }));
    grid.querySelector('#dashNewProject').addEventListener('click', () => DashboardView.newProjectDialog());
  }
};
/* 新建项目：与项目分集页同一套表单(含 26·5 的出片规格设置),不再各自实现一份 */
DashboardView.newProjectDialog = function () { return ProjectsView.newProjectDialog(); };