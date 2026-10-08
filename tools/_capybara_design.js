/* ============================================================
 * _capybara_design.js — 卡皮巴拉 像素形象「设计台」
 * ============================================================
 * 作用：在真正写进 sprites.js 之前，先在这里
 *   ① 跑一遍 sprite-check.js 的全部体检规则
 *   ② 和美团袋鼠 / 飞龙宝宝 做轮廓区分度对比
 *   ③ 输出放大预览 PNG（肉眼确认形象）
 * 这样改一格就能立刻看到结果，不用重启游戏。
 *
 * 用法：node tools/_capybara_design.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

/* ------------------------------------------------------------
 * 1. 调色板
 * ------------------------------------------------------------ */
const CAPY_PAL = {
  // —— 卡皮巴拉本体（棕） ——
  c_fur:   '#a9784a',   // 毛（主色）
  c_furD:  '#8a5f38',   // 毛暗部
  c_face:  '#c19360',   // 脸（比身体亮，把五官托出来）
  c_ear:   '#7a5230',   // 耳廓（深棕，帽子两侧露出）
  c_earI:  '#5e3c22',   // 耳内
  c_eye:   '#2b2118',   // 眼睛
  c_muz:   '#b88450',   // 吻部（卡皮巴拉的方嘴）
  c_nose:  '#4a3020',   // 方鼻（★ 卡皮巴拉最强的辨识特征）
  c_belly: '#c8a06a',   // 露出来的浅色肚皮
  // —— 骑手装备 ——
  c_cap:   '#ffd93b',   // 美团黄帽
  c_capD:  '#d9a417',   // 帽檐
  c_uni:   '#ffd93b',   // 外卖制服
  c_uniD:  '#e8b81c',   // 制服暗部
  c_stripe:'#ff9a3c',   // 胸口条纹（美团橙）
  c_pants: '#3a3a46',   // 深色裤装
  c_pantsD:'#2a2a34',
  c_shoe:  '#3a3a3a',   // 鞋
  c_bag:   '#4a9de0',   // 配送包
  c_bagD:  '#2b6ea8',
  c_out:   '#2b2118',   // 描边
};

/* ------------------------------------------------------------
 * 2. 16x16 网格
 * ------------------------------------------------------------
 * 图例：
 *   .  透明      C 帽子黄     c 帽檐暗黄
 *   E  耳廓      I 耳内       f 脸        F 脸暗部
 *   e  眼睛      m 吻部       N 方鼻
 *   U  制服黄    u 制服暗     S 橙色条纹
 *   b  浅肚皮    P 裤装       p 裤装暗    s 鞋
 *   G  配送包    g 包暗部     o 描边
 *
 * 从上到下的结构：
 *   y1     帽顶（比头窄，露出一点额头轮廓）
 *   y2     帽檐（★ 宽 —— "戴了帽子"第一眼靠它）
 *   y3-4   耳朵从帽子两侧探出 + 大脸
 *   y5     眼睛（小而淡定 —— 卡皮巴拉的招牌表情）
 *   y7-8   方吻 + 方鼻（★ 卡皮巴拉的招牌）
 *   y9-12  黄色外卖制服 + 胸口橙条纹 + 左侧蓝色配送包
 *   y13    浅色肚皮（圆胖）
 *   y14-15 深色裤 + 鞋（托住轮廓，别让黄糊成一片）
 * ------------------------------------------------------------ */
const CAPYBARA_SPRITE = [
  "................",
  "....CCCCCCCC....",
  "..cccccccccccc..",
  ".EEffffffffffEE.",
  ".EIffffffffffIE.",
  "...feeffffeef...",
  "...ffffffffff...",
  "....mmmmmmmm....",
  ".....mNNNNm.....",
  "....ffffffff....",
  "gggUUUUUUUUUU...",
  "gggUUUSSSUUUU...",
  "gggUUUUUUUUUU...",
  "..uUUUbbbbUUUu..",
  "...PPPPPPPPPP...",
  "...ssss..ssss...",
];

const CAPYBARA_KEY = {
  f: ['c_face'],
  F: ['c_furD'],
  E: ['c_ear'],
  I: ['c_earI'],
  e: ['c_eye'],
  m: ['c_muz'],
  N: ['c_nose'],
  b: ['c_belly'],
  C: ['c_cap'],
  c: ['c_capD'],
  U: ['c_uni'],
  u: ['c_uniD'],
  S: ['c_stripe'],
  P: ['c_pants'],
  p: ['c_pantsD'],
  s: ['c_shoe'],
  G: ['c_bag'],
  g: ['c_bagD'],
  o: ['c_out'],
};

/* ------------------------------------------------------------
 * 3. 构建 + 体检
 * ------------------------------------------------------------ */
function build(grid, key) {
  return grid.map(function (row) {
    const out = [];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') { out.push(null); continue; }
      const k = key[ch];
      out.push(k ? CAPY_PAL[k[0]] : null);
    }
    return out;
  });
}

let PASS = 0, FAIL = 0;
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

const spr = build(CAPYBARA_SPRITE, CAPYBARA_KEY);

console.log('=========================================');
console.log('  卡皮巴拉 像素形象体检');
console.log('=========================================');

/* ① 尺寸 */
check('行数 = 16', CAPYBARA_SPRITE.length === 16, '实际 ' + CAPYBARA_SPRITE.length);
const badRows = [];
CAPYBARA_SPRITE.forEach(function (r, i) {
  if (r.length !== 16) badRows.push('第' + i + '行=' + r.length);
});
check('每行长度 = 16', badRows.length === 0, badRows.join(' '));

/* ② 字符映射 */
const chars = new Set();
CAPYBARA_SPRITE.forEach(function (r) {
  r.split('').forEach(function (ch) { if (ch !== '.') chars.add(ch); });
});
const unmapped = [];
chars.forEach(function (ch) { if (!CAPYBARA_KEY[ch]) unmapped.push(ch); });
check('所有字符都有颜色映射', unmapped.length === 0, '未映射: ' + unmapped.join(' '));

/* ③ 内部天窗 */
const holes = [];
for (let y = 1; y < 16 - 1; y++) {
  for (let x = 1; x < 16 - 1; x++) {
    if (spr[y][x] !== null) continue;
    const U = spr[y - 1][x] !== null;
    const D = spr[y + 1][x] !== null;
    const L = spr[y][x - 1] !== null;
    const R = spr[y][x + 1] !== null;
    if (U && D && L && R) holes.push('(' + x + ',' + y + ')');
  }
}
check('身体内部没有透明天窗', holes.length === 0, '漏画: ' + holes.join(' '));

/* ④ 配色比例 */
const flat = spr.flat();
const solid = flat.filter(function (c) { return c !== null; });
const n = solid.length;
const ratio = n / flat.length;
check('实体占比 40%~75%', ratio >= 0.40 && ratio <= 0.75, Math.round(ratio * 100) + '%');

const cnt = function (col) {
  let k = 0;
  for (let i = 0; i < solid.length; i++) if (solid[i] === col) k++;
  return k;
};

/* ⚠️ 帽子和制服共用同一个黄（品牌色一致），
 *    直接相加会把同一批格子数两遍 —— 必须先按颜色值去重。 */
const uniq = function (list) {
  const set = [];
  list.forEach(function (c) { if (set.indexOf(c) < 0) set.push(c); });
  return set;
};
const sumOf = function (cols) {
  return uniq(cols).reduce(function (a, c) { return a + cnt(c); }, 0);
};

const yellow = sumOf([CAPY_PAL.c_cap, CAPY_PAL.c_capD, CAPY_PAL.c_uni, CAPY_PAL.c_uniD]);
const dark = sumOf([CAPY_PAL.c_pants, CAPY_PAL.c_pantsD, CAPY_PAL.c_shoe,
                    CAPY_PAL.c_out, CAPY_PAL.c_nose, CAPY_PAL.c_ear, CAPY_PAL.c_earI]);
const brown = sumOf([CAPY_PAL.c_fur, CAPY_PAL.c_furD, CAPY_PAL.c_face,
                     CAPY_PAL.c_muz, CAPY_PAL.c_belly]);

console.log('\n  实体格数: ' + n + ' / 256 (' + Math.round(ratio * 100) + '%)');
console.log('  黄色系(帽+制服): ' + yellow + ' → ' + Math.round(yellow / n * 100) + '%');
console.log('  棕色系(卡皮巴拉本体): ' + brown + ' → ' + Math.round(brown / n * 100) + '%');
console.log('  深色系(裤/鞋/鼻/耳): ' + dark + ' → ' + Math.round(dark / n * 100) + '%');

check('★ 黄色占比 < 60%（不跟金币/按钮/背景糊一起）',
  yellow / n < 0.60, Math.round(yellow / n * 100) + '%');
check('★ 深色占比 ≥ 8%（缩小后轮廓不散）',
  dark / n >= 0.08, Math.round(dark / n * 100) + '%');
check('★ 棕色系 ≥ 25%（一眼看出是卡皮巴拉，不是袋鼠/奶龙）',
  brown / n >= 0.25, Math.round(brown / n * 100) + '%');

/* ⑤ 骑手三件套 */
console.log('\n--- 骑手形象三要素（十一的要求）---');
check('★ 戴帽子（黄色帽顶）', cnt(CAPY_PAL.c_cap) > 0);
check('★ 有帽檐（帽子的辨识特征）', cnt(CAPY_PAL.c_capD) > 0);
check('★ 穿外卖制服（黄）', cnt(CAPY_PAL.c_uni) > 0);
check('★ 有配送包（蓝）', cnt(CAPY_PAL.c_bag) + cnt(CAPY_PAL.c_bagD) > 0);
console.log('\n--- 卡皮巴拉本体特征 ---');
check('★ 有方鼻（卡皮巴拉最强辨识点）', cnt(CAPY_PAL.c_nose) > 0);
check('★ 有小圆耳（帽子两侧露出）', cnt(CAPY_PAL.c_ear) > 0);

/* ------------------------------------------------------------
 * 4. 和现有两个角色比区分度
 * ------------------------------------------------------------ */
console.log('\n--- 和美团袋鼠 / 飞龙宝宝的区分度 ---');
const vm = require('vm');
const sandbox = { console, Math, Date, Object, Array, Infinity, NaN, JSON, String, Number, Boolean, Error };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8'), sandbox);
const kSpr = vm.runInContext('SPR_KANGAROO', sandbox);
const dSpr = vm.runInContext('SPR_DRAGON', sandbox);

function diff(a, b) {
  let d = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if ((a[y][x] !== null) !== (b[y][x] !== null)) d++;
    }
  }
  return d;
}
const dk = diff(spr, kSpr), dd = diff(spr, dSpr);
console.log('  vs 袋鼠: ' + dk + ' / 256 (' + Math.round(dk / 256 * 100) + '%)');
console.log('  vs 奶龙: ' + dd + ' / 256 (' + Math.round(dd / 256 * 100) + '%)');
check('★ 轮廓 vs 袋鼠 明显不同（>15%）', dk / 256 > 0.15, Math.round(dk / 256 * 100) + '%');
check('★ 轮廓 vs 奶龙 明显不同（>15%）', dd / 256 > 0.15, Math.round(dd / 256 * 100) + '%');

/* ------------------------------------------------------------
 * 5. 输出放大预览 PNG
 * ------------------------------------------------------------ */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
/** 把若干 (grid,key) 横向拼成一张 PNG，scale 倍放大 */
function writePng(file, items, scale, bg) {
  const cols = items.length;
  const W = 16 * cols * scale, H = 16 * scale;
  const raw = Buffer.alloc(H * (1 + W * 4));
  const bgc = bg ? hex2rgb(bg) : null;
  for (let y = 0; y < H; y++) {
    const off = y * (1 + W * 4);
    raw[off] = 0;
    for (let x = 0; x < W; x++) {
      const gx = Math.floor(x / scale) % 16;
      const gi = Math.floor(x / (16 * scale));
      const gy = Math.floor(y / scale);
      const col = items[gi].spr[gy][gx];
      let r, g, b, a;
      if (col) { const c = hex2rgb(col); r = c[0]; g = c[1]; b = c[2]; a = 255; }
      else if (bgc) { r = bgc[0]; g = bgc[1]; b = bgc[2]; a = 255; }
      else { r = g = b = 0; a = 0; }
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log('  写出 ' + file + ' (' + W + 'x' + H + ')');
}

function grid2spr(grid, key) { return build(grid, key); }

const outDir = path.join(PROJ, 'tools', '_capy_shots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const capy = { spr: spr };
console.log('\n--- 预览图 ---');
writePng(path.join(outDir, 'capybara_big.png'), [capy], 20, '#ffffff');
writePng(path.join(outDir, 'capybara_32.png'), [capy], 2, '#ffffff');
writePng(path.join(outDir, 'three_chars.png'),
  [{ spr: kSpr }, { spr: dSpr }, capy], 12, '#ffffff');
/* 模拟真实游戏背景（浅黄 + 金币色）看会不会糊 */
writePng(path.join(outDir, 'capybara_onbg.png'),
  [{ spr: kSpr }, { spr: dSpr }, capy], 12, '#ffe9a8');

/* ------------------------------------------------------------
 * 6. ASCII 预览（终端里直接看）
 * ------------------------------------------------------------ */
console.log('\n--- 字符预览（. = 透明）---');
CAPYBARA_SPRITE.forEach(function (r, i) {
  console.log('  ' + String(i).padStart(2) + ' |' + r + '|');
});

console.log('\n============================================');
console.log('  体检: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('============================================');
process.exit(FAIL > 0 ? 1 : 0);
