/* ============================================================
 * _ch3-audit.js — 第 13~20 关"高级动作设计"审计（诊断工具）
 * ============================================================
 * 【为什么写这个】
 *   十一的诉求是："关卡没有逼玩家用高级动作"。
 *   现有的 ch3-levels-test.js 只验**字段存在**（有 puddles 吗），
 *   验不出"**地形本身是否要求墙跳/冲刺**"。
 *
 *   所以这里做**地形级**的硬指标统计：
 *     · 坑宽分布（能否靠单跳过去的）
 *     · 竖井数（两面高墙夹窄缝 = 只能墙跳）
 *     · 大缺口（> 单跳距离 = 必须冲刺）
 *     · 底层连续安全平地（= 无脑向右跑的空间）
 *     · 终点相对出生点的爬升（是否需要垂直机动）
 *
 * 【坐标约定】map[行][列]，行号越大越低。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

function noop() { }
function buildSandbox() {
  const prox = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    }, set: function () { return true; },
  });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    window: { addEventListener: noop, requestAnimationFrame: function () { return 0; } },
    document: {
      getElementById: function () { return { getContext: function () { return prox; }, width: 0, height: 0, style: {} }; },
      addEventListener: noop,
      createElement: function () { return { getContext: function () { return prox; }, style: {}, appendChild: noop }; },
    },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: noop,
    localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop, clear: noop },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const FILES = ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'physics.js', 'ch3-mechanics.js'];
const sb = buildSandbox();
FILES.forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f }); }
  catch (e) { console.log('    (加载 ' + f + ' 失败：' + e.message + ')'); }
});
const G = function (e) { return vm.runInContext(e, sb); };
const J = function (e) { return JSON.parse(vm.runInContext('JSON.stringify(' + e + ')', sb)); };

/* ---------- 读物理参数（只读！绝不改） ---------- */
const CFG = J('(typeof CONFIG!=="undefined")?CONFIG:null') || {};
const CEL = J('(typeof CELESTE!=="undefined")?CELESTE:null') || {};
const GRAV = (CEL.gravity != null) ? CEL.gravity : (CFG.GRAVITY != null ? CFG.GRAVITY : 0.62);
const JUMP = Math.abs((CEL.jumpPower != null) ? CEL.jumpPower : -11.2);
const RUN = (CFG.RUN_SPEED != null) ? CFG.RUN_SPEED : 3.4;
const TILE = (CFG.TILE != null) ? CFG.TILE : 32;

const AIR_FRAMES = Math.round(2 * JUMP / GRAV);
const SGL = +(RUN * AIR_FRAMES * 0.62 / TILE).toFixed(2);     // 单跳水平格数（折损 0.62）
const DBL = +(SGL * 1.75).toFixed(2);
const DASH = 3.2;
const SGL_DASH = +(SGL + DASH).toFixed(2);

console.log('============================================');
console.log('  第 13~20 关 · 地形 / 高级动作 审计');
console.log('============================================');
console.log('物理基准（只读）：重力 ' + GRAV + '，跳跃 ' + JUMP.toFixed(2) +
  '，跑速 ' + RUN.toFixed(2) + '，格 ' + TILE + 'px');
console.log('⇒ 单跳水平 ≈ ' + SGL + ' 格 ｜ 二段跳 ≈ ' + DBL + ' 格 ｜ 跳+冲刺 ≈ ' + SGL_DASH + ' 格');
console.log('');

const levels = [];
for (let id = 13; id <= 20; id++) {
  try { levels.push({ id: id, raw: J('__CH3_LEVEL_BUILDERS[' + id + ']()') }); }
  catch (e) { console.log('第 ' + id + ' 关构建失败: ' + e.message); }
}

const rows = [];
for (const L of levels) {
  const map = L.raw.map;
  const H = map.length, W = map[0].length;

  const solid = function (r, c) {
    if (r < 0 || r >= H || c < 0 || c >= W) return true;
    const ch = map[r][c];
    return ch === '#' || ch === 'm' || ch === 'B' || ch === 'S' || ch === 'I' ||
      ch === '>' || ch === '<' || ch === 'D';
  };
  const empty = function (r, c) { return !solid(r, c); };

  /* ---------- ① 坑宽分布（同一行里"实心→空→实心"） ---------- */
  const gaps = [];
  for (let r = 1; r < H - 1; r++) {
    let c = 1;
    while (c < W - 1) {
      if (empty(r, c) && solid(r, c - 1)) {
        let e = c;
        while (e < W - 1 && empty(r, e)) e++;
        if (solid(r, e) && e - c >= 2) {
          /* 只算"坑"：下面 1~8 行内有离得较近的地面（否则是不同层/深渊） */
          let floorDist = 999;
          for (let k = 1; k <= 10; k++) { if (solid(r + k, c)) { floorDist = k; break; } }
          if (floorDist <= 8) gaps.push(e - c);
        }
        c = e;
      } else c++;
    }
  }
  const big = gaps.filter(function (g) { return g > SGL; }).sort(function (a, b) { return b - a; });

  /* ---------- ② 竖井（左右都是连续高墙，缝宽 2~6 格） ---------- */
  let shafts = 0;
  const shaftCols = [];
  for (let c = 2; c < W - 7; c++) {
    for (let wdt = 2; wdt <= 6; wdt++) {
      /* 找一条纵向空缝 [c, c+wdt]，左右墙在上下都连续 */
      let best = 0;
      for (let r = 1; r < H - 2; r++) {
        if (!empty(r, c) || !empty(r, c + wdt)) { best = 0; continue; }
        let okL = true, okR = true;
        for (let k = 0; k <= wdt + 1 && okL; k++) { /* 缝内不能有实心 */ }
        /* 检查这一行的缝内全空 */
        let inside = true;
        for (let k = 0; k <= wdt; k++) { if (solid(r, c + k)) { inside = false; break; } }
        if (!inside) { best = 0; continue; }
        if (!solid(r, c - 1) || !solid(r, c + wdt + 1)) { best = 0; continue; }
        best++;
        if (best === 5) { shafts++; shaftCols.push(c + '/' + wdt + '@r' + (r - 4)); }
      }
    }
  }

  /* ---------- ③ 底层最长连续安全平地 ---------- */
  let runMax = 0, cur = 0, runTotal = 0;
  const GR = H - 2;                            // 地面顶面行
  for (let c = 1; c < W - 1; c++) {
    const safe = solid(GR, c) && empty(GR - 1, c) && empty(GR - 2, c) &&
      map[GR - 1][c] !== '^' && map[GR - 1][c] !== 'M' && map[GR - 1][c] !== 'j' &&
      map[GR - 1][c] !== 'I' && map[GR - 1][c] !== '>' && map[GR - 1][c] !== '<';
    if (safe) { cur++; runTotal++; if (cur > runMax) runMax = cur; } else cur = 0;
  }

  /* ---------- ④ 出生 → 终点 的爬升 ---------- */
  let spawnR = null, goalR = null, goalC = null, spawnC = null;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (map[r][c] === 'P' && spawnR === null) { spawnR = r; spawnC = c; }
    if (map[r][c] === 'G' && goalR === null) { goalR = r; goalC = c; }
  }
  const climb = (spawnR !== null && goalR !== null) ? (spawnR - goalR) : 0;

  /* ---------- ⑤ "高处平台"数量（离主路 >5 格的上层落脚面） ---------- */
  const standable = function (r, c) {
    if (r < 0 || r >= H || c < 0 || c >= W) return false;
    const above = (r > 0) ? map[r - 1][c] : '#';
    return solid(r, c) && (above === '.' || above === 'o' || above === '=' || above === 'A');
  };
  let highPlat = 0;
  for (let r = 1; r < GR - 4; r++) for (let c = 1; c < W - 1; c++) if (standable(r, c)) highPlat++;

  rows.push({
    id: L.id, size: W + 'x' + H, maxGap: gaps.length ? Math.max.apply(null, gaps) : 0,
    big: big, gapCount: gaps.length, shafts: shafts, shaftCols: shaftCols.slice(0, 4),
    runMax: runMax, runTotal: runTotal, climb: climb, highPlat: highPlat,
  });
}

console.log('关  | 尺寸     | 坑数 | 最宽坑 | 超单跳(>' + SGL + ') | 竖井 | 底层最长平地 | 平地合计 | 爬升 | 高处平台');
console.log('----+----------+------+--------+-----------+------+--------------+----------+------+---------');
for (const r of rows) {
  console.log(
    String(r.id).padEnd(4) + '| ' +
    r.size.padEnd(9) + '| ' +
    String(r.gapCount).padEnd(5) + '| ' +
    String(r.maxGap).padEnd(7) + '| ' +
    String(r.big.length ? r.big.join(',') : '—').padEnd(10) + '| ' +
    String(r.shafts).padEnd(5) + '| ' +
    String(r.runMax).padEnd(13) + '| ' +
    String(r.runTotal).padEnd(9) + '| ' +
    String(r.climb).padEnd(5) + '| ' +
    String(r.highPlat)
  );
}
console.log('');
console.log('【判定】');
console.log('  · "超单跳" 全为 — ⇒ 没有任何坑逼玩家用二段跳/冲刺');
console.log('  · "竖井" = 0 ⇒ 没有必须墙跳的地形');
console.log('  · "底层最长平地" > 40 格 ⇒ 存在大片"无脑向右跑"');
console.log('  · "爬升" ≤ 4 格 ⇒ 水平关卡，不需要垂直机动');
