'use strict';
/* 文档解析(第五十轮 · 短剧工作流)
 * 剧本与分镜表在真实项目里是 Word / Excel,平台要能吃它们,又不能为此加 npm 依赖。
 * docx 与 xlsx 都是 ZIP + OOXML,所以这里只用 node:zlib 手搓一个最小 ZIP 读取器:
 * 读中心目录拿条目的压缩方式与尺寸,再回到本地文件头取数据 —— 本地头的尺寸字段在
 * 流式写入时会是 0,不能作为依据。
 */
const zlib = require('node:zlib');

const SIG_CDX = 0x02014b50;   // 中心目录项
const SIG_EOCD = 0x06054b50;  // 中心目录结束记录
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

function u16(buf, off) { return buf.readUInt16LE(off); }
function u32(buf, off) { return buf.readUInt32LE(off); }

/* 从尾部往上找 EOCD(注释最长 65535 字节) */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === SIG_EOCD) return i;
  }
  return -1;
}

/* ZIP 条目名 → Buffer(未解压的原始数据由调用方按需 inflate) */
function zipEntries(input) {
  const buf = Buffer.isBuffer(input) ? input : require('node:fs').readFileSync(input);
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('文件不是合法的 ZIP 包(docx/xlsx 应为 ZIP 格式)');
  let count = u16(buf, eocd + 10);
  let cdOff = u32(buf, eocd + 16);
  /* ZIP64:目录项或偏移超出 32 位时真正的值挂在额外字段里 */
  if (count === 0xffff || cdOff === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (u32(buf, i) === SIG_ZIP64_LOCATOR) {
        const z = u32(buf, i + 8);
        if (u32(buf, z) === SIG_ZIP64_EOCD) { count = Number(buf.readBigUInt64LE(z + 32)); cdOff = Number(buf.readBigUInt64LE(z + 48)); break; }
      }
    }
  }
  const out = new Map();
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || u32(buf, p) !== SIG_CDX) break;
    const method = u16(buf, p + 10);
    let csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    let lho = u32(buf, p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    let q = p + 46 + nameLen;
    const extraEnd = q + extraLen;
    /* ZIP64 额外字段(0x0001)里带 64 位的尺寸与偏移 */
    while (q + 4 <= extraEnd) {
      const id = u16(buf, q), sz = u16(buf, q + 2);
      if (id === 0x0001) {
        if (csize === 0xffffffff) csize = Number(buf.readBigUInt64LE(q + 4));
        if (lho === 0xffffffff) lho = Number(buf.readBigUInt64LE(q + 12));
      }
      q += 4 + sz;
    }
    const dataAt = lho + 30 + u16(buf, lho + 26) + u16(buf, lho + 28);
    out.set(name, { method, raw: buf.subarray(dataAt, dataAt + csize) });
    p = p + 46 + nameLen + extraLen + commentLen;
  }
  if (!out.size) throw new Error('压缩包里没有任何条目');
  return out;
}

function readEntry(entries, want) {
  const key = want.replace(/^\/+/, '');
  let hit = entries.get(key);
  if (!hit) {
    /* 有的写法把目录挂在 word/ 之外,或大小写不同 */
    for (const [k, v] of entries) if (k.toLowerCase() === key.toLowerCase()) { hit = v; break; }
  }
  if (!hit) return null;
  return hit.method === 8 ? zlib.inflateRawSync(hit.raw) : hit.raw;
}

function xmlDecode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/* ---------- Word ---------- */
/* 段落 → 行:一个段落里的文字散在多个 run 上,必须按 <w:p> 归并再拼 <w:t>;
   <w:tab> 还原成制表符,<w:br> 还原成换行(硬回车不另起段)。 */
function docxLines(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const entries = zipEntries(buf);
  const xmlBuf = readEntry(entries, 'word/document.xml');
  if (!xmlBuf) throw new Error('docx 里找不到 word/document.xml');
  const xml = xmlBuf.toString('utf8');
  const lines = [];
  for (const m of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g)) {
    const body = m[1] || '';
    let text = '';
    for (const t of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>/g)) {
      if (t[1] != null) text += xmlDecode(t[1]);
      else if (/<w:tab/.test(t[0])) text += '\t';
      else text += '\n';
    }
    lines.push(text);
  }
  return lines;
}
function docxText(input) {
  return docxLines(input).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- Excel ---------- */
function colIndex(ref) {
  const letters = /^([A-Z]+)/.exec(String(ref));
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* 共享字符串里一段文字可能同时带 <t> 与 <r> run,且 run 之间没有分隔符;
   直接按 <t> 顺序拼即可,但要把富文本里被拆掉的换行留下。 */
function parseSharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) {
      if (t[1] != null) text += xmlDecode(t[1]);
    }
    out.push(text);
  }
  return out;
}

function parseSheet(xml, shared) {
  const rows = [];
  for (const m of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const body = m[1] || '';
    const cells = [];
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] || '';
      const inner = c[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs);
      const idx = ref ? colIndex(ref[1]) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs);
      let val = '';
      if (type && type[1] === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        val = v ? (shared[Number(v[1])] != null ? shared[Number(v[1])] : '') : '';
      } else if (type && (type[1] === 'inlineStr' || type[1] === 'str')) {
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inner) || /<v>([\s\S]*?)<\/v>/.exec(inner);
        val = t ? xmlDecode(t[1]) : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v) {
          const num = Number(v[1]);
          val = Number.isFinite(num) ? String(num) : xmlDecode(v[1]);
        }
      }
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
    }
    if (cells.some(x => x !== '')) rows.push(cells);
  }
  return rows;
}

/* 返回 [{name, rows:[[cell…]]}] —— 工作表顺序按 workbook.xml 的声明顺序 */
function xlsxSheets(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const entries = zipEntries(buf);
  const wbBuf = readEntry(entries, 'xl/workbook.xml');
  if (!wbBuf) throw new Error('xlsx 里找不到 xl/workbook.xml');
  const wb = wbBuf.toString('utf8');
  const relsBuf = readEntry(entries, 'xl/_rels/workbook.xml.rels');
  const relMap = {};
  if (relsBuf) {
    for (const m of relsBuf.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0]);
      const target = /Target="([^"]+)"/.exec(m[0]);
      if (id && target) relMap[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\.\.\//, '');
    }
  }
  const ssBuf = readEntry(entries, 'xl/sharedStrings.xml');
  const shared = ssBuf ? parseSharedStrings(ssBuf.toString('utf8')) : [];
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/>/g)) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag);
    const rid = /r:id="([^"]+)"/.exec(tag);
    let path = (rid && relMap[rid[1]]) ? relMap[rid[1]] : null;
    if (!path) path = 'worksheets/sheet' + (sheets.length + 1) + '.xml';
    const sBuf = readEntry(entries, 'xl/' + path) || readEntry(entries, path);
    if (!sBuf) continue;
    sheets.push({ name: name ? xmlDecode(name[1]) : ('Sheet' + (sheets.length + 1)), rows: parseSheet(sBuf.toString('utf8'), shared) });
  }
  if (!sheets.length) throw new Error('xlsx 里没有任何可读的工作表');
  return sheets;
}

module.exports = { zipEntries, docxText, docxLines, xlsxSheets };
