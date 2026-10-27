'use strict';
/* 后台管理：模型管理(有效性检查+免费模型自检) / 任务监控 / 用户管理 / 系统设置(含积分定价) / 积分审批 */
const ROW_STEP = 30;   /* 任务监控每次多渲染的行数：整表 200 行在 3s 轮询下会明显卡顿 */

/* 生图任务没有 duration/fps，此前统一渲染成「—s @ —fps」，一列噪声 */
const taskParamsText = t => {
  const p = t.params || {};
  /* 第四十二轮：文本处理任务(剧本润色/拆分镜等)没有时长与张数,按字数显示 */
  if (p.engine === 'textgen') {
    const label = p.selftest ? '文本模型自检' : (TEXT_TASK_LABELS[p.task] || p.task || '文本');
    return label + ' · ' + (p.chars_in || 0) + '→' + (p.chars_out || 0) + ' 字'
      + (p.shots ? ' · ' + p.shots + ' 镜' : '') + (p.ms ? ' · ' + Math.round(p.ms / 1000) + 's' : '');
  }
  if (p.selftest) return '免费模型自检';
  if (p.count || p.size) return [p.aspect_ratio || p.size, p.count ? p.count + ' 张' : ''].filter(Boolean).join(' · ');
  if (p.duration || p.fps) return (p.duration || '—') + 's @ ' + (p.fps || '—') + 'fps';
  return '—';
};

/* 网关排队已满的任务在 next_at 到点前不占 worker,列表要显示等待而不是静止的百分比 */
const busyWaitSec = t => (t.status === 'queued' && t.next_at) ? Math.ceil((t.next_at - Date.now()) / 1000) : 0;

/* 后台子标签写进地址(#/admin/tasks)，刷新与后退才不会再跳回第一个标签 */
const ADMIN_TABS = ['models', 'credits', 'tasks', 'users', 'themes', 'settings'];
/* 文本处理任务名(与服务端 textgen.TASKS 的 label 保持一致) */
const TEXT_TASK_LABELS = {
  polish: '润色剧本', expand: '扩写细节', condense: '压缩精简',
  to_video_prompt: '转视频提示词', split_shots: '拆分镜', selftest: '文本自检'
};

const AdminView = {
  state: { tab: 'models', pollTimer: null, task: { status: 'all', q: '', limit: ROW_STEP } },

  async render(root, params) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    if (App.user.role !== 'admin') {
      root.innerHTML = `<div class="empty"><div class="empty-ico">${icon('lock')}</div><h3>需要管理员权限</h3></div>`;
      return;
    }
    this.renderUI();
    /* 子标签写进地址(#/admin/tasks)，刷新/后退都能回到原来那一页；未知值回落模型管理 */
    const want = params && params.tab ? String(params.tab) : '';
    this.switchTab(ADMIN_TABS.includes(want) ? want : 'models');
    return () => this.stopPolling();
  },

  renderUI() {
    const tabs = [
      { key: 'models', label: '模型管理', icon: 'brain-circuit' },
      { key: 'credits', label: '积分审批', icon: 'coins' },
      { key: 'tasks', label: '任务监控', icon: 'activity' },
      { key: 'users', label: '用户管理', icon: 'users' },
      { key: 'themes', label: '主题管理', icon: 'palette' },
      { key: 'settings', label: '系统设置', icon: 'settings' }
    ];
    this.root.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <div class="page-eyebrow">${icon('settings')} Console</div>
        <h1 class="page-title">后台管理</h1>
        <p class="page-sub">模型接入与有效性自检 · 积分定价与审批 · 任务队列监控 · 用户与存储配额 · 主题与系统参数。</p>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(t => `<div class="tab" data-tab="${t.key}">${icon(t.icon, 'ico-sm')} ${t.label}</div>`).join('')}
    </div>
    <div id="adminBody"></div>`;
    this.root.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      const want = '#/admin/' + t.dataset.tab;
      /* 走 hash 而不是直接 switchTab：地址栏跟着变，刷新与浏览器后退都停在同一页 */
      if (location.hash === want) this.switchTab(t.dataset.tab);
      else location.hash = want;
    }));
  },

  switchTab(tab) {
    this.state.tab = tab;
    this.root.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'tasks') this.startPolling();
    else this.stopPolling();
    const body = this.root.querySelector('#adminBody');
    body.classList.remove('silent-render');
    body.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    if (tab === 'models') this.renderModels(body);
    else if (tab === 'tasks') this.renderTasks(body);
    else if (tab === 'users') this.renderUsers(body);
    else if (tab === 'credits') this.renderCreditRequests(body);
    else if (tab === 'themes') this.renderThemes(body);
    else this.renderSettings(body);
  },

  startPolling() {
    this.stopPolling();
    this._tasksSig = '';
    this.state.pollTimer = setInterval(() => {
      if (this.state.tab === 'tasks' && !document.hidden) this.renderTaskData();
    }, 3000);
  },
  stopPolling() {
    if (this.state.pollTimer) { clearInterval(this.state.pollTimer); this.state.pollTimer = null; }
    stopWaitCountdown(this._waitCd);
  },

  /* ---------- 模型有效性徽章 ---------- */
  mcBadge(m) {
    const map = {
      ok: `<span class="mc-badge mc-ok">${icon('circle-check', 'ico-xs')}有效</span>`,
      fail: `<span class="mc-badge mc-fail">${icon('circle-x', 'ico-xs')}无效</span>`,
      unknown: `<span class="mc-badge mc-unknown">未检查</span>`
    };
    return (map[m.check_status] || map.unknown)
      + (m.check_message ? `<div class="mc-msg" title="${esc(m.check_message)}">${esc(m.check_message)}</div>` : '')
      + (m.checked_at ? `<div class="mc-msg">检查于 ${fmtAgo(m.checked_at)}</div>` : '');
  },

  /* 生成协议适配器：显示模型当前使用的适配器标签(空 = 自动识别) */
  protocolLabel(m) {
    const PROTO = {
      'agnes-flash': 'Agnes Flash 适配',
      'agnes-v2': 'Agnes V2 适配',
      'openai-video': 'OpenAI 通用协议',
      ffmpeg: '本地 ffmpeg',
      'openai-image': 'OpenAI 生图协议',
      'gemini-image': 'Gemini 生图协议',
      'img-ffmpeg': '本地占位生图',
      'openai-chat': 'OpenAI Chat 协议'
    };
    return (PROTO[m.protocol] || '自动识别') + (m.rules && m.rules.protocol ? '' : ' · 自动');
  },

  /* 模型类型友好名(第二十五轮：并入 AI 生图;第四十二轮：并入文本处理) */
  typeLabel(m) {
    const MAP = { 'image-to-video': '图生视频', 'text-to-video': '文生视频', 'text-to-image': 'AI 生图', 'text-generation': '文本处理' };
    return MAP[m.type] || m.type;
  },

  /* ---------- 模型管理 ---------- */
  async renderModels(body, silent) {
    if (!silent || !this.models) {
      const res = await API.get('/styles/models');
      this.models = res.items;
    }
    const models = this.models;
    const on = models.filter(m => m.enabled).length;
    const bad = models.filter(m => m.check_status === 'fail').length;
    body.innerHTML = `
    <div class="filters">
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="mdSearch" placeholder="搜索模型名称或版本…"></div>
      <span class="filters-divider"></span>
      <span class="alib-count"><b class="gold-num">${models.length}</b> 个模型 · 启用 ${on}${bad ? ' · <b style="color:var(--danger)">' + bad + ' 个检查未通过</b>' : ''}</span>
      <div class="grow"></div>
      <div class="menu">
        <button class="btn" id="mdMoreBtn">${iconText('more-horizontal', '维护')}${icon('chevron-down', 'ico-xs')}</button>
        <div class="menu-pop hidden" id="mdMorePop">
          <button class="menu-item" id="checkAllBtn">${icon('shield-check', 'ico-sm')}<span>全部检查有效性</span></button>
          <button class="menu-item" id="selfTestBtn">${icon('flask-conical', 'ico-sm')}<span>测试免费模型(端到端自检)</span></button>
        </div>
      </div>
      <button class="btn btn-primary" id="addModelBtn">${iconText('plus', '新建模型')}</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table class="table">
      <thead><tr><th>模型</th><th>类型 / 协议</th><th>推理端点</th><th>并发</th><th>积分</th><th>状态</th><th>有效性</th><th>统计</th><th style="width:210px">操作</th></tr></thead>
      <tbody>${models.map(m => `
        <tr data-md-row="${esc((m.name || '') + ' ' + (m.version || '') + ' ' + (m.model_id || ''))}">
          <td><b>${esc(m.name)}</b>${m.is_free ? ' <span class="free-badge">' + icon('gift', 'ico-xs') + '免费</span>' : ''}${m.api_base ? ' <span class="tag-api">API</span>' : ''}<br><span style="font-size:var(--fs-xs);color:var(--ink-3)">${esc(m.version)}${m.model_id ? ' · ' + esc(m.model_id) : ''}</span></td>
          <td>${esc(this.typeLabel(m))}<br><span class="proto-tag" title="生成协议适配器(可按模型规则自动适配)">${esc(this.protocolLabel(m))}</span></td>
          <td style="font-family:var(--mono);font-size:var(--fs-xs);color:var(--ink-2)">${m.api_base ? esc(m.api_base) + (m.has_api_key ? ' ' + icon('key-round', 'ico-xs') + '<span style="font-family:var(--mono);font-size:var(--fs-xs);color:var(--ok)" title="API Key 已配置(尾号 ' + esc(m.api_key_tail || '') + ')">KEY</span>' : '') : esc(m.endpoint || '—')}</td>
          <td class="num">${m.concurrency}</td>
          <td>${m.is_free ? '<span class="free-badge">' + icon('gift', 'ico-xs') + '免费</span>'
            + (freeQuotaText(m)
              ? '<br><span style="font-size:var(--fs-xs);color:var(--ink-3)" title="额度总量登记在模型规则 rules.quota,已用量按平台内成功任务统计(直连网关与控制台用量不计入)">额度 ' + esc(freeQuotaText(m)) + ' · 已用 ' + m.free_quota.used + esc(m.free_quota.unit_text || '') + '</span>'
              : '<br><span style="font-size:var(--fs-xs);color:var(--ink-3)" title="在模型「生成规则 JSON」里加 &quot;quota&quot;:{&quot;total&quot;:30,&quot;unit&quot;:&quot;second&quot;} 即可显示余量">未登记额度</span>')
            : (Number(m.credit_per_second) > 0
              ? '<b style="font-family:var(--mono);color:var(--ok)">' + m.credit_per_second + '</b> <span style="font-size:var(--fs-xs);color:var(--ink-3)">' + ('积分/' + (m.type === 'text-to-image' ? '张' : m.type === 'text-generation' ? '次' : '秒')) + '</span>'
              : '<span class="muted">' + ('全局定价 / ' + (m.type === 'text-to-image' ? '张' : m.type === 'text-generation' ? '次' : '秒')) + '</span>')}</td>
          <td>${m.enabled ? '<span class="status status-completed">已启用</span>' : '<span class="status status-cancelled">已禁用</span>'}</td>
          <td>${this.mcBadge(m)}</td>
          <td class="muted">成功 ${m.success_count} · 失败 ${m.fail_count}<br>平均 ${Math.round((m.avg_duration_ms || 0) / 1000)}s</td>
          <td><div class="table-ops">
              <button class="btn btn-xs" data-edit-model="${m.id}">编辑</button>
              <button class="btn btn-xs ${m.enabled ? 'btn-danger' : ''}" data-toggle-model="${m.id}">${m.enabled ? '禁用' : '启用'}</button>
              <button class="btn btn-xs" data-del-model="${m.id}">删除</button>
              <button class="btn btn-xs" data-model-menu="${m.id}" title="更多维护操作">${icon('more-horizontal', 'ico-xs')}</button>
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>`;

    body.querySelector('#addModelBtn').addEventListener('click', () => this.editModel(null));
    bindMenu(body.querySelector('#mdMoreBtn'), body.querySelector('#mdMorePop'));
    body.querySelector('#mdSearch').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      body.querySelectorAll('[data-md-row]').forEach(r => { r.style.display = !q || r.dataset.mdRow.toLowerCase().includes(q) ? '' : 'none'; });
    });
    body.querySelector('#selfTestBtn').addEventListener('click', () => {
      const free = this.models.find(m => m.is_free) || this.models[0];
      if (free) this.selftestModel(free.id);
    });
    body.querySelector('#checkAllBtn').addEventListener('click', async () => {
      toast('正在检查全部模型…');
      for (const m of this.models) {
        try { await API.post('/admin/models/' + m.id + '/check'); } catch (e) { /* 单项失败继续检查其余 */ }
      }
      toast('全部检查完成', 'ok');
      this.renderModels(body);
    });
    body.querySelectorAll('[data-edit-model]').forEach(b => b.addEventListener('click', () => this.editModel(b.dataset.editModel)));
    /* 低频维护动作收进行内菜单，表格操作列只留三个常用按钮 */
    body.querySelectorAll('[data-model-menu]').forEach(b => b.addEventListener('click', e => {
      const m = this.models.find(x => x.id === b.dataset.modelMenu);
      if (!m) return;
      contextMenu(e, [
        { label: '检查有效性', icon: 'shield-check', onClick: () => this.checkModel(m.id) },
        { label: '端到端自检(提交真实任务)', icon: 'flask-conical', onClick: () => this.selftestModel(m.id) }
      ]);
    }));
    body.querySelectorAll('[data-toggle-model]').forEach(b => b.addEventListener('click', async () => {
      const m = this.models.find(x => x.id === b.dataset.toggleModel);
      await API.patch('/admin/models/' + m.id, { enabled: !m.enabled });
      toast(m.enabled ? '已禁用' : '已启用', 'ok');
      this.renderModels(body);
    }));
    body.querySelectorAll('[data-del-model]').forEach(b => b.addEventListener('click', async () => {
      const m = this.models.find(x => x.id === b.dataset.delModel);
      if (await confirmDlg('确认删除模型 "' + m.name + '"?')) {
        try { await API.del('/admin/models/' + m.id); toast('已删除', 'ok'); this.renderModels(body); }
        catch (e) { toast(e.message, 'err'); }
      }
    }));
  },

  /* 模型有效性检查 */
  async checkModel(id, quiet) {
    try {
      const res = await API.post('/admin/models/' + id + '/check');
      if (quiet) return res;
      toast(res.ok ? `检查通过：${res.model.name}` : `检查未通过：${res.message}`, res.ok ? 'ok' : 'err');
      this.renderModels(this.root.querySelector('#adminBody'));
      return res;
    } catch (e) {
      if (!quiet) toast(e.message, 'err');
      return null;
    }
  },

  /* 免费模型端到端自检：真实任务走完整队列 */
  async selftestModel(id) {
    const m = this.models.find(x => x.id === id) || { name: id };
    const STATUS_TEXT = { queued: '排队中', processing: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' };
    const statusModal = openModal({ title: `${icon('flask-conical', 'ico-sm')} 模型自检`, size: 'modal-sm', body: '<div class="loading-wrap"><span class="spinner"></span></div><div style="text-align:center;font-size:12px;color:var(--ink-2);padding-bottom:14px">正在对「' + esc(m.name) + '」执行端到端自检<br>(有效性检查 → 提交真实 2s 测试任务 → 队列渲染)</div>' });
    try {
      const res = await API.post('/admin/models/' + id + '/selftest');
      statusModal.close();
      toast(res.message, 'ok');
      // 轮询该自检任务直到完成
      const taskId = res.task.id;
      let done = false, lastStatus = '';
      const timer = setInterval(async () => {
        try {
          const { task } = await API.get('/tasks/' + taskId);
          if (task.status !== lastStatus) {
            lastStatus = task.status;
            toast(`自检任务状态：${STATUS_TEXT[task.status] || task.status} (${task.progress}%)`);
          }
          if (['completed', 'failed', 'cancelled'].includes(task.status)) {
            clearInterval(timer);
            done = true;
            if (task.status === 'completed') toast(`自检成功：「${m.name}」渲染管线正常(${Math.round((task.duration_ms || 0) / 1000)}s)`, 'ok');
            else toast(`自检失败：${errBrief(task.error) || task.status}`, 'err');
            if (this.state.tab === 'models') this.renderModels(this.root.querySelector('#adminBody'));
          }
        } catch (e) { clearInterval(timer); }
      }, 2000);
    } catch (e) {
      statusModal.close();
      toast(e.message, 'err');
    }
  },

  /* ---------- 添加 / 编辑模型 ----------
     支持「API 模型」：填入 API 地址 + API Key 后可一键检测可用模型列表，
     从结果中选择模型 ID;保存后自动执行有效性检查 */
  async editModel(id) {
    const m = id ? this.models.find(x => x.id === id)
      : { params_schema: [], enabled: true, concurrency: 1, api_base: '', has_api_key: false, model_id: '', credit_per_second: 0 };
    /* 分辨率档常量与默认值必须在下方 innerHTML 模板求值前就绪(模板内会引用)
       26·3:档位统一为 1K / 2K / 4K,历史模型模板里的纯数字档按就近档位折算 */
    const RES_TIERS = IMG_RES_TIERS;
    const toTier = v => {
      const s = String(v == null ? '' : v).trim().toUpperCase();
      if (RES_TIERS.includes(s)) return s;
      const px = resTierToPx(s);
      if (!px) return '1K';
      return px >= 3072 ? '4K' : px >= 1536 ? '2K' : '1K';
    };
    const prevRes = (() => {
      const rd = (m.params_schema || []).find(d => d && d.key === 'resolution');
      if (rd && rd.default != null) return toTier(rd.default);
      const sizeDef = (m.params_schema || []).find(d => d && d.key === 'size');
      const wm = sizeDef && sizeDef.options ? sizeDef.options.map(String).find(sx => /^[0-9]+x[0-9]+$/.test(sx)) : null;
      return wm ? toTier(Math.min.apply(null, wm.split('x').map(Number))) : '1K';
    })();
    /* 单次张数上限：此前默认值 4 与存储值同时标 selected,浏览器取 DOM 最后一个，
       导致编辑任何生图模型都会把上限重置为 4 */
    const prevMaxCount = (() => {
      const mc = m.rules && m.rules.limits && Number(m.rules.limits.max_count);
      return (Number.isFinite(mc) && mc >= 1 && mc <= 4) ? Math.round(mc) : 4;
    })();
    const body = el('<div></div>');
    const uid4 = 'em' + Math.random().toString(36).slice(2, 8);
    body.innerHTML = `
      <div class="form-row">
        <div class="field" style="flex:2"><label>模型名称</label><input class="input" id="emName" value="${esc(m.name || '')}" placeholder="如： GPT-Video"></div>
        <div class="field"><label>类型</label><select class="select" id="emType">
          <option value="image-to-video" ${!m.type || m.type === 'image-to-video' ? 'selected' : ''}>图生视频</option>
          <option value="text-to-video" ${m.type === 'text-to-video' ? 'selected' : ''}>文生视频</option>
          <option value="text-to-image" ${m.type === 'text-to-image' ? 'selected' : ''}>AI 生图</option>
          <option value="text-generation" ${m.type === 'text-generation' ? 'selected' : ''}>文本处理</option>
        </select></div>
        <div class="field"><label>版本</label><input class="input" id="emVersion" value="${esc(m.version || 'v1')}"></div>
      </div>

      <div class="em-api-box">
        <div class="em-api-title">${icon('plug-zap', 'ico-sm')} API 模型配置 <span class="hint" style="font-weight:400">(OpenAI 兼容接口)</span></div>
        <div class="field"><label>API 地址</label><input class="input" id="emApiBase" value="${esc(m.api_base || '')}" placeholder="如 https://api.openai.com/v1">
          <div class="hint">填入地址与 Key 后可点击「检测可用模型」拉取模型列表</div></div>
        <div class="form-row">
          <div class="field"><label>API Key</label>
            <div style="display:flex;gap:6px">
              <input class="input" id="emApiKey" type="password" placeholder="${m.has_api_key ? '已配置(尾号 ' + esc(m.api_key_tail || '') + '),留空保持不变' : 'sk-…'}" autocomplete="new-password">
              <button class="btn btn-sm" id="emKeyEye" title="显示/隐藏">${icon('eye')}</button>
            </div></div>
          <div class="field"><label>模型 ID</label>
            <input class="input" id="emModelId" list="${uid4}-list" value="${esc(m.model_id || '')}" placeholder="检测后从下拉中选择，或手动填写">
            <datalist id="${uid4}-list"></datalist></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-sm btn-primary" id="emDetectBtn">${iconText('radar', '检测可用模型')}</button>
          <span class="hint" id="emDetectMsg">填写 API 地址与 Key 后可检测</span>
        </div>
      </div>

      <div class="em-rules-box" style="margin-top:14px" id="emImgBox" ${m.type !== 'text-to-image' ? 'hidden' : ''}>
        <div class="em-api-title">${icon('image-plus', 'ico-sm')} 生图参数 <span class="hint" style="font-weight:400">能力与参数在生图页生效，无需改代码</span></div>
        <div class="field"><label>模型能力(可多选)</label>
          <div style="display:flex;flex-wrap:wrap;gap:14px">
            <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="emCapT2I" style="width:15px;height:15px;accent-color:var(--gold)" ${!(m.rules && Array.isArray(m.rules.caps) && m.rules.caps.length && !m.rules.caps.includes('text-to-image')) ? 'checked' : ''}>
              <span>${icon('type', 'ico-xs')} 文生图</span><span class="hint">纯提示词生成</span>
            </label>
            <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="emCapI2I" style="width:15px;height:15px;accent-color:var(--gold)" ${m.rules && Array.isArray(m.rules.caps) && m.rules.caps.includes('image-to-image') ? 'checked' : ''}>
              <span>${icon('image', 'ico-xs')} 图生图</span><span class="hint">1 张参考图改图</span>
            </label>
            <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px">
              <input type="checkbox" id="emCapMulti" style="width:15px;height:15px;accent-color:var(--gold)" ${m.rules && Array.isArray(m.rules.caps) && m.rules.caps.includes('multi-image') ? 'checked' : ''}>
              <span>${icon('layers', 'ico-xs')} 多图合成</span><span class="hint">多张参考图融合(含图生图)</span>
            </label>
          </div>
          <div class="hint">按 API 实际支持勾选；生图页与分镜弹窗会按能力显示「选择参考图 / 多图合成」入口，提交时后端同样校验</div></div>
        <div class="form-row">
          <div class="field"><label>画幅比例选项(可手动输入自定义比例)</label>
            <div class="em-size-tags" id="emRatios">
              ${['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'].map(rt => '<span class="em-size-tag" data-ratio="' + rt + '">' + rt + '</span>').join('')}
            </div>
            <div class="form-row" style="margin-top:6px">
              <input class="input" id="emRatioCustom" placeholder="自定义比例，如 4:5 / 2.35:1" style="flex:1">
              <button class="btn btn-sm" id="emRatioAdd">添加比例</button>
            </div>
            <div class="hint">点击标签启用/停用该画幅；启用后写入模型参数模板(ratio),生图页只显示启用的比例</div></div>
        </div>
        <div class="form-row">
          <div class="field"><label>默认分辨率</label>
            <select class="select" id="emRes">
              ${RES_TIERS.map(rs => '<option value="' + rs + '" ' + (String(prevRes) === rs ? 'selected' : '') + '>' + resTierLabel(rs) + '</option>').join('')}
            </select>
            <div class="hint">生图页显示「画幅比例 + 分辨率」，提交时按 比例 × 分辨率 换算具体尺寸(短边 = 档位，长边按比例，取偶数，最长 4096)</div>
          </div>
          <div class="field"><label>单次张数上限</label>
            <select class="select" id="emMaxCount">
              ${[1, 2, 3, 4].map(n => '<option value="' + n + '" ' + (n === prevMaxCount ? 'selected' : '') + '>' + n + ' 张</option>').join('')}
            </select></div>
        </div>
        <div class="field"><label>支持的分辨率档(逗号分隔)</label>
          <input class="input" id="emResTiers" value="${(() => { const rd = (m.params_schema || []).find(d => d && d.key === 'resolution'); const ls = m.rules && m.rules.limits && m.rules.limits.resolutions; const v = (Array.isArray(ls) && ls.length) ? ls : ((rd && Array.isArray(rd.options)) ? rd.options : []); return v.map(String).join(', '); })()}" placeholder="留空 = 按模型规则里的 resolutions 清单，都没有才用 1K, 2K, 4K">
          <div class="hint">生图页「分辨率」下拉就按这里渲染，保存时也会同步回 <code>rules.limits.resolutions</code> —— 网关只支持单档就只写一档，别让界面选出被服务端改掉的值(26·9 / 40·2)</div></div>
        <div class="field"><label>固定尺寸清单(可选，高级)</label>
          <input class="input" id="emSizeCustom" value="${(() => { const sd = (m.params_schema || []).find(d => d && d.key === 'size'); if (sd && sd.options) return sd.options.join(', '); const ls = m.rules && m.rules.limits && m.rules.limits.sizes; return Array.isArray(ls) ? ls.join(', ') : ''; })()}" placeholder="留空 = 由 比例 × 分辨率 自动换算；或输入 API 仅支持的固定尺寸，如 1024x1024, 1536x1024(逗号/空格分隔)">
          <div class="hint">仅当生图 API 只接受特定「像素尺寸」时填写：提交会按所选 比例 × 分辨率 换算后，向此清单就近吸附(同方向优先);留空则直接使用换算尺寸</div></div>
        <div class="form-row">
          <div class="field"><label>质量参数 <span class="hint" style="font-weight:400">(可选，部分 API 支持)</span></label>
            <select class="select" id="emQuality">
              <option value="">不启用</option>
              ${['standard', 'hd'].map(qd => '<option value="' + qd + '" ' + ((m.params_schema || []).some(d => d && d.key === 'quality' && d.default === qd) ? 'selected' : '') + '>' + qd + '</option>').join('')}
            </select></div>
          <div class="field"><label>是否支持 seed 种子</label>
            <select class="select" id="emHasSeed">
              <option value="1" ${(m.params_schema || []).some(d => d && d.key === 'seed') ? 'selected' : ''}>支持(生图页显示种子输入)</option>
              <option value="0" ${(m.params_schema || []).some(d => d && d.key === 'seed') ? '' : 'selected'}>不支持</option>
            </select></div>
        </div>
        <div class="hint" id="emSchemaOut" style="font-family:var(--mono);font-size:11px;color:var(--ink-2)"></div>
      </div>

      <div class="em-rules-box" style="margin-top:14px">
        <div class="em-api-title">${icon('workflow', 'ico-sm')} 生成规则 / 协议适配 <span class="hint" style="font-weight:400">提交任务后按该规则自动适配模型生成 · create.path / headers / body / id_path / nested_media · query.path(支持 &lt;video_id&gt;) / data_path / status_values · limits</span></div>
        <div class="field"><label>生成协议(适配器)</label>
          <select class="select" id="emProtocol">
            <option value="" ${m.rules && !m.rules.protocol ? 'selected' : ''}>自动识别(按模型 ID / API 自动匹配，推荐)</option>
            <option value="agnes-flash" ${m.rules && m.rules.protocol === 'agnes-flash' ? 'selected' : ''}>Agnes Video 2.5 Flash 兼容</option>
            <option value="agnes-v2" ${m.rules && m.rules.protocol === 'agnes-v2' ? 'selected' : ''}>Agnes Video V2.0 兼容</option>
            <option value="openai-video" ${m.rules && m.rules.protocol === 'openai-video' ? 'selected' : ''}>OpenAI 视频通用协议(规则可配)</option>
            <option value="ffmpeg" ${m.rules && m.rules.protocol === 'ffmpeg' ? 'selected' : ''}>本地 ffmpeg 渲染</option>
            <option value="openai-image" ${m.rules && m.rules.protocol === 'openai-image' ? 'selected' : ''}>OpenAI 生图兼容协议(规则可配)</option>
            <option value="gemini-image" ${m.rules && m.rules.protocol === 'gemini-image' ? 'selected' : ''}>Google Gemini 生图(generateContent)</option>
            <option value="img-ffmpeg" ${m.rules && m.rules.protocol === 'img-ffmpeg' ? 'selected' : ''}>本地占位生图(免费测试)</option>
            <option value="openai-chat" ${m.rules && m.rules.protocol === 'openai-chat' ? 'selected' : ''}>OpenAI Chat 兼容协议(文本处理)</option>
          </select>
          <div class="hint">添加新模型时通常选「自动识别」即可 —— 系统按模型 ID 特征匹配内置适配器；接入全新网关可选「OpenAI 视频通用协议」并微调下方规则，无需改代码。</div></div>
        <div class="field"><label>生成规则 JSON(可选)</label><textarea class="textarea" id="emRules" rows="7" spellcheck="false" style="font-family:var(--mono);font-size:11.5px" placeholder='{"create":{"path":"/videos","body":{"model":"<model_id>","prompt":"<prompt>","seconds":"<seconds>"}},"query":{"path":"/agnesapi","params":{"video_id":"<video_id>","model_name":"<model_id>"}}}'>${m.rules && Object.keys(m.rules).length ? esc(JSON.stringify(m.rules, null, 2)) : ''}</textarea>
          <div class="hint">占位符：&lt;model_id&gt; &lt;prompt&gt; &lt;mode&gt; &lt;seconds&gt; &lt;size&gt;(像素 WxH)&lt;resolution&gt;(分辨率档位)&lt;ratio&gt; / &lt;aspect_ratio&gt;(画幅)&lt;width&gt; &lt;height&gt; &lt;max_side&gt; &lt;min_side&gt; &lt;n&gt; &lt;seed&gt; &lt;fps&gt; &lt;quality&gt; &lt;negative_prompt&gt; &lt;first_frame&gt; &lt;last_frame&gt; &lt;images&gt; &lt;audios&gt; &lt;video_id&gt;。内置适配器(Agnes Flash/V2)无需填写，留空即可。</div>
          <div class="hint">生图网关「按像素尺寸」还是「按档位」收参数，取决于模板里写 &lt;size&gt; 还是 &lt;resolution&gt; —— 平台不预设任何一家的写法(26·9)。</div>
          <div class="em-tpl-row"><button class="btn btn-sm" id="emTplTier" title="把请求体模板换成「size=1K/2K/4K + ratio=16:9」这类档位网关(如 Agnes images)">填入档位网关模板</button>
          <button class="btn btn-sm" id="emTplPixel" title="换回 OpenAI 默认的像素尺寸 + multipart 图生图模板">填入 OpenAI 像素模板</button></div></div>
      </div>

      <div class="field"><label>推理端点(可选，兼容旧配置)</label><input class="input" id="emEndpoint" value="${esc(m.endpoint || '')}" placeholder="gpu://… 或 api://https://host/path 或 local://ffmpeg/free"></div>
      <div class="form-row">
        <div class="field"><label>并发限制</label><input class="input" id="emConcurrency" type="number" min="1" max="64" value="${m.concurrency || 1}"></div>
        <div class="field"><label>计费方式</label><select class="select" id="emBilling">
          <option value="free" ${m.is_free ? 'selected' : ''}>免费(不扣平台积分)</option>
          <option value="paid" ${m.is_free ? '' : 'selected'}>按积分消耗</option>
        </select>
          <div class="hint">「免费」只决定平台侧是否扣用户积分，与服务商是否收费无关</div></div>
        <div class="field" id="emQuotaField"${m.is_free ? '' : ' hidden'}><label>免费额度(可选)</label>
          <div class="ig-seed-row">
            <input class="input" id="emQuotaTotal" type="number" min="1" step="1" value="${esc(String((m.rules && m.rules.quota && m.rules.quota.total) || ''))}" placeholder="总量，留空 = 不登记">
            <select class="select" id="emQuotaUnit" style="max-width:92px">
              <option value="" ${!(m.rules && m.rules.quota && m.rules.quota.unit) ? 'selected' : ''}>自动</option>
              <option value="image" ${m.rules && m.rules.quota && m.rules.quota.unit === 'image' ? 'selected' : ''}>张</option>
              <option value="second" ${m.rules && m.rules.quota && m.rules.quota.unit === 'second' ? 'selected' : ''}>秒</option>
            </select>
          </div>
          <div class="hint">登记后模型下拉与后台会显示「剩 X/总量」；已用量按<b>平台内成功任务</b>统计(生图计张数、视频计秒数)，直连网关与控制台用量不计入</div></div>
        <div class="field"><label id="emCpsLabel">每秒积分消耗 <span class="hint" style="font-weight:400">(积分/秒)</span></label>
          <input class="input" id="emCps" type="number" min="0" step="0.5" value="${Number(m.credit_per_second) > 0 ? m.credit_per_second : ''}" placeholder="留空按全局定价">
          <div class="hint" id="emCpsHint">设置后该模型按 秒数×单价 向上取整，忽略全局段时长覆盖价；0/留空 = 全局定价；免费模型恒 0 分</div></div>
        <div class="field"><label>启用</label><select class="select" id="emEnabled">
          <option value="1" ${m.enabled ? 'selected' : ''}>启用</option>
          <option value="0" ${!m.enabled ? 'selected' : ''}>禁用</option>
        </select></div>
      </div>
      <div class="field"><label>描述</label><textarea class="textarea" id="emDesc" placeholder="选填">${esc(m.description || '')}</textarea></div>`;

    const q = s => body.querySelector(s);

    /* ---------- 第二十六/二十七/二十八轮：生图参数面板逻辑 ----------
       比例 + 分辨率档驱动，自定义尺寸作为「支持清单」提交时就近吸附 */
    const imgBox = q('#emImgBox');
    const RATIO_PRESETS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
    /* 比例清单双键回显:aspect_ratio 为准,兼容早期键名 ratio */
    const RATIO_DEF = (m.params_schema || []).find(d => d && (d.key === 'aspect_ratio' || d.key === 'ratio')
      && Array.isArray(d.options) && d.options.length);
    const RATIOS_ON = new Set(RATIO_DEF ? (RATIO_DEF.options || []).map(String)
      : ['1:1', '16:9', '9:16', '4:3', '3:4']);
    const applyRatioTags = () => {
      imgBox.querySelectorAll('.em-size-tag[data-ratio]').forEach(tag => {
        tag.classList.toggle('on', RATIOS_ON.has(tag.dataset.ratio));
      });
    };
    /* 事件委托：动态添加的自定义比例标签同样可点 */
    q('#emRatios').addEventListener('click', e => {
      const tag = e.target.closest('.em-size-tag[data-ratio]');
      if (!tag) return;
      const rt = tag.dataset.ratio;
      if (RATIOS_ON.has(rt)) RATIOS_ON.delete(rt); else RATIOS_ON.add(rt);
      applyRatioTags();
      updateSchemaHint();
    });
    /* 手动输入自定义比例(如 4:5 / 2.35:1) */
    const addCustomRatio = () => {
      const inp = q('#emRatioCustom');
      const raw = (inp.value || '').trim();
      const mm = /^([0-9]+(?:\.[0-9]+)?)\s*[:：/]\s*([0-9]+(?:\.[0-9]+)?)$/.exec(raw);
      if (!mm) { toast('比例格式应为 宽：高，如 4:5 或 2.35:1', 'err'); return; }
      const rt = parseFloat(mm[1]) + ':' + parseFloat(mm[2]);
      if (imgBox.querySelector('.em-size-tag[data-ratio="' + rt + '"]')) { toast('该比例已存在', 'err'); return; }
      const tag = document.createElement('span');
      tag.className = 'em-size-tag on';
      tag.dataset.ratio = rt;
      tag.textContent = rt;
      q('#emRatios').appendChild(tag);
      RATIOS_ON.add(rt);
      inp.value = '';
      updateSchemaHint();
    };
    q('#emRatioAdd').addEventListener('click', addCustomRatio);
    q('#emRatioCustom').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustomRatio(); } });
    const parseCustomSizes = () => {
      const raw = (q('#emSizeCustom').value || '').trim();
      if (!raw) return [];
      return [...new Set(raw.split(/[,，；\s]+/).map(sx => sx.trim()).filter(sx => /^[0-9]+x[0-9]+$/.test(sx) || sx === 'auto'))];
    };
    /* 分辨率档清单来自「支持的分辨率档」输入框(26·9:新网关只改后台,不改代码)。
       留空时优先跟随 rules.limits.resolutions(服务端吸附用的就是这份清单),
       都没有才回退 1K/2K/4K —— 此前留空一律塞三档,只支持单档的网关会被选出无效值 */
    const RULE_RES = (() => { const ls = m.rules && m.rules.limits && m.rules.limits.resolutions;
      return Array.isArray(ls) && ls.length ? ls.map(String) : null; })();
    const parseResTiers = () => {
      const raw = ((q('#emResTiers') || {}).value || '').trim();
      if (!raw) return (RULE_RES || RES_TIERS).slice();
      return [...new Set(raw.split(/[,，；\s]+/).map(s => s.trim()).filter(Boolean))];
    };
    const syncResTierSelect = () => {
      const sel = q('#emRes');
      if (!sel) return;
      const tiers = parseResTiers();
      const cur = sel.value || prevRes;
      sel.innerHTML = tiers.map(rs => '<option value="' + esc(rs) + '"'
        + (String(cur) === String(rs) ? ' selected' : '') + '>' + esc(resTierLabel(rs)) + '</option>').join('');
      if (!tiers.some(t => String(t) === String(sel.value))) sel.value = tiers[0];
    };
    const buildImageSchema = () => {
      /* 自定义比例排在前置预设之后，保持用户添加顺序 */
      const ratios = RATIO_PRESETS.filter(rt => RATIOS_ON.has(rt))
        .concat([...RATIOS_ON].filter(rt => !RATIO_PRESETS.includes(rt)));
      const res = q('#emRes').value;
      const tiers = parseResTiers();
      const schema = [];
      if (ratios.length) {
        schema.push({ key: 'aspect_ratio', label: '画幅比例', type: 'select', options: ratios, default: ratios[0] });
      }
      /* 分辨率档:生图页统一展示「画幅比例 + 分辨率」，提交时由服务端
         按模型规则换算(26·3:档位用 1K/2K/4K 叫法;26·9:清单由管理员填) */
      schema.push({ key: 'resolution', label: '分辨率', type: 'select',
        options: tiers, default: tiers.includes(res) ? res : tiers[0] });
      if (q('#emQuality').value) schema.push({ key: 'quality', label: '质量', type: 'select', options: ['standard', 'hd'], default: q('#emQuality').value });
      if (q('#emHasSeed').value === '1') schema.push({ key: 'seed', label: '随机种子(留空 = 随机，可点骰子刷新)', type: 'number', default: -1 });
      return schema;
    };
    const updateSchemaHint = () => {
      const out = q('#emSchemaOut');
      if (out) out.textContent = '参数模板预览： ' + JSON.stringify(buildImageSchema());
    };
    ['emRes', 'emQuality', 'emHasSeed'].forEach(fid => { const elx = q('#' + fid); if (elx) elx.addEventListener('change', updateSchemaHint); });
    /* 档位清单一改:默认档下拉与参数模板预览同步重算 */
    const resTiersInp = q('#emResTiers');
    if (resTiersInp) {
      syncResTierSelect();
      resTiersInp.addEventListener('input', () => { syncResTierSelect(); updateSchemaHint(); });
    }
    q('#emSizeCustom').addEventListener('input', updateSchemaHint);
    /* 规则模板一键填入(26·9):只覆盖 create / limits / caps 的相关部分,
       管理员已写的其它键原样保留 */
    const applyRulesTpl = tpl => {
      const ta = q('#emRules');
      if (!ta) return;
      let cur = {};
      if (ta.value.trim()) { try { cur = JSON.parse(ta.value); } catch (e) { cur = {}; } }
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
      cur.protocol = cur.protocol || tpl.protocol;
      cur.create = Object.assign({}, cur.create || {}, tpl.create);
      cur.limits = Object.assign({}, cur.limits || {}, tpl.limits || {});
      if (!Array.isArray(cur.caps)) cur.caps = tpl.caps;
      ta.value = JSON.stringify(cur, null, 2);
      toast('模板已填入，保存后该模型即按此形态请求网关', 'ok');
      updateSchemaHint();
    };
    const TIER_TPL = {
      protocol: 'openai-image',
      caps: ['text-to-image', 'image-to-image', 'multi-image'],
      create: {
        path: '/images/generations', edit: 'json', images_field: 'image',
        body: { model: '<model_id>', prompt: '<prompt>', n: '<n>', size: '<resolution>', ratio: '<ratio>' }
      },
      limits: {
        max_count: 1, resolutions: ['1K', '2K', '4K'],
        aspect_ratios: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']
      }
    };
    const PIXEL_TPL = {
      protocol: 'openai-image',
      create: {
        path: '/images/generations', edit: 'multipart', edit_path: '/images/edits', images_field: 'image',
        body: { model: '<model_id>', prompt: '<prompt>', n: '<n>', size: '<size>' }
      },
      limits: { max_count: 4, sizes: ['1024x1024', '1536x1024', '1024x1536'] }
    };
    const tierBtn = q('#emTplTier'), pixelBtn = q('#emTplPixel');
    if (tierBtn) tierBtn.addEventListener('click', () => applyRulesTpl(TIER_TPL));
    if (pixelBtn) pixelBtn.addEventListener('click', () => applyRulesTpl(PIXEL_TPL));
    /* 类型切换 → 显示/隐藏生图参数面板 + 积分字段文案 */
    const syncCpsLabel = () => {
      const isImg = q('#emType').value === 'text-to-image';
      const free = q('#emBilling').value === 'free';
      const lbl = q('#emCpsLabel');
      if (lbl) lbl.textContent = isImg ? '积分消耗(每张)' : '每秒积分消耗';
      const hint = q('#emCpsHint');
      if (hint) hint.textContent = (isImg
        ? '生图按「张数 × 单价」扣分；0/留空 = 用全局「AI 生图每张积分」定价'
        : '设置后该模型按 秒数×单价 向上取整，忽略全局段时长覆盖价；0/留空 = 全局定价')
        + (free ? '(当前计费方式为免费，此价不生效)' : '');
    };
    /* 计费方式(第四十轮):免费 ⇄ 按积分;免费时才显示额度登记,并按积分输入禁用 */
    const syncBilling = () => {
      const free = q('#emBilling').value === 'free';
      const qf = q('#emQuotaField');
      if (qf) qf.hidden = !free;
      const cps = q('#emCps');
      if (cps) cps.disabled = free;
      syncCpsLabel();
    };
    q('#emType').addEventListener('change', () => { imgBox.hidden = q('#emType').value !== 'text-to-image'; syncCpsLabel(); });
    q('#emBilling').addEventListener('change', syncBilling);
    applyRatioTags();
    syncCpsLabel();
    syncBilling();
    updateSchemaHint();

    const detectBtn = q('#emDetectBtn'), msg = q('#emDetectMsg');
    const canDetect = () => !!q('#emApiBase').value.trim() && (!!q('#emApiKey').value.trim() || !!m.has_api_key);
    const refreshDetect = () => {
      detectBtn.disabled = !canDetect();
      if (!canDetect()) msg.textContent = '填写 API 地址与 Key 后可检测';
    };
    ['input', 'change'].forEach(ev => {
      q('#emApiBase').addEventListener(ev, refreshDetect);
      q('#emApiKey').addEventListener(ev, refreshDetect);
    });
    q('#emKeyEye').addEventListener('click', () => {
      const inp = q('#emApiKey');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    detectBtn.addEventListener('click', async () => {
      const apiBase = q('#emApiBase').value.trim();
      const keyVal = q('#emApiKey').value.trim();
      if (!apiBase) return toast('请先填写 API 地址', 'err');
      if (!keyVal && !m.has_api_key) return toast('请先填写 API Key', 'err');
      detectBtn.disabled = true;
      msg.textContent = '正在请求可用模型列表…';
      msg.style.color = '';
      try {
        const payload = { api_base: apiBase };
        if (keyVal) payload.api_key = keyVal;
        else if (id && m.has_api_key) { payload.use_saved_key = true; payload.id = id; } // 复用已保存 Key
        const res = await API.post('/admin/models/detect', payload);
        body.querySelector('#' + uid4 + '-list').innerHTML =
          res.items.map(x => `<option value="${esc(x)}"></option>`).join('');
        msg.innerHTML = `${icon('circle-check', 'ico-xs')} 检测到 <b>${res.count}</b> 个可用模型，点击「模型 ID」输入框即可下拉选择`;
        msg.style.color = 'var(--ok)';
        toast(res.message, 'ok');
      } catch (e) {
        msg.textContent = e.message;
        msg.style.color = 'var(--danger)';
      }
      refreshDetect();
    });
    refreshDetect();

    const saveBtn = el(`<button class="btn btn-primary">${iconText(id ? 'save' : 'plus', id ? '保存' : '创建')}</button>`);
    const cancelBtn = el('<button class="btn">取消</button>');
    const modal = openModal({ title: `${icon('brain-circuit', 'ico-sm')} ${id ? '编辑模型' : '新建模型'}`, size: 'modal-lg', body, footer: [cancelBtn, saveBtn] });
    cancelBtn.addEventListener('click', () => modal.close());
    saveBtn.addEventListener('click', async () => {
      const name = q('#emName').value.trim();
      if (!name) return toast('模型名称不能为空', 'err');
      const reqBody = {
        name,
        type: q('#emType').value,
        version: q('#emVersion').value.trim() || 'v1',
        endpoint: q('#emEndpoint').value.trim(),
        description: q('#emDesc').value.slice(0, 500),
        concurrency: Number(q('#emConcurrency').value) || 1,
        enabled: q('#emEnabled').value === '1',
        is_free: q('#emBilling').value === 'free',
        api_base: q('#emApiBase').value.trim(),
        model_id: q('#emModelId').value.trim(),
        credit_per_second: Math.max(0, Number(q('#emCps').value) || 0),
        params_schema: m.params_schema || []
      };
      /* 第二十六轮：生图模型 — 能力勾选 + 参数模板(比例/分辨率/质量/种子)+ 张数上限 */
      const isImageModel = q('#emType').value === 'text-to-image';
      let customSizes = [];
      if (isImageModel) {
        const caps = [];
        if (q('#emCapT2I').checked) caps.push('text-to-image');
        if (q('#emCapI2I').checked) caps.push('image-to-image');
        if (q('#emCapMulti').checked) caps.push('multi-image');
        if (!caps.length) { toast('请至少勾选一项模型能力(文生图 / 图生图 / 多图合成)', 'err'); return; }
        reqBody.caps = caps;
        reqBody.params_schema = buildImageSchema();
        reqBody.max_count = Number(q('#emMaxCount').value) || 4;
        customSizes = parseCustomSizes();
      }
      /* 生成规则：协议 + 规则 JSON */
      const emProtocol = q('#emProtocol').value;
      const emRulesRaw = q('#emRules').value.trim();
      let rulesObj = {};
      if (emProtocol) rulesObj.protocol = emProtocol;
      if (emRulesRaw) { try { const parsed = JSON.parse(emRulesRaw); Object.assign(rulesObj, parsed); } catch (e) { toast('生成规则 JSON 解析失败：' + e.message, 'err'); saveBtn.disabled = false; return; } }
      /* 固定尺寸清单(生图 API 仅支持特定尺寸时):写入 limits.sizes,提交时就近吸附 */
      if (isImageModel && customSizes.length) {
        rulesObj.limits = Object.assign({}, rulesObj.limits, { sizes: customSizes });
      }
      /* 第四十轮:把界面上勾的「分辨率档 / 画幅比例」同步进 limits —— 服务端吸附清单与
         生图页下拉清单必须同源,否则用户能选出一个被服务端悄悄改掉的值 */
      if (isImageModel) {
        const tiers = parseResTiers();
        const ratiosOn = [...RATIOS_ON];
        if (tiers.length) rulesObj.limits = Object.assign({}, rulesObj.limits, { resolutions: tiers });
        if (ratiosOn.length) rulesObj.limits = Object.assign({}, rulesObj.limits, { aspect_ratios: ratiosOn });
      }
      /* 免费额度登记:写 rules.quota;清空 = 取消登记(界面回到只显示「免费」) */
      const qTotal = Math.floor(Number((q('#emQuotaTotal') || {}).value));
      const qUnit = (q('#emQuotaUnit') || {}).value || '';
      if (reqBody.is_free && Number.isFinite(qTotal) && qTotal > 0) {
        rulesObj.quota = qUnit ? { total: qTotal, unit: qUnit } : { total: qTotal };
      } else {
        delete rulesObj.quota;
      }
      if (Object.keys(rulesObj).length) reqBody.rules = rulesObj;
      const keyVal = q('#emApiKey').value.trim();
      if (keyVal) reqBody.api_key = keyVal; // 留空 = 保持原 Key
      saveBtn.disabled = true;
      try {
        let modelId = id;
        if (id) await API.patch('/admin/models/' + id, reqBody);
        else modelId = (await API.post('/admin/models', reqBody)).model.id;
        toast('已保存，正在自动检查模型有效性…', 'ok');
        modal.close();
        const res = await API.get('/styles/models');
        this.models = res.items;
        this.renderModels(this.root.querySelector('#adminBody'), true);
        await this.checkModel(modelId);
      } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; }
    });
  },

  /* ---------- 积分审批 ---------- */
  async renderCreditRequests(body) {
    let items, pricing;
    try {
      const res = await API.get('/admin/credit-requests?status=all');
      items = res.items; pricing = res.pricing;
    } catch (e) { body.innerHTML = `<div class="empty"><h3>${esc(e.message)}</h3></div>`; return; }
    const pending = items.filter(x => x.status === 'pending').length;
    body.innerHTML = `
    <div class="stat-cards" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-value">${pending}</div><div class="stat-label">待审批申请</div></div>
      <div class="stat-card"><div class="stat-value">${items.filter(x => x.status === 'approved').length}</div><div class="stat-label">已批准</div></div>
      <div class="stat-card"><div class="stat-value">${pricing.perSecond}</div><div class="stat-label">默认单价(积分/秒)</div></div>
      <div class="stat-card"><div class="stat-value">${Object.keys(pricing.overrides || {}).length}</div><div class="stat-label">段时长覆盖价条目</div></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table class="table">
      <thead><tr><th>用户</th><th>数量</th><th>用途</th><th>状态</th><th>申请时间</th><th>处理</th></tr></thead>
      <tbody>${items.length ? items.map(cr => `
        <tr>
          <td><b>${esc(cr.user_name)}</b><br><span style="font-size:11px;color:var(--ink-3)">${esc(cr.user_email)}</span></td>
          <td style="font-family:var(--mono);font-weight:800;color:var(--ok)">+${cr.amount}</td>
          <td class="muted">${esc(cr.reason || '—')}</td>
          <td><span class="status status-${cr.status === 'approved' ? 'completed' : cr.status === 'rejected' ? 'failed' : 'queued'}">${cr.status === 'approved' ? '已批准' : cr.status === 'rejected' ? '已驳回' : '待审批'}</span></td>
          <td class="muted">${fmtTime(cr.created_at)}</td>
          <td><div class="table-ops">${cr.status === 'pending' ? `
            <button class="btn btn-xs btn-primary" data-cr-approve="${cr.id}">批准</button>
            <button class="btn btn-xs btn-danger" data-cr-reject="${cr.id}">驳回</button>`
            : `<span class="muted">${cr.handled_at ? fmtTime(cr.handled_at) : '—'}</span>`}</div></td>
        </tr>`).join('') : '<tr><td class="td-empty" colspan="6">暂无申请记录</td></tr>'}
      </tbody></table></div>`;
    body.querySelectorAll('[data-cr-approve]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/credit-requests/' + b.dataset.crApprove + '/approve'); toast('已批准，积分到账', 'ok'); this.renderCreditRequests(body); }
      catch (e) { toast(e.message, 'err'); }
    }));
    body.querySelectorAll('[data-cr-reject]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/credit-requests/' + b.dataset.crReject + '/reject'); toast('已驳回', 'ok'); this.renderCreditRequests(body); }
      catch (e) { toast(e.message, 'err'); }
    }));
  },

  /* ---------- 任务监控 ---------- */
  /* 旧实现在 3s 轮询里重建整张表(最多 200 行)：一个任务进度跳一下就让全部行重画、
     搜索框失焦，且统计卡显示的是「最近 200 条里已完成多少」而不是全量。
     现在拆成「静态筛选外壳 + 可重绘数据区」，数据区每次最多渲染 30 行，按需「显示更多」 */
  renderTasks(body) {
    const st = this.state.task;
    this._tkRendered = false;
    this._tasksSig = '';
    const chips = [
      { v: 'all', t: '全部' },
      { v: 'queued', t: '排队中' },
      { v: 'processing', t: '执行中' },
      { v: 'completed', t: '已完成' },
      { v: 'failed', t: '失败' },
      { v: 'cancelled', t: '已取消' }
    ];
    body.innerHTML = `
    <div class="filters">
      ${chips.map(c => `<span class="cat-chip${c.v === st.status ? ' on' : ''}" data-tk-status="${c.v}">${c.t}<b class="chip-n" data-cn="${c.v}"></b></span>`).join('')}
      <span class="filters-divider"></span>
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="tkSearch" placeholder="搜索任务 ID / 用户 / 模型 / 提示词…" value="${esc(st.q)}"></div>
      <div class="grow"></div>
      <span class="alib-count" id="tkMeta">正在读取…</span>
    </div>
    <div id="tkData"><div class="loading-wrap"><span class="spinner"></span></div></div>`;

    body.querySelectorAll('[data-tk-status]').forEach(c => c.addEventListener('click', () => {
      if (st.status === c.dataset.tkStatus) return;
      st.status = c.dataset.tkStatus; st.limit = ROW_STEP;
      body.querySelectorAll('[data-tk-status]').forEach(x => x.classList.toggle('on', x === c));
      this._tasksSig = '';
      this.renderTaskData();
    }));
    const si = body.querySelector('#tkSearch');
    si.addEventListener('input', () => {
      clearTimeout(this._tkTimer);
      this._tkTimer = setTimeout(() => {
        if (!si.isConnected) return;
        st.q = si.value.trim(); st.limit = ROW_STEP;
        this._tasksSig = '';
        this.renderTaskData();
      }, 280);
    });
    this.renderTaskData();
  },

  /* 只重绘数据区：筛选栏留在外面，轮询不会打断正在输入搜索框的管理员 */
  async renderTaskData() {
    const box = this.root && this.root.querySelector('#tkData');
    if (!box) return;
    const st = this.state.task;
    /* 连点筛选 chips 时多个请求并行，后到的旧响应会覆盖新结果 —— 只认最后一次 */
    const seq = this._tkSeq = (this._tkSeq || 0) + 1;
    let res;
    try {
      res = await API.get('/admin/tasks?status=' + encodeURIComponent(st.status) + '&q=' + encodeURIComponent(st.q));
    } catch (e) {
      if (seq !== this._tkSeq) return;
      box.innerHTML = `<div class="empty"><div class="empty-ico">${icon('cloud-off')}</div><h3>任务列表加载失败</h3><p class="muted">${esc(e.message)}</p></div>`;
      return;
    }
    if (seq !== this._tkSeq) return;
    const items = res.items || [];
    this._adminTasks = items;
    const counts = res.counts || {};
    const n = k => counts[k] || 0;
    const meta = this.root.querySelector('#tkMeta');
    if (meta) {
      meta.innerHTML = `共 <b class="gold-num">${res.total}</b> 条 · 已取最近 ${items.length} 条`
        + (res.total > items.length ? '(列表上限 200)' : '') + ' · 每 3s 自动刷新';
    }
    this.root.querySelectorAll('[data-cn]').forEach(el0 => {
      const k = el0.dataset.cn;
      const v = k === 'all' ? res.total : n(k);
      el0.textContent = v ? String(v) : '';
    });
    const sig = st.limit + '#' + res.total + '#' + res.running + '#'
      + items.map(t => t.id + ':' + t.status + ':' + t.progress + ':' + (t.cost || 0) + ':' + (t.next_at || 0)).join('|');
    if (sig === this._tasksSig) return;
    const silent = this._tkRendered;
    this._tkRendered = true;
    this._tasksSig = sig;

    const shown = items.slice(0, st.limit);
    box.classList.toggle('silent-render', silent);
    box.innerHTML = `
    <div class="stat-cards" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-value">${res.running}</div><div class="stat-label">正在执行</div></div>
      <div class="stat-card"><div class="stat-value">${n('queued') + n('processing')}</div><div class="stat-label">排队中 / 执行中</div></div>
      <div class="stat-card"><div class="stat-value">${n('completed')}</div><div class="stat-label">已完成</div></div>
      <div class="stat-card"><div class="stat-value">${n('failed')}</div><div class="stat-label">失败</div></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table class="table">
      <thead><tr><th>任务</th><th>用户</th><th>模型</th><th>参数</th><th>提示词</th><th>状态</th><th>进度</th><th>积分</th><th>耗时</th><th>提交时间</th><th>操作</th></tr></thead>
      <tbody>${shown.map(t => `
        <tr>
          <td class="num muted">${esc(t.id.slice(0, 10))}</td>
          <td>${esc(t.user_name || t.user_email)}</td>
          <td class="muted">${t.model_name ? esc(t.model_name) : (t.model_id ? '<span class="tag">' + esc(t.model_id) + '</span>' : '—')}</td>
          <td class="muted">${taskParamsText(t)}</td>
          <td><button class="btn-link task-prompt-btn" data-prompt="${t.id}" title="点击查看完整提示词">${t.prompt ? esc(String(t.prompt).slice(0, 16)) + '…' : '无提示词'}</button></td>
          <td>${statusBadge(t.status)}${busyWaitSec(t) > 0 ? '<div class="muted" style="font-size:11px">网关排队已满</div>' : ''}</td>
          <td style="min-width:96px">${['queued', 'processing'].includes(t.status) ? `<div class="progress"><div class="progress-fill" style="width:${t.progress}%"></div></div><span class="muted"${busyWaitSec(t) > 0 ? ` data-wait-until="${t.next_at}" data-wait-suffix="s 后重投 · 第 ${((t.params || {}).busy_attempts || 0)} 次"` : ''}>${busyWaitSec(t) > 0 ? busyWaitSec(t) + 's 后重投 · 第 ' + ((t.params || {}).busy_attempts || 0) + ' 次' : t.progress + '%'}</span>` : '—'}</td>
          <td class="num muted">${t.cost > 0 ? '-' + t.cost + (t.refunded ? '(退)' : '') : '<span class="free-badge">免费</span>'}</td>
          <td>${t.duration_ms ? Math.round(t.duration_ms / 1000) + 's' : '—'}</td>
          <td class="muted">${fmtTime(t.created_at)}</td>
          <td>${['queued', 'processing'].includes(t.status) ? `<button class="btn btn-xs btn-danger" data-cancel="${t.id}">取消</button>` : ''}
              ${['failed', 'cancelled'].includes(t.status) ? `<button class="btn btn-xs" data-retry="${t.id}">重试</button>` : ''}</td>
        </tr>`).join('')
        || `<tr><td class="td-empty" colspan="11">${st.q ? '没有匹配「' + esc(st.q) + '」的任务' : '暂无该状态的任务'}</td></tr>`}
      </tbody></table>
      ${items.length > shown.length ? `<div class="table-more"><button class="btn btn-sm" id="tkMore">显示更多（还有 ${items.length - shown.length} 条）</button></div>` : ''}
    </div>`;
    const q = sel => box.querySelector(sel);
    const more = q('#tkMore');
    if (more) more.addEventListener('click', () => { st.limit += ROW_STEP; this._tasksSig = ''; this.renderTaskData(); });
    box.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/tasks/' + b.dataset.cancel + '/cancel'); toast('已取消(积分将退还)', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      this._tasksSig = ''; this.renderTaskData();
    }));
    box.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/tasks/' + b.dataset.retry + '/retry'); toast('已重试', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      this._tasksSig = ''; this.renderTaskData();
    }));
    box.querySelectorAll('.task-prompt-btn').forEach(b => b.addEventListener('click', () => this.viewTaskPrompt(b.dataset.prompt)));
    ensureWaitCountdown(this._waitCd || (this._waitCd = {}), box);
  },

  viewTaskPrompt(id) {
    const t = (this._adminTasks || []).find(x => x.id === id);
    if (!t) return toast('任务数据未找到', 'err');
    const params = t.params || {};
    const paramRows = Object.keys(params).length
      ? Object.entries(params).map(([k, v]) => `<div class="preview-info-row"><span>${esc(k)}</span><span>${esc(String(v))}</span></div>`).join('')
      : '<div class="hint">无参数</div>';
    const modelName = t.model_name || t.model_id || '—';
    const errHtml = t.error ? `<div class="field"><label>错误信息</label><div style="color:var(--danger);font-size:12px">${esc(t.error)}</div></div>` : '';
    const costHtml = t.cost > 0
      ? `<span style="color:var(--ok);font-family:var(--mono)">${t.cost} 积分</span>${t.refunded ? ' <span class="tag">已退还</span>' : ''}`
      : '<span class="free-badge">免费</span>';
    openModal({
      title: `任务提示词 · ${esc(t.id.slice(0, 10))}`,
      size: 'modal-lg',
      body: `
        <div class="field"><label>提示词</label><div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${esc(t.prompt || '(空)')}</div></div>
        <div class="field"><label>负向提示词</label><div style="font-size:12px;color:var(--ink-2);white-space:pre-wrap;word-break:break-word">${esc(t.negative_prompt || '(空)')}</div></div>
        <div class="form-row">
          <div class="field"><label>模型</label><div>${esc(modelName)}</div></div>
          <div class="field"><label>状态</label><div>${statusBadge(t.status)}</div></div>
          <div class="field"><label>积分</label><div>${costHtml}</div></div>
          <div class="field"><label>耗时</label><div>${t.duration_ms ? Math.round(t.duration_ms / 1000) + 's' : '—'}</div></div>
        </div>
        <div class="field"><label>任务参数</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">${paramRows}</div>
        </div>
        ${errHtml}
        <div class="field"><label>任务 ID</label><div style="font-family:var(--mono);font-size:11px;color:var(--ink-3)">${esc(t.id)}</div></div>
        <div class="field"><label>提交时间</label><div style="font-size:11px;color:var(--ink-3)">${fmtTime(t.created_at)}</div></div>
      `
    });
  },

  /* ---------- 用户管理 ---------- */
  async renderUsers(body) {
    const [res, creditsRes] = await Promise.all([
      API.get('/admin/users'),
      API.get('/admin/credit-requests?status=all').catch(() => ({ items: [] }))
    ]);
    const users = res.items;
    const reqByUser = {};
    for (const cr of creditsRes.items || []) {
      if (cr.status === 'pending') reqByUser[cr.user_id] = (reqByUser[cr.user_id] || 0) + 1;
    }
    const balances = {};
    body.innerHTML = `
    <div class="card" style="padding:0;overflow-x:auto"><table class="table">
      <thead><tr><th>用户</th><th>角色</th><th>存储用量</th><th>配额</th><th>积分</th><th>状态</th><th>注册时间</th><th>操作</th></tr></thead>
      <tbody>${users.map(u => `
        <tr>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:12px">${avatar(u.name)}</div><div><b>${esc(u.name)}</b><br><span style="font-size:11px;color:var(--ink-3)">${esc(u.email)}</span></div></div></td>
          <td>${u.role === 'admin' ? '<span class="tag">管理员</span>' : '<span class="tag" style="background:rgba(var(--film), .06);color:var(--ink-2)">用户</span>'}</td>
          <td>${fmtBytes(u.storage_used)}</td>
          <td>${fmtBytes(u.storage_quota)}</td>
          <td><b style="font-family:var(--mono);color:var(--ok)" data-bal-row="${u.id}">${u.credits != null ? u.credits : '—'}</b>${reqByUser[u.id] ? ` <span class="cc-pending" title="待审批申请">${reqByUser[u.id]}</span>` : ''}</td>
          <td>${u.banned ? '<span class="status status-failed">已封禁</span>' : '<span class="status status-completed">正常</span>'}</td>
          <td class="muted">${fmtTime(u.created_at)}</td>
          <td><div class="table-ops">
            ${u.id !== App.user.id ? `<button class="btn btn-xs" data-setquota="${u.id}">配额</button>
            <button class="btn btn-xs" data-setcredits="${u.id}">调分</button>
            <button class="btn btn-xs ${u.role === 'admin' ? '' : 'btn-primary'}" data-role="${u.id}">${u.role === 'admin' ? '取消管理员' : '设为管理员'}</button>
            <button class="btn btn-xs ${u.banned ? '' : 'btn-danger'}" data-ban="${u.id}">${u.banned ? '解封' : '封禁'}</button>` : '<span class="muted">当前账号</span>'}
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>`;

    body.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.ban);
      if (await confirmDlg(u.banned ? '确认解封 ' + u.email + '?' : '确认封禁 ' + u.email + '?该用户将无法登录。')) {
        await API.patch('/admin/users/' + u.id, { banned: !u.banned });
        toast('已更新', 'ok');
        this.renderUsers(body);
      }
    }));
    body.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.role);
      await API.patch('/admin/users/' + u.id, { role: u.role === 'admin' ? 'user' : 'admin' });
      toast('角色已更新', 'ok');
      this.renderUsers(body);
    }));
    body.querySelectorAll('[data-setquota]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.setquota);
      await formModal({
        title: '设置配额',
        fields: [{ key: 'quota', label: '存储配额 (GB)', type: 'number', value: Math.round(u.storage_quota / 1024 ** 3) }],
        submitText: '保存',
        onSubmit: async (vals) => {
          await API.patch('/admin/users/' + u.id, { storage_quota: Number(vals.quota) * 1024 ** 3 });
          toast('配额已更新', 'ok');
          this.renderUsers(body);
        }
      });
    }));
    body.querySelectorAll('[data-setcredits]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.setcredits);
      await formModal({
        title: `调整积分 · ${u.name}`,
        fields: [
          { key: 'delta', label: '变动数量(正数发放 / 负数扣减)', type: 'number', value: 100 },
          { key: 'reason', label: '备注', value: '', placeholder: '如： 活动奖励' }
        ],
        submitText: '确认调整',
        onSubmit: async (vals) => {
          await API.post('/admin/users/' + u.id + '/credits', { delta: Number(vals.delta), reason: vals.reason });
          toast('积分已调整', 'ok');
          this.renderUsers(body);
        }
      });
    }));
  },

  /* ---------- 系统设置(含积分定价) ---------- */
  async renderSettings(body) {
    const [res, creditsRes, textModelsRes] = await Promise.all([
      API.get('/admin/settings'),
      API.get('/admin/credit-requests?status=all'),
      /* 第四十二轮:文本处理模型清单(默认模型下拉的唯一依据) */
      API.get('/text/models').catch(() => ({ items: [] }))
    ]);
    const s = res.settings;
    const pricing = creditsRes.pricing || { perSecond: 5, overrides: {} };
    const TIERS = [2, 3, 5, 8, 10];
    body.innerHTML = `
    <div class="setting-grid">
      <div class="card">
        <div class="card-title">${icon('sliders-horizontal', 'ico-sm')} 系统设置</div>
        <div class="field"><label>最大并发任务数</label><input class="input" id="setConcurrency" type="number" min="1" max="64" value="${s.maxConcurrentTasks || 2}"></div>
        <div class="field"><label>新用户默认配额 (GB)</label><input class="input" id="setQuota" type="number" min="1" value="${s.defaultQuotaGB || 5}"></div>
        <div class="field"><label>单文件上传上限 (MB)</label><input class="input" id="setUpload" type="number" min="1" value="${s.maxUploadMB || 2048}"></div>
        <div class="field"><label>GPU 资源池配置</label><textarea class="textarea" id="setGpu">${esc(s.gpuPool || '')}</textarea></div>
        <button class="btn btn-primary" id="saveSettings">保存设置</button>
      </div>

      <div class="card">
        <div class="card-title">${icon('coins', 'ico-sm')} 积分定价 <span class="hint">每个段时长的积分数</span></div>
        <div class="field"><label>默认单价(积分 / 秒)</label><input class="input" id="setPerSecond" type="number" min="0" step="0.5" value="${pricing.perSecond}">
          <div class="hint">未配置覆盖价的时长按 秒数×单价 向上取整；免费模型恒为 0 分</div></div>
        <div class="field"><label>AI 生图单价(积分 / 张)</label><input class="input" id="setPerImage" type="number" min="0" step="0.5" value="${s.creditPerImage ?? 2}">
          <div class="hint">生图按张计价：张数 × 单价；免费生图模型恒为 0 分</div></div>
        <div class="field"><label>文本处理单价(积分 / 次)</label><input class="input" id="setPerText" type="number" min="0" step="0.5" value="${s.creditPerText ?? 1}">
          <div class="hint">剧本润色 / 拆分镜等按次计价；免费文本模型恒为 0 分</div></div>
        <div class="field"><label>默认文本处理模型</label>
          <select class="select" id="setDefaultText">
            <option value="">自动(按列表顺序取第一个启用的文本模型)</option>
            ${(textModelsRes.items || []).map(tm => `<option value="${esc(tm.id)}" ${String(s.defaultTextModel || '') === String(tm.id) ? 'selected' : ''}>${esc(tm.name)}${tm.is_free ? '（免费）' : '（' + tm.price_per_call + ' 分/次）'}</option>`).join('')}
          </select>
          <div class="hint">${(textModelsRes.items || []).length ? '分镜与剧本的 AI 按钮默认用这个模型；没有启用中的文本模型时按钮会提示去后台添加。' : '⚠ 当前没有可用的文本模型：请到「模型管理」添加，类型选「文本处理」。'}</div></div>
        <div class="field"><label>注册赠送积分</label><input class="input" id="setFreeCredits" type="number" min="0" value="${s.freeCredits ?? 100}"></div>
        <div class="field"><label>常用段时长定价</label>
          <div>
            ${TIERS.map(d => `<div class="tier-row">
              <span>每段 ${d}s</span>
              <input class="input" type="number" min="0" data-tier="${d}" value="${pricing.overrides && pricing.overrides[String(d)] !== undefined ? pricing.overrides[String(d)] : ''}" placeholder="留空按秒计价">
              <span class="hint">积分</span>
            </div>`).join('')}
          </div></div>
        <button class="btn btn-primary" id="savePricing">保存定价</button>
      </div>

      <div class="card">
        <div class="card-title">${icon('scan', 'ico-sm')} 生成视频尺寸 <span class="hint">分镜工作台的分辨率选项(480p/720p/960p/2k)</span></div>
        <div class="field"><label>可用尺寸(至少勾选一项)</label>
          <div>
            ${(['480p', '720p', '960p', '2k']).map(v => `<label class="check-row">
              <input type="checkbox" data-vres="${v}"
                ${(Array.isArray(s.videoResolutions) && s.videoResolutions.length ? s.videoResolutions : ['480p', '720p', '960p', '2k']).includes(v) ? 'checked' : ''}>
              <span class="mono">${v === '2k' ? '2K' : v.toUpperCase()}</span>
              <span class="hint">${({ '480p': '标清 · 省积分，预览草稿', '720p': '高清 · 通用推荐', '960p': '准高清 · 兼顾清晰与速度', '2k': '2K 超清 · 成品出片' })[v]}</span>
            </label>`).join('')}
          </div>
          <div class="hint">保存后，分镜创作页的「分辨率」下拉只显示勾选的尺寸；提交任务的分辨率会按此白名单校验</div></div>
        <button class="btn btn-primary" id="saveResolutions">保存尺寸设置</button>
      </div>
    </div>`;
    body.querySelector('#saveSettings').addEventListener('click', () => this.saveWithBusy(body.querySelector('#saveSettings'), () => API.patch('/admin/settings', {
      maxConcurrentTasks: Number(body.querySelector('#setConcurrency').value),
      defaultQuotaGB: Number(body.querySelector('#setQuota').value),
      maxUploadMB: Number(body.querySelector('#setUpload').value),
      gpuPool: body.querySelector('#setGpu').value
    }), '设置已保存'));
    body.querySelector('#savePricing').addEventListener('click', () => {
      const overrides = {};
      body.querySelectorAll('[data-tier]').forEach(inp => { if (inp.value !== '') overrides[inp.dataset.tier] = inp.value; });
      return this.saveWithBusy(body.querySelector('#savePricing'), () => API.patch('/admin/settings', {
        creditPerSecond: Number(body.querySelector('#setPerSecond').value),
        creditPerImage: Number(body.querySelector('#setPerImage').value),
        creditPerText: Number(body.querySelector('#setPerText').value),
        defaultTextModel: body.querySelector('#setDefaultText').value,
        freeCredits: Number(body.querySelector('#setFreeCredits').value),
        creditOverrides: overrides
      }), '积分定价已保存，新任务立即生效');
    });
    body.querySelector('#saveResolutions').addEventListener('click', () => {
      const list = [...body.querySelectorAll('[data-vres]:checked')].map(x => x.dataset.vres);
      if (!list.length) return toast('至少勾选一个生成尺寸', 'err');
      return this.saveWithBusy(body.querySelector('#saveResolutions'),
        () => API.patch('/admin/settings', { videoResolutions: list }), '生成尺寸已保存，分镜创作页即时生效');
    });
  },
  /* 统一的「保存」按钮行为:请求期间禁用 + 文案提示,失败弹错并恢复 —— 三个设置卡共用 */
  async saveWithBusy(btn, fn, okMsg) {
    if (!btn || btn.disabled) return;
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = '保存中…';
    try { await fn(); toast(okMsg, 'ok'); }
    catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; btn.innerHTML = label; }
  },
  /* ---------- 主题管理：导入 / 导出 / 应用 / 删除 (含外部主题包上传) ---------- */
  async renderThemes(body) {
    const res = await API.get('/admin/themes');
    const themes = res.themes || [];
    const active = res.active || 'black-gold';
    const activeTheme = themes.find(t => t.id === active) || { id: 'black-gold', name: '黑金设计系统', colors: { accent: '#ffcf4d', accent2: '#3ddc84', bg: '#000000', text: '#ffffff' } };
    const sw = (color, title) => `<span class="tm-swatch" style="background:${color}" title="${esc(title || color)}"></span>`;
    body.innerHTML = `
    <div class="tm-wrap">
      <div class="tm-header">
        <div class="tm-header-title">
          <div class="hdr-title">${icon('palette', 'ico')} 主题管理</div>
          <div class="hdr-sub">管理本站皮肤：导出当前样式布局、导入新主题、上传外部主题包、一键切换</div>
        </div>
        <div class="tm-active-chip">
          <span class="tm-active-label">当前使用</span>
          <span class="tm-active-name">${esc(activeTheme.name)}</span>
          <div class="tm-swatches">
            ${sw(activeTheme.colors.accent, '主色 ' + activeTheme.colors.accent)}
            ${sw(activeTheme.colors.accent2, '辅助色 ' + activeTheme.colors.accent2)}
            ${sw(activeTheme.colors.bg, '背景 ' + activeTheme.colors.bg)}
          </div>
        </div>
      </div>
      <div class="tm-grid2">
        <div class="card tm-card">
          <div class="card-title">${icon('download', 'ico-sm')} 导出当前主题</div>
          <div class="tm-field-row">
            <div class="field"><label>主题 ID</label><input class="input" id="expThemeId" placeholder="my-theme"></div>
            <div class="field"><label>主题名称</label><input class="input" id="expThemeName" placeholder="新主题名称"></div>
          </div>
          <div class="field"><label>描述</label><input class="input" id="expThemeDesc" placeholder="简短描述这个主题"></div>
          <button class="btn btn-primary" id="btnExportTheme">${icon('download', 'ico-sm')} 导出主题</button>
        </div>
        <div class="card tm-card">
          <div class="card-title">${icon('upload', 'ico-sm')} 导入主题</div>
          <div class="tm-field-row">
            <div class="field"><label>主题 ID</label><input class="input" id="impThemeId" placeholder="my-theme"></div>
            <div class="field"><label>主题名称</label><input class="input" id="impThemeName" placeholder="新主题"></div>
          </div>
          <div class="field"><label>基础主题</label>
            <select class="select" id="impBaseTheme">${themes.map(t => `<option value="${esc(t.id)}"${t.id === active ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
          </div>
          <div class="tm-pickers">
            <div class="tm-pick"><label>主色</label><input type="color" id="impAccent" value="#ffcf4d"><span class="tm-hex" id="impAccentHex">#ffcf4d</span></div>
            <div class="tm-pick"><label>辅助色</label><input type="color" id="impAccent2" value="#3ddc84"><span class="tm-hex" id="impAccent2Hex">#3ddc84</span></div>
            <div class="tm-pick"><label>背景</label><input type="color" id="impBg" value="#000000"><span class="tm-hex" id="impBgHex">#000000</span></div>
          </div>
          <div class="field"><label>JSON 令牌(可选)</label><textarea class="textarea" id="impTokens" rows="3" placeholder='{"colors":{"accent":"#ffcf4d"}}'></textarea></div>
          <button class="btn btn-primary" id="btnImportTheme">${icon('upload', 'ico-sm')} 导入主题</button>
        </div>
      </div>
      <div class="card tm-upload-card">
        <div class="card-title">${icon('package-plus', 'ico-sm')} 上传外部主题包</div>
        <div class="hint" style="margin-bottom:10px">选择本机 .zip 主题包(内含 theme.json / app.css / layout.html),或分别选择 app.css / layout.html / theme.json 文件</div>
        <div class="tm-dropzone" id="impDrop" title="点击或拖拽选择主题文件">
          <div class="tm-drop-icon">${icon('file-archive', 'ico')}</div>
          <div class="tm-drop-text">拖拽 .zip 主题包到此处，或点击选择文件</div>
          <div class="hint">单个 .zip 或 app.css / layout.html / theme.json 多选</div>
        </div>
        <div class="tm-files" id="impFiles"></div>
        <div class="tm-upload-row">
          <button class="btn btn-primary" id="btnUploadTheme">${icon('upload', 'ico-sm')} 上传导入</button>
          <span class="hint" id="impUploadStatus"></span>
        </div>
      </div>
      <div class="card tm-list">
        <div class="card-title">
          ${icon('boxes', 'ico-sm')} 已保存主题
          <span class="tm-count">${themes.length} 个</span>
        </div>
        ${themes.length ? `<div class="tm-grid">
          ${themes.map(t => {
            const c = t.colors || {};
            const bg = c.bg || '#000';
            const accent = c.accent || '#ffcf4d';
            const accent2 = c.accent2 || '#3ddc84';
            const text = c.text || '#fff';
            return `<div class="tm-item${t.id === active ? ' tm-active' : ''}">
              <div class="tm-preview" style="background:${bg};color:${text}">
                <div class="tm-preview-swatches">
                  <span class="tm-swatch" style="background:${accent}" title="主色 ${accent}"></span>
                  <span class="tm-swatch" style="background:${accent2}" title="辅助色 ${accent2}"></span>
                  <span class="tm-swatch" style="background:${bg};border:1px solid rgba(255,255,255,.15)" title="背景 ${bg}"></span>
                </div>
                <div class="tm-preview-dots">
                  <span class="tm-dot" style="background:${accent}"></span>
                  <span class="tm-dot" style="background:${accent2}"></span>
                  <span class="tm-dot" style="background:${text}"></span>
                </div>
              </div>
              <div class="tm-body">
                <div class="tm-name">${esc(t.name)} ${t.id === active ? '<span class="tag tm-active-tag">使用中</span>' : ''}</div>
                <div class="hint">${esc(t.id)} · v${esc(t.version)}</div>
                ${t.description ? `<div class="hint">${esc(t.description)}</div>` : ''}
                <div class="tm-actions">
                  <button class="btn btn-sm btn-primary" data-apply="${esc(t.id)}" ${t.id === active ? 'disabled' : ''}>${icon('check', 'ico-sm')} 应用</button>
                  <button class="btn btn-sm btn-danger" data-del="${esc(t.id)}" ${t.id === active ? 'disabled' : ''}>${icon('trash-2', 'ico-sm')} 删除</button>
                </div>
              </div>
            </div>`;}).join('')}
        </div>` : `<div class="empty" style="padding:24px">暂无已保存的主题，使用上方导入功能创建</div>`}
      </div>
    </div>`;
    /* 颜色选择器联动：实时显示 hex 值 */
    ['impAccent', 'impAccent2', 'impBg'].forEach(id => {
      const inp = body.querySelector('#' + id);
      const hex = body.querySelector('#' + id + 'Hex');
      if (inp && hex) inp.addEventListener('input', () => { hex.textContent = inp.value; });
    });
    /* 外部主题包上传：拖拽 / 点击选择文件 */
    let impFiles = [];
    const drop = body.querySelector('#impDrop');
    const filesBox = body.querySelector('#impFiles');
    const statusEl = body.querySelector('#impUploadStatus');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = '.zip,.css,.html,.json';
    fileInput.style.display = 'none';
    drop.appendChild(fileInput);
    const renderFiles = () => {
      filesBox.innerHTML = impFiles.map((f, i) => `<span class="tm-file">${icon('file', 'ico-sm')} ${esc(f.name)} <button type="button" class="icon-btn" data-rm="${i}" title="移除">${icon('x', 'ico-xs')}</button></span>`).join('') || '';
      filesBox.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); impFiles.splice(Number(b.dataset.rm), 1); renderFiles(); }));
    };
    const addFiles = list => {
      if (!list.length) return;
      for (const f of list) { if (!impFiles.some(x => x.name === f.name)) impFiles.push(f); }
      renderFiles();
      statusEl.textContent = '';
    };
    drop.addEventListener('click', () => fileInput.click());
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles([...fileInput.files]); fileInput.value = ''; });
    body.querySelector('#btnUploadTheme').addEventListener('click', async () => {
      if (!impFiles.length) { toast('请先选择主题文件', 'err'); return; }
      const fd = new FormData();
      const zip = impFiles.find(f => (f.name.split('.').pop() || '').toLowerCase() === 'zip');
      if (zip) {
        if (impFiles.length > 1) toast('同时选择了 zip 与其他文件，仅导入 zip', 'info');
        fd.append('zip', zip);
      } else {
        for (const f of impFiles) {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          if (ext === 'css') fd.append('css', f);
          else if (ext === 'html') fd.append('layout', f);
          else if (ext === 'json') fd.append('manifest', f);
        }
      }
      statusEl.textContent = '上传中...';
      const btn = body.querySelector('#btnUploadTheme');
      btn.disabled = true;
      try {
        const r2 = await API.upload('/admin/themes/upload', fd);
        toast('主题已导入：' + (r2.id || ''), 'ok');
        impFiles = []; renderFiles();
        statusEl.textContent = '';
        this.renderThemes(body);
      } catch (e) { statusEl.textContent = ''; toast(e.message, 'err'); }
      finally { btn.disabled = false; }
    });
    body.querySelector('#btnExportTheme').addEventListener('click', async () => {
      const id = (body.querySelector('#expThemeId').value || 'theme-' + Date.now()).trim();
      try {
        await API.post('/admin/themes/export', {
          id,
          name: body.querySelector('#expThemeName').value.trim(),
          description: body.querySelector('#expThemeDesc').value.trim()
        });
        toast('主题已导出', 'ok');
        this.renderThemes(body);
      } catch (e) { toast(e.message, 'err'); }
    });
    body.querySelector('#btnImportTheme').addEventListener('click', async () => {
      let tokens = {};
      const raw = body.querySelector('#impTokens').value.trim();
      if (raw) {
        try { tokens = JSON.parse(raw); }
        catch (e) { toast('JSON 令牌解析失败：' + e.message, 'err'); return; }
      }
      tokens.colors = tokens.colors || {};
      tokens.colors.accent = body.querySelector('#impAccent').value;
      tokens.colors.accent2 = body.querySelector('#impAccent2').value;
      tokens.colors.bg = body.querySelector('#impBg').value;
      try {
        await API.post('/admin/themes/import', {
          id: (body.querySelector('#impThemeId').value || 'theme-' + Date.now()).trim(),
          name: body.querySelector('#impThemeName').value.trim(),
          baseTheme: body.querySelector('#impBaseTheme').value,
          tokens
        });
        toast('主题已导入', 'ok');
        this.renderThemes(body);
      } catch (e) { toast(e.message, 'err'); }
    });
    body.querySelectorAll('[data-apply]').forEach(btn => btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const ok = await confirmDlg('应用主题「' + btn.dataset.apply + '」？将覆盖当前页面样式与布局。', { okText: '应用', danger: false, title: '应用主题' });
      if (!ok) return;
      try {
        await API.post('/admin/themes/' + btn.dataset.apply + '/apply');
        toast('主题已应用，刷新页面后生效', 'ok');
        this.renderThemes(body);
      } catch (e) { toast(e.message, 'err'); }
    }));
    body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const ok = await confirmDlg('确认删除主题「' + btn.dataset.del + '」？此操作不可恢复。', { okText: '删除', danger: true, title: '删除主题' });
      if (!ok) return;
      try {
        await API.del('/admin/themes/' + btn.dataset.del);
        toast('主题已删除', 'ok');
        this.renderThemes(body);
      } catch (e) { toast(e.message, 'err'); }
    }));
  }
};