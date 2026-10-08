/* ============================================================
 * scooter-test.js — 🛵 外卖车（借车加速）测试
 * ============================================================
 * 十一的要求（2026-10-07 改版）：
 *   "去掉随机充电桩，保留外卖车。
 *    碰到外卖车可以加速几秒，外卖车没电了，就加速不了。"
 *
 * 早先的硬约束（依然有效）：
 *   "**只加速地面，不改跳跃**"（这条是红线）
 *
 * ------------------------------------------------------------
 * ★ 本测试要守住的核心（按重要性排）★
 * ------------------------------------------------------------
 *   ① ★★ **不改跳跃、不改物理参数** ★★
 *      外卖车只能乘在**水平速度**上。跳跃高度必须**一模一样**。
 *      这是十一明确定的红线，也是最容易被后人改坏的地方。
 *   ② **充电桩真的没了**（源码级 + 运行时双重检查）
 *   ③ **碰到车 → 限时加速**（有明确时长、会自动结束）
 *   ④ **没电的车借不了**（"车没电了，就加速不了"）
 *   ⑤ **车会耗尽**（借 BOOSTS_PER_BIKE 次之后就没电了）
 *   ⑥ **不会无限续**（站在车上不能反复刷满加速）
 *   ⑦ "有概率刷新"是按关卡固定的（同一关每次结果一样）
 *   ⑧ 车不刷在半空中（必须站在可站的实心面上）
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; }
}
function checkEq(a, b, msg) {
  check(a === b, msg + (a === b ? '' : '  → 实际: ' + JSON.stringify(a) + '，期望: ' + JSON.stringify(b)));
}

/* ---------- 沙箱 ---------- */
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
          state: 'running', currentTime: 0, sampleRate: 44100,
          createBuffer: function (ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; },
          createBufferSource: function () { return { buffer: null, loop: false, connect: noop, start: noop, stop: noop }; },
          createBiquadFilter: function () { return { type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { setValueAtTime: noop }, connect: noop }; },
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
    localStorage: {
      getItem: function () { return null; }, setItem: noop, removeItem: noop, clear: noop,
    },
  };
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

/* ⚠️ 顺序必须和 index.html 一致（scooter.js 要在 game.js / render.js 之前） */
const FILES = [
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
  'device-mode.js', 'save.js', 'net.js',
  'scooter.js',                 // ← 本测试的主角
  'render.js', 'game.js',
];

function fresh() {
  const sb = buildSandbox();
  FILES.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
  });
  return sb;
}
const mkRun = sb => code => vm.runInContext(code, sb);

const sb = fresh();
const run = mkRun(sb);

/* ============================================================
 * 1. 模块存在 + 参数合理
 * ============================================================ */
console.log('\n=== 1. 模块与参数 ===');
check(run('typeof SCOOTER === "object" && SCOOTER !== null'), 'SCOOTER 模块已加载');
const cfg = JSON.parse(run('JSON.stringify(SCOOTER.CFG)'));
check(cfg.SPEED_MUL > 1 && cfg.SPEED_MUL <= 2,
  '速度倍率 ' + cfg.SPEED_MUL + '（要 >1 且别太夸张，避免飞过落点）');
check(cfg.BOOST_SECONDS > 0 && cfg.BOOST_SECONDS <= 10,
  '★ 加速时长 ' + cfg.BOOST_SECONDS + ' 秒（十一："加速几秒"）');
check(cfg.BOOSTS_PER_BIKE >= 1 && cfg.BOOSTS_PER_BIKE <= 5,
  '★ 每台车能借 ' + cfg.BOOSTS_PER_BIKE + ' 次（借完就没电）');
check(cfg.RELEND_COOL > 0, '加速结束有冷却 ' + cfg.RELEND_COOL + ' 帧（防无限续）');
check(cfg.LOW_RATIO > 0 && cfg.LOW_RATIO < 0.5, '低电量阈值 ' + cfg.LOW_RATIO);
check(cfg.SPAWN_CHANCE > 0 && cfg.SPAWN_CHANCE <= 1, '刷新概率 ' + cfg.SPAWN_CHANCE);

/* ============================================================
 * 2. ★★ 红线：不改跳跃、不改物理参数 ★★
 * ============================================================
 * 十一明确定的"只加速地面，不改跳跃"。
 * 做法上我用的是"乘在水平速度上"，所以跳跃参数**根本没被碰过**。
 * 但要防止以后有人"顺手"在 scooter.js 里改 CONFIG —— 用源码级检查守住。
 */
console.log('\n=== 2. ★★ 红线：只加速地面，不改跳跃 / 不改物理 ★★');
{
  const src = fs.readFileSync(path.join(SRC, 'js', 'scooter.js'), 'utf8');
  check(!/CONFIG\.\w+\s*=[^=]/.test(src),
    '★ scooter.js 里没有给 CONFIG 任何字段赋值（不改物理参数）');
  check(!/JUMP_POWER\s*=/.test(src) && !/GRAVITY\s*=/.test(src),
    '★ scooter.js 里没有改 JUMP_POWER / GRAVITY（不改跳跃）');
  const phy = fs.readFileSync(path.join(SRC, 'js', 'physics.js'), 'utf8');
  check(!/scooter/i.test(phy), '★ physics.js 里完全没有"外卖车"的痕迹（没被污染）');
  check(/function speedMulFor/.test(src) && /speedMulFor: speedMulFor/.test(src),
    '★ 只通过 speedMulFor() 影响速度（单一入口，好审计）');
}

/* ============================================================
 * 3. ★ 充电桩真的删掉了
 * ============================================================ */
console.log('\n=== 3. ★ 充电桩已删除 ===');
{
  const src = fs.readFileSync(path.join(SRC, 'js', 'scooter.js'), 'utf8');
  check(!/data\.chargers\.push/.test(src),
    '★ scooter.js 里不再往 chargers 里塞东西（不再生成桩）');
  check(!/CHARGE_SECONDS/.test(src),
    '★ 充电时长参数 CHARGE_SECONDS 已移除（不留无意义的配置）');
  /* 渲染层不再画桩 */
  const rnd = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(!/drawCharger|充电桩（画在车之前/.test(rnd),
    '★ render.js 里没有"画充电桩"的分支了');
  /* 运行时：任何关卡都不该有桩 */
  const res = run(`(function(){
    var out = [];
    var all = (typeof PLAYABLE_LEVELS === 'function') ? PLAYABLE_LEVELS() : LEVELS;
    all.forEach(function(raw){
      var lv = parseLevel(raw);
      var d = SCOOTER.buildForLevel(lv);
      out.push({ id: lv.id, chargers: (d.chargers||[]).length });
    });
    return out;
  })()`);
  check(res.every(r => r.chargers === 0),
    '★ 全部 ' + res.length + ' 关运行时都没有充电桩（chargers 恒为空）');
}

/* ============================================================
 * 4. ★ 实测：碰到车后，水平速度变了，但跳跃高度**一个像素都没变**
 * ============================================================
 * 这是本文件最重要的测试 —— 用真实物理循环跑出来，不是看代码。
 * ⚠️ 旧版这里是"手动造一台骑着的车"；改版后要**真的走拾取流程**
 *    （碰到车 → 借到加速），否则测不出"碰到车才加速"这件事。
 */
console.log('\n=== 4. ★ 实测：碰到车才加速、跳跃高度不变 ===');
{
  const res = run(`(function(){
    function setup(){
      Game.mode='single'; Game.playerCount=1;
      Save.reset();
      loadLevel(0);
      Game.state='playing';
      var p = Game.players[0];
      p.x = 400; p.y = 600; p.vx = 0; p.vy = 0;
      p.onGround = true;
      if (typeof initRideState === 'function') initRideState(p);
      return p;
    }

    /* --- 不碰车：跑 1 秒，量水平位移 --- */
    var pA = setup();
    var dA = SCOOTER.current();
    dA.bikes = [];  dA.chargers = [];        // 清空：这一关没有车
    var x0 = pA.x;
    for (var f = 0; f < 60; f++) {
      InputState.now = {}; InputState.now['ArrowRight'] = true;
      update(1/60); InputState.tick();
    }
    var distWalk = Math.abs(pA.x - x0);

    /* --- 碰到车：把车放在玩家身上，跑 1 秒 --- */
    var pB = setup();
    var dB = SCOOTER.current();
    dB.bikes = [{ x: pB.x - 10, y: pB.y, w: 46, h: 30, charge: 1, seed: 0.3 }];
    dB.chargers = [];
    var x1 = pB.x;
    /* 先跑一帧让"碰到车"生效 */
    InputState.now = {}; update(1/60); InputState.tick();
    var boosted = pB.boostTimer > 0;
    for (var f2 = 0; f2 < 60; f2++) {
      InputState.now = {}; InputState.now['ArrowRight'] = true;
      update(1/60); InputState.tick();
    }
    var distBoost = Math.abs(pB.x - x1);

    /* --- 跳跃高度：两种情况各跳一次，量最高点 --- */
    function jumpHeight(withBoost){
      var p = setup();
      var d = SCOOTER.current();
      d.bikes = []; d.chargers = [];
      if (withBoost) {
        if (typeof initRideState === 'function') initRideState(p);
        p.boostTimer = 240;               // 直接点亮加速（测物理是否受影响）
      }
      var y0 = p.y, minY = p.y;
      InputState.now = {}; InputState.now['Space'] = true;
      update(1/60); InputState.tick();
      InputState.now = {};
      for (var f = 0; f < 90; f++) {
        InputState.now = {};
        update(1/60); InputState.tick();
        if (p.y < minY) minY = p.y;
      }
      return y0 - minY;
    }
    var hWalk = jumpHeight(false);
    var hBoost = jumpHeight(true);

    return { distWalk: distWalk, distBoost: distBoost, boosted: boosted,
             hWalk: hWalk, hBoost: hBoost };
  })()`);

  console.log('    不碰车位移: ' + res.distWalk.toFixed(1) + ' px');
  console.log('    碰到车位移: ' + res.distBoost.toFixed(1) + ' px');
  console.log('    不加速跳跃高度: ' + res.hWalk.toFixed(2) + ' px');
  console.log('    加速中跳跃高度: ' + res.hBoost.toFixed(2) + ' px');
  check(res.boosted, '★ 碰到车 → 点亮加速（boostTimer > 0）');
  check(res.distBoost > res.distWalk * 1.2,
    '★ 加速期间**明显更快**（' + (res.distBoost / res.distWalk).toFixed(2) + ' 倍）');
  check(Math.abs(res.hBoost - res.hWalk) < 0.01,
    '★★ 跳跃高度**完全一致**（差 ' + Math.abs(res.hBoost - res.hWalk).toFixed(4) + ' px）—— 红线守住');
}

/* ============================================================
 * 5. speedMulFor / boostRatio：只在加速期间生效
 * ============================================================ */
console.log('\n=== 5. speedMulFor / boostRatio 的边界 ===');
{
  checkEq(run('SCOOTER.speedMulFor({ boostTimer: 0 })'), 1, '没加速 → 倍率 1');
  checkEq(run('SCOOTER.speedMulFor(null)'), 1, 'null → 倍率 1');
  checkEq(run('SCOOTER.speedMulFor({})'), 1, '空对象 → 倍率 1');
  const full = run('SCOOTER.speedMulFor({ boostTimer: 240 })');
  const tail = run('SCOOTER.speedMulFor({ boostTimer: 1 })');
  check(full > 1 && full <= cfg.SPEED_MUL + 1e-6,
    '刚借到 → 接近满倍率 (' + full.toFixed(3) + ')');
  check(tail > 1 && tail < full,
    '最后 1 秒 → 缓出（' + tail.toFixed(3) + ' < ' + full.toFixed(3) + '，不会"啪"地掉回原速）');
  checkEq(run('SCOOTER.boostRatio({ boostTimer: 0 })'), 0, '没加速 → 倒计时比例 0');
  check(Math.abs(run('SCOOTER.boostRatio({ boostTimer: 240 })') - 1) < 1e-6,
    '刚借到 → 倒计时比例 1');
  check(run('SCOOTER.boostRatio({ boostTimer: 120 }) > 0 && SCOOTER.boostRatio({ boostTimer: 120 }) < 1'),
    true, '中途 → 比例介于 0~1（进度条会动）');
  checkEq(run('SCOOTER.boostSecondsLeft({ boostTimer: 121 })'), 3, '剩余秒数向上取整（121 帧 → 3 秒）');
  checkEq(run('SCOOTER.boostSecondsLeft({ boostTimer: 0 })'), 0, '没加速 → 0 秒');
}

/* ============================================================
 * 6. ★ 完整的借车生命周期：碰到 → 加速 → 结束 → 冷却
 * ============================================================ */
console.log('\n=== 6. ★ 借车生命周期 ===');
{
  const res = run(`(function(){
    Game.mode='single'; Game.playerCount=1;
    Save.reset();
    loadLevel(0);
    Game.state='playing';
    var p = Game.players[0];
    if (typeof initRideState === 'function') initRideState(p);
    var d = SCOOTER.current();
    d.bikes = [{ x: p.x, y: p.y, w: 46, h: 30, charge: 1, seed: 0.1 }];
    d.chargers = [];

    /* ① 碰到 → 应该借到加速，车掉半格电 */
    SCOOTER.update(p, Game.level, 1/60);
    var gotBoost = p.boostTimer > 0;
    var chargeAfter1 = d.bikes[0].charge;
    var timer0 = p.boostTimer;

    /* ② 站在车上不动：倒计时应逐帧减少，但**不该重置回满** */
    for (var i = 0; i < 10; i++) SCOOTER.update(p, Game.level, 1/60);
    var timer10 = p.boostTimer;
    var stillOneBoost = (timer10 === timer0 - 10);

    /* ③ 跑到时间耗尽 */
    var guard = 0;
    while (p.boostTimer > 0 && guard++ < 2000) SCOOTER.update(p, Game.level, 1/60);
    var ended = p.boostTimer === 0;
    var locked = p.boostLock > 0;
    var expiredFlag = SCOOTER.takeExpired();

    /* ④ 冷却期间再 update：不该重新借到（防无限续） */
    SCOOTER.update(p, Game.level, 1/60);
    var stillOff = p.boostTimer === 0;

    /* ⑤ 冷却结束后又碰到车 → 又能借（车还剩半格电） */
    p.boostLock = 0;
    SCOOTER.update(p, Game.level, 1/60);
    var gotBoost2 = p.boostTimer > 0;
    var chargeAfter2 = d.bikes[0].charge;

    return { gotBoost: gotBoost, chargeAfter1: chargeAfter1,
             stillOneBoost: stillOneBoost, ended: ended, locked: locked,
             expiredFlag: expiredFlag, stillOff: stillOff,
             gotBoost2: gotBoost2, chargeAfter2: chargeAfter2 };
  })()`);
  check(res.gotBoost, '★ 碰到车 → 借到限时加速');
  check(Math.abs(res.chargeAfter1 - (1 - 1 / cfg.BOOSTS_PER_BIKE)) < 1e-6,
    '★ 借一次 → 车掉 ' + (1 / cfg.BOOSTS_PER_BIKE).toFixed(2) + ' 格电（剩 ' + res.chargeAfter1.toFixed(2) + '）');
  check(res.stillOneBoost, '★ 站在车上**不会**反复刷满加速（倒计时只减不重置）');
  check(res.ended, '★ 时间到 → 加速自动结束');
  check(res.locked, '★ 加速结束后有冷却（防立刻重新借）');
  check(res.expiredFlag, '★ 结束时置了一次性提示标记（玩家能收到"加速结束"反馈）');
  check(res.stillOff, '★ 冷却期间不会又借到（防无限续）');
  check(res.gotBoost2, '★ 冷却结束 + 车还有电 → 能再借一次');
  check(Math.abs(res.chargeAfter2) < 1e-6,
    '★ 借第二次 → 车电归零（' + res.chargeAfter2.toFixed(2) + '）');
}

/* ============================================================
 * 7. ★ "车没电了，就加速不了"
 * ============================================================ */
console.log('\n=== 7. ★ 没电的车借不了 ===');
{
  const res = run(`(function(){
    Game.mode='single'; Game.playerCount=1;
    Save.reset();
    loadLevel(0);
    Game.state='playing';
    var p = Game.players[0];
    if (typeof initRideState === 'function') initRideState(p);
    var d = SCOOTER.current();
    d.bikes = [{ x: p.x, y: p.y, w: 46, h: 30, charge: 0, seed: 0.2 }];
    d.chargers = [];
    SCOOTER.update(p, Game.level, 1/60);
    var noBoost = p.boostTimer === 0;
    var mul = SCOOTER.speedMulFor(p);
    return { noBoost: noBoost, mul: mul };
  })()`);
  check(res.noBoost, '★ 电量 0 的车**借不到加速**（十一："外卖车没电了，就加速不了"）');
  checkEq(res.mul, 1, '★ 没加速时速度倍率 = 1（不会白加速）');
}

/* ============================================================
 * 8. ★ 一台车的总续航 = BOOST_SECONDS × BOOSTS_PER_BIKE
 * ============================================================
 * 把车"借到不能借"为止，统计实际拿到多少秒加速。
 */
console.log('\n=== 8. ★ 一台车的总续航 ===');
{
  const res = run(`(function(){
    Game.mode='single'; Game.playerCount=1;
    Save.reset();
    loadLevel(0);
    Game.state='playing';
    var p = Game.players[0];
    if (typeof initRideState === 'function') initRideState(p);
    var d = SCOOTER.current();
    d.bikes = [{ x: p.x, y: p.y, w: 46, h: 30, charge: 1, seed: 0.5 }];
    d.chargers = [];

    var totalFrames = 0, times = 0, guard = 0;
    while (guard++ < 20000) {
      var had = p.boostTimer > 0;
      SCOOTER.update(p, Game.level, 1/60);
      if (p.boostTimer > 0) {
        if (!had) times++;                 // 新借到一次
        totalFrames++;
      }
      /* 跑空就停 */
      if (d.bikes[0].charge <= 0 && p.boostTimer === 0) break;
    }
    return { times: times, seconds: totalFrames / 60, charge: d.bikes[0].charge };
  })()`);
  console.log('    一台车共借到 ' + res.times + ' 次，合计 ' + res.seconds.toFixed(1) + ' 秒加速');
  checkEq(res.times, cfg.BOOSTS_PER_BIKE, '★ 正好能借 ' + cfg.BOOSTS_PER_BIKE + ' 次');
  check(Math.abs(res.seconds - cfg.BOOST_SECONDS * cfg.BOOSTS_PER_BIKE) < 0.5,
    '★ 总续航 ≈ ' + (cfg.BOOST_SECONDS * cfg.BOOSTS_PER_BIKE) + ' 秒（实测 ' + res.seconds.toFixed(1) + '）');
  check(Math.abs(res.charge) < 1e-6, '★ 用完电量归零（车变"没电"状态）');
}

/* ============================================================
 * 9. ★ "有概率刷新"是按关卡固定的
 * ============================================================
 * 同一关连续 build 两次，结果必须完全一样；
 * 而且要有"有车"和"没车"两种关卡都出现（否则就是没生效）。
 */
console.log('\n=== 9. ★ 刷新是"按关卡固定"（不是每帧随机）===');
{
  const res = run(`(function(){
    var out = [];
    var all = (typeof PLAYABLE_LEVELS === 'function') ? PLAYABLE_LEVELS() : LEVELS;
    all.forEach(function(raw){
      var lv = parseLevel(raw);
      var a = SCOOTER.buildForLevel(lv);
      var n1 = a.bikes.length;
      var x1 = a.bikes.length ? a.bikes[0].x : null;
      var c1 = a.bikes.length ? a.bikes[0].charge : null;
      /* 再跑一次（模拟"重进同一关"） */
      var b = SCOOTER.buildForLevel(lv);
      var n2 = b.bikes.length;
      var x2 = b.bikes.length ? b.bikes[0].x : null;
      out.push({ id: lv.id, n1: n1, n2: n2, x1: x1, x2: x2, c1: c1 });
    });
    return out;
  })()`);

  const stable = res.every(r => r.n1 === r.n2 && r.x1 === r.x2);
  check(stable, '★ 同一关连续生成两次结果**完全一致**（不会"时有时无"）');

  const withBike = res.filter(r => r.n1 > 0);
  console.log('    有外卖车的关卡: ' + (withBike.map(r => '第' + r.id + '关').join(', ') || '（无）'));
  check(withBike.length > 0, '★ 有关卡刷出了外卖车');
  check(withBike.length < res.length, '★ 也有没刷出来的关卡（"有概率"成立）');
  check(res.every(r => r.c1 === null || r.c1 === 1),
    '★ 新生成的车**都是满电**（重开一局不该继承"没电"）');
}

/* ============================================================
 * 10. ★ 外卖车不会刷在半空中
 * ============================================================
 * 每台车下方必须有可站的实心面（否则玩家看到一台悬空的车，很出戏）。
 */
console.log('\n=== 10. ★ 外卖车站在地面上（不悬空）===');
{
  const res = run(`(function(){
    var out = [];
    var all = (typeof PLAYABLE_LEVELS === 'function') ? PLAYABLE_LEVELS() : LEVELS;
    all.forEach(function(raw){
      var lv = parseLevel(raw);
      var d = SCOOTER.buildForLevel(lv);
      var T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;
      d.bikes.forEach(function(b){
        var footY = b.y + b.h;
        var cx = b.x + b.w/2;
        var supported = false;
        (lv.solids||[]).concat(lv.platforms||[]).forEach(function(s){
          if (s.x <= cx && s.x + s.w >= cx && Math.abs(s.y - footY) < 3) supported = true;
        });
        out.push({ id: lv.id, col: Math.round(cx/T), supported: supported });
      });
    });
    return out;
  })()`);
  res.forEach(r => console.log('    第' + r.id + '关 col' + r.col + ' → ' + (r.supported ? '有地面 ✅' : '悬空 ❌')));
  check(res.length === 0 || res.every(r => r.supported),
    '★ 所有外卖车都站在实心面上（没有悬空的车）');
}

/* ============================================================
 * 11. 进关会重置（不能靠"自杀重开"白嫖满电车）
 * ============================================================ */
console.log('\n=== 11. 进关重新生成 = 车回到满电 ===');
{
  const res = run(`(function(){
    Game.mode='single'; Game.playerCount=1;
    Save.reset();
    loadLevel(0);
    Game.state='playing';
    var p = Game.players[0];
    if (typeof initRideState === 'function') initRideState(p);
    var d = SCOOTER.current();
    d.bikes = [{ x: p.x, y: p.y, w: 46, h: 30, charge: 1, seed: 0.9 }];
    d.chargers = [];
    /* 把电用光 */
    var guard = 0;
    while (d.bikes[0].charge > 0 && guard++ < 20000) SCOOTER.update(p, Game.level, 1/60);
    var drained = d.bikes[0].charge;
    /* 重新进关 */
    SCOOTER.buildForLevel(Game.level);
    var d2 = SCOOTER.current();
    var recharged = d2.bikes.length ? d2.bikes[0].charge : null;
    return { drained: drained, recharged: recharged };
  })()`);
  check(Math.abs(res.drained) < 1e-6, '★ 用光后电量 = 0');
  check(res.recharged === null || res.recharged === 1,
    '★ 重新进关 → 车回到满电（本关生成的是新车）');
}

/* ============================================================
 * 12. 健壮性：模块缺席 / 缺字段都不能崩
 * ============================================================ */
console.log('\n=== 12. 健壮性 ===');
{
  const sbNo = (function () {
    /* 不加载 scooter.js 的沙箱 —— 模拟"删掉这个模块" */
    const s2 = buildSandbox();
    ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
      'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js'].forEach(function (f) {
        vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), s2, { filename: f });
      });
    return s2;
  })();
  const runNo = mkRun(sbNo);
  let err = null;
  try {
    runNo('Game.mode="single"; Game.playerCount=1; Save.reset(); loadLevel(0); Game.state="playing";');
    for (let f = 0; f < 10; f++) runNo('InputState.now={}; update(1/60); InputState.tick();');
  } catch (e) { err = e.message; }
  check(err === null, '★ 没有 scooter.js 时游戏照常跑（typeof 保护生效）' + (err ? '（实际: ' + err + '）' : ''));

  let err2 = null;
  try {
    run('SCOOTER.speedMulFor(null)');
    run('SCOOTER.speedMulFor({})');
    run('SCOOTER.boostRatio(null)');
    run('SCOOTER.boostRatio({})');
    run('SCOOTER.boostSecondsLeft(null)');
    run('SCOOTER.update(null, null, 1/60)');
    run('SCOOTER.buildForLevel(null)');
    run('SCOOTER.buildForLevel({})');
    run('SCOOTER.takeExpired()');
  } catch (e) { err2 = e.message; }
  check(err2 === null, '★ 传 null / 空对象也不抛异常' + (err2 ? '（实际: ' + err2 + '）' : ''));
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('  外卖车测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);
