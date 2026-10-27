'use strict';
/* 风格库：浏览/收藏/创建/管理 */
const StylesView = {
  state: { styles: [], categories: [], selected: new Set(), page: 1 },

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
    <div class="page-head">
      <div class="page-head-main">
        <div class="page-eyebrow">${icon('palette')} Styles</div>
        <h1 class="page-title">风格库</h1>
        <p class="page-sub">把提示词模板、负向词与模型绑定沉淀成「风格」；在分镜工作台的「视频风格」下拉里一键套用。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="createStyleBtn">${iconText('plus', '新建风格')}</button>
      </div>
    </div>
    <div class="filters">
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="stSearch" placeholder="搜索风格名称…"></div>
      <select class="select" id="stCatFilter" style="width:auto">
        <option value="">全部分类</option>
        ${[...cats].sort().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <button class="wb-tbtn" id="styleSelectAllBtn" title="选中当前全部可删除风格">${iconText('check-check', '全选')}</button>
      <span class="alib-count" id="stCount"></span>
      <div class="grow"></div>
    </div>
    <div class="grid grid-cards" id="styleGrid"></div>
    <div id="stylePager"></div>
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
    this.state.page = 1;   /* 筛选一变就回到第 1 页(26·1 每页 20 条) */
    this.renderGrid();
  },

  gotoPage(p) {
    this.state.page = Math.max(1, p);
    this.renderGrid();
    const scroller = document.querySelector('.content') || document.scrollingElement;
    if (scroller && scroller.scrollTo) scroller.scrollTo({ top: 0, behavior: 'smooth' });
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
    const cnt = this.root.querySelector('#stCount');
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (this.state.page > pages) this.state.page = pages;
    const shown = filtered.slice((this.state.page - 1) * PAGE_SIZE, (this.state.page - 1) * PAGE_SIZE + PAGE_SIZE);
    if (cnt) cnt.innerHTML = `<b class="gold-num">${filtered.length}</b> 个风格`
      + (filtered.length !== this.state.styles.length ? ' / 共 ' + this.state.styles.length : '')
      + (pages > 1 ? ' · 第 ' + this.state.page + '/' + pages + ' 页' : '');
    renderPager(this.root.querySelector('#stylePager'), { page: this.state.page, total: filtered.length, onPage: p => this.gotoPage(p) });
    if (!filtered.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-ico">${icon('palette')}</div><h3>没有匹配的风格</h3><p>换个关键词或分类，或新建一个风格</p></div>`; return; }
    grid.innerHTML = shown.map(s => `
      <div class="card${this.state.selected.has(s.id) ? ' sel' : ''}" style="position:relative">
        <div class="st-head">
          ${s.can_edit && this.canDelete(s)
            ? `<span class="asset-check style-check${this.state.selected.has(s.id) ? ' on' : ''}" data-style-check="${s.id}" title="勾选">${icon('check', 'ico-xs')}</span>`
            : ''}
          <div class="st-name">${esc(s.name)}</div>
          <button class="icon-btn fav-btn${s.is_favorite ? ' on' : ''}" data-fav="${s.id}" title="${s.is_favorite ? '取消收藏' : '收藏'}">${icon('star')}</button>
        </div>
        <div class="st-meta">${esc(s.category)}${s.author_name ? ' · ' + esc(s.author_name) : ''}</div>
        <div class="st-desc">${esc(s.description || '暂无描述')}</div>
        ${s.tags && s.tags.length ? `<div class="st-tags">${s.tags.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="st-actions">
          <a class="btn btn-sm btn-primary" href="#/projects" style="flex:1" data-apply="${s.id}">${iconText('wand-2', '去项目套用')}</a>
          ${s.can_edit ? `<button class="btn btn-sm btn-ghost" data-edit="${s.id}">${icon('pencil', 'ico-xs')}</button>` : ''}
          ${this.canDelete(s) ? `<button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-del="${s.id}">${icon('trash-2', 'ico-xs')}</button>` : ''}
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.fav;
        const s = this.state.styles.find(x => x.id === id);
        if (!s || btn.disabled) return;
        btn.disabled = true;                       /* 连点会重复收藏 / 取消,先锁住 */
        try {
          if (s.is_favorite) await API.del('/styles/' + id + '/favorite');
          else await API.post('/styles/' + id + '/favorite');
          const res = await API.get('/styles');
          this.state.styles = res.items;
          this.renderGrid();
        } catch (e) {
          toast('收藏状态未能保存：' + e.message, 'err');
          btn.disabled = false;
        }
      });
    });
    grid.querySelectorAll('[data-apply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = this.state.styles.find(x => x.id === btn.dataset.apply);
        toast(s ? `已选择风格「${s.name}」— 进入项目分镜创作页，在「视频风格」中选择即可套用` : '已跳转项目分集', 'ok', 4600);
      });
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

  /* 仅作者或平台管理员可删除 */
  canDelete(s) {
    return s.can_edit && (s.author_id === App.user.id || (App && App.user && App.user.role === 'admin'));
  },

  /* 全选：选中当前全部可删除的风格 */
  selectAllStyles() {
    const selectable = this.state.styles.filter(s => this.canDelete(s));
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
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 个风格？删除后不可恢复。`)) return;
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
        { key: 'name', label: '风格名称', placeholder: '如： 黑白电影', value: '' },
        { key: 'category', label: '分类', type: 'select', options: [['通用'], ['影视'], ['科幻'], ['国风'], ['动画'], ['自然'], ['商业'], ['其他']].map(c => ({ value: c[0], label: c[0] || '—' })), value: '通用' },
        { key: 'model_id', label: '关联模型(可选)', type: 'select', options: [{ value: '', label: '不关联模型' }].concat(models.items.map(m => ({ value: m.id, label: m.name }))), value: '' },
        { key: 'description', label: '描述', placeholder: '简短描述风格特点', value: '' },
        { key: 'prompt_template', label: '提示词模板', type: 'textarea', placeholder: '使用 {subject} 代表主体描述', value: '' },
        { key: 'negative_prompt', label: '负向提示词', type: 'textarea', placeholder: '需要避免的内容', value: '' },
        { key: 'tags', label: '标签(逗号分隔)', placeholder: '如： 电影， 复古', value: '' },
        { key: 'visibility', label: '可见性', type: 'select', options: [{ value: 'public', label: '公开' }, { value: 'private', label: '私有' }], value: 'public' }
      ],
      submitText: '创建',
      /* 交给 formModal 的 onSubmit 统一处理:失败时弹窗保持打开、按钮恢复可用,
         不会「弹已关闭 → 用户以为存了 → 数据其实没进去」 */
      onSubmit: async (vals) => {
        await API.post('/styles', {
          name: vals.name, category: vals.category, model_id: vals.model_id || undefined,
          description: vals.description, prompt_template: vals.prompt_template,
          negative_prompt: vals.negative_prompt, tags: vals.tags.split(',').map(s => s.trim()).filter(Boolean),
          visibility: vals.visibility, params: {}
        });
        toast('风格已创建', 'ok');
        const res = await API.get('/styles'); this.state.styles = res.items; this.renderGrid();
      }
    });
  },

  async editStyle(id) {
    const s = this.state.styles.find(x => x.id === id);
    const models = await API.get('/styles/models');
    const vals = await formModal({
      title: '编辑风格',
      fields: [
        { key: 'name', label: '名称', value: s.name },
        { key: 'category', label: '分类', type: 'select', options: [['通用'], ['影视'], ['科幻'], ['国风'], ['动画'], ['自然'], ['商业'], ['其他']].map(c => ({ value: c[0], label: c[0] || '—' })), value: s.category || '通用' },
        { key: 'model_id', label: '关联模型', type: 'select', options: [{ value: '', label: '—' }].concat(models.items.map(m => ({ value: m.id, label: m.name }))), value: s.model_id || '' },
        { key: 'description', label: '描述', value: s.description },
        { key: 'prompt_template', label: '提示词模板', type: 'textarea', value: s.prompt_template },
        { key: 'negative_prompt', label: '负向提示词', type: 'textarea', value: s.negative_prompt },
        { key: 'tags', label: '标签(逗号分隔)', value: (s.tags || []).join(', ') },
        { key: 'visibility', label: '可见性', type: 'select', options: [{ value: 'public', label: '公开' }, { value: 'private', label: '私有' }], value: s.visibility }
      ],
      submitText: '保存',
      onSubmit: async (vals) => {
        await API.patch('/styles/' + id, {
          name: vals.name, category: vals.category, model_id: vals.model_id || undefined,
          description: vals.description, prompt_template: vals.prompt_template,
          negative_prompt: vals.negative_prompt, tags: vals.tags.split(',').map(s => s.trim()).filter(Boolean), visibility: vals.visibility
        });
        toast('已更新', 'ok');
        const res = await API.get('/styles'); this.state.styles = res.items; this.renderGrid();
      }
    });
  }
};