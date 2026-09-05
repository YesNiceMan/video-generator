const css = require('fs').readFileSync('public/css/app.css','utf8');
let o=0,c=0; for (const ch of css){ if(ch==='{')o++; if(ch==='}')c++; }
console.log('braces:', o, c, o===c ? 'BALANCED' : 'MISMATCH');
console.log('lines:', css.split('\n').length);
