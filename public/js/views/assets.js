'use strict';
/* 资产库:文件夹树 + 分类筛选(角色/场景/物品/分镜/音频/视频) + 资产网格 + 多选批量分类 + 上传/预览/共享 */
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

  state: { folders: [], assets: [], currentFolder: null, type: 'all', category: 'all', q: '', shared: false, selectMode: false },

  async render(root) {
    root.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    this.root = root;
    this.state.currentFolder = 'root';
    this.state.selectMode = false;
    this.selected = new Set();
    await this.load();
    this.renderUI();
  },

  async load() {
    const [folderRes, assetRes] = await Promise.all([
      API.get('/assets/folders'),
      API.get('/assets?folder_id=' + (this.state.currentFolder || 'root')
        + '&type=' + this.state.type
        + '&category=' + encodeURIComponent(this.state.category)
        + '&q=' + encodeURIComponent(this.state.q))
    ]);
    this.state.folders = folderRes.items;
    this.state.assets = assetRes.items;
    if (this.selected) for (const id of [...this.selected]) if (!assetRes.items.some(a => a.id === id)) this.selected.delete(id);
  },

  renderUI() {
    const h = this.root;
    h.innerHTML = `
    <div class="toolbar">
      <div class="search-box">${icon('search', 'search-ico')}<input class="input" id="astSearch" placeholder="搜索资产名称…" value="${esc(this.state.q)}"></div>
      <select class="select" id="astTypeFilter" style="width:auto">
        <option value="all">全部类型</option>
        <option value="image">图片</option>
        <option value="video">视频</option>
        <option value="audio">音频</option>
      </select>
      <button class="btn btn-ghost" id="astSharedBtn">${this.state.shared ? iconText('share-2', '共享给我') : iconText('folder', '我的资产')}</button>
      <div class="grow"></div>
      <button class="btn" id="astAutoCatBtn" title="按文件类型与文件名关键词,给未分类的资产自动归类">${iconText('wand-2', '自动分类')}</button>
      <button class="btn" id="astSelectAllBtn" title="选中当前筛选出的全部资产">${iconText('check-check', '全选')}</button>
      <button class="btn${this.state.selectMode ? ' btn-primary' : ''}" id="astSelectBtn">${iconText('square-check-big', this.state.selectMode ? '退出选择' : '选择分类')}</button>
      <button class="btn btn-primary" id="astUploadBtn">${iconText('upload', '上传')}</button>
    </div>
    <div class="cat-chips" id="catChips"></div>
    <div style="display:flex;gap:16px;align-items:start">
      <div style="width:200px;flex-shrink:0">
        <div class="card" style="padding:10px">
          <div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px;padding:0 8px">文件夹</div>
          <div class="folder-tree" id="folderTree"></div>
          <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" id="newFolderBtn" style="width:100%">${iconText('plus', '新建文件夹')}</button></div>
        </div>
      </div>
      <div style="flex:1;min-width:0">
        <div class="grid grid-cards" id="assetGrid"></div>
        <div id="astEmpty" class="hidden empty"><div class="empty-ico">${icon('folder-open')}</div><h3>暂无资产</h3><p>点击"上传"或拖拽文件到本页面</p></div>
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

    // 搜索
    h.querySelector('#astSearch').addEventListener('input', () => {
      this.state.q = h.querySelector('#astSearch').value;
      this.loadAndRender();
    });
    h.querySelector('#astTypeFilter').addEventListener('change', () => {
      this.state.type = h.querySelector('#astTypeFilter').value;
      this.loadAndRender();
    });
    h.querySelector('#astSharedBtn').addEventListener('click', () => {
      this.state.shared = !this.state.shared;
      if (this.state.shared) this.loadShared();
      else this.loadAndRender();
    });
    h.querySelector('#astUploadBtn').addEventListener('click', () => this.showUploadDialog());
    h.querySelector('#astAutoCatBtn').addEventListener('click', () => this.autoCategorize());
    h.querySelector('#astSelectAllBtn').addEventListener('click', () => this.selectAllAssets());
    h.querySelector('#astSelectBtn').addEventListener('click', () => this.toggleSelectMode());

    h.querySelector('#astBatchApply').addEventListener('click', () => this.applyBatchCategory());
    h.querySelector('#astBatchDel').addEventListener('click', () => this.applyBatchDelete());
    h.querySelector('#astBatchCancel').addEventListener('click', () => { this.toggleSelectMode(false); });

    this.root.querySelector('#newFolderBtn').addEventListener('click', async () => {
      const vals = await formModal({
        title: '新建文件夹',
        fields: [{ key: 'name', label: '文件夹名称', placeholder: '输入名称', value: '' }],
        submitText: '创建'
      });
      if (vals) {
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
    btn.classList.toggle('btn-primary', this.state.selectMode);
    btn.innerHTML = iconText('square-check-big', this.state.selectMode ? '退出选择' : '选择分类');
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

  /* 全选:选中当前筛选(类型/分类/文件夹/搜索)下的全部可编辑资产 */
  selectAllAssets() {
    const selectable = this.state.assets.filter(a => a.my_permission !== 'read');
    this.selected = new Set(selectable.map(a => a.id));
    this.state.selectMode = true;
    this.updateSelectBtn();
    this.applySelectionState();
    toast(`已全选 ${this.selected.size} 项资产`, 'ok');
  },

  /* 批量删除选中资产 */
  async applyBatchDelete() {
    const ids = [...this.selected];
    if (!ids.length) return toast('请先勾选要删除的资产', 'err');
    if (!await confirmDlg(`确认删除选中的 ${ids.length} 项资产?文件将永久删除,不可恢复。`)) return;
    try {
      const res = await API.post('/assets/batch-delete', { ids });
      if (res.deleted) toast(`已删除 ${res.deleted} 项资产${res.errors ? `,${res.errors} 项失败` : ''}`, res.errors ? 'err' : 'ok');
      else toast('没有可删除的资产', 'err');
      this.toggleSelectMode(false);
      this.loadAndRender();
    } catch (e) { toast(e.message, 'err'); }
  },

  /* 自动分类:按文件类型/文件名关键词给未分类资产自动归类 */
  async autoCategorize() {
    const btn = this.root.querySelector('#astAutoCatBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = icon('loader', 'ico-xs') + ' 分类中…'; }
    try {
      const res = await API.post('/assets/auto-categorize', {});
      if (!res.updated) {
        toast(res.scanned ? '没有需要自动分类的资产(未分类资产已全部归类)' : '自动分类完成', res.scanned ? 'ok' : 'ok');
      } else {
        const parts = Object.entries(res.summary || {}).map(([k, v]) => k + '×' + v).join(' · ');
        toast(`已自动分类 ${res.updated} 项资产${parts ? ' (' + parts + ')' : ''}`, 'ok');
      }
      this.loadAndRender();
    } catch (e) { toast(e.message, 'err'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = iconText('wand-2', '自动分类'); } }
  },

  async loadAndRender() {
    await this.load();
    this.renderFolders();
    this.renderAssets();
  },

  async loadShared() {
    const res = await API.get('/assets/shared-with-me');
    this.state.assets = res.items;
    this.renderAssets();
  },

  renderFolders() {
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
    return `<div class="folder-item${active ? ' active' : ''}" data-id="${f.id}" style="cursor:pointer;padding:6px 8px;border-radius:6px;font-size:13px;display:flex;align-items:center;gap:6px;margin:1px 0;${f.id === 'root' ? '' : 'padding-left:28px'}">
      ${icon(f.id === 'root' ? 'folder-open' : 'folder', 'ico-sm')}<span>${esc(f.name)}</span>
      ${children.length ? `<span style="color:var(--text-faint);font-size:11px">(${children.length})</span>` : ''}
    </div>${children.map(c => this.renderFolderNode(c, all)).join('')}`;
  },

  renderAssets() {
    const grid = this.root.querySelector('#assetGrid');
    const empty = this.root.querySelector('#astEmpty');
    if (!grid) return;
    if (!this.state.assets.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); this.updateBatchBar(); return; }
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
    /* 鼠标框选:在网格空白或卡片上按住左键拖动,松开后选中框内资产 */
    this.attachBoxSelect(grid);
    grid.querySelectorAll('.asset-del').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (await confirmDlg('确认删除此资产?不可恢复。')) {
          await API.del('/assets/' + id);
          toast('已删除', 'ok');
          this.loadAndRender();
        }
      });
    });
    grid.querySelectorAll('.asset-share').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.shareAsset(btn.dataset.id); });
    });
    this.updateBatchBar();
  },

  /* 鼠标框选(资产库网格):按住左键拖动绘制选框,松开后选中框内全部资产
     选框挂到 body 上使用 fixed 定位,拖动图片时 preventDefault 防止触发原生图片拖拽 */
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

  /* 右击快捷菜单:打开 / 重命名 / 共享 / 下载 / 删除 */
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
          if (await confirmDlg(`确认删除「${a.name}」?不可恢复。`)) {
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
      fields: [{ key: 'name', label: '资产名称', value: a.name || '', placeholder: '输入新名称(占位符链接按名称匹配,不含扩展名)' }],
      submitText: '保存'
    });
    if (!vals) return;
    const name = String(vals.name || '').trim();
    if (!name || name === a.name) return;
    try {
      const { asset } = await API.patch('/assets/' + id, { name });
      a.name = asset.name;
      toast('已重命名:' + asset.name, 'ok');
      this.renderAssets();
    } catch (e) { toast(e.message, 'err'); }
  },

  assetCard(a) {
    const thumb = a.thumb_path ? '/api/assets/' + a.id + '/thumbnail' : (a.type === 'image' ? '/api/assets/' + a.id + '/file' : '');
    const catIcon = (this.categories.find(c => c.key === a.category) || {}).icon || '';
    const catBadge = a.category
      ? `<span class="tag tag-cat">${catIcon ? icon(catIcon, 'ico-xs') : ''}${esc(a.category)}</span>`
      : `<span class="tag tag-cat tag-cat-none">未分类</span>`;
    const check = a.my_permission !== 'read'
      ? `<span class="asset-check${this.selected.has(a.id) ? ' on' : ''}" data-check="${a.id}" title="勾选">${icon('check', 'ico-xs')}</span>` : '';
    return `<div class="media-card" data-id="${a.id}" data-my-permission="${a.my_permission || 'owner'}">
      ${check}
      <div class="media-type-badge">${icon(a.type === 'image' ? 'image' : a.type === 'video' ? 'clapperboard' : 'music', 'ico-xs')}</div>
      <div class="media-actions">
        <button class="icon-btn asset-share" data-id="${a.id}" title="共享">${icon('users')}</button>
        <button class="icon-btn asset-del" data-id="${a.id}" title="删除">${icon('trash-2')}</button>
      </div>
      ${thumb ? `<img class="media-thumb" src="${thumb}" loading="lazy">` : `<div class="media-thumb media-thumb-empty">${icon('music')}</div>`}
      <div class="media-body">
        <div class="media-name">${esc(a.name || '未命名')}</div>
        <div class="media-meta">${fmtBytes(a.size)}${a.duration ? ' · ' + fmtDuration(a.duration) : ''}${a.width ? ' · ' + a.width + '×' + a.height : ''}${a.created_at ? ' · ' + fmtTime(a.created_at) : ''}</div>
        <div class="media-cat">${catBadge}</div>
        ${a.is_shared ? `<div style="font-size:10px;color:var(--accent-2);margin-top:2px">共享自 ${esc(a.shared_by_name || '其他用户')}</div>` : ''}
      </div>
    </div>`;
  },

  async previewAsset(id) {
    const a = this.state.assets.find(x => x.id === id);
    if (!a) return;
    const fileUrl = '/api/assets/' + id + '/file';
    const thumb = a.thumb_path ? '/api/assets/' + id + '/thumbnail' : (a.type === 'image' ? fileUrl : '');
    let mediaHtml = '';
    if (a.type === 'image') mediaHtml = `<img class="preview-media" src="${fileUrl}" style="max-height:50vh">`;
    else if (a.type === 'video') mediaHtml = `<video class="preview-media" src="${fileUrl}" controls style="max-height:50vh"></video>`;
    else if (a.type === 'audio') mediaHtml = `<audio src="${fileUrl}" controls style="width:100%"></audio>`;
    const catOptions = ['<option value="">未分类</option>']
      .concat(this.categories.map(c => `<option value="${c.key}" ${a.category === c.key ? 'selected' : ''}>${c.key}</option>`))
      .join('');
    const canEdit = a.my_permission !== 'read';
    const catRow = canEdit
      ? `<div class="preview-info" style="margin-top:8px;display:flex;align-items:center;gap:8px">
          <b>分类:</b>
          <select class="select" id="pvCat" style="width:auto">${catOptions}</select>
          <span class="hint" style="font-size:11px;color:var(--text-faint)">更改后立即保存,可在工作台按分类引用</span>
        </div>` : '';
    const m = openModal({
      title: esc(a.name),
      size: 'modal-lg',
      body: `<div style="text-align:center">${mediaHtml}</div>
        ${catRow}
        <div class="preview-info">
          <b>类型:</b> ${a.type} · <b>大小:</b> ${fmtBytes(a.size)}${a.width ? ' · <b>尺寸:</b> ' + a.width + '×' + a.height : ''}${a.duration ? ' · <b>时长:</b> ' + fmtDuration(a.duration) : ''}${a.created_at ? ' · <b>上传时间:</b> ' + fmtTime(a.created_at) : ''}<br>
          <b>路径:</b> ${esc(a.folder_id && this.state.folders.find(f => f.id === a.folder_id) ? this.state.folders.find(f => f.id === a.folder_id).name : '根目录')}<br>
          ${a.tags && a.tags.length ? '<b>标签:</b> ' + a.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('') : ''}
          <div style="margin-top:10px;display:flex;gap:8px">
            <a class="btn btn-sm btn-primary" href="${fileUrl}" target="_blank">${iconText('download', '下载文件')}</a>
            ${canEdit ? `<button class="btn btn-sm" id="renameBtn">${iconText('pencil', '重命名')}</button>` : ''}
            <button class="btn btn-sm" id="shareBtn">${iconText('users', '共享')}</button>
            <button class="btn btn-sm btn-danger" id="delBtn">${iconText('trash-2', '删除')}</button>
          </div>
        </div>`,
      onClose: () => {}
    });
    if (canEdit) m.body.querySelector('#pvCat')?.addEventListener('change', async e => {
      try {
        await API.patch('/assets/' + id, { category: e.target.value });
        a.category = e.target.value;
        toast('分类已更新:' + (e.target.value || '未分类'), 'ok');
        this.renderAssets();
      } catch (err) { toast(err.message, 'err'); }
    });
    m.body.querySelector('#shareBtn')?.addEventListener('click', () => { m.close(); this.shareAsset(id); });
    m.body.querySelector('#renameBtn')?.addEventListener('click', async () => {
      const old = a.name;
      m.close();
      await this.renameAsset(id);
      if (a.name === old && this.state.assets.some(x => x.id === id)) this.previewAsset(id);
    });
    m.body.querySelector('#delBtn')?.addEventListener('click', async () => {
      m.close();
      if (await confirmDlg('确认删除此资产?')) {
        await API.del('/assets/' + id);
        toast('已删除', 'ok');
        this.loadAndRender();
      }
    });
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
    if (vals) {
      await API.post('/assets/' + id + '/share', { email: vals.email, permission: vals.permission });
      toast('共享成功', 'ok');
    }
  },

  showUploadDialog() {
    const view = this;
    const dz = makeDropzone({
      text: '支持 JPG/PNG/WebP/GIF/MP4/MOV/MP3/WAV, 单文件最大 2GB', multiple: true,
      accept: 'image/*,video/*,audio/*',
      onFiles: async files => {
        const m = openModal({ title: '上传中…', body: '请稍候,正在上传文件', size: 'modal-sm' });
        for (const file of files) {
          try {
            await uploadFile('/assets/upload', file, {
              folder_id: view.state.currentFolder === 'root' ? '' : view.state.currentFolder,
              // 若当前正按具体分类筛选,新上传的素材直接归入该分类
              category: view.categories.some(c => c.key === view.state.category) ? view.state.category : ''
            });
            toast('已上传: ' + file.name, 'ok');
          } catch (e) { toast(file.name + ': ' + e.message, 'err'); }
        }
        m.close();
        view.loadAndRender();
      }
    });
    openModal({ title: '上传素材', body: dz, size: '' });
  }
};
