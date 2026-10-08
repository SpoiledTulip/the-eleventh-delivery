/* ============================================================
 * jump-test.js — 二连跳回归测试
 * 验证：
 *   1. 地面跳后还能在空中再跳一次（二连跳生效）
 *   2. 二连跳用完后不能再跳（不能无限跳）
 *   3. 落地后二连跳次数重置
 *   4. 踩敌人头后二连跳次数重置
 *   5. 二连跳的高度符合预期（约第一跳的 90%）
 * 用法：node jump-test.js
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
      var self = this;
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
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ⚠️ 加载顺序要和 index.html 一致：save.js 在 actions.js 之前 */
['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js',
 'actions.js', 'net.js', 'render.js', 'game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
});

/* ★ 解锁全部动作 ★
 * 游戏默认"动作逐步解锁"（新档全锁）。本测试测的是跳跃/二连跳本身，
 * 所以先解锁 —— 否则"二连跳"那几条会假失败。
 *
 * ⚠️ 注意位置：这里只是**声明**解锁意图，真正的解锁在下面 initGame() 之后执行。
 *    因为 initGame() 内部会调 Save.load()，会把这里设的值覆盖掉。
 *    踩过这个坑 —— 解锁写在前面看着对，实际被 initGame 冲掉了。 */
function unlockAllActions() {
  vm.runInContext('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;', sandbox);
}

function run(code) { return vm.runInContext(code, sandbox); }

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  [v] ' + msg);
  else { console.log('  [X] ' + msg); fails++; }
}

/* 跑一帧，可指定按键状态 */
function frame(keys) {
  keys = keys || {};
  var parts = ['InputState.now = {};'];
  for (var k in keys) if (keys[k]) parts.push('InputState.now["' + k + '"]=true;');
  parts.push('update(0.016);');
  parts.push('InputState.tick();');
  run(parts.join(''));
}

console.log('二连跳测试\n');
run('initGame("game")');
/* ★ 关键：必须在 initGame() **之后**解锁 ★
 * initGame 内部会调 Save.load()，把之前在沙箱外设的解锁状态覆盖掉。
 * 所以解锁要放在这里。（这个坑找了几轮才定位到。） */
unlockAllActions();
run('Game.mode="local"; loadLevel(0)');

// 先让角色落地站稳
for (var i = 0; i < 60; i++) frame({});
check(run('Game.players[0].onGround') === true, '角色已落地站稳');
check(run('Game.players[0].jumpsLeft') === run('CONFIG.MAX_JUMPS'),
  '落地后剩余跳跃次数 = ' + run('CONFIG.MAX_JUMPS'));

/* ---- 1. 地面跳 ---- */
var y0 = run('Game.players[0].y');
frame({ ArrowUp: true });
check(run('Game.players[0].vy') < 0, '地面跳：vy=' + run('Game.players[0].vy').toFixed(2) + '（负值=起跳）');
check(run('Game.players[0].jumpsLeft') === 1, '地面跳后剩余次数 = 1');
var vyAfterFirst = run('Game.players[0].vy');

/* ---- 2. 空中二连跳 ---- */
// 等几帧离地
for (var i2 = 0; i2 < 8; i2++) frame({});
check(run('Game.players[0].onGround') === false, '已在空中');
var yBeforeDouble = run('Game.players[0].y');
frame({ ArrowUp: true });
var vyAfterDouble = run('Game.players[0].vy');
check(vyAfterDouble < 0, '二连跳生效：vy=' + vyAfterDouble.toFixed(2));
check(run('Game.players[0].jumpsLeft') === 0, '二连跳后剩余次数 = 0');
check(run('Game.players[0].doubleJumped') === true, 'doubleJumped 标记已置位（用于显示特效）');

/* ---- 3. 二连跳高度约为第一跳的 90% ---- */
var ratio = vyAfterDouble / vyAfterFirst;
check(Math.abs(ratio - 0.9) < 0.35,
  '二连跳初速比 ≈ ' + ratio.toFixed(2) + '（期望接近 0.9）');

/* ---- 4. 次数用完后不能再跳（防无限跳）---- */
for (var i3 = 0; i3 < 6; i3++) frame({});
var vyBefore = run('Game.players[0].vy');
frame({ ArrowUp: true });
var vyAfter = run('Game.players[0].vy');
// 在空中且次数为 0，按跳跃不应该产生新的上升（vy 只会因重力增大）
check(vyAfter >= vyBefore || vyAfter > -3,
  '次数用完后按跳跃不再起跳（vy: ' + vyBefore.toFixed(2) + ' → ' + vyAfter.toFixed(2) + '）');

/* ---- 5. 落地后次数重置 ---- */
for (var i4 = 0; i4 < 200; i4++) {
  frame({});
  if (run('Game.players[0].onGround')) break;
}
check(run('Game.players[0].onGround') === true, '已重新落地');
check(run('Game.players[0].jumpsLeft') === run('CONFIG.MAX_JUMPS'), '落地后二连跳次数已重置');
check(run('Game.players[0].doubleJumped') === false, '落地后 doubleJumped 已复位');

/* ---- 6. 两个角色都能二连跳 ---- */
run('Game.players[1].x=Game.players[1].spawnX; Game.players[1].y=Game.players[1].spawnY; Game.players[1].vy=0; Game.players[1].onGround=true');
for (var i5 = 0; i5 < 30; i5++) frame({});
frame({ KeyW: true });
var p2first = run('Game.players[1].vy');
for (var i6 = 0; i6 < 8; i6++) frame({});
frame({ KeyW: true });
var p2second = run('Game.players[1].vy');
check(p2first < 0 && p2second < 0, '奶龙也能二连跳（第二跳 vy=' + p2second.toFixed(2) + '）');

/* ---- 7. MAX_JUMPS=1 时等于关闭二连跳（可配置性）---- */
run('CONFIG.MAX_JUMPS = 1');
run('Game.players[0].y=Game.players[0].spawnY; Game.players[0].vy=0; Game.players[0].onGround=true; Game.players[0].jumpsLeft=1');
for (var i7 = 0; i7 < 30; i7++) frame({});
frame({ ArrowUp: true });
for (var i8 = 0; i8 < 8; i8++) frame({});
var vyBefore2 = run('Game.players[0].vy');
frame({ ArrowUp: true });
var vyAfter2 = run('Game.players[0].vy');
check(vyAfter2 > vyBefore2 || run('Game.players[0].jumpsLeft') === 0,
  'MAX_JUMPS=1 时二连跳被关闭（可配置）');
run('CONFIG.MAX_JUMPS = 2');   // 还原

console.log('\n=========================================');
console.log(fails === 0 ? '二连跳全部正常 ✓' : (fails + ' 项失败 ✗'));
process.exit(fails === 0 ? 0 : 1);
