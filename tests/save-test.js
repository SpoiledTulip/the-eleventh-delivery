/* ============================================================
 * save-test.js — 本地存档 + 关卡解锁 测试
 *
 * 重点验证：
 *   1. 存档读取/写入正确
 *   2. 星数计算规则对
 *   3. 解锁逻辑（只增不减）
 *   4. ★存档损坏不会让游戏崩★（这个最容易漏，但线上出事最惨）
 *   5. localStorage 不可用时（无痕模式）也能正常玩
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

let pass = 0, fail = 0;
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; }
}

/* ---------- 可配置的假 localStorage ---------- */
let store = {};
let throwOnGet = false, throwOnSet = false;
let localStorageAvailable = true;

const fakeLS = {
  getItem: function (k) {
    if (throwOnGet) throw new Error('SecurityError: localStorage blocked');
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
  },
  setItem: function (k, v) {
    if (throwOnSet) throw new Error('QuotaExceededError');
    store[k] = String(v);
  },
  removeItem: function (k) { delete store[k]; },
  clear: function () { store = {}; },
};

function buildSandbox() {
  function noop() {}
  const ctxProbe = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    }, set: function () { return true; },
  });

  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
    window: {
      addEventListener: noop, requestAnimationFrame: function () { return 0; },
      Image: function () { setTimeout(function () { if (this.onerror) this.onerror(); }, 0); },
      AudioContext: function () {
        return {
          state: 'running', currentTime: 0,
          createOscillator: function () { return { frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }; },
          createGain: function () { return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }; },
          destination: {}, resume: noop,
        };
      },
    },
    document: {
      getElementById: function () { return { getContext: function () { return ctxProbe; }, width: 0, height: 0, style: {} }; },
      addEventListener: noop,
    },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: noop,
  };
  if (localStorageAvailable) sb.localStorage = fakeLS;
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const FILES = ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js'];

function mkRun(sb) {
  return function (code) { return vm.runInContext(code, sb); };
}
function loadAll(sb) {
  FILES.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
  });
}

/* ============================================================
 * 1. 全新存档
 * ============================================================ */
console.log('--- 全新存档 ---');
store = {};
let sb = buildSandbox();
loadAll(sb);
let run = mkRun(sb);
{
  run('Save.load()');
  check(run('Save.data.maxUnlocked') === 1, '全新存档只解锁第 1 关（maxUnlocked=1）');
  check(run('Save.clearedCount()') === 0, '通关数为 0');
  check(run('Save.isUnlocked(0)') === true, '第 1 关已解锁');
  check(run('Save.isUnlocked(1)') === false, '第 2 关还没解锁');
  check(run('Save.levelInfo(0)') === null, '第 1 关还没有成绩');
}

/* ============================================================
 * 2. 星数计算
 * ============================================================ */
console.log('\n--- 星数规则 ---');
{
  check(run('calcStars(18, 18)') === 3, '全收集（18/18）→ 3 星');
  check(run('calcStars(14, 18)') === 2, '14/18 ≈ 78% → 2 星');
  check(run('calcStars(10, 18)') === 1, '10/18 ≈ 56% → 1 星');
  check(run('calcStars(9, 18)') === 1, '刚达门槛（50%）→ 1 星');
  check(run('calcStars(5, 0)') === 1, '本关无金币 → 保底 1 星');
  check(run('starsText(3)') === '★★★', '星数文字：3 星');
  check(run('starsText(0)') === '☆☆☆', '星数文字：0 星');

  /* ★回归测试★ starsText 只能用于 0-3 星，但传任何值都不能崩。
   * 踩过的坑：主菜单显示"总星数"时误传了 10，算出 3-10=-7，
   * '☆'.repeat(-7) 抛 RangeError，把主菜单整个打崩。 */
  let starCrash = false;
  try {
    run('starsText(10)');
    run('starsText(999)');
    run('starsText(-5)');
    run('starsText(null)');
    run('starsText(undefined)');
    run('starsText(NaN)');
  } catch (e) { starCrash = true; }
  check(!starCrash, 'starsText 传任何越界值都不崩（已加夹紧）');
  check(run('starsText(10)') === '★★★', 'starsText(10) 夹到 3 星，不抛异常');
  check(run('starsText(-5)') === '☆☆☆', 'starsText(-5) 夹到 0 星，不抛异常');
}

/* ============================================================
 * 3. 记录通关 + 解锁
 * ============================================================ */
console.log('\n--- 记录通关与解锁 ---');
{
  store = {};
  sb = buildSandbox();
  loadAll(sb);
  run = mkRun(sb);
  run('Save.load()');

  let r = run('Save.recordClear(0, 45.5, 18, 18)');
  check(run('Save.data.maxUnlocked') === 2, '通关第 1 关 → 解锁第 2 关');
  check(run('Save.isUnlocked(1)') === true, '第 2 关现在是解锁的');
  check(run('Save.levelInfo(0).bestTime') === 45.5, '第 1 关最佳用时 = 45.50');
  check(run('Save.levelInfo(0).bestStars') === 3, '第 1 关 3 星');
  check(r.recorded !== false, '返回了记录结果');

  // 再玩一次，成绩更差 → 不该覆盖最佳
  run('Save.recordClear(0, 60.0, 10, 18)');
  check(run('Save.levelInfo(0).bestTime') === 45.5, '成绩更差时，最佳用时不被覆盖');
  check(run('Save.levelInfo(0).bestStars') === 3, '成绩更差时，星数不被降低');

  // 再玩一次，成绩更好
  const r2 = run('Save.recordClear(0, 32.1, 18, 18)');
  check(run('Save.levelInfo(0).bestTime') === 32.1, '成绩更好时，最佳用时可更新');
  check(r2.isNewTime === true, '标记为"新纪录"');

  // 通关第 2 关
  run('Save.recordClear(1, 50.0, 7, 7)');
  check(run('Save.data.maxUnlocked') === 3, '通关第 2 关 → 解锁第 3 关');

  // 重玩第 1 关：解锁进度不该被"锁回去"
  run('Save.recordClear(0, 30.0, 18, 18)');
  check(run('Save.data.maxUnlocked') === 3, '重玩旧关时，已解锁进度只增不减');
}

/* ============================================================
 * 4. ★存档损坏不能崩★
 * ============================================================ */
console.log('\n--- 存档损坏的容错 ---');
{
  const badCases = [
    ['不是 JSON', 'this is not json {{{'],
    ['是 JSON 但不是对象', '"hello"'],
    ['是数组', '[1,2,3]'],
    ['缺 maxUnlocked', '{"version":1,"levels":{}}'],
    ['maxUnlocked 是字符串', '{"version":1,"maxUnlocked":"5","levels":{}}'],
    ['maxUnlocked 是 0', '{"version":1,"maxUnlocked":0,"levels":{}}'],
    ['levels 是 null', '{"version":1,"maxUnlocked":2,"levels":null}'],
    ['levels 里某项是垃圾', '{"version":1,"maxUnlocked":2,"levels":{"1":"garbage"}}'],
    ['bestTime 是负数', '{"version":1,"maxUnlocked":1,"levels":{"1":{"bestTime":-5,"bestStars":99,"cleared":true}}}'],
    ['空字符串', ''],
  ];

  badCases.forEach(function (c) {
    store = {};
    store['delivery-game-save-v1'] = c[1];
    const sb2 = buildSandbox();
    loadAll(sb2);
    const run2 = mkRun(sb2);
    let crashed = false, maxU = null;
    try {
      run2('Save.load()');
      maxU = run2('Save.data.maxUnlocked');
    } catch (e) { crashed = true; }
    check(!crashed && typeof maxU === 'number' && maxU >= 1,
      '损坏存档【' + c[0] + '】不崩且回落到合法值（maxUnlocked=' + maxU + '）');
  });
}

/* 星数越界要夹住 */
{
  store = {};
  store['delivery-game-save-v1'] = '{"version":1,"maxUnlocked":1,"levels":{"1":{"bestTime":10,"bestStars":99,"cleared":true}}}';
  const sb3 = buildSandbox();
  loadAll(sb3);
  const run3 = mkRun(sb3);
  run3('Save.load()');
  check(run3('Save.levelInfo(0).bestStars') === 3, '星数超范围时夹到 3（实际 99 → 3）');
}

/* ============================================================
 * 5. localStorage 不可用（无痕模式）
 * ============================================================ */
console.log('\n--- localStorage 不可用 ---');
{
  localStorageAvailable = false;
  const sb4 = buildSandbox();
  loadAll(sb4);
  const run4 = mkRun(sb4);
  let crashed = false;
  try {
    run4('Save.load()');
    const ok = run4('Save.save()');
    check(ok === false, '没有 localStorage 时 save() 返回 false（不抛异常）');
    run4('Save.recordClear(0, 10, 18, 18)');
    check(run4('Save.data.levels["1"].cleared') === true, '没有 localStorage 时游戏仍能正常记录（仅存在内存里）');
  } catch (e) { crashed = true; }
  check(!crashed, '没有 localStorage 时不崩溃（无痕模式可正常玩）');
  localStorageAvailable = true;
}

/* 读/写抛异常（被浏览器策略拦） */
{
  store = {};
  throwOnGet = true;
  const sb5 = buildSandbox();
  loadAll(sb5);
  const run5 = mkRun(sb5);
  let crashed = false;
  try { run5('Save.load()'); } catch (e) { crashed = true; }
  check(!crashed, 'localStorage.getItem 抛异常时不崩');
  check(run5('Save.data.maxUnlocked') === 1, '抛异常时回落到全新存档');
  throwOnGet = false;

  throwOnSet = true;
  let crashed2 = false;
  try {
    run5('Save.recordClear(0, 10, 18, 18)');
  } catch (e) { crashed2 = true; }
  check(!crashed2, 'localStorage.setItem 抛异常时不崩（配额满也能玩）');
  throwOnSet = false;
}

/* ============================================================
 * 6. 清档
 * ============================================================ */
console.log('\n--- 清档 ---');
{
  store = {};
  const sb6 = buildSandbox();
  loadAll(sb6);
  const run6 = mkRun(sb6);
  run6('Save.load()');
  run6('Save.recordClear(0, 10, 18, 18)');
  run6('Save.recordClear(1, 20, 7, 7)');
  check(run6('Save.data.maxUnlocked') === 3, '清档前：已解锁 3 关');
  run6('Save.reset()');
  check(run6('Save.data.maxUnlocked') === 1, '清档后：回到只解锁 1 关');
  check(run6('Save.clearedCount()') === 0, '清档后：通关数为 0');
}

/* ============================================================
 * 7. 和游戏本体联动：通关真的会存进去
 * ============================================================ */
console.log('\n--- 和游戏本体联动 ---');
{
  store = {};
  const sb7 = buildSandbox();
  loadAll(sb7);
  const run7 = mkRun(sb7);
  run7('initGame("game")');

  // 直接进第 1 关，把金币补够，然后站到终点
  run7('Game.mode="single";Game.playerCount=1;loadLevel(0)');
  check(run7('Save.isUnlocked(1)') === false, '开局时第 2 关是锁的');

  run7('Game.coinsTaken = Game.coinsRequired');
  run7('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run7('InputState.now={};update(0.016);InputState.tick();');

  check(run7('Game.state') === 'clear', '到达终点 → 过关');
  check(run7('Save.isUnlocked(1)') === true, '过关后第 2 关自动解锁');
  check(run7('Save.levelInfo(0)') !== null, '过关成绩写进了存档');
  check(run7('Game.lastRecord') !== null, 'Game.lastRecord 有值（结算面板用来显示"新纪录"）');
}

/* ============================================================
 * ★ 第 2/3 期新增：游玩模式 + 骑手模式评星（2026-10-06）★
 * ============================================================
 * 这一段的重点不是"功能对不对"，而是**守住三条红线**：
 *   ① calcStars() 的老逻辑一个字都没改（经典模式靠它）
 *   ② 新模式字段有兼容（旧档补默认值，不丢进度）
 *   ③ ★超时绝不影响过关★ —— 只影响星数
 * ============================================================ */
console.log('\n=== 六、游玩模式 + 骑手评星（第 2/3 期）===');
{
  store = {};
  const sb = buildSandbox();
  loadAll(sb);
  const run = mkRun(sb);

  /* ---- ① 经典模式的老规则必须原样 ---- */
  check(run('calcStars(10,10)') === 3, 'calcStars 全收集 = 3 星（老规则没变）');
  check(run('calcStars(9,10)') === 2, 'calcStars 90% = 2 星（老规则没变）');
  check(run('calcStars(5,10)') === 1, 'calcStars 50% = 1 星（老规则没变）');
  check(run('calcStars(0,0)') === 1, 'calcStars 0/0 = 1 星（老边界没变）');

  /* ---- ② 模式字段：默认 + 切换 + 非法值兜底 ---- */
  run('Save.load()');
  check(run('Save.mode()') === 'classic', '默认是经典模式（老玩家无感升级）');
  check(run('Save.isRiderMode()') === false, 'isRiderMode 默认 false');
  check(run('Save.setMode("rider")') === 'rider', '切到骑手模式成功');
  check(run('Save.mode()') === 'rider', '切换后读回来是 rider');
  check(run('Save.setMode("bogus")') === 'rider', '非法模式被忽略（返回当前值）');
  check(run('Save.mode()') === 'rider', '非法切换没有污染存档');

  /* ---- ③ 骑手模式评星：准时 + 满好评 = 3 星 ---- */
  check(run('calcStarsRider(60, 90, 10, 10, 100)') === 3,
    '准时 + 满好评 = 3 星');
  /* 稍微超一点点（超 5%，时间分 0.95）→ 总分 0.975 → 仍 3 星（有容错） */
  check(run('calcStarsRider(94.5, 90, 10, 10, 100)') === 3,
    '轻微超时（超 5%）仍有 3 星（容错）');
  /* 超时一半（时间分 0.5）→ 总分 0.75 → 2 星 */
  check(run('calcStarsRider(135, 90, 10, 10, 100)') === 2,
    '超时 50% + 满好评 = 2 星');
  /* ★ 超时严重 + 好评低 → 最低也是 1 星，且**没有任何"失败"返回值** */
  const worst = run('calcStarsRider(9999, 90, 0, 10, 0)');
  check(worst === 1, '★ 超时严重 + 零好评 → 仍返回 1 星（不是 0、不是失败）');
  check(typeof worst === 'number' && worst >= 1,
    '★ 评星函数永远返回 ≥1（送达即算完成）');

  /* ---- ④ 没有 targetTime 的关卡：只按好评率 ---- */
  check(run('calcStarsRider(9999, 0, 10, 10, 100)') === 3,
    '没目标时间的关卡：满好评 = 3 星（不被时间拖累）');

  /* ---- ⑤ 好评率取不到时的兜底（不能崩、不能惩罚）---- */
  check(run('calcStarsRider(60, 90, 10, 10, undefined)') === 3,
    '好评率缺失 → 按满分算（不惩罚玩家）');
  check(typeof run('calcStarsRider(NaN, NaN, 10, 10, NaN)') === 'number',
    '全部传 NaN 也不崩，返回数字');

  /* ============================================================
   * ---- ⑥ ★★ 超时的行为"按模式分叉"（2026-10-06 改）★★ ----
   * ============================================================
   * ⚠️ 这一段原来叫"超时不失败"，无条件断言"超时也能过关"。
   *    十一的新决定是**按模式区分**：
   *      · 经典模式 = 放松模式 → 超时不失败（老行为，必须保住）
   *      · 骑手模式 = 压力模式 → 超时即失败（新规则）
   *    ⇒ 所以这里**不是删掉老断言，而是把它拆成两条按模式走**，
   *      两条都留着 —— 这样无论哪边的行为被改坏都会报警。
   * ============================================================ */

  /* ============================================================
   * ⚠️⚠️ 写这几条测试时踩的坑（很重要，记下来免得重踩）⚠️⚠️
   * ============================================================
   *   一开始我是这样伪造"已超时"的：
   *       run('Game.elapsed = 9999');
   *   结果**判定永远不触发**（一直 clear），排查半天。
   *
   *   原因：updatePlaying() 的**第一行**就会重算 elapsed：
   *       Game.elapsed = (performance.now() - Game.startTime) / 1000;
   *   所以手改 Game.elapsed 在下一帧就被覆盖掉了。
   *
   *   ⇒ 正确做法：伪造 **Game.startTime**（把起跑时间往前推），
   *     这样重算出来的 elapsed 才真的是"已经超时"。
   *     也就是说 —— 这里**必须走真实的时间计算路径**，
   *     否则测的就不是真实行为。
   * ============================================================ */
  /* 统一工具：把本局起跑时间往前推 N 秒（等价于"已经跑了 N 秒"） */
  const fakeElapsed = function (seconds) {
    run('Game.startTime = performance.now() - ' + (seconds * 1000) + ';');
  };

  /* ---- ⑥-a 经典模式：严重超时 → ★照样过关★（老行为必须保住）---- */
  run('Game.skipWeatherBrief = true;');
  run('Game.mode="single";Game.playerCount=1;Save.setMode("classic");loadLevel(0)');
  fakeElapsed(9999);                                // 假装已经超时到离谱
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'clear',
    '★★ 经典模式：严重超时的情况下，到终点照样过关（超时≠失败，老行为保住）★');
  check(run('Game.deathReason') !== 'timeout',
    '★ 经典模式：没有任何地方把超时写成死因');

  /* ---- ⑥-b 骑手模式：超时 + 过完宽限期 → ★失败★（新规则）---- */
  run('Game.mode="single";Game.playerCount=1;Save.setMode("rider");loadLevel(0)');
  check(run('typeof TIMEOUT_GRACE') === 'number', '宽限期常量 TIMEOUT_GRACE 存在');
  fakeElapsed(run('Game.level.targetTime') + run('TIMEOUT_GRACE') + 1);  // 超时且过完宽限
  run('Game.coinsTaken = Game.coinsRequired');                          // 订单够了
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'gameover',
    '★★ 骑手模式：超时且过完宽限期 → 配送失败（新规则）★');
  check(run('Game.deathReason') === 'timeout',
    '★★ 骑手模式：死因是 timeout（失败页会显示"配送超时"）★');
  check(run('Game.playerHeartsAtDeath') !== null,
    '★ 超时失败也走统一收尾（好评率快照有值，失败页能显示好评率）');

  /* ---- ⑥-c 骑手模式：超时但**在宽限期内**到达 → ★必须过关（不能误杀）★ ---- */
  run('Game.mode="single";Game.playerCount=1;Save.setMode("rider");loadLevel(0)');
  fakeElapsed(run('Game.level.targetTime') + 1);      // 已超时 1 秒，但宽限期有 5 秒
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'clear',
    '★★ 骑手模式：宽限期内到达终点 → 正常过关（★没有误杀★）');

  /* ---- ⑥-d 骑手模式：宽限期边界（刚好等于宽限期 → 判负）---- */
  run('Game.mode="single";Game.playerCount=1;Save.setMode("rider");loadLevel(0)');
  fakeElapsed(run('Game.level.targetTime') + run('TIMEOUT_GRACE') + 0.05);  // 刚好越过边界
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'gameover',
    '★ 骑手模式：刚好越过宽限期 → 判负（边界行为明确）');

  /* ---- ⑥-e 骑手模式：还没超时 → 当然能过关 ---- */
  run('Game.mode="single";Game.playerCount=1;Save.setMode("rider");loadLevel(0)');
  fakeElapsed(run('Game.level.targetTime') - 5);      // 提前到达
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'clear', '★ 骑手模式：准时到达 → 正常过关');

  /* ---- ⑥-f 联机模式：不启用超时判负（避免和房主不同步）---- */
  /* ⚠️ 联机客人端在 updatePlaying 里会提前 return，本来就到不了判定；
   *    这里测的是**房主端**（mode='online' 且走完整物理），
   *    确认它也不判超时 —— 因为房主一改 state 就可能和客人不同步。 */
  run('Game.mode="online";Game.playerCount=1;Save.setMode("rider");loadLevel(0)');
  fakeElapsed(run('Game.level.targetTime') + run('TIMEOUT_GRACE') + 30);
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.deathReason') !== 'timeout',
    '★★ 联机模式不判超时（整个 online 模式都禁用，避免不同步）★');
  run('Game.mode="single";Save.setMode("classic");');   // 恢复，免得影响后面的测试

  /* ---- ⑦ 旧档兼容：没有 mode 字段的老档要补成 classic ---- */
  store = {};
  const sbOld = buildSandbox();
  loadAll(sbOld);
  const runOld = mkRun(sbOld);
  // 造一份"第 2 期之前"的 v2 存档（没有 mode）
  store[runOld('SAVE_KEY_LEGACY')] = JSON.stringify({
    version: 2, maxUnlocked: 3,
    unlockedActions: ['doublejump'], levels: { '1': { cleared: true, bestStars: 3 } },
    selectedCharacter: 'kangaroo', unlockedCharacters: ['kangaroo', 'dragon'],
    characterRecords: {}, seenUnlockAnimations: [],
    settings: { soundOn: true, volume: 0.7, hintsOn: true, shakeOn: true },
  });
  const d = runOld('(function(){Save.load();return Save.data})()');
  check(d.mode === 'classic', '★ 旧档（无 mode）升级后补成 classic');
  check(d.maxUnlocked === 3, '★ 旧档的关卡进度没丢（maxUnlocked=3）');
  check(d.levels['1'] && d.levels['1'].cleared === true, '★ 旧档的通关记录没丢');

  /* ---- ⑧ 清档保留模式（模式是偏好，不是进度）---- */
  store = {};
  const sb2 = buildSandbox();
  loadAll(sb2);
  const run2 = mkRun(sb2);
  run2('Save.load()');
  run2('Save.setMode("rider")');
  run2('Save.reset()');
  check(run2('Save.mode()') === 'rider', '★ 清档后模式选择保留（和设置一样）');
  check(run2('Save.data.maxUnlocked') === 1, '清档确实清掉了进度');
}

/* ============================================================
 * ★ 第 7 期：E3 神秘订单 + 称号（2026-10-06）★
 * ============================================================
 * 重点守住：
 *   · 称号能解锁、能查、重复解锁不重复提示
 *   · ★神秘订单**不影响过关**★（没达成也照样 clear）
 *   · 旧档兼容（没有 titles 字段也补默认值）
 * ============================================================ */
console.log('\n=== 七、神秘订单 + 称号（第 7 期）===');
{
  store = {};
  const sb = buildSandbox();
  loadAll(sb);
  const run = mkRun(sb);
  run('Save.load()');

  /* ---- 称号读写 ---- */
  check(run('Save.hasTitle("测试称号")') === false, '初始没有称号');
  check(run('Save.addTitle("测试称号")') === true, '首次解锁称号返回 true（该弹提示）');
  check(run('Save.hasTitle("测试称号")') === true, '解锁后能查到');
  check(run('Save.addTitle("测试称号")') === false,
    '★ 重复解锁返回 false（不重复弹提示）');
  check(run('Save.listTitles().length') === 1, '称号列表只有 1 个（没重复）');
  check(run('Save.addTitle("")') === false, '空称号被忽略');
  check(run('Save.addTitle(null)') === false, 'null 称号被忽略');

  /* ---- 神秘订单表 ---- */
  const mo = run('JSON.stringify(MYSTERY_ORDERS.map(function(m){return m.id}))');
  check(mo.indexOf('no_pickup') >= 0 && mo.indexOf('all_pickup') >= 0 &&
    mo.indexOf('no_damage') >= 0, '三种神秘订单都定义了: ' + mo);
  check(run('mysteryOrderForLevel(0) !== null'), '第 1 关有神秘订单');
  check(run('mysteryOrderForLevel(99) === null'), '不存在的关卡返回 null（不崩）');

  /* ---- ★★ 最核心：神秘订单不影响过关 ★★ ---- */
  run('Game.mode="single";Game.playerCount=1;loadLevel(0)');
  /* 故意"碰满"订单袋 + 挨一次打 → 两个挑战都没达成 */
  run('Game.challengeStats.coinsTouched = 99; Game.challengeStats.damageTaken = 5;');
  /* 但订单数量刚好够过关 */
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'clear',
    '★★ 挑战没达成，但**照样过关**（神秘订单不影响过关）');
  /* ⚠️ 2026-10-06 更新：现在通关还会跑**全局成就**判定
   *    （`checkGlobalAchievements()`，见 save.js 的 GLOBAL_ACHIEVEMENTS）。
   *    通关第 1 关天然满足"开张大吉"，所以 `newTitleThisClear` 不再是 null。
   *
   *    ⇒ 这条断言的本意是"**神秘订单那个称号**没解锁"，
   *      所以改成直接查那个称号，而不是查"有没有任何新称号"——
   *      后者会随着"加了新的全局成就"而失效（测试太脆）。 */
  check(run('Save.hasTitle("一单未取")') === false,
    '★ 神秘订单挑战没达成 → 那个称号没解锁（但也不影响过关）');
  check(run('Save.hasTitle("开张大吉")') === true,
    '★ 但全局成就「开张大吉」照样解锁（通关第一单就达成）');

  /* ---- 达成挑战 → 解锁称号 ---- */
  run('Game.mode="single";Game.playerCount=1;loadLevel(0)');
  /* 「洁癖客户」的条件：只碰必要数量的订单袋 */
  run('Game.challengeStats.coinsTouched = Game.coinsRequired; Game.challengeStats.damageTaken = 0;');
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.state') === 'clear', '达成挑战后照样过关');
  /* ⚠️ 2026-10-06 更新：`newTitleThisClear` 现在是"本局新解锁的**所有**称号"
   *    拼成的一行（神秘订单 + 全局成就可能一起达成）。
   *    所以用 indexOf 判断"包含"，不再用 === 全等。 */
  check(String(run('Game.newTitleThisClear')).indexOf('一单未取') >= 0,
    '★ 达成挑战 → 记录了新解锁的称号「一单未取」: ' + run('Game.newTitleThisClear'));
  check(run('Save.hasTitle("一单未取")') === true, '称号写进了存档');

  /* ---- 「零差评」：不挨打 ---- */
  run('Game.mode="single";Game.playerCount=1;loadLevel(2)');   // 第 3 关有 no_damage
  run('Game.challengeStats.coinsTouched = 0; Game.challengeStats.damageTaken = 0;');
  run('Game.coinsTaken = Game.coinsRequired');
  run('Game.players[0].x = Game.level.goal.x; Game.players[0].y = Game.level.goal.y;');
  for (let f = 0; f < 6; f++) run('InputState.now={};update(0.016);InputState.tick();');
  check(run('Game.newTitleThisClear') === '金身不破',
    '★ 全程不挨打 → 解锁「金身不破」: ' + run('Game.newTitleThisClear'));

  /* ---- 旧档兼容：没有 titles 字段 ---- */
  store = {};
  const sbT = buildSandbox();
  loadAll(sbT);
  const runT = mkRun(sbT);
  store[runT('SAVE_KEY_LEGACY')] = JSON.stringify({
    version: 2, maxUnlocked: 2, unlockedActions: [], levels: {},
    selectedCharacter: 'kangaroo', unlockedCharacters: ['kangaroo'],
    characterRecords: {}, seenUnlockAnimations: [],
    settings: { soundOn: true, volume: 0.7, hintsOn: true, shakeOn: true },
    mode: 'rider',
  });
  const dT = runT('(function(){Save.load();return Save.data})()');
  check(Array.isArray(dT.titles) && dT.titles.length === 0,
    '★ 旧档（无 titles）升级后补成空数组，不丢档');
  check(dT.mode === 'rider', '★ 旧档的 mode 字段保留');

  /* ---- 清档会清称号（称号属于进度） ---- */
  store = {};
  const sbR = buildSandbox();
  loadAll(sbR);
  const runR = mkRun(sbR);
  runR('Save.load()');
  runR('Save.addTitle("要被清掉的称号")');
  runR('Save.reset()');
  check(runR('Save.hasTitle("要被清掉的称号")') === false,
    '★ 清档会清掉称号（称号属于游戏进度）');
}

console.log('\n=========================================');
console.log(pass + ' 项通过, ' + fail + ' 项失败');
if (fail > 0) { console.log(fail + ' 项失败 ✗'); process.exit(1); }
console.log('本地存档全部正常 ✓');

