'use strict';
/* 后台管理:模型管理(有效性检查+免费模型自检) / 任务监控 / 用户管理 / 系统设置(含积分定价) / 积分审批 */
const AdminView = {
  state: { tab: 'models', pollTimer: null },

  async render(root) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    if (App.user.role !== 'admin') {
      root.innerHTML = `<div class="empty"><div class="empty-ico">${icon('lock')}</div><h3>需要管理员权限</h3></div>`;
      return;
    }
    this.renderUI();
    this.switchTab('models');
    return () => this.stopPolling();
  },

  renderUI() {
    this.root.innerHTML = `
    <div class="tabs">
      <div class="tab" data-tab="models">${icon('brain-circuit', 'ico-sm')} 模型管理</div>
      <div class="tab" data-tab="credits">${icon('coins', 'ico-sm')} 积分审批</div>
      <div class="tab" data-tab="tasks">${icon('activity', 'ico-sm')} 任务监控</div>
      <div class="tab" data-tab="users">${icon('users', 'ico-sm')} 用户管理</div>
      <div class="tab" data-tab="themes"><i class="ico ico-sm" data-lucide="palette" aria-hidden="true"></i> 主题管理</div>
      <div class="tab" data-tab="settings">${icon('settings', 'ico-sm')} 系统设置</div>
    </div>
    <div id="adminBody"></div>`;
    this.root.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => this.switchTab(t.dataset.tab)));
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
      if (this.state.tab === 'tasks') this.renderTasks(this.root.querySelector('#adminBody'), true);
    }, 3000);
  },
  stopPolling() { if (this.state.pollTimer) { clearInterval(this.state.pollTimer); this.state.pollTimer = null; } },

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

  /* 生成协议适配器:显示模型当前使用的适配器标签(空 = 自动识别) */
  protocolLabel(m) {
    const PROTO = {
      'agnes-flash': 'Agnes Flash 适配',
      'agnes-v2': 'Agnes V2 适配',
      'openai-video': 'OpenAI 通用协议',
      ffmpeg: '本地 ffmpeg'
    };
    return (PROTO[m.protocol] || '自动识别') + (m.rules && m.rules.protocol ? '' : ' · 自动');
  },

  /* ---------- 模型管理 ---------- */
  async renderModels(body, silent) {
    if (!silent || !this.models) {
      const res = await API.get('/styles/models');
      this.models = res.items;
    }
    const models = this.models;
    body.innerHTML = `
    <div class="toolbar">
      <span class="hint" style="font-size:12px">添加模型后自动执行有效性检查(schema / 端点 / 本地渲染管线)</span>
      <div class="grow"></div>
      <button class="btn btn-primary" id="selfTestBtn">${iconText('flask-conical', '测试免费模型')}</button>
      <button class="btn" id="checkAllBtn">${iconText('shield-check', '全部检查')}</button>
      <button class="btn btn-primary" id="addModelBtn">${iconText('plus', '添加模型')}</button>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table class="table">
      <thead><tr><th>模型</th><th>类型</th><th>推理端点</th><th>并发</th><th>积分/秒</th><th>状态</th><th>有效性</th><th>统计</th><th style="width:210px">操作</th></tr></thead>
      <tbody>${models.map(m => `
        <tr>
          <td><b>${esc(m.name)}</b>${m.is_free ? ' <span class="free-badge">' + icon('gift', 'ico-xs') + '免费</span>' : ''}${m.api_base ? ' <span class="tag" title="API 模型">API</span>' : ''}<br><span style="font-size:11px;color:var(--text-faint)">${esc(m.version)}${m.model_id ? ' · ' + esc(m.model_id) : ''}</span></td>
          <td>${esc(m.type)}<br><span class="tag" style="background:rgba(255,255,255,.06);color:var(--accent-2);font-size:10px" title="生成协议适配器(可按模型规则自动适配)">${esc(this.protocolLabel(m))}</span></td>
          <td style="font-family:var(--mono);font-size:11px;color:var(--text-dim)">${m.api_base ? esc(m.api_base) + (m.has_api_key ? ' <span style="color:var(--accent-2)" title="API Key 已配置(尾号 ' + esc(m.api_key_tail || '') + ')">🔑</span>' : '') : esc(m.endpoint || '—')}</td>
          <td>${m.concurrency}</td>
          <td>${m.is_free ? '<span class="free-badge">' + icon('gift', 'ico-xs') + '免费</span>'
            : (Number(m.credit_per_second) > 0
              ? '<b style="font-family:var(--mono);color:var(--accent-2)">' + m.credit_per_second + '</b> <span style="font-size:10px;color:var(--text-faint)">积分/秒</span>'
              : '<span class="tag" style="font-size:10px" title="按系统设置的全局定价计费">全局定价</span>')}</td>
          <td>${m.enabled ? '<span class="status status-completed">已启用</span>' : '<span class="status status-cancelled">已禁用</span>'}</td>
          <td>${this.mcBadge(m)}</td>
          <td style="font-size:11px;color:var(--text-dim)">成功 ${m.success_count} · 失败 ${m.fail_count}<br>平均 ${Math.round((m.avg_duration_ms || 0) / 1000)}s</td>
          <td><button class="btn btn-xs" data-edit-model="${m.id}">编辑</button>
              <button class="btn btn-xs" data-check-model="${m.id}">检查</button>
              <button class="btn btn-xs" data-selftest-model="${m.id}" title="提交一条真实任务走完整生成队列">自检</button>
              <button class="btn btn-xs ${m.enabled ? 'btn-danger' : ''}" data-toggle-model="${m.id}">${m.enabled ? '禁用' : '启用'}</button>
              <button class="btn btn-xs" data-del-model="${m.id}">删除</button></td>
        </tr>`).join('')}
      </tbody></table></div>`;

    body.querySelector('#addModelBtn').addEventListener('click', () => this.editModel(null));
    body.querySelector('#selfTestBtn').addEventListener('click', () => {
      const free = this.models.find(m => m.is_free) || this.models[0];
      if (free) this.selftestModel(free.id);
    });
    body.querySelector('#checkAllBtn').addEventListener('click', async () => {
      toast('正在检查全部模型…');
      for (const m of this.models) {
        try { await API.post('/admin/models/' + m.id + '/check'); } catch (e) {}
      }
      toast('全部检查完成', 'ok');
      this.renderModels(body);
    });
    body.querySelectorAll('[data-edit-model]').forEach(b => b.addEventListener('click', () => this.editModel(b.dataset.editModel)));
    body.querySelectorAll('[data-check-model]').forEach(b => b.addEventListener('click', () => this.checkModel(b.dataset.checkModel)));
    body.querySelectorAll('[data-selftest-model]').forEach(b => b.addEventListener('click', () => this.selftestModel(b.dataset.selftestModel)));
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
      toast(res.ok ? `检查通过:${res.model.name}` : `检查未通过:${res.message}`, res.ok ? 'ok' : 'err');
      this.renderModels(this.root.querySelector('#adminBody'));
      return res;
    } catch (e) {
      if (!quiet) toast(e.message, 'err');
      return null;
    }
  },

  /* 免费模型端到端自检:真实任务走完整队列 */
  async selftestModel(id) {
    const m = this.models.find(x => x.id === id) || { name: id };
    const STATUS_TEXT = { queued: '排队中', processing: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' };
    const statusModal = openModal({ title: `${icon('flask-conical', 'ico-sm')} 模型自检`, size: 'modal-sm', body: '<div class="loading-wrap"><span class="spinner"></span></div><div style="text-align:center;font-size:12px;color:var(--text-dim);padding-bottom:14px">正在对「' + esc(m.name) + '」执行端到端自检<br>(有效性检查 → 提交真实 2s 测试任务 → 队列渲染)</div>' });
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
            toast(`自检任务状态:${STATUS_TEXT[task.status] || task.status} (${task.progress}%)`);
          }
          if (['completed', 'failed', 'cancelled'].includes(task.status)) {
            clearInterval(timer);
            done = true;
            if (task.status === 'completed') toast(`✅ 自检成功:「${m.name}」渲染管线正常(${Math.round((task.duration_ms || 0) / 1000)}s)`, 'ok');
            else toast(`❌ 自检失败:${task.error || task.status}`, 'err');
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
     支持「API 模型」:填入 API 地址 + API Key 后可一键检测可用模型列表,
     从结果中选择模型 ID;保存后自动执行有效性检查 */
  async editModel(id) {
    const m = id ? this.models.find(x => x.id === id)
      : { params_schema: [], enabled: true, concurrency: 1, api_base: '', has_api_key: false, model_id: '', credit_per_second: 0 };
    const body = el('<div></div>');
    const uid4 = 'em' + Math.random().toString(36).slice(2, 8);
    body.innerHTML = `
      <div class="form-row">
        <div class="field" style="flex:2"><label>模型名称</label><input class="input" id="emName" value="${esc(m.name || '')}" placeholder="如: GPT-Video"></div>
        <div class="field"><label>类型</label><select class="select" id="emType">
          <option value="image-to-video" ${m.type !== 'text-to-video' ? 'selected' : ''}>图生视频</option>
          <option value="text-to-video" ${m.type === 'text-to-video' ? 'selected' : ''}>文生视频</option>
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
            <input class="input" id="emModelId" list="${uid4}-list" value="${esc(m.model_id || '')}" placeholder="检测后从下拉中选择,或手动填写">
            <datalist id="${uid4}-list"></datalist></div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-sm btn-primary" id="emDetectBtn">${iconText('radar', '检测可用模型')}</button>
          <span class="hint" id="emDetectMsg">填写 API 地址与 Key 后可检测</span>
        </div>
      </div>

      <div class="em-rules-box" style="margin-top:14px">
        <div class="em-api-title">${icon('workflow', 'ico-sm')} 生成规则 / 协议适配 <span class="hint" style="font-weight:400">提交任务后按该规则自动适配模型生成</span></div>
        <div class="field"><label>生成协议(适配器)</label>
          <select class="select" id="emProtocol">
            <option value="" ${m.rules && !m.rules.protocol ? 'selected' : ''}>自动识别(按模型 ID / API 自动匹配,推荐)</option>
            <option value="agnes-flash" ${m.rules && m.rules.protocol === 'agnes-flash' ? 'selected' : ''}>Agnes Video 2.5 Flash 兼容</option>
            <option value="agnes-v2" ${m.rules && m.rules.protocol === 'agnes-v2' ? 'selected' : ''}>Agnes Video V2.0 兼容</option>
            <option value="openai-video" ${m.rules && m.rules.protocol === 'openai-video' ? 'selected' : ''}>OpenAI 视频通用协议(规则可配)</option>
            <option value="ffmpeg" ${m.rules && m.rules.protocol === 'ffmpeg' ? 'selected' : ''}>本地 ffmpeg 渲染</option>
          </select>
          <div class="hint">添加新模型时通常选「自动识别」即可 —— 系统按模型 ID 特征匹配内置适配器;接入全新网关可选「OpenAI 视频通用协议」并微调下方规则,无需改代码。</div></div>
        <div class="field"><label>生成规则 JSON(可选)</label><textarea class="textarea" id="emRules" rows="7" spellcheck="false" style="font-family:var(--mono);font-size:11.5px" placeholder='{"create":{"path":"/videos","body":{"model":"<model_id>","prompt":"<prompt>","seconds":"<seconds>"}},"query":{"path":"/agnesapi","params":{"video_id":"<video_id>","model_name":"<model_id>"}}}'>${m.rules && Object.keys(m.rules).length ? esc(JSON.stringify(m.rules, null, 2)) : ''}</textarea>
          <div class="hint">占位符:&lt;model_id&gt; &lt;prompt&gt; &lt;mode&gt; &lt;seconds&gt; &lt;size&gt; &lt;aspect_ratio&gt; &lt;seed&gt; &lt;fps&gt; &lt;negative_prompt&gt; &lt;first_frame&gt; &lt;last_frame&gt; &lt;images&gt; &lt;audios&gt; &lt;video_id&gt;。内置适配器(Agnes Flash/V2)无需填写,留空即可。</div></div>
      </div>

      <div class="field"><label>推理端点(可选,兼容旧配置)</label><input class="input" id="emEndpoint" value="${esc(m.endpoint || '')}" placeholder="gpu://… 或 api://https://host/path 或 local://ffmpeg/free"></div>
      <div class="form-row">
        <div class="field"><label>并发限制</label><input class="input" id="emConcurrency" type="number" min="1" max="64" value="${m.concurrency || 1}"></div>
        <div class="field"><label>每秒积分消耗 <span class="hint" style="font-weight:400">(积分/秒)</span></label>
          <input class="input" id="emCps" type="number" min="0" step="0.5" value="${Number(m.credit_per_second) > 0 ? m.credit_per_second : ''}" placeholder="留空按全局定价">
          <div class="hint">设置后该模型按 秒数×单价 向上取整,忽略全局段时长覆盖价;0/留空 = 全局定价;免费模型恒 0 分</div></div>
        <div class="field"><label>启用</label><select class="select" id="emEnabled">
          <option value="1" ${m.enabled ? 'selected' : ''}>启用</option>
          <option value="0" ${!m.enabled ? 'selected' : ''}>禁用</option>
        </select></div>
      </div>
      <div class="field"><label>描述</label><textarea class="textarea" id="emDesc" placeholder="选填">${esc(m.description || '')}</textarea></div>`;

    const q = s => body.querySelector(s);
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
        msg.innerHTML = `${icon('circle-check', 'ico-xs')} 检测到 <b>${res.count}</b> 个可用模型,点击「模型 ID」输入框即可下拉选择`;
        msg.style.color = 'var(--accent-2)';
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
    const modal = openModal({ title: `${icon('brain-circuit', 'ico-sm')} ${id ? '编辑模型' : '添加模型'}`, size: 'modal-lg', body, footer: [cancelBtn, saveBtn] });
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
        api_base: q('#emApiBase').value.trim(),
        model_id: q('#emModelId').value.trim(),
        credit_per_second: Math.max(0, Number(q('#emCps').value) || 0),
        params_schema: m.params_schema || []
      };
      /* 生成规则:协议 + 规则 JSON */
      const emProtocol = q('#emProtocol').value;
      const emRulesRaw = q('#emRules').value.trim();
      let rulesObj = {};
      if (emProtocol) rulesObj.protocol = emProtocol;
      if (emRulesRaw) { try { const parsed = JSON.parse(emRulesRaw); Object.assign(rulesObj, parsed); } catch (e) { toast('生成规则 JSON 解析失败:' + e.message, 'err'); saveBtn.disabled = false; return; } }
      if (Object.keys(rulesObj).length) reqBody.rules = rulesObj;
      const keyVal = q('#emApiKey').value.trim();
      if (keyVal) reqBody.api_key = keyVal; // 留空 = 保持原 Key
      saveBtn.disabled = true;
      try {
        let modelId = id;
        if (id) await API.patch('/admin/models/' + id, reqBody);
        else modelId = (await API.post('/admin/models', reqBody)).model.id;
        toast('已保存,正在自动检查模型有效性…', 'ok');
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
          <td><b>${esc(cr.user_name)}</b><br><span style="font-size:11px;color:var(--text-faint)">${esc(cr.user_email)}</span></td>
          <td style="font-family:var(--mono);font-weight:800;color:var(--accent-2)">+${cr.amount}</td>
          <td style="font-size:12px;color:var(--text-dim);max-width:260px">${esc(cr.reason || '—')}</td>
          <td><span class="status status-${cr.status === 'approved' ? 'completed' : cr.status === 'rejected' ? 'failed' : 'queued'}">${cr.status === 'approved' ? '已批准' : cr.status === 'rejected' ? '已驳回' : '待审批'}</span></td>
          <td style="font-size:11px;color:var(--text-faint)">${fmtTime(cr.created_at)}</td>
          <td>${cr.status === 'pending' ? `
            <button class="btn btn-xs btn-primary" data-cr-approve="${cr.id}">批准</button>
            <button class="btn btn-xs btn-danger" data-cr-reject="${cr.id}">驳回</button>`
            : `<span style="font-size:11px;color:var(--text-faint)">${cr.handled_at ? fmtTime(cr.handled_at) : '—'}</span>`}</td>
        </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-faint);padding:26px">暂无申请记录</td></tr>'}
      </tbody></table></div>`;
    body.querySelectorAll('[data-cr-approve]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/credit-requests/' + b.dataset.crApprove + '/approve'); toast('已批准,积分到账', 'ok'); this.renderCreditRequests(body); }
      catch (e) { toast(e.message, 'err'); }
    }));
    body.querySelectorAll('[data-cr-reject]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/credit-requests/' + b.dataset.crReject + '/reject'); toast('已驳回', 'ok'); this.renderCreditRequests(body); }
      catch (e) { toast(e.message, 'err'); }
    }));
  },

  /* ---------- 任务监控 ---------- */
  async renderTasks(body, silent) {
    let items, running;
    try {
      const res = await API.get('/admin/tasks?status=all');
      items = res.items; running = res.running;
      this._adminTasks = items;
    } catch (e) { return; }
    /* 修复「屏幕隔几秒闪一下」:轮询重绘前做签名比对,数据无变化直接跳过;
       有变化时也以静默模式渲染(silent-render 类),不重播入场动画 */
    const sig = items.length + '#' + items.map(t => t.id + ':' + t.status + ':' + t.progress + ':' + (t.cost || 0)).join('|');
    if (silent && sig === this._tasksSig) return;
    this._tasksSig = sig;
    body.classList.toggle('silent-render', !!silent);
    const active = items.filter(t => ['queued', 'processing'].includes(t.status)).length;
    body.innerHTML = `
    <div class="stat-cards" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-value">${running}</div><div class="stat-label">正在执行</div></div>
      <div class="stat-card"><div class="stat-value">${active}</div><div class="stat-label">等待中 / 执行中</div></div>
      <div class="stat-card"><div class="stat-value">${items.filter(t => t.status === 'completed').length}</div><div class="stat-label">已完成</div></div>
      <div class="stat-card"><div class="stat-value">${items.filter(t => t.status === 'failed').length}</div><div class="stat-label">失败</div></div>
    </div>
    <div class="card" style="padding:0;overflow-x:auto"><table class="table">
      <thead><tr><th>任务</th><th>用户</th><th>模型</th><th>参数</th><th>提示词</th><th>状态</th><th>进度</th><th>积分</th><th>耗时</th><th>提交时间</th><th>操作</th></tr></thead>
      <tbody>${items.map(t => `
        <tr>
          <td style="font-family:var(--mono);font-size:11px">${esc(t.id.slice(0, 10))}</td>
          <td>${esc(t.user_name || t.user_email)}</td>
          <td style="font-size:11px;color:var(--text-dim)">${t.model_name ? esc(t.model_name) : (t.model_id ? '<span class="tag">' + esc(t.model_id) + '</span>' : '—')}</td>
          <td style="font-size:11px;color:var(--text-dim)">${t.params.duration || '—'}s @ ${t.params.fps || '—'}fps${t.params.selftest ? ' · 自检' : ''}</td>
          <td><button class="btn-link task-prompt-btn" data-prompt="${t.id}" title="点击查看完整提示词">${t.prompt ? esc(String(t.prompt).slice(0, 16)) + '…' : '无提示词'}</button></td>
          <td>${statusBadge(t.status)}</td>
          <td style="min-width:90px">${['queued', 'processing'].includes(t.status) ? `<div class="progress"><div class="progress-fill" style="width:${t.progress}%"></div></div><span style="font-size:10px;color:var(--text-faint)">${t.progress}%</span>` : '—'}</td>
          <td style="font-family:var(--mono);font-size:11px">${t.cost > 0 ? '-' + t.cost + (t.refunded ? '(退)' : '') : '<span class="free-badge">免费</span>'}</td>
          <td>${t.duration_ms ? Math.round(t.duration_ms / 1000) + 's' : '—'}</td>
          <td style="font-size:11px;color:var(--text-faint)">${fmtTime(t.created_at)}</td>
          <td>${['queued', 'processing'].includes(t.status) ? `<button class="btn btn-xs btn-danger" data-cancel="${t.id}">取消</button>` : ''}
              ${['failed', 'cancelled'].includes(t.status) ? `<button class="btn btn-xs" data-retry="${t.id}">重试</button>` : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
    body.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      await API.post('/admin/tasks/' + b.dataset.cancel + '/cancel');
      toast('已取消(积分将退还)', 'ok');
    }));
    body.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post('/admin/tasks/' + b.dataset.retry + '/retry'); toast('已重试', 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    }));
    body.querySelectorAll('.task-prompt-btn').forEach(b => b.addEventListener('click', () => this.viewTaskPrompt(b.dataset.prompt)));
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
      ? `<span style="color:var(--accent-2);font-family:var(--mono)">${t.cost} 积分</span>${t.refunded ? ' <span class="tag">已退还</span>' : ''}`
      : '<span class="free-badge">免费</span>';
    openModal({
      title: `任务提示词 · ${esc(t.id.slice(0, 10))}`,
      size: 'modal-lg',
      body: `
        <div class="field"><label>提示词</label><div style="font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${esc(t.prompt || '(空)')}</div></div>
        <div class="field"><label>负向提示词</label><div style="font-size:12px;color:var(--text-dim);white-space:pre-wrap;word-break:break-word">${esc(t.negative_prompt || '(空)')}</div></div>
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
        <div class="field"><label>任务 ID</label><div style="font-family:var(--mono);font-size:11px;color:var(--text-faint)">${esc(t.id)}</div></div>
        <div class="field"><label>提交时间</label><div style="font-size:11px;color:var(--text-faint)">${fmtTime(t.created_at)}</div></div>
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
          <td><div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:12px">${avatar(u.name)}</div><div><b>${esc(u.name)}</b><br><span style="font-size:11px;color:var(--text-faint)">${esc(u.email)}</span></div></div></td>
          <td>${u.role === 'admin' ? '<span class="tag">管理员</span>' : '<span class="tag" style="background:rgba(255,255,255,.06);color:var(--text-dim)">用户</span>'}</td>
          <td>${fmtBytes(u.storage_used)}</td>
          <td>${fmtBytes(u.storage_quota)}</td>
          <td><b style="font-family:var(--mono);color:var(--accent-2)" data-bal-row="${u.id}">${u.credits != null ? u.credits : '—'}</b>${reqByUser[u.id] ? ` <span class="cc-pending" title="待审批申请">${reqByUser[u.id]}</span>` : ''}</td>
          <td>${u.banned ? '<span class="status status-failed">已封禁</span>' : '<span class="status status-completed">正常</span>'}</td>
          <td style="font-size:11px;color:var(--text-faint)">${fmtTime(u.created_at)}</td>
          <td>
            ${u.id !== App.user.id ? `<button class="btn btn-xs" data-setquota="${u.id}">配额</button>
            <button class="btn btn-xs" data-setcredits="${u.id}">调分</button>
            <button class="btn btn-xs ${u.role === 'admin' ? '' : 'btn-primary'}" data-role="${u.id}">${u.role === 'admin' ? '取消管理员' : '设为管理员'}</button>
            <button class="btn btn-xs ${u.banned ? '' : 'btn-danger'}" data-ban="${u.id}">${u.banned ? '解封' : '封禁'}</button>` : '<span style="color:var(--text-faint);font-size:11px">当前账号</span>'}
          </td>
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
      const vals = await formModal({
        title: '设置配额',
        fields: [{ key: 'quota', label: '存储配额 (GB)', type: 'number', value: Math.round(u.storage_quota / 1024 ** 3) }],
        submitText: '保存'
      });
      if (vals) {
        await API.patch('/admin/users/' + u.id, { storage_quota: Number(vals.quota) * 1024 ** 3 });
        toast('配额已更新', 'ok');
        this.renderUsers(body);
      }
    }));
    body.querySelectorAll('[data-setcredits]').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => x.id === b.dataset.setcredits);
      const vals = await formModal({
        title: `调整积分 · ${u.name}`,
        fields: [
          { key: 'delta', label: '变动数量(正数发放 / 负数扣减)', type: 'number', value: 100 },
          { key: 'reason', label: '备注', value: '', placeholder: '如: 活动奖励' }
        ],
        submitText: '确认调整'
      });
      if (vals) {
        try {
          await API.post('/admin/users/' + u.id + '/credits', { delta: Number(vals.delta), reason: vals.reason });
          toast('积分已调整', 'ok');
          this.renderUsers(body);
        } catch (e) { toast(e.message, 'err'); }
      }
    }));
  },

  /* ---------- 系统设置(含积分定价) ---------- */
  async renderSettings(body) {
    const [res, creditsRes] = await Promise.all([
      API.get('/admin/settings'),
      API.get('/admin/credit-requests?status=all')
    ]);
    const s = res.settings;
    const pricing = creditsRes.pricing || { perSecond: 5, overrides: {} };
    const TIERS = [2, 3, 5, 8, 10];
    body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">
      <div class="card" style="max-width:520px;margin-bottom:0">
        <div class="card-title">系统设置</div>
        <div class="field"><label>最大并发任务数</label><input class="input" id="setConcurrency" type="number" min="1" max="64" value="${s.maxConcurrentTasks || 2}"></div>
        <div class="field"><label>新用户默认配额 (GB)</label><input class="input" id="setQuota" type="number" min="1" value="${s.defaultQuotaGB || 5}"></div>
        <div class="field"><label>单文件上传上限 (MB)</label><input class="input" id="setUpload" type="number" min="1" value="${s.maxUploadMB || 2048}"></div>
        <div class="field"><label>GPU 资源池配置</label><textarea class="textarea" id="setGpu">${esc(s.gpuPool || '')}</textarea></div>
        <button class="btn btn-primary" id="saveSettings">保存设置</button>
      </div>

      <div class="card" style="max-width:520px;margin-bottom:0">
        <div class="card-title">${icon('coins', 'ico-sm')} 积分定价 <span class="hint" style="font-weight:400;font-size:11px">每个段时长的积分数</span></div>
        <div class="field"><label>默认单价(积分 / 秒)</label><input class="input" id="setPerSecond" type="number" min="0" step="0.5" value="${pricing.perSecond}">
          <div class="hint">未配置覆盖价的时长按 秒数×单价 向上取整;免费模型恒为 0 分</div></div>
        <div class="field"><label>注册赠送积分</label><input class="input" id="setFreeCredits" type="number" min="0" value="${s.freeCredits ?? 100}"></div>
        <div class="field"><label>常用段时长定价</label>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${TIERS.map(d => `<div style="display:flex;align-items:center;gap:10px">
              <span style="min-width:52px;font-size:12.5px;color:var(--text-dim)">每段 ${d}s</span>
              <input class="input" type="number" min="0" style="width:110px" data-tier="${d}" value="${pricing.overrides && pricing.overrides[String(d)] !== undefined ? pricing.overrides[String(d)] : ''}" placeholder="留空按秒计价">
              <span class="hint">积分</span>
            </div>`).join('')}
          </div></div>
        <button class="btn btn-primary" id="savePricing">保存定价</button>
      </div>

      <div class="card" style="max-width:520px;margin-bottom:0">
        <div class="card-title">${icon('scan', 'ico-sm')} 生成视频尺寸 <span class="hint" style="font-weight:400;font-size:11px">分镜工作台的分辨率选项(480p/720p/960p/2k)</span></div>
        <div class="field"><label>可用尺寸(至少勾选一项)</label>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${(['480p', '720p', '960p', '2k']).map(v => `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px">
              <input type="checkbox" data-vres="${v}" style="width:15px;height:15px;accent-color:var(--accent)"
                ${(Array.isArray(s.videoResolutions) && s.videoResolutions.length ? s.videoResolutions : ['480p', '720p', '960p', '2k']).includes(v) ? 'checked' : ''}>
              <span style="font-family:var(--mono);min-width:44px">${v === '2k' ? '2K' : v.toUpperCase()}</span>
              <span class="hint">${({ '480p': '标清 · 省积分,预览草稿', '720p': '高清 · 通用推荐', '960p': '准高清 · 兼顾清晰与速度', '2k': '2K 超清 · 成品出片' })[v]}</span>
            </label>`).join('')}
          </div>
          <div class="hint">保存后,分镜创作页的「分辨率」下拉只显示勾选的尺寸;提交任务的分辨率会按此白名单校验</div></div>
        <button class="btn btn-primary" id="saveResolutions">保存尺寸设置</button>
      </div>
    </div>`;
    body.querySelector('#saveSettings').addEventListener('click', async () => {
      await API.patch('/admin/settings', {
        maxConcurrentTasks: Number(body.querySelector('#setConcurrency').value),
        defaultQuotaGB: Number(body.querySelector('#setQuota').value),
        maxUploadMB: Number(body.querySelector('#setUpload').value),
        gpuPool: body.querySelector('#setGpu').value
      });
      toast('设置已保存', 'ok');
    });
    body.querySelector('#savePricing').addEventListener('click', async () => {
      const overrides = {};
      body.querySelectorAll('[data-tier]').forEach(inp => {
        if (inp.value !== '') overrides[inp.dataset.tier] = inp.value;
      });
      try {
        await API.patch('/admin/settings', {
          creditPerSecond: Number(body.querySelector('#setPerSecond').value),
          freeCredits: Number(body.querySelector('#setFreeCredits').value),
          creditOverrides: overrides
        });
        toast('积分定价已保存,新任务立即生效', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
    body.querySelector('#saveResolutions').addEventListener('click', async () => {
      const list = [...body.querySelectorAll('[data-vres]:checked')].map(x => x.dataset.vres);
      if (!list.length) return toast('至少勾选一个生成尺寸', 'err');
      try {
        await API.patch('/admin/settings', { videoResolutions: list });
        toast('生成尺寸已保存,分镜创作页即时生效', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    });
  },
  /* ---------- 主题管理:导入 / 导出 / 应用 / 删除 (含外部主题包上传) ---------- */
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
          <div class="hdr-sub">管理本站皮肤:导出当前样式布局、导入新主题、上传外部主题包、一键切换</div>
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
          <div class="tm-drop-text">拖拽 .zip 主题包到此处,或点击选择文件</div>
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
        </div>` : `<div class="empty" style="padding:24px">暂无已保存的主题,使用上方导入功能创建</div>`}
      </div>
    </div>`;
    /* 颜色选择器联动:实时显示 hex 值 */
    ['impAccent', 'impAccent2', 'impBg'].forEach(id => {
      const inp = body.querySelector('#' + id);
      const hex = body.querySelector('#' + id + 'Hex');
      if (inp && hex) inp.addEventListener('input', () => { hex.textContent = inp.value; });
    });
    /* 外部主题包上传:拖拽 / 点击选择文件 */
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
        if (impFiles.length > 1) toast('同时选择了 zip 与其他文件,仅导入 zip', 'info');
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
        toast('主题已导入:' + (r2.id || ''), 'ok');
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
        catch (e) { toast('JSON 令牌解析失败:' + e.message, 'err'); return; }
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
      const ok = await confirmDlg('应用主题「' + btn.dataset.apply + '」?将覆盖当前页面样式与布局。', { okText: '应用', danger: false, title: '应用主题' });
      if (!ok) return;
      try {
        await API.post('/admin/themes/' + btn.dataset.apply + '/apply');
        toast('主题已应用,刷新页面后生效', 'ok');
        this.renderThemes(body);
      } catch (e) { toast(e.message, 'err'); }
    }));
    body.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const ok = await confirmDlg('确认删除主题「' + btn.dataset.del + '」?此操作不可恢复。', { okText: '删除', danger: true, title: '删除主题' });
      if (!ok) return;
      try {
        await API.del('/admin/themes/' + btn.dataset.del);
        toast('主题已删除', 'ok');
        this.renderThemes(body);
      } catch (e) { toast(e.message, 'err'); }
    }));
  }
};