'use strict';
/* 验证第 11 轮优化:1) 占位链接高亮对齐+滚动跟随+新样式 2) 分镜折叠 3) 布局优化 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9351;
const SHOT_DIR = path.join(__dirname, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--user-data-dir=/tmp/vf-chrome-profile-r11',
  '--remote-debugging-port=' + PORT, '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch (e) {} });
const wait = ms => new Promise(r => setTimeout(r, ms));
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, m => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, ready: new Promise(r => ws.onopen = r) };
}
const B = {"layout":"KCgpID0+IHsKICBjb25zdCBxID0gcyA9PiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKHMpOwogIHJldHVybiB7CiAgICBoYXNNYWluQmFyOiAhIXEoJy53cy1tYWluLWJhcicpLAogICAgbWJhclRleHQ6IHEoJy53cy1tYWluLWJhcicpID8gcSgnLndzLW1haW4tYmFyJykudGV4dENvbnRlbnQucmVwbGFjZSgvXHMrL2csJyAnKS50cmltKCkgOiAnJywKICAgIGhhc0xlZnRGb2xkQnRuOiAhIXEoJy53cy1yZWYtZm9sZCcpLAogICAgaGFzTGVmdE9wZW5CdG46ICEhcSgnLndzLWxlZnQtb3BlbicpLAogICAgY2FyZEhlYWRBY3Rpb25zOiBxKCcud3MtY2FyZC1hY3Rpb25zJykgPyBxKCcud3MtY2FyZC1hY3Rpb25zJykuY2hpbGRyZW4ubGVuZ3RoIDogMCwKICAgIGhhc0lkeEJhZGdlOiAhIXEoJy53cy1zaG90LWlkeCcpLAogICAgY2FyZENvdW50OiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCcud3MtY2FyZCcpLmxlbmd0aAogIH07Cn0pKCk=","inputText":"KCgpID0+IHsKICBjb25zdCB0YSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLXNob3Qtc2NyaXB0XScpOwogIHRhLmZvY3VzKCk7CiAgdGEudmFsdWUgPSBbJ1t0ZXN0X3I1XSDlpbPkuLvlnKjlj6Tln47plb/ooZfnvJPnvJPlm57lpLQs5aSV6Ziz5rSS6JC944CCJywgJ+WlueaOqOW8gOacqOmXqOi1sOi/m+Wwj+mZoizpo47pk4Povbvlk40s6L+c5aSE5Lyg5p2l5pu05aOw44CCJywgJ+mVnOWktOe8k+e8k+aLiei/nCzngorng5/oooXoooXljYfotbcs5b2S5Lq66ISa5q2l5aOw5riQ6L+R44CCJywgJ+esrOWbm+ihjDrlpbnnmbvkuIrpmIHmpbzmjqjlvIDnqpcs5pma6aOO5ouC6L+H6Z2i6aKKLOi/nOWkhOeahOWxseW9sea4kOmakOS6juaaruiJsuS4reOAgicsICfnrKzkupTooYw65aW55Z6C5LiL55y85biYLOaMh+Wwlui9u+i9u+WIkui/h+eql+WPsCzoi6XmnInmiYDmgJ3jgIInLCAn56ys5YWt6KGMOuW/veeEtuWlueaKrOi1t+WktCzku7/kvZvlkKzliLDkuobku4DkuYgs55uu5YWJ5Y+Y5b6X5Z2a5a6a44CCJywgJ+esrOS4g+ihjDrlpbnovazouqvkuIvmpbws6KOZ5pGG5ouC6L+H5pyo6Zi2LOWPkeWHuuaymeaymeeahOWjsOWTjeOAgicsICfnrKzlhavooYw66Zmi5a2Q6YeMLOS4gOS4qui6q+W9semdoOWcqOaip+ahkOagkeS4iyzmiYvph4zmjY/nnYDkuIDlsIHkv6HjgIInLCAn56ys5Lmd6KGMOuWlueWBnOS9j+iEmuatpSzpmpTnnYDlpJzoibLmnJvlkJHku5Ys56m65rCU5Lu/5L2b5Yed5Zu65LqG44CCJywgJ+esrOWNgeihjDrku5bnvJPnvJPovazov4fouqvmnaUs5Zub55uu55u45a+5LOWNg+iogOS4h+ivreWwveWcqOS4jeiogOS4reOAgicsICfnrKzljYHkuIDooYw66aOO6ZOD5YaN5qyh5ZON6LW3LOi/meS4gOasoSzlpbnov4jlh7rkuobohJrmraXjgIInXS5qb2luKFN0cmluZy5mcm9tQ2hhckNvZGUoMTApKTsKICB0YS5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnaW5wdXQnLCB7IGJ1YmJsZXM6IHRydWUgfSkpOwogIHJldHVybiB0cnVlOwp9KSgp","mirrorCheck":"KCgpID0+IHsKICBjb25zdCB3cmFwID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLnBsLXdyYXAtZGFyaycpOwogIGNvbnN0IG1pcnJvciA9IHdyYXAucXVlcnlTZWxlY3RvcignLnBsLW1pcnJvcicpOwogIGNvbnN0IHRhID0gd3JhcC5xdWVyeVNlbGVjdG9yKCd0ZXh0YXJlYScpOwogIGNvbnN0IHRva2VuID0gbWlycm9yLnF1ZXJ5U2VsZWN0b3IoJy5wbC10b2tlbi5vaycpOwogIHJldHVybiB7CiAgICBoYXNXcmFwOiAhIXdyYXAsCiAgICBoYXNUb2tlbjogISF0b2tlbiwKICAgIHRva2VuVGV4dDogdG9rZW4gPyB0b2tlbi50ZXh0Q29udGVudCA6ICcnLAogICAgbXc6IG1pcnJvci5jbGllbnRXaWR0aCwgdHc6IHRhLmNsaWVudFdpZHRoLAogICAgbWg6IG1pcnJvci5jbGllbnRIZWlnaHQsIHRoOiB0YS5jbGllbnRIZWlnaHQsCiAgICBtaEZpeGVkOiBwYXJzZUZsb2F0KG1pcnJvci5zdHlsZS5oZWlnaHQpIHx8IDAsCiAgICBzY3JvbGxIOiB0YS5zY3JvbGxIZWlnaHQsCiAgICBjbGllbnRIOiB0YS5jbGllbnRIZWlnaHQsCiAgICBoYXNUaXBDc3M6ICgoKSA9PiB7IHRyeSB7IGNvbnN0IHNzID0gZG9jdW1lbnQuc3R5bGVTaGVldHNbMF07IHJldHVybiBzcyAmJiBzcy5jc3NSdWxlcyA/IFsuLi5zcy5jc3NSdWxlc10uc29tZShyID0+IHIuc2VsZWN0b3JUZXh0ICYmIHIuc2VsZWN0b3JUZXh0LmluY2x1ZGVzKCcucGwtdGlwJykpIDogZmFsc2U7IH0gY2F0Y2goZSl7IHJldHVybiBmYWxzZTsgfSB9KSgpCiAgfTsKfSkoKQ==","scrollSet":"KCgpID0+IHsKICBjb25zdCB3cmFwID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLnBsLXdyYXAtZGFyaycpOwogIGNvbnN0IG1pcnJvciA9IHdyYXAucXVlcnlTZWxlY3RvcignLnBsLW1pcnJvcicpOwogIGNvbnN0IHRhID0gd3JhcC5xdWVyeVNlbGVjdG9yKCd0ZXh0YXJlYScpOwogIHRhLnNjcm9sbFRvcCA9IDYwOwogIHRhLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdzY3JvbGwnKSk7CiAgcmV0dXJuIHRydWU7Cn0pKCk=","scrollGet":"KCgpID0+IHsKICBjb25zdCB3cmFwID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLnBsLXdyYXAtZGFyaycpOwogIGNvbnN0IG1pcnJvciA9IHdyYXAucXVlcnlTZWxlY3RvcignLnBsLW1pcnJvcicpOwogIGNvbnN0IHRhID0gd3JhcC5xdWVyeVNlbGVjdG9yKCd0ZXh0YXJlYScpOwogIHJldHVybiB7IG1pcnJvclRvcDogbWlycm9yLnNjcm9sbFRvcCwgdGFUb3A6IHRhLnNjcm9sbFRvcCB9Owp9KSgp","toggleClick":"ZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtc2hvdC10b2dnbGVdJykuY2xpY2soKTsgdHJ1ZQ==","collapsed":"KCgpID0+IHsKICBjb25zdCBjYXJkID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLndzLWNhcmQnKTsKICByZXR1cm4gewogICAgaXNDb2xsYXBzZWQ6IGNhcmQuY2xhc3NMaXN0LmNvbnRhaW5zKCdpcy1jb2xsYXBzZWQnKSwKICAgIGJvZHlIaWRkZW46IGdldENvbXB1dGVkU3R5bGUoY2FyZC5xdWVyeVNlbGVjdG9yKCcud3MtY2FyZC1ib2R5JykpLmRpc3BsYXkgPT09ICdub25lJywKICAgIGhhc1N1bW1hcnk6ICEhY2FyZC5xdWVyeVNlbGVjdG9yKCcud3MtY2FyZC1zdW1tYXJ5JyksCiAgICBzdW1tYXJ5OiBjYXJkLnF1ZXJ5U2VsZWN0b3IoJy53cy1jYXJkLXN1bW1hcnknKSA/IGNhcmQucXVlcnlTZWxlY3RvcignLndzLWNhcmQtc3VtbWFyeScpLnRleHRDb250ZW50IDogJycKICB9Owp9KSgp","expanded":"IWRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy53cy1jYXJkJykuY2xhc3NMaXN0LmNvbnRhaW5zKCdpcy1jb2xsYXBzZWQnKQ==","add2":"KCgpID0+IHsgZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtd3MtYWN0aW9uPWFkZHNob3RdJykuY2xpY2soKTsgZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtd3MtYWN0aW9uPWFkZHNob3RdJykuY2xpY2soKTsgcmV0dXJuIHRydWU7IH0pKCk=","collapseAllClick":"ZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtd3MtYWN0aW9uPWNvbGxhcHNlYWxsXScpLmNsaWNrKCk7IHRydWU=","collapseAllCheck":"KCgpID0+IHsgY29uc3QgY2FyZHMgPSBbLi4uZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLndzLWNhcmQnKV07IHJldHVybiB7IG46IGNhcmRzLmxlbmd0aCwgYWxsOiBjYXJkcy5ldmVyeShjID0+IGMuY2xhc3NMaXN0LmNvbnRhaW5zKCdpcy1jb2xsYXBzZWQnKSkgfTsgfSkoKQ==","toggleLeftClick":"ZG9jdW1lbnQucXVlcnlTZWxlY3RvcignW2RhdGEtd3MtYWN0aW9uPXRvZ2dsZWxlZnRdJykuY2xpY2soKTsgdHJ1ZQ==","leftFolded":"KCgpID0+IHsKICBjb25zdCBhc2lkZSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy53cy1sZWZ0Jyk7CiAgcmV0dXJuIHsKICAgIGZvbGRlZDogYXNpZGUuY2xhc3NMaXN0LmNvbnRhaW5zKCdmb2xkZWQnKSwKICAgIHJlZkhpZGRlbjogZ2V0Q29tcHV0ZWRTdHlsZShhc2lkZS5xdWVyeVNlbGVjdG9yKCcud3MtcmVmJykpLmRpc3BsYXkgPT09ICdub25lJywKICAgIG9wZW5WaXNpYmxlOiBnZXRDb21wdXRlZFN0eWxlKGFzaWRlLnF1ZXJ5U2VsZWN0b3IoJy53cy1sZWZ0LW9wZW4nKSkuZGlzcGxheSAhPT0gJ25vbmUnCiAgfTsKfSkoKQ==","orderBefore":"Wy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ1tkYXRhLXNob3QtY2FyZF0nKV0ubWFwKGUgPT4gZS5kYXRhc2V0LnNob3RDYXJkKS5qb2luKCcsJyk=","moveLastUp":"KCgpID0+IHsgY29uc3QgY2FyZHMgPSBbLi4uZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnLndzLWNhcmQnKV07IGNvbnN0IGxhc3RDYXJkID0gY2FyZHNbY2FyZHMubGVuZ3RoIC0gMV07IGxhc3RDYXJkLnF1ZXJ5U2VsZWN0b3JBbGwoJ1tkYXRhLXNob3QtdXBdJykuZm9yRWFjaChiID0+IGIuY2xpY2soKSk7IHJldHVybiB0cnVlOyB9KSgp","orderAfter":"Wy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ1tkYXRhLXNob3QtY2FyZF0nKV0ubWFwKGUgPT4gZS5kYXRhc2V0LnNob3RDYXJkKS5qb2luKCcsJyk="};
async function ev(expr, page) {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}
let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label); if (!cond) failures++; }
async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(500); }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');
  const login = await fetch('http://localhost:3088/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@videoforge.cn', password: 'demo123' })
  });
  const demoToken = login.headers.get('set-cookie').split(';')[0].split('=')[1];
  const tab = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('http://localhost:3088/#/projects/p-d3e2d9b40bf747e6/episode/e-5a6bbbf41d5c2bad'), { method: 'PUT' })).json();
  const page = cdpConnect(tab.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await wait(1500);
  await page.send('Network.setCookie', { name: 'vf_sid', value: demoToken, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' });
  await page.send('Page.reload', { ignoreCache: true });
  await wait(3800);
  const ev0 = e => ev(Buffer.from(B[e], 'base64').toString('utf8'), page);
  async function snap(name) {
    const shotFile = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SHOT_DIR, name + '.png'), Buffer.from(shotFile.data, 'base64'));
    console.log('[shot] ' + name + '.png');
  }

  /* 1) 布局 */
  const layout = await ev0('layout');
  console.log('layout:', JSON.stringify(layout));
  ok(layout.hasMainBar, '主栏置顶工具条存在');
  ok(layout.hasLeftFoldBtn && layout.hasLeftOpenBtn, '左栏折叠/展开按钮存在');
  ok(layout.cardHeadActions >= 4, '分镜卡头部有 上移/下移/折叠/删除 操作');
  ok(layout.hasIdxBadge, '分镜序号徽标存在');

  /* 2) 占位链接高亮 */
  await ev0('inputText');
  await wait(800);
  const mirrorCheck = await ev0('mirrorCheck');
  console.log('mirror:', JSON.stringify(mirrorCheck));
  ok(mirrorCheck.hasToken && mirrorCheck.tokenText === '[test_r5]', '占位符 [test_r5] 链接成功且高亮(ok token)');
  ok(Math.abs(mirrorCheck.mw - mirrorCheck.tw) <= 2, '镜像层宽度与 textarea 内容区对齐');
  ok(mirrorCheck.scrollH > mirrorCheck.clientH + 10, '文案较长已出现滚动(scrollH=' + mirrorCheck.scrollH + ')');
  ok(mirrorCheck.mhFixed > 0, '镜像层高度已固定(不再随内容向下溢出,mh=' + mirrorCheck.mhFixed + ')');

  /* 3) 滚动跟随 */
  await ev0('scrollSet');
  const scrollSync = await ev0('scrollGet');
  console.log('scrollSync:', JSON.stringify(scrollSync));
  ok(Math.abs(scrollSync.mirrorTop - scrollSync.taTop) <= 1, '滚动时镜像层跟随(scrollTop 同步)');
  ok(mirrorCheck.hasTipCss, '占位符悬停 tooltip 样式已注入');
  await snap('r11-storyboard');

  /* 4) 分镜折叠 */
  await ev0('toggleClick');
  await wait(400);
  const collapsed = await ev0('collapsed');
  console.log('collapsed:', JSON.stringify(collapsed));
  ok(collapsed.isCollapsed && collapsed.bodyHidden, '分镜卡折叠:正文隐藏');
  ok(collapsed.hasSummary && /剧本:/.test(collapsed.summary), '折叠态显示摘要:' + String(collapsed.summary).slice(0, 40));
  await snap('r11-collapsed');
  await ev0('toggleClick');
  await wait(400);
  const expanded = await ev0('expanded');
  ok(expanded, '再次点击折叠按钮恢复展开');

  /* 5) 全部折叠 */
  await ev0('add2');
  await wait(500);
  await ev0('collapseAllClick');
  await wait(400);
  const allCollapsed = await ev0('collapseAllCheck');
  console.log('collapseall:', JSON.stringify(allCollapsed));
  ok(allCollapsed.n >= 3 && allCollapsed.all, '全部折叠生效(共 ' + allCollapsed.n + ' 个分镜)');
  await snap('r11-collapse-all');

  /* 6) 左栏折叠 */
  await ev0('toggleLeftClick');
  await wait(400);
  const leftFolded = await ev0('leftFolded');
  console.log('leftFolded:', JSON.stringify(leftFolded));
  ok(leftFolded.folded && leftFolded.refHidden && leftFolded.openVisible, '左侧参考资产面板可折叠(折叠为窄条)');
  await snap('r11-left-folded');

  /* 7) 分镜排序 */
  const orderBefore = await ev0('orderBefore');
  await ev0('moveLastUp');
  await wait(400);
  const orderAfter = await ev0('orderAfter');
  console.log('order before:', orderBefore, '=> after:', orderAfter);
  ok(orderBefore !== orderAfter, '分镜支持上移/下移排序');
  await snap('r11-final');
  console.log('');
  console.log('==== ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES') + ' ====');
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error('验证失败:', e.message); try { chrome.kill('SIGKILL'); } catch (x) {} process.exit(1); });