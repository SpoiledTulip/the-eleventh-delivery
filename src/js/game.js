/* ============================================================
 * game.js — 主引擎
 * 状态机：menu → playing → dying → gameover / clear
 * ============================================================ */

const CANVAS_W = 1280;
const CANVAS_H = 720;

/* ============================================================
 * ★ 超时宽限期（2026-10-06 十一要求：骑手模式加"超时失败"）★
 * ============================================================
 * 【这是什么】
 *   骑手模式下倒计时归零后，**不立刻判失败**，先给玩家
 *   这几秒钟"冲线"的机会 —— 过了这个宽限期还没到终点才失败。
 *
 * 【为什么要宽限期（不能"到点就死"）】
 *   十一定的体验节奏是："到 0 → 先提醒 → 宽限几秒 → 还没到才失败"。
 *   如果归零瞬间就死，会出现最劝退的一种死法：
 *   玩家**已经跑到终点旗前面了**，脚刚抬起来，屏幕一黑 ——
 *   "我明明就差一步"。这种"差一点却毫无补救机会"的挫败感，
 *   是玩家直接退游级别的体验。给几秒缓冲，让"差一点"变成"还能救"。
 *
 * 【为什么不能太长（不能给成 30 秒）】
 *   宽限期本质是"把时限偷偷往后拖"。给太长等于时限没收紧 ——
 *   那十一这轮"收紧时限、要紧张感"的诉求就落空了。
 *   5 秒是"够跑完眼前这一段、但不够重跑半关"的长度，正好。
 *
 * ------------------------------------------------------------
 * ★★ 2026-10-06 十一调整：5 秒 → 60 秒 ★★
 * ------------------------------------------------------------
 * 她的原话："30 秒之后不写失败，就是如果一分钟没到就直接失败，差评。"
 * ⇒ 新的体验节奏是：
 *     目标时间到（30s）→ **催单气泡开始跳**（催单会一直持续）
 *     → 总用时满 60 秒 → 配送失败（差评）
 *
 * 【为什么这个改动反而更合理】
 *   原来 5 秒宽限 = "超时后基本没救，等于到点就死"，
 *   玩家只会觉得"这关时限太狠"，而**看不到催单气泡想表达的幽默**。
 *   拉长到 60 秒之后：
 *     · 催单气泡有**整整 30 秒**在屏幕上越催越急（E2 终于被看见了）
 *     · 玩家有充足时间补救（对应"放松优先"—— 压力是目标不是惩罚）
 *     · 失败仍然存在（对应"要紧张感"），只是不再是"毫无余地"
 *
 * 【为什么放在 game.js 而不是 physics.js】
 *   physics.js 里全是**影响角色运动**的参数（重力/速度/跳跃）。
 *   超时宽限期**不改变任何物理**，只是"什么时候判负"的规则，
 *   放进 physics.js 会让人误以为它影响手感。
 *   ⇒ 它是**游戏规则**，所以放在主引擎 game.js 顶部。
 *
 * ⚠️ 只对**骑手模式**生效。经典模式用的是"超时不失败"的老逻辑。
 * ============================================================ */
const TIMEOUT_GRACE = 60;

const STATE = {
  MENU: 'menu',
  PLAYING: 'playing',
  CLEAR: 'clear',
  GAMEOVER: 'gameover',
  PAUSED: 'paused',
  // --- 联机相关 ---
  LOBBY: 'lobby',        // 联机大厅：建房间 / 加入房间
  HOSTING: 'hosting',    // 已建房，等待朋友
  JOINING: 'joining',    // 输入房间码
  // --- 单人相关 ---
  SINGLE_PICK: 'single_pick',  // 单人模式选角色
  LEVEL_SELECT: 'level_select', // 关卡选择菜单
  // --- 说明页 ---
  /* 注意：这个状态**不是"玩游戏"**，而是"看说明"。
   * 它必须和 PLAYING 一样让 UI 浮层显示出来（而不是被 hideUI 藏掉），
   * 所以 syncUI 里要单独分发（见 ui.js）。 */
  HELP: 'help',                 // 按键说明

  /* ★ 👤 账号系统（2026-10-06 十一要求）★
   * 三个页面，职责分得很清楚（别合起来，合起来会很乱）：
   *   ACCOUNT_WELCOME —— **首次**打开、一个账号都没有时的"创建账号"页。
   *                       玩家点「开始」被自动送过来（见 ui.js 的开始跑单按钮）。
   *   ACCOUNT_PICK    —— 选账号页：列出本机所有账号，点一个去输密码。
   *                       也是"退出账号"之后的落地页（未登录状态）。
   *   ACCOUNT_LOGIN   —— 输密码页：验证通过才真正切过去。
   * ⚠️ 为什么"选账号"和"输密码"要分成两页（而不是一个页面里带密码框）：
   *    一个页面里既有账号列表又有密码框，玩家点了别人名字就会开始输密码，
   *    容易误操作；分开之后"选谁"和"证明是我"是两步，清晰得多，
   *    也才有地方放"忘记密码怎么办"的说明。 */
  ACCOUNT_WELCOME: 'account_welcome',
  ACCOUNT_PICK: 'account_pick',
  ACCOUNT_LOGIN: 'account_login',

  /* ★ 🏁 PK 模式：开跑前的选骑手页（2026-10-06 十一要求）★
   * 十一："AI 可以随机皮肤，我可以选皮肤"
   * ⇒ 点「开始 PK」先到这个页面：玩家选自己的骑手，
   *   同时**亮出 AI 随机抽到的是谁**（不看清楚就开跑会有"我打的是谁"的困惑）。 */
  PK_PICK: 'pk_pick',

  /* ---------- 2026-10-06 新增 ---------- */
  /* ★ 启动画面（2026-10-06 十一要求）★
   * 打开游戏先看到它：标题「第十一单外卖」+ 背景图，
   * 玩家点一下才进入"开始跑单 / 选择路线"的主菜单。
   * 为什么用独立状态而不是直接进 MENU：
   *   主菜单的面板会盖住画布上的大标题，而启动画面
   *   需要"标题完整可见"—— 所以两者必须是两个界面。 */
  SPLASH: 'splash',
  /* ⚠️ DEVICE_PICK 已废弃（2026-10-06 十一要求"暂不开通手机端入口、
   *    移除电脑/手机选择页"）。这里**保留这个常量**是为了：
   *    ① 老代码/测试里若还引用它，不会因为 undefined 而崩；
   *    ② 以后想重新开放手机端时，界面函数还在，把入口接回来即可。
   *    当前没有任何地方会进入这个状态。 */
  DEVICE_PICK: 'device_pick',
  /* 角色库（查看全部角色的详情、解锁状态、各关成绩） */
  CHAR_LIBRARY: 'char_library',
  /* 其他模式（双人同屏 / 异地联机的低优先级入口） */
  OTHER_MODES: 'other_modes',
  /* 设置（音效/震动/提示/切换设备模式/清除存档） */
  SETTINGS: 'settings',
  /* 角色解锁动画（通关节点关卡后播放，可跳过） */
  CHAR_UNLOCK: 'char_unlock',
  /* ============================================================
   * ★ 气象播报过场（E1，2026-10-06 第 5 期）★
   * ============================================================
   * 方案原文（E1 气象播报员，被称为"王牌"）：
   *   "每单开始前，弹一个**过场画面**：一个一本正经的气象播报员
   *    播报本单天气……然后游戏才开始"
   *
   * 为什么它是王牌（方案原话）：
   *   ① 它是天气系统的"落地入口"（天气是"预报出来的"）→ 逻辑闭环
   *   ② 卡通游戏里突然出现正经气象播报 → 荒诞感拉满
   *   ③ 只有大气科学专业的人想得出来 → 别人抄不走
   *
   * ⚠️ 第 5 期只做"播报界面 + 台词"，天气效果留给第 6 期。
   *    所以现在进这一屏看到的是**占位天气文案**，
   *    点了"收到"照样正常进游戏（不影响任何玩法）。
   * ============================================================ */
  WEATHER_BRIEF: 'weather_brief',

  /* ============================================================
   * ★ 成就页（2026-10-06）★
   * ============================================================
   * 把游戏里已有的"称号"（`Save.data.titles`）做成一个**能看的地方**。
   *
   * ⚠️ 为什么要独立 STATE 而不是复用 CHAR_LIBRARY：
   *   成就页有**两条入口**（角色库 tab 切过来 / 结算页点过来），
   *   而 tab 切换用的是"重绘"（改 UI.lastKey 触发 syncUI）——
   *   如果共用 CHAR_LIBRARY，就没法区分"我想看角色"还是"我想看成就"，
   *   重绘出来永远是同一个页面。
   *   独立 state 让路由表能直接分派，最干净。
   * ============================================================ */
  ACHIEVEMENTS: 'achievements',
};

const Game = {
  canvas: null,
  ctx: null,
  state: STATE.MENU,
  /* ★ 2026-10-06：进主菜单前先过一次启动画面 ★
   * 注意这里是**模块级默认值**（Game.state = STATE.MENU）。
   * 真正的"第一屏是启动画面"由 index.html 的 boot() 设置，
   * 因为 boot 是唯一知道"这是本次打开游戏的第一次"的地方。 */
  sawSplash: false,
  level: null,
  players: [],
  camera: { x: 0, y: 0 },
  frame: 0,
  startTime: 0,
  elapsed: 0,
  coinsTotal: 0,
  coinsTaken: 0,
  coinsRequired: 0,   // 过关需要收集的订单数（默认 80%，第 1 关单独放宽）
  /* 关卡限时（秒）。
   * 0 = 不限时（当前所有关卡都是 0）。
   * 十一在"挑战目标"里提到"规定时间内完成"——
   * 系统先留好位置，HUD 会据此显示"快超时"预警，
   * 具体哪关限时多少等关卡设计定了再填。 */
  timeLimit: 0,
  coinShortTimer: 0,  // 金币不足时的提示节流计时
  message: '',
  messageTimer: 0,
  shake: 0,
  particles: [],
  screenFlash: 0,
  checkpoint: null,
  /* ★ 失败原因（结构化）★
   * 十一要求"失败时必须说明具体原因"。原来只有一句 Game.message，
   * 文案和原因混在一起，UI 没法据此给出针对性的重试建议。
   *
   * 现在存一个**枚举式**的键（'fall' / 'hazard' / 'stamina' /
   * 'bridge' / 'timeout' / 'enemy' / 'bomb'），
   * 由 ui.js 的 DEATH_REASONS 表翻译成"原因 + 建议"。
   *
   * 用键而不是直接存文案的原因：以后要改文案、加多语言、
   * 或者按原因做统计，都只改一处。 */
  deathReason: '',
  /* ★ 好评率快照（C3，2026-10-06 第 1 期）★
   * 通关/阵亡那一刻把 hearts/maxHearts 记下来，
   * 结算页和失败页读这两个值换算成"好评率"。
   *
   * ⚠️ 这只是**记录**，不参与任何判定 —— 游戏逻辑里决定生死的
   *    一直是 p.hearts（没变过）。这两个快照纯粹给 UI 显示用。
   *    初始值用 null（而不是 0）是为了让 UI 能区分
   *    "还没通关过"和"通关时是 0 好评"，避免误显示。 */
  playerHeartsAtClear: null,
  playerMaxHeartsAtClear: 0,
  playerHeartsAtDeath: null,
  playerMaxHeartsAtDeath: 0,
  /* ★ E1 气象播报（第 5 期）★
   * pendingLevelIndex：播报过场结束后要进哪一关
   * briefWeather    ：本单播报的天气（第 6 期接真实天气，现在多是占位 'clear'） */
  pendingLevelIndex: null,
  briefWeather: null,
  levelIndex: 0,
  lastRecord: null,     // 最近一次通关的存档记录（用于结算面板显示"新纪录"）
  // --- 联机 ---
  mode: 'local',        // 'local' | 'online' | 'single'
  playerCount: 2,       // 1 = 单人模式（只出操控的角色）
  pickRole: 'kangaroo', // 单人模式选的角色
  /* ★ 🏁 PK 模式（2026-10-06 十一要求）★
   * 有哪些 role 是 AI 在开。
   *   · 空数组 / null = 不是 PK 局（默认，所有既有模式不受影响）
   *   · ['kangaroo'] = 第一个角色由 AI 开（玩家操控另一个）
   *
   * ⚠️ 用一个**数组**而不是布尔值：以后要做"多个 AI 一起跑"直接往里加。
   * ⚠️ 只在 PK 模式下有值；loadLevel 时会据此**给 AI 角色建玩家和脑子**。
   *
   * ★★ 2026-10-06 加 `isPk` 显式标记（修"泄漏"bug）★★
   * ------------------------------------------------------------
   * 【十一反馈的严重 bug】"普通开始跑单就变成 AI 赛跑了"
   *
   *   根因：`aiRoles` 原来只在**两个地方**被清空（初始值 + 双人同屏按钮），
   *   而**"开始跑单"这条最常见的路径没清**。
   *   ⇒ 玩完一次 PK 之后，`aiRoles` 一直留着 `['dragon']`，
   *     再点"开始跑单"就变成了 AI 赛跑（而且还有 PK 进度条）。
   *
   *   修法：不再依赖"每个入口都记得清 aiRoles"（那种设计一定会漏），
   *   改成**显式标记**：
   *     · `Game.isPk = true` 只在 startPkRace() 里设
   *     · `Game.isPk = false` 由**所有非 PK 的启动路径**设
   *     · 并提供一个 `clearPkState()` 统一清理
   * ------------------------------------------------------------ */
  isPk: false,
  aiRoles: null,
  /* PK 局里**玩家自己**用哪个 role（AI 用另一个）。
   * 它的用处：`keymapFor` 靠它认出"哪个角色是玩家的" → 给全键位。
   * ⚠️ 比"aiRoles.indexOf(role) < 0"更直接、更不容易搞反。 */
  pkMyRole: null,
  /* PK 局抽到的是第几关（随机地图用，HUD 显示关卡名） */
  pkLevelIndex: null,
  /* PK 比赛结果（谁赢了、双方进度）—— 结算页读它 */
  pkResult: null,
  joinCodeInput: '',    // 玩家正在输入的房间码
  noticeText: '',
  noticeTimer: 0,
};

/* ---------------- 初始化 ---------------- */
/* ------------------------------------------------------------
 * 输入层
 * ------------------------------------------------------------
 * 设计要点：
 *   1. 每个动作支持「多个按键」（数组），例如跳跃 = [↑, 空格]。
 *      之所以不用单键，是因为十一要求空格也能跳。
 *   2. 按键状态统一走 InputState，本地键盘和（以后的）网络输入
 *      都往同一个接口里写，物理层只读这个接口，不关心来源。
 *      这样联机时只需替换输入源，物理和渲染代码一行不用改。
 * ------------------------------------------------------------ */

/* ============================================================
 * 键位绑定（v4 — 彻底隔离版）
 * ============================================================
 * ⚠️ 血泪教训：之前三个版本都犯了同一个错误 —— **让按键共享**。
 *
 *   v1: kangaroo.jump = ['ArrowUp', 'Space']
 *       dragon.jump   = ['KeyW', 'Space']     ← Space 两边都有！
 *       结果：按空格，两个角色一起跳。
 *
 *   v2: 为了修"手机客人动不了"，让客人接受**所有键**
 *       （方向键 + WASD + 全部虚拟键）
 *       结果：客人能操控所有角色，隔离彻底失效。
 *
 * 【正确的设计原则】
 *   1. **一个物理按键只能属于一个角色** —— 绝不共用，包括空格。
 *   2. **"谁能被操控"由 localRoles 明确声明**，不靠键位表猜。
 *   3. 联机时本机只操控自己的那个角色；双人同机时两套键完全不重叠。
 * ============================================================ */

/* ------------------------------------------------------------
 * 每个角色的专属键位
 * ------------------------------------------------------------
 * 分工（一套键盘塞两个人，必须泾渭分明）：
 *
 *   袋鼠（左，P1）：方向键 ← → ↑ ↓ ，跳跃额外给**空格**
 *   奶龙（右，P2）：A D W S
 *
 * 为什么空格只给袋鼠：
 *   空格是"最顺手的大键"，但只有一个。
 *   两人同机时，谁也不能独占公共键——所以只把它分给 P1，
 *   P2 用 W 跳（W 本来就在他的操作区里，也顺手）。
 *
 * 这样 P1 的键集 = {←,→,↑,↓,Space}，P2 的键集 = {A,D,W,S}，
 * **交集为空**，物理上不可能串键。
 * ------------------------------------------------------------ */
const KEYMAP = {
  kangaroo: {
    left:  ['ArrowLeft'],
    right: ['ArrowRight'],
    jump:  ['ArrowUp', 'Space'],
    down:  ['ArrowDown'],
  },
  dragon: {
    left:  ['KeyA'],
    right: ['KeyD'],
    jump:  ['KeyW'],
    down:  ['KeyS'],
  },
};

/* ------------------------------------------------------------
 * 虚拟键码（手机触屏用）
 * ------------------------------------------------------------
 * 手机没有键盘，但我们不想为此重写一套输入逻辑。
 * 做法：给触屏按钮分配"假的键码"，按下时往 InputState 写这些码，
 * 于是**物理层、渲染层一行都不用改** —— 它们只认 InputState。
 *
 * 码名用 `VK_` 前缀，跟真实 KeyboardEvent.code 不会撞车。
 * 每个角色各一套，双人同屏（一台手机上两个人）也能分开操作。
 * ------------------------------------------------------------ */
const VK = {
  P1_LEFT:  'VK_P1_LEFT',
  P1_RIGHT: 'VK_P1_RIGHT',
  P1_JUMP:  'VK_P1_JUMP',
  /* ★ 2026-10-06 新增：虚拟手柄的「下落」和「冲刺」★
   * 原来手柄只有 左/右/跳 三个键 —— 冲刺（Shift+方向）在手机上
   * **根本按不出来**，等于手机上玩不到冲刺，而冲刺是第 4 关之后的核心动作。
   * 加这两个虚拟键让手机也能完整操作。 */
  P1_DOWN:  'VK_P1_DOWN',
  P1_DASH:  'VK_P1_DASH',
  P2_LEFT:  'VK_P2_LEFT',
  P2_RIGHT: 'VK_P2_RIGHT',
  P2_JUMP:  'VK_P2_JUMP',
  P2_DOWN:  'VK_P2_DOWN',
  P2_DASH:  'VK_P2_DASH',
  /* ★ 远程输入专用通道（联机时对方上报的按键写这里）★
   *
   * 为什么要单独一套：
   *   如果远程输入直接写对方的真实键码（比如客人的 KeyA/KeyW），
   *   而房主自己的键盘也在用这些键（比如房主临时切到 WASD 玩），
   *   两边就会互相覆盖 —— 又是一次串键。
   *
   *   给远程输入开一套独立虚拟键，物理上不可能和本地键盘撞车。
   *   使用方：net.js 的 applyRemote() 写入，物理层照常读 keymapFor()。 */
  R_LEFT:  'VK_R_LEFT',
  R_RIGHT: 'VK_R_RIGHT',
  R_JUMP:  'VK_R_JUMP',
};

/* 虚拟键按角色归属，同样绝不共用 */
KEYMAP.kangaroo.left.push(VK.P1_LEFT);
KEYMAP.kangaroo.right.push(VK.P1_RIGHT);
KEYMAP.kangaroo.jump.push(VK.P1_JUMP);
KEYMAP.kangaroo.down.push(VK.P1_DOWN);
KEYMAP.kangaroo.dash = [VK.P1_DASH];
KEYMAP.dragon.left.push(VK.P2_LEFT);
KEYMAP.dragon.right.push(VK.P2_RIGHT);
KEYMAP.dragon.jump.push(VK.P2_JUMP);
KEYMAP.dragon.down.push(VK.P2_DOWN);
KEYMAP.dragon.dash = [VK.P2_DASH];

/* ★ 远程输入通道只挂给"客人角色"（dragon）★
 *
 * 为什么只给 dragon：
 *   联机架构是"房主权威"——房主跑两个角色的物理。
 *   房主自己的角色（kangaroo）由**房主的键盘**驱动；
 *   客人的角色（dragon）由**客人上报的按键**驱动。
 *   所以远程通道只需要接到 dragon 上。
 *
 * ⚠️ 绝不能两个角色都挂：那样客人的按键会同时驱动房主自己的角色，
 *    又是一次串键（这正是之前"能操控别人角色"的成因之一）。 */
KEYMAP.dragon.left.push(VK.R_LEFT);
KEYMAP.dragon.right.push(VK.R_RIGHT);
KEYMAP.dragon.jump.push(VK.R_JUMP);

/* ------------------------------------------------------------
 * 单人模式键位：方向键 + WASD + 空格 全都行
 * ------------------------------------------------------------
 * 理由：单人玩的时候，没必要让玩家记"我该按哪套键"。
 * 只有一个角色在场上，不存在串键问题，怎么顺手怎么按。
 * ------------------------------------------------------------ */
const KEYMAP_SINGLE = {
  left:  ['ArrowLeft', 'KeyA', VK.P1_LEFT, VK.P2_LEFT],
  right: ['ArrowRight', 'KeyD', VK.P1_RIGHT, VK.P2_RIGHT],
  jump:  ['ArrowUp', 'KeyW', 'Space', VK.P1_JUMP, VK.P2_JUMP],
  down:  ['ArrowDown', 'KeyS', VK.P1_DOWN, VK.P2_DOWN],
  dash:  ['KeyF', VK.P1_DASH, VK.P2_DASH],
};

/* ------------------------------------------------------------
 * ★ 本机操控的角色集合（隔离的核心）★
 * ------------------------------------------------------------
 * 这是"谁能被我的键盘控制"的唯一真相来源。
 *
 *   单人模式          → 只有我在玩的那个角色
 *   双人同机(local)   → 两个都操控（两个人共用一台电脑，
 *                       各自用自己那套键，靠键位不重叠来隔离）
 *   联机房主(host)    → **只操控袋鼠**（自己的角色）
 *                       奶龙的按键由客人上报 → applyRemote 写入
 *   联机客人(guest)   → **只操控奶龙**（自己的角色）
 *
 * ⚠️ 关键：联机时**绝不能**返回两个角色。
 * 之前的 bug 就是联机时本机也能操控对方角色。
 * ------------------------------------------------------------ */
function localRoles() {
  if (Game.playerCount === 1) {
    /* ★ 单人模式：从"选中的角色配置"取 role（2026-10-06）★
     * 原来是 `Game.pickRole === 'dragon' ? 'dragon' : 'kangaroo'` ——
     * 加了第三个角色后这个三元会把卡皮巴拉判成袋鼠。
     * ⇒ 改成走 roleOfSelection()：查角色表拿 role，查不到才退袋鼠。
     * ⚠️ 这个函数**一定有返回值**（绝不返回 undefined），见 characters.js。 */
    return [roleOfSelection()];
  }
  if (Game.mode === 'online') {
    // 联机：我只有一个角色
    /* ⚠️ 联机**保持原样不动**（十一："单人优先、联机暂缓"）——
     *    客人固定 dragon，这不是 bug，是联机协议的一部分。 */
    return [Net.role === 'guest' ? 'dragon' : 'kangaroo'];
  }
  // 双人同机：两个角色都归本机操控（键位不重叠，天然隔离）
  /* ⚠️ 双人也保持"就这两个"—— 双人是固定双角色模式，
   *    不参与"选第三个角色"这件事（卡皮巴拉只在单人有意义）。 */
  return ['kangaroo', 'dragon'];
}

/* 某个角色是否由本机操控 */
function isLocalRole(role) {
  return localRoles().indexOf(role) >= 0;
}

/* ============================================================
 * ★★ 这一局是不是"两个真人玩家"（2026-10-06 十一要求）★★
 * ============================================================
 * 十一的原话：
 *   "无论是我单机还是 PK，我这个角色都是 P1，永远都是 P1，不要 P2。
 *    而且 P1 P2 都是双人的时候才会有的。
 *    单人模式下就不要显示这个 P1 P2。"
 *
 * 【用途】只有一种 UI 需要它：**"P1 / P2"这套编号标签**。
 *   规则：**只有两个真人同时玩，才有 P1/P2 的意义**。
 *
 *   | 情况 | 场上角色 | 是真人数 | 显示 P1/P2 |
 *   |---|---|---|---|
 *   | 单人模式 | 1 | 1 | ❌ 不显示 |
 *   | **PK 模式** | 2 | **1**（另一个是 AI） | ❌ 不显示 |
 *   | 双人同屏 | 2 | 2 | ✅ 显示 |
 *   | 联机 | 2 | 2（一个在远端） | ✅ 显示 |
 *
 * ⚠️ **PK 必须排除** —— 这是十一特别强调的：
 *    PK 里第二个人是电脑，标个 P2 会让人以为"还有个真人没到"。
 *
 * ⚠️ 判断依据用 `Game.isPk`（PK 的唯一真相标记），
 *    不要用"role 是不是 AI"去猜 —— 那容易漏。
 * ============================================================ */
function isTwoHumanPlayers() {
  /* PK：第二个人是 AI，不算"双人" */
  if (Game.isPk) return false;
  /* 只有真的有两个角色在场上，才谈得上"双人" */
  return Game.players.length >= 2 && Game.playerCount >= 2;
}

/**
 * 取某个角色当前生效的按键绑定。
 *
 * ⚠️ 这里必须**严格按角色返回专属键位**，不能因为"是我在操控"
 * 就把所有键都塞给他 —— 那正是串键的根源。
 *
 *   - 单人：用 KEYMAP_SINGLE（只有一个角色，随便怎么按）
 *   - 多人：严格返回该角色的专属键位（KEYMAP[role]）
 *           联机时客人上报的动作走 applyRemote 写入虚拟通道，
 *           不需要、也不应该让本机键盘去碰对方角色。
 */
function keymapFor(role) {
  if (Game.playerCount === 1) return KEYMAP_SINGLE;

  /* ============================================================
   * ★ 🏁 PK 模式：玩家用全键位（2026-10-06 十一反馈后修）★
   * ============================================================
   * 【十一反馈的原话】
   *   "我可以使用 WASD 和箭头都可以控制，而刚刚只能用箭头控制"
   *
   * 【为什么原来只能用一套键（我的设计失误）】
   *   PK 用了 `playerCount = 2` —— 因为要场上出现两个角色。
   *   而 `playerCount === 2` 在这里会被当成"双人同屏"，
   *   于是返回 `KEYMAP[role]`（每人一套专属键，**交集为空**）。
   *
   *   但 PK 的"第二个角色"是 **AI**，不是另一个真人！
   *   ⇒ **根本不存在抢键问题**，限制键位纯属多余，还害得玩家
   *     只能用方向键、WASD 完全没反应。
   *
   * 【修法】
   *   如果这个 role **不是 AI 在开**，说明它是玩家自己的角色 →
   *   给它 KEYMAP_SINGLE（方向键 + WASD + 空格 全都能用）。
   *
   * ⚠️ 绝不能影响**双人同屏**：那里 Game.aiRoles 是 null，
   *    两个角色都不是 AI，所以照样走 KEYMAP[role]，隔离依然严格。
   * ============================================================ */
  /* ============================================================
   * ★ 🏁 PK 模式：玩家用全键位（2026-10-06 十一反馈后修）★
   * ============================================================
   * 【十一反馈的原话】
   *   "我可以使用 WASD 和箭头都可以控制，而刚刚只能用箭头控制"
   *
   * 【为什么原来只能用一套键（我的设计失误）】
   *   PK 用了 `playerCount = 2` —— 因为要场上出现两个角色。
   *   而 `playerCount === 2` 在这里会被当成"双人同屏"，
   *   于是返回 `KEYMAP[role]`（每人一套专属键，**交集为空**）。
   *
   *   但 PK 的"第二个角色"是 **AI**，不是另一个真人！
   *   ⇒ **根本不存在抢键问题**，限制键位纯属多余，还害得玩家
   *     只能用方向键、WASD 完全没反应。
   *
   * 【修法】
   *   如果这个 role 是**玩家自己的**（= Game.pkMyRole）→
   *   给它 KEYMAP_SINGLE（方向键 + WASD + 空格 全都能用）。
   *
   * ⚠️ 绝不能影响**双人同屏**：那里 `Game.isPk` 是 false，
   *    所以照样走 KEYMAP[role]，键位隔离依然严格。
   * ============================================================ */
  if (Game.isPk === true && Game.pkMyRole === role) {
    return KEYMAP_SINGLE;
  }

  return KEYMAP[role] || KEYMAP.kangaroo;
}

/* 输入状态：记录哪个键被按下，以及上一帧的状态（用于判断"刚按下"） */
const InputState = {
  now: {},    // 本帧按键状态
  prev: {},   // 上一帧按键状态

  /* ============================================================
   * ★ AI 输入通道（2026-10-06 · PK 模式）★
   * ============================================================
   * 键：角色 role。值：{ left, right, jump }。
   *
   * 【为什么要单独一条通道，而不是"往 now 里塞键码"】
   *   如果 AI 直接往 `now` 里写真实键码（比如 KeyD），会出现两个问题：
   *     ① 和真实键盘**抢同一个键** —— 玩家按一下就把 AI 的输入覆盖了
   *     ② 单人模式下 `keymapFor` 返回的是 `KEYMAP_SINGLE`（方向键+WASD 都在里面），
   *        往哪个键写都会顺便驱动玩家自己 → **AI 一动玩家也动**
   *
   *   ⇒ 用**独立的 role → 输入对象**映射，在 `actionHeld` 里**优先读它**。
   *     这样 AI 的输入和真实键盘完全隔离，谁都不会影响谁。
   *
   * ⚠️ 这是个**纯附加**的结构：没人往 aiInput 里写时，行为和不加它完全一样。
   *    所以它不会影响单人/联机/双人的任何既有逻辑。
   * ============================================================ */
  aiInput: {},

  /* 给某个角色设 AI 输入（PK 模式每帧调用） */
  setAI: function (role, input) { this.aiInput[role] = input; },
  /* 清掉所有 AI 输入（退出 PK / 换关时调用） */
  clearAI: function () { this.aiInput = {}; this.aiPrev = {}; },
  /* 这个角色是不是 AI 在开 */
  isAI: function (role) { return !!this.aiInput[role]; },

  /* ============================================================
   * ★ AI 的"上一帧输入"（2026-10-06 修 bug 时加，很重要）★
   * ============================================================
   * 【踩过的坑】跳跃用的是 `actionPressed`（**刚按下**才算），
   *   而它在物理层是这么用的：
   *       if (InputState.actionPressed(p.role, 'jump')) p.jumpBuffer = ...
   *
   *   我第一版让 AI 的 jump 返回 `!!aiInput.jump` —— **持续为 true**。
   *   于是 `prev.jump` 也永远是 true → `justPressed` **永远不成立**
   *   → **AI 根本跳不起来**。
   *
   *   实测症状：AI 走到坑边想跳，但跳跃完全没生效，
   *   直接走下坑摔死（死因 fall，跳跃高度只有 -27px 说明压根没跳）。
   *
   *   ⇒ 修法：给 AI 也维护 prev，这样才能算出真正的"刚按下"。
   * ============================================================ */
  aiPrev: {},

  /* 本地键盘写入 */
  /* 本地键盘/触屏写入。
   * ★ 2026-10-07：**按下时同时置"脉冲锁存"**（见下方 _latch 大段说明）★
   *   这样即使按下和抬起挤在同一个逻辑步内，物理层也一定看得到一次 ——
   *   修的就是十一报的"轻触无法被正确识别或触发"。 */
  setKey: function (code, down) {
    var d = !!down;
    this.now[code] = d;
    if (d) this._latch[code] = this.LATCH_FRAMES;
  },

  /* ============================================================
   * ★★★ 2026-10-07 新增：按下「脉冲锁存」（修轻触失灵）★★★
   * ============================================================
   * 十一原话："当前的触摸灵敏度仍然不足，在轻触操作时无法被正确识别或触发。"
   *
   * 【根因 —— 轻触落在两个逻辑步之间就彻底丢失】
   *   主循环是**固定 1/60 秒步长**：一帧里可能跑 0 次、1 次、最多 5 次 update。
   *   而 `InputState.now` 只是个"当前状态"表：
   *       pointerdown  → now[code] = true
   *       pointerup    → now[code] = false      （可能紧接着同一帧内发生）
   *       InputState.tick() 才把 now 拷进 prev
   *
   *   ⇒ 如果玩家**快速点一下**（按下→抬起都在同一帧内，甚至两次 tick 之间），
   *     物理层那一次 update() **根本没机会看到 true**
   *     ⇒ `actionPressed` 永远不成立 ⇒ **跳不起来、冲不出去、点了没反应**。
   *   ⇒ 上一轮加的 `reconcile()` 还会在 pointerup 时立刻对账，
   *     把"刚写下但还没被消费"的键更早地清掉，**加重**了这个问题。
   *
   * 【修法：锁存一次"注入"】
   *   · `setKey(code, true)` 时，额外记 `_latch[code] = 2`（存活 2 个逻辑帧）
   *   · `actionPressed()` 读**锁存 或 实时状态**；消费后把锁存减到 0
   *   · `actionHeld()` 也读锁存（保证"按住"语义在极短按时依然成立）
   *
   *   ⇒ 无论按多短，**物理层至少能看到一次按下**，边沿判定不再丢。
   *
   * ⚠️ 为什么是 2 帧而不是 1：
   *   `actionPressed` 在**一次** update 里只需要看到一次；
   *   但某些动作在 update 的**多个位置**读（比如跳 + 冲刺分别读），
   *   给 2 帧余量能覆盖"同一步里被读两次"的情况，且不会让"刚按下"变成"一直按住"
   *   （2 帧 = 33ms，远小于人的连续点击间隔）。
   *
   * ⚠️ 只对**虚拟手柄/触屏**有意义吗？不是 —— 键盘也有同样的丢失可能
   *   （尤其高刷屏 + 极快的敲击）。所以放在**输入层统一处理**，
   *   键盘与触屏一起受益，行为一致。
   *
   * ⚠️ 不改变"按住"语义：锁存只在**按下瞬间**置位、很快归零；
   *   真正的"按住"靠 `now[code]` 持续为 true（锁存只是兜底补一次边沿）。
   * ============================================================ */
  _latch: {},
  /* 锁存存活帧数（见上面"为什么是 2"） */
  LATCH_FRAMES: 2,

  /** 某个键是否处在"按下锁存"里（还没被物理层消费掉） */
  _latched: function (code) { return (this._latch[code] || 0) > 0; },

  clear: function () { this.now = {}; this._latch = {}; },

  /* 帧末推进 */
  tick: function () {
    this.prev = Object.assign({}, this.now);
    /* ★ 锁存倒计时：每过一个逻辑步减 1，归零后彻底移除 ★
     * ⚠️ 必须在 prev 更新**之后**减 —— 否则"按下那一帧"的锁存会
     *    在自己刚被设置时就被减掉，等于没锁。 */
    var self2 = this;
    Object.keys(this._latch).forEach(function (k) {
      self2._latch[k]--;
      if (self2._latch[k] <= 0) delete self2._latch[k];
    });
    /* ★ AI 输入的 prev 也要推进（否则 actionPressed 永远不成立）★
     * 深拷贝一层就够 —— AI 的输入对象每个字段都是布尔值。 */
    var next = {};
    var self = this;
    Object.keys(this.aiInput || {}).forEach(function (role) {
      var src = self.aiInput[role] || {};
      next[role] = { left: !!src.left, right: !!src.right, jump: !!src.jump };
    });
    this.aiPrev = next;
  },

  /* 某个键是否按住 */
  held: function (code) { return !!this.now[code]; },

  /* 某个键是否「刚按下」（本帧按下、上帧没按） */
  justPressed: function (code) { return !!this.now[code] && !this.prev[code]; },

  /* 某个动作是否按住（支持多键，任一按住即算）
   * ★ 2026-10-06：如果这个角色是 AI 在开，**优先返回 AI 的输入** ——
   *   这样 AI 不读键盘、键盘也不影响 AI（完全隔离）。 */
  actionHeld: function (role, action) {
    var ai = this.aiInput[role];
    if (ai) return !!ai[action];
    var map = keymapFor(role);
    var keys = map[action];
    if (!keys) return false;
    for (var i = 0; i < keys.length; i++) {
      /* ★ 实时按下 **或** 还在锁存里（兜底极短按）★ */
      if (this.now[keys[i]] || this._latched(keys[i])) return true;
    }
    return false;
  },

  /* 某个动作是否「刚按下」（多键，任一刚按下即算）
   * ★ AI 同理，而且**必须真的算"刚按下"**：
   *   AI 的 jump 是"电平"信号（AI 想跳时设为 true），
   *   但跳跃判定用的是 actionPressed（边沿）——
   *   第一版我直接 `return !!ai[action]` → 永远是 true → 永远不"刚按下"
   *   → **AI 跳不起来**（实测确认）。
   *   ⇒ 现在用 aiPrev 记录上一帧的 AI 输入，真正算出边沿。 */
  actionPressed: function (role, action) {
    var ai = this.aiInput[role];
    if (ai) {
      var prev = this.aiPrev[role] || {};
      return !!ai[action] && !prev[action];
    }
    var map = keymapFor(role);
    var keys = map[action];
    if (!keys) return false;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      /* ★ 2026-10-07：**锁存优先** —— 极短按（按下+抬起挤在同一步内）时
       *   `now[k]` 可能已经是 false，但锁存还记得"刚按过"。
       *   消费掉锁存（置 0）保证**一次按下只触发一次**，不会连跳。 */
      if (this._latched(k)) {
        this._latch[k] = 0;
        return true;
      }
      /* 常规路径：真实的"本帧按下、上帧没按"边沿 */
      if (this.now[k] && !this.prev[k]) return true;
    }
    return false;
  },

  /* 供外部（网络输入源）批量写入 —— 联机时用。
   *
   * 背景：联机固定「房主 = kangaroo（方向键）/ 客人 = dragon（WASD）」。
   * 房主用 camera 前那个角色，物理也在房主这边跑；
   * 客人的按键由房主代跑，所以要把客人上报的"动作"
   * 翻译成**客人角色（dragon）的键码**写进输入层。
   *
   * ⚠️ 隔离要求：绝不能写到 kangaroo 那套键（方向键），
   * 否则客人的操作会带动房主自己的角色 —— 人会"抢"同一个角色跑。
   * 所以这里只写 KEYMAP.dragon 的键码 + VK.P2_*（虚拟手柄给客人用的那套）。
   *
   * ⚠️ 兼容手机客人：他可能按的是虚拟手柄，
   * 而虚拟键 VK.P2_* 已挂在 KEYMAP.dragon 上（见上方 push），
   * 所以只写 dragon 那套就够了 —— 房主端 actionHeld('dragon', ...) 能读到。 */
  /* 供外部（网络输入源）写入远程玩家按键 —— 联机时用。
   *
   * 设计：**走独立的远程虚拟通道（VK.R_*）**，不碰任何真实键码。
   *
   * 为什么这么做：
   *   远程输入如果用真实键码（KeyA/KeyW...），就会和本机键盘
   *   共用同一格 InputState，双方互相覆盖 → 串键。
   *   用独立通道后，远程和本地在 InputState 里是两个不同的 key，
   *   物理上不可能互相干扰。
   *
   * 参数 role：要驱动的角色（联机时固定是客人角色 dragon）。
   * role 只用于确认目标角色，键码固定用 VK.R_*。 */
  applyRemote: function (role, state) {
    var R = { left: VK.R_LEFT, right: VK.R_RIGHT, jump: VK.R_JUMP, down: null };
    for (var action in R) {
      var code = R[action];
      if (!code) continue;
      if (!(action in state)) continue;
      this.now[code] = !!state[action];
    }
  },
};

function initGame(canvasId) {
  Game.canvas = document.getElementById(canvasId);
  Game.ctx = Game.canvas.getContext('2d');
  Game.ctx.imageSmoothingEnabled = false;
  Game.canvas.width = CANVAS_W;
  Game.canvas.height = CANVAS_H;

  /* 读本地存档（进度 / 最佳用时 / 星数）。
   * SAVE() 是兜底访问器（定义在 physics.js）：save.js 没加载时返回空实现，
   * 所以存档功能挂了也只是"没有进度记录"，不会让游戏起不来。 */
  SAVE().load();

  bindInput();

  /* 手机/平板：建虚拟手柄。桌面端此调用直接返回，无副作用。 */
  try { TouchPad.init(); } catch (e) { /* 触屏初始化失败不影响游玩 */ }

  /* ---- 视口自适应：让 1280x720 的画布等比缩放到任意屏幕 ---- */
  try { setupViewport(); } catch (e) { /* 自适应失败也不该让游戏起不来 */ }

  requestAnimationFrame(loop);
}

/* ============================================================
 * 视口自适应（canvas 等比缩放）
 * ============================================================
 * 问题：canvas 内部固定 1280x720（游戏逻辑坐标），但 CSS 只写了
 * `max-width:100%`。在手机上，竖屏时宽度被压到屏幕宽、
 * 高度还按 720 撑，结果画面被拉扁/超出屏幕 —— 看着像"排版错乱"。
 *
 * 做法：把 CSS 尺寸按窗口比例算出来，保持 16:9，居中显示。
 * 只改 CSS 尺寸，**不改 canvas.width/height**，
 * 所以渲染坐标和物理坐标一动不动，零风险。
 * ============================================================ */
function setupViewport() {
  var canvas = Game.canvas;
  if (!canvas) return;

  function fit() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    /* canvas 在 CSS 里是 content-box，所以 style.width 设的就是
     * **纯画面宽度**（边框不算在内）。但边框确实占地方（左右各 3px），
     * 计算可用空间时要留出来，否则整块会轻微溢出屏幕。
     * 3px 边框 × 2 边 = 6px。 */
    var bw = 6;

    var padX = 8, padY = 8;
    var availW = vw - padX * 2 - bw;
    var availH = vh - padY * 2 - bw;

    var scale = Math.min(availW / CANVAS_W, availH / CANVAS_H);
    if (!isFinite(scale) || scale <= 0) scale = 1;

    var w = Math.floor(CANVAS_W * scale);
    var h = Math.floor(CANVAS_H * scale);

    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    /* 竖屏判定：**只在手机模式下生效**。
     *
     * ⚠️ 2026-10-06 改动：原来写的是 `TouchPad.enabled`，
     *    而 enabled 在旧代码里 == "这是触屏设备"。
     *    问题是现在手柄骨架**无条件**建好（为了支持运行时切换模式），
     *    enabled 恒为 true —— 那样桌面端把窗口拉窄一点
     *    就会弹出"请把手机横过来"，非常莫名其妙。
     *    改成看玩家选的模式：只有手机模式才谈得上横竖屏。 */
    var portrait = DEVICE_STATE().isMobile() && vh > vw;
    document.body.classList.toggle('portrait', portrait);

    /* 尺寸/朝向变化后，手柄的可显示性可能变了（横竖屏切换）——
     * 重新算一次显隐。这是**唯一**会让手柄自动出现/消失的路径，
     * 而且它只看模式+是否在游玩+是否横屏，绝不会因为"检测到触屏"
     * 就自己冒出来。 */
    try { TouchPad.syncVisibility(); } catch (e) {}
  }

  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', function () {
    /* 旋转瞬间要把手柄按键全松开：
     * 否则如果玩家正按着"右"时旋转屏幕，手柄被 CSS 隐藏，
     * pointerup 收不到 → 那个虚拟键永远停在按下状态 → 角色一直往右跑。 */
    try { TouchPad.releaseAll(); } catch (e) {}
    // 旋转后窗口尺寸要等一帧才更新
    setTimeout(fit, 120);
  });

  /* 切到后台/失焦也松开，避免回来发现角色在乱跑 */
  window.addEventListener('blur', function () {
    try { TouchPad.releaseAll(); } catch (e) {}
  });
}

function bindInput() {
  window.addEventListener('keydown', function (e) {
    // 正在输入框里打字（比如输房间码）时，不要抢按键，
    // 否则打字会被游戏当成操作，而且输入法/退格会乱掉。
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    // 阻止方向键 / 空格滚动页面；阻止退格触发浏览器"后退"
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Backspace'].indexOf(e.key) >= 0) {
      e.preventDefault();
    }
    // 防止长按重复触发
    if (e.repeat) return;
    InputState.setKey(e.code, true);
  });
  window.addEventListener('keyup', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    InputState.setKey(e.code, false);
  });
  window.addEventListener('blur', function () { InputState.clear(); });
}

/* 全局按键查询（用于菜单、重开等非玩家动作） */
function pressed(code) { return InputState.justPressed(code); }
function held(code) { return InputState.held(code); }

/* ============================================================
 * 触屏手柄（手机 / 平板）
 * ============================================================
 * 为什么需要它：这个游戏原本只有 keydown/keyup，手机没键盘就等于
 * **打不开也玩不了**。十一反馈"手机上打不开"，实际表现就是
 * 页面能显示、但怎么点都没反应，看着像卡死。
 *
 * ★ 2026-10-06 重要改动：**显示与否由玩家决定，不由探测决定** ★
 * ------------------------------------------------------------
 * 原实现是 `if (!this.isTouchDevice()) return;` —— 触屏就自动造手柄。
 * 这在两种真实场景下全都判错：
 *   · 触屏 Windows 笔记本（用键盘玩，却被糊了一层虚拟按键）
 *   · 平板横屏（一半屏幕被按键占掉）
 *
 * 现在改成：
 *   · 手柄**永远**在 DOM 里建好（成本极低，就是个空 div）
 *   · 显不显示，只看 `DEVICE.isMobile()` —— 玩家手动选的结果
 *   · 任何触摸事件、尺寸变化、模式切换都**不会**把它偷偷打开
 *
 * 显隐规则（三条，缺一不可）：
 *   ① 必须是手机模式
 *   ② 必须正在游玩（菜单/暂停/结算/失败里都藏起来）
 *   ③ 不能是竖屏（竖屏时改为显示"请横过来"提示）
 *
 * 设计：
 *   - 按钮用真实的 DOM 元素（不是画在 canvas 上），
 *     这样 `pointerdown/up` 事件最稳，也不会跟 canvas 渲染打架；
 *   - 每个按钮绑定一个虚拟键码，按下去等价于敲键盘；
 *   - 支持多点触控（一只手按方向、一只手按跳）；
 *   - 手指滑出按钮范围时自动松开（pointerleave/pointercancel），
 *     避免"手指移开了但角色一直在往左跑"的经典 bug。
 * ============================================================ */

const TouchPad = {
  enabled: false,
  root: null,
  _buttons: [],   // { el, code }

  /* 是否触屏设备 —— ⚠️ 这个判断**只用于探测默认值**，
   * 绝对不要拿它来决定显不显示手柄。
   * 保留它是为了兼容可能存在的旧调用点。 */
  isTouchDevice: function () {
    return ('ontouchstart' in window) ||
           (navigator.maxTouchPoints > 0) ||
           (navigator.msMaxTouchPoints > 0);
  },

  init: function () {
    /* ⚠️ 注意：这里**没有** `if (!this.isTouchDevice()) return;`。
     *    手柄骨架无条件建好 —— 因为玩家可能先用电脑模式打开、
     *    之后在设置里切到手机模式。如果初始化时按设备跳过，
     *    切过去就会发现"切换了但没手柄"。
     *    DOM 成本只是一个空 div，不值得为省它引入这种 bug。 */
    if (this.root) return;          // 防重复初始化
    this.enabled = true;

    var root = document.createElement('div');
    root.id = 'touchpad';

    /* 手柄按钮的虚拟键码是**动态决定**的 —— 见 currentCodes()。
     * 这里先建好按钮骨架，键码绑定延后到按下的那一刻。
     *
     * 布局（横屏，左右手分工）：
     *   左手区：◀ ▶
     *   右手区：跳（大）· 冲刺（大）· 下落（小）
     * 跳跃和冲刺做得更大更亮 —— 十一要求"跳跃和冲刺按钮比方向键更突出"。 */
    var layout = [
      { cls: 'left',  label: '◀',  action: 'left' },
      { cls: 'right', label: '▶',  action: 'right' },
      { cls: 'down',  label: ' ▼', action: 'down' },
      { cls: 'jump',  label: '跳', action: 'jump' },
      { cls: 'dash',  label: '冲', action: 'dash' },
      /* ============================================================
       * ★★ 2026-10-07 新增：暂停 / 全屏（十一反馈"手机上退不出去"）★★
       * ============================================================
       * 【为什么必须有】
       *   电脑上按 ESC 就能暂停、再退到主菜单。手机**没有 ESC 键**
       *   ⇒ 十一原话："放到手机版上完全就退出不了，因为根本没有那个按钮，
       *      进入游戏之后。"
       *
       * 【为什么放在"右上角"】
       *   左下角是方向键、右下角是跳/冲（十一指定的布局）。
       *   暂停/全屏属于**系统功能**，放右上角既不跟手指打架，
       *   也是手机游戏里"菜单键"的通用位置。
       *
       * ⚠️ 这两个按钮**不写 InputState**（不是游戏动作），
       *    所以 `action` 用特殊名，`_bind` 里单独分流。
       * ============================================================ */
      { cls: 'pause',  label: '❚❚', action: 'pause',  sys: true },
      { cls: 'full',   label: '⛶',  action: 'full',   sys: true },
    ];

    var that = this;
    layout.forEach(function (cfg) {
      var b = document.createElement('div');
      b.className = 'tp-btn tp-' + cfg.cls;
      b.textContent = cfg.label;
      b.setAttribute('data-action', cfg.action);
      root.appendChild(b);
      that._buttons.push({ el: b, action: cfg.action, code: null });
      that._bind(b, cfg.action);
      /* ★ 2026-10-07：给每个按钮接上"编辑模式拖拽"（平时无副作用）★ */
      that._bindDrag(that._buttons[that._buttons.length - 1]);
    });

    document.body.appendChild(root);
    this.root = root;

    /* ============================================================
     * ★★★ 2026-10-07 终极修法：**按坐标对账**（免疫 pointerId 乱序）★★★
     * ============================================================
     * 【为什么前面按 pointerId 记账还不够】
     *   实测（真浏览器 + 真实触摸）发现：抬起「跳」的手指时，
     *   浏览器会把 `pointerup` 投给 **◀ 按钮**，而且带的是 ◀ 自己的
     *   pointerId（`pointerup | tp-left | id=2`）。
     *   这是触屏上 pointerId 由 touch 合成、**顺序不保证**导致的
     *   （第一根手指可能拿到 id=2、第二根 id=3，释放时还可能错配）。
     *   ⇒ 只要**依赖 pointerId 归属**，就一定有概率串键。
     *
     * 【做法：不看 id，只看"哪根手指现在压在哪"】
     *   在 document 上（**捕获阶段**）统一记录所有活动指针的坐标：
     *       this._livePointers[pointerId] = {x, y}
     *   然后**每帧**（`TouchPad.reconcile()`，由 applyScale/syncVisibility
     *   和游戏循环调用）按坐标做一次"命中测试"：
     *       对每个按钮，找有没有**仍在活动**的指针落在它范围内
     *       → 有 = 这个键该是按下；没有 = 该松开。
     *   坐标是物理事实，永远不会像 id 那样错配。
     *
     * 【代价与取舍】
     *   · 命中测试用 `getBoundingClientRect()`：每帧对 5 个按钮各一次，
     *     浏览器有缓存，开销可忽略（只在手机模式 + 游玩时跑）。
     *   · ⚠️ **手指滑出按钮 = 自动松开**。对方向键这其实是**更符合直觉**
     *     的行为（手指移开就该停）。之前"按住滑出去也不松"反而会让玩家
     *     觉得"我手都离开了角色还在跑"。
     *   · ⚠️ 多指按同一按钮、以及多指分别按不同按钮，坐标法**天然正确**。
     *
     * ⚠️ 这套"对账"是**兜底**，不是主路径：正常的 pointerdown/up 依然
     *    会即时写键（保证零延迟）。reconcile 只在下一帧做修正，
     *    所以"按下去立刻响应"这个手感**一点没丢**。
     * ============================================================ */
    this._livePointers = {};
    this._bindGlobalPointerTrack();

    /* ★ 建好骨架后立刻套用"按键大小倍率"（十一要求可调）★
     * 不在这里套的话，第一次进游戏会先按 CSS 的默认值（1）渲染，
     * 等玩家动了设置页滑块才变 —— 视觉上会"闪一下"。 */
    this.applyScale();

    /* 注意：这里**不再**无条件加 body.touch-mode。
     * 那个 class 现在由 DEVICE._applyBodyClass() 统一管理
     * （它同时控制虚拟手柄显隐和键盘提示显隐）。 */
    this.syncVisibility();
  },

  /* 在 document 捕获阶段记录所有活动指针坐标（唯一真相源） */
  _bindGlobalPointerTrack: function () {
    var self = this;
    /* 用捕获阶段（第三个参数 true）—— 即使某个按钮 stopPropagation，
     * 我们依然能收到，保证记录完整。 */
    var add = function (e) {
      if (!e) return;
      self._livePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    };
    var move = function (e) {
      if (!e) return;
      if (!self._livePointers[e.pointerId]) return;   // 只跟踪"已按下"的
      self._livePointers[e.pointerId].x = e.clientX;
      self._livePointers[e.pointerId].y = e.clientY;
    };
    var del = function (e) {
      if (!e) return;
      delete self._livePointers[e.pointerId];
      /* ★ 立刻做一次对账：手指抬起当帧就修正，不受 id 错配影响 ★ */
      self.reconcile();
    };
    if (window.PointerEvent) {
      document.addEventListener('pointerdown', add, true);
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', del, true);
      document.addEventListener('pointercancel', del, true);
    } else {
      /* 老设备：touch 用 identifier 当键 */
      document.addEventListener('touchstart', function (e) {
        var ts = e.changedTouches || [];
        for (var i = 0; i < ts.length; i++) {
          self._livePointers['t' + ts[i].identifier] = { x: ts[i].clientX, y: ts[i].clientY };
        }
      }, true);
      document.addEventListener('touchmove', function (e) {
        var ts = e.changedTouches || [];
        for (var i = 0; i < ts.length; i++) {
          var k = 't' + ts[i].identifier;
          if (self._livePointers[k]) { self._livePointers[k].x = ts[i].clientX; self._livePointers[k].y = ts[i].clientY; }
        }
      }, true);
      var endT = function (e) {
        var ts = e.changedTouches || [];
        for (var i = 0; i < ts.length; i++) delete self._livePointers['t' + ts[i].identifier];
        self.reconcile();
      };
      document.addEventListener('touchend', endT, true);
      document.addEventListener('touchcancel', endT, true);
    }
    /* 失去焦点/页面隐藏时，把所有指针视为已抬起（否则会留下卡住的键） */
    window.addEventListener('blur', function () { self._livePointers = {}; self.releaseAll(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { self._livePointers = {}; self.releaseAll(); }
    });
  },

  /**
   * ★ 对账：按**指针坐标**反推每个按钮该不该按下。
   *
   * 【为什么必须有它】
   *   见 _bindGlobalPointerTrack 的说明 —— pointerId 在触屏上会错配，
   *   "抬起跳的手指却松开了◀"就是这么来的。坐标是物理事实，不会错配。
   *
   * 【实现要点】
   *   · 只对**非系统按钮**（left/right/jump/dash/down）做对账 ——
   *     暂停/全屏是一次性点击，不该被"按住"语义影响。
   *   · ⚠️ 编辑模式下**跳过**：那时按钮是拿来拖的，不是拿来按的。
   *   · 用 `document.elementFromPoint` 会受 pointer-events / 层级影响，
   *     所以这里用**矩形包含判断**，最稳。
   */
  reconcile: function () {
    if (!this.root || this._editMode) return;
    if (!DEVICE_STATE().isMobile()) return;
    /* 手柄没显示时不用对账（避免隐藏状态下误写键） */
    if (!this.root.classList.contains('tp-on')) return;

    var pts = [];
    var keys = Object.keys(this._livePointers || {});
    for (var i = 0; i < keys.length; i++) {
      var q = this._livePointers[keys[i]];
      if (q) pts.push(q);
    }

    /* ★★ 安全闸：**没有任何活动指针时，绝不主动清键** ★★
     * ------------------------------------------------------------
     * 【为什么必须有这道闸】
     *   对账的语义是"按坐标修正"。但有一种情况会让它误伤：
     *   **指针表是空的**（比如刚初始化、或某些浏览器不派发
     *   document 级 pointerdown、或自动化测试派发了没有坐标的合成事件）。
     *   此时"没有任何指针在按钮上"⇒ 会被判成"所有键都该松开"，
     *   于是**一按下去就被清掉**，手感表现为"完全按不动"。
     *
     *   ⇒ 规则：**只有在"确实跟踪到了至少一个活动指针"时才对账**。
     *     没有指针信息时，保持 pointerdown/up 直接写的键不动 ——
     *     退回"纯事件驱动"的老行为（那个行为至少不会乱清）。
     *
     *   ⚠️ 那"手指真的全部抬起"怎么办？不需要这里管 ——
     *     抬起的瞬间 document 的 pointerup/touchend 会**立刻**调
     *     reconcile（见 _bindGlobalPointerTrack 的 del），
     *     那时候"最后一个指针刚好被删掉"，但我们靠 pointerup
     *     自身的 releasePointer 已经把键清干净了。
     * ------------------------------------------------------------ */
    if (pts.length === 0) return;

    var that = this;
    this._buttons.forEach(function (b) {
      if (b.action === 'pause' || b.action === 'full') return;   // 系统键不对账
      var r = b.el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;                 // 没布局就别动
      /* 命中测试：有没有活动指针落在按钮矩形内（含 ±14px 的隐形热区，
       * 和 CSS 的 ::before 扩张量保持一致 —— 否则"看起来按到了却不算"） */
      var PAD = 14;
      var hit = false;
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j];
        if (p.x >= r.left - PAD && p.x <= r.right + PAD &&
            p.y >= r.top - PAD && p.y <= r.bottom + PAD) { hit = true; break; }
      }
      var codes = that.currentCodes();
      var code = codes[b.action];
      if (!code) return;
      var isDown = !!InputState.now[code];
      if (hit && !isDown) {
        /* 应该按下但没有（比如 pointerdown 被 id 错配漏掉了）⇒ 补上 */
        InputState.setKey(code, true);
        b.el.__padCode = code;
        b.el.classList.add('held');
      } else if (!hit && isDown) {
        /* 不该按下但还按着（比如抬起时事件投错元素）⇒ 松开
         * ⚠️ 这是"抬起跳的手指却松开了◀ / 跳卡住"的根治点。
         *
         * ★★ 2026-10-07 修轻触：**但"刚按下还没被物理层消费"的键不能清** ★★
         *   轻触时 pointerup 会立刻调 reconcile，若此时直接清掉，
         *   物理层就永远看不到这次按下了（十一报的"轻触无响应"）。
         *   ⇒ 只要锁存还在，说明"这次按下还没被消费"，**放它一马**。 */
        var latched = (typeof InputState._latched === 'function') && InputState._latched(code);
        if (latched) return;                 // 让锁存把它交给物理层
        that._clearKeysFor(b.action);
        b.el.__padCode = null;
        b.el.classList.remove('held');
      }
    });
  },

  /* ------------------------------------------------------------
   * 计算当前该用哪套虚拟键码
   * ------------------------------------------------------------
   * 手柄是给"本机操控的角色"用的，而本机操控谁取决于模式：
   *   单人 / 联机房主 → 袋鼠 → VK.P1_*
   *   联机客人        → 奶龙 → VK.P2_*
   *   双人同机        → 两人挤一台手机，暂用 P1（未来可加双套手柄）
   *
   * 踩过的坑：原来写死 VK.P1_*。
   * 结果手机**客人**按手柄完全没反应 —— 因为 P1 虚拟键属于袋鼠，
   * 而客人操控的是奶龙，读到的是 false。
   * ------------------------------------------------------------ */
  currentCodes: function () {
    var role = 'kangaroo';
    try {
      var roles = localRoles();
      // 本机只操控一个角色时，用那个角色的虚拟键
      if (roles.length >= 1) role = roles[0];
    } catch (e) { /* 游戏未初始化时兜底用 P1 */ }

    return (role === 'dragon')
      ? { left: VK.P2_LEFT, right: VK.P2_RIGHT, jump: VK.P2_JUMP,
          down: VK.P2_DOWN, dash: VK.P2_DASH }
      : { left: VK.P1_LEFT, right: VK.P1_RIGHT, jump: VK.P1_JUMP,
          down: VK.P1_DOWN, dash: VK.P1_DASH };
  },

  /* 给一个按钮绑定按下/松开 —— 同时用 pointer 和 touch 事件兜底 */
  _bind: function (el, action) {
    var that = this;

    /* ★ 系统按钮（暂停 / 全屏）走单独分支 —— 见 layout 里的 sys:true ★
     * ------------------------------------------------------------
     * 它们**不是游戏动作**，不该往 InputState 写键码：
     *   · 暂停 → 直接切 Game.state（和按 ESC 同一条路径）
     *   · 全屏 → 调 Fullscreen API
     * 所以在这里提前分流，下面的"写虚拟键"逻辑它们完全不碰。 */
    if (action === 'pause' || action === 'full') {
      var fire = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        /* 手机上才生效（和普通虚拟键同一条防线：电脑模式绝不响应） */
        if (!DEVICE_STATE().isMobile()) return;
        el.classList.add('held');
        setTimeout(function () { el.classList.remove('held'); }, 130);
        if (action === 'pause') {
          try { togglePauseByTouch(); } catch (err) {
            console.error('[手机] 暂停失败：', err);
          }
        } else {
          try { toggleFullscreenByTouch(); } catch (err) {
            console.error('[手机] 全屏失败：', err);
          }
        }
      };
      if (window.PointerEvent) {
        el.addEventListener('pointerdown', fire, { passive: false });
      } else {
        el.addEventListener('touchstart', fire, { passive: false });
        el.addEventListener('click', fire, { passive: false });
      }
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      return;
    }

    /* ============================================================
     * ★★ 2026-10-07 重做：按住持续移动 + 多键同时按 ★★
     * ============================================================
     * 十一原话："我希望不要一直按那个向左向右，要需要一直点。
     *           我希望就是我按到它可以一直向左或者向右。"
     *          "你在按左右的时候不能跳。我希望这些按钮都是可以同时按的。"
     *
     * 【为什么原来"必须一直点"，按住了却会松】
     *   三个叠加的毛病，全在 release 这一侧：
     *     ① `release()` 里调的是 `_clearAllVirtualKeys()` ——
     *        **松开任意一个按钮会把全部虚拟键都清掉**。
     *        症状：按住 ◀ 不放，手指去够一下「跳」，跳一松手，
     *        ◀ 也被顺手清掉了 ⇒ 角色立刻停下，只能继续点。
     *     ② `pointerleave` 也绑了 release ——
     *        拇指在按钮上按住不动时，指腹会有几毫米的滑动，
     *        一旦滑出按钮边界立刻触发 leave ⇒ 松开。
     *        大屏 iPad 上按住一个 76px 的圆钮，滑出去太容易了。
     *     ③ 老设备那条 touch 分支没有 `pointerleave` 的问题，
     *        但同样被 ① 的"全清"连累。
     *
     * 【第一轮修法（已被第二轮推翻，保留记录以免重蹈覆辙）】
     *     ① `release()` 只清本按钮的动作键 —— ✅ 这条是对的，保留。
     *     ② 删 `pointerleave`、改用 `setPointerCapture` 兜底 ——
     *        ❌ **这是错的**！它导致多指串键（抬起跳的手指却松开了 ◀）。
     *        第二轮已**彻底删掉 capture**，改为按 pointerId 记账。
     * ============================================================ */
    /* ============================================================
     * ★★ 2026-10-07 二次返工：按 pointerId 记账，**彻底删掉 setPointerCapture** ★★
     * ============================================================
     * 十一反馈："虽然可以同时按住两个按钮，但无法做到在移动过程中同时进行跳跃。
     *           要么是只能跳跃，要么是只能移动。"
     *
     * 【真机实测抓到的根因】（真浏览器 + 真实触摸事件复现）
     *   按住 ◀（手指1）+ 按跳（手指2），然后**抬起跳的那根手指**时：
     *       事件明细 → ["pointerup | tp-left | id=2"]
     *       ⇒ **抬的是「跳」的手指，pointerup 却发给了「◀」按钮**！
     *       结果：◀ 被松开（角色停下）、而「跳」永远卡在按下状态。
     *   这正是"要么只能跳、要么只能移动"的来源。
     *
     * 【为什么会这样 —— `setPointerCapture` 是罪魁】
     *   上一轮为了修"拇指按住时滑出按钮就松手"，给按钮加了
     *   `el.setPointerCapture(e.pointerId)`。
     *   但 **触屏上的 pointerId 是浏览器从 touch 合成出来的**，
     *   在 `touch-action:none` 的页面上，id 分配/回收顺序**不保证稳定**
     *   （实测第一根手指拿到 id=2、第二根拿到 id=3）。
     *   一旦对某个 id 做了 capture，**该指针的后续事件会被强制重定向到
     *   捕获元素**——于是"抬第二根手指"的 pointerup 被投递到了
     *   第一根手指所在的按钮上。多指同时按直接失效。
     *
     * 【正确做法：不捕获，改用"按 pointerId 记账"】
     *   · 每个按钮维护自己的 `el.__pointers`（Set / Map），记录
     *     **有哪些 pointerId 正按在这个按钮上**。
     *   · pointerdown：把自己的 id 加进去 → 置键为 true。
     *   · pointerup / pointercancel：只从自己的集合里删**这个 id**；
     *     **集合空了才真的松开**（这样"两根手指按同一个按钮"也不会误松）。
     *   · 不用 capture ⇒ 事件永远不会被重定向到别的按钮 ⇒ 天然支持多指。
     *   · 手指滑出按钮：不 capture 会收到 pointerleave ——
     *     ⚠️ 但**不能**在 leave 时松开（否则回到"按住滑一下就断"的老毛病）。
     *     折中：leave 时**保留按下**（靠 pointerup 兜底）。
     *     代价是"手指移出按钮后仍算按着"，对方向键完全可接受
     *     （玩家本来就是按住不放），而且比"断触/串键"好得多。
     * ============================================================ */
    var press = function (pointerId) {
      /* 手机模式下才允许手柄写入按键。
       * 这是"电脑模式彻底禁用虚拟按键"的最后一道防线 ——
       * 即使按钮因为某种原因还留在 DOM 里（比如 CSS 没加载），
       * 按下去也不会有任何效果。 */
      if (!DEVICE_STATE().isMobile()) return;
      /* 按下时才取键码 —— 保证跟随当前模式 */
      var codes = that.currentCodes();
      var code = codes[action];
      if (!code) return;
      /* ★ 记账：这个 pointerId 正按在本按钮上 ★
       * 用 Map（id → code）而不是 Set —— 因为"松开时该清哪个键码"
       * 取决于**按下当时**的模式（房间主/客人会切），不能到松开时再算。 */
      if (!el.__pointers) el.__pointers = {};
      el.__pointers[pointerId] = code;
      el.setAttribute('data-code', code);
      InputState.setKey(code, true);
      el.classList.add('held');
    };
    /* 松开"某一个 pointerId"。只有当所有按在本按钮上的手指都走了，
     * 才真正把这个动作的键置 false —— 否则多指按同一按钮会误松。 */
    var releasePointer = function (pointerId) {
      if (!el.__pointers) return;
      var code = el.__pointers[pointerId];
      if (code === undefined) return;          // 这个 id 不归本按钮管
      delete el.__pointers[pointerId];
      /* 还有别的指针按着 ⇒ 键继续按住，不松 */
      if (Object.keys(el.__pointers).length > 0) return;
      /* ★ 只清本按钮对应的动作键（多键同时按的关键）★
       * 原来这里是 `_clearAllVirtualKeys()` —— 一松手清掉所有键，
       * 于是"按住◀ + 点跳"永远做不到（点完跳◀就没了）。
       *
       * ★★ 2026-10-07 修轻触：**保留锁存**（`keepLatch=true`）★★
       *   `now[code]` 要立刻置 false（手感：手指离开就该停），
       *   但**锁存不能清** —— 它的全部意义就是"即使已经抬起，
       *   也要让物理层看到这一次按下"。
       *   之前这里连带清了锁存 ⇒ 轻触点一下完全没反应（十一报的 bug）。 */
      InputState.setKey(code, false);
      that._clearKeysFor(action, true);
      el.__padCode = null;
      el.classList.remove('held');
    };

    /* Pointer Events：现代浏览器（含 iOS 13+/Android）首选。
     * ⚠️ **绝不要 setPointerCapture**（原因见上面的大段说明）——
     *    它会让多指同时按串键，"边走边跳"直接失效。 */
    if (window.PointerEvent) {
      el.addEventListener('pointerdown', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        press(e.pointerId);
      }, { passive: false });
      el.addEventListener('pointerup', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        releasePointer(e.pointerId);
      }, { passive: false });
      el.addEventListener('pointercancel', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        releasePointer(e.pointerId);
      }, { passive: false });
    } else {
      /* 老设备的 touch 事件兜底。
       * ⚠️ touch 没有 pointerId，用 `touch.identifier` 当 id 记账，
       *    同样支持多指（identifier 在触屏上唯一）。 */
      el.addEventListener('touchstart', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var ts = e.changedTouches || [];
        for (var i = 0; i < ts.length; i++) press('t' + ts[i].identifier);
      }, { passive: false });
      var endTouch = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        var ts = e.changedTouches || [];
        for (var i = 0; i < ts.length; i++) releasePointer('t' + ts[i].identifier);
      };
      el.addEventListener('touchend', endTouch, { passive: false });
      el.addEventListener('touchcancel', endTouch, { passive: false });
    }

    /* 兜底：防止手指在按钮上按住时页面被拖动/缩放 */
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  },

  /* 清掉所有角色的虚拟键（含新增的下落/冲刺） */
  _clearAllVirtualKeys: function () {
    [VK.P1_LEFT, VK.P1_RIGHT, VK.P1_JUMP, VK.P1_DOWN, VK.P1_DASH,
     VK.P2_LEFT, VK.P2_RIGHT, VK.P2_JUMP, VK.P2_DOWN, VK.P2_DASH
    ].forEach(function (code) {
      InputState.setKey(code, false);
      /* ★ 2026-10-07：连**锁存**一起清 ★
       *   不然"清键"之后锁存还在，下一次 actionPressed 又会凭空触发一次。
       *   （锁存只在"按下瞬间"该存在，任何主动清理都必须把它抹掉。） */
      delete InputState._latch[code];
    });
  },

  /* ------------------------------------------------------------
   * ★ 只清"某个动作"对应的虚拟键（2026-10-07 新增）★
   * ------------------------------------------------------------
   * 【为什么需要它】十一要"按住◀的同时能按跳"。
   *   原来松手走 `_clearAllVirtualKeys()` ⇒ 点一下跳，◀ 也被清掉，
   *   于是永远做不到"边走边跳"。
   *
   * 【为什么 P1 / P2 两套都要清】
   *   按下和松开之间可能发生"房主→客人"的模式切换
   *   （虽然罕见，但手机上切模式确实存在）。此时按下写的是 P1_LEFT、
   *   松手要清的是 P2_LEFT ⇒ 只清一套会留下"一直往左跑"的残影。
   *   两套都清不会有副作用：另一个人根本没在按这个键时，
   *   写 false 等于没写（`InputState.now[code]` 本来就是 falsy）。
   *
   * ★★ 2026-10-07 修轻触：`keepLatch` 参数 ★★
   *   · 普通"松手"（手指抬起）→ 传 `true`：**保留锁存**。
   *     锁存的意义就是"即使抬起，也要让物理层看到这一次按下"，
   *     清掉它 = 轻触彻底失效（十一报的 bug）。
   *   · "主动清理"（切界面 / 隐藏手柄 / 失焦）→ 传 `false`：
   *     这种场景下必须连锁存一起抹掉，否则会凭空触发一次动作。
   */
  _clearKeysFor: function (action, keepLatch) {
    var p1 = { left: VK.P1_LEFT, right: VK.P1_RIGHT, jump: VK.P1_JUMP,
               down: VK.P1_DOWN, dash: VK.P1_DASH }[action];
    var p2 = { left: VK.P2_LEFT, right: VK.P2_RIGHT, jump: VK.P2_JUMP,
               down: VK.P2_DOWN, dash: VK.P2_DASH }[action];
    if (p1) { InputState.setKey(p1, false); if (!keepLatch) delete InputState._latch[p1]; }
    if (p2) { InputState.setKey(p2, false); if (!keepLatch) delete InputState._latch[p2]; }
  },

  /* 松开全部按键（切界面、失焦时调用，避免"卡住一直跑"） */
  releaseAll: function () {
    if (!this.root) return;
    this._clearAllVirtualKeys();
    this._buttons.forEach(function (b) {
      /* ★ 2026-10-07：**必须把按 pointerId 的记账也清空** ——
       *   否则"手指还按着时手柄被隐藏（比如死了弹结算）"，
       *   之后手指抬起时 pointerup 找不到对应记录（集合里还留着旧 id），
       *   或者更糟：旧 id 挡住新手指的释放判断 ⇒ 复活后角色自己往一边跑。 */
      b.el.__pointers = {};
      b.el.__padCode = null;
      b.el.classList.remove('held');
    });
  },

  /* ------------------------------------------------------------
   * ★ 显隐控制（唯一入口）★
   * ------------------------------------------------------------
   * 三条规则同时满足才显示：
   *   ① 手机模式（玩家选的，不是探测的）
   *   ② 正在游玩 —— 菜单/暂停/结算/失败里都藏起来
   *      （十一明确要求："手机按键只在实际游玩时显示"）
   *   ③ 不是竖屏
   *
   * ⚠️ 这个函数会被频繁调用（状态切换、resize、模式切换）。
   *    它只改 class，不做 DOM 重建，所以开销可忽略。
   * ------------------------------------------------------------ */
  /* ------------------------------------------------------------
   * ★ 应用"按键大小倍率"（2026-10-07 十一要求）★
   * ------------------------------------------------------------
   * 十一原话："设置里面可以加大按键，或者是调小按键，
   *           根据自己的使用习惯去调整按键大小。"
   *
   * 【实现方式】只改一个 CSS 变量 `--tp-scale`，
   *   CSS 里所有尺寸都写成 `calc(基准值 × var(--tp-scale))`
   *   ⇒ **全部按钮等比缩放**，不会出现"方向键变大了跳跃键没变"的错位。
   *
   * 【为什么读存档而不是接参数】
   *   保证任何入口（设置页滑块 / 切设备模式 / 进游戏 / 刷新）
   *   拿到的都是同一个真相源，不会出现两处状态不同步。
   *
   * ⚠️ 读不到存档（模块缺失）时退回 1 —— 绝不能写 NaN 进去，
   *    否则 `calc(76px * NaN)` 非法 ⇒ **按钮尺寸整个塌掉**。
   * ------------------------------------------------------------ */
  applyScale: function () {
    var root = this.root || document.getElementById('touchpad');
    if (!root) return 1;
    var sc = 1, side = 0, hgt = 0, spr = 0;
    try {
      var st = SAVE().settings();
      var n = Number(st && st.padScale);
      if (isFinite(n) && n > 0) sc = n;
      /* ★ 位置档位（2026-10-07 十一要求："大概位置就行"）★
       * ⚠️ `padPosOf` 内部自带校验 —— 手改存档塞怪值会退回默认档，
       *    绝不会算出 NaN 把按钮位置搞塌（`calc(... * NaN)` 是非法值）。 */
      if (typeof padPosOf === 'function') {
        side = padPosOf('side', st && st.padSide);
        hgt = padPosOf('height', st && st.padHeight);
        spr = padPosOf('spread', st && st.padSpread);
      }
    } catch (e) { sc = 1; }
    root.style.setProperty('--tp-scale', String(sc));
    root.style.setProperty('--tp-dx', side + 'px');
    root.style.setProperty('--tp-dy', hgt + 'px');
    root.style.setProperty('--tp-spread', spr + 'px');

    /* ============================================================
     * ★★ 2026-10-07 新增：把玩家**亲手拖**的位置写进每个按钮 ★★
     * ============================================================
     * 十一原话："我想可以自己去调这个位置，这个按钮的位置，
     *           而不是上面写偏左偏右。"
     *
     * 【为什么写在这一个函数里】
     *   `applyScale()` 已经是"大小 + 位置"的唯一出口
     *   （设置页改任意一项、切设备、进游戏、旋转屏幕都会走它）。
     *   把自定义坐标也挂在这里 ⇒ 一个出口、一个真相源，
     *   不会出现"改了大小位置却回到默认"的错位。
     *
     * 【偏移量的语义】相对"档位布局"的**额外**位移（px）。
     *   正向：x 往右、y 往上（和 CSS 的 left/bottom 同向）。
     *   ⚠️ 右组按钮的 CSS 用的是 `right` / `left`，所以符号要相反 ——
     *      这件事**在 CSS 里已经处理**（见 `.tp-jump` 的 `- var(--tp-bx)`），
     *      这里只需要写**同一个语义值**，不用分左右。
     *   没自定义过的键**逐个删掉**变量（而不是写 0px）——
     *      删掉才能走 CSS 的 `var(--tp-bx, 0px)` 默认值，
     *      和"拖了又拖回原位"在视觉上等价但少一层覆盖。
     * ============================================================ */
    if (this._buttons && this._buttons.length) {
      this._buttons.forEach(function (b) {
        var pos = null;
        try {
          if (typeof padCustomOf === 'function') pos = padCustomOf(b.action);
        } catch (err) { pos = null; }
        if (pos) {
          b.el.style.setProperty('--tp-bx', pos.x + 'px');
          /* ⚠️ CSS 的 bottom 越大 = 越往上。
           *   玩家在编辑器里拖出来的 y 我们约定"往上为正"，
           *   和 bottom 同向，所以**不取反**。 */
          b.el.style.setProperty('--tp-by', pos.y + 'px');
        } else {
          b.el.style.removeProperty('--tp-bx');
          b.el.style.removeProperty('--tp-by');
        }
      });
    }
    return sc;
  },

  syncVisibility: function () {
    if (!this.root) return;
    var mobile = DEVICE_STATE().isMobile();
    /* 只有 PLAYING 显示。CLEAR / GAMEOVER / PAUSED / MENU / 各种大厅
     * 全都不显示 —— 那些界面要么在点按钮、要么在看结果，
     * 虚拟手柄盖在上面既没用又挡视线。 */
    var playing = false;
    try { playing = (Game.state === STATE.PLAYING); } catch (e) { playing = false; }

    /* 竖屏判断：高度 > 宽度就是竖着拿。
     * 竖屏时哪怕在游玩也不显示手柄 —— 画面已经小得可怜了，
     * 再糊一层按键就没法看了。这时会显示"请横过来"的遮罩。 */
    var portrait = false;
    try { portrait = window.innerHeight > window.innerWidth; } catch (e) { portrait = false; }

    var show = mobile && playing && !portrait;
    this.root.classList.toggle('tp-on', show);
    /* 手指还按着的时候忽然隐藏（比如死了弹结算），
     * 必须把按键松开，否则复活后角色会自己往一边跑。 */
    if (!show) this.releaseAll();
  },

  /* 兼容旧调用点：以前 refresh() 负责"显示 + 松开按键"。
   * 现在显隐交给 syncVisibility()，refresh() 只保留"松开按键"的语义。 */
  refresh: function () {
    if (!this.root) return;
    this.releaseAll();
    this.syncVisibility();
  },

  /* ============================================================
   * ★★ 2026-10-07 新增：按键位置**拖拽编辑器** ★★
   * ============================================================
   * 十一原话："我想可以自己去调这个位置，这个按钮的位置，
   *           而不是上面写偏左偏右，这种能实现吗？"
   *   ⇒ 能。这一组方法就是"让玩家亲手把按钮拖到顺手的地方"。
   *
   * 【设计取舍：为什么是"独立编辑层"而不是"长按进编辑"】
   *   ① 长按进编辑会和"按住持续移动"打架 ——
   *      刚把 ② 那件事修好（按住就走），再来个"长按=编辑"，
   *      玩家按住方向键不动就会被拖进编辑，体验极差。
   *   ② 编辑时必须在**全屏、横屏、手柄可见**的真实状态下拖，
   *      否则"设置页里看着合适、进游戏就被刘海/大拇指挡住"。
   *      所以编辑层 = 在手柄本体上直接拖，所见即所得。
   *
   * 【进入方式】设置页的「自定义按键位置」按钮 / 暂停面板的入口。
   *
   * 【保存时机】**松手就存**（不是"点保存"）——
   *   手机上切出去/来电太常见，不做"未保存的编辑"这种状态。
   * ============================================================ */
  _editMode: false,

  /** 是否正在编辑按键位置 */
  isEditing: function () { return !!this._editMode; },

  /** 进入编辑模式：显示手柄 + 让按钮可拖 */
  enterEditMode: function () {
    if (!this.root) return;
    this._editMode = true;
    this.root.classList.add('tp-on', 'tp-editing');
    /* 编辑层需要一个"点空白处退出"的提示条 —— 由 ui.js 负责渲染，
     * 这里只广播事件（避免 game.js 里塞一堆 DOM 文案） */
    try {
      window.dispatchEvent(new CustomEvent('pad-edit-enter'));
    } catch (e) { /* 老浏览器不支持 CustomEvent 构造器：无提示条也能用 */ }
  },

  /** 退出编辑模式（值已经在拖动时存好了，这里只收尾） */
  exitEditMode: function () {
    if (!this.root) return;
    this._editMode = false;
    this.root.classList.remove('tp-editing');
    try {
      window.dispatchEvent(new CustomEvent('pad-edit-exit'));
    } catch (e) { /* 同上 */ }
    /* 退出后按正常规则重新判定显隐（编辑时是强制的 tp-on） */
    this.syncVisibility();
  },

  /**
   * 把某个按钮当前的**实际屏幕位置**换算成 `--tp-bx/--tp-by` 偏移。
   *
   * 【为什么不能直接用指针位移累加】
   *   累加会漂（多点触控/取整误差）。正确做法是：
   *     拖完后读 `getBoundingClientRect()` 拿到真实位置，
   *     减去"不带自定义偏移时的位置"= 基准位置，差值就是偏移量。
   *   基准位置怎么拿：把变量清掉、强制重排读一次 rect —— 精确。
   *
   * ⚠️ `--tp-bx/--tp-by` 是相对"档位布局"的额外位移，
   *    所以基准位置必须在**变量清除后**读取，不能拿旧值推算。
   */
  _commitDrag: function (btn) {
    var el = btn.el;
    /* 1. 清掉私有偏移，读"档位基准位置" */
    el.style.removeProperty('--tp-bx');
    el.style.removeProperty('--tp-by');
    var base = el.getBoundingClientRect();
    var cur = btn._dragRect;                 // 拖动过程中记录的目标矩形
    if (!cur) return;
    /* 2. 偏移 = 目标 - 基准。⚠️ y 取反：
     *    rect 的 top 往下增大，而 CSS 的 bottom 往上增大。 */
    var dx = Math.round(cur.left - base.left);
    var dy = Math.round(base.top - cur.top);
    /* 3. 夹紧：别让按钮被拖到屏幕外找不回来（那是不可逆的坑） */
    var W = window.innerWidth, H = window.innerHeight;
    var w = base.width, h = base.height;
    try {
      var st = SAVE().settings();
      var all = (st && st.padCustomPos) || {};
      /* 绝对坐标也要在屏内：基准位置 + 偏移 ∈ [0, W-w] */
      var absLeft = base.left + dx, absTop = base.top - dy;
      absLeft = Math.max(0, Math.min(W - w, absLeft));
      absTop  = Math.max(0, Math.min(H - h, absTop));
      dx = Math.round(absLeft - base.left);
      dy = Math.round(base.top - absTop);
      all[btn.action] = { x: dx, y: dy };
      SAVE().setSetting('padCustomPos', all);   // setSetting 会再洗一遍
    } catch (e) { /* 存档不可用：本次不保存，但不影响拖动本身 */ }
    /* 4. 写回去（applyScale 会统一重算，保证和档位叠加正确） */
    this.applyScale();
  },

  /* 给一个按钮开启"编辑模式拖拽"。
   * ⚠️ 只在 `_editMode` 为真时生效 —— 平时拖动按钮依然只是"按键"，
   *    不会把一个正在跑动的角色手指变成"拖动 UI"（那会毁掉手感）。 */
  _bindDrag: function (btn) {
    var that = this, el = btn.el;
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    el.addEventListener('pointerdown', function (e) {
      if (!that._editMode) return;
      e.preventDefault(); e.stopPropagation();
      dragging = true;
      var r = el.getBoundingClientRect();
      btn._dragRect = { left: r.left, top: r.top, width: r.width, height: r.height };
      sx = e.clientX; sy = e.clientY;
      ox = r.left; oy = r.top;
      el.classList.add('tp-dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    }, { passive: false });

    el.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.preventDefault(); e.stopPropagation();
      var r = btn._dragRect;
      var nx = ox + (e.clientX - sx);
      var ny = oy + (e.clientY - sy);
      /* 实时夹紧到屏内，拖动时就能看到边界，不会"拖出去了才被告知" */
      var W = window.innerWidth, H = window.innerHeight;
      nx = Math.max(0, Math.min(W - r.width, nx));
      ny = Math.max(0, Math.min(H - r.height, ny));
      btn._dragRect.left = nx;
      btn._dragRect.top = ny;
      /* 直接改 left/top（编辑期间临时用，松手后再转成 --tp-bx/by） */
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }, { passive: false });

    var end = function (e) {
      if (!dragging) return;
      dragging = false;
      if (e) { e.preventDefault(); e.stopPropagation(); }
      el.classList.remove('tp-dragging');
      /* 把临时写的 left/top/right/bottom 清掉，
       * 让 CSS 规则重新接管（否则会永久内联这些值） */
      el.style.removeProperty('left');
      el.style.removeProperty('top');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
      that._commitDrag(btn);
    };
    el.addEventListener('pointerup', end, { passive: false });
    el.addEventListener('pointercancel', end, { passive: false });
  },

  /** 全部重置成默认布局（编辑器里的"恢复默认"按钮） */
  resetCustom: function () {
    try { SAVE().setSetting('padCustomPos', null); } catch (e) { /* 忽略 */ }
    try { SAVE().setSetting('padUseCustom', false); } catch (e2) { /* 忽略 */ }
    this.applyScale();
  },
};

/* ============================================================
 * ★★ 手机版「暂停」与「全屏」（2026-10-07 新增）★★
 * ============================================================
 * 十一的原话：
 *   "无论是手机版还是电脑版，电脑上不是有一个 ESC 键可以暂停或者退出
 *    本关吗？但是放到手机版上完全就退出不了，因为根本没有那个按钮。"
 *
 * ⇒ 手机没有 ESC 键，必须在屏幕上补一个入口。
 * ============================================================ */

/**
 * 触屏「暂停」键 —— 走和 ESC **完全同一条状态机路径**。
 *
 * ⚠️ 为什么复用 `Game.state = STATE.PAUSED`，而不是另写一套暂停：
 *   ① 暂停界面（buildPaused）、HUD、音效、联机同步全都挂在
 *      `STATE.PAUSED` 上 —— 另起炉灶等于要改十几处。
 *   ② 走同一条路，**键盘和触屏的行为天然一致**（不会出现
 *      "手机上暂停后键盘按 ESC 恢复不了"这种割裂）。
 *   ③ 暂停面板里本来就有"继续 / 重跑本单 / 回主菜单"三个按钮，
 *      手机上点它们即可 —— **这就是十一要的"退出本关"入口**。
 *
 * 行为（和 ESC 对齐）：
 *   · PLAYING → PAUSED
 *   · PAUSED  → PLAYING（再点一下继续）
 *   · GAMEOVER / CLEAR → 回主菜单（和 ESC 在结算界面一致）
 */
function togglePauseByTouch() {
  if (typeof STATE === 'undefined') return;
  if (Game.state === STATE.PLAYING) {
    Game.state = STATE.PAUSED;
    /* 暂停瞬间松开所有虚拟键 —— 否则手指还按着方向键时暂停，
     * 恢复后会"角色自己往一边跑"（和 syncVisibility 里同一个坑）。 */
    if (typeof TouchPad !== 'undefined') TouchPad.releaseAll();
    if (typeof UI !== 'undefined') UI.lastKey = '';
    if (typeof syncUI === 'function') syncUI();
  } else if (Game.state === STATE.PAUSED) {
    Game.state = STATE.PLAYING;
    if (typeof UI !== 'undefined') UI.lastKey = '';
    if (typeof syncUI === 'function') syncUI();
  } else if (Game.state === STATE.GAMEOVER || Game.state === STATE.CLEAR) {
    /* 结算界面 —— 和按 ESC 一样回主菜单 */
    if (Game.mode === 'online' && typeof leaveRoom === 'function') {
      leaveRoom(); Game.mode = 'local';
    }
    Game.state = STATE.MENU;
    if (typeof UI !== 'undefined') UI.lastKey = '';
    if (typeof syncUI === 'function') syncUI();
  }
}

/**
 * 触屏「全屏」键 —— 在有 Fullscreen API 的浏览器上切换全屏。
 *
 * ⚠️ 已知限制（要如实告诉玩家）：
 *   · **iPhone Safari 不支持页面全屏**（只有 iPad 支持）。
 *     调用会 reject ⇒ 这里静默忽略，按钮留着也无害
 *     （点了没反应，总比报错强）。
 *   · 全屏后尝试锁横屏（`screen.orientation.lock`）——
 *     Android Chrome 支持，iOS 不支持，失败同样忽略。
 *   · 必须在**用户手势**里调用（点击事件里），否则浏览器会拒绝。
 *     这里正是从 pointerdown 进来的 ⇒ 满足要求。
 */
function toggleFullscreenByTouch() {
  var d = document;
  var el = d.documentElement;
  var fsEl = d.fullscreenElement || d.webkitFullscreenElement ||
             d.mozFullScreenElement || d.msFullscreenElement;
  try {
    if (fsEl) {
      /* 已经在全屏 → 退出 */
      var exit = d.exitFullscreen || d.webkitExitFullscreen ||
                 d.mozCancelFullScreen || d.msExitFullscreen;
      if (exit) {
        var p = exit.call(d);
        if (p && p.catch) p.catch(function () {});
      }
    } else {
      /* 进全屏 */
      var req = el.requestFullscreen || el.webkitRequestFullscreen ||
                el.mozRequestFullScreen || el.msRequestFullscreen;
      if (!req) return;                    // 不支持就没有这回事
      var r = req.call(el);
      if (r && r.then) {
        r.then(function () {
          /* 全屏成功后再尝试锁横屏（iOS 没有这个 API，失败就算了） */
          try {
            if (screen.orientation && screen.orientation.lock) {
              var lp = screen.orientation.lock('landscape');
              if (lp && lp.catch) lp.catch(function () {});
            }
          } catch (e) { /* 忽略 */ }
        }).catch(function () { /* 用户拒绝或被策略拦下 */ });
      }
    }
  } catch (e) {
    /* 全屏失败绝不该影响游戏 —— 静默吞掉 */
  }
}

/* ---------------- 生物实体工厂 ---------------- */
/* 新动作模块出错的"只报一次"警告器
 * ------------------------------------------------------------
 * 为什么不直接 console.error：
 *   这些代码在每帧都被调用，一旦出错就是每秒 60 条日志，
 *   会把控制台刷爆（反而看不到第一条线索）。
 *   所以每种错误只报一次。
 * 为什么不用静默 catch：
 *   曾经因为静默吞异常，新动作全不生效却查不出原因 ——
 *   宁可吵一次，也不要完全没线索。 */
const _actionsWarned = {};
function warnActionsOnce(tag, err) {
  if (_actionsWarned[tag]) return;
  _actionsWarned[tag] = true;
  console.error('[新动作] ' + tag + ' 出错（后续同类错误不再重复打印）：', err);
}

function makePlayer(role, spawn) {
  const isK = role === 'kangaroo';
  /* 角色配置：名字也从配置表读，保证 HUD / 角色库 / 选人页显示一致。
   * 取不到就退回原来的默认名字（characters.js 缺失时的降级）。 */
  const cfg = (typeof charByRole === 'function') ? charByRole(role) : null;
  const charId = (cfg && cfg.id) ? cfg.id : role;

  /* ============================================================
   * ★ sprite 也按 role 取（2026-10-06 接第三个角色时改）★
   * ============================================================
   * 原来是 `isK ? SPR_KANGAROO : SPR_DRAGON` —— 二元，
   * 卡皮巴拉会被画成飞龙。
   * ⇒ 改成一张"role → sprite"的映射表，加角色时只改这里一处。
   * ⚠️ 必须用 typeof 判断常量是否存在（sprites.js 可能没加载 /
   *    某个角色的贴图常量漏了），查不到就退回袋鼠贴图，
   *    绝不出现 `sprite: undefined`（那会让角色完全不显示）。
   * ============================================================ */
  let sprite = SPR_KANGAROO;
  try {
    if (typeof SPR_CAPYBARA !== 'undefined' && role === 'capybara') sprite = SPR_CAPYBARA;
    /* ★ 史迪奇（2026-10-06 修）★
     * ------------------------------------------------------------
     * 【原来这里写的是 `role === 'stitch' ? SPR_CAPYBARA`】
     *   那是"借用卡皮巴拉的像素画"的临时兜底，但**渲染层会拿这个
     *   sprite 对象反查 role** → 反查出 capybara → **画成卡皮巴拉**
     *   （十一报的 bug："史迪奇宝宝跑酷内还是卡皮巴拉"）。
     *
     * ⇒ 现在渲染层改成**优先用 role**（drawCharacter 的第 10 个参数），
     *   `p.sprite` 这个字段对渲染已经**没有影响**了（只作兼容保留）。
     *   所以这里让史迪奇也走 `SPR_KANGAROO`（而不是卡皮巴拉）——
     *   万一有哪条老路径还在拿 sprite 反查，也**不会画成另一个真实角色**。
     * ------------------------------------------------------------ */
    else if (typeof SPR_DRAGON !== 'undefined' && role === 'dragon') sprite = SPR_DRAGON;
    else if (typeof SPR_KANGAROO !== 'undefined') sprite = SPR_KANGAROO;
  } catch (e) {
    /* 兜底：SPR_KANGAROO 也不存在时给 null，drawCharacter 会走像素网格回退 */
    sprite = (typeof SPR_KANGAROO !== 'undefined') ? SPR_KANGAROO : null;
  }

  /* ⚠️ 注意：这里必须是 `const p = {...}` 而不是 `return {...}`。
   * 原来直接 return 对象字面量，导致后面想给 p 附加新动作字段时
   * 根本没有变量可用（`p` undefined）——而且抛出的异常被静默吞掉，
   * 表现为"新动作全都不生效"却查不出原因。 */
  const p = {
    role: role,
    charId: charId,
    name: (cfg && cfg.name) ? cfg.name : (isK ? '美团袋鼠' : '飞龙宝宝'),
    sprite: sprite,
    x: spawn.x, y: spawn.y,
    w: CONFIG.PLAYER_W, h: CONFIG.PLAYER_H,
    vx: 0, vy: 0,
    dir: 1,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    jumpsLeft: CONFIG.MAX_JUMPS,   // 剩余跳跃次数（二连跳用）
    doubleJumped: false,           // 这一次空中是否已用过二连跳（用于显示特效状态）
    jumpCutEligible: false,        // 当前上升是否允许被"松键截断"（机关弹射不受影响）
    stun: 0,                       // 被炸弹掀翻后的短暂失控帧数
    _seesaw: null,                 // 当前站的跷跷板（用来判定被弹射）
    _seesawEnd: null,              // 站在哪一端（'left' / 'right'）
    launchCooldown: 0,             // 被跷跷板弹射后的冷却（防止连续弹）
    squash: 1,
    /* 二连跳的空中翻滚动画：
     *   spinT     —— 剩余旋转帧数（> 0 表示正在翻滚）
     *   spinDur   —— 本次翻滚总帧数（用来算进度 0→1）
     * 触发二连跳时置为总时长，之后每帧递减。 */
    spinT: 0,
    spinDur: 0,
    /* 起跳"预备拉伸"：短暂把角色拉长，让起跳更有力量感 */
    stretchT: 0,
    hearts: 3,
    maxHearts: 3,
    invuln: 0,
    animT: 0,
    atGoal: false,
    spawnX: spawn.x,
    spawnY: spawn.y,
    /* ★ 角色倍率：从 characters.js 的配置表读，不再硬编码 ★
     *
     * 原来的写法是这里写死 `isK ? 1.0 : CONFIG.DRAGON_SPEED_MUL`，
     * 而角色选择页又另写一套"跳得更高 +12%"的文案 ——
     * 两处数据来源不同，加第三个角色时必然对不上。
     *
     * 现在统一从配置表取。取不到（characters.js 没加载）时
     * charMul() 会返回 1，也就是"所有角色一样"，
     * 游戏照常能玩，只是没有角色差异 —— 这是可接受的降级。 */
    speedMul: charMul(role, 'speedMultiplier'),
    jumpMul: charMul(role, 'jumpMultiplier'),
    /* 冲刺距离倍率。actions.js 在计算冲刺速度时会读这个字段，
     * 所以这里必须先挂上 —— 否则冲刺永远是 1.0 倍。 */
    dashMul: charMul(role, 'dashMultiplier'),
    wallStaminaMul: charMul(role, 'wallStaminaMultiplier'),
    /* ★ 墙跳力度倍率（2026-10-06 加，美团猴子的招牌）★
     * ------------------------------------------------------------
     * 这是**新增的能力维度**，和 `wallStaminaMul`（抓墙能挂多久）是两回事：
     *   · wallStaminaMul → 抓在墙上**撑多久**
     *   · wallJumpMul    → 踩墙弹出去**蹬多高**
     *
     * ⚠️ 光在 characters.js 里配了不生效 —— 必须
     *    ① 在这里挂到玩家对象上
     *    ② actions.js 的 actDoWallJump 里乘上它
     *    漏了②就是"配了但没用"（最难查的那种 bug）。 */
    wallJumpMul: charMul(role, 'wallJumpMultiplier'),
    /* ============================================================
     * ★ 二段跳力度倍率（2026-10-07 加，尼克的招牌）★
     * ============================================================
     * 【和 jumpMul 的区别（别搞混）】
     *   · jumpMul        → **第一跳**的初速倍率（袋鼠的招牌）
     *   · doubleJumpMul  → **第二跳**的初速倍率（尼克的招牌）
     *
     * 第二跳的算法原本是：
     *     vy = JUMP_POWER × jumpMul × DOUBLE_JUMP_MUL(0.9)
     * 现在多乘一层角色倍率：
     *     vy = JUMP_POWER × jumpMul × DOUBLE_JUMP_MUL × doubleJumpMul
     *
     * ⚠️ 要同步改三处，漏一处就是"配了不生效"：
     *     ① characters.js 的 doubleJumpMultiplier
     *     ② 这里挂到玩家对象
     *     ③ game.js 两处二段跳计算（单人 + 联机）乘上它
     *   ⚠️ 容易漏的是③的**第二处**（联机那份是复制粘贴出来的，
     *      两处逻辑相同但位置分开）。 */
    doubleJumpMul: charMul(role, 'doubleJumpMultiplier'),
    /* ============================================================
     * ★ 下落重力倍率（2026-10-07 加，**噜噜的招牌**）★
     * ============================================================
     * 这是全游戏第 8 个能力维度，之前被占掉的是：
     *   速度 / 跳跃 / 冲刺 / 抓墙 / 墙跳 / 二段跳 / 踩怪弹跳
     * 「噜噜」（恐龙装水豚）是"落速最慢"—— 水豚在水里就是漂着的。
     *
     * ⚠️ 和 jumpMul 的区别（别搞混）：
     *   · jumpMul        → **往上跳**的初速（越大跳越高）
     *   · fallGravityMul → **往下掉**时重力乘多少（**越小掉得越慢**）
     *   ⇒ 注意方向是反的！这是唯一一个"越小越强"的倍率。
     *
     * ⚠️ 要同步改两处，漏一处就是"配了不生效"：
     *     ① characters.js 的 fallGravityMultiplier
     *     ② physics.js 的重力计算（只对 vy > 0 的下落段生效）
     *
     * ⚠️⚠️ **绝不能**在上升段也减重力 —— 那会变成"跳得更高"，
     *     直接抢了袋鼠的招牌（构成上位替代）。
     *     所以 physics.js 里加了 `ent.vy > 0` 的前置条件。 */
    fallGravityMul: charMul(role, 'fallGravityMultiplier'),
    /* ★ 踩怪弹跳倍率（2026-10-07 加，碧琪的招牌）★
     * ------------------------------------------------------------
     * 【和 jumpMul / doubleJumpMul 的区别（三个别搞混）】
     *   · jumpMul        → **第一跳**初速
     *   · doubleJumpMul  → **第二跳**初速
     *   · stompBounceMul → **踩到敌人那一下**的弹起高度
     *
     * ⚠️ 要同步改三处：
     *     ① characters.js 的 stompBounceMultiplier
     *     ② 这里挂到玩家对象
     *     ③ physics.js 的 stompBounce/stompBounceSuper 乘上它
     *        （game.js 的踩怪处负责把 p.stompBounceMul 传进去） */
    stompBounceMul: charMul(role, 'stompBounceMultiplier'),
    /* ★ 冲刺次数加成（2026-10-07 加，朱迪的招牌）★
     * 0 = 标准 1 发；1 = 能连冲 2 发。
     * ⚠️ 这个字段在 actions.js 里用（算 actDashes 上限），
     *    不是"倍率"而是"额外发数"，所以不走 charMul（那个会给 1.0 兜底）。 */
    dashBonus: (function () {
      const c = (typeof charByRole === 'function') ? charByRole(role) : null;
      const v = c && c.dashMaxBonus;
      return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
    })(),
    /* ★ 外卖车状态（2026-10-07 改版：借车加速）★
     * ⚠️ 在独立模块 scooter.js 里初始化，这里只挂一行 ——
     *    这样"删掉 scooter.js 就退回原版"更容易做到。
     *    boostTimer = 剩余加速帧数（>0 = 正在加速）
     *    boostLock  = 加速结束后的"不能再借"冷却帧
     *    boostFrom  = 这次加速是哪台车给的（渲染用）
     * ⚠️ 字段名从 riding/rideLock 改成 boostTimer/boostLock ——
     *    语义从"骑着车"变成"借到几秒加速"，名字必须跟着变，
     *    留着旧名会让后来的人误以为是同一套逻辑。 */
    boostTimer: 0,
    boostLock: 0,
    boostFrom: null,
    running: false,
    deadFlash: 0,
  };

  /* ★ 附加新动作系统的状态字段（滑墙/墙跳/冲刺）★
   * 由 actions.js 统一初始化，避免这里散落一堆字段。
   *
   * 用 try 包住是因为"新动作模块缺失"不该让游戏起不来
   * （比如单文件打包漏了 actions.js —— 那就退化成原版玩法）。
   * 但**必须打印一次警告** —— 静默吞异常曾经害我找了很久：
   * 新动作全都不生效，却没有任何报错线索。 */
  try {
    if (typeof ACTIONS !== 'undefined' && ACTIONS.initPlayer) {
      ACTIONS.initPlayer(p);
    } else {
      if (!makePlayer._warned) {
        makePlayer._warned = true;
        console.warn('[新动作] ACTIONS 未加载 —— 滑墙/墙跳/冲刺将不可用。' +
          '请检查 index.html 是否引入了 js/actions.js');
      }
    }
  } catch (e) {
    if (!makePlayer._errWarned) {
      makePlayer._errWarned = true;
      console.error('[新动作] 状态初始化失败（新动作将不可用）：', e);
    }
  }

  /* ★ 🛵 外卖车状态（2026-10-07）★
   * 和 ACTIONS 一样"独立模块 + 一行调用"的写法：
   * 删掉 scooter.js 就退回原版（上面的默认值 boostTimer=0 已经够用，
   * 所以这里加不加 try 都不会崩，但保持和其它模块一致的容错姿势）。 */
  try {
    if (typeof initRideState === 'function') initRideState(p);
  } catch (e) { /* 外卖车模块不在也不影响正常游玩 */ }

  return p;
}

/* ---------------- 关卡装载 ---------------- */
/* 实际可玩的关卡列表（按顺序推进）。
 * 想加关：在 levels.js 里写好，然后加到这里，并按需实现 buildLevelN。
 * 顺序：第1关（跑跳收集）→ 第2关（双人按钮机关） */
const PLAYABLE_LEVELS = function () {
  // 顺序：第1关（跑跳收集）→ 第2关（双人按钮）→ 第3关（新机关综合）
  return LEVELS.concat(LEVELS_COOP, LEVELS_EXTRA);
};

/* ============================================================
 * ★ 关卡索引的"单一真相源"（2026-10-06 修 bug 时抽出）★
 * ============================================================
 * 为什么要有下面这几个函数：
 *
 *   修这个 bug 之前，"该玩哪一关"这个概念在**四个地方**各算了一遍：
 *     · ui.js 选角色页的「开始跑单」  —— 用 maxUnlocked - 1 算
 *     · ui.js 结算面板的「接下一单」  —— 用 levelIndex + 1 算
 *     · game.js 空格键推进            —— 用 levelIndex + 1 算（**没有越界保护**）
 *     · game.js loadLevel 内部         —— 越界就静默回绕到第 0 关
 *
 *   四处算法不一致，于是出现两个现象：
 *     · 「开始跑单」全通关后恒落在第 5 关（见 resumeLevelIndex 的说明）
 *     · 第 5 关通关后按空格 → loadLevel(5) 越界 → 静默回第 1 关（死循环）
 *
 *   现在收敛成函数，所有调用点统一用它们。改规则只改这一个地方。
 * ============================================================ */

/** 关卡总数 */
function levelCount() {
  return PLAYABLE_LEVELS().length;
}

/**
 * 把任意索引安全地夹到 [0, levelCount-1]。返回 null = 没有可用的关卡。
 *
 * ⚠️ 这是**唯一的**越界处理入口。
 *
 * 为什么不再做"越界回绕到第 1 关"：
 *   回绕是**静默的** —— 玩家按空格想进下一关，结果跳回第 1 关，
 *   而且没有任何提示，只会以为游戏坏了（这正是本次要修的问题）。
 *   越界只应该意味着"已经通关了"，那是**调用方该自己判断**的状态，
 *   不该在这里偷偷塞一个第 1 关。
 */
function clampLevelIndex(i) {
  const n = levelCount();
  if (n <= 0) return null;
  let v = parseInt(i, 10);
  if (!isFinite(v)) v = 0;
  if (v < 0) v = 0;
  if (v > n - 1) v = n - 1;
  return v;
}

/**
 * "下一关"的索引。已经是最后一关时返回 **null**。
 *
 * ⚠️ 返回 null 而不是 0，是刻意的：
 *    调用方必须显式处理"已通关"，不能靠一个默认值糊过去。
 *    返回 0  → "通关后跳回第 1 关"（本次的 bug）
 *    返回最后一关 → "卡在最后一关反复玩"（同一个 bug 的另一种表现）
 */
function nextLevelIndex(fromIndex) {
  const n = levelCount();
  if (n <= 0) return null;
  const cur = (typeof fromIndex === 'number') ? fromIndex : Game.levelIndex;
  const next = cur + 1;
  return (next >= 0 && next < n) ? next : null;
}

/**
 * ★「开始跑单」该从哪一关开始 ★
 *
 * 规则（十一要求的三条）：
 *   ① 新玩家（一关都没通关）   → 第 1 关
 *   ② 有进度但**没全部通关**   → 接着下一关（"继续跑"）
 *   ③ **全部通关了**           → 回第 1 关重新跑
 *      （没有"下一关"可接时，从头再来是最自然的选择；
 *        否则就会出现"永远停在第 5 关"的尴尬）
 *
 * ⚠️⚠️ 这里就是本次 bug 的根因，改之前务必看懂 ⚠️⚠️
 *
 *   原写法：Math.min(SAVE().data.maxUnlocked - 1, total - 1)
 *
 *   而 maxUnlocked 的语义是「**已解锁到第几关**，1 起算」
 *   —— 通关第 5 关后 maxUnlocked = 6。
 *   于是全通关时 maxUnlocked - 1 = 5，被 Math.min 夹成 4 →
 *   **每次都落在第 5 关**：玩家点「开始跑单」只会一遍遍重玩最后一关。
 *
 *   根因是**把两个不同的概念用同一个数字表达了**：
 *     · "已解锁到第几关"（maxUnlocked）
 *     · "下一个该玩第几关"（本函数要算的）
 *   两者相差 1，还要额外处理"全部通关"的边界。
 *
 *   所以现在**不用 maxUnlocked 推算**，而是直接看实际通关成绩：
 *   从 levels 里求出"已通关的最高关号"，再决定接哪一关。
 *   levels 是真实成绩，比解锁标记更可靠。
 */
function resumeLevelIndex() {
  const n = levelCount();
  if (n <= 0) return 0;

  /* 求"已通关的最高关号"（1 起算）。一关没过就是 0。 */
  let clearedMax = 0;
  try {
    const s = SAVE();
    if (s && s.data && s.data.levels) {
      Object.keys(s.data.levels).forEach(function (k) {
        const rec = s.data.levels[k];
        if (!rec || !rec.cleared) return;
        const num = parseInt(k, 10);
        if (isFinite(num) && num > clearedMax) clearedMax = num;
      });
    }
  } catch (e) {
    clearedMax = 0;   // 存档读不出来 → 当新玩家，从第 1 关开始（放行语义）
  }

  /* 规则 ①：一关都没通关 */
  if (clearedMax <= 0) return 0;

  /* 规则 ③：全部通关 → 回第 1 关 */
  if (clearedMax >= n) return 0;

  /* 规则 ②：有进度没通关 → 接下一关。
   * clearedMax 是"已通关的关号（1 起算）"，
   * 转成 0 起算的索引正好就是它自己
   * （通关了 3 关 → 下一个该玩索引 3 = 第 4 关）。 */
  const idx = clampLevelIndex(clearedMax);
  return (idx == null) ? 0 : idx;
}

function loadLevel(rawIndex) {
  const list = PLAYABLE_LEVELS();
  /* 越界统一走 clampLevelIndex（唯一的越界处理入口）。
   * ⚠️ 这里**不再**把越界改成 0 —— 那正是"第 5 关通关后按空格
   *    静默跳回第 1 关"的原因。现在越界只夹到最后一关，
   *    而"通关后该干什么"由调用方自己判断
   *    （见 update() 的空格键分支 和 ui.js 的 buildClear）。 */
  const safe = clampLevelIndex(rawIndex);
  Game.levelIndex = (safe == null) ? 0 : safe;
  rawIndex = Game.levelIndex;

  if (!list[rawIndex]) return;   // 一关都没有（理论上不会发生）

  const raw = list[rawIndex];
  Game.level = parseLevel(raw);

  /* ============================================================
   * ★ 把"本局生效的天气"写进关卡（2026-10-06 随机天气）★
   * ============================================================
   * 【为什么必须有这一段】
   *   render.js 的 drawWeather 读的是 `Game.level.weather`，
   *   而随机抽出来的天气存在 `Game.briefWeather`（播报界面用的）。
   *   两者不是同一个地方 —— 如果不在这里"搬运"，
   *   就会出现"播报说下雨、进去还是晴天"的 bug。
   *
   * 【优先级：强制指定 > 本局随机 > 关卡原值】
   *   ① 关卡自己写了 weather（比如第 4 关 'fog'）→ 用关卡的
   *      （"强制指定"语义，以后想给某关钉死天气就靠它）
   *   ② 否则用 Game.briefWeather（rollWeather 抽出来的）
   *   ③ 都没有 → 保持 parseLevel 的结果（null → 不画天气）
   *
   * ⚠️ 只写 weather 这一个字段，不动关卡的其它数据。
   * ============================================================ */
  if (raw && raw.weather) {
    Game.level.weather = raw.weather;                 // ① 关卡强制指定
  } else if (Game.briefWeather) {
    Game.level.weather = Game.briefWeather;           // ② 本局随机
  }

  Game.players = [];

  /* ============================================================
   * ★ 每次进关都清掉 AI 输入（2026-10-06）★
   * ============================================================
   * 【踩过的坑】退出 PK 局后，`InputState.aiInput` 里还留着
   *   "某角色由 AI 操控"的记录 —— 于是**下一局单人选同一个角色时，
   *   他会被 AI 接管，玩家按键完全没反应**。
   *
   *   表现很隐蔽：界面上完全看不出来（没有 AI 参赛），
   *   只是"我的角色自己往右跑"，像鬼畜而不像 bug。
   *
   * ⇒ 修法：**进关第一件事就清空**（无条件，不管这局有没有 AI）。
   *    放在这里最可靠 —— 任何入口（单人/双人/联机/PK/重开）
   *    都要经过 loadLevel，不会有漏网路径。
   * ============================================================ */
  try {
    if (typeof InputState !== 'undefined' && InputState.clearAI) InputState.clearAI();
  } catch (e) { /* 清不掉也不该拦住进关 */ }
  const sp = Game.level.spawns;
  const kSpawn = sp.find(function (s) { return s.role === 'kangaroo'; }) || { x: 64, y: 64 };
  const dSpawn = sp.find(function (s) { return s.role === 'dragon'; }) || { x: 128, y: 64 };

  /* ============================================================
   * ★ 出生点：按"选中的角色"取（2026-10-06 接第三个角色时改）★
   * ============================================================
   * 【现状】
   *   关卡里只标了**两个**出生点（levels.js 的 'P' → kangaroo、'N' → dragon）。
   *   加了卡皮巴拉就有三个可选角色，但出生点还是两个。
   *
   * 【怎么办：卡皮巴拉借用"袋鼠的出生点"】
   *   关卡地图只有两个入口，不可能为卡皮巴拉再挖一个 ——
   *   而且单人模式**只有一个角色出场**，另一个出生点本来就空着。
   *   ⇒ 卡皮巴拉用袋鼠那个出生点（进关卡的位置完全一样，只是换了个角色）。
   *
   * ⚠️ 为什么"袋鼠位"而不是"飞龙位"：
   *    袋鼠是初始角色、它的出生点必然存在（找不到也有兜底 {x:64,y:64}），
   *    而飞龙位在某些单人向的关卡里可能没有。借"必然存在的那个"最稳。
   *
   * ⚠️ 千万别改成"按 role 字符串去 sp 里 find"就算完 ——
   *    sp 里永远不会有 role === 'capybara' 的项，直接 find 会得到 undefined，
   *    那就是"角色生成不出来"（游戏黑屏/卡死）。
   * ============================================================ */
  /* ============================================================
   * ★ 🏁 PK 模式：角色创建（2026-10-06）★
   * ============================================================
   * 十一："要不要再加一个 PK 模式，先只开发 AI 骑手，跟我们比速度。"
   *
   * 【⚠️ 踩过的坑：AI 被建了两遍】
   *   PK 用的是 `playerCount = 2`，于是走进了下面那个 `else` 分支 ——
   *   它**已经**建了 kangaroo + dragon；我又在外面按 aiRoles 补建了一个
   *   → 场上出现 **3 个角色**（kangaroo / dragon / dragon），
   *     其中两个 dragon 重叠、互相挤。
   *   实测表现：AI 跑到一半就卡住不动、最后 state 变成 gameover。
   *
   *   ⇒ 修法：**PK 模式下完全接管角色创建**，不走那个 else 分支。
   *     玩家用"选中角色的出生点"，AI 用"另一个出生点"。
   *
   * 【★ 同一起跑线（2026-10-06 十一反馈后改）★】
   *   十一的原话："AI 和我应该是同一起跑线，在同一个地方生成"
   *
   *   ⇒ 现在玩家和 AI **用同一个出生点**（kSpawn），肩并肩起跑。
   *     只做一点**极小的水平错开**（各往两边偏 6px）——
   *     因为两个角色若完全像素级重叠，物理的"互相推开"会在开局抖动。
   *     6px 远小于一个身位，看起来就是"并排站在起跑线上"。
   *
   *   ⚠️ 为什么不再用"玩家袋鼠位 / AI 龙位"：
   *      那样两人的起跑距离不同（两个出生点隔了老远），
   *      **比赛根本不公平** —— 而且十一明确要"同一起跑线"。
   * ============================================================ */
  /* ============================================================
   * ★★ PK 状态判定：`isPk` 是唯一真相 ★★
   * ============================================================
   * ⚠️ 为什么必须同时检查 `isPk` 和 `aiRoles`：
   *   `isPk` 是**显式意图**（"这局是 PK"），`aiRoles` 是**数据**。
   *   只要 `isPk` 是 false，就一定不是 PK 局 ——
   *   哪怕 `aiRoles` 里还残留着上一局的值（那正是 bug 的来源）。
   *
   *   ⇒ 这一段同时起两个作用：
   *     ① 判定这局是不是 PK
   *     ② **顺手把非 PK 局的残留 aiRoles 清掉**（防御性清理）
   *
   *   这样"玩完 PK 再点开始跑单"就**不可能**变成 AI 赛跑了 ——
   *   因为"开始跑单"不会设 `isPk = true`。
   * ============================================================ */
  /* ============================================================
   * ★★ PK 判定：只读 `Game.isPk`，**不做清理** ★★
   * ============================================================
   * 【第一版为什么错（自我修正记录）】
   *   我原来在这里写"如果 isPk 是 false 就清理 PK 残留"。
   *   但那是个**循环依赖**：
   *     `isPk` 这个局部变量 = (Game.isPk && aiRoles 非空)
   *     清理的目的又是"把 Game.isPk 设成 false"
   *     ⇒ 当 Game.isPk 还是 true 时，局部 isPk 也就是 true，
   *       于是"清理分支"根本不执行 —— **清理永远不生效**。
   *   （实测：PK 局后直接 loadLevel，isPk 仍是 true、aiRoles 仍在。）
   *
   * 【正确分工】
   *   · **清理**：只由 `startGame()` 做（它已经是 PK 状态的唯一设置点）
   *   · **读取**：`loadLevel()` 只读 `Game.isPk`，不负责清
   *
   *   为什么这样够用：所有"换局"的路径其实都经过 startGame
   *   （开始跑单 / 下一关 / 重开 / PK 都是从那里进的）。
   *   而 loadLevel 被直接调用的场合（复活、重试）本来就是**同一局**，
   *   Game.isPk 保持原值正是对的。
   * ============================================================ */
  const isPk = (Game.isPk === true) &&
               Array.isArray(Game.aiRoles) && Game.aiRoles.length > 0;

  if (isPk) {
    /* ============================================================
     * ---------- PK 局：玩家 + AI 都站在**同一个起跑线** ----------
     * ============================================================
     * 十一："AI 和我应该是同一起跑线，在同一个地方生成"
     *
   * 【做法】
   *   两人都用 kSpawn（袋鼠位 —— 它必然存在，有兜底）。
   *   水平错开：玩家 -14px、AI +14px（共 28px）。
   *
   * ------------------------------------------------------------
   * ★★ 错开距离为什么是 28px（2026-10-06 实测后定的）★★
   * ------------------------------------------------------------
   * 【踩过的坑】第一版只错开 ±6px（共 12px），想着"6px 看起来就是并肩"。
   *   但 **玩家碰撞盒宽 26px**（CONFIG.PLAYER_W）——
   *   两个 26px 宽的盒子中心只差 12px，**重叠了 14px**！
   *   于是物理的 `separatePlayers` 每帧都把两人往外推：
   *     实测 生成时 122/134（差 12px），倒计时 150 帧后变成 115/141（差 26px）
   *   —— 两人被"挤开"了 7px/边，起跑线就不齐了。
   *
   *   ⇒ 错开距离必须 **≥ 碰撞盒宽度（26px）**，让两个盒子**不重叠**。
   *     取 28px（26 + 2 的余量）：两人肩并肩、互不推挤，
   *     而 28px 只比一个身位多一点，视觉上仍然是"并排站在起跑线"。
   * ------------------------------------------------------------ */
    const myRole = roleOfSelection();
    Game.pickRole = myRole;

    const startMp = makePlayer(myRole, kSpawn);
    startMp.x = kSpawn.x - 14;                   // 玩家：起跑线左边
    Game.players.push(startMp);

    try {
      if (typeof AI_RIDER !== 'undefined') AI_RIDER.reset();
      Game.aiRoles.forEach(function (aiRole) {
        if (aiRole === myRole) return;           // 别让自己打自己
        /* ★ AI 也用同一个出生点（同一起跑线）★ */
        const ap = makePlayer(aiRole, kSpawn);
        ap.x = kSpawn.x + 14;                    // AI：起跑线右边
        Game.players.push(ap);
        if (typeof AI_RIDER !== 'undefined') AI_RIDER.initFor(aiRole);
      });
      if (typeof PK_RACE !== 'undefined') PK_RACE.start(Game.level, Game.players.length);
    } catch (e) { warnActionsOnce('PK 初始化', e); }
  } else if (Game.playerCount === 1) {
    const role = roleOfSelection();
    /* ★ 顺手同步 Game.pickRole（2026-10-06）★
     * 这个字段现在是**只读镜像**：真正的真相源是存档里的角色 id，
     * 由 roleOfSelection() 换算成 role。
     * 但项目里还有几处老代码在读 Game.pickRole（比如 ui.js 的结算文案），
     * 同步一下它们就不会读到过期的值。
     * ⚠️ 不要反过来"改 Game.pickRole 来换角色" —— 那是旧写法，现在没用了。 */
    Game.pickRole = role;
    /* 袋鼠 / 龙 → 各自的出生点；其它角色（卡皮巴拉）→ 借袋鼠的 */
    const spawn = (role === 'dragon') ? dSpawn : kSpawn;
    Game.players.push(makePlayer(role, spawn));
  } else {
    Game.players.push(makePlayer('kangaroo', kSpawn));
    Game.players.push(makePlayer('dragon', dSpawn));
  }

  // 单人模式：把需要"两人合作"的机关降级成单人可解
  applySinglePlayerAdjustments(Game.level);

  /* 关卡载入时，游戏模式（单人/联机房主/客人/同机）已经确定，
   * 这时把触屏手柄的虚拟键归属刷新一遍 —— 客人的手柄要绑到奶龙的键上。 */
  try { TouchPad.refresh(); } catch (e) { /* 触屏不可用不影响游玩 */ }

  Game.coinsTotal = Game.level.coins.length;
  Game.coinsTaken = 0;
  /* 过关需要收集的订单数。
   * 默认比例见 CONFIG.COIN_REQUIRE_RATIO（80%），
   * 但**允许单关覆盖** —— 第 1 关是教学关，订单全在平台上，
   * 用 80% 等于"必须爬三层平台"（劝退新手），所以单独放宽。
   * 覆盖值写在关卡数据里：`lv.coinRequireRatio`（见 levels.js）。 */
  const coinRatio = (Game.level.coinRequireRatio != null)
    ? Game.level.coinRequireRatio
    : CONFIG.COIN_REQUIRE_RATIO;
  // 向上取整 → 宁严勿松（宁可多要一单，也不要"差 0.4 单"这种模糊边界）
  Game.coinsRequired = Math.ceil(Game.coinsTotal * coinRatio);
  /* ★ E3 神秘订单（第 7 期）：本局挑战统计 ★
   * 每局清零。两个计数分别对应 MYSTERY_ORDERS 里的条件。
   * ⚠️ 这些只是"记数"，不做任何判定 —— 判定放在通关那一刻。 */
  Game.challengeStats = {
    coinsTouched: 0,     // 碰到过几个订单袋
    damageTaken: 0,      // 挨打次数
  };
  Game.elapsed = 0;
  Game.startTime = performance.now();
  Game.particles = [];
  Game.checkpoint = null;
  /* ★ 作者彩蛋：进关提示的计时器（2026-10-06）★
   * 归零 = 刚进关，render.js 的 drawEggHint 靠它算弹入/淡出。
   * 换关/重开都会走到这里，所以**每次进关都会重新飘一次**小提示
   * （十一要的"每次进关都能踩"，提示自然也要每次都出现）。 */
  Game.eggHintTimer = 0;
  /* ★ 雷电状态重置（2026-10-06）★
   * 换关/重开时必须清 —— 否则上一关残留的"预警圈"会带到新一关，
   * 玩家一进来就看到一个莫名其妙的圈。 */
  try {
    if (typeof THUNDER !== 'undefined' && THUNDER.reset) THUNDER.reset(Game.level);
  } catch (e) { /* 雷电模块不在也不影响正常游玩 */ }

  /* ★ 🛵 外卖车：按本关生成（2026-10-07 改版，去掉充电桩）★
   * ⚠️ 必须在 Game.level 已经就绪之后调（它要读 lv.cols / lv.solids 找地面）。
   * ⚠️ 生成是**按关卡确定性的**（同一关每次一样），所以重开一局
   *    或中途复活，外卖车的位置和剩余电量**会不会重置**？
   *    ⇒ 会重置（每次进关都重新 build）：这是刻意的 ——
   *      不然玩家"把车用到没电 → 故意自杀重开"就能白嫖满电车，
   *      一次性的资源就有漏洞了。重开一局 = 重新开始这一单，车也是满电的。
   * ⚠️ 充电桩（2026-10-06 加，2026-10-07 删）：十一要求"去掉随机充电桩"，
   *    所以 buildForLevel 不再生成 charger，data.chargers 恒为空数组。 */
  try {
    if (typeof SCOOTER !== 'undefined') SCOOTER.buildForLevel(Game.level);
  } catch (e) { /* 外卖车模块不在也不影响正常游玩 */ }

  /* ★ 🧍 收餐人台词：进关重置（2026-10-07）★
   * 每关**只触发一次**（骑手第一次走到门口）。
   * ⇒ 换关/重开必须清掉 —— 否则第二关一进去就带着上一关的说话状态。 */
  try {
    if (typeof receiverTalkReset === 'function') receiverTalkReset();
  } catch (e) { /* 收餐人模块不在也不影响正常游玩 */ }

  /* ★ 🌊 第 13~20 关的新机制：进关时按关卡数据建状态（2026-10-06）★
   * ------------------------------------------------------------
   * 和外卖车一样：**每次进关都重建**。
   * `CH3.init(level)` 会读 `level.ch3`（纯数据对象），
   * 把水柱/漏电/货柜/水位/潮汐/电弧… 全部初始化出来。
   * 关卡里没写 `ch3` 字段 → 全部保持空，`update` 里直接跳过，
   * 所以**旧的 1~12 关完全不受影响**。
   * ------------------------------------------------------------ */
  try {
    if (typeof CH3 !== 'undefined') CH3.init(Game.level);
  } catch (e) { warnActionsOnce('第三章机制初始化', e); }

  Game.shake = 0;
  Game.screenFlash = 0;
  /* 清掉上一局的失败原因 —— 不清的话，重开一局后如果直接死，
   * 失败界面可能显示上一局的原因（比如上一局"掉出路线"、
   * 这局"体力耗尽"，却显示成掉出路线）。 */
  Game.deathReason = '';
  Game.message = Game.level.name;
  Game.messageTimer = 150;
  Game.state = STATE.PLAYING;

  /* 新动作教学：每关重新开始（提示记录不跨关保留，
   * 这样换关后基础动作仍会再教一次，对新手更友好）。
   * 整个调用做了降级保护 —— tutorial.js 缺席时游戏照常跑。 */
  try {
    if (typeof TUTORIAL !== 'undefined' && TUTORIAL.init) TUTORIAL.init();
  } catch (e) { /* 教学模块不可用不影响游玩 */ }
}

/* ============================================================
 * ★ 从检查点继续（失败界面的第二个按钮）★
 * ============================================================
 * 和"整关重开"的区别要说清楚（否则玩家会以为两个按钮一样）：
 *
 *   立即重试      → 回到关卡起点，订单、计时、机关全部重置
 *   从检查点继续  → 从最近踩过的打卡点开始，**保留已收集的订单**，
 *                   计时继续（不重置），机关状态也保留（桥该塌的还是塌的）
 *
 * 保留订单是刻意的：检查点的意义就是"不用重复捡已经捡过的单"。
 * 但计时不重置 —— 否则就成了刷成绩的漏洞（重开计时就能洗掉慢的时间）。
 *
 * 没有检查点时**不要调用这个函数** —— UI 那边会先判断 Game.checkpoint，
 * 没有就不显示这个按钮。
 * ============================================================ */
function restartFromCheckpoint() {
  if (!Game.level || !Game.checkpoint) {
    /* 没有检查点 → 退化成整关重开（而不是什么都不做） */
    loadLevel(Game.levelIndex);
    return;
  }
  const cp = Game.checkpoint;

  /* 只把玩家搬回检查点，其余世界状态保留 */
  Game.players.forEach(function (p, i) {
    /* 每个玩家在检查点附近错开一点，避免两人重叠在同一个像素上 */
    p.x = cp.x + i * 8;
    p.y = cp.y - p.h - 4;
    p.vx = 0;
    p.vy = 0;
    p.hearts = 3;                                  // 回满血（和 makePlayer 的初始值一致）
    p.invuln = 60;                                 // 复活短暂无敌，防止落地就死
    p.dir = 1;
    /* 清掉动作系统的临时状态 —— 不清的话可能带着"冲刺中/贴墙中"
     * 的状态复活，表现会很怪（空中乱冲、贴着一个不存在的墙）。 */
    try {
      if (typeof ACTIONS !== 'undefined' && ACTIONS.initPlayer) {
        ACTIONS.initPlayer(p);
      }
    } catch (e) { /* 动作模块不在也能用 */ }
  });

  Game.particles = [];
  Game.shake = 0;
  Game.screenFlash = 0;
  Game.deathReason = '';
  Game.message = '从打卡点继续';
  Game.messageTimer = 90;
  Game.state = STATE.PLAYING;
  Game.startTime = performance.now() - Game.elapsed * 1000;   // 接着算，不重置用时
}

/* ---------------- 单人模式的关卡调整 ----------------
 *
 * 思路：**不改关卡数据文件，在载入后动态放宽**。
 * 这样同一张地图既能双人玩、也能单人玩，不用维护两份关卡。
 *
 * 已经处理的两处"双人专属机制"：
 *
 * 1) 第 2/3 关的合作门
 *    门需要"两个按钮同时亮"，一个人踩不了两个按钮。
 *    → 放宽成"任意一个按钮亮就开"。
 *
 * 2) 第 4 关的跷跷板高墙 —— ★ 2026-10-06 已取消，见下方说明 ★
 *    原来：高墙落差 224px，单跳/二连跳都够不到，
 *          所以单人模式会在跷跷板旁边补一块弹簧板当补偿。
 *    现在：十一要求"把跷跷板改成单机版、移除旁边的弹跳机"，
 *          同时第 4 关的高墙已从 8 格降到 5 格（160px），
 *          二连跳（奶龙 194px）本来就能上去 ——
 *          补偿弹簧既多余又占地方，整段逻辑删除。
 *          （跷跷板现在一个人就能用，见 seesaw 更新里的 seesawSingleBoost）
 */
function applySinglePlayerAdjustments(level) {
  if (Game.playerCount !== 1) return;

  // ---- 1) 合作门放宽 ----
  if (level.buttons && level.buttons.length > 0) {
    level.singlePlayerRelaxed = true;
  }

  /* ---- 2) 跷跷板：不再补弹簧板（2026-10-06 删除）----
   * ------------------------------------------------------------
   * ⚠️ 为什么删掉：
   *   · 十一明确要求"移除跷跷板旁边的弹跳机"
   *   · 跷跷板本身已经支持单人（把自己弹起来），补偿机制重复
   *   · 运行时凭空塞方块，玩家会困惑"这石头哪来的"
   *   · 第 4 关高墙降到了 5 格，二连跳就能上，本来也不需要弹簧
   *
   * ⚠️ 以后如果再遇到"单人过不去"的机关，**优先改关卡地形**，
   *    不要在这里偷偷塞东西 —— 地形是玩家能看懂的语言。
   * ------------------------------------------------------------ */
}

/* ---------------- 主循环 ----------------
 *
 * ⚠️ 关键设计：**不管这一帧发生什么，都必须把下一帧排上**。
 *
 * 踩过的坑（很惨）：原来写成
 *     update(dt); render(dt); requestAnimationFrame(loop);
 * 结果 render() 里抛过一次异常（新状态没在 render 里处理，画到一半空指针），
 * requestAnimationFrame 那行**根本没执行到** ——
 * 整个游戏循环就此死掉，玩家再怎么点都没反应，
 * 看起来就是"点了没动静、卡死了"，而且刷新前无法恢复。
 *
 * 现在用 try/finally 把"排下一帧"放进 finally：
 * 单帧出错最多丢一帧画面，游戏不会死。错误照样打到控制台方便排查。
 * ---------------------------------------- */
let lastT = 0;
let loopErrorCount = 0;

/* ============================================================
 * 固定步长（锁 60 帧）
 * ============================================================
 * ⚠️ 原来用"变步长"（dt = 实际间隔），这在**高刷新率屏幕上是错的**：
 *
 *   游戏所有物理常量都是按「每帧」标定的
 *   （RUN_SPEED=3px/帧、GRAVITY=0.62/帧、JUMP_POWER=-11.2/帧……）。
 *   在 120Hz 屏幕上，rAF 一秒回调 120 次，
 *   而代码每回调一次就推进一"帧"物理 → **游戏速度直接翻倍**。
 *   在 60Hz 屏幕上是正常的，在 144Hz 上就是 2.4 倍速 ——
 *   同一个游戏在不同电脑上跑得不一样快。
 *
 * 现在改成业界标准的「固定步长 + 累加器」：
 *   1. 逻辑永远按 1/60 秒推进（不管屏幕多快）
 *   2. 累积真实流逝的时间，够一个步长就跑一次逻辑
 *   3. 一帧内最多补 5 步（防止卡顿后"追帧"跑飞）
 *   4. 渲染照旧每帧一次 —— 高刷屏仍然流畅，但速度恒定
 *
 * 这样：60Hz / 120Hz / 144Hz 屏幕上，游戏速度完全一致。
 * ============================================================ */
const FIXED_DT_MS = 1000 / 60;     // 逻辑步长：16.667ms
let accMs = 0;                      // 时间累加器
const MAX_STEPS = 5;                // 单帧最多补几步（防追帧跑飞）

function loop(t) {
  try {
    if (!lastT) lastT = t;
    let elapsed = t - lastT;
    lastT = t;

    /* 后台切回来时 elapsed 会很大（几十秒），直接钳掉，
     * 否则会一次性补上千步，卡死几秒。 */
    if (elapsed > 250) elapsed = FIXED_DT_MS;
    if (elapsed < 0) elapsed = 0;

    accMs += elapsed;

    /* ---- 逻辑：固定步长推进 ---- */
    let steps = 0;
    while (accMs >= FIXED_DT_MS && steps < MAX_STEPS) {
      accMs -= FIXED_DT_MS;
      steps++;
      Game.frame++;
      /* ★★ 2026-10-07：每步**之前**先按指针坐标对账一次 ★★
       * ------------------------------------------------------------
       * 为什么放在 update() 之前（重要）：
       *   触屏的 pointerId 会错配（抬起跳的手指却把 pointerup 投给 ◀）。
       *   `reconcile()` 用坐标这一"物理事实"修正按下/松开，
       *   必须**在物理读取输入之前**完成，否则这一帧角色还是用错的输入跑。
       *
       * ⚠️ 只在手机模式下有开销（内部会提前 return），电脑端零成本。 */
      try { if (typeof TouchPad !== 'undefined') TouchPad.reconcile(); }
      catch (recErr) { /* 对账失败不能让主循环挂掉，继续用原输入 */ }
      update(1 / 60);
      /* 每个逻辑步都推进输入状态 ——
       * 这样"刚按下"的边沿判定在任何刷新率下都精确到 1/60 秒。 */
      InputState.tick();
    }
    /* 补步数超上限说明严重卡顿，把残留时间丢掉，避免持续落后 */
    if (steps >= MAX_STEPS) accMs = 0;

    /* ---- 渲染：每次 rAF 都画（高刷屏更顺滑）---- */
    render(FIXED_DT_MS / 1000);
  } catch (e) {
    /* 单帧异常：记录下来，但绝不让它终止循环。
     * 连续出错太多次就不刷屏了（避免每帧打日志把控制台刷爆）。 */
    loopErrorCount++;
    if (loopErrorCount <= 5) {
      console.error('[游戏循环] 第 ' + Game.frame + ' 帧出错（已忽略，继续运行）：', e);
    } else if (loopErrorCount === 6) {
      console.error('[游戏循环] 错误持续发生，后续不再重复打印。');
    }
    // 出错时把输入状态推进一步，避免"刚按下"的边沿判断卡住
    try { InputState.tick(); } catch (x) { /* 连这个都错就彻底放弃本帧 */ }
  } finally {
    requestAnimationFrame(loop);   // ★ 无论如何都要排下一帧
  }
}

/* ---------------- 更新 ----------------
 * 界面（菜单/大厅/房间码输入）全部由 ui.js 的 HTML 浮层负责。
 * 这里只保留"游戏过程中"的键盘快捷键（ESC 暂停 / R 重开 / 空格下一关），
 * 因为那些需要低延迟响应，不适合走 DOM 点击。
 * 菜单上的操作键盘也能用（ui.js 里给按钮绑了 Enter 等效行为）。
 */
function update(dt) {
  if (Game.messageTimer > 0) Game.messageTimer--;
  if (Game.shake > 0) Game.shake *= 0.88;
  if (Game.screenFlash > 0) Game.screenFlash -= dt * 2.2;
  if (Game.noticeTimer > 0) Game.noticeTimer--;

  // 菜单 / 大厅 / 选角色 / 等待 / 输入房间码 —— 交给 UI 层，这里不动
  if (Game.state === STATE.MENU ||
      Game.state === STATE.SINGLE_PICK ||
      Game.state === STATE.LOBBY ||
      Game.state === STATE.HOSTING ||
      Game.state === STATE.JOINING) {
    return;
  }

  if (Game.state === STATE.PAUSED) {
    if (pressed('Escape')) { Game.state = STATE.PLAYING; }
    return;
  }

  if (Game.state === STATE.GAMEOVER || Game.state === STATE.CLEAR) {
    const isGuest = Game.mode === 'online' && Net.role === 'guest';
    // 联机时客人不能自己重开/进关，要等房主
    if (pressed('KeyR')) {
      if (isGuest) showGameNotice('等主骑手操作');
      else loadLevel(Game.levelIndex);
    }
    if (Game.state === STATE.CLEAR && (pressed('Space') || pressed('Enter'))) {
      if (isGuest) {
        showGameNotice('等主骑手接下一单');
      } else if (Game.isPk) {
        /* ★ 🏁 PK 局：一局定胜负，按空格**不接下一单**（2026-10-06 十一反馈）★
         * ------------------------------------------------------------
         * 十一："一局定胜负，现在打完一局会连着来"
         *
         * 【为什么原来会"连着来"】
         *   这里统一走 `startGame(next)` —— 它不带 opts，于是 PK 状态被清，
         *   但 **`playerCount` 还是 2**（PK 遗留）→
         *   下一关照样立起两个角色，看起来就是"PK 连着又来一局"。
         *
         * ⇒ PK 局在结算界面上**只允许"再来一局 PK"或"回首页"**（那些按钮
         *   走 ui.js 的 leavePkState / restartPkSameLevel，会正确复位
         *   playerCount）。键盘这条路径**不提供接下一单**，避免绕过按钮。
         * ------------------------------------------------------------ */
        showGameNotice('PK 是一局定胜负 —— 点「🏁 再来一局 PK」再战');
      } else {
        /* ★ 修 bug（2026-10-06）：这里原来直接 loadLevel(Game.levelIndex + 1)。
         *
         *   第 5 关（最后一关）通关后按空格 → loadLevel(5) 越界 →
         *   旧代码静默回绕到第 1 关 → **"跑完第五关又跳回第一关"的死循环**。
         *
         *   为什么结算面板没这个问题、只有空格键有：
         *     面板那边有 `if (!isLast)` 保护，最后一关不显示"接下一单"按钮；
         *     但键盘这条路径**漏了同样的判断**。
         *     （和项目文档里"加新判定点要加在所有地方"是同一类教训。）
         *
         *   现在统一走 nextLevelIndex()：最后一关返回 null，
         *   这时**留在结算界面**并提示玩家，而不是偷偷把他送回第 1 关。 */
        const next = nextLevelIndex(Game.levelIndex);
        if (next == null) {
          showGameNotice('全部路线已跑完 —— 可以重跑这一单，或回首页换条路线');
        } else {
          /* ★ 2026-10-06 改（随机天气）：走 startGame 而不是 loadLevel ★
           *   原因：loadLevel 只加载关卡，**不会重新抽天气** ——
           *   于是"接下一单"会沿用上一单的天气（下雨天送完接着还是下雨），
           *   而且 `Game.briefWeather` 是上一单的残留值。
           *   ⇒ 走 startGame 才会重新 rollWeather() + 播报新一单的天气。
           *
           * ⚠️ 用 typeof 保护：startGame 定义在 ui.js，
           *    万一加载顺序出问题，退化成原来的 loadLevel（不至于卡住）。
           *    ⚠️ 单人模式才会走播报（startGame 内部会判断）；
           *       双人/联机 startGame 直接进关，行为和以前一致。 */
          if (typeof startGame === 'function') startGame(next);
          else loadLevel(next);
        }
      }
    }
    if (pressed('Escape')) {
      if (Game.mode === 'online') { leaveRoom(); Game.mode = 'local'; }
      Game.state = STATE.MENU;
    }
    return;
  }

  if (Game.state !== STATE.PLAYING) return;

  if (pressed('Escape')) { Game.state = STATE.PAUSED; return; }

  /* 兜底：状态是 playing 但关卡还没载入（理论上不该发生，
   * 但一旦发生就会在 collectSolids(null) 崩掉，把主循环带走）。
   * 宁可什么都不做，也不要崩。 */
  if (!Game.level) return;

  updatePlaying(dt);
}

/* ============================================================
 * predictPlayer — 客人端的本地物理预测
 * ============================================================
 * 目的：让客人按了键**立刻看到自己的角色动**，不绕房主一圈。
 *
 * ⚠️ 这是"简化版物理"，只算确定性最强的部分：
 *      水平加减速 / 跳跃 / 重力 / 地形碰撞 / 平台
 *     **不算**：弹簧、传送带、跷跷板、炸弹、机关交互
 *
 * 为什么砍掉机关：
 *   1. 机关逻辑和音效、粒子、状态机耦合很深，硬抽出来风险大
 *   2. 机关是"环境事件"，房主一定会广播正确状态，
 *      客人端等权威值校正即可（延迟感知不明显）
 *   3. 跑跳手感才是延迟感最强的来源 —— 优先保证它
 *
 * 结果：客人操作零延迟；偶尔在机关处有小误差，由 applyRemoteState 平滑校正。
 * ============================================================ */
function predictPlayer(p, lv, solids, dt) {
  /* 时间步：和房主保持一致（物理是固定步长，不是变步长） */
  const step = dt;
  if (!(step > 0)) return;
  if (step > 0.05) return;         // 掉帧时跳过预测，避免一步冲太远

  const left = InputState.actionHeld(p.role, 'left');
  const right = InputState.actionHeld(p.role, 'right');

  /* ---- 水平加速（与房主同参数）---- */
  /* ★ 外卖车（2026-10-07）：借到加速时水平速度更快 ★
   * ⚠️ 只乘在 speed 上，**不碰 accel / 跳跃** —— 见 scooter.js 的说明。 */
  const rideMul = (typeof SCOOTER !== 'undefined') ? SCOOTER.speedMulFor(p) : 1;
  const speed = CONFIG.RUN_SPEED * p.speedMul * rideMul;
  const accel = CONFIG.RUN_ACCEL;

  if (p.stun > 0) {
    p.stun--;
    p.running = false;
  } else if (left && !right) {
    p.vx -= accel;
    p.dir = -1;
    if (p.vx < -speed) p.vx = -speed;
    p.running = true;
  } else if (right && !left) {
    p.vx += accel;
    p.dir = 1;
    if (p.vx > speed) p.vx = speed;
    p.running = true;
  } else {
    p.vx *= p.onGround ? CONFIG.FRICTION : CONFIG.AIR_FRICTION;
    if (Math.abs(p.vx) < 0.1) p.vx = 0;
    p.running = false;
  }

  /* ---- 跳跃（含土狼时间与二连跳，参数与房主一致）---- */
  if (p.onGround) p.coyote = CONFIG.COYOTE_TIME;
  else if (p.coyote > 0) p.coyote--;

  if (InputState.actionPressed(p.role, 'jump')) p.jumpBuffer = CONFIG.JUMP_BUFFER;
  else if (p.jumpBuffer > 0) p.jumpBuffer--;

  const canGroundJump = p.jumpBuffer > 0 && p.coyote > 0 && p.jumpsLeft > 0;
  /* ★ 二连跳要先解锁（通关第 1 关后永久可用）★
   * 未解锁时 canAirJump 恒为 false —— 空中按跳完全没反应，
   * 玩家会自然形成"这游戏只能跳一次"的认知，然后在第 1 关通关时
   * 收到"解锁二连跳"的提示，学习曲线才对。 */
  const canAirJump = p.jumpBuffer > 0 && !p.onGround && p.coyote <= 0 &&
                     p.jumpsLeft > 0 && isActionUnlocked('doublejump');

  if (canGroundJump) {
    p.jumpsLeft--;
    p.vy = CONFIG.JUMP_POWER * p.jumpMul;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.onGround = false;
    p.squash = 0.78;
    p.jumpCutEligible = true;
    /* ★ 按角色播起跳音（卡皮巴拉是"低闷的蓄力弹起"）—— 见 characters.js */
    playJumpSound(p.role, 'jump');
    /* ★ 卡皮巴拉起跳扬一圈"沉土"，和它的憨重感配套；
     *   史迪奇起跳迸一圈"上飞的碎屑"，和它的爆发感配套 */
    if (p.role === 'capybara') spawnHeavyDust(p.x + p.w / 2, p.y + p.h, 9);
    else if (p.role === 'stitch') spawnBurstDust(p.x + p.w / 2, p.y + p.h, 7);
    else spawnDust(p.x + p.w / 2, p.y + p.h, 5);
  } else if (canAirJump) {
    p.jumpsLeft--;
    /* ★ 二段跳初速（2026-10-07 加角色倍率）★
     * ⚠️ 多乘了 p.doubleJumpMul —— 这是尼克（狐狸）的招牌：
     *    第一跳平平，第二跳特别狠。
     *    老角色没有这个字段时 charMul 会给 1.0，行为**完全不变**。 */
    p.vy = CONFIG.JUMP_POWER * p.jumpMul * CONFIG.DOUBLE_JUMP_MUL * (p.doubleJumpMul || 1);
    p.jumpBuffer = 0;
    p.squash = 0.72;
    p.doubleJumped = true;
    /* 二连跳不受松键截断（与主物理保持一致，否则联机手感不同） */
    p.jumpCutEligible = false;
    Sound.doubleJump();
    spawnDoubleJumpRing(p.x + p.w / 2, p.y + p.h);
    spawnDust(p.x + p.w / 2, p.y + p.h, 7);
  }

  /* 松键截断（可变跳高） */
  /* 冲刺期间豁免（冲刺是匀速直线运动，不该被跳跃截断逻辑削速度） */
  if (p.actDashT > 0) { /* 冲刺中，跳过截断 */ }
  else if (p.vy < 0 && p.jumpCutEligible && !InputState.actionHeld(p.role, 'jump')) {
    p.vy *= (1 - (1 - CONFIG.JUMP_CUT) * 0.5);
  }

  p.squash += (1 - p.squash) * 0.18;
  if (p.spinT > 0) p.spinT--;

  /* ---- 重力 + 碰撞（复用主物理的公共函数，保证行为一致）---- */
  const wasAir = !p.onGround;
  const prevBottom = p.y + p.h;

  const collResP = moveAndCollide(p, solids, { noGravity: !!p.actNoGravity });
  resolvePlatforms(p, lv.platforms, prevBottom);

  /* 联机客人端也要跑新动作，否则两边手感不一致
   * （客人在自己屏幕上看不到滑墙/冲刺，会以为操作没生效）。 */
  try {
    if (typeof ACTIONS !== 'undefined' && ACTIONS.updatePlayer) {
      ACTIONS.updatePlayer(p, lv, solids, collResP);
    }
  } catch (e) { warnActionsOnce('预测动作', e); }

  if (p.onGround && wasAir && p.vy >= 0) {
    p.squash = 1.22;
    playJumpSound(p.role, 'land');
    spawnDust(p.x + p.w / 2, p.y + p.h, 4);
  }

  if (p.onGround) {
    p.jumpsLeft = CONFIG.MAX_JUMPS;
    p.doubleJumped = false;
    p.jumpCutEligible = false;
  }

  /* 掉出屏幕：不在本地判定失败（交给房主的权威状态） */
  if (p.invuln > 0) p.invuln--;
  if (p.deadFlash > 0) p.deadFlash--;
}

function updatePlaying(dt) {
  const lv = Game.level;
  Game.elapsed = (performance.now() - Game.startTime) / 1000;

  /* ★ 🧍 收餐人说话：任何"新按键"都跳过（2026-10-07）★
   * ------------------------------------------------------------
   * 十一要的 10 秒必须给一个"我看完了"的出口 ——
   * 10 秒对重复游玩太长了，没有出口就成了硬性等待。
   *
   * ⚠️ 用 `justPressed` 而不是 `held`：
   *    玩家过关时多半还按着方向键/冲刺键，用 held 的话
   *    一说第一句就被"一直按着"的键跳过了，等于没有台词。
   * ⇒ 只有**刚按下**的新键才算"我要走"。
   * ⚠️ 检查的是所有角色的绑定键（不只看玩家 1）——
   *    双人模式下任何一个人按键都该能跳过。
   */
  try {
    if (typeof receiverTalkSkip === 'function' && typeof receiverTalkSession === 'function') {
      const sess = receiverTalkSession();
      if (sess && !sess.done) {
        const roles = (Game.players || []).map(function (p) { return p && p.role; })
          .filter(function (r) { return !!r; });
        for (let ri = 0; ri < roles.length; ri++) {
          const map = keymapFor(roles[ri]);
          for (const act in map) {
            const keys = map[act] || [];
            for (let k = 0; k < keys.length; k++) {
              if (InputState.justPressed(keys[k])) { receiverTalkSkip(); ri = roles.length; break; }
            }
          }
        }
      }
    }
  } catch (e) { /* 跳过失败不影响玩法 */ }

  /* ★ 作者彩蛋：进关提示计时（2026-10-06）★
   * 每帧 +1，render.js 的 drawEggHint 靠它算"飘了多久、该不该淡出"。
   * ⚠️ 只加不封顶 —— 到 EGG_HINT_FRAMES 之后 drawEggHint 自己就不画了，
   *    这里不用管（少一个判断，也避免以后改时长时忘了同步上限）。 */
  Game.eggHintTimer = (Game.eggHintTimer || 0) + 1;

  /* ============================================================
   * ★ 骑手模式：超时判负（2026-10-06 十一要求）★
   * ============================================================
   * 十一定的体验节奏："倒计时到 0 → 不立刻失败 → 先提醒 →
   * 宽限几秒 → 还没到终点才失败"。
   *
   * 【★ 这是对原设计红线的一次"按模式放开" ★】
   *   项目原来的铁律是"超时不失败、只影响评星"（怕随机/时限变成惩罚）。
   *   十一的新决定是**按模式区分**：
   *     · 经典模式 = 放松模式 → 超时不失败（★老逻辑一个字没动★）
   *     · 骑手模式 = 压力模式 → 超时即失败（本次新加）
   *   所以这里全部用 `SAVE().isRiderMode()` 包住，
   *   经典模式永远走不到这段（老测试改成按模式分支，没有删）。
   *
   * 【三个必须注意的点（十一特别强调）】
   *   ① 不能误杀：宽限期内到达终点 → 必须正常过关
   *      ⇒ 判定放在这里（物理/机关之前），而"到终点"的判定在
   *        本函数后面（goal 检测）。只要宽限期没到，就绝不会提前判负。
   *   ② 失败走统一入口：复用 damagePlayer 的收尾（Sound.die /
   *      shake / screenFlash / 快照），保证失败表现和"被机关打死"一致。
   *   ③ 联机不启用 ★
   *      客人端在上面就 return 了（本地的预测分支），本来就到不了这里；
   *      但**房主会走到** —— 房主一改 Game.state 就可能和客人不同步。
   *      联机现在是"开发中"的低优先级入口，不值得为它引入同步风险，
   *      所以**整个 online 模式都不判超时**。
   *
   * 【为什么用 >= 而不是 >】
   *   overBy 刚好等于宽限期时也该判负（边界归入失败侧），
   *   测试里有一条守着这个边界。
   * ============================================================ */
  const canTimeoutFail =
    (Game.mode !== 'online') &&                                  // ★ 联机不启用
    (typeof SAVE === 'function' && SAVE().isRiderMode) &&         // 只骑手模式
    SAVE().isRiderMode() &&
    (lv && lv.targetTime > 0);                                   // 本关有时限
  if (canTimeoutFail && Game.state === STATE.PLAYING) {
    const overBy = Game.elapsed - lv.targetTime;
    if (overBy >= TIMEOUT_GRACE) {
      const victim = Game.players && Game.players[0];
      if (victim) {
        /* 复用统一失败入口。
         * ⚠️ 传 amount = 玩家当前全部血量 → 必定触发 damagePlayer 的
         *    "hearts <= 0" 那条收尾路径（Sound.die / state=GAMEOVER /
         *    快照 / deathReason）。这样"超时死"和"被打死"的
         *    表现完全一致，不会出现两套失败流程。
         * ⚠️ reason 传 'timeout' → ui.js 的 DEATH_REASONS 会显示
         *    "配送超时"+对应的重试建议（那条文案早就写好了）。
         * ⚠️ 先清 invuln/actInvuln —— 否则玩家刚好在无敌帧里
         *    （冲刺中）就会被 damagePlayer 直接 return 掉，超时判负失效。 */
        victim.invuln = 0;
        victim.actInvuln = 0;
        damagePlayer(victim, victim.hearts, 'timeout');
      }
      return;   // 已经进入 GAMEOVER，本帧不再继续跑物理
    }
  }

  /* ---- 联机：客人端 ----
   *
   * ============ 为什么需要"本地预测" ============
   * 最初的实现是纯"房主权威"：客人只上报按键，位置全靠房主广播。
   * 结果客人的操作链路是：
   *   按键 → 等轮询(≤60ms) → 上报(78ms) → 等房主轮询(≤60ms)
   *        → 房主算(16ms) → 下发(78ms) → 客人插值(70ms)
   *   ≈ 330ms 才看到自己动 —— 这就是十一说的"延迟依然很大"。
   *
   * 关键认知：**客人看自己角色动，不应该绕房主一圈！**
   * 这是所有联机游戏的标准解法：客户端预测（client-side prediction）。
   *
   * ============ 现在的做法 ============
   *   1. 客人**本地立刻跑自己角色的物理** → 零延迟响应
   *   2. 房主广播的权威位置作为**校正参考**（在 applyRemoteState 里处理）：
   *      - 误差小（< 60px）→ 完全信任本地，不动（避免抖动）
   *      - 误差大 → 平滑拉回（防止长期漂移）
   *   3. 房主的角色仍然用插值显示（别人的角色没法预测）
   *
   * 取舍说明：本地预测只算"跑/跳/重力"这些确定性强的部分，
   * 不预测机关交互（弹簧/传送带/炸弹）。所以偶尔会有小误差，
   * 但换来的是**操作零延迟**——这对手感重要得多。
   * ================================================ */
  if (Game.mode === 'online' && Net.role === 'guest') {
    const guestRole = Game.players[1] ? Game.players[1].role : 'dragon';
    const me = Game.players.find(function (q) { return q.role === guestRole; });

    /* 采集本地按键（读客人自己角色的专属键位：WASD + VK.P2_*） */
    Net.localInput = {
      left: InputState.actionHeld(guestRole, 'left'),
      right: InputState.actionHeld(guestRole, 'right'),
      jump: InputState.actionHeld(guestRole, 'jump'),
    };

    /* ★ 按键一变就"抢跑"上报，不等下一个轮询周期 ★
     * 这一下能把操作延迟砍掉最多一整拍（最坏省 160ms）。 */
    Net.notifyInputChanged();

    /* 本地预测：只跑自己的角色，且只在"方向键有输入"或"空中"时跑。
     * 站着不动时不必算（省性能，也避免和权威位置打架）。 */
    if (me) {
      const solids = collectSolids(lv);
      predictPlayer(me, lv, solids, dt);
    }

    updateParticles(dt);
    return;
  }

  /* ★ 机关更新必须放在收集碰撞体**之前** ★
   * 因为移动平台会改自己的 x/y，而 collectSolids 要把最新的位置
   * 收进碰撞列表 —— 顺序反了平台就会"慢一帧"，看起来在抖。 */
  try {
    if (typeof ACTIONS !== 'undefined' && ACTIONS.updateMechanisms) {
      ACTIONS.updateMechanisms(lv, dt);
    }
  } catch (e) { warnActionsOnce('机关更新', e); }

  /* ============================================================
   * ★ ⚡ 雷电推进（2026-10-06）★
   * ============================================================
   * 和机关更新放在一起 —— 雷电本质就是一个"定时触发的机关"。
   *
   * ⚠️ 伤害通过**参数注入**（把 damagePlayer 传进去），
   *    而不是让 thunder.js 直接调 damagePlayer。
   *    为什么：这样 thunder.js 不依赖 game.js 的内部函数，
   *    可以单独测、也符合项目"新功能独立封装"的规范。
   *
   * ⚠️ 用 try 包住：雷电出问题不该让整局游戏崩掉
   *    （和上面机关更新同样的处理）。 */
  try {
    if (typeof THUNDER !== 'undefined' && THUNDER.update) {
      THUNDER.update(lv, damagePlayer);
    }
  } catch (e) { warnActionsOnce('雷电更新', e); }

  /* 新动作教学：只读玩家状态、只改自己的记录，不会影响任何游戏逻辑。
   * 放在物理更新**之前**，这样它能读到"上一帧结束时的状态"
   * （比如刚蹬完墙的 actWallJumpLock），提示更贴合玩家刚做的动作。 */
  try {
    if (typeof TUTORIAL !== 'undefined' && TUTORIAL.update) TUTORIAL.update(dt);
  } catch (e) { warnActionsOnce('教学提示', e); }

  const solids = collectSolids(lv);
  const [p1, p2] = Game.players;

  /* ============================================================
   * ★ PK 倒计时推进 + **冻结玩家输入**（2026-10-06）★
   * ============================================================
   * ⚠️ 必须放在**最前面**（AI 驱动之前）——
   *    因为 AI 要用 `PK_RACE.inCountdown()` 判断"该不该动"。
   *
   * ⚠️ 也必须冻玩家 —— 否则玩家能抢跑，"同一起跑线"就不公平了。
   *    做法：物理循环之前把 InputState.now 清空（等价于"什么都没按"）。
   * ============================================================ */
  let pkWaiting = false;
  try {
    if (Game.isPk && typeof PK_RACE !== 'undefined') {
      pkWaiting = PK_RACE.tickCountdown();
      if (pkWaiting) {
        InputState.now = {};           // 玩家按键全部无效（原地待命）
        InputState.aiPrev = {};        // AI 的"上一帧"也清掉，避免开跑瞬间误触发跳跃
      }
    }
  } catch (e) { warnActionsOnce('PK 倒计时', e); }

  /* ============================================================
   * ★ 🏁 PK 模式：驱动 AI 骑手（2026-10-06）★
   * ============================================================
   * ⚠️ 必须在**物理循环之前** —— AI 要先产生本帧的输入，
   *    物理层才能照着它移动。放后面的话 AI 永远慢一帧。
   *
   * ⚠️ AI 只是"写 InputState.aiInput"，**不直接改速度**。
   *    所以它和玩家受完全一样的物理约束（不会穿墙、不会跳更高）。
   * ============================================================ */
  try {
    if (Game.aiRoles && Game.aiRoles.length && typeof AI_RIDER !== 'undefined') {
      for (let i = 0; i < Game.players.length; i++) {
        const p = Game.players[i];
        if (Game.aiRoles.indexOf(p.role) < 0) continue;
        if (pkWaiting) {
          /* ★ 预备中：AI 站着不动 ★
           * 否则它一生成就往右冲，会和玩家挤在一起（separatePlayers 强行推开），
           * "同一起跑线"就名存实亡了。 */
          InputState.setAI(p.role, { left: false, right: false, jump: false });
          continue;
        }
        AI_RIDER.update(p, lv, solids);
        /* AI 算出来的输入写进隔离通道（不碰真实键位） */
        InputState.setAI(p.role, p._aiInput || { left: false, right: false, jump: false });
      }
    }
  } catch (e) { warnActionsOnce('AI 骑手', e); }

  /* ---- 按钮是锁存式，不每帧重置（详见下方踩踏判定） ---- */

  /* ---- 物理更新 ---- */
  for (let i = 0; i < Game.players.length; i++) {
    const p = Game.players[i];
    p.animT += dt;

    /* ============================================================
     * ★ 「十一」的移动拖尾（2026-10-07 十一要求）★
     * ============================================================
     * 原话："要做一个移动拖尾，就是十一经过的时候，
     *        会留下小蛋糕的样子，然后过两三秒就会消失。"
     *
     * ⚠️ 三个条件都要满足才留痕迹：
     *   ① 是这个角色
     *   ② **在地面上**（空中留蛋糕会飘在半空，很怪）
     *   ③ **真的在水平移动**（站着不动不留，否则原地堆成一坨）
     * 频率控制交给 spawnDessertTrail 内部的冷却计数器。
     * ============================================================ */
    if (p.role === 'pinkstitch' && p.onGround && Math.abs(p.vx) > 0.5) {
      spawnDessertTrail(p);
    } else if (p._dessertGap > 0) {
      p._dessertGap--;          // 站立/空中时也让冷却走，重新跑起来衔接更自然
    }

    /* ============================================================
     * ★ 「噜噜」的橘子拖尾 + 挂机计时（2026-10-07 十一要求）★
     * ============================================================
     * 十一原话：
     *   "走路的话要设计专属动作，然后还有橘子拖尾，然后两秒消失的那种。"
     *   "挂机的时候，手上拿个橘子，挂机 5 秒没动算挂机。"
     *
     * ------------------------------------------------------------
     * 【橘子拖尾】⚠️ 关键是"**拖尾要跟角色速度匹配**"（十一特别提过）：
     *   如果按**固定时间间隔**（比如每 0.2 秒一枚）发，
     *   跑得快 → 拖尾间距被拉得很开（像断线的珠子）；
     *   走得慢 → 挤成一堆。
     *   ⇒ 正确做法是**按移动距离**发放：
     *     在 spawnOrangeTrail 里用"上次落点到现在走了多远"判断，
     *     走到 `ORANGE_TRAIL_GAP` 像素才留一枚。
     *     这样无论快慢，**空间间距恒定**，看起来就是"走过的路"。
     *
     * 【挂机计时】满足这些条件才累计：
     *   · 站在地面 · 几乎不动（|vx| < 0.5）· 不在贴墙/冲刺
     *   ⇒ 一旦动起来（或离地）就**归零**。
     *   累计到 5 秒 → render.js 画"手上掏出橘子"。
     * ============================================================ */
    if (p.role === 'lulu') {
      /* --- 橘子拖尾（按距离） --- */
      if (p.onGround && Math.abs(p.vx) > 0.5) {
        spawnOrangeTrail(p);
      } else {
        p._orangeLastX = null;      // 停下/离地 → 重置"上次落点"
      }
      /* --- 挂机计时 --- */
      const idleNow = p.onGround && Math.abs(p.vx || 0) < 0.5 &&
                      !p.actWallDir && !p.dashing && p.spinT <= 0;
      p._idleT = idleNow ? (p._idleT || 0) + dt : 0;
    }

    /* ============================================================
     * ★ 地面是否"滑"：冰面地形 **或** 暴雨天气（2026-10-06）★
     * ============================================================
     * 十一要求："🌧️ 暴雨 → 地面打滑、刹车距离变长 → 复用'冰面'机制"。
     *
     * 【为什么能一行接入】
     *   原来的冰面就是"改两个参数"：加速度倍数 + 摩擦系数。
     *   暴雨只是**把'哪里算冰面'从'脚下那格是冰'放宽成'整关都算'**，
     *   所以判定改一处 `||` 就够，物理公式一个字没动。
     *
     * ⚠️ 踩坑提醒：这两个参数只在 `onIce` 为真时生效。
     *    之前写探针时想"直接改 CONFIG.ICE_*"来模拟暴雨，
     *    测出来毫无变化 —— 因为 isOnIce 是 false，参数压根没被读。
     *    ⇒ 要模拟暴雨，必须让这个 `||` 成立（或伪造 ices 数组）。
     *
     * ⚠️ 暴雨用的是**独立的常量**（WEATHER_RAIN_*）而不是冰面的 ——
     *    因为冰面是"局部地形"（可以绕开），暴雨是**整关**都滑，
     *    同样的参数值在暴雨下会难受得多。分开存才能各自调强度。
     * ============================================================ */
    const raining = isRainingWeather(lv);
    const slippery = isOnIce(p, lv) || raining;
    const onIce = slippery;                 // ⚠️ 保住旧变量名（下面多处用它）
    p.onIce = onIce;

    /* ⚠️ 参数选择要**区分三种情况**：
     *   ① 普通地面 → RUN_ACCEL / FRICTION
     *   ② 冰面     → ICE_*（局部，最滑）
     *   ③ 暴雨     → WEATHER_RAIN_*（整关，比冰面温和） */
    let accel, groundFriction;
    if (isOnIce(p, lv)) {                       // ① 真·冰面（优先，最滑）
      accel = CONFIG.RUN_ACCEL * CONFIG.ICE_ACCEL_MUL;
      groundFriction = CONFIG.ICE_FRICTION;
    } else if (raining) {                       // ② 暴雨（整关湿滑）
      accel = CONFIG.RUN_ACCEL * CONFIG.WEATHER_RAIN_ACCEL_MUL;
      groundFriction = CONFIG.WEATHER_RAIN_FRICTION;
    } else {                                    // ③ 普通
      accel = CONFIG.RUN_ACCEL;
      groundFriction = CONFIG.FRICTION;
    }

    /* ★ 🌊 积水打滑（第 13/15/18 关，2026-10-06）★
     * ------------------------------------------------------------
     * 【设计意图】十一要求"积水会改变移动和跳跃手感"，
     *   具体是"移动变滑、刹车距离变长"。
     *
     * 【怎么实现的】**不改 CONFIG**（红线），只是在**这一段局部**把
     *   accel 调小、friction 调大 —— 效果正好是"加速慢、但滑得远"，
     *   也就是"打滑"的手感。
     *
     * ⚠️ 为什么把 accel 调小而不是只调 friction：
     *    只调 friction 的话，玩家在积水里**加速仍然很快**，
     *    体验是"很灵敏但停不住" —— 那不对。
     *    真实的湿滑地面是"加速费劲 + 停不下来"，两个都要。
     *
     * ⚠️ 只影响**地面**移动（这一整段都在 onGround 分支里），
     *    空中不受影响 —— 否则会影响跳跃落点判定，那会动到可达性模型。
     * ------------------------------------------------------------ */
    try {
      if (typeof CH3 !== 'undefined' && CH3.isSlippery && CH3.isSlippery(p)) {
        accel = accel * 0.62;          // 加速变费劲
        groundFriction = 0.995;        // 几乎不减速 = 滑得远
      }
    } catch (e) { /* 机制模块异常不影响基础移动 */ }

    // 水平加速（支持多键：任一绑定键按住即算）
    const left = InputState.actionHeld(p.role, 'left');
    const right = InputState.actionHeld(p.role, 'right');
    /* ============================================================
     * ★★ 2026-10-07 新增：手机按键灵敏度（十一要求）★★
     * ============================================================
     * 十一原话："然后提高这个手机版的灵敏度，就是按钮的灵敏度。"
     *
     * 【为什么是"乘 accel"而不是"改 CONFIG.RUN_ACCEL"】
     *   ⚠️ 项目红线：physics.js 的物理参数**不许改数值**。
     *   原因不是教条 —— 是 `RUN_ACCEL` 参与"跑两步能跳多远"的
     *   可达性推算，第 13~20 关的坑宽（3.38 / 5.44 格）就是按它算的。
     *   直接改数值 = 悄悄改掉所有关卡的可通过性（血泪：那种 bug
     *   极其难查，表现是"某几关突然过不去"）。
     *
     *   ⇒ 所以做成**局部的、玩家自选的倍率**：
     *      · 默认 1 ⇒ 乘了等于没乘（行为与改动前**完全一致**）
     *      · 只有玩家在设置里主动调过才生效
     *      · 且**只影响本地玩家**（AI 走 predictPlayer/aiInput，
     *        不经过这里 ⇒ 人机会不会因这个设置失衡）
     *
     * 【为什么只乘 accel、不乘 speed】
     *   乘 speed 会改"最高速度"⇒ 又变成可达性问题（平跳距离按
     *   RUN_SPEED 算的）。乘 accel 只改"多久到最高速"，
     *   峰值速度不变 ⇒ **不改变任何跳跃距离**，纯粹是手感。
     *   这是"能做"和"安全"之间唯一正确的取舍。
     * ============================================================ */
    try {
      if (typeof SAVE === 'function') {
        const sv = Number(SAVE().settings().padSensitivity);
        if (isFinite(sv) && sv > 0) accel = accel * sv;
      }
    } catch (e) { /* 读不到存档就用原 accel，不影响基础移动 */ }
    /* ★ 外卖车（2026-10-07）：借到加速时水平速度更快 ★
     * ⚠️ 只乘在 speed 上，不碰 accel / 跳跃（见 scooter.js 顶部说明）。 */
    const _rideMul = (typeof SCOOTER !== 'undefined') ? SCOOTER.speedMulFor(p) : 1;
    /* ★ 🌊 新机制的速度倍率（积水里变慢等）—— 同样是"只乘 speed" ★ */
    let _ch3Mul = 1;
    try {
      if (typeof CH3 !== 'undefined' && CH3.speedMulFor) _ch3Mul = CH3.speedMulFor(p);
    } catch (e) { /* 忽略 */ }
    const speed = CONFIG.RUN_SPEED * p.speedMul * _rideMul * _ch3Mul;

    /* ★ 冲刺期间完全接管移动 ★
     * ------------------------------------------------------------
     * 踩过的坑：新动作模块把 vx 设成冲刺速度 18.33，
     * 但这段原有代码**每帧都会重新计算 vx**（改成 ±RUN_SPEED=3），
     * 结果冲刺"看起来在冲"，实际每帧只走 3px —— 110px 的冲刺
     * 变成了 20px。测出来"冲刺距离严重不足"。
     *
     * 修法：冲刺进行中直接跳过整个水平输入逻辑，
     * 让 vx 完全由 actions.js 控制。冲刺只有 6 帧，跳过不影响手感。 */
    if (p.actDashT > 0) {
      p.running = false;
      /* 不碰 p.vx —— 保持 actions.js 设定的冲刺速度 */
    } else if (p.stun > 0) {
      /* 被炸弹掀翻时短暂失控：不接受左右输入（但重力/碰撞照常），
       * 这样爆炸就有"被冲飞"的实感，而不是被推一下还稳稳站着。 */
      p.stun--;
      p.running = false;
    } else if (left && !right) {
      p.vx -= accel;
      p.dir = -1;
      if (p.vx < -speed) p.vx = -speed;
      p.running = true;
    } else if (right && !left) {
      p.vx += accel;
      p.dir = 1;
      if (p.vx > speed) p.vx = speed;
      p.running = true;
    } else {
      // 冰面上摩擦系数接近 1（几乎不减速）→ 刹不住
      p.vx *= p.onGround ? groundFriction : CONFIG.AIR_FRICTION;
      if (Math.abs(p.vx) < 0.1 && !onIce) p.vx = 0;
      p.running = false;
    }

    // ---- 传送带：站在上面被持续推动 ----
    // 推力是"环境强加的"，所以直接改 vx，而不是像按键那样受 max speed 限制。
    // 这样逆着跑传送带能明显感觉到费劲，顺着跑会更快。
    if (p.onGround) {
      const belt = conveyorUnder(p, lv);
      if (belt) {
        p.vx += belt.dir * CONFIG.CONVEYOR_SPEED * 0.09;
        // 上限：顺向时允许比正常跑速快一点，但不至于失控
        const beltMax = speed + CONFIG.CONVEYOR_SPEED * 0.75;
        if (p.vx > beltMax) p.vx = beltMax;
        if (p.vx < -beltMax) p.vx = -beltMax;
      }
    }

    /* ============================================================
     * ★ 💨 大风：侧向持续推力（2026-10-06）★
     * ============================================================
     * 十一要求："💨 大风 → 侧向持续推力，跳跃轨迹偏移
     *            → 复用'传送带/风场'机制"。
     *
     * 【为什么紧跟在传送带后面】
     *   两者是**同一类力**（环境强加的持续水平推力），
     *   所以放在同一个位置、用同样的手法（直接改 vx）。
     *   区别：传送带只在"站在带子上"时生效，大风**整关都生效**
     *   （包括空中 —— 因为十一明确要"跳跃轨迹偏移"，
     *    空中不受力的话轨迹就不会偏，那就没实现需求）。
     *
     * ⚠️ 空中也推是**故意的**：
     *    这正是"大风"和"传送带"手感不同的地方 ——
     *    跳起来会被吹歪，落点要提前算。这是这条需求的核心体验。
     *
     * ⚠️ 上限保护：顺风时会叠加到很高速度，必须像传送带那样封顶，
     *    否则角色会"飞出去"失控。
     * ⚠️ 单位：WEATHER_WIND_PUSH 是"每帧加多少 vx"，
     *    乘 0.09 和传送带保持同一量纲（详见 CONVEYOR_SPEED 那行注释）。
     * ============================================================ */
    if (isWindyWeather(lv)) {
      p.vx += CONFIG.WEATHER_WIND_PUSH * 0.09;
      const windMax = speed + CONFIG.WEATHER_WIND_MAX_EXTRA;
      if (p.vx > windMax) p.vx = windMax;
      if (p.vx < -windMax) p.vx = -windMax;
    }

    // ---- 跳跃（含二连跳）----
    // 土狼时间：离开地面后仍有一小段时间算"可地面跳"
    if (p.onGround) p.coyote = CONFIG.COYOTE_TIME;
    else if (p.coyote > 0) p.coyote--;

    if (InputState.actionPressed(p.role, 'jump')) p.jumpBuffer = CONFIG.JUMP_BUFFER;
    else if (p.jumpBuffer > 0) p.jumpBuffer--;

    // 判断这次能不能跳：
    //   地面跳（含土狼时间）
    //   空中跳（二连跳）= 不在可地面跳状态，但还有剩余次数
    const canGroundJump = p.jumpBuffer > 0 && p.coyote > 0 && p.jumpsLeft > 0;
    /* 客户端预测也要遵守解锁门槛 —— 否则联机时客人能跳、房主不能跳，
     * 会变成"位置对不上"的同步 bug。 */
    const canAirJump = p.jumpBuffer > 0 && !p.onGround && p.coyote <= 0 &&
                       p.jumpsLeft > 0 && isActionUnlocked('doublejump');

    if (canGroundJump) {
      p.jumpsLeft--;              // 用掉一次
      p.vy = CONFIG.JUMP_POWER * p.jumpMul;
      p.jumpBuffer = 0;
      p.coyote = 0;
      p.onGround = false;
      p.squash = 0.78;            // 起跳拉伸
      p.doubleJumped = false;
      p.jumpCutEligible = true;   // 玩家自己跳的，允许"松键截断"
      applySeesawBoost(p);
      playJumpSound(p.role, 'jump');
      if (p.role === 'capybara') spawnHeavyDust(p.x + p.w / 2, p.y + p.h, 9);
      else if (p.role === 'stitch') spawnBurstDust(p.x + p.w / 2, p.y + p.h, 7);
      else spawnDust(p.x + p.w / 2, p.y + p.h, 5);
    } else if (canAirJump) {
      // 二连跳：重置垂直速度再给一次推力（不是叠加），
      // 否则在上升过程中触发会冲得特别高。
      p.jumpsLeft--;
      /* ⚠️ 联机这份也要乘 p.doubleJumpMul（和单人那份保持一致）。
       *    两处逻辑是复制的，改一处必须改另一处 —— 否则
       *    "单人能用尼克的二段跳加成、联机不行"。 */
      p.vy = CONFIG.JUMP_POWER * p.jumpMul * CONFIG.DOUBLE_JUMP_MUL * (p.doubleJumpMul || 1);
      p.jumpBuffer = 0;
      p.squash = 0.72;            // 二连跳拉伸更明显
      p.doubleJumped = true;
      /* 空中翻滚动画：转一圈，明确表现"这是二段跳" */
      p.spinT = CONFIG.DOUBLE_JUMP_SPIN_FRAMES;
      p.spinDur = CONFIG.DOUBLE_JUMP_SPIN_FRAMES;
      /* ⚠️ 关键修复：二连跳**不允许**被"松键截断"。
       *
       * 原来的 bug：这里也置 jumpCutEligible = true，
       * 于是"快速双击二段跳然后松手"的瞬间就被截断 —— 实测
       *   初速 -10.08 → -7.31（少 27.5%）
       *   上升高度 87px → 47px（几乎腰斩）
       * 表现就是十一说的"二段跳速度明显减慢、发飘"。
       *
       * 为什么不该截断：
       *   松键截断是为了"轻点小跳"（可变跳高），
       *   而二连跳本身就是**主动消耗一次跳跃机会**的动作 ——
       *   它已经有代价了，不需要再被截一刀。
       *   而且二连跳的输入习惯就是"快速双击后松手"，
       *   截断等于每次都误伤。
       *
       * 所以：置 false，让二连跳保持完整的上升速度。 */
      p.jumpCutEligible = false;
      applySeesawBoost(p);
      Sound.doubleJump();
      // 二连跳特效：双层光环 + 速度线 + 星芒，明确提示"第二跳用掉了"
      spawnDoubleJumpRing(p.x + p.w / 2, p.y + p.h);
      spawnDust(p.x + p.w / 2, p.y + p.h, 6);
    }
    /* 松键截断跳跃（可变跳高）：松开跳跃键时上升速度衰减变快，
     * 从而实现"轻点小跳、长按大跳"。
     *
     * ⚠️ 只对"玩家自己按跳键起跳"生效。
     * `jumpCutEligible` 在玩家按跳时置 true，落地时清除。
     * 弹簧板这类外部力弹射不会置这个标记，所以不会被削 ——
     * 踩过这个坑：弹簧弹力 -17.5，因为没按跳键被每帧削一刀，
     * 实际只上升了 31px（应该 ~247px）。 */
    /* 冲刺期间豁免（冲刺是匀速直线运动，不该被跳跃截断逻辑削速度） */
  if (p.actDashT > 0) { /* 冲刺中，跳过截断 */ }
  else if (p.vy < 0 && p.jumpCutEligible && !InputState.actionHeld(p.role, 'jump')) {
      p.vy *= (1 - (1 - CONFIG.JUMP_CUT) * 0.5);
    }

    // 挤压恢复
    p.squash += (1 - p.squash) * 0.18;
    // 二连跳翻滚计时递减
    if (p.spinT > 0) p.spinT--;

    const wasAir = !p.onGround;
    const prevBottom = p.y + p.h;

    /* 碰撞推进。
     * opts.noGravity：冲刺期间要"匀速直线"，不能被重力拉弯轨道
     * （见 actions.js 的 actHandleDash）。 */
    const collRes = moveAndCollide(p, solids, { noGravity: !!p.actNoGravity });
    resolvePlatforms(p, lv.platforms, prevBottom);

    /* ★ 新动作系统 ★
     * 必须放在**碰撞之后** —— 因为"贴墙"依赖碰撞结果
     * （collRes.hitLeft / hitRight），冲刺也要在碰撞后才改速度。
     * 传入 collRes 让 actions.js 能复用这次碰撞的结果，不用重复计算。 */
    try {
      if (typeof ACTIONS !== 'undefined' && ACTIONS.updatePlayer) {
        ACTIONS.updatePlayer(p, lv, solids, collRes);
      }
    } catch (e) {
      /* 新动作出错不该带走整个游戏循环（顶层 loop 已有兜底，
       * 这里再包一层是为了只丢"新动作"而不是丢整帧）。
       * 但要打印一次，否则出问题时毫无线索。 */
      warnActionsOnce('动作更新', e);
    }

    // 踩队友头顶当跳板（单人模式没有队友，跳过；否则会拿到 undefined 崩溃）
    if (Game.players.length >= 2) {
      const other = Game.players[1 - i];
      if (other) checkPlayerPlatform(p, other);
    }

    // 落地音效 + 挤压
    if (p.onGround && wasAir && p.vy >= 0) {
      p.squash = 1.22;
      playJumpSound(p.role, 'land');
      spawnDust(p.x + p.w / 2, p.y + p.h, 4);
    }

    // ⚠️ 二连跳次数的重置必须放在碰撞之后。
    // 原因：碰撞（moveAndCollide）才是把 onGround 置为 true 的地方，
    // 如果只在跳跃逻辑开头（碰撞之前）判断 onGround，落地那一帧会漏掉重置，
    // 导致落地后仍然不能二连跳。
    if (p.onGround) {
      p.jumpsLeft = CONFIG.MAX_JUMPS;
      p.doubleJumped = false;
      p.jumpCutEligible = false;   // 落地后清掉，避免影响下一次跳跃
    }

    /* ---- 弹簧板：踩到就弹飞 ----
     * 判定条件要同时看"脚下有弹簧"和"正在下落/站住"，
     * 避免从下面顶上来的时候被误弹。
     * 弹簧的弹力明显大于正常跳跃（17.5 vs 11.2），配合二连跳能上到很高的地方。 */
    const spr = springUnder(p, lv);
    if (spr && spr.cooldown <= 0 && p.vy >= -0.5) {
      p.vy = CONFIG.SPRING_POWER;
      p.jumpsLeft = CONFIG.MAX_JUMPS;   // 弹起来后二连跳也重置，手感更爽
      p.doubleJumped = false;
      p.onGround = false;
      p.squash = 0.7;
      spr.compress = 1;                 // 触发压缩动画
      spr.cooldown = CONFIG.SPRING_COOLDOWN;
      Sound.spring();
      spawnDust(p.x + p.w / 2, p.y + p.h, 6);
      spawnDoubleJumpRing(p.x + p.w / 2, p.y + p.h);
    }

    // 掉出屏幕 → 直接判定失败（不再走扣血流程，避免反复触发）
    if (p.y > lv.height + 120) {
      p.hearts = 0;
      Sound.die();
      Game.state = STATE.GAMEOVER;
      Game.deathReason = 'fall';
      Game.message = displayNameOfRole(p.role) + ' 摔车了！';
      Game.messageTimer = 99999;
      return;
    }

    if (p.invuln > 0) p.invuln--;
    if (p.deadFlash > 0) p.deadFlash--;
  }

  /* ============================================================
   * ★ 🛵 外卖车更新（2026-10-07 改版：借车加速）★
   * ============================================================
   * ⚠️ 位置很关键：放在**玩家物理更新之后**。
   *    因为借车判定要读"物理算完的位置"——
   *    放前面的话用的是上一帧的旧坐标，会出现
   *    "明明碰到车了却没借到"（差一帧）。
   *
   * ⚠️ 它**不修改任何物理参数**，只做两件事：
   *    ① 碰到"还有电"的车 → 点亮 p.boostTimer（限时加速）
   *    ② 倒计时递减 / 归零收尾
   *    真正影响速度的是 `SCOOTER.speedMulFor(p)`，
   *    那是**下一帧**算速度时才读的（所以不冲突）。
   * ============================================================ */
  try {
    if (typeof SCOOTER !== 'undefined' && SCOOTER.update) {
      for (let i = 0; i < Game.players.length; i++) {
        SCOOTER.update(Game.players[i], lv, dt);
      }
    }
  } catch (e) { warnActionsOnce('外卖车更新', e); }

  /* ============================================================
   * ★ 🧍 收餐人台词推进（2026-10-07）★
   * ============================================================
   * 这 10 秒是**纯表现层**：它不改速度、不给状态、不判生死。
   * 触发在 render.js（要等"骑手真的走进门洞"才知道该说话），
   * 这里只负责把计时往前推。
   *
   * ⚠️⚠️ 它**绝不阻挡通关** —— 本作"送达即结算"，
   *    这 10 秒是叠在结算/庆祝上的余韵，玩家可以随时按键跳过。
   *    见 receiver-talk.js 的 `blocksGoal()`（那里写死 false）。
   * ============================================================ */
  try {
    if (typeof receiverTalkTick === 'function') receiverTalkTick(dt);
  } catch (e) { warnActionsOnce('收餐人台词推进', e); }

  /* ============================================================
   * ★ 🌊 第 13~20 关机制：每帧推进（2026-10-06）★
   * ============================================================
   * 这一步只做"**推进计时器、改状态**"——
   *   水柱该喷了没 / 漏电该通电了没 / 水位涨到哪了 / 车流走到哪了 /
   *   阶段推进到第几段 / 闪电在预警还是落雷 …
   *
   * ⚠️ 真正影响玩家的是下面三处**查询**（都在物理循环里）：
   *     · CH3.jetLiftFor(p) / bubbleLiftFor(p) → 给向上的速度
   *     · CH3.speedMulFor(p) / isSlippery(p) / pushFor(p) → 改手感
   *     · CH3.hurtAt(p) → 报告"这里危险"（game.js 再决定扣血）
   *   这种"推进"和"查询"分离的写法，是为了让机制**不侵入物理**。
   * ============================================================ */
  try {
    if (typeof CH3 !== 'undefined' && CH3.update) CH3.update(dt, lv);
  } catch (e) { warnActionsOnce('第三章机制更新', e); }

  // 玩家互相阻挡（单人模式没有第二个玩家，跳过）
  /* ★ 移动平台"带着玩家走" ★
   * 必须在玩家物理更新**之后** —— 因为要先知道玩家这一帧
   * 有没有落在平台上（onGround + 脚底贴着平台顶面），
   * 再决定要不要跟着平台位移。
   *
   * 不做这一步的后果：平台从脚下滑走，玩家看起来"悬空停着"，
   * 而实际上平台已经移开了 —— 非常别扭。 */
  try {
    if (typeof ACTIONS !== 'undefined' && ACTIONS.carryPlayer) {
      for (let i = 0; i < Game.players.length; i++) {
        ACTIONS.carryPlayer(Game.players[i], lv);
      }
    }
  } catch (e) { warnActionsOnce('平台承载', e); }

  if (Game.players.length >= 2) separatePlayers(p1, p2);

  /* ---- 按钮踩踏判定 ----
   * 锁存式（latch）：踩亮一次就永久保持，不用一直站着。
   * 原因：如果必须一直踩住，两人都被钉在按钮上，
   *       谁也走不到终点，关卡就无解了。
   * 只要想改成"必须踩着"，把永久点亮那行注释掉即可。 */
  for (let i = 0; i < lv.buttons.length; i++) {
    const btn = lv.buttons[i];
    if (btn.pressed) continue;   // 已经亮了，不用重复判定
    for (let j = 0; j < Game.players.length; j++) {
      const p = Game.players[j];
      const foot = { x: p.x + 4, y: p.y + p.h - 4, w: p.w - 8, h: 8 };
      if (!aabb(foot, btn)) continue;
      // 冰火人机制：只有对应角色能踩亮。
      // 单人模式下放宽：唯一的角色可以踩亮任意按钮（否则关卡无解）。
      const okRole = btn.color === 'Y' ? 'kangaroo' : 'dragon';
      const canPress = (p.role === okRole) || Game.playerCount === 1;
      if (canPress) {
        btn.pressed = true;
        btn.latchFlash = 30;
        Sound.button();
        spawnSparkle(btn.x + btn.w / 2, btn.y, btn.color === 'Y' ? '#f7c948' : '#ff9a3c');
      }
    }
  }

  /* ============================================================
   * ★★ 彩蛋踏板判定（2026-10-06）★★
   * ============================================================
   * 第 11 关起点那块"踩踩看"的板子 —— 踩住显示作者微信二维码。
   *
   * ⚠️⚠️ 和上面的 `buttons` **关键区别：这里是实时的，不是锁存**。
   *    `buttons` 踩一次就永久亮（`if (btn.pressed) continue;`），
   *    因为它要"开门"，两人不可能一直站在按钮上。
   *    而彩蛋要的是"**走下踏板立刻消失**" ⇒ 每帧重新判定：
   *      pressed = 本帧有没有人踩着
   *
   * ⚠️ 判定区和 buttons 一样（脚底那一小条 AABB），
   *    但结果**只写 eggPads[i].pressed**，不参与任何门/机关判定。
   *
   * ⚠️ 踩住时要把 `Game.message` 续命（坑 1，详见 render.js 的说明）：
   *    `Game.message` 靠 `messageTimer` 倒计时，到 0 就消失。
   *    我们要"站着就一直显示"，所以**每帧把计时器补回 6**。
   *    · 一直踩着 → 每帧都补 → 一直在
   *    · 走开 → 不再补 → 6 帧（约 0.1 秒）内自然淡出，干脆利落
   *    ⚠️ 不要新增独立变量来管这句大字 —— 那会和已有的 message 系统
   *       打架（比如"订单还差 N 单"的提示）。复用它，只做续命。
   * ============================================================ */
  if (lv.eggPads && lv.eggPads.length) {
    for (let i = 0; i < lv.eggPads.length; i++) {
      const pad = lv.eggPads[i];
      let someoneOn = false;
      for (let j = 0; j < Game.players.length; j++) {
        const p = Game.players[j];
        const foot = { x: p.x + 4, y: p.y + p.h - 4, w: p.w - 8, h: 8 };
        if (aabb(foot, pad)) { someoneOn = true; break; }
      }
      /* ★ 实时赋值（不是 `if (pressed) continue`）—— 走开就变 false */
      pad.pressed = someoneOn;
    }
    /* 只要**任意一块**踏板被踩着，就显示那句大字 + 续命
     * ⚠️ `EGG_MESSAGE` 定义在 egg.js —— 用 typeof 保护，
     *    这样万一 egg.js 没加载（被删了），游戏照常能玩，只是彩蛋不显示。
     *    这是项目规范要求的"新模块删掉能退回原版"。 */
    const anyPadPressed = lv.eggPads.some(function (pad) { return pad.pressed; });
    if (anyPadPressed && typeof EGG_MESSAGE !== 'undefined') {
      Game.message = EGG_MESSAGE;
      Game.messageTimer = Math.max(Game.messageTimer, 6);
    }
  }

  /* ---- 门开合 ----
   * 多人：所有按钮都亮 → 门开。
   * 单人：任意一个按钮亮 → 门开（一个人踩不了两个按钮，必须放宽）。
   * 按钮是锁存的，所以门一旦打开就保持开启。
   *
   * ⚠️ 必须跳过"开关门"（isSwitchDoor）！
   * ------------------------------------------------------------
   * 踩过的坑：这里原来无条件遍历**所有**门并覆盖 openAmount / open。
   * 结果新加的"开关门"被这段旧逻辑每帧强制关回去 ——
   * 开关明明切换成功了（on=true），门却永远打不开，
   * 表现为"踩开关没反应"，而且手动调用机关更新时又是正常的，
   * 非常难查。
   *
   * 所以：按钮门（原机制）和开关门（新机制）各管各的，互不干扰。 */
  for (let i = 0; i < lv.doors.length; i++) {
    const d = lv.doors[i];
    if (d.isSwitchDoor) continue;      // ★ 开关门由 actions.js 负责
    let shouldOpen;
    if (lv.buttons.length === 0) {
      shouldOpen = false;
    } else if (lv.singlePlayerRelaxed) {
      shouldOpen = lv.buttons.some(function (b) { return b.pressed; });
    } else {
      shouldOpen = lv.buttons.every(function (b) { return b.pressed; });
    }
    const target = shouldOpen ? 1 : 0;
    const before = d.openAmount;
    d.openAmount += (target - d.openAmount) * 0.12;
    if (Math.abs(d.openAmount - target) < 0.01) d.openAmount = target;
    d.open = d.openAmount > 0.85;
    if (before < 0.5 && d.openAmount >= 0.5) {
      Sound.door();
      Game.message = '货仓门开了！';
      Game.messageTimer = 80;
    }
  }

  /* ---- 按钮点亮闪烁计时 ---- */
  for (let i = 0; i < lv.buttons.length; i++) {
    if (lv.buttons[i].latchFlash > 0) lv.buttons[i].latchFlash--;
  }

  /* ---- 尖刺 ---- */
  for (let i = 0; i < Game.players.length; i++) {
    const p = Game.players[i];
    for (let h = 0; h < lv.hazards.length; h++) {
      if (aabb(p, lv.hazards[h])) damagePlayer(p, 1, 'hazard');
    }
  }

  /* ============================================================
   * ★ 🌊 第 13~20 关机制：对玩家的作用（2026-10-06）★
   * ============================================================
   * 四件事，全部在这里一次性处理：
   *   ① 水柱 / 气泡流 → **给向上速度**（把角色托起来）
   *   ② 水流推力 → 每帧往 vx 上加点（把角色往下游推）
   *   ③ 伤害 → 漏电 / 电弧 / 闪电 / 坠落物 / 追车撞上
   *   ④ 叉车 → 不是直接扣血，是**击退**（更符合"被撞开"的手感）
   *
   * ⚠️ 为什么"托举"要给速度而不是直接改位置：
   *    改位置会**跳过碰撞检测**，角色可能被塞进墙里。
   *    给速度则完全走原有物理（该撞墙还是会撞），和"跳跃"同一条路径。
   *
   * ⚠️ 为什么要 try 包住：
   *    机制模块出问题绝不能影响"基础平台跳跃"能玩下去。
   * ============================================================ */
  try {
    if (typeof CH3 !== 'undefined' && CH3.active && CH3.active()) {
      for (let i = 0; i < Game.players.length; i++) {
        const p = Game.players[i];
        if (!p || p.dead || p.hearts <= 0) continue;

        /* ①a 水柱：踩在正在喷发的柱子上 → 被顶起来 */
        const jet = CH3.jetLiftFor(p);
        if (jet) {
          /* ⚠️ 只在"下落或站着"时给，避免"站在水柱上被无限加速" */
          if (p.vy > jet) p.vy = jet;
          p.onGround = false;
          p.coyote = 0;
        }

        /* ①b 气泡流：在水里被往上托（更温和） */
        const bub = CH3.bubbleLiftFor(p);
        if (bub && p.vy > bub) p.vy = bub;

        /* ② 水流推力 */
        const push = CH3.pushFor(p);
        if (push) p.vx += push;

        /* ③ 伤害 */
        const reason = CH3.hurtAt(p);
        if (reason) damagePlayer(p, 1, reason);

        /* ④ 叉车击退（不是直接死，是撞开 + 小伤害） */
        const knock = CH3.knockAt(p);
        if (knock) {
          p.vx = knock.vx;
          p.vy = knock.vy;
          p.onGround = false;
          damagePlayer(p, 1, knock.reason);
        }
      }
    }
  } catch (e) { warnActionsOnce('第三章机制作用', e); }

  /* ---- 敌人 ----
   * 两种行为：
   *   walker 巡逻怪 —— 来回走，会走落差（简单版重力）
   *   hopper 跳跳怪 —— 抛物线起跳，落地再弹，边跳边漂
   * 共同点：踩头顶可以消灭，撞侧面扣血。 */
  for (let e = 0; e < lv.enemies.length; e++) {
    const en = lv.enemies[e];
    if (en.dead) continue;

    if (en.type === 'hopper') {
      updateHopper(en, lv, solids);
    } else {
      en.animT += dt;
      en.x += en.vx;
      if (en.x < en.patrolLeft) { en.x = en.patrolLeft; en.vx = Math.abs(en.vx); }
      if (en.x + en.w > en.patrolRight) { en.x = en.patrolRight - en.w; en.vx = -Math.abs(en.vx); }
      // 重力
      let onG = false;
      for (let s = 0; s < solids.length; s++) {
        const so = solids[s];
        if (aabb({ x: en.x, y: en.y + 1, w: en.w, h: en.h }, so)) { onG = true; break; }
      }
      if (!onG) en.y += 3;
    }

    for (let i = 0; i < Game.players.length; i++) {
      const p = Game.players[i];
      if (!aabb(p, en)) continue;
      const pBottom = p.y + p.h;
      if (p.vy > 0 && pBottom < en.y + 16) {
        en.dead = true;

        /* ---- 踩怪弹跳：分「普通踩」和「蓄力超级跳」 ----
         * 按住下键（S / ↓）时给一个高得多的弹跳，
         * 这是玩家可主动使用的高跳手段（关卡设计上也留了这种用法）。
         *
         * 判定用 actionHeld 而不是 actionPressed：
         *   玩家从空中落下时手指本来就可能压着下键，
         *   用"按住"更符合直觉，不用卡精确时机。 */
        const superStomp = InputState.actionHeld(p.role, 'down');
        /* ★ 2026-10-06：踩怪弹跳也要乘角色跳跃倍率 ★
         * 原来写死 CONFIG.STOMP_BOUNCE(_SUPER)，袋鼠和奶龙弹得一样高 ——
         * 但奶龙跳得矮，踩怪却弹得和袋鼠一样，既不合理，也让
         * "袋鼠擅长垂直路线"这个定位在踩怪玩法里失效。
         * 现在按角色倍率缩放（步长改成函数据此计算，见 physics.js）。
         *
         * ⚠️ 这里是"踩怪超级跳"的主要消费点 —— 第 1 关的
         *    "踩怪上高台"教学点就靠它。改参数务必跑 jump-test。 */
        const jm = p.jumpMul || 1;
        /* ★ 踩怪弹跳倍率（2026-10-07 加，碧琪的招牌）★
         * ⚠️ 和 jm 是**两个不同的维度**：
         *    jm = 通用跳跃身板（袋鼠 1.12）
         *    bm = 只放大"踩怪那一下"（碧琪 1.75）
         * 不传等价于 1 → 老角色行为**完全不变**。 */
        const bm = p.stompBounceMul || 1;
        const bounceBase = (typeof CONFIG.stompBounce === 'function')
          ? CONFIG.stompBounce(jm, bm) : CONFIG.STOMP_BOUNCE * jm * bm;
        const bounceSuper = (typeof CONFIG.stompBounceSuper === 'function')
          ? CONFIG.stompBounceSuper(jm, bm) : CONFIG.STOMP_BOUNCE_SUPER * jm * bm;
        p.vy = superStomp ? bounceSuper : bounceBase;

        p.squash = superStomp ? 0.62 : 1.25;   // 蓄力跳拉伸更明显
        p.jumpsLeft = CONFIG.MAX_JUMPS;   // 踩敌人头 → 重置二连跳次数
        p.doubleJumped = false;
        /* 踩怪弹跳明确不允许被"松键截断" ——
         * 这是外部力（踩到了敌人），不是玩家主动跳的，
         * 否则玩家没按跳键就会被每帧削一刀（弹簧板踩过这个坑）。 */
        p.jumpCutEligible = false;

        /* ★ 记一笔"踩过怪" ★
         * 教学提示 tut_stomp（"跳到小怪头顶就能踩死"）靠这个计数决定
         * 还要不要教 —— 玩家已经踩过了就不用再唠叨。
         * 放在这里而不是 tutorial.js 里，是因为"踩到了"这件事
         * 只有物理/碰撞这边知道。 */
        if (Game.tutorial) Game.tutorial.stompUsedCount =
          (Game.tutorial.stompUsedCount || 0) + 1;

        if (superStomp) {
          Sound.doubleJump();            // 蓄力跳用更"有力"的音效
          spawnStompSuperEffect(en.x + en.w / 2, en.y + en.h / 2);
        } else {
          Sound.stomp();
          spawnDust(en.x + en.w / 2, en.y, 8);
        }
        addScorePop(en.x, en.y);
      } else {
        damagePlayer(p, 1, 'enemy');
      }
    }
  }

  /* ---- 外卖订单（收集品）----
   * ⚠️ 代码里仍叫 coin（金币），因为地图字符 'o'、字段 lv.coins、
   *    存档 bestCoins 全都是这个名字，全局改名风险太大且没收益。
   *    但**玩家看到的一切**都叫"订单"（HUD、提示、结算）。
   *    这是刻意的：内部名保持稳定，对外文案统一。 */
  for (let c = 0; c < lv.coins.length; c++) {
    const co = lv.coins[c];
    if (co.taken) continue;
    co.bob += dt * 3;
    for (let i = 0; i < Game.players.length; i++) {
      const p = Game.players[i];
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (Math.hypot(cx - co.x, cy - co.y) < 22 + co.r) {
        co.taken = true;
        Game.coinsTaken++;
        /* ★ E3（第 7 期）：记"碰到过订单袋"——
         *   "洁癖客户"那个神秘订单要求全程不碰订单袋，
         *   靠这个计数判断。注意：这里**碰到就算**，
         *   和 coinsTaken（真正收到）是两回事吗？
         *   —— 本项目里"碰到即收取"，所以两个计数会同步，
         *   但语义不同：coinsTouched 表达"手碰过"，
         *   以后若加了"必须先接单再送达"，这个区分就用得上。 */
        if (Game.challengeStats) Game.challengeStats.coinsTouched++;
        Sound.coin();
        spawnSparkle(co.x, co.y);

        /* ★ 拾取反馈："订单 +1" ★
         * 十一要求"拾取时出现明确反馈，例如『订单 +1』"。
         * 用**飘字粒子**而不是 Game.message ——
         * message 显示在画面中央偏上，收集得频繁时会一直闪、很吵；
         * 飘字跟在角色旁边消失，既清楚又不挡视线。 */
        spawnFloatText(cx, cy - 14, '订单 +1');

        /* 刚好凑够最低要求时，给一次明确的"可以走了"提示。
         * 只在**越过阈值的那一刻**提示一次（不是每捡一个都提示）——
         * 所以判定必须用"这一单之前还不够、这一单之后够了"。
         * ⚠️ 80% 门槛下，从 0 张一路捡到门槛会跨过很多次（每关订单多），
         *    但 `=== coinsRequired` 只会在**正好相等**那一帧成立，仍然只提示一次。 */
        if (Game.coinsTaken === Game.coinsRequired) {
          Game.message = '订单够了！可以前往收餐点';
          Game.messageTimer = 150;
          Sound.checkpoint();
        }
      }
    }
  }

  /* ---- 存档点 ---- */
  for (let c = 0; c < lv.checkpoints.length; c++) {
    const cp = lv.checkpoints[c];
    if (cp.on) continue;
    for (let i = 0; i < Game.players.length; i++) {
      if (aabb(Game.players[i], cp)) {
        cp.on = true;
        /* ★ 记录检查点位置 ★
         * 踩过的坑：Game.checkpoint 一直初始化成 null 却**从来没赋过值**，
         * 导致失败界面的"从检查点继续"永远没法工作（没有数据可用）。
         * 现在真正把踩到的存点存下来。 */
        Game.checkpoint = { x: cp.x, y: cp.y, index: c };
        Sound.checkpoint();
        spawnSparkle(cp.x + 16, cp.y + 16);
        Game.message = '打卡点已记录 —— 之后失败可以从这里继续';
        Game.messageTimer = 110;
      }
    }
  }

  /* ---- 机关动画状态推进 ---- */
  // 弹簧：压缩量回弹 + 冷却递减
  for (let i = 0; i < lv.springs.length; i++) {
    const s = lv.springs[i];
    if (s.cooldown > 0) s.cooldown--;
    if (s.compress > 0) s.compress = Math.max(0, s.compress - 0.09);
  }
  // 传送带：滚动条纹动画相位
  for (let i = 0; i < lv.conveyors.length; i++) {
    lv.conveyors[i].scroll += lv.conveyors[i].dir * 0.09;
  }

  updateBridges(lv);
  updateBombs(lv);
  updateSeesaws(lv);

  /* ---- 终点 ----
   * 过关有两个条件，必须同时满足：
   *   1. 所有角色都碰到送达点
   *   2. 收集的订单达到门槛（见 CONFIG.COIN_REQUIRE_RATIO）
   * 订单不够时送达点不生效，并在旁边提示还差几单。
   * 这样订单收集就从"装饰品"变成了和跳跃同等重要的必做动作。 */
  if (lv.goal) {
    const coinsOk = Game.coinsTaken >= Game.coinsRequired;
    let allAtGoal = true;
    for (let i = 0; i < Game.players.length; i++) {
      const p = Game.players[i];
      p.atGoal = aabb(p, lv.goal);
      if (!p.atGoal) allAtGoal = false;
    }

    /* ============================================================
     * ★ 🏁 PK 模式：谁先到终点谁赢（2026-10-06）★
     * ============================================================
     * 【和普通模式的规则差异（很重要）】
     *   普通模式：**所有**玩家都到终点 + 订单达标 → 过关
     *   PK 模式  ：**任何一个**到终点 → 立刻结束，他赢
     *
     * 【为什么 PK 不要求收齐订单】
     *   ① 规则的"目标"必须只有一个。"比速度"和"比收集"混在一起，
     *      玩家不知道该先干嘛。
     *   ② AI 不会捡金币（那是复杂得多的 AI），要求订单等于
     *      **玩家必须多花时间捡、AI 直冲** → 规则对玩家不公平。
     *   ⇒ PK 就是纯竞速：到终点 = 赢。
     *
     * ⚠️ 判定要在普通过关判定**之前** —— 否则 PK 局会被
     *    "订单不达标"拦住，永远结束不了。
     * ============================================================ */
    if (Array.isArray(Game.aiRoles) && Game.aiRoles.length && !Game.pkResult) {
      for (let i = 0; i < Game.players.length; i++) {
        const p = Game.players[i];
        if (!p.atGoal) continue;
        const isAI = Game.aiRoles.indexOf(p.role) >= 0;
        Game.pkResult = {
          winnerRole: p.role,
          winnerIsAI: isAI,
          elapsed: Game.elapsed,
          /* 另一位参赛者到哪了（用于结算页显示"你差多少"） */
          loserProgress: (function () {
            let best = 0;
            Game.players.forEach(function (q) {
              if (q === p) return;
              const pr = (typeof PK_RACE !== 'undefined') ? PK_RACE.progressOf(q, lv) : 0;
              if (pr > best) best = pr;
            });
            return best;
          })(),
        };
        Game.state = STATE.CLEAR;
        Sound.win();
        return;
      }
    }

    if (allAtGoal && coinsOk) {
      Game.state = STATE.CLEAR;
      Sound.win();

      /* ★ C3（2026-10-06 第 1 期）：通关瞬间记下"剩余好评率" ★
       *   结算页要显示"本单评价（好评率）"，但结算时玩家可能已经
       *   被重置/换人，或者 Game.players 的状态已经不新鲜了 ——
       *   所以在**通关那一刻**把数值快照下来，结算页只读快照。
       *
       * ⚠️ 只是"记一个数"，没有任何判定/改动 —— 好评率本身
       *    还是由 hearts 决定的（掉血逻辑一行没动）。 */
      const p0 = Game.players[0];
      if (p0) {
        Game.playerHeartsAtClear = p0.hearts;
        Game.playerMaxHeartsAtClear = p0.maxHearts;
      }

      /* ============================================================
       * ★ E3 神秘订单：通关时判定挑战是否达成（第 7 期）★
       * ============================================================
       * ⚠️⚠️ 这一段是**"发称号"**，不是"判过关" ⚠️⚠️
       *   · 挑战没达成 → 什么也不发生，玩家照样通关（已在上面的 if 里）
       *   · 挑战达成  → 解锁一个称号，结算页会显示
       *   所以这里**绝不允许**出现"没达成就不让过关"的逻辑。
       *
       * 只在单人模式判定（方案：E3 明确只做单人版）。
       * ============================================================ */
      Game.newTitleThisClear = null;      // 本局新解锁的称号（没解锁就是 null）
      const solo = (Game.mode === 'single' || Game.playerCount === 1);
      if (solo && typeof mysteryOrderForLevel === 'function') {
        const mo = mysteryOrderForLevel(Game.levelIndex);
        if (mo) {
          const st = Game.challengeStats || { coinsTouched: 0, damageTaken: 0 };
          let done = false;
          if (mo.id === 'no_pickup') {
            /* 全程不碰订单袋 —— 但还要能过关（够最低要求）……
             * ⚠️ 矛盾点：不碰袋子就收不到订单，就过不了关！
             *    所以这个条件实际上是**不可能达成**的。
             *    ⇒ 换句话说这条件设计得不对 —— 我把它改成
             *      "只碰必要的，不去捡多余的"：碰到的数量 = 最低要求数。
             *    这样既反直觉（少拿反而好），又能真的达成。
             *    （这是施工时发现的设计问题，已记进最终报告待十一确认。） */
            done = (st.coinsTouched === Game.coinsRequired) &&
                   (Game.coinsTaken === Game.coinsRequired);
          } else if (mo.id === 'all_pickup') {
            done = (Game.coinsTaken === Game.coinsTotal) && Game.coinsTotal > 0;
          } else if (mo.id === 'no_damage') {
            done = (st.damageTaken === 0);
          }
          if (done) {
            const isNew = SAVE().addTitle(mo.title);
            if (isNew) Game.newTitleThisClear = mo.title;
          }
        }
      }

      /* 记录存档。
       * 联机时只有【房主】记录（客人不写自己的本地存档，
       * 因为那一局的成绩属于房主的进度）。
       * 单人 / 本地双人也照常记录 —— 本地双人就是同一台电脑上的两个人。
       *
       * ★ 传角色 id ★ —— 十一要求"关卡最佳时间建议按角色分别保存"。
       *   单人模式记当前骑手；多人/联机没有"当前骑手"概念，传 null，
       *   只记关卡总最佳（不写角色记录）。 */
      if (Game.mode !== 'online' || Net.role === 'host') {
        const recCharId = (Game.playerCount === 1 && Game.players[0])
          ? (charByRole(Game.players[0].role) || {}).id
          : null;
        Game.lastRecord = SAVE().recordClear(
          Game.levelIndex, Game.elapsed, Game.coinsTaken, Game.coinsTotal,
          recCharId || null
        );
        // 顺手记一次"这个骑手出战了" —— 角色库里要显示出战次数
        if (recCharId) SAVE().addCharUse(recCharId);
      } else {
        Game.lastRecord = null;
      }

      /* ============================================================
       * ★ 全局成就判定（2026-10-06 新增）★
       * ============================================================
       * 上面那段"神秘订单"是**每关一条**的判定（读本局统计）。
       * 这里补的是**跨关卡的全局成就**（跑完全程 / 三星全收 /
       * 专一骑手 / 换着骑 / 闪电骑手 / 全勤标兵 …）。
       *
       * ⚠️⚠️ 顺序很重要：**必须在 `recordClear()` 之后**！
       *    判定函数读的是"这一单记进去之后的存档"——
       *    放在前面的话，"跑完全程"会永远差最后一关。
       *
       * ⚠️ 一次通关可能**同时解锁多个**（比如最后一关通关那一瞬间，
       *    "单王""全勤标兵""三星骑手"可能一起达成），
       *    所以这里把新解锁的都收进数组，弹提示时一起显示。
       *
       * ⚠️ 单人才判定 —— 和神秘订单同一个口径（成就属于骑手自己的进度）。
       * ============================================================ */
      if (Game.mode !== 'online' && typeof checkGlobalAchievements === 'function') {
        try {
          const newGlobal = checkGlobalAchievements();
          if (newGlobal && newGlobal.length) {
            /* 一条就沿用原来的单个字段（简单）；
             * 多条就把它们**拼成一行**显示在同一个称号块里 ——
             * 不新造 UI，结算页那块还是原来那个。 */
            Game.newTitleThisClear = Game.newTitleThisClear
              ? (Game.newTitleThisClear + ' · ' + newGlobal.join(' · '))
              : newGlobal.join(' · ');
          }
        } catch (e) {
          /* 成就判定出错**绝不能影响通关** —— 静默跳过。 */
        }
      }
    } else if (allAtGoal && !coinsOk) {
      /* 站到收餐点但订单不够 → 明确告诉玩家**还差几单**。
       * 十一要求："到达终点但订单不足时，明确提示还差多少单。"
       *
       * 用 Game.message（画面中央）而不是飘字 ——
       * 这条提示是"劝退 + 指路"，需要玩家看到，飘字一闪就没了。
       * 但不能一直刷屏（站在终点会每帧触发），所以用 90 帧的节流。 */
      if (Game.coinShortTimer <= 0) {
        Game.coinShortTimer = 90;
        const lack = Game.coinsRequired - Game.coinsTaken;
        Game.message = '订单还差 ' + lack + ' 单，先去把订单收齐';
        Game.messageTimer = 150;
        Sound.coinShort();
      }
    }
  }
  if (Game.coinShortTimer > 0) Game.coinShortTimer--;

  /* ---- 粒子 ---- */
  updateParticles(dt);

  /* ---- 联机：房主把世界状态打包，交给网络层广播 ---- */
  if (Game.mode === 'online' && Net.role === 'host') {
    Net._outState = packWorldState();
  }
}

/* 玩家受伤。
 * @param reason  失败原因（可选）：'hazard' / 'enemy' / 'bomb' …
 *                只有打到 0 血才会用到它 —— 那时会写进 Game.deathReason，
 *                让失败界面能说清"你是怎么死的"。
 *                不给就归到 'hazard'（通用"被机关击中"）。 */
function damagePlayer(p, amount, reason) {
  if (p.invuln > 0) return;
  /* ★ 冲刺无敌帧 ★
   * 需求："冲刺过程附带少量无敌帧"。这是 Celeste 的核心手感之一 ——
   * 玩家能"算准时机冲过尖刺"，而不是只能绕开。
   * 判定用 actInvuln（由 actions.js 在冲刺时置位）。 */
  if (p.actInvuln > 0) return;
  p.hearts -= amount;
  /* ★ E3（第 7 期）：记挨打次数 —— "零差评"神秘订单靠它判断。
   * ⚠️ 放在扣血之后、判死之前，保证"致死的那一下"也算挨打。 */
  if (Game.challengeStats) Game.challengeStats.damageTaken++;
  p.invuln = 60;
  Game.shake = amount > 1 ? 22 : 12;
  Game.screenFlash = 0.6;
  if (p.hearts <= 0) {
    Sound.die();
    Game.state = STATE.GAMEOVER;
    /* ★ C3（2026-10-06 第 1 期）：记下阵亡时的好评率快照 ★
     *   失败页要显示"好评 0%"，用快照读，不依赖 p 还在不在。 */
    Game.playerHeartsAtDeath = Math.max(0, p.hearts);
    Game.playerMaxHeartsAtDeath = p.maxHearts;
    /* 记下死因 —— 优先用调用方给的，没给就算"被机关击中" */
    Game.deathReason = reason || 'hazard';
    Game.message = displayNameOfRole(p.role) + ' 体力耗尽！';
    Game.messageTimer = 99999;
  } else {
    Sound.hurt();
    if (amount < 90) {
      p.vy = -6;
      p.vx = -p.dir * 4;
    }
  }
}

/* ============================================================
 * 机关判定辅助
 * 都用"脚下那一小块"去做检测，而不是整块角色包围盒。
 * 原因：包围盒会提早/拖后触发（人物高 32px，站在格子边缘时身体
 * 已经压到下一格了），用脚部区域最符合直觉。
 * ============================================================ */

/** 取角色脚底的检测区域 */
function footBox(p) {
  return { x: p.x + 4, y: p.y + p.h - 4, w: p.w - 8, h: 8 };
}

/** 角色脚下是否踩着冰面 */
function isOnIce(p, lv) {
  if (!lv.ices || !p.onGround) return false;
  var f = footBox(p);
  for (var i = 0; i < lv.ices.length; i++) {
    if (aabb(f, lv.ices[i])) return true;
  }
  return false;
}

/* ============================================================
 * ★ 天气物理判定（2026-10-06 十一要求：天气改操作手感）★
 * ============================================================
 * 两个"这个天气有没有效果"的查询函数。
 * ⚠️ 统一从 `lv.weather` 读（唯一真相源，见 game.js loadLevel 的搬运逻辑），
 *    不要另外维护一份状态 —— 否则会出现"播报说暴雨、物理还是晴天"。
 *
 * ⚠️ 这两个函数只做**读取**，不改任何东西（纯函数）。
 *    真正改物理的地方在 updatePlaying 的物理段里（集中在一处好调）。
 * ============================================================ */

/** 当前关卡是不是在"暴雨"（地面湿滑） */
function isRainingWeather(lv) {
  return !!(lv && lv.weather === 'rain');
}

/** 当前关卡是不是在"刮大风"（侧向推力） */
function isWindyWeather(lv) {
  return !!(lv && lv.weather === 'wind');
}

/** 当前关卡是不是在"打雷"（定时落雷） */
function isThunderingWeather(lv) {
  return !!(lv && lv.weather === 'thunder');
}

/** 角色脚下是哪条传送带（没有则 null） */
function conveyorUnder(p, lv) {
  if (!lv.conveyors) return null;
  var f = footBox(p);
  for (var i = 0; i < lv.conveyors.length; i++) {
    if (aabb(f, lv.conveyors[i])) return lv.conveyors[i];
  }
  return null;
}

/** 角色脚下是哪块弹簧板（没有则 null） */
function springUnder(p, lv) {
  if (!lv.springs) return null;
  var f = footBox(p);
  for (var i = 0; i < lv.springs.length; i++) {
    if (aabb(f, lv.springs[i])) return lv.springs[i];
  }
  return null;
}

/* ---------------- 机关：断裂桥 ----------------
 * 玩家踩上去 → 抖动 1 秒 → 塌掉（变空气）→ 2.5 秒后恢复。
 *
 * 设计意图：制造"不能停"的压力。
 * 和传送带（逼你顶着推力跑）、冰面（逼你提前刹车）是同一类机关，
 * 但断裂桥的压力最直接：站着不动就掉下去。
 * ------------------------------------------------ */
function updateBridges(lv) {
  if (!lv.bridges) return;
  for (let i = 0; i < lv.bridges.length; i++) {
    const b = lv.bridges[i];
    const solid = findSolidAt(lv, b.x, b.y);
    if (!solid) continue;

    // 同步"塌没塌"到碰撞体上（collectSolids 靠这个字段过滤）
    solid.broken = b.gone;

    if (b.gone) {
      // 已塌 → 等恢复
      if (b.respawn > 0) {
        b.respawn--;
        if (b.respawn === 0) {
          b.gone = false;
          b.pressed = false;
          b.timer = 0;
          b.shake = 0;
          solid.broken = false;
          Sound.bridge();
          spawnSparkle(b.x + 16, b.y + 16);
        }
      }
      continue;
    }

    // 有人站在这块桥上吗（脚底贴着桥顶面）
    let occupied = false;
    for (let j = 0; j < Game.players.length; j++) {
      const p = Game.players[j];
      const foot = { x: p.x + 4, y: p.y + p.h - 3, w: p.w - 8, h: 8 };
      if (aabb(foot, b) && p.vy >= 0) { occupied = true; break; }
    }

    if (occupied && !b.pressed) {
      b.pressed = true;
      b.timer = CONFIG.BRIDGE_DELAY;
      Sound.bridge();
      Game.message = '桥在塌！快跑！';
      Game.messageTimer = 70;
    }

    if (b.pressed) {
      b.shake = Math.min(1, b.shake + 0.12);
      if (b.timer > 0) {
        b.timer--;
        if (b.timer === 0) {
          // 塌
          b.gone = true;
          b.respawn = CONFIG.BRIDGE_RESPAWN;
          solid.broken = true;
          Sound.crash();
          Game.shake = Math.max(Game.shake, 9);
          for (let k = 0; k < 12; k++) {
            Game.particles.push({
              x: b.x + Math.random() * b.w,
              y: b.y + Math.random() * b.h,
              vx: (Math.random() - 0.5) * 3.4,
              vy: Math.random() * 2 + 1,
              life: 40, maxLife: 40,
              color: '#8a6a4a', size: 4, type: 'chunk',
            });
          }
        }
      }
    } else if (b.shake > 0) {
      b.shake = Math.max(0, b.shake - 0.12);
    }
  }
}

/* 在关卡的实心块里找"某个格子位置"对应的那块砖 */
function findSolidAt(lv, x, y) {
  for (let i = 0; i < lv.solids.length; i++) {
    const s = lv.solids[i];
    if (s.x === x && s.y === y) return s;
  }
  return null;
}

/* ---------------- 机关：炸弹 ----------------
 * 玩家碰到 → 点燃引信（约 2 秒）→ 爆炸。
 * 爆炸效果：
 *   · 炸死半径内的敌人
 *   · 炸开半径内的 'b' 可炸墙
 *   · 把半径内的玩家推开（不扣血 —— 扣血会太惩罚，推开就够有反馈）
 *
 * 双人配合的用法：
 *   一个人去点火，另一个人趁机冲过那堵墙的位置；
 *   或者一个人点火后往回跑，另一个人在前方等着接应。
 * ------------------------------------------------ */
function updateBombs(lv) {
  if (!lv.bombs) return;
  for (let i = 0; i < lv.bombs.length; i++) {
    const b = lv.bombs[i];
    if (b.exploded) continue;
    b.flash += 0.34;

    // 点燃判定：任一玩家碰到
    if (!b.lit) {
      for (let j = 0; j < Game.players.length; j++) {
        if (aabb(Game.players[j], b)) {
          b.lit = true;
          b.timer = CONFIG.BOMB_FUSE;
          Sound.fuse();
          Game.message = '引信点燃了！';
          Game.messageTimer = 70;
          break;
        }
      }
      continue;
    }

    // 倒计时 + 冒火星
    if (b.timer > 0) {
      b.timer--;
      if (b.timer % 3 === 0) {
        Game.particles.push({
          x: b.x + b.w / 2 + (Math.random() - 0.5) * 8,
          y: b.y - 4,
          vx: (Math.random() - 0.5) * 1.2,
          vy: -1.2 - Math.random(),
          life: 22, maxLife: 22,
          color: Math.random() < 0.5 ? '#ffd166' : '#ff6b00',
          size: 3, type: 'spark',
        });
      }
      if (b.timer === 0) explodeBomb(lv, b);
    }
  }
}

function explodeBomb(lv, b) {
  b.exploded = true;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const R = CONFIG.BOMB_RADIUS;

  Sound.explode();
  Game.shake = Math.max(Game.shake, 16);
  Game.screenFlash = 0.85;

  // 爆炸粒子
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
    const sp = 2.4 + Math.random() * 3.6;
    Game.particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6,
      life: 30 + Math.floor(Math.random() * 16),
      maxLife: 46,
      color: ['#fff3b0', '#ffd166', '#ff6b00', '#d63c3c'][i % 4],
      size: 5, type: 'spark',
    });
  }
  Game.particles.push({
    x: cx, y: cy, vx: 0, vy: 0,
    life: 22, maxLife: 22,
    color: 'rgba(255,180,60,0.6)', size: 10, type: 'ring',
    maxR: R * 0.9,
  });

  // 炸死敌人
  for (let i = 0; i < lv.enemies.length; i++) {
    const en = lv.enemies[i];
    if (en.dead) continue;
    if (distPointRect(cx, cy, en) <= R) {
      en.dead = true;
      spawnDust(en.x + en.w / 2, en.y, 10);
      addScorePop(en.x, en.y);
    }
  }

  // 炸开可炸墙
  for (let i = 0; i < lv.solids.length; i++) {
    const s = lv.solids[i];
    if (!s.destructible || s.broken) continue;
    if (distPointRect(cx, cy, s) <= R) {
      s.broken = true;
      for (let k = 0; k < 6; k++) {
        Game.particles.push({
          x: s.x + Math.random() * s.w,
          y: s.y + Math.random() * s.h,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 2.6,
          life: 34, maxLife: 34,
          color: '#9a9aa4', size: 4, type: 'chunk',
        });
      }
    }
  }

  // 把玩家推开（不扣血）
  for (let i = 0; i < Game.players.length; i++) {
    const p = Game.players[i];
    const dx = (p.x + p.w / 2) - cx;
    const dy = (p.y + p.h / 2) - cy;
    const d = Math.max(1, Math.hypot(dx, dy));
    if (d <= R + 30) {
      const f = (1 - d / (R + 30));
      p.vx += (dx / d) * CONFIG.BOMB_KNOCKBACK * f * 1.6;
      p.vy = Math.min(p.vy, -CONFIG.BOMB_KNOCKBACK * f * 1.5);
      p.stun = CONFIG.BOMB_STUN;
      p.onGround = false;
    }
  }
}

/* 点到矩形的最近距离（圆心到方块的"贴脸距离"） */
function distPointRect(px, py, r) {
  const nx = Math.max(r.x, Math.min(px, r.x + r.w));
  const ny = Math.max(r.y, Math.min(py, r.y + r.h));
  return Math.hypot(px - nx, py - ny);
}

/* ---------------- 机关：跷跷板 ----------------
 * 一块绕中心支点转的板子。谁重就往谁那边沉。
 * 双人配合的核心用法：
 *   · 一个骑手站一端（沉下去），另一端翘起来
 *   · 另一个骑手跳上翘起的那端 → 被"弹射"到高处
 * 所以它是"一个人当配重、另一个人借力上天"的机关。
 *
 * 实现要点：
 *   1. 每帧统计板子两侧（左/右）各有多少玩家重量
 *   2. 重量差 → 角加速度 → 更新倾角
 *   3. 站在板上的玩家，位置要跟着板面高度走（不然会陷进去）
 *   4. 从"正在上升的一端"跳起时给一个垂直加成（借力弹射）
 * ------------------------------------------------ */
function updateSeesaws(lv) {
  if (!lv.seesaws) return;
  for (let i = 0; i < lv.seesaws.length; i++) {
    const s = lv.seesaws[i];

    /* ---- 1) 找出板上的玩家，以及各自在哪一端 ----
     *
     * ⚠️ 这里不用"比重量"（早期版本用左右人数差当扭矩，结果发现：
     *    两个角色重量完全相同，两人各站一端时扭矩恒为 0，
     *    板子永远翘不起来 —— 也就没法做"配重弹射"，双人配合根本立不住)。
     *
     * 改成"踩下即压沉"：只要有人站在某一端，那一端就往下沉。
     * 沉下去 → 另一端抬起 → 站在抬起端的人被弹飞。
     * 这样双人配合的用法才成立：
     *   甲站左端（把左端压沉）→ 乙站右端被抬起来抛向高处。
     */
    let leftSomeone = false, rightSomeone = false;
    const riders = [];
    for (let j = 0; j < Game.players.length; j++) {
      const p = Game.players[j];
      const foot = { x: p.x + 4, y: p.y + p.h - 3, w: p.w - 8, h: 10 };
      if (!onSeesaw(s, foot)) continue;
      const rel = (p.x + p.w / 2) - s.cx;
      riders.push({ p: p, rel: rel });
      if (rel < 0) leftSomeone = true; else rightSomeone = true;
    }

    /* ---- 1.5) ★ 单机版跷跷板（2026-10-06 新增）★ ----
     * ------------------------------------------------------------
     * 十一要求："将跷跷板改成单机版跷跷板"。
     *
     * 双人版的原理：甲压左端 → 左端沉、**右端抬** → 站在右端的乙被弹飞。
     * 单人时问题很明显：只有一个人，他站在哪端、哪端就沉，
     * **被抬起的那一端根本没人**，所以永远弹不到自己，
     * 板子只是徒劳地上下晃。
     *
     * 单机版的做法（保留"翘起来再弹出去"的物理直觉）：
     *   一个人在板上时，判定顺序反过来 ——
     *   先让他**把远端压沉**（像踩跷跷板一样蹬下去），
     *   然后本端翘起时，把**他自己**弹出去。
     *   视觉上就是"他往下一蹬、自己被翘起来"，
     *   和真实的跷跷板一个人玩时的感觉一致（蹬地起跳）。
     *
     * 实现：单人时把 targetAngle 设为"远端沉"，
     *       这样本端会抬起；弹射判定里把 rider 自己算作"正在被抬起"。
     * ------------------------------------------------------------ */
    const singleRider = (Game.playerCount === 1 && riders.length === 1);

    // ---- 2) 目标角度：有人压哪端，哪端就沉 ----
    // 正角度 = 右端下沉
    let targetAngle = 0;
    if (leftSomeone && !rightSomeone) targetAngle = -CONFIG.SEESAW_MAX_ANGLE;   // 只有左边有人 → 左沉
    else if (rightSomeone && !leftSomeone) targetAngle = CONFIG.SEESAW_MAX_ANGLE; // 只有右边有人 → 右沉
    // 两端都有人 → 保持平衡（targetAngle = 0）

    /* ★ 单机版：把目标角度**取反** —— 让玩家所在的那一端翘起来。
     *   一个人站左端 → 本来 targetAngle = -MAX（左沉），
     *   取反成 +MAX（左端抬起）→ 玩家会被自己翘起来弹飞。 */
    if (singleRider) targetAngle = -targetAngle;

    /* 角度朝目标值移动（弹簧式逼近，带阻尼 → 有点"重量感"但不迟钝）。
     * 用差值驱动而不是直接赋值，这样板子翻转时有过程，玩家能看清发生了什么。 */
    s.angVel += (targetAngle - s.angle) * CONFIG.SEESAW_TORQUE;
    s.angVel *= CONFIG.SEESAW_ANG_DAMP;
    s.angle += s.angVel;
    if (s.angle > CONFIG.SEESAW_MAX_ANGLE) { s.angle = CONFIG.SEESAW_MAX_ANGLE; s.angVel = 0; }
    if (s.angle < -CONFIG.SEESAW_MAX_ANGLE) { s.angle = -CONFIG.SEESAW_MAX_ANGLE; s.angVel = 0; }

    /* ---- 2.5) 弹射：站在"正在抬起的那一端"的人会被抛出去 ----
     *
     * 判定：本帧板子在朝"抬起这一端"的方向转，且转得够快。
     * 抬右端 = 角度在减小（从正走向负）；抬左端 = 角度在增大。
     * 给一个向上的速度，大小随角速度增加 —— 翻得越快，抛得越高。
     */
    for (let k = 0; k < riders.length; k++) {
      const p = riders[k].p;
      if (p.launchCooldown > 0) { p.launchCooldown--; continue; }
      /* 判定"这一端是不是正在抬起"。
       * 抬右端 = 角度在减小（从正走向负）；抬左端 = 角度在增大。
       *
       * ★ 单机版：玩家所在的那一端就是"正在抬起"的那一端（自己翘自己），
       *   所以判定条件同样成立 —— 走的是同一套代码，不用特判。 */
      const wantUp = (riders[k].rel < 0 && s.angVel > 0) ||   // 在左端，左端正在抬起
        (riders[k].rel > 0 && s.angVel < 0);                  // 在右端，右端正在抬起
      if (!wantUp || p.vy < -6) continue;                     // 已经在上升就不要重复弹
      const rate = Math.min(1, Math.abs(s.angVel) / 0.035);
      if (rate < 0.22) continue;                              // 转得太慢，不弹（避免抖动误触）
      /* 弹射力度：直接给接近满力的 SEESAW_LAUNCH_POWER。
       *
       * 踩过的坑：一开始写成 `POWER * (0.55 + 0.45*rate)`，
       * 结果刚刚越过阈值时只给到 0.71 倍 ≈ vy -11.7，
       * 只比普通跳跃（-11.2）高一点点 —— 弹射完全没意义，玩家根本够不到高台。
       * 现在改成 0.88 起步（rate 只做小幅微调），保证"被弹飞"的感觉足够强烈。 */
      const boost = CONFIG.SEESAW_LAUNCH_POWER * (0.88 + 0.12 * rate);
      p.vy = boost;
      p.onGround = false;
      p.jumpsLeft = CONFIG.MAX_JUMPS;      // 弹起来后仍然保留二连跳，手感更宽裕
      p.jumpCutEligible = false;           // 这是机关弹射，不该被"松键截断"削掉
      p.launchCooldown = 24;
      p.squash = 0.74;
      Sound.spring();
      spawnDoubleJumpRing(p.x + p.w / 2, p.y + p.h);
      spawnDust(p.x + p.w / 2, p.y + p.h, 8);
    }

    // ---- 3) 站在板上的玩家跟着板面走 ----
    for (let k = 0; k < riders.length; k++) {
      const p = riders[k].p;
      const surfaceY = seesawSurfaceY(s, p.x + p.w / 2);
      const targetBottom = surfaceY;
      const curBottom = p.y + p.h;
      // 只把玩家"抬上来"，不硬压下去（压下去会穿模）
      if (curBottom > targetBottom && curBottom - targetBottom < 26) {
        p.y = targetBottom - p.h;
        if (p.vy > 0) p.vy = 0;
      }
      // 记录"我站在哪一端"，供外部判定
      p._seesawEnd = ((p.x + p.w / 2) - s.cx) < 0 ? 'left' : 'right';
      p._seesaw = s;
    }
    for (let j = 0; j < Game.players.length; j++) {
      const p = Game.players[j];
      const isRider = riders.some(function (r) { return r.p === p; });
      if (!isRider) { p._seesaw = null; p._seesawEnd = null; }
    }

    s.riders = riders.length;
  }
}

/* 判断某个脚部矩形是否踩在这块跷跷板上
 *
 * 容差要放得比较宽，原因：板子会倾斜，倾斜后"板面在玩家脚下那个 x 处的高度"
 * 变化很大（最大倾角时两端相差 ±19px）。
 * 如果容差太紧，板子一翘玩家就和板面脱开判定，出现"站在板上却不动"的假死。
 */
function onSeesaw(s, foot) {
  if (foot.x + foot.w <= s.cx - s.halfLen || foot.x >= s.cx + s.halfLen) return false;
  const y = seesawSurfaceY(s, foot.x + foot.w / 2);
  const bottom = foot.y + foot.h;
  // 脚底在板面上下 18px 以内都算"站在板上"
  return bottom >= y - 18 && bottom <= y + 18;
}

/* 板子在某个 x 处的台面高度 */
function seesawSurfaceY(s, x) {
  const dx = x - s.cx;
  return s.cy + Math.sin(s.angle) * dx;
}

/* 跷跷板借力弹射（主动跳的那一侧）
 *
 * 与"被动被弹飞"（updateSeesaws 里做的）不同：这里处理的是
 * 玩家自己站在抬起端按下跳跃键的情况 —— 在正在抬起的板面上起跳，
 * 相当于顺着板子的力道起跳，能跳得更高。
 *
 * 判定：起跳瞬间，板子正在朝"抬起我这一端"的方向转。
 */
function applySeesawBoost(p) {
  const s = p._seesaw;
  if (!s || !p._seesawEnd) return;

  // 抬右端 = 角度在减小；抬左端 = 角度在增大
  const onRisingEnd = (p._seesawEnd === 'right' && s.angVel < 0) ||
    (p._seesawEnd === 'left' && s.angVel > 0);
  if (!onRisingEnd) return;

  const rate = Math.min(1, Math.abs(s.angVel) / 0.055);
  if (rate < 0.28) return;      // 板子转得太慢，不算借到力

  const mul = 1 + (CONFIG.SEESAW_LAUNCH_MUL - 1) * rate;
  p.vy *= mul;

  Sound.spring();
  spawnDoubleJumpRing(p.x + p.w / 2, p.y + p.h);
  spawnDust(p.x + p.w / 2, p.y + p.h, 8);
}

/* ---------------- 敌人：跳跳怪 ----------------
 * 原地周期起跳，落地再弹，一边跳一边缓慢左右漂移（撞到漂移边界就回头）。
 * 比巡逻怪难躲 —— 因为它是"跳过来"而不是"走过来"，玩家得算抛物线。
 *
 * ⚠️ 重力不要在这里加！moveAndCollide 内部已经处理了垂直运动（含重力）。
 *    踩过这个坑：这里又加了一次重力，导致上升速度被双倍衰减，
 *    跳起来只有 31px（应该 ~71px），看起来像"原地抖了一下"。
 * ------------------------------------------------ */
function updateHopper(en, lv, solids) {
  en.animT += 0.1;

  // 水平漂移（撞边界回头）
  en.x += en.vx;
  if (en.x < en.driftLeft) { en.x = en.driftLeft; en.vx = Math.abs(en.vx); }
  if (en.x > en.driftRight - en.w) { en.x = en.driftRight - en.w; en.vx = -Math.abs(en.vx); }

  // 垂直 + 碰撞：全部交给 moveAndCollide（它内部会加重力）
  const hit = moveAndCollide(en, solids);

  if (hit.onGround) {
    // 落地 → 蓄力后起跳
    if (en.hopTimer > 0) {
      en.hopTimer--;
    } else {
      en.vy = en.hopPower;
      en.hopTimer = 42 + Math.floor(Math.random() * 18);
      en.vx = en.drift * 0.55;
      spawnDust(en.x + en.w / 2, en.y + en.h, 4);
    }
  }
}

/* ---------------- 粒子 ---------------- */
function spawnDust(x, y, n) {
  for (let i = 0; i < n; i++) {
    Game.particles.push({
      x: x + (Math.random() - 0.5) * 18,
      y: y - Math.random() * 6,
      vx: (Math.random() - 0.5) * 2.4,
      vy: -Math.random() * 1.6,
      life: 22 + Math.random() * 14,
      maxLife: 36,
      color: '#d8cdb4',
      size: 3 + Math.random() * 3,
      type: 'dust',
    });
  }
}
/* ============================================================
 * ★ 卡皮巴拉专属起跳尘土（2026-10-06 新增）★
 * ============================================================
 * 十一要求："要有他的独特跳跃动作。"
 *
 * 通用的 spawnDust 是"向上飘的浅色尘"（轻盈、敏捷）。
 * 卡皮巴拉是"憨、重、圆"—— 所以它的尘土要**横向铺开、更矮更沉**：
 *   · 速度以水平为主（0.5~2.6 横，几乎不向上）
 *   · 颜色更暗（#b9ab8e，比通用尘暗一档）
 *   · 寿命更长（落下去慢，像真的扬起来一层土）
 *
 * ⇒ 三个角色站在一起跳：袋鼠飞快、飞龙轻巧、卡皮巴拉"咚"地扬起一圈土。
 * ⚠️ 纯表现，不影响物理和关卡可行性。
 */
function spawnHeavyDust(x, y, n) {
  for (let i = 0; i < (n || 8); i++) {
    const dir = i % 2 === 0 ? 1 : -1;          // 左右对称铺开
    Game.particles.push({
      x: x + (Math.random() - 0.5) * 16,
      y: y - Math.random() * 3,
      vx: dir * (0.5 + Math.random() * 2.1),   // 横向为主
      vy: -Math.random() * 0.7,                // 几乎不向上
      life: 26 + Math.random() * 16,
      maxLife: 42,
      color: '#b9ab8e',                        // 更暗、更"土"
      size: 3.5 + Math.random() * 3,
      type: 'dust',
    });
  }
}

/* ★ 史迪奇宝宝专属起跳尘土（2026-10-06）★
 * ============================================================
 * 定位与卡皮巴拉相反：卡皮巴拉是"咚"地扬起一圈横铺的土（憨重），
 * 史迪奇是"嗖"地窜起 —— 所以它的尘土**向上斜飞、更小更快、偏蓝**，
 * 像小怪物蹬地时迸出的碎屑。
 * ⚠️ 纯表现，不影响物理和关卡可行性。
 */
function spawnBurstDust(x, y, n) {
  for (let i = 0; i < (n || 6); i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    Game.particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y - Math.random() * 4,
      vx: dir * (0.8 + Math.random() * 1.4),   // 略横向
      vy: -(1.2 + Math.random() * 1.6),        // ★ 向上斜飞（和卡皮巴拉相反）
      life: 16 + Math.random() * 10,           // 消散更快
      maxLife: 26,
      color: '#8fc4e8',                        // 偏蓝（呼应史迪奇蓝）
      size: 2.5 + Math.random() * 2,
      type: 'dust',
    });
  }
}

function spawnSparkle(x, y) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    Game.particles.push({
      x: x, y: y,
      vx: Math.cos(a) * 2.6, vy: Math.sin(a) * 2.6,
      life: 26, maxLife: 26,
      color: '#ffe89a', size: 4, type: 'spark',
    });
  }
}

/* ============================================================
 * ★★ 「十一」专属：移动拖尾 —— 小蛋糕痕迹（2026-10-07）★★
 * ============================================================
 * 十一原话："要做一个移动拖尾，就是十一经过的时候，
 *           会留下小蛋糕的样子，然后过两三秒就会消失。"
 *
 * 【实现】
 *   在地上留一枚迷你纸杯蛋糕（render.js 的 `dessert` 粒子类型），
 *   **原地不动**、2.4 秒淡出（`life` = 144 帧 @60fps ≈ 2.4s）。
 *
 * 【⚠️ 为什么必须限流】
 *   如果"每帧都留一枚"，跑 3 秒就是 180 枚粒子 —— 卡顿 + 满地都是。
 *   ⇒ 用 `p._dessertGap` 做**冷却计数器**，每 14 帧（约 0.23 秒）才留一枚，
 *     这样一串痕迹的间距刚好，跑起来像"撒了一路小蛋糕"。
 *
 * 【⚠️ 只在她真的在动的时候留】
 *   站着不动不该留痕迹（否则原地会堆成一坨）。
 *
 * ⚠️ 纯表现，不参与物理、不影响关卡可行性。
 * @param p 玩家对象
 * ============================================================ */
function spawnDessertTrail(p) {
  try {
    if (!p) return;
    /* 冷却：每 14 帧才留一枚 */
    if (p._dessertGap > 0) { p._dessertGap--; return; }
    p._dessertGap = 14;

    /* 留的位置：脚下稍微靠后（"经过"的感觉） */
    const back = (p.dir < 0 ? 1 : -1) * (8 + Math.random() * 8);
    const cx = p.x + p.w / 2 + back;
    const cy = p.y + p.h - 3;

    /* 尺寸/角度用**确定性哈希**（按位置算）——
     * 绝不能用 Math.random 存进粒子里，否则每帧重画会疯狂抖。 */
    const seed = (Math.round(cx) * 73856093) ^ (Math.round(cy) * 19349663);
    const r0 = ((seed >>> 0) % 1000) / 1000;
    const r1 = ((seed >>> 9) % 1000) / 1000;

    Game.particles.push({
      x: cx,
      y: cy,
      vx: 0, vy: 0,                        // ★ 原地不动
      life: 144,                           // ≈ 2.4 秒
      maxLife: 144,
      size: 6 + r0 * 2.6,
      angle: (r1 - 0.5) * 0.5,             // 轻微歪一点，更自然
      type: 'dessert',
      /* 配色轮换：三种甜品色，让拖尾有层次 */
      cupColor: ['#F2A8C8', '#F8C8DC', '#E9A6D8'][Math.floor(r0 * 3) % 3],
      creamColor: '#FFF3E4',
      cherryColor: '#E84A6F',
    });
  } catch (e) { /* 拖尾是纯表现，出错不能影响游戏 */ }
}

/* ============================================================
 * ★★ 「噜噜」专属：移动拖尾 —— **橘子**痕迹（2026-10-07）★★
 * ============================================================
 * 十一原话："还有橘子拖尾，然后两秒消失的那种。"
 *           "橘子拖尾要跟你本身的速度匹配哦。"
 *
 * ------------------------------------------------------------
 * 【⚠️⚠️ 核心：按"移动距离"发，不按"时间"发】
 *   十一特意强调了"拖尾要跟速度匹配"，这正是不该用固定时间间隔的原因：
 *
 *   · 固定时间（比如每 12 帧一枚）：
 *       跑得快(vx=8) → 每枚间隔 8×12 = 96px，拖尾**稀稀拉拉像断线的珠子**
 *       走得慢(vx=2) → 每枚间隔 2×12 = 24px，拖尾**挤成一坨**
 *     ⇒ 同一关里速度一变，拖尾疏密就乱掉，很不自然。
 *
 *   · 按距离（本实现）：
 *       每走 `GAP` 像素留一枚 ⇒ 无论快慢，**空间间距恒定**，
 *       看起来就是"我走过的这条路"，速度感天然正确。
 *
 * ------------------------------------------------------------
 * 【为什么不复用 spawnDessertTrail 的冷却计数器】
 *   dessert 是"每 14 帧一枚"（时间间隔）—— 那是给「十一」用的，
 *   同样有上面说的问题。但那是已交付的东西，**我不动它**（改了要重测）。
 *   噜噜用距离方案，并把这个区别写在这里，以后要统一时有个参照。
 *
 * ⚠️ 寿命 120 帧 = 正好 **2 秒**（十一指定的）。
 * ⚠️ 纯表现，不参与物理。
 * @param p 玩家对象
 * ============================================================ */
const ORANGE_TRAIL_GAP = 26;          // 每走多少像素留一枚（≈角色宽度的 1/4）

function spawnOrangeTrail(p) {
  try {
    if (!p) return;
    const cx = p.x + p.w / 2;
    /* 第一次（或刚重置）→ 记下起点，不留痕迹（否则原地会先冒一枚） */
    if (typeof p._orangeLastX !== 'number' || !isFinite(p._orangeLastX)) {
      p._orangeLastX = cx;
      return;
    }
    /* 还没走够 GAP 像素 → 这帧不留 */
    if (Math.abs(cx - p._orangeLastX) < ORANGE_TRAIL_GAP) return;
    p._orangeLastX = cx;

    /* 留的位置：脚下稍后一点（"经过"的感觉） */
    const back = (p.dir < 0 ? 1 : -1) * (6 + (cx % 7));
    const ox = cx + back;
    const oy = p.y + p.h - 3;

    /* ⚠️ 确定性哈希定位（按坐标算）——
     *    绝不能用 Math.random 存进粒子，否则每帧重画会疯狂抖。 */
    const seed = (Math.round(ox) * 73856093) ^ (Math.round(oy) * 19349663);
    const r0 = ((seed >>> 0) % 1000) / 1000;
    const r1 = ((seed >>> 9) % 1000) / 1000;

    Game.particles.push({
      x: ox,
      y: oy,
      vx: 0, vy: 0,                     // ★ 原地不动（留在地上）
      life: 120,                        // ★ 120 帧 @60fps = **正好 2 秒**
      maxLife: 120,
      size: 5.5 + r0 * 2.2,
      angle: (r1 - 0.5) * 0.6,          // 轻微歪，更自然
      type: 'orange',                   // ★ 新的粒子类型（render.js 里画）
      /* 配色：橘子橙 / 浅橙 / 偏红的橘，三种轮换有层次 */
      peelColor: ['#FFA726', '#FFB74D', '#FB8C00'][Math.floor(r0 * 3) % 3],
    });
  } catch (e) { /* 拖尾是纯表现，出错不能影响游戏 */ }
}

/* ============================================================
 * 二连跳特效（v2 — 强化反馈）
 * ============================================================
 * 设计目标：让二连跳"一眼就能看出发生了"。
 *
 * 三件套：
 *   1. 双层扩散环（内层亮白、外层淡蓝）—— 有爆发感
 *   2. 放射状速度线 —— 表现"向上弹射"的力
 *   3. 四角星芒 —— 增加魔法感/明确感
 *
 * 为什么不做成粒子堆叠（几十个粒子）：
 *   粒子多了在低端机上掉帧，而且视觉上会糊成一团。
 *   用少量"结构化"的图形（环 + 线 + 星芒）更清晰、更省性能。
 * ============================================================ */
function spawnDoubleJumpRing(x, y) {
  /* 1) 内层环：亮白，扩散快、消失快 */
  Game.particles.push({
    x: x, y: y,
    vx: 0, vy: 0,
    life: 18, maxLife: 18,
    color: '#ffffff',
    size: 6,
    type: 'ring',
    maxR: 30,
    lineW: 3.5,
  });
  /* 2) 外层环：淡蓝，扩散慢、范围大，做出"冲击波"的层次 */
  Game.particles.push({
    x: x, y: y,
    vx: 0, vy: 0,
    life: 30, maxLife: 30,
    color: '#8fd4ff',
    size: 8,
    type: 'ring',
    maxR: 46,
    lineW: 2.2,
  });
  /* 3) 放射速度线：向上为主，表现弹射方向 */
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i - 2.5) * 0.42;   // 朝上扇开
    Game.particles.push({
      x: x + Math.cos(a) * 8,
      y: y + Math.sin(a) * 8,
      vx: Math.cos(a) * 4.2,
      vy: Math.sin(a) * 4.2,
      life: 16, maxLife: 16,
      color: '#cdefff',
      size: 4,
      type: 'streak',
      angle: a,
    });
  }
  /* 4) 四角星芒：斜向的短十字，增加"炸开"的明确感 */
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i - 1.5) * 1.05;
    Game.particles.push({
      x: x + Math.cos(a) * 14,
      y: y + Math.sin(a) * 14,
      vx: Math.cos(a) * 1.6,
      vy: Math.sin(a) * 1.6,
      life: 22, maxLife: 22,
      color: '#fff3b0',
      size: 5,
      type: 'star',
      angle: a,
    });
  }
  /* 5) 轻微屏幕震动：非常轻（2px），只为"体感"上一顿，
   *    不做大是怕影响操作精度 */
  Game.shake = Math.max(Game.shake, 2);
}

/* 一段跳特效：比二连跳朴素（只有薄环 + 小尘），
 * 这样两者对比明显 —— 玩家一眼能分出"我跳到第二下了"。 */
function spawnSingleJumpRing(x, y) {
  Game.particles.push({
    x: x, y: y,
    vx: 0, vy: 0,
    life: 14, maxLife: 14,
    color: '#e8f4ff',
    size: 5,
    type: 'ring',
    maxR: 20,
    lineW: 2,
  });
}
/* ============================================================
 * 蓄力踩怪特效（按住下键踩敌人时触发）
 * ============================================================
 * 要比普通踩怪"重"得多 —— 玩家要立刻意识到"我使出了大招"。
 *
 * 表现：
 *   · 橙金色冲击环（暖色 = 力量感，和跳跃的冷蓝区分开）
 *   · 向下溅射的碎屑（表现"我把它踩扁了"的反作用力）
 *   · 大范围星芒
 *   · 明显一点的屏幕震动
 * ============================================================ */
function spawnStompSuperEffect(x, y) {
  /* 1) 双层橙金冲击环 */
  Game.particles.push({
    x: x, y: y, vx: 0, vy: 0,
    life: 20, maxLife: 20,
    color: '#fff0a8', size: 8, type: 'ring', maxR: 40, lineW: 4,
  });
  Game.particles.push({
    x: x, y: y, vx: 0, vy: 0,
    life: 34, maxLife: 34,
    color: '#ff9a3c', size: 10, type: 'ring', maxR: 60, lineW: 2.6,
  });
  /* 2) 向下溅射的碎屑：表现"向下发力"（和跳跃的向上速度线相反） */
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 2 + (i - 3.5) * 0.4;    // 朝下扇开
    Game.particles.push({
      x: x + Math.cos(a) * 6,
      y: y + Math.sin(a) * 6,
      vx: Math.cos(a) * 5.0,
      vy: Math.sin(a) * 5.0,
      life: 18, maxLife: 18,
      color: '#ffd98a', size: 4, type: 'streak', angle: a,
    });
  }
  /* 3) 大范围星芒 */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    Game.particles.push({
      x: x + Math.cos(a) * 20,
      y: y + Math.sin(a) * 20,
      vx: Math.cos(a) * 2.2,
      vy: Math.sin(a) * 2.2,
      life: 24, maxLife: 24,
      color: '#fff3b0', size: 6, type: 'star', angle: a,
    });
  }
  /* 4) 屏幕震动比二连跳更明显（4px vs 2px） */
  Game.shake = Math.max(Game.shake, 4);
}

function addScorePop(x, y) {
  Game.particles.push({
    x: x, y: y, vx: 0, vy: -1.1, life: 40, maxLife: 40,
    color: '#ffffff', size: 0, type: 'text', text: '+100',
  });
}

/* 通用飘字（拾取订单、吃到东西等即时反馈用）。
 *
 * 为什么单独抽一个函数，而不是到处 push 粒子：
 *   1. 飘字是**最频繁**的反馈（每捡一单一次），
 *      参数写错（比如误加了重力）会导致字往下掉，很难看
 *   2. 统一控制"上飘速度 / 存活帧数 / 颜色"，全项目观感一致
 *
 * @param x,y   世界坐标（粒子在渲染时会被相机变换，不用自己换算）
 * @param text  显示的文本，例如 "订单 +1"
 * @param color 可选，默认美团黄
 */
function spawnFloatText(x, y, text, color) {
  Game.particles.push({
    x: x, y: y,
    vx: 0, vy: -1.3,          // 直着往上飘（type='text' 不受重力，见 updateParticles）
    life: 44, maxLife: 44,
    color: color || '#FFD100',
    size: 0, type: 'text', text: text,
  });
}
function updateParticles(dt) {
  for (let i = Game.particles.length - 1; i >= 0; i--) {
    const p = Game.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    /* 不受重力的类型：
     *   text    —— 计分飘字（要直着往上飘）
     *   ring    —— 冲击波环（原地扩散）
     *   streak  —— 速度线（直线射出，被重力拉歪就不像"速度"了）
     *   star    —— 星芒（光芒不该掉下来）
     *   dessert —— ★「十一」的小蛋糕痕迹（留在原地当地上的印记，
     *              飘走就不像"经过留下的痕迹"了）
     *   orange  —— ★「噜噜」的橘子痕迹（同上，留在原地）
     * 其余（dust / spark 等碎屑）受重力，才有"落下"的实感。 */
    if (p.type !== 'text' && p.type !== 'ring' &&
        p.type !== 'streak' && p.type !== 'star' &&
        p.type !== 'dessert' && p.type !== 'orange') {
      p.vy += 0.14;
    }
    p.life--;
    if (p.life <= 0) Game.particles.splice(i, 1);
  }
}
