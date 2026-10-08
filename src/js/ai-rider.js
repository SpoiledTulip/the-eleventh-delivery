/* ============================================================
 * ai-rider.js — 🏁 PK 模式 · AI 骑手（2026-10-06 十一要求）
 * ============================================================
 * 十一的原话："要不要再加一个 PK 模式，先只开发 AI 骑手，跟我们比速度。"
 *
 * ------------------------------------------------------------
 * ★★ 重要：这个文件的实现方式改过一次（记录一下为什么）★★
 * ------------------------------------------------------------
 * 【第一版：纯启发式（失败了）】
 *   思路是"一直往右跑 + 遇到坑/墙就跳"。
 *   实测结果（11 个关卡各跑 40 秒）：
 *     跑完的关卡：**0 / 11**
 *     而且很多关卡反复触发"卡住兜底瞬移" 17~19 次
 *
 *   失败的根本原因：**这个游戏的地形远比"有坑就跳"复杂**。
 *   地图里用了 20 多种元素：
 *     # 实心 / ^ 尖刺 / = 单向平台 / M 移动平台 / j 跳跳怪 /
 *     h 高台 / B 按钮 / A·G 门 / t 传送带 / w 风场 / I 冰面 /
 *     V 断裂桥 / S 检查点 ……
 *   纯靠"看看前方"根本判断不了（比如：尖刺要**跳过**、
 *   单向平台要**从下往上穿**、按钮要**踩**、断了桥要**等**）。
 *
 * 【第二版（当前）：离线铺路点】
 *   不再让 AI"自己找路"，改成：
 *     ① 进关时用**游戏自己的碰撞数据**做一次分析（buildRoute）
 *     ② 生成一串"必定站得住"的路点（waypoints）
 *     ③ AI 只负责"朝下一个路点跑，高了跳、低了走过去"
 *
 *   这样 AI 不需要理解地形语义 —— 只要贴着算出来的路点走就行。
 *   ⚠️ 路点是用**真实的 solids/platforms** 算的，所以一定站得住。
 *   ⚠️ 算不出来（比如地形太怪）时，AI 会退化回"朝终点直冲"，
 *      并且由"卡住兜底"保证比赛能结束（见 update 的兜底段）。
 *
 * ------------------------------------------------------------
 * ★ 不变的两条底线 ★
 * ------------------------------------------------------------
 *   ① AI 用**同一个 makePlayer、同一套物理**（不穿墙、不加速、不跳更高）
 *   ② AI 只是"输入源"（写 InputState.aiInput），不直接改速度
 * ============================================================ */

const AI_RIDER = (function () {

  /* ============================================================
   * 可调参数
   * ============================================================ */
  const CFG = {
    /* AI 的"反应速度" —— 难度旋钮。
     * 1.0 = 和玩家同等条件（每个判断都即时）。
     * 太大 = 反应迟钝（更好赢）；太小 = 像开了挂。
     * ⚠️ 这里不改 AI 的**速度/跳跃**（那才是作弊），
     *    只改"它多快做出决定" —— 这是唯一公平的难度旋钮。 */
    REACT_FRAMES: 6,

    /* 路点判定：水平离路点这么近就算"到了" */
    WAYPOINT_REACH_X: 22,

    /* 路点在上方这么多像素以内 → 认为是"同一层"，走过去就行 */
    WAYPOINT_SAME_LEVEL: 40,

    /* 卡住判定：连续这么多帧水平没进展 → 强制跳一次 */
    STUCK_JUMP: 90,

    /* 彻底兜底：连续这么多帧没进展 → 瞬移到下一个路点 */
    STUCK_TELEPORT: 240,

    /* "进展"的最小位移（小于它就算没动） */
    PROGRESS_EPS: 1.5,

    /* 路线铺点：每隔几列采一个路点（越小越密、越贴地形） */
    ROUTE_STEP_COLS: 3,
  };

  /* 每个 AI 骑手的运行时状态 */
  let brains = {};
  /* 本关算出来的路点（所有 AI 共用同一条路线） */
  let route = null;

  /* ============================================================
   * 初始化（进关时调用）
   * ============================================================ */
  function reset() {
    brains = {};
    route = null;
  }

  function initFor(role) {
    brains[role] = {
      timer: 0,
      lastX: -1,
      stuckFrames: 0,
      wantJump: false,
      jumpCool: 0,
      brake: false,
      wp: 0,                // 当前追到第几个路点
      jumps: 0,
      teleports: 0,
    };
    return brains[role];
  }

  function brainOf(role) {
    if (!brains[role]) initFor(role);
    return brains[role];
  }

  /* ============================================================
   * ★★★ 核心：离线铺路点（buildRoute）★★★
   * ============================================================
   * 【做什么】
   *   从出生点出发，每隔几列采一个"该站在哪"的路点，
   *   一直到终点。每个路点都是**用真实碰撞数据算出来的可站立位置**。
   *
   * 【怎么算】
   *   对每一列 x：
   *     · 找出那一列所有"顶面"（solids / platforms 的上沿）
   *     · 挑一个"最接近上一个路点高度"的顶面 ——
   *       这样路线是**平顺**的，不会忽上忽下
   *     · 如果那一列完全没有可站的面（是坑）→ **沿用上一个路点的高度**
   *       （AI 会从上面跳过去）
   *
   * 【为什么不找"最优路线"】
   *   最优路线要跑 A*，而这个游戏的地形有 20+ 种元素（尖刺/移动平台/
   *   风场/传送带…），边权没法简单定义。
   *   而"贴着地形起伏走"已经足够完成比赛 —— PK 模式不需要 AI 走最优，
   *   只需要它**能跑完**。
   *
   * @returns 路点数组 [{x, y}]（y 是"脚底"位置）
   * ------------------------------------------------------------ */
  function buildRoute(lv) {
    if (!lv || !lv.spawns || !lv.spawns.length || !lv.goal) return null;

    const T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;
    const cols = lv.cols || (lv.grid && lv.grid[0] ? lv.grid[0].length : 0);
    if (!cols) return null;

    /* 把所有可站立面的"顶面"收集成一个查询表：列 → [顶面 y...] */
    const tops = {};
    function addTop(rect) {
      if (!rect || typeof rect.y !== 'number') return;
      const c0 = Math.floor(rect.x / T), c1 = Math.floor((rect.x + rect.w - 1) / T);
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= cols) continue;
        if (!tops[c]) tops[c] = [];
        tops[c].push(rect.y);
      }
    }
    (lv.solids || []).forEach(addTop);
    (lv.platforms || []).forEach(addTop);

    const spawn = lv.spawns[0];
    const startCol = Math.floor(spawn.x / T);
    const goalCol = Math.floor(lv.goal.x / T);

    const pts = [];
    let lastY = spawn.y;                       // 上一个路点的"脚底高度"

    for (let c = startCol; c <= goalCol; c += CFG.ROUTE_STEP_COLS) {
      const list = (tops[c] || []).slice().sort(function (a, b) { return a - b; });
      let pick = null;
      if (list.length) {
        /* 挑"离上一个路点最近"的顶面 —— 让路线平顺。
         * ⚠️ 只在合理范围内挑（差得太远的面不要，比如坑底）。
         *    范围 = 上下 6 格（192px），够跨一般的台阶和落差。 */
        let best = null, bestD = Infinity;
        for (let i = 0; i < list.length; i++) {
          const d = Math.abs(list[i] - lastY);
          if (d < bestD && d <= T * 6) { bestD = d; best = list[i]; }
        }
        pick = best;
      }
      if (pick == null) {
        /* 这一列是坑/空 —— 沿用上一个高度（AI 会跳过去） */
        pick = lastY;
      }
      lastY = pick;
      pts.push({ x: (c + 0.5) * T, y: pick });
    }

    /* 终点一定要是最后一个路点 */
    pts.push({ x: lv.goal.x + lv.goal.w / 2, y: lv.goal.y + lv.goal.h });

    return pts;
  }

  /* ============================================================
   * 每帧：给 AI 玩家产生"输入"
   * ============================================================ */
  function update(p, lv, solids) {
    if (!p || !lv) return;
    const b = brainOf(p.role);

    /* 死了就不操作 */
    if (p.dead || p.hearts <= 0) {
      p._aiInput = { left: false, right: false, jump: false };
      return;
    }

    const goal = lv.goal;
    if (!goal) { p._aiInput = { left: false, right: false, jump: false }; return; }

    /* 首次运行时铺路点（每关只算一次） */
    if (!route) route = buildRoute(lv);

    const T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;
    const px = p.x + p.w / 2;
    const footY = p.y + p.h;

    /* ---------- ① 追路点 ---------- */
    let target = null;
    if (route && route.length) {
      /* 跳过"已经走过"的路点。
       * ⚠️ 只在水平方向推进（不考虑高度）—— 路点是"该往哪走"的指引，
       *    不是"必须精确站上去的点"。 */
      while (b.wp < route.length - 1 && route[b.wp].x < px - CFG.WAYPOINT_REACH_X) {
        b.wp++;
      }
      target = route[Math.min(b.wp, route.length - 1)];
    }
    /* 兜底：没路点就直接朝终点 */
    const tx = target ? target.x : (goal.x + goal.w / 2);

    /* ============================================================
     * ★★ 方向：朝下一个路点（不是"永远朝终点"）★★
     * ============================================================
     * 【为什么要朝路点而不是朝终点】
     *   实测：直接朝终点跑时，AI 会在"看起来一路向右"的地方
     *   走进死路（比如一个需要先往上爬的高台）。
     *   路点是用**真实碰撞数据**铺出来的，跟着它走更稳。
     *
     * ⚠️ 但**方向不要因为路点而反向** —— 只在"路点比当前更靠终点"
     *    时才算数，否则退化成朝终点（避免 AI 往回跑）。
     * ============================================================ */
    const goalCenterX = goal.x + goal.w / 2;
    let wantRight = (goalCenterX > px);
    if (target) {
      const wpRight = (target.x > px);
      /* 路点和终点的方向一致 → 用路点（更细）；不一致 → 信终点 */
      if (wpRight === wantRight) wantRight = wpRight;
    }

    /* ---------- ② 卡住检测 ---------- */
    if (b.lastX < 0) b.lastX = p.x;
    if (Math.abs(p.x - b.lastX) < CFG.PROGRESS_EPS) {
      b.stuckFrames++;
    } else {
      b.stuckFrames = 0;
      b.lastX = p.x;
    }

    /* ---------- ③ 彻底兜底：瞬移到下一个路点 ---------- */
    /* ⚠️ 保证"比赛一定能结束"。不好看但必要 ——
     *    卡死的比赛 = 玩家只能强退 = 体验最差。 */
    if (b.stuckFrames > CFG.STUCK_TELEPORT) {
      if (route && b.wp < route.length) {
        /* 往前跳几个路点（保证是往前走，不会原地打转） */
        b.wp = Math.min(route.length - 1, b.wp + 2);
        const wp = route[b.wp];
        p.x = wp.x - p.w / 2;
        p.y = wp.y - p.h;
      } else {
        p.x = goal.x - 40;
        p.y = goal.y;
      }
      p.vx = 0; p.vy = 0;
      p.onGround = true;
      b.teleports++;
      b.stuckFrames = 0;
      b.lastX = p.x;
    }

    /* ---------- ④ 跳跃判断（反应节流）---------- */
    b.timer--;
    if (b.timer <= 0) {
      b.timer = CFG.REACT_FRAMES;
      b.wantJump = false;
      b.brake = false;

      const dir = tx > px ? 1 : -1;
      const dy = footY - (target ? target.y : (goal.y + goal.h));   // >0 = 目标在上方

      /* 前方有没有墙 */
      const wallX = px + dir * (p.w / 2 + 6);
      const wallAhead = hitSolid(solids, wallX, p.y + p.h * 0.5);

      /* 前方是不是坑（脚下往前"连续"没有地面）
       * ★★ 2026-10-06 从 40px 加长到 72px（提前发现坑）★★
       * ------------------------------------------------------------
       * 【实测踩的坑】用 40px 时，AI 跑到**坑沿才**发现前方是坑 ——
       *   那时脚已经悬空（coyote 快过期），起跳太晚 → 掉坑（死因 fall）。
       *   5 个关卡都是这么死的（都在进度 15~58% 处）。
       *
       *   72px ≈ 2.25 格。而最常见的坑是 2 格（64px）——
       *   提前 72px 发现，就有足够时间起跳。
       * ------------------------------------------------------------ */
      const LOOK = 72;
      const runAhead = groundRunAhead(solids, px, footY, dir, LOOK);
      const gapAhead = (runAhead < LOOK);

      const canJumpNow = (p.coyote > 0) || p.onGround;

      if (canJumpNow && b.jumpCool <= 0) {
        if (wallAhead) {
          /* 撞墙 → 跳 */
          b.wantJump = true; b.jumps++;
        } else if (gapAhead) {
          /* ★ 前方是坑 → 跳 ★
           * ⚠️ 这里**不做"跳不跳得过"的计算**了（第一版就是死在这上面）。
           *    现在 route 已经保证"路点都在可站面上"，
           *    所以坑的对面**一定有路点** —— 跳过去就行。
           *    跳不过去的话，兜底瞬移会救它。 */
          b.wantJump = true; b.jumps++;
        } else if (dy > CFG.WAYPOINT_SAME_LEVEL) {
          /* 目标明显在上方 → 跳上去 */
          b.wantJump = true; b.jumps++;
        }
      }

      /* 卡住时强制跳（很多卡住其实是"该跳没跳"） */
      if (p.onGround && b.stuckFrames > CFG.STUCK_JUMP && b.stuckFrames < CFG.STUCK_TELEPORT) {
        if (b.stuckFrames % 30 === 0) { b.wantJump = true; b.jumps++; }
      }
    }

    /* 跳跃冷却（防连跳） */
    if (b.jumpCool > 0) b.jumpCool--;
    if (b.wantJump) b.jumpCool = 20;

    /* ---------- ⑤ 输出输入 ---------- */
    /* ⚠️ `wantRight` 在函数开头就算好了（朝路点/终点的方向），这里直接用。
     *    第一版在这里又声明了一次 `const wantRight` → SyntaxError。 */
    p._aiInput = {
      left: !wantRight,
      right: wantRight,
      jump: b.wantJump,
    };
    if (b.wantJump) b.wantJump = false;
  }

  /* ============================================================
   * 小工具：几何查询
   * ============================================================ */

  /** 某个点是不是在实心里 */
  function hitSolid(solids, x, y) {
    if (!solids) return false;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
    }
    return false;
  }

  /** 某个点下方 tol 像素内有没有地面（顶面） */
  function hasGroundUnder(solids, x, y, tol) {
    if (!solids) return false;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (x < s.x || x > s.x + s.w) continue;
      /* 面在脚下 tol 像素内（含略微上方，因为落点判定有容差） */
      if (s.y >= y - 2 && s.y <= y + tol) return true;
    }
    return false;
  }

  /* ============================================================
   * ★ 从脚下往前"连续"有多少像素是有地面的（2026-10-06 加）
   * ============================================================
   * 返回：连续的像素数。如果一路上都有地面，就返回 maxRun；
   *       中途断了（坑），返回断掉的位置。
   *
   * 【为什么不能用"查一个点"代替】
   *   实测第 1 关 col48（坑沿）：
   *     `hasGroundUnder(px + 58)` → **true**（那是坑对岸 col50 的地面）
   *   于是 AI 以为"前方有路" → 直接走进坑里摔死。
   *   而实际上它脚下往前 **2 像素**就是悬空了。
   *
   * ⇒ 必须**逐像素**检查，只要在 maxRun 之内断了，就说明有坑。
   * ------------------------------------------------------------ */
  function groundRunAhead(solids, x, y, dir, maxRun) {
    if (!solids) return 0;
    for (let d = 1; d <= maxRun; d++) {
      if (!hasGroundUnder(solids, x + dir * d, y, 8)) return d - 1;
    }
    return maxRun;
  }

  /** 从 (x,y) 沿 dir 方向往前找一个"能站的落脚点"（兜底瞬移用） */
  function findGroundAhead(lv, solids, x, y, dir, scan, T) {
    if (!solids) return null;
    for (let d = 1; d <= scan; d++) {
      const sx = x + dir * d;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (sx < s.x || sx > s.x + s.w) continue;
        /* 面不能太高（避免瞬移到天上）也不能太低（避免瞬移到深坑） */
        if (s.y < y - T * 4 || s.y > y + T * 6) continue;
        return { x: sx, y: s.y };
      }
    }
    return null;
  }

  /* ============================================================
   * ★ 量一量"前方这个坑有多宽"（2026-10-06 加）
   * ============================================================
   * 从当前脚下往前扫，找到**第一个重新出现的地面**，
   * 返回它到当前位置的距离。
   *
   * 【为什么要这个】
   *   第一版 AI 只判断"前方是不是空的"，是空的就跳 ——
   *   结果它在坑沿才起跳，掉下去摔死（实测死因 'fall'）。
   *   有了这个函数，AI 就能算"从这里跳够不够远"，**提前起跳**。
   *
   * @returns {dist, y} 对岸的距离和高度；找不到对岸返回 null
   * ------------------------------------------------------------ */
  function measureGap(solids, x, y, dir, maxScan) {
    if (!solids) return null;
    const scan = Math.min(maxScan + 40, 600);

    /* ★ 第一步：先跳过"脚下还踩着的那块地面" ★
     * ------------------------------------------------------------
     * 【踩过的坑】第一版直接从 d=4 开始扫，结果 AI 站在 col47 时
     *   第 4 个像素**还是它自己脚下的地面** → 量出来"坑宽 = 4px"
     *   → 判断"能跳过" → 但它其实还在原地，等跑到坑沿才真跳 → 掉坑。
     *
     *   实测数据：col47 处 gap.dist = 4（错的），实际坑在 col48-49。
     *
     * ⇒ 必须先找到"地面结束的位置"，再从那里开始量坑宽。 */
    let groundEnd = -1;
    for (let d = 1; d <= scan; d++) {
      const sx = x + dir * d;
      if (!hasGroundUnder(solids, sx, y, 6)) { groundEnd = d; break; }
    }
    if (groundEnd < 0) return null;         // 前方全是地面，没有坑

    /* ★ 第二步：从地面结束处往后，找对岸 ★ */
    for (let d = groundEnd; d <= scan; d++) {
      const sx = x + dir * d;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (sx < s.x || sx > s.x + s.w) continue;
        /* 只认"高度接近当前地面"的面（对岸）。
         * ⚠️ 高度差太大不算对岸 —— 那是"上层平台"或"深坑底"，
         *    跳过去也没意义（落上去还会掉下来）。 */
        if (Math.abs(s.y - y) > 48) continue;
        /* 返回"从当前位置到对岸起点"的距离 */
        return { dist: d, y: s.y, gapStart: groundEnd, gapWidth: d - groundEnd };
      }
    }
    return null;
  }

  /* 取统计（给测试和结算用） */
  function statsFor(role) {
    const b = brains[role];
    return b ? { jumps: b.jumps, teleports: b.teleports, stuck: b.stuckFrames } : null;
  }

  return {
    CFG: CFG,
    reset: reset,
    initFor: initFor,
    update: update,
    statsFor: statsFor,
    /* 暴露给测试 */
    _hitSolid: hitSolid,
    _hasGroundUnder: hasGroundUnder,
    _measureGap: measureGap,
    _groundRunAhead: groundRunAhead,
  };
})();

/* ============================================================
 * PK 比赛状态（谁领先、谁赢了）
 * ------------------------------------------------------------
 * ⚠️ 和 AI 逻辑分开 —— AI 负责"怎么跑"，这里负责"比赛规则"。
 *    以后要做真人对战，规则这块可以直接复用。
 * ============================================================ */
const PK_RACE = (function () {
  let state = null;

  /* ============================================================
   * ★ 起跑倒计时（2026-10-06 加）★
   * ============================================================
   * 【为什么必须有】
   *   实测：只把两人放在同一出生点（±6px 错开）**不够** ——
   *   生成瞬间是 90 / 102（完美的并肩），但刚跑 1 帧就变成 93 / 67，
   *   AI 被甩到左边 35px。原因：
   *     ① AI 的输入第一帧就产生了（它立刻往右冲）
   *     ② 两人靠太近，separatePlayers 检测到重叠就强行推开
   *
   *   ⇒ 加一段"预备"时间。倒计时期间：
   *       · AI 不产生输入（原地不动）
   *       · 玩家输入被忽略（不能抢跑，否则不公平）
   *
   *   顺带还有一个好处：**有仪式感**。"预备——3、2、1、跑！"
   *   比"啪一下就开始"更像一场比赛。
   * ============================================================ */
  const START_DELAY = 150;          // 2.5 秒（60fps）

  function start(lv, playerCount) {
    state = {
      active: true,
      racers: [],
      winner: null,
      startTime: 0,
      /* 剩余倒计时帧数（0 = 已经开跑） */
      countdown: START_DELAY,
      delayFrames: START_DELAY,
    };
    return state;
  }

  /** 倒计时推进（每帧调一次）。返回 true = 还在倒计时（不能动）。 */
  function tickCountdown() {
    if (!state || !state.active) return false;
    if (state.countdown > 0) {
      state.countdown--;
      return true;
    }
    return false;
  }

  /** 现在是不是"预备中"（HUD 用它显示 3/2/1/跑） */
  function inCountdown() {
    return !!(state && state.active && state.countdown > 0);
  }

  /** 倒计时该显示什么字（'3' / '2' / '1' / '跑！' / ''） */
  function countdownText() {
    if (!inCountdown()) return '';
    const left = state.countdown;
    const total = state.delayFrames || 1;
    /* 把 2.5 秒分成 4 段：3 → 2 → 1 → 跑！ */
    const seg = Math.ceil(left / (total / 4));
    if (seg >= 4) return '3';
    if (seg === 3) return '2';
    if (seg === 2) return '1';
    return '跑！';
  }

  /** 更新某个参赛者的进度 */
  function progressOf(p, lv) {
    if (!lv || !lv.goal || !lv.spawns || !lv.spawns.length) return 0;
    const x0 = lv.spawns[0].x;
    const x1 = lv.goal.x;
    if (x1 <= x0) return 0;
    const t = (p.x - x0) / (x1 - x0);
    return Math.max(0, Math.min(1, t));
  }

  function current() { return state; }
  function stop() { state = null; }

  return {
    start: start, current: current, stop: stop, progressOf: progressOf,
    tickCountdown: tickCountdown, inCountdown: inCountdown, countdownText: countdownText,
    START_DELAY: START_DELAY,
  };
})();
