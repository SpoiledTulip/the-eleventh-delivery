/* ============================================================
 * actions.js — Celeste 式动作系统（滑墙 / 墙跳 / 八方冲刺）
 * ============================================================
 * 设计原则：
 *   1. **完全复用现有引擎**：碰撞用 physics.js 的 moveAndCollide，
 *      输入用 InputState，绘制用 render.js 的粒子系统。
 *      本模块只负责"新动作的状态机与参数"，不改动原有玩法。
 *   2. **独立封装**：所有新逻辑集中在这里，通过 ACTIONS.* 对外暴露。
 *      game.js 只需在物理循环里调一次 ACTIONS.updatePlayer()。
 *   3. **参数集中**：全部手感数值在 physics.js 的 CELESTE 块里，
 *      改手感只改那一处。
 *
 * ------------------------------------------------------------
 * ⚠️ 单位说明（很重要，改参数前必读）
 * ------------------------------------------------------------
 * 本项目所有物理量都是 **「像素/帧」**（60fps 固定步长，见 game.js 锁帧）。
 * 而需求文档给的是 **「像素/秒」**。
 *
 * 换算公式（60fps）：
 *   速度：   px/帧 = px/s ÷ 60
 *   加速度： px/帧² = px/s² ÷ 60²  = px/s² ÷ 3600
 *
 * 但**不能直接换算填入** —— 实测按纯秒制换算后跳跃高度只有 60px(1.88格)，
 * 而现有 4 个关卡是按 101px(3.16格) 设计的，会全部跳不上去。
 * 所以这里采用 **「等比例映射」**：保持现有手感高度不变，
 * 把需求参数当作"设计意图"按比例缩放到本项目坐标系。
 * 详细换算见 physics.js 的 CELESTE 块注释。
 *
 * ------------------------------------------------------------
 * 动作清单与操作
 * ------------------------------------------------------------
 *   贴墙滑墙    ：空中贴住竖直墙面 → 自动缓慢下滑（无需按键）
 *   抓墙        ：贴墙时按住"朝向墙"的方向键 → 抓得更稳（消耗体力）
 *   墙跳        ：贴墙时按跳跃 → 向墙的外侧弹出去
 *   八方冲刺    ：空中按「冲刺键」+ 方向 → 朝8个方向冲刺，单次落地重置
 *
 * 冲刺键设计：电脑端使用 `F`，手机端使用屏幕冲刺按钮，
 *   因为方向键/跳跃键要留给移动和墙跳，再抢键会冲突。
 *   键位在 ACTIONS.DASH_KEYS 里，想换随便改。
 * ============================================================ */

/* ============================================================
 * 一、参数（从 CELESTE 读取，集中管理）
 * ============================================================ */
function ACT_P() { return (typeof CELESTE !== 'undefined') ? CELESTE : null; }

/* 冲刺键：电脑端默认 F。改成别的只需改这个数组。
 *
 * ★ 2026-10-06 补充：加上虚拟手柄的「冲刺」键 ★
 *   手机没有 F 键。电脑键和虚拟手柄键分开接入，
 *   触屏按「冲」等价于按住电脑端的冲刺动作。
 *
 * ⚠️⚠️ 这里踩了一个很隐蔽的坑，务必看明白再改 ⚠️⚠️
 *
 *   一开始我把它写成"模块加载时用 IIFE 把 VK 里的键 push 进来"：
 *       const DASH_KEYS = (function(){ ... VK.P1_DASH ... })();
 *   结果 **手机上按冲刺还是没反应**。
 *
 *   原因：**加载顺序**。index.html 里 actions.js 排在 game.js 之前
 *   （因为 game.js 要调 ACTIONS），而 VK 是定义在 game.js 里的常量。
 *   所以 IIFE 执行的那一刻 VK 还是 undefined，
 *   typeof 保护让代码"安全地"跳过了 —— 于是 DASH_KEYS 里永远只有 Shift。
 *   因为没报错，这个 bug 极难发现（保护性代码反而把问题藏住了）。
 *
 *   修法：**不缓存**，改成每次调用时现查。
 *   dashKeys() 是唯一入口，两处判定点都用它，不会再漏。
 * ============================================================ */
const DASH_KEYS_BASE = ['KeyF'];

/* 取当前生效的冲刺键（基础键 + 虚拟手柄键）。
 *
 * ⚠️ **每次调用都重新拼**，不要缓存成常量 ——
 *    见上面那段说明：VK 在 actions.js 加载完之后才存在。
 *    每帧几次数组拼接的开销可以忽略，正确性更重要。
 */
function dashKeys() {
  const keys = DASH_KEYS_BASE.slice();
  try {
    /* typeof 检查在这里是**对的**：
     * 它在"运行时"求值，那时 VK 早已定义好了。
     * （之前错就错在把它放在了"加载时"求值的 IIFE 里） */
    if (typeof VK !== 'undefined' && VK) {
      if (VK.P1_DASH) keys.push(VK.P1_DASH);
      if (VK.P2_DASH) keys.push(VK.P2_DASH);
    }
  } catch (e) { /* VK 不可用就只用 Shift，键盘照样能冲 */ }
  return keys;
}

/* 兼容旧引用点：DASH_KEYS 保留成一个"只含键盘键"的数组，
 * 但**判定一律走 dashKeys()**。
 * 之所以保留它：tests 和外部代码可能在读它，
 * 而且 ACTIONS.DASH_KEYS 是对外暴露的接口。 */
const DASH_KEYS = DASH_KEYS_BASE;

/* ============================================================
 * ★ 角色倍率（从 characters.js 的配置表读）★
 * ============================================================
 * 奶龙"冲刺能力更强"要真正体现在手感上，不能只是角色卡上写个数字。
 * 所以冲刺速度和抓墙体力都要乘角色的倍率。
 *
 * ⚠️ 为什么包成函数、每帧现读，而不是在 initPlayer 时算一次存起来：
 *    角色倍率理论上可以在中途变（比如以后做"临时增益"），
 *    每帧读一次的成本是几次属性访问，可以忽略。
 *    更重要的是**不会出现"存下来的值过期了"这种难查的 bug**。
 *
 * 取不到角色配置时返回 1（= 无加成）—— 那是可接受的降级：
 * 所有角色手感一样，但游戏照常能玩。
 * ============================================================ */
function actDashMul(p) {
  const v = p && p.dashMul;
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1;
}
function actStaminaMul(p) {
  const v = p && p.wallStaminaMul;
  return (typeof v === 'number' && isFinite(v) && v > 0) ? v : 1;
}
/* 该角色抓墙体力的**上限**（帧）。落地补满、恢复封顶都用它 */
function actStaminaMax(p, P) {
  return Math.round(P.grabStaminaFrames * actStaminaMul(p));
}

/* ============================================================
 * ★ 该角色"一次落地能用几发冲刺"（2026-10-07 加，朱迪的招牌）★
 * ============================================================
 * 【为什么需要它】
 *   冲刺发数原本是**全局常量** `CELESTE.dashMaxCount = 1` ——
 *   所有角色都只能冲一发。朱迪的设定是"能连冲两发"，
 *   所以要把这个值变成**按角色可调**的。
 *
 * 【和史迪奇的区别（别搞混）】
 *   · dashMul（史迪奇 1.35）  → 单发冲**多远**
 *   · actDashMax（朱迪 +1）   → 一次落地能冲**几发**
 *   两个维度互不干扰，可以叠加。
 *
 * ⚠️ 取不到角色配置时返回全局默认值（1）—— 那是可接受的降级：
 *    所有角色都一样，但游戏照常能玩。
 * ============================================================ */
function actDashMax(p) {
  const base = (ACT_P() ? ACT_P().dashMaxCount : 1);
  const bonus = (p && typeof p.dashBonus === 'number' && isFinite(p.dashBonus) && p.dashBonus > 0)
    ? Math.floor(p.dashBonus) : 0;
  return base + bonus;
}

/* 方向 → 单位向量（八方） */
const DIR8 = {
  up:        { x: 0,  y: -1 },
  down:      { x: 0,  y: 1  },
  left:      { x: -1, y: 0  },
  right:     { x: 1,  y: 0  },
  upleft:    { x: -0.7071, y: -0.7071 },
  upright:   { x: 0.7071,  y: -0.7071 },
  downleft:  { x: -0.7071, y: 0.7071  },
  downright: { x: 0.7071,  y: 0.7071  },
};

/* ============================================================
 * 二、状态初始化（挂在玩家对象上，不新建结构）
 * ============================================================
 * 所有字段以 `act` 开头（action 的缩写），避免和原有字段混淆。
 * 在 makePlayer 里调 ACTIONS.initPlayer(p) 即可附加这些字段。
 * ============================================================ */
function actInitPlayer(p) {
  /* ---- 贴墙 / 抓墙 ---- */
  p.actWallDir = 0;        // 贴墙方向：-1 贴左墙，+1 贴右墙，0 没贴墙
  p.actWallTouch = 0;      // 还在墙上（本帧检测结果）
  p.actGrabStamina = 0;    // 剩余抓墙体力（帧）
  p.actGrabHeld = false;   // 本帧是否在"抓"（按住朝墙方向键）
  p.actWallSlide = false;  // 本帧是否在滑墙
  p.actWallJumpLock = 0;   // 墙跳后的"短暂失去控制"帧数（防止立刻又贴回原墙）

  /* ---- 墙跳动画 ---- */
  p.actWallJumpT = 0;      // >0 表示正在播放墙跳动画
  p.actWallJumpDir = 0;    // 墙跳方向（用于绘制朝向）

  /* ---- 冲刺 ----
   * ⚠️ 2026-10-06 十一要求"冲刺无限用"后，`actDashes` 只作**显示/兼容**用，
   *    不再限制能否冲刺（判定里已拆掉次数闸门）。
   *    但**初始值仍给满**（原来给 0，靠落地补）——
   *    否则玩家刚出生、还没落地时 HUD 会显示"冲刺 0"，
   *    看起来像坏了（实际能冲），容易误报 bug。
   *
   * ⚠️⚠️ 这里**不能写 `P.dashMaxCount`**！踩过的坑：
   *    本函数签名是 `actInitPlayer(p)` —— **只有 p，没有 P**。
   *    写了 `P.dashMaxCount` 会抛 ReferenceError，
   *    导致**本函数从这里往下的所有字段都没初始化**
   *    （actDashT / actDashCool / actDashTrail / actInvuln 全丢），
   *    症状是一连串莫名其妙的下游失败（墙跳不生效、体力补不满…），
   *    极难定位。这里改用现读 CELESTE（同样是"参数只有一处"）。 */
  p.actDashes = actDashMax(p);
  p.actDashT = 0;          // 冲刺剩余帧数（>0 = 正在冲）
  p.actDashCool = 0;       // 冲刺冷却剩余帧数
  p.actDashDirX = 0;       // 本次冲刺方向（单位向量）
  p.actDashDirY = 0;
  p.actDashDirName = '';   // 方向名（用于绘制提示）
  p.actDashTrail = [];     // 冲刺残影（最近几帧的位置）

  /* ---- 冲刺无敌帧 ---- */
  p.actInvuln = 0;         // >0 时免疫伤害（冲刺期间的安全保护）
}

/* ============================================================
 * 三、工具函数
 * ============================================================ */

/** 某个方向的键是否被按住（支持多键绑定） */
function actHeldAny(keys) {
  for (let i = 0; i < keys.length; i++) {
    if (InputState.now[keys[i]]) return true;
  }
  return false;
}

/** 读取八方方向（返回方向名 + 单位向量）。没按方向键时返回 null。 */
function actReadDir8(role) {
  const up    = InputState.actionHeld(role, 'jump');          // 上 = 跳跃键（同类游戏惯例）
  const down  = InputState.actionHeld(role, 'down');
  const left  = InputState.actionHeld(role, 'left');
  const right = InputState.actionHeld(role, 'right');

  let dx = 0, dy = 0;
  if (left  && !right) dx = -1;
  if (right && !left)  dx = 1;
  if (down  && !up)    dy = 1;
  if (up    && !down)  dy = -1;

  if (dx === 0 && dy === 0) return null;   // 没方向 → 冲刺时用朝向兜底

  const name = (dy < 0 ? 'up' : dy > 0 ? 'down' : '') +
               (dx < 0 ? 'left' : dx > 0 ? 'right' : '');
  const v = DIR8[name];
  return v ? { name: name, x: v.x, y: v.y } : null;
}

/** 检测角色左右两侧是否贴着墙（复用引擎的碰撞查询） */
function actCheckWall(p, solids) {
  const P = ACT_P();
  const probe = P.wallProbePx;      // 探测距离（像素）
  // 用一个"薄片"贴在角色左右两侧做 AABB 检测
  const leftProbe  = { x: p.x - probe, y: p.y + 4, w: probe, h: p.h - 8 };
  const rightProbe = { x: p.x + p.w,   y: p.y + 4, w: probe, h: p.h - 8 };

  let hitLeft = false, hitRight = false;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!hitLeft  && aabb(leftProbe, s))  hitLeft = true;
    if (!hitRight && aabb(rightProbe, s)) hitRight = true;
    if (hitLeft && hitRight) break;
  }
  return { left: hitLeft, right: hitRight };
}

/* ============================================================
 * 四、主更新：每个玩家的新动作状态机
 * ============================================================
 * 调用时机：在 game.js 的物理循环里，**移动与碰撞之后**。
 *   顺序很重要 —— 因为"贴墙"要靠碰撞结果来判断
 *   （moveAndCollide 返回的 hitLeft/hitRight）。
 *
 * @param p       玩家对象
 * @param lv      关卡（要用 lv.solids / lv.winds / lv.movers）
 * @param solids  实心体列表（collectSolids 的结果，复用以省性能）
 * @param collRes moveAndCollide 的返回值 {hitLeft, hitRight, onGround, hitTop}
 * ============================================================ */
function actUpdatePlayer(p, lv, solids, collRes) {
  const P = ACT_P();
  if (!P) return;

  /* ----------------------------------------------------------
   * 0. ★ 动作解锁门槛 ★
   * ----------------------------------------------------------
   * 未解锁的动作**完全不生效**（等同于游戏里没这个动作），
   * 而不是"能用但不提示" —— 那样玩家会绕过教学、也失去
   * "学会新动作"的成就感。
   *
   * 判断用的是 isActionUnlocked()（定义在 save.js），
   * 它内部有完整兜底：存档读不出来时**放行**，
   * 绝不会因为存档问题把动作锁死。
   *
   * 注意：解锁是**单调递增**并存在存档里的，
   * 通关第 N 关后永久可用，不受当前正在玩哪一关影响。
   * ---------------------------------------------------------- */
  const canDash = isActionUnlocked('dash');
  const canWall = isActionUnlocked('wallslide');
  const canWallJump = isActionUnlocked('walljump');

  /* 未解锁时把相关状态清干净，避免"上一关解锁了、这一关没解锁"
   * 之类的边界情况留下残影 */
  if (!canDash && p.actDashT > 0) {
    p.actDashT = 0;
    p.actNoGravity = false;
  }
  if (!canWall) {
    p.actWallDir = 0;
    p.actWallSlide = false;
    p.actGrabHeld = false;
  }

  /* ----------------------------------------------------------
   * 1. 计时器递减
   * ---------------------------------------------------------- */
  if (p.actWallJumpLock > 0) p.actWallJumpLock--;
  if (p.actWallJumpT > 0) p.actWallJumpT--;
  if (p.actDashCool > 0) p.actDashCool--;
  if (p.actInvuln > 0) p.actInvuln--;

  /* 冲刺残影：只在冲刺中记录，松开后逐渐清空 */
  if (p.actDashT > 0) {
    p.actDashTrail.push({ x: p.x, y: p.y, life: P.dashTrailLife });
  }
  for (let i = p.actDashTrail.length - 1; i >= 0; i--) {
    if (--p.actDashTrail[i].life <= 0) p.actDashTrail.splice(i, 1);
  }

  /* ----------------------------------------------------------
   * 2. 落地：重置冲刺次数 + 补满抓墙体力
   * ---------------------------------------------------------- */
  if (p.onGround) {
    /* ★ 冲刺次数上限按角色取（2026-10-07）——朱迪能连冲两发 */
    p.actDashes = actDashMax(p);
    /* 抓墙体力上限 = 基础值 × 角色倍率（奶龙/袋鼠目前都是 1.0，
     * 预留给以后"擅长抓墙"的角色） */
    p.actGrabStamina = actStaminaMax(p, P);
    p.actWallSlide = false;
    p.actWallDir = 0;
    p.actGrabbedThisFrame = false;
  }

  /* ----------------------------------------------------------
   * 3. ★ 冲刺（优先级最高，会覆盖其他动作）★
   *    未解锁时整段跳过 —— 按了 Shift 也不会有反应。
   * ---------------------------------------------------------- */
  if (canDash) {
    actHandleDash(p, lv, P);

    /* 冲刺进行中：锁住其他动作，避免互相干扰 */
    if (p.actDashT > 0) {
      p.actWallSlide = false;
      return;
    }
  }

  /* ----------------------------------------------------------
   * 4. ★ 贴墙 / 滑墙 / 抓墙 / 墙跳 ★
   *    未解锁「贴墙滑行」→ 整个贴墙系统都不生效
   *    （滑墙和墙跳是一体的：不会滑墙，自然也谈不上蹬墙）。
   * ---------------------------------------------------------- */
  if (canWall || canWallJump) {
    actHandleWall(p, lv, solids, collRes, P, { slide: canWall, jump: canWallJump });
  }

  /* ----------------------------------------------------------
   * 5. 风场（环境力，作为新机关之一）
   *    风场不属于"玩家动作"，所以不受解锁影响 ——
   *    它靠开关/地形就能用，不需要玩家会什么。
   * ---------------------------------------------------------- */
  actApplyWind(p, lv);
}

/* ============================================================
 * 五、冲刺实现
 * ============================================================ */
function actHandleDash(p, lv, P) {
  /* ---- 冲刺进行中：保持速度，不施加重力 ---- */
  if (p.actDashT > 0) {
    p.actDashT--;
    /* 冲刺期间速度恒定（由 dashSpeed 决定，不随时间衰减），
     * 这样"距离 = 速度 × 时间"才能精确等于 dashDistance。
     * ★ 乘以角色倍率：奶龙冲刺更远（配置表里 dashMultiplier）★ */
    const dspd = P.dashSpeed * actDashMul(p);
    p.vx = p.actDashDirX * dspd;
    p.vy = p.actDashDirY * dspd;
    /* ★ 关键：告诉物理层这一帧别加重力 ★
     * 否则斜向冲刺会被重力拉成抛物线，轨道就歪了。
     * game.js 里会把这个标记传给 moveAndCollide 的 opts.noGravity。 */
    p.actNoGravity = true;
    if (p.actDashT === 0) {
      /* 冲刺结束：速度降下来，避免"冲完还在飞"的感觉 */
      p.vx = p.actDashDirX * P.dashEndSpeedKeep;
      p.vy = p.actDashDirY * P.dashEndSpeedKeep;
      p.actNoGravity = false;
      p.actDashCool = P.dashCoolFrames;
    }
    return;
  }
  p.actNoGravity = false;

  /* ---- 触发条件检查 ----
   * ⚠️ **2026-10-06 十一要求：冲刺改成无限用**（想冲几次冲几次）。
   *    原来这里第一行是 `if (p.actDashes <= 0) return;`（次数耗尽就不能冲），
   *    落地才补满（`P.dashMaxCount = 1`）。
     *    现在**去掉次数限制** —— 但**保留冷却**（dashCoolFrames = 300 帧 = 5 秒）：
   *    冷却还在，所以不会变成"按住就无限瞬移"，
   *    手感上仍然是"一次一次地冲"，只是不用再等落地。
   *    ⚠️ 没有改任何物理参数（dashFrames / dashSpeed / dashCoolFrames 全不变），
   *       只是把"次数"这道闸门拆了。 */
  /* 先记录按键边沿，再判断冷却。
   * 旧逻辑在冷却判断前直接 return，导致玩家在5秒冷却期间松开 F
   * 时 `_actDashKeyPrev` 仍保持 true；冷却结束后的下一次按下就会被
   * 误判成“没有新的按下”，表现为一局只能冲一次。 */
  const nowDown = actHeldAny(dashKeys());
  const wasDown = p._actDashKeyPrev === true;
  p._actDashKeyPrev = nowDown;
  if (p.actDashCool > 0) return;                // 冷却中（这一步保留）
  if (!nowDown) return;                         // 没按冲刺键

  /* 用"刚按下"判定，避免按住不放一直冲。
   * 注意：Shift 不在 KEYMAP 里，所以不能走 actionPressed，
   * 这里自己维护一个边沿检测。
   *
   * ⚠️ 这里和上面那处**必须都调 dashKeys()** ——
   *    这就是文档里说的"加新动作要加在所有判定点"。
   *    漏掉任何一处，手机上就是"按住冲不动"。 */
  if (wasDown) return;                          // 没有新的按下边沿

  /* ---- 决定冲刺方向 ---- */
  let dir = actReadDir8(p.role);
  if (!dir) {
    /* 没按方向 → 朝当前朝向水平冲（同 Celeste 的手感） */
    const f = p.dir < 0 ? 'left' : 'right';
    dir = { name: f, x: DIR8[f].x, y: DIR8[f].y };
  }

  /* ---- 执行冲刺 ----
   * ⚠️ 原来这里有一行 `p.actDashes--;`（扣次数）。
   *    2026-10-06 改成无限冲刺后**不再扣**，
   *    但 `actDashes` 字段保留（HUD 的"冲刺可用"指示、存档兼容都要读它），
   *    落地时照旧补满，保证它是"满的"而不是"0"。
   *    （如果只删扣减、不补满，某些一次性初始化的路径会留着 0，
   *      HUD 可能显示"没冲刺"，虽然实际能冲。） */
  p.actDashT = P.dashFrames;
  p.actDashDirX = dir.x;
  p.actDashDirY = dir.y;
  p.actDashDirName = dir.name;
  p.actInvuln = Math.max(p.actInvuln, P.dashInvulnFrames);   // 无敌帧
  p.actDashTrail = [];
  p.dir = dir.x < 0 ? -1 : (dir.x > 0 ? 1 : p.dir);

  /* 音效 + 视觉：复用现有音效系统与粒子 */
  if (typeof Sound !== 'undefined' && Sound.dash) Sound.dash();
  actSpawnDashBurst(p, dir);
}

/* 冲刺起手的粒子爆发 */
function actSpawnDashBurst(p, dir) {
  if (typeof Game === 'undefined' || !Game.particles) return;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  /* 反方向的"起手气浪"：冲刺方向的反侧喷出速度线 */
  for (let i = 0; i < 8; i++) {
    const spread = (Math.random() - 0.5) * 1.2;
    const a = Math.atan2(-dir.y, -dir.x) + spread;
    Game.particles.push({
      x: cx + Math.cos(a) * 10,
      y: cy + Math.sin(a) * 10,
      vx: Math.cos(a) * 4.5,
      vy: Math.sin(a) * 4.5,
      life: 14, maxLife: 14,
      color: '#c8f0ff',
      size: 4,
      type: 'streak',
      angle: a,
    });
  }
  /* 中心一圈扩散环 */
  Game.particles.push({
    x: cx, y: cy, vx: 0, vy: 0,
    life: 16, maxLife: 16,
    color: '#eafcff', size: 6, type: 'ring', maxR: 30, lineW: 2.5,
  });
  if (Game.shake !== undefined) Game.shake = Math.max(Game.shake, 2);
}

/* ============================================================
 * 六、贴墙 / 滑墙 / 抓墙 / 墙跳 实现
 * ============================================================ */
/* @param opts {slide, jump} —— 两个子能力的解锁状态（默认都开）
 *   为什么滑墙和墙跳要分开判：
 *   解锁节奏是"第2关学滑墙、第3关学墙跳" —— 中间存在
 *   "会贴墙但还不会蹬墙"的过渡阶段，必须支持只有 slide 没有 jump。 */
function actHandleWall(p, lv, solids, collRes, P, opts) {
  /* 没传 opts 时默认都开（保证老调用点/直接调用时行为不变） */
  const canSlide = !opts || opts.slide !== false;
  const canWallJump = !opts || opts.jump !== false;

  /* ---- 1. 探测墙面 ---- */
  const wall = actCheckWall(p, solids);
  let dir = 0;
  if (wall.left && !wall.right) dir = -1;
  else if (wall.right && !wall.left) dir = 1;

  /* 只有"空中"才贴墙。地面上贴墙没意义，也会干扰正常移动。 */
  const airborne = !p.onGround;

  /* 墙跳后的短暂锁定：防止刚弹出去又立刻贴回同一面墙 */
  if (p.actWallJumpLock > 0) {
    p.actWallDir = 0;
    p.actWallSlide = false;
    p.actGrabHeld = false;
    return;
  }

  p.actWallDir = airborne ? dir : 0;
  p.actWallTouch = dir;

  if (!p.actWallDir) {
    /* 没贴墙：体力快速恢复（比地面恢复慢一些，鼓励落地） */
    p.actWallSlide = false;
    p.actGrabHeld = false;
    p.actGrabStamina = Math.min(actStaminaMax(p, P), p.actGrabStamina + P.grabRecoverAir);
    return;
  }

  /* ---- 1.5 只解锁了墙跳、还没解锁滑墙的情况 ----
   * 这种组合在实际解锁流程里不会出现（滑墙先解锁），
   * 但手动改存档 / 以后调整顺序时可能遇到。
   * 处理方式：保留贴墙方向（让墙跳能用），但不做减速。 */
  if (!canSlide) {
    p.actWallSlide = false;
    p.actGrabHeld = false;
    /* 仍然允许墙跳（如果解锁了） */
    if (canWallJump && InputState.actionPressed(p.role, 'jump')) {
      actDoWallJump(p, P);
    }
    return;
  }

  /* ---- 2. 是否在"抓"（按住朝墙方向键）---- */
  const keyTowardWall = p.actWallDir < 0
    ? InputState.actionHeld(p.role, 'left')
    : InputState.actionHeld(p.role, 'right');
  /* 体力耗尽后无法再抓 */
  const canGrab = p.actGrabStamina > 0;
  p.actGrabHeld = keyTowardWall && canGrab;
  p.actWallSlide = true;

  /* ---- 3. 抓墙消耗体力 ---- */
  if (p.actGrabHeld) {
    p.actGrabStamina--;
  } else if (!keyTowardWall) {
    /* 没按方向键但贴墙 → 也算"轻挂"，消耗少一些（一半） */
    p.actGrabStamina = Math.max(0, p.actGrabStamina - P.grabDrainPassive);
  }

  /* ---- 4. 下落速度控制 ---- */
  /* 目标下落速度：
   *   正常滑墙   → wallSlideSpeed（较慢）
   *   抓墙       → grabSlideSpeed（几乎不动）
   *   体力耗尽   → 直接恢复自由落体（快速滑落） */
  let targetVy;
  if (p.actGrabHeld) {
    targetVy = P.grabSlideSpeed;
  } else if (canGrab) {
    targetVy = P.wallSlideSpeed;
  } else {
    targetVy = null;    // 体力耗尽：不干预，走正常重力（快速滑落）
  }

  if (targetVy !== null && p.vy > targetVy) {
    /* 把下落速度"夹"到目标值。
     * 用钳制而不是直接赋值，是为了保留"刚跳起来还在上升"的情况。 */
    p.vy = targetVy;
  }
  /* 体力耗尽时的"快速滑落"：额外给一点向下加速度，让手感更明确 */
  if (!canGrab && p.vy >= 0) {
    p.vy += P.grabExhaustExtraFall;
  }

  /* ---- 5. 墙跳（要解锁了才能用）---- */
  if (canWallJump && InputState.actionPressed(p.role, 'jump')) {
    actDoWallJump(p, P);
  }
}

/* 执行一次墙跳
 * ------------------------------------------------------------
 * 抽成独立函数是因为有两处调用：
 *   ① actHandleWall 的正常路径
 *   ② "只解锁了墙跳、还没解锁滑墙"的过渡路径
 * 两处必须给出一模一样的手感，所以逻辑只能有一份。
 */
function actDoWallJump(p, P) {
  /* 向**墙的外侧**弹出去（贴左墙 → 往右弹） */
  const outDir = -p.actWallDir;
  p.vx = P.wallJumpSpeedX * outDir;
  /* ★ 2026-10-06：竖直初速要乘角色跳跃倍率 ★
   * P.wallJumpSpeedY 现在是函数（以角色普通跳为基准×0.93），
   * 所以这里必须把 p.jumpMul 传进去 —— 否则袋鼠和奶龙的墙跳
   * 高度会一样，而它们的普通跳高度其实差 12%。
   *
   * ⚠️ 兼容写法：老版本里 wallJumpSpeedY 是个数字，
   *    如果拿到的是函数就调它，是数字就乘倍率 —— 两条路都得走通。 */
  const wjY = (typeof P.wallJumpSpeedY === 'function')
    ? P.wallJumpSpeedY(p.jumpMul)
    : P.wallJumpSpeedY * (p.jumpMul || 1);
  /* ★ 墙跳力度（2026-10-06 加，美团猴子的招牌）★
   * ------------------------------------------------------------
   * 把角色自己的"墙跳力度倍率"再乘上去。
   *
   * 【为什么要单独一个倍率，而不是复用 jumpMul】
   *   猴子的**普通跳没有加成**（jumpMul = 1.0），
   *   但它的**墙跳要明显更强**（wallJumpMul = 1.40）。
   *   复用 jumpMul 就做不到这个区分 —— 那样一来猴子要么
   *   "普通跳和墙跳一起变强"，要么"都不强"。
   *
   * ⇒ 独立维度 = 可以做出"踩着墙特别能蹿"这种辨识度，
   *   而且卡皮巴拉、袋鼠它们不受影响（没配这个字段就是 1.0）。
   * ------------------------------------------------------------ */
  const wjMul = (typeof p.wallJumpMul === 'number' && isFinite(p.wallJumpMul) && p.wallJumpMul > 0)
    ? p.wallJumpMul : 1;
  p.vy = wjY * wjMul;
  p.dir = outDir;                       // 面朝弹出方向
  p.actWallJumpLock = P.wallJumpLockFrames;
  p.actWallJumpT = P.wallJumpAnimFrames;
  p.actWallJumpDir = outDir;

  /* 墙跳重置跳跃相关状态（让玩家能接二段跳） */
  p.jumpsLeft = (typeof CONFIG !== 'undefined' && CONFIG.MAX_JUMPS) ? CONFIG.MAX_JUMPS : 1;
  p.doubleJumped = false;
  p.jumpCutEligible = false;            // 墙跳是外部力，不接受松键截断

  if (typeof Sound !== 'undefined' && Sound.jump) Sound.jump();
  actSpawnWallJumpEffect(p, outDir);
}

/* 墙跳的视觉反馈 */
function actSpawnWallJumpEffect(p, outDir) {
  if (typeof Game === 'undefined' || !Game.particles) return;
  /* 贴墙那一侧喷出尘土（表现"蹬墙"的反作用力） */
  const wx = outDir > 0 ? p.x : p.x + p.w;    // 墙面位置
  const wy = p.y + p.h / 2;
  for (let i = 0; i < 7; i++) {
    const a = (outDir > 0 ? Math.PI : 0) + (Math.random() - 0.5) * 1.4;
    Game.particles.push({
      x: wx, y: wy + (Math.random() - 0.5) * 16,
      vx: Math.cos(a) * 3.2,
      vy: Math.sin(a) * 3.2 - 1,
      life: 18, maxLife: 18,
      color: '#ffe6b0',
      size: 4, type: 'streak', angle: a,
    });
  }
  Game.particles.push({
    x: wx, y: wy, vx: 0, vy: 0,
    life: 16, maxLife: 16,
    color: '#fff2c8', size: 5, type: 'ring', maxR: 24, lineW: 2,
  });
  if (Game.shake !== undefined) Game.shake = Math.max(Game.shake, 1.5);
}

/* ============================================================
 * 七、风场（新机关：持续推动角色的气流）
 * ============================================================ */
function actApplyWind(p, lv) {
  /* 兼容两种数据来源：
   *   lv.windGates —— 新机关（第5关用）
   *   lv.winds     —— 旧命名（以防别处有）
   * 这样命名换过也不会突然失效。 */
  const list = (lv && lv.windGates) || (lv && lv.winds) || [];
  if (!list.length) return;
  for (let i = 0; i < list.length; i++) {
    const wd = list[i];
    if (!aabb(p, wd)) continue;
    /* 风是"环境力"，直接加在速度上（和传送带同一思路）。
     * 冲刺期间不吹（否则冲刺轨道会被吹歪，玩家会觉得"失灵"）。 */
    if (p.actDashT > 0) return;
    p.vx += wd.fx;
    p.vy += wd.fy;
    p.actInWind = true;
    return;
  }
  p.actInWind = false;
}

/* ============================================================
 * 七之二、机关更新（移动平台 / 开关 / 开关门）
 * ============================================================
 * 调用时机：每帧一次（在玩家更新之前），由 game.js 的 updatePlaying 调用。
 * 这些机关只改变"世界状态"，不直接动玩家 —— 玩家与它们的交互
 * 通过正常的碰撞/踩踏逻辑自然发生。
 * ============================================================ */
function actUpdateMechanisms(lv, dt) {
  if (!lv) return;

  /* ---- 1. 移动平台：在 base 位置附近按三角波往返 ---- */
  if (lv.movers && lv.movers.length) {
    for (let i = 0; i < lv.movers.length; i++) {
      const m = lv.movers[i];
      /* 用相位累加而不是"撞到边界才反向"，
       * 这样即使卡顿/掉帧也不会出现"跑到范围外"的情况。 */
      m.phase += (m.speed / Math.max(1, m.rangeX || m.rangeY || 32)) * 0.5;
      if (m.phase > 1) m.phase -= 1;

      /* 三角波：0→1→0，得到平滑往返 */
      const tri = m.phase < 0.5 ? (m.phase * 2) : (2 - m.phase * 2);
      const offset = (tri - 0.5) * 2;      // -1 ~ +1

      const nx = m.baseX + (m.rangeX || 0) * offset;
      const ny = m.baseY + (m.rangeY || 0) * offset;
      /* 记录位移量：站在平台上的玩家要跟着一起动（见 actCarryPlayer） */
      m.dx = nx - m.x;
      m.dy = ny - m.y;
      m.x = nx;
      m.y = ny;
    }
  }

  /* ---- 2. 开关：碰一下就切换，控制对应门 ---- */
  if (lv.switchers && lv.switchers.length) {
    for (let i = 0; i < lv.switchers.length; i++) {
      const sw = lv.switchers[i];
      if (sw.cooldown > 0) sw.cooldown--;

      /* 检查是否有玩家碰到 */
      let touched = false;
      for (let k = 0; k < Game.players.length; k++) {
        if (aabb(Game.players[k], sw)) { touched = true; break; }
      }
      if (touched && sw.cooldown <= 0) {
        sw.on = !sw.on;
        sw.cooldown = 20;               // 0.33 秒冷却，避免站着反复触发
        /* 同步所有"监听这个开关"的门 */
        if (lv.doors) {
          for (let d = 0; d < lv.doors.length; d++) {
            const dr = lv.doors[d];
            if (dr.isSwitchDoor && dr.switchId === i) dr.open = sw.on;
          }
        }
        if (typeof Sound !== 'undefined' && Sound.checkpoint) Sound.checkpoint();
      }
    }
  }

  /* ---- 3. 开关门：按 open 状态平滑开合 ---- */
  if (lv.doors && lv.doors.length) {
    for (let i = 0; i < lv.doors.length; i++) {
      const d = lv.doors[i];
      if (!d.isSwitchDoor) continue;     // 老的按钮门由原逻辑控制
      const target = d.open ? 1 : 0;
      /* 每帧靠近 4%，约 25 帧开完（0.4 秒），有"缓缓升起"的感觉 */
      if (d.openAmount < target) d.openAmount = Math.min(target, d.openAmount + 0.04);
      else if (d.openAmount > target) d.openAmount = Math.max(target, d.openAmount - 0.04);
    }
  }
}

/* ============================================================
 * 七之三、移动平台"带着玩家走"
 * ============================================================
 * 平台移动时，站在上面的玩家要跟着动 —— 否则平台会从脚下滑走，
 * 玩家感觉像"站在跑步机上"却原地不动，非常别扭。
 *
 * 判定：玩家的脚底贴近平台顶面 且 水平有交叠。
 * 这种"传送带式承载"是平台游戏的通用做法，比做父子变换简单得多。
 * ============================================================ */
function actCarryPlayer(p, lv) {
  if (!lv || !lv.movers || !lv.movers.length) return;
  if (!p.onGround) return;               // 只有站在地上才可能被承载

  for (let i = 0; i < lv.movers.length; i++) {
    const m = lv.movers[i];
    if (!m.dx && !m.dy) continue;

    /* 脚底是否贴着这块平台的顶面 */
    const footY = p.y + p.h;
    const onTop = Math.abs(footY - m.y) <= 4;
    const overlapX = (p.x + p.w > m.x + 2) && (p.x < m.x + m.w - 2);
    if (onTop && overlapX) {
      p.x += m.dx;
      p.y += m.dy;
      return;                            // 一块平台足够，不重复叠加
    }
  }
}

/* ============================================================
 * 八、渲染辅助：冲刺残影（供 render.js 调用）
 * ============================================================ */
function actDrawDashTrail(ctx, p) {
  if (!p.actDashTrail || !p.actDashTrail.length) return;
  const P = ACT_P();
  for (let i = 0; i < p.actDashTrail.length; i++) {
    const t = p.actDashTrail[i];
    const alpha = (t.life / P.dashTrailLife) * 0.35;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#a8e8ff';
    ctx.fillRect(t.x, t.y, p.w, p.h);
    ctx.restore();
  }
}

/* ============================================================
 * 九、对外接口
 * ============================================================ */
const ACTIONS = {
  /** 给玩家对象附加新动作状态（在 makePlayer 里调一次） */
  initPlayer: actInitPlayer,

  /** 每帧更新新动作（在物理循环里调，移动碰撞之后） */
  updatePlayer: actUpdatePlayer,

  /** 每帧更新机关（移动平台/开关/门）—— 在玩家更新**之前**调 */
  updateMechanisms: actUpdateMechanisms,

  /** 移动平台承载玩家 —— 在玩家更新**之后**调 */
  carryPlayer: actCarryPlayer,

  /** 绘制冲刺残影 */
  drawDashTrail: actDrawDashTrail,

  /** 冲刺键列表（供 UI 提示使用） */
  DASH_KEYS: DASH_KEYS,
  /* ★ 对外暴露"当前生效的冲刺键"（含虚拟手柄键）★
   * 外部要判定"玩家按没按冲刺"请用这个，不要用上面的 DASH_KEYS ——
   * 后者只含键盘键，在手机上永远是空的。 */
  dashKeys: dashKeys,

  /** 查询：某玩家本帧是否在滑墙（供渲染判断） */
  isWallSliding: function (p) { return !!p.actWallSlide; },

  /** 查询：某玩家是否处于冲刺中 */
  isDashing: function (p) { return p.actDashT > 0; },

  /** 查询：冲刺剩余次数（供 HUD 显示） */
  dashesLeft: function (p) { return p.actDashes; },

  /** 查询：该角色**冲刺次数上限**（供 HUD 画格子）。
   *  ⚠️ 必须按角色取 —— 否则朱迪（能冲 2 发）的 HUD 只画 1 格，
   *     冲完第一发就显示"没冲刺了"，看起来像坏了。 */
  dashesMax: function (p) { return actDashMax(p); },

  /** 查询：抓墙体力比例（0~1，供 HUD 显示） */
  grabStaminaRatio: function (p) {
    const P = ACT_P();
    if (!P || !P.grabStaminaFrames) return 0;
    /* 分母要用"该角色的体力上限"而不是基础值 ——
     * 否则给抓墙强的角色加成后，比例会超过 1，
     * HUD 的体力条会画到框外面去。 */
    const max = actStaminaMax(p, P);
    if (!max) return 0;
    return Math.max(0, Math.min(1, p.actGrabStamina / max));
  },
};
