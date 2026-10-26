'use strict';
/* Lucide 图标库辅助
   - icon(name, cls): 生成 <i data-lucide> 占位元素
   - initIcons(): 监听 DOM 变化，自动把占位元素渲染为 SVG(无需手动刷新) */
function icon(name, cls) {
  return `<i class="ico${cls ? ' ' + cls : ''}" data-lucide="${esc(name)}" aria-hidden="true"></i>`;
}

/* 常用内联组合：图标 + 文字 */
function iconText(name, text, cls) {
  return `${icon(name, cls)}<span>${text}</span>`;
}

function initIcons() {
  if (!window.lucide) return;
  let scheduled = false;
  const render = () => {
    scheduled = false;
    if (!document.querySelector('i[data-lucide]')) return;
    try { window.lucide.createIcons(); } catch (e) { /* 忽略 */ }
  };
  /* 视图大量使用 innerHTML 动态渲染，MutationObserver 保证新插入的图标都会被转换 */
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }).observe(document.documentElement, { childList: true, subtree: true });
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIcons);
else initIcons();
