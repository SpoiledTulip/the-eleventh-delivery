/* ============================================================
 * save.js — 本地存档（进度 / 最佳用时 / 星数）
 * ============================================================
 * ★★ 2026-10-06 改版：存档从"全机一份"变成"每个账号一份" ★★
 * ------------------------------------------------------------
 * 十一的要求："为本机游戏设计一套本地账号与存档系统…支持在本机创建
 *              多个账号并在其间切换。"
 *
 * 【改了什么】原本存档 key 是一个写死的常量 `SAVE_KEY`，
 *   现在改成**函数** `saveKey()` —— 它去问账号模块"当前是谁在玩"，
 *   返回那个账号专属的 key（见下面 saveKey() 的实现）。
 *
 * 【为什么这是最小侵入的改法】
 *   全项目读存档都走 `SAVE()`（在 physics.js 里），
 *   而 `SAVE()` 返回的就是这个 `Save` 对象 —— 也就是说：
 *   **只要这个对象的读写路径认得账号，全项目自动隔离**，
 *   17 个调用点**一行都不用改**。
 *
 * 【未登录怎么办】
 *   账号模块会给一个"游客档"key 兜底（不返回 null），
 *   保证"顺手存一下"的调用点永远不会炸。
 *   而"未登录不能开跑"由 UI 层拦住（见 ui.js 的开始跑单按钮）。
 *
 * 【旧存档怎么办】（灾难级红线）
 *   无账号时代的老档存在 LEGACY_SAVE_KEY（'delivery-game-save-v1'）。
 *   玩家**第一个**账号注册时会被自动"认领"过去
 *   （见 account.js 的 adoptLegacySave）—— 进度一点都不丢。
 * ------------------------------------------------------------
 * 数据损坏怎么办：
 *   localStorage 可能被用户手动改、被浏览器策略清掉、跨版本结构变了。
 *   所以每次读取都做**校验 + 兜底**，坏了就当作全新存档，
 *   绝不让存档问题导致游戏打不开。
 * ============================================================ */

/* 旧版 key：无账号时代的存档就存在这里。
 * ⚠️ 保留这个常量是有意的 —— 迁移逻辑要读它。
 *    现在**不再往里写**，只可能被读一次然后清掉。
 *    （真正在用的 key 由 saveKey() 动态算） */
const SAVE_KEY_LEGACY = 'delivery-game-save-v1';

/* ============================================================
 * ★ 当前存档 key ★
 * ============================================================
 * 这个函数是整个"多账号"改造的**唯一开关**。
 *
 * 逻辑很朴素：
 *   · 账号模块在 → 问它要 key（已登录 = 该账号专属；未登录 = 游客档）
 *   · 账号模块不在（比如某些离线测试只加载了 save.js）→ 退回旧 key
 *
 * ⚠️ 最后那个兜底分支很重要：**它保证了"删掉 account.js 游戏照常能玩"**。
 *    这是项目一贯的规矩（新功能独立封装，删掉能退回原版），
 *    也让所有已有的存档测试**不用改就能继续跑**。
 * ============================================================ */
function saveKey() {
  try {
    if (typeof ACCOUNT !== 'undefined' && ACCOUNT && typeof ACCOUNT.saveKey === 'function') {
      const k = ACCOUNT.saveKey();
      if (typeof k === 'string' && k) return k;
    }
  } catch (e) { /* 账号模块出问题 → 退回旧行为，绝不让存档读不出来 */ }
  return SAVE_KEY_LEGACY;
}

/* ============================================================
 * ★ 动作解锁表 ★
 * ============================================================
 * 设计意图：**动作要一个一个学，不是一开始全给。**
 *
 *   一口气把所有动作摊给玩家，等于没有教学 ——
 *   玩家会跳过简单动作直奔"最酷的"，然后在需要基础动作的地方卡住，
 *   而且不知道卡住的原因。逐步解锁能让每个动作都有"被学会"的时刻。
 *
 * 解锁规则：**通关第 N 关 → 解锁对应的动作，且永久保留**
 *   （存在存档里，之后玩任何关卡都能用）
 *
 * 表格含义：
 *   afterLevel —— 通关第几关后解锁（1 起算，和存档的 key 一致）
 *   id         —— 动作标识（各处统一用这个字符串判断）
 *   name       —— 中文名（教学提示/说明页用）
 *   unlockMsg  —— 解锁时的提示语
 *   hintKeys   —— 怎么按（说明页用）
 * ============================================================ */
const ACTION_UNLOCKS = [
  {
    id: 'doublejump',
    afterLevel: 1,
    name: '二连跳',
    hintKeys: '空中再按一次跳跃键',
    unlockMsg: '解锁「二连跳」—— 空中再按一次跳跃键',
  },
  {
    id: 'wallslide',
    afterLevel: 2,
    name: '贴墙滑行',
    hintKeys: '空中碰到墙自动触发',
    unlockMsg: '解锁「贴墙滑行」—— 空中贴住墙面会缓慢下滑',
  },
  {
    id: 'walljump',
    afterLevel: 3,
    name: '墙跳',
    hintKeys: '贴墙时按跳跃键',
    unlockMsg: '解锁「墙跳」—— 贴墙时按跳跃键，朝墙外弹出去',
  },
  {
    id: 'dash',
    afterLevel: 4,
    name: '八方冲刺',
    hintKeys: 'Z + 方向键',
    unlockMsg: '解锁「八方冲刺」—— 按住 F 再按方向键，八个方向都能冲（冷却5秒）',
  },
];

/* 存档结构（v2）：
 * {
 *   version: 2,
 *   maxUnlocked: 1,              // 已解锁到第几关（1 起算，= 通关数 + 1）
 *   unlockedActions: ["doublejump", ...],   // 已解锁的动作
 *   levels: {
 *     "1": { bestTime: 32.45, bestStars: 3, bestCoins: 18, cleared: true },
 *     ...
 *   },
 *   // ---- v2 新增：角色系统 ----
 *   selectedCharacter: 'kangaroo',       // 当前选中的角色 id
 *   unlockedCharacters: ['kangaroo', 'dragon'],
 *   characterRecords: {                  // 每角色的分项记录
 *     kangaroo: {
 *       uses: 3,                         // 使用次数
 *       levels: { "1": { bestTime: 28.1 } }   // 该角色每关最佳用时
 *     }
 *   },
 *   seenUnlockAnimations: ['capybara'],  // 已播过解锁动画的角色（不重复播）
 *   // ---- v2 新增：设置 ----
 *   settings: {
 *     soundOn: true, volume: 0.7, hintsOn: true, shakeOn: true
 *   }
 * }
 *
 * ★ 兼容原则（非常重要，改之前先读）★
 *   旧档（v1）没有上面这些字段。升级时**必须补默认值**，
 *   绝不能因为"字段不存在"就把存档整体丢弃 ——
 *   那会清掉玩家已经通关的进度，是灾难性的。
 */
const SAVE_VERSION = 2;

/* 设置的默认值。单独抽出来，因为"读档兜底"和"清档重置"都要用它，
 * 写两份迟早会不一致。 */
/* ============================================================
 * ★ 手机虚拟按键的大小倍率（2026-10-07 十一要求）★
 * ============================================================
 * 十一原话："设置里面可以加大按键，或者是调小按键，
 *           根据自己的使用习惯去调整按键大小。"
 *
 * 【值域为什么是 0.7 ~ 1.5】
 *   · < 0.7：按钮小到手指点不准（76px × 0.7 = 53px，已接近拇指极限）
 *   · > 1.5：跳跃键会变成 144px，在 720p 横屏上直接糊住半个屏幕
 *   ⇒ 这是"能用"的区间，超出就没有使用价值了。
 * ⚠️ 改这两个值时，同步改设置页滑块的 min/max（ui.js）。
 * ============================================================ */
const PAD_SCALE_MIN = 0.7;
const PAD_SCALE_MAX = 1.5;

/* ============================================================
 * ★★ 2026-10-07 新增：按键灵敏度（十一要求）★★
 * ============================================================
 * 十一原话："然后提高这个手机版的灵敏度，就是按钮的灵敏度。"
 *
 * 【"灵敏度"到底指什么 —— 先把它翻译成能改的东西】
 *   触屏按钮的"不灵敏"在体感上有两种，必须分清楚，
 *   因为一种能靠参数解决、另一种只能靠代码修：
 *
 *   ① **响应延迟 / 断触**（这次真修的是这个）
 *      手指按住不放，角色却走走停停；或者按下去要"等一下"才动。
 *      根因是 **松开判定太激进**（pointerleave）和
 *      **一松手就把速度清零**。⇒ 已在 game.js 的 TouchPad
 *      和物理层分别处理，**与这个设置项无关**。
 *
 *   ② **手感偏"肉"** —— 按了要推一会儿才有速度感
 *      根因是加速度 `CONFIG.RUN_ACCEL` 偏小（0.7/帧）。
 *      ⚠️ **这个必须做成可调项，不能直接改 physics.js**
 *        —— 项目红线：物理参数不许动数值（会连锁影响
 *        可达性模型、墙跳距离、第 13~20 关的坑宽设计）。
 *      ⇒ 做法：**在输入层加一个"提前量"倍率**，
 *        只在"按住方向键时"多给一点点 vx，不碰 CONFIG。
 *
 * 【值域 0.6 ~ 1.6，默认 1】
 *   1 = 完全按原来的手感（等于没开这个设置）。
 *   < 1 更"稳"（起步慢、精细，适合走窄台）；
 *   > 1 更"跟手"（起步快，但冲过头风险大）。
 *   ⇒ 给了双向，因为"灵敏度"不是越高越好，是**顺不顺手**。
 *   ⚠️ 上限 1.6 是红线：再往上等于偷偷改 RUN_ACCEL，
 *      会让"跑两步就冲进坑里"，体验崩坏。
 * ============================================================ */
const PAD_SENS_MIN = 0.6;
const PAD_SENS_MAX = 1.6;

function defaultSettings() {
  return {
    soundOn: true,
    volume: 0.7,
    hintsOn: true,     // 操作提示（游戏内浮字教学）
    shakeOn: true,     // 屏幕震动
    /* ★★ 2026-10-07 新增：手机虚拟按键的大小倍率（十一要求）★★
     * ------------------------------------------------------------
     * 十一原话："设置里面可以加大按键，或者是调小按键，
     *           根据自己的使用习惯去调整按键大小。"
     *
     * 【为什么是"倍率"而不是"像素值"】
     *   手机屏幕尺寸千差万别（4.7 寸 ~ 7 寸、720p ~ 2K）。
     *   写死像素值必然在某些机型上过大/过小。
     *   倍率 × 基准尺寸（CSS 里的 `--tp-scale`）能自适应任何屏。
     *
     * 【值域】0.7 ~ 1.5，默认 1。
     *   ⚠️ 读的时候必须夹紧（见 settings()），防止手改存档塞进怪值
     *     把按钮撑爆（比如 99）或缩成 0（那就点不到了）。
     * 【只对手机模式有意义】电脑模式不显示虚拟按键，这个值不起作用。
     * ------------------------------------------------------------ */
    padScale: 1,
    /* ★★ 2026-10-07 新增：虚拟按键的位置微调（十一要求）★★
     * ------------------------------------------------------------
     * 十一原话："按键的位置也是需要根据使用习惯去调节，
     *           比如说习惯用左手还是习惯用右手那种。不过应该不需要
     *           做得特别精细，就是大概的位置就行。"
     *
     * 【为什么不给"随便拖到任意位置"】
     *   十一自己说了"不需要特别精细、大概位置就行"。
     *   自由拖拽会带来一堆麻烦（拖出屏幕/按钮重叠/存一堆坐标），
     *   而**档位**已经能覆盖"左撇子 / 右撇子 / 手握位置"这些真实需求。
     *
     * 【三个档位，各自独立】
     *   · `padSide`   —— 整体左右：'left' | 'center' | 'right'
     *     决定"操作区整体靠哪边"（左撇子把方向键换到右边用）
     *   · `padHeight` —— 整体高低：'low' | 'mid' | 'high'
     *     手握位置高的人（小手/大屏）需要按钮更高
     *   · `padSpread` —— 左右分得开不开：'tight' | 'normal' | 'wide'
     *     手小的人希望方向键和跳/冲离得近一点
     *
     * ⚠️ 值域必须和 ui.js 的选项表**逐字一致**，读的时候要校验
     *   （见 settings()），非法值直接退回默认档 —— 否则手改存档
     *   塞个 `'xxx'` 会让 CSS 变量算不出来，按钮位置整个塌掉。
     * ------------------------------------------------------------ */
    padSide: 'center',
    padHeight: 'mid',
    padSpread: 'normal',

    /* ★★ 2026-10-07 新增：按键灵敏度（十一要求）★★
     * 见文件上方 PAD_SENS_MIN/MAX 的说明。
     * 1 = 原手感；> 1 跟手；< 1 精细。 */
    padSensitivity: 1,

    /* ★★ 2026-10-07 新增：按键自由摆放（十一要求）★★
     * ------------------------------------------------------------
     * 十一原话："我想可以自己去调这个位置，这个按钮的位置，
     *           而不是上面写偏左偏右。"
     *
     * 【和上面三个档位的关系】
     *   档位（padSide/padHeight/padSpread）是**粗调**、是默认值；
     *   这个字段是玩家**亲手拖动**后的精细坐标。
     *   · `padCustomPos === null` ⇒ 用档位（默认，等于没自定义过）
     *   · 一旦玩家在"调整按键"编辑器里拖动过 ⇒ 存成对象
     *
     * 【结构】按"动作名"存**左上角坐标**（单位 px，相对屏幕左下角，
     *   和 CSS 的 left/bottom 同一坐标系）：
     *     { left: {x, y}, right: {x, y}, jump: {x, y}, ... }
     *   ⚠️ 用**动作名**而不是元素 class —— 动作名是稳定的语义键，
     *      以后改样式/改类名不会把玩家的自定义位置搞丢。
     *   ❌ 不存 vw/vh 百分比：手机旋转后比例会漂，px 才是所见即所得。
     *
     * ⚠️ 读的时候必须逐键校验（`padCustomOf()`）——
     *    手改存档塞 `{left:{x:"abc"}}` 会让 CSS 算出 NaN，
     *    按钮位置整个塌掉（`calc(... * NaN)` 是非法值）。
     * ------------------------------------------------------------ */
    padCustomPos: null,
    /* 玩家自定义过按键大小/位置后，是否隐藏"档位"那几行
     * （避免"我明明拖过了，档位还显示居中"的困惑） */
    padUseCustom: false,
  };
}

/* ============================================================
 * ★ 按键自定义位置：校验与读取（2026-10-07 新增）
 * ============================================================
 * 唯一真相源就是存档里的 `padCustomPos`。这里的职责是
 * **把脏数据洗干净**，让上层（game.js / ui.js）永远拿到
 * 合法数值 —— 上层绝不做 -0.5 / NaN / 超屏的判断。
 *
 * 【为什么要夹紧而不是"非法就丢掉"】
 *   玩家辛苦拖好的位置，不该因为一次手改存档、或者
 *   在旧版本上存过（屏幕尺寸不同）就整个丢失。
 *   ⇒ 能修就修（夹回屏幕内），实在修不了（类型都不对）才退回 null。
 * ============================================================ */
const PAD_CUSTOM_ACTIONS = ['left', 'right', 'down', 'jump', 'dash'];
/* 位置合法范围（px）。⚠️ 上限故意留得比屏幕大 ——
 * 因为这里不知道屏幕尺寸，真正的"别超出屏幕"由 ui.js 的
 * 编辑器按当前窗口尺寸夹紧（那里才拿得到 innerWidth/innerHeight）。 */
const PAD_CUSTOM_MIN = -400;
const PAD_CUSTOM_MAX = 4000;

/** 清洗单个坐标；非法返回 null（调用方决定退回默认） */
function padCustomNum(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Math.max(PAD_CUSTOM_MIN, Math.min(PAD_CUSTOM_MAX, Math.round(n)));
}

/**
 * 取某个动作的自定义坐标。
 * @returns {{x:number,y:number}|null} null = 该键没自定义过，用档位/默认布局
 */
function padCustomOf(action) {
  let raw = null;
  try {
    if (typeof SAVE === 'function') raw = SAVE().settings().padCustomPos;
  } catch (e) { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const item = raw[action];
  if (!item || typeof item !== 'object') return null;
  const x = padCustomNum(item.x), y = padCustomNum(item.y);
  if (x === null || y === null) return null;
  return { x: x, y: y };
}

/** 是否**任何一个**键被自定义过（编辑器用：决定显示"重置"按钮） */
function padHasCustom() {
  for (let i = 0; i < PAD_CUSTOM_ACTIONS.length; i++) {
    if (padCustomOf(PAD_CUSTOM_ACTIONS[i])) return true;
  }
  return false;
}

/**
 * 清洗整份自定义坐标表（存档升级 / setSetting 时调用）。
 *
 * 【为什么要"逐键清洗"而不是整体判断】
 *   项目红线：**坏一项只修那一项，绝不整体丢弃**。
 *   比如玩家拖好了 5 个键，结果 jump 的 y 被手改成一个字符串 ——
 *   正确做法是只丢 jump、另外 4 个留住，
 *   而不是"发现一处脏就把玩家的劳动全删了"。
 *
 * @returns {object|null} null = 一个有效键都没有（等于没用过自定义）
 */
function sanitizePadCustom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  let any = false;
  PAD_CUSTOM_ACTIONS.forEach(function (a) {
    const item = raw[a];
    if (!item || typeof item !== 'object') return;
    const x = padCustomNum(item.x), y = padCustomNum(item.y);
    if (x === null || y === null) return;      // 只丢这一个键
    out[a] = { x: x, y: y };
    any = true;
  });
  return any ? out : null;
}

/* ---- 按键位置：档位 → 数值（**唯一真相源**）----
 * 单位是"基准 px"，会写进 CSS 变量。
 * ⚠️ ui.js 的按钮文字必须和这里的 key 一一对应。 */
const PAD_POS_DEFAULT = { side: 'center', height: 'mid', spread: 'normal' };

const PAD_POS = {
  /* 左右：整体平移量。正数=往右，负数=往左 */
  side: { left: -150, center: 0, right: 150 },
  /* 高低：整体上下平移。正数=往上（bottom 变大） */
  height: { low: -14, mid: 0, high: 46 },
  /* 分开程度：左右两组各自的"向外扩张量"，正数=互相远离 */
  spread: { tight: -34, normal: 0, wide: 40 },
};

/** 校验档位值；非法（手改存档/老存档缺字段）一律退回默认 */
function padPosOf(key, val) {
  const table = PAD_POS[key];
  if (!table) return 0;
  return (typeof table[val] === 'number') ? table[val] : (table[PAD_POS_DEFAULT[key]] || 0);
}

/* ============================================================
 * ★ 游玩模式（经典 / 骑手）（2026-10-06 扩展方案第 2 期）★
 * ============================================================
 * 方案第一节的核心决策：
 *   "同一套关卡、同一套物理、同一套角色。区别只在'计分规则'
 *    和'有没有计时器'。"
 *
 *   · 经典模式（classic）→ 只看订单收集率（= 现在的 calcStars）
 *   · 骑手模式（rider）  → 综合"时间 + 好评率"（= calcStarsRider）
 *
 * ⚠️ 这个字段只影响**结算和 HUD 显示**，不影响关卡内容、
 *    不影响物理、不影响能不能过关。
 *
 * ⚠️ 值域必须是 'classic' | 'rider' 之一 ——
 *    读档时会做白名单校验（见 load），非法值一律退回 'classic'。
 *    为什么默认经典：老玩家升级上来时不该被突然塞一个"有时限"的模式，
 *    保持他们熟悉的手感（放松优先）。
 * ============================================================ */
const GAME_MODES = ['classic', 'rider'];
const DEFAULT_GAME_MODE = 'classic';

/* 模式的中文名（UI 各处共用，避免"经典/经典模式/Classic"三种写法混用） */
function gameModeName(mode) {
  return (mode === 'rider') ? '骑手模式' : '经典模式';
}

/* ============================================================
 * ★ E3 神秘订单（2026-10-06 第 7 期，**只做单人版**）★
 * ============================================================
 * 方案原文：
 *   "接单界面偶尔出现紫色神秘订单，条件怪但奖励高……
 *    完成后解锁特殊称号"
 *   "⚠️ 明确不做：涉及双人的版本（双人怎么判定？**先只做单人**）"
 *
 * ⇒ 所以这里：
 *   · 只在单人模式出现（game.js 里会判断）
 *   · 条件全部是"单人可判定"的
 *   · 不碰 net.js（联机四舍五入等于没有这个功能）
 *
 * 【什么是"神秘订单"】
 *   给某一关附加一条**额外挑战条件**（比如"不许碰到任何订单袋"），
 *   做到就解锁一个称号。
 *
 * ⚠️ 关键：神秘订单**只是加分挑战，不影响过关**。
 *    做不到也一样能通关（只是拿不到那个称号）——
 *    这条又一次呼应"放松优先"：挑战是"锦上添花"，不是"惩罚"。
 * ============================================================ */
const MYSTERY_ORDERS = [
  {
    id: 'no_pickup',
    /* 挑战关卡下标（0 起算）：第 1 关最容易达成，适合做第一个神秘单 */
    levelIndex: 0,
    name: '神秘订单 · 洁癖客户',
    condition: '全程不碰到任何订单袋，照样送到',
    title: '一单未取',
    /* ⚠️ 难度提示：第 1 关订单袋不多，绕开是可能的（有测试保证可达性） */
  },
  {
    id: 'all_pickup',
    levelIndex: 1,
    name: '神秘订单 · 大胃王',
    condition: '把第 2 关的订单全部收齐',
    title: '有求必应',
  },
  {
    id: 'no_damage',
    levelIndex: 2,
    name: '神秘订单 · 零差评',
    condition: '全程不挨打（好评率保持 100%）',
    title: '金身不破',
  },
];

/* 按关卡下标找神秘订单（没有就返回 null）。
 * ⚠️ 单人专用 —— 调用方要先确认是单人模式。 */
function mysteryOrderForLevel(levelIndex) {
  for (let i = 0; i < MYSTERY_ORDERS.length; i++) {
    if (MYSTERY_ORDERS[i].levelIndex === levelIndex) return MYSTERY_ORDERS[i];
  }
  return null;
}

/* ============================================================
 * ★ 全局成就（2026-10-06 新增，把成就从 3 个补到 9 个）★
 * ============================================================
 * 十一的原话："加一项刚刚的工作，候选成就清单补到 8~10 个"。
 *
 * 【为什么要单独一张表，不塞进 MYSTERY_ORDERS】
 *   `MYSTERY_ORDERS` 的结构是**"每关一条"**（靠 `levelIndex` 一对一），
 *   而"跑完全程""三星全收"这类是**跨关卡的全局成就**，不属于某一关。
 *   硬塞进去要改 `mysteryOrderForLevel()` 的语义，风险大。
 *   ⇒ 独立一张表，成就页把两张表**合并展示**（顺序：神秘订单在前）。
 *
 * 【每条要有什么】
 *   · `id`        —— 唯一标识（别和 MYSTERY_ORDERS 的 id 撞）
 *   · `title`     —— 称号名（**就是存进 `Save.data.titles` 的那个字符串**）
 *   · `condition` —— 给玩家看的条件文字（未解锁时也要显示，方案 A）
 *   · `check(s)`  —— 判定函数。参数 `s` 是"当前存档快照"，
 *                    返回 true = 已达成。**通关后统一跑一遍**。
 *   · `progress(s)`（可选）—— 返回 {now, total}，成就页会显示"5 / 20"这种进度。
 *
 * ⚠️⚠️ 绝不能做的事：
 *   · 不要用 `check` 去改存档 —— 它只读不写。写只发生在 `addTitle()`。
 *   · 不要把成就做成"不达成就不让过关" —— 成就永远是**锦上添花**。
 *
 * 【判定函数拿到的快照 s 长这样】
 *   s.clearedCount   已通关的不同关卡数
 *   s.levelCount     关卡总数
 *   s.levels         { "1": {bestStars, bestTime, bestCoins, cleared}, ... }
 *   s.charRecords    characterRecords（每角色的使用统计）
 *   s.readyChars     已制作的角色 id 列表（用来算"换着骑"的分母）
 * ============================================================ */
const GLOBAL_ACHIEVEMENTS = [
  {
    id: 'g_first_order',
    title: '开张大吉',
    condition: '完成第一单配送',
    check: function (s) { return s.clearedCount >= 1; },
    progress: function (s) { return { now: Math.min(s.clearedCount, 1), total: 1 }; },
  },
  {
    id: 'g_all_cleared',
    title: '单王',
    condition: '把全部关卡的订单都送到',
    check: function (s) { return s.clearedCount >= s.levelCount; },
    progress: function (s) { return { now: s.clearedCount, total: s.levelCount }; },
  },
  {
    id: 'g_all_stars',
    title: '五星骑手',
    condition: '每一单都拿到三星',
    check: function (s) {
      /* 必须**先全通关**，否则"每一关都三星"会在只玩过 1 关时就成立 */
      if (s.clearedCount < s.levelCount) return false;
      for (let n = 1; n <= s.levelCount; n++) {
        const lv = s.levels[String(n)];
        if (!lv || !lv.cleared || (lv.bestStars || 0) < 3) return false;
      }
      return true;
    },
    progress: function (s) {
      let n = 0;
      for (let i = 1; i <= s.levelCount; i++) {
        const lv = s.levels[String(i)];
        if (lv && (lv.bestStars || 0) >= 3) n++;
      }
      return { now: n, total: s.levelCount };
    },
  },
  {
    id: 'g_speed',
    title: '闪电骑手',
    condition: '任意一单在 30 秒内送达',
    check: function (s) {
      const ks = Object.keys(s.levels);
      for (let i = 0; i < ks.length; i++) {
        const t = s.levels[ks[i]].bestTime;
        if (typeof t === 'number' && t > 0 && t <= 30) return true;
      }
      return false;
    },
  },
  {
    id: 'g_loyal',
    title: '专一骑手',
    condition: '同一个骑手送达满 10 单',
    /* ⚠️ 字段是 `uses`（不是 clears）——
     *    `characterRecords[id].uses` 由 `SAVE().addCharUse()` 累加，
     *    而它**只在通关那一刻调用**（game.js 记录存档时），
     *    所以 `uses` 天然就是"这个骑手送达过几单"。 */
    check: function (s) {
      const ks = Object.keys(s.charRecords || {});
      for (let i = 0; i < ks.length; i++) {
        const r = s.charRecords[ks[i]];
        if (r && (r.uses || 0) >= 10) return true;
      }
      return false;
    },
    progress: function (s) {
      let best = 0;
      const ks = Object.keys(s.charRecords || {});
      for (let i = 0; i < ks.length; i++) {
        const r = s.charRecords[ks[i]];
        if (r && (r.uses || 0) > best) best = r.uses;
      }
      return { now: Math.min(best, 10), total: 10 };
    },
  },
  {
    id: 'g_variety',
    title: '换着骑',
    condition: '每个骑手都至少送达过一单',
    check: function (s) {
      if (!s.readyChars.length) return false;
      for (let i = 0; i < s.readyChars.length; i++) {
        const r = (s.charRecords || {})[s.readyChars[i]];
        if (!r || (r.uses || 0) < 1) return false;
      }
      return true;
    },
    progress: function (s) {
      let n = 0;
      for (let i = 0; i < s.readyChars.length; i++) {
        const r = (s.charRecords || {})[s.readyChars[i]];
        if (r && (r.uses || 0) >= 1) n++;
      }
      return { now: n, total: s.readyChars.length };
    },
  },
  {
    id: 'g_veteran',
    title: '全勤标兵',
    condition: '累计送达 20 单',
    check: function (s) { return s.totalClears >= 20; },
    progress: function (s) { return { now: Math.min(s.totalClears, 20), total: 20 }; },
  },
];

/* 把存档里能用到的数据摘成一个"快照"，喂给上面那些 check / progress。
 *
 * ⚠️ 为什么要摘快照而不是让 check 直接读 Save.data：
 *    ① 判定函数更容易测（传个假快照就能测，不用起整个存档）
 *    ② 以后存档结构变了，只改这一处
 *    ③ 快照里已经算好 levelCount / readyChars 这类派生值，
 *       免得每个 check 自己重复算
 */
function achievementSnapshot() {
  const d = (Save && Save.data) ? Save.data : {};
  const levels = d.levels || {};
  const chars = d.characterRecords || {};
  /* 已制作的角色（"换着骑"的分母）。拿不到就退回已解锁的那两个。 */
  let readyChars = [];
  try {
    if (typeof CHARACTERS !== 'undefined' && Array.isArray(CHARACTERS)) {
      readyChars = CHARACTERS.filter(function (c) { return c && c.ready !== false; })
        .map(function (c) { return c.id; });
    }
  } catch (e) { readyChars = []; }
  if (!readyChars.length) {
    readyChars = (d.unlockedCharacters || []).slice();
  }
  /* 关卡总数：拿不到就用已解锁的最高关数兜底 */
  let levelCount = 0;
  try {
    levelCount = (typeof LEVELS !== 'undefined' ? LEVELS.length : 0) +
      (typeof LEVELS_EXTRA !== 'undefined' ? LEVELS_EXTRA.length : 0);
  } catch (e) { levelCount = 0; }
  if (!levelCount) levelCount = Math.max(1, d.maxUnlocked || 1);

  /* 累计送达单数 = 各角色 `uses` 之和。
   * ⚠️ 不能用 Object.keys(levels).length —— 那是"不同关卡数"，
   *    重玩同一关不会增加，但"累计 20 单"要算重复送达的。 */
  let totalClears = 0;
  Object.keys(chars).forEach(function (k) {
    const r = chars[k];
    if (r && typeof r.uses === 'number' && r.uses > 0) totalClears += r.uses;
  });
  /* 兜底：万一角色记录没写（老档 / 联机局 / 早期存档），
   *       退回"已通关卡数"—— 宁可少算，也不能显示成 0 让人以为坏了。 */
  if (!totalClears) {
    Object.keys(levels).forEach(function (k) {
      if (levels[k] && levels[k].cleared) totalClears++;
    });
  }

  let clearedCount = 0;
  Object.keys(levels).forEach(function (k) {
    if (levels[k] && levels[k].cleared) clearedCount++;
  });

  return {
    levels: levels,
    charRecords: chars,
    readyChars: readyChars,
    levelCount: levelCount,
    clearedCount: clearedCount,
    totalClears: totalClears,
  };
}

/* ★ 通关后统一跑一遍全局成就判定 ★
 * 返回**本次新解锁的称号名数组**（可能为空）。
 * 每解锁一个就 addTitle（它内部会去重）。
 */
function checkGlobalAchievements() {
  const out = [];
  const snap = achievementSnapshot();
  GLOBAL_ACHIEVEMENTS.forEach(function (a) {
    try {
      if (Save.hasTitle(a.title)) return;      // 已经拿过，跳过
      if (a.check(snap)) {
        if (Save.addTitle(a.title)) out.push(a.title);
      }
    } catch (e) {
      /* 单个成就判定出错不能影响通关 —— 静默跳过这一个。
       * ⚠️ 这里刻意不用 console.error 刷屏，通关流程更重要。 */
    }
  });
  return out;
}

/* 成就总数（神秘订单 + 全局），成就页的"已达成 N / M"用它 */
function achievementTotal() {
  return MYSTERY_ORDERS.length + GLOBAL_ACHIEVEMENTS.length;
}

const Save = {
  /* ⚠️ 初始值必须是"合法的空存档"，不能是 null。
   * 踩过的坑：一开始写 `data: null`，结果 initGame() 之前若有代码读了
   * `Save.data.maxUnlocked` 就会 TypeError 把游戏带崩
   * （比如初始化是异步的，UI 先一步渲染了）。
   * 现在即使 load() 还没被调用，读到的也是一个能用的空档。 */
  data: {
    version: SAVE_VERSION,
    maxUnlocked: 1, unlockedActions: [], levels: {},
    selectedCharacter: 'kangaroo', unlockedCharacters: ['kangaroo', 'dragon'],
    characterRecords: {}, seenUnlockAnimations: [],
    settings: defaultSettings(),
    mode: DEFAULT_GAME_MODE,      // 经典 / 骑手（第 2 期新增）
    titles: [],                   // 已解锁称号（第 7 期 E3 神秘订单）
    /* ★ 已兑换过的兑换码（2026-10-07）★
     * 用途：同一个码只能兑一次（否则能反复点、把奖励刷爆）。 */
    redeemedCodes: [],
    /* ★ 最近用过的角色 id（最近的排前面）—— 2026-10-06 加 ★
     * 用途：选骑手页顶部只展示「最常用的 4 个」。
     * ⚠️ 只看 uses 次数不够 —— 玩家上周常玩袋鼠、这周改玩猴子，
     *    「最近」才是他真正想看的。所以单独记一个顺序表。 */
    recentChars: [],
  },

  /* ============================================================
   * ★★ 作者账号特权同步（2026-10-07 十一要求）★★
   * ============================================================
   * 十一："我希望这个账号能做到，每次更新作者账号可以同步更新
   *        所有的关卡和角色。"
   *
   * ------------------------------------------------------------
   * 【它做的事：每次读档时，把"当前已发布的全部内容"补给作者账号】
   * ------------------------------------------------------------
   *   · 全角色：`CHARACTERS` 里所有 `ready:true` 的，一个不漏
   *   · 全动作：冲刺 / 二段跳 / 墙跳 / 滑墙
   *   · 全关卡：`maxUnlocked` 顶到"当前关卡总数"
   *             （**动态算**，所以以后加了新关卡也自动跟上）
   *
   * ------------------------------------------------------------
   * 【为什么是"同步"而不是"发一次"】
   * ------------------------------------------------------------
   *   只在注册时发一次 → **每次加新内容都得手动删号重建**。
   *   放进读档流程 → 加多少、什么时候加，都自动跟上。
   *
   * ------------------------------------------------------------
   * 【幂等性（重要）】
   * ------------------------------------------------------------
   *   这个函数会被**每次读档**调用，所以必须**只补缺的、不重复加**：
   *     · 角色：用 indexOf 判断，已解锁的跳过
   *     · 关卡：只在"当前值 < 总数"时才更新
   *   这样反复调用结果完全一样，也不会把存档越写越大。
   *
   * ------------------------------------------------------------
   * 【软依赖：拿不到账号模块就静默跳过】
   * ------------------------------------------------------------
   *   save.js 是底层模块，测试里常常不加载 account.js。
   *   所以这里全程 `typeof` 检查 —— 缺模块时**什么都不做**，
   *   绝不让读档失败（存档读取是全游戏最关键的一条路径）。
   * ============================================================ */
  syncAuthorPerks: function (data) { return syncAuthorPerks(data); },

  /* ---------------- 读 ---------------- */
  load: function () {
    const fresh = function () {
      return {
        version: SAVE_VERSION,
        maxUnlocked: 1, unlockedActions: [], levels: {},
        selectedCharacter: 'kangaroo',
        unlockedCharacters: defaultUnlockedChars(),
        characterRecords: {},
        seenUnlockAnimations: [],
        settings: defaultSettings(),
        mode: DEFAULT_GAME_MODE,      // 经典 / 骑手（第 2 期新增）
        titles: [],                   // 已解锁称号（第 7 期 E3）
        redeemedCodes: [],            // 已兑换的码（2026-10-07）
        recentChars: [],
      };
    };
    try {
      const raw = (typeof localStorage !== 'undefined')
        ? localStorage.getItem(saveKey())
        : null;
      if (!raw) { this.data = fresh(); return this.data; }

      const parsed = JSON.parse(raw);
      // 结构校验：任何一个字段不对，就整体丢弃重来（不尝试"修复半截数据"，
      // 那样更容易留下奇怪的中间状态）
      if (!parsed || typeof parsed !== 'object') { this.data = fresh(); return this.data; }
      if (typeof parsed.maxUnlocked !== 'number' || parsed.maxUnlocked < 1) {
        this.data = fresh(); return this.data;
      }
      if (!parsed.levels || typeof parsed.levels !== 'object') parsed.levels = {};

      /* ---- 动作解锁：兼容旧存档 ----
       * 旧存档没有 unlockedActions 字段。
       * **不能**直接当成"全都没解锁" —— 那会让已经玩到后期的玩家
       * 突然发现自己不会滑墙了（体验灾难）。
       * 正确做法：**按已通关进度补全** ——
       * 已经通关过的关对应动作，视为早就解锁了。 */
      if (!Array.isArray(parsed.unlockedActions)) parsed.unlockedActions = [];
      parsed.unlockedActions = parsed.unlockedActions.filter(function (id) {
        return ACTION_UNLOCKS.some(function (u) { return u.id === id; });
      });

      // 按"已通关数"补全缺失的解锁（只增不减）
      let clearedNum = 0;
      Object.keys(parsed.levels).forEach(function (k) {
        if (parsed.levels[k] && parsed.levels[k].cleared) {
          const n = parseInt(k, 10);
          if (!isNaN(n) && n > clearedNum) clearedNum = n;
        }
      });
      ACTION_UNLOCKS.forEach(function (u) {
        if (u.afterLevel <= clearedNum &&
            parsed.unlockedActions.indexOf(u.id) < 0) {
          parsed.unlockedActions.push(u.id);
        }
      });
      /* 兜底：如果 maxUnlocked 已经超过某个动作的门槛，
       * 说明玩家进度早就到了，也该解锁（防止 maxUnlocked 和 levels 不同步） */
      const progressLevel = (parsed.maxUnlocked || 1) - 1;
      ACTION_UNLOCKS.forEach(function (u) {
        if (u.afterLevel <= progressLevel &&
            parsed.unlockedActions.indexOf(u.id) < 0) {
          parsed.unlockedActions.push(u.id);
        }
      });

      // 逐关校验 + 补默认值
      Object.keys(parsed.levels).forEach(function (k) {
        const lv = parsed.levels[k];
        if (!lv || typeof lv !== 'object') { delete parsed.levels[k]; return; }
        if (typeof lv.bestTime !== 'number' || lv.bestTime <= 0) lv.bestTime = null;
        if (typeof lv.bestStars !== 'number') lv.bestStars = 0;
        lv.bestStars = Math.max(0, Math.min(3, Math.floor(lv.bestStars)));
        if (typeof lv.bestCoins !== 'number') lv.bestCoins = 0;
        lv.cleared = !!lv.cleared;
      });

      /* ============================================================
       * ★ v1 → v2 升级：补角色与设置字段 ★
       * ============================================================
       * 旧档没有这些字段。原则是 **补齐默认值，绝不整体丢弃**。
       * 下面每一项都单独判断类型，某一项坏了只修那一项 ——
       * 一个角色的记录损坏不该让整个存档报废（更不该让游戏打不开）。
       * ============================================================ */

      // ---- 已解锁角色 ----
      if (!Array.isArray(parsed.unlockedCharacters)) {
        parsed.unlockedCharacters = [];
      }
      // 过滤掉配置表里不存在的 id（防止手改存档塞进奇怪的值）
      parsed.unlockedCharacters = parsed.unlockedCharacters.filter(function (id) {
        return !!charById(id);
      });
      // 默认角色必须始终在列表里（否则玩家会发现自己的初始角色没了）
      defaultUnlockedChars().forEach(function (id) {
        if (parsed.unlockedCharacters.indexOf(id) < 0) {
          parsed.unlockedCharacters.push(id);
        }
      });
      /* 按进度补全：如果玩家早就通关过某个解锁节点关卡，
       * 该角色应该视为已解锁（和动作解锁同一个道理 ——
       * 老玩家升级后不该突然失去角色）。 */
      const progressLevels = (parsed.maxUnlocked || 1) - 1;
      CHARACTERS.forEach(function (c) {
        if (c.ready && c.unlockLevel > 0 && c.unlockLevel <= progressLevels &&
            parsed.unlockedCharacters.indexOf(c.id) < 0) {
          parsed.unlockedCharacters.push(c.id);
        }
      });

      // ---- 当前选中角色 ----
      if (typeof parsed.selectedCharacter !== 'string' ||
          !charById(parsed.selectedCharacter) ||
          parsed.unlockedCharacters.indexOf(parsed.selectedCharacter) < 0) {
        // 选中了一个不存在/没解锁的角色 → 退回第一个可用的
        parsed.selectedCharacter = defaultUnlockedChars()[0] || 'kangaroo';
      } else if (!charIsReady(parsed.selectedCharacter)) {
        /* 选中了"未制作完成"的角色 —— 不能让它生效（会生成一个没有形象的家伙）。
         * 退回一个 ready 的默认角色。 */
        const ok = defaultUnlockedChars().filter(charIsReady);
        parsed.selectedCharacter = ok[0] || 'kangaroo';
      }

      // ---- 每角色记录 ----
      if (!parsed.characterRecords || typeof parsed.characterRecords !== 'object' ||
          Array.isArray(parsed.characterRecords)) {
        parsed.characterRecords = {};
      }
      Object.keys(parsed.characterRecords).forEach(function (id) {
        const rec = parsed.characterRecords[id];
        // 单条记录坏了就删这一条，不影响别的角色
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
          delete parsed.characterRecords[id];
          return;
        }
        if (typeof rec.uses !== 'number' || rec.uses < 0 || !isFinite(rec.uses)) rec.uses = 0;
        if (!rec.levels || typeof rec.levels !== 'object' || Array.isArray(rec.levels)) {
          rec.levels = {};
        }
        Object.keys(rec.levels).forEach(function (lk) {
          const lr = rec.levels[lk];
          if (!lr || typeof lr !== 'object') { delete rec.levels[lk]; return; }
          // 用时必须是正数，否则记为"没有记录"
          if (typeof lr.bestTime !== 'number' || lr.bestTime <= 0 || !isFinite(lr.bestTime)) {
            lr.bestTime = null;
          }
        });
      });

      // ---- 已播过解锁动画的角色 ----
      if (!Array.isArray(parsed.seenUnlockAnimations)) parsed.seenUnlockAnimations = [];
      parsed.seenUnlockAnimations = parsed.seenUnlockAnimations.filter(function (id) {
        return typeof id === 'string';
      });

      /* ---- 游玩模式（第 2 期新增）----
       * ⚠️ 旧档没有 mode 字段 —— 这里**只补默认值**，绝不丢弃存档。
       *    老玩家升级上来默认是"经典模式"，手感和他熟悉的一模一样。
       *    而且做了**白名单校验**：万一存档被人手改成 'whatever'，
       *    也退回 'classic'，不会让游戏进入一个不认识的模式。 */
      if (GAME_MODES.indexOf(parsed.mode) < 0) {
        parsed.mode = DEFAULT_GAME_MODE;
      }

      /* ---- 称号（第 7 期 E3 新增）----
       * 旧档没有 titles 字段 → 补一个空数组（只补默认值，不丢存档）。 */
      if (!Array.isArray(parsed.titles)) parsed.titles = [];
      parsed.titles = parsed.titles.filter(function (t) {
        return typeof t === 'string' && t.length > 0;
      });

      /* ============================================================
       * ★ 最近用过的角色（2026-10-06 新增 —— 选骑手页"常用 4 个"用）
       * ============================================================
       * ⚠️ 存档兼容是**灾难级红线**：老档没有这个字段是**正常的**，
       *    必须补一个能用的初值，**绝不能因此丢掉整个存档**。
       *
       * 【旧档怎么补】
       *   老档只有 `characterRecords[id].uses`（累计使用次数），
       *   没有"最近"这个概念。那就**按 uses 从多到少**排一个初始顺序 ——
       *   至少让"最常玩的那几个"排在前面，和玩家的直觉一致。
       *   uses 全为 0（新档）时，顺序就是"当前选中 + 已解锁顺序"。
       * ------------------------------------------------------------ */
      if (!Array.isArray(parsed.recentChars)) {
        const idOk = function (id) {
          return typeof id === 'string' && id && charById(id) &&
                 parsed.unlockedCharacters.indexOf(id) >= 0 &&
                 charIsReady(id);
        };
        /* 按 uses 次数降序，取已解锁且已制作的 */
        const ranked = parsed.unlockedCharacters.filter(idOk).slice().sort(function (a, b) {
          const ra = parsed.characterRecords[a] || {};
          const rb = parsed.characterRecords[b] || {};
          return (rb.uses || 0) - (ra.uses || 0);
        });
        /* 把"当前选中的"提到最前面（它最可能是玩家想用的） */
        const sel = parsed.selectedCharacter;
        if (ranked.indexOf(sel) > 0) {
          ranked.splice(ranked.indexOf(sel), 1);
          ranked.unshift(sel);
        } else if (ranked.indexOf(sel) < 0 && idOk(sel)) {
          ranked.unshift(sel);
        }
        parsed.recentChars = ranked;
      }
      /* 逐项清洗：坏 id / 已失效的 id 直接剔掉（只修这一项，不动别的） */
      parsed.recentChars = parsed.recentChars.filter(function (id) {
        return typeof id === 'string' && id && charById(id);
      });
      /* 去重（防止脏数据里同一个 id 出现两次） */
      parsed.recentChars = parsed.recentChars.filter(function (id, i, arr) {
        return arr.indexOf(id) === i;
      });

      // ---- 设置 ----
      if (!parsed.settings || typeof parsed.settings !== 'object' ||
          Array.isArray(parsed.settings)) {
        parsed.settings = defaultSettings();
      } else {
        const d = defaultSettings();
        // 逐项兜底：某一项类型不对就用默认值，不整块丢弃
        if (typeof parsed.settings.soundOn !== 'boolean') parsed.settings.soundOn = d.soundOn;
        if (typeof parsed.settings.shakeOn !== 'boolean') parsed.settings.shakeOn = d.shakeOn;
        if (typeof parsed.settings.hintsOn !== 'boolean') parsed.settings.hintsOn = d.hintsOn;
        if (typeof parsed.settings.volume !== 'number' || !isFinite(parsed.settings.volume)) {
          parsed.settings.volume = d.volume;
        }
        parsed.settings.volume = Math.max(0, Math.min(1, parsed.settings.volume));
      }

      /* ★ 作者特权同步：补缺的角色 / 动作 / 关卡（只补缺的，幂等）★
       * ⚠️ 返回值表示"这次有没有真的补东西"，用它决定要不要立刻写回 ——
       *    不写回的话每次读档都要重算一遍（虽然结果一样，但白费）。
       * ⚠️ 写回放在 `this.data = parsed` **之后**（见本函数末尾），
       *    因为 save() 读的是 this.data。 */
      let perksChanged = false;
      try {
        perksChanged = syncAuthorPerks(parsed);
      } catch (e) { /* 同步失败绝不该影响读档 */ }

      parsed.version = SAVE_VERSION;
      this.data = parsed;
      /* 补齐了东西才写回（正常普通账号走不到这里） */
      if (perksChanged) {
        try { this.save(); } catch (e) { /* 写失败不影响本次读到的东西 */ }
      }
      return this.data;
    } catch (e) {
      // localStorage 被禁用 / JSON 坏了 / 其他异常：一律当新档
      this.data = fresh();
      return this.data;
    }
  },

  /* ---------------- 写 ---------------- */
  save: function () {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(saveKey(), JSON.stringify(this.data));
      return true;
    } catch (e) {
      return false;   // 无痕模式 / 配额满：静默失败，不影响游戏
    }
  },

  /* ---------------- 查 ---------------- */
  levelInfo: function (levelIndex) {
    if (!this.data) this.load();
    const key = String(levelIndex + 1);
    return this.data.levels[key] || null;
  },

  /** 这一关解锁了没 */
  isUnlocked: function (levelIndex) {
    if (!this.data) this.load();
    return (levelIndex + 1) <= this.data.maxUnlocked;
  },

  /** 通关数 */
  clearedCount: function () {
    if (!this.data) this.load();
    let n = 0;
    const self = this;
    Object.keys(this.data.levels).forEach(function (k) {
      if (self.data.levels[k].cleared) n++;
    });
    return n;
  },

  /* ============================================================
   * ★ 动作解锁相关 ★
   * ============================================================ */

  /** 某个动作解锁了没
   * @param id  'doublejump' / 'wallslide' / 'walljump' / 'dash'
   *
   * ⚠️ 找不到这个 id 时返回 **true**（放行）。
   *    理由：解锁系统本身不该成为"动作失效"的原因。
   *    如果哪天动作表改名了、或存档字段没读出来，
   *    宁可让玩家能玩到，也不要莫名其妙被锁住。 */
  hasAction: function (id) {
    if (!this.data) this.load();
    /* 找不到定义 → 放行 */
    const known = ACTION_UNLOCKS.some(function (u) { return u.id === id; });
    if (!known) return true;
    const list = this.data.unlockedActions;
    if (!Array.isArray(list)) return false;   // 老数据的兜底（load 里会补齐）
    return list.indexOf(id) >= 0;
  },

  /** 已解锁的所有动作 id（说明页/调试用） */
  unlockedActions: function () {
    if (!this.data) this.load();
    return (this.data.unlockedActions || []).slice();
  },

  /** 手动解锁（调试 / 特殊模式用） */
  unlockAction: function (id) {
    if (!this.data) this.load();
    if (!Array.isArray(this.data.unlockedActions)) this.data.unlockedActions = [];
    if (this.data.unlockedActions.indexOf(id) < 0) {
      this.data.unlockedActions.push(id);
      this.save();
      return true;
    }
    return false;
  },

  /** 通关第 N 关后，该解锁哪些动作（返回新解锁的列表，供 UI 弹提示） */
  actionsUnlockedBy: function (levelIndex) {
    const levelNum = levelIndex + 1;
    return ACTION_UNLOCKS.filter(function (u) { return u.afterLevel === levelNum; });
  },

  /* ============================================================
   * ★ 角色系统相关 ★
   * ============================================================ */

  /** 当前选中的角色 id */
  selectedChar: function () {
    if (!this.data) this.load();
    const id = this.data.selectedCharacter;
    if (typeof id === 'string' && charById(id) && charIsReady(id) &&
        this.data.unlockedCharacters.indexOf(id) >= 0) {
      return id;
    }
    // 兜底：返回第一个已解锁且已完成的角色
    const ok = (this.data.unlockedCharacters || []).filter(charIsReady);
    return ok[0] || 'kangaroo';
  },

  /** 切换当前角色。未解锁/未完成的一律拒绝（返回 false） */
  setSelectedChar: function (id) {
    if (!this.data) this.load();
    if (!charIsReady(id)) return false;
    if (this.data.unlockedCharacters.indexOf(id) < 0) return false;
    this.data.selectedCharacter = id;
    /* ★ 顺手记进"最近用过"（2026-10-06 加）★
     * ------------------------------------------------------------
     * 【为什么记在"选中"而不是"通关"】
     *   选骑手页要展示的是"你最常用的 4 个"。
     *   而玩家的"想用谁"是在**点卡片那一刻**表达的 ——
     *   用 `uses`（通关次数）会导致"刚选了新角色、但还没通关"
     *   时它排不到前面，和直觉不符。
     *
     * ⚠️ 这里**不调用 this.save()** —— 上面那行已经存过盘了，
     *    再存一次纯属浪费（localStorage 是同步 IO）。
     *    顺序改成"先改字段、再统一 save"，所以把记录逻辑放在 save() 之前。
     * ------------------------------------------------------------ */
    this._touchRecentChar(id);
    this.save();
    return true;
  },

  /** 把某个角色挪到"最近用过"的最前面（内部方法） */
  _touchRecentChar: function (id) {
    if (!this.data) this.load();
    if (!Array.isArray(this.data.recentChars)) this.data.recentChars = [];
    const list = this.data.recentChars;
    const at = list.indexOf(id);
    if (at === 0) return;                  // 已经在最前面，不用动
    if (at > 0) list.splice(at, 1);
    list.unshift(id);
    /* 只保留最近的一小段就够了（选骑手页最多也只用前几个）——
     * 不设上限的话，玩久了这个数组会一直长。 */
    if (list.length > 20) list.length = 20;
  },

  /** 最近用过的角色 id（最近的在前）；调用方不要再改返回的数组 */
  recentChars: function () {
    if (!this.data) this.load();
    return Array.isArray(this.data.recentChars) ? this.data.recentChars.slice() : [];
  },

  /** 角色解锁了没 */
  hasChar: function (id) {
    if (!this.data) this.load();
    // 配置表里没有的角色：放行（和动作解锁同一个思路 ——
    // 解锁系统本身不该成为"角色不可用"的原因）
    if (!charById(id)) return true;
    return (this.data.unlockedCharacters || []).indexOf(id) >= 0;
  },

  /** 已解锁的角色 id 列表 */
  unlockedChars: function () {
    if (!this.data) this.load();
    return (this.data.unlockedCharacters || []).slice();
  },

  /**
   * 解锁一个角色（通关节点关卡时调用）。
   * @return true = 这次是新解锁的；false = 早就有了
   */
  unlockChar: function (id) {
    if (!this.data) this.load();
    const c = charById(id);
    if (!c || !charIsReady(id)) return false;      // 未制作的不解锁
    if (!Array.isArray(this.data.unlockedCharacters)) this.data.unlockedCharacters = [];
    if (this.data.unlockedCharacters.indexOf(id) >= 0) return false;
    this.data.unlockedCharacters.push(id);
    this.save();
    return true;
  },

  /** 某个角色的解锁动画播过了没 */
  hasSeenUnlockAnim: function (id) {
    if (!this.data) this.load();
    return (this.data.seenUnlockAnimations || []).indexOf(id) >= 0;
  },

  /** 标记解锁动画已播（避免重玩该关时重复播） */
  markUnlockAnimSeen: function (id) {
    if (!this.data) this.load();
    if (!Array.isArray(this.data.seenUnlockAnimations)) {
      this.data.seenUnlockAnimations = [];
    }
    if (this.data.seenUnlockAnimations.indexOf(id) < 0) {
      this.data.seenUnlockAnimations.push(id);
      this.save();
    }
  },

  /** 取某角色的记录（没有就现建一个空的，但**不落盘**） */
  charRecord: function (id) {
    if (!this.data) this.load();
    if (!this.data.characterRecords) this.data.characterRecords = {};
    const r = this.data.characterRecords[id];
    if (r && typeof r === 'object') return r;
    return { uses: 0, levels: {} };
  },

  /** 某角色在某关的最佳用时（没有返回 null） */
  charBestTime: function (id, levelIndex) {
    const rec = this.charRecord(id);
    const lr = rec.levels && rec.levels[String(levelIndex + 1)];
    return (lr && typeof lr.bestTime === 'number' && lr.bestTime > 0) ? lr.bestTime : null;
  },

  /** 记录角色使用次数 +1 */
  addCharUse: function (id) {
    if (!this.data) this.load();
    if (!charById(id) || !charIsReady(id)) return;
    if (!this.data.characterRecords) this.data.characterRecords = {};
    if (!this.data.characterRecords[id]) this.data.characterRecords[id] = { uses: 0, levels: {} };
    const rec = this.data.characterRecords[id];
    if (typeof rec.uses !== 'number') rec.uses = 0;
    rec.uses++;
    this.save();
  },

  /* ============================================================
   * ★ 设置相关 ★
   * ============================================================ */

  settings: function () {
    if (!this.data) this.load();
    if (!this.data.settings || typeof this.data.settings !== 'object') {
      this.data.settings = defaultSettings();
    }
    const s = this.data.settings;
    /* ★ 2026-10-07：老存档补默认值 + 夹紧（项目红线：只补默认值，绝不整体丢弃）
     * ------------------------------------------------------------
     * ① **补默认值**：升级前存的档没有 `padScale` 字段，
     *    不补的话读到 `undefined` ⇒ 喂给 CSS 变量变 NaN ⇒
     *    `calc(76px * NaN)` 非法 ⇒ **按钮尺寸整个塌掉**（血泪：
     *    这和当年 `input.maxLength = undefined → 0` 是同一类坑）。
     * ② **夹紧**：防止手改存档塞进 99（撑爆屏幕）或 0（点不到）。
     *    只修这一个字段，**不影响 settings 里的其他字段**。 */
    const ps = Number(s.padScale);
    s.padScale = (isFinite(ps) && ps > 0)
      ? Math.max(PAD_SCALE_MIN, Math.min(PAD_SCALE_MAX, ps))
      : 1;
    /* ★ 2026-10-07：按键位置档位同样"补默认 + 校验"★
     * 老存档没有这三个字段 ⇒ 读到 undefined ⇒ CSS 变量算不出 ⇒
     * 按钮位置整个塌掉。所以每个字段单独判，非法就退回默认档。 */
    ['side', 'height', 'spread'].forEach(function (k) {
      const field = 'pad' + k.charAt(0).toUpperCase() + k.slice(1);
      const tbl = PAD_POS[k];
      if (!tbl || !(s[field] in tbl)) s[field] = PAD_POS_DEFAULT[k];
    });
    /* ★ 2026-10-07：按键灵敏度补默认 + 夹紧（同一套规矩）★ */
    const sn = Number(s.padSensitivity);
    s.padSensitivity = (isFinite(sn) && sn > 0)
      ? Math.max(PAD_SENS_MIN, Math.min(PAD_SENS_MAX, sn))
      : 1;
    /* ★ 2026-10-07：自定义按键位置 —— 逐键清洗，坏键单独丢 ★
     * 老存档一定是 `undefined` ⇒ 补成 null（= 用档位布局）。 */
    s.padCustomPos = sanitizePadCustom(s.padCustomPos);
    s.padUseCustom = !!s.padUseCustom;
    return s;
  },

  setSetting: function (key, value) {
    if (!this.data) this.load();
    const s = this.settings();
    s[key] = value;
    // 音量夹紧，防止手改存档塞个 100 进来把耳朵炸了
    if (key === 'volume') {
      s.volume = Math.max(0, Math.min(1, Number(value) || 0));
    }
    /* ★ 手机按键大小同样夹紧（手改存档也不能把按钮撑爆/缩没） */
    if (key === 'padScale') {
      const n = Number(value);
      s.padScale = isFinite(n)
        ? Math.max(PAD_SCALE_MIN, Math.min(PAD_SCALE_MAX, n))
        : 1;
    }
    /* ★ 2026-10-07：按键灵敏度夹紧（防止手改存档塞 99 ⇒ 起飞） */
    if (key === 'padSensitivity') {
      const n2 = Number(value);
      s.padSensitivity = isFinite(n2)
        ? Math.max(PAD_SENS_MIN, Math.min(PAD_SENS_MAX, n2))
        : 1;
    }
    /* ★ 2026-10-07：自定义按键位置过一遍清洗 ★
     * 直接写单个键时（`setSetting('padCustomPos', {...})`）也要洗，
     * 不能假设调用方给的一定干净。 */
    if (key === 'padCustomPos') {
      s.padCustomPos = sanitizePadCustom(value);
    }
    this.save();
    return s[key];
  },

  /* ---------------- 游玩模式（第 2 期新增）---------------- */

  /** 当前模式：'classic' | 'rider'。任何异常都退回经典。 */
  mode: function () {
    if (!this.data) this.load();
    const m = this.data && this.data.mode;
    return (GAME_MODES.indexOf(m) >= 0) ? m : DEFAULT_GAME_MODE;
  },

  /** 是不是骑手模式（有时限/看时间评星的那个） */
  isRiderMode: function () {
    return this.mode() === 'rider';
  },

  /** 切换模式。非法值直接忽略（返回当前值），不会把档写坏。 */
  setMode: function (mode) {
    if (!this.data) this.load();
    if (GAME_MODES.indexOf(mode) < 0) return this.mode();
    this.data.mode = mode;
    this.save();
    return mode;
  },

  /* ---------------- 称号（第 7 期 E3 神秘订单）---------------- */

  /** 已解锁的称号列表（拷贝，别让调用方直接改内部数组） */
  listTitles: function () {
    if (!this.data) this.load();
    return (this.data.titles || []).slice();
  },

  /** 有没有拿到某称号 */
  hasTitle: function (title) {
    if (!this.data) this.load();
    return (this.data.titles || []).indexOf(title) >= 0;
  },

  /** 解锁一个称号。返回 true = 这次是**新**解锁的（可以弹提示）。
   *  ⚠️ 重复解锁返回 false —— 调用方靠这个判断"要不要弹提示"，
   *     避免每次通关都弹一遍同样的称号。 */
  addTitle: function (title) {
    if (!this.data) this.load();
    if (typeof title !== 'string' || !title) return false;
    if (!Array.isArray(this.data.titles)) this.data.titles = [];
    if (this.data.titles.indexOf(title) >= 0) return false;
    this.data.titles.push(title);
    this.save();
    return true;
  },

  /* ---------------- 记录一次通关 ----------------
   * @param levelIndex  关卡下标（0 起）
   * @param elapsed     本局用时（秒）
   * @param coinsTaken  本局收集数
   * @param coinsTotal  本关金币总数
   * @param charId      本局使用的角色 id（可选，不给就跳过角色记录）
   * @return {object} { isNewTime, isNewStars, stars, unlocked: [动作...],
   *                    isNewCharTime, unlockedChars: [角色...] }
   */
  recordClear: function (levelIndex, elapsed, coinsTaken, coinsTotal, charId) {
    if (!this.data) this.load();
    const key = String(levelIndex + 1);
    const prev = this.data.levels[key] || { bestTime: null, bestStars: 0, bestCoins: 0, cleared: false };

    const stars = calcStars(coinsTaken, coinsTotal);
    const isNewTime = (prev.bestTime == null) || (elapsed < prev.bestTime);
    const isNewStars = stars > prev.bestStars;

    this.data.levels[key] = {
      cleared: true,
      bestTime: isNewTime ? +elapsed.toFixed(2) : prev.bestTime,
      bestStars: Math.max(stars, prev.bestStars),
      bestCoins: Math.max(coinsTaken, prev.bestCoins || 0),
    };

    // 解锁下一关（只增不减，别因为重玩旧关而把新解锁的锁回去）
    const nextNum = levelIndex + 2;
    if (nextNum > this.data.maxUnlocked) this.data.maxUnlocked = nextNum;

    /* ★ 解锁新动作 ★
     * 同样"只增不减" —— 重玩旧关不该把后面的动作锁回去。 */
    if (!Array.isArray(this.data.unlockedActions)) this.data.unlockedActions = [];
    const newlyUnlocked = [];
    const self = this;
    ACTION_UNLOCKS.forEach(function (u) {
      if (u.afterLevel <= levelNum0(levelIndex) &&
          self.data.unlockedActions.indexOf(u.id) < 0) {
        self.data.unlockedActions.push(u.id);
        newlyUnlocked.push(u);
      }
    });

    /* ★ 每角色记录最佳用时 ★
     * 和关卡总最佳时间是**两份数据**：
     *   levels["2"].bestTime    = 本关总最佳（任何角色）
     *   characterRecords.dragon.levels["2"].bestTime = 奶龙的个人最佳
     * 分开记的理由：换了角色跑得更快，总记录会刷新，
     * 但玩家想知道"我用袋鼠最好能跑多少"时，那份数据不能被冲掉。 */
    let isNewCharTime = false;
    if (typeof charId === 'string' && charById(charId)) {
      if (!this.data.characterRecords) this.data.characterRecords = {};
      if (!this.data.characterRecords[charId]) {
        this.data.characterRecords[charId] = { uses: 0, levels: {} };
      }
      const rec = this.data.characterRecords[charId];
      if (!rec.levels || typeof rec.levels !== 'object') rec.levels = {};
      const crec = rec.levels[key] || { bestTime: null };
      const cTime = +elapsed.toFixed(2);
      if (crec.bestTime == null || cTime < crec.bestTime) {
        crec.bestTime = cTime;
        isNewCharTime = true;
      }
      rec.levels[key] = crec;
    }

    /* ★ 角色解锁（每 5 关一个新角色）★
     * 只用"本次通关的关号"匹配 unlockLevel，
     * 所以重玩旧关不会重复触发（而且 unlockChar 内部还会查重）。 */
    const newlyChars = [];
    charsUnlockedBy(levelIndex, this.data.unlockedCharacters).forEach(function (c) {
      if (self.unlockChar(c.id)) newlyChars.push(c);
    });

    this.save();
    return {
      isNewTime: isNewTime,
      isNewStars: isNewStars,
      stars: stars,
      unlocked: newlyUnlocked,
      isNewCharTime: isNewCharTime,
      unlockedChars: newlyChars,
    };
  },

  /* ---------------- 清档（给"重新开始"用） ----------------
   * ⚠️ 清档会**同时清掉角色解锁记录**（十一明确要求）。
   *    这是"从头体验完整流程"的必要条件 ——
   *    如果角色还留着，清档后玩家一开局就有全部角色，流程就不完整了。
   *    设置项（音效/震动）**不清** —— 那是设备偏好，不是游戏进度。
   *    设备模式也不清（存在另一个 key 里，见 device-mode.js）。 */
  reset: function () {
    const keepSettings = this.data && this.data.settings
      ? this.data.settings
      : defaultSettings();
    this.data = {
      version: SAVE_VERSION,
      maxUnlocked: 1, unlockedActions: [], levels: {},
      selectedCharacter: defaultUnlockedChars()[0] || 'kangaroo',
      unlockedCharacters: defaultUnlockedChars(),
      characterRecords: {},
      seenUnlockAnimations: [],
      settings: keepSettings,
      /* 清档**保留**模式选择 —— 和设置一样，那是"想怎么玩"的偏好，
       * 不是游戏进度。玩家清档重来，不应该被打回经典模式。 */
      mode: (this.data && GAME_MODES.indexOf(this.data.mode) >= 0)
        ? this.data.mode : DEFAULT_GAME_MODE,
      /* ⚠️ 称号**清掉** —— 它属于"游戏进度"（是挑战达成的证明），
       *    和关卡星级一样应该被清档重置。
       *    这和 mode 不同：mode 是"想怎么玩"的偏好，所以保留。 */
      titles: [],
      /* ⚠️ 兑换记录也清掉 —— 清档 = 重新开始，包括"哪些码用过了"。
       *    这样玩家清档后还能再兑一次（合理，因为进度也确实归零了）。 */
      redeemedCodes: [],
    };
    this.save();
  },

  /* ============================================================
   * ★ 切换账号后重新读档（2026-10-06 加）★
   * ============================================================
   * 【为什么需要它】`saveKey()` 是"此刻去算 key"，所以**光切账号不会
   *   自动换存档** —— `this.data` 里还揣着上一个账号的数据。
   *   必须显式"把当前内存里的存档丢掉、按新 key 重读一遍"。
   *
   * 【和 reset() 的区别】（很容易搞混，写清楚）
   *   · `reset()`   = **清档**：把进度抹成新的，保留设置（玩家主动清档重来）
   *   · `reload()`  = **换档**：丢掉内存缓存，从新的 key 重新读
   *                   —— 这个账号原本的进度**原样加载回来**，不抹任何东西
   *
   * ⚠️ 调用时机：**必须在账号模块的 currentId 已经改完之后**调。
   *    顺序反了就会读到上一个账号的档（表现为"切了账号进度没变"）。
   * ============================================================ */
  reload: function () {
    /* load() 内部会：读 localStorage → 校验 → 迁移补字段 → 写进 this.data。
     * 所以"重读"就是再调一次 load()，不需要别的。 */
    return this.load();
  },
};

/* ============================================================
 * ★★ syncAuthorPerks —— 作者账号特权同步（2026-10-07）★★
 * ============================================================
 * 十一："我希望这个账号能做到，每次更新作者账号可以同步更新
 *        所有的关卡和角色。"
 *
 * 【一句话】读档时如果发现"当前账号是作者"，
 *           就把**当前版本的全部内容**补齐给他 —— 而且只补缺的。
 *
 * 【为什么必须在 save.js 里、而不是 account.js】
 *   因为要挂在 `load()` 流程里（每次读档都跑）。
 *   account.js 是上层（它反过来调 save.js），不能倒过来依赖。
 *
 * 【软依赖三连（缺任何一样都静默跳过，绝不让读档失败）】
 *   ① `ACCOUNT` 不存在（测试环境常不加载）
 *   ② `ACCOUNT.isCurrentAuthor` 不存在（旧版 account.js）
 *   ③ 当前登录的不是作者账号
 *   ⇒ 三种情况都 `return`，什么都不做。
 *
 * 【幂等】只补缺的：反复调用结果一致，不会越写越大。
 * ============================================================ */
function syncAuthorPerks(data) {
  if (!data || typeof data !== 'object') return false;

  /* ============================================================
   * ★ 作者判定（2026-10-07 改为"看存档标记"）
   * ============================================================
   * 十一要求"改成只靠 code 认作者" ⇒ 权威依据是
   * **存档里的 `data.isAuthor`**（由兑换码写入）。
   *
   * ⚠️ 判定顺序（两个来源，取"或"）：
   *   ① **传入的 data 自己带 isAuthor 标记** —— 最直接、最可靠。
   *      这条很重要：`grantAuthorPerks` 刚盖上章就调本函数，
   *      如果只认 ACCOUNT 那边读的磁盘值，可能出现"写得慢半拍"
   *      导致特权发不出去。
   *   ② `ACCOUNT.isCurrentAuthor()` —— 它内部读 localStorage，
   *      用于"读档时"判断当前登录账号是不是作者。
   *
   * 任一为真即视为作者；两个都拿不到就静默跳过
   * （普通账号本来也不需要这个逻辑），**绝不让读档失败**。
   * ============================================================ */
  let isAuthor = (data.isAuthor === true);
  if (!isAuthor) {
    if (typeof ACCOUNT === 'undefined' || !ACCOUNT) return false;
    if (typeof ACCOUNT.isCurrentAuthor !== 'function') return false;
    try { isAuthor = ACCOUNT.isCurrentAuthor(); } catch (e) { return false; }
  }
  if (!isAuthor) return false;

  let changed = false;

  /* ---- ① 全角色：把当前版本所有 ready 的角色都解锁 ---- */
  try {
    if (typeof CHARACTERS !== 'undefined' && Array.isArray(CHARACTERS)) {
      if (!Array.isArray(data.unlockedCharacters)) data.unlockedCharacters = [];
      CHARACTERS.forEach(function (c) {
        if (!c || !c.ready || !c.id) return;
        if (data.unlockedCharacters.indexOf(c.id) < 0) {
          data.unlockedCharacters.push(c.id);
          changed = true;
        }
      });
    }
  } catch (e) { /* 单步失败不影响其它几项 */ }

  /* ---- ② 全动作 ---- */
  try {
    const allActs = ['dash', 'doublejump', 'walljump', 'wallslide'];
    if (!Array.isArray(data.unlockedActions)) data.unlockedActions = [];
    allActs.forEach(function (id) {
      if (data.unlockedActions.indexOf(id) < 0) {
        data.unlockedActions.push(id);
        changed = true;
      }
    });
  } catch (e) { }

  /* ---- ③ 全关卡 ----
   * ⚠️ 用**动态总数**而不是写死 30 ——
   *    这样以后加了第 31~40 关，作者账号下次进游戏就自动解锁到 40。
   *    这正是十一要的"每次更新都同步"。 */
  try {
    let total = 0;
    if (typeof levelCount === 'function') {
      total = levelCount();                    /* game.js 里的单一真相源 */
    } else {
      total = (typeof LEVELS !== 'undefined' ? LEVELS.length : 0) +
              (typeof LEVELS_EXTRA !== 'undefined' ? LEVELS_EXTRA.length : 0);
    }
    if (total > 0) {
      /* ⚠️ 只**提高**、不降低 —— 万一以后关卡数变少了（删关），
       *    也不能把作者已经解锁的进度往回缩。 */
      if (typeof data.maxUnlocked !== 'number' || data.maxUnlocked < total) {
        data.maxUnlocked = total;
        changed = true;
      }
    }
  } catch (e) { }

  /* ---- ④ 标记作者身份（UI 显示徽章用）---- */
  if (data.isAuthor !== true) { data.isAuthor = true; changed = true; }

  return changed;
}

/* 关卡下标 → 1 起算的关号。
 * 单独抽出来是因为这个"+1"在解锁逻辑里出现很多次，
 * 每次手写都容易搞错（0 起算 vs 1 起算是这个项目最常见的 off-by-one）。 */
function levelNum0(levelIndex) {
  return (typeof levelIndex === 'number' ? levelIndex : 0) + 1;
}

/* 统一的"动作解锁了吗"查询入口
 * ------------------------------------------------------------
 * 为什么要有这个包装（而不是各处直接调 SAVE().hasAction）：
 *   ① SAVE() 本身是兜底访问器 —— 存档模块整个挂了也要能返回一个可用对象
 *   ② 分散在各处调用时，只要有一处忘了兜底，动作就可能"时灵时不灵"
 *   ③ 以后要加"练习模式全解锁"这类开关，只改这一处
 */
function isActionUnlocked(id) {
  try {
    if (typeof SAVE !== 'function') return true;
    const s = SAVE();
    if (!s || typeof s.hasAction !== 'function') return true;
    return s.hasAction(id);
  } catch (e) {
    /* 存取出错时**放行** —— 宁可让玩家玩到，也不要因为存档问题被锁死 */
    return true;
  }
}

/* ============================================================
 * 星级规则【经典模式】
 * ============================================================
 * 按金币收集率给 0-3 星。
 *   全收集     → 3 星
 *   ≥ 75%      → 2 星
 *   达到过关门槛 → 1 星
 *   否则        → 0 星（理论上不会出现，因为不到门槛根本过不了关）
 *
 * ⚠️ 2026-10-07：全局过关门槛从 45% 提到 **80%** 之后，
 *   实际可达的星级只有 **2 星（80~99%）和 3 星（全收集）**——
 *   "1 星（刚好达门槛）"实际上等于"2 星"，梯度被压缩了。
 *   ⚠️ 这是**已知的、可接受的副作用**：
 *     · 3 星＝全收集这条最重要的分档没变（挑战性还在）
 *     · 但**若十一想要更细的梯度**（比如"85% 就 2 星、95% 才 3 星"），
 *       必须**新增函数**（按下面的红线，calcStars 本身不许改）。
 *   暂不改：本轮需求只提"收集 80%"，没提评星，不擅自改评分体系。
 *
 * 用比例而不是固定个数 —— 以后加关卡不用手算。
 *
 * ⚠️⚠️ 【动这个函数之前先读这段】⚠️⚠️
 *   扩展方案（docs/扩展方案_C+E_骑手成长版.md）里**明确要求**：
 *     "★不许修改 calcStars() 的现有逻辑★（经典模式在用它）。
 *      要新逻辑就新增函数，不要改老函数。"
 *   ⇒ 所以骑手模式的评星**另起一个函数 calcStarsRider()**（在下面），
 *     这个 calcStars 一个字都不许动。
 *     它被这些地方用着（改它会连带影响）：
 *       · ui.js buildClear()（经典模式的结算）
 *       · 各种测试（unlock-test / single-player-test 等）
 */
function calcStars(coinsTaken, coinsTotal) {
  if (coinsTotal <= 0) return 1;
  const ratio = coinsTaken / coinsTotal;
  if (ratio >= 0.999) return 3;
  if (ratio >= 0.75) return 2;
  return 1;
}

/* ============================================================
 * 星级规则【骑手模式】（★第 2 期建骨架，第 3 期启用★）
 * ============================================================
 * 方案的核心决策：骑手模式综合"时间 + 好评率"给星。
 *
 * 【评星配比：时间 50% + 好评率 50%】
 *   ⚠️ 这是我（AI）定的默认配比，方案第七节存疑点 #2
 *      建议"各 50% 或时间达标即满分"，**需要十一确认**。
 *
 * 【算法】
 *   总分 = 时间分（0-1）× 0.5 + 好评分（0-1）× 0.5
 *   时间分：
 *     · 用时 ≤ 目标时间       → 1.0（准时，满分）
 *     · 超时                  → 按比例递减，最低 0
 *       公式：max(0, 1 - (超时秒数 / 目标时间))
 *       例：目标 90 秒，用了 108 秒（超 18 秒 = 20%）→ 时间分 0.8
 *           目标 90 秒，用了 180 秒（超 100%）     → 时间分 0
 *     · 没有目标时间（targetTime <= 0）→ 时间项不参与，
 *       整颗星只看好评率（避免"没时限的关卡反而更难拿星"）
 *   好评分：好评率 / 100
 *
 *   星级门槛（总分）：
 *     ≥ 0.95 → 3 星（几乎完美：准时 + 满好评）
 *     ≥ 0.70 → 2 星
 *     其余    → 1 星
 *
 *   ⚠️ 最低也是 1 星 —— 因为**能过关就已经算送达了**。
 *     这和经典模式一致（calcStars 也不会返回 0）。
 *
 * 【为什么 3 星门槛是 0.95 而不是 1.0】
 *   0.95 意味着"稍微晚一点点 / 掉一颗心"仍然可以三星，
 *   给玩家一点容错。要真的 1.0 太苛刻（掉血就永远拿不到三星了）。
 *
 * ⚠️⚠️ 红线：这个函数**只影响星数**，绝不决定过关与否。
 *     超时在这里最多让时间分变低，**不会**让关卡失败。
 *     过关判定在 game.js 里，只看"到没到终点 + 订单够不够"，
 *     和时间没有任何关系。
 *
 * @param elapsed      本局用时（秒）
 * @param targetTime   本局目标时间（秒，0 = 没有目标时间）
 * @param coinsTaken   本局收集订单数
 * @param coinsTotal   本关订单总数
 * @param ratingPct    本单好评率（0-100）
 * @return 1..3 星
 */
function calcStarsRider(elapsed, targetTime, coinsTaken, coinsTotal, ratingPct) {
  /* ---- 兜底：好评率取不到就按满分算（不惩罚玩家）---- */
  const pct = (typeof ratingPct === 'number' && isFinite(ratingPct))
    ? Math.max(0, Math.min(100, ratingPct))
    : 100;
  const coinScore = pct / 100;

  const time = (typeof elapsed === 'number' && isFinite(elapsed)) ? elapsed : 0;

  /* ---- 没有目标时间：时间项不参与，只看好评率 ----
   * ⚠️ 这条重要：否则"没时限的关卡用 50/50 加权"会莫名更难拿三星。
   *    直接退化成"好评率 = 星级依据"，和经典模式精神一致。 */
  if (!(targetTime > 0)) {
    if (coinScore >= 0.999) return 3;
    if (coinScore >= 0.75) return 2;
    return 1;
  }

  /* ---- 时间分 ----
   * 准时（含提前）→ 满分 1.0
   * 超时 → 按"超时比例"线性递减，最低 0 */
  let timeScore;
  if (time <= targetTime) {
    timeScore = 1.0;
  } else {
    const overRatio = (time - targetTime) / targetTime;   // 超时的比例
    timeScore = Math.max(0, 1 - overRatio);
  }

  /* ---- 加权总分（50% / 50%）---- */
  const total = timeScore * 0.5 + coinScore * 0.5;

  if (total >= 0.95) return 3;
  if (total >= 0.70) return 2;
  return 1;
}

/* 星数画成文字（菜单里用）
 *
 * ⚠️ 只用于【单关的 0-3 星】。
 *    踩过的坑：主菜单想显示"总星数"，误传了 10 进来，
 *    算出 3-10 = -7，'☆'.repeat(-7) 直接抛 RangeError 把菜单打崩。
 *    现在加了夹紧，传什么进来都不会崩 —— 但语义上它仍只表达 0-3 星，
 *    要显示总数请直接用数字（"★ 10 / 12"）。 */
function starsText(n) {
  const k = Math.max(0, Math.min(3, Math.floor(Number(n) || 0)));
  if (k <= 0) return '☆☆☆';
  return '★'.repeat(k) + '☆'.repeat(3 - k);
}

/* 注：`SAVE()` 这个兜底访问器定义在 physics.js 里（那是必加载的基础模块），
 * 调用方统一用 SAVE().xxx()，这样即使本文件没加载成功，游戏也不会崩。 */
