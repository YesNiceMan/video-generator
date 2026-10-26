'use strict';
/* 全局统一成果查看器(第二十九轮 · 全站「结果查看」统一)
 * 黑场沉浸式预览：图片点击缩放 / 视频播放 / 音频播放器，
 * 键盘 ← → 循环翻页、Esc 关闭、点空白处关闭；底部操作条 = 下载 + 调用方注入的自定义动作。
 * 全站入口：AI 生图结果、分镜生成视频、批量审片、工作日志、资产库、首页最近成果。
 * items: [{ id, name, type:'image'|'video'|'audio', url?, poster?, meta?, tag?,
 *           width?, height?, size?, duration?, created_at? }]
 * opts : { actions:[{ label, icon, primary?, danger?, onClick(item, Viewer) }], onClose? } */
const Viewer = {
  _mask: null, _items: [], _idx: 0, _opts: {}, _keyHandler: null,

  open(items, index, opts) {
    /* 先在局部变量里备好本次数据再 teardown:close() 会清空上一轮的 items/opts */
    const list = (items || []).filter(it => it && (it.id || it.url));
    if (!list.length) return;
    const o = opts || {};
    this._teardown();
    this._items = list;
    this._opts = o;
    this._idx = Math.max(0, Math.min(Number(index) || 0, this._items.length - 1));
    const mask = el(
      '<div class="viewer-mask" role="dialog" aria-label="成果查看">'
      + '<div class="viewer-top">'
      +   '<div class="viewer-title pv-meta"><span class="viewer-name pv-name"></span><span class="viewer-meta"></span></div>'
      +   '<span class="viewer-count"></span>'
      +   '<button class="viewer-x" title="关闭 (Esc)">' + icon('x') + '</button>'
      + '</div>'
      + '<button class="viewer-nav viewer-prev" title="上一张 (←)">' + icon('chevron-left') + '</button>'
      + '<button class="viewer-nav viewer-next" title="下一张 (→)">' + icon('chevron-right') + '</button>'
      + '<div class="viewer-stage"></div>'
      + '<div class="viewer-foot"><div class="viewer-tag"></div><div class="viewer-actions"></div></div>'
      + '</div>');
    this._mask = mask;
    mask.querySelector('.viewer-x').addEventListener('click', () => this.close());
    /* 点空白处关闭:此前只有遮罩最外圈(e.target === mask)能点关,而舞台铺满中间区域,
       看图时点图片上下的空白毫无反应 —— 现在把「舞台里的空白」也算外面(媒体本身/操作条/翻页键除外) */
    mask.addEventListener('mousedown', e => {
      if (e.target === mask) { this.close(); return; }
      if (!e.target.closest('.viewer-stage')) return;
      if (e.target.closest('.viewer-media, .viewer-audio svg, audio, video, button, a')) return;
      this.close();
    });
    mask.querySelector('.viewer-prev').addEventListener('click', () => this.step(-1));
    mask.querySelector('.viewer-next').addEventListener('click', () => this.step(1));
    document.body.appendChild(mask);
    document.documentElement.classList.add('viewer-open');
    this._keyHandler = e => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
    };
    document.addEventListener('keydown', this._keyHandler);
    this.paint();
  },

  /* 拆除当前实例(遮罩 / 键盘监听 / 状态),并触发 onClose 回调 */
  _teardown() {
    if (this._mask) { this._mask.remove(); this._mask = null; }
    document.documentElement.classList.remove('viewer-open');
    if (this._keyHandler) { document.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    const cb = this._opts && this._opts.onClose;
    this._opts = {};
    this._items = [];
    if (typeof cb === 'function') { try { cb(); } catch (e) { /* 忽略 */ } }
  },

  close() { this._teardown(); },

  isOpen() { return !!this._mask; },

  step(d) {
    const n = this._items.length;
    if (n < 2) return;
    this._idx = (this._idx + d + n) % n;
    this.paint();
  },

  cur() { return this._items[this._idx] || null; },

  urlOf(it) { return it.url || ('/api/assets/' + it.id + '/file'); },

  metaOf(it) {
    if (it.meta) return it.meta;
    const parts = [];
    parts.push(it.type === 'image' ? '图片' : it.type === 'video' ? '视频' : it.type === 'audio' ? '音频' : '文件');
    if (it.width && it.height) parts.push(it.width + '×' + it.height);
    if (it.duration != null && it.type !== 'image') parts.push(fmtDuration(it.duration));
    if (it.size != null) parts.push(fmtBytes(it.size));
    if (it.created_at) parts.push(fmtTime(it.created_at));
    return parts.filter(Boolean).join(' · ');
  },

  paint() {
    const mask = this._mask; if (!mask) return;
    const it = this.cur(); if (!it) return;
    const n = this._items.length;
    mask.querySelector('.viewer-name').textContent = it.name || '未命名';
    mask.querySelector('.viewer-meta').textContent = this.metaOf(it);
    mask.querySelector('.viewer-count').textContent = n > 1 ? (this._idx + 1) + ' / ' + n : '';
    mask.querySelector('.viewer-tag').innerHTML = it.tag
      ? '<span class="pv-tag">' + icon('circle-check', 'ico-xs') + esc(it.tag) + '</span>' : '';
    mask.querySelector('.viewer-prev').style.display = n > 1 ? '' : 'none';
    mask.querySelector('.viewer-next').style.display = n > 1 ? '' : 'none';

    const stage = mask.querySelector('.viewer-stage');
    stage.innerHTML = '';
    const url = this.urlOf(it);
    if (it.type === 'video') {
      const v = el('<video class="viewer-media pv-media" src="' + esc(url) + '" controls autoplay playsinline preload="metadata"></video>');
      if (it.poster) v.setAttribute('poster', it.poster);
      stage.appendChild(v);
    } else if (it.type === 'audio') {
      const box = el('<div class="viewer-audio">' + icon('music') + '</div>');
      box.appendChild(el('<audio class="pv-media" src="' + esc(url) + '" controls autoplay></audio>'));
      stage.appendChild(box);
    } else {
      const img = el('<img class="viewer-media pv-media" src="' + esc(url) + '" alt="" draggable="false">');
      img.addEventListener('click', () => img.classList.toggle('zoomed'));
      stage.appendChild(img);
    }

    const acts = mask.querySelector('.viewer-actions');
    acts.innerHTML = '';
    acts.appendChild(el('<a class="viewer-act" href="' + esc(url) + '" download="' + esc(it.name || '') + '" title="下载原文件">'
      + icon('download') + '<span>下载</span></a>'));
    for (const a of (this._opts.actions || [])) {
      if (!a || !a.label) continue;
      const b = el('<button class="viewer-act' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') + '">'
        + (a.icon ? icon(a.icon) : '') + '<span>' + esc(a.label) + '</span></button>');
      b.addEventListener('click', () => { try { a.onClick && a.onClick(it, this); } catch (e) { toast(e.message, 'err'); } });
      acts.appendChild(b);
    }
  }
};
function openViewer(items, index, opts) { return Viewer.open(items, index, opts); }
