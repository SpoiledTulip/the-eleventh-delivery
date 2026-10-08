/* ============================================================
 * _bgshot.js — 背景"配色指纹"分析（诊断工具）
 * ============================================================
 * 【为什么需要】
 *   这一轮的诉求是"每关背景要能一眼区分，不能只是换颜色"。
 *   但我（AI）看不到图，所以用**像素统计**来判断：
 *     · 天空带（顶部 25%）的平均色 / 色相直方图
 *     · 远景带 / 中景带 / 地面带的平均色
 *     · 整图的**色相多样性**（只有一种色相 = 单色换皮）
 *     · 边缘密度（楼房剪影和云朵会产生大量竖直/水平边缘）
 *
 *   颜色能区分 ≠ 构图能区分。所以这里额外算
 *   "**竖直边缘的比例**"——同一排高楼剪影的竖边密度是固定的，
 *   如果 8 关这个数字都差不多，就说明**还是在用同一套剪影**。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

/* 极简 PNG 解码：用 Chrome 截图工具链里的 canvas? 不行（Node 无 DOM）。
 * ⇒ 改用 zlib 手解 PNG（截图是标准 RGBA/RGB PNG，无隔行）。 */
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels) throw new Error('colorType ' + colorType);
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
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    /* cur 是 slice（视图），写入已生效 */
  }
  return { w, h, channels, data: out };
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hh = 0;
  if (d > 0) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  const s = mx === 0 ? 0 : d / mx;
  return { h: hh, s: s, v: mx };
}

const dir = process.argv[2] || 'dist/_mod_shots';
const files = fs.readdirSync(dir).filter(f => /^ch3-level\d+\.png$/.test(f)).sort();
if (!files.length) { console.error('没有找到 ch3-levelNN.png，先跑测试生成截图'); process.exit(1); }

const REPORT = [];
for (const f of files) {
  const img = decodePNG(fs.readFileSync(path.join(dir, f)));
  const { w, h, channels, data } = img;
  /* 按"带"统计：天空 0~22%、远景 22~45%、中景 45~70%、地面 70~100% */
  const bands = [[0, 0.22, 'sky'], [0.22, 0.45, 'far'], [0.45, 0.70, 'mid'], [0.70, 1.0, 'ground']];
  const bandStat = {};
  /* 整图平均色（排除最下面的 HUD 区，只看画面主体上方 88%） */
  let ar = 0, ag = 0, ab = 0, an = 0;
  for (let y = 0; y < Math.floor(h * 0.88); y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = y * w * channels + x * channels;
      ar += data[i]; ag += data[i + 1]; ab += data[i + 2]; an++;
    }
  }
  bandStat.avg = [Math.round(ar / an), Math.round(ag / an), Math.round(ab / an)];
  for (const [a, b, name] of bands) {
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = Math.floor(a * h); y < Math.floor(b * h); y++) {
      for (let x = 0; x < w; x += 2) {
        const i = y * w * channels + x * channels;
        r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
      }
    }
    bandStat[name] = [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  }
  /* 色相多样性：全图采样，按 30° 一个 bin 统计"非灰"像素 */
  const hueBin = new Array(12).fill(0);
  let colored = 0;
  for (let y = 0; y < h; y += 3) {
    for (let x = 0; x < w; x += 3) {
      const i = y * w * channels + x * channels;
      const c = rgb2hsv(data[i], data[i + 1], data[i + 2]);
      if (c.s > 0.12 && c.v > 0.10) { hueBin[Math.floor(c.h / 30) % 12]++; colored++; }
    }
  }
  const hueSpread = hueBin.filter(v => v > colored * 0.04).length;
  /* 竖直边缘密度：逐行找亮度跳变（楼房/管道竖直边）
   * ⚠️ 这是判断"是不是同一排高楼剪影"的关键指标。 */
  let vEdges = 0, samples = 0;
  for (let y = 10; y < h - 10; y += 4) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w * channels + x * channels;
      const i2 = y * w * channels + (x + 1) * channels;
      const l1 = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      const l2 = data[i2] * 0.3 + data[i2 + 1] * 0.59 + data[i2 + 2] * 0.11;
      if (Math.abs(l1 - l2) > 55) vEdges++;
      samples++;
    }
  }
  /* ============================================================
   * 结构指纹（★ 判断"构图是否不同"的关键）
   * ============================================================
   * 【为什么平均色不够】
   *   第 15/17/19 关都是"很暗的场景"，平均色天然接近，
   *   但它们的**构图可能完全不同**（拱顶 / 招牌 / 铁塔）。
   *   颜色相近 ≠ 长得一样 —— 验收标准是"一眼能认出是哪一关"，
   *   那看的是**结构**：哪里有边、边在哪、疏密如何。
   *
   * ⇒ 做法：把画面切成 8 列 × 5 行 = 40 个格子，
   *   统计每格的**边缘密度**（亮度跳变比例），得到一个 40 维向量。
   *   两关的向量距离 = 构图差异。这个指标对颜色不敏感、对形状敏感。
   * ============================================================ */
  const GW = 8, GH = 5;
  const grid = new Array(GW * GH).fill(0);
  const gcount = new Array(GW * GH).fill(0);
  for (let y = 1; y < Math.floor(h * 0.9) - 1; y++) {
    const gy = Math.min(GH - 1, Math.floor((y / (h * 0.9)) * GH));
    for (let x = 1; x < w - 1; x++) {
      const gx = Math.min(GW - 1, Math.floor((x / w) * GW));
      const gi = gy * GW + gx;
      gcount[gi]++;
      const i = y * w * channels + x * channels;
      const i2 = y * w * channels + (x + 1) * channels;
      const i3 = (y + 1) * w * channels + x * channels;
      const l1 = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      const lh = data[i2] * 0.3 + data[i2 + 1] * 0.59 + data[i2 + 2] * 0.11;
      const lv = data[i3] * 0.3 + data[i3 + 1] * 0.59 + data[i3 + 2] * 0.11;
      if (Math.abs(l1 - lh) > 40 || Math.abs(l1 - lv) > 40) grid[gi]++;
    }
  }
  for (let i = 0; i < grid.length; i++) grid[i] = gcount[i] ? grid[i] / gcount[i] : 0;

  REPORT.push({
    file: f, size: w + 'x' + h,
    sky: bandStat.sky, far: bandStat.far, mid: bandStat.mid, ground: bandStat.ground,
    avg: bandStat.avg, grid: grid,
    hueSpread, vEdgeDensity: +(vEdges / samples * 100).toFixed(2),
  });
}

console.log('文件'.padEnd(20), '尺寸'.padEnd(10), '天空RGB'.padEnd(16), '中景RGB'.padEnd(16), '色相段', '竖边%');
for (const r of REPORT) {
  console.log(
    r.file.padEnd(20),
    r.size.padEnd(10),
    ('(' + r.sky.join(',') + ')').padEnd(16),
    ('(' + r.mid.join(',') + ')').padEnd(16),
    String(r.hueSpread).padEnd(6),
    String(r.vEdgeDensity)
  );
}
console.log('\n【判断标准】(本轮诉求)');
console.log('  · 天空RGB 两关完全相同 → 背景没区分度');
console.log('  · 色相段 ≤ 2 → 单一色相换皮（"蓝色城市/紫色城市"）');
console.log('  · 竖边% 全部接近同一值 → 极可能复用同一排高楼剪影');

/* 距离矩阵：两图之间的差异 */
console.log('\n【两两差异】整图平均色 RGB 欧氏距离（越大越容易区分）');
const dists = [];
for (let i = 0; i < REPORT.length; i++) {
  for (let j = i + 1; j < REPORT.length; j++) {
    const a = REPORT[i], b = REPORT[j];
    /* 用**整图平均色**而不是天空带 —— 天空带对"暗天"不敏感，
     * 而验收标准是"隐藏标题后能不能区分是哪一关"，
     * 那看的是**整幅构图**，不是天空那一条。 */
    const A = a.avg, B = b.avg;
    const d = Math.round(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]));
    dists.push(d);
    console.log('  ' + a.file.replace('ch3-level', 'L').replace('.png', '') +
      ' vs ' + b.file.replace('ch3-level', 'L').replace('.png', '') + ' = ' + d);
  }
}
if (dists.length) {
  const mn = Math.min.apply(null, dists);
  const avg = Math.round(dists.reduce((x, y) => x + y, 0) / dists.length);
  console.log('\n  最小距离 ' + mn + ' ｜ 平均距离 ' + avg);
  console.log('  ⚠️ 改进前实测：13 关 vs 20 关天空带距离只有 12（几乎分不出）');
  console.log('  ⇒ 目标：最小距离明显 > 12，且**没有一对完全相同**');
}

/* ============================================================
 * ★ 结构差异（40 维边缘密度向量）—— 比颜色更能说明"构图不同"
 * ============================================================
 * 颜色相近的两关（如 15/17/19 都很暗）只要构图不同，
 * 这个距离就会明显大于 0。
 * ============================================================ */
console.log('\n【结构差异】构图指纹距离（对颜色不敏感，只看形状疏密）');
const sd = [];
for (let i = 0; i < REPORT.length; i++) {
  for (let j = i + 1; j < REPORT.length; j++) {
    const a = REPORT[i].grid, b = REPORT[j].grid;
    let s = 0;
    for (let k = 0; k < a.length; k++) s += (a[k] - b[k]) * (a[k] - b[k]);
    const d = Math.round(Math.sqrt(s) * 100);
    sd.push({ pair: REPORT[i].file.replace(/ch3-level|\.png/g, '') + ' vs ' +
      REPORT[j].file.replace(/ch3-level|\.png/g, ''), d: d });
  }
}
sd.sort((x, y) => x.d - y.d);
sd.slice(0, 6).forEach(x => console.log('  最像的一对: ' + x.pair + ' = ' + x.d));
const smin = sd.length ? sd[0].d : 0;
const savg = sd.length ? Math.round(sd.reduce((x, y) => x + y.d, 0) / sd.length) : 0;
console.log('\n  结构最小距离 ' + smin + ' ｜ 结构平均距离 ' + savg);
console.log('  ⇒ 判读：结构距离 **越大 = 构图越不同**。');
console.log('    若两关结构距离 < 10，说明它们"长得几乎一样"（换色而已）。');
