'use strict';
/* 提示词占位符自动链接
   在文本域中输入 [资产名](如 [女主]),若「参考资产」存在同名资源(忽略扩展名)则自动建立链接,
   匹配的 "[]" 会高亮显示;通过镜像层实现 textarea 内 token 高亮。

   修复(v2):
   - 高亮错位:镜像层宽高严格对齐 textarea 内容区(clientWidth/clientHeight + 边框),
     内容超出时不再向下溢出到文本框外部;
   - 滑动跟随:镜像层高度固定为 textarea 可视区高度,滚动时同步 scrollTop/scrollLeft;
   - 更新显示风格:成功链接 → 金色来源下划线胶囊;未链接 → 灰色虚线;
   - 链接来源显示:悬停高亮占位符显示其来源资产名,点击高亮对应参考资产并自动滚动到位;
   - 重名文件处理:同名资产均匹配,去重显示
   - 可用占位提示仅显示左侧参考资产列表中的素材,而非全部资产库
   - 点击链接占位符可高亮对应参考资产(左侧面板闪动)

   二十二(视频创作优化):
   - 22·1 参考资产门控:仅「已引入左侧参考资产」的素材可被 [占位符] 引用;
     资产库里有同名但未引入的一律按未链接渲染(虚线),悬停提示先引入再引用;
   - 22·3 引用字体与形状放大:芯片名 13.5→11px 逐级取最大可容字号,
     窄令牌内缩略图为名字让位(空间足够才显示图),垂直内边距加高芯片形状(不影响占宽)。

   用法:
     const pl = attachPlaceholderLinker(textareaEl, () => refAssetsArray, () => allAssetsArray);
       参数2:getRefAssets  — 参与链接匹配的资产(左侧「参考资产」);
       参数3:getAllAssets — 可选,全部资产库(仅用于「未引入」提示,不参与链接);
     pl.getLinked()  -> [{id,name,type,...}] 当前成功链接的资源(去重,必属于参考资产)
     pl.refresh()    -> 手动刷新渲染 */
function attachPlaceholderLinker(textarea, getAssets, getAllAssets) {
  if (!textarea || textarea.dataset.plBound) return textarea._pl;
  textarea.dataset.plBound = '1';

  const wrap = document.createElement('div');
  wrap.className = 'pl-wrap' + (textarea.classList.contains('ws-script') ? ' pl-wrap-dark' : '');
  textarea.parentNode.insertBefore(wrap, textarea);
  const mirror = document.createElement('div');
  mirror.className = 'pl-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  wrap.appendChild(mirror);
  wrap.appendChild(textarea);
  textarea.classList.add('pl-input');

  const TOKEN_RE = /\[([^\[\]\n]{1,60})\]/g;

  function nameKey(n) {
    return String(n || '').replace(/\.[^.]+$/, '').trim().toLowerCase();
  }

  /* 构建名→资产列表映射(支持重名,一个名字对应多个资产) */
  function buildNameMap(assets) {
    const map = new Map();
    for (const a of assets) {
      const key = nameKey(a.name);
      if (!map.has(key)) map.set(key, []);
      const arr = map.get(key);
      if (!arr.some(x => x.id === a.id)) arr.push(a);
    }
    return map;
  }

/* 精确测量文本宽度(canvas measureText,与输入框同字体):
   用于判断芯片里放不放得下缩略图 + 资产名 */
  const measCtx = document.createElement('canvas').getContext('2d');
  function textW(str, font) {
    const cs = getComputedStyle(textarea);
    measCtx.font = (font || (cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily));
    return measCtx.measureText(String(str)).width;
  }

  function renderTokens(value) {
    let html = '';
    let last = 0;
    const assets = (getAssets && getAssets()) || [];
    const byName = buildNameMap(assets);
    /* 二十二·1:资产库全量名单仅用于「未引入」悬停提示,不参与链接匹配 */
    const libByName = buildNameMap((getAllAssets && getAllAssets()) || []);
    wrap._libByName = libByName;
    wrap._byName = byName;
    wrap._assets = assets;
    wrap._ranges = [];
    value.replace(TOKEN_RE, (raw, inner, idx) => {
      html += esc(value.slice(last, idx));
      const hits = byName.get(inner.trim().toLowerCase()) || [];
      const matched = hits.length > 0;
      const assetIds = hits.map(a => a.id).join(',');
      const names = hits.map(a => String(a.name || '').replace(/\.[^.]+$/, ''));
      if (!matched) {
        html += '<span class="pl-token no">' + esc(raw) + '</span>';
      } else {
        wrap._ranges.push({ start: idx, end: idx + raw.length });
        /* 十七·2:高亮改为下方 chips 的「圆角矩形 + 图 + 文字」样式:
           镜像层置顶后用不透明芯片盖住输入框原文,再叠加资产缩略图 + 资产名;
           令牌内保留原文(透明)作为占宽基准,保证与输入框光标/换行严格对齐 */
        const primary = hits[0];
        const thumb = primary.type === 'image' ? '/api/assets/' + primary.id + '/file'
          : (primary.thumb_path || primary.type === 'video') ? '/api/assets/' + primary.id + '/thumbnail' : '';
        const label = names[0] + (hits.length > 1 ? ' +' + (hits.length - 1) : '');
        const cs2 = getComputedStyle(textarea);
        /* 二十二·3:引用字体与形状放大 —— 名字 13.5 → 11px 逐级取最大可容字号(旧版 12 → 10px);
           令牌过窄时缩略图为名字让位(不出图),优先保证引用名大而完整,不靠省略号截断 */
        const rawW = textW(raw);
        const availIco = rawW - 19.5; /* 带图:名字位于 left 17px / right 2.5px(放不下即让图) */
        const availBare = rawW - 8;   /* 无图:左右各留 4px 呼吸边 */
        const fitPx = (fs, avail) => avail >= textW(label, '800 ' + fs + 'px ' + cs2.fontFamily) + 1;
        const LADDER = [13.5, 13, 12.5, 12, 11.5, 11];
        let nameFs = 0, withIco = true;
        for (const fs of LADDER) { if (fitPx(fs, availIco)) { nameFs = fs; break; } }
        if (!nameFs) {
          withIco = false;
          for (const fs of LADDER) { if (fitPx(fs, availBare)) { nameFs = fs; break; } }
        }
        if (!nameFs) nameFs = 11; /* 极窄兜底:仍不截断,超出部分省略 */
        html += '<span class="pl-token ok' + (withIco ? ' has-ico' : '') + '" style="--pl-name-fs:' + nameFs + 'px"' +
          ' data-pl-asset="' + esc(assetIds) + '" data-pl-name="' + esc(names.join('、')) + '">' + esc(raw) +
          (withIco
            ? (thumb
              ? '<img class="pl-timg" src="' + thumb + '" alt="">'
              : '<span class="pl-timg pl-tico">' + icon('link') + '</span>')
            : '') +
          '<b class="pl-tname">' + esc(label) + '</b>' +
          '</span>';
      }
      last = idx + raw.length;
      return raw;
    });
    html += esc(value.slice(last));
    return html + '\n';
  }

  /* 关键修复:镜像层宽高与 textarea 内容区严格一致(含边框),滚动才能对齐 */
  function syncStyles() {
    const cs = getComputedStyle(textarea);
    for (const prop of ['fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'letterSpacing', 'textAlign']) {
      mirror.style[prop] = cs[prop];
    }
    mirror.style.borderStyle = 'solid';
    mirror.style.borderColor = 'transparent';
    mirror.style.boxSizing = 'border-box';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = cs.overflowWrap === 'normal' ? 'break-word' : cs.overflowWrap;
    mirror.style.wordBreak = cs.wordBreak === 'normal' ? 'break-word' : cs.wordBreak;
    mirror.style.overflow = 'hidden';
    const bwH = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const bwV = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    mirror.style.width = (textarea.clientWidth + bwH) + 'px';
    mirror.style.height = (textarea.clientHeight + bwV) + 'px';
  }

  function syncScroll() {
    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }

  function refresh() {
    syncStyles();
    mirror.innerHTML = renderTokens(textarea.value);
    syncScroll();
  }

  textarea.addEventListener('input', () => { refresh(); fire(); });
  textarea.addEventListener('scroll', () => { syncScroll(); hideTip(); });

  /* 光标落在已链接占位符内时,芯片临时让位(半透明),露出原文与光标便于编辑 */
  function updateCaretHint() {
    const ranges = wrap._ranges || [];
    let inside = false;
    const s = textarea.selectionStart, e = textarea.selectionEnd;
    if (ranges.length && s != null && e != null) {
      inside = ranges.some(r => (s > r.start && s < r.end) || (e > r.start && e < r.end));
    }
    wrap.classList.toggle('pl-caret-in', inside);
  }
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === textarea) updateCaretHint();
  });
  textarea.addEventListener('blur', () => wrap.classList.remove('pl-caret-in'));

  /* ---- 链接来源显示:悬停提示 + 点击高亮左侧参考资产 ----
     镜像层 pointer-events:none,通过命中检测(坐标落在某个 token 边界框内)实现 */
  function hitToken(e) {
    if (!wrap._byName) return null;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tokens = wrap.querySelectorAll('.pl-token');
    for (const tok of tokens) {
      const r = tok.getBoundingClientRect();
      const rx = r.left - rect.left;
      const ry = r.top - rect.top;
      if (x >= rx && x <= rx + r.width && y >= ry && y <= ry + r.height) return tok;
    }
    return null;
  }

  let tip = null;
  function showTip(text, x, y) {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'pl-tip';
      tip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const pad = 14;
    tip.style.left = Math.min(x + pad, window.innerWidth - tw - 10) + 'px';
    tip.style.top = (y - th - 8 < 8 ? y + pad : y - th - 8) + 'px';
  }
  function hideTip() {
    if (tip) tip.style.display = 'none';
  }

  wrap.addEventListener('mousemove', e => {
    const tok = hitToken(e);
    if (!tok) { hideTip(); return; }
    if (tok.classList.contains('ok')) {
      const names = tok.getAttribute('data-pl-name');
      showTip('已链接: ' + (names || '来源资产') + ' · 点击左侧面板定位', e.clientX, e.clientY);
    } else {
      /* 二十二·1:仅「参考资产」可引用 —— 资产库同名未引入时,提示先引入再引用 */
      const m = (tok.textContent || '').match(/^\[([^\[\]]{1,60})\]/);
      const inner = m ? m[1].trim().toLowerCase() : '';
      const libHits = inner && wrap._libByName ? (wrap._libByName.get(inner) || []) : [];
      showTip(libHits && libHits.length
        ? '「' + String(libHits[0].name || '').replace(/\.[^.]+$/, '') + '」未引入参考资产,请先在左侧引入后再引用'
        : '未链接:仅左侧「参考资产」中的素材可被 [占位符] 引用', e.clientX, e.clientY);
    }
  });
  wrap.addEventListener('mouseleave', hideTip);

  wrap.addEventListener('click', e => {
    const hit = hitToken(e);
    if (!hit || !hit.classList.contains('ok')) return;
    const assetIds = hit.dataset.plAsset;
    if (!assetIds) return;
    const evt = new CustomEvent('pl-token-click', {
      bubbles: true,
      detail: { assetIds: assetIds.split(',') }
    });
    textarea.dispatchEvent(evt);
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!textarea.isConnected) { ro.disconnect(); return; }
      refresh();
    });
    ro.observe(textarea);
  } else {
    const onResize = () => {
      if (!textarea.isConnected) { window.removeEventListener('resize', onResize); return; }
      refresh();
    };
    window.addEventListener('resize', onResize);
  }

  function linked() {
    const assets = (getAssets && getAssets()) || [];
    const byName = buildNameMap(assets);
    const out = [];
    const seen = new Set();
    for (const m of textarea.value.matchAll(TOKEN_RE)) {
      const hits = byName.get(m[1].trim().toLowerCase());
      if (hits) {
        for (const hit of hits) {
          if (!seen.has(hit.id)) { seen.add(hit.id); out.push(hit); }
        }
      }
    }
    return out;
  }

  const listeners = [];
  function fire() { for (const fn of listeners) fn(linked()); }
  function onChange(fn) { listeners.push(fn); }

  function insert(name) {
    const token = '[' + String(name).replace(/\.[^.]+$/, '') + ']';
    const s = textarea.selectionStart ?? textarea.value.length;
    const e = textarea.selectionEnd ?? s;
    textarea.value = textarea.value.slice(0, s) + token + textarea.value.slice(e);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = s + token.length;
    refresh(); fire();
  }

  const api = { refresh, getLinked: linked, linked, insertToken: insert, insert, onChange };
  textarea._pl = api;
  refresh();
  return api;
}

/* 渲染"已链接资源"chips 行 + 可用占位符提示
   二十二·1:仅左侧「参考资产」可被引用 —— 可用占位提示只来自参考资产,不再兜底全部资产库;
   二十二·2:已链接 chips 可点击,放大查看该资源(onPreview 回调) */
function renderPlaceholderChips(container, linkedAssets, refAssets, onInsert, onPreview) {
  if (!container) return;
  /* linkedAssets:当前已成功链接的资源(仅来自参考资产)
     refAssets:左侧参考资产列表(引用唯一来源) */
  const refs = refAssets || [];
  const linkedHtml = linkedAssets.length
    ? linkedAssets.map(a => {
        const thumb = a.type === 'image' ? '/api/assets/' + a.id + '/file'
          : a.thumb_path ? '/api/assets/' + a.id + '/thumbnail' : '';
        return '<button type="button" class="pl-chip ok" data-pl-view="' + esc(a.id) + '" title="点击放大查看:' + esc(a.name) + '">' +
          (thumb ? '<img src="' + thumb + '" alt="">' : icon('link', 'ico-xs')) +
          '<b>' + esc(String(a.name).replace(/\.[^.]+$/, '')) + '</b>' + icon('circle-check', 'ico-xs') +
          '<span class="pl-chip-zoom" title="放大查看">' + icon('zoom-in', 'ico-xs') + '</span></button>';
      }).join('')
    : refs.length
      ? '<span class="pl-chip-none">尚无链接,输入 [资产名] 自动链接左侧参考资产</span>'
      : '<span class="pl-chip-none">左侧暂无参考资产 —— 请先从上方分类引入素材,再输入 [资产名] 引用</span>';
  /* 从参考资产中取前 10 个作为可用占位提示(未引入的资产库素材不提示) */
  const names = refs.slice(0, 10)
    .map(a => {
      const clean = esc(String(a.name).replace(/\.[^.]+$/, ''));
      return '<button type="button" class="pl-hint-name" data-pl-insert="' + clean + '" title="点击插入占位符">[' + clean + ']</button>';
    }).join('');
  container.innerHTML = '<div class="pl-chips">' + linkedHtml + '</div>' +
    (names ? '<div class="pl-hints"><span class="pl-hints-label">可用占位:</span>' + names + '</div>' : '');
  container.querySelectorAll('[data-pl-insert]').forEach(b =>
    b.addEventListener('click', () => onInsert && onInsert(b.dataset.plInsert)));
  if (onPreview) {
    container.querySelectorAll('[data-pl-view]').forEach(b => {
      const asset = (linkedAssets || []).find(x => x.id === b.dataset.plView);
      if (asset) b.addEventListener('click', () => onPreview(asset));
    });
  }
}
