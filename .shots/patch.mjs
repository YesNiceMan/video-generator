const fs=await import("node:fs/promises");
const ws="/Users/a123/Desktop/test/video-generator";
const fp=ws+"/public/css/app.css";
let css=await fs.readFile(fp,"utf-8");
function rep(o,n){if(css.includes(o)){css=css.replace(o,n);return 1;}console.log("NOT:"+JSON.stringify(o.slice(0,60)));return 0;}
let cnt=0;
cnt+=rep("  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .8), 0 10px 26px rgba(92, 98, 113, .08);","  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9), 0 8px 22px rgba(92, 98, 113, .04);");
cnt+=rep("html[data-scheme=\"light\"] .ws-ref-item,\nhtml[data-scheme=\"light\"] .ws-rec,\nhtml[data-scheme=\"light\"] .ws-clip,\nhtml[data-scheme=\"light\"] .ws-review-item,\nhtml[data-scheme=\"light\"] .ws-log-item,\nhtml[data-scheme=\"light\"] .ws-pick-item { background: #f6f4ee; border-color: rgba(120, 100, 58, .14); }","html[data-scheme=\"light\"] .ws-ref-item,\nhtml[data-scheme=\"light\"] .ws-rec,\nhtml[data-scheme=\"light\"] .ws-clip,\nhtml[data-scheme=\"light\"] .ws-review-item,\nhtml[data-scheme=\"light\"] .ws-log-item,\nhtml[data-scheme=\"light\"] .ws-pick-item { background: #f7f8fb; border-color: rgba(90, 98, 113, .10); }");
cnt+=rep("html[data-scheme=\"light\"] .ws-ref-ico,\nhtml[data-scheme=\"light\"] .ws-pick-ico { background: #efecdf; color: var(--text-dim); }","html[data-scheme=\"light\"] .ws-ref-ico,\nhtml[data-scheme=\"light\"] .ws-pick-ico { background: #eef1f7; color: var(--text-dim); }");
cnt+=rep("html[data-scheme=\"light\"] .dash-hero {\n  background: linear-gradient(120deg, rgba(196, 164, 96, .16), rgba(251, 250, 245, .96) 58%);\n  border-color: rgba(120, 100, 58, .26);\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .7);\n}","html[data-scheme=\"light\"] .dash-hero {\n  background: linear-gradient(120deg, rgba(184, 165, 120, .08), rgba(248, 250, 253, .96) 58%);\n  border-color: rgba(90, 98, 113, .18);\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .9);\n}");
cnt+=rep("  background: radial-gradient(circle at 50% 50%, rgba(60, 48, 20, .82) 2.6px, transparent 3.3px) 0 0 / 24px 12px repeat-x;","  background: radial-gradient(circle at 50% 50%, rgba(92, 98, 113, .78) 2.6px, transparent 3.3px) 0 0 / 24px 12px repeat-x;");
const ts=css;css=css.split("text-shadow: 0 0 16px rgba(227,180,94,.55);").join("text-shadow: 0 0 14px rgba(201, 184, 146, .40);");console.log("ts changed:"+(ts!==css));
await fs.writeFile(fp,css);console.log("written len:",css.length,"replaced:",cnt);
const lines=css.split("\n");const warm=/rgba\(196, 164, 96|rgba\(120, 100, 58|#f6f4ee|#efecdf|rgba\(130, 108, 40|rgba\(148, 114, 42|rgba\(227,180,94|rgba\(248, 246, 240|rgba\(250, 248, 243|rgba\(252, 251, 247|rgba\(60, 48, 20/;
let left=[];for(let i=2750;i<lines.length;i++){const l=lines[i];if(warm.test(l)&&!/^\s*\*/.test(l)&&!l.includes("/*"))left.push((i+1)+": "+l.slice(0,90));}
console.log("remaining warm refs:",left.length);left.slice(0,25).forEach(x=>console.log(x));
let o=0,c2=0;for(const ch of css){if(ch==="{")o++;if(ch==="}")c2++;}console.log("braces:",o,c2,"balanced:",o===c2);