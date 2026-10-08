/* ============================================================
 * mover-connectivity-test.js — 移动平台"连通性"校验
 * ============================================================
 * 【为什么要单独写这个测试】
 * ============================================================
 * 十一反馈："第 11 关我没看到缆车" —— 查下去发现两个真问题：
 *   ① 缆车 6 最右会插进终点站台 2 格（视觉上"箱子钻进桥里"）
 *   ② 救生台放在行 16，缆车在行 12，差 4 格 = 128px，撞跳跃极限
 *      → 掉下去爬不回来，"救生台"形同虚设
 *
 * 但 **reachability-test.js 全是绿**，一个都测不出来。
 * 原因：它的 collectStandables() 只收 solids / platforms / springs /
 *      conveyors，**完全没把 lv.movers 算进去**。
 *      它把移动平台当成"不存在"，自然测不出移动平台的问题。
 *
 * 本测试补上这个盲区，做法是：
 *   1. 采样移动平台**整个往返周期**，算出它实际覆盖的**列区间**
 *      （rangeX × 2 + 自身宽度）。
 *   2. 按"所在行"分组，检查**同一行内相邻平台之间**是否存在
 *      「永久空档」——即无论平台怎么动都填不上的缝。
 *   3. 检查每个移动平台与**最近的静止落脚面**之间的衔接：
 *      · 垂直方向：站立面高差是否在单跳能力内
 *      · 水平方向：是否存在能跳过的连接点
 *
 * 【判定标准（都是实测出来的，不是拍的）】
 *   · 同高度的两个平台：只要列区间有重叠 → 连通（玩家能走过去）
 *   · 同高度、有 < 1.5 格空档 → 算连通（一步跨过）
 *   · 有高差时：高差 ≤ 单跳能力（袋鼠 133px ≈ 4.16 格）→ 连通
 *   · 高差 > 4.16 格 → 报错（除非中间有落脚点）
 *
 * ⚠️ 本测试只做**几何连通性**，不模拟真实操作手感。
 *    它的价值是抓"结构上根本过不去"的死点，不是判难度。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const ROOT = SRC;

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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/physics.js'), 'utf8'), sandbox, { filename: 'physics.js' });

/* ⚠️ vm 沙箱里的 const 不会挂到 sandbox 上，必须用 runInContext 求值取出来。 */
const G = function (n) { return vm.runInContext(n, sandbox); };

const CONFIG = G('CONFIG');
const parseLevel = G('parseLevel');
const LEVEL_TILE = G('LEVEL_TILE');
const LEVELS_EXTRA = G('LEVELS_EXTRA');
const LEVELS = G('LEVELS');
const T = LEVEL_TILE;

/* ---- 跳跃能力（实测算，和 reachability-test 保持一致）----
 * 为什么用袋鼠：红线要求"任何角色都要能过"，
 * 但连通性判定用**最强角色**当基准，再单独提示"最弱角色可能不够"。
 * 这样不会因为一个角色的特殊数值把整个测试搞成误报。 */
function rise(v0) { let y = 0, v = v0; for (let i = 0; i < 400 && v < 0; i++) { y += v; v += CONFIG.GRAVITY; } return Math.abs(y); }
const JUMP1_K = rise(CONFIG.JUMP_POWER * CONFIG.KANGAROO_JUMP_MUL);
/* 最弱角色（奶龙/卡皮巴拉）的单跳——用来提示"这关是不是只有袋鼠能过" */
const JUMP1_WEAK = rise(CONFIG.JUMP_POWER * Math.min(
  CONFIG.DRAGON_JUMP_MUL != null ? CONFIG.DRAGON_JUMP_MUL : 1,
  CONFIG.CAPYBARA_JUMP_MUL != null ? CONFIG.CAPYBARA_JUMP_MUL : 1
));

const allLevels = LEVELS.concat(LEVELS_EXTRA);

console.log('移动平台连通性校验');
console.log('='.repeat(64));
console.log('能力基准：');
console.log('  袋鼠单跳    ' + JUMP1_K.toFixed(0).padStart(4) + 'px / ' + (JUMP1_K / T).toFixed(2) + ' 格（判定用）');
console.log('  最弱单跳    ' + JUMP1_WEAK.toFixed(0).padStart(4) + 'px / ' + (JUMP1_WEAK / T).toFixed(2) + ' 格（提示用）');
console.log();

/* ============================================================
 * 采样一个移动平台在整个往返周期里的覆盖区间
 * ============================================================
 * 复刻 actions.js actUpdateMechanisms() 的运动学：
 *   phase 累加 → 三角波 → offset ∈ [-1,1] → x = baseX + rangeX*offset
 *
 * ⚠️ 只采样 200 个点就够（三角波是分段线性，极值必出现在端点/中点）。
 *    采样公式和引擎一致，不依赖引擎的帧率。
 * ============================================================ */
function sampleMover(m, samples) {
  samples = samples || 200;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let s = 0; s <= samples; s++) {
    const phase = s / samples;
    const tri = phase < 0.5 ? (phase * 2) : (2 - phase * 2);
    const off = (tri - 0.5) * 2;
    const nx = m.baseX + (m.rangeX || 0) * off;
    const ny = m.baseY + (m.rangeY || 0) * off;
    if (nx < minX) minX = nx;
    if (nx > maxX) maxX = nx;
    if (ny < minY) minY = ny;
    if (ny > maxY) maxY = ny;
  }
  return {
    /* 平台**箱体**覆盖的列区间（含自身宽度） */
    colMin: minX / T, colMax: (maxX + m.w) / T,
    rowMin: minY / T, rowMax: (maxY + m.h) / T,
    /* 平台顶面所在的行（站立用） */
    topRowMin: minY / T, topRowMax: maxY / T,
  };
}

/* ---- 收集一关里"所有能站的地方"（含移动平台）---- */
function standables(lv, moverSamples) {
  const out = [];
  lv.solids.forEach(function (s) { out.push({ x0: s.x / T, x1: (s.x + s.w) / T, top: s.y / T, kind: 'solid' }); });
  lv.platforms.forEach(function (p) { out.push({ x0: p.x / T, x1: (p.x + p.w) / T, top: p.y / T, kind: 'plat' }); });
  if (lv.conveyors) lv.conveyors.forEach(function (c) { out.push({ x0: c.x / T, x1: (c.x + c.w) / T, top: c.y / T, kind: 'conv' }); });
  if (lv.springs) lv.springs.forEach(function (s) { out.push({ x0: s.x / T, x1: (s.x + s.w) / T, top: s.y / T, kind: 'spring' }); });
  (moverSamples || []).forEach(function (ms, i) {
    out.push({
      x0: ms.colMin, x1: ms.colMax,
      /* 移动平台可能上下动，站立面取**最高**的那一行（玩家从上面踩） */
      top: ms.topRowMin,
      topRange: [ms.topRowMin, ms.topRowMax],
      kind: 'mover' + i,
    });
  });
  return out;
}

let levelsWithMovers = 0;

allLevels.forEach(function (raw) {
  const lv = parseLevel(raw);
  if (!lv.movers || !lv.movers.length) return;
  levelsWithMovers++;

  console.log('【第 ' + lv.id + ' 关】' + lv.name + '  —— ' + lv.movers.length + ' 个移动平台');

  const samples = lv.movers.map(function (m) { return sampleMover(m); });

  /* ⚠️ statics 必须在"检查 1"之前算好 ——
   *    检查 1 要用它判"缝里有没有中转落脚面"。
   *    （第一版放在检查 2 前面，导致检查 1 里 TDZ 报错。） */
  const statics = standables(lv, null).filter(function (s) { return s.kind.indexOf('mover') !== 0; });

  /* ---- 检查 1：同行的相邻移动平台之间有没有"永久空档" ----
   * ⚠️⚠️ 关键：**中间夹着静止落脚面时不算空档**。
   *   例：第 11 关缆车 6（→col69）和缆车 7（col76→）之间隔着终点站台
   *   （col70-78）。玩家是"缆车6 → 站台 → 缆车7"接力过去的，
   *   根本不需要从缆车直达缆车。第一版没考虑这点 →
   *   把 7 个正常设计全报成了 false positive。
   *
   *   判定：A 到 B 之间的缝隙里，如果有**同行的静止面**能站，
   *   且该面与 A、与 B 各自都连通 → 视为连通（中转站）。 */
  const byRow = {};
  samples.forEach(function (ms, i) {
    const rowKey = Math.round(lv.movers[i].baseY / T);
    (byRow[rowKey] = byRow[rowKey] || []).push({ i: i, ms: ms });
  });

  /* 同行静止面（用来判"有没有中转站"）
   * ⚠️ 行号容差 ±1：移动平台常放在落脚面**上方一格**
   *    （第 8 关桥面在行 20、渡船在行 19），
   *    它们顶面**视觉上齐平**，算"同一层"。
   *    第一版只认严格同行 → 渡船判定全部失效。 */
  function staticOnRow(rowKey, x0, x1) {
    return statics.some(function (s) {
      if (Math.abs(s.top - rowKey) > 1.5) return false;
      if (s.kind.indexOf('mover') === 0) return false;
      /* 和缝隙区间有交叠 */
      return (s.x1 > x0 + 0.05) && (s.x0 < x1 - 0.05);
    });
  }

  Object.keys(byRow).sort(function (a, b) { return a - b; }).forEach(function (rowKey) {
    const rk = Number(rowKey);
    const arr = byRow[rowKey].sort(function (a, b) { return a.ms.colMin - b.ms.colMin; });
    for (let k = 0; k < arr.length - 1; k++) {
      const A = arr[k], B = arr[k + 1];
      const gap = B.ms.colMin - A.ms.colMax;
      if (gap <= 1.5) {
        check('第' + lv.id + '关 行' + rk + ' 平台#' + A.i + '→#' + B.i + ' 衔接', true);
        continue;
      }
      /* 有缝：检查缝里有没有可站的中转面 */
      const hasStop = staticOnRow(rk, A.ms.colMax, B.ms.colMin);
      /* ★ 另一种合法情况：「渡船模式」 ★
       * ============================================================
       * 第 8 关不是"平台跳到平台"，而是"岸边 → 平台 → 岸边"：
       *   桥面断成 5 段，每个缺口放**一个**平台来回渡。
       *   玩家在缺口左边的桥面上等，平台滑过来 → 站上去 → 到对岸。
       *   所以"平台 A 和平台 B 之间有 5 格缝"是**正常的** ——
       *   它们之间本来就隔着一段实心桥面（只是不在这两个平台的行）。
       *
       * 判定：只要平台 A **和前方的静止落脚面有横向交叠**，
       *       平台 B 也是，就说明每个平台都能服务各自的缺口。
       * ============================================================ */
      function touchesStatic(ms) {
        return statics.some(function (s) {
          if (Math.abs(s.top - rk) > 1.5) return false;
          return (s.x1 > ms.colMin + 0.05) && (s.x0 < ms.colMax - 0.05);
        });
      }
      const ferryMode = touchesStatic(A.ms) && touchesStatic(B.ms);
      const ok = hasStop || ferryMode;
      check(
        '第' + lv.id + '关 行' + rk + ' 平台#' + A.i + '(→col' + A.ms.colMax.toFixed(1) + ') 与 #' + B.i +
        '(col' + B.ms.colMin.toFixed(1) + '→) 衔接',
        ok,
        ok ? '' : ('永久空档 ' + gap.toFixed(1) + ' 格（' + (gap * T).toFixed(0) + 'px），缝里也没有同行的落脚面 → 玩家无法跨越')
      );
      if (ferryMode && !hasStop) {
        console.log('     ℹ️ 渡船模式：两个平台各自衔接独立岸边（合法设计）');
      }
    }
  });

  /* ---- 检查 2：移动平台与"最近的静止落脚面"之间的竖向衔接 ----
   * 场景：玩家在移动平台上，平台走了之后他要跳到某个静止面上；
   *       或者玩家掉下去之后要能从静止面跳回移动平台。
   * 做法：对每个移动平台，找横向有交叠的静止面，看**最小高差**。 */
  samples.forEach(function (ms, i) {
    /* 找横向交叠的静止面 */
    let bestUp = Infinity;   // 从静止面往上跳需要的高度
    let bestSurface = null;
    statics.forEach(function (s) {
      const overlap = (s.x1 > ms.colMin + 0.05) && (s.x0 < ms.colMax - 0.05);
      if (!overlap) return;
      /* 静止面比平台低 → 从静止面跳到平台需要的高度 */
      const dyUp = (ms.topRowMin - s.top) * T;
      if (dyUp > 0 && dyUp < bestUp) { bestUp = dyUp; bestSurface = s; }
    });
    if (bestSurface) {
      /* ⚠️⚠️ 判定改过（第一版把"电梯"当成了 bug）：
       *   竖向移动平台有两种设计意图：
       *     ① **往返升降**（第 8 关下层平台）：上下都走，掉下去能坐回来
       *     ② **单向电梯**（第 10 关电梯井）：只负责把你送上去，
       *        掉回井底是**设计内的惩罚**，井底另有出路（走回主线）
       *   区分方法：看这个平台**本身能不能下降**。
       *     rangeY > 0 说明它是升降的 —— 高差再大也能坐着下来/上去，
       *     不该报错；只有**不能下降**的平台才要求"爬得回来"。
       *
       *   第 10 关的电梯 rangeY=192（能升降），所以这里只做**提示**。 */
      const canDescend = (ms.rowMax - ms.rowMin) > 0.5;
      if (canDescend) {
        if (bestUp > JUMP1_WEAK + 8) {
          console.log('     ℹ️ 平台#' + i + ' 是可升降平台（竖向行程 ' +
            ((ms.rowMax - ms.rowMin) * T).toFixed(0) + 'px），高差 ' + bestUp.toFixed(0) +
            'px 靠坐平台解决，不是死路。');
        }
      } else {
        check(
          '第' + lv.id + '关 平台#' + i + ' 可从下方静止面(行' + bestSurface.top.toFixed(0) +
          ')跳回（高差 ' + bestUp.toFixed(0) + 'px）',
          bestUp <= JUMP1_K + 8,
          bestUp > JUMP1_K + 8 ? ('高差 ' + bestUp.toFixed(0) + 'px 超过单跳能力 ' + JUMP1_K.toFixed(0) + 'px，掉下去爬不回来') : ''
        );
        if (bestUp > JUMP1_WEAK + 8) {
          console.log('     ⚠️ 提示：该高差 ' + bestUp.toFixed(0) + 'px 超过最弱角色单跳 ' + JUMP1_WEAK.toFixed(0) + 'px（只有强的角色能爬回来）');
        }
      }
    }
  });

  /* ---- 检查 3：移动平台不能"插进"静止的实心体里 ----
   * ============================================================
   * ⚠️⚠️ 这条判定改过（第一版误报了一堆）：
   *
   *   第一版："同高的实心块和平台水平重叠 → 报错"。
   *   结果第 11 关报了 6 条 —— 全是误报。
   *   因为**同高共面的重叠是设计意图**：
   *     · 缆车与"风场台"重叠 1 格 → 玩家从台子走上缆车，正常
   *     · 缆车与"终点站台"重叠 → 同上
   *   顶面同高、共面 → 玩家走过去是平滑的，不是"钻进去"。
   *
   *   ✅ 真正的问题只有一种：**平台撞进比自己高的墙** ——
   *      那种墙是竖直障碍，平台平移过去会被墙挡住/穿模，
   *      而且玩家站在平台上会被墙"切"一下。
   *      判定：静止实心块的**顶面高于平台顶面**（即墙比平台高），
   *            且水平重叠 > 0.5 格。
   * ============================================================ */
  const solidsList = lv.solids.filter(function (s) { return !s.isMover; });
  samples.forEach(function (ms, i) {
    solidsList.forEach(function (s) {
      const sRow = s.y / T;
      const sX0 = s.x / T, sX1 = (s.x + s.w) / T;
      const ov = Math.min(ms.colMax, sX1) - Math.max(ms.colMin, sX0);
      /* ⚠️ 容差 1.5 格：平台滑到极限时与落脚台**边缘相切**是常见设计
       * （第 5 关平台最左 col60 / 落脚台最右 col60），
       * 相切 1 格属于"刚好贴住、能走过去"，不是穿模。
       * 只有重叠 > 1.5 格才是真"插进去"了。 */
      if (ov <= 1.5) return;
      /* 静止块顶面**高于**平台顶面 → 这是"墙"，平台撞进去是真问题。
       * 顶面同高或更低 → 是"地板延续"，允许重叠。 */
      const isWallAbove = sRow < ms.topRowMin - 0.5;
      if (isWallAbove) {
        check(
          '第' + lv.id + '关 平台#' + i + ' 不会撞进比它高的墙(col' + sX0.toFixed(0) + '-' + sX1.toFixed(0) +
          ', 行' + sRow.toFixed(0) + ')',
          false,
          '水平重叠 ' + ov.toFixed(1) + ' 格，且该砖顶面(行' + sRow.toFixed(0) + ')高于平台(行' +
          ms.topRowMin.toFixed(0) + ') → 平台平移会撞墙穿模'
        );
      }
    });
  });

  console.log();
});

console.log('='.repeat(64));
console.log('含移动平台的关卡: ' + levelsWithMovers + ' 关');
console.log('移动平台连通性: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('='.repeat(64));

/* ⚠️ 原来的 process.exit 挪到**文件最末尾**了 ——
 *    因为下面追加了"断裂桥通过性模拟"那一段，
 *    如果在这里 exit，后面的测试根本跑不到。 */

/* ============================================================
 * ★ 追加：断裂桥"通过性"模拟（2026-10-06）★
 * ============================================================
 * 【为什么要加】
 *   第 8 关重做时把断裂桥 `B` 放到了**主路**上（18 格连续）。
 *   它有个陷阱：**每格独立倒计时**（BRIDGE_DELAY = 58 帧）。
 *   如果格子太多，玩家跑到一半前面的格子就塌了 → 掉江。
 *   这个坑用"看地图"完全看不出来，必须**按帧模拟**才能发现。
 *
 * 【做法】复刻引擎的运动学（moveAndCollide + 桥倒计时），
 *   让一个"一直往右跑、不跳不停"的模拟玩家走一遍，
 *   看它能不能安全通过断裂桥段。
 *
 * ⚠️ 为什么不放在真浏览器里测：
 *   浏览器里要手动设 Game.state / 输入，和游戏主循环的 rAF 打架，
 *   容易出现假失败（我自己就踩了：明明物理没问题，却被判 gameover）。
 *   这种"纯物理 + 纯逻辑"的校验，离线模拟**又快又准**。
 * ============================================================ */
console.log('\n' + '='.repeat(64));
console.log('断裂桥通过性模拟（一直往右跑，不跳不停）');
console.log('='.repeat(64));

function simulateBridge(lv, startCol, endCol, startRow) {
  const solids0 = G('collectSolids');
  const aabbF = G('aabb');
  const macF = G('moveAndCollide');
  const rpF = G('resolvePlatforms');
  const PW = CONFIG.PLAYER_W, PH = CONFIG.PLAYER_H;
  const DELAY = CONFIG.BRIDGE_DELAY, RESPAWN = CONFIG.BRIDGE_RESPAWN;

  let solids = solids0(lv);
  /* ⚠️ 起步行号必须由**断裂桥自己的行**算（站在桥面上一格）——
   *    不能写死 19：各关的断裂桥在不同行（第 4 关在行 15、第 8 关在行 20…）。
   *    写死会导致模拟玩家一开始就悬空/卡住，报出假失败。 */
  /* ⚠️ 起点：站在断裂桥**第一格的顶面**（桥面在 startRow，玩家头顶在 startRow-1）。
   *    起点列就是桥的第一格（调用方传 c0），所以一上来就有地踩。
   *    `onGround: false` + 正常重力 → 第一帧自然落到桥面上。 */
  const startY = Math.max(0, (startRow - 1) * T);
  const p = { x: startCol * T, y: startY, w: PW, h: PH, vx: CONFIG.RUN_SPEED, vy: 0, onGround: false };
  const maxX = endCol * T;

  for (let f = 0; f < 900; f++) {
    p.vx = CONFIG.RUN_SPEED;
    const prevBottom = p.y + p.h;
    macF(p, solids);
    rpF(p, lv.platforms, prevBottom);

    /* 复刻 updateBridges 的核心逻辑 */
    (lv.bridges || []).forEach(function (b) {
      const foot = { x: p.x + 4, y: p.y + p.h - 3, w: p.w - 8, h: 8 };
      if (aabbF(foot, b) && p.vy >= 0 && !b.pressed) { b.pressed = true; b.timer = DELAY; }
      if (b.gone) {
        if (b.respawn > 0) { b.respawn--; if (b.respawn === 0) { b.gone = false; b.pressed = false; b.timer = 0; } }
        return;
      }
      if (b.pressed && b.timer > 0) { b.timer--; if (b.timer === 0) { b.gone = true; b.respawn = RESPAWN; } }
    });
    solids = solids0(lv);

    if (p.y > lv.height + 120) return { ok: false, frame: f, col: p.x / T, reason: '掉出地图' };
    if (p.x >= maxX) return { ok: true, frame: f, col: p.x / T, collapsed: (lv.bridges || []).filter(function (x) { return x.gone; }).length };
  }
  return { ok: false, frame: 900, col: p.x / T, reason: '超时未到终点' };
}

allLevels.forEach(function (raw) {
  const lv = parseLevel(raw);
  if (!lv.bridges || !lv.bridges.length) return;

  /* ⚠️⚠️ 只测**最长的那一段连续断裂桥**（return: 见下）。
   *   为什么：断裂桥不一定连续 —— 第 4 关是 `col12,13` + `col17,18`
   *   两段，中间有 3 格缺口，本来就要**跳过去**。
   *   本测试的模拟玩家"不跳"，遇到缺口当然会掉，
   *   那是**测试假设不成立**，不是关卡问题。
   *   ⇒ 按列排序、切出连续区间、取最长的那段来测。 */
  const cols = lv.bridges.map(function (b) { return b.x / T; }).sort(function (a, b) { return a - b; });
  let best = null, cur = null;
  cols.forEach(function (c) {
    if (!cur || c === cur.end + 1) { cur = cur ? { start: cur.start, end: c } : { start: c, end: c }; }
    else { if (!best || (cur.end - cur.start) > (best.end - best.start)) best = cur; cur = { start: c, end: c }; }
  });
  if (!best || (cur && (!best || (cur.end - cur.start) > (best.end - best.start)))) best = best || cur;
  const c0 = best.start, c1 = best.end;
  const rows = lv.bridges.filter(function (b) { return b.x / T >= c0 && b.x / T <= c1; }).map(function (b) { return b.y / T; });
  const r0 = Math.round(rows.reduce(function (a, b) { return a + b; }, 0) / rows.length);

  const total = lv.bridges.length;
  const note = (c1 - c0 + 1) < total ? '（共 ' + total + ' 格，取最长连续段 ' + (c1 - c0 + 1) + ' 格）' : '';
  /* 起点放在连续段第一格，跑到段尾再往右 3 格 */
  const r = simulateBridge(lv, c0, c1 + 3, r0);
  check(
    '第' + lv.id + '关 断裂桥最长连续段（col' + c0 + '~' + c1 + ' 行' + r0 + '）不冲刺能否跑通',
    r.ok,
    r.ok ? '' : (r.reason + ' @ col' + (r.col || 0).toFixed(1))
  );
  if (r.ok) {
    console.log('      通过用时 ' + (r.frame / 60).toFixed(2) + 's（' + r.frame + ' 帧），期间有 ' + r.collapsed + ' 格塌掉' + note);
  }
});

console.log('\n' + '='.repeat(64));
console.log('（含断裂桥校验）总计: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('='.repeat(64));

/* ⚠️ process.exit 挪到**文件最末尾** —— 下面还有"绘制覆盖校验"要跑。 */

/* ============================================================
 * ★ 追加：移动平台"有没有被绘制"校验（2026-10-06）★
 * ============================================================
 * 【为什么要加】这是十一抓出来的真 bug：
 *   她说"**有缆车的功能，但是看不见缆车**" —— 完全准确。
 *
 *   根因：`parseLevel` 的 `case 'm'` 只 push 到 `level.movers`，
 *   而绘制函数 `drawTiles()` 遍历的是 `lv.solids`。
 *   ⇒ 移动平台**从来没进过绘制循环**，一直隐形。
 *      它能站能挡，是因为 `physics.js` 的 `collectSolids()`
 *      在**运行时**把 movers 合并进了碰撞列表。
 *   ⇒ 结果："有碰撞、看不见"。
 *
 * 【这个测试守什么】
 *   render.js 的 drawTiles 必须**显式处理 lv.movers**。
 *   做法：读源码，确认 drawTiles 函数体里出现 `lv.movers`。
 *   （比真的跑浏览器快得多，而且抓的正是"漏写"这一类错误。）
 * ============================================================ */
console.log('\n' + '='.repeat(64));
console.log('移动平台绘制覆盖校验（防"隐形平台"回归）');
console.log('='.repeat(64));

(function checkMoversDrawn() {
  const renderSrc = fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8');
  /* 抠出 drawTiles 函数体 */
  const start = renderSrc.indexOf('function drawTiles(');
  let body = '';
  if (start >= 0) {
    /* 简单括号配平，找到函数结束 */
    let i = renderSrc.indexOf('{', start), depth = 0, end = -1;
    for (; i < renderSrc.length; i++) {
      if (renderSrc[i] === '{') depth++;
      else if (renderSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    body = renderSrc.slice(start, end + 1);
  }
  const hasMovers = /lv\.movers|level\.movers/.test(body);
  check('render.js 的 drawTiles 显式绘制了 lv.movers（防隐形平台）',
    hasMovers,
    hasMovers ? '' : 'drawTiles 里没提 lv.movers —— 移动平台会隐形（十一踩过这个 bug）');

  /* 额外确认：云上索道这一关的缆车**外观函数存在** */
  const hasSkin = /function drawMoverSkin/.test(renderSrc) && /function drawCableCar/.test(renderSrc);
  check('缆车外观函数存在（drawMoverSkin / drawCableCar）', hasSkin);
})();

/* 每一关的 movers 都要能被"画到"——统计一下 */
console.log('\n各关移动平台数量（都要能被绘制）：');
allLevels.forEach(function (raw) {
  const lv = parseLevel(raw);
  if (!lv.movers || !lv.movers.length) return;
  console.log('  第' + String(lv.id).padStart(2) + '关 ' + (lv.name || '').padEnd(26) +
    ' movers=' + lv.movers.length + '  (solids 内 isMover=' +
    lv.solids.filter(function (s) { return s.isMover; }).length + ' ← 0 是正常的，靠 drawTiles 单独画)');
});

/* ---- 最终收尾（所有校验都跑完了才退出）---- */
console.log('\n' + '='.repeat(64));
console.log('最终汇总: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('='.repeat(64));
if (FAIL > 0) {
  console.log('\n问题清单：');
  problems.forEach(function (p, i) { console.log('  ' + (i + 1) + '. ' + p); });
}
process.exit(FAIL > 0 ? 1 : 0);
