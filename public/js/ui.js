'use strict';
/* 通用 UI 组件与工具 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function fmtBytes(n) {
  if (n == null || isNaN(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

/* 免费额度余量文案(第三十九轮):额度登记在模型规则 rules.quota,
   已用量按平台内成功任务统计。未登记额度的免费模型返回空串(仍显示「免费」)。 */
function freeQuotaText(m) {
  const q = m && m.free_quota;
  if (!q || !q.declared) return '';
  return '剩 ' + q.remaining + '/' + q.total + (q.unit_text || '');
}

/* 模型下拉项统一文案:名称 + 免费标注(+ 额度余量),复用既有选项文本,不新增界面占位。
   名称里已含「免费」的(如「百炼 Qwen-Image 3.0（免费额度）」)不再重复标注 ——
   下拉宽度有限,重复后缀会把余量挤出可见区。 */
function modelOptionLabel(m) {
  const name = String((m && m.name) || '');
  if (!m || !m.is_free) return name;
  const q = freeQuotaText(m);
  if (name.indexOf('免费') >= 0) return q ? name + ' · ' + q : name;
  return name + '(免费' + (q ? ' · ' + q : '') + ')';
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return '—';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
  return Math.floor(diff / 86400e3) + ' 天前';
}

/* 上游网关的失败原因经常是一整坨响应体 JSON,直接铺进成果卡片就成了一屏代码。
   先抠出 message/detail 这类人话字段,抠不到就按「上游返回 status=queued」概括,
   再退化成截断原文。完整内容留在 title 里,详情面板仍显示原始串。 */
function errBrief(s, max = 90) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return '';
  let txt = raw;
  if (/^[{[]/.test(raw)) {
    try {
      const j = JSON.parse(raw);
      const o = Array.isArray(j) ? j[0] : j;
      const msg = [o && o.error && o.error.message, o && o.error && o.error.msg, o && o.message,
        o && o.msg, o && o.detail, typeof (o && o.error) === 'string' ? o.error : null]
        .find(v => typeof v === 'string' && v.trim());
      const st = o && (o.status || (o.data && o.data[0] && o.data[0].status));
      txt = msg || (st ? `上游返回 status=${st}，未产出结果` : raw);
    } catch (e) { /* 不是合法 JSON:按原文走截断 */ }
  }
  txt = txt.replace(/\s+/g, ' ').trim();
  return txt.length > max ? txt.slice(0, max) + '…' : txt;
}

function toast(msg, type = 'info', ms = 3200) {
  const box = document.getElementById('toastRoot');
  const ico = type === 'ok' ? 'circle-check' : type === 'err' ? 'circle-x' : 'info';
  const t = el(`<div class="toast ${type === 'ok' ? 'ok' : type === 'err' ? 'err' : ''}">${icon(ico, 'toast-ico')}<span>${esc(msg)}</span></div>`);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(12px)'; t.style.transition = 'opacity .3s, transform .3s'; setTimeout(() => t.remove(), 320); }, ms);
}

/* 弹窗 */
function openModal({ title = '', body = '', footer = null, size = '', onClose } = {}) {
  const mask = el(`<div class="modal-mask"><div class="modal ${size}">
    <div class="modal-head"><div class="modal-title">${title}</div>
    <button class="icon-btn modal-x" title="关闭">${icon('x')}</button></div>
    <div class="modal-body"></div>
    ${footer ? '<div class="modal-foot"></div>' : ''}
  </div></div>`);
  const bodyEl = mask.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof HTMLElement) bodyEl.appendChild(body);
  if (footer) {
    const footEl = mask.querySelector('.modal-foot');
    const btns = typeof footer === 'function' ? footer(mask) : footer;
    if (Array.isArray(btns)) btns.forEach(b => footEl.appendChild(b));
  }
  const close = () => { mask.remove(); if (onClose) onClose(); };
  mask.querySelector('.modal-x').addEventListener('click', close);
  mask.addEventListener('click', e => { if (e.target === mask) close(); });
  document.getElementById('modalRoot').appendChild(mask);
  return { mask, close, body: bodyEl };
}

function confirmDlg(message, { title = '确认操作', danger = true, okText = '确认' } = {}) {
  return new Promise(resolve => {
    let confirmed = false; // 关键：onClose 在 m.close() 时同步触发，
    // 若在这里无条件 resolve(false),会抢先于 resolve(true) 落定 Promise,
    // 表现为「点确认后什么都不执行」(如批量审片删除记录)。改为按结果落定。
    const okBtn = el(`<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(okText)}</button>`);
    const cancelBtn = el('<button class="btn">取消</button>');
    const m = openModal({
      title, size: 'modal-sm',
      body: `<div style="line-height:1.7">${esc(message)}</div>`,
      footer: [cancelBtn, okBtn],
      onClose: () => resolve(confirmed)
    });
    okBtn.addEventListener('click', () => { confirmed = true; m.close(); });
    cancelBtn.addEventListener('click', () => m.close());
  });
}

/* 简单表单弹窗 */
function formModal({ title, fields, onSubmit, submitText = '保存', size = '' }) {
  const body = el('<div></div>');
  const inputs = {};
  for (const f of fields) {
    const row = el(`<div class="field"><label>${esc(f.label)}</label></div>`);
    let ctl;
    if (f.type === 'textarea') {
      ctl = el(`<textarea class="textarea" placeholder="${esc(f.placeholder || '')}"></textarea>`);
      ctl.value = f.value || '';
    } else if (f.type === 'select') {
      ctl = el(`<select class="select">${(f.options || []).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`);
      if (f.value) ctl.value = f.value;
    } else {
      ctl = el(`<input class="input" type="${f.type || 'text'}" placeholder="${esc(f.placeholder || '')}">`);
      ctl.value = f.value != null ? f.value : '';
    }
    row.appendChild(ctl);
    if (f.hint) row.appendChild(el(`<div class="hint">${esc(f.hint)}</div>`));
    body.appendChild(row);
    inputs[f.key] = ctl;
  }
  const okBtn = el(`<button class="btn btn-primary">${esc(submitText)}</button>`);
  const cancelBtn = el('<button class="btn">取消</button>');
  return new Promise(resolve => {
    let settled = false;
    const m = openModal({
      title, body, size, footer: [cancelBtn, okBtn],
      onClose: () => { if (!settled) resolve(null); }
    });
    cancelBtn.addEventListener('click', () => m.close());
    okBtn.addEventListener('click', async () => {
      const values = {};
      for (const [k, ctl] of Object.entries(inputs)) values[k] = ctl.value;
      okBtn.disabled = true;
      try {
        const r = onSubmit ? await onSubmit(values, m) : undefined;
        if (r !== false) { settled = true; m.close(); resolve(values); }
        else okBtn.disabled = false;
      } catch (e) { toast(e.message, 'err'); okBtn.disabled = false; }
    });
  });
}

/* 状态徽章 */
function statusBadge(status) {
  const map = { queued: '排队中', processing: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消' };
  const dot = status === 'processing' || status === 'queued' ? '<span class="status-dot"></span>' : '';
  return `<span class="status status-${status}">${dot}${map[status] || status}</span>`;
}

/* 网关排队已满的延后重投:轮询签名里没有 next_at,列表不会为此重绘,
   所以用一个 1 秒定时器只改 [data-wait-until] 文案节点(整表重绘会打断输入) */
function ensureWaitCountdown(holder, root) {
  if (!holder || !root) return;
  const nodes = root.querySelectorAll('[data-wait-until]');
  if (!nodes.length) { stopWaitCountdown(holder); return; }
  if (holder.waitTimer) return;
  holder.waitTimer = setInterval(() => {
    const list = root.querySelectorAll('[data-wait-until]');
    if (!list.length) { stopWaitCountdown(holder); return; }
    list.forEach(n => {
      const sec = Math.ceil((Number(n.dataset.waitUntil) - Date.now()) / 1000);
      n.textContent = sec > 0 ? sec + (n.dataset.waitSuffix || 's 后重试') : '重试提交中…';
    });
  }, 1000);
}
function stopWaitCountdown(holder) {
  if (holder && holder.waitTimer) { clearInterval(holder.waitTimer); holder.waitTimer = null; }
}

/* 头像 */
function avatar(name) {
  return esc((name || 'U').trim().slice(0, 1).toUpperCase());
}

/* 上传拖放区域 */
function makeDropzone({ text = '拖拽文件到此处，或点击选择', multiple = true, accept = '', onFiles }) {
  const dz = el(`<div class="dropzone"><div class="dz-ico">${icon('upload')}</div><div>${esc(text)}</div></div>`);
  const input = el(`<input type="file" style="display:none" ${multiple ? 'multiple' : ''} accept="${esc(accept)}">`);
  dz.appendChild(input);
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  return dz;
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name || '';
  document.body.appendChild(a); a.click(); a.remove();
}

/* 下拉菜单：全局单点委托，避免每个视图各自注册 document 监听造成叠加 */
function closeMenus(except) {
  document.querySelectorAll('.menu-pop').forEach(p => { if (p !== except) p.classList.add('hidden'); });
}
function bindMenu(btn, pop) {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const wasHidden = pop.classList.contains('hidden');
    closeMenus();
    pop.classList.toggle('hidden', !wasHidden);
  });
  pop.addEventListener('click', () => pop.classList.add('hidden'));
}
document.addEventListener('click', () => closeMenus());

/* 右击快捷菜单
   items: [{ label, icon?, danger?, disabled?, onClick }...] */
function contextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.ctx-menu').forEach(x => x.remove());
  const menu = el(`<div class="ctx-menu"></div>`);
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.appendChild(el('<div class="ctx-sep"></div>')); continue; }
    const btn = el(`<button class="ctx-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}">
      ${it.icon ? icon(it.icon, 'ico-sm') : '<span class="ctx-ico-ph"></span>'}<span>${esc(it.label)}</span></button>`);
    if (!it.disabled) btn.addEventListener('click', () => { close(); it.onClick && it.onClick(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(e.clientX, window.innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - r.height - 8) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('click', close); window.removeEventListener('blur', close); };
  setTimeout(() => {
    document.addEventListener('click', close);
    window.addEventListener('blur', close);
  }, 0);
}

/* ---------- 列表分页(项目优化 26·1):资源/素材类列表统一每页 20 条 ---------- */
const PAGE_SIZE = 20;

/* 列数算式与 CSS 的 repeat(auto-fill, minmax(var(--card-min), 1fr)) 保持一致:
   每页排满整数行,20 条按 6 列排剩 4 个空格的问题就没了(32·需求三十一续) */
const PAGE_ROWS = 4;
function gridCols(el, minVar) {
  if (!el) return 0;
  const w = el.clientWidth; if (!w) return 0;
  const root = getComputedStyle(document.documentElement);
  const min = parseFloat(root.getPropertyValue(minVar)) || 220;
  const cs = getComputedStyle(el);
  const gap = parseFloat(cs.columnGap || cs.gap) || 20;
  return Math.max(1, Math.floor((w + gap) / (min + gap)));
}
function gridPageSize(el, minVar, fallback) {
  const n = gridCols(el, minVar);
  return n >= 2 ? n * PAGE_ROWS : (fallback || PAGE_SIZE);
}

/* 把分页控件画进 box:共 N 条 · 第 x/y 页 · 上一页/页码/下一页
   只有一页时清空控件(不留常驻占位)。o = { page, pageSize, total, onPage } */
function renderPager(box, o) {
  if (!box) return;
  const pageSize = Math.max(1, Number(o.pageSize) || PAGE_SIZE);
  const total = Math.max(0, Number(o.total) || 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number(o.page) || 1), pages);
  box.classList.add('pager');
  box.innerHTML = '';
  if (pages <= 1) return;
  const btn = (label, opts) => {
    const b = el(`<button class="pg-btn${opts && opts.on ? ' on' : ''}"${opts && opts.disabled ? ' disabled' : ''}>${label}</button>`);
    if (opts && opts.onClick && !opts.disabled) b.addEventListener('click', opts.onClick);
    return b;
  };
  box.appendChild(el(`<span class="pager-info">共 <b class="gold-num">${total}</b> 条 · 每页 ${pageSize} 条</span>`));
  box.appendChild(btn(icon('chevron-left', 'ico-xs') + '上一页', { disabled: page <= 1, onClick: () => o.onPage(page - 1) }));
  /* 页码窗口:首、尾、当前页 ±1,中间用省略号 */
  const nums = [...new Set([1, pages, page - 1, page, page + 1])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) box.appendChild(el('<span class="pg-gap">…</span>'));
    box.appendChild(btn(String(n), { on: n === page, onClick: () => n !== page && o.onPage(n) }));
    prev = n;
  }
  box.appendChild(btn('下一页' + icon('chevron-right', 'ico-xs'), { disabled: page >= pages, onClick: () => o.onPage(page + 1) }));
}

/* ---------- 生图输出规格(项目优化 26·3):分辨率档 + 画幅比例 → 尺寸预览 ----------
   与服务端 server/api/images.js 的 resolutionToPx / deriveSize 同一口径 */
const IMG_RES_TIERS = ['1K', '2K', '4K'];
const IMG_RES_LABELS = { '1K': '1K · 1024 短边，日常出图', '2K': '2K · 2048 短边，高清', '4K': '4K · 4096 短边，超清' };
const RES_SHORT_EDGE = { '1K': 1024, '2K': 2048, '4K': 4096 };

function resTierToPx(v) {  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return 0;
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*k/.exec(s);
  if (m) return Math.round(parseFloat(m[1]) * 1024);
  const px = Math.round(Number(s));
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/* 档位 → 下拉里的可读文案:1K/2K/4K 用行业叫法,历史数字档退回「Npx 短边」 */
function resTierLabel(v) {
  const s = String(v == null ? '' : v).trim();
  const up = s.toUpperCase();
  if (IMG_RES_LABELS[up]) return IMG_RES_LABELS[up];
  const px = resTierToPx(s);
  return px ? px + 'px 短边 · ' + (px >= 2048 ? '高清' : px >= 1024 ? '标准' : '草稿') : s;
}

/* 比例 × 分辨率档 → { w, h }(偶数,长边不超过 4096);比例解析失败按 1:1 */
function imgSizeFrom(ratio, res) {
  let short = resTierToPx(res) || 1024;
  short = Math.max(64, Math.min(4096, short));
  const m = /^([0-9.]+)\s*[:x/／]\s*([0-9.]+)$/.exec(String(ratio || '').trim());
  let rw = 1, rh = 1;
  if (m) { const a = parseFloat(m[1]), b = parseFloat(m[2]); if (a > 0 && b > 0) { rw = a; rh = b; } }
  let w = rw >= rh ? short * rw / rh : short;
  let h = rw >= rh ? short : short * rh / rw;
  const over = Math.max(w, h) / 4096;
  if (over > 1) { w /= over; h /= over; }
  const even = v => Math.max(16, Math.round(v / 2) * 2);
  return { w: even(w), h: even(h) };
}

/* ---------- 视频出片规格(项目优化 26·5):分辨率档 × 画幅 → 成片宽高 ----------
   与 server/ffmpeg.js 的 videoWH 同一口径 */
const VIDEO_RES_EDGES = { '480p': 480, '720p': 720, '960p': 960, '1080p': 1080, '2k': 1440, '4k': 2160 };
const VIDEO_RATIOS = [
  { v: '16:9', t: '16:9 · 横屏' }, { v: '9:16', t: '9:16 · 竖屏' },
  { v: '4:3', t: '4:3 · 横屏' }, { v: '3:4', t: '3:4 · 竖屏' },
  { v: '1:1', t: '1:1 · 方屏' }, { v: '21:9', t: '21:9 · 影院宽幅' }
];
/* 分辨率档 → 下拉文案:附带按 16:9 换算出的成片尺寸,选了才知道出多大 */
const VIDEO_RES_NOTES = { '480p': '标清 · 草稿预览', '720p': '高清 · 通用推荐', '960p': '准高清 · 清晰与速度兼顾', '1080p': '全高清', '2k': '2K · 成品出片', '4k': '4K · 成品出片' };
function videoResLabel(v) {
  const key = String(v || '').trim().toLowerCase();
  const wh = videoWH(key, '16:9');
  const note = VIDEO_RES_NOTES[key] || '';
  return String(v || '').toUpperCase() + ' · ' + wh.w + '×' + wh.h + (note ? '(' + note + ')' : '');
}

function videoWH(resolution, aspectRatio) {
  let short = VIDEO_RES_EDGES[String(resolution || '').trim().toLowerCase()] || 720;
  const m = /^([0-9.]+)\s*[:x/／]\s*([0-9.]+)$/.exec(String(aspectRatio || '').trim());
  let rw = 16, rh = 9;
  if (m) { const a = parseFloat(m[1]), b = parseFloat(m[2]); if (a > 0 && b > 0) { rw = a; rh = b; } }
  const even = v => Math.max(2, Math.round(v / 2) * 2);
  const long = Math.max(rw, rh), side = Math.min(rw, rh);
  if (short * long / side > 4096) short = Math.floor(4096 * side / long);
  return rw >= rh ? { w: even(short * rw / rh), h: even(short) } : { w: even(short), h: even(short * rh / rw) };
}

/* 返回顶部浮标：长列表页滚动超过 600px 后出现(捕获阶段监听各滚动容器) */
(function () {
  function init() {
    if (document.getElementById('toTopBtn')) return;
    const btn = el('<button class="to-top" id="toTopBtn" title="返回顶部">' + icon('arrow-up') + '</button>');
    document.body.appendChild(btn);
    btn.addEventListener('click', () => {
      const c = document.querySelector('.content');
      if (c) c.scrollTo({ top: 0, behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      document.querySelectorAll('.wb-canvas, .ws-main').forEach(x => x.scrollTo({ top: 0, behavior: 'smooth' }));
    });
    window.addEventListener('scroll', () => {
      const doc = document.scrollingElement;
      let show = !!(doc && doc.scrollTop > 600);
      if (!show) show = Array.prototype.some.call(
        document.querySelectorAll('.content, .wb-canvas, .ws-main'),
        x => x.scrollTop > 600
      );
      btn.classList.toggle('show', show);
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();