'use strict';
/* 风格库:浏览/收藏/创建/管理 */
const StylesView = {
  state: { styles: [], categories: [], selected: new Set() },

  async render(root) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    const [stylesRes, catsRes] = await Promise.all([
      API.get('/styles'), API.get('/styles/categories')
    ]);
    this.state.styles = stylesRes.items;
    this.state.categories = catsRes.items;
    this.renderUI();
  },

  renderUI() {
    const h = this.root;
    const cats = new Set(this.state.styles.map(s => s.category));
    h.innerHTML = `
    <div class="toolbar">
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="stSearch" placeholder="搜索风格名称…"></div>
      <select class="select" id="stCatFilter" style="width:auto">
        <option value="">全部分类</option>
        ${[...cats].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <div class="grow"></div>
      <button class="btn" id="styleSelectAllBtn" title="选中当前全部风格">${iconText('check-check', '全选')}</button>
      <button class="btn btn-primary" id="createStyleBtn">${iconText('plus', '新建风格')}</button>
    </div>
    <div class="grid grid-cards" id="styleGrid"></div>
    <div class="ast-batchbar hidden" id="styleBatchBar">
      <span>已选 <b id="styleSelCount">0</b> 个风格</span>
      <button class="btn btn-sm btn-danger" id="styleBatchDel">${iconText('trash-2', '删除选中')}</button>
      <button class="btn btn-sm" id="styleBatchCancel">取消</button>
    </div>`;

    this.renderGrid();
    h.querySelector('#stSearch').addEventListener('input', () => this.filter());
    h.querySelector('#stCatFilter').addEventListener('change', () => this.filter());
    h.querySelector('#createStyleBtn').addEventListener('click', () => this.createStyle());
    h.querySelector('#styleSelectAllBtn').addEventListener('click', () => this.selectAllStyles());
    h.querySelector('#styleBatchDel').addEventListener('click', () => this.applyStyleBatchDelete());
    h.querySelector('#styleBatchCancel').addEventListener('click', () => { this.state.selected.clear(); this.updateStyleBatchBar(); this.renderGrid(); });
  },

  filter() {
    this.renderGrid();
  },

  renderGrid() {
    const q = this.root.querySelector('#stSearch').value.toLowerCase();
    const cat = this.root.querySelector('#stCatFilter').value;
    const filtered = this.state.styles.filter(s => {
      if (cat && s.category !== cat) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const grid = this.root.querySelector('#styleGrid');
    if (!filtered.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">${icon('palette')}</div><h3>没有匹配的风格</h3></div>`; return; }
    grid.innerHTML = filtered.map(s => `
      <div class="card${this.state.selected.has(s.id) ? ' sel' : ''}" style="position:relative;padding:16px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          ${s.can_edit && (s.author_id === App.user.id || (App && App.user && App.user.role === 'admin'))
            ? `<span class="asset-check style-check${this.state.selected.has(s.id) ? ' on' : ''}" data-style-check="${s.id}">${icon('check', 'ico-xs')}</span>`
            : ''}
          <div style="font-weight:700;font-size:14px;flex:1">${esc(s.name)}</div>
          <button class="icon-btn fav-btn${s.is_favorite ? ' on' : ''}" style="width:28px;height:28px" data-fav="${s.id}" title="${s.is_favorite ? '取消收藏' : '收藏'}">${icon('star')}</button>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">${esc(s.category)}${s.author_name ? ' · ' + esc(s.author_name) : ''}</div>
        <div style="font-size:12px;color:var(--text-faint);margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(s.description || '')}</div>
        ${s.tags && s.tags.length ? s.tags.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('') : ''}
        <div style="display:flex;gap:6px;margin-top:10px">
          <a class="btn btn-sm btn-primary" href="#/projects" style="flex:1" data-apply="${s.id}">${iconText('wand-2', '应用')}</a>
          ${s.can_edit ? `<button class="btn btn-sm btn-ghost" data-edit="${s.id}">${iconText('pencil', '编辑')}</button>` : ''}
          ${s.can_edit && s.author_id === App.user.id ? `<button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-del="${s.id}">${iconText('trash-2', '删除')}</button>` : ''}
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.fav;
        const s = this.state.styles.find(x => x.id === id);
        if (s.is_favorite) await API.del('/styles/' + id + '/favorite');
        else await API.post('/styles/' + id + '/favorite');
        const res = await API.get('/styles');
        this.state.styles = res.items;
        this.renderGrid();
      });
    });
    grid.querySelectorAll('[data-apply]').forEach(btn => {
      btn.addEventListener('click', () => { location.hash = '#/projects'; });
    });
    grid.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => this.editStyle(btn.dataset.edit));
    });
    grid.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (await confirmDlg('确认删除风格 "' + (this.state.styles.find(s => s.id === btn.dataset.del)?.name || '') + '"?')) {
          await API.del('/styles/' + btn.dataset.del);
          toast('已删除', 'ok');
          const res = await API.get('/styles'); this.state.styles = res.items; this.renderGrid();
        }
      });
    });
    grid.querySelectorAll('[data-style-check]').forEach(box => box.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      this.toggleStyleSelect(box.dataset.styleCheck);
    }));
  },

  /* 全选:选中当前全部可删除的风格 */
  selectAllStyles() {
    const selectable = this.state.styles.filter(s => s.can_edit && (s.author_id === App.user.id || (App && App.user && App.user.role === 'admin')));
    this.state.selected = new Set(selectable.map(s => s.id));
    this.renderGrid();
    this.updateStyleBatchBar();
    toast(`已全选 ${this.state.selected.size} 个风格`, 'ok');
  },

  /* 切换风格选中状态 */
  toggleStyleSelect(id) {
    const sel = this.state.selected;
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    this.renderGrid();
    this.updateStyleBatchBar();
  },

  /* 更新风格批量操作浮条 */
  updateStyleBatchBar() {
    const bar = document.getElementById('styleBatchBar');
    if (!bar) return;
    const show = this.state.selected.size > 0;
    bar.classList.toggle('hidden', !show);
    const n = document.getElementById('styleSelCount');
    if (n) n.textContent = this.state.selected.size;
  },

  /* 批量删除选中风格 */
  async applyStyleBatchDelete() {
    const ids = [...this.state.selected];
    if (!ids.length) return toast('请先勾选要删除的风格', 'err');
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 个风格?删除后不可恢复。`)) return;
    try {
      const res = await API.post('/styles/batch-delete', { ids });
      if (res.deleted) toast(`已删除 ${res.deleted} 个风格${res.errors ? `,${res.errors} 个失败` : ''}`, res.errors ? 'err' : 'ok');
      else toast('没有可删除的风格', 'err');
      this.state.selected.clear();
      const stylesRes = await API.get('/styles');
      this.state.styles = stylesRes.items;
      this.renderGrid();
    } catch (e) { toast(e.message, 'err'); }
  },

  async createStyle() {
    const models = await API.get('/styles/models');
    const vals = await formModal({
      title: '新建风格',
      fields: [
        { key: 'name', label: '风格名称', placeholder: '如: 黑白电影', value: '' },
        { key: 'category', label: '分类', type: 'select', options: [[''], ['影视'], ['科幻'], ['国风'], ['动画'], ['自然'], ['商业'], ['其他']].map(c => ({ value: c[0], label: c[0] || '—' })), value: '通用' },
        { key: 'model_id', label: '关联模型', type: 'select', options: models.items.map(m => ({ value: m.id, label: m.name })), value: '' },
        { key: 'description', label: '描述', placeholder: '简短描述风格特点', value: '' },
        { key: 'prompt_template', label: '提示词模板', type: 'textarea', placeholder: '使用 {subject} 代表主体描述', value: '' },
        { key: 'negative_prompt', label: '负向提示词', type: 'textarea', placeholder: '需要避免的内容', value: '' },
        { key: 'tags', label: '标签(逗号分隔)', placeholder: '如: 电影, 复古', value: '' },
        { key: 'visibility', label: '可见性', type: 'select', options: [{ value: 'public', label: '公开' }, { value: 'private', label: '私有' }], value: 'public' }
      ],
      submitText: '创建'
    });
    if (vals) {
      await API.post('/styles', {
        name: vals.name, category: vals.category, model_id: vals.model_id || undefined,
        description: vals.description, prompt_template: vals.prompt_template,
        negative_prompt: vals.negative_prompt, tags: vals.tags.split(',').map(s => s.trim()).filter(Boolean),
        visibility: vals.visibility, params: {}
      });
      toast('风格已创建', 'ok');
      const res = await API.get('/styles'); this.state.styles = res.items; this.renderGrid();
    }
  },

  async editStyle(id) {
    const s = this.state.styles.find(x => x.id === id);
    const models = await API.get('/styles/models');
    const vals = await formModal({
      title: '编辑风格',
      fields: [
        { key: 'name', label: '名称', value: s.name },
        { key: 'category', label: '分类', type: 'select', options: [[''], ['影视'], ['科幻'], ['国风'], ['动画'], ['自然'], ['商业'], ['其他']].map(c => ({ value: c[0], label: c[0] || '—' })), value: s.category },
        { key: 'model_id', label: '关联模型', type: 'select', options: [{ value: '', label: '—' }].concat(models.items.map(m => ({ value: m.id, label: m.name }))), value: s.model_id || '' },
        { key: 'description', label: '描述', value: s.description },
        { key: 'prompt_template', label: '提示词模板', type: 'textarea', value: s.prompt_template },
        { key: 'negative_prompt', label: '负向提示词', type: 'textarea', value: s.negative_prompt },
        { key: 'tags', label: '标签(逗号分隔)', value: (s.tags || []).join(', ') },
        { key: 'visibility', label: '可见性', type: 'select', options: [{ value: 'public', label: '公开' }, { value: 'private', label: '私有' }], value: s.visibility }
      ],
      submitText: '保存'
    });
    if (vals) {
      await API.patch('/styles/' + id, {
        name: vals.name, category: vals.category, model_id: vals.model_id || undefined,
        description: vals.description, prompt_template: vals.prompt_template,
        negative_prompt: vals.negative_prompt, tags: vals.tags.split(',').map(s => s.trim()).filter(Boolean), visibility: vals.visibility
      });
      toast('已更新', 'ok');
      const res = await API.get('/styles'); this.state.styles = res.items; this.renderGrid();
    }
  }
};