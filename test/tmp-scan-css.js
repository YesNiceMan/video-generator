
const fs = require('fs');
const css = fs.readFileSync('public/css/app.css','utf8');
// 计算每条规则起始行号并解析 选择器{声明}
const darkBg = /background[^;{}]*(rgba\((?:[0-9]|1[0-9]|2[0-5])\s*,[^)]*\)|#[0-3][0-9a-fA-F]{2,5}\b)/;
const re = /([^{}]+)\{([^{}]*)\}/g;
let m; const out = [];
while ((m = re.exec(css))) {
  const body = m[2];
  if (!darkBg.test(body)) continue;
  const before = css.slice(0, m.index);
  const line = before.split('\n').length;
  const sel = m[1].trim().replace(/\s+/g, ' ').slice(-100);
  out.push(line + ': ' + sel + '  =>  ' + body.trim().replace(/\s+/g,' ').slice(0, 170));
}
console.log(out.join('\n'));
