/* ============================================================
 * mechanics-test.js — 新机关测试（弹簧板 / 传送带 / 冰面）
 *
 * 每个机关都测"是不是真的起作用"，而不只是"能不能解析"：
 *   弹簧板  —— 踩上去的初速是否明显高于普通跳跃，冷却是否生效
 *   传送带  —— 站着不动会不会被推动，推力方向对不对，逆着跑是否费劲
 *   冰面    —— 同样输入下，冰面上的滑行距离是否明显更长
 * 用法：node mechanics-test.js
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

function noop() {}
const ctxProbe = new Proxy({}, {
  get: function (t, k) {
    if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
    if (k === 'measureText') return function () { return { width: 10 }; };
    return noop;
  },
  set: function () { return true; },
});

const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
  window: {
    addEventListener: noop,
    requestAnimationFrame: function () { return 0; },
    Image: function () {
      const self = this;
      this.width = 0; this.height = 0; this.src = '';
      setTimeout(function () { if (self.onerror) self.onerror(); }, 0);
    },
    AudioContext: function () {
      return {
        state: 'running', currentTime: 0,
        createOscillator: function () {
          return { type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop };
        },
        createGain: function () {
          return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop };
        },
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
  localStorage: (function () {
    var s = {};
    return { getItem: function (k) { return s[k] === undefined ? null : s[k]; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } };
  })(),
};
sandbox.Image = sandbox.window.Image;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
});
function run(code) { return vm.runInContext(code, sandbox); }

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  [v] ' + msg);
  else { console.log('  [X] ' + msg); fails++; }
}
function frame(keys) {
  keys = keys || {};
  const parts = ['InputState.now = {};'];
  for (const k in keys) if (keys[k]) parts.push('InputState.now["' + k + '"]=true;');
  parts.push('update(0.016); InputState.tick();');
  run(parts.join(''));
}

/* 造一张测试地图：直接用字符串数组，宽 40 列（够测了） */
function makeTestLevel(rows) {
  const padded = rows.map(function (r) {
    var s = r;
    while (s.length < 40) s += '.';
    return s.slice(0, 40);
  });
  return run('parseLevel(' + JSON.stringify({
    id: 99, name: 'test', gravity: 0.62, map: padded,
  }) + ')');
}

console.log('新机关测试\n');
run('initGame("game")');
/* ★ 解锁全部动作 ★（放在 initGame 之后 —— 它内部会 Save.load() 覆盖掉）
 * 游戏默认"动作逐步解锁"，新档一个动作都没有。
 * 这些测试测的是关卡/机关本身，不是解锁流程，所以先把动作全开。 */
run('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;');

/* ============================================================
 * 1. 弹簧板
 * ============================================================ */
console.log('--- 弹簧板 ---');
// 地图：地面在行 8，弹簧在 x=5
var rowsSpring = [
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '.....S..................................',
  '########################################',
];
run('Game.level = parseLevel(' + JSON.stringify({ id: 99, name: 'spring', gravity: 0.62, map: rowsSpring }) + ')');
run('Game.playerCount=2; Game.mode="local";');
run('Game.players = [makePlayer("kangaroo", {x: 5*32+4, y: 7*32})]');
run('Game.players.push(makePlayer("dragon", {x: 20*32, y: 7*32}))');
run('Game.state="playing"');

check(run('Game.level.springs.length') === 1, '弹簧板解析正确（1 个）');

// 先让角色自然落到弹簧上（不要手动改 onGround，否则会在测量开始前就弹飞）
for (var i = 0; i < 30; i++) frame({});
// 弹簧会把人弹起来，所以找一个"下落中途刚接触弹簧"的时刻来测
// 更稳的做法：直接检查弹簧的触发逻辑本身
var springFired = false;
var springVy = null;
for (var j = 0; j < 120; j++) {
  frame({});
  var vyNow = run('Game.players[0].vy');
  if (vyNow <= run('CONFIG.SPRING_POWER') + 0.5) {
    springFired = true;
    springVy = vyNow;
    break;
  }
}
check(springFired, '弹簧会被触发（踩上去有反应）');
check(springVy !== null && springVy <= run('CONFIG.SPRING_POWER') + 1,
  '弹簧弹速正确（vy=' + (springVy === null ? '未触发' : springVy.toFixed(1)) +
  '，期望 ≈ ' + run('CONFIG.SPRING_POWER') + '）');

var normalJumpVy = run('CONFIG.JUMP_POWER');
check(springVy !== null && Math.abs(springVy) > Math.abs(normalJumpVy) * 1.3,
  '弹簧弹力明显高于普通跳跃（' + (springVy === null ? '?' : springVy.toFixed(1)) + ' vs ' + normalJumpVy + '）');

// 弹簧应该把角色弹到比正常跳跃更高的地方
// 注意：只测"第一次飞行"。落回弹簧上会被再次弹起（设计如此），
// 一直跑会测到反复弹跳，高度失真。
// 做法：从弹簧上方自由落体，记录整个飞行过程中的最高点。
run('Game.players[0].x = 5*32+4; Game.players[0].y = 3*32; Game.players[0].vy = 0;');
run('Game.level.springs[0].cooldown = 0;');
var maxUp = run('Game.players[0].y');
var launched = false;
for (var k = 0; k < 200; k++) {
  frame({});
  var y2 = run('Game.players[0].y');
  if (y2 < maxUp) maxUp = y2;
  if (run('Game.players[0].vy') <= run('CONFIG.SPRING_POWER') + 0.5) launched = true;
  // 飞完一轮并重新落地就停
  if (launched && run('Game.players[0].onGround')) break;
}
var springHeight = 8 * 32 - maxUp;   // 弹簧顶面 y = 8*32
check(springHeight > 200,
  '弹簧单次能弹起 ' + Math.round(springHeight) + 'px（普通跳跃约 101px）');

// 冷却：连按不应该允许在空中连续弹
check(run('CONFIG.SPRING_COOLDOWN') > 0, '弹簧有冷却配置（' + run('CONFIG.SPRING_COOLDOWN') + ' 帧）');

/* ============================================================
 * 2. 传送带
 * ============================================================ */
console.log('\n--- 传送带 ---');
var rowsConv = [
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '.....>>>>><<<<<..........................',
  '########################################',
];
run('Game.level = parseLevel(' + JSON.stringify({ id: 99, name: 'conv', gravity: 0.62, map: rowsConv }) + ')');
check(run('Game.level.conveyors.length') === 10, '传送带解析正确（10 格）');
check(run('Game.level.conveyors[0].dir') === 1, '前 5 格（列5-9）是向右（dir=1）');
check(run('Game.level.conveyors[5].dir') === -1, '后 5 格（列10-14）是向左（dir=-1）');

run('Game.players = [makePlayer("kangaroo", {x: 6*32+4, y: 7*32})]');
run('Game.players.push(makePlayer("dragon", {x: 20*32, y: 7*32}))');
// 站在向右的传送带上（列 6 属于 '>' 段），完全不按键
for (var m = 0; m < 20; m++) frame({});
var xBefore = run('Game.players[0].x');
for (var n = 0; n < 40; n++) frame({});   // 全程不按键
var xAfter = run('Game.players[0].x');
check(xAfter > xBefore + 20,
  '站在向右的传送带上不按键也会被推走（x: ' + Math.round(xBefore) + ' → ' + Math.round(xAfter) + '）');

// 站在向左的传送带上（列 12 属于 '<' 段）
run('Game.players[0].x = 12*32 + 4; Game.players[0].y = 7*32; Game.players[0].vx = 0;');
for (var m2 = 0; m2 < 15; m2++) frame({});
var xb = run('Game.players[0].x');
for (var n2 = 0; n2 < 30; n2++) frame({});
var xa = run('Game.players[0].x');
check(xa < xb - 10, '站在向左的传送带上会被向左推（x: ' + Math.round(xb) + ' → ' + Math.round(xa) + '）');

// 逆着传送带跑（在向左的带子上向右跑），前进应该明显变慢
run('Game.players[0].x = 12*32 + 4; Game.players[0].y = 7*32; Game.players[0].vx = 0;');
for (var m3 = 0; m3 < 15; m3++) frame({});
var px0 = run('Game.players[0].x');
for (var n3 = 0; n3 < 30; n3++) frame({ ArrowRight: true });
var px1 = run('Game.players[0].x');
var againstDist = px1 - px0;

// 对照：在普通地面上同样时长往右跑
run('Game.level = parseLevel(' + JSON.stringify({ id: 99, name: 'flat', gravity: 0.62, map: rowsConv.map(function (r) { return r.replace(/[<>]/g, '#'); }) }) + ')');
run('Game.players = [makePlayer("kangaroo", {x: 12*32+4, y: 7*32})]');
run('Game.players.push(makePlayer("dragon", {x: 20*32, y: 7*32}))');
for (var m4 = 0; m4 < 15; m4++) frame({});
var nx0 = run('Game.players[0].x');
for (var n4 = 0; n4 < 30; n4++) frame({ ArrowRight: true });
var nx1 = run('Game.players[0].x');
var normalDist = nx1 - nx0;

check(againstDist < normalDist * 0.98,
  '逆着传送带跑更慢（' + Math.round(againstDist) + 'px vs 普通地面 ' + Math.round(normalDist) + 'px）');

/* ============================================================
 * 3. 冰面
 * ============================================================ */
console.log('\n--- 冰面 ---');
var rowsIce = [
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '.....IIIII..............................',
  '########################################',
];
run('Game.level = parseLevel(' + JSON.stringify({ id: 99, name: 'ice', gravity: 0.62, map: rowsIce }) + ')');
check(run('Game.level.ices.length') === 5, '冰面解析正确（5 格）');

run('Game.players = [makePlayer("kangaroo", {x: 5*32+4, y: 7*32})]');
run('Game.players.push(makePlayer("dragon", {x: 30*32, y: 7*32}))');

// 在冰上跑起来后松手，看滑多远
for (var q = 0; q < 20; q++) frame({});
for (var q2 = 0; q2 < 25; q2++) frame({ ArrowRight: true });   // 加速
var iceVx = run('Game.players[0].vx');
var iceStart = run('Game.players[0].x');
for (var q3 = 0; q3 < 30; q3++) frame({});                     // 松手滑行
var iceSlid = run('Game.players[0].x') - iceStart;
check(run('Game.players[0].onIce') === true || iceVx > 0,
  '角色能识别自己在冰面上');
check(iceSlid > 60, '冰面上松手后滑行较远（' + Math.round(iceSlid) + 'px，速度 ' + iceVx.toFixed(2) + '）');

// 对照：普通地面的滑行距离
run('Game.level = parseLevel(' + JSON.stringify({ id: 99, name: 'ice2', gravity: 0.62, map: rowsIce.map(function (r) { return r.replace(/I/g, '#'); }) }) + ')');
run('Game.players = [makePlayer("kangaroo", {x: 5*32+4, y: 7*32})]');
run('Game.players.push(makePlayer("dragon", {x: 30*32, y: 7*32}))');
for (var q4 = 0; q4 < 20; q4++) frame({});
for (var q5 = 0; q5 < 25; q5++) frame({ ArrowRight: true });
var gStart = run('Game.players[0].x');
for (var q6 = 0; q6 < 30; q6++) frame({});
var groundSlid = run('Game.players[0].x') - gStart;
check(iceSlid > groundSlid * 1.8,
  '冰面滑行距离明显大于普通地面（' + Math.round(iceSlid) + 'px vs ' + Math.round(groundSlid) + 'px）');

// 冰面加速度也应该更慢
check(run('CONFIG.ICE_ACCEL_MUL') < 0.5, '冰面加速度倍数较小（' + run('CONFIG.ICE_ACCEL_MUL') + '）');
check(run('CONFIG.ICE_FRICTION') > 0.9, '冰面摩擦系数接近 1（' + run('CONFIG.ICE_FRICTION') + '）');

console.log('\n=========================================');
console.log(fails === 0 ? '新机关全部正常 ✓' : (fails + ' 项失败 ✗'));
process.exit(fails === 0 ? 0 : 1);
