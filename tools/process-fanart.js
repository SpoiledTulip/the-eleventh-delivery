#!/usr/bin/env node
/**
 * 二创素材处理工具
 *
 * 把 src/assets/fanart/<角色>/source.png（AI 生成的大图）
 * 处理成 src/assets/fanart/<角色>/sprite.png（可直接用的游戏贴图）。
 *
 * 处理步骤：
 *   1. 解码 PNG（纯 Node，不依赖第三方库）
 *   2. 泛洪填充去掉浅色/棋盘格背景
 *   3. 只保留最大的连通角色区域（顺带去掉水印等孤立块）
 *   4. 裁剪掉四周透明留白
 *   5. 最近邻缩放到 128px 高（保持像素风，不做插值模糊）
 *
 * 用法：
 *   node tools/process-fanart.js                    # 处理所有角色
 *   node tools/process-fanart.js doraemon mickey    # 只处理指定角色
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FANART_DIR = path.join(ROOT, 'src', 'assets', 'fanart');
const MAX_SIDE = 128;

/* ---------------- PNG 解码 ---------------- */

function decodePNG(file) {
  const b = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = require('zlib').inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const bb = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      const v = line[x];
      let r;
      if (ft === 0) r = v;
      else if (ft === 1) r = v + a;
      else if (ft === 2) r = v + bb;
      else if (ft === 3) r = v + ((a + bb) >> 1);
      else {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        r = v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c));
      }
      cur[x] = r & 255;
    }
  }
  return { w, h, ch, data: out };
}

/* ---------------- PNG 编码 ---------------- */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = require('zlib').deflateSync(raw, { level: 9 });
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 图像处理 ---------------- */

function toRGBA(img) {
  const { w, h, ch, data } = img;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    out[i * 4] = data[j];
    out[i * 4 + 1] = data[j + 1];
    out[i * 4 + 2] = data[j + 2];
    out[i * 4 + 3] = ch === 4 ? data[j + 3] : 255;
  }
  return out;
}

/* ============================================================
 * 背景判定（★ 2026-10-07 大改：修"白色角色被当成背景抠掉"★）
 * ============================================================
 * 【原来的写法（有严重缺陷）】
 *   `return max > 180 && (max - min) < 35;`
 *   即"亮 + 低饱和 = 背景"。
 *
 * 【它为什么错】（十一报的 bug："朱迪没有头了"）
 *   AI 生成图的透明背景常常是**灰白棋盘格**（模拟透明）。
 *   而**白色的角色**（朱迪是白兔！）本身也是"亮 + 低饱和" ——
 *   于是这条规则把**角色的头和身体一起当成背景抠掉了**，
 *   只剩下深色的眼睛/制服残片。
 *
 * 【怎么修：用"棋盘格纹理"识别，而不是用"亮色"识别】
 *   棋盘格有两个可靠特征：
 *     ① 只有**两种**精确色值（亮格 / 暗格）交替
 *     ② 沿水平/垂直方向以**固定周期**（这里是 64px）方块交替
 *   角色身上**不会**出现这种规律。所以：
 *     · 先把图里出现最多的两种"亮灰/浅灰"色认作棋盘格两色
 *     · 只有**精确匹配这两色之一**的像素才算背景候选
 *     · 再加上"从图片边缘泛洪可达"（角色内部的白毛不会连通到边界）
 *
 * ⚠️ 关键是**收紧颜色容差**：原来 35 太宽（把 215 和 247 都算一类），
 *    现在只认"离某个棋盘格色 ≤ 12"的像素。
 * ============================================================ */

/** 从图像四边采样，推断棋盘格的两个代表色。
 *  返回 [{r,g,b}, {r,g,b}] 或 null（图里没有明显棋盘格）。 */
function detectBoardColors(img) {
  const { w, h, ch, data } = img;
  const votes = new Map();          // 量化色 -> 次数
  const step = 4;
  /* ★ 采样范围：最外圈 48 像素（2026-10-07 改）★
   * ⚠️ 原来只采 12 像素，但**外圈常有抗锯齿和噪点**，导致
   *    "最高的两色覆盖率"达不到阈值 → 判定失败 → 退回宽松规则 →
   *    白色角色被误抠（朱迪"没有头"就是这个原因）。
   *    放宽到 48 后能采到足够多的**干净棋盘格**像素。 */
  const band = 48;
  function vote(x, y) {
    const j = (y * w + x) * ch;
    const r = data[j], g = data[j + 1], b = data[j + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    /* 棋盘格是"亮灰"，先粗筛一次（宽松，只是候选） */
    if (max < 150 || (max - min) > 24) return;
    /* 量化到 10 的格，抵消 PNG 压缩噪点。
     * ⚠️ 原来是 6 —— 太细，同一块棋盘格被拆成好几个色桶，
     *    每桶票数都不高，导致"两色覆盖率"上不去。 */
    const key = ((r / 10) | 0) + ',' + ((g / 10) | 0) + ',' + ((b / 10) | 0);
    votes.set(key, (votes.get(key) || 0) + 1);
  }
  for (let x = 0; x < w; x += step) {
    for (let d = 0; d < band; d += 2) { vote(x, d); vote(x, h - 1 - d); }
  }
  for (let y = 0; y < h; y += step) {
    for (let d = 0; d < band; d += 2) { vote(d, y); vote(w - 1 - d, y); }
  }
  if (!votes.size) return null;
  /* 取票数最高的两种颜色 */
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, e) => s + e[1], 0);
  const top = sorted.slice(0, 2).map(e => {
    const p = e[0].split(',').map(Number);
    return { r: p[0] * 10, g: p[1] * 10, b: p[2] * 10, n: e[1] };
  });
  /* 两种色加起来要占采样的一定比例，才认为"这图有棋盘格"。
   * ⚠️ 阈值从 0.5 降到 0.35 —— 采样范围放宽后噪点变多，
   *    但只要有明显的主色对就够用了。 */
  const cover = top.reduce((s, c) => s + c.n, 0) / total;
  if (top.length < 2 || cover < 0.35) return null;
  /* ⚠️ 两色必须**明显不同**，否则不是棋盘格（可能是纯色背景） */
  const d01 = Math.abs(top[0].r - top[1].r) + Math.abs(top[0].g - top[1].g) + Math.abs(top[0].b - top[1].b);
  if (d01 < 15) {
    /* 只有一种色 → 当作纯色背景（交给宽松规则处理），返回 null */
    return null;
  }
  return top;
}

function removeBackground(w, h, rgba) {
  /* 先推断棋盘格色；推不出来就退回"旧的宽松规则"（保守，不乱抠） */
  const img = { w, h, ch: 4, data: rgba };
  const board = detectBoardColors(img);

  function isBackground(r, g, b) {
    if (!board) {
      /* 没有棋盘格（纯色背景）→ 用原来的宽松规则 */
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      return max > 180 && (max - min) < 35;
    }
    /* 有棋盘格 → **只认精确匹配两色之一**的像素。
     * ⚠️ 容差 14 是调出来的：
     *    太小 → 棋盘格边缘的抗锯齿像素抠不干净（留一圈灰边）
     *    太大 → 角色的浅色部分会被误伤（就是这次的 bug） */
    const TOL = 14;
    for (let k = 0; k < board.length; k++) {
      const c = board[k];
      if (Math.abs(r - c.r) <= TOL && Math.abs(g - c.g) <= TOL && Math.abs(b - c.b) <= TOL) {
        return true;
      }
    }
    return false;
  }

  const visited = new Uint8Array(w * h);
  const stack = [];
  function push(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    const i = idx * 4;
    if (!isBackground(rgba[i], rgba[i + 1], rgba[i + 2])) return;
    visited[idx] = 1;
    stack.push(idx);
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w, y = (idx / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  for (let i = 0; i < w * h; i++) {
    if (visited[i]) rgba[i * 4 + 3] = 0;
  }
  return rgba;
}

function keepLargestComponent(w, h, rgba) {
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (seen[idx] || rgba[idx * 4 + 3] <= 8) continue;
      const comp = [];
      const stack = [idx];
      seen[idx] = 1;
      while (stack.length) {
        const id = stack.pop();
        comp.push(id);
        const cx = id % w, cy = (id / w) | 0;
        const nbs = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nidx = ny * w + nx;
          if (seen[nidx] || rgba[nidx * 4 + 3] <= 8) continue;
          seen[nidx] = 1;
          stack.push(nidx);
        }
      }
      if (!best || comp.length > best.length) best = comp;
    }
  }
  if (!best) return rgba;
  const keep = new Uint8Array(w * h);
  for (const id of best) keep[id] = 1;
  for (let i = 0; i < w * h; i++) {
    if (!keep[i]) rgba[i * 4 + 3] = 0;
  }
  return rgba;
}

function trim(w, h, rgba) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { w, h, rgba };
  const nw = maxX - minX + 1, nh = maxY - minY + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    rgba.copy(out, y * nw * 4, ((y + minY) * w + minX) * 4, ((y + minY) * w + minX + nw) * 4);
  }
  return { w: nw, h: nh, rgba: out };
}

function resizeNearest(w, h, rgba, tw, th) {
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.round(x * w / tw));
      const sy = Math.min(h - 1, Math.round(y * h / th));
      const si = (sy * w + sx) * 4, di = (y * tw + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

/* ---------------- 主流程 ---------------- */

function processRole(role) {
  const dir = path.join(FANART_DIR, role);
  const srcPath = path.join(dir, 'source.png');
  const dstPath = path.join(dir, 'sprite.png');

  if (!fs.existsSync(srcPath)) {
    console.log(`  [skip] ${role}: 缺少 source.png`);
    return false;
  }

  const img = decodePNG(srcPath);
  let rgba = toRGBA(img);
  rgba = removeBackground(img.w, img.h, rgba);
  rgba = keepLargestComponent(img.w, img.h, rgba);
  const t = trim(img.w, img.h, rgba);
  const scale = MAX_SIDE / Math.max(t.w, t.h);
  const tw = Math.max(1, Math.round(t.w * scale));
  const th = Math.max(1, Math.round(t.h * scale));
  const scaled = resizeNearest(t.w, t.h, t.rgba, tw, th);
  fs.writeFileSync(dstPath, encodePNG(tw, th, scaled));
  console.log(`  [ok] ${role}: ${img.w}x${img.h} -> ${tw}x${th}`);
  return true;
}

const args = process.argv.slice(2);
let roles;
if (args.length > 0) {
  roles = args;
} else {
  roles = fs.readdirSync(FANART_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();
}

console.log(`处理 ${roles.length} 个角色素材：`);
let done = 0;
for (const role of roles) {
  if (processRole(role)) done++;
}
console.log(`完成：${done}/${roles.length}`);
