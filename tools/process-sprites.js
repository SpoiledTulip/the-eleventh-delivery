/* ============================================================
 * tools/process-sprites.js
 * 把 AI 生成的角色图处理成游戏能用的贴图：
 *   1. 去掉白底 → 变真透明
 *   2. 裁掉多余的空白边
 *   3. 缩放到 128x128（游戏里会再按需缩放）
 *   4. 复制成 kangaroo.png / dragon.png
 *
 * 为什么要自己处理：AI 出图时未必真的给透明背景
 * （这次拿到的是白底 RGB 图），所以得补一道"抠白底"。
 *
 * 用法：node tools/process-sprites.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- 最小 PNG 编解码（不依赖任何第三方库） ---------- */

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
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
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

function encodePNG(w, h, rgba) {
  // 每行前面加 filter byte 0
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
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

/* ---------- 处理流程 ---------- */

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

/**
 * 抠白底：把接近白色的像素设为透明。
 * threshold 越大抠得越狠（会吃到浅色角色）。
 * 这里对浅色角色（奶龙是奶白）要小心，所以用较严的阈值 +
 * 只抠"从边缘连通的白色区域"（避免把角色内部的白色抠掉）。
 */
function removeWhiteBackground(w, h, rgba, threshold) {
  threshold = threshold == null ? 30 : threshold;
  const isWhite = function (i) {
    return rgba[i] > 255 - threshold && rgba[i + 1] > 255 - threshold && rgba[i + 2] > 255 - threshold;
  };
  // 从四边做泛洪，只把"和边界连通的白色"变透明
  const visited = new Uint8Array(w * h);
  const stack = [];
  function push(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    if (!isWhite(idx * 4)) return;
    visited[idx] = 1;
    stack.push(idx);
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const idx = stack.pop();
    rgba[idx * 4 + 3] = 0;
    const x = idx % w, y = (idx / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return rgba;
}

/** 裁掉全透明的边 */
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

/* 面积平均缩放（保持像素风不糊，用最近邻更好） */
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

/* ---------- 主流程 ---------- */

const ASSETS = __dirname ? path.join(__dirname, '..', 'assets') : '.';
const OUT = path.join(__dirname, '..', 'assets');

function process(srcFile, outName, whiteThreshold) {
  const img = decodePNG(path.join(ASSETS, srcFile));
  let rgba = toRGBA(img);
  rgba = removeWhiteBackground(img.w, img.h, rgba, whiteThreshold);
  const t = trim(img.w, img.h, rgba);
  // 缩放：保持比例，最长边 128
  const maxSide = 128;
  const scale = maxSide / Math.max(t.w, t.h);
  const tw = Math.max(1, Math.round(t.w * scale));
  const th = Math.max(1, Math.round(t.h * scale));
  const scaled = resizeNearest(t.w, t.h, t.rgba, tw, th);
  const png = encodePNG(tw, th, scaled);
  fs.writeFileSync(path.join(OUT, outName), png);
  console.log('  ' + srcFile.slice(0, 32) + '... → ' + outName);
  console.log('    原图 ' + img.w + 'x' + img.h + ' → 裁边 ' + t.w + 'x' + t.h + ' → 输出 ' + tw + 'x' + th + ' (' + (png.length / 1024).toFixed(1) + 'KB)');
  return { tw, th };
}

console.log('处理角色贴图（抠白底 → 裁边 → 缩放）\n');

const files = fs.readdirSync(ASSETS).filter(function (f) { return /^16_bit_pixel_art.*\.png$/.test(f); });
if (files.length < 2) {
  console.log('❌ 在 assets/ 里没找到两张生成图，实际找到 ' + files.length + ' 张');
  process.exit(1);
}
// 按生成时间排序：第一张是袋鼠，第二张是奶龙
files.sort();
process(files[0], 'kangaroo.png', 40);
process(files[1], 'dragon.png', 22);   // 奶龙是奶白，阈值要更低，别把身体抠掉

console.log('\n完成。输出在 assets/kangaroo.png 和 assets/dragon.png');
