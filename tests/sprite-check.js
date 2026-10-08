/* ============================================================
 * sprite-check.js — 像素精灵图结构校验
 * ============================================================
 * 为什么需要这个测试：
 *   像素精灵图是"手画的字符网格"，非常容易出错，而且**画错了不报错** ——
 *   表现只是"角色看起来怪怪的"，游戏照常能跑。
 *   人手肉眼看 16x16 的字符网格也容易漏。
 *
 * 这个脚本把"能自动查的错"全查出来：
 *
 *   ① 行数 / 每行长度一致（不一致会让某个方向被拉歪）
 *   ② 每个非透明字符都有颜色映射（漏了 → 变成透明洞）
 *   ③ 身体内部没有透明天窗（画漏的格子，会露出背景）
 *   ④ 配色比例合理 —— 这直接决定"缩小后能不能看清"
 *      （十一要求："缩小到实际游戏尺寸后仍能看清帽子和制服"）
 *   ⑤ 两个角色的轮廓差异足够大（十一要求："站在一起时必须容易区分"）
 *
 * 用法：node tests/sprite-check.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else {
    FAIL++;
    problems.push(name + (detail ? ' → ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? '  → ' + detail : ''));
  }
}

const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON,
  String, Number, Boolean, Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8'),
  sandbox, { filename: 'sprites.js' }
);
const G = function (e) { return vm.runInContext(e, sandbox); };

const PAL = G('PAL');

/* ============================================================
 * 通用结构校验
 * ============================================================ */
function checkSprite(label, grid, sprite, keyMap, size) {
  console.log('\n--- ' + label + ' ---');

  /* ① 行数 */
  check(label + ' 行数 = ' + size, grid.length === size,
    '实际 ' + grid.length);

  /* ① 每行长度 */
  const badRows = [];
  grid.forEach(function (r, i) {
    if (r.length !== size) badRows.push('第' + i + '行=' + r.length);
  });
  check(label + ' 每行长度都是 ' + size, badRows.length === 0,
    badRows.join(' '));

  /* ② 字符映射完整性 */
  const chars = new Set();
  grid.forEach(function (r) {
    r.split('').forEach(function (c) { if (c !== '.') chars.add(c); });
  });
  const unmapped = [];
  chars.forEach(function (c) { if (!keyMap[c]) unmapped.push(c); });
  check(label + ' 所有用到的字符都有颜色映射', unmapped.length === 0,
    '未映射: ' + unmapped.join(' ') + '（会变成透明洞）');

  /* ③ 内部透明天窗 */
  const holes = [];
  for (let y = 1; y < grid.length - 1; y++) {
    for (let x = 1; x < grid[y].length - 1; x++) {
      if (sprite[y][x] !== null) continue;
      const U = sprite[y - 1] && sprite[y - 1][x] !== null;
      const D = sprite[y + 1] && sprite[y + 1][x] !== null;
      const L = sprite[y][x - 1] !== null;
      const R = sprite[y][x + 1] !== null;
      /* 上下左右都被非透明包住 → 这是画漏的格子 */
      if (U && D && L && R) holes.push('(' + x + ',' + y + ')');
    }
  }
  check(label + ' 身体内部没有透明天窗', holes.length === 0,
    '漏画的格子: ' + holes.join(' '));

  /* ④ 非透明占比（不能太稀疏，否则缩小后看不见） */
  const flat = sprite.flat();
  const solid = flat.filter(function (c) { return c !== null; });
  const ratio = solid.length / flat.length;
  check(label + ' 实体占比合理（40%~75%）', ratio >= 0.40 && ratio <= 0.75,
    Math.round(ratio * 100) + '%');

  return { flat: flat, solid: solid, chars: chars };
}

/* ============================================================
 * 校验袋鼠
 * ============================================================ */
console.log('=========================================');
console.log('  精灵图结构校验');
console.log('=========================================');

const kGrid = G('KANGAROO_SPRITE');
const kSpr = G('SPR_KANGAROO');
const kKey = G('SPRITE_MAP');
const kInfo = checkSprite('袋鼠', kGrid, kSpr, kKey, 16);

/* ============================================================
 * 校验奶龙（骑手版）
 * ============================================================ */
console.log('\n--- 奶龙（外卖骑手版）---');

const dGrid = G('DRAGON_SPRITE');
const dSpr = G('SPR_DRAGON');
const dKey = G('DRAGON_KEY');

check('奶龙 行数 = 16', dGrid.length === 16, '实际 ' + dGrid.length);
const dBadRows = [];
dGrid.forEach(function (r, i) {
  if (r.length !== 16) dBadRows.push('第' + i + '行=' + r.length);
});
check('奶龙 每行长度都是 16', dBadRows.length === 0, dBadRows.join(' '));

const dChars = new Set();
dGrid.forEach(function (r) {
  r.split('').forEach(function (c) { if (c !== '.') dChars.add(c); });
});
const dUnmapped = [];
dChars.forEach(function (c) { if (!dKey[c]) dUnmapped.push(c); });
check('奶龙 所有字符都有颜色映射', dUnmapped.length === 0,
  '未映射: ' + dUnmapped.join(' '));

const dHoles = [];
for (let y = 1; y < dGrid.length - 1; y++) {
  for (let x = 1; x < dGrid[y].length - 1; x++) {
    if (dSpr[y][x] !== null) continue;
    const U = dSpr[y - 1] && dSpr[y - 1][x] !== null;
    const D = dSpr[y + 1] && dSpr[y + 1][x] !== null;
    const L = dSpr[y][x - 1] !== null;
    const R = dSpr[y][x + 1] !== null;
    if (U && D && L && R) dHoles.push('(' + x + ',' + y + ')');
  }
}
check('奶龙 身体内部没有透明天窗', dHoles.length === 0,
  '漏画的格子: ' + dHoles.join(' '));

const dFlat = dSpr.flat();
const dSolid = dFlat.filter(function (c) { return c !== null; });
check('奶龙 实体占比合理（40%~75%）',
  dSolid.length / dFlat.length >= 0.40 && dSolid.length / dFlat.length <= 0.75,
  Math.round(dSolid.length / dFlat.length * 100) + '%');

/* ============================================================
 * 骑手形象三要素：帽子 / 制服 / 深色裤装
 * ============================================================ */
console.log('\n--- 骑手形象要素（十一的要求）---');

const hasColor = function (list, col) {
  return list.indexOf(col) >= 0;
};

check('★ 有骑手帽（黄色）', hasColor(dSolid, PAL.d_cap),
  '需要出现 d_cap 色 #ffd93b');
check('★ 有帽檐（暗黄，帽子的辨识特征）', hasColor(dSolid, PAL.d_capD),
  '需要出现 d_capD 色');
check('★ 有黄色制服', hasColor(dSolid, PAL.d_uni),
  '需要出现 d_uni 色');
check('★ 有深色裤装（和上衣形成对比，托住轮廓）',
  hasColor(dSolid, PAL.d_pants),
  '需要出现 d_pants 色');
check('★ 有配送包（呼应外卖主题）',
  hasColor(dSolid, PAL.d_bag) || hasColor(dSolid, PAL.d_bagD),
  '需要出现 d_bag(#4a9de0) 或 d_bagD(#2b6ea8)');

/* 保留奶龙的辨识度：脸/肚皮还是奶白 */
check('★ 保留奶龙的奶白身体（不丢辨识度）',
  hasColor(dSolid, PAL.d_body) || hasColor(dSolid, PAL.d_belly),
  '需要保留 d_body / d_belly');
check('★ 保留角（奶龙的标志特征）', hasColor(dSolid, PAL.d_horn));

/* ============================================================
 * 配色比例 —— 决定"缩小后能否看清"
 * ============================================================
 * 十一的要求：
 *   "不要让黄色服装与黄色背景、金币或按钮混在一起"
 *   "缩小到实际游戏尺寸后仍能看清帽子和制服"
 *
 * 黄色占太多 → 和金币/按钮/背景糊成一片。
 * 深色太少   → 轮廓不清晰，缩到 32px 会散掉。
 * ============================================================ */
console.log('\n--- 配色比例（决定缩小后能否看清）---');

const count = function (list, col) {
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] === col) n++;
  return n;
};
const n = dSolid.length;

const dYellow = count(dSolid, PAL.d_cap) + count(dSolid, PAL.d_uni) +
                count(dSolid, PAL.d_capD) + count(dSolid, PAL.d_uniD);
const dDark = count(dSolid, PAL.d_pants) + count(dSolid, PAL.d_pantsD) +
              count(dSolid, PAL.d_outline);

const yPct = Math.round(dYellow / n * 100);
const kPct = Math.round(dDark / n * 100);
console.log('  黄色系: ' + dYellow + ' 格 (' + yPct + '%)');
console.log('  深色系: ' + dDark + ' 格 (' + kPct + '%)');

check('★ 黄色占比 < 60%（避免和金币/按钮糊在一起）', yPct < 60,
  '实际 ' + yPct + '%');
check('★ 深色占比 ≥ 8%（轮廓清晰，缩小后不散）', kPct >= 8,
  '实际 ' + kPct + '%');

/* ============================================================
 * 两个角色的轮廓差异（站一起要能区分）
 * ============================================================ */
console.log('\n--- 两个角色的区分度 ---');

/* 用"形状差异"和"主色差异"两个维度判断。
 * 形状差异：16x16 里两个角色"一个透明一个不透明"的格子数。
 * 这个数越大，轮廓越不同。
 *
 * ⚠️ 阈值取 15%（不是 25%）：
 *    两个都是"人形站立"的角色，在 16x16 这么小的格子里，
 *    能差出 15% 已经是很明显的差别了（袋鼠细高+耳朵，
 *    奶龙矮胖+大头+帽子）。定太高会逼出"故意画丑"的畸形设计 ——
 *    那不是我们要的。真正的区分度靠"形状 + 主色 + 帽子"三件套。 */
let shapeDiff = 0;
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const k0 = kSpr[y][x] !== null;
    const d0 = dSpr[y][x] !== null;
    if (k0 !== d0) shapeDiff++;
  }
}
const shapePct = Math.round(shapeDiff / 256 * 100);
console.log('  轮廓差异格数: ' + shapeDiff + ' / 256 (' + shapePct + '%)');
check('★ 两个角色的轮廓明显不同（>15%）', shapePct > 15,
  '实际 ' + shapePct + '%');

/* 主色差异：袋鼠的主色（制服黄/外卖箱蓝）vs 奶龙的主色（奶白/帽黄） */
const kColors = {};
kInfo.solid.forEach(function (c) { kColors[c] = (kColors[c] || 0) + 1; });
const dColors = {};
dSolid.forEach(function (c) { dColors[c] = (dColors[c] || 0) + 1; });

const topK = Object.keys(kColors).sort(function (a, b) { return kColors[b] - kColors[a]; })[0];
const topD = Object.keys(dColors).sort(function (a, b) { return dColors[b] - dColors[a]; })[0];
console.log('  袋鼠主色: ' + topK + '　奶龙主色: ' + topD);

/* 奶龙现在也有大片黄（制服），所以不能要求"主色不同" ——
 * 但可以要求"奶龙身上必须有奶白，且奶白占比不小"，
 * 这样一眼就能看出"白色那个是奶龙"。 */
const dCream = count(dSolid, PAL.d_body) + count(dSolid, PAL.d_belly);
const creamPct = Math.round(dCream / n * 100);
console.log('  奶龙的奶白占比: ' + creamPct + '%');
check('★ 奶龙身上有足够的奶白（一眼可辨）', creamPct >= 20,
  '实际 ' + creamPct + '%');

/* ============================================================
 * ★★ 贴图清单一致性：sprites.js 引用的 assets/*.png 必须全部登记进
 *    tools/build-single.js 的 imgFiles（2026-10-07 补，踩过第 3 次）
 * ============================================================
 * 【为什么必须单独测这一条】
 *   构建脚本自己**已经有**这个校验（build-single.js 的 2.5 段），
 *   但它只**打印警告、不中断**（构建仍然退出码 0）。
 *   ⇒ 只要没人盯着构建输出，这类漏项就能一路溜到玩家手里。
 *
 * 【症状（最坑的地方）】
 *   src 版（十一自己内测）**完全正常** —— 因为 `assets/` 就在旁边；
 *   只有**发给朋友的单文件版**才会缺图（图变成相对路径 → 404）。
 *   ⇒ 也就是"自己测永远发现不了，只有别人玩才暴露"。
 *
 * 【刚发生的实例】
 *   角色「噜噜」(`lulu`) 做好并注册进 characters.js/sprites.js 后，
 *   忘了往 imgFiles 加 `lulu.png` ⇒ 构建当场报了出来。
 *
 * 【判据】从 sprites.js 里正则抓所有 `src: 'assets/xxx.png'`，
 *   逐个确认：① 文件真的存在 ② 已在 imgFiles 清单里。
 *   反过来也查一遍：清单里列了、文件却没有（构建时会被静默跳过）。
 * ============================================================ */
const SPRITES_SRC = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
const BUILD_SRC = fs.readFileSync(path.join(PROJ, 'tools', 'build-single.js'), 'utf8');

/* sprites.js 里声明的贴图路径 */
const referenced = [];
const reSrc = /src:\s*'assets\/([^']+)'/g;
let mSrc;
while ((mSrc = reSrc.exec(SPRITES_SRC))) {
  if (referenced.indexOf(mSrc[1]) < 0) referenced.push(mSrc[1]);
}

/* build-single.js 的 imgFiles 清单
 *
 * ⚠️ 必须**先剥掉注释**再抓引号里的名字 ——
 *    imgFiles 块里写着大量解释性注释，注释里会举例提到
 *    `src: 'assets/xxx.png'` 这种占位写法。
 *    不剥注释的话会把例子当成真实清单项 ⇒ **假失败**
 *    （加这段测试时当场踩了一次：报"缺文件 assets/xxx.png"，
 *      而那个名字其实只存在于注释里）。
 * ⚠️ 也**不要**用 `/\/\*[\s\S]*?\*\//` 一把梭全剥 ——
 *    清单里若有含 `/*` 的字符串会剥错。这里的注释都是规整的
 *    块注释/行注释，剥完再匹配引号即可。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* 块注释 */
    .replace(/^\s*\/\/.*$/gm, '');      // 行首 // 注释
}
const imgBlock = BUILD_SRC.match(/const imgFiles = \[([\s\S]*?)\n\];/);
const inList = [];
if (imgBlock) {
  const body = stripComments(imgBlock[1]);
  const reList = /'([^']+\.(?:png|jpg|gif|webp))'/g;
  let mL;
  while ((mL = reList.exec(body))) inList.push(mL[1]);
}

console.log('\n  sprites.js 引用贴图: ' + referenced.length + ' 个');
console.log('  build imgFiles 登记: ' + inList.length + ' 个');

const missing = referenced.filter(function (f) { return inList.indexOf(f) < 0; });
check('★★ sprites.js 引用的贴图全部已登记进 imgFiles（否则单文件版缺图）',
  missing.length === 0,
  missing.length ? '漏登记: ' + missing.join(', ') : '');

const notExist = referenced.filter(function (f) {
  return !fs.existsSync(path.join(SRC, 'assets', f));
});
check('★★ sprites.js 引用的贴图文件都真实存在',
  notExist.length === 0,
  notExist.length ? '缺文件: ' + notExist.join(', ') : '');

/* 只查"清单里列了、sprites.js 没引用"这一种「列了但文件不存在」的情况 ——
 * 其余（receiver/scooter/bag-preview 等由别的模块加载）允许不在 sprites.js 里。 */
const listedButNoFile = inList.filter(function (f) {
  return !fs.existsSync(path.join(SRC, 'assets', f));
});
check('★★ imgFiles 清单里的文件都存在（否则构建会静默跳过）',
  listedButNoFile.length === 0,
  listedButNoFile.length ? '缺文件: ' + listedButNoFile.join(', ') : '');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n============================================================');
console.log('  精灵图校验: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) {
  console.log('  失败项:');
  problems.forEach(function (p) { console.log('    - ' + p); });
}
console.log('============================================================');
process.exit(FAIL > 0 ? 1 : 0);
