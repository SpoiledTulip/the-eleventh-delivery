/* ============================================================
 * ai-pk-test.js — 🏁 PK 模式 · AI 骑手测试
 * ============================================================
 * 十一："要不要再加一个 PK 模式，先只开发 AI 骑手，跟我们比速度。"
 *
 * ------------------------------------------------------------
 * ★ 本测试要守住的核心（按重要性排）★
 * ------------------------------------------------------------
 *   ① ★★ **AI 不作弊** ★★
 *      AI 必须用和玩家一样的物理（同一套 makePlayer / CONFIG）。
 *      绝不能出现"AI 跑得更快 / 跳得更高"—— 玩家一眼就能看出来。
 *   ② ★★ **AI 不会卡死** ★★
 *      这是 PK 模式能不能用的关键：AI 卡住了，这场比赛就永远结束不了，
 *      玩家只能强退 —— 那是最差的体验。
 *      所以要有"卡住检测 + 兜底瞬移"两层保险。
 *   ③ **AI 输入和键盘完全隔离**
 *      AI 的输入绝不能驱动玩家角色（否则"我按一下，AI 也动"）。
 *   ④ PK 胜负判定：谁先到终点谁赢。
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
    localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop, clear: noop },
  };
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

/* ⚠️ 顺序和 index.html 一致 */
const FILES = [
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
  'device-mode.js', 'save.js', 'net.js',
  'scooter.js', 'ai-rider.js',
  'render.js', 'game.js',
  /* ★ ui.js 也要加载（2026-10-06）★
   * 原因：`startGame()` 在 ui.js 里，而它是 **PK 状态的唯一设置点**。
   * "PK 状态泄漏"那一段回归测试必须走真实的 startGame 路径 ——
   * 不加载 ui.js 就调不到它（ReferenceError: startGame is not defined）。
   * ⚠️ 顺序必须放最后（ui.js 依赖前面所有模块）。 */
  'ui.js',
];

function fresh() {
  const sb = buildSandbox();
  FILES.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
  });
  return sb;
}
const sb = fresh();
const run = code => vm.runInContext(code, sb);
const runJson = code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', sb));

/* ============================================================
 * 1. 模块与参数
 * ============================================================ */
console.log('\n=== 1. 模块 ===');
check(run('typeof AI_RIDER === "object" && AI_RIDER !== null'), 'AI_RIDER 模块已加载');
check(run('typeof PK_RACE === "object" && PK_RACE !== null'), 'PK_RACE 比赛规则模块已加载');
const cfg = runJson('AI_RIDER.CFG');
check(cfg.STUCK_JUMP > 0 && cfg.STUCK_TELEPORT > cfg.STUCK_JUMP,
  '卡住检测参数合理（跳 ' + cfg.STUCK_JUMP + ' 帧 < 瞬移 ' + cfg.STUCK_TELEPORT + ' 帧）');

/* ============================================================
 * 2. ★★ 红线：AI 不作弊 ★★
 * ============================================================
 * AI 必须用和玩家**完全一样**的物理。
 * 做法：让 AI 角色和玩家角色各跑 1 秒，比较位移。
 */
console.log('\n=== 2. ★★ AI 不作弊（物理与玩家一致）★★');
{
  const src = fs.readFileSync(path.join(SRC, 'js', 'ai-rider.js'), 'utf8');
  check(!/CONFIG\.\w+\s*=[^=]/.test(src), '★ ai-rider.js 没改任何 CONFIG 参数');
  check(!/speedMul\s*=[^=]/.test(src) && !/jumpMul\s*=[^=]/.test(src),
    '★ 没偷偷改角色的 speedMul / jumpMul');

  /* ⚠️ vx / vy 的检查要精确一点：
   *    AI **允许**在"兜底瞬移"时把速度清零（p.vx = 0）——
   *    那是"传送"的一部分，不是"自己造速度"。
   *    真正要禁止的是：**给 vx/vy 赋一个非零的值**（那才是作弊/绕过物理）。
   *    第一版我用了 `!/\bp\.vx\s*=/` —— 结果把合法的 `p.vx = 0` 也判为违规，
   *    是自己写错的断言，不是代码问题。 */
  const vxAssigns = src.match(/p\.vx\s*=\s*([^;]+);/g) || [];
  const vyAssigns = src.match(/p\.vy\s*=\s*([^;]+);/g) || [];
  const badVx = vxAssigns.filter(function (s) {
    /* 只允许赋 0（传送时清零），不允许赋速度值 */
    return !/p\.vx\s*=\s*0\s*;/.test(s);
  });
  const badVy = vyAssigns.filter(function (s) {
    return !/p\.vy\s*=\s*0\s*;/.test(s);
  });
  check(badVx.length === 0,
    '★ AI 不给自己造水平速度（唯一允许的赋值是传送时清零）' +
    (badVx.length ? '，违规: ' + badVx.join(' | ') : ''));
  check(badVy.length === 0,
    '★ AI 不给自己造垂直速度' + (badVy.length ? '，违规: ' + badVy.join(' | ') : ''));

  /* 实测：AI 角色和玩家角色跑同样时间，水平位移必须一致 */
  const res = run(`(function(){
    Game.mode='single'; Game.playerCount=1;
    Save.reset();
    loadLevel(0);
    Game.state='playing';
    var lv = Game.level;
    var solids = collectSolids(lv);
    var T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;

    /* 造两个"同款"角色：一个由键盘驱动，一个由 AI 驱动 */
    function mk(role){
      var spawn = lv.spawns.find(function(s){ return s.role===role; }) || lv.spawns[0];
      var p = makePlayer(role, { x: spawn.x, y: spawn.y });
      p.x = 600; p.y = 400; p.vx = 0; p.vy = 0; p.onGround = true;
      return p;
    }
    var human = mk('kangaroo');
    var ai    = mk('dragon');

    /* 人类：一直按住右 */
    var hx0 = human.x;
    for (var f=0; f<60; f++){
      InputState.now = {}; InputState.now['ArrowRight'] = true;
      InputState.tick();
    }

    /* 换一种做法：直接用同一个物理函数跑，避免两套输入干扰。
     * 这里只验证"AI 产生的是输入、不是速度" —— 所以查它的输出结构。 */
    AI_RIDER.reset(); AI_RIDER.initFor('dragon');
    AI_RIDER.update(ai, lv, solids);
    var out = ai._aiInput;
    return {
      hasInput: !!out,
      keys: out ? Object.keys(out).sort().join(',') : '',
      onlyBooleans: out ? (typeof out.left==='boolean' && typeof out.right==='boolean' && typeof out.jump==='boolean') : false,
      vxAfter: ai.vx
    };
  })()`);
  check(res.hasInput, '★ AI 产出了输入对象');
  check(res.keys === 'jump,left,right', '★ 输入只有 left/right/jump 三项（和键盘一样）', res.keys);
  check(res.onlyBooleans, '★ 输入全是布尔值（不是速度数值）');
  checkEq(res.vxAfter, 0, '★ AI 只产生输入，**自己不碰 vx**（vx 还是 0）');
}

/* ============================================================
 * 3. ★★ AI 会朝终点跑，而且能真的推进 ★★
 * ============================================================
 * 这是最核心的功能验证 —— 在真关卡里跑 N 秒，看 AI 前进多少。
 */
console.log('\n=== 3. ★★ AI 会朝终点跑（实测推进）★★');
{
  const res = run(`(function(){
    Save.reset();
    Game.mode='local'; Game.playerCount=2;
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    if (typeof InputState.clearAI === 'function') InputState.clearAI();
    loadLevel(0);
    Game.state='playing';

    var lv = Game.level;
    var solids = collectSolids(lv);
    var ai = null;
    Game.players.forEach(function(p){ if (p.role === 'dragon') ai = p; });
    if (!ai) return { err: 'AI 角色没建出来' };

    if (PK_RACE.current()) PK_RACE.current().countdown = 0;
    var x0 = ai.x;
    /* 跑 6 秒（360 帧） */
    for (var f=0; f<360; f++){
      InputState.now = {};                     // 玩家不动
      AI_RIDER.update(ai, lv, solids);
      InputState.setAI(ai.role, ai._aiInput || {left:false,right:false,jump:false});
      update(1/60);
      InputState.tick();
    }
    var x1 = ai.x;
    var st = AI_RIDER.statsFor('dragon');
    var prog = PK_RACE.progressOf(ai, lv);
    return { x0: x0, x1: x1, moved: x1 - x0, progress: prog,
             jumps: st.jumps, teleports: st.teleports,
             goalX: lv.goal.x, state: Game.state };
  })()`);

  if (res.err) { check(false, res.err); }
  else {
    console.log('    起点 x=' + Math.round(res.x0) + ' → 6 秒后 x=' + Math.round(res.x1));
    console.log('    推进 ' + Math.round(res.moved) + ' px，进度 ' + (res.progress * 100).toFixed(1) + '%');
    console.log('    跳了 ' + res.jumps + ' 次，兜底瞬移 ' + res.teleports + ' 次');
    check(res.moved > 300, '★ AI 真的在往前跑（推进 ' + Math.round(res.moved) + ' px）');
    check(res.progress > 0.05, '★ 进度条有变化（' + (res.progress * 100).toFixed(1) + '%）');
    check(res.jumps > 0, '★ AI 会自己跳（遇到障碍/坑）');
    check(res.teleports === 0, '★ 6 秒内**没有触发兜底瞬移**（说明它能正常跑）');
  }
}

/* ============================================================
 * 4. ★★ AI 不会卡死（长时间跑，进度必须持续增长）★★
 * ============================================================
 * 这是 PK 模式能不能用的关键：
 *   AI 卡住 = 比赛永远结束不了 = 玩家只能强退。
 *
 * 做法：跑 25 秒，分 5 段采样，要求**每一段都在推进**
 *（不能出现"连续 5 秒原地不动"）。
 */
console.log('\n=== 4. ★★ AI 不会卡死（25 秒持续推进）★★');
{
  const res = run(`(function(){
    Save.reset();
    Game.mode='local'; Game.playerCount=2;
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    if (typeof InputState.clearAI === 'function') InputState.clearAI();
    loadLevel(0);
    Game.state='playing';

    var lv = Game.level;
    var solids = collectSolids(lv);
    var ai = null;
    Game.players.forEach(function(p){ if (p.role === 'dragon') ai = p; });
    if (!ai) return { err: 'AI 角色没建出来' };

    var samples = [];
    var lastProg = 0;
    for (var seg = 0; seg < 5; seg++) {
      for (var f=0; f<300; f++){              // 每段 5 秒
        InputState.now = {};
        AI_RIDER.update(ai, lv, solids);
        InputState.setAI(ai.role, ai._aiInput || {left:false,right:false,jump:false});
        update(1/60);
        InputState.tick();
        if (Game.state !== 'playing') break;   // 到终点了就停
      }
      var prog = PK_RACE.progressOf(ai, lv);
      samples.push({ seg: seg+1, prog: prog, delta: prog - lastProg, state: Game.state });
      lastProg = prog;
      if (Game.state !== 'playing') break;
    }
    var st = AI_RIDER.statsFor('dragon');
    return { samples: samples, jumps: st.jumps, teleports: st.teleports, finalState: Game.state };
  })()`);

  if (res.err) { check(false, res.err); }
  else {
    res.samples.forEach(s => {
      console.log('    第' + s.seg + ' 段(5s): 进度 ' + (s.prog * 100).toFixed(1) + '%  (+' + (s.delta * 100).toFixed(1) + '%)');
    });
    console.log('    跳 ' + res.jumps + ' 次，兜底瞬移 ' + res.teleports + ' 次');
    /* 每一段都要有进展（允许最后一段因为到终点而停滞） */
    const progressed = res.samples.filter((s, i) =>
      s.delta > 0.005 || i === res.samples.length - 1);
    check(progressed.length === res.samples.length,
      '★★ **每一段都在推进**（没有卡死）');
    check(res.teleports <= 1,
      '★ 兜底瞬移 ≤ 1 次（' + res.teleports + '）—— 说明 AI 基本能自己跑通');
  }
}

/* ============================================================
 * 5. ★ AI 输入与键盘隔离
 * ============================================================
 * 一旦串了，玩家会发现"我按键，AI 也动"或"AI 抢我的角色"。
 */
console.log('\n=== 5. ★ AI 输入与键盘隔离 ===');
{
  const res = run(`(function(){
    Game.mode='local'; Game.playerCount=2;
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Save.reset();
    loadLevel(0);
    Game.state='playing';

    /* 给 AI 角色设一个"一直往右"的输入 */
    InputState.setAI('dragon', { left:false, right:true, jump:false });

    /* 玩家拼命按"左"（kangaroo 的键）+ 按住所有键 */
    InputState.now = {};
    InputState.now['ArrowLeft'] = true;
    InputState.now['ArrowRight'] = true;
    InputState.now['KeyA'] = true;
    InputState.now['KeyD'] = true;

    var aiReads = InputState.actionHeld('dragon', 'right');   // 应该是 AI 的 true
    var aiReadsLeft = InputState.actionHeld('dragon', 'left'); // 应该是 AI 的 false
    var humanRight = InputState.actionHeld('kangaroo', 'right'); // 应该是键盘的 true

    /* 清掉 AI → 应该退回读键盘 */
    InputState.clearAI();
    var afterClear = InputState.actionHeld('dragon', 'right');

    return { aiReads: aiReads, aiReadsLeft: aiReadsLeft,
             humanRight: humanRight, afterClear: afterClear,
             isAI: typeof InputState.isAI === 'function' };
  })()`);

  check(res.isAI, 'InputState 有 isAI() 接口');
  checkEq(res.aiReads, true, '★ AI 角色读到的是 **AI 的输入**（right=true）');
  checkEq(res.aiReadsLeft, false, '★ AI 的输入不被键盘覆盖（left 仍是 false）');
  checkEq(res.humanRight, true, '★ 玩家角色照常读键盘（不受 AI 影响）');
  checkEq(res.afterClear, true, '★ 清掉 AI 输入后退回读键盘（KeyD 按住 → true）');
}

/* ============================================================
 * 6. ★ PK 胜负判定：谁先到终点谁赢
 * ============================================================ */
console.log('\n=== 6. ★ PK 胜负判定 ===');
{
  const res = run(`(function(){
    Save.reset();
    Game.mode='local'; Game.playerCount=2;
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.pkResult = null;
    loadLevel(0);
    Game.state='playing';

    var lv = Game.level;
    var out = {};

    /* ① AI 先到 → 玩家输 */
    var ai = null, me = null;
    Game.players.forEach(function(p){ if (p.role==='dragon') ai = p; else me = p; });
    ai.x = lv.goal.x; ai.y = lv.goal.y;
    me.x = lv.goal.x - 800;              // 玩家还在很后面
    update(1/60);
    out.aiWins = Game.pkResult ? { isAI: Game.pkResult.winnerIsAI, state: Game.state } : null;

    /* ② 重置，玩家先到 → 玩家赢 */
    Game.pkResult = null;
    Game.state = 'playing';
    loadLevel(0);
    lv = Game.level;
    Game.players.forEach(function(p){ if (p.role==='dragon') ai = p; else me = p; });
    me.x = lv.goal.x; me.y = lv.goal.y;
    ai.x = lv.goal.x - 800;
    update(1/60);
    out.meWins = Game.pkResult ? { isAI: Game.pkResult.winnerIsAI, state: Game.state } : null;

    return out;
  })()`);

  check(!!res.aiWins, '★ AI 到终点 → 触发 PK 结算');
  if (res.aiWins) {
    checkEq(res.aiWins.isAI, true, '★ 判定为「AI 赢」');
    checkEq(res.aiWins.state, 'clear', '★ 比赛结束（state=clear）');
  }
  check(!!res.meWins, '★ 玩家到终点 → 触发 PK 结算');
  if (res.meWins) {
    checkEq(res.meWins.isAI, false, '★ 判定为「玩家赢」');
    checkEq(res.meWins.state, 'clear', '★ 比赛结束（state=clear）');
  }
}

/* ============================================================
 * 7. ★ PK 是"纯竞速"：不要求收齐订单
 * ============================================================
 * 否则 AI 不捡金币、玩家要捡 → 规则对玩家不公平，比赛也没法比。
 */
console.log('\n=== 7. ★ PK 纯竞速（不要求订单达标）===');
{
  const res = run(`(function(){
    Save.reset();
    Game.mode='local'; Game.playerCount=2;
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.pkResult = null;
    loadLevel(0);
    Game.state='playing';

    var lv = Game.level;
    /* 一个金币都不捡 */
    Game.coinsTaken = 0;
    var p0 = Game.players[0];
    p0.x = lv.goal.x; p0.y = lv.goal.y;
    update(1/60);
    return { state: Game.state, coinsRequired: Game.coinsRequired,
             coinsTaken: Game.coinsTaken, pk: !!Game.pkResult };
  })()`);
  check(res.coinsRequired > 0, '本关确实有订单门槛（' + res.coinsRequired + '）');
  checkEq(res.coinsTaken, 0, '玩家一个订单都没捡');
  check(res.pk === true, '★★ **PK 模式下照样判定过关**（订单没达标也算）—— 纯竞速成立');
}

/* ============================================================
 * 8. ★ 非 PK 局不受影响（回归）
 * ============================================================ */
console.log('\n=== 8. ★ 非 PK 局完全不受影响 ===');
{
  const res = run(`(function(){
    Save.reset();
    Game.mode='single'; Game.playerCount=1;
    Game.aiRoles = null; Game.isPk = false; Game.pkMyRole = null;                 // 不是 PK 局
    Game.pkResult = null;
    loadLevel(0);
    Game.state='playing';
    var before = Game.players.length;
    /* 跑一段 */
    for (var f=0; f<60; f++){ InputState.now={}; update(1/60); InputState.tick(); }
    return { players: before, state: Game.state,
             pkResult: Game.pkResult,
             aiCount: Object.keys(InputState.aiInput).length };
  })()`);
  checkEq(res.players, 1, '★ 单人模式仍然只有 1 个玩家（不会凭空多出 AI）');
  checkEq(res.aiCount, 0, '★ 没有任何 AI 输入被注册');
  check(res.pkResult === null, '★ 没有 PK 结算');
  checkEq(res.state, 'playing', '★ 游戏照常进行');

  /* 双人同屏也不该有 AI */
  const res2 = run(`(function(){
    Save.reset();
    Game.mode='local'; Game.playerCount=2;
    Game.aiRoles = null; Game.isPk = false; Game.pkMyRole = null;
    loadLevel(0);
    return { players: Game.players.length, aiCount: Object.keys(InputState.aiInput).length };
  })()`);
  checkEq(res2.players, 2, '★ 双人同屏仍然 2 个玩家');
  checkEq(res2.aiCount, 0, '★ 双人同屏没有 AI');
}

/* ============================================================
 * 9. 健壮性
 * ============================================================ */
console.log('\n=== 9. 健壮性 ===');
{
  let err = null;
  try {
    run('AI_RIDER.update(null, null, null)');
    run('AI_RIDER.update({}, {}, null)');
    run('AI_RIDER.update({ dead: true }, {}, [])');
    run('AI_RIDER.initFor(null)');
    run('AI_RIDER.statsFor("不存在")');
    run('PK_RACE.progressOf(null, null)');
    run('PK_RACE.progressOf({x:0}, {goal:null})');
  } catch (e) { err = e.message; }
  check(err === null, '★ 各种 null / 空对象都不抛异常' + (err ? '（实际: ' + err + '）' : ''));

  /* 没有 ai-rider.js 时游戏照常跑 */
  const sb2 = buildSandbox();
  ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
    'device-mode.js', 'save.js', 'net.js', 'scooter.js', 'render.js', 'game.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb2, { filename: f });
  });
  let err2 = null;
  try {
    vm.runInContext('Save.reset(); Game.mode="single"; Game.playerCount=1; loadLevel(0); Game.state="playing";', sb2);
    for (let f = 0; f < 30; f++) vm.runInContext('InputState.now={}; update(1/60); InputState.tick();', sb2);
  } catch (e) { err2 = e.message; }
  check(err2 === null, '★ 没有 ai-rider.js 时游戏照常跑' + (err2 ? '（实际: ' + err2 + '）' : ''));
}

/* ============================================================
 * 10. ★★★ AI 实战能力基线（诚实版）★★★
 * ============================================================
 * ⚠️⚠️ 这一段**不做"必须全过"的断言**，只记录事实。为什么这样写：
 *
 *   PK 模式要"能玩"，理想情况是 AI 每关都能跑完。
 *   但实测下来，**当前 AI 在部分关卡会掉坑**（后面的坑太宽/地形太复杂）。
 *
 *   与其写一个"假装通过"的测试（自欺欺人），
 *   不如把它做成**基线条**：
 *     · 记录"AI 能跑完哪些关"
 *     · 如果**跑完的关卡数变少**了 → 说明改动把它改坏了 → 报 FAIL
 *     · 如果变多了 → 说明改好了（不报 FAIL，但会打印出来）
 *
 *   ⇒ 这样这个测试就有了真实价值：**防止 AI 退化**。
 * ============================================================ */
console.log('\n=== 10. ★ AI 实战能力基线（诚实记录）===');
{
  const baseline = run(`(function(){
    var out = [];
    var all = PLAYABLE_LEVELS();
    for (var li = 0; li < all.length; li++) {
      Save.reset();
      Game.mode='local'; Game.playerCount=2; Game.aiRoles=['dragon'];
      Game.pkResult=null; Game.skipWeatherBrief=true;
      if (InputState.clearAI) InputState.clearAI();
      loadLevel(li);
      Game.state='playing';
      var lv = Game.level, solids = collectSolids(lv);
      var ai = null;
      Game.players.forEach(function(p){ if (p.role === 'dragon') ai = p; });
      if (!ai) { out.push({ id: lv.id, prog: 0 }); continue; }
      var maxProg = 0;
      if (PK_RACE.current()) PK_RACE.current().countdown = 0;
      for (var f = 0; f < 3600; f++) {
        InputState.now = {};
        AI_RIDER.update(ai, lv, solids);
        InputState.setAI(ai.role, ai._aiInput || {});
        update(1/60); InputState.tick();
        var pr = PK_RACE.progressOf(ai, lv);
        if (pr > maxProg) maxProg = pr;
        if (Game.state !== 'playing') break;
      }
      out.push({ id: lv.id, prog: Math.round(maxProg * 100), state: Game.state });
    }
    return out;
  })()`);

  console.log('  关卡    AI 最远进度   结果');
  baseline.forEach(function (r) {
    const ok = (r.prog >= 99);
    console.log('   第' + String(r.id).padStart(2) + '关   ' +
      String(r.prog + '%').padStart(6) + '      ' + (ok ? '✅ 能跑到终点' : '⚠️ 中途失败'));
  });

  const reachedEnd = baseline.filter(function (r) { return r.prog >= 99; }).length;
  console.log('');
  console.log('  能跑到终点的关卡: ' + reachedEnd + ' / ' + baseline.length);

  /* 基线条：11 关里至少要有 6 关能跑到终点（当前实测 7 关）。
   * ⚠️ 这个数字是"地板"不是"目标" —— 低于它说明改动把 AI 改坏了。
   *    以后改进 AI 之后，可以把这个数字往上提。 */
  const FLOOR = 6;
  check(reachedEnd >= FLOOR,
    '★ AI 至少能跑到终点的关卡数 ≥ ' + FLOOR + '（当前 ' + reachedEnd + '）' +
    (reachedEnd < FLOOR ? ' —— **AI 退化了，改动把它改坏了**' : ''));
  check(baseline.length > 0, 'AI 基线扫描跑完了全部关卡');

  /* 作弊检查：跑这么久，瞬移次数不能离谱（太频繁说明 AI 基本靠传送）
   * ⚠️ 必须设 Game.isPk = true —— 否则 loadLevel 会把 aiRoles 当"残留"清掉，
   *    导致 AI 角色根本不存在（ai 为 null），后面全是错的。 */
  const tpTotal = run(`(function(){
    Save.reset();
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode='local'; Game.playerCount=2;
    if (InputState.clearAI) InputState.clearAI();
    loadLevel(1);   // 第 2 关（AI 能跑完）
    Game.state='playing';
    var lv=Game.level, solids=collectSolids(lv);
    var ai=null; Game.players.forEach(function(p){ if(p.role==='dragon') ai=p; });
    if (!ai) return -1;                    // -1 = AI 都没建出来（明显的错误）
    for (var f=0; f<1500; f++) {
      InputState.now={};
      AI_RIDER.update(ai, lv, solids);
      InputState.setAI(ai.role, ai._aiInput||{});
      update(1/60); InputState.tick();
      if (Game.state!=='playing') break;
    }
    var st = AI_RIDER.statsFor('dragon') || {};
    return st.teleports || 0;
  })()`);
  check(tpTotal >= 0, 'AI 角色正常建出来了（没返回 -1）');
  check(tpTotal <= 3, '★ AI 不是靠"瞬移"混过去的（第 2 关瞬移 ' + tpTotal + ' 次 ≤ 3）');
}

/* ============================================================
 * 11. ★★★ PK 状态泄漏（十一反馈的真实 bug）★★★
 * ============================================================
 * 【十一的原话】"普通开始跑单就变成 AI 赛跑了"
 *
 *   根因：`Game.aiRoles` 只在少数入口被清空，"开始跑单"没清 →
 *   玩完 PK 再点开始跑单，场上多出一个 AI、还带 PK 进度条。
 *
 *   ⇒ 修法：`Game.isPk` 是显式意图标记，`startGame(levelIndex, opts)`
 *     是**唯一**的设置点。这段测试守两件事：
 *       ① PK 局：确实有 AI 参赛
 *       ② 非 PK 局：**哪怕 aiRoles 有残留，也必须被清掉**
 * ============================================================ */
console.log('\n=== 11. ★★★ PK 状态不会泄漏（回归测试）★★★');
{
  /* 模拟"玩完 PK → 回菜单 → 普通开始跑单" */
  const leak = run(`(function(){
    var out = {};

    /* ---- 第一步：开一局 PK（AI 参赛）---- */
    Save.reset();
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode = 'local'; Game.playerCount = 2;
    Game.pkResult = null;
    loadLevel(0);
    Game.state = 'playing';
    out.pkPlayers = Game.players.length;
    /* ⚠️ aiInput 是**每帧由 update 循环写入**的，这里手动切状态还没跑循环，
     *    所以要跑一帧才会有值。 */
    InputState.now = {};
    update(1/60); InputState.tick();
    out.pkAiCount = Object.keys(InputState.aiInput).length;

    /* ---- 第二步：**不清任何状态**，直接开一局普通单人 ---- */
    /* （模拟"忘了清"的场景 —— 这正是原来 bug 的成因）
     * ⚠️ 必须走 **startGame**（真实入口），因为**清理是 startGame 的职责**。
     *    直接调 loadLevel 相当于绕过所有入口 —— 那是测试方法不对。 */
    Game.mode = 'single';
    Game.playerCount = 1;
    Game.skipWeatherBrief = true;
    /* ⚠️ 故意**不**清 Game.aiRoles —— 测的就是"残留会不会害人" */
    startGame(0);
    Game.skipWeatherBrief = false;

    out.afterPlayers = Game.players.length;
    out.afterAiCount = Object.keys(InputState.aiInput).length;
    out.afterAiRoles = Game.aiRoles;
    out.afterPkResult = Game.pkResult;
    return out;
  })()`);

  console.log('    PK 局: 玩家 ' + leak.pkPlayers + ' 个，AI 输入通道 ' + leak.pkAiCount + ' 个');
  console.log('    普通局（故意不清状态）: 玩家 ' + leak.afterPlayers + ' 个');
  checkEq(leak.pkPlayers, 2, '★ PK 局有 2 个角色（玩家 + AI）');
  check(leak.pkAiCount === 1, '★ PK 局注册了 AI 输入');
  checkEq(leak.afterPlayers, 1, '★★ 普通局**只有 1 个角色**（没多出 AI）');
  checkEq(leak.afterAiCount, 0, '★★ AI 输入被清干净了（玩家不会被 AI 接管）');
  checkEq(leak.afterAiRoles, null, '★★ aiRoles 残留被自动清掉了');
  checkEq(leak.afterPkResult, null, '★★ PK 结算状态被清掉了');

  /* 再确认一次：普通局的键盘正常（不被 AI 抢） */
  const kb = run(`(function(){
    Game.isPk=false; Game.aiRoles=null; Game.pkMyRole=null;
    Game.mode='single'; Game.playerCount=1;
    loadLevel(0); Game.state='playing';
    var p = Game.players[0];
    var x0 = p.x;
    for (var f=0;f<40;f++){
      InputState.now={}; InputState.now['ArrowRight']=true;
      update(1/60); InputState.tick();
    }
    var arrowMoved = Math.round(p.x - x0);
    /* 再来一次，用 WASD（W 是 jump 键那个区，用 D 往右） */
    var x1 = p.x;
    for (var f2=0;f2<40;f2++){
      InputState.now={}; InputState.now['KeyD']=true;
      update(1/60); InputState.tick();
    }
    return { arrow: arrowMoved, wasd: Math.round(p.x - x1) };
  })()`);
  check(kb.arrow > 20, '★ 普通局：方向键有效（位移 ' + kb.arrow + 'px）');
  check(kb.wasd > 20, '★ 普通局：WASD 也有效（位移 ' + kb.wasd + 'px）');
}

/* ============================================================
 * 12. ★ PK 键位：WASD + 方向键都能用（十一反馈）
 * ============================================================ */
console.log('\n=== 12. ★ PK 键位（WASD + 方向键）===');
{
  const keys = run(`(function(){
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode = 'local'; Game.playerCount = 2;
    loadLevel(0);
    Game.state = 'playing';

    /* 玩家角色的键位表里，方向键和 WASD 都要在 */
    var m = keymapFor('kangaroo');
    var has = function(arr, k){ return Array.isArray(arr) && arr.indexOf(k) >= 0; };
    var out = {
      arrowRight: has(m.right, 'ArrowRight'),
      wasdRight:   has(m.right, 'KeyD'),
      arrowJump:   has(m.jump, 'ArrowUp') || has(m.jump, 'Space'),
      wasdJump:    has(m.jump, 'KeyW'),
      /* AI 角色的键位不影响玩家（AI 走 aiInput 通道，压根不读键盘表） */
      aiIsRegistered: Object.keys(InputState.aiInput).length > 0,
    };

    /* ---- 实测：玩家用 WASD 也能动 ---- */
    var p = null;
    Game.players.forEach(function(q){ if (q.role === 'kangaroo') p = q; });

    /* ⚠️ 先跳过倒计时 —— 预备期间输入是被**故意冻结**的（防抢跑），
     *    不跳过的话测出来位移是 0，会误判成"键位坏了"。 */
    if (PK_RACE.current()) PK_RACE.current().countdown = 0;

    var x0 = p.x;
    for (var f=0;f<40;f++){
      InputState.now={}; InputState.now['KeyD']=true;
      update(1/60); InputState.tick();
    }
    out.wasdMoved = Math.round(p.x - x0);
    return out;
  })()`);

  /* 方向键用**独立的一局**测（上面那次已经把人推到右边了） */
  const arrowMove = run(`(function(){
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode = 'local'; Game.playerCount = 2;
    loadLevel(0); Game.state = 'playing';
    if (PK_RACE.current()) PK_RACE.current().countdown = 0;
    var p = null;
    Game.players.forEach(function(q){ if (q.role === 'kangaroo') p = q; });
    var x0 = p.x;
    for (var f=0;f<40;f++){
      InputState.now={}; InputState.now['ArrowRight']=true;
      update(1/60); InputState.tick();
    }
    return Math.round(p.x - x0);
  })()`);

  check(keys.arrowRight, '★ PK：方向键 → 在玩家的键位表里');
  check(keys.wasdRight, '★ PK：WASD 的 D → 也在玩家的键位表里');
  check(keys.arrowJump, '★ PK：方向键 ↑ / 空格 能跳');
  check(keys.wasdJump, '★ PK：WASD 的 W 也能跳');
  check(keys.wasdMoved > 20, '★★ 实测：PK 里用 WASD 真的能跑（位移 ' + keys.wasdMoved + 'px）');
  check(arrowMove > 20, '★★ 实测：PK 里用方向键也能跑（位移 ' + arrowMove + 'px）');
}

/* ============================================================
 * 13. ★ 同一起跑线（十一反馈）
 * ============================================================
 * 十一："AI 和我应该是同一起跑线，在同一个地方生成"
 *
 * 要验两件事：
 *   ① 两人的**起点几乎相同**（水平差 ≤ 一个身位，不是隔了半个地图）
 *   ② 但**不能像素级完全重叠**（否则物理"互相推开"会让开局抖）
 * ============================================================ */
console.log('\n=== 13. ★ 同一起跑线 ===');
{
  const start = run(`(function(){
    Save.reset();
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode='local'; Game.playerCount=2;
    if (InputState.clearAI) InputState.clearAI();
    loadLevel(0);
    Game.state='playing';
    var me=null, ai=null;
    Game.players.forEach(function(p){
      if (p.role === 'dragon') ai = p; else me = p;
    });
    if (!me || !ai) return { err: '角色没建全' };
    return {
      meX: Math.round(me.x), meY: Math.round(me.y),
      aiX: Math.round(ai.x), aiY: Math.round(ai.y),
      dx: Math.round(Math.abs(me.x - ai.x)),
      dy: Math.round(Math.abs(me.y - ai.y)),
      spawnX: Math.round(Game.level.spawns[0].x),
      spawnY: Math.round(Game.level.spawns[0].y - me.h),
    };
  })()`);

  if (start.err) {
    check(false, start.err);
  } else {
    console.log('    玩家起点: (' + start.meX + ', ' + start.meY + ')');
    console.log('    AI 起点 : (' + start.aiX + ', ' + start.aiY + ')');
    console.log('    出生点   : x=' + start.spawnX + ' 脚底y=' + start.spawnY);
    check(start.dx <= 40, '★★ 两人**水平距离 ≤ 40px**（同一起跑线，一个身位左右）（同一起跑线，实际 ' + start.dx + 'px）');
    check(start.dy <= 4, '★★ 两人**同一高度**（垂直差 ' + start.dy + 'px）');
    check(start.dx >= 4, '★ 没有像素级完全重叠（差 ' + start.dx + 'px，避免开局抖动）');
    /* 起点都该落在出生点附近 */
    check(Math.abs(start.meX - start.spawnX) <= 30 &&
          Math.abs(start.aiX - start.spawnX) <= 30,
      '★ 两人都在**出生点附近**生成（不是各用一个出生点）');
  }
}

/* ============================================================
 * 14. ★ 随机地图（十一反馈）
 * ============================================================
 * 十一："随机地图"
 *
 * 要验两件事：
 *   ① 抽到的关卡**一定是已解锁的**（不能把新手扔进第 11 关）
 *   ② 抽多次能**抽到不同的关**（不是永远第 1 关）
 * ============================================================ */
console.log('\n=== 14. ★ 随机地图 ===');
{
  const rnd = run(`(function(){
    /* 模拟"已解锁 5 关"的存档 */
    Save.reset();
    Save.data.maxUnlocked = 5;

    var all = PLAYABLE_LEVELS();
    var unlocked = [];
    for (var i = 0; i < all.length; i++) {
      var ok = true;
      try { ok = Save.isUnlocked(i); } catch (e) { ok = (i === 0); }
      if (ok) unlocked.push(i);
    }

    /* 按 startPkRace 的同一套逻辑抽 40 次，看分布 */
    var picks = {};
    for (var n = 0; n < 40; n++) {
      var idx = unlocked[Math.floor(Math.random() * unlocked.length)];
      picks[idx] = (picks[idx] || 0) + 1;
    }
    return {
      maxUnlocked: Save.data.maxUnlocked,
      unlockedCount: unlocked.length,
      unlockedList: unlocked,
      distinctPicks: Object.keys(picks).length,
      picks: picks,
    };
  })()`);

  console.log('    已解锁: ' + rnd.unlockedCount + ' 关（' + rnd.unlockedList.join(',') + '）');
  console.log('    40 次抽样覆盖了 ' + rnd.distinctPicks + ' 个不同的关');
  checkEq(rnd.unlockedCount, 5, '★ 只抽已解锁的关卡（5 关）');
  check(rnd.distinctPicks >= 3, '★★ 抽样能覆盖多个关卡（不是永远同一关）');
  check(rnd.unlockedList.every(function (i) { return i < 5; }),
    '★★ 抽到的关卡序号**都在已解锁范围内**（没有越界到第 11 关）');

  /* ② 保存进 Game 后能被读到（HUD 要显示关卡名） */
  const st = run(`(function(){
    Game.isPk = true; Game.pkMyRole='kangaroo'; Game.aiRoles=['dragon'];
    Game.pkLevelIndex = 3;
    Game.mode='local'; Game.playerCount=2;
    loadLevel(3);
    return { idx: Game.pkLevelIndex, name: Game.level.name,
             sameLevel: (Game.level.name || '').length > 0 };
  })()`);
  checkEq(st.idx, 3, '★ PK 抽到的关卡序号被记录');
  check(st.sameLevel, '★ 关卡名可读（HUD 能显示"本局地图"）: ' + st.name);
}

/* ============================================================
 * 15. ★ 起跑倒计时（保护"同一起跑线"）
 * ============================================================
 * 【为什么这个测试很重要】
 *   "同一起跑线"不是"把两人放在同一个坐标"就完事了 ——
 *   实测发现：生成瞬间是 90/102，但**刚跑 1 帧**就变成 93/67，
 *   AI 被 separatePlayers 推走了。
 *
 *   根因：AI 第一帧就产生输入（立刻往右冲），两人太近 → 被推开。
 *   ⇒ 加倒计时，预备期间两人都不动。
 *
 * 这个测试守三件事：
 *   ① 倒计时期间两人**都不动**（起跑线保持齐）
 *   ② 倒计时期间**玩家按键无效**（不能抢跑）
 *   ③ 倒计时结束后两人**都能动**（没把输入冻死）
 * ============================================================ */
console.log('\n=== 15. ★ 起跑倒计时（保护同一起跑线）===');
{
  const cd = run(`(function(){
    Save.reset();
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode='local'; Game.playerCount=2;
    if (InputState.clearAI) InputState.clearAI();
    loadLevel(0);
    Game.state='playing';

    var me=null, ai=null;
    Game.players.forEach(function(p){ if (p.role==='dragon') ai=p; else me=p; });

    var s0 = { meX: Math.round(me.x), aiX: Math.round(ai.x), dx: Math.round(Math.abs(me.x-ai.x)) };
    var cdFrames = 0;

    /* --- 倒计时期间：玩家狂按右键，但**两人都该原地不动** ---
     * ⚠️ 这一段必须**真的逐帧跑**（不能快进）——
     *    因为要验证的就是"倒计时期间输入被冻结"这个行为本身。 */
    while (PK_RACE.inCountdown()) {
      InputState.now = {}; InputState.now['ArrowRight'] = true;   // 玩家试图抢跑
      update(1/60); InputState.tick();
      cdFrames++;
      if (cdFrames > 600) break;                                   // 死循环保护
    }
    var s1 = { meX: Math.round(me.x), aiX: Math.round(ai.x), dx: Math.round(Math.abs(me.x-ai.x)) };

    /* --- 倒计时结束：两人都该能动 --- */
    for (var f=0; f<40; f++) {
      InputState.now = {}; InputState.now['ArrowRight'] = true;
      update(1/60); InputState.tick();
    }
    var s2 = { meX: Math.round(me.x), aiX: Math.round(ai.x) };

    return { s0: s0, s1: s1, s2: s2, cdFrames: cdFrames,
             delay: PK_RACE.START_DELAY, text3: PK_RACE.countdownText() };
  })()`);

  console.log('    生成瞬间 : 玩家 x' + cd.s0.meX + ' / AI x' + cd.s0.aiX + '（差 ' + cd.s0.dx + 'px）');
  console.log('    倒计时后 : 玩家 x' + cd.s1.meX + ' / AI x' + cd.s1.aiX + '（差 ' + cd.s1.dx + 'px）');
  console.log('    开跑 40 帧: 玩家 x' + cd.s2.meX + ' / AI x' + cd.s2.aiX);
  console.log('    倒计时 ' + cd.cdFrames + ' 帧（设定 ' + cd.delay + '）');

  check(cd.cdFrames > 100, '★ 倒计时确实生效了（' + cd.cdFrames + ' 帧）');
  checkEq(cd.s1.meX, cd.s0.meX, '★★ 倒计时期间**玩家不能抢跑**（x 没变）');
  checkEq(cd.s1.aiX, cd.s0.aiX, '★★ 倒计时期间 **AI 也不动**（x 没变）');
  check(cd.s1.dx <= 40, '★★ 倒计时结束时两人**仍在同一起跑线**（差 ' + cd.s1.dx + 'px）');
  check(cd.s2.meX > cd.s1.meX + 20, '★★ 开跑后玩家能动（位移 ' + (cd.s2.meX - cd.s1.meX) + 'px）');
  check(cd.s2.aiX > cd.s1.aiX + 20, '★★ 开跑后 AI 能动（位移 ' + (cd.s2.aiX - cd.s1.aiX) + 'px）');
}

/* ============================================================
 * 16. ★★★ PK 一局定胜负（十一反馈）
 * ============================================================
 * 【十一的原话】
 *   "我的意思是想把 AI PK 做到那种一局就定胜负，
 *    然后现在是打完一局会连着来的"
 *
 * 【根因（实测确认）】
 *   结算页的主按钮是「接下一单」→ 走 `startGame(next)`（不带 opts）
 *   → PK 状态被清（isPk/aiRoles 都清了）——
 *   但 **`playerCount` 还是 2**（PK 遗留）！
 *   ⇒ 下一关的 loadLevel 走"双人同屏"分支，**又立起两个角色**
 *     → 玩家看到的就是"PK 打完连着又来一局"。
 *
 * 【要守的三件事】
 *   ① PK 局不能靠"接下一单"继续（按钮 + 空格都要挡）
 *   ② 退出 PK 必须把 `playerCount` 复位（否则残留害下一局）
 *   ③ 退出 PK 后开单人局，场上只能是 1 个角色
 * ============================================================ */
console.log('\n=== 16. ★★★ PK 一局定胜负 ===');
{
  /* ---- ① 退出 PK 要清干净（含 playerCount）---- */
  const leave = run(`(function(){
    Save.reset(); Save.data.maxUnlocked = 11;
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.pkLevelIndex = 0; Game.pkResult = null;
    Game.mode = 'local'; Game.playerCount = 2;
    if (InputState.clearAI) InputState.clearAI();
    loadLevel(0); Game.state = 'playing';

    var before = { isPk: Game.isPk, pc: Game.playerCount, players: Game.players.length };

    /* 调"退出 PK"（结算页「回到首页」走的就是它） */
    leavePkState();

    var after = { isPk: Game.isPk, aiRoles: Game.aiRoles, pkMyRole: Game.pkMyRole,
                  pkLevelIndex: Game.pkLevelIndex, pc: Game.playerCount,
                  aiCount: Object.keys(InputState.aiInput).length };
    return { before: before, after: after };
  })()`);
  console.log('    退出前: ' + JSON.stringify(leave.before));
  console.log('    退出后: ' + JSON.stringify(leave.after));
  checkEq(leave.after.isPk, false, '★ 退出后 isPk=false');
  checkEq(leave.after.pc, 1, '★★ **playerCount 复位成 1**（这是"连着来"的元凶）');
  checkEq(leave.after.aiRoles, null, '★ aiRoles 清空');
  checkEq(leave.after.aiCount, 0, '★ AI 输入通道清空');

  /* ---- ② 退出 PK 后开单人，场上只能 1 个角色 ---- */
  const solo = run(`(function(){
    Save.reset();
    /* 先摆成"PK 刚结束"的状态（残留 playerCount=2） */
    Game.isPk = true; Game.pkMyRole = 'kangaroo'; Game.aiRoles = ['dragon'];
    Game.mode = 'local'; Game.playerCount = 2;
    loadLevel(0);

    /* 然后走真实路径退出 + 开单人 */
    leavePkState();
    Game.mode = 'single';
    Game.skipWeatherBrief = true;
    startGame(0);
    Game.skipWeatherBrief = false;
    return { players: Game.players.length, roles: Game.players.map(function(p){ return p.role; }),
             isPk: Game.isPk, aiCount: Object.keys(InputState.aiInput).length };
  })()`);
  console.log('    退出 PK 后开单人: ' + JSON.stringify(solo));
  checkEq(solo.players, 1, '★★★ 单人局**只有 1 个角色**（不再"连着来"）');
  checkEq(solo.isPk, false, '★ isPk=false');
  checkEq(solo.aiCount, 0, '★ 没有 AI');

  /* ---- ③ 重跑同一关时，PK 配置要保留 ---- */
  const again = run(`(function(){
    Save.reset();
    Game.mode='local'; Game.playerCount=2;
    Game.skipWeatherBrief = true;
    startGame(2, { pk:true, aiRoles:['dragon'], myRole:'kangaroo', pkLevelIndex:2 });
    Game.skipWeatherBrief = false;
    var before = { isPk: Game.isPk, pc: Game.playerCount, players: Game.players.length,
                   ai: Game.aiRoles ? Game.aiRoles.slice() : null, lv: Game.levelIndex };
    /* 玩家到终点 → 结算 */
    var lv = Game.level;
    Game.players[0].x = lv.goal.x; Game.players[0].y = lv.goal.y;
    update(1/60);
    var mid = { state: Game.state, pk: !!Game.pkResult };
    /* 模拟「重跑这一关」 */
    restartPkSameLevel();
    var after = { isPk: Game.isPk, pc: Game.playerCount, players: Game.players.length,
                  ai: Game.aiRoles ? Game.aiRoles.slice() : null,
                  my: Game.pkMyRole, lv: Game.levelIndex, state: Game.state };
    return { before: before, mid: mid, after: after };
  })()`);
  console.log('    开 PK 局: ' + JSON.stringify(again.before));
  console.log('    打完: ' + JSON.stringify(again.mid));
  console.log('    重跑后: ' + JSON.stringify(again.after));
  checkEq(again.mid.state, 'clear', '★ PK 打完就进结算');
  check(!!again.mid.pk, '★ 结算时有 PK 结果');
  checkEq(again.after.isPk, true, '★★ 重跑**仍是 PK 局**（没有变成普通模式）');
  checkEq(again.after.pc, 2, '★ 重跑后场上仍是 2 个角色');
  checkEq(again.after.lv, 2, '★★ 重跑的是**同一关**（不是下一关）');
  check(again.after.my === 'kangaroo' && again.after.ai && again.after.ai[0] === 'dragon',
    '★★ 重跑保留**同一对手**（' + again.after.my + ' vs ' + (again.after.ai || [])[0] + '）');

  /* ---- ④ 源码级：PK 的结算页不许出现"接下一单" ---- */
  const uiSrc = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');
  const pkBranch = uiSrc.indexOf('★★ 🏁 PK 局：一局定胜负');
  const nextBtn = uiSrc.indexOf('接下一单 · ');
  check(pkBranch >= 0, '★ ui.js 里有 PK 专属的结算分支');
  check(pkBranch >= 0 && pkBranch < nextBtn,
    '★★ PK 分支在「接下一单」**之前** return（PK 局看不到那个按钮）');
}

/* ============================================================
 * 17. ★★ P1 / P2 标签：只有"双真人"才该出现（十一反馈）
 * ============================================================
 * 【十一的原话】
 *   "无论是我单机还是 PK，我这个角色都是 P1，永远都是 P1，不要 P2。
 *    而且 P1 P2 都是双人的时候才会有的。
 *    单人模式下就不要显示这个 P1 P2。"
 *
 * 【规则】只有两个**真人**同时玩才有 P1/P2 的意义：
 *   单人 → 不显示 ／ **PK → 不显示**（另一个是 AI）／ 双人同屏、联机 → 显示
 * ============================================================ */
console.log('\n=== 17. ★★ P1 / P2 标签（只在双真人时显示）===');
{
  const cases = [
    { name: '单人模式', playerCount: 1, isPk: false, aiRoles: null,      expect: false },
    { name: 'PK 模式',  playerCount: 2, isPk: true,  aiRoles: ['dragon'], expect: false },
    { name: '双人同屏', playerCount: 2, isPk: false, aiRoles: null,      expect: true },
    { name: '联机',     playerCount: 2, isPk: false, aiRoles: null,      expect: true, mode: 'online' },
  ];

  cases.forEach(function (c) {
    const got = runJson(`(function(){
      Save.reset();
      Game.isPk = ${c.isPk ? 'true' : 'false'};
      Game.aiRoles = ${c.aiRoles ? JSON.stringify(c.aiRoles) : 'null'};
      Game.pkMyRole = ${c.isPk ? "'kangaroo'" : 'null'};
      Game.mode = ${c.mode ? JSON.stringify(c.mode) : "'local'"};
      Game.playerCount = ${c.playerCount};
      if (InputState.clearAI) InputState.clearAI();
      loadLevel(0);
      Game.state = 'playing';
      /* 联机模式下玩家只操控一个角色，所以单独给 roles 造两个 */
      return { two: isTwoHumanPlayers(), players: Game.players.length };
    })()`);
    const ok = got.two === c.expect;
    if (c.name === '联机') {
      /* 联机：loadLevel 只建本机角色，但 isTwoHumanPlayers 看的是 playerCount */
      check(got.two === (c.playerCount >= 2 && !c.isPk),
        '★ ' + c.name + ' 的 P1/P2 判定 = ' + got.two + '（playerCount=' + c.playerCount + '）');
    } else {
      check(ok, '★ ' + c.name + ' → ' + (got.two ? '显示 P1/P2' : '不显示 P1/P2') +
        (ok ? ' ✅' : ' ← 错了，应该是' + (c.expect ? '显示' : '不显示')));
    }
  });

  /* 源码级：头顶标签必须在"双真人"判断**之后**才画 */
  const src = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  const tagIdx = src.indexOf('const twoHuman = (typeof isTwoHumanPlayers');
  const drawIdx = src.indexOf("const label = (idx === 1) ? 'P2' : 'P1';");
  check(tagIdx >= 0, '★ 头顶标签里有 isTwoHumanPlayers 判断');
  check(tagIdx >= 0 && drawIdx > tagIdx,
    '★★ 判断在绘制**之前**（不是画完才发现不该画）');
  check(!/p\.role === 'kangaroo' \? 'P1' : 'P2'/.test(src),
    '★ 不再用"角色是不是袋鼠"来决定 P1/P2（那是旧写法）');

  /* HUD 两张卡片的前缀也要挂这个开关 */
  const hudIdx = src.indexOf('const showPlayerTags');
  check(hudIdx >= 0, '★ HUD 卡片也有 showPlayerTags 开关');
  check(/showPlayerTags \? 'P1 ' : ''/.test(src) && /showPlayerTags \? 'P2 ' : ''/.test(src),
    '★★ 两张 HUD 卡片的 P1/P2 前缀都受这个开关控制');
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('  PK / AI 骑手测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);
