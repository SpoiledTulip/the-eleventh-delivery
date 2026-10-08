/* ============================================================
 * tools/_process-lamb.js — 小羊专用抠图（AI 原图画风）
 * ============================================================
 * 【为什么单独写一个，不改 process-fanart.js】
 *   项目里其他角色（朱迪白兔等）用现版本 work 得很好；
 *   小羊的问题是**它周围的暖白过渡区**（实测主色 rgb(240,224,208)）
 *   与米白毛色太接近。动公共脚本会连带影响其它角色 → 风险高。
 *   ⇒ 单独给小羊一个更稳的流程，验证满意后再考虑要不要合并。
 *
 * 【算法（修正版）】
 *   ① 采样：**先量化到 12 的格**再统计（不量化会把同一色拆成几十个，
 *      票数分散 → 抓不到真正的棋盘格两色）。取最高的两个"亮灰"色。
 *   ② 背景判定：像素"落在两色的**线段**附近（点到线段距离 ≤ tol）"
 *      且低饱和。
 *      ★ 关键：用**线段**而不是两个球 —— 棋盘格两色之间的抗锯齿过渡像素
 *        正好落在连线上，用线段才能一并抠掉（这就是"多出手"的根源）。
 *   ③ 泛洪：只从图像**边缘**开始泛洪（角色内部的白毛不可达 → 保住）。
 *   ④ 保留最大连通块（去水印/噪点）。
 *   ⑤ 裁剪 + 最近邻缩放到 128 高。
 *
 * 用法: node tools/_process-lamb.js
 * ============================================================
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const MAX_SIDE = 128;

function decodePNG(file) {
  const b = fs.readFileSync(file); let pos = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (pos < b.length) { const len = b.readUInt32BE(pos); const t = b.toString('ascii', pos + 4, pos + 8); const d = b.slice(pos + 8, pos + 8 + len); if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } if (t === 'IDAT') idat.push(d); pos += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1, stride = w * ch, out = Buffer.alloc(h * stride); let p = 0;
  for (let y = 0; y < h; y++) { const ft = raw[p++]; const line = raw.slice(p, p + stride); p += stride; const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride); const cur = out.slice(y * stride, (y + 1) * stride); for (let x = 0; x < stride; x++) { const a = x >= ch ? cur[x - ch] : 0, bb = prev[x], c = x >= ch ? prev[x - ch] : 0, v = line[x]; let r; if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + bb; else if (ft === 3) r = v + ((a + bb) >> 1); else { const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c); r = v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c)); } cur[x] = r & 255; } }
  return { w, h, ch, data: out };
}
let CRC = null;
function crc32(buf) { if (!CRC) { CRC = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); CRC[n] = c; } } let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return c ^ -1; }
function encodePNG(w, h, rgba) { const stride = w * 4; const raw = Buffer.alloc(h * (stride + 1)); for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); } const comp = zlib.deflateSync(raw, { level: 9 }); function chunk(t, d) { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t, 'ascii'), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0); return Buffer.concat([len, body, crc]); } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', comp), chunk('IEND', Buffer.alloc(0))]); }
function toRGBA(img) { const { w, h, ch, data } = img; const out = Buffer.alloc(w * h * 4); for (let i = 0, j = 0; i < w * h; i++, j += ch) { out[i * 4] = data[j]; out[i * 4 + 1] = data[j + 1]; out[i * 4 + 2] = data[j + 2]; out[i * 4 + 3] = ch === 4 ? data[j + 3] : 255; } return out; }

/* ---- ① 量化采样，取两个"亮灰"主色（还原为桶内均值）---- */
function detectBoardColors(img) {
  const { w, h, ch, data } = img;
  const votes = new Map(), sums = new Map();
  const Q = 12;                       // ★ 量化步长（12 是实测调出来的）
  const BAND = 64;                    // ★ 外圈采样带宽（太小会被抗锯齿噪点干扰）
  const STEP = 3;
  function vote(x, y) {
    const j = (y * w + x) * ch;
    const r = data[j], g = data[j + 1], b = data[j + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 150 || (mx - mn) > 22) return;          // 只要"亮灰"候选
    const key = ((r / Q) | 0) + ',' + ((g / Q) | 0) + ',' + ((b / Q) | 0);
    votes.set(key, (votes.get(key) || 0) + 1);
    if (!sums.has(key)) sums.set(key, [0, 0, 0, 0]);
    const s = sums.get(key); s[0] += r; s[1] += g; s[2] += b; s[3]++;
  }
  for (let x = 0; x < w; x += STEP) for (let d = 0; d < BAND; d += STEP) { vote(x, d); vote(x, h - 1 - d); }
  for (let y = 0; y < h; y += STEP) for (let d = 0; d < BAND; d += STEP) { vote(d, y); vote(w - 1 - d, y); }
  if (!votes.size) return null;
  const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, e) => s + e[1], 0);
  const top = sorted.slice(0, 2).map(e => {
    const s = sums.get(e[0]);
    return { r: Math.round(s[0] / s[3]), g: Math.round(s[1] / s[3]), b: Math.round(s[2] / s[3]), n: e[1] };
  });
  const cover = top.reduce((s, c) => s + c.n, 0) / total;
  if (top.length < 2 || cover < 0.30) return null;
  const d01 = Math.abs(top[0].r - top[1].r) + Math.abs(top[0].g - top[1].g) + Math.abs(top[0].b - top[1].b);
  if (d01 < 12) return null;
  return { board: top, cover };
}

/* ---- 点到线段距离平方 ---- */
function distSeg2(px, py, pz, ax, ay, az, bx, by, bz) {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const wx = px - ax, wy = py - ay, wz = pz - az;
  const vv = vx * vx + vy * vy + vz * vz;
  let t = vv > 0 ? (wx * vx + wy * vy + wz * vz) / vv : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = wx - t * vx, dy = wy - t * vy, dz = wz - t * vz;
  return dx * dx + dy * dy + dz * dz;
}

/* ---- ② + ③ 抠背景（线段 + 泛洪）---- */
function removeBackground(w, h, rgba, det) {
  let isBg;
  if (!det) {
    isBg = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 180 && (mx - mn) < 35; };
  } else {
    const [A, B] = det.board;
    const tol2 = det.tol * det.tol;
    isBg = (r, g, b) => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if ((mx - mn) > det.satMax) return false;       // 有彩 → 角色
      if (mx < det.lumMin) return false;              // 太暗 → 角色
      return distSeg2(r, g, b, A.r, A.g, A.b, B.r, B.g, B.b) <= tol2;
    };
  }
  const vis = new Uint8Array(w * h), st = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const id = y * w + x; if (vis[id]) return; const i = id * 4; if (!isBg(rgba[i], rgba[i + 1], rgba[i + 2])) return; vis[id] = 1; st.push(id); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) { const id = st.pop(); const x = id % w, y = (id / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  for (let i = 0; i < w * h; i++) if (vis[i]) rgba[i * 4 + 3] = 0;
  return rgba;
}

/* ---- ④ 保留最大连通块 ---- */
function keepLargest(w, h, rgba) { const seen = new Uint8Array(w * h); let best = null; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const idx = y * w + x; if (seen[idx] || rgba[idx * 4 + 3] <= 8) continue; const comp = []; const st = [idx]; seen[idx] = 1; while (st.length) { const id = st.pop(); comp.push(id); const cx = id % w, cy = (id / w) | 0; for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const nid = ny * w + nx; if (seen[nid] || rgba[nid * 4 + 3] <= 8) continue; seen[nid] = 1; st.push(nid); } } if (!best || comp.length > best.length) best = comp; } if (!best) return rgba; const keep = new Uint8Array(w * h); for (const id of best) keep[id] = 1; for (let i = 0; i < w * h; i++) if (!keep[i]) rgba[i * 4 + 3] = 0; return rgba; }
function trim(w, h, rgba) { let mnx = w, mny = h, mxx = -1, mxy = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 8) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; } if (mxx < 0) return { w, h, rgba }; const nw = mxx - mnx + 1, nh = mxy - mny + 1; const out = Buffer.alloc(nw * nh * 4); for (let y = 0; y < nh; y++) rgba.copy(out, y * nw * 4, ((y + mny) * w + mnx) * 4, ((y + mny) * w + mnx + nw) * 4); return { w: nw, h: nh, rgba: out }; }
function resizeNearest(w, h, rgba, tw, th) { const out = Buffer.alloc(tw * th * 4); for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const sx = Math.min(w - 1, Math.round(x * w / tw)), sy = Math.min(h - 1, Math.round(y * h / th)); const si = (sy * w + sx) * 4, di = (y * tw + x) * 4; out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3]; } return out; }

/* ---- 主流程 ---- */
const role = process.argv[2] || 'lamb';
const src = path.join(ROOT, 'src', 'assets', 'fanart', role, 'source.png');
const img = decodePNG(src);
const det = detectBoardColors(img);
console.log('棋盘格检测: ' + (det ? '两色 ' + det.board.map(c => '(' + c.r + ',' + c.g + ',' + c.b + ')').join(' / ') + ' 覆盖 ' + det.cover.toFixed(2) : '失败→退回旧规则'));
const PARAMS = { tol: det ? 16 : 0, satMax: 24, lumMin: 150 };
console.log('抠图参数: ' + JSON.stringify(PARAMS));
let rgba = toRGBA(img);
removeBackground(img.w, img.h, rgba, det);
keepLargest(img.w, img.h, rgba);
const t = trim(img.w, img.h, rgba);
const scale = MAX_SIDE / Math.max(t.w, t.h);
const tw = Math.max(1, Math.round(t.w * scale)), th = Math.max(1, Math.round(t.h * scale));
const png = encodePNG(tw, th, resizeNearest(t.w, t.h, t.rgba, tw, th));
const out1 = path.join(ROOT, 'src', 'assets', role + '.png');
const out2 = path.join(ROOT, 'src', 'assets', 'fanart', role, 'sprite.png');
fs.writeFileSync(out1, png);
fs.writeFileSync(out2, png);
console.log('输出 ' + img.w + 'x' + img.h + ' -> ' + tw + 'x' + th + ' (' + png.length + ' 字节)');
console.log('  ' + out1);
