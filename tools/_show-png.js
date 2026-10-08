/* 自查工具：把生成的 PNG 打回 18x18 字符画（我用它"看"图）
 * 用法: node tools/_show-png.js <png路径> [网格数]
 */
const fs = require('fs'), zlib = require('zlib');
function dec(f) {
  const b = fs.readFileSync(f); let p = 8, w = 0, h = 0, ct = 0; const id = [];
  while (p < b.length) { const L = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8), d = b.slice(p + 8, p + 8 + L); if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } if (t === 'IDAT') id.push(d); p += 12 + L; }
  const raw = zlib.inflateSync(Buffer.concat(id)); const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1, st = w * ch, o = Buffer.alloc(h * st); let q = 0;
  for (let y = 0; y < h; y++) { const ft = raw[q++]; const ln = raw.slice(q, q + st); q += st; const pv = y > 0 ? o.slice((y - 1) * st, y * st) : Buffer.alloc(st); const cr = o.slice(y * st, (y + 1) * st); for (let x = 0; x < st; x++) { const a = x >= ch ? cr[x - ch] : 0, bb = pv[x], c = x >= ch ? pv[x - ch] : 0, v = ln[x]; let r; if (ft === 0) r = v; else if (ft === 1) r = v + a; else if (ft === 2) r = v + bb; else if (ft === 3) r = v + ((a + bb) >> 1); else { const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c); r = v + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c)); } cr[x] = r & 255; } }
  return { w, h, ch, data: o };
}
const file = process.argv[2];
const S = parseInt(process.argv[3] || '18', 10);
const img = dec(file);
const W = img.w, H = img.h, ch = img.ch, data = img.data;
console.log(file + '  ' + W + 'x' + H + '  ch=' + ch);
const cell = W / S;
for (let gy = 0; gy < S; gy++) {
  let line = '';
  for (let gx = 0; gx < S; gx++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.floor(gy * cell); y < Math.floor((gy + 1) * cell); y++) {
      for (let x = Math.floor(gx * cell); x < Math.floor((gx + 1) * cell); x++) {
        const j = (y * W + x) * ch;
        if (ch === 4 && data[j + 3] <= 8) continue;
        r += data[j]; g += data[j + 1]; b += data[j + 2]; n++;
      }
    }
    if (!n) { line += ' '; continue; }
    r /= n; g /= n; b /= n;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let c;
    if (mx < 90) c = '#';                       // 黑（蹄子/眼）
    else if (mx - mn < 22) c = mx > 238 ? 'W' : (mx > 220 ? 'w' : 'g');  // 白/浅灰/中灰
    else if (r > 200 && g > 150 && b < 140) c = 'Y';   // 黄（帽/制服）
    else if (r > 230 && g > 170 && b > 170) c = 'P';   // 粉（脸/腮红）
    else if (b > r) c = 'B';                   // 蓝（背包）
    else c = '?';
    line += c;
  }
  console.log(String(gy).padStart(2) + '|' + line + '|');
}
/* 统计 */
const cnt = {};
for (let i = 0; i < W * H; i++) { const j = i * ch; if (ch === 4 && data[j + 3] <= 8) continue;
  const r = data[j], g = data[j + 1], b = data[j + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let c = mx < 90 ? 'black' : (mx - mn < 22 ? 'white/gray' : (r > 200 && g > 150 && b < 140 ? 'yellow' : (r > 230 && g > 170 && b > 170 ? 'pink' : (b > r ? 'blue' : 'other'))));
  cnt[c] = (cnt[c] || 0) + 1;
}
console.log('像素构成:', JSON.stringify(cnt));
