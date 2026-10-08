/* 还原工具：用"改动前的旧规则"重新生成 sprite.png
 *
 * 背景（2026-10-07）：
 *   08:47 有人改了 process-fanart.js 的 removeBackground（棋盘格精确匹配 TOL=14），
 *   08:49 重跑了全部 fanart => 多个角色 sprite 变了样。
 *   十一报小羊"像长了两只手/六条腿"。
 *
 * 根因：新规则用 TOL=14 精确匹配棋盘格两色，但两色之间的暖白过渡带
 *       （实测主色 rgb(240,224,208)，3.3 万像素）抠不掉，被 keepLargest 保留，
 *       在小羊腿间形成"假腿"。
 *
 * 本脚本 = 完整复刻"旧规则"（亮 max>180 且低饱和 max-min<35）的那条路径，
 * 输出与 10-06 那版逐字节一致的结果。
 *
 * 用法：node tools/_revert-fanart.js lamb [more...]
 *      node tools/_revert-fanart.js --all        # 还原所有 fanart
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const FANART = path.join(ROOT, 'src', 'assets', 'fanart');
const ASSETS = path.join(ROOT, 'src', 'assets');
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

/* ===== 旧规则（改动前）：亮 + 低饱和 即背景 ===== */
function removeBackground(w, h, rgba) {
  const isBg = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx > 180 && (mx - mn) < 35; };
  const vis = new Uint8Array(w * h), st = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const id = y * w + x; if (vis[id]) return; const i = id * 4; if (!isBg(rgba[i], rgba[i + 1], rgba[i + 2])) return; vis[id] = 1; st.push(id); };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) { const id = st.pop(); const x = id % w, y = (id / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  for (let i = 0; i < w * h; i++) if (vis[i]) rgba[i * 4 + 3] = 0;
  return rgba;
}
function keepLargestComponent(w, h, rgba) { const seen = new Uint8Array(w * h); let best = null; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const idx = y * w + x; if (seen[idx] || rgba[idx * 4 + 3] <= 8) continue; const comp = []; const st = [idx]; seen[idx] = 1; while (st.length) { const id = st.pop(); comp.push(id); const cx = id % w, cy = (id / w) | 0; for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const nid = ny * w + nx; if (seen[nid] || rgba[nid * 4 + 3] <= 8) continue; seen[nid] = 1; st.push(nid); } } if (!best || comp.length > best.length) best = comp; } if (!best) return rgba; const keep = new Uint8Array(w * h); for (const id of best) keep[id] = 1; for (let i = 0; i < w * h; i++) if (!keep[i]) rgba[i * 4 + 3] = 0; return rgba; }
function trim(w, h, rgba) { let mnx = w, mny = h, mxx = -1, mxy = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 8) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; } if (mxx < 0) return { w, h, rgba }; const nw = mxx - mnx + 1, nh = mxy - mny + 1; const out = Buffer.alloc(nw * nh * 4); for (let y = 0; y < nh; y++) rgba.copy(out, y * nw * 4, ((y + mny) * w + mnx) * 4, ((y + mny) * w + mnx + nw) * 4); return { w: nw, h: nh, rgba: out }; }
function resizeNearest(w, h, rgba, tw, th) { const out = Buffer.alloc(tw * th * 4); for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const sx = Math.min(w - 1, Math.round(x * w / tw)), sy = Math.min(h - 1, Math.round(y * h / th)); const si = (sy * w + sx) * 4, di = (y * tw + x) * 4; out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3]; } return out; }

function processRole(role) {
  const src = path.join(FANART, role, 'source.png');
  const dst = path.join(FANART, role, 'sprite.png');
  if (!fs.existsSync(src)) { console.log('  [skip] ' + role + ': 无 source.png'); return null; }
  const img = decodePNG(src);
  let rgba = toRGBA(img);
  rgba = removeBackground(img.w, img.h, rgba);
  rgba = keepLargestComponent(img.w, img.h, rgba);
  const t = trim(img.w, img.h, rgba);
  const scale = MAX_SIDE / Math.max(t.w, t.h);
  const tw = Math.max(1, Math.round(t.w * scale)), th = Math.max(1, Math.round(t.h * scale));
  const png = encodePNG(tw, th, resizeNearest(t.w, t.h, t.rgba, tw, th));
  fs.writeFileSync(dst, png);
  console.log('  [ok] ' + role + ': ' + img.w + 'x' + img.h + ' -> ' + tw + 'x' + th);
  return { tw, th, png };
}

const args = process.argv.slice(2);
let roles = args;
if (args[0] === '--all') {
  roles = fs.readdirSync(FANART, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
} else if (!roles.length) {
  roles = ['lamb'];
}
console.log('用【旧规则】还原 ' + roles.length + ' 个角色：');
const results = {};
for (const r of roles) { const res = processRole(r); if (res) results[r] = res; }

/* 同步到 src/assets/<role>.png（游戏实际加载的位置）—— 只对"已接入游戏"的角色做 */
const WIRED = ['lamb', 'judy', 'fish', 'puppy', 'pinkiepie', 'monkey', 'nick', 'stitch'];
for (const r of Object.keys(results)) {
  if (WIRED.includes(r)) {
    fs.writeFileSync(path.join(ASSETS, r + '.png'), results[r].png);
    console.log('  [sync] assets/' + r + '.png');
  }
}
