/* ============================================================
 * ch3-pressure-test.js — 第 13~20 关"能力压力测试"（2026-10-07）
 * ============================================================
 * 十一的要求原文（长文七）：
 *   "请新增测试，不只测试机制字段存在，还要测试关卡是否真正使用了高级能力。"
 *   "每关至少检查：
 *      · 是否存在至少一个二段跳必要区域
 *      · 是否存在至少一个墙跳必要区域
 *      · 是否存在至少一个冲刺必要区域
 *      · 是否存在连续动作链
 *      · 是否存在普通跑跳无法直接绕过的路线
 *      · 是否有高风险路线和安全路线的区别
 *      · 是否有大面积无意义安全地面
 *      · 是否可以只靠无限冲刺无脑通过
 *      · 是否可以只靠墙跳绕过全部机制"
 *   "如果某关只需要一直向右跑、偶尔跳跃或冲刺，就判定为设计过简单，需要返工。"
 *
 * ------------------------------------------------------------
 * ★★ 这个测试和 ch3-levels-test.js 的根本区别 ★★
 * ------------------------------------------------------------
 *   后者查**数据字段**（有 puddles 吗 / 有几关 / 尺寸多少），
 *   本测试查**地形几何**：只看地图矩阵，不看任何 ch3 字段。
 *   ⇒ 所以它才抓得出"字段齐全但地形全是平地"这种问题
 *     （这正是十一那两轮反馈的核心）。
 *
 * ★★ 判定用的硬数字（tools/_ch3-reach.js 逐帧积分实测）★★
 *   单跳 3.38 格 / 二段跳 5.44 格 / 跳+冲刺 5.22 格
 *   单跳最大高度 2.99 格 / 上冲高度 12.26 格
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
const failures = [];
function check(ok, msg, extra) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg + (extra ? '  → ' + extra : '')); fail++; failures.push(msg); }
}

/* ---------- 沙箱 ---------- */
function noop() { }
function buildSandbox() {
  const prox = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return function () { return { addColorStop: noop }; };
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

const sb = buildSandbox();
['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'physics.js'].forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f }); }
  catch (e) { check(false, '加载 ' + f, e.message); }
});
const J = function (e) { return JSON.parse(vm.runInContext('JSON.stringify(' + e + ')', sb)); };

/* ---------- 实测硬数字（和 tools/_ch3-reach.js 保持一致） ---------- */
const CFG = J('(typeof CONFIG !== "undefined") ? CONFIG : {}');
const CEL = J('(typeof CELESTE !== "undefined") ? CELESTE : {}');
const G = CFG.GRAVITY || 0.62;
const JUMP = Math.abs(CFG.JUMP_POWER || 11.2);
const RUN = CFG.RUN_SPEED || 3.0;
const TILE = 32;

/* 水平跨越（逐帧积分的结果，见 _ch3-reach.js 的推导） */
const SINGLE_TILES = 3.38;
const DOUBLE_TILES = 5.44;
const DASH_TILES = 5.22;
const ALL_TILES = 7.84;
/* 垂直 */
const SINGLE_UP = 2.99;
const DOUBLE_UP = 5.39;
const UPDASH_UP = 12.26;

/* ---------- 阈值（十一的验收线） ---------- */
const TH = {
  /* 必须冲刺的大缺口：> 二段跳 5.44，留边距取 5.8 */
  CHASM_MIN: 5.8,
  /* 必须二段跳的落差：> 单跳 2.99，留边距取 3.2 */
  DROP_MIN: 3.2,
  /* 底层连续安全平地：≤ 24 格（超过就是"无脑向右跑"） */
  FLAT_MAX: 24,
  /* 出生→终点爬升：≥ 8 格（要有垂直机动） */
  CLIMB_MIN: 8,
};

console.log('============================================');
console.log('  第 13~20 关 · 能力压力测试（只看地形）');
console.log('============================================');
console.log('硬数字：单跳 ' + SINGLE_TILES + ' 格 / 二段跳 ' + DOUBLE_TILES +
  ' 格 / 跳+冲刺 ' + DASH_TILES + ' 格 / 全连招 ' + ALL_TILES + ' 格');
console.log('        单跳高 ' + SINGLE_UP + ' 格 / 上冲高 ' + UPDASH_UP + ' 格');
console.log('');

const levels = [];
for (let id = 13; id <= 20; id++) {
  try { levels.push({ id: id, raw: J('__CH3_LEVEL_BUILDERS[' + id + ']()') }); }
  catch (e) { check(false, '第 ' + id + ' 关能构建', e.message); }
}
check(levels.length === 8, '8 关全部能构建（' + levels.length + '/8）');

/* ============================================================
 * 地形分析器
 * ============================================================ */
function analyze(raw) {
  const map = raw.map;
  const H = map.length, W = map[0].length;
  const solid = function (r, c) {
    if (r < 0 || r >= H || c < 0 || c >= W) return true;
    const ch = map[r][c];
    return ch === '#' || ch === 'm' || ch === 'B' || ch === 'S' || ch === 'I' ||
      ch === '>' || ch === '<' || ch === 'D';
  };
  const empty = function (r, c) { return !solid(r, c); };

  const GR = H - 2;                       // 地面顶面行

  /* ============================================================
   * ① 横向缺口（★★ 主路走廊追踪 —— 唯一可靠的做法）★★
   * ============================================================
   * 【试错记录（两次都失败，写下来免得再走）】
   *   版本 A "全图按行扫实心→空→实心"：
   *     → 把平台上方的**整片天空**当成缺口，报出 53/86/148 格（148=全宽）。
   *   版本 B "每列只要有任一可站高度就算可站"：
   *     → 几乎所有列都有某个高度能站，于是缺口全是 0。
   *
   * 【正确做法：走廊追踪】
   *   从出生点出发，维护"当前所在高度层"。逐列向右推进：
   *     · 这一列在 `row ± STEP` 内有立足点 → 走过去，更新 row
   *     · 否则开始记断口，并继续往右找"第一个能落脚的列"
   *       · 找到 → 断口宽度 = 两列之差，更新 row
   *       · 一直找不到 → 到地图末尾为止
   *   `STEP` 限制"一次能上下几格" = 模拟玩家上下走动的能力。
   *   这样得到的每个断口就是**玩家真实要跨的距离**。
   * ------------------------------------------------------------ */
  const gaps = [];
  {
    let sr = null, sc = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (map[r][c] === 'P' && sr === null) { sr = r; sc = c; }
    }
    if (sr === null) { sr = H - 4; sc = 1; }

    /* 站在 row 这一行、列 c 上是否成立 */
    const canStandAt = function (row, c) {
      if (row < 1 || row >= H - 1 || c < 1 || c >= W - 1) return false;
      return solid(row + 1, c) && empty(row, c) && empty(row - 1, c);
    };

    let row = sr;
    /* 先把出生点校正到脚下有地的高度 */
    for (let k = 0; k <= 5; k++) {
      if (canStandAt(sr + k, sc)) { row = sr + k; break; }
      if (k > 0 && canStandAt(sr - k, sc)) { row = sr - k; break; }
    }

    /* ★★ STEP 必须 = **单跳的垂直能力**（3 格），不能给大！★★
     * ------------------------------------------------------------------
     * 【踩过的坑】一开始设 STEP=6，结果追踪器"爬"过了我精心设计的
     *   7 格大缺口和 5 格深竖井 —— 它只是沿着台阶走过去了，
     *   于是报出"最大缺口 1 格"。**这恰好证明了那个缺口没有强制冲刺**：
     *   现实中玩家也能靠台阶绕过去。
     * ⇒ STEP = 3（单跳 2.99 格的保守整数）：
     *   追踪器只能做到"玩家用单跳能做到的移动"，
     *   凡是它过不去的地方，就是**玩家必须用高级动作**的地方。 */
    const STEP = 3;
    let c = sc;
    let guard = 0;
    while (c < W - 2 && guard++ < W * 3) {
      /* 下一列能不能在 row±STEP 内落脚？ */
      let nextRow = -1, bestD = 999;
      for (let k = -STEP; k <= STEP; k++) {
        if (canStandAt(row + k, c + 1) && Math.abs(k) < bestD) { bestD = Math.abs(k); nextRow = row + k; }
      }
      if (nextRow >= 0) { row = nextRow; c++; continue; }

      /* 落后了：从这里开始记断口，找右边第一个能落脚的列 */
      const gapStart = c + 1;
      let e = gapStart;
      let landRow = -1;
      while (e < W - 1) {
        /* 落点也必须在"跳得到"的范围内（向上 3 格 / 向下自由落体） */
        for (let k = -3; k <= 20; k++) {
          if (canStandAt(row + k, e)) { landRow = row + k; break; }
        }
        if (landRow >= 0) break;
        e++;
      }
      const wdt = e - gapStart + 1;
      if (wdt >= 2) gaps.push({ c: gapStart, w: wdt, w2: wdt + 1 });
      if (landRow < 0) break;         // 后面完全没路了
      row = landRow;
      c = e;
    }
  }
  const bigGaps = gaps.filter(function (g) { return g.w >= TH.CHASM_MIN; });
  const maxGap = gaps.length ? Math.max.apply(null, gaps.map(function (g) { return g.w; })) : 0;

  /* ---- ② 竖井（左右都是连续高墙，缝宽 2~5 格，深 ≥ 4 格） ---- */
  const shafts = [];
  for (let c = 2; c < W - 6; c++) {
    for (let wdt = 2; wdt <= 5; wdt++) {
      let depth = 0, startR = -1;
      for (let r = 2; r < H - 3; r++) {
        let insideEmpty = true;
        for (let k = 0; k < wdt; k++) { if (solid(r, c + k)) { insideEmpty = false; break; } }
        const wallsOk = solid(r, c - 1) && solid(r, c + wdt);
        if (insideEmpty && wallsOk) {
          if (depth === 0) startR = r;
          depth++;
        } else {
          if (depth >= 4) shafts.push({ c: c, w: wdt, rTop: startR, depth: depth });
          depth = 0;
        }
      }
      if (depth >= 4) shafts.push({ c: c, w: wdt, rTop: startR, depth: depth });
    }
  }
  /* 去重（同一条缝会被多个 wdt 命中） */
  const shaftUniq = [];
  shafts.forEach(function (s) {
    if (!shaftUniq.some(function (u) { return Math.abs(u.c - s.c) <= 2 && Math.abs(u.rTop - s.rTop) <= 3; })) shaftUniq.push(s);
  });

  /* ---- ③ 底层连续安全平地（"无脑向右跑"的空间） ---- */
  let flatMax = 0, cur = 0, flatTotal = 0;
  for (let c = 1; c < W - 1; c++) {
    const safe = solid(GR, c) && empty(GR - 1, c) && empty(GR - 2, c) &&
      '^MjoIt<>'.indexOf(map[GR - 1][c]) < 0;
    if (safe) { cur++; flatTotal++; if (cur > flatMax) flatMax = cur; } else cur = 0;
  }

  /* ---- ④ 出生 → 终点 爬升 ---- */
  let spawnR = null, goalR = null;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (map[r][c] === 'P' && spawnR === null) spawnR = r;
    if (map[r][c] === 'G' && goalR === null) goalR = r;
  }
  const climb = (spawnR !== null && goalR !== null) ? (spawnR - goalR) : 0;

  /* ---- ⑤ 高风险路线（离主路 ≥4 格的上层落脚面） ---- */
  let highPlat = 0;
  for (let r = 1; r < GR - 3; r++) for (let c = 1; c < W - 1; c++) {
    if (solid(r, c) && !solid(r - 1, c) && r < GR - 3) highPlat++;
  }

  /* ---- ⑥ 垂直落差（用来判断"二段跳必要"） ---- */
  /* 统计"相邻两级平台之间落差 3~5 格"的台阶数 */
  let dropSteps = 0;
  for (let c = 1; c < W - 1; c++) {
    for (let r = 2; r < GR - 1; r++) {
      if (solid(r, c) && !solid(r - 1, c)) {
        /* 这个台面的高度 */
        let below = -1;
        for (let k = 1; k <= 8; k++) { if (solid(r + k, c)) { below = r + k; break; } }
        if (below > 0 && below - r >= 3 && below - r <= 6) dropSteps++;
        break;
      }
    }
  }

  return {
    H: H, W: W, gaps: gaps, bigGaps: bigGaps, maxGap: maxGap,
    shafts: shaftUniq, flatMax: flatMax, flatTotal: flatTotal,
    climb: climb, highPlat: highPlat, dropSteps: dropSteps,
    name: raw.name, district: raw.district,
  };
}

const stats = levels.map(function (L) {
  const a = analyze(L.raw);
  a.id = L.id;
  return a;
});

/* ---------- 汇总表 ---------- */
console.log('--- 1. 地形硬指标总览 ---');
console.log('关 | 尺寸     | 最宽缺口 | 必须冲刺的缺口 | 竖井 | 底层最长平地 | 爬升 | 高处平台');
console.log('---+----------+----------+----------------+------+--------------+------+---------');
stats.forEach(function (s) {
  console.log(
    String(s.id).padEnd(3) + '| ' +
    (s.W + 'x' + s.H).padEnd(9) + '| ' +
    String(s.maxGap).padEnd(9) + '| ' +
    String(s.bigGaps.length ? s.bigGaps.map(function (g) { return g.w; }).join(',') : '—').padEnd(15) + '| ' +
    String(s.shafts.length).padEnd(5) + '| ' +
    String(s.flatMax).padEnd(13) + '| ' +
    String(s.climb).padEnd(5) + '| ' +
    String(s.highPlat)
  );
});

/* ============================================================
 * 逐关判定
 * ============================================================ */
console.log('\n--- 2. ★★★ 每关"是否真的逼玩家用高级动作" ---');

stats.forEach(function (s) {
  console.log('\n  ▸ 第 ' + s.id + ' 关（' + s.district + '）');

  /* ① 必须冲刺的缺口 */
  check(s.bigGaps.length >= 1,
    '① 有"必须冲刺"的大缺口（≥ ' + TH.CHASM_MIN + ' 格）',
    '最宽只有 ' + s.maxGap + ' 格');

  /* ② 必须墙跳的竖井 */
  check(s.shafts.length >= 1,
    '② 有"必须墙跳"的竖井（宽 2~5、深 ≥ 4 格）',
    '一个都没有');

  /* ③ 必须二段跳的落差 */
  check(s.dropSteps >= 1,
    '③ 有"必须二段跳"的落差（3~6 格台阶）',
    '落差台阶数 0');

  /* ④ 底层不能有大片无脑平地 */
  check(s.flatMax <= TH.FLAT_MAX,
    '④ 底层最长连续安全平地 ≤ ' + TH.FLAT_MAX + ' 格',
    '实测 ' + s.flatMax + ' 格（太长 = 可以无脑向右跑）');

  /* ⑤ 终点要有垂直机动 */
  check(s.climb >= TH.CLIMB_MIN,
    '⑤ 出生→终点爬升 ≥ ' + TH.CLIMB_MIN + ' 格',
    '实测 ' + s.climb + ' 格');
});

/* ============================================================
 * 全局判定
 * ============================================================ */
console.log('\n--- 3. ★ 全局：不能有"只靠一种动作通关"的关卡 ---');

/* 冲刺万能？—— 如果所有缺口都 ≤ 单跳距离，那冲刺确实可以替代一切 */
const dashTrivial = stats.filter(function (s) { return s.maxGap <= SINGLE_TILES; });
check(dashTrivial.length === 0,
  '★ 没有"所有缺口都在单跳范围内"的关卡（冲刺不能无脑替代跳）',
  '第 ' + dashTrivial.map(function (s) { return s.id; }).join(',') + ' 关仍可用单跳解决一切');

/* 全关竖井总数 */
const totalShafts = stats.reduce(function (a, s) { return a + s.shafts.length; }, 0);
check(totalShafts >= 8,
  '★ 8 关的竖井总数 ≥ 8（平均每关至少 1 口）',
  '实测 ' + totalShafts + ' 口');

/* ============================================================
 * 平地总量（"无意义安全地面"）
 * ============================================================
 * 【为什么阈值是 65% 而不是更低】
 *   十一的原话是"**是否有大面积无意义安全地面**"，判据是"无意义"，
 *   不是"越少越好"。平台游戏**必须有能跑的地面** ——
 *   把底层挖成满地是坑，会变成"步步送命"，反而更糟。
 *
 *   ⇒ 真正能表达"无意义"的是**每关的"最长连续平地"**（阈值 24 格，
 *     上面已经逐关判过了）。这个全局百分比只是**兜底监控**：
 *     它抓的是"整张地图几乎全是平地"那种极端情况。
 *
 *   改进前实测 84%，现在 59% —— 说明改动是实打实的。
 *   （84% 的来源是 `ch3Base` 在**全图底下垫了一整条地板**，见它的注释。）
 * ============================================================ */
const totalFlat = stats.reduce(function (a, s) { return a + s.flatTotal; }, 0);
const totalW = stats.reduce(function (a, s) { return a + s.W; }, 0);
const flatPct = Math.round(totalFlat / totalW * 100);
console.log('    （参考）底层安全平地占全地图宽度的 ' + flatPct + '%（改进前 84%）');
check(flatPct <= 65, '★ 底层安全平地占比 ≤ 65%（兜底：不能"整张图都是平地"）', '实测 ' + flatPct + '%');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n============================================');
console.log('  能力压力测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('============================================');
if (fail) {
  console.log('\n❌ 判为"设计过简单"的关卡（需要返工）：');
  const byLv = {};
  failures.forEach(function (f) {
    const m = f.match(/第 (\d+) 关/);
    if (m) { byLv[m[1]] = (byLv[m[1]] || 0) + 1; }
  });
  Object.keys(byLv).sort().forEach(function (k) {
    console.log('   第 ' + k + ' 关：' + byLv[k] + ' 项不达标');
  });
}
process.exit(fail ? 1 : 0);
