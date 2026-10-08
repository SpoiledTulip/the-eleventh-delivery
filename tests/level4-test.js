/* ============================================================
 * level4-test.js — 第 4 关（双人配合关）测试
 *
 * 重点验证两件事：
 *   1. 双人配合能通关（断裂桥 → 炸墙 → 跷跷板高墙 → 跳跳怪 → 终点）
 *   2. 单人【过不去】—— 这是本关的设计核心，必须验证它真的成立
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

function noop() {}
const ctxProbe = new Proxy({}, {
  get: function (t, k) {
    if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
    if (k === 'measureText') return function () { return { width: 10 }; };
    return noop;
  }, set: function () { return true; },
});

const sandbox = {
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
  localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop },
};
sandbox.Image = sandbox.window.Image;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js']
  .forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
  });

const run = function (code) { return vm.runInContext(code, sandbox); };
run('initGame("game")');

/* ★ 解锁全部动作 ★（放在 initGame 之后 —— 它内部会 Save.load() 覆盖掉）
 * 第 4 关的跷跷板高墙要靠二连跳/弹射上墙，新档默认没解锁二连跳，
 * 不解锁的话会测出"单人上不去高墙"的假失败。 */
run('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;');

function frame(keys) {
  const k = keys || {};
  const expr = 'InputState.now={};' +
    Object.keys(k).map(function (n) { return 'InputState.now.' + n + '=' + JSON.stringify(k[n]) + ';'; }).join('') +
    'update(0.016);InputState.tick();';
  run(expr);
}

const LV4 = 3;   // 第 4 关在可玩列表里的下标（0起）

/* ---------- 基本结构 ---------- */
console.log('--- 第 4 关结构 ---');
run('Game.mode="local";Game.playerCount=2;loadLevel(' + LV4 + ')');
check(run('Game.level.id') === 4, '载入的是第 4 关：' + run('Game.level.name'));
check(run('Game.level.bridges.length') === 4, '有 4 块断裂桥');
check(run('Game.level.bombs.length') === 1, '有 1 颗炸弹');
check(run('Game.level.seesaws.length') === 1, '有 1 个跷跷板');
check(run('Game.level.enemies.filter(function(e){return e.type==="hopper";}).length') === 2, '有 2 只跳跳怪');
check(run('Game.level.solids.filter(function(s){return s.destructible;}).length') === 6, '有 6 块可炸墙');

/* ---------- 1. 断裂桥必须"跑着过" ---------- */
console.log('\n--- 断裂桥：站着不动会掉下去 ---');
{
  run('loadLevel(' + LV4 + ')');
  // 把袋鼠放到第一块桥上，然后不动
  var b0 = run('Game.level.bridges[0]');
  run('Game.players[0].x = ' + b0.x + '; Game.players[0].y = ' + (b0.y - 32) + ';');
  var yStart = run('Game.players[0].y');
  for (var f = 0; f < 200; f++) frame({});
  var yEnd = run('Game.players[0].y');
  check(yEnd > yStart + 100, '站在断裂桥上不动 → 桥塌，人掉下去（y: ' +
    Math.round(yStart) + ' → ' + Math.round(yEnd) + '）');
}

/* ---------- 2. 炸弹必须点开才能过 ---------- */
console.log('\n--- 炸墙：不炸开就过不去 ---');
{
  run('loadLevel(' + LV4 + ')');
  // 把袋鼠放在墙左边
  run('Game.players[0].x = 25*32; Game.players[0].y = 23*32; Game.players[0].vx = 0;');
  // 一直往右跑，不点炸弹（其实碰到炸弹就会自动点燃）
  var reachedX = 0;
  for (var f = 0; f < 200; f++) {
    frame({ ArrowRight: true });
    var x = run('Game.players[0].x');
    if (x > reachedX) reachedX = x;
    if (run('Game.state') !== 'playing') break;
  }
  var wallX = 28 * 32;
  // 碰到炸弹会被点燃，等它炸
  for (var f2 = 0; f2 < 300; f2++) {
    frame({ ArrowRight: true });
    var x2 = run('Game.players[0].x');
    if (x2 > reachedX) reachedX = x2;
    if (run('Game.state') !== 'playing') break;
  }
  check(reachedX > 32 * 32, '点爆炸弹后能穿过原本被墙封住的路（走到 x=' + Math.round(reachedX) + '）');
  check(run('Game.level.bombs[0].exploded') === true, '炸弹已爆炸');
}

/* ============================================================
 * 3. ★核心：单机版跷跷板（2026-10-06 改造）★
 * ============================================================
 * 十一的要求：
 *   "第四关请改为单机模式，取消双人配合机制；
 *    将跷跷板改成单机版跷跷板，并移除旁边的弹跳机。"
 *
 * 改造前这一节测的是"单人上不去 / 双人才行"，
 * 现在反过来：**单人必须能上去**，而且不许再靠补偿弹簧。
 * ============================================================ */
console.log('\n--- 单机跷跷板：一个人就能被弹上去 ---');
{
  var wallTopY = 20 * 32;      // ★ 高墙已从行16(512)连降到行20(640)
  var groundY = 23 * 32;       // 地面 y = 736

  /* ---- 3.1 关卡数据层：不能有补偿弹簧 ---- */
  run('Game.mode="single";Game.playerCount=1;loadLevel(' + LV4 + ')');
  check(run('Game.level.springs.length') === 0,
    '★ 第 4 关不再有"弹跳机"（补偿弹簧已移除，实际 ' +
    run('Game.level.springs.length') + ' 块）');
  check(run('Game.level.seesaws.length') === 1, '第 4 关有 1 个跷跷板');

  /* ---- 3.2 高墙高度必须在"二连跳可达"范围内 ---- */
  var needRise = groundY - wallTopY;
  console.log('      高墙落差 = ' + needRise + 'px（改造前是 224px，超出二连跳上限）');
  check(needRise <= 200,
    '高墙落差降到二连跳范围内（' + needRise + 'px ≤ 200px）');

  /* ---- 3.3 单人站上跷跷板 → 被自己弹起来 ---- */
  run('Game.players[0].x = Game.level.seesaws[0].cx - 40;');
  run('Game.players[0].y = Game.level.seesaws[0].cy - 40;');
  run('Game.players[0].vx = 0; Game.players[0].vy = 0; Game.players[0].onGround = true;');
  var soloStartY = run('Game.players[0].y');
  var soloMinY = soloStartY, soloMinVy = 0, soloLaunched = false;
  for (var f = 0; f < 240; f++) {
    frame({});
    var y = run('Game.players[0].y');
    var vy = run('Game.players[0].vy');
    if (y < soloMinY) soloMinY = y;
    if (vy < soloMinVy) soloMinVy = vy;
    if (vy <= -17) soloLaunched = true;
  }
  var soloRise = soloStartY - soloMinY;
  console.log('      单人弹射：最高上升 ' + Math.round(soloRise) + 'px（' +
    (soloRise / 32).toFixed(2) + ' 格），最大上升速度 vy=' + soloMinVy.toFixed(1));

  check(soloLaunched,
    '★ 单人站上跷跷板就能被弹飞（vy=' + soloMinVy.toFixed(1) + '，阈值 -17）');
  check(soloRise >= 160,
    '★ 单人弹射高度够上高墙（上升 ' + Math.round(soloRise) +
    'px ≥ 落差 ' + needRise + 'px）');

  /* ---- 3.4 单人不用跷跷板也能自己跳上高墙（兜底） ---- */
  run('Game.playerCount=1;loadLevel(' + LV4 + ')');
  run('Game.players[0].x = 44*32 - 60; Game.players[0].y = 23*32;');
  run('Game.players[0].vx = 0; Game.players[0].vy = 0; Game.players[0].onGround = true;');
  var jumpMinY = 9999;
  for (var f2 = 0; f2 < 200; f2++) {
    /* 反复单跳+二连跳（模拟玩家自己在墙边尝试） */
    var keys = { ArrowRight: true };
    keys.ArrowUp = (f2 % 16 < 2);
    frame(keys);
    var yj = run('Game.players[0].y');
    if (yj < jumpMinY) jumpMinY = yj;
  }
  console.log('      不靠跷跷板纯跳跃：最高到 y=' + Math.round(jumpMinY) +
    '（墙顶 y=' + wallTopY + '）');
  check(jumpMinY <= wallTopY,
    '★ 不靠跷跷板，纯二连跳也能上高墙（最高 y=' + Math.round(jumpMinY) +
    ' ≤ 墙顶 ' + wallTopY + '）—— 跷跷板是捷径而非唯一通路');

  /* ---- 3.5 双人模式下跷跷板仍然工作（不能改坏老玩法） ---- */
  run('Game.mode="local";Game.playerCount=2;loadLevel(' + LV4 + ')');
  var ss = run('Game.level.seesaws[0]');
  run('Game.players[1].x = ' + (ss.cx - 26) + '; Game.players[1].y = ' + (ss.cy - 40) + '; Game.players[1].onGround = true;');
  run('Game.players[0].x = 3*32; Game.players[0].y = 23*32; Game.players[0].onGround = true;');
  for (var f3 = 0; f3 < 60; f3++) frame({});
  check(run('Game.level.seesaws[0].angle') < -0.3,
    '双人模式下跷跷板照常工作（乙压住左端，板子倾斜）');
}

/* ---------- 4. 全关可通关（用带作弊的走位验证路径连通） ---------- */
console.log('\n--- 第 4 关整关连通性 ---');
{
  run('Game.mode="local";Game.playerCount=2;loadLevel(' + LV4 + ')');
  // 只验证"终点可达、金币门槛合理"，具体的机关已在上面单项验证过。
  var goalX = run('Game.level.goal.x');
  check(goalX > 70 * 32, '终点在最右侧（x=' + Math.round(goalX) + '）');
  var total = run('Game.level.coins.length');
  var need = run('Game.coinsRequired');
  check(need < total, '金币门槛留有余量（需 ' + need + '/共 ' + total + '）');

  // 地面连通性：从起点到终点之间，地面（行24）不能有大段空洞
  var map = run('Game.level.grid');
  var holes = [];
  var curHole = 0;
  for (var c = 4; c <= 85; c++) {
    if (map[24][c] !== '#' && map[24][c] !== 'I') { curHole++; }
    else { if (curHole >= 4) holes.push({ start: c - curHole, len: curHole }); curHole = 0; }
  }
  // 断裂桥那段是故意挖空的（要靠跑过去），所以允许 1 处
  check(holes.length <= 1,
    '地面只有断裂桥那一段是空的（' + holes.length + ' 处大空洞，预期 ≤1）' +
    (holes.length ? '：' + JSON.stringify(holes) : ''));
}

console.log('\n=========================================');
console.log(pass + ' 项通过, ' + fail + ' 项失败');
if (fail > 0) { console.log(fail + ' 项失败 ✗'); process.exit(1); }
console.log('第 4 关全部正常 ✓');
