'use strict';
// ffmpeg 封装:媒体探测 / 缩略图 / 图生视频生成 / 分集导出
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let FFMPEG = resolveFfmpeg();

function resolveFfmpeg() {
  const candidates = [];
  try { candidates.push(require('ffmpeg-static')); } catch (e) {}
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  candidates.push('ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  candidates.push(require('path').join(__dirname, '..', 'tools', 'ffmpeg'));
  const { spawnSync } = require('child_process');
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['-version'], { encoding: 'utf8', timeout: 15000 });
      if (r.status === 0) { console.log('[ffmpeg] 使用:', c); return c; }
    } catch (e) { /* 尝试下一个 */ }
  }
  console.warn('[ffmpeg] 未找到可用的 ffmpeg 二进制,视频生成将不可用');
  return candidates[0];
}

function run(args, { timeout = 300000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stderr.on('data', d => { stderr += d.toString(); });
    if (onProgress) {
      child.stdout.on('data', d => {
        const text = d.toString();
        const m = /out_time_ms=(\d+)/.exec(text);
        if (m) onProgress(Number(m[1]) / 1e6);
      });
    }
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('ffmpeg 执行超时'));
      if (code !== 0) return reject(new Error('ffmpeg 失败(exit ' + code + '): ' + stderr.slice(-800)));
      resolve(stderr);
    });
  });
}

// 探测媒体:返回 {duration, width, height, videoCodec, audio}
function probe(filePath) {
  const r = spawnSync(FFMPEG, ['-i', filePath], { encoding: 'utf8' });
  const stderr = r.stderr || '';
  const out = { duration: null, width: null, height: null, video: false, audio: false, codec: null };
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (dur) out.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  const v = /Stream #\d+:\d+(?:\[\S+\])?.*?Video:\s*(\w+).*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (v) { out.video = true; out.codec = v[1]; out.width = Number(v[2]); out.height = Number(v[3]); }
  out.audio = /Stream #\d+:\d+.*?Audio:/.test(stderr);
  return out;
}

async function makeThumb(videoPath, thumbPath) {
  await run(['-y', '-i', videoPath, '-vf', 'scale=480:-2', '-frames:v', '1', '-q:v', '4', thumbPath], { timeout: 60000 });
  return thumbPath;
}

// 风格 → 色彩滤镜
const GRADE_FILTERS = {
  '影视': 'eq=contrast=1.08:saturation=0.88:brightness=-0.015,colorbalance=rs=0.05:bs=-0.05',
  '科幻': 'hue=h=18:s=1.35,eq=contrast=1.12:brightness=0.02',
  '国风': 'hue=s=0.25,eq=contrast=1.28,curves=preset=medium_contrast',
  '动画': 'eq=saturation=1.55:contrast=1.08,unsharp=5:5:1.0',
  '自然': 'eq=saturation=1.18:contrast=1.06',
  '商业': 'eq=brightness=0.03:saturation=1.15:contrast=1.12,colorbalance=rs=0.04:gs=0.02'
};

/**
 * 图生视频:对单张图片做镜头推拉 + 风格调色,生成 MP4
 * @param {object} o {input, output, duration, fps, motion, seed, grade}
 */
async function generateI2V(o) {
  const duration = Math.max(2, Math.min(10, o.duration || 5));
  const fps = o.fps || 30;
  const motion = Math.max(0, Math.min(1, o.motion ?? 0.5));
  const total = Math.ceil(duration * fps);
  const speed = (0.0008 + motion * 0.0028).toFixed(5);
  const maxz = (1.04 + motion * 0.7).toFixed(3);
  const w = 1280, h = 720;
  const grade = GRADE_FILTERS[o.grade] || 'eq=contrast=1.05:saturation=1.05';
  const vf = [
    `scale=${w * 6}:-2`,
    `zoompan=z='min(zoom+${speed},${maxz})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${total}:s=${w}x${h}:fps=${fps}`,
    `fps=${fps}`,
    grade,
    'format=yuv420p'
  ].join(',');
  const outDir = path.dirname(o.output);
  fs.mkdirSync(outDir, { recursive: true });
  await run(['-y', '-i', o.input, '-vf', vf, '-t', String(duration), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', o.output],
    { timeout: duration * 120000, onProgress: o.onProgress });
  return o.output;
}

/**
 * 分集导出:把片段(视频/图片)拼接为一段 MP4
 * @param {object} o {clips:[{path,duration}], output, width, height}
 */
async function exportEpisode(o) {
  const W = o.width || 1920, H = o.height || 1080;
  const args = ['-y'];
  const scalePad = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  const inputs = [];
  const filters = [];
  o.clips.forEach((c, i) => {
    const ext = (c.path.split('.').pop() || '').toLowerCase();
    const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
    if (isImage) {
      const dur = c.duration && c.duration > 0 ? c.duration : 3;
      args.push('-loop', '1', '-t', String(dur), '-i', c.path);
    } else {
      args.push('-i', c.path);
    }
    filters.push(`[${i}:v]${scalePad}${c.duration && c.duration > 0 && !isImage ? `,trim=duration=${c.duration}` : ''},setpts=PTS-STARTPTS[v${i}]`);
  });
  filters.push(filters.map((_, i) => `[v${i}]`).join('') + `concat=n=${o.clips.length}:v=1:a=0[outv]`);
  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[outv]', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-movflags', '+faststart', o.output);
  const totalSec = o.clips.reduce((s, c) => s + (c.duration || 3), 0);
  fs.mkdirSync(path.dirname(o.output), { recursive: true });
  await run(args, { timeout: Math.max(120000, totalSec * 20000), onProgress: o.onProgress });
  return o.output;
}

module.exports = { FFMPEG, run, probe, makeThumb, generateI2V, exportEpisode };
