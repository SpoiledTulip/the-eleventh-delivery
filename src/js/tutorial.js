/* ============================================================
 * 新动作教学引导（Tutorial）
 * ============================================================
 * 背景：
 *   游戏原本没有"按位置触发教学"的机制 —— 只有零散的
 *   `Game.message = '桥在塌！快跑！'` 这种场景提示。
 *   而新加的动作（滑墙/墙跳/冲刺）**必须有人教**，
 *   否则玩家根本不知道能这么玩（十一就说"很多按键还不太懂"）。
 *
 * 设计：
 *   · 用"**玩家真的做到那个动作**"来触发，而不是"走到某个位置"
 *     —— 后者会变成"路过被弹窗打扰"，前者是"你做对了，我告诉你"。
 *   · 每个提示**只出一次**（用 `Game.tutorial.seen` 记录）。
 *   · 提示内容分两种：
 *       - 引导型（"试试按 Shift+方向冲刺"）→ 触发条件宽松，先教后做
 *       - 确认型（"漂亮的墙跳！"）        → 触发条件严格，做到才提示
 *   · 全部走 `Game.message`，复用现有的提示渲染，不新增渲染代码。
 *
 * ⚠️ 与主循环的关系：**完全独立**。
 *   它只被 game.js 调用一次（updateTutorial），
 *   不修改任何游戏状态，删掉这个文件游戏照常跑。
 * ============================================================ */

/* ------------------------------------------------------------
 * 教学提示表
 * ------------------------------------------------------------
 * 每条的字段：
 *   id      —— 唯一标识（用来记"已经提示过"）
 *   levels  —— 在哪些关卡生效（null = 所有关卡）
 *   when(p, g) —— 触发条件，返回 true 就提示
 *   text    —— 提示文字（走 Game.message）
 *   hold    —— 提示持续帧数
 *   once    —— 是否只提示一次（默认 true）
 *   priority—— 数值越大越优先（同一帧多条满足时只出一条）
 * ------------------------------------------------------------ */
const TUTORIAL_HINTS = [
  /* ============================================================
   * ⓪ 第一关教学：左右移动 → 跳跃 → 过缺口（三步，依次解锁）
   * ============================================================
   * ★ 2026-10-06 扩写（十一要求"第一关请增加左右移动和跳跃的教学内容"）★
   *
   * 为什么要拆成三条独立的提示，而不是一条说全：
   *   新手一次能记住的操作只有一两条。把"移动 + 跳跃 + 过坑"
   *   塞进一句话，玩家会全部忽略（提示显示 3 秒就过去了）。
   *   拆开之后每条只讲一件事，按**玩家的实际进度**依次出现：
   *     ① 刚进关        → "用 → 跑，用 ← 后退"
   *     ② 跑起来之后    → "空格可以跳"
   *     ③ 跳了几次之后  → "一次跳就够过缺口"
   *   这就是平台游戏常见的"分步教学"（马里奥 1-1 也是这么做的）。
   *
   * ⚠️ 第 1 关玩家**还没有二连跳**（通关第 1 关才解锁）。
   *    所以这三条讲的都是"现在就能做到的事"。
   *    二连跳的提示有独立的解锁门槛（见下面 id: 'doublejump'，
   *    十一明确要求"移除开局出现的『再点一次可以跳得更高』提示"）。
   * ============================================================ */

  /* ⓪-1 左右移动 */
  {
    id: 'tut_move',
    levels: [0],           // ★ 只在第 1 关讲，其它关不需要
    priority: 70,          // 最高：这是最基础的一步
    text: '用 ← → 左右移动 · 按住 → 会越跑越快',
    hold: 220,
    when: function (p, g) {
      /* 进关 1 秒后提示（先让玩家看清场景） */
      return g.elapsed > 1.0;
    },
  },

  /* ⓪-2 跳跃（玩家真的跑起来之后再教） */
  {
    id: 'tut_jump',
    levels: [0],
    priority: 68,
    text: '按「空格」跳跃（↑ 也可以）· 跑着跳能跳更远',
    hold: 220,
    when: function (p, g) {
      /* 条件：玩家已经往前走过一段（说明在尝试移动），
       * 而且**还没跳过**（跳过之后就由下一条接管） */
      var moved = (p.x - (p.spawnX || 0)) > 96;
      var notJumped = !g.tutorial || g.tutorial.jumpUsedCount === 0;
      return moved && notJumped;
    },
  },

  /* ⓪-3 过缺口：强调"一次跳就够"，消除"是不是跳不够高"的疑虑 */
  {
    id: 'tut_gap',
    levels: [0],
    priority: 66,
    text: '一次跳跃就能越过缺口 —— 助跑一下跳得更远',
    hold: 200,
    when: function (p, g) {
      /* 玩家已经跳过至少 1 次 → 说明在尝试跳跃了 */
      return !!g.tutorial && g.tutorial.jumpUsedCount >= 1 && p.onGround;
    },
  },

  /* ⓪-4 ★ 踩小怪：教"跳在头顶就能踩死" ★
   * ------------------------------------------------------------
   * ★ 2026-10-06 新增（十一要求："第一关加上跳在小怪头上就能踩死
   *   小怪的说明文字"）★
   *
   * 为什么这条必须教：
   *   第 1 关主路线上有 3 只巡逻怪。新手第一次遇到怪，
   *   默认反应是"躲"或者"跳过去"，**不会想到能踩**——
   *   "踩敌人"是平台游戏的传统玩法，但对没接触过的人来说不是常识。
   *   实测玩家会在这里卡很久（以为怪是纯障碍物）。
   *
   * 触发时机用的是"玩家离最近的怪还有一段距离"——
   * 也就是**在他撞上怪之前**就把话说出去，给足反应时间。
   * 而不是等踩到了才提示（那时候已经来不及学了）。
   * ------------------------------------------------------------ */
  {
    id: 'tut_stomp',
    levels: [0],           // 只在第 1 关教
    priority: 64,          // 比基础移动低、比动作提示高
    text: '跳到小怪头顶上就能把它踩死 —— 顺便还能弹起来！',
    hold: 230,
    when: function (p, g) {
      /* 玩家还没踩过怪（踩过就不用教了） */
      if (g.tutorial && g.tutorial.stompUsedCount > 0) return false;
      /* 找最近的小怪，判断"快到了但还没撞上" */
      var enemies = (g.level && g.level.enemies) ? g.level.enemies : null;
      if (!enemies || !enemies.length) return false;
      var px = p.x + p.w / 2;
      for (var i = 0; i < enemies.length; i++) {
        var dx = enemies[i].x - px;
        /* 怪在前方 90~260px 之间 → 正是"讲解的好时机"：
         * 太近（<90）玩家已经在处理它了，太远（>260）说了会忘。 */
        if (dx > 90 && dx < 260) return true;
      }
      return false;
    },
  },

  /* ---------- ① 二连跳：★ 必须解锁了才提示 ★ ----------
   * ⚠️ 这里原来**没有判断解锁状态**，结果第 1 关（还没解锁）也会提示
   *    "空中再按一次跳跃键"—— 玩家照做没反应，体验极差。
   *    十一本轮再次点名要求：
   *      "玩家开局时尚未解锁『双跳』能力，
   *       请移除开局出现的『再点一次可以跳得更高』提示，
   *       避免引导玩家执行尚未解锁的操作。"
   *
   *    现在有两道保险：
   *      ① 加上 isActionUnlocked('doublejump') 门槛（没解锁永不提示）
   *      ② **限定不在第 1 关出现**（levels 里排除索引 0）——
   *         第 1 关由上面三条基础教学负责，语义上更干净，
   *         即使存档出了奇怪的状态，第 1 关也不会冒出这句。 */
  {
    id: 'doublejump',
    /* ★ 不包含第 1 关（索引 0）★ —— 十一要求第 1 关不许出现这条 */
    levels: [1, 2, 3, 4],
    priority: 10,
    text: '空中再按一次「跳」能跳更高 —— 试试！',
    hold: 150,
    when: function (p) {
      /* 没解锁就永远不提示（这才是"教学教的是能做的事"） */
      if (typeof isActionUnlocked === 'function' && !isActionUnlocked('doublejump')) {
        return false;
      }
      /* 第一次跳起来后（已在空中），提示二连跳 */
      return !p.onGround && p.vy < 0 && p.jumpsLeft === 1;
    },
  },

  /* ---------- ①b 单跳意识：还没解锁二连跳时，教"一次跳就够" ----------
   * 和第 1 关的地图改动配合：主路线上的坑 2 格宽，一段跳就能过。
   * 这里明确告诉玩家"不用连跳也能过"，消除"我是不是跳不够高"的疑虑。
   *
   * ⚠️ 触发条件用 Game.tutorial.jumpUsedCount（在 updateTutorial 里累计），
   *    不依赖任何玩家身上的字段 —— 老存档热重载时也不会读不到而报错。 */
  {
    id: 'single_jump_hint',
    levels: null,
    priority: 12,
    text: '一次跳跃就够过缺口 —— 助跑一下跳得更远',
    hold: 170,
    when: function (p, g) {
      /* 只在"还没解锁二连跳"的阶段提示，解锁后让位给二连跳提示 */
      if (typeof isActionUnlocked === 'function' && isActionUnlocked('doublejump')) {
        return false;
      }
      /* 玩家至少跳过 2 次之后再提示（说明他已经在尝试跳跃了） */
      return !!(g.tutorial && g.tutorial.jumpUsedCount >= 2) && p.onGround;
    },
  },

  /* ---------- ② 贴墙滑行：碰到墙就教 ---------- */
  {
    id: 'wallslide',
    levels: null,
    priority: 20,
    text: '贴着墙下落会变慢 · 按住朝墙方向键可以「抓墙」',
    hold: 150,
    when: function (p) {
      return !!p.actWallDir && !p.actGrabHeld;
    },
  },

  /* ---------- ③ 抓墙：按住方向键抓住时 ---------- */
  {
    id: 'wallgrab',
    levels: null,
    priority: 30,
    text: '抓墙会消耗体力（左上角蓝条）· 耗尽就会掉下去',
    hold: 160,
    when: function (p) {
      if (!p.actGrabHeld) return false;
      /* 体力已经掉到 70% 以下才提示（说明真的在抓） */
      const P = (typeof CELESTE !== 'undefined') ? CELESTE : null;
      if (!P) return false;
      return p.actGrabStamina < P.grabStaminaFrames * 0.7;
    },
  },

  /* ---------- ④ 墙跳：贴墙时提示"按跳" ---------- */
  {
    id: 'walljump_tip',
    levels: null,
    priority: 25,
    text: '贴墙时按「跳」= 墙跳，会往墙外弹出去',
    hold: 140,
    when: function (p) {
      /* 在贴墙 + 没有墙跳锁（说明还没跳） */
      return !!p.actWallDir && p.actWallJumpLock <= 0 && p.vy > 0;
    },
  },

  /* ---------- ⑤ 墙跳成功：确认型 ---------- */
  {
    id: 'walljump_done',
    levels: null,
    priority: 40,
    text: '漂亮的墙跳！两面墙来回蹬可以爬上去',
    hold: 120,
    once: false,      // 可以重复确认（但不刷屏，见节流）
    throttle: 300,    // 至少隔 300 帧才再提示一次
    when: function (p) {
      return p.actWallJumpLock > 6;   // 刚蹬出去
    },
  },

  /* ---------- ⑥ 冲刺提示：在需要冲刺的关卡，或者空中时 ---------- */
  {
    id: 'dash_tip',
    levels: [4],      // 第 5 关（索引 4）—— 冲刺区在那里
    priority: 35,
    text: '按住 F + 方向键 = 八方冲刺（使用后冷却5秒）',
    hold: 200,
    when: function (p, g) {
      /* 进关卡后过一会儿提示（让玩家先跑两步） */
      return g.elapsed > 3 && !p.onGround;
    },
  },

  /* ---------- ⑦ 冲刺成功：确认型 ---------- */
  {
    id: 'dash_done',
    levels: null,
    priority: 50,
    text: '冲刺！有短暂无敌，能穿过尖刺',
    hold: 110,
    once: false,
    throttle: 360,
    when: function (p) {
      return p.actDashT > 0;
    },
  },

  /* ---------- ⑧ 冲刺用光了：提醒落地恢复 ---------- */
  {
    id: 'dash_empty',
    levels: null,
    priority: 45,
    text: '冲刺用完了 —— 落地就能恢复',
    hold: 110,
    when: function (p) {
      return p.actDashes <= 0 && !p.onGround && p.actDashT <= 0;
    },
  },

  /* ---------- ⑨ 所有关卡通用：根本没试过冲刺 ---------- */
  {
    id: 'dash_unused',
    levels: null,
    priority: 5,
    text: '还不知道怎么冲刺？按住 F + 方向键试试（冷却5秒）',
    hold: 190,
    /* 只在关卡进行了 25 秒、且玩家一次都没冲刺过时提示。
     * 目的：给"完全没发现这个功能"的玩家一个兜底提示。 */
    when: function (p, g) {
      return g.elapsed > 25 && g.tutorial.dashUsedCount === 0 && p.onGround;
    },
  },
];

/* ============================================================
 * 初始化（在 loadLevel 里调）
 * ============================================================ */
function tutorialInit() {
  Game.tutorial = {
    seen: {},            // 已经提示过的 id
    lastMsgId: null,     // 上一条提示是什么（避免同一句连续刷）
    lastSeenAt: {},      // 每条上次提示的时刻（用于 throttle）
    dashUsedCount: 0,    // 本关冲刺次数（用于兜底提示）
    jumpUsedCount: 0,    // 本关跳跃次数（用于"单跳就够"提示，2026-10-06 新增）
    stompUsedCount: 0,   // 本关踩怪次数（用于"踩怪"教学，2026-10-06 新增）
    startedAt: 0,        // 本关开始时间（秒，Game.elapsed）
  };
}

/* ============================================================
 * 每帧更新（在 game.js 的物理更新里调一次）
 * ============================================================
 * 注意：这里**只读**玩家状态，不修改任何东西（除自己的记录）。
 * ============================================================ */
function updateTutorial(dt) {
  /* 容错：如果 Game.tutorial 还没初始化（比如老存档热重载），补一个 */
  if (!Game.tutorial) tutorialInit();
  const T = Game.tutorial;

  /* 只在真正play的时候提示（暂停/死亡不打扰） */
  if (Game.state !== 'playing') return;

  /* ★ 设置里的"操作提示"开关 ★
   * 十一要求设置页能开关操作提示。关掉后**完全不产生**提示
   * （而不是"产生了但不画"）—— 这样连计时/状态机都不推进，
   * 再次打开时不会突然弹出一堆攒下来的提示。
   *
   * 每次读一次设置：设置页改完立刻生效，不需要重开一局。
   * 读的是内存里的对象，开销可忽略（每帧一次属性访问）。 */
  try {
    if (typeof SAVE === 'function') {
      const s = SAVE().settings ? SAVE().settings() : null;
      if (s && s.hintsOn === false) return;
    }
  } catch (e) { /* 存档读不出来就照常提示 */ }

  const players = Game.players;
  if (!players || !players.length) return;

  /* 累计冲刺次数（用于"根本没试过"的兜底提示） */
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.actDashT > 0 && !p._tutDashCounted) {
      p._tutDashCounted = true;
      T.dashUsedCount++;
    }
    if (p.actDashT <= 0) p._tutDashCounted = false;
  }

  /* ★ 累计跳跃次数（2026-10-06 新增）★
   * 检测"离地"这个跳跃瞬间：上一帧还在地上、这一帧已在空中。
   * 用"离地"而不是读 p.jumpsLeft，是因为后者会被墙跳/踩怪/弹簧
   * 等各种机制重置，不能反过来推断"玩家按过几次跳"。
   * 这条计数喂给 single_jump_hint，判断"玩家已经在尝试跳了"。 */
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    /* 每位玩家记录"上一帧是否在地面"（放在玩家对象上，
     * 出关卡时随玩家一起丢，不用额外清理） */
    if (p._tutWasGround === undefined) p._tutWasGround = p.onGround;
    if (p._tutWasGround && !p.onGround) T.jumpUsedCount++;
    p._tutWasGround = p.onGround;
  }

  /* 收集本帧所有满足条件的提示，按优先级排序，只取最高的一条 */
  const now = Game.elapsed || 0;
  let best = null;

  for (let i = 0; i < TUTORIAL_HINTS.length; i++) {
    const h = TUTORIAL_HINTS[i];

    /* 关卡过滤 */
    if (h.levels && h.levels.indexOf(Game.levelIndex) < 0) continue;

    /* 只提示一次的，见过了就跳过 */
    if (h.once !== false && T.seen[h.id]) continue;

    /* 节流（确认型提示会重复出现，但不能太频繁） */
    if (h.throttle) {
      const last = T.lastSeenAt[h.id];
      if (last != null && (now - last) * 60 < h.throttle) continue;
    }

    /* 任意一个玩家满足即可（合作游戏：谁先做到就提示谁） */
    let hit = false;
    for (let k = 0; k < players.length; k++) {
      try {
        if (h.when(players[k], Game)) { hit = true; break; }
      } catch (e) {
        /* 提示条件出错不该影响游戏 —— 但也别静默，
         * 用项目统一的"只报一次"警告器（见 game.js） */
        if (typeof warnActionsOnce === 'function') {
          warnActionsOnce('教学提示:' + h.id, e);
        }
        break;
      }
    }
    if (!hit) continue;

    /* 优先级更高就替换 */
    if (!best || (h.priority || 0) > (best.priority || 0)) best = h;
  }

  if (!best) return;

  /* 同一句别连续刷 */
  if (T.lastMsgId === best.id && best.once !== false) return;

  /* 如果当前已经有别的提示在显示（比如"桥在塌"），不要抢 —— 
   * 场景提示比教学提示重要。 */
  if (Game.messageTimer > 0 && Game.message && Game.message !== T._myLastText) {
    /* 但如果是我们自己上次发的，可以覆盖 */
    if (!T._owned) return;
  }

  Game.message = best.text;
  Game.messageTimer = best.hold;
  T.lastMsgId = best.id;
  T.lastSeenAt[best.id] = now;
  T.seen[best.id] = true;
  T._myLastText = best.text;
  T._owned = true;

  /* 提示消失后释放"所有权"，让场景提示能正常接管 */
  setTimeout(function () { Game.tutorial && (Game.tutorial._owned = false); }, 200);
}

/* 对外接口（和 ACTIONS 一样的风格，方便以后单独摘掉） */
const TUTORIAL = {
  init: tutorialInit,
  update: updateTutorial,
  hints: TUTORIAL_HINTS,
};
