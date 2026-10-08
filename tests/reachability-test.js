/* ============================================================
 * reachability-test.js — 收集品可达性自动校验
 * ============================================================
 * 背景：十一反馈"外卖袋位置不合理，根本跳不到顶上平台"。
 * 人工摆位置很容易摆出"跳不到"的死点，而且加关卡后又会忘。
 *
 * 这个测试用**能力上限**做静态校验：
 *   从每个收集品正下方的"最近可站立面"出发，
 *   看跳跃能力够不够到它。
 *
 * 能力基准（实测，袋鼠最强）：
 *   一段跳上升      133px (4.16 格)
 *   两段连跳合计    242px (7.55 格)
 *   踩怪超级跳      220px (6.87 格)
 *
 * ⚠️ 判定要留余量：玩家实际还要横向移动 + 角色有高度，
 *    所以留 8px 容差。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

/* ============================================================
 * ★ 路径常量（迁移后新增）★
 * ============================================================
 * 本项目结构：
 *   <项目根>/
 *     src/    ← index.html + js/ + assets/（源码）
 *     tests/  ← 本文件所在
 *     tools/  ← 构建脚本
 *     dist/   ← 单文件发布版
 *
 * 测试脚本住在 tests/ 里，要读 src/js 和 dist。
 * 下面这几个常量全部基于 __dirname 推算，
 * **不依赖当前工作目录** —— 从任何地方 node 都能跑。
 * ============================================================ */
const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const DIST = path.join(PROJ, 'dist');

const vm = require('vm');

const ROOT = SRC;   // ← 迁移后：源码在 src/ 下
let PASS = 0, FAIL = 0;
const problems = [];
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); problems.push(name + ': ' + extra); }
}

const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, String, Number, Boolean, Error,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/levels.js'), 'utf8'), sandbox, { filename: 'levels.js' });
/* ⚠️⚠️ 必须加载 ch3-builder + levels-ch3（2026-10-07 修的真 bug）⚠️⚠️
 * ------------------------------------------------------------------
 * 【问题】原来这里**只加载 levels.js** —— 而第 13~20 关的**重构版**
 *   定义在 `levels-ch3.js` 里，由它回调 `applyCh3Levels()` 去**替换**。
 *   ⇒ 不加载这两个文件时，`LEVELS_EXTRA` 里躺的是**旧版 13~20 关**，
 *     于是这个测试一直在验一套**玩家根本看不到的地图**，
 *     而且**全部通过**（最危险的"假绿"）。
 *
 *   这个坑项目里记录过一次（见 MEMORY.md 的"27 个测试的 FILES 列表"），
 *   这里是漏网的第 28 个。
 *
 * 【验证方法】加载后断言"第 13 关的地图宽度 = 新版的值（150）"——
 *   如果还是旧版的 110，就说明加载没生效。 */
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ch3-builder.js'), 'utf8'), sandbox, { filename: 'ch3-builder.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/levels-ch3.js'), 'utf8'), sandbox, { filename: 'levels-ch3.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/physics.js'), 'utf8'), sandbox, { filename: 'physics.js' });

/* ⚠️ 注意：vm 沙箱里的 `const` 不会挂到 sandbox 对象上，
 * 必须用 vm.runInContext 求值取出来 —— 直接写 CELESTE 会拿到 undefined。
 * 这个坑害我找了半天（新动作的冲刺距离参数读不到，能力算少了 110px）。 */
const G = function (n) { return vm.runInContext(n, sandbox); };

const CONFIG = G('CONFIG');
const parseLevel = G('parseLevel');
const LEVEL_TILE = G('LEVEL_TILE');
const T = LEVEL_TILE;

/* ---- 能力上限 ---- */
function rise(v0) { let y = 0, v = v0; for (let i = 0; i < 400 && v < 0; i++) { y += v; v += CONFIG.GRAVITY; } return Math.abs(y); }
const JUMP1_K = rise(CONFIG.JUMP_POWER * CONFIG.KANGAROO_JUMP_MUL);
const JUMP2_K = JUMP1_K + rise(CONFIG.JUMP_POWER * CONFIG.KANGAROO_JUMP_MUL * CONFIG.DOUBLE_JUMP_MUL);
const SUPER = rise(CONFIG.STOMP_BOUNCE_SUPER);
const TOL = 8;   // 容差

/* ★ 新动作带来的额外可达性（第5关用）★
 * ------------------------------------------------------------
 * 第 5 关是"动作试炼场"，玩家有墙跳和冲刺可用，
 * 所以单纯按"普通跳跃"判定会误报"够不到"。
 *
 * 这里的处理原则：**保守估算**——
 *   · 墙跳：不能简单当成"额外高度"，因为它依赖旁边有墙。
 *     所以不把它算进通用能力（靠墙才能用）。
 *   · 冲刺：能垂直上升 CELESTE.dashDistance（110px），
 *     而且**不消耗跳跃**，所以可以"跳 + 冲"叠加。
 *
 * 综合：跳跃两段(242) + 冲刺(110) ≈ 352px 的瞬时高度。
 * 但冲刺后水平位移很大，落点要求严格，所以留一半余量更安全。
 * ------------------------------------------------------------ */
const CELESTE = G('CELESTE');
const DASH = (CELESTE && CELESTE.dashDistance) ? CELESTE.dashDistance : 0;
/* 带冲刺的可达高度：两段跳之后还能冲一次 */
const JUMP_DASH_K = JUMP2_K + DASH * 0.85;   // 留 15% 余量（冲刺后要能落住）

/* 判定用的能力上限：如果关卡有新机关（第5关），按"带冲刺"算 */
function abilityFor(lv) {
  const isActionLevel = (lv.movers && lv.movers.length) ||
                        (lv.windGates && lv.windGates.length) ||
                        (lv.switchers && lv.switchers.length);
  /* ⚠️⚠️ 2026-10-06 重要修正：第 1 关必须按【一段跳】判定 ★★
   * ------------------------------------------------------------
   * 【为什么】二连跳是**通关第 1 关之后**才解锁的（见 save.js 的
   *   ACTION_UNLOCKS：`doublejump` 的 afterLevel = 1）。
   *   所以第 1 关里玩家**只有一段跳 133px**。
   *
   * 之前的 bug：
   *   这个函数只区分"有机关/没机关"，第 1 关被当成普通关，
   *   用了 `JUMP2_K`（二连跳 242px）判定。
   *   ⇒ 行 17 那三个金币需要 176px，按 242px 算"够得到"，
   *     但玩家实际只有 133px，**永远拿不到** ——
   *     十一反馈的"**第一关无法收集全部外卖**"就是这个。
   *   ⇒ 修正后按 133px 判，问题当场暴露（现在已修好地图）。
   *
   * ⚠️ 以后加新动作时，若某动作是"通关某关后才解锁"，
   *    那个关卡的能力基准也要跟着调 —— 别一律用最大能力。
   * ------------------------------------------------------------ */
  const isLevel1 = (lv.id === 1 && !isActionLevel);
  if (isLevel1) {
    return {
      max: JUMP1_K,
      label: '一段跳 ' + JUMP1_K.toFixed(0),
      isAction: false,
    };
  }
  return {
    max: isActionLevel ? JUMP_DASH_K : JUMP2_K,
    label: isActionLevel ? ('连跳+冲刺 ' + JUMP_DASH_K.toFixed(0)) : ('连跳 ' + JUMP2_K.toFixed(0)),
    isAction: isActionLevel,
  };
}

console.log('收集品可达性校验');
console.log('='.repeat(60));
console.log('能力基准（像素 / 格）:');
console.log('  一段跳      ' + JUMP1_K.toFixed(0).padStart(4) + 'px / ' + (JUMP1_K / T).toFixed(2) + ' 格');
console.log('  两段连跳    ' + JUMP2_K.toFixed(0).padStart(4) + 'px / ' + (JUMP2_K / T).toFixed(2) + ' 格');
console.log('  踩怪超级跳  ' + SUPER.toFixed(0).padStart(4) + 'px / ' + (SUPER / T).toFixed(2) + ' 格');
console.log('  连跳+冲刺   ' + JUMP_DASH_K.toFixed(0).padStart(4) + 'px / ' + (JUMP_DASH_K / T).toFixed(2) +
  ' 格（仅"有机关的动作关"适用）');
console.log('  容差 ±' + TOL + 'px');
console.log();

/* ---- 收集所有可站立面 ---- */
function collectStandables(lv) {
  const surfaces = [];
  function push(x, y, w) { surfaces.push({ x: x, y: y, x0: x, x1: x + w }); }
  lv.solids.forEach(function (s) { push(s.x, s.y, s.w); });
  lv.platforms.forEach(function (p) { push(p.x, p.y, p.w); });       // '=' 单向平台
  lv.springs.forEach(function (s) { push(s.x, s.y, s.w); });
  if (lv.conveyors) lv.conveyors.forEach(function (c) { push(c.x, c.y, c.w); });
  return surfaces;
}

/* ---- 检查一个收集品 ----
 * ability 由调用方按关卡类型给出（普通关 vs 动作关）。 */
function checkCoin(lv, coin, ability) {
  const surfaces = collectStandables(lv);
  /* 只考虑在金币**下方**、且横向有交叠的面 */
  let best = null;
  surfaces.forEach(function (s) {
    const overlap = (coin.x + 10 > s.x0) && (coin.x - 10 < s.x1);
    if (!overlap) return;
    if (s.y < coin.y - 2) return;                 // 面必须在下方
    if (!best || s.y < best.y) best = s;          // 取最高（最容易够到）的那个
  });
  const gy = best ? best.y : (lv.height);
  const need = gy - coin.y;
  const ok = need <= ability.max + TOL;
  return { need: need, from: gy, ok: ok, best: best };
}

/* ---- ★ 坑上方的金币：跳过坑时顺路吃（2026-10-06 新增）★ ----
 * ------------------------------------------------------------
 * 【背景】静态判定只认"金币正下方有落脚面"。但有一类金币是
 *   故意悬在**坑的正上方**的（第 1 关 col31 / col65 那两个）——
 *   玩家跑着跳过坑，**跳跃弧线正好穿过金币**，顺手就吃到。
 *
 *   静态判定看不出这个，会误报"够不到"，逼着人把好设计改掉。
 *   所以这里补一条：**金币正下方没面，但左右两侧都有地面、
 *   且坑宽 ≤ 一段跳的水平射程 → 算可达。**
 *
 * ⚠️ 只对"下方完全没有落脚面"的金币生效。下方有面的，
 *    走上面正常的 `need <= ability.max` 判定，逻辑不变。
 * ------------------------------------------------------------ */
function checkCoinOverGap(lv, coin, ability) {
  const r = checkCoin(lv, coin, ability);
  if (r.best) return r;                           // 下方有面 → 老逻辑说了算

  /* 下方没面：找左右两侧最近的实心地面，看坑宽 */
  const surfaces = collectStandables(lv);
  /* 收集"金币下方（更靠下）"的所有面，按 x 排序 */
  const below = surfaces.filter(function (s) {
    return s.y > coin.y + 2;                      // 面在金币下方（y 更大）
  });
  const left = below.filter(function (s) { return s.x1 <= coin.x + 10; });
  const right = below.filter(function (s) { return s.x0 >= coin.x - 10; });
  if (!left.length || !right.length) return r;    // 一侧没地面 → 判不了，保持原结论

  const nearLeft = left.reduce(function (a, b) { return b.x1 > a.x1 ? b : a; });
  const nearRight = right.reduce(function (a, b) { return b.x0 < a.x0 ? b : a; });
  /* 两侧地面高度要接近（同一层），否则不是"坑"而是"台阶" */
  if (Math.abs(nearLeft.y - nearRight.y) > 40) return r;

  const gapW = nearRight.x0 - nearLeft.x1;        // 坑的宽度（像素）
  const canClear = gapW <= ability.max * 0.95;    // 跳跃水平射程内
  if (canClear && r.need <= ability.max + TOL + (nearLeft.y - coin.y)) {
    /* 从坑沿起跳能越过，且跳跃弧线在金币高度时确实存在 → 算可达 */
    return { need: r.need, from: nearLeft.y, ok: true, best: { k: 'gap-jump', y: nearLeft.y, x: nearLeft.x1 }, overGap: true };
  }
  return r;
}

/* ---- 逐关检查 ---- */
const LEVELS = G('LEVELS').concat(G('LEVELS_COOP')).concat(G('LEVELS_EXTRA'));

LEVELS.forEach(function (raw, li) {
  const lv = parseLevel(raw);
  console.log('\n【第 ' + (li + 1) + ' 关】' + lv.name);
  console.log('  外卖袋数量: ' + lv.coins.length);

  const ability = abilityFor(lv);
  if (ability.isAction) {
    console.log('  （本关有机关 → 按"连跳+冲刺"能力判定）');
  }
  let bad = 0;
  const unreachable = [];
  lv.coins.forEach(function (c, ci) {
    const r = checkCoinOverGap(lv, c, ability);
    if (!r.ok) {
      bad++;
      unreachable.push({ i: ci + 1, x: Math.round(c.x), y: Math.round(c.y), need: Math.round(r.need) });
    }
  });

  if (bad === 0) {
    console.log('  ✅ 全部 ' + lv.coins.length + ' 个外卖袋都够得到');
    PASS++;
  } else {
    console.log('  ❌ ' + bad + ' 个够不到（能力上限 ' + ability.max.toFixed(0) + 'px）:');
    unreachable.forEach(function (u) {
      console.log('     #' + u.i + ' x=' + u.x + ' y=' + u.y +
        ' 需 ' + u.need + 'px（超 ' + (u.need - Math.round(ability.max)) + 'px）');
    });
    FAIL++;
    problems.push('第' + (li + 1) + '关有 ' + bad + ' 个外卖袋够不到');
  }
});

/* ------------------------------------------------------------
 * ★ 教学关（第 1 关）主路线"单跳净空"检查 ★
 * ------------------------------------------------------------
 * 背景（2026-10-06 十一反馈"教学关要二连跳才能过"）：
 *   二连跳要通关第 1 关才解锁，所以第 1 关只能用一段跳。
 *   但 v2 地图把行20 的砖悬在了沟的正上方 —— 玩家满跳升
 *   32px 就撞头（角色高 32px，行20 砖底离地 64px），
 *   垂直速度清零 → 掉沟里死。轻跳更短，照样过不了沟。
 *
 *   上面"收集品可达性"检查抓不到这种 bug，因为它按
 *   "二连跳能力"判定 —— 假设本身就是错的。所以这里
 *   换成"新玩家视角"做结构检查：
 *
 * 规则：主地面（行23）上每个坑、行22 每个尖刺，
 *   其列范围 ±2 格（起跳区 + 落点余量）内、
 *   头顶 4 格（行17~20）不得有实心砖 '#'。
 *   （'=' 单向平台从下方可以穿过，不挡跳跃弧线，不算。）
 * 另查：坑宽 ≤ 3 格（一段跳水平飞行约 3.4~4.4 格）。
 * ------------------------------------------------------------ */
console.log('\n=== 教学关主路线单跳净空（新玩家没有二连跳）===');
(function checkLevel1SingleJump() {
  const MAP_W_88 = G('MAP_W');        // vm 沙箱里 const 不挂全局，必须 G() 取
  const raw1 = G('LEVELS')[0];
  const map = raw1.map;               // 已 padRow 的字符串数组
  const GROUND_ROW = 23;

  /* 找坑：行23 上的连续 '.' 段（不含地图边界 col0 / col87） */
  const pits = [];
  let cur = null;
  for (let c = 1; c < MAP_W_88 - 1; c++) {
    if (map[GROUND_ROW][c] === '.') {
      if (!cur) cur = { a: c, b: c }; else cur.b = c;
    } else if (cur) { pits.push(cur); cur = null; }
  }
  if (cur) pits.push(cur);

  /* 找尖刺：行22 的 '^' */
  const spikes = [];
  for (let c = 1; c < MAP_W_88 - 1; c++) {
    if (map[22][c] === '^') spikes.push(c);
  }

  /* 禁区列集合：坑/尖刺 ±2 格 */
  const forbidden = new Set();
  pits.forEach(function (p) {
    for (let c = p.a - 2; c <= p.b + 2; c++) forbidden.add(c);
  });
  spikes.forEach(function (c) {
    for (let k = c - 2; k <= c + 2; k++) forbidden.add(k);
  });

  /* 头顶 4 格（行17~20）内不得有实心砖 */
  const blockers = [];
  for (let r = 17; r <= 20; r++) {
    for (let c = 0; c < MAP_W_88; c++) {
      if (forbidden.has(c) && map[r][c] === '#') {
        blockers.push('行' + r + '列' + c);
      }
    }
  }
  check('主路坑/尖刺的跳跃弧线上方无实心砖', blockers.length === 0,
    blockers.join(' '));

  /* 坑宽：一段跳水平飞行 3.4~4.4 格 */
  const wide = pits.filter(function (p) { return p.b - p.a + 1 > 3; });
  check('所有坑宽 ≤ 3 格（一段跳可越过）', wide.length === 0,
    wide.map(function (p) { return '列' + p.a + '-' + p.b; }).join(' '));

  if (pits.length === 0 && spikes.length === 0) {
    console.log('  （第 1 关没有坑/尖刺？检查 GROUND_ROW 是否还是 23）');
  }
})();

/* ============================================================
 * ★★ 通用：主路线不许被"过不去的墙"堵死 ★★
 * ============================================================
 * 背景（2026-10-06 十一反馈"第三关没有爬墙技能过不去"）：
 *   墙跳练习角被摆在了第 3 关**主路正中间**，行18 一条封顶砖。
 *   要越过它需要上升 224px（7 格），而墙跳是通关第 3 关后才解锁的 ——
 *   玩家当时根本没这个技能，被永久挡死在列 56，到不了终点。
 *
 *   原有测试全都没抓到，因为它们只检查"金币跳不跳得到"和
 *   "出生点安全"，**没有一个检查"路是不是通的"**。
 *
 * 本检查用"新玩家视角"扫每一关的地面主干道：
 *   从出生点出发，沿地面（主地板那一行）向右扫描，
 *   统计"挡路的实心砖"。只要某列：
 *     · 地面行（玩家身体所在行）是实心 '#'
 *     · 且它上方连续 N 格（N = 该角色能跳过的高度）也全是实心 '#'
 *   那么这一列就是**跳不过去的墙**。
 *
 *   判断"能不能跳过去"用的是**关卡解锁时玩家实际拥有的能力**，
 *   而不是角色理论上限 —— 这才是关键：
 *     第 1 关：只有单跳（二连跳未解锁）
 *     第 2、3 关：单跳 + 二连跳（墙跳/冲刺未解锁）
 *     第 4、5 关：再多冲刺
 *   一开始就是没按这个算，才漏掉了第 3 关的死路。
 * ============================================================ */
console.log('\n=== 通用检查：主路线是否被"过不去的墙"堵死 ===');

/* 每关解锁时玩家**实际能用**的跳跃高度（像素）。
 * 换算：rise(v0) 逐帧求和，见文件顶部。
 *   jm = 角色跳跃倍率（取两个角色里**最差**的那个 —— 最差能过才算真能过） */
function abilityAtLevel(levelIndex) {
  const jmWorst = Math.min(CONFIG.KANGAROO_JUMP_MUL, 1.0);   // 奶龙是 1.0，最低
  const j1 = rise(CONFIG.JUMP_POWER * jmWorst);
  const hasDouble = levelIndex + 1 > 1;      // 通关第 1 关后才解锁二连跳
  const j2 = hasDouble ? rise(CONFIG.JUMP_POWER * jmWorst * CONFIG.DOUBLE_JUMP_MUL) : 0;
  return j1 + j2;
}

const ALL_LEVELS = G('LEVELS').concat(G('LEVELS_COOP')).concat(G('LEVELS_EXTRA'));
let wallIssues = 0;

ALL_LEVELS.forEach(function (raw, li) {
  const map = raw.map;
  const lv = parseLevel(raw);
  const GROUND = 23;                              // 玩家身体所在行
  const jumpH = abilityAtLevel(li);
  const jumpCells = jumpH / T;                    // 能跳过的格数

  /* 找出生点，取最靠左的那个当作"起点" */
  const spawnCol = lv.spawns.length
    ? Math.min.apply(null, lv.spawns.map(function (s) { return Math.floor(s.x / T); }))
    : 2;
  /* 终点列 */
  const goalCol = lv.goal ? Math.floor(lv.goal.x / T) : MAP_W_88 - 3;

  const walls = [];
  for (let c = spawnCol; c <= goalCol; c++) {
    if (map[GROUND][c] !== '#') continue;         // 地面行不是砖 → 不是墙
    /* 从地面行往上数连续实心格数 */
    let h = 0;
    while (GROUND - h >= 0 && map[GROUND - h][c] === '#') h++;
    /* 墙高超过"能跳过的格数" → 跳不过去 */
    if (h > jumpCells) walls.push({ c: c, h: h });
  }

  if (walls.length) {
    wallIssues++;
    console.log('  ❌ 第' + (li + 1) + '关 ' + lv.name + '：');
    console.log('     ' + (li + 1) + ' 关通关时玩家跳跃能力 ' + jumpH.toFixed(0) +
      'px（' + jumpCells.toFixed(1) + ' 格）');
    walls.forEach(function (w) {
      console.log('     列 ' + w.c + ' 有 ' + w.h + ' 格高的实心墙 —— 跳不过去，路被堵死');
    });
  }
});

check('所有关卡主路线都没有"跳不过去的墙"', wallIssues === 0,
  wallIssues + ' 关有堵路');
if (wallIssues === 0) {
  console.log('  ✅ 每一关的主路线都能走到终点（按解锁当时的技能算）');
}


console.log('\n=== 安全检查：外卖袋是否直接压在刺的正上方 ===');
let hazardIssues = 0;
LEVELS.forEach(function (raw, li) {
  const lv = parseLevel(raw);
  if (!lv.hazards || !lv.hazards.length) return;
  lv.coins.forEach(function (c, ci) {
    lv.hazards.forEach(function (h) {
      const dx = Math.abs((h.x + h.w / 2) - c.x);
      const dy = h.y - c.y;
      /* 金币在刺正上方 0~40px 内 → 玩家去捡几乎必踩刺 */
      if (dx < 16 && dy > 0 && dy < 40) {
        hazardIssues++;
        console.log('  ⚠️ 第' + (li + 1) + '关 #' + (ci + 1) + ' 外卖袋(x=' + Math.round(c.x) +
          ') 在刺上方 ' + Math.round(dy) + 'px —— 捡它就必踩刺');
      }
    });
  });
});
if (hazardIssues === 0) console.log('  ✅ 没有外卖袋压在刺正上方');
check('无外卖袋压在刺上方（危险摆放）', hazardIssues === 0, hazardIssues + ' 处');

/* ---- 检查出生点是否安全 ---- */
console.log('\n=== 安全检查：出生点下方是否有地面 ===');
let spawnIssues = 0;
LEVELS.forEach(function (raw, li) {
  const lv = parseLevel(raw);
  const surfaces = collectStandables(lv);
  lv.spawns.forEach(function (sp) {
    const below = surfaces.filter(function (s) {
      return sp.x + 20 > s.x0 && sp.x < s.x1 && s.y >= sp.y;
    });
    if (!below.length) {
      spawnIssues++;
      console.log('  ⚠️ 第' + (li + 1) + '关 ' + sp.role + ' 出生点(x=' + sp.x + ',y=' + sp.y + ') 下方没有地面');
    }
  });
});
check('所有出生点下方都有地面', spawnIssues === 0, spawnIssues + ' 处');
if (spawnIssues === 0) console.log('  ✅ 出生点下方都有地面');

/* ------------------------------------------------------------
 * ★ 出生点头顶必须净空 ★
 * ------------------------------------------------------------
 * 踩过的坑：给第1关加跳板时，把一块砖放在了奶龙出生点**正上方**，
 * 结果角色一出生就被顶在砖下面 —— vy=0、onGround=false，
 * 永远落不下来，看起来像"卡死在半空"。
 * jump-test 里"奶龙也能二连跳"就是这么挂掉的（跳不起来）。
 *
 * 判定：出生点包围盒（x±1格，向上 3 格）内不能有任何实心块。
 * ------------------------------------------------------------ */
console.log('\n=== 安全检查：出生点头顶必须净空（防止卡住）===');
let headIssues = 0;
LEVELS.forEach(function (raw, li) {
  const lv = parseLevel(raw);
  lv.spawns.forEach(function (sp) {
    const px = sp.x, py = sp.y;
    const pw = CONFIG.PLAYER_W, ph = CONFIG.PLAYER_H;
    /* 检查出生点上方 3 格内是否有实心块 */
    const ceiling = py - T * 3;
    lv.solids.forEach(function (s) {
      const hitX = (px + pw > s.x) && (px < s.x + s.w);
      const hitY = (s.y + s.h > ceiling) && (s.y < py);
      if (hitX && hitY) {
        headIssues++;
        console.log('  ⚠️ 第' + (li + 1) + '关 ' + sp.role + ' 出生点(x=' + Math.round(px) +
          ',y=' + Math.round(py) + ') 头顶有障碍：solid(x=' + Math.round(s.x) +
          ',y=' + Math.round(s.y) + ') —— 角色会被顶住落不下来');
      }
    });
  });
});
check('所有出生点头顶净空', headIssues === 0, headIssues + ' 处');
if (headIssues === 0) console.log('  ✅ 出生点头顶都没有障碍');

/* ============================================================
 * ★ 新增：「封闭区域里的收集品」检查（2026-10-06）★
 * ============================================================
 * 【为什么加】十一反馈"**第五关还有三个捡不到，被土框起来了**"。
 *
 *   实测第 5 关的"墙跳井"是个**完全密封的盒子**：
 *     左墙 col23 + 右墙 col31 + 井底 行19 + **井顶 行7**
 *     （`hline(g, 7, 23, 36, '#')` 从 col23 起，把井口整个盖住了）
 *   ⇒ 四个方向全封死，里面那 3 个金币永远拿不到。
 *
 *   旧的"收集品可达性"检查抓不到这一类 ——
 *   它是**逐金币看"下方最近的面"**，只要那个面「理论上够高」
 *   就算过。而这里的问题是「**那个面本身就到不了**」（被围死），
 *   属于**拓扑问题**，不是高度问题。
 *
 * 【做法】用物理引擎的**真碰撞体**做洪水填充：
 *   从出生点出发，只走「上下左右都不是实心」的格。
 *   如果一个金币的四邻**一个都到不了** → 说明它在封闭区域里。
 *
 * ⚠️ 局限：洪水填充**只走平地、不算跳跃**。所以对"高处平台上的
 *    金币"会**误报**（那些要靠跳）。
 *    ⇒ 所以这里**只报「区域面积极小的孤立块」**——
 *      真正的密封盒子一定很小（几格到几十格），
 *      而"高处平台"总是连着大片的可走区域。
 *      判定阈值：金币所在的连通块 ≤ 80 格 → 认为是封闭盒子。
 *
 *    这样既不误报高处平台，又能抓住"井里/盒子里"这类问题。
 * ============================================================ */
console.log('\n=== 封闭区域里的收集品（永久拿不到）===');
(function checkEnclosedCoins() {
  let enclosed = 0;
  LEVELS.forEach(function (raw, li) {
    const lv = parseLevel(raw);
    /* ---- 实心判定（用真碰撞体，比按字符判准） ---- */
    function solidAt(c, r) {
      const x = c * T, y = r * T;
      return lv.solids.some(function (s) {
        return s.x < x + T && s.x + s.w > x && s.y < y + T && s.y + s.h > y;
      });
    }
    /* ---- 从出生点洪水填充，记录每个空格属于哪个"连通块" ---- */
    const spawn = (lv.spawns && lv.spawns[0]) ? lv.spawns[0] : null;
    if (!spawn) return;
    const start = [Math.round(spawn.y / T), Math.round(spawn.x / T)];
    const blockId = {};
    const blocks = [];              // 每块的格数
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let r = 0; r < lv.rows; r++) {
      for (let c = 0; c < lv.cols; c++) {
        const key = r + ',' + c;
        if (blockId[key] !== undefined) continue;
        if (solidAt(c, r)) continue;
        /* BFS 一整块 */
        const id = blocks.length;
        let size = 0;
        const q = [[r, c]];
        blockId[key] = id;
        while (q.length) {
          const cur = q.shift();
          size++;
          dirs.forEach(function (d) {
            const rr = cur[0] + d[0], cc = cur[1] + d[1];
            if (rr < 0 || rr >= lv.rows || cc < 0 || cc >= lv.cols) return;
            const k2 = rr + ',' + cc;
            if (blockId[k2] !== undefined) return;
            if (solidAt(cc, rr)) return;
            blockId[k2] = id;
            q.push([rr, cc]);
          });
        }
        blocks.push(size);
      }
    }
    const startBlock = blockId[start[0] + ',' + start[1]];
    /* ---- 检查每个金币 ---- */
    lv.coins.forEach(function (coin) {
      const cx = Math.round(coin.x / T), cy = Math.round(coin.y / T);
      /* 金币四邻所在块的 id（可能多个） */
      const ids = [];
      dirs.forEach(function (d) {
        const k = (cy + d[0]) + ',' + (cx + d[1]);
        if (blockId[k] !== undefined && ids.indexOf(blockId[k]) < 0) ids.push(blockId[k]);
      });
      if (!ids.length) return;                    // 金币四周全是实心，另行处理
      /* 只要它挨着"出生点那块"或任何一个**大于 80 格**的块 → 正常 */
      const bigOrMain = ids.some(function (id) {
        return id === startBlock || blocks[id] > 80;
      });
      if (!bigOrMain) {
        enclosed++;
        const sizes = ids.map(function (id) { return blocks[id]; }).join('/');
        console.log('  ❌ 第' + lv.id + '关 金币 col' + cx + ' 行' + cy +
          ' 在一个**只有 ' + sizes + ' 格**的封闭小区域里 → 玩家拿不到');
        problems.push('第' + lv.id + '关 col' + cx + '行' + cy + ' 的收集品在封闭区域里');
      }
    });
  });
  check('没有收集品被关在封闭区域里', enclosed === 0, enclosed + ' 个');
  if (enclosed === 0) console.log('  ✅ 所有收集品都在可到达的区域里');
})();

console.log('\n' + '='.repeat(60));
console.log('  可达性校验: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) {
  console.log('\n  待修问题:');
  problems.forEach(function (p) { console.log('    · ' + p); });
}
console.log('='.repeat(60));
process.exit(FAIL > 0 ? 1 : 0);
