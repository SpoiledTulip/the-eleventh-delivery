/* ============================================================
 * ui.js — HTML 浮层界面
 * ============================================================
 * 设计说明（重要）：
 *   所有菜单/按钮/输入框都用真正的 HTML 元素，不用 canvas 自绘。
 *   理由：
 *     1. 鼠标点击行为由浏览器保证，不用自己算坐标做命中检测
 *     2. 输入框能直接粘贴（Ctrl+V）、能调起输入法
 *     3. 复制房间码能直接用浏览器剪贴板 API
 *   画布只负责画游戏本身；界面是一次性建好 DOM，靠显隐切换，
 *   不做"每帧重建 DOM"（那样会闪烁且吃性能）。
 * ============================================================ */

const UI = {
  root: null,       // #ui 容器
  panel: null,      // 当前面板（只建一次，之后只改内容/显隐）
  lastKey: '',      // 上一次同步用的状态指纹，避免重复重建
  /* 角色解锁界面正在显示哪个角色。
   * 放在 UI 上而不是 Game 上，是因为它纯粹是"界面状态"——
   * 游戏逻辑不需要知道。 */
  unlockCharId: '',
  /* 清除存档的二次确认状态。
   * 十一明确要求"清除存档前必须二次确认，不能误触直接清除"。
   * 用两段式按钮：第一次点变成"真的清除？"，再点才执行。 */
  resetConfirm: false,

  /* ★ 👤 账号：正在登录哪个账号（选账号页 → 输密码页之间传值）★
   * 放在 UI 上而不是 Game 上 —— 这是纯界面状态，游戏逻辑不需要知道。
   * 存的是账号 id（不是名字）：名字可以重复输入、id 是唯一的。 */
  loginTargetId: null,

  /* ★ 账号：删除账号的二次确认状态（和清档一样要防误触）★ */
  deleteConfirmId: null,

  /* ★ 账号：退出登录的二次确认（防误触）★ */
  logoutConfirm: false,

  /* ★ 账号：正在删除哪个账号（弹窗期间用）★ */
  deleteAccountName: '',
};

/* ============================================================
 * ★ 游戏标题（唯一真相源）★
 * ============================================================
 * 2026-10-06 十一要求："将游戏名称由『外卖双人组』统一更改为
 * 『第十一单外卖』，涵盖项目文件夹名、游戏内标题及各处相关名称。"
 * 2026-10-07 十一再次改名为 **『第十一单外卖』**（"每个地方都换"）。
 *
 * ⚠️ 所有显示游戏名的地方都必须读这个常量，**不要**再各处硬编码：
 *     · 启动画面大标题
 *     · 主菜单标题
 *     · canvas 背景大标题（render.js）
 *     · index.html 的 <title>
 *     · 单文件版的文件名（tools/build-single.js）
 *   改一次名字，全站跟着变。
 * ============================================================ */
const GAME_TITLE = '第十一单外卖';

function initUI() {
  UI.root = document.getElementById('ui');
  if (!UI.root) return;
  UI.root.innerHTML = '';
  UI.root.addEventListener('click', function (e) {
    // 点空白处不穿透到画布
    if (e.target === UI.root) e.stopPropagation();
  });
}

/* 把 UI 关掉（进入游戏时用） */
function hideUI() {
  if (!UI.root) return;
  UI.root.classList.remove('on');
  UI.root.innerHTML = '';
  UI.panel = null;
  UI.lastKey = '';
}

/* ============================================================
 * 开始一局游戏（所有"点一下就开始"的入口都走这里）
 *
 * ⚠️ 为什么要有这个函数，而不是直接调 loadLevel()：
 *
 *   菜单浮层是靠 `setInterval(syncUI, 100)` 每 100ms 检查一次状态来显隐的。
 *   如果点击后只调 loadLevel()（把 state 改成 playing），
 *   浮层要等**下一次 syncUI 才会消失**——也就是说，点完之后
 *   那几张关卡卡片还会盖在画面上最多 100ms。
 *
 *   更糟的是：浏览器在标签页切到后台时会**节流定时器**（可能降到 1 秒一次），
 *   这时点完关卡，卡片会明显"赖"在屏幕上，玩家看起来就像"点不动、卡住了"。
 *   （这正是被玩家反馈的问题。）
 *
 *   所以：**点击后立刻隐藏浮层，不要等定时器。**
 * 还要顺手把 lastKey 清掉，保证下次进菜单一定会重建（而不是因为 key 相同被跳过）。
 * ============================================================ */
function startGame(levelIndex, opts) {
  hideUI();
  UI.lastKey = '';

  /* ============================================================
   * ★★ PK 状态的唯一设置点（2026-10-06 修"泄漏"bug）★★
   * ============================================================
   * 【十一反馈】"普通开始跑单就变成 AI 赛跑了"
   *
   *   根因：`Game.aiRoles` 只在少数入口被清空，而"开始跑单"没清 →
   *   玩完 PK 之后残留的 aiRoles 让普通模式也变成 AI 赛跑。
   *
   * 【修法：让 startGame 成为唯一的真相设置点】
   *   所有模式的启动最终都走 startGame（包括 PK —— 它也是调这个）。
   *   所以在这里根据 `opts.pk` 决定：
   *     · opts.pk 为真 → 这一局是 PK
   *     · 否则 → **无条件清掉所有 PK 状态**
   *
   *   ⇒ "忘了清"这件事从此不可能发生 —— 因为**不需要任何入口去清**。
   * ============================================================ */
  const pkOpts = opts || {};
  if (pkOpts.pk) {
    Game.isPk = true;
    Game.aiRoles = Array.isArray(pkOpts.aiRoles) ? pkOpts.aiRoles.slice() : null;
    Game.pkResult = null;
    Game.pkMyRole = pkOpts.myRole || null;
    Game.pkLevelIndex = (typeof pkOpts.pkLevelIndex === 'number') ? pkOpts.pkLevelIndex : 0;
  } else {
    /* ★ 非 PK：把上一局的 PK 残留彻底清掉 ★ */
    Game.isPk = false;
    Game.aiRoles = null;
    Game.pkResult = null;
    Game.pkMyRole = null;
    Game.pkLevelIndex = null;
    try {
      if (typeof InputState !== 'undefined' && InputState.clearAI) InputState.clearAI();
    } catch (e) { /* 清理失败不该拦住开局 */ }
  }

  /* ============================================================
   * ★ E1：进关前先插播"气象播报过场"（2026-10-06 第 5 期）★
   * ============================================================
   * 方案：气象播报是天气系统的"落地入口" ——
   *   天气不是凭空来的，是**预报出来的**。
   *   所以顺序是：选完角色 → 播报天气 → 开始跑单。
   *
   * 【哪些情况不播报】
   *   · 联机（`Game.mode === 'online'`）：客人端不该被过场卡住，
   *     房主那边播一次就够了；而且联机是"其他模式（开发中）"，
   *     这一阶段不给它加新流程，避免引入同步问题。
   *   · 双人同屏（`playerCount === 2`）：同理，本阶段单人优先。
   *   ⇒ 只有**单人模式**会看到播报过场。这也符合方案"单人优先"。
   *
   * ⚠️ 播报只在**进新关卡时**播一次。真正的关卡加载在
   *    Game.startAfterBrief() 里（game.js 定义，就是下面 proceedAfterBrief 挂上去那个）。
   *
   * ⚠️ 有一个**测试/调试用**的开关 Game.skipWeatherBrief：
   *    置为 true 时 startGame 直接进关卡、不弹过场。
   *    为什么留这个开关而不是让测试去点 DOM：
   *      ① 30 套测试里有好几套直接调 startGame，让它们都去点过场
   *         既啰嗦又容易碎（DOM 一改测试全挂）
   *      ② 玩家侧没有入口会打开它，所以不影响正常游玩
   *    第 6 期做"跳过播报"设置项时可以把这个开关接到设置上。
   * ============================================================ */
  const soloPlay = (Game.mode === 'single' || Game.playerCount === 1);
  if (soloPlay && !Game.skipWeatherBrief) {
    /* 记下"待进入的关卡"，播报界面只负责显示 + 放行 */
    Game.pendingLevelIndex = levelIndex;
    /* ============================================================
     * ★ 天气来源：优先"关卡强制指定"，否则随机抽（2026-10-06）★
     * ============================================================
     * 十一的要求："每次进关随机抽一个天气"。
     *
     * 【语义：levels.js 的 weather 字段 = 强制指定】
     *   · 关卡写了 weather（比如第 4 关写死 'fog'）→ **用指定的**
     *     （用途：以后想给某关配"剧情上必有某天气"时不用改代码）
     *   · 关卡没写（其余 4 关都是 null）→ **随机抽**
     *   ⇒ 这样既满足"每关随机"，又保留了"想钉死就钉死"的能力。
     *
     * ⚠️ 注意绘制层读的是 `Game.level.weather`（见下面 setWeatherForLevel），
     *    不是 briefWeather —— briefWeather 只给播报界面显示用。
     *    两处必须一致，否则"播报说下雨、进去是晴天"。
     * ============================================================ */
    const lvArr = PLAYABLE_LEVELS();
    const lvRaw = lvArr[levelIndex];
    const forced = (lvRaw && lvRaw.weather) ? lvRaw.weather : null;
    Game.briefWeather = forced || rollWeather();
    Game.state = STATE.WEATHER_BRIEF;
    UI.lastKey = '';
    syncUI();
    return;
  }

  loadLevel(levelIndex);
}

/* 气象播报放行：过场点掉之后真正进关卡。
 * 单独抽出来是因为"按钮"和"点整屏"两条路都要调它。
 *
 * ⚠️ 挂在 Game 上（而不是只做内部函数）有两个原因：
 *   ① 播报界面的按钮在别的地方也要能调（比如以后的"跳过全部播报"）
 *   ② 测试里可以直接调 Game.startAfterBrief() 跳过过场，
 *      不用去点 DOM —— 让测试稳定
 */
function proceedAfterBrief() {
  const idx = (typeof Game.pendingLevelIndex === 'number') ? Game.pendingLevelIndex : 0;
  Game.pendingLevelIndex = null;
  /* ★ 必须立刻隐藏浮层，不要等定时器（2026-10-06 修 bug）★
   *   loadLevel() 之后游戏确实开始跑了（state 变 playing），
   *   但播报浮层还盖在屏幕上，要等 setInterval(syncUI, 100) 才消失 ——
   *   浏览器切后台被节流时可能等 1 秒以上，玩家看起来就是"点了没反应"。
   *   ⇒ 和 startGame() 一样先 hideUI()（内部会清 UI.lastKey，
   *     不用额外写；而且点击后立刻视觉反馈，体验才不"卡"。） */
  hideUI();
  loadLevel(idx);
}
if (typeof Game !== 'undefined') Game.startAfterBrief = proceedAfterBrief;

/* 返回主菜单（所有"返回"按钮走这里） */
function goMenu() {
  /* ★ 回主菜单 = 确定离开这一局 → 顺手把 PK 状态清干净（2026-10-06）★
   * ------------------------------------------------------------
   * 【为什么在这里兜底】
   *   PK 局可能从很多地方退出：结算页、失败页、暂停里按 Esc、
   *   直接点"回到首页"……每个都记得清状态是不可能的（一定会漏）。
   *   而"回主菜单"是**所有这些路径的必经之地** ——
   *   在这里清一次，就不可能带着 PK 残留去开单人局。
   *
   *   ⚠️ 必须清 `playerCount`（不只是 isPk/aiRoles）——
   *      实测过：只清 isPk/aiRoles 而留着 playerCount=2，
   *      下一局会走"双人同屏"分支，**又立起两个角色**，
   *      表现就是十一说的"PK 完了还连着来"。 */
  try {
    if (Game.isPk) {
      /* ⚠️ 只在"这一局确实是 PK"时才清 —— 双人同屏不算 PK，
       *    不能把它的 playerCount=2 也复位掉（那会毁掉双人模式）。 */
      if (typeof leavePkState === 'function') {
        leavePkState();
      } else {
        Game.isPk = false; Game.aiRoles = null; Game.pkResult = null;
        Game.pkMyRole = null; Game.pkLevelIndex = null; Game.playerCount = 1;
      }
    }
  } catch (e) { /* 清理失败不该拦住回菜单 */ }

  Game.state = STATE.MENU;
  UI.lastKey = '';
  syncUI();
}

/* 切到某个界面（统一清 lastKey，强制重建） */
function gotoState(st) {
  Game.state = st;
  UI.lastKey = '';
  syncUI();
}

/* 建一个新面板 */
function newPanel() {
  if (!UI.root) return null;
  UI.root.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'panel';
  UI.root.appendChild(p);
  UI.root.classList.add('on');
  UI.panel = p;
  return p;
}

/* 小工具：建元素 */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function btn(text, desc, onClick, cls) {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ' ' + cls : '');
  const t = el('span', null, text);
  b.appendChild(t);
  if (desc) b.appendChild(el('span', 'desc', desc));
  b.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    Sound.unlock();
    Sound.uiClick();
    onClick();
  });
  return b;
}

/* 把字符画在指定 canvas 上（用于角色选择预览） */
/* 把角色画到指定 canvas 上（角色选择预览 / 封面立绘 / 小标志都用它）
 *
 * ⚠️ 2026-10-06 修：尺寸不再写死 76，改成**读调用方设好的尺寸**。
 *   原来第一行就是 `canvas.width = 76`，会**覆盖**调用方设的值 ——
 *   于是封面上"把尺寸放大到 196"完全没生效（内部还是 76×76，
 *   只是被 CSS 拉伸放大，边缘发虚）。
 *   现在：调用方设多大就画多大；没设过才退到默认 76。
 *
 * ⚠️ 另外：不主动改 canvas.width/height —— 那会清空画布并重置变换。
 *    调用方自己在创建时设尺寸，这里只负责"画内容"。
 */
/* ============================================================
 * 角色预览图（启动画面两侧、角色库、选骑手页都用它）
 * ============================================================
 * ★ 2026-10-06 改：可指定"视觉体量补偿"，解决"袋鼠比飞龙小一圈" ★
 * ============================================================
 * 十一说："主菜单页的袋鼠要和龙一样大。"
 *
 * 【问题根源】
 *   这个函数原来是"在正方形画布内**按比例撑满**"：
 *     先按高度算宽（宽 = 高 × 贴图比例），超宽就反过来。
 *   而两张贴图的宽高比差很多：
 *     kangaroo.png  91/128 = 0.711 （瘦高）
 *     dragon.png   126/128 = 0.984 （接近方形）
 *   塞进同一个 196×196：
 *     袋鼠 → 139×196（高度顶满，**窄**）
 *     飞龙 → 193×196（高度顶满，**宽**）
 *   ⇒ 高度一样，但袋鼠窄了 54px、**面积少 28%**，看起来就"小一圈"。
 *
 * 【怎么修】
 *   不改变"不许拉变形"这条底线（拉伸会让角色变胖变丑），
 *   而是**按面积把两只的视觉体量对齐**：
 *     让袋鼠画得更高（高度放大），补偿它窄的那部分面积。
 *
 *   设目标面积 A（按飞龙的实际面积定，因为飞龙是"满格"那个）：
 *     飞龙：宽 = H×0.984，面积 = H²×0.984
 *     袋鼠：宽 = H×0.711，面积 = H²×0.711
 *   要面积相等 → H袋鼠² × 0.711 = H飞龙² × 0.984
 *              → H袋鼠 = H飞龙 × √(0.984/0.711) ≈ H飞龙 × 1.177
 *
 *   ⚠️ 不能直接用 1.177 —— 会**顶出画布**。
 *     所以同时要把画布高度给够，或者**反过来把飞龙缩小**。
 *     这里选后者（缩小飞龙）更安全：**不动画布尺寸**，
 *     保证所有调用点（角色库/选骑手页/启动画面）都不会被裁。
 *     做法：飞龙按 0.85 缩放，袋鼠按 0.85×1.177 ≈ 1.0 缩放 ——
 *     正好袋鼠满格、飞龙略收，两只面积接近。
 *
 * @param canvas  目标画布
 * @param role    角色 id
 * @param opts.fill  可选。true = 按"视觉体量对齐"绘制（启动画面用）；
 *                   不传 = 老的"正方形撑满"行为（角色库/选骑手页沿用，
 *                   那边是个小方块图标，尺寸差异不明显，不必改）
 * ============================================================ */
function paintCharPreview(canvas, role, opts) {
  const size = canvas.width || 76;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, canvas.width, canvas.height);

  const slot = getSpriteImage(role);
  if (slot) {
    const img = slot.img;
    const ar = img.width / img.height;

    /* ---- 算绘制尺寸 ----
     * 老行为：h = size，然后宽度按比例；超宽则反过来按宽度算高度。
     * 新行为（opts.visualFill）：在"撑满"的基础上，
     *   · 瘦高角色（ar 小）→ 用满高度（本来就会被高度顶满）
     *   · 宽角色（ar 大）→ **收一点**，把面积让给瘦的那个
     * 这样两只的"视觉体量"就接近了，而且都不拉变形。 */
    let h = size, w = h * ar;
    if (w > size) { w = size; h = w / ar; }

    if (opts && opts.visualFill) {
      /* 目标面积 = size² × 0.55（经验值，实测两只看起来最接近）。
       * 按面积反算各自的高度：h = √(A / ar) */
      const targetArea = size * size * 0.55;
      h = Math.sqrt(targetArea / ar);
      w = h * ar;
      /* 兜底：万一算出来超出画布（极端比例），退回撑满 */
      if (h > size) { h = size; w = h * ar; }
      if (w > size) { w = size; h = w / ar; }
    }

    // 原图若不朝右，先翻正再画
    c.save();
    c.translate((size - w) / 2, (size - h) / 2);
    if (!slot.facesRight) {
      c.translate(w, 0);
      c.scale(-1, 1);
    }
    c.drawImage(img, 0, 0, w, h);
    c.restore();
  } else {
    // 兜底：代码画的像素版
    const grid = role === 'kangaroo' ? SPR_KANGAROO
               : role === 'capybara' ? SPR_CAPYBARA
               /* ⚠️ 史迪奇/小鱼/小狗/小羊暂无专属的代码像素画 →
                *    一律退回袋鼠（**不是**借某个真实角色的画）——
                *    因为"借真实角色"会让玩家看到别的角色（十一报过的 bug）。
                *    这只是图片加载失败时的极短暂兜底，正常看到的是贴图。 */
               : SPR_KANGAROO;
    drawPixelSprite(c, grid, size * 0.08, size * 0.08, size * 0.84, false);
  }
}

/* ============================================================
 * 主同步：按游戏状态决定显示哪个界面
 * ============================================================ */
function syncUI() {
  if (!UI.root) return;

  // 游戏进行中 / 过关 / 失败 / 暂停 —— 由 canvas 自己画，UI 层最多盖个小面板
  const st = Game.state;
  let key = st;
  if (st === STATE.CLEAR || st === STATE.GAMEOVER) key = st + ':' + Game.levelIndex + ':' + Math.floor(Game.elapsed);
  /* 角色解锁界面：同一个角色只播一次，但 key 里带上角色 id，
   * 保证"连续解锁两个角色"时第二个也会重建。 */
  if (st === STATE.CHAR_UNLOCK) key = st + ':' + (UI.unlockCharId || '');
  if (st === STATE.PLAYING) {
    hideUI();
    /* 进入游玩要把虚拟手柄按当前规则显示出来（仅手机模式 + 非竖屏）。
     * 放在这里而不是 loadLevel 里，是因为"暂停后继续"也要恢复显隐，
     * 而那条路径不经过 loadLevel。 */
    try { TouchPad.syncVisibility(); } catch (e) {}
    return;
  }

  // 状态没变就不重建，避免闪烁
  if (key === UI.lastKey) {
    if (st === STATE.HOSTING) refreshHostingText();
    if (st === STATE.JOINING) refreshJoiningText();
    return;
  }
  UI.lastKey = key;

  /* 切到任何非游玩界面，虚拟手柄都该收起来 ——
   * 十一明确要求："手机按键只在实际游玩时显示，
   * 菜单、暂停、结算和失败界面中应隐藏"。 */
  try { TouchPad.syncVisibility(); } catch (e) {}

  if (st === STATE.SPLASH) buildSplash();
  else if (st === STATE.WEATHER_BRIEF) buildWeatherBrief();
  else if (st === STATE.MENU) buildMainMenu();
  else if (st === STATE.DEVICE_PICK) buildDevicePick();
  else if (st === STATE.SINGLE_PICK) buildCharPick();
  else if (st === STATE.PK_PICK) buildPkPick();
  else if (st === STATE.CHAR_LIBRARY) buildCharLibrary();
  else if (st === STATE.ACHIEVEMENTS) buildAchievements();
  else if (st === STATE.LEVEL_SELECT) buildLevelSelect();
  else if (st === STATE.LOBBY) buildLobby();
  else if (st === STATE.HOSTING) buildHosting();
  else if (st === STATE.JOINING) buildJoining();
  else if (st === STATE.OTHER_MODES) buildOtherModes();
  else if (st === STATE.SETTINGS) buildSettings();
  else if (st === STATE.HELP) buildHelp();
  /* ★ 👤 账号三页（2026-10-06）★ */
  else if (st === STATE.ACCOUNT_WELCOME) buildAccountWelcome();
  else if (st === STATE.ACCOUNT_PICK) buildAccountPick();
  else if (st === STATE.ACCOUNT_LOGIN) buildAccountLogin();
  else if (st === STATE.PAUSED) buildPaused();
  else if (st === STATE.CLEAR) buildClear();
  else if (st === STATE.GAMEOVER) buildGameOver();
  else if (st === STATE.CHAR_UNLOCK) buildCharUnlock();
  else hideUI();
}

/* 品牌条（菜单顶部的小标签，做"外卖 App"的观感）
 *
 * ★ 2026-10-06 回退：重新显示默认文字「美团专送 · 骑手版」★
 *   上一轮我按"删掉那行很小的美团专送骑手版"把默认文字去掉了，
 *   但十一看完成品后澄清：
 *     "主菜单顶部不要删掉「美团专送 · 骑手版」小字，
 *      包括主菜单旁边的飞龙宝宝也不要删，主菜单改回去，
 *      删去下面一行美团专送骑手版就好了。"
 *
 *   ⇒ 她真正要删的是**主菜单底部那一行小字**（设备模式 + 当前骑手），
 *     顶部品牌栏**要保留**，所以这里恢复默认文字。
 *   ⇒ 其它界面传了具体文字的（'设置' / '角色库' / '配送完成' …）不受影响。
 *
 * ⚠️ 不传 text 时用 defaultText 兜底，而不是不显示 ——
 *    主菜单顶部要看到「美团专送 · 骑手版」这一行品牌字样。 */
function brandBar(text, defaultText) {
  const b = el('div', 'brand');
  b.appendChild(el('div', 'logo'));
  const label = text || defaultText || '美团专送 · 骑手版';
  b.appendChild(el('div', 'bname', label));
  return b;
}

/* ============================================================
 * ★ 启动画面（2026-10-06 新增）★
 * ============================================================
 * 十一的要求：
 *   "打开游戏后先展示包含标题『第十一单外卖』及对应背景图的启动画面，
 *    玩家点击后方进入『开始跑单／选择路线』界面。"
 *   "确保游戏大标题不被按钮所在的黑色面板覆盖，标题层级最高。"
 *
 * 为什么单独做一屏（而不是"在主菜单标题上盖个遮罩"）：
 *   主菜单的面板(.panel)是黑底方块，它天然会压住画布上的大标题。
 *   要"标题完整可见 + 层级最高"，最干净的做法就是
 *   **把标题放进一个独立的全屏层**，一点就走 ——
 *   这样标题永远不可能被任何面板遮挡。
 *
 * 背景图：用 canvas 画（零资源依赖，单文件版也能显示），
 *   内容是"天 → 路 → 两个骑手"，风格和游戏内一致。
 * ============================================================ */
function buildSplash() {
  if (!UI.root) return;
  UI.root.innerHTML = '';
  UI.root.classList.add('on');

  const s = el('div', null);
  s.id = 'splash';

  /* 背景层：像素画（复用游戏内的天空/云/山，见 paintSplashBg） */
  const bgCv = document.createElement('canvas');
  bgCv.className = 'splash-bg';
  s.appendChild(bgCv);
  paintSplashBg(bgCv);
  s.appendChild(el('div', 'splash-cover'));

  /* ============================================================
   * ★ 两边都放美团袋鼠（2026-10-06 改，十一要求）★
   * ============================================================
   * 十一原话：
   *   "封面上是不是有三个你之前画的那个丑丑的改版奶龙？那些都不要，
   *    全都给我改成美团袋鼠。就给我改成之前的那个美团袋鼠，
   *    可以给他不同的动作，放在那两边，大一点哈。"
   *
   * ⇒ 左边原本是袋鼠、右边原本是飞龙宝宝（就是她说的"丑丑的改版"），
   *   现在**两边统一美术团袋鼠**，尺寸放大，各自一个动作。
   *
   * 活动作的做法：在 CSS 动画之外，额外给两只不同的
   *   transform（位移/旋转/缩放），让它们不是"复制粘贴的一对"。
   *   （见 index.html 里 .splash-cast 的 sc-left / sc-right 类） */
  const cast = el('div', 'splash-cast');
  const left = el('div', 'sc-left');
  const right = el('div', 'sc-right');
  const cvL = document.createElement('canvas');
  const cvR = document.createElement('canvas');
  /* ★ 尺寸放大：132 → 196（十一说"大一点"）★ */
  [cvL, cvR].forEach(function (c) { c.width = 196; c.height = 196; });
  left.appendChild(cvL); right.appendChild(cvR);
  cast.appendChild(left); cast.appendChild(right);
  s.appendChild(cast);
  /* ⚠️ 第三参 { visualFill: true } 是**必须的**（十一：袋鼠要和飞龙一样大）——
   *    不加的话两只按"正方形撑满"画，袋鼠会窄一圈、显得小。
   *    见 paintCharPreview 的注释。 */
  try { paintCharPreview(cvL, 'kangaroo', { visualFill: true }); } catch (e) {}
  /* ★ 2026-10-06 回退：右边改回 'dragon'（飞龙宝宝）★
   *   上一轮我按"全都改成美团袋鼠"把右边也换成了袋鼠，
   *   但十一后来明确说："包括主菜单旁边的**飞龙宝宝**也不要删"。
   *   ⇒ 左边袋鼠、右边飞龙宝宝，恢复到原来的搭配。别单方面又改成两只袋鼠。 */
  try { paintCharPreview(cvR, 'dragon', { visualFill: true }); } catch (e) {}

  /* 顶部品牌区：美团袋鼠图标 + 一行品牌字样
   * ⚠️ 必须在 repaintCast 之前建好，重画时要用到 badge。
   *
   * ★ 2026-10-06 回退（十一的要求，务必看清）★
   *   上一轮我按"删掉美团专送小字"的指令，把这里的文字也去掉了。
   *   但十一看完成品后说的是：
   *     "主菜单顶部不要删掉「美团专送 · 骑手版」小字，包括主菜单旁边的
   *      飞龙宝宝也不要删，主菜单改回去，删去下面一行美团专送骑手版就好了。"
   *
   *   ⇒ 她真正要删的是**主菜单（点击进入后的页面）**底部那行
   *     「美团专送 · 骑手版」小字，**不是启动画面/封面**。
   *   ⇒ 所以这里**恢复**成带文字的版本（"美团专送"）。
   *     别再把这一段删掉了。 */
  const brand = el('div', 'splash-brand');
  const badge = document.createElement('canvas');
  badge.className = 'sb-badge';
  badge.width = 26; badge.height = 26;
  brand.appendChild(badge);
  brand.appendChild(el('div', 'sb-text', '美团专送'));
  s.appendChild(brand);
  try { paintCharPreview(badge, 'kangaroo'); } catch (e) {}

  /* ============================================================
   * ★ 等贴图加载完再重画一次（2026-10-06 修）★
   * ============================================================
   * 踩过的坑（十一说"封面上是丑丑的那个版本"就是这个原因）：
   *
   *   boot() 是**立刻**显示启动画面的，不等贴图 —— 这是故意的
   *   （见 index.html 的说明：等贴图会让白屏很久）。
   *   但后果是：第一帧画的时候 assets/kangaroo.png **还没加载完**，
   *   paintCharPreview 走的是 drawPixelSprite 兜底分支
   *   （16×16 的低清像素网格版），看起来就"糊"。
   *   而启动画面之后**不会重绘**，所以那张低清图会一直留在封面上。
   *
   * 修法：贴图加载完就把这三张 canvas 重画一次。
   *   这样玩家看到的是真·美团袋鼠贴图，而不是兜底的方块版。
   *
   * ⚠️ 用"轮询 + 重画"而不是依赖单一回调：
   *    · 万一 boot 里的 loadSpriteImages 回调没调到我们，也不会漏
   *    · 贴图从缓存秒开时，第一次轮询就会命中，最多多花 120ms
   * ============================================================ */
  function repaintCast() {
    try {
      var st = (typeof getSpriteImage === 'function') ? getSpriteImage('kangaroo') : null;
      if (!st || !st.img) return false;    // 贴图还没好，下次再来
      paintCharPreview(cvL, 'kangaroo', { visualFill: true });
      /* ⚠️ 右边是飞龙宝宝 —— 别改成 'kangaroo'（见上面 paintCharPreview 的注释） */
      paintCharPreview(cvR, 'dragon', { visualFill: true });
      paintCharPreview(badge, 'kangaroo');
      return true;
    } catch (e) { return false; }          // 失败就用兜底版，不影响进游戏
  }
  /* 暴露给 boot 的 loadSpriteImages 回调（可选调用） */
  UI.repaintSplash = repaintCast;
  /* 轮询兜底：最多试 40 次 × 120ms ≈ 4.8 秒，足够覆盖慢网络下的贴图加载 */
  (function pollCast(n) {
    if (n <= 0) return;
    if (repaintCast()) return;             // 成功就不再轮询
    setTimeout(function () { pollCast(n - 1); }, 120);
  })(40);

  /* 标题在最上层 —— 层级最高，任何东西都盖不住它。
   * （品牌的袋鼠图标在上面 repaintCast 之前就已经建好了，这里不重复建）*/

  s.appendChild(el('div', 'splash-title', GAME_TITLE));
  /* ⚠️ 小标题必须和主菜单一致 —— 十一要求"送完这单就下班"。
   *    这里原来还留着旧的"骑手跑单 · 一路把订单送到"，已同步。 */
  s.appendChild(el('div', 'splash-sub', '送完这单就下班'));
  s.appendChild(el('div', 'splash-cta', '点击开始'));

  /* 整屏可点 —— 点哪儿都能进主菜单。
   * 这是刻意的：启动画面上有一个"必须对准才能点"的按钮，
   * 反而会让玩家以为卡住了。 */
  s.addEventListener('click', function (e) {
    e.stopPropagation();
    Sound.unlock();
    Sound.uiClick();
    enterMenuFromSplash();
  });
  UI.root.appendChild(s);
  UI.panel = null;      // 启动画面不是 .panel，避免别处误用 UI.panel
}

/* 从启动画面进入主菜单（唯一入口，方便测试定位） */
function enterMenuFromSplash() {
  Game.sawSplash = true;
  Game.state = STATE.MENU;
  UI.lastKey = '';
  syncUI();
}

/* ============================================================
 * 启动画面背景（★ 2026-10-06 改为"直接用开始页面那套背景" ★）
 * ============================================================
 * 十一的要求：
 *   "封面改成开始页面的背景，把现在的封面全部换掉。"
 *   （上一轮是"封面与点击进入后的页面背景保持一致"，
 *     这一轮进一步要求封面**就是**开始页面的背景）
 *
 * 做法：**不再自己画一套**，而是直接调用 render.js 里那套
 *      游戏背景绘制函数：drawSky / drawClouds / drawHills。
 *       封面 = 开始页面 = 关卡内，三者是**同一份代码**画出来的，
 *       从此不可能再跑偏。
 *
 * 以前自己画过的两版（黄昏城市剪影 / 像素蓝天）已全部删除。
 *
 * ⚠️ 这三个函数用的是全局 CANVAS_W / CANVAS_H（1280×720）。
 *    所以这里的画布也设成同样尺寸，并且用 CSS 拉伸铺满
 *    —— 这样比例和开始页面完全一致。
 * ============================================================ */
function paintSplashBg(cv) {
  /* 尺寸必须和游戏画布一致，否则 drawSky 的渐变/云层位置会对不上 */
  cv.width = CANVAS_W;
  cv.height = CANVAS_H;
  const c = cv.getContext('2d');

  c.clearRect(0, 0, CANVAS_W, CANVAS_H);
  /* 关插值：放大到屏幕时保住像素硬边（像素风关键） */
  c.imageSmoothingEnabled = false;

  /* ---- 复用开始页面的背景三件套 ---- */
  const cam = { x: 0, y: 0 };
  const t = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() / 1000 : 0;
  try {
    if (typeof drawSky === 'function') drawSky(c, cam);
    if (typeof drawClouds === 'function') drawClouds(c, cam, t);
    if (typeof drawHills === 'function') drawHills(c, cam, t);
  } catch (e) {
    /* 兜底：绘制函数不可用时，至少铺一层天空色，别留白屏 */
    c.fillStyle = '#5c94fc';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  /* ---- 地面：和开始页面一致（草地 + 砖块）----
   * 开始页面的地平线在画面底部附近；这里画一条同样的草地+泥土带，
   * 让封面看起来就是"开始页面截了一张图"。 */
  const gTop = CANVAS_H - 96;
  /* 草地 */
  c.fillStyle = '#6ab04c';
  c.fillRect(0, gTop, CANVAS_W, 10);
  c.fillStyle = '#4e8f38';
  c.fillRect(0, gTop + 10, CANVAS_W, 4);
  /* 泥土 */
  c.fillStyle = '#8a5a3a';
  c.fillRect(0, gTop + 14, CANVAS_W, CANVAS_H - gTop - 14);
  /* 泥土砖缝（像素风：整齐的方格线） */
  c.fillStyle = 'rgba(0,0,0,0.16)';
  const TS = 32;
  for (let y = gTop + 14; y < CANVAS_H; y += TS) {
    c.fillRect(0, y, CANVAS_W, 2);
  }
  for (let row = 0, y = gTop + 14; y < CANVAS_H; y += TS, row++) {
    const off = (row % 2) * (TS / 2);
    for (let x = off; x < CANVAS_W; x += TS) {
      c.fillRect(x, y, 2, TS);
    }
  }
}

/* ⚠️ 已删除：pixelCloud / pixelHill / 旧的城市剪影版 paintSplashBg。
 *    十一要求"把现在的封面全部换掉"，且封面必须等于开始页面背景 ——
 *    所以自绘的那两套（黄昏城市剪影、像素蓝天绿山）都不再需要。
 *    现在封面走的是 render.js 的 drawSky/drawClouds/drawHills，
 *    想调封面背景 = 调那三个函数（会同时影响开始页面和关卡内，符合预期）。 */

/* ============================================================
 * 设备选择页（⚠️ 2026-10-06 起已停用，函数保留）
 * ============================================================
 * 十一的要求："暂不开通手机端入口，移除『选择电脑端／手机端』的
 * 初始选择页，专注完善电脑端。"
 *
 * 所以 boot() 不再进入 STATE.DEVICE_PICK，设置页里的设备切换也删了。
 * **但函数本身留着**，理由：
 *   ① 以后想重新开放手机端时，把入口接回来即可，不用重写界面；
 *   ② 老测试若还引用 buildDevicePick，不会 undefined 崩掉。
 *
 * 原设计要点（供以后恢复时参考）：
 *   · 两个选项做得很大 —— 手机上要好点
 *   · 只解决一个问题："你用什么设备玩"
 *   · 用 canvas 画图标（零资源依赖，单文件版也能显示）
 * ============================================================ */
function buildDevicePick() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('开始之前'));
  p.appendChild(el('h1', null, '选择游玩设备'));
  p.appendChild(el('div', 'sub', '选一次就好，之后可以在「设置」里随时切换'));

  const wrap = el('div', 'devices');

  [
    {
      mode: 'desktop',
      title: '电脑模式',
      desc: '使用键盘操作，不显示触屏按键',
      keys: '← → 移动　↑ / 空格 跳　Z 冲刺',
    },
    {
      mode: 'mobile',
      title: '手机模式',
      desc: '使用屏幕虚拟按键，建议横屏游玩',
      keys: '左手方向 · 右手跳跃 / 冲刺',
    },
  ].forEach(function (d) {
    const box = el('div', 'device-card');
    box.setAttribute('data-device', d.mode);

    const cv = document.createElement('canvas');
    cv.className = 'dev-icon';
    cv.width = 108;
    cv.height = 88;
    box.appendChild(cv);
    paintDeviceIcon(cv, d.mode);

    box.appendChild(el('div', 'dev-title', d.title));
    box.appendChild(el('div', 'dev-desc', d.desc));
    box.appendChild(el('div', 'dev-keys', d.keys));

    box.addEventListener('click', function (e) {
      e.stopPropagation();
      Sound.unlock();
      Sound.uiClick();
      chooseDeviceMode(d.mode);
    });
    wrap.appendChild(box);
  });

  p.appendChild(wrap);
}

/* 玩家在设备选择页点了某个模式 */
function chooseDeviceMode(mode) {
  try {
    DEVICE.set(mode);
  } catch (e) {
    console.error('[设备模式] 保存失败：', e);
  }
  /* ⚠️ 2026-10-07 改：选完**直接接着选骑手**，不要退回主菜单。
   * ------------------------------------------------------------
   * 【为什么】
   *   设备选择现在是"开始跑单"流程里的**一道闸门**
   *   （启动画面 → 主菜单 → 开始跑单 → **选设备** → 选骑手 → 开跑）。
   *   如果这里回 MENU，玩家就得**再点一次"开始跑单"** ——
   *   多一步、且会让人觉得"我刚才不是点过了吗"。
   *
   * 【为什么复用 goStartFlow()】
   *   它内部有账号闸门 + 设备闸门，此时 `chosen()` 已是 true，
   *   会**自动跳过设备页**直接进 SINGLE_PICK —— 正好是我们要的。
   *   而且以后往流程里再加闸门，这里一行都不用改。
   * ------------------------------------------------------------ */
  try {
    const sel = SAVE().selectedChar();
    Game.pickRole = roleOfSelection(sel);
  } catch (e) { /* 存档模块异常时用默认角色，不阻塞 */ }
  gotoState(STATE.SINGLE_PICK);
}

/* 画设备图标（电脑：显示器+键盘 / 手机：横屏手机+虚拟按键） */
function paintDeviceIcon(cv, mode) {
  if (!cv) return;
  const c = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  c.imageSmoothingEnabled = false;

  const Y = '#ffd100';      // 美团黄
  const D = '#1a1a1a';      // 深色
  const O = '#ff8c28';      // 橙

  if (mode === 'desktop') {
    /* 显示器 */
    c.strokeStyle = Y; c.lineWidth = 4;
    c.strokeRect(14, 12, 80, 50);
    c.fillStyle = 'rgba(255,209,0,0.16)';
    c.fillRect(14, 12, 80, 50);
    /* 屏幕里的方向键示意 */
    c.fillStyle = Y;
    c.fillRect(46, 30, 8, 8);
    c.fillRect(36, 40, 8, 8);
    c.fillRect(56, 40, 8, 8);
    /* 支架 */
    c.fillStyle = Y;
    c.fillRect(48, 62, 12, 10);
    c.fillRect(35, 72, 38, 4);
    /* 键盘 */
    c.fillStyle = D;
    c.strokeStyle = Y; c.lineWidth = 3;
    c.beginPath();
    c.rect(22, 78, 64, 8);
    c.fill(); c.stroke();
    c.fillStyle = Y;
    for (let i = 0; i < 7; i++) c.fillRect(26 + i * 9, 81, 5, 2);
  } else {
    /* 横屏手机 */
    c.strokeStyle = Y; c.lineWidth = 4;
    c.beginPath();
    c.rect(20, 24, 68, 44);
    c.fillStyle = 'rgba(255,209,0,0.12)';
    c.fill(); c.stroke();
    /* 屏幕内容示意 */
    c.fillStyle = 'rgba(255,209,0,0.35)';
    c.fillRect(28, 32, 22, 6);
    c.fillRect(28, 42, 14, 6);
    /* 虚拟按键：左下方向 + 右下跳跃（橙色，呼应实际手柄配色） */
    c.fillStyle = Y;
    c.fillRect(30, 54, 10, 10);
    c.fillRect(44, 54, 10, 10);
    c.fillStyle = O;
    c.beginPath();
    c.arc(72, 58, 9, 0, Math.PI * 2);
    c.fill();
    /* 左上角"横屏"暗示：一个小小的旋转箭头 */
    c.strokeStyle = O; c.lineWidth = 2;
    c.beginPath();
    c.arc(96, 18, 8, Math.PI * 0.15, Math.PI * 1.1);
    c.stroke();
  }
}

/* ============================================================
 * ★ 主菜单「可上下滑动」提示（2026-10-07 十一反馈"手机屏小看不到"）★
 * ============================================================
 * 小屏（视口高 ≤500px）上，主菜单面板会变成"内部滚动"
 * （见 index.html 里 `.panel.no-scroll.menu-fit` 的那段媒体查询）。
 *
 * 但滚动条是叠加式的、平时根本看不见 ⇒ 玩家可能压根不知道还能往下滚，
 * 于是表现成"后面的选项看不到"。这里在**面板真的溢出时**才挂一条提示，
 * 用 `position: sticky` 吸在面板底部，滚到底自然滑走。
 *
 * ⚠️ 必须**等一帧再量**：buildMainMenu 刚 append 完时布局还没算完，
 *    此时 `scrollHeight === clientHeight`，会把"需要滚动"误判成不需要。
 * ⚠️ 元素**绝不能带 .btn** —— help-page-test 会数
 *    `.panel.menu-fit` 里的 .btn 个数（必须恰好 4 个）。
 * ⚠️ `pointer-events: none`（写在 CSS 里）—— 绝不能挡住按钮点击。
 * ============================================================ */
let _menuHintRAF = 0;
function refreshMenuScrollHint() {
  const p = document.querySelector('#ui .panel.no-scroll.menu-fit');
  const hint = document.getElementById('menu-scroll-hint');
  if (!p) { if (hint) hint.remove(); return; }
  /* 溢出 >2px 才算"需要滚动"（留一点余量，避免亚像素误差误报） */
  const need = p.scrollHeight > p.clientHeight + 2;
  if (!need) { if (hint) hint.remove(); return; }
  if (!hint) {
    const h = document.createElement('div');
    h.id = 'menu-scroll-hint';
    h.textContent = '↕ 可上下滑动';
    p.appendChild(h);
  }
}

/* ---------------- 主菜单 ----------------
 * ============================================================
 * ★ 2026-10-06 重构：中间只留核心入口，工具/开发中入口移到边上 ★
 * ============================================================
 * 十一的要求：
 *   "精简开始界面：将『设置』『按键说明』移至左上角，
 *    中间主区域只保留『开始跑单』『选择路线』『角色库』等核心入口，
 *    减少展示内容；将仍处于开发中的『双人同屏模式』『异地联机模式』
 *    移到侧边或其他位置，避免中间区域杂乱。"
 *
 * 布局（三层，视线自上而下收敛）：
 *   · 左上角  [设置] [按键说明]     ← 工具，想找的时候找得到，平时不抢戏
 *   · 正中间  标题 + 3 个核心入口    ← 玩家 95% 的时间只关心这三个
 *   · 右下角  [其他模式（开发中）]   ← 双人/联机降级到边上
 *
 * ★ 我的补充优化建议（十一让我评估这个方案）★
 *   1. **加了"角色"这一行状态**：中间区域最下方显示"当前骑手 + 设备"，
 *      因为"开始跑单"是按上次的角色直接开跑，玩家需要知道当前骑的是谁，
 *      否则会一头雾水（"怎么这次是个龙？"）。
 *   2. **删掉「角色库」的重复入口**：主菜单有「角色库」，
 *      选角色页也有「角色库」，这是合理的（一个是"看"、一个是"换"），
 *      但都保留会导致两处文案不一致 —— 已统一成同一句。
 *   3. **「其他模式」用右下角而不是侧边栏**：侧边栏在横屏时会挤压主区域，
 *      右下角既不占通道，又符合"次要功能靠边"的直觉。
 *   4. **主面板去掉黑底**：原来是"浮在黑方块上的按钮"，
 *      背景的像素天空完全被挡住。现在面板透明，
 *      标题和按钮直接浮在游戏世界的天空上，观感更统一也更不杂乱。
 * ============================================================ */
function buildMainMenu() {
  if (!UI.root) return;
  UI.root.innerHTML = '';
  UI.root.classList.add('on');

  /* 主面板：透明外壳，只负责排中间的三个核心入口 */
  const p = el('div', 'panel no-scroll menu-fit');
  UI.root.appendChild(p);
  UI.panel = p;

  /* ---- 左上角工具条：设置 + 按键说明 ---- */
  const corner = el('div', 'menu-corner');
  corner.appendChild(btn('设置', null, function () {
    gotoState(STATE.SETTINGS);
  }));
  /* ★ 按键说明：十一要求"迁到设置页统一展示"，
   *   但在角落也留一个直达入口 —— 因为新手找不到设置里的二级菜单，
   *   而"怎么操作"恰恰是新手最需要的东西。
   *   两处指向同一个页面（STATE.HELP），不是重复功能。 */
  corner.appendChild(btn('按键说明', null, function () {
    gotoState(STATE.HELP);
  }));
  UI.root.appendChild(corner);

  /* ---- 右下角：其他模式 ----
   * ★ 2026-10-06 改：十一要求"那个其他模式，还是放在中间吧，
   *   跟这个开始跑单放在一起，放在这个底下。"
   *   ⇒ 已经从右下角移回中间主区域（见下面 ④）。
   *   这里保留一个注释说明，避免以后有人又把它挪回角落。 */

  /* ---- 正中间：标题 + 核心入口 ---- */
  /* ============================================================
   * ★ 去掉 HTML 层重复的「品牌栏 + 大标题 + 副标题」（2026-10-06）★
   * ============================================================
   * 十一反馈："主菜单那几行黑底栏目往下面移，不要挡住上面的标题。"
   *
   * 【真正的原因：标题画了两次，叠在一起了】
   *   菜单页上同时存在两层内容，位置都在屏幕中间：
   *     ① canvas 层（render.js 的 drawMenuBackdrop）
   *        品牌栏 + 66px 大标题「第十一单外卖」+ 副标题
   *     ② HTML 层（就是这里，.panel.menu-fit 里）
   *        .brand（美团专送·骑手版）+ <h1>第十一单外卖</h1> + .sub
   *
   *   两层叠在同一个位置 —— HTML 的 .brand 深色块正好压在
   *   canvas 的大标题上，看起来就是"黑底栏目挡住了标题"。
   *
   * ⇒ 修法：**HTML 层不要再画标题和品牌栏**，交给 canvas 那一层独占。
   *   理由：
   *     · canvas 那版是像素风、会浮动、和天空背景是一体的（更好看）
   *     · HTML 这版是纯文字，风格不统一，而且和 canvas 版内容完全重复
   *     · 去掉后主菜单只剩"按钮组"，面板更干净（也符合"减少展示内容"）
   *
   * ⚠️ 那几行按钮**不受影响**，下面照常 append。
   *    删掉的只有 brandBar() / h1 / sub 这三个元素。
   * ============================================================ */

  const totalLv = PLAYABLE_LEVELS().length;
  const unlockedLv = Math.min(SAVE().data.maxUnlocked, totalLv);

  /* ============================================================
   * ★ 零、模式选择（2026-10-06 第 2 期）★
   * ============================================================
   * 方案第 2 期："主菜单加模式选择"。
   *
   * 【放在最上面、但做得"轻"】
   *   · 放在"开始跑单"之上 —— 因为模式决定这一局怎么计分，
   *     玩家应该在开跑前就选定（而不是开跑了才想起来换）
   *   · 但它**不是主按钮** —— 用一行紧凑的分段选择器（两个小片），
   *     而不是两个大按钮。主按钮永远只有"开始跑单"一个。
   *
   * 【两个模式的差别，写在下面一行小字里】
   *   玩家看到"经典 / 骑手"两个词是不知道差别的，所以配一行说明：
   *     经典模式 → 慢慢逛，只看订单收齐没
   *     骑手模式 → 有时限，送得又快又好才拿三星
   *   ⚠️ 说明文案里**不提"失败"** —— 因为超时不会失败，
   *      写"超时会失败"是错的（违反方案红线）。
   * ============================================================ */
  const curMode = SAVE().mode ? SAVE().mode() : DEFAULT_GAME_MODE;
  const modeBox = el('div', 'mode-pick');
  modeBox.appendChild(el('div', 'mode-label', '玩法模式'));
  const modeRow = el('div', 'mode-row');
  [
    { id: 'classic', name: '经典模式', desc: '慢慢逛' },
    { id: 'rider',   name: '骑手模式', desc: '掐着表' },
  ].forEach(function (m) {
    const seg = el('div', 'mode-seg' + (curMode === m.id ? ' on' : ''));
    seg.textContent = m.name;
    seg.setAttribute('data-mode', m.id);
    seg.addEventListener('click', function (e) {
      e.stopPropagation();
      if (SAVE().mode() === m.id) return;      // 已经是这个模式，不重复切
      Save.setMode(m.id);
      Sound.uiClick();
      UI.lastKey = '';                          // 强制重建，让选中态刷新
      syncUI();
    });
    modeRow.appendChild(seg);
  });
  modeBox.appendChild(modeRow);
  modeBox.appendChild(el('div', 'mode-hint',
    (curMode === 'rider')
      ? '骑手模式 · 有时限（超时不会失败，只是拿不到时间分）'
      : '经典模式 · 不限时，只看订单收齐没有'));
  p.appendChild(modeBox);

  /* ① 开始跑单 —— 唯一的主按钮 */
  p.appendChild(btn('开始跑单', '从当前进度继续 · 选一个骑手上路', function () {
    /* ★★ 👤 账号闸门（2026-10-06 十一要求）★★
     * ------------------------------------------------------------
     * 十一的原话："玩家首次打开游戏并点击「开始」后，
     *              应自动弹出创建账号界面。"
     *
     * 所以这里分三种情况：
     *   ① 账号模块不可用（account.js 被删了）→ 直接放行
     *      （保证"删掉新模块能退回原版"这条项目规矩成立）
     *   ② 一个账号都没有 → 送去**创建账号页**
     *   ③ 有账号但当前**未登录**（比如刚退出）→ 送去**选账号页**
     *   ④ 已登录 → 正常开始
     *
     * ⚠️ 为什么闸门放在这里而不是"更靠前的地方"（比如主菜单都不让进）：
     *    玩家**应该能**浏览角色库、看按键说明、进设置 ——
     *    那些都不产生进度，没必要拦。真正需要账号的只有"改存档"，
     *    也就是开跑这一步。
     * ------------------------------------------------------------ */
    if (accountReady()) {
      if (ACCOUNT.count() === 0) {
        gotoState(STATE.ACCOUNT_WELCOME);
        return;
      }
      if (!ACCOUNT.isLoggedIn()) {
        gotoState(STATE.ACCOUNT_PICK);
        return;
      }
    }

    /* ★★ 🖥📱 设备选择闸门（2026-10-07 十一要求重新开放）★★
     * ------------------------------------------------------------
     * 十一的原话："在一开始点完开始游戏之后，选择手机版或者是电脑版。"
     *
     * 【为什么放在这里（账号闸门之后、选骑手之前）】
     *   · 在账号之后：账号才是"改存档"的第一道门，
     *     设备选择只是"怎么玩"，优先级更低，不该插在账号前面打断流程。
     *   · 在选骑手之前：手机/电脑决定**操作方式**，
     *     先定操作方式，再挑角色，顺序上更自然。
     *
     * 【什么时候弹】
     *   只有**没选过**（`DEVICE.chosen() === false`）才弹。
     *   选过之后直接跳过 —— 老玩家升级、或者第二次开跑都不该再被问。
     *   想改主意的话：设置页里有「操作设备」两个按钮（见 buildSettings）。
     *
     * ⚠️ `chosen()` 在设备模块缺失时兜底返回 true ⇒ 自动跳过，
     *    不会因为模块被删而卡住流程（项目规矩：删模块能退回原版）。
     * ------------------------------------------------------------ */
    let devChosen = true;
    try { devChosen = DEVICE_STATE().chosen(); } catch (e) { devChosen = true; }
    if (!devChosen) {
      gotoState(STATE.DEVICE_PICK);
      return;
    }

    const sel = SAVE().selectedChar();
    /* ★ 2026-10-06 改：走统一的 roleOfSelection（原先是二元三元表达式，
     *   选卡皮巴拉会被判成袋鼠）。传 sel 进去是"用这个 id 算 role"。 */
    Game.pickRole = roleOfSelection(sel);
    gotoState(STATE.SINGLE_PICK);
  }, 'primary'));

  /* ② 选择路线 */
  p.appendChild(btn(
    '选择路线 · 已解锁 ' + unlockedLv + ' / ' + totalLv + ' 单',
    unlockedLv < totalLv ? '看看后面还有哪些订单' : '全部订单已解锁',
    function () { gotoState(STATE.LEVEL_SELECT); }
  ));

  /* ③ 角色库
   * ⚠️ 计数必须用"看得见的角色数"，不能用 listForLibrary().length ——
   *    后者会把还没解锁的角色也数进去，
   *    按钮显示"角色库 · 3 名骑手"但点进去只有 2 张卡，
   *    等于提前剧透鲁鲁的存在（十一明确要求不许）。 */
  const libCount = listVisibleChars().length;
  p.appendChild(btn('角色库 · ' + libCount + ' 名骑手', '看看每个骑手擅长什么', function () {
    gotoState(STATE.CHAR_LIBRARY);
  }));

  /* ④ 其他模式 —— 十一要求放回中间、接在"开始跑单"那组下面。
   * 用 'muted' 样式保持"视觉上更弱"的层级关系
   * （这是**语义标记**，测试和以后的维护者都靠它判断优先级，不要删）。
   *
   * ⚠️ 注意：这里跟"开始跑单/选择路线/角色库"是同一列，
   *    所以主菜单现在中间有 4 个按钮。加东西之前先确认一屏放不放得下
   *    （见 index.html 的 .panel.menu-fit 和 @media (max-height) 兜底）。 */
  p.appendChild(btn('其他模式（开发中）', '双人同屏 · 异地联机', function () {
    gotoState(STATE.OTHER_MODES);
  }, 'muted'));

  /* 底部：总进度（一行，不占地方）
   * ★ 第 7 期成长主线：把"已送 N 单"包装成"骑手等级"——
   *   玩家看到的是"我是老练骑手"，比"我有 8 颗星"更有代入感。 */
  const cleared = SAVE().clearedCount();
  const totalStars = getTotalStars();
  const maxStars = totalLv * 3;
  const rank = (typeof riderRank === 'function') ? riderRank(cleared) : null;
  const prog = el('div', 'progress-line');
  /* ⚠️ 这里不要用 starsText(totalStars)！
   * starsText 是给"单关 0-3 星"设计的，传总星数（比如 10）会算出 3-10=-7，
   * '☆'.repeat(-7) 直接抛 RangeError 把主菜单打崩。 */
  prog.textContent = (rank ? rank.name + '　·　' : '') +
    '已送 ' + cleared + ' / ' + totalLv + ' 单' +
    (cleared > 0 ? '　·　★ ' + totalStars + ' / ' + maxStars + ' 星' : '');
  p.appendChild(prog);

  /* 当前骑手 + 设备提示（见上面"补充建议 1"）
   * ★ 2026-10-06：十一要求「删去下面一行美团专送骑手版」——就是这一行。
   *   原话："主菜单顶部不要删掉「美团专送 · 骑手版」小字，
   *          包括主菜单旁边的飞龙宝宝也不要删，主菜单改回去，
   *          删去下面一行美团专送骑手版就好了。"
   *
   *   ⇒ 主菜单**底部**这一行小字删掉（不再显示设备模式 + 当前骑手），
   *     顶部品牌栏（canvas 上那条）+ 两侧角色（袋鼠 + 飞龙宝宝）**保留**。
   *
   *   ⚠️ 为什么整块删掉而不是只改文案：
   *     十一要删的是"这一行的存在"，不是"换个说法"。
   *     当前骑手信息在「开始跑单 → 选骑手」页面里本来就有，
   *     主菜单再挂一行属于重复展示 —— 删了反而更干净。
   *     设备模式信息同理：那只是设备偏好的提示，不是进度。
   *
   *   如果以后想恢复"当前骑手"提示，直接取消下面这段注释即可
   *   （别改回去之前先想清楚：十一明确说过要删）。 */
  /* const info = el('div', 'menu-info');
  const devName = DEVICE_STATE().isMobile() ? '手机模式' : '电脑模式';
  const curChar = charById(SAVE().selectedChar());
  info.textContent = devName + '　·　当前骑手：' + (curChar ? curChar.name : '—');
  p.appendChild(info); */

  /* ---- 小屏滚动提示（见 refreshMenuScrollHint 的说明） ----
   * 等一帧再量，否则布局未完成 ⇒ 误判"不需要滚动"。 */
  if (_menuHintRAF) cancelAnimationFrame(_menuHintRAF);
  _menuHintRAF = requestAnimationFrame(function () {
    _menuHintRAF = 0;
    try { refreshMenuScrollHint(); } catch (e) {}
  });
  /* 旋转屏幕 / 改窗口大小后要重新判断（只注册一次） */
  if (!UI._hintBound) {
    UI._hintBound = true;
    const recheck = function () {
      if (Game.state !== STATE.MENU) return;
      try { refreshMenuScrollHint(); } catch (e) {}
    };
    window.addEventListener('resize', recheck);
    window.addEventListener('orientationchange', function () { setTimeout(recheck, 200); });
  }
}

/* ============================================================
 * ★ E1 气象播报过场（2026-10-06 第 5 期）★
 * ============================================================
 * 方案把它列为"王牌"，原话：
 *   "每单开始前，弹一个过场画面：一个一本正经的气象播报员
 *    播报本单天气……然后游戏才开始"
 *   "卡通游戏里突然出现正经气象播报 → **荒诞感拉满**"
 *   "只有大气科学专业的人想得出来 → 别人抄不走"
 *
 * 【为什么好笑】
 *   正经的气象播报腔调，配一个"送外卖"的卡通游戏 ——
 *   两种完全不同的话语体系撞在一起，反差本身就是笑点。
 *   而且它是**真的**在用气象术语（阵风、能见度、强对流），
 *   不是随便糊的假专业感。这是十一的专业签名。
 *
 * 【写法】
 *   完全照 buildSplash() 的套路（那个过场已经验证可用）：
 *   独立全屏层 + canvas 背景 + 中央文案 + 点击/按钮继续。
 *   ⇒ 复用成熟的过场模式，不发明第二套。
 *
 * 【第 5 期的范围】
 *   ⚠️ 只做"界面 + 台词"，天气效果留给第 6 期。
 *      所以这里读的是**占位天气**（每关的 weather 字段现在都是 null，
 *      就用一个固定的"晴"作为占位）—— 台词照样播音腔，
 *      只是天气本身还没有影响（第 6 期才加雾）。
 *
 * 【播报文案怎么来的】
 *   按"天气类型"给一段台词。第 6 期接上真实天气后，
 *   这里只用改 WEATHER_BRIEFS 表的数据，界面不用动。
 * ============================================================ */

/* ============================================================
 * ★ 随机天气池（2026-10-06 十一要求）★
 * ============================================================
 * 十一的要求：
 *   "改成：★每次进关随机抽一个天气★
 *    新增 4 种天气：小雨 / 飘雪 / 夜晚配送 / 大风落叶"
 *
 * ⚠️⚠️ 【2026-10-06 更新：这条铁律被十一自己推翻了】⚠️⚠️
 *   上一轮她立的规矩是"随机天气不得改物理"（怕运气决定成败）。
 *   这一轮她明确改主意，**要求天气改操作手感**，并选了"全模式都改物理"。
 *   ⇒ 所以池子里现在**有改物理的天气**（rain / wind / thunder）。
 *
 * 【新的风险控制方式（替代原来的'一律不改'）】
 *   既然会改物理，就必须回答"会不会随机到过不去的天气"。
 *   现在靠**两道防线**：
 *     ① 强度从"中等档"起，并且**用穷举测试验证**
 *        （关×天气×角色 全部能过才上线，见 tests/weather-physics-test.js）
 *     ② 天气播报会**明确告知**这一单有什么影响（不藏）
 *   ⚠️ 往池子里加"更狠"的天气前，先跑穷举测试 —— 过不去就不要加。
 *
 * 【weight 是什么】
 *   相对权重，不是百分比（内部会按总和归一）。
 *   晴天给得最重（7），因为**不是每单都该有天气** ——
 *   天气是"偶尔来一下"的调味料，不是每单都遇到的日常。
 *   实测分布（20 次抽样）：晴天约 44%，其余 5 种各约 11%。
 *
 * ⚠️ 这个权重我调过一次：原来晴天是 8，实测晴天占了 55%
 *    （20 次里 11 次晴）—— 天气太少见了，不够有趣。
 *    降到 7 之后晴天约 44%，"偶尔来一下"的手感更合适。
 *    （想再调只改 weight 数字，测试里有一条守着"每种都可能被抽到"。）
 *
 * 【key 必须和 WEATHER_BRIEFS 对得上】
 *   新增天气时**两处都要加**（池 + 台词表），否则会出现
 *   "抽到了但播报没台词"（退化成晴天台词）。测试里有一条守这个。
 * ============================================================ */
const WEATHER_POOL = [
  { key: 'clear', weight: 7 },   // ☀ 晴 —— 权重最高（不是每单都该有天气）
  { key: 'fog',   weight: 3 },   // 🌫 雾 —— 已在第 6 期实现
  { key: 'rain',  weight: 3 },   // 🌧 小雨（纯视觉）
  { key: 'snow',  weight: 3 },   // ❄ 飘雪（纯视觉）
  { key: 'night', weight: 3 },   // 🌙 夜晚配送（纯视觉）
  { key: 'wind',  weight: 3 },   // 💨 大风（★改物理：侧向推力）
  { key: 'thunder', weight: 3 }, // ⚡ 雷电（★改物理：定时落雷，会扣血）
];

/* 所有合法天气 key（测试用，也用来做"绝不返回未知值"的白名单） */
const WEATHER_KEYS = WEATHER_POOL.map(function (w) { return w.key; });

/**
 * 随机抽一个天气。
 *
 * ⚠️ 硬约束（十一的铁律 + 测试守着）：
 *   · **只返回 WEATHER_POOL 里出现过的 key**，绝不返回 undefined/未知值
 *   · 池子里**只有不改物理的天气**（见上面 WEATHER_POOL 的注释）
 *
 * @param rand  可选注入的随机源（0~1），测试用；不给就用 Math.random()
 * @return {string} 天气 key，一定是合法值（兜底返回 'clear'）
 */
function rollWeather(rand) {
  const r = (typeof rand === 'function') ? rand : Math.random;
  let total = 0;
  for (let i = 0; i < WEATHER_POOL.length; i++) {
    const w = WEATHER_POOL[i].weight;
    if (typeof w === 'number' && w > 0) total += w;
  }
  /* 池子被改坏（全无权重）时的兜底 —— 宁可晴天，也不返回 undefined */
  if (!(total > 0)) return 'clear';

  let roll = r() * total;
  for (let i = 0; i < WEATHER_POOL.length; i++) {
    const it = WEATHER_POOL[i];
    const w = (typeof it.weight === 'number' && it.weight > 0) ? it.weight : 0;
    if (roll < w) return it.key;
    roll -= w;
  }
  /* 浮点误差兜底：最后一档或晴天 */
  return WEATHER_POOL[WEATHER_POOL.length - 1].key || 'clear';
}

/* 每种天气的播报台词（气象播报腔）。
 * ⚠️ 文案是我（AI）写的，**需要十一确认** —— 尤其术语的准确性，
 *    她本人是大气科学专业，术语不能糊。 */
const WEATHER_BRIEFS = {
  clear: {
    name: '晴',
    icon: '☀',
    script: '今日配送区域天气晴好，能见度良好，气温适宜。' +
            '请各位骑手注意防晒补水，安全第一。',
  },
  fog: {
    name: '雾',
    icon: '🌫',
    script: '本区域已发布大雾黄色预警，局地能见度不足 200 米。' +
            '请骑手减速慢行，注意观察前方路况。',
  },
  /* ============================================================
   * ★ 4 种新增天气的台词（2026-10-06）★
   * ============================================================
   * ⚠️⚠️ 台词铁律【2026-10-06 反转了，注意】⚠️⚠️
   *
   * 【上一轮】十一说"物理没变，就不能播'路面湿滑'（骗玩家）"，
   *            所以要求"只说氛围"。
   * 【这一轮】她改成**要天气改物理**了 ——
   *            那台词就必须**如实告知影响**，不能再说"没事"。
   *
   * ⇒ 现在的规则是：**有什么影响就说什么**（不藏不骗）。
   *   ✅ 正确：说清这一单的**实际**影响（因为真的会发生）
   *   ❌ 错误：说了没有的影响 / 有影响却不说
   *
   * 【为什么这条反而更重要了】
   *   天气是随机的 + 会改物理 = 玩家可能"进门才发现今天特别难"。
   *   播报是他**唯一的事前信息**。瞒着他 = 让他觉得被坑。
   *   说清了 = 他能提前调整策略（"今天滑，我小心点"）。
   *   所以台词里要**明说机制**（打滑/侧风/落雷），
   *   这既是公平，也是这个游戏"气象播报"特色的价值所在。
   * ============================================================ */

  /* 🌧️ 暴雨：★会改物理（地面打滑）→ 台词必须如实说★ */
  rain: {
    name: '暴雨',
    icon: '🌧',
    script: '本区域有暴雨，累积雨量 50 至 80 毫米，将发布橙色预警。' +
            '路面湿滑，刹车距离明显变长，请骑手提前减速、留足余量。',
  },

  /* ❄️ 飘雪：纯视觉（不改物理）→ 只讲氛围 */
  snow: {
    name: '飘雪',
    icon: '❄',
    script: '受冷空气影响，本区域有小雪，气温零下 2 度到 2 度。' +
            '雪景虽好，也请骑手戴好手套，注意保暖。',
  },

  /* 🌙 夜晚配送：纯视觉 → 只讲氛围 */
  night: {
    name: '夜晚配送',
    icon: '🌙',
    script: '夜幕降临，本区域转为夜间配送时段，气温逐渐下降。' +
            '请骑手打开车灯，一路平安。',
  },

  /* 💨 大风：★会改物理（侧向推力）→ 台词必须如实说★ */
  wind: {
    name: '大风 · 落叶',
    icon: '💨',
    script: '本区域有偏北大风，平均风力 6 级，阵风 8 级。' +
            '注意：横向阵风会持续把骑手往一个方向带，' +
            '跳跃落点会偏移，请提前修正方向。',
  },

  /* ⚡ 雷电：★会改物理（落雷扣血）→ 台词必须如实说★ */
  thunder: {
    name: '雷暴 · 落雷',
    icon: '⚡',
    script: '本区域有强对流天气，雷电黄色预警。' +
            '注意：会定时落雷，落点提前约半秒在地上画圈预警，' +
            '看到圈请立刻离开，被劈中会扣好评率。',
  },
};

/* ============================================================
 * ★ E4 会"翻车"的气象播报（2026-10-06 第 7 期）★
 * ============================================================
 * 方案原文：
 *   "后期订单，播报员**故意报错或含糊其辞**：
 *    '今日……呃……天气大概……还行吧？'
 *    进去却是极端天气（玩家：'我信你个鬼'）"
 *   "把'预报不准'这个**现实梗做成游戏机制**——
 *    用幽默包装了一个真实的科学话题。"
 *
 * 【为什么这条特别有价值】
 *   气象预报**本来就会错**，这是科学事实（不是播报员不专业）。
 *   把这件事做成笑点，比"编个假的预报"高级得多 ——
 *   它是**真的**在讲一个真实的现象。
 *
 * 【怎么触发"翻车"】
 *   按"本单是第几单"来切：前两单播报员很正经，
 *   从第 3 单起开始"含糊其辞"（预报误差本来就随预报时效增长）。
 *   —— 这个设定本身也是有气象学依据的：预报时效越长，准确率越低。
 *   （⚠️ 这是隐喻，不是真的在算预报误差。文案需要十一把关。）
 *
 * ⚠️ 只在**单人模式**＋**有天气的关卡**才有翻车播报；
 *    没天气的关卡播报员照样正经（没东西可翻）。
 * ============================================================ */
const WEATHER_BRIEF_MUMBLE = {
  /* 含糊其辞版：播报员开始"打太极"（第 3 单起启用）
   * ⚠️ 同样遵守"只说氛围、不提物理"的铁律 ——
   *    "含糊"是含糊天气本身，不是含糊物理影响。 */
  fog: {
    name: '雾？（存疑）',
    icon: '🌫',
    script: '今日……呃……本区域能见度……大概还行吧？' +
            '总之雾可能有一点，也可能没有。大家随机应变。',
  },
  rain: {
    name: '小雨？（存疑）',
    icon: '🌧',
    script: '今天……好像有雨？也可能是阴天。' +
            '雨衣带一件吧，用不上就当多背了点东西。',
  },
  snow: {
    name: '飘雪？（存疑）',
    icon: '❄',
    script: '呃……冷空气大概会来，也可能不来。' +
            '温度嘛……反正多穿点总没错。',
  },
  night: {
    name: '夜晚？（存疑）',
    icon: '🌙',
    script: '这个时段……天应该是黑的吧，嗯，应该是。' +
            '至于具体几点黑，各位看表。',
  },
  wind: {
    name: '大风？（存疑）',
    icon: '💨',
    script: '风力……大概有个几级？反正不算小。' +
            '会被吹歪是肯定的，往哪吹……你跑起来就知道了。',
  },
  thunder: {
    name: '雷暴？（存疑）',
    icon: '⚡',
    script: '好像……有雷？具体什么时候劈、劈在哪，' +
            '这个真说不准。看到地上的圈就躲一下吧。',
  },
};

/* 取播报内容：按"本单第几单"决定用正经版还是含糊版 */
function weatherBriefContent(weatherKey, orderNo) {
  const base = WEATHER_BRIEFS[weatherKey] || WEATHER_BRIEFS.clear;
  /* 第 3 单起播报员开始不靠谱（对应"后期订单"） */
  const mumble = (typeof orderNo === 'number' && orderNo >= 3) &&
                 WEATHER_BRIEF_MUMBLE[weatherKey];
  return mumble ? WEATHER_BRIEF_MUMBLE[weatherKey] : base;
}

function buildWeatherBrief() {
  if (!UI.root) return;
  UI.root.innerHTML = '';
  UI.root.classList.add('on');

  const s = el('div', null);
  s.id = 'weather-brief';

  /* 背景：复用启动画面那套像素背景（同一套美术，零新增资源） */
  const bgCv = document.createElement('canvas');
  bgCv.className = 'wb-bg';
  s.appendChild(bgCv);
  try { paintSplashBg(bgCv); } catch (e) {}
  s.appendChild(el('div', 'wb-cover'));

  /* ---- 播报台：一块"电视屏幕"样子的面板 ---- */
  const board = el('div', 'wb-board');

  /* 先确定这一单的订单号 —— E4 翻车播报要用它判断"是不是后期订单" */
  const lv0 = Game.level || {};
  const ordNoTmp = (typeof lv0.orderNo === 'number') ? lv0.orderNo : null;
  const wKey = (Game.briefWeather && WEATHER_BRIEFS[Game.briefWeather])
    ? Game.briefWeather : 'clear';
  /* ★ E4：第 3 单起，播报员开始"含糊其辞"（预报时效越长越不准） */
  const info = (typeof weatherBriefContent === 'function')
    ? weatherBriefContent(wKey, ordNoTmp)
    : WEATHER_BRIEFS[wKey];

  board.appendChild(el('div', 'wb-tag', '气象播报'));

  /* 播报员头像（像素画，sprites.js 提供） */
  const av = document.createElement('canvas');
  av.className = 'wb-avatar';
  av.width = 96; av.height = 96;
  board.appendChild(av);
  try {
    if (typeof drawWeatherCaster === 'function') drawWeatherCaster(av);
  } catch (e) {}

  board.appendChild(el('div', 'wb-weather', info.icon + '　' + info.name));
  board.appendChild(el('div', 'wb-script', info.script));

  /* 本单信息（让玩家知道"马上要跑哪一单"） */
  const lv = Game.level || {};
  const ordNo = (typeof lv.orderNo === 'number') ? lv.orderNo : null;
  board.appendChild(el('div', 'wb-order',
    ordNo
      ? '下一单：#' + ((ordNo < 10 ? '0' : '') + ordNo) +
        (lv.district ? ' · ' + lv.district : '') +
        (lv.targetTime ? '　目标 ' + formatTime(lv.targetTime) : '')
      : (lv.name || '')));

  /* 继续按钮（唯一出路，但点整屏也能过） */
  board.appendChild(btn('收到 · 出发', null, function () {
    Game.startAfterBrief();
  }, 'primary'));

  s.appendChild(board);

  /* 整屏可点 —— 沿用启动画面的交互习惯（少一次找按钮） */
  s.addEventListener('click', function () { Game.startAfterBrief(); });

  UI.root.appendChild(s);
}

/* ============================================================
 * 其他模式（双人同屏 / 异地联机）
 * ============================================================
 * 十一的定位很清楚：
 *   "主菜单中保留一个低优先级入口：双人模式（开发中）"
 *   "当前仍在优化，可能存在卡顿"
 *
 * 所以这一页要做的只有两件事：
 *   ① 把现有双人/联机功能**原样**留在里面（不删、不扩展）
 *   ② 如实告知"还在优化、可能卡顿" —— 不要假装完美
 *
 * ⚠️ 本阶段不要在双人/联机上投入新功能。这一页只是"把入口降级"。
 * ============================================================ */
function buildOtherModes() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('其他模式'));
  p.appendChild(el('h1', null, '双人和联机'));
  p.appendChild(el('div', 'sub', '当前开发重点在单人模式，这两种玩法仍在优化'));

  const notice = el('div', 'dev-notice');
  notice.textContent = '⚠ 仍在优化中，可能出现卡顿或不同步。' +
                       '单人模式不受影响，可以放心玩。';
  p.appendChild(notice);

  /* ============================================================
   * ★ 🏁 PK 模式（2026-10-06 十一要求）★
   * ============================================================
   * 十一："要不要再加一个 PK 模式，先只开发 AI 骑手，跟我们比速度。"
   *
   * 【为什么放在"其他模式"页而不是主菜单】
   *   主菜单现在是**精心收干净的 4 个按钮**，十一明确要求别动它。
   *   PK 是"另一种玩法"，放这里语义正确。
   * ============================================================ */
  const pkBox = el('div', 'pk-entry');
  pkBox.appendChild(el('div', 'pk-entry-title', '🏁 竞速 PK · 和 AI 骑手比速度'));
  pkBox.appendChild(el('div', 'pk-entry-desc',
    '同一单路线，谁先送到收餐点谁赢。AI 会用和你一样的速度和跳跃 —— 它不作弊，只是不休息。'));
  pkBox.appendChild(btn('开始 PK', '先选骑手 · 电脑随机挑一个对手', function () {
    /* ★ 先到"选骑手页"（玩家选 + 看 AI 抽到谁），再开跑 ★ */
    buildPkPick._ai = null;
    buildPkPick._aiRoleOfMine = null;
    gotoState(STATE.PK_PICK);
  }, 'primary'));
  p.appendChild(pkBox);

  p.appendChild(btn('双人同屏接单', '两个人挤一台电脑，方向键 + WASD', function () {
    Game.mode = 'local';
    Game.playerCount = 2;
    Game.aiRoles = null;
    Game.pkResult = null;
    startGame(0);
  }));

  p.appendChild(btn('联机 · 和异地搭档一起跑单', '开一个取餐号，或输入搭档给你的号', function () {
    gotoState(STATE.LOBBY);
  }));

  const row = el('div', 'row');
  row.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
  p.appendChild(row);
}

/* ============================================================
 * ★ 🏁 PK 辅助（2026-10-06 十一反馈后加）★
 * ============================================================
 * 十一："一局定胜负，现在打完一局会连着来"
 * ⇒ 需要一个"干净退出 PK"和"原地重开 PK"。
 * ============================================================ */

/** 彻底退出 PK：清掉所有 PK 状态 + **把 playerCount 复位**
 *
 * ⚠️⚠️ 为什么必须复位 `playerCount`（这是"连着来"的真正元凶）：
 *   PK 用 `playerCount = 2`（为了让场上出现两个角色）。
 *   如果退出 PK 时只清 `isPk` / `aiRoles`，而**忘了清 playerCount**，
 *   下一局 `loadLevel` 就会走"双人同屏"分支，**又立起两个角色** ——
 *   玩家看到的就是"PK 打完了还连着来"（其实是双人同屏的残留）。
 *   实测确认过：按空格接下一单后 `players` 仍是 2。 */
function leavePkState() {
  Game.isPk = false;
  Game.aiRoles = null;
  Game.pkResult = null;
  Game.pkMyRole = null;
  Game.pkLevelIndex = null;
  Game.playerCount = 1;                    // ★ 关键：复位成单人
  Game.mode = 'local';
  try {
    if (typeof InputState !== 'undefined' && InputState.clearAI) InputState.clearAI();
  } catch (e) { }
  try {
    if (typeof AI_RIDER !== 'undefined') AI_RIDER.reset();
  } catch (e) { }
}

/** 原地重开一局 PK（同一关、同一对手、重新倒计时）
 *
 * 和"再来一局 PK"的区别：
 *   · 再来一局 → 回选骑手页（可换皮肤/换对手/重新抽关）
 *   · 重跑这一关 → 直接用当前配置再来一次（最快重赛）
 *
 * ⚠️ 必须**保留** `pkMyRole` 和 `aiRoles`（这才是"同一对手"），
 *    然后走 `startGame(同一关, {pk:true, ...})` ——
 *    这样 PK 状态由 startGame 统一维护（它是唯一设置点）。 */
function restartPkSameLevel() {
  const myRole = Game.pkMyRole || (typeof roleOfSelection === 'function' ? roleOfSelection() : 'kangaroo');
  const aiRoles = Array.isArray(Game.aiRoles) ? Game.aiRoles.slice() : [];
  const lvIdx = (typeof Game.pkLevelIndex === 'number') ? Game.pkLevelIndex : 0;
  if (!aiRoles.length) { leavePkState(); goMenu(); return; }

  Game.mode = 'local';
  Game.playerCount = 2;
  Game.skipWeatherBrief = true;
  startGame(lvIdx, {
    pk: true,
    aiRoles: aiRoles,
    myRole: myRole,
    pkLevelIndex: lvIdx,
  });
  Game.skipWeatherBrief = false;
}

/* ============================================================
 * ★ 🏁 PK 选骑手页（2026-10-06 十一要求）★
 * ============================================================
 * 十一："AI 可以随机皮肤，我可以选皮肤"
 *
 * 【为什么要有这一页，而不是"直接用存档里的角色"】
 *   ① PK 是"挑对手来打"，玩家在开跑前有**选一次**的诉求
 *     （"这次我要用卡皮巴拉跟他比"）
 *   ② **必须让玩家看见 AI 是谁** —— 不然跑起来会困惑
 *     "对面那个是谁？为什么长得不一样？"
 *   ⇒ 所以这一页做两件事：玩家选 + 显示 AI 抽到了谁。
 *
 * 【AI 怎么随机】
 *   开了这一页时**立刻抽一次**并固定下来（存在 PK_PICK 的会话状态里），
 *   而不是"点开始才抽" —— 因为要**先显示给玩家看**。
 *   ⚠️ 抽到的角色必须是「已解锁 + 已制作」的（用 listVisibleChars），
 *      否则会出现"AI 用了玩家还没解锁的角色"（虽然不算作弊，但很怪）。
 * ============================================================ */
function buildPkPick() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('竞速 PK'));
  p.appendChild(el('h1', null, '选你的骑手'));
  p.appendChild(el('div', 'sub', '选好就开跑 · AI 会用另一个骑手跟你抢收餐点'));

  /* ============================================================
   * ★★ 重绘这一页的正确方式（2026-10-06 修 bug）★★
   * ============================================================
   * 【十一报的 bug】"我为什么换不了皮肤"
   *
   * 【根因（两层，都是我写错的）】
   *   ① 我在换骑手/换对手的回调里调了 `render()` ——
   *      但 **ui.js 里根本没有 render() 这个函数**（那是 render.js 的画布函数）。
   *      于是点击后**抛 ReferenceError** → 页面完全不重绘
   *      → 看起来就是"点了没反应、换不了"。
   *
   *   ② 就算改成 `syncUI()` 也不行 —— syncUI 有"状态没变就不重建"的优化
   *      （`if (key === UI.lastKey) return;`），
   *      而这一页的状态一直叫 pk_pick，所以它**直接 return**，照样不重绘。
   *
   *   ⇒ 正确做法：把一个**请求重绘**封装成"清掉 lastKey + 调 syncUI"。
   *     清掉 lastKey 就是在告诉 syncUI "状态算变了，重建吧"。
   *     （buildCharPick 那种"只切高亮"的做法这里更简单：直接整页重建，
   *       因为"我 VS AI"预览也要跟着更新。）
   * ============================================================ */
  function repaintPkPick() {
    UI.lastKey = '';        // ★ 必须清！否则 syncUI 会因为"状态没变"直接 return
    syncUI();
  }

  const avail = listVisibleChars();
  if (!avail.length) {
    p.appendChild(el('div', 'sub', '还没有可用的骑手'));
    p.appendChild(btn('返回', null, function () { gotoState(STATE.OTHER_MODES); }, 'small'));
    return;
  }

  /* 玩家当前用的角色（后面 AI 池要排除它、预览要显示它） */
  const myRoleNow = (typeof roleOfSelection === 'function') ? roleOfSelection() : avail[0].role;

  /* ============================================================
   * ★★ AI 的候选池 vs 玩家的候选池（2026-10-06 修 bug）★★
   * ============================================================
   * 【十一报的 bug】"我为什么换不了皮肤"
   *
   * 【根因（不是代码坏了，是规则）】
   *   玩家的可选骑手 = `listVisibleChars()` = **只看已解锁的**。
   *   而角色的解锁门槛是：
   *       美团袋鼠 → 初始
   *       飞龙宝宝 → 通关第 1 关
   *       卡皮巴拉 → 通关第 10 关
   *       史迪奇   → 通关第 11 关
   *   ⇒ **新档只通关 0~1 关时，页面上只有一个骑手**，
   *     看起来就像"换不了皮肤"。
   *
   * 【怎么修】
   *   分两个池子：
   *     · **玩家池** = 已解锁的（`listVisibleChars`）—— 保持"不剧透"的设计
   *     · **AI 池**  = **全部已制作的角色**（`listForLibrary`）——
   *        AI 是对手，不受玩家进度限制，这样对手才有变化
   *        （而且不会出现"AI 只能跟玩家用同一个"，那是最没意思的情况）
   *
   *   ⚠️ 为什么 AI 可以用玩家没解锁的角色：
   *      ① 它是对手不是你的角色，不违反"不剧透"
   *         （不剧透针对的是"玩家自己有哪些可选"）
   *      ② 反而有好处：**新档也能遇到不同对手**，
   *         提前看到"原来还有这种骑手"，是正向的好奇而非剧透
   *   ⚠️ 但 AI 池必须过滤掉玩家**正在用的那个**（不然变成打自己）。
   * ============================================================ */
  const aiPool = (function () {
    var all = [];
    try { all = (typeof listForLibrary === 'function') ? listForLibrary() : avail; }
    catch (e) { all = avail; }
    const others = all.filter(function (c) { return c.role !== myRoleNow; });
    return others.length ? others : all;
  })();

  /* ---- AI 对手（这一页打开时抽一次就固定）---- */
  /* 存在模块级变量里，避免"每次重绘都换人"（那会让玩家看到 AI 一直变） */
  if (!buildPkPick._ai || buildPkPick._aiRoleOfMine !== myRoleNow) {
    buildPkPick._ai = aiPool[Math.floor(Math.random() * aiPool.length)];
    buildPkPick._aiRoleOfMine = myRoleNow;
  }
  const aiChar = buildPkPick._ai;

  /* ---- 对战预览条：我 vs AI ---- */
  const vsBox = el('div', 'pk-vs');

  const mineBox = el('div', 'pk-vs-side');
  mineBox.appendChild(el('div', 'pk-vs-tag', '你'));
  const myCv = document.createElement('canvas');
  myCv.width = 76; myCv.height = 76;
  mineBox.appendChild(myCv);
  const myNameEl = el('div', 'pk-vs-name', charByRole(myRoleNow) ? charByRole(myRoleNow).name : '');
  mineBox.appendChild(myNameEl);
  paintCharPreview(myCv, myRoleNow);
  vsBox.appendChild(mineBox);

  vsBox.appendChild(el('div', 'pk-vs-mid', 'VS'));

  const aiBox = el('div', 'pk-vs-side ai');
  aiBox.appendChild(el('div', 'pk-vs-tag', 'AI（随机）'));
  const aiCv = document.createElement('canvas');
  aiCv.width = 76; aiCv.height = 76;
  aiBox.appendChild(aiCv);
  aiBox.appendChild(el('div', 'pk-vs-name', aiChar.name));
  paintCharPreview(aiCv, aiChar.role);
  vsBox.appendChild(aiBox);

  p.appendChild(vsBox);

  /* ---- 换一个 AI（玩家想换对手时可以点）---- */
  /* ⚠️ btn() 只有 4 个参数 (text, desc, onClick, cls) —— 别多传。
   * ⚠️ 用 **aiPool**（全部已制作角色）而不是 avail（玩家已解锁的）——
   *    否则新档只有 1 个可选角色时，"换对手"永远换不动（十一报的 bug 之一）。 */
  p.appendChild(btn('🎲 换一个对手', '随机再抽一个 AI 骑手', function () {
    const pool = aiPool;
    let next = pool[Math.floor(Math.random() * pool.length)];
    /* 避免"换一个"换到同一个（那样像没反应） */
    if (pool.length > 1) {
      let guard = 0;
      while (next.role === buildPkPick._ai.role && guard++ < 10) {
        next = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    buildPkPick._ai = next;
    Sound.uiClick();
    repaintPkPick();
  }, 'small'));

  /* ---- 我的骑手列表 ---- */
  p.appendChild(el('div', 'sub', '你的骑手（点一下换）'));

  /* ★★ 只有一个可选时，明确告诉玩家"怎么才能多一个"（2026-10-06）★★
   * ------------------------------------------------------------
   * 【为什么必须给这句提示】
   *   十一反馈"我为什么换不了皮肤" —— 根因就是**新档只解锁了 1 个骑手**。
   *   但界面上只显示一张卡，玩家只会觉得"这功能坏了"，
   *   完全猜不到"要去通关才解锁"。
   *
   *   ⇒ 这种"规则限制看起来像 bug"的情况，**必须把规则讲出来**。
   * ------------------------------------------------------------ */
  if (avail.length <= 1) {
    /* 找下一个还没解锁的角色的门槛关数 */
    let nextLv = 0, nextName = '';
    try {
      const all = (typeof listForLibrary === 'function') ? listForLibrary() : [];
      const locked = all.filter(function (c) {
        return c.unlockLevel > 0 && avail.every(function (a) { return a.id !== c.id; });
      }).sort(function (a, b) { return a.unlockLevel - b.unlockLevel; });
      if (locked.length) { nextLv = locked[0].unlockLevel; nextName = locked[0].name; }
    } catch (e) { }
    const hint = el('div', 'pk-lock-hint');
    hint.textContent = nextLv
      ? '你目前只有 1 名骑手。通关第 ' + nextLv + ' 单后会解锁新的骑手（' + nextName + '），到时候这里就能换了。'
      : '你目前只有 1 名骑手。通关更多订单后会解锁新的骑手。';
    p.appendChild(hint);
  }

  const wrap = el('div', 'chars');
  avail.forEach(function (c) {
    const isSel = (c.role === myRoleNow);
    const box = el('div', 'char' + (isSel ? ' selected' : ''));
    box.setAttribute('data-role', c.role);
    if (isSel) applyCharSelectedStyle(box, c.role);

    const cv = document.createElement('canvas');
    cv.width = 76; cv.height = 76;
    box.appendChild(cv);
    box.appendChild(el('div', 'cname', c.name));
    box.appendChild(el('div', 'ctag', c.tagline || ''));
    paintCharPreview(cv, c.role);

    box.addEventListener('click', function (e) {
      e.stopPropagation();
      Sound.unlock(); Sound.uiClick();
      if (!SAVE().hasChar(c.id) || !charIsReady(c.id)) return;
      Game.pickRole = c.role;
      try { SAVE().setSelectedChar(c.id); } catch (err) { }
      /* 我换了角色 → AI 也要重抽（否则可能变成"我和 AI 同一个角色"） */
      buildPkPick._ai = null;
      buildPkPick._aiRoleOfMine = null;
      repaintPkPick();
    });
    wrap.appendChild(box);
  });
  p.appendChild(wrap);

  /* ---- 开跑 ---- */
  p.appendChild(btn('开始 PK · 说跑就跑', '随机抽一关 · 谁先到收餐点谁赢', function () {
    Sound.uiClick();
    buildPkPick._ai = null;
    buildPkPick._aiRoleOfMine = null;
    startPkRace();
  }, 'primary'));

  const row = el('div', 'row');
  row.appendChild(btn('返回', null, function () {
    buildPkPick._ai = null;
    buildPkPick._aiRoleOfMine = null;
    gotoState(STATE.OTHER_MODES);
  }, 'small'));
  p.appendChild(row);
}

/* ============================================================
 * ★ 🏁 开始 PK 比赛（2026-10-06）★
 * ============================================================
 * 【怎么让"玩家 + AI"两个角色同时上场】
 *   用 `playerCount = 2`（这样关卡里会出现两个角色、两个出生点），
 *   但把其中一个的 role 登记进 `Game.aiRoles` ——
 *   于是 InputState.actionHeld 对这个 role 返回 AI 的输入，
 *   玩家的键盘**碰不到它**。
 *
 *   ⇒ 结果：玩家操控一个、AI 操控另一个，两人用同一套物理竞速。
 *
 * 【谁来当 AI】
 *   让 AI 用**玩家没选的那个角色**（玩家选袋鼠 → AI 开飞龙）。
 *   这样"我 vs 那个我没选的骑手"，有对手感。
 *
 * ------------------------------------------------------------
 * ★ 随机地图（2026-10-06 十一反馈）★
 * ------------------------------------------------------------
 * 十一："随机地图"
 *
 *   从**已解锁的关卡**里随机抽一关跑。
 *   ⚠️ 只抽"已解锁"的 —— 否则新手一开 PK 就被扔进第 11 关，
 *      那不叫随机，那叫劝退。
 *   ⚠️ 抽中哪一关要**告诉玩家**（在开跑前的提示里），
 *      否则"莫名其妙跑了个没见过的关"会让人困惑。
 * ============================================================ */
function startPkRace() {
  const myRole = (typeof roleOfSelection === 'function') ? roleOfSelection() : 'kangaroo';
  Game.mode = 'local';          // 用 local 的输入分发（两个角色都在本机跑）
  Game.playerCount = 2;

  /* ★ AI 用"选骑手页上显示的那个"★
   * ⚠️ 优先用 buildPkPick 里已经抽好、并**已经显示给玩家看过**的对手 ——
   *    如果这里重新随机，就会出现"页面上写着对手是卡皮巴拉，
   *    开跑却变成飞龙"的欺骗感。
   * 兜底（比如直接调 startPkRace 没经过选人页）：用"我没选的那个"。 */
  let aiRole = null;
  if (buildPkPick._ai && buildPkPick._ai.role && buildPkPick._ai.role !== myRole) {
    aiRole = buildPkPick._ai.role;
  } else {
    aiRole = (myRole === 'dragon') ? 'kangaroo' : 'dragon';
  }
  /* ⚠️ 保险：万一抽到的角色没就绪（配置缺失），退回一个必然可用的 */
  try {
    const c = charByRole(aiRole);
    if (!c || !c.ready) aiRole = (myRole === 'dragon') ? 'kangaroo' : 'dragon';
  } catch (e) { aiRole = (myRole === 'dragon') ? 'kangaroo' : 'dragon'; }

  /* ★ 随机抽一关（只从已解锁的里面抽）★ */
  const pickLevel = (function () {
    const all = (typeof PLAYABLE_LEVELS === 'function') ? PLAYABLE_LEVELS() : [];
    if (!all.length) return 0;
    const unlocked = [];
    for (let i = 0; i < all.length; i++) {
      let ok = true;
      try { ok = Save.isUnlocked(i); } catch (e) { ok = (i === 0); }
      if (ok) unlocked.push(i);
    }
    if (!unlocked.length) return 0;
    return unlocked[Math.floor(Math.random() * unlocked.length)];
  })();

  /* ⚠️ PK 是纯竞速，播报过场会打断节奏（而且它只对单人播），
   *    所以这里跳过播报 —— PK 就该"说跑就跑"。 */
  Game.skipWeatherBrief = true;
  /* ★ PK 状态通过 opts 传进去（startGame 是唯一设置点）★
   * 这样"忘了清 PK 状态"这种 bug 从根上不可能再出现。 */
  startGame(pickLevel, {
    pk: true,
    aiRoles: [aiRole],
    myRole: myRole,
    /* 记录抽到第几关，渲染层用它显示"本局地图" */
    pkLevelIndex: pickLevel,
  });
  Game.skipWeatherBrief = false;
}


/* ============================================================
 * 设置
 * ============================================================
 * 内容：
 *   · ★ 按键说明（2026-10-06 从主菜单迁进来）★
 *   · 音效开关
 *   · 屏幕震动开关
 *   · 操作提示开关
 *   · 清除存档（★二次确认★）
 *
 * ⚠️ 清除存档一定要二次确认。原来的清档是"点一下进度全没"，
 *    误触代价太大（玩家可能已经通关好几关）。
 *
/* ============================================================
 * ★ 兑换码表（2026-10-07 十一要求）★
 * ============================================================
 * 十一的原话："输入「code」能获得点什么东西"
 *
 * 【设计】
 *   一个**数据驱动**的兑换表 —— 加新码只要往这里加一行，
 *   UI 和存档逻辑都不用动。
 *
 * 【怎么加新码】
 *   '你的码': {
 *     label: '这个码是干嘛的（兑换成功时显示）',
 *     grant: function (save) { ... 直接改存档对象 ... return '给玩家的反馈' }
 *   }
 *
 * ⚠️ 码统一**转小写去空格**后比对（玩家不会记得大小写）。
 * ⚠️ `grant` 里改的是**存档数据对象**（不是 SAVE() 实例），
 *    因为要支持"改了之后统一保存一次"，避免写多遍。
 * ============================================================ */
const REDEEM_CODES = {
  /* ============================================================
   * ★ 主码：`code` —— 授予**作者身份**（2026-10-07 十一改）
   * ============================================================
   * 十一的原话："改成只靠 code 认作者"
   *
   * 【这个码做什么】
   *   ① 往当前账号的存档盖 `isAuthor: true`
   *   ② 立刻解锁全角色 / 全动作 / 全关卡
   *   ③ **从此以后**：每次读档 `syncAuthorPerks` 都会按这个标记
   *      自动补齐新内容 —— 加多少新角色/新关卡都自动跟上
   *
   * 【为什么放到兑换码里，而不是建号时特判昵称】
   *   十一明确要求只靠 code 认作者。而且这样更好：
   *     · 玩家的账号已经建好了，不用删号重建
   *     · 昵称保持自由，不被一个功能占位
   *     · 判定只有**一处**（存档标记），不会再出现两处不一致
   *
   * ⚠️ `grant` 只负责"盖章"这一步；
   *    补内容交给 `ACCOUNT.markAsAuthor()` → `syncAuthorPerks`，
   *    保持"只有一份解锁逻辑"。
   * ============================================================ */
  'code': {
    label: '作者身份',
    grant: function (save) {
      /* 盖章：让这个存档从此被认作作者 */
      save.isAuthor = true;
      /* 让 ACCOUNT 那边把内容补齐（它会读存档、补全、写回、并重载） */
      try {
        if (typeof ACCOUNT !== 'undefined' && ACCOUNT.markAsAuthor) {
          ACCOUNT.markAsAuthor();      /* 不传 id = 当前登录账号 */
        }
      } catch (e) { /* 补齐失败也不该拦住盖章 */ }
      return '作者身份已激活 · 全部骑手解锁';
    },
  },

  /* ============================================================
   * ★ 彩蛋码：「十一的碧琪宝宝」—— 解锁碧琪（2026-10-07 十一要求）★
   * ============================================================
   * 十一的原话："当兑换码里面写「十一的碧琪宝宝」的时候，
   *             可以获得碧琪这个新角色。"
   *
   * 【为什么用专属码，而不是通关解锁】
   *   碧琪是（彩虹小马）联动角色，定位是"彩蛋"而不是"进度奖励"。
   *   所以不占通关解锁位（unlockLevel 保持 0）——
   *   想拿就得知道这个码，有种"内部消息"的感觉。
   *
   * 【码本身】
   *   `十一的碧琪宝宝` —— 中文、含昵称"十一"，
   *   既是密码也是一份签名（十一本人给自己留的）。
   *   ⚠️ 码的比对是**转小写 + 去首尾空格**，
   *      所以 ` 十一的碧琪宝宝 ` 也认（玩家粘进来带空格是常事）。
   *
   * 【和作者账号的关系】
   *   十一说"作者那个破解账号，输入 code 那个账号，这些都直接有"。
   *   ⇒ 作者账号有**全角色**特权（syncAuthorPerks 会把所有 ready
   *     角色都解锁，碧琪也在内），所以作者**不用**兑这个码。
   *     这个码是给普通玩家 / 想单独要碧琪的人用的。
   * ============================================================ */
  '十一的碧琪宝宝': {
    label: '碧琪',
    grant: function (save) {
      const id = 'pinkiepie';
      /* 角色必须真的存在且已制作 —— 否则给个假 id 会变成"解锁了但没有" */
      if (typeof charById !== 'function' || !charById(id)) {
        return '这个角色还没做好，稍后再试';
      }
      if (!Array.isArray(save.unlockedCharacters)) save.unlockedCharacters = [];
      if (save.unlockedCharacters.indexOf(id) >= 0) {
        return '碧琪已经在你的车队里了';
      }
      save.unlockedCharacters.push(id);
      return '碧琪加入车队！';
    },
  },

  /* ============================================================
   * ★★★ 兑换码 `11` —— 解锁「十一」（2026-10-07 十一要求）★★★
   * ============================================================
   * 十一原话："我想给它设计成那个兑换码，输入 11 就可以兑换。"
   *
   * 【这个码给什么】
   *   解锁角色「十一」（粉色史迪仔 · 甜品主题）——
   *   一个**五项能力全部拉满**的顶配角色。
   *
   * 【⚠️ 码为什么这么短】
   *   一般兑换码会用长字符串防猜，但这个是**十一本人指定的**：
   *   短、好记、就是她自己的代号。它本来也不是"防别人"的、
   *   而是"给知道的人"的彩蛋。⇒ 按十一要求写 `11`。
   *
   * 【和作者账号的关系】
   *   作者账号（兑换码 `code`）有全角色特权 ⇒ **不用兑这个码**也直接有。
   *   这个码是给普通玩家用的。
   * ============================================================ */
  '11': {
    label: '十一',
    grant: function (save) {
      const id = 'pinkstitch';
      /* 角色必须真的存在且已制作 —— 否则给个假 id 会变成"解锁了但没有" */
      if (typeof charById !== 'function' || !charById(id)) {
        return '这个角色还没做好，稍后再试';
      }
      if (!Array.isArray(save.unlockedCharacters)) save.unlockedCharacters = [];
      if (save.unlockedCharacters.indexOf(id) >= 0) {
        return '十一已经在你身边了';
      }
      save.unlockedCharacters.push(id);
      return '十一来了！';
    },
  },

  /* ============================================================
   * ★★★ 兑换码「宁宁」—— 解锁「噜噜」（2026-10-07 十一要求）★★★
   * ============================================================
   * 十一原话："然后这个获取的话是兑换码输入宁宁。"
   *
   * 【这个码给什么】
   *   解锁角色「噜噜」（恐龙装水豚，佛系宅水豚个性）。
   *   招牌能力是**全游戏唯一的"落速最慢"**（飘着往下掉）。
   *
   * 【为什么码是"宁宁"而不是角色名】
   *   和 `11`（解锁「十一」）是同一个套路：
   *   码用**收码人的名字**，角色名另起。
   *   ⇒ 这是给"宁宁"这个人的专属彩蛋码。
   * ============================================================ */
  '宁宁': {
    label: '宁宁',
    grant: function (save) {
      const id = 'lulu';
      /* 角色必须真的存在且已制作 —— 否则给个假 id 会变成"解锁了但没有" */
      if (typeof charById !== 'function' || !charById(id)) {
        return '这个角色还没做好，稍后再试';
      }
      if (!Array.isArray(save.unlockedCharacters)) save.unlockedCharacters = [];
      if (save.unlockedCharacters.indexOf(id) >= 0) {
        return '噜噜已经在你身边了';
      }
      save.unlockedCharacters.push(id);
      return '噜噜来了！';
    },
  },
};

/**
 * 兑换一个码。
 * @return { ok, message }  —— message 为空字符串表示"输入框还是空的"
 */
function redeemCode(input) {
  const raw = String(input == null ? '' : input);
  const key = raw.trim().toLowerCase();
  if (!key) return { ok: false, message: '请输入兑换码' };

  const def = REDEEM_CODES[key];
  if (!def) return { ok: false, message: '这个兑换码不存在' };

  /* 同一账号同一个码只能兑一次 */
  let save = null;
  try { save = SAVE().data; } catch (e) { save = null; }
  if (!save) return { ok: false, message: '存档读不出来，稍后再试' };
  if (!Array.isArray(save.redeemedCodes)) save.redeemedCodes = [];
  /* ⚠️ 已兑过的处理（2026-10-07 加例外）：
   *   · 一般码：兑过就不能再兑（防刷）
   *   · **作者码 `code`**：只要这个存档**还不是作者**，就允许再兑 ——
   *     因为老存档可能"早就兑过码、但那时还没有作者这套机制"。
   *   · **碧琪码**：如果角色**还没到手**，也允许再兑 ——
   *     比如老存档兑过码但当时角色还没做好。
   *   判定标准统一成"**这次兑了，能不能真的给出东西**"。 */
  const already = save.redeemedCodes.indexOf(key) >= 0;
  let allowRetry = false;
  if (key === 'code') {
    allowRetry = (save.isAuthor !== true);
  } else if (key === '十一的碧琪宝宝') {
    allowRetry = !Array.isArray(save.unlockedCharacters) ||
                 save.unlockedCharacters.indexOf('pinkiepie') < 0;
  } else if (key === '11') {
    /* 「十一」同理：角色还没到手就允许再兑
     *（防"老存档兑过码、但当时角色还没做好"） */
    allowRetry = !Array.isArray(save.unlockedCharacters) ||
                 save.unlockedCharacters.indexOf('pinkstitch') < 0;
  } else if (key === '宁宁') {
    /* 「噜噜」同理 */
    allowRetry = !Array.isArray(save.unlockedCharacters) ||
                 save.unlockedCharacters.indexOf('lulu') < 0;
  }
  if (already && !allowRetry) {
    return { ok: false, message: '这个码你已经兑换过了' };
  }

  const feedback = def.grant(save);
  if (save.redeemedCodes.indexOf(key) < 0) save.redeemedCodes.push(key);
  try { SAVE().save(); } catch (e) { }

  return {
    ok: true,
    message: feedback
      ? ('兑换成功 · ' + def.label + ' —— ' + feedback)
      : ('兑换成功 · ' + def.label),
  };
}

/* ============================================================
 * 设置页
 * ============================================================
 * 十一的要求（2026-10-06）：
 *   "设置页要显示当前账号、能退出登录、能切换账号、能清除存档"
 * ⚠️ 清除存档是**危险操作**，必须二次确认 ——
 *    误触代价太大（玩家可能已经通关好几关）。
 *
 * ⚠️ 设备模式切换（电脑/手机）已移除（2026-10-06）。
 *    十一要求"暂不开通手机端入口"，所以设置里也不再给这个开关 ——
 *    留着它等于留了个能把自己切成手机模式的坑。
 *    DEVICE.set() 仍然存在，只是不再有 UI 入口。
 * ============================================================ */
function buildSettings() {
  const p = newPanel();
  if (!p) return;

  /* ★ 返回按钮放**左上角 + 最前面**（2026-10-06 十一要求）★
   * ------------------------------------------------------------
   * 十一的原话："设置页面中的返回放在左上角。"
   *
   * 【为什么要放在第一个子元素】
   *   用的是 `position: sticky` —— 它只在"滚动到它之后"才粘住。
   *   如果放在末尾，页面短的时候它会待在底部；页面长了要滚到底才看得见，
   *   那就完全违背"左上角固定返回"的初衷。
   *   ⇒ **必须是面板的第一个子元素**，这样一进来就贴在左上角、
   *     往下滚也一直粘着。
   *
   * ⚠️ 但视觉上它会挤掉品牌条的位置 —— 所以品牌条保持不动，
   *    让返回按钮浮在它上面（负 margin 收一点空间）。
   * ------------------------------------------------------------ */
  p.appendChild(btn('‹ 返回', null, function () { goMenu(); }, 'corner-back'));

  p.appendChild(brandBar('设置'));
  p.appendChild(el('h1', null, '设置'));
  p.appendChild(el('div', 'sub', '这些设置不会影响你的关卡进度'));

  const s = SAVE().settings();

  /* ---- ★ 操作设备：手机 / 电脑 可切换（2026-10-07 恢复）★ ----
   * ------------------------------------------------------------
   * 【历史】
   *   2026-10-06 十一要求"设置中请关闭手机模式"，这里被改成只读的"已固定"。
   *   2026-10-07 十一要求"启动手机版制作"，重新给回切换入口。
   *
   * 【为什么必须有这个入口】
   *   设备选择现在只在"第一次点开始跑单"时弹一次。
   *   如果玩家选错了（或者在电脑上误点了手机模式），
   *   **必须有个地方能改回来** —— 否则就被永久锁在错误模式里。
   *
   * ⚠️ `DEVICE.set()` 是唯一改模式的入口（device-mode.js 的硬规矩）；
   *    它内部会同步 <body> 的 dev-mobile / dev-desktop class，
   *    虚拟手柄显隐随之刷新 —— 这里不用手动做任何事。
   * ------------------------------------------------------------ */
  p.appendChild(el('div', 'set-label', '操作设备'));
  const devRow = el('div', 'set-row');
  const _devMode = (function () {
    try { return DEVICE_STATE().mode; } catch (e) { return 'desktop'; }
  })();
  devRow.appendChild(el('div', 'set-name',
    _devMode === 'mobile' ? '手机模式（屏幕虚拟按键）' : '电脑模式（键盘操作）'));

  const devSwitch = el('div', 'set-row');
  [['电脑', 'desktop'], ['手机', 'mobile']].forEach(function (m) {
    const active = (_devMode === m[1]);
    const b = btn(m[0], null, function () {
      Sound.unlock(); Sound.uiClick();
      try { DEVICE.set(m[1]); } catch (e) {
        console.error('[设备模式] 切换失败：', e);
      }
      /* 强制重建设置页 —— 让"当前：xx模式"的文案立刻跟上 */
      UI.lastKey = '';
      syncUI();
    }, 'small');
    if (active) {
      b.style.background = 'rgba(255,209,0,0.85)';
      b.style.color = '#1a1a1a';
    }
    devSwitch.appendChild(b);
  });
  devRow.appendChild(devSwitch);
  p.appendChild(devRow);
  p.appendChild(el('div', 'set-hint',
    '手机模式在屏幕上显示虚拟按键（左下方向 · 右下跳跃/冲刺），右上角有暂停和全屏键。'));

  /* ============================================================
   * ★📱 按键大小调节（2026-10-07 十一要求）★
   * ============================================================
   * 十一原话："设置里面可以加大按键，或者是调小按键，
   *           根据自己的使用习惯去调整按键大小。"
   *
   * 【为什么用"滑块"而不是"大/中/小三档"】
   *   十一说的是"根据自己的使用习惯去调整" ——
   *   档位只有 3 个选择，滑块能连续调，才叫"根据习惯"。
   *   手机手指粗细/屏幕尺寸差异很大，三档必有人觉得"高不成低不就"。
   *
   * 【为什么放这里】紧挨着「操作设备」—— 都是"怎么操作"相关的设置。
   *
   * ⚠️ 值域取自 save.js 的 PAD_SCALE_MIN/MAX（**唯一真相源**），
   *    这里绝不再写一遍 0.7 / 1.5 —— 否则改一处忘一处就错位。
   * ⚠️ 存值走 `SAVE().setSetting('padScale', v)`（自带夹紧）。
   * ============================================================ */
  p.appendChild(el('div', 'set-label', '按键大小（手机模式）'));
  (function buildPadScaleRow() {
    const st = SAVE().settings();
    const cur = Number(st.padScale) || 1;

    const row = el('div', 'set-row');

    /* 实时数值显示 —— 拖动时游戏里能立刻看到按钮变化，
     * 这里同步显示百分比，玩家知道"现在是多大"。 */
    const val = el('div', 'set-name', '当前：' + Math.round(cur * 100) + '%');

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'set-range';
    /* ⚠️ 用**公开常量**，不要手写数字（见上面注释） */
    const lo = (typeof PAD_SCALE_MIN === 'number') ? PAD_SCALE_MIN : 0.7;
    const hi = (typeof PAD_SCALE_MAX === 'number') ? PAD_SCALE_MAX : 1.5;
    input.min = String(lo);
    input.max = String(hi);
    input.step = '0.05';
    /* ⚠️ 喂给 DOM 的数值必须先确认有效 —— `input.value = undefined`
     *    会静默变成空串，滑块位置跑飞（和当年 maxLength=0 同一类坑）。 */
    input.value = String(isFinite(cur) ? cur : 1);

    /* input 事件 = 拖动过程中**实时**生效（不等松手）——
     * 十一要"根据习惯调整"，必须能边拖边看效果。 */
    input.addEventListener('input', function () {
      const v = Number(input.value);
      const saved = SAVE().setSetting('padScale', v);
      val.textContent = '当前：' + Math.round(saved * 100) + '%';
      /* 立刻把倍率写进 CSS 变量 ⇒ 游戏里的按钮**当场**变大/变小。
       * ⚠️ 这里**不**调 syncUI()：那会重建整个设置面板，
       *    滑块会被销毁 ⇒ 手指还按着却拖不动了（血泪）。 */
      try { if (typeof TouchPad !== 'undefined') TouchPad.applyScale(); } catch (e) {}
    });
    /* 松手后把值补成一个"好看"的刻度（0.05 的整数倍），并重绘一次 */
    input.addEventListener('change', function () {
      const v = Math.round(Number(input.value) * 20) / 20;
      SAVE().setSetting('padScale', v);
      input.value = String(v);
      val.textContent = '当前：' + Math.round(v * 100) + '%';
      try { if (typeof TouchPad !== 'undefined') TouchPad.applyScale(); } catch (e) {}
    });

    row.appendChild(val);
    row.appendChild(input);
    p.appendChild(row);

    /* 快捷按钮：不想拖的话，一键回到默认 / 放大 / 缩小 */
    const quick = el('div', 'set-row');
    [['缩小', 0.8], ['默认', 1], ['放大', 1.3]].forEach(function (q) {
      quick.appendChild(btn(q[0], null, function () {
        Sound.unlock(); Sound.uiClick();
        SAVE().setSetting('padScale', q[1]);
        try { if (typeof TouchPad !== 'undefined') TouchPad.applyScale(); } catch (e) {}
        /* 快捷按钮是"点一下"，没有拖动中的问题 ⇒ 可以安全重绘，
         * 让滑块位置同步跟上。 */
        UI.lastKey = '';
        syncUI();
      }, 'small'));
    });
    p.appendChild(quick);

    p.appendChild(el('div', 'set-hint',
      '拖动滑块可实时调整手机虚拟按键的大小，按自己手指的习惯来。'));

    /* ============================================================
     * ★📱 按键灵敏度（2026-10-07 十一要求）★
     * ============================================================
     * 十一原话："然后提高这个手机版的灵敏度，就是按钮的灵敏度。"
     *
     * 【这个滑块实际改的是什么】
     *   只改**起步的快慢**（物理层的"加速度"倍率），
     *   **不改最高速度** ⇒ 不会让角色跑得更远、跳得更远，
     *   所以**不会影响任何关卡的可通过性**。
     *   1.0 = 原来的手感（等于没开）。
     *
     * ⚠️ 值域取自 save.js 的 PAD_SENS_MIN/MAX（**唯一真相源**），
     *    这里绝不再写一遍数字。
     * ⚠️ 和"按键大小"同一个坑：`input` 事件里**不能调 syncUI()**，
     *    否则滑块会被销毁，手指还按着却拖不动了。
     * ============================================================ */
    p.appendChild(el('div', 'set-label', '按键灵敏度（手机模式）'));
    (function buildPadSensRow() {
      const st = SAVE().settings();
      const cur = Number(st.padSensitivity) || 1;

      const row = el('div', 'set-row');
      /* 用文字描述档感，而不是只给个百分比 ——
       * "灵敏度 115%" 谁也不知道是什么手感。 */
      const label = function (v) {
        if (v < 0.85) return '稳（起步慢、好控制）';
        if (v > 1.2) return '跟手（起步快、易冲过头）';
        return '标准（原手感）';
      };
      const val = el('div', 'set-name', label(cur));

      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'set-range';
      const lo = (typeof PAD_SENS_MIN === 'number') ? PAD_SENS_MIN : 0.6;
      const hi = (typeof PAD_SENS_MAX === 'number') ? PAD_SENS_MAX : 1.6;
      input.min = String(lo);
      input.max = String(hi);
      input.step = '0.05';
      input.value = String(isFinite(cur) ? cur : 1);

      input.addEventListener('input', function () {
        const v = Number(input.value);
        const saved = SAVE().setSetting('padSensitivity', v);
        val.textContent = label(saved);
        /* 立刻生效：进游戏时物理层每帧都读这个值，
         * 所以这里只要存下来就够了，不需要额外通知。 */
      });
      input.addEventListener('change', function () {
        const v = Math.round(Number(input.value) * 20) / 20;
        const saved = SAVE().setSetting('padSensitivity', v);
        input.value = String(saved);
        val.textContent = label(saved);
      });

      row.appendChild(val);
      row.appendChild(input);
      p.appendChild(row);

      const quick = el('div', 'set-row');
      [['稳一点', 0.85], ['标准', 1], ['跟手点', 1.25]].forEach(function (q) {
        quick.appendChild(btn(q[0], null, function () {
          Sound.unlock(); Sound.uiClick();
          SAVE().setSetting('padSensitivity', q[1]);
          UI.lastKey = '';
          syncUI();
        }, 'small'));
      });
      p.appendChild(quick);

      p.appendChild(el('div', 'set-hint',
        '只影响起步快慢，不会让角色跑更远/跳更高。觉得"按了要等一下才动"就往右调。'));
    })();

    /* ============================================================
     * ★📱 按键位置（2026-10-07 十一要求）★
     * ============================================================
     * 十一原话："按键的位置也是需要根据使用习惯去调节，
     *           比如说习惯用左手还是习惯用右手那种。
     *           不过应该不需要做得特别精细，就是大概的位置就行。"
     *
     * 【为什么用"三档按钮组"而不是拖拽】
     *   ① 十一自己说"不需要特别精细" ⇒ 档位够用
     *   ② 拖拽要处理"拖出屏幕/按钮重叠/存一堆坐标"，收益不匹配成本
     *   ③ 三个维度已能覆盖真实需求：惯用手（左右）、手握高低、手大手小（分开程度）
     *
     * ⚠️ 三个维度的表在 **save.js 的 PAD_POS**（唯一真相源）——
     *    这里只写"怎么展示"，**不写具体像素值**。
     * ============================================================ */
    const POS_ROWS = [
      { key: 'padSide', label: '整体位置', opts: [['偏左', 'left'], ['居中', 'center'], ['偏右', 'right']] },
      { key: 'padHeight', label: '整体高低', opts: [['偏低', 'low'], ['适中', 'mid'], ['偏高', 'high']] },
      { key: 'padSpread', label: '左右间距', opts: [['紧凑', 'tight'], ['标准', 'normal'], ['宽松', 'wide']] },
    ];
    POS_ROWS.forEach(function (rowCfg) {
      const stt = SAVE().settings();
      const curVal = stt[rowCfg.key];
      p.appendChild(el('div', 'set-label', rowCfg.label));
      const row = el('div', 'set-row');
      rowCfg.opts.forEach(function (o) {
        const active = (curVal === o[1]);
        const b = btn(o[0], null, function () {
          Sound.unlock(); Sound.uiClick();
          SAVE().setSetting(rowCfg.key, o[1]);
          /* 立刻生效，让玩家在设置页就能"想象到"位置变化
           * （手柄在设置页是隐藏的，但值已经写好了，进游戏即生效） */
          try { if (typeof TouchPad !== 'undefined') TouchPad.applyScale(); } catch (e) {}
          UI.lastKey = '';
          syncUI();
        }, 'small');
        if (active) {
          b.style.background = 'rgba(255,209,0,0.85)';
          b.style.color = '#1a1a1a';
        }
        row.appendChild(b);
      });
      p.appendChild(row);
    });
    p.appendChild(el('div', 'set-hint',
      '习惯用左手就把操作区调到你顺手的那一侧；手小可以把"左右间距"调紧凑一点。'));

    /* ============================================================
     * ★📱 「自定义按键位置」入口（2026-10-07 十一要求）★
     * ============================================================
     * 十一原话："我想可以自己去调这个位置，这个按钮的位置，
     *           而不是上面写偏左偏右，这种能实现吗？"
     *
     * 【为什么档位之外还要这个】
     *   档位是"给不想折腾的人"的快捷方式（三个维度、点一下就好）。
     *   但她的原话明确说了"而不是上面写偏左偏右" ⇒
     *   她想要的是**亲手拖**，档位对她来说太粗糙。
     *   ⇒ 两个都留：档位当默认，拖动当精细调整，互不冲突
     *     （拖动存的是**相对档位的偏移**，所以档位仍可作为基准）。
     *
     * ⚠️ 进编辑模式前必须先把手柄**显示出来**（游戏里才显示，
     *    设置页状态下手柄是隐藏的）—— 这正是 enterEditMode() 干的事，
     *    它强制加 .tp-on/.tp-editing。 */
    (function buildPadDragEntry() {
      const custom = (typeof padHasCustom === 'function') ? padHasCustom() : false;
      const row = el('div', 'set-row');
      row.appendChild(btn(custom ? '重新调整按键位置' : '自定义按键位置',
        '进入后直接把按钮拖到顺手的地方', function () {
          Sound.unlock(); Sound.uiClick();
          if (typeof TouchPad === 'undefined') return;
          /* ⚠️ 顺序很重要：先隐藏设置面板（否则面板盖在手柄上，
           *    手柄看得见却**点不到**）—— 靠 gotoState 切到 PLAYING 前的空档。
           *    这里不切状态机（编辑不是游戏状态），只用 hideUI 收掉面板。 */
          try { if (typeof hideUI === 'function') hideUI(); } catch (e) {}
          TouchPad.enterEditMode();
        }, 'small'));
      p.appendChild(row);

      if (custom) {
        const r2 = el('div', 'set-row');
        r2.appendChild(btn('恢复默认布局', null, function () {
          Sound.unlock(); Sound.uiClick();
          try { if (typeof TouchPad !== 'undefined') TouchPad.resetCustom(); } catch (e) {}
          UI.lastKey = '';
          syncUI();
        }, 'small'));
        p.appendChild(r2);
      }
      p.appendChild(el('div', 'set-hint',
        '点进去后按住任意按钮就能拖到任意位置，松手自动保存；右下角「完成」返回。'));
    })();
  })();

  /* ---- ★ 按键说明（迁到设置页的设置项）★ ----
   * 十一要求："将『按键说明』从初始页面迁移至『设置』页面中，
   *            作为设置项之一统一展示。"
   * 所以它现在是一个设置项，点进去是完整的图文说明页（STATE.HELP）。 */
  p.appendChild(el('div', 'set-label', '操作帮助'));
  p.appendChild(btn('按键说明', '基础操作、贴墙、墙跳、八方冲刺 —— 图文详解',
    function () { gotoState(STATE.HELP); }, 'small'));
  p.appendChild(el('div', 'set-hint', '还没解锁的动作会显示成灰色，通关后会点亮'));

  /* ============================================================
   * ★ 👤 账号（2026-10-06 十一要求）★
   * ============================================================
   * 十一的原话："后续创建账号、切换账号和退出账号的入口统一放在设置菜单中。"
   *
   * 【这一块显示什么，取决于当前状态】
   *   已登录  → 显示"当前是谁" + 切换账号 / 退出登录
   *   未登录  → 显示"未登录" + 去登录（而不是显示一个假名字）
   *
   * ⚠️ 整块用 try/catch 包住 —— 账号模块万一出问题，
   *    设置页剩下的项目（音效、清档…）必须照常能用。
   * ============================================================ */
  try {
    if (accountReady()) {
      p.appendChild(el('div', 'set-label', '账号'));
      const cur = ACCOUNT.current();

      if (cur) {
        const accRow = el('div', 'set-row');
        accRow.appendChild(el('div', 'set-name', '当前账号：' + cur.name));
        /* ★ 作者徽章（2026-10-07 改）★
         * 判定依据改成**存档里的 isAuthor 标记**（由兑换码写入），
         * 不再看昵称 —— 与 ACCOUNT.isCurrentAuthor 同源。 */
        const isAuthor = (typeof ACCOUNT !== 'undefined' && ACCOUNT.isCurrentAuthor)
          ? ACCOUNT.isCurrentAuthor() : false;
        if (isAuthor) {
          accRow.appendChild(el('div', 'set-badge author-badge', '★ 作者'));
        }
        accRow.appendChild(el('div', 'set-badge', '已登录'));
        p.appendChild(accRow);

        p.appendChild(btn('切换账号', '回到账号列表，换一个人玩（进度各自独立）',
          function () { gotoState(STATE.ACCOUNT_PICK); }, 'small'));

        /* 退出登录 —— 同样两段式确认（防误触） */
        const outBtn = btn(UI.logoutConfirm ? '真的退出？再点一下' : '退出登录',
          '退出后回到未登录状态，进度不会丢',
          function () {
            if (!UI.logoutConfirm) {
              UI.logoutConfirm = true;
              /* 3 秒内没再点就自动取消（避免一直停在"真的退出？"） */
              setTimeout(function () { UI.logoutConfirm = false; UI.lastKey = ''; }, 3000);
              UI.lastKey = '';       // 强制重绘，让按钮文字变一下
              syncUI();
              return;
            }
            UI.logoutConfirm = false;
            ACCOUNT.logout();
            /* 退出后读"游客档"（干净的新档，不会看到上一个账号的进度） */
            try { SAVE().reload(); } catch (e) { }
            applySoundFromSave();
            Sound.uiClick();
            UI.lastKey = '';
            syncUI();
          }, 'small');
        p.appendChild(outBtn);

        p.appendChild(btn('删除这个账号', '连同它的进度一起删掉（要输密码）',
          function () {
            UI.deleteAccountName = cur.name;
            /* 从设置页进来 → 取消时回设置页（不要跳去别处） */
            openDeleteAccountDialog(cur, STATE.SETTINGS);
          }, 'small'));

        p.appendChild(el('div', 'set-hint',
          '每个账号的进度、骑手、称号都是独立的 —— 换账号不会互相影响。'));
      } else {
        const accRow = el('div', 'set-row');
        accRow.appendChild(el('div', 'set-name', '未登录'));
        accRow.appendChild(el('div', 'set-badge warn', '未登录'));
        p.appendChild(accRow);

        if (ACCOUNT.count() > 0) {
          p.appendChild(btn('登录账号', '选一个本机账号，输密码进入',
            function () { gotoState(STATE.ACCOUNT_PICK); }, 'small'));
        }
        p.appendChild(btn('创建一个新账号', '从零开始一份新进度',
          function () { gotoState(STATE.ACCOUNT_WELCOME); }, 'small'));

        p.appendChild(el('div', 'set-hint', '未登录时不能开始跑单 —— 进度得有地方存着。'));
      }
    }
  } catch (e) { /* 账号块失败不影响其它设置项 */ }

  const box = el('div', 'settings');
  /* ---- 开关项 ---- */
  const toggles = [
    { key: 'soundOn', label: '音效', hint: '关掉后完全没有声音' },
    { key: 'shakeOn', label: '屏幕震动', hint: '冲刺、落地、踩怪时的画面抖动' },
    { key: 'hintsOn', label: '操作提示', hint: '游戏中第一次做出动作时的浮字提示' },
  ];
  toggles.forEach(function (t) {
    const on = s[t.key] !== false;
    const row2 = el('div', 'set-row');
    row2.appendChild(el('div', 'set-name', t.label));
    const b = btn(on ? '已开启' : '已关闭', null, function () {
      SAVE().setSetting(t.key, !on);
      /* 音效开关要立刻生效 —— 否则"关了还响"看起来像没生效 */
      if (t.key === 'soundOn') {
        try { Sound.setEnabled(!on); } catch (e) {}
      }
      UI.lastKey = '';
      syncUI();
    }, on ? 'small on' : 'small');
    row2.appendChild(b);
    box.appendChild(row2);
    box.appendChild(el('div', 'set-hint', t.hint));
  });

  p.appendChild(box);

  /* ============================================================
   * ★ 兑换码（2026-10-07 十一要求）★
   * ============================================================
   * 十一："输入「code」能获得点什么东西"。
   *
   * 【做成什么】
   *   设置页里一个输入框，输入兑换码就能领奖励。
   *   目前只配了一个码：`code` → 解锁全部骑手（含作者彩蛋角色）。
   *
   * 【为什么做成"通用兑换码框"而不是写死一个按钮】
   *   以后想加新码（节日福利、bug 补偿）只要往 CODES 表里加一行，
   *   不用再动 UI —— 和项目里其它"数据驱动"的做法保持一致。
   *
   * ⚠️ 兑换记录写进存档（savedCodes），**同一个码只能兑一次**，
   *    否则玩家能反复点、把奖励刷爆。
   * ⚠️ 兑换码**大小写不敏感**（玩家不会记得大小写），
   *    但去空格后必须完全相等（避免"cod e"这种意外通过）。
   * ============================================================ */
  p.appendChild(el('div', 'set-label', '兑换码'));
  {
    const codeBox = el('div', 'set-row');
    const codeInput = el('input', 'acc-input');
    codeInput.type = 'text';
    codeInput.maxLength = 24;
    codeInput.placeholder = '输入兑换码';
    codeInput.autocomplete = 'off';
    codeInput.className = 'acc-input redeem-input';
    codeBox.appendChild(codeInput);

    const redeemMsg = el('div', 'acc-hint', '');
    const redeemBtn = btn('兑换', '领了就是你的了', function () {
      const raw = String(codeInput.value || '');
      const r = redeemCode(raw);
      redeemMsg.textContent = r.message;
      redeemMsg.className = 'acc-hint' + (r.ok ? ' ok' : (r.message ? ' bad' : ''));
      if (r.ok) {
        codeInput.value = '';
        Sound.win();
        /* 兑换可能改了存档（解锁角色）→ 立刻重读并重绘，让效果看得见 */
        try { SAVE().reload(); } catch (e) { }
        UI.lastKey = '';
        syncUI();
      } else if (r.message) {
        Sound.uiClick();
      }
    }, 'small');
    codeBox.appendChild(redeemBtn);

    p.appendChild(codeBox);
    p.appendChild(redeemMsg);
    p.appendChild(el('div', 'set-hint', '兑换码不区分大小写。每个码只能兑换一次。'));
  }

  /* ---- 清除存档 ---- */
  p.appendChild(el('div', 'set-label danger-label', '危险操作'));
  const resetBtn = btn(
    UI.resetConfirm ? '⚠ 真的清除？点这里确认，进度将无法找回' : '清除存档 · 从头开始',
    UI.resetConfirm ? '包括关卡进度、星级、动作解锁和角色解锁' : '清空关卡进度、星级和解锁（会二次确认）',
    function () {
      if (!UI.resetConfirm) {
        /* 第一次点：不执行，只把按钮变成"确认"状态。
         * 同时启动一个超时 —— 玩家点了确认按钮但走神了，
         * 10 秒后自动取消，避免那个"危险按钮"一直挂在那里。 */
        UI.resetConfirm = true;
        UI.lastKey = '';
        syncUI();
        setTimeout(function () {
          if (UI.resetConfirm) {
            UI.resetConfirm = false;
            /* 只在还停留在设置页时才重建，否则会打断玩家 */
            if (Game.state === STATE.SETTINGS) { UI.lastKey = ''; syncUI(); }
          }
        }, 10000);
        return;
      }
      /* 第二次点：真清 */
      try { SAVE().reset(); } catch (e) { console.error('[清档] 失败：', e); }
      UI.resetConfirm = false;
      Game.noticeText = '存档已清除，可以重新开始了';
      Game.noticeTimer = 240;
      UI.lastKey = '';
      syncUI();
    },
    UI.resetConfirm ? 'danger' : 'small'
  );
  resetBtn.classList.add('reset-btn');
  p.appendChild(resetBtn);
  /* ⚠️ 返回按钮**已经在函数开头**加到面板最前面了（见那里的说明）——
   *    它是 sticky 的，必须第一个。这里不要再加一次。 */
}

/* ============================================================
 * 角色库
 * ============================================================
 * 展示每个**已制作完成**的角色：
 *   形象 / 名称 / 定位 / 能力条 / 简介 / 解锁条件 / 各关最佳成绩
 *
 * 三条硬要求（改之前先读）：
 *   ① **不能卡片套卡片** —— 外层是面板、里层是角色卡，
 *      角色卡内部只用行/条，不再嵌卡片
 *   ② **不能只靠颜色区分状态** —— 已选角色除了描边高亮，
 *      还有文字标记"✓ 使用中"（不再有"🔒 未解锁"——见下面 ④）
 *   ③ **未制作的角色不能出现** —— 不要自己遍历 CHARACTERS
 *   ④ ★ **未解锁的角色不能出现**（2026-10-06 十一要求）——
 *      用 listVisibleChars() 过滤（= 已制作 + 已解锁）。
 *      原来这里遍历 listForLibrary()，然后给没解锁的画一张
 *      "黑影 + 🔒 + 通关第 N 关后解锁"的卡片 —— 对新角色那是剧透。
 *      **那整段"未解锁"渲染代码已经删掉了**，见下面的 ★ 双保险 ★。
 * ============================================================ */
/* ============================================================
 * ★ 共用：「骑手 / 成就」两个 tab（2026-10-06）★
 * ============================================================
 * 十一的入口方案 B：角色库页顶部加 [骑手] / [成就] 两个 tab。
 *
 * 【怎么切】
 *   ⚠️ 用**重绘**：点一下 → `gotoState(目标 state)` → 状态变了
 *      → syncUI 发现 key 变了 → 重建整个面板。
 *   不用"CSS 隐藏/显示两套 DOM"—— 这个项目**全是重绘式**的，
 *   混用两套会让"进游戏时清 UI"之类的逻辑出现漏网节点。
 *
 * 【两个页面各调一次，各自指定 active】
 *   角色库页 → buildLibTabs('char')
 *   成就页   → buildLibTabs('ach')
 *   这样"哪个 tab 亮着"由**当前页面**决定，不会有状态残留。
 *
 * 【★ 为什么不用 UI.lastKey 的手动技巧】
 *   `gotoState()` 已经把 `UI.lastKey` 清成 '' 了，所以状态一变必定重绘——
 *   不需要额外做什么。文档里说的"改 UI.lastKey 触发 syncUI"，
 *   在项目里对应的就是这个函数（它就是干这个的）。
 * ============================================================ */
function buildLibTabs(active) {
  const bar = el('div', 'lib-tabs');

  function tab(label, key, targetState) {
    const t = el('button', 'lib-tab');
    if (key === active) t.classList.add('on');
    /* ⚠️ 用 textContent 拼：li 里塞 span 会被 el() 的 text 参数覆盖，
     *    所以这里手动 append。 */
    const dot = el('span', 'tab-dot', '●');
    t.appendChild(dot);
    t.appendChild(document.createTextNode(label));
    t.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (key === active) return;          // 点自己不用重绘
      Sound.unlock();
      Sound.uiClick();
      gotoState(targetState);
    });
    return t;
  }

  /* 默认选中「骑手」—— 保持老玩家习惯，不改默认行为 */
  bar.appendChild(tab('骑手', 'char', STATE.CHAR_LIBRARY));
  bar.appendChild(tab('成就', 'ach', STATE.ACHIEVEMENTS));
  return bar;
}

/* ============================================================
 * ★ 成就页（2026-10-06）★
 * ============================================================
 * 十一的需求："把达成的成就做成一个入口，可以查看自己获得的成就。"
 *
 * 【数据从哪来】**全部是现成的，这个函数一行存储逻辑都不碰**：
 *   · 有哪些成就 → `MYSTERY_ORDERS`（每关一条）+ `GLOBAL_ACHIEVEMENTS`
 *                  （跨关卡的全局成就）—— **两张表合并展示**
 *   · 拿没拿到   → `SAVE().hasTitle(称号名)`
 *   · 总数       → `achievementTotal()`
 *
 * 【★ 核心设计：未解锁的也要显示，而且显示条件 ★】
 *   这和角色库的"零剧透"**方向相反**，是刻意的：
 *     角色 = 惊喜 → 提前说了就没意思   → 藏起来（见 buildCharLibrary）
 *     成就 = 清单 → 藏起来就失去意义   → 显示灰版 + 条件
 *   玩家看到"全程不碰到任何订单袋"，才会想"下把试试"。
 *   这和 helpRow() 把未解锁招式画灰 + 标解锁条件是**同一个手法**。
 *
 * 【坑：titles 只存名字，没有时间戳】
 *   `titles: ['一单未取']` —— 纯字符串数组。
 *   所以**只显示"已达成"三个字，不显示日期**。
 *   ⚠️ 不要顺手加时间戳（要改数据结构 + 写旧档迁移，风险大收益小）。
 *
 * 【无障碍】状态用 **图标 + 文字** 表达，不只靠颜色 ——
 *   项目已有的约定（角色库的状态标记、helpRow 的 hr-locked-tag 都是这么做的）。
 * ============================================================ */
function buildAchievements() {
  const p = newPanel();
  if (!p) return;

  /* ---- 左上角返回（和角色库、接一单页同一个 corner 做法）---- */
  const corner = el('div', 'panel-corner');
  const cornerBtns = el('div', 'panel-corner-btns');
  cornerBtns.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
  corner.appendChild(cornerBtns);
  corner.appendChild(el('div', 'panel-corner-brand', '成就'));
  p.appendChild(corner);

  p.appendChild(el('h1', null, '我的成就'));

  /* [骑手] / [成就] tab —— 当前在「成就」这一页 */
  p.appendChild(buildLibTabs('ach'));

  /* ---- 汇总两张成就表 ----
   * 神秘订单（每关一条）在前 —— 它们最"具体"（有明确关卡）。
   * 全局成就在后 —— 它们是"长期目标"。
   *
   * 统一成同一种"条目"结构，后面的渲染就不用管来源了：
   *   { title, condition, from, progress }
   *   · from     = 显示在哪一关 / 或"全局"
   *   · progress = {now, total}（可选，只有全局成就才有） */
  const items = [];

  const mo = (typeof MYSTERY_ORDERS !== 'undefined' && Array.isArray(MYSTERY_ORDERS))
    ? MYSTERY_ORDERS : [];
  mo.forEach(function (o) {
    const lvNo = (typeof o.levelIndex === 'number') ? (o.levelIndex + 1) : '?';
    items.push({
      title: o.title,
      condition: o.condition,
      from: (o.name || '神秘订单') + ' · 第 ' + lvNo + ' 关',
    });
  });

  /* 全局成就的进度：先摘一次快照，各条的 progress() 都用它 */
  let snap = null;
  try {
    snap = (typeof achievementSnapshot === 'function') ? achievementSnapshot() : null;
  } catch (e) { snap = null; }

  const ga = (typeof GLOBAL_ACHIEVEMENTS !== 'undefined' && Array.isArray(GLOBAL_ACHIEVEMENTS))
    ? GLOBAL_ACHIEVEMENTS : [];
  ga.forEach(function (a) {
    let prog = null;
    if (a.progress && snap) {
      try { prog = a.progress(snap); } catch (e) { prog = null; }
    }
    items.push({
      title: a.title,
      condition: a.condition,
      from: '全局成就',
      progress: prog,
    });
  });

  /* ---- 统计行：已达成 N / M ---- */
  const owned = items.filter(function (it) {
    return typeof SAVE === 'function' && SAVE().hasTitle(it.title);
  }).length;
  const total = items.length;

  const stat = el('div', 'ach-stat');
  stat.appendChild(el('span', 'ach-stat-num', '已达成 ' + owned + ' / ' + total));
  stat.appendChild(el('span', 'ach-stat-tip',
    owned >= total && total > 0
      ? '全部达成 —— 你是真正的金牌骑手！'
      : '继续跑单，解锁更多称号'));
  p.appendChild(stat);

  /* ---- 成就列表 ---- */
  if (!items.length) {
    /* 兜底：两张表都拿不到时不让页面空白 */
    p.appendChild(el('div', 'sub', '（暂时没有可展示的成就）'));
  }

  const list = el('div', 'ach-list');
  items.forEach(function (it) {
    const got = (typeof SAVE === 'function') && SAVE().hasTitle(it.title);

    const row = el('div', 'ach-row' + (got ? ' got' : ' locked'));

    /* 左：状态图标（★ 图标 + 文字双表达，不只靠颜色） */
    row.appendChild(el('div', 'ach-icon', got ? '🏆' : '🔒'));

    /* 中：称号名 + 条件 + 所属关卡 */
    const body = el('div', 'ach-body');

    const head = el('div', 'ach-head');
    head.appendChild(el('span', 'ach-name', it.title));
    /* ★ 未解锁的**必须显示条件文字**（方案 A），
     *   不要用一个问号占位符把它藏起来 —— 玩家看不到目标就没有追求。 */
    head.appendChild(el('span', 'ach-state', got ? '已达成' : '未达成'));
    /* 进度：只有"有进度概念的"成就才显示（比如 累计 5 / 20）。
     * ⚠️ 已达成时不再显示进度 —— 拿到手了，"3/3"是废话。
     * ⚠️ 进度用**文字**而不是进度条：项目里没有进度条组件，
     *    而且纯文字对色盲玩家更友好。 */
    if (!got && it.progress && typeof it.progress.now === 'number') {
      const pr = el('span', 'ach-prog',
        it.progress.now + ' / ' + it.progress.total);
      head.appendChild(pr);
    }
    body.appendChild(head);

    body.appendChild(el('div', 'ach-cond', it.condition));

    /* 来源：神秘订单显示"第 N 关"，全局成就显示"全局成就" */
    body.appendChild(el('div', 'ach-from', it.from));

    row.appendChild(body);
    list.appendChild(row);
  });
  p.appendChild(list);

  /* ---- 底部返回（和角色库底部按钮一致，长列表滚到底也能回）---- */
  const foot = el('div', 'ach-foot');
  foot.appendChild(btn('返回', null, function () { goMenu(); }));
  p.appendChild(foot);
}

/* ============================================================
 * 角色库 / 骑手档案
 * ============================================================
 * ⚠️ 页面结构（2026-10-06 整理）：
 *   ① 只有一个卡片（外层 .panel），内部只用行/条，不嵌卡片
 *   ② **不能只靠颜色区分状态** —— 已选角色除了描边高亮，
 *      还有文字标记"✓ 使用中"（不再有"🔒 未解锁"——见下面 ④）
 *   ③ **未制作的角色不能出现** —— 不要自己遍历 CHARACTERS
 *   ④ ★ **未解锁的角色不能出现**（2026-10-06 十一要求）——
 *      用 listVisibleChars() 过滤（= 已制作 + 已解锁）。
 *      原来这里遍历 listForLibrary()，然后给没解锁的画一张
 *      "黑影 + 🔒 + 通关第 N 关后解锁"的卡片 —— 对新角色那是剧透。
 *      **那整段"未解锁"渲染代码已经删掉了**，见下面的 ★ 双保险 ★。
 * ============================================================ */
function buildCharLibrary() {
  const p = newPanel();

  if (!p) return;

  /* ============================================================
   * ★ 角落按钮条：返回 / 换骑手开跑（2026-10-06 新增）★
   * ============================================================
   * 和「接一单」页同一个做法（见 buildLevelSelect 里的详细说明）：
   *   sticky 吸在面板顶部 → 长列表滚到哪都够得着，不用往下翻。
   *   十一的要求："角色库这个也是，左上角"
   * ⚠️ 品牌标签并到同一行右侧，否则会被吸顶的按钮条压住
   *    （在「接一单」页实测过：重叠 14px）。
   * ============================================================ */
  const corner = el('div', 'panel-corner');
  const cornerBtns = el('div', 'panel-corner-btns');
  cornerBtns.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
  cornerBtns.appendChild(btn('换骑手开跑', null, function () {
    gotoState(STATE.SINGLE_PICK);
  }, 'small'));
  corner.appendChild(cornerBtns);
  corner.appendChild(el('div', 'panel-corner-brand', '角色库'));
  p.appendChild(corner);

  p.appendChild(el('h1', null, '骑手档案'));
  p.appendChild(el('div', 'sub', '每个骑手都有自己的长处，没有谁绝对更强'));

  /* ============================================================
   * ★ [骑手] / [成就] tab（2026-10-06）★
   * ============================================================
   * 十一的入口方案 B —— 加**两个 tab**，默认选中「骑手」。
   *
   * ⚠️⚠️ 这里**只加了一个 tab 条**，下面原有的角色卡渲染**一行都没动**：
   *     · `listVisibleChars()` 过滤（零剧透）—— 原样
   *     · 卡片循环开头的 `if (!unlocked) return;` 双保险 —— 原样
   *     · 主菜单"角色库 · N 名骑手"的计数走的是**另一个函数**，
   *       和这里无关
   *   成就和"角色剧透"是两件完全不同的事（见 buildAchievements 的说明），
   *   不能因为加了 tab 就顺手统一口径。
   * ============================================================ */
  p.appendChild(buildLibTabs('char'));

  const list = el('div', 'lib-list');
  const selId = SAVE().selectedChar();

  /* 只遍历"玩家看得见"的角色 ——
   * ★ 2026-10-06 改动（十一要求）：未解锁的角色**一点线索都不给**。
   *
   *   原来这里遍历 listForLibrary()（= 所有已制作的角色），
   *   然后给没解锁的那几个画一张"黑影 + 名字 + 能力条 + 通关第 N 关解锁"的卡片。
   *   对卡皮巴拉来说这是**剧透**：玩家一进角色库就看到第 3 个人存在。
   *
   *   现在改成 listVisibleChars()（= 已制作 + 已解锁），
   *   没拿到手的角色压根不渲染 —— 它会在通关第 10 关那一刻
   *   作为惊喜登场。 */
  listVisibleChars().forEach(function (c) {
    const unlocked = SAVE().hasChar(c.id);
    const isSel = (c.id === selId);

    /* ★★ 双保险：拿不到手的角色，一张卡都不许画 ★★
     *
     * 光靠 listVisibleChars() 过滤是不够的 —— 万一以后有人改坏了那里、
     * 或者在别处误用这张表，这里能兜住最后一道。
     * 原则是：**宁可什么都不画，也不画一张黑影/锁头/问号**，
     * 因为那等于告诉玩家"还有一个你没见过的人"。
     *
     * （2026-10-06 十一要求：卡皮巴拉在通关第 10 关之前一点线索都不给。）
     */
    if (!unlocked) return;

    const card = el('div', 'lib-card');
    card.setAttribute('data-char', c.id);
    /* ⚠️ 用 class 表达状态，但**不依赖颜色**——
     *    每种状态都另有文字标记，色盲玩家也能分清。 */
    if (!unlocked) card.classList.add('locked');
    if (isSel) card.classList.add('active');

    /* ---- 左：形象 ---- */
    const left = el('div', 'lib-left');
    const cv = document.createElement('canvas');
    cv.width = 88; cv.height = 88;
    cv.className = 'lib-avatar';
    /* ★ 2026-10-06：这里**只有一个分支**了（原先是 if(unlocked)/else 两支）。
     * ============================================================
     * 为什么要删掉 else 那一支：
     *   原来 else 走 paintCharSilhouette()（画黑影 + 问号），
     *   是"让玩家知道这里有个角色但看不清是谁"的旧设计。
     *   但十一现在的要求是**零剧透** —— 卡皮巴拉在通关第 10 关前
     *   **一点线索都不给**，连"还有一个角色"这件事都不能透露。
     * ⇒ 黑影/问号/锁头全都属于剧透，必须去掉。
     *
     * ⚠️ 虽然上面已经有 `if (!unlocked) return;` 拦着、这个分支走不到，
     *    但**留着就是隐患**：万一以后有人把 listVisibleChars 改回
     *    listForLibrary，这段死代码会立刻复活、把卡皮巴拉画成黑影卖出去。
     *    删掉它 = 就算那种情况发生，也只是"这张卡不显示"，不会剧透。
     *    （这就是十一要的"双保险"：改坏了只会不画，不会画出黑影。）
     * ============================================================ */
    paintCharPreview(cv, c.role);
    left.appendChild(cv);
    left.appendChild(el('div', 'lib-name', c.name));
    left.appendChild(el('div', 'lib-tagline', c.tagline));
    card.appendChild(left);

    /* ---- 中：能力条 ---- */
    const mid = el('div', 'lib-mid');
    const attrRows = [
      { k: 'speed', label: '移动速度' },
      { k: 'jump',  label: '跳跃能力' },
      { k: 'dash',  label: '冲刺能力' },
      { k: 'wall',  label: '抓墙能力' },
    ];
    attrRows.forEach(function (a) {
      const v = (c.strengths && c.strengths[a.k]) || 3;
      const row = el('div', 'attr-row');
      row.appendChild(el('span', 'attr-label', a.label));
      const bar = el('div', 'attr-bar');
      for (let i = 1; i <= 5; i++) {
        const cell = el('i', 'attr-cell' + (i <= v ? ' filled' : ''));
        bar.appendChild(cell);
      }
      row.appendChild(bar);
      /* 数字也要写出来 —— 光靠格子长度，色弱/小屏上都看不清 */
      row.appendChild(el('span', 'attr-val', String(v)));
      mid.appendChild(row);
    });
    /* 弱点也用文字说清，不做成"负的条"（那样不好懂） */
    if (c.weaknesses && c.weaknesses.length) {
      mid.appendChild(el('div', 'lib-weak', '弱项：' + c.weaknesses.join('、')));
    }
    mid.appendChild(el('div', 'lib-desc', c.description));
    card.appendChild(mid);

    /* ---- 右：状态 / 成绩 / 操作 ---- */
    const right = el('div', 'lib-right');

    if (unlocked) {
      /* 状态标记：文字 + 符号，不只有颜色 */
      right.appendChild(el('div', 'lib-state' + (isSel ? ' ok' : ''),
        isSel ? '✓ 使用中' : '已解锁'));

      /* 各关最佳成绩（该角色自己的记录） */
      const recTitle = el('div', 'lib-rectitle', '各关最佳用时');
      right.appendChild(recTitle);
      const recs = el('div', 'lib-records');
      const levels = PLAYABLE_LEVELS();
      let hasAny = false;
      levels.forEach(function (lv, i) {
        const t = SAVE().charBestTime(c.id, i);
        if (t == null) return;
        hasAny = true;
        const line = el('div', 'lib-rec-line');
        line.appendChild(el('span', 'lr-name', '第' + (i + 1) + '关'));
        line.appendChild(el('span', 'lr-time', formatTime(t)));
        recs.appendChild(line);
      });
      if (!hasAny) {
        recs.appendChild(el('div', 'lib-rec-none', '还没用这个骑手跑过'));
      }
      right.appendChild(recs);

      /* 使用次数 —— 让玩家看到自己偏爱谁 */
      const uses = SAVE().charRecord(c.id).uses || 0;
      right.appendChild(el('div', 'lib-uses', '出战 ' + uses + ' 次'));

      if (!isSel) {
        right.appendChild(btn('选为骑手', null, function () {
          SAVE().setSelectedChar(c.id);
          /* ★ 直接用这个角色的 role（c 就是配置对象，不用再查表。
           *   ⚠️ 但仍要过一层白名单校验 —— 配置写错了也别把非法值塞进去。 */
          Game.pickRole = roleOfSelection(c.id);
          UI.lastKey = '';
          syncUI();
        }, 'small'));
      } else {
        /* 已选中的给个禁用感的标记，而不是一个能点的"选为骑手" */
        const tag = el('div', 'lib-current', '当前骑手');
        right.appendChild(tag);
      }
    }

    /* ★ 这里原来有一段"未解锁"的渲染（🔒 + 通关第 N 关后解锁）。
     *   2026-10-06 删掉了 —— 它对新角色是剧透。
     *   走到这里的角色一定已经解锁（上面有双保险 return），
     *   所以**不需要也不允许**再画任何"未解锁"的样子。 */

    card.appendChild(right);
    list.appendChild(card);
  });

  p.appendChild(list);

  /* 底部：说明（保留）
   * ⚠️ 原来下面还有一排「返回 / 换骑手开跑」按钮，
   *    2026-10-06 已搬到页面**最上方的角落条**（.panel-corner），
   *    原因同「接一单」页：角色多起来之后要往下翻才能按到。
   *    所以这里**故意不再加底部按钮**。 */
  p.appendChild(el('div', 'lib-note',
    '角色不会因为"后解锁"就一定更强 —— ' +
    '每个骑手都有擅长和不擅长的地方，任何骑手都能独立跑完全部路线。'));
}

/* ============================================================
 * ⚠️ 这里原来有一个 paintCharSilhouette()（画未解锁角色的黑影 + 问号）
 * ============================================================
 * 2026-10-06 十一要求"零剧透"之后**已整体删除**，原因是它和需求直接冲突：
 *   · 旧作用：让玩家知道"角色库里还有个我没见过的骑手"
 *   · 新要求：卡皮巴拉在通关第 10 关之前**一点线索都不给**，
 *            连"还有别的角色"这件事都不能透露
 * ⇒ 黑影/问号/锁头/剪影 全部属于剧透，一律不许出现。
 *
 * ⚠️ 如果你正想加回一个"未解锁提示"——先读 requirements：
 *    十一明确列过禁止清单（锁定卡片 / 黑色剪影 / 问号占位 /
 *    "coming soon" / 灰头像 / "还有 N 名骑手没解锁" / "通关第 N 关解锁 XXX"）。
 *    角色库靠 listVisibleChars() 直接把未解锁的过滤掉，不给任何暗示。
 *    回归守卫在 tests/unlock-test.js 的 H 节（12 项）。
 * ============================================================ */


/* ---------------- 单人：选骑手 ---------------- */

/* ============================================================
 * 按键说明页
 * ============================================================
 * 为什么需要它：
 *   游戏里加了一整套新动作（滑墙 / 墙跳 / 八方冲刺），
 *   纯靠文字提示根本说不清 —— 十一说"很多按键还不太懂，比如冲刺"。
 *
 * 设计：**图文分级**
 *   ① 基础操作    —— 一眼就会的（移动/跳/暂停）
 *   ② 进阶动作    —— 需要理解的（滑墙/墙跳/冲刺），每个配小图示 + 一句话
 *   ③ 冲刺详解    —— 最容易懵的动作，单独展开讲
 *
 * 图示用 canvas 画（不是图片）—— 这样零资源依赖，
 * 单文件版也能正常显示，而且能跟着主题色调。
 * ============================================================ */
/* ============================================================
 * ★ 👤 账号系统 —— 三个页面（2026-10-06 十一要求）★
 * ============================================================
 * 十一的要求原文：
 *   "支持在本机创建多个账号并在其间切换；创建账号时需输入昵称和密码，
 *    且本机已存在的账号昵称不可重复；切换账号时需输入对应密码进行验证；
 *    退出账号后返回未登录状态。交互流程上，玩家首次打开游戏并点击
 *    「开始」后，应自动弹出创建账号界面；后续创建账号、切换账号和
 *    退出账号的入口统一放在设置菜单中。"
 *
 * ------------------------------------------------------------
 * ★ 三个页面怎么分工（看 STATE 里那段注释）
 * ------------------------------------------------------------
 *   buildAccountWelcome  首次、一个账号都没有 → 创建第一个账号
 *   buildAccountPick     选账号（本机有多个时）→ 也是"退出后"的落地页
 *   buildAccountLogin    输密码 → 验证过了才切
 *
 * ------------------------------------------------------------
 * ★★ 一条硬规矩：这里所有地方都**必须**通过 ACCOUNT 公开方法访问账号，
 *    绝不直接读 localStorage。★★
 *    原因：以后升级到云端时，只有 ACCOUNT 这一层要改，
 *    UI 一行都不用动。绕过它 = 把升级路径堵死。
 * ------------------------------------------------------------ */

/* 账号模块不可用时（理论上不会，但要有兜底）给一句人话 */
function accountReady() {
  return (typeof ACCOUNT !== 'undefined' && ACCOUNT && typeof ACCOUNT.list === 'function');
}

/* ============================================================
 * ★ 安全地给输入框设 maxLength（2026-10-06 修 bug 时加）★
 * ============================================================
 * 【为什么需要这个 helper】
 *   十一报的 bug："跳到创建账号那一块，那个密码框里面不显示字，
 *                  就是输不进去字"。
 *
 *   根因：我写的是 `passInput.maxLength = ACCOUNT._internals.PASS_MAX`，
 *   而 `_internals` 里**恰好漏了 PASS_MAX**（只暴露了 NAME_MAX / PASS_MIN）。
 *   ⇒ `maxLength = undefined` → 浏览器当成 **0** →
 *     **一个字都打不进去**，而且**完全不报错**，极其隐蔽。
 *
 *   ⇒ 修法有两层：
 *     ① 把限额挪到公开的 `ACCOUNT.LIMITS`（UI 该用的就该是公开的）
 *     ② 加这个 helper 兜底 —— 以后就算字段又缺了，
 *        也只会"不限制长度"，**绝不会变成"打不进字"**
 *
 *   ⚠️ 记住这个规律：**给 DOM 设数值属性时，undefined 会静默变成 0**。
 *      凡是喂给 DOM 的数字，都必须先确认是有效数字。
 * ============================================================ */
function setMaxLen(input, n, fallback) {
  const v = (typeof n === 'number' && isFinite(n) && n > 0) ? n : fallback;
  /* 兜底值取一个"宽松但有上限"的数（不是 0！）——
   * 宁可让玩家多打几个字被 validate 拦下，也不能让他一个字都打不进。 */
  input.maxLength = (typeof v === 'number' && v > 0) ? v : 64;
}

/* 从账号模块读限额（读不到就给默认值）。 */
function accLimit(key, dflt) {
  try {
    if (typeof ACCOUNT !== 'undefined' && ACCOUNT && ACCOUNT.LIMITS) {
      const v = ACCOUNT.LIMITS[key];
      if (typeof v === 'number' && isFinite(v) && v > 0) return v;
    }
  } catch (e) { /* 忽略，走默认值 */ }
  return dflt;
}

/* ============================================================
 * 创建账号页（也叫"欢迎页" —— 第一次打开游戏看到的就是它）
 * ============================================================ */
function buildAccountWelcome() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('骑手注册'));

  const isFirst = !accountReady() || ACCOUNT.count() === 0;
  p.appendChild(el('h1', null, isFirst ? '先给自己起个名字' : '再建一个账号'));
  p.appendChild(el('div', 'sub',
    isFirst ? '这台电脑上的进度会存在你的账号里'
      : '每个账号有自己独立的进度，互不影响'));

  /* ---- 表单 ---- */
  const form = el('div', 'acc-form');

  form.appendChild(el('div', 'acc-label', '昵称'));
  const nameInput = el('input', 'acc-input');
  nameInput.type = 'text';
  nameInput.maxLength = accLimit('NAME_MAX', 12);
  nameInput.placeholder = '最多 ' + accLimit('NAME_MAX', 12) + ' 个字';
  nameInput.autocomplete = 'off';
  form.appendChild(nameInput);

  const nameHint = el('div', 'acc-hint', '');
  form.appendChild(nameHint);

  form.appendChild(el('div', 'acc-label', '密码'));
  const passInput = el('input', 'acc-input');
  passInput.type = 'password';
  setMaxLen(passInput, accLimit('PASS_MAX', 32), 32);
  passInput.placeholder = '至少 ' + accLimit('PASS_MIN', 4) + ' 位';
  form.appendChild(passInput);

  form.appendChild(el('div', 'acc-label', '再输一次密码'));
  const pass2Input = el('input', 'acc-input');
  pass2Input.type = 'password';
  setMaxLen(pass2Input, accLimit('PASS_MAX', 32), 32);
  pass2Input.placeholder = '两次要一样';
  form.appendChild(pass2Input);

  const errBox = el('div', 'acc-error', '');
  form.appendChild(errBox);

  p.appendChild(form);

  /* ---- 即时提示：昵称有没有被占用 ----
   * ⚠️ 只在"输完了"才提示（blur 或不为空时），别一上来就红字吓人。 */
  function refreshNameHint() {
    const v = nameInput.value;
    if (!v.trim()) { nameHint.textContent = ''; nameHint.className = 'acc-hint'; return; }
    const vn = ACCOUNT.validateName(v);
    if (!vn.ok) {
      nameHint.textContent = vn.message;
      nameHint.className = 'acc-hint bad';
      return;
    }
    if (ACCOUNT.nameTaken(v)) {
      nameHint.textContent = '这个昵称已经有人用了';
      nameHint.className = 'acc-hint bad';
      return;
    }
    nameHint.textContent = '可以用';
    nameHint.className = 'acc-hint good';
  }
  nameInput.addEventListener('input', refreshNameHint);

  function showErr(msg) {
    errBox.textContent = msg || '';
    errBox.className = 'acc-error' + (msg ? ' on' : '');
  }

  function doRegister() {
    const r = ACCOUNT.register(nameInput.value, passInput.value, pass2Input.value);
    if (!r.ok) {
      showErr(r.message || '创建失败');
      /* 焦点给到最该改的那个框 —— 免得玩家对着错误提示发愣 */
      if (r.code === 'NAME_TAKEN' || r.code === 'BAD_NAME') nameInput.focus();
      else passInput.focus();
      return;
    }
    /* ★ 成功了：把存档切到这个新账号名下再进游戏 ★
     * ⚠️ 顺序：register() 内部已经把 currentId 设成新账号了，
     *    所以这里 reload() 就会读到"这个账号的档"。
     *    （第一个账号会被 adoptLegacySave 认领老进度，见 account.js） */
    try { SAVE().reload(); } catch (e) { }
    Sound.win();
    gotoState(STATE.MENU);
  }

  const row = el('div', 'row');
  row.appendChild(btn(isFirst ? '创建并开始' : '创建账号', null, doRegister, 'primary'));
  /* 已经有账号了 → 给个"去登录"的出口（别让多账号玩家卡在注册页） */
  if (!isFirst) {
    row.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
  }
  p.appendChild(row);

  /* 回车提交（键盘玩家的顺手操作） */
  [nameInput, passInput, pass2Input].forEach(function (inp) {
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doRegister(); }
    });
  });

  nameInput.focus();
}

/* ============================================================
 * 选账号页（未登录状态的"主页"）
 * ============================================================
 * 十一要求："退出账号后返回未登录状态。"
 * 这个页面就是那个"未登录状态" —— 列出本机所有账号，
 * 点一个去输密码。也提供"新建账号"的入口。
 * ============================================================ */
function buildAccountPick() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('切换账号'));

  const list = accountReady() ? ACCOUNT.list() : [];

  p.appendChild(el('h1', null, '这局谁在玩？'));
  p.appendChild(el('div', 'sub', '点一个账号，输密码就能接着玩'));

  if (!list.length) {
    /* 一个账号都没有（比如被删光了）→ 直接引导去创建 */
    p.appendChild(el('div', 'sub', '这台电脑上还没有任何账号'));
    p.appendChild(btn('创建一个账号', null, function () {
      gotoState(STATE.ACCOUNT_WELCOME);
    }, 'primary'));
    p.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
    return;
  }

  const wrap = el('div', 'acc-list');
  /* 最近登录的排最前（玩家最可能点那个） */
  const sorted = list.slice().sort(function (a, b) {
    return (b.lastLoginAt || 0) - (a.lastLoginAt || 0);
  });
  sorted.forEach(function (acc) {
    const card = el('div', 'acc-card');
    card.setAttribute('data-acc-id', acc.id);
    card.setAttribute('data-acc-name', acc.name);

    /* 头像用昵称首字（本机系统没有头像图，首字圆圈最省事也最清楚） */
    const av = el('div', 'acc-avatar', acc.name.slice(0, 1));
    card.appendChild(av);

    const info = el('div', 'acc-info');
    info.appendChild(el('div', 'acc-name', acc.name));
    info.appendChild(el('div', 'acc-meta', acc.lastLoginAt
      ? '上次登录：' + formatAccDate(acc.lastLoginAt)
      : '还没登录过'));
    card.appendChild(info);

    card.appendChild(el('div', 'acc-go', '›'));

    /* 点头像/名字那块 → 去输密码登录 */
    card.addEventListener('click', function (e) {
      e.stopPropagation();
      Sound.uiClick();
      /* 记住"要点哪个账号"，送去输密码页 */
      UI.loginTargetId = acc.id;
      gotoState(STATE.ACCOUNT_LOGIN);
    });

    /* ============================================================
     * ★ 删除按钮（2026-10-07 十一要求）★
     * ============================================================
     * 十一："切换账号里面可以删除账号功能" ——
     *   原来删除入口只藏在**设置页**深处，要切个号还得先绕过去。
     *   ⇒ 直接在每张账号卡上放一个删除按钮，就地删。
     *
     * ⚠️ 为什么用 stopPropagation：
     *    卡片整块绑了"点击 = 去登录"。删除按钮在卡片**内部**，
     *    不拦住的话点删除会先触发登录跳转 —— 那就永远删不掉了。
     *
     * ⚠️ 删除仍然走**完整的两道关**（二次确认 + 输密码），
     *    这里只是把入口提前，安全级别一点没降。 */
    const delBtn = el('button', 'acc-del', '删除');
    delBtn.type = 'button';
    delBtn.setAttribute('title', '删除这个账号（连同它的进度）');
    delBtn.addEventListener('click', function (e) {
      /* ⚠️ 两层都要拦：click 会冒泡到 card 上触发登录。
       *    preventDefault 挡浏览器默认行为，stopPropagation 挡冒泡。 */
      e.preventDefault();
      e.stopPropagation();
      Sound.uiClick();
      UI.deleteAccountName = acc.name;
      /* 取消时回到**账号选择页**（不是设置页）—— 见 openDeleteAccountDialog */
      openDeleteAccountDialog(acc, STATE.ACCOUNT_PICK);
    });
    card.appendChild(delBtn);

    wrap.appendChild(card);
  });
  p.appendChild(wrap);

  p.appendChild(btn('＋ 新建一个账号', '每个账号有自己独立的进度', function () {
    gotoState(STATE.ACCOUNT_WELCOME);
  }, 'small'));

  p.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
}

/* 时间戳 → "10月6日 22:30" 这种能看懂的形式 */
function formatAccDate(ts) {
  try {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  } catch (e) { return '很久以前'; }
}

/* ============================================================
 * 输密码页
 * ============================================================ */
function buildAccountLogin() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('验证身份'));

  const list = accountReady() ? ACCOUNT.list() : [];
  let target = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === UI.loginTargetId) { target = list[i]; break; }
  }
  /* 目标账号被删了 / 没设过 → 退回选账号页（不报错，静默回退） */
  if (!target) {
    gotoState(list.length ? STATE.ACCOUNT_PICK : STATE.ACCOUNT_WELCOME);
    return;
  }

  const head = el('div', 'acc-login-head');
  head.appendChild(el('div', 'acc-avatar big', target.name.slice(0, 1)));
  head.appendChild(el('div', 'acc-name big', target.name));
  p.appendChild(head);

  p.appendChild(el('div', 'sub', '输入密码继续'));

  const form = el('div', 'acc-form');
  const passInput = el('input', 'acc-input');
  passInput.type = 'password';
  setMaxLen(passInput, accLimit('PASS_MAX', 32), 32);
  passInput.placeholder = '密码';
  form.appendChild(passInput);

  const errBox = el('div', 'acc-error', '');
  form.appendChild(errBox);
  p.appendChild(form);

  function showErr(msg) { errBox.textContent = msg || ''; errBox.className = 'acc-error' + (msg ? ' on' : ''); }

  function doLogin() {
    const r = ACCOUNT.login(target.id, passInput.value);
    if (!r.ok) {
      showErr(r.message || '密码不对');
      passInput.select();
      return;
    }
    /* ★ 切换生效：把存档重读一遍（换成这个账号的档）★
     * ⚠️ 顺序不能反 —— ACCOUNT.login() 已经改了 currentId，
     *    这时 reload() 才会读到正确的 key。 */
    try { SAVE().reload(); } catch (e) { }
    applySoundFromSave();
    Sound.win();
    gotoState(STATE.MENU);
  }

  const row = el('div', 'row');
  row.appendChild(btn('进入游戏', null, doLogin, 'primary'));
  row.appendChild(btn('换个账号', null, function () { gotoState(STATE.ACCOUNT_PICK); }, 'small'));
  p.appendChild(row);

  /* ---- "忘记密码怎么办" 的说明 ----
   * ⚠️ 必须如实说：本机系统**没有**找回密码的能力。
   *    偷偷留个后门（万能密码）会让整个密码功能变成摆设，
   *    那比"承认没有找回"糟得多。 */
  p.appendChild(el('div', 'acc-forgot',
    '忘记密码？本机账号没有找回功能 —— 只能删掉这个账号重新开始（进度会一起没）。'));

  passInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
  });
  passInput.focus();
}

/* 把存档里的音效设置套用上去（切换账号后要重新套 —— 每个账号设置不同） */
function applySoundFromSave() {
  try {
    var st = SAVE().settings();
    if (!st) return;
    if (typeof Sound !== 'undefined') {
      if (typeof Sound.setEnabled === 'function') Sound.setEnabled(st.soundOn !== false);
      if (typeof Sound.setVolume === 'function') {
        Sound.setVolume(typeof st.volume === 'number' ? st.volume : 0.7);
      }
    }
  } catch (e) { /* 音效套用失败不影响进场 */ }
}

/* ============================================================
 * 删除账号（两段式确认 + 要输密码）
 * ============================================================
 * 为什么这么严：
 *   删账号会**连带删掉那个账号的所有进度**，不可恢复。
 *   所以要走两道关：
 *     ① 二次确认（第一次点只是"真的删？"）
 *     ② 输密码（证明你确实是这个账号的主人）
 *
 * ⚠️ 输密码这一步不是多余的 —— 它挡住了"室友趁你不在删你号"
 *    这种本机多账号的经典事故。
 * ============================================================ */
/**
 * 打开"删除账号"弹窗。
 *
 * @param acc     要删的账号（publicOf 形状的对象）
 * @param backTo  ★ 取消/删完之后回到哪个界面。
 *                现在有两个入口：
 *                  · 设置页（STATE.SETTINGS）
 *                  · 账号选择页（STATE.ACCOUNT_PICK）
 *                ⚠️ 原来这里**硬编码返回 SETTINGS** ——
 *                   从"切换账号"页点进来再点取消，会被突兀地踢到设置页
 *                   （明明是"算了"，却跳去了另一个毫不相干的界面）。
 *                ⇒ 改成由调用方指定，两处入口各自正确返回。
 */
function openDeleteAccountDialog(acc, backTo) {
  const target = backTo || STATE.ACCOUNT_PICK;
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('删除账号'));

  p.appendChild(el('h1', null, '真的不要这个账号了？'));

  const warn = el('div', 'acc-warn');
  warn.appendChild(el('div', null, '「' + acc.name + '」的进度会被一起删掉'));
  warn.appendChild(el('div', 'acc-warn-sub',
    '这个账号玩过的关卡、骑手、称号都会没，而且找不回来。'));
  p.appendChild(warn);

  p.appendChild(el('div', 'acc-label', '输入密码确认是你本人'));
  const form = el('div', 'acc-form');
  const passInput = el('input', 'acc-input');
  passInput.type = 'password';
  setMaxLen(passInput, accLimit('PASS_MAX', 32), 32);
  passInput.placeholder = '密码';
  form.appendChild(passInput);
  const errBox = el('div', 'acc-error', '');
  form.appendChild(errBox);
  p.appendChild(form);

  function showErr(m) { errBox.textContent = m || ''; errBox.className = 'acc-error' + (m ? ' on' : ''); }

  function doDelete() {
    const r = ACCOUNT.remove(acc.id, passInput.value);
    if (!r.ok) { showErr(r.message || '删除失败'); passInput.select(); return; }
    /* 删掉的如果正是当前账号 → 变成未登录，存档也要重读 */
    try { SAVE().reload(); } catch (e) { }
    Sound.uiClick();
    /* 删完回账号选择页 —— 那里能看到"少了一个账号"。
     * ⚠️ 如果删的是**最后一个**账号，回 ACCOUNT_PICK 会看到
     *    "这台电脑上还没有任何账号" + 创建引导（buildAccountPick 已处理）。 */
    gotoState(STATE.ACCOUNT_PICK);
  }

  const row = el('div', 'row');
  row.appendChild(btn('确认删除', null, doDelete, 'danger'));
  row.appendChild(btn('算了，返回', null, function () { gotoState(target); }, 'small'));
  p.appendChild(row);

  passInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doDelete(); }
  });
  passInput.focus();
}

function buildHelp() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('骑手手册'));

  const h = el('h1', null, '按键说明');
  h.className = 'help-title';
  p.appendChild(h);
  p.appendChild(el('div', 'sub', '滑墙、墙跳、八方冲刺 —— 一次看懂'));

  /* 让面板可以滚动（说明内容比一个屏幕长） */
  const box = el('div', 'help-box');
  p.appendChild(box);

  /* ---------------- ① 基础操作 ---------------- */
  box.appendChild(helpSection('① 基础操作', '这些记住就够了，玩起来很自然'));

  box.appendChild(helpRow({
    icon: 'move',
    title: '左右移动',
    keys: '← → ／ A D',
    desc: '袋鼠用方向键，奶龙用 A D。按住会加速，松开慢慢停下。',
  }));

  box.appendChild(helpRow({
    icon: 'jump',
    title: '跳跃',
    keys: '↑ ／ W ／ 空格',
    desc: '站在地面上才能跳。空中还能再跳一次（二连跳），会翻个跟头。',
    actionId: 'doublejump',      // 二连跳那条要标解锁状态
  }));

  box.appendChild(helpRow({
    icon: 'pause',
    title: '暂停 / 重开',
    keys: 'ESC ／ R',
    desc: 'ESC 暂停，R 重跑本单。过关后按空格进下一单。',
  }));

  /* ---------------- ② 进阶动作 ---------------- */
  box.appendChild(helpSection('② 进阶动作', '要通关才解锁 —— 一个动作一个动作学'));

  box.appendChild(helpRow({
    icon: 'wallslide',
    title: '贴墙滑行',
    keys: '碰到墙自动触发',
    desc: '在空中贴住竖直墙面时，下落会**自动变慢**（80 的速度，比自由落体慢得多）。' +
          '碰到墙就行，不用按键。',
    actionId: 'wallslide',
  }));

  box.appendChild(helpRow({
    icon: 'wallgrab',
    title: '抓墙（更慢，但耗体力）',
    keys: '按住朝墙的方向键',
    desc: '贴墙时**按住朝墙那边**的方向键，会抓住墙、几乎停住。' +
          '但要消耗**抓墙体力**（1.2 秒耗尽），体力空了你就会直接掉下去。' +
          '左上角骑手卡下方的蓝条就是体力。',
    actionId: 'wallslide',       // 抓墙是滑墙系统的一部分，共用解锁状态
  }));

  box.appendChild(helpRow({
    icon: 'walljump',
    title: '墙跳（蹬墙跳）',
    keys: '贴墙时按 跳跃键',
    desc: '贴着墙按跳，会**朝墙的反方向弹出去**。' +
          '两面墙来回蹬，就能一路爬上去 —— 第 5 关那口井就是这么过的。',
    actionId: 'walljump',
  }));

  box.appendChild(helpRow({
    icon: 'dash',
    title: '八方冲刺 ★',
    keys: 'Z + 方向键',
    desc: '按住 <kbd>Z</kbd> 再按方向键，会朝那个方向**极速冲出去**（110 像素）。使用后需要等待5秒。' +
          '关键：**八个方向都能冲** —— 上下左右，还有四个斜角。' +
          '空中每次落地只能用 1 次，落地就恢复；冲刺过程中有短暂的**无敌**，能穿尖刺。',
    actionId: 'dash',
  }));

  /* ---------------- ③ 冲刺详解 ---------------- */
  box.appendChild(helpSection('③ 冲刺详解', '这个最容易搞不懂，单独讲一下'));

  const dashBox = el('div', 'help-dash');
  dashBox.appendChild(el('div', 'hd-title', '怎么按出冲刺？'));
  const steps = el('div', 'hd-steps');
  [
    '按住 F 键',
    '同时按一个方向键（← ↑ → ↓ 或组合）',
    '角色就会朝那个方向冲出去',
  ].forEach(function (s, i) {
    const line = el('div', 'hd-step');
    line.appendChild(el('span', 'hd-num', String(i + 1)));
    line.appendChild(el('span', null, s));
    steps.appendChild(line);
  });
  dashBox.appendChild(steps);

  /* 八方向示意图：用 canvas 画一个圆 + 八根箭头 */
  const dia = document.createElement('canvas');
  dia.className = 'hd-diagram';
  dia.width = 168;
  dia.height = 168;
  dashBox.appendChild(dia);
  paintDir8Diagram(dia);

  dashBox.appendChild(el('div', 'hd-note',
    '冲刺方向的判断：如果你按了方向键，就按方向键冲；' +
    '没按方向键的话，默认朝你面朝的方向冲。'));
  dashBox.appendChild(el('div', 'hd-warn',
    '空中限 1 次 —— 想再冲必须落地。左上角紫色菱形格就是剩余次数。'));

  /* ⚠️ 别忘了挂到滚动区上！
   * 踩过的坑：上面把内容都塞进了 dashBox，但漏了这一步 ——
   * 结果冲刺详解区整块都不显示，而文字又"看起来"在页面上
   * （因为关键文案也出现在别处），非常难发现。 */
  box.appendChild(dashBox);

  /* ---------------- 底部：返回 ---------------- */
  p.appendChild(btn('返回主菜单', '看完了，回去跑单', function () {
    goMenu();
  }, 'primary'));
}

/* 说明页的一节标题 */
function helpSection(title, sub) {
  const d = el('div', 'help-sec');
  d.appendChild(el('div', 'hs-title', title));
  if (sub) d.appendChild(el('div', 'hs-sub', sub));
  return d;
}

/* 说明页的一行（图标 + 标题 + 按键 + 说明） */
/* 说明页的一行（图标 + 标题 + 按键 + 说明）
 *
 * @param o.actionId  可选。给了就按"动作解锁状态"渲染：
 *    · 已解锁 → 正常显示
 *    · 未解锁 → 整行压暗 + 加一个"通关第 N 关解锁"的标签
 *
 * ⚠️ 为什么要区分：动作是**逐步解锁**的。
 *    如果玩家一进说明页就看到"八方冲刺 Shift+方向键"，
 *    他会去按、按了没反应，然后认定"这游戏有 bug"。
 *    显示成"灰色 + 还没解锁"，玩家就明白了 —— 而且产生期待。 */
function helpRow(o) {
  const row = el('div', 'help-row');

  /* 判断解锁状态（没给 actionId 的就是常驻能力，永远算已解锁） */
  let locked = false;
  let unlockLevel = 0;
  if (o.actionId && typeof isActionUnlocked === 'function') {
    locked = !isActionUnlocked(o.actionId);
    if (locked && typeof ACTION_UNLOCKS !== 'undefined') {
      const def = ACTION_UNLOCKS.filter(function (u) { return u.id === o.actionId; })[0];
      if (def) unlockLevel = def.afterLevel;
    }
  }
  if (locked) row.classList.add('locked');

  /* 左侧小图示 */
  const c = document.createElement('canvas');
  c.className = 'hr-icon';
  c.width = 56;
  c.height = 56;
  row.appendChild(c);
  paintActionIcon(c, o.icon, locked);

  const body = el('div', 'hr-body');
  const head = el('div', 'hr-head');
  head.appendChild(el('span', 'hr-title', o.title));
  head.appendChild(el('span', 'hr-keys', o.keys));
  if (locked) {
    head.appendChild(el('span', 'hr-locked-tag',
      unlockLevel ? '通关第 ' + unlockLevel + ' 关解锁' : '未解锁'));
  }
  body.appendChild(head);

  /* desc 允许用 **强调** 和 <kbd> 标签，所以这里走 innerHTML。
   * ⚠️ 内容全部是我们自己写死的常量，没有任何用户输入 —— 不存在注入风险。 */
  const desc = el('div', 'hr-desc');
  desc.innerHTML = o.desc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  body.appendChild(desc);

  row.appendChild(body);
  return row;
}

/* ------------------------------------------------------------
 * 图标绘制（全用 canvas 画，零资源依赖）
 * ------------------------------------------------------------
 * @param locked  true = 画成"未解锁"的观感（整体压暗、加个锁扣）
 * ------------------------------------------------------------ */
function paintActionIcon(canvas, kind, locked) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* 未解锁：先把整体透明度压低，最后再单独画锁扣（锁扣要清晰） */
  if (locked) ctx.globalAlpha = 0.32;

  const ACCENT = '#FFD100';   // 主色（和菜单一致）
  const DIM = 'rgba(255,243,176,0.35)';

  /* 统一先画一个圆底 */
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
  ctx.fill();

  function arrow(x1, y1, x2, y2, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w || 3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const a = Math.atan2(y2 - y1, x2 - x1);
    const L = 6;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5));
    ctx.stroke();
  }

  if (kind === 'move') {
    arrow(14, 28, 26, 28, ACCENT);
    arrow(42, 28, 30, 28, ACCENT);
  } else if (kind === 'jump') {
    arrow(28, 34, 28, 14, ACCENT);
    ctx.fillStyle = DIM;
    ctx.fillRect(16, 40, 24, 4);
  } else if (kind === 'pause') {
    ctx.fillStyle = 'rgba(255,243,176,0.7)';
    ctx.fillRect(20, 18, 5, 20);
    ctx.fillRect(31, 18, 5, 20);
  } else if (kind === 'wallslide') {
    /* 左侧一堵墙 + 角色贴墙下滑 */
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(8, 8, 6, 40);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(18, 18, 12, 14);
    arrow(30, 36, 30, 46, DIM, 2);   // 下滑箭头（暗色 = 慢）
  } else if (kind === 'wallgrab') {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(8, 8, 6, 40);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(18, 22, 12, 14);
    /* 抓住的手（三个小点） */
    ctx.fillStyle = 'rgba(255,243,176,0.9)';
    ctx.beginPath(); ctx.arc(17, 24, 2.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(17, 29, 2.4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(17, 34, 2.4, 0, 7); ctx.fill();
  } else if (kind === 'walljump') {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(36, 8, 6, 40);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(22, 24, 12, 14);
    arrow(20, 30, 10, 22, ACCENT);   // 朝外弹出
  } else if (kind === 'dash') {
    /* 朝右的冲刺：角色 + 速度线 */
    ctx.fillStyle = 'rgba(201,139,255,0.55)';
    ctx.fillRect(10, 25, 8, 6);
    ctx.fillRect(19, 25, 6, 6);
    ctx.fillStyle = '#c98bff';
    ctx.fillRect(28, 22, 14, 12);
    arrow(30, 28, 46, 28, '#c98bff', 2.5);
  }

  /* ---- 未解锁：右下角盖一个小锁扣 ----
   * 单独画（不受前面的 globalAlpha 影响），保证清晰可辨。 */
  if (locked) {
    ctx.globalAlpha = 1;
    const lx = W - 20, ly = H - 20;
    /* 锁体 */
    ctx.fillStyle = 'rgba(20,20,24,0.85)';
    ctx.fillRect(lx + 1, ly + 8, 18, 13);
    ctx.strokeStyle = 'rgba(200,196,180,0.85)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(lx + 1, ly + 8, 18, 13);
    /* 锁梁（半圆） */
    ctx.beginPath();
    ctx.arc(lx + 10, ly + 8, 5, Math.PI, 0);
    ctx.stroke();
    /* 锁孔 */
    ctx.fillStyle = 'rgba(200,196,180,0.85)';
    ctx.fillRect(lx + 9, ly + 13, 2, 5);
  }
}

/* 八方向冲刺示意图：中心一个点，八个方向箭头 */
function paintDir8Diagram(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const R = 56;

  ctx.clearRect(0, 0, W, H);

  /* 外圈虚环，暗示"八个方向都能选" */
  ctx.strokeStyle = 'rgba(201,139,255,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  /* 八个方向的箭头 */
  const dirs = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-0.707, -0.707], [0.707, -0.707], [-0.707, 0.707], [0.707, 0.707],
  ];
  dirs.forEach(function (d, i) {
    const isDiag = i >= 4;
    const col = isDiag ? 'rgba(201,139,255,0.65)' : '#c98bff';
    const len = isDiag ? R * 0.72 : R;
    const x2 = cx + d[0] * len;
    const y2 = cy + d[1] * len;
    const x1 = cx + d[0] * 20;
    const y1 = cy + d[1] * 20;

    ctx.strokeStyle = col;
    ctx.lineWidth = isDiag ? 2.5 : 3.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    /* 箭头 */
    const a = Math.atan2(y2 - y1, x2 - x1);
    const L = isDiag ? 8 : 10;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
    ctx.stroke();
  });

  /* 中心：角色 */
  ctx.fillStyle = '#FFD100';
  ctx.fillRect(cx - 8, cy - 9, 16, 18);

  /* 中心提示文字 */
  ctx.fillStyle = 'rgba(255,243,176,0.75)';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Z + 方向', cx, H - 6);
}

/* 所有关卡的星数总和（菜单进度用） */
function getTotalStars() {
  const levels = PLAYABLE_LEVELS();  let n = 0;
  for (let i = 0; i < levels.length; i++) {
    const info = SAVE().levelInfo(i);
    if (info && info.cleared) n += (info.bestStars || 0);
  }
  return n;
}

/* ============================================================
 * ★ 骑手成长主线（M3 融合层，2026-10-06 第 7 期）★
 * ============================================================
 * 方案的手法 4："一条主线串起来 —— 一个骑手的成长日记：
 *   新手骑手（晴天、简单单、播报正经）
 *     → 老练骑手（恶劣天气、神秘单、播报开始不靠谱）
 *       → 金牌骑手（极端天气、解锁全部）"
 *
 * 【这一层做什么】
 *   **不加新玩法**，只把已有的东西（订单数 / 星数 / 称号 / 天气）
 *   归纳成一个"我成长到哪儿了"的说法。
 *   玩家看到的是"我是新手骑手"，而不是"我有 3 颗星"。
 *
 * 【怎么算是"老练"】
 *   用**已送单数**（clearedCount）分段，因为这个数最直观、
 *   也最贴"送了多少单外卖"的现实逻辑。
 *
 * ⚠️ 等级**只是称呼**，不解锁任何玩法（不做"要达到 X 级才能玩"）——
 *    那会让新手玩不到内容，违反"放松优先"。
 * ============================================================ */
const RIDER_RANKS = [
  { min: 0,  name: '见习骑手', desc: '刚拿到工牌，先熟悉路况' },
  { min: 1,  name: '新手骑手', desc: '送出第一单，开始上道' },
  { min: 2,  name: '熟练骑手', desc: '路线跑顺了，知道哪条道近' },
  { min: 3,  name: '老练骑手', desc: '恶劣天气也照送不误' },
  { min: 5,  name: '金牌骑手', desc: '全部订单跑完，片区最强' },
];

/* 按"已送单数"算当前骑手等级 */
function riderRank(clearedCount) {
  const n = Math.max(0, clearedCount || 0);
  let cur = RIDER_RANKS[0];
  for (let i = 0; i < RIDER_RANKS.length; i++) {
    if (n >= RIDER_RANKS[i].min) cur = RIDER_RANKS[i];
  }
  const total = PLAYABLE_LEVELS().length;
  return {
    name: cur.name,
    desc: cur.desc,
    cleared: n,
    total: total,
    /* 下一级还差几单（满级返回 null） */
    toNext: (function () {
      for (let i = 0; i < RIDER_RANKS.length; i++) {
        if (RIDER_RANKS[i].min > n) return RIDER_RANKS[i].min - n;
      }
      return null;
    })(),
  };
}

/* ---------------- 关卡选择 ----------------
 * 每关一张卡片：序号 + 路线名 + 星数 + 最佳用时。
 * 未解锁的显示为灰色 + 锁。
 * ---------------------------------------- */
function buildLevelSelect() {
  const p = newPanel();
  if (!p) return;

  /* ============================================================
   * ★ 角落按钮条：返回 / 换角色重跑（2026-10-06 新增）★
   * ============================================================
   * 十一的要求：
   *   "返回和换角色重跑给我放到**那个黑框的左上角**，
   *    不要放到整个页面左上角，只是那个黑框的左上角。"
   *   原因：原来这两个按钮在列表最底下，
   *        路线一多就要**往下翻**才能按到，很烦。
   *
   * ⚠️ 为什么用 sticky + 放在**第一个子元素**：
   *    · sticky 让它一直吸在面板顶部 → 滚到哪都够得着
   *    · 放最前是因为 sticky 元素一旦被"滚过去"就恢复普通流了，
   *      放最前才能全程吸住（这是 sticky 的实际行为，不是理论）
   *    · 它**不是 fixed/absolute** —— 所以不会跑到整个页面左上角，
   *      只会在面板（黑框）内部的最上面。这正是十一要的。
   * ============================================================ */
  const corner = el('div', 'panel-corner');
  /* 左半：两个操作按钮 */
  const cornerBtns = el('div', 'panel-corner-btns');
  cornerBtns.appendChild(btn('返回', null, function () {
    Game.state = STATE.MENU;
    UI.lastKey = '';
    syncUI();
  }, 'small'));
  cornerBtns.appendChild(btn('换角色重跑', null, function () {
    Game.state = STATE.SINGLE_PICK;
    UI.lastKey = '';
    syncUI();
  }, 'small'));
  corner.appendChild(cornerBtns);
  /* 右半：品牌标签（原来是单独一行，会被吸顶的按钮条压住 ——
   * 现在并到同一行，既不重叠也不浪费垂直空间）
   * ⚠️ 用 el('div','brand-label') 而不是 brandBar()：
   *    brandBar 是带 logo 方块的组件，这里只要文字标签。 */
  corner.appendChild(el('div', 'panel-corner-brand', '选择路线'));
  p.appendChild(corner);

  const levels = PLAYABLE_LEVELS();
  const unlockedMax = SAVE().data.maxUnlocked;

  /* ============================================================
   * ★ C1 订单系统：从"选一条路线"改成"接一单"（2026-10-06 第 1 期）★
   * ============================================================
   * 十一的要求：让玩家身份从"闯关者"变成"骑手"。
   *   标题「第 N 关 · XXX」→「订单 #NN · 区域」
   *   卡片显示：订单号 / 区域 / 时限 / 难度
   *
   * ⚠️ 只改**展示文案**，选关/解锁/开跑逻辑一行没动。
   *
   * 【关于时限文案】
   *   第 1 期只显示"目标时限"这个数字，**不启用任何计时逻辑** ——
   *   方案要求把时限留给第 3 期。
   *   而且第 3 期之前，**经典模式下不看时限**，所以卡片上
   *   给时限加了一句"（经典模式不限时）"的说明，避免玩家误会。
   *   ⚠️ 但注意：这里写的是"目标时间"，不是"倒计时"——
   *     超时不会失败，只是拿不到时间分（见方案第一节的核心约束）。
   * ============================================================ */
  p.appendChild(el('h1', null, '接一单'));
  const subLine = '已解锁 ' + Math.min(unlockedMax, levels.length) + ' / ' + levels.length + ' 单' +
    '　·　全收集订单可得 ★★★';
  p.appendChild(el('div', 'sub', subLine));

  const list = el('div', 'lv-list');

  levels.forEach(function (lv, i) {
    const unlocked = SAVE().isUnlocked(i);
    const info = SAVE().levelInfo(i);
    const card = el('div', 'lv-card' + (unlocked ? '' : ' locked'));

    /* 左边：订单号（不是关卡序号了）
     * 补零成 01 / 02 —— 外卖 App 的订单号观感，位数一致也更整齐。 */
    const orderNo = (typeof lv.orderNo === 'number') ? lv.orderNo : (i + 1);
    const padNo = (orderNo < 10 ? '0' : '') + orderNo;
    const num = el('div', 'lv-num', unlocked ? padNo : '🔒');
    card.appendChild(num);

    // 中间：订单名 + 区域 + 成绩
    const mid = el('div', 'lv-mid');
    /* 主标题：订单 #NN · 区域
     * ⚠️ 没填 district 的关卡退化成 lv.name（不会显示空）。 */
    const orderTitle = '订单 #' + padNo +
      (lv.district ? ' · ' + lv.district : '');
    mid.appendChild(el('div', 'lv-name', unlocked ? orderTitle : lv.name));
    if (unlocked) {
      const sub = el('div', 'lv-sub');
      if (info && info.cleared) {
        // 用 textContent 而不是 innerHTML —— 这里只有纯文本，不需要 HTML 解析，
        // 用 textContent 更安全（也更好测试）。
        sub.textContent = starsText(info.bestStars) + '　最佳 ' + formatTime(info.bestTime || 0) +
          (lv.targetTime ? '　·　目标 ' + formatTime(lv.targetTime) : '');
      } else {
        sub.textContent = lv.targetTime
          ? '还没跑过　·　目标 ' + formatTime(lv.targetTime)
          : '还没跑过';
      }
      mid.appendChild(sub);
    } else {
      mid.appendChild(el('div', 'lv-sub', '跑通上一单才能解锁'));
    }
    card.appendChild(mid);

    if (unlocked) {
      card.addEventListener('click', function (e) {
        e.stopPropagation();
        Sound.unlock();
        Sound.uiClick();
        /* 沿用存档里选中的角色（不读 Game.pickRole —— 那是个派生的镜像，
         * 真正该信的是存档）。roleOfSelection() 内部会自己读存档，
         * 并且保证返回合法值。 */
        Game.mode = 'single';
        Game.playerCount = 1;
        Game.pickRole = roleOfSelection();
        startGame(i);
      });
    }

    list.appendChild(card);
  });

  p.appendChild(list);

  /* ⚠️ 这一页原来在最底下有一排「返回 / 换角色重跑」按钮。
   *    2026-10-06 已搬到页面**最上方的角落条**（.panel-corner），
   *    原因：路线一多列表就长，按钮在最底下要往下翻才能按到。
   *    所以这里**故意留空** —— 不要再加回底部按钮。
   *    （保留这段注释是为了让下一个人知道"为什么这页没有底部按钮"。） */
}

/* ---------------- 单人：选骑手 ----------------
 * ============================================================
 * 十一的要求：
 *   · 只显示**已解锁**的角色
 *   · 默认选中上次用的角色（localStorage 里记着）
 *   · 明确显示能力差异（不是"轻微数值差异"）
 *   · 未解锁角色不能通过改界面状态直接选中
 *   · 不能增加过多步骤 —— 选过的玩家要能快速确认
 * ============================================================ */
function buildCharPick() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('选择骑手'));
  p.appendChild(el('h1', null, '今天骑哪个？'));

  const selId = SAVE().selectedChar();
  /* 默认选中上次用的角色。
   * ⚠️ 但必须校验它仍然可用（存档可能被清过）—— else 会选中一个锁定角色。 */
  /* ⚠️ 这段是"存档被清过 / 选中了已失效的角色"时的**纠正逻辑** ——
   *    必须用 roleOfSelection 重算，不能沿用旧的三元（会把卡皮巴拉纠正成袋鼠）。 */
  if (!Game.pickRole || !charIsReady(selId)) {
    Game.pickRole = roleOfSelection();
  }
  p.appendChild(el('div', 'sub', '跑单模式只操控这一个骑手 · 都可以独立通关'));

  /* ============================================================
   * ★★ 顶部只展示"最常用的 4 个"（2026-10-06 十一要求）★★
   * ============================================================
   * 十一的原话："在该页面顶部**默认只展示四个角色皮肤**
   *            （即玩家最常用的四个皮肤），以直观的方式呈现给玩家。
   *            其余角色不直接显示，玩家可通过打开「角色库」浏览与选择。"
   *
   * 【为什么不再全列出来】
   *   现在总共 5 个角色（以后还会更多），全平铺在一个网格里：
   *     · 卡片会越挤越小（一屏放 5~8 张就很迷你）
   *     · 玩家的真实需求是"用我常玩的那个"，
   *       剩下几个是"偶尔换换口味"—— 那是**浏览**行为，不是**选择**行为
   *   ⇒ 拆成两层：**常用 4 个直给** + **完整列表去角色库**。
   *
   * 【排序规则】见 characters.js 的 listTopChars()：
   *   最近用过 > 累计次数 > 角色表顺序（保证稳定不跳）
   *
   * ⚠️ 只从 `listVisibleChars()` 里挑 —— 绝不能带出没解锁的角色（零剧透）。
   * ⚠️ 不足 4 个就有几个给几个（新档只有 1 个，不能凭空补）。
   * ============================================================ */
  const TOP_N = 4;
  const avail = listVisibleChars();          // 全部"看得见"的（已解锁 + 已制作）
  const topChars = (typeof listTopChars === 'function')
    ? listTopChars(TOP_N)
    : avail.slice(0, TOP_N);
  const hiddenCount = Math.max(0, avail.length - topChars.length);

  /* 当前选中的角色**一定**要在顶部能看到 ——
   * 否则会出现"卡片上没高亮，玩家不知道自己在用谁"。
   * （正常情况 listTopChars 已经把"最近用过"的排前面了，
   *   但存档被手动改过、或刚解锁新角色时可能对不上。） */
  let shown = topChars.slice();
  const selChar = (function () {
    for (let i = 0; i < avail.length; i++) {
      if (avail[i].id === selId) return avail[i];
    }
    return null;
  })();
  if (selChar && !shown.some(function (c) { return c.id === selChar.id; })) {
    /* 把末尾那个挤掉，换成当前选中的（保证"当前骑手"永远可见） */
    if (shown.length >= TOP_N) shown[shown.length - 1] = selChar;
    else shown.push(selChar);
  }

  const wrap = el('div', 'chars');

  /* ★ 渲染一张角色卡的函数 —— 顶部常用区**复用同一套**（风格一致）★ */
  function makeCharCard(c) {
    const isSel = (Game.pickRole === c.role);
    const box = el('div', 'char' + (isSel ? ' selected' : ''));
    box.setAttribute('data-role', c.role);
    box.setAttribute('data-char', c.id);
    /* ★ 选中态的颜色由**角色配置**决定（不是 CSS 里写死的两段）★
     * ⚠️ 之前 CSS 里只有 kangaroo / dragon 的样式，
     *    卡皮巴拉被选中时**没有任何高亮**（十一报的 bug）。
     *    现在改成动态注入 —— 加新角色不用碰 CSS。 */
    if (isSel) applyCharSelectedStyle(box, c.role);

    const cv = document.createElement('canvas');
    /* ⚠️ 必须显式设尺寸 —— paintCharPreview 现在**不再自己写死 76**，
     *    它读 canvas 的现有尺寸。这个 canvas 原来靠"函数内部设 76"
     *    才能显示，现在不设的话就是默认的 300×150（HTML 默认值），
     *    角色会画得很小、外面一大圈空白。 */
    cv.width = 76; cv.height = 76;
    box.appendChild(cv);
    box.appendChild(el('div', 'cname', c.name));
    /* 定位用文字说清，不含糊 */
    box.appendChild(el('div', 'ctag', c.tagline));

    /* 关键能力的对比条 —— 让"差异"看得见，而不是只有一行小字 */
    const bars = el('div', 'cbar-hero');
    [
      { k: 'jump', label: '跳' },
      { k: 'speed', label: '跑' },
    ].forEach(function (a) {
      const v = (c.strengths && c.strengths[a.k]) || 3;
      const r = el('div', 'cbar-row');
      r.appendChild(el('span', 'cbar-label', a.label));
      const bar = el('div', 'cbar');
      for (let i = 1; i <= 5; i++) {
        bar.appendChild(el('i', 'cbar-cell' + (i <= v ? ' filled' : '')));
      }
      r.appendChild(bar);
      bars.appendChild(r);
    });
    box.appendChild(bars);

    /* 说明弱点，避免玩家以为"选了强的那个"就万事大吉 */
    if (c.weaknesses && c.weaknesses.length) {
      box.appendChild(el('div', 'cweak', c.weaknesses.join('、')));
    }

    paintCharPreview(cv, c.role);

    box.addEventListener('click', function (e) {
      e.stopPropagation();
      Sound.unlock();
      Sound.uiClick();
      /* ★ 安全校验：只允许选"已解锁 + 已制作"的角色。
       *    界面元素本身是按已解锁列表生成的，理论上不会点到锁定的，
       *    但这里再查一次 —— 十一明确要求
       *    "未解锁角色不能通过修改界面状态直接选择"。
       *    万一有人用开发者工具改了 DOM，这一步会挡住。 */
      if (!SAVE().hasChar(c.id) || !charIsReady(c.id)) return;
      Game.pickRole = c.role;
      try { SAVE().setSelectedChar(c.id); } catch (err) { /* 存不下也不影响这一局 */ }
      /* 只切换高亮，不重建整个面板。
       * ⚠️⚠️ 这里必须**同时清掉行内颜色**！
       *    因为现在选中色是行内 style 注入的，
       *    只 remove('selected') 的话，旧的边框/背景色还挂在 style 上
       *    —— 表现就是"两张卡同时亮着"。 */
      wrap.querySelectorAll('.char').forEach(function (n) {
        n.classList.remove('selected');
        clearCharSelectedStyle(n);
      });
      box.classList.add('selected');
      applyCharSelectedStyle(box, c.role);
    });
    wrap.appendChild(box);
  }

  shown.forEach(makeCharCard);

  /* ⚠️ 这一行绝对不能漏！
   * 上面整个 forEach 只是往 wrap 里塞角色卡，
   * **不把这行写出来，wrap 就永远不在面板里** ——
   * 表现是"选角色页只有标题和按钮，一个角色都没有"，
   * 而且**不报任何错**（元素建了、填了，就是没挂上去），
   * 特别难查。改这个函数时请务必确认这行还在。 */
  p.appendChild(wrap);

  /* ============================================================
   * ★ 「角色库」入口（2026-10-06 做明显 —— 十一要求）★
   * ============================================================
   * 十一："角色库入口明显易用。"
   *
   * 【为什么要把入口做大】
   *   现在顶部只显示 4 个，**"其余角色去哪找"必须有明确出口** ——
   *   不然玩家会以为"我就只有这 4 个骑手"（那是信息缺失，不是简化）。
   *
   * 【文案怎么写才不剧透】
   *   ⚠️ 红线：**不能暴露"还有几个没解锁"**（十一明确要求零剧透）。
   *   ⇒ 只说"已有的都在里面"，不说"还差几个"：
   *     · 有藏起来的（已解锁但没进常用 4 个）→ "还有 N 名骑手 →"
   *     · 没有藏起来的（总角色数 ≤ 4）      → "查看骑手档案 →"
   *   这样"已解锁 5 个"和"已解锁 2 个"看到的文案不同，
   *   但**都不会泄漏未解锁角色的信息**。
   * ============================================================ */
  const libRow = el('div', 'pk-lib-row');
  const libDesc = hiddenCount > 0
    ? '还有 ' + hiddenCount + ' 名骑手 —— 完整档案都在里面'
    : '每个骑手的完整档案（能力、擅长路线）';
  libRow.appendChild(btn('角色库 · 查看全部骑手 →', libDesc, function () {
    gotoState(STATE.CHAR_LIBRARY);
  }, 'lib-entry'));
  p.appendChild(libRow);

  /* ★ 2026-10-06 删除：原来这里有一句
   *     "还有 N 名骑手没解锁 —— 通关指定关卡后加入"
   *
   *   删掉的原因（十一要求）：卡皮巴拉要在通关第 10 关那一刻作为**惊喜**出场，
   *   提前告诉玩家"后面还有角色可拿"就等于剧透了一半。
   *   这句提示对新玩家毫无作用（他正忙着选人开跑），却把惊喜卖掉了。
   *
   *   ⚠️ 以后要加类似的引导，先确认不会暴露未解锁角色的数量或名字。 */

  const row = el('div', 'row');
  row.appendChild(btn('开始跑单', null, function () {
    Game.mode = 'single';
    Game.playerCount = 1;
    /* ★ 起始关卡：走 resumeLevelIndex()（单一真相源）★
     *
     * 规则（十一要求）：
     *   ① 新玩家            → 第 1 关
     *   ② 有进度没全通关    → 接着下一关
     *   ③ 全部通关          → 回第 1 关
     *
     * ⚠️ 这里原来是自己算的：
     *      Math.min(SAVE().data.maxUnlocked - 1, total - 1)
     *    而 maxUnlocked 是"已解锁到第几关"（1 起算，全通关 = 6），
     *    减一再夹紧之后恒等于最后一关 →
     *    **全通关的玩家点「开始跑单」只会一遍遍重玩第 5 关**。
     *
     *    根因是把"解锁到第几关"和"该玩第几关"当成了同一个数。
     *    现在统一由 resumeLevelIndex() 算（它看的是实际通关成绩），
     *    这个按钮不再自己做索引运算 —— 避免以后又算岔。
     */
    startGame(resumeLevelIndex());
  }, 'primary'));
  /* ★ 2026-10-06：原来这里还有一个小的「角色库」按钮 ——
   * 现在**删掉**，因为上方已经有一个做明显的入口（`.lib-entry`）。
   * 同一个页面放两个进同一个地方的按钮只会让人犹豫点哪个。
   * 「返回」保留（它去的是主菜单，不是角色库）。 */
  row.appendChild(btn('返回', null, function () { goMenu(); }, 'small'));
  p.appendChild(row);
}

/* ============================================================
 * 角色解锁界面（通关节点关卡后）
 * ============================================================
 * 十一的要求（逐条对照实现）：
 *   · 先正常显示配送结算，**再**显示角色解锁  → 由 buildClear 触发
 *   · 不能强制玩家更换角色                    → "继续使用当前骑手"
 *   · 动画保持简短，不要阻断太久               → 无强制计时，随时可点走
 *   · 已解锁过的重玩不重复播完整动画            → hasSeenUnlockAnim 控制
 *   · 解锁记录写入 localStorage                → markUnlockAnimSeen
 *
 * ⚠️ 当前配置表里 unlockLevel=5 的角色是 ready:false，
 *    所以**实际不会走到这个界面** ——
 *    系统已就绪，等第 5 关和第三名角色做好后自动生效。
 * ============================================================ */
function buildCharUnlock() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('新骑手加入'));
  p.appendChild(el('h1', null, '新骑手加入！'));

  const c = charById(UI.unlockCharId);
  if (!c) {   // 兜底：数据不对就直接回菜单，别给玩家看一个空白页
    goMenu();
    return;
  }

  const wrap = el('div', 'unlock-wrap');

  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  cv.className = 'unlock-avatar';
  wrap.appendChild(cv);
  paintCharPreview(cv, c.role);

  wrap.appendChild(el('div', 'unlock-name', c.name));
  wrap.appendChild(el('div', 'unlock-tag', c.tagline));
  if (c.routes && c.routes.length) {
    wrap.appendChild(el('div', 'unlock-routes', '擅长路线：' + c.routes.join(' · ')));
  }
  wrap.appendChild(el('div', 'unlock-desc', c.description));
  p.appendChild(wrap);

  const row = el('div', 'row');
  row.appendChild(btn('立即使用', null, function () {
    SAVE().setSelectedChar(c.id);
    /* ★ 解锁新角色后马上切过去（走统一取值，支持第三个角色）。 */
    Game.pickRole = roleOfSelection(c.id);
    gotoState(STATE.MENU);
  }, 'primary'));
  row.appendChild(btn('继续使用当前骑手', null, function () {
    gotoState(STATE.MENU);
  }, 'small'));
  p.appendChild(row);

  p.appendChild(el('div', 'unlock-note', '可以随时在「角色库」里换回来'));
}

/* ---------------- 联机大厅 ---------------- */
function buildLobby() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('组队跑单'));
  p.appendChild(el('h1', null, '和搭档异地一起跑'));
  p.appendChild(el('div', 'sub', '一个人开单，另一个人用取餐号加入'));

  p.appendChild(btn('开一单（我当主骑手）', '生成一个 6 位取餐号，发给搭档', function () {
    Game.state = STATE.HOSTING;
    UI.lastKey = '';
    syncUI();
    Net.statusText = '正在开单…';
    hostRoom(CLOUD_CONFIG).then(function (code) {
      if (!code) {
        Game.noticeText = Net.lastError || '开单失败';
        Game.noticeTimer = 99999;
        Game.state = STATE.LOBBY;
      }
      UI.lastKey = '';
      syncUI();
    });
  }, 'primary'));

  p.appendChild(btn('用取餐号加入', '输入搭档给你的 6 位取餐号', function () {
    Game.state = STATE.JOINING;
    Game.joinCodeInput = '';
    UI.lastKey = '';
    syncUI();
  }));

  const row = el('div', 'row');
  row.appendChild(btn('返回', null, function () {
    Game.state = STATE.MENU;
    UI.lastKey = '';
    syncUI();
  }, 'small'));
  p.appendChild(row);

  if (Game.noticeText && Game.noticeTimer > 0) {
    p.appendChild(el('div', 'msg err', Game.noticeText));
  }
}

/* ---------------- 等待搭档加入（主骑手） ---------------- */
function buildHosting() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('等待搭档'));
  p.appendChild(el('h1', null, '把取餐号发给搭档'));
  p.appendChild(el('div', 'sub', '搭档打开同一个网址，点「用取餐号加入」输入这 6 位'));

  const box = el('div', 'code-box');
  const codeEl = el('div', 'code-text', Net.code || '······');
  codeEl.id = 'ui-room-code';
  box.appendChild(codeEl);
  box.appendChild(el('div', 'code-hint', '点下面的按钮一键复制'));
  p.appendChild(box);

  const row = el('div', 'row');
  row.appendChild(btn('复制取餐号', null, function () {
    copyText(Net.code || '', '已复制！发给搭档吧');
  }, 'primary'));
  row.appendChild(btn('取消', null, function () {
    leaveRoom();
    Game.state = STATE.LOBBY;
    UI.lastKey = '';
    syncUI();
  }, 'small'));
  p.appendChild(row);

  const st = el('div', 'msg info');
  st.id = 'ui-host-status';
  st.textContent = Net.statusText;
  p.appendChild(st);

  const spin = el('div', 'spinner');
  spin.id = 'ui-host-spinner';
  p.appendChild(spin);
}

/* 房主等待期间只更新文字，不重建 DOM */
function refreshHostingText() {
  const c = document.getElementById('ui-room-code');
  if (c && Net.code && c.textContent !== Net.code) c.textContent = Net.code;
  const s = document.getElementById('ui-host-status');
  if (s) {
    s.textContent = Net.statusText;
    if (Net.peerConnected) {
      s.className = 'msg ok';
      const sp = document.getElementById('ui-host-spinner');
      if (sp) sp.style.display = 'none';
    }
  }
  // 朋友一进来就自动开局
  if (Net.peerConnected && Game.state === STATE.HOSTING) {
    Game.mode = 'online';
    Game.playerCount = 2;
    startGame(0);
  }
}

/* ---------------- 输入取餐号（搭档） ---------------- */
function buildJoining() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('加入跑单'));
  p.appendChild(el('h1', null, '输入取餐号'));
  p.appendChild(el('div', 'sub', '输入搭档给你的 6 位取餐号'));

  const inp = document.createElement('input');
  inp.className = 'input';
  inp.id = 'ui-code-input';
  inp.type = 'text';
  inp.maxLength = 6;
  inp.placeholder = '······';
  inp.value = Game.joinCodeInput || '';
  inp.autocomplete = 'off';
  inp.autocapitalize = 'characters';
  inp.spellcheck = false;

  // 只保留字母数字，自动大写
  inp.addEventListener('input', function () {
    inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    Game.joinCodeInput = inp.value;
    updateJoinBtn();
  });
  inp.addEventListener('keydown', function (e) {
    e.stopPropagation();                 // 别让游戏输入层抢走按键
    if (e.key === 'Enter') tryJoin();
    if (e.key === 'Escape') {
      Game.state = STATE.LOBBY;
      UI.lastKey = '';
      syncUI();
    }
  });
  // 允许直接粘贴
  inp.addEventListener('paste', function (e) {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text') || '';
    inp.value = (inp.value + t).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    Game.joinCodeInput = inp.value;
    updateJoinBtn();
  });
  p.appendChild(inp);

  const msg = el('div', 'msg');
  msg.id = 'ui-join-msg';
  p.appendChild(msg);

  const row = el('div', 'row');
  const joinBtn = btn('接单', null, tryJoin, 'primary');
  joinBtn.id = 'ui-join-btn';
  joinBtn.style.flex = '1';
  row.appendChild(joinBtn);
  row.appendChild(btn('返回', null, function () {
    Game.state = STATE.LOBBY;
    UI.lastKey = '';
    syncUI();
  }, 'small'));
  p.appendChild(row);

  function tryJoin() {
    const code = (Game.joinCodeInput || '').trim().toUpperCase();
    if (code.length !== 6) {
      setJoinMsg('取餐号是 6 位，请检查', 'err');
      return;
    }
    setJoinMsg('正在接单…', 'info');
    const jb = document.getElementById('ui-join-btn');
    if (jb) jb.disabled = true;
    joinRoom(code, CLOUD_CONFIG).then(function (ok) {
      const jb2 = document.getElementById('ui-join-btn');
      if (ok) {
        Game.mode = 'online';
        Game.playerCount = 2;
        startGame(0);
      } else {
        if (jb2) jb2.disabled = false;
        setJoinMsg(Net.lastError || '接单失败', 'err');
      }
    });
  }

  setTimeout(function () { inp.focus(); }, 30);

  // 供外部（键盘输入时）刷新用
  window.__uiUpdateJoinBtn = updateJoinBtn;

  function updateJoinBtn() {
    const jb = document.getElementById('ui-join-btn');
    if (jb) jb.disabled = (Game.joinCodeInput || '').length !== 6;
  }
  function setJoinMsg(t, cls) {
    const m = document.getElementById('ui-join-msg');
    if (m) { m.textContent = t; m.className = 'msg ' + (cls || ''); }
  }
  updateJoinBtn();
}

function refreshJoiningText() {
  const inp = document.getElementById('ui-code-input');
  if (inp && document.activeElement !== inp && inp.value !== Game.joinCodeInput) {
    inp.value = Game.joinCodeInput || '';
  }
  if (window.__uiUpdateJoinBtn) window.__uiUpdateJoinBtn();
}

/* ---------------- 暂停 ---------------- */
function buildPaused() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('跑单暂停'));
  p.appendChild(el('h1', null, '暂停中'));
  const riders = Game.playerCount === 1
    ? ('单人 · ' + displayNameOfRole(Game.pickRole))
    : (Game.mode === 'online' ? '联机双骑手' : '双人同屏');
  p.appendChild(el('div', 'sub', riders + '　·　' + (Game.level ? Game.level.name : '')));

  p.appendChild(btn('继续跑单', null, function () {
    Game.state = STATE.PLAYING;
    hideUI();
  }, 'primary'));

  /* ★ "重跑这一单"**故意**不走 startGame（2026-10-06 随机天气）★
   *   走 loadLevel 不重新抽天气 ⇒ 同一单的天气保持不变。
   *
   *   为什么不重抽：
   *     "这一单的天气已经定了" —— 死了重来还是同一个天气，
   *     才符合"这一单在下一个雨天/雪天"的叙事。
   *     如果每死一次就换天气，玩家会觉得"天气在跟着我变"，很出戏。
   *   ⇒ 只有**进新一单**（接下一单 / 从菜单开始跑）才会重新 rollWeather()。 */
  p.appendChild(btn('重跑这一单', null, function () {
    loadLevel(Game.levelIndex);
  }));

  p.appendChild(btn(Game.mode === 'online' ? '下线，回到首页' : '回到首页', null, function () {
    if (Game.mode === 'online') { leaveRoom(); Game.mode = 'local'; }
    Game.state = STATE.MENU;
    UI.lastKey = '';
    syncUI();
  }));
}

/* ---------------- 过关：配送完成单 ----------------
 * ============================================================
 * ★ 2026-10-06 重做：三星制度统一 ★
 * ============================================================
 * 十一指出的问题：
 *   "保持三颗星制度，不要同时出现「三星系统」和「五星好评」的规则冲突。"
 *
 *   原来这里确实有冲突：星数是 3 星制，
 *   但全收集时又弹一句"五星好评" —— 玩家会以为满分是 5。
 *
 * 现在统一成 **只有三颗星**：
 *   ★    达到最低订单要求并完成配送
 *   ★★   订单达到 75%
 *   ★★★  全部订单送达（完美）
 *
 * 原来"五星好评"那句话改成 "满单送达" —— 和三星制一致。
 * 文字里**不再出现"五星"**。
 *
 * ⚠️ calcStars() 的档位（save.js）就是这个规则，别改这里去迎合文案，
 *    要改就两个一起改，保持一致。
 * ============================================================ */
function buildClear() {
  const p = newPanel();
  if (!p) return;

  /* ⚠️ 这里原来有个 `const isLast = ...`，现在删掉了。
   *    "是不是最后一关"统一走 nextLevelIndex()（在下面判断 "下一关"按钮时算），
   *    不再自己用 `Game.levelIndex >= length - 1` 算一遍 ——
   *    两处算法不一致就会出"按钮说还有下一关、点了却回第 1 关"这类 bug。 */
  const met = Game.coinsTaken >= Game.coinsRequired;
  const perfect = Game.coinsTaken === Game.coinsTotal && Game.coinsTotal > 0;

  p.appendChild(brandBar('配送完成'));

  /* ============================================================
   * ★ 通关后页面优化（2026-10-06）★
   * ============================================================
   * 十一说"还有通关后页面也需要优化"。
   *
   * 优化前的问题：
   *   · 星数藏在"配送单"小字里，玩家通关后第一眼看到的是
   *     一堆灰色小字，情绪最高的瞬间没有一个"成绩高光"
   *   · 5 个按钮全是同一个尺寸，玩家不知道该点哪个
   *
   * 优化后：
   *   ① 顶部一个 .clear-hero —— 大星星 + 标题 + 三个大字数据
   *      （用时 / 订单 / 骑手），一眼看清成绩
   *   ② "下一单"用 primary 大按钮独占一行，其余缩成一行小按钮
   *   ③ 细节信息（每个角色的最佳、新纪录等）收到下面
   * ============================================================ */
  /* ============================================================
   * ★ 评星：按模式分支（2026-10-06 第 2 期）★
   * ============================================================
   * 方案第 2 期要求："结算按模式分支：ui.js buildClear 调不同算星函数"。
   *
   *   · 经典模式 → calcStars(收集率)          ← 老函数，一个字没改
   *   · 骑手模式 → calcStarsRider(时间+好评率) ← 新函数
   *
   * ⚠️ 必须用 `typeof === 'function'` 保护 ——
   *    万一 calcStarsRider 没加载成功（脚本加载顺序问题），
   *    这里退化成经典规则，而不是抛异常把结算页打崩。
   *
   * ⚠️ 本单好评率先算出来（下面 C3 那块也要用），
   *    所以提到这里统一算一次，别在两处各算一遍。 */
  const usedChar = charById(SAVE().selectedChar());
  const clearPct0 = (typeof Game.playerHeartsAtClear === 'number')
    ? riderRatingPercent(Game.playerHeartsAtClear, Game.playerMaxHeartsAtClear || 3)
    : 100;
  const isRider = (typeof SAVE === 'function') && SAVE().isRiderMode
    ? SAVE().isRiderMode() : false;
  const targetT = (Game.level && Game.level.targetTime) ? Game.level.targetTime : 0;
  const stars = (isRider && typeof calcStarsRider === 'function')
    ? calcStarsRider(Game.elapsed, targetT, Game.coinsTaken, Game.coinsTotal, clearPct0)
    : calcStars(Game.coinsTaken, Game.coinsTotal);
  const title = perfect ? '全部送达！' : (met ? '送达成功' : '送达（有漏单）');

  /* ============================================================
   * ★ C3 评价系统：结算页显示"本单评价"（2026-10-06 第 1 期）★
   * ============================================================
   * 方案要求："结算：显示'本单评价'（五星骑手 / 一般般）"。
   * ⚠️ 只是**呈现**，不动任何数值 —— 好评率由 riderRatingPercent()
   *    从 p.hearts / p.maxHearts 换算，掉血逻辑一行没改。
   *
   * ⚠️ 用"通关瞬间的剩余好评率"来给评价：
   *    Game.playerHeartsAtClear 由 game.js 在通关时记录（见第 1 期改动）。
   *    取不到就退化成 100%（满血通关）—— 绝不让它显示成 NaN 或空白。
   *    ⚠️ clearPct0 在上面算评星时已经算过了，直接复用，别重算。 */
  const clearPct = clearPct0;
  const ratingText = riderRatingText(clearPct);

  const hero = el('div', 'clear-hero');
  /* 大星星放最上 —— 通关后最想看到的东西 */
  hero.appendChild(el('div', 'clear-stars', starsText(stars)));
  hero.appendChild(el('div', 'clear-title', title));

  /* ============================================================
   * ★ 🏁 PK 模式：胜负（2026-10-06）★
   * ============================================================
   * ⚠️ 放在最显眼的位置（标题正下方）—— PK 局里
   *    "赢没赢"是玩家唯一关心的事，比星数重要。
   * ⚠️ 赢了/输了都要给出**具体差距**（差多少百分比），
   *    否则输了只知道"输了"，不知道"差一点点"还是"被碾压"。
   * ============================================================ */
  if (Game.pkResult) {
    const r = Game.pkResult;
    const box = el('div', 'pk-result ' + (r.winnerIsAI ? 'lose' : 'win'));
    box.appendChild(el('div', 'pkr-head', '🏁 竞速 PK'));
    box.appendChild(el('div', 'pkr-verdict', r.winnerIsAI ? '你输了' : '你赢了！'));
    let detail = '用时 ' + formatTime(r.elapsed);
    if (r.winnerIsAI) {
      detail += ' · 对手先到「收餐点」';
      if (typeof r.loserProgress === 'number' && r.loserProgress > 0) {
        detail += '（你跑到了 ' + Math.round(r.loserProgress * 100) + '%）';
      }
    } else {
      detail += ' · 对手才跑到 ' + Math.round((r.loserProgress || 0) * 100) + '%';
    }
    box.appendChild(el('div', 'pkr-detail', detail));
    hero.appendChild(box);
  }

  /* 本单评价（好评率）—— 放在标题下面、数据格上面。
   * 用一句人话表达，而不是只给百分比数字（"本单评价：五星骑手"更好懂）。 */
  hero.appendChild(el('div', 'clear-rating',
    '本单评价：' + ratingText + '（好评 ' + clearPct + '%）'));

  const stats = el('div', 'clear-stats');
  [
    ['配送用时', formatTime(Game.elapsed)],
    ['订单送达', Game.coinsTaken + ' / ' + Game.coinsTotal],
    ['骑手', usedChar ? usedChar.name : '—'],
  ].forEach(function (pair) {
    const cell = el('div');
    cell.appendChild(el('span', 'cs-val', pair[1]));
    cell.appendChild(el('span', 'cs-label', pair[0]));
    stats.appendChild(cell);
  });
  hero.appendChild(stats);

  /* ============================================================
   * ★ 时间项说明（C2，第 3 期）—— 只在骑手模式显示 ★
   * ============================================================
   * 方案要求："结算显示时间项"。
   *
   * ⚠️ 文案里必须明确"超时不影响送达" ——
   *    否则玩家会以为超时=失败（这也是方案最在意的一条：
   *    压力只能是目标、不能是惩罚）。
   *
   * ⚠️ 经典模式**完全不显示**这一行（连"无时间限制"都不写），
   *    保持经典模式界面的干净 —— 这是方案第 3 期的验收点。
   * ============================================================ */
  if (isRider && targetT > 0) {
    const onTime = Game.elapsed <= targetT;
    const overSec = Math.max(0, Math.round(Game.elapsed - targetT));
    hero.appendChild(el('div', 'clear-time',
      onTime
        ? '⏱ 准时送达（目标 ' + formatTime(targetT) + '）'
        : '⏱ 超时 ' + overSec + ' 秒（目标 ' + formatTime(targetT) + '）· 不影响送达，只是少拿时间分'));
  }

  /* 星数说明 —— 告诉玩家"为什么是这个星数"（差在哪、怎么升星）
   * ★ 第 3 期：按模式给不同的解释（骑手模式要看时间和好评，不能只说订单）。 */
  hero.appendChild(el('div', 'set-hint',
    isRider
      ? ((stars >= 3) ? '★★★ 又快又好 —— 准时 + 好评满格'
        : (stars >= 2) ? '★★ 送达达标 · 更快一点 / 少挨打就能三星'
          : '★ 完成配送 · 准时送达且少挨打可以升星')
      : ((stars >= 3) ? '★★★ 满单送达 —— 全部订单都送到了'
        : (stars >= 2) ? '★★ 订单完成度达标（75% 以上）· 全收可得 ★★★'
          : '★ 完成配送 · 再多送几单可以升星')));

  p.appendChild(hero);

  /* ============================================================
   * ★ E3 神秘订单结果 + 称号（2026-10-06 第 7 期）★
   * ============================================================
   * 两种可能：
   *   ① 本局解锁了新称号 → 弹一块紫色"★ 解锁称号 ★"（值得炫耀的时刻）
   *   ② 本关有神秘订单但没达成 → 显示"还差什么"（给玩家下次再来的目标）
   *
   * ⚠️ 只影响**展示**。前面已经强调过：没达成挑战照样通关。
   *    所以这里的文案不能写成"失败"，只能是"这次没拿到"。
   * ============================================================ */
  /* ★ 拿到新称号 → 整块可点，跳成就页（2026-10-06 入口方案 C）★
   * ------------------------------------------------------------
   * 为什么这块要做成可点：
   *   刚拿到成就的那一刻**是玩家最想看"我还有什么没拿"的时候** ——
   *   这时候跳转成本最低。如果只能"退主菜单→角色库→切 tab"，太绕。
   *
   * ⚠️ 没拿到新称号时**这一行根本不出现**（保持原行为，不凭空造一行）。
   * ⚠️ 点击提示用"查看成就 →"的文字 + hover 效果，
   *    不能只靠"手型光标"（手机上没有光标）。 */
  if (Game.newTitleThisClear) {
    const tBox = el('div', 'title-get');
    tBox.appendChild(el('div', 'tg-head', '★ 解锁称号 ★'));
    tBox.appendChild(el('div', 'tg-name', Game.newTitleThisClear));
    /* 行尾的明确暗示 —— 十一点了要"一个明确的视觉暗示" */
    tBox.appendChild(el('div', 'tg-more', '查看成就 →'));
    tBox.classList.add('clickable');
    tBox.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      Sound.unlock();
      Sound.uiClick();
      gotoState(STATE.ACHIEVEMENTS);
    });
    p.appendChild(tBox);
  } else if (typeof mysteryOrderForLevel === 'function') {
    const solo = (Game.mode === 'single' || Game.playerCount === 1);
    const mo = solo ? mysteryOrderForLevel(Game.levelIndex) : null;
    if (mo && !SAVE().hasTitle(mo.title)) {
      const mBox = el('div', 'mystery-hint');
      mBox.appendChild(el('div', 'mh-head', '🟣 ' + mo.name));
      mBox.appendChild(el('div', 'mh-cond', '挑战：' + mo.condition));
      mBox.appendChild(el('div', 'mh-tip', '这次没达成 · 不影响送达，下次可以再试试'));
      p.appendChild(mBox);
    }
  }

  /* ★ 骑手成长主线（第 7 期）：显示当前等级 + 距下一级还差几单 ★
   * 通关后是最适合"看到自己成长"的时刻 —— 玩家刚送完一单，
   * 告诉他"你现在是老练骑手了 / 再送 2 单就是金牌骑手"。
   * ⚠️ 只是展示，不解锁也不限制任何玩法。 */
  if (typeof riderRank === 'function') {
    const rk2 = riderRank(SAVE().clearedCount());
    const gBox = el('div', 'rank-line');
    gBox.textContent = '骑手等级：' + rk2.name +
      (rk2.toNext != null ? '　·　再送 ' + rk2.toNext + ' 单升到下一级' : '　·　已是最高等级');
    p.appendChild(gBox);
  }

  // 做一张"配送单"样式的信息块（次要信息收在这里）
  const receipt = el('div', 'code-box');
  receipt.style.borderStyle = 'solid';
  receipt.style.textAlign = 'left';
  receipt.style.padding = '14px 16px';

  /* C1：这一行从"路线"改成"订单"（订单号 + 区域），和选关页口径一致。
   * ⚠️ 兜底：老关卡数据没有 orderNo/district 时退回 lv.name，不会显示空。 */
  const routeName = Game.level ? Game.level.name : '';
  const lvObj = Game.level || {};
  const ordNo = (typeof lvObj.orderNo === 'number') ? lvObj.orderNo : null;
  const orderLabel = ordNo
    ? ('#' + ((ordNo < 10 ? '0' : '') + ordNo) + (lvObj.district ? ' · ' + lvObj.district : ''))
    : routeName;
  const lines = [
    ['订单', orderLabel],
    ['最低要求', Game.coinsRequired + ' 单（共 ' + Game.coinsTotal + ' 单）'],
  ];
  lines.forEach(function (row) {
    const li = el('div');
    li.style.cssText = 'font-size:13px;color:rgba(220,214,190,0.72);margin:3px 0;';
    li.textContent = row[0] + '：' + row[1];
    receipt.appendChild(li);
  });

  /* ⚠️ 星级已经移到上面的 .clear-hero 里用大字展示了（2026-10-06 优化）。
   *    这里不再重复画一遍星星 —— 同一个信息出现两次会让页面显得啰嗦，
   *    而十一这轮的诉求正是"减少展示内容"。 */

  // 存档里的最佳成绩
  const info = SAVE().levelInfo(Game.levelIndex);
  if (info && info.bestTime != null) {
    const bestLine = el('div');
    bestLine.style.cssText = 'font-size:12px;color:rgba(200,196,180,0.6);margin-top:6px;';
    bestLine.textContent = '本关历史最佳：' + formatTime(info.bestTime) + '　' + starsText(info.bestStars);
    receipt.appendChild(bestLine);
  }

  /* 该角色在这关的个人最佳 —— 和上面的"总最佳"分开显示。
   * 十一要求"关卡最佳时间建议按角色分别保存，同时保留本关总最佳时间"。 */
  if (usedChar) {
    const ct = SAVE().charBestTime(usedChar.id, Game.levelIndex);
    if (ct != null) {
      const cl = el('div');
      cl.style.cssText = 'font-size:12px;color:rgba(200,196,180,0.5);margin-top:1px;';
      cl.textContent = usedChar.name + ' 最佳：' + formatTime(ct);
      receipt.appendChild(cl);
    }
  }

  // "新纪录"提示
  const rec = Game.lastRecord;
  if (rec && (rec.isNewTime || rec.isNewStars || rec.isNewCharTime)) {
    const tag = el('div');
    tag.style.cssText = 'font-size:14px;font-weight:700;color:#9dffb8;margin-top:6px;';
    const parts = [];
    if (rec.isNewTime) parts.push('最快用时');
    if (rec.isNewStars) parts.push('星数提升');
    if (rec.isNewCharTime) parts.push('该骑手最快');
    tag.textContent = '▲ 新纪录！' + parts.join(' · ');
    receipt.appendChild(tag);
  }

  if (perfect) {
    const tagLine = el('div');
    tagLine.style.cssText = 'font-size:14px;font-weight:700;color:#FFD100;margin-top:8px;';
    /* ⚠️ 这里原来是"五星好评" —— 和三星制冲突，改成"满单送达" */
    tagLine.textContent = '★ 满单送达 —— 一单都没漏 ★';
    receipt.appendChild(tagLine);
  } else if (!met) {
    const tagLine = el('div');
    tagLine.style.cssText = 'font-size:13px;color:#ffb3b3;margin-top:8px;';
    tagLine.textContent = '有订单未送达（但已满足最低要求）';
    receipt.appendChild(tagLine);
  }

  /* ★ 解锁新动作 ★
   * 这是"逐步解锁"系统里**最重要的一个反馈时刻** ——
   * 玩家刚通关，情绪最高，这时候告诉他"你学会了新动作"，
   * 学习动机最强。
   *
   * 所以做得比其它提示更醒目：单独的色块 + 图标 + 一句话说明怎么按。 */
  const newActions = (rec && rec.unlocked) ? rec.unlocked : [];
  if (newActions.length) {
    const box = el('div', 'unlock-box');
    const head = el('div', 'ub-head', '★ 解锁新动作 ★');
    box.appendChild(head);
    newActions.forEach(function (a) {
      const line = el('div', 'ub-line');
      const name = el('span', 'ub-name', '「' + a.name + '」');
      line.appendChild(name);
      line.appendChild(el('span', 'ub-keys', a.hintKeys));
      box.appendChild(line);
    });
    box.appendChild(el('div', 'ub-hint',
      '这个动作以后一直都能用 —— 回去之前的关卡也可以试试。'));
    receipt.appendChild(box);
  }

  p.appendChild(receipt);

  /* ★ 角色解锁阶段提示 ★
   * 十一要求"先正常显示配送结算，再显示角色解锁界面"。
   * 所以这里不是自动跳转，而是**给一个按钮**：
   * 玩家看完结算，自己点"看看新骑手"才进解锁界面。
   * 这样既不打断（不强制），也不会让玩家错过。
   *
   * ⚠️ 当前配置表里的第 3 名角色是 ready:false，
   *    所以这里实际上永远不会出现 —— 设计就绪，等角色做好。 */
  const newChars = (rec && rec.unlockedChars) ? rec.unlockedChars : [];
  if (newChars.length) {
    const nowChar = newChars[0];
    /* 记录"这个角色的解锁动画该播" —— 但**标记为已播**要等玩家
     * 真的看过那个界面。这里只把 id 挂到 UI 上，由
     * buildCharUnlock 的进入动作去打标记。 */
    p.appendChild(btn('★ 有新骑手加入 · 看看是谁 ★', null, function () {
      UI.unlockCharId = nowChar.id;
      gotoState(STATE.CHAR_UNLOCK);
    }, 'primary'));
  }

  /* ============================================================
   * ★★ 🏁 PK 局：一局定胜负 —— **不给"接下一单"** ★★
   * ============================================================
   * 【十一的原话】
   *   "我的意思是想把 AI PK 做到那种一局就定胜负，
   *    然后现在是打完一局会连着来的"
   *
   * 【为什么原来会"连着来"】
   *   结算页的主按钮统一是「接下一单」，点了走 `startGame(next)`。
   *   而 `startGame` 不带 opts → **PK 状态被清** → 下一关变成普通模式。
   *   但 `Game.playerCount` 还是 2（PK 遗留）——
   *   于是下一关照样立着两个角色（变成"双人同屏"的样子）。
   *   玩家看到的就是"**PK 打完连着又来一局，还有两个角色**"。
   *
   *   ⇒ 修法（两件事都要做）：
   *     ① PK 的结算页**不出现「接下一单」**，
   *        主按钮改成「🏁 再来一局 PK」（重新抽关、重新选对手）
   *     ② PK 局结束时**把 playerCount 复位成 1** ——
   *        否则玩家从 PK 回主菜单再开单人，场上还会多一个角色
   *
   *   【为什么 PK 就该一局定胜负（而不是连跑多关）】
   *     · 竞速的核心乐趣是"这一局的胜负"，连跑多关会把紧张感稀释掉
   *     · AI 目前只有 6/11 关能跑完，连跑很容易卡在它掉坑的关卡上
   *     · 想再来一局，点一下按钮就行 —— 比自动连关更可控
   * ============================================================ */
  if (Game.isPk) {
    p.appendChild(btn('🏁 再来一局 PK', '重新随机抽一关 · 重新抽对手', function () {
      /* 回到"选骑手页"（可以换皮肤、换对手），再开始新的一局 */
      if (typeof buildPkPick === 'function') {
        buildPkPick._ai = null;
        buildPkPick._aiRoleOfMine = null;
      }
      gotoState(STATE.PK_PICK);
    }, 'primary'));

    const pkRow = el('div', 'row');
    pkRow.appendChild(btn('重跑这一关', null, function () {
      /* PK 的"重跑"要**保持 PK**（重跑同一关、同一对手）——
       * 所以走 startPkRace 的等价路径，而不是普通 loadLevel。
       * ⚠️ 直接 loadLevel 会把 pkResult 当成"还要继续"，
       *    而且 AI 的脑子（AI_RIDER）得重建。 */
      restartPkSameLevel();
    }, 'small'));
    pkRow.appendChild(btn('回到首页', null, function () {
      leavePkState();
      goMenu();
    }, 'small'));
    p.appendChild(pkRow);
    return;                       // ★ PK 局到此为止，不再往下加普通模式的按钮
  }

  /* ---- "下一关"按钮 ----
   * ★ 2026-10-06 改用 nextLevelIndex()（单一真相源）★
   *   原来的写法是用 `!isLast` 判断 + `Game.levelIndex + 1` 推进。
   *   两处算法分开写有两个隐患：
   *     · `isLast` 和 `levelIndex + 1` 越界判断如果不一致，就会出现
   *       "显示着接下一单、点了却回第 1 关"（或反之）
   *     · 以后"最后一关"的定义变了（比如加关），要改两处
   *   现在统一问 nextLevelIndex()：返回 null 就是没有下一关。
   */
  const nextIdx = nextLevelIndex(Game.levelIndex);

  /* ★ 按钮层级（2026-10-06 优化）★
   *   主按钮独占一行、最大最醒目 → 玩家 90% 的情况下就点这一个。
   *   次要按钮（重跑 / 换角色 / 返回）缩成底部一排小按钮。
   *   优化前 5 个按钮一样大，玩家要读完才知道点哪个。 */
  if (nextIdx != null) {
    const nextLevel = PLAYABLE_LEVELS()[nextIdx];
    p.appendChild(btn('接下一单 · ' + (nextLevel ? nextLevel.name : ''), null, function () {
      if (Game.mode === 'online' && Net.role === 'guest') {
        showGameNotice('等主骑手接下一单');
        return;
      }
      /* ★ E1（第 5 期）：走 startGame 而不是 loadLevel ——
       *   这样"接下一单"也会先播报下一单的天气（新单该有新预报）。
       *   ⚠️ 而"重跑这一单"仍走 loadLevel（不重播播报），
       *      避免玩家点重试就被一段过场拦住 —— 那会很烦。 */
      startGame(nextIdx);
    }, newChars.length ? undefined : 'primary'));
  } else {
    /* 已经是最后一关 → 不显示"接下一单"（避免玩家以为还有关），
     * 改成"从头再跑一遍"。这是唯一可能出现"回到第 1 关"的地方，
     * 而且**必须由玩家主动点击**，不是自动跳转。 */
    p.appendChild(btn('全部路线跑完！重新跑一遍 · 从第 1 关开始', null, function () {
      if (Game.mode === 'online' && Net.role === 'guest') {
        showGameNotice('等主骑手操作');
        return;
      }
      startGame(0);
    }, newChars.length ? undefined : 'primary'));
  }

  /* 次要操作：一排小按钮，不再各占一行 */
  const subRow = el('div', 'row');
  subRow.appendChild(btn('重跑这一单', null, function () {
    if (Game.mode === 'online' && Net.role === 'guest') {
      showGameNotice('等主骑手操作');
      return;
    }
    loadLevel(Game.levelIndex);
  }, 'small'));
  subRow.appendChild(btn('换骑手', null, function () {
    gotoState(STATE.SINGLE_PICK);
  }, 'small'));
  subRow.appendChild(btn('回到首页', null, function () {
    if (Game.mode === 'online') { leaveRoom(); Game.mode = 'local'; }
    goMenu();
  }, 'small'));
  p.appendChild(subRow);
}

/* ---------------- 失败：配送异常 ----------------
 * ============================================================
 * ★ 2026-10-06 重做：失败要说清"为什么" ★
 * ============================================================
 * 十一的要求：
 *   · 失败时必须说明**具体原因**（掉出路线 / 被机关击中 /
 *     体力耗尽 / 桥上待太久 / 超时 / 被敌人撞倒）
 *   · 显示：失败原因、本次订单数、本次用时、一条重试建议
 *   · 按钮顺序：① 立即重试 ② 从检查点继续 ③ 换角色重跑 ④ 返回路线选择
 *   · "立即重试"是最明显的按钮
 *
 * 原来的实现只有一句"这一单没送成" + 两个按钮，
 * 玩家不知道自己是怎么死的。
 *
 * 失败原因来自 Game.deathReason（由 game.js 在触发失败时写入）。
 * 取不到就给个通顺的兜底文案，绝不显示"undefined"。
 * ============================================================ */

/* 失败原因 → 显示文案 + 重试建议。
 * 抽成一张表：以后新增死法只需在这里加一条，
 * 不用改 UI 结构。 */
const DEATH_REASONS = {
  fall:       { text: '掉出配送路线',      tip: '注意路边的缺口，起跳前先看清落点' },
  hazard:     { text: '被危险机关击中',    tip: '尖刺不能踩 —— 试着跳过去，或用冲刺的无敌时间穿过' },
  stamina:    { text: '抓墙体力耗尽',      tip: '抓墙只撑 1.2 秒，体力条见红就赶紧跳走' },
  bridge:     { text: '在断裂桥上停留过久', tip: '断桥会塌 —— 落上去要一口气跑过去，别停' },
  timeout:    { text: '配送超时',          tip: '时间到之前送到收餐点就行，不要恋战捡单' },
  enemy:      { text: '被敌人撞倒',        tip: '从上方踩敌人可以弹起来，正面撞会受伤' },
  bomb:       { text: '被炸弹波及',        tip: '炸弹爆炸范围比看起来大，绕开或等它炸完再走' },
  unknown:    { text: '配送中断',          tip: '再试一次，这次注意脚下' },
};

/* ============================================================
 * ★ E2 顾客催单气泡（2026-10-06 第 5 期）★
 * ============================================================
 * 方案原文（docs/扩展方案 的 E2）：
 *   "超时后，屏幕上跳顾客催单气泡（漫画式）……
 *    气泡随时间越来越急（语气从客气到暴躁）"
 *
 * ⚠️⚠️ 这一条最重要的设计意图 ⚠️⚠️
 *   方案原话："**它替代了败北音效**：玩家听到的不是'Game Over'，
 *             是'你到哪了'——挫败感被消解成好笑。"
 *   ⇒ 所以这些文案**必须是好笑的、有人味的**，
 *     不能写成"超时！扣分！"这种系统腔。
 *     它是"幽默"，不是"惩罚"。
 *
 * 【为什么叫"顾客"而不是"系统"】
 *   超时后隔着屏幕催你的，是**点外卖的人**，不是游戏系统。
 *   这个视角转换就是笑点所在 —— 明明是跑跳游戏，
 *   突然有人在催你送外卖。
 *
 * 【分档】
 *   按"超时秒数"分 3 档，语气逐档变急：
 *     0-15 秒   客气（还在装礼貌）
 *     15-35 秒  着急（开始不讲客套）
 *     35 秒以上 暴躁（彻底不装了）
 *   每档给 3 条，随机出现 —— 免得玩家每次都看到同一句。
 *
 * ⚠️ 这些文案是我（AI）写的，**需要十一确认口吻**。
 * ============================================================ */
const CUSTOMER_NAG_LINES = [
  /* 第 1 档：超时 0-15 秒 —— 客气（还在维持体面） */
  {
    maxOver: 15,
    lines: [
      '老板，快到楼下了吗？',
      '小哥辛苦啦，我在门口等着呢～',
      '不急不急，就是问一下到哪了',
    ],
  },
  /* 第 2 档：超时 15-35 秒 —— 着急（客套没了） */
  {
    maxOver: 35,
    lines: [
      '老板，我快饿死了……',
      '还有多久啊？我饭都凉了',
      '你到哪了？我下楼等着了',
    ],
  },
  /* 第 3 档：超时 35 秒以上 —— 暴躁（彻底不装了） */
  {
    maxOver: Infinity,
    lines: [
      '五星好评给你留着，快啊！！！',
      '再不来我就取消订单了啊',
      '我饿得能听见自己的回声了',
      '你是走路来的吗？？？',
    ],
  },
];

/* 按"超时秒数"取一条催单文案。
 *
 * @param overSec  已经超时多少秒（<0 表示还没超时 → 返回 null）
 * @param seed     随机种子（可选）。传一个稳定的数（比如订单号+秒数）
 *                 可以让"同一秒内"文案不抖动，避免每帧都换一句。
 * @return 文案字符串；没超时返回 null
 *
 * ⚠️ 用"稳定 seed"而不是 Math.random()：
 *    如果每帧都随机，气泡里的字会疯狂闪烁（看起来像 bug）。
 *    用 seed 保证"同一段时间内固定一句话"，隔几秒才换。 */
function customerNagLine(overSec, seed) {
  if (!(overSec > 0)) return null;
  let tier = CUSTOMER_NAG_LINES[CUSTOMER_NAG_LINES.length - 1];
  for (let i = 0; i < CUSTOMER_NAG_LINES.length; i++) {
    if (overSec <= CUSTOMER_NAG_LINES[i].maxOver) { tier = CUSTOMER_NAG_LINES[i]; break; }
  }
  const list = tier.lines;
  const s = (typeof seed === 'number' && isFinite(seed)) ? Math.abs(Math.floor(seed)) : 0;
  return list[s % list.length];
}

/* 催单气泡的"紧急度"（0-1）—— 决定气泡颜色和抖动幅度
 * 0 = 刚超时，1 = 超时很久（气泡发红、抖得厉害） */
function customerNagUrgency(overSec) {
  if (!(overSec > 0)) return 0;
  return Math.min(1, overSec / 45);      // 45 秒到顶
}


function buildGameOver() {
  const p = newPanel();
  if (!p) return;
  p.appendChild(brandBar('配送异常'));
  p.appendChild(el('h1', null, '这一单没送成'));

  /* 失败原因 —— 优先用 game.js 写入的结构化原因，
   * 取不到就退化到 Game.message（原逻辑），最后才是兜底。 */
  const rk = (Game.deathReason && DEATH_REASONS[Game.deathReason])
    ? Game.deathReason
    : null;
  const reasonText = rk ? DEATH_REASONS[rk].text
                        : (Game.message || DEATH_REASONS.unknown.text);
  const reasonTip = rk ? DEATH_REASONS[rk].tip : DEATH_REASONS.unknown.tip;

  const box = el('div', 'over-box');
  box.appendChild(el('div', 'over-reason', '失败原因：' + reasonText));

  /* 本次成绩 —— 让玩家知道"差多少"
   * ★ C3（2026-10-06 第 1 期）：加上"当时的好评率"，
   *   让失败页也有外卖语义（而不是只有冷冰冰的"订单 N/M"）。 */
  const stat = el('div', 'over-stats');
  const failPct = (typeof Game.playerHeartsAtDeath === 'number')
    ? riderRatingPercent(Game.playerHeartsAtDeath, Game.playerMaxHeartsAtDeath || 3)
    : null;
  stat.textContent = '本次订单：' + Game.coinsTaken + ' / ' + Game.coinsTotal +
                     '　·　用时：' + formatTime(Game.elapsed) +
                     (failPct !== null ? '　·　好评 ' + failPct + '%' : '');
  box.appendChild(stat);

  /* 重试建议 */
  box.appendChild(el('div', 'over-tip', '💡 ' + reasonTip));
  p.appendChild(box);

  /* ---- 按钮顺序（严格按十一给的顺序）----
   * ① 立即重试（最明显）
   * ② 从检查点继续（仅当本关确实有存点时才出现）
   * ③ 换角色重跑
   * ④ 返回路线选择
   */
  p.appendChild(btn('立即重试 · R', '从本关开头重新开始', function () {
    if (Game.mode === 'online' && Net.role === 'guest') {
      showGameNotice('等主骑手操作'); return;
    }
    loadLevel(Game.levelIndex);
  }, 'primary'));

  /* 检查点：Game.checkpoint 是"本关有没有存点"的真相来源。
   * 没有就**不显示这个按钮** —— 显示一个点了没反应的按钮比不显示更糟。 */
  if (Game.checkpoint) {
    p.appendChild(btn('从检查点继续', '回到最近经过的存点，不用从头跑', function () {
      if (Game.mode === 'online' && Net.role === 'guest') {
        showGameNotice('等主骑手操作'); return;
      }
      /* restartFromCheckpoint 是 game.js 提供的入口。
       * 用 typeof 保护 —— 万一那个函数改名了，这里退化成整关重开，
       * 而不是抛异常把失败界面打崩。 */
      if (typeof restartFromCheckpoint === 'function') {
        restartFromCheckpoint();
      } else {
        loadLevel(Game.levelIndex);
      }
    }));
  }

  p.appendChild(btn('换角色重跑', '回到选骑手页面', function () {
    if (Game.mode === 'online') { leaveRoom(); Game.mode = 'local'; }
    gotoState(STATE.SINGLE_PICK);
  }));

  p.appendChild(btn('返回路线选择', null, function () {
    if (Game.mode === 'online') { leaveRoom(); Game.mode = 'local'; }
    gotoState(STATE.LEVEL_SELECT);
  }, 'small'));
}

/* ---------------- 复制到剪贴板 ---------------- */
function copyText(text, okMsg) {
  function fallback() {
    // 老浏览器 / 非 https 环境的兜底：用一个临时 textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      flashHostMsg(okMsg || '已复制', 'ok');
    }).catch(function () {
      if (fallback()) flashHostMsg(okMsg || '已复制', 'ok');
      else flashHostMsg('复制失败，请手动选中复制：' + text, 'err');
    });
  } else {
    if (fallback()) flashHostMsg(okMsg || '已复制', 'ok');
    else flashHostMsg('复制失败，请手动复制：' + text, 'err');
  }
}

function flashHostMsg(t, cls) {
  const s = document.getElementById('ui-host-status');
  if (s) { s.textContent = t; s.className = 'msg ' + (cls || ''); }
}

/* 游戏过程中的短提示（用 canvas 上的 Game.message 显示） */
function showGameNotice(text) {
  Game.noticeText = text;
  Game.noticeTimer = 110;
}
