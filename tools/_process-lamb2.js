/* ============================================================
 * tools/_process-lamb2.js — 小羊专用抠图 v2（纯深色背景版）
 * ============================================================
 * 【为什么能简化】
 *   这次的 source.png 背景是**纯深青色 rgb(36,60,72)**（单一色，占 76%），
 *   与亮色小羊对比极强 ⇒ 不需要棋盘格检测，直接"深色 = 背景"即可，
 *   抠得又干净又稳。
 *
 * 【v1 的两个问题（本版修掉）】
 *   ① 保留最大连通块没生效 → 原图别处的蓝色碎片被带进来
 *      （处理后 128×128 右下角出现蓝块）
 *   ② 裁剪框按整图算 → 把碎片的范围也算进去
 *   ⇒ 修法：抠完先按"面积"过滤连通块（只留最大的 1 块），
 *      并且**要求面积 ≥ 总不透明像素的 50%** 才算主体。
 *
 * 用法: node tools/_process-lamb2.js <role>
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

/* 采样背景色（外圈主色） */
function bgColor(img) {
  const { w, h, ch, data } = img; const m = new Map();
  const add = (x, y) => { const j = (y * w + x) * ch; const k = ((data[j] / 8) | 0) + ',' + ((data[j + 1] / 8) | 0) + ',' + ((data[j + 2] / 8) | 0); m.set(k, (m.get(k) || 0) + 1); };
  for (let x = 0; x < w; x += 2) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += 2) { add(0, y); add(w - 1, y); }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const p = top[0].split(',').map(x => x * 8 + 4);
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  return { r: p[0], g: p[1], b: p[2], cover: top[1] / total };
}

/* 抠图：① 颜色距离背景远 ⇒ 主体候选；② 再从边缘泛洪把"背景连通区"抠掉 */
function removeBg(w, h, rgba, bg, opt) {
  const tol = opt.tol;
  const isBg = (r, g, b) => {
    const d = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
    return d <= tol;
  };
  const vis = new Uint8Array(w * h), st = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const id = y * w + x; if (vis[id]) return; const i = id * 4; if (!isBg(rgba[i], rgba[i + 1], rgba[i + 2])) return; vis[id] = 1; st.push(id); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) { const id = st.pop(); const x = id % w, y = (id / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  for (let i = 0; i < w * h; i++) if (vis[i]) rgba[i * 4 + 3] = 0;
  return rgba;
}

/* 连通块统计 → 只保留主体（面积 ≥ 总不透明 50% 的最大块） */
function keepMainBody(w, h, rgba) {
  const seen = new Uint8Array(w * h);
  const comps = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (seen[idx] || rgba[idx * 4 + 3] <= 8) continue;
    const cells = []; const st = [idx]; seen[idx] = 1;
    let mnx = w, mny = h, mxx = -1, mxy = -1;
    while (st.length) {
      const id = st.pop(); cells.push(id); const cx = id % w, cy = (id / w) | 0;
      if (cx < mnx) mnx = cx; if (cx > mxx) mxx = cx; if (cy < mny) mny = cy; if (cy > mxy) mxy = cy;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nid = ny * w + nx;
        if (seen[nid] || rgba[nid * 4 + 3] <= 8) continue;
        seen[nid] = 1; st.push(nid);
      }
    }
    comps.push({ cells, size: cells.length, box: [mnx, mny, mxx, mxy] });
  }
  comps.sort((a, b) => b.size - a.size);
  const main = comps[0];
  const keep = new Uint8Array(w * h);
  for (const id of main.cells) keep[id] = 1;
  for (let i = 0; i < w * h; i++) if (!keep[i]) rgba[i * 4 + 3] = 0;
  return { comps: comps.length, mainSize: main.size, box: main.box, kept: comps.length };
}

function cropTo(rgba, w, h, box) {
  const [mnx, mny, mxx, mxy] = box;
  const nw = mxx - mnx + 1, nh = mxy - mny + 1;
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) rgba.copy(out, y * nw * 4, ((y + mny) * w + mnx) * 4, ((y + mny) * w + mnx + nw) * 4);
  return { w: nw, h: nh, rgba: out };
}
function resizeNearest(w, h, rgba, tw, th) { const out = Buffer.alloc(tw * th * 4); for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const sx = Math.min(w - 1, Math.round(x * w / tw)), sy = Math.min(h - 1, Math.round(y * h / th)); const si = (sy * w + sx) * 4, di = (y * tw + x) * 4; out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3]; } return out; }

/* ---- 主流程 ---- */
const role = process.argv[2];
if (!role) { console.log('用法: node tools/_process-lamb2.js <role>'); process.exit(1); }
const src = path.join(ROOT, 'src', 'assets', 'fanart', role, 'source.png');
const img = decodePNG(src);
const bg = bgColor(img);
console.log('背景色采样: rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ') 覆盖率 ' + bg.cover.toFixed(2));
const TOL = parseInt(process.argv[3] || '150', 10);
console.log('容差 tol = ' + TOL + '（RGB 曼哈顿距离）');
let rgba = toRGBA(img);
removeBg(img.w, img.h, rgba, bg, { tol: TOL });
const body = keepMainBody(img.w, img.h, rgba);
console.log('连通块 ' + body.comps + ' 个，主体面积 ' + body.mainSize + ' px，包围盒 ' + body.box.join(','));
const t = cropTo(rgba, img.w, img.h, body.box);
const scale = MAX_SIDE / Math.max(t.w, t.h);
const tw = Math.max(1, Math.round(t.w * scale)), th = Math.max(1, Math.round(t.h * scale));
const png = encodePNG(tw, th, resizeNearest(t.w, t.h, t.rgba, tw, th));
fs.writeFileSync(path.join(ROOT, 'src', 'assets', role + '.png'), png);
fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'fanart', role.replace(/-new$/, ''), 'sprite.png'), png);
console.log('输出 ' + t.w + 'x' + t.h + ' -> ' + tw + 'x' + th + ' (' + png.length + ' 字节)');
console.log('  src/assets/' + role + '.png');
