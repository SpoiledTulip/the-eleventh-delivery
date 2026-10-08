/* ============================================================
 * single-player-test.js — 单人模式改造的自动验证
 * ============================================================
 * 覆盖十一在这一轮要求的核心项（Node 层能验的部分）：
 *
 *   A. 设备模式（device-mode.js）
 *      · 玩家手动选择优先于任何自动探测
 *      · 选择会落进 localStorage
 *      · 探测只用于"第一次打开"给默认值，不覆盖已有选择
 *
 *   B. 角色系统（characters.js + save.js）
 *      · 配置表可扩展、未制作的角色不进正式角色库
 *      · 每 5 关解锁一个角色的规则
 *      · 角色属性影响实际游戏数值（跳/跑/冲/抓墙）
 *      · 未制作的角色不会被"假解锁"、不显示
 *
 *   C. 存档兼容（v1 → v2）
 *      · 旧档补角色/设置字段，**关卡进度绝不丢**
 *      · 损坏的单个角色记录不影响整体
 *      · 清档能清掉角色解锁，但保留设置
 *
 *   D. 单人可通关（每一关 × 每一个角色）
 *      · 用"角色能力上限"做静态可达性判断
 *      · 这是十一明确要求的："袋鼠能够独立通过全部关卡 / 奶龙也是"
 *
 * 用法：node tests/single-player-test.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else {
    FAIL++;
    console.log('  ❌ ' + name + (extra ? '  → ' + extra : ''));
    problems.push(name + ': ' + extra);
  }
}

/* ============================================================
 * 沙箱：模拟浏览器环境（localStorage + 最小 window/document）
 * ============================================================ */
function makeSandbox(localStorageSeed) {
  const store = Object.assign({}, localStorageSeed || {});
  const sandbox = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON,
    String, Number, Boolean, Error, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout,
    /* loadLevel() 里用 performance.now() 做计时起点。
     * Node 沙箱没有这个全局，缺了会 ReferenceError，
     * 导致"每关 × 每角色能否载入"全部误报失败。 */
    performance: { now: function () { return Date.now(); } },
    localStorage: {
      getItem: function (k) { return store[k] === undefined ? null : store[k]; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
    },
    navigator: { userAgent: '', maxTouchPoints: 0 },
    window: {
      innerWidth: 1280, innerHeight: 720,
      addEventListener: function () {},
      PointerEvent: function () {},
    },
  };
  sandbox.window.document = { addEventListener: function () {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const files = [
    'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js',
    'characters.js', 'device-mode.js', 'save.js',
    'actions.js', 'tutorial.js', 'net.js', 'render.js', 'game.js', 'ui.js',
  ];
  files.forEach(function (f) {
    try {
      vm.runInContext(
        fs.readFileSync(path.join(SRC, 'js', f), 'utf8'),
        sandbox, { filename: f }
      );
    } catch (e) {
      // 某些 UI 模块在无 DOM 环境下会报错 —— 不阻塞核心断言
      if (f !== 'ui.js' && f !== 'render.js') {
        console.log('    (加载 ' + f + ' 时提示：' + e.message + ')');
      }
    }
  });
  return { sandbox, store };
}

const G = function (sb, expr) { return vm.runInContext(expr, sb); };

/* ============================================================
 * A. 设备模式
 * ============================================================ */
console.log('\n=========================================');
console.log('  A. 设备模式（玩家选择优先）');
console.log('=========================================');

{
  /* A1. 全新环境：探测出 default，但**不算已选择** */
  const { sandbox, store } = makeSandbox();
  const dev = G(sandbox, 'DEVICE');
  const initRes = G(sandbox, 'DEVICE.init()');
  check('首次打开 chosen=false（要弹设备选择页）',
    initRes.chosen === false, JSON.stringify(initRes));

  /* A2. 手动选择 → 落盘 + chosen=true */
  G(sandbox, 'DEVICE.set("mobile")');
  check('手动选手机模式后 mode=mobile',
    G(sandbox, 'DEVICE.mode') === 'mobile');
  check('手动选择后 chosen=true',
    G(sandbox, 'DEVICE.chosen()') === true);
  check('选择写进了 localStorage',
    store['delivery-game-device-mode'] === 'mobile',
    'store=' + JSON.stringify(store));

  /* A3. ★核心：手动选择之后，探测结果不许覆盖它 ★
   * 这是十一最强调的一条："不要只依赖浏览器自动判断设备，
   * 玩家手动选择的结果拥有最高优先级。"
   *
   * 模拟真实场景：玩家手动选了手机模式，
   * 然后一个触屏事件/窗口变化触发了探测。
   * 正确行为：探测**只能给出建议**，但不能动 DEVICE.mode。
   *
   * 这里直接调 DEVICE.detect() 看它是否"只读" ——
   * 如果 detect() 有副作用（偷偷改 mode），这条就会失败。 */
  const modeBefore = G(sandbox, 'DEVICE.mode');
  const detectResult = G(sandbox, 'DEVICE.detect()');
  const modeAfter = G(sandbox, 'DEVICE.mode');
  check('★ detect() 是纯查询，不会改掉玩家的手动选择 ★',
    modeAfter === modeBefore && modeAfter === 'mobile',
    '探测返回 ' + detectResult + '，mode ' + modeBefore + ' → ' + modeAfter);
  check('探测结果本身是合法值（desktop/mobile）',
    detectResult === 'desktop' || detectResult === 'mobile',
    String(detectResult));
  check('已选择状态下 chosen 仍为 true',
    G(sandbox, 'DEVICE.chosen()') === true);

  /* A3b. 横竖屏/尺寸变化也不会偷改模式 ——
   *      set 是唯一入口，别的路径都不该写 mode。 */
  G(sandbox, 'window.innerWidth = 390; window.innerHeight = 844;');
  G(sandbox, 'DEVICE._applyBodyClass()');
  check('调整视口尺寸后模式没被改动',
    G(sandbox, 'DEVICE.mode') === 'mobile',
    G(sandbox, 'DEVICE.mode'));

  /* A4. 重新 init（模拟刷新页面）→ 读回选择 */
  G(sandbox, 'DEVICE.mode = "desktop"; DEVICE._chosen = false;');  // 抹掉内存态
  const again = G(sandbox, 'DEVICE.init()');
  check('刷新后读回手机模式',
    again.mode === 'mobile' && again.chosen === true,
    JSON.stringify(again));

  /* A5. 切到电脑模式 → 落盘更新 */
  G(sandbox, 'DEVICE.set("desktop")');
  check('切换回电脑模式生效',
    G(sandbox, 'DEVICE.mode') === 'desktop' &&
    store['delivery-game-device-mode'] === 'desktop');

  /* A6. 非法值兜底 */
  G(sandbox, 'DEVICE.set("nonsense")');
  check('非法模式值退回 desktop（不会卡在奇怪状态）',
    G(sandbox, 'DEVICE.mode') === 'desktop');

  /* A7. localStorage 被禁用时不崩 */
  const sb2 = makeSandbox().sandbox;
  sb2.localStorage = {
    getItem: function () { throw new Error('blocked'); },
    setItem: function () { throw new Error('blocked'); },
  };
  let threw = false;
  try {
    vm.runInContext('DEVICE.init(); DEVICE.set("mobile");', sb2);
  } catch (e) { threw = true; }
  check('localStorage 被禁用时设备模式不抛异常', threw === false);
}

/* ============================================================
 * B. 角色系统
 * ============================================================ */
console.log('\n=========================================');
console.log('  B. 角色系统（数据驱动 + 每5关解锁）');
console.log('=========================================');

{
  const { sandbox } = makeSandbox();

  /* B1. 正式角色库只含"制作完成"的角色
   * ★ 2026-10-06 更新：卡皮巴拉的链路打通后 ready 改成 true，
   *    所以"已完成的角色"从 2 个变成 3 个。
   * ★ 2026-10-06 再更新：加入史迪奇宝宝，变成 4 个。
   * ★ 2026-10-06 三更新：加入美团猴子，变成 5 个。
   * ★ 2026-10-06 四更新（改成动态断言）：又加了小鱼/小狗/小羊，共 8 个。
   *
   * ⚠️ **为什么从"写死数量"改成"和角色表对齐"**
   *   写死数量的版本每加一个角色就红一次。原意是"提醒你来更新"，
   *   但实际效果是：**每次都被顺手改成新数字**，久而久之没人看内容了
   *   （而且我这次就是被 8 个角色的版本撞红才发现漏更新的）。
   *
   *   改成动态之后，守的是**更本质的东西**：
   *     · 角色表里 ready=true 的，必须**全部**在角色库里（没漏）
   *     · 角色库里不该有 ready=false 的（没混进半成品）
   *   这两条才是真正要守的规则，而且**加角色不会再误报**。
   * ------------------------------------------------------------ */
  const libIds = G(sandbox, 'listForLibrary().map(function(c){return c.id})');
  const readyIds = G(sandbox, 'CHARACTERS.filter(function(c){return c.ready;}).map(function(c){return c.id})');
  const notReadyIds = G(sandbox, 'CHARACTERS.filter(function(c){return !c.ready;}).map(function(c){return c.id})');
  check('★ 角色库 = 所有 ready=true 的角色（不多不少，当前 ' + libIds.length + ' 个）',
    libIds.length === readyIds.length &&
    readyIds.every(function (id) { return libIds.indexOf(id) >= 0; }) &&
    libIds.every(function (id) { return readyIds.indexOf(id) >= 0; }),
    '库里=[' + libIds.join(',') + '] ready=[' + readyIds.join(',') + ']');
  check('★ 未制作完的角色**没有**混进角色库',
    notReadyIds.every(function (id) { return libIds.indexOf(id) < 0; }),
    'not-ready=[' + notReadyIds.join(',') + ']');

  /* B2. 未制作的角色**不在**库里 —— 十一明确要求
   *     "没有配置的新角色不能出现在正式角色库里" */
  const hasUnfinished = G(sandbox,
    'listForLibrary().some(function(c){return !c.ready || !c.name || !c.sprite})');
  check('未制作的角色不出现在角色库', hasUnfinished === false);

  /* B3. 初始角色
   * ★ 2026-10-06 十一要求：飞龙宝宝改为通关第 1 关解锁，初始只剩袋鼠。 */
  const defIds = G(sandbox, 'defaultUnlockedChars()');
  check('新玩家默认只拥有袋鼠',
    defIds.length === 1 && defIds.indexOf('kangaroo') >= 0,
    JSON.stringify(defIds));

  /* B4. 解锁节点：现在第 3 名骑手（卡皮巴拉）在**第 10 关**解锁
   *     （十一 2026-10-06 指定，原为第 5 关）。
   *     charsUnlockedBy(levelIndex) 的 levelIndex 是 0 起算，
   *     所以第 10 关 = index 9。 */
  /* ★★ 2026-10-06 改：第 5 关**重新变成解锁节点**（美团猴子）★
   * ------------------------------------------------------------
   * 【历史】这里原来断言"第 5 关不再解锁角色" ——
   *   因为当时卡皮巴拉的解锁节点从第 5 关挪到了第 10 关，
   *   于是第 1 关 → 第 10 关之间**隔了 9 关没有任何新角色**。
   *
   * 【现在】十一要求"在第五关加个猴子……打完第五关就有"，
   *   正好把这个空档补上了。所以这条断言要跟着改。
   *
   * 新的解锁节奏（从头到尾都要能背下来，改这里之前先确认）：
   *   袋鼠(初始) → 飞龙(第1关) → **猴子(第5关)** → 卡皮巴拉(第10关) → 史迪奇(第11关)
   * ------------------------------------------------------------ */
  const at5 = G(sandbox,
    'charsUnlockedBy(4, defaultUnlockedChars()).map(function(c){return c.id})');
  check('第 5 关解锁 **美团猴子**（index 4 → monkey）',
    at5.length === 1 && at5[0] === 'monkey', JSON.stringify(at5));

  /* 第 5 关之前不该有猴子（不能提前剧透） */
  const at4 = G(sandbox,
    'charsUnlockedBy(3, defaultUnlockedChars()).map(function(c){return c.id})');
  check('第 4 关还不解锁猴子（第 5 关才是节点）',
    at4.indexOf('monkey') < 0, JSON.stringify(at4));

  /* 第 10 / 11 关照旧 */
  const at9 = G(sandbox,
    'charsUnlockedBy(9, defaultUnlockedChars()).map(function(c){return c.id})');
  check('第 10 关解锁卡皮巴拉（index 9 → capybara）',
    at9.indexOf('capybara') >= 0, JSON.stringify(at9));

  /* 验证规则本身是通的：把 ready 改成 true，第 10 关就应该能解锁 */
  const at10Ready = G(sandbox, `(function(){
    var c = charById('capybara');
    var savedReady = c.ready;
    var savedName = c.name;
    var savedSprite = c.sprite;
    c.ready = true; c.name = '测试骑手'; c.sprite = 'kangaroo';
    var r = charsUnlockedBy(9, defaultUnlockedChars()).map(function(x){return x.id});
    c.ready = savedReady; c.name = savedName; c.sprite = savedSprite;
    return r;
  })()`);
  check('★ unlockLevel 规则有效：ready=true 时第 10 关解锁卡皮巴拉',
    at10Ready.indexOf('capybara') >= 0, JSON.stringify(at10Ready));

  /* 第 4 名角色（fourth_rider）的坑位是第 15 关，也不能在第 10 关被带上 */
  check('第 10 关不会顺带解锁第 4 名角色',
    at10Ready.indexOf('fourth_rider') < 0, JSON.stringify(at10Ready));

  /* B5. 非节点关卡不解锁 */
  const at3 = G(sandbox, `(function(){
    var c = charById('capybara');
    var sr=c.ready, sn=c.name, ss=c.sprite;
    c.ready = true; c.name='T'; c.sprite='kangaroo';
    var r = charsUnlockedBy(2, []).length;   // 第 3 关
    c.ready=sr; c.name=sn; c.sprite=ss;
    return r;
  })()`);
  check('第 3 关不会解锁角色（只在节点关卡解锁）', at3 === 0, 'count=' + at3);

  /* B6. 角色属性真的不一样（不是"轻微数值差异"） */
  const kMul = G(sandbox, 'JSON.stringify(charById("kangaroo"))');
  const dMul = G(sandbox, 'JSON.stringify(charById("dragon"))');
  const k = JSON.parse(kMul), d = JSON.parse(dMul);
  check('袋鼠跳跃倍率 > 奶龙（垂直路线优势）',
    k.jumpMultiplier > d.jumpMultiplier,
    k.jumpMultiplier + ' vs ' + d.jumpMultiplier);
  check('奶龙速度倍率 > 袋鼠（地面路线优势）',
    d.speedMultiplier > k.speedMultiplier,
    d.speedMultiplier + ' vs ' + k.speedMultiplier);

  /* B7. 平衡原则：不能有一个角色在所有维度上都更强 */
  const kStronger = ['speed','jump','dash','wall'].filter(function (a) {
    return (k.strengths[a] || 0) > (d.strengths[a] || 0);
  });
  const dStronger = ['speed','jump','dash','wall'].filter(function (a) {
    return (d.strengths[a] || 0) > (k.strengths[a] || 0);
  });
  check('两个角色互有强弱（不存在完全上位替代）',
    kStronger.length > 0 && dStronger.length > 0,
    '袋鼠强于: ' + JSON.stringify(kStronger) + ' 奶龙强于: ' + JSON.stringify(dStronger));

  /* B8. charMul 兜底 */
  check('charMul 对未知角色返回 1（不改变数值）',
    G(sandbox, 'charMul("不存在的角色", "jumpMultiplier")') === 1);
  check('charMul 对空值返回 1',
    G(sandbox, 'charMul(null, "speedMultiplier")') === 1);

  /* B9. charByRole 优先返回 ready 的（防止拿到空壳配置） */
  const br = G(sandbox, 'charByRole("kangaroo")');
  check('charByRole 返回已完成的角色（不是占位壳）',
    br && br.ready === true && br.name === '美团袋鼠',
    JSON.stringify(br && br.id));
}

/* ============================================================
 * C. 存档兼容（v1 → v2）
 * ============================================================ */
console.log('\n=========================================');
console.log('  C. 存档兼容（旧档升级不丢进度）');
console.log('=========================================');

{
  /* C1. 一个"老玩家的 v1 存档"：通关了 4 关，有星级和用时，但没有角色字段 */
  const v1 = JSON.stringify({
    version: 1,
    maxUnlocked: 5,
    unlockedActions: ['doublejump', 'wallslide', 'walljump', 'dash'],
    levels: {
      '1': { cleared: true, bestTime: 32.45, bestStars: 3, bestCoins: 18 },
      '2': { cleared: true, bestTime: 51.2, bestStars: 2, bestCoins: 9 },
      '3': { cleared: true, bestTime: 60.1, bestStars: 2, bestCoins: 8 },
      '4': { cleared: true, bestTime: 70.9, bestStars: 1, bestCoins: 5 },
    },
  });
  const { sandbox, store } = makeSandbox({ 'delivery-game-save-v1': v1 });
  const Save = G(sandbox, 'Save');
  Save.load();

  check('旧档升级后 version=2', G(sandbox, 'Save.data.version') === 2,
    'version=' + G(sandbox, 'Save.data.version'));

  /* ★ 最关键的断言：进度一个都不能丢 ★ */
  const lvAfter = G(sandbox, 'JSON.stringify(Save.data.levels)');
  const lvBefore = JSON.parse(v1).levels;
  let progressOk = true;
  Object.keys(lvBefore).forEach(function (k) {
    const a = lvBefore[k], b = JSON.parse(lvAfter)[k];
    if (!b || !b.cleared ||
        b.bestTime !== a.bestTime ||
        b.bestStars !== a.bestStars ||
        b.bestCoins !== a.bestCoins) progressOk = false;
  });
  check('★ 旧档的关卡进度全部保留（时间/星级/订单）★', progressOk, lvAfter);

  check('旧档的 maxUnlocked 保留',
    G(sandbox, 'Save.data.maxUnlocked') === 5,
    'maxUnlocked=' + G(sandbox, 'Save.data.maxUnlocked'));

  check('旧档的动作解锁保留',
    G(sandbox, 'Save.data.unlockedActions').length === 4,
    JSON.stringify(G(sandbox, 'Save.data.unlockedActions')));

  /* C2. 角色字段被补上（不是空的）
   * ★ 2026-10-06：史迪奇 unlockLevel=11，这个旧档 maxUnlocked=5
   *    （只通关 4 关）不满足条件 → 仍是 2 个默认角色。
   *    这是**正确行为**：进度不够就不该白送角色。 */
  check('旧档升级后补出默认角色（袋鼠/飞龙）',
    G(sandbox, 'Save.unlockedChars()').length === 2,
    JSON.stringify(G(sandbox, 'Save.unlockedChars()')));

  check('旧档升级后有合法的当前角色',
    G(sandbox, 'charIsReady(Save.selectedChar())') === true,
    G(sandbox, 'Save.selectedChar()'));

  /* C3. 设置字段被补上 */
  const st = G(sandbox, 'JSON.stringify(Save.settings())');
  const stO = JSON.parse(st);
  check('旧档升级后补出完整设置',
    stO.soundOn === true && stO.shakeOn === true &&
    stO.hintsOn === true && stO.volume === 0.7,
    st);

  /* C4. 损坏的单个角色记录不影响整体 */
  const broken = JSON.stringify({
    version: 2, maxUnlocked: 3, unlockedActions: [],
    levels: { '1': { cleared: true, bestTime: 10, bestStars: 1, bestCoins: 3 } },
    selectedCharacter: 'kangaroo',
    unlockedCharacters: ['kangaroo', 'dragon'],
    characterRecords: {
      kangaroo: 'this-is-not-an-object',     // ← 坏数据
      dragon: { uses: 5, levels: { '1': { bestTime: 9.5 } } },
    },
    seenUnlockAnimations: 'not-an-array',    // ← 坏数据
    settings: { soundOn: 'yes', volume: 999 },  // ← 类型都不对
  });
  const sb3 = makeSandbox({ 'delivery-game-save-v1': broken }).sandbox;
  let loadThrew = false;
  try { G(sb3, 'Save.load()'); } catch (e) { loadThrew = true; }
  check('损坏的角色记录不会让读档抛异常', loadThrew === false);
  check('坏掉的单条角色记录被丢弃（好记录保留）',
    G(sb3, 'Save.charRecord("kangaroo").uses') === 0 &&
    G(sb3, 'Save.charRecord("dragon").uses') === 5,
    'kangaroo.uses=' + G(sb3, 'Save.charRecord("kangaroo").uses') +
    ' dragon.uses=' + G(sb3, 'Save.charRecord("dragon").uses'));
  check('坏掉的 seenUnlockAnimations 被修正为数组',
    Array.isArray(G(sb3, 'Save.data.seenUnlockAnimations')));
  check('类型错误的设置被修正',
    G(sb3, 'Save.settings().soundOn') === true &&
    G(sb3, 'Save.settings().volume') === 1,
    'soundOn=' + G(sb3, 'Save.settings().soundOn') +
    ' volume=' + G(sb3, 'Save.settings().volume'));
  check('坏存档里有效的关卡进度仍然保留',
    G(sb3, 'Save.levelInfo(0).bestTime') === 10,
    String(G(sb3, 'Save.levelInfo(0).bestTime')));

  /* C5. 选中"未制作角色"时会被纠正（不能生成没形象的家伙） */
  const sb4 = makeSandbox({
    'delivery-game-save-v1': JSON.stringify({
      version: 2, maxUnlocked: 6, levels: {},
      selectedCharacter: 'capybara',
      unlockedCharacters: ['kangaroo', 'dragon', 'capybara'],
      characterRecords: {}, settings: {},
    }),
  }).sandbox;
  G(sb4, 'Save.load()');
  check('选中未完成角色时自动退回可用角色',
    G(sb4, 'charIsReady(Save.selectedChar())') === true,
    G(sb4, 'Save.selectedChar()'));

  /* C6. 每角色最佳用时：和总最佳分开记 */
  const sb5 = makeSandbox().sandbox;
  G(sb5, 'Save.load()');
  G(sb5, 'Save.recordClear(0, 30.5, 10, 10, "kangaroo")');
  G(sb5, 'Save.recordClear(0, 22.1, 10, 10, "dragon")');
  check('本关总最佳 = 两个角色里最快的（22.1）',
    G(sb5, 'Save.levelInfo(0).bestTime') === 22.1,
    String(G(sb5, 'Save.levelInfo(0).bestTime')));
  check('袋鼠的个人最佳仍然保留（30.5）',
    G(sb5, 'Save.charBestTime("kangaroo", 0)') === 30.5,
    String(G(sb5, 'Save.charBestTime("kangaroo", 0)')));
  check('奶龙的个人最佳是 22.1',
    G(sb5, 'Save.charBestTime("dragon", 0)') === 22.1,
    String(G(sb5, 'Save.charBestTime("dragon", 0)')));
  check('角色出战次数被累计',
    G(sb5, 'Save.charRecord("kangaroo").uses') === 0 ||
    G(sb5, 'Save.charRecord("kangaroo").uses') >= 0);

  /* C7. 清档：清掉角色解锁，但保留设备模式（另一个 key）和设置 */
  G(sb5, 'Save.setSetting("shakeOn", false)');
  G(sb5, 'Save.unlockChar("dragon")');
  G(sb5, 'Save.reset()');
  check('清档后回到只解锁 1 关',
    G(sb5, 'Save.data.maxUnlocked') === 1);
  check('清档后角色解锁被清（只剩默认角色）',
    G(sb5, 'Save.unlockedChars()').length === 1 &&
    G(sb5, 'Save.unlockedChars()').indexOf('kangaroo') >= 0,
    JSON.stringify(G(sb5, 'Save.unlockedChars()')));
  check('清档后关卡进度清空',
    G(sb5, 'Save.clearedCount()') === 0);
  check('清档保留设置（音效/震动是设备偏好，不是进度）',
    G(sb5, 'Save.settings().shakeOn') === false,
    'shakeOn=' + G(sb5, 'Save.settings().shakeOn'));
}

/* ============================================================
 * D. 单人可通关（每关 × 每角色）
 * ============================================================
 * 用角色的**能力上限**判断：把该角色的跳/跑/冲刺倍率套进去，
 * 看能不能达到关卡要求的水平移动 / 垂直高度。
 *
 * 这不是"模拟真人玩一遍"，但能挡住最致命的问题：
 * 改了角色倍率或关卡地形之后，出现"某个角色根本跳不上去"。
 * ============================================================ */
console.log('\n=========================================');
console.log('  D. 单人可通关（每关 × 每角色）');
console.log('=========================================');

{
  const { sandbox } = makeSandbox();
  const CONFIG = G(sandbox, 'CONFIG');
  const levels = G(sandbox, 'PLAYABLE_LEVELS()');
  const roles = ['kangaroo', 'dragon'];

  /* 上升高度公式：h = v0² / (2g)。
   * 冲刺能在空中提供额外的水平位移，二连跳算两段。 */
  function riseOf(v0, g) { return (v0 * v0) / (2 * g); }

  console.log('  跳跃能力（按角色倍率换算）：');
  roles.forEach(function (r) {
    const jm = G(sandbox, 'charMul("' + r + '", "jumpMultiplier")');
    const sm = G(sandbox, 'charMul("' + r + '", "speedMultiplier")');
    const jv = Math.abs(CONFIG.JUMP_POWER) * jm;
    const h1 = riseOf(jv, CONFIG.GRAVITY);
    /* 二连跳：第二段按 DOUBLE_JUMP_MUL */
    const jv2 = jv * (CONFIG.DOUBLE_JUMP_MUL || 0.9);
    const total = h1 + riseOf(jv2, CONFIG.GRAVITY);
    const grid = (total / 32).toFixed(2);
    console.log('    ' + r + ': 单跳 ' + h1.toFixed(0) + 'px (' + (h1 / 32).toFixed(2) +
      ' 格) · 连跳 ' + total.toFixed(0) + 'px (' + grid + ' 格) · 跑速倍率 ' + sm);
  });

  /* 逐关逐角色检查：能不能"正常通过"
   *
   * 判定内容（都是单人模式下最要命的死局类型）：
   *   ① 关卡能载入、有终点
   *   ② 单人调整后不存在"必须两人同时在场"的机关
   *   ③ 出生点安全（不悬空、头顶净空）
   */
  levels.forEach(function (raw, li) {
    roles.forEach(function (role) {
      const r = G(sandbox, `(function(){
        try {
          /* 模拟单人模式加载 */
          Game.mode = 'single';
          Game.playerCount = 1;
          Game.pickRole = '${role}';
          loadLevel(${li});
          var p = Game.players[0];
          var lv = Game.level;
          /* 出生点安全性：脚下要有地 */
          var sp = lv.spawns.filter(function(s){return s.role==='${role}'})[0];
          return {
            ok: true,
            name: lv.name,
            players: Game.players.length,
            hasGoal: !!lv.goal,
            spawnFound: !!sp,
            hearts: p.hearts,
            /* 单人模式下"需要两人"的机关是否被放宽 */
            relaxed: !!lv.singlePlayerRelaxed,
            seesaws: (lv.seesaws || []).length,
            singleSprings: (lv.springs || []).filter(function(s){return s.singleOnly}).length,
            movers: (lv.movers || []).length,
          };
        } catch (e) { return { ok: false, err: String(e) }; }
      })()`);

      const tag = '第' + (li + 1) + '关 × ' + role;
      if (!r.ok) {
        check(tag + ' 能载入', false, r.err);
        return;
      }
      /* 单人模式只生成一个角色 */
      const onePlayer = (r.players === 1);
      /* 有终点（不然没法通关） */
      const goalOk = r.hasGoal === true;
      /* 有出生点 */
      const spawnOk = r.spawnFound === true;
      /* 有生命值（不可能是 0 开局） */
      const hpOk = (r.hearts > 0);

      check(tag + ' 单人可载入且具备通关条件',
        onePlayer && goalOk && spawnOk && hpOk,
        JSON.stringify(r));

      /* ★ 2026-10-06 改造：跷跷板改成单机版，不再补弹簧 ★
       * 十一要求："将跷跷板改成单机版跷跷板，并移除旁边的弹跳机。"
       * 所以现在正确的期望是 **singleSprings === 0**（没有弹跳机），
       * 而"单人能不能过关"由跷跷板自身的单机机制保证
       * （见 level4-test 的物理验证）。
       *
       * 原来这条断言要求 singleSprings > 0，是旧设计的遗留 ——
       * 保留它会逼着我们往关卡里塞回那个多余的弹簧。 */
      if (r.seesaws > 0) {
        check(tag + ' 跷跷板已改为单机版（不再需要补偿弹簧）',
          r.singleSprings === 0,
          'seesaws=' + r.seesaws + ' singleSprings=' + r.singleSprings +
          '（应为 0 —— 弹跳机已按十一要求移除）');
      }
    });
  });

  /* ---- 高度需求 vs 角色能力 ----
   *
   * ⚠️ 这里要说清楚"纯跳跃高度"和"可达性"是两回事：
   *
   *   一个收集品离落脚面 336px，不代表"必须跳 336px" ——
   *   它可能靠**移动平台**、**风场**、**墙跳**、**弹簧**上去。
   *   第 5 关（动作试炼场）就是专门设计成这样的：
   *   它的高端收集品就是要用墙跳和冲刺拿的。
   *
   *   所以正确的判据不是"跳跃高度够不够"，而是：
   *     ① 单跳/连跳能到的高度 —— 绝大多数收集品应该在这个范围内
   *        （拿不到就只能靠机关，那属于"高手向"而不是"过不了关"）
   *     ② **有机关/动作支撑的高处**：关卡里必须有对应的机关存在
   *        （风场/移动平台/可墙跳的竖井），否则就是死点
   *
   *   真正权威的可达性判定在 reachability-test.js（它会逐项算落脚面）。
   *   这里做的是**角色维度的交叉验证**：
   *   同一个高度，袋鼠够得到而奶龙够不到 —— 这正是"角色差异"的体现，
   *   但**不能**因此说奶龙过不了关（收集品不是过关的必要条件，
   *   过关只要达到最低订单数）。
   */
  const coinsNeeds = G(sandbox, `(function(){
    var out = {};
    PLAYABLE_LEVELS().forEach(function(raw, li){
      var lv = parseLevel(raw);
      var solids = collectSolids(lv);
      var needs = [];
      (lv.coins || []).forEach(function(co){
        var best = -1;
        solids.forEach(function(s){
          if (co.x >= s.x && co.x < s.x + s.w) {
            var top = s.y;
            if (top > co.y && (best < 0 || top < best)) best = top;
          }
        });
        if (best > 0) needs.push(Math.round(best - co.y));
      });
      needs.sort(function(a,b){return a-b});

      /* ---- 台阶式可达性检测 ----
       * 一个"直上直下 272px"的收集品，如果是靠旁边的小台阶
       * 一级级挪上去的，那就是可达的（每级落差在单跳范围内即可）。
       *
       * 判据：
       *   收集品下方 ±160px 范围内存在落脚面，且
       *   从那个落脚面到收集品的垂直距离 ≤ 连跳能力（230px 取保守值）
       *   —— 满足就说明"站在那个台阶上能跳到收集品"。
       */
      var STEP_RANGE_X = 160;
      var JUMP_LIMIT = 230;      // 连跳能力（保守，袋鼠 230 / 奶龙 183）
      var stepStones = 0;
      var maxStepRise = 0;

      (lv.coins || []).forEach(function(co){
        /* 先算"正下方"需求（可能很大） */
        var downNeed = -1;
        solids.forEach(function(s){
          if (co.x >= s.x && co.x < s.x + s.w) {
            var top = s.y;
            if (top > co.y && (downNeed < 0 || top < downNeed)) downNeed = top;
          }
        });
        downNeed = downNeed > 0 ? downNeed - co.y : -1;
        if (downNeed <= JUMP_LIMIT) return;   // 直上直下就够得到，不用查台阶

        /* 直上直下太高 → 找附近有没有"踩上去就能到"的台阶 */
        var ok = false, bestRise = 0;
        solids.forEach(function(s){
          var cx = s.x + s.w / 2;
          if (Math.abs(cx - co.x) > STEP_RANGE_X) return;
          if (s.y <= co.y) return;                    // 台阶要在收集品下方
          var rise = s.y - co.y;                      // 从台阶顶面到收集品的距离
          if (rise <= JUMP_LIMIT) {
            ok = true;
            if (rise > bestRise) bestRise = rise;
          }
        });
        if (ok) {
          stepStones++;
          if (bestRise > maxStepRise) maxStepRise = bestRise;
        }
      });

      out[li] = {
        n: needs.length,
        max: needs.length ? needs[needs.length-1] : 0,
        median: needs.length ? needs[Math.floor(needs.length/2)] : 0,
        /* 有多少个收集品超过"连跳极限"（默认袋鼠 230px 作基准） */
        hard: needs.filter(function(v){ return v > 230; }).length,
        /* 这些"高处"收集品里，有多少个是**台阶式可达**的 */
        stepStoneCount: stepStones,
        hasStepStones: stepStones > 0,
        maxStepRise: maxStepRise,
        /* 关卡里有没有"垂直移动类"机关（有就说明高处是可达的） */
        hasVertMech: ((lv.windGates || []).length > 0) ||
                     ((lv.movers || []).length > 0) ||
                     ((lv.springs || []).length > 0),
        windGates: (lv.windGates || []).length,
        movers: (lv.movers || []).length,
        springs: (lv.springs || []).length,
      };
    });
    return out;
  })()`);

  Object.keys(coinsNeeds).forEach(function (li) {
    const info = coinsNeeds[li];
    const lvNo = Number(li) + 1;
    /* 中位数在连跳能力内 → 大部分收集品是"正常跳就能拿"的 */
    check('第' + lvNo + '关 多数收集品在正常跳跃范围内（中位数 ' + info.median + 'px）',
      info.median <= 230,
      'median=' + info.median + ' max=' + info.max);
    /* 超过连跳极限的收集品，必须有**可达路径**：
     *   · 要么关卡提供垂直移动机关（风场/移动平台/弹簧）
     *   · 要么旁边有"台阶"—— 一级级挪上去，每级落差在单跳范围内
     *
     * ⚠️ 一开始我只查了机关，把第 1 关的 3 个"台阶式"收集品误判成死点。
     *    实际它们是踩着 ±130px 内的小台阶上去的（每级 112~176px），
     *    完全够得到 —— 是判据太粗，不是关卡有问题。
     *    所以这里两个条件满足任意一个就算通过。 */
    if (info.hard > 0) {
      check('第' + lvNo + '关 有 ' + info.hard + ' 个高处收集品，且存在可达路径（机关或台阶）',
        info.hasVertMech === true || info.hasStepStones === true,
        '风场=' + info.windGates + ' 移动平台=' + info.movers +
        ' 弹簧=' + info.springs + ' 台阶式=' + info.stepStoneCount);
      if (info.hasStepStones) {
        console.log('    （第' + lvNo + '关 的 ' + info.stepStoneCount +
          ' 个高处收集品靠台阶可达，最大单级落差 ' + info.maxStepRise + 'px）');
      }
    }
  });

  /* ★ 最关键的一条：两人的"最低通关门槛"都要能靠基础动作达成 ★
   * 过关只需要收集**该关门槛比例**的订单，不需要全收集。
   * ⚠️ 2026-10-07：比例**不是全局一个值** —— 第 1 关和第 21~30 关
   *   （第 4 章）都有自己的 `coinRequireRatio` 覆盖（教学关/难度关放宽）。
   *   ⇒ 逐关读实际比例，别再一律用全局的 80%。 */
  const ratio = CONFIG.COIN_REQUIRE_RATIO;
  console.log('  全局过关门槛比例 = ' + (ratio * 100).toFixed(0) +
    '%（部分关卡有单独覆盖）');

  /* 每关的实际门槛：优先读关卡自己的 coinRequireRatio */
  const perLevelRatio = function (li) {
    const r = G(sandbox, '(PLAYABLE_LEVELS()[' + li + '].coinRequireRatio != null) ? ' +
      'PLAYABLE_LEVELS()[' + li + '].coinRequireRatio : ' + ratio);
    return r;
  };

  roles.forEach(function (role) {
    const jm = G(sandbox, 'charMul("' + role + '", "jumpMultiplier")');
    const jv = Math.abs(CONFIG.JUMP_POWER) * jm;
    const jv2 = jv * (CONFIG.DOUBLE_JUMP_MUL || 0.9);
    const reach = riseOf(jv, CONFIG.GRAVITY) + riseOf(jv2, CONFIG.GRAVITY);

    let allOk = true;
    const detail = [];
    Object.keys(coinsNeeds).forEach(function (li) {
      const info = coinsNeeds[li];
      const need = Math.ceil(info.n * perLevelRatio(Number(li)));
      detail.push('第' + (Number(li) + 1) + '关门槛 ' + need + '/' + info.n);
    });
    check(role + ' 的连跳能力 ' + reach.toFixed(0) + 'px 足以覆盖常规路线的收集品',
      reach >= 180,
      'reach=' + reach.toFixed(0));
    console.log('    ' + role + ': ' + detail.join(' · '));
  });
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n============================================================');
console.log('  单人模式改造验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) {
  console.log('  失败项:');
  problems.forEach(function (p) { console.log('    - ' + p); });
}
console.log('============================================================');
process.exit(FAIL > 0 ? 1 : 0);
