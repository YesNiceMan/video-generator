'use strict';
/* 资产库：文件夹树 + 分类筛选(角色/场景/物品/分镜/音频/视频) + 资产网格 + 多选批量分类 + 上传/预览/共享 */
const AssetsView = {
  /* 分类定义(与服务端 CATEGORIES 保持一致) */
  categories: [
    { key: '角色', icon: 'user-round' },
    { key: '场景', icon: 'mountain' },
    { key: '物品', icon: 'package' },
    { key: '分镜', icon: 'images' },
    { key: '音频', icon: 'music' },
    { key: '视频', icon: 'clapperboard' }
  ],

  state: { folders: [], assets: [], total: 0, page: 1, size: PAGE_SIZE, currentFolder: null, type: 'all', category: 'all', q: '', shared: false, selectMode: false },

  async render(root) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    this.state.currentFolder = 'root';
    this.state.selectMode = false;
    this.state.page = 1;
    this.state.shared = false;
    this.selected = new Set();
    /* 先出外壳再取数据:每页条数要按网格实际列数排满整数行,得先量得到 #assetGrid 的宽度 */
    this._loading = true;
    this.renderUI();
    this._loading = false;
    /* 每页 = 列数 × 4 行:整数行,最后一行不再空着几个位置 */
    this.state.size = gridPageSize(this.root.querySelector('#assetGrid'), '--card-min');
    await this.load();
    this.renderFolders();
    this.renderAssets();
  },

  /* 分页(26·1):资产库每页 20 条。此前一次拉全库(演示账号 125 项 → 网格近 9000px 高),
     滚动条长得没法用,筛选结果也只能靠鼠标滚 */
  async load(opts) {
    const keep = !!(opts && opts.keepSelection);
    const st = this.state;
    const [folderRes, assetRes] = await Promise.all([
      API.get('/assets/folders'),
      API.get('/assets?folder_id=' + (st.currentFolder || 'root')
        + '&type=' + st.type
        + '&category=' + encodeURIComponent(st.category)
        + '&q=' + encodeURIComponent(st.q)
        + '&limit=' + st.size + '&offset=' + (Math.max(1, st.page) - 1) * st.size)
    ]);
    this.state.folders = folderRes.items;
    this.state.assets = assetRes.items;
    this.state.total = assetRes.total != null ? assetRes.total : assetRes.items.length;
    /* 页码越界(筛选变严 / 删除掉最后一页)→ 回到实际最后一页重取 */
    const pages = Math.max(1, Math.ceil(this.state.total / st.size));
    if (st.page > pages) {
      st.page = pages;
      return this.load(opts);
    }
    /* 翻页时保留已勾选(跨页批量操作);换筛选条件时只保留仍在结果里的项 */
    if (this.selected && !keep) {
      for (const id of [...this.selected]) if (!assetRes.items.some(a => a.id === id)) this.selected.delete(id);
    }
  },

  /* 换筛选条件(文件夹/类型/分类/搜索/共享)统一回到第 1 页 */
  async loadAndRender(resetPage) {
    if (resetPage !== false) this.state.page = 1;
    await this.load();
    this.renderFolders();
    this.renderAssets();
  },

  async gotoPage(p) {
    this.state.page = Math.max(1, p);
    if (this.state.shared) {
      await this.loadShared({ keepSelection: true });
    } else {
      await this.load({ keepSelection: true });
      this.renderAssets();
    }
    /* 翻页后回到列表顶部,否则视线停在上一页的滚动位置 */
    const scroller = document.querySelector('.content') || document.scrollingElement;
    if (scroller && scroller.scrollTo) scroller.scrollTo({ top: 0, behavior: 'smooth' });
  },

  renderUI() {
    const h = this.root;
    h.innerHTML = `
    <div class="page-head">
      <div class="page-head-main">
        <div class="page-eyebrow">${icon('folder-open')} Assets</div>
        <h1 class="page-title">资产库</h1>
        <p class="page-sub">图片 / 视频 / 音频统一归档；分镜工作台按「角色 · 场景 · 物品」等分类引用，右击卡片可快捷操作。</p>
      </div>
      <div class="page-actions">
        <div class="menu">
          <button class="btn" id="astMoreBtn">${iconText('more-horizontal', '更多')}${icon('chevron-down', 'ico-xs')}</button>
          <div class="menu-pop hidden" id="astMorePop">
            <button class="menu-item" id="astAutoCatBtn" title="按文件类型与文件名关键词，给未分类的资产自动归类">${icon('wand-2', 'ico-sm')}<span>自动分类未归档资产</span></button>
            <button class="menu-item" id="astSelectAllBtn" title="选中当前筛选出的全部资产">${icon('check-check', 'ico-sm')}<span>全选当前结果</span></button>
            <div class="ctx-sep"></div>
            <button class="menu-item" id="astNewFolderBtn2">${icon('folder-plus', 'ico-sm')}<span>新建文件夹</span></button>
          </div>
        </div>
        <button class="btn btn-primary" id="astUploadBtn">${iconText('upload', '上传资产')}</button>
      </div>
    </div>

    <div class="filters">
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="astSearch" placeholder="搜索资产名称…" value="${esc(this.state.q)}"></div>
      <select class="select" id="astTypeFilter" style="width:auto">
        <option value="all">全部类型</option>
        <option value="image">图片</option>
        <option value="video">视频</option>
        <option value="audio">音频</option>
      </select>
      <button class="wb-tbtn${this.state.shared ? ' active' : ''}" id="astSharedBtn">${icon(this.state.shared ? 'share-2' : 'users', 'ico-xs')}<span>${this.state.shared ? '共享给我的' : '共享给我'}</span></button>
      <span class="filters-divider"></span>
      <button class="wb-tbtn${this.state.selectMode ? ' active' : ''}" id="astSelectBtn">${iconText('square-check-big', this.state.selectMode ? '退出选择' : '选择模式')}</button>
      <span class="alib-count" id="astCount"></span>
      <div class="grow"></div>
    </div>

    <div class="cat-chips" id="catChips"></div>

    <div class="ast-layout">
      <div class="ast-side">
        <div class="card">
          <div class="ast-side-title">文件夹</div>
          <div class="folder-tree" id="folderTree"></div>
          <div style="margin-top:var(--sp-2)"><button class="btn btn-ghost btn-sm" id="newFolderBtn" style="width:100%">${iconText('plus', '新建文件夹')}</button></div>
        </div>
      </div>
      <div class="ast-main">
        <div class="ast-scroll">
          <div class="grid grid-cards" id="assetGrid"></div>
          <div id="astEmpty" class="hidden empty"><div class="empty-ico">${icon('folder-open')}</div><h3>暂无资产</h3><p>点击「上传资产」添加，或调整上方的类型 / 分类 / 文件夹筛选</p></div>
        </div>
        <div id="astPager" class="ast-pager"></div>
      </div>
    </div>

    <div class="ast-batchbar hidden" id="astBatchBar">
      <span>已选 <b id="astSelCount">0</b> 项 · 设为分类</span>
      <select class="select" id="astBatchCat" style="width:auto">
        ${this.categories.map(c => `<option value="${c.key}">${c.key}</option>`).join('')}
        <option value="">未分类</option>
      </select>
      <button class="btn btn-sm btn-primary" id="astBatchApply">${iconText('check', '应用')}</button>
      <button class="btn btn-sm btn-danger" id="astBatchDel">${iconText('trash-2', '删除选中')}</button>
      <button class="btn btn-sm" id="astBatchCancel">取消</button>
    </div>`;

    this.renderCatChips();
    this.renderFolders();
    this.renderAssets();

    /* 搜索防抖:此前每敲一个字发一次 /assets 请求，中文输入法还在拼字就已经打了几轮 */
    h.querySelector('#astSearch').addEventListener('input', e => {
      const v = e.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        if (!this.root.isConnected) return;
        this.state.q = v;
        this.loadAndRender();
      }, 280);
    });
    h.querySelector('#astTypeFilter').addEventListener('change', () => {
      this.state.type = h.querySelector('#astTypeFilter').value;
      this.loadAndRender();
    });
    /* 共享视图切换只改这一枚按钮的状态并重载列表，不再整页 renderUI（会丢滚动位置与搜索词） */
    const sharedBtn = h.querySelector('#astSharedBtn');
    sharedBtn.addEventListener('click', () => {
      this.state.shared = !this.state.shared;
      this.state.page = 1;
      sharedBtn.classList.toggle('active', this.state.shared);
      sharedBtn.innerHTML = icon(this.state.shared ? 'share-2' : 'users', 'ico-xs')
        + '<span>' + (this.state.shared ? '共享给我的' : '共享给我') + '</span>';
      if (this.state.shared) this.loadShared();
      else this.loadAndRender();
    });
    h.querySelector('#astUploadBtn').addEventListener('click', () => this.showUploadDialog());
    h.querySelector('#astSelectBtn').addEventListener('click', () => this.toggleSelectMode());

    /* 次要动作集中在「更多」菜单，选择后自动收起 */
    bindMenu(h.querySelector('#astMoreBtn'), h.querySelector('#astMorePop'));
    h.querySelector('#astAutoCatBtn').addEventListener('click', () => this.autoCategorize());
    h.querySelector('#astSelectAllBtn').addEventListener('click', () => this.selectAllAssets());
    h.querySelector('#astNewFolderBtn2').addEventListener('click', () => this.newFolder());

    h.querySelector('#astBatchApply').addEventListener('click', () => this.applyBatchCategory());
    h.querySelector('#astBatchDel').addEventListener('click', () => this.applyBatchDelete());
    h.querySelector('#astBatchCancel').addEventListener('click', () => { this.toggleSelectMode(false); });
    h.querySelector('#newFolderBtn').addEventListener('click', () => this.newFolder());
  },

  async newFolder() {
    await formModal({
      title: '新建文件夹',
      fields: [{ key: 'name', label: '文件夹名称', placeholder: '输入名称', value: '' }],
      submitText: '创建',
      onSubmit: async (vals) => {
        await API.post('/assets/folders', { name: vals.name, parent_id: this.state.currentFolder === 'root' ? null : this.state.currentFolder });
        toast('文件夹已创建', 'ok');
        this.loadAndRender();
      }
    });
  },

  /* 分类筛选 chips */
  renderCatChips() {
    const wrap = this.root.querySelector('#catChips');
    if (!wrap) return;
    const chip = (key, label, ic) => `
      <button class="cat-chip${this.state.category === key ? ' on' : ''}" data-cat="${esc(key)}" title="${label}">
        ${ic ? icon(ic, 'ico-xs') : ''}<span>${esc(label)}</span>
      </button>`;
    wrap.innerHTML =
      chip('all', '全部分类', 'layout-grid') +
      this.categories.map(c => chip(c.key, c.key, c.icon)).join('') +
      chip('none', '未分类', 'circle-dashed');
    wrap.querySelectorAll('.cat-chip').forEach(b => b.addEventListener('click', () => {
      this.state.category = b.dataset.cat;
      this.renderCatChips();
      this.loadAndRender();
    }));
  },

  /* 多选模式 */
  toggleSelectMode(force) {
    const on = force !== undefined ? force : !this.state.selectMode;
    this.state.selectMode = on;
    if (!on) this.selected.clear();
    this.updateSelectBtn();
    this.updateBatchBar();
    this.renderAssets();
  },

  updateSelectBtn() {
    const btn = this.root.querySelector('#astSelectBtn');
    if (!btn) return;
    btn.classList.toggle('active', this.state.selectMode);
    btn.innerHTML = iconText('square-check-big', this.state.selectMode ? '退出选择' : '选择模式');
  },

  updateCount() {
    const n = this.root.querySelector('#astCount');
    if (!n) return;
    const st = this.state;
    const total = st.total != null ? st.total : st.assets.length;
    const pages = Math.max(1, Math.ceil(total / st.size));
    n.innerHTML = `<b class="gold-num">${total}</b> 项`
      + (pages > 1 ? ` · 第 ${Math.min(st.page, pages)}/${pages} 页` : '')
      + (st.selectMode ? ' · 已选 ' + this.selected.size : '');
  },

  updateBatchBar() {
    const bar = this.root.querySelector('#astBatchBar');
    if (!bar) return;
    const show = this.state.selectMode || this.selected.size > 0;
    bar.classList.toggle('hidden', !show);
    const n = this.root.querySelector('#astSelCount');
    if (n) n.textContent = this.selected.size;
  },

  toggleSelect(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.applySelectionState();
  },

  /* 根据选中集合刷新所有卡片选中态与勾选框 */
  applySelectionState() {
    const grid = this.root.querySelector('#assetGrid');
    if (!grid) return;
    grid.classList.toggle('selecting', this.state.selectMode);
    grid.querySelectorAll('.media-card').forEach(card => {
      const id = card.dataset.id;
      const on = this.selected.has(id);
      card.classList.toggle('sel', on);
      const ck = card.querySelector('.asset-check');
      if (ck) ck.classList.toggle('on', on);
    });
    this.updateBatchBar();
  },

  async applyBatchCategory() {
    const ids = [...this.selected];
    if (!ids.length) return toast('请先勾选资产', 'err');
    const cat = this.root.querySelector('#astBatchCat').value;
    try {
      const res = await API.post('/assets/batch-category', { ids, category: cat });
      toast(res.updated ? `已把 ${res.updated} 项资产设为「${cat || '未分类'}」` : '没有可修改的资产', res.updated ? 'ok' : 'err');
      this.loadAndRender();
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 全选：选中当前筛选(类型/分类/文件夹/搜索)下的全部可编辑资产。
     分页后「全选当前结果」不能只选本页这 20 条,所以按同样的筛选条件取全量 ID */
  async selectAllAssets() {
    const st = this.state;
    let all = [];
    try {
      all = st.shared
        ? (await API.get('/assets/shared-with-me')).items || []
        : (await API.get('/assets?folder_id=' + (st.currentFolder || 'root')
            + '&type=' + st.type + '&category=' + encodeURIComponent(st.category)
            + '&q=' + encodeURIComponent(st.q) + '&limit=0')).items || [];
    } catch (e) { return toast(e.message, 'err'); }
    const selectable = all.filter(a => a.my_permission !== 'read');
    /* 服务端批量接口单次上限 100 项,选超了会「显示全选、实际只删掉一部分」,所以这里就截断 */
    const picked = selectable.slice(0, 100);
    this.selected = new Set(picked.map(a => a.id));
    st.selectMode = true;
    this.updateSelectBtn();
    this.applySelectionState();
    toast(picked.length < selectable.length
      ? `已选 ${picked.length} 项 · 批量操作单次上限 100 项,请分页分次处理`
      : `已全选 ${picked.length} 项资产`, 'ok');
  },

  /* 批量删除选中资产 */
  async applyBatchDelete() {
    const ids = [...this.selected];
    if (!ids.length) return toast('请先勾选要删除的资产', 'err');
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 项资产？文件将永久删除，不可恢复。`)) return;
    try {
      const res = await API.post('/assets/batch-delete', { ids });
      if (res.deleted) toast(`已删除 ${res.deleted} 项资产${res.errors ? `,${res.errors} 项失败` : ''}`, res.errors ? 'err' : 'ok');
      else toast('没有可删除的资产', 'err');
      this.toggleSelectMode(false);
      this.loadAndRender();
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 自动分类：按文件类型/文件名关键词给未分类资产自动归类 */
  async autoCategorize() {
    const btn = this.root.querySelector('#astAutoCatBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = icon('loader', 'ico-sm') + '<span>分类中…</span>'; }
    try {
      const res = await API.post('/assets/auto-categorize', {});
      if (!res.updated) {
        toast(res.scanned ? '没有需要自动分类的资产(未分类资产已全部归类)' : '自动分类完成', 'ok');
      } else {
        const parts = Object.entries(res.summary || {}).map(([k, v]) => k + '×' + v).join(' · ');
        toast(`已自动分类 ${res.updated} 项资产${parts ? ' (' + parts + ')' : ''}`, 'ok');
      }
      this.loadAndRender();
    } catch (e) { toast(e.message, 'err'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = icon('wand-2', 'ico-sm') + '<span>自动分类未归档资产</span>'; } }
  },

  async loadShared(opts) {
    const keep = !!(opts && opts.keepSelection);
    const res = await API.get('/assets/shared-with-me');
    const items = res.items || [];
    const pages = Math.max(1, Math.ceil(items.length / st.size));
    if (this.state.page > pages) this.state.page = pages;
    const start = (this.state.page - 1) * st.size;
    this.state.assets = items.slice(start, start + st.size);
    this.state.total = items.length;
    if (this.selected && !keep) { for (const id of [...this.selected]) if (!items.some(a => a.id === id)) this.selected.delete(id); }
    this.renderAssets();
  },

  renderFolders() {
    if (this._loading) return;
    const tree = this.root.querySelector('#folderTree');
    const items = [{ id: 'root', name: '全部资产', parent_id: null }].concat(this.state.folders);
    const rootChild = items.filter(i => !i.parent_id);
    tree.innerHTML = rootChild.map(f => this.renderFolderNode(f, items)).join('');
    tree.querySelectorAll('.folder-item').forEach(item => {
      item.addEventListener('click', () => {
        this.state.currentFolder = item.dataset.id;
        this.state.shared = false;
        this.loadAndRender();
      });
    });
  },

  renderFolderNode(f, all) {
    const children = all.filter(i => i.parent_id === f.id && i.parent_id !== null);
    const active = this.state.currentFolder === f.id || (f.id === 'root' && this.state.currentFolder === 'root' && !this.state.shared);
    return `<div class="folder-item${active ? ' active' : ''}" data-id="${f.id}">
      ${icon(f.id === 'root' ? 'folder-open' : 'folder', 'ico-sm')}<span class="alib-fname">${esc(f.name)}</span>
      ${children.length ? `<span style="color:var(--ink-3);font-size:var(--fs-xs)">(${children.length})</span>` : ''}
    </div>${children.map(c => `<div style="padding-left:14px">${this.renderFolderNode(c, all)}</div>`).join('')}`;
  },

  renderAssets() {
    if (this._loading) return;
    const grid = this.root.querySelector('#assetGrid');
    const empty = this.root.querySelector('#astEmpty');
    if (!grid) return;
    this.updateCount();
    grid.classList.toggle('selecting', this.state.selectMode);
    if (!this.state.assets.length) {
      grid.innerHTML = ''; empty.classList.remove('hidden');
      renderPager(this.root.querySelector('#astPager'), { page: 1, total: 0, onPage: () => {} });
      this.updateBatchBar(); return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = this.state.assets.map(a => this.assetCard(a)).join('');
    grid.querySelectorAll('.media-card').forEach(card => {
      card.classList.toggle('sel', this.selected.has(card.dataset.id));
      card.addEventListener('click', e => {
        if (e.target.closest('.media-actions')) return;
        if (e.target.closest('.asset-check')) return;
        if (this.state.selectMode && card.dataset.myPermission !== 'read') { this.toggleSelect(card.dataset.id); return; }
        this.previewAsset(card.dataset.id);
      });
      /* 右击资源弹出快捷菜单 */
      card.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.showContextMenu(e, card.dataset.id);
      });
    });
    grid.querySelectorAll('.asset-check').forEach(box => {
      box.addEventListener('click', e => { e.stopPropagation(); this.toggleSelect(box.dataset.check); });
    });
    /* 鼠标框选：在网格空白或卡片上按住左键拖动，松开后选中框内资产 */
    this.attachBoxSelect(grid);
    grid.querySelectorAll('.asset-del').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (await confirmDlg('确认删除此资产？不可恢复。')) {
          await API.del('/assets/' + id);
          toast('已删除', 'ok');
          this.loadAndRender();
        }
      });
    });
    grid.querySelectorAll('.asset-share').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.shareAsset(btn.dataset.id); });
    });
    renderPager(this.root.querySelector('#astPager'), {
      page: this.state.page, pageSize: this.state.size,
      total: this.state.total != null ? this.state.total : this.state.assets.length,
      onPage: p => this.gotoPage(p)
    });
    this.updateBatchBar();
  },

  /* 鼠标框选(资产库网格):按住左键拖动绘制选框，松开后选中框内全部资产
     选框挂到 body 上使用 fixed 定位，拖动图片时 preventDefault 防止触发原生图片拖拽 */
  attachBoxSelect(grid) {
    if (this._boxCleanup) { this._boxCleanup(); this._boxCleanup = null; }
    let startX = 0, startY = 0, box = null, active = false, moved = false, suppress = false;
    const makeBox = () => {
      if (box) return;
      box = document.createElement('div');
      box.className = 'select-box';
      box.style.position = 'fixed';
      box.style.zIndex = '99999';
      box.style.pointerEvents = 'none';
      document.body.appendChild(box);
    };
    const onDown = e => {
      if (e.button !== 0) return;
      if (e.target.closest('.media-actions') || e.target.closest('.asset-check') || e.target.closest('.asset-share') || e.target.closest('.asset-del')) return;
      e.preventDefault(); // 阻止图片原生拖拽 / 文本选择
      active = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      makeBox();
      box.style.left = startX + 'px';
      box.style.top = startY + 'px';
      box.style.width = '0px'; box.style.height = '0px';
    };
    const onMove = e => {
      if (!active) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      e.preventDefault();
      box.style.left = Math.min(startX, e.clientX) + 'px';
      box.style.top = Math.min(startY, e.clientY) + 'px';
      box.style.width = Math.abs(dx) + 'px';
      box.style.height = Math.abs(dy) + 'px';
    };
    const onUp = e => {
      if (!active) return;
      active = false;
      if (box) { box.remove(); box = null; }
      if (!moved) return;
      suppress = true;
      const bx = Math.min(startX, e.clientX);
      const by = Math.min(startY, e.clientY);
      const bw = Math.abs(e.clientX - startX);
      const bh = Math.abs(e.clientY - startY);
      const next = new Set();
      grid.querySelectorAll('.media-card').forEach(card => {
        if (card.dataset.myPermission === 'read') return;
        const cr = card.getBoundingClientRect();
        const inter = !(cr.right < bx || cr.left > bx + bw || cr.bottom < by || cr.top > by + bh);
        if (inter) next.add(card.dataset.id);
      });
      this.selected = next;
      this.state.selectMode = true;
      this.updateSelectBtn();
      this.applySelectionState();
    };
    const onClickCapture = e => {
      if (suppress) { e.stopPropagation(); e.preventDefault(); suppress = false; }
    };
    grid.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    grid.addEventListener('click', onClickCapture, true);
    this._boxCleanup = () => {
      grid.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      grid.removeEventListener('click', onClickCapture, true);
      if (box) { box.remove(); box = null; }
    };
  },

  /* 右击快捷菜单：打开 / 重命名 / 共享 / 下载 / 删除 */
  showContextMenu(e, id) {
    const a = this.state.assets.find(x => x.id === id);
    if (!a) return;
    const canEdit = a.my_permission !== 'read';
    contextMenu(e, [
      { label: '打开预览', icon: 'eye', onClick: () => this.previewAsset(id) },
      { label: '重命名', icon: 'pencil', disabled: !canEdit, onClick: () => this.renameAsset(id) },
      { sep: true },
      { label: '共享…', icon: 'users', onClick: () => this.shareAsset(id) },
      { label: '下载文件', icon: 'download', onClick: () => download('/api/assets/' + id + '/file', a.name) },
      { sep: true },
      { label: '删除', icon: 'trash-2', danger: true, disabled: !canEdit, onClick: async () => {
          if (await confirmDlg(`确认删除「${a.name}」？不可恢复。`)) {
            await API.del('/assets/' + id);
            toast('已删除', 'ok');
            this.loadAndRender();
          }
        } }
    ]);
  },

  /* 重命名资产 */
  async renameAsset(id) {
    const a = this.state.assets.find(x => x.id === id);
    if (!a) return;
    const vals = await formModal({
      title: '重命名资产',
      fields: [{ key: 'name', label: '资产名称', value: a.name || '', placeholder: '输入新名称(占位符链接按名称匹配，不含扩展名)' }],
      submitText: '保存'
    });
    if (!vals) return;
    const name = String(vals.name || '').trim();
    if (!name || name === a.name) return;
    try {
      const { asset } = await API.patch('/assets/' + id, { name });
      a.name = asset.name;
      toast('已重命名：' + asset.name, 'ok');
      this.renderAssets();
    } catch (e) { toast(e.message, 'err'); }
  },

  assetCard(a) {
    const thumb = a.thumb_path ? '/api/assets/' + a.id + '/thumbnail' : (a.type === 'image' ? '/api/assets/' + a.id + '/file' : '');
    const catIcon = (this.categories.find(c => c.key === a.category) || {}).icon || '';
    const catBadge = a.category
      ? `<span class="tag-cat">${catIcon ? icon(catIcon, 'ico-xs') : ''}${esc(a.category)}</span>`
      : '<span class="tag-cat tag-cat-none">未分类</span>';
    const check = a.my_permission !== 'read'
      ? `<span class="asset-check${this.selected.has(a.id) ? ' on' : ''}" data-check="${a.id}" title="勾选">${icon('check', 'ico-xs')}</span>` : '';
    return `<div class="media-card" data-id="${a.id}" data-my-permission="${a.my_permission || 'owner'}" title="${esc(a.name)}">
      ${check}
      <div class="media-type-badge">${icon(a.type === 'image' ? 'image' : a.type === 'video' ? 'clapperboard' : 'music', 'ico-xs')}</div>
      <div class="media-actions">
        <button class="icon-btn asset-share" data-id="${a.id}" title="共享">${icon('users')}</button>
        <button class="icon-btn asset-del" data-id="${a.id}" title="删除">${icon('trash-2')}</button>
      </div>
      ${thumb ? `<img class="media-thumb" src="${thumb}" loading="lazy">` : `<div class="media-thumb media-thumb-empty">${icon('music')}</div>`}
      <div class="media-body">
        <div class="media-name">${esc(a.name || '未命名')}</div>
        <div class="media-meta">${fmtBytes(a.size)}${a.duration ? ' · ' + fmtDuration(a.duration) : ''}${a.width ? ' · ' + a.width + '×' + a.height : ''} · ${fmtAgo(a.created_at)}</div>
        <div class="media-cat">
          ${catBadge}
          ${a.is_shared ? `<span style="margin-left:6px;font-size:var(--fs-xs);color:var(--ok)">共享自 ${esc(a.shared_by_name || '其他用户')}</span>` : ''}
        </div>
      </div>
    </div>`;
  },

  /* 二十九轮：预览改全站统一成果查看器
     - 翻页上下文 = 当前筛选出的资产列表(← → 直接切换)
     - 底部动作：重命名 / 共享 / 设置分类 / 删除(下载固定在操作条首位) */
  viewerItemOf(a) {
    return {
      id: a.id, name: a.name || '未命名', type: a.type || 'image',
      width: a.width, height: a.height, size: a.size, duration: a.duration,
      created_at: a.created_at,
      meta: [(a.type === 'image' ? '图片' : a.type === 'video' ? '视频' : '音频')
        + (a.category ? ' · ' + a.category : ' · 未分类'),
        a.folder_id && this.state.folders.find(f => f.id === a.folder_id) ? '位于「' + this.state.folders.find(f => f.id === a.folder_id).name + '」' : '']
        .filter(Boolean).join(' · ')
    };
  },

  previewAsset(id) {
    const list = this.state.assets;
    const idx = Math.max(0, list.findIndex(x => x.id === id));
    const a = list[idx];
    if (!a) return;
    const items = list.map(x => this.viewerItemOf(x));
    const canEdit = a.my_permission !== 'read';
    const actions = [];
    if (canEdit) {
      actions.push(
        { label: '重命名', icon: 'pencil', onClick: it => { Viewer.close(); this.renameAsset(it.id); } },
        { label: '设置分类', icon: 'tag', onClick: it => { Viewer.close(); this.categoryAsset(it.id); } },
        { label: '共享…', icon: 'users', onClick: it => { Viewer.close(); this.shareAsset(it.id); } },
        { label: '删除', icon: 'trash-2', danger: true, onClick: async it => {
            if (!await confirmDlg(`确认删除「${it.name}」？文件将永久删除，不可恢复。`)) return;
            Viewer.close();
            try { await API.del('/assets/' + it.id); toast('已删除', 'ok'); this.loadAndRender(); }
            catch (e) { toast(e.message, 'err'); }
          } });
    }
    openViewer(items, idx, { actions });
  },

  /* 单改资产分类(原预览弹窗内的分类下拉迁移到查看器动作) */
  async categoryAsset(id) {
    const a = this.state.assets.find(x => x.id === id);
    if (!a) return;
    const vals = await formModal({
      title: '设置分类 · ' + (a.name || '未命名'),
      fields: [{
        key: 'category', label: '业务分类', type: 'select',
        options: [{ value: '', label: '未分类' }].concat(this.categories.map(c => ({ value: c.key, label: c.key }))),
        value: a.category || ''
      }],
      submitText: '保存'
    });
    if (!vals) return;
    try {
      await API.patch('/assets/' + id, { category: vals.category });
      a.category = vals.category || '';
      toast('分类已更新：' + (vals.category || '未分类'), 'ok');
      this.renderAssets();
    } catch (e) { toast(e.message, 'err'); }
  },

  async shareAsset(id) {
    const vals = await formModal({
      title: '共享资产',
      fields: [
        { key: 'email', label: '用户邮箱', placeholder: '输入对方的邮箱地址', value: '' },
        { key: 'permission', label: '权限', type: 'select', options: [{ value: 'read', label: '只读' }, { value: 'edit', label: '可编辑' }], value: 'read' }
      ],
      submitText: '共享'
    });
    if (!vals) return;
    try {
      await API.post('/assets/' + id + '/share', { email: vals.email, permission: vals.permission });
      toast('共享成功', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  },

  showUploadDialog() {
    const view = this;
    const dz = makeDropzone({
      text: '支持 JPG/PNG/WebP/GIF/MP4/MOV/MP3/WAV, 单文件最大 2GB', multiple: true,
      accept: 'image/*,video/*,audio/*',
      onFiles: async files => {
        const m = openModal({ title: '上传中…', body: '请稍候，正在上传文件', size: 'modal-sm' });
        for (const file of files) {
          try {
            await uploadFile('/assets/upload', file, {
              folder_id: view.state.currentFolder === 'root' ? '' : view.state.currentFolder,
              // 若当前正按具体分类筛选，新上传的素材直接归入该分类
              category: view.categories.some(c => c.key === view.state.category) ? view.state.category : ''
            });
            toast('已上传： ' + file.name, 'ok');
          } catch (e) { toast(file.name + ': ' + e.message, 'err'); }
        }
        m.close();
        view.loadAndRender();
      }
    });
    openModal({ title: '上传资产', body: dz, size: '' });
  }
};
