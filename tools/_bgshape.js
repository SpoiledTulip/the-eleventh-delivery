/* ============================================================
 * _bgshape.js — 背景"构图"文本化对比（诊断工具）
 * ============================================================
 * 【为什么要它】
 *   我（AI）**看不到图片**，而验收标准是十一用眼睛看的：
 *   "隐藏关卡标题和 HUD 后，仍然能区分不同关卡"。
 *   所以必须把画面变成**能读的文本**，才能自己核对。
 *
 * 【做法】
 *   把每张截图降采样成 48 列 × 22 行的**亮度字符图**，
 *   再按"垂直方向是否有结构"生成一行**天际线剖面**。
 *   → 直接看这串字符就能判断两关构图是否相同。
 *
 * 字符含义（越亮越靠前）：
 *   ' ' 很暗   '.' 暗   ':' 中   '*' 亮   '#' 很亮
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* 复用 _bgshot 的 PNG 解码（复制一份，保持工具自包含） */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, channels, data: out };
}

const CW = 52, CH = 20;                 // 字符图尺寸
const CHARS = ' .:-=+*#%@';
function toAscii(img, skipBottom) {
  const { w, h, channels, data } = img;
  const usableH = Math.floor(h * (skipBottom == null ? 0.9 : skipBottom));
  const lines = [];
  const lum = [];
  for (let gy = 0; gy < CH; gy++) {
    let row = '';
    const rowLum = [];
    for (let gx = 0; gx < CW; gx++) {
      let sum = 0, n = 0;
      const x0 = Math.floor((gx / CW) * w), x1 = Math.floor(((gx + 1) / CW) * w);
      const y0 = Math.floor((gy / CH) * usableH), y1 = Math.floor(((gy + 1) / CH) * usableH);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
        const i = y * w * channels + x * channels;
        sum += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
        n++;
      }
      const l = n ? sum / n : 0;
      rowLum.push(Math.round(l));
      row += CHARS[Math.min(9, Math.floor(l / 25.6))];
    }
    lines.push(row); lum.push(rowLum);
  }
  return { lines, lum };
}

/** 一关的"天际线剖面"：每列最上面一个"亮"格的行号（越小 = 越高的亮物） */
function skyline(lum) {
  const out = [];
  for (let gx = 0; gx < CW; gx++) {
    let top = -1;
    for (let gy = 0; gy < CH; gy++) {
      if (lum[gy][gx] > 70) { top = gy; break; }
    }
    out.push(top < 0 ? '.' : String(top % 10));
  }
  return out.join('');
}

const dir = process.argv[2] || 'dist/_bg_shots';
const only = process.argv[3];       // 可选：只打印某几个（逗号分隔前缀）
let files = fs.readdirSync(dir).filter(f => /\.png$/.test(f));
if (only) {
  const keys = only.split(',');
  files = files.filter(f => keys.some(k => f.includes(k)));
}
files.sort();

const info = [];
for (const f of files) {
  const img = decodePNG(fs.readFileSync(path.join(dir, f)));
  const { lines, lum } = toAscii(img);
  const sk = skyline(lum);
  info.push({ f, lines, lum, sk });
  console.log('\n════════ ' + f + ' (' + img.w + 'x' + img.h + ') ════════');
  lines.forEach(r => console.log('  |' + r + '|'));
  console.log('  天际线: ' + sk);
}

/* ---- 结构差异：字符图逐格比较 ---- */
if (info.length >= 2) {
  console.log('\n\n════════ 构图差异（逐格亮度差的平均绝对值，越大越不同）════════');
  const pairs = [];
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      let s = 0, n = 0, big = 0;
      for (let gy = 0; gy < CH; gy++) for (let gx = 0; gx < CW; gx++) {
        const d = Math.abs(info[i].lum[gy][gx] - info[j].lum[gy][gx]);
        s += d; n++;
        if (d > 40) big++;                    // "明显不同的格子"占比
      }
      pairs.push({
        pair: info[i].f.replace(/ch3-level|\.png/g, '') + ' vs ' + info[j].f.replace(/ch3-level|\.png/g, ''),
        avg: Math.round(s / n), pct: Math.round(big / n * 100),
      });
    }
  }
  pairs.sort((a, b) => a.avg - b.avg);
  console.log('（列出最像的 10 对 —— 这些是"可能撞脸"的）');
  pairs.slice(0, 10).forEach(p => console.log('  ' + p.pair.padEnd(14) + ' 平均差=' + String(p.avg).padStart(3) + '  明显不同格子=' + p.pct + '%'));
  const minAvg = pairs[0].avg;
  const avgAll = Math.round(pairs.reduce((a, b) => a + b.avg, 0) / pairs.length);
  console.log('\n  最小平均差 ' + minAvg + ' ｜ 全部平均 ' + avgAll);
  console.log('  判读：平均差 > 8 且"明显不同格子" > 25% ⇒ 构图确实不同；');
  console.log('        若平均差 < 4 ⇒ 基本是同一张图（换色）。');
}
