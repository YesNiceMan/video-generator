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
    let confirmed = false; // 关键:onClose 在 m.close() 时同步触发,
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

/* 头像 */
function avatar(name) {
  return esc((name || 'U').trim().slice(0, 1).toUpperCase());
}

/* 面包屑:项目分集 → 分集列表 → 视频创作
   items: [{ label, href?, title?, tag? }],最后一项为当前页(不可点) */
function breadcrumb(items, opts = {}) {
  let html = '';
  items.forEach((it, i) => {
    if (i) html += '<i class="crumb-sep">/</i>';
    if (it.href && i < items.length - 1) {
      html += `<a href="${it.href}" title="${esc(it.title || it.label)}">${esc(it.label)}</a>`;
    } else {
      html += `<span class="crumb-cur">${it.tag ? `<span class="crumb-tag">${esc(it.tag)}</span>` : ''}${esc(it.label)}</span>`;
    }
  });
  return `<nav class="crumb${opts.cls ? ' ' + opts.cls : ''}">${html}</nav>`;
}

/* 上传拖放区域 */
function makeDropzone({ text = '拖拽文件到此处,或点击选择', multiple = true, accept = '', onFiles }) {
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

/* 音频波形(基于 Web Audio 解码) */
async function drawWaveform(container, url) {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const canvas = container;
    canvas.width = canvas.clientWidth * 2;
    canvas.height = canvas.clientHeight * 2;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(255,207,77,.4)';
    const step = Math.floor(data.length / 140);
    for (let i = 0; i < 140; i++) {
      const s = data[i * step];
      const h = Math.abs(s) * canvas.height * 0.9;
      g.fillRect(i * (canvas.width / 140), (canvas.height - h) / 2, canvas.width / 140 - 2, h);
    }
    ctx.close();
  } catch (e) { /* 忽略解码失败 */ }
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name || '';
  document.body.appendChild(a); a.click(); a.remove();
}

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

/* 返回顶部浮标:长列表页滚动超过 600px 后出现(捕获阶段监听各滚动容器) */
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