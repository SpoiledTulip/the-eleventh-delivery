/* ============================================================
 * level2-test.js — 第 2 关合作机关通关测试
 * 用"只会按方向键的傻瓜 AI"模拟两个玩家配合过关：
 *   1. 袋鼠走到黄钮踩亮
 *   2. 奶龙走到橙钮踩亮
 *   3. 门打开
 *   4. 两人依次进门碰到终点旗
 * 若这四步都成，说明关卡设计与机关逻辑都是通的。
 * 用法：node level2-test.js
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

['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
});
function run(code) { return vm.runInContext(code, sandbox); }

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  [v] ' + msg);
  else { console.log('  [X] ' + msg); fails++; }
}

/* 驱动一帧：按住某键（可选），跑 update */
function frame(keys) {
  keys = keys || {};
  var parts = ['InputState.now = {};'];
  for (var k in keys) if (keys[k]) parts.push('InputState.now["' + k + '"]=true;');
  parts.push('update(0.016);');
  parts.push('InputState.tick();');
  run(parts.join(''));
}

/* 让某个角色一直往右走，直到 x 超过 target（或超过 maxFrames） */
function walkRightTo(role, targetX, maxFrames) {
  var key = role === 'kangaroo' ? 'ArrowRight' : 'KeyD';
  var idx = role === 'kangaroo' ? 0 : 1;
  var f = 0;
  while (f < maxFrames) {
    var x = run('Game.players[' + idx + '].x');
    if (x >= targetX) return { ok: true, x: x, frames: f };
    if (run('Game.state') !== 'playing') return { ok: false, x: x, frames: f, state: run('Game.state') };
    var keys = {};
    keys[key] = true;
    frame(keys);
    f++;
  }
  return { ok: false, x: run('Game.players[' + idx + '].x'), frames: f, stuck: true };
}

console.log('第 2 关合作机关通关测试\n');

run('initGame("game")');
/* ★ 解锁全部动作 ★（放在 initGame 之后 —— 它内部会 Save.load() 覆盖掉）
 * 游戏默认"动作逐步解锁"，新档一个动作都没有。
 * 这些测试测的是关卡/机关本身，不是解锁流程，所以先把动作全开。 */
run('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;');
run('Game.mode="local"; loadLevel(1)');

/* 断言不要写死关卡文案（文案会随主题调整），改判 levelIndex 和 id 更稳。 */
check(run('Game.levelIndex') === 1 && run('Game.level.id') === 2,
  '已载入第 2 关: ' + run('Game.level.name'));
check(run('Game.level.buttons.length') === 2, '关卡有 2 个按钮');
check(run('Game.level.doors.length') === 1, '关卡有 1 道门');

// 初始：门必须关着
for (var i = 0; i < 10; i++) frame({});
check(run('Game.level.doors[0].openAmount') < 0.05, '开局门是关着的（开度=' +
  run('Game.level.doors[0].openAmount').toFixed(2) + '）');
check(run('Game.level.buttons[0].pressed') === false, '开局黄钮未亮');

/* ---- 1. 验证"缺一个按钮门不开" ---- */
var ybtn = run('Game.level.buttons[0]');
run('Game.players[0].x=' + (ybtn.x + 4) + '; Game.players[0].y=' + (ybtn.y - 30));
for (var i2 = 0; i2 < 20; i2++) frame({});
check(run('Game.level.buttons[0].pressed') === true, '袋鼠站上黄钮后黄钮亮起');
check(run('Game.level.doors[0].openAmount') < 0.05, '只有黄钮亮时门仍然关着（需要两个）');

/* ---- 2. 奶龙踩橙钮 ---- */
var obtn = run('Game.level.buttons[1]');
run('Game.players[1].x=' + (obtn.x + 4) + '; Game.players[1].y=' + (obtn.y - 30));
for (var i3 = 0; i3 < 30; i3++) frame({});
check(run('Game.level.buttons[1].pressed') === true, '奶龙站上橙钮后橙钮亮起');
check(run('Game.level.doors[0].openAmount') > 0.85, '两个钮都亮 → 门打开（开度=' +
  run('Game.level.doors[0].openAmount').toFixed(2) + '）');

/* ---- 3. 验证锁存：离开按钮门仍然开着 ---- */
run('Game.players[0].x=200; Game.players[1].x=400');
for (var i4 = 0; i4 < 40; i4++) frame({});
check(run('Game.level.buttons[0].pressed') === true && run('Game.level.buttons[1].pressed') === true,
  '离开按钮后按钮保持点亮（锁存生效）');
check(run('Game.level.doors[0].openAmount') > 0.85, '门保持开启');

/* ---- 4. 两人从起点跑到终点 ---- */
run('Game.mode="local"; loadLevel(1)');
// 重新踩按钮（重开后按钮复位）
run('Game.players[0].x=' + (run('Game.level.buttons[0]').x + 4) + '; Game.players[0].y=' + (run('Game.level.buttons[0]').y - 30));
for (var i5 = 0; i5 < 20; i5++) frame({});
run('Game.players[1].x=' + (run('Game.level.buttons[1]').x + 4) + '; Game.players[1].y=' + (run('Game.level.buttons[1]').y - 30));
for (var i6 = 0; i6 < 40; i6++) frame({});
check(run('Game.level.doors[0].open') === true, '重开后再次开门成功');

// 把袋鼠放到门口左边，一路往右冲进房间
var doorX = run('Game.level.doors[0].x');
run('Game.players[0].x=' + (doorX - 120) + '; Game.players[0].y=736');
var r1 = walkRightTo('kangaroo', run('Game.level.goal.x'), 400);
check(run('Game.players[0].atGoal') === true,
  '袋鼠能穿过门进到终点（x=' + Math.round(run('Game.players[0].x')) + '）');

// 奶龙同样
run('Game.players[1].x=' + (doorX - 120) + '; Game.players[1].y=736');
walkRightTo('dragon', run('Game.level.goal.x'), 400);
check(run('Game.players[1].atGoal') === true,
  '奶龙能穿过门进到终点（x=' + Math.round(run('Game.players[1].x')) + '）');

/* ---- 5. 两人都到 → 过关 ----
 * 金币现在是过关条件，所以要把金币补够。
 * 另外注意：walkRightTo 会一直按着方向键，角色会冲出终点判定范围，
 * 所以这里直接把两人都放到旗子上（本段只验证"到达 + 金币达标 = 通关"）。 */
run('Game.coinsTaken = Game.coinsRequired');
run([
  'Game.players[0].x = Game.level.goal.x + 2;',
  'Game.players[0].y = Game.level.goal.y;',
  'Game.players[1].x = Game.level.goal.x + 2;',
  'Game.players[1].y = Game.level.goal.y;',
].join('\n'));
for (var iG = 0; iG < 5; iG++) frame({});   // 跑几帧让终点判定生效
var st = run('Game.state');
check(st === 'clear', '两人都到终点 + 金币达标 → 通关（state=' + st + '）');

/* ---- 5b. 金币不够时即便两人都到也不通关 ---- */
run('Game.mode="local"; Game.playerCount=2; loadLevel(1)');
run('Game.coinsTaken = 0');
run([
  'Game.players[0].x = Game.level.goal.x;',
  'Game.players[0].y = Game.level.goal.y;',
  'Game.players[1].x = Game.level.goal.x;',
  'Game.players[1].y = Game.level.goal.y;',
].join('\n'));
for (var ic = 0; ic < 10; ic++) frame({});
check(run('Game.state') === 'playing', '金币不足时即便两人都到旗子也不通关');

/* ---- 6. 单人模式：一个按钮就能开门 ---- */
run('Game.playerCount = 1; Game.pickRole = "kangaroo"; Game.mode = "single";');
run('loadLevel(1)');   // 第2关
check(run('Game.players.length') === 1, '单人模式只生成 1 个角色');
check(run('Game.level.singlePlayerRelaxed') === true, '单人模式下关卡标记为"已放宽"');

// 开局门应该是关的
for (var i9 = 0; i9 < 10; i9++) frame({});
check(run('Game.level.doors[0].openAmount') < 0.05, '单人模式开局门是关着的');

// 只踩黄钮（袋鼠）→ 单人模式下应该开门
run('Game.players[0].x=' + (run('Game.level.buttons[0]').x + 4) +
    '; Game.players[0].y=' + (run('Game.level.buttons[0]').y - 30));
for (var i10 = 0; i10 < 40; i10++) frame({});
check(run('Game.level.buttons[0].pressed') === true, '单人踩了黄钮');
check(run('Game.level.doors[0].openAmount') > 0.85,
  '单人模式：只踩一个按钮门也开（开度=' + run('Game.level.doors[0].openAmount').toFixed(2) + '）');

// 单人能从出生点走到终点
run('loadLevel(1)');
run('Game.players[0].x=' + (run('Game.level.buttons[0]').x + 4) +
    '; Game.players[0].y=' + (run('Game.level.buttons[0]').y - 30));
for (var i11 = 0; i11 < 40; i11++) frame({});
var doorX2 = run('Game.level.doors[0].x');
run('Game.players[0].x=' + (doorX2 - 120) + '; Game.players[0].y=736');
walkRightTo('kangaroo', run('Game.level.goal.x'), 400);
check(run('Game.players[0].atGoal') === true, '单人模式能一路走到终点');
run('Game.coinsTaken = Game.coinsRequired');   // 金币是过关条件，先补够
for (var ic2 = 0; ic2 < 10; ic2++) frame({});
check(run('Game.state') === 'clear', '单人模式通关成功');

// 还原成多人设置（避免影响后续）
run('Game.playerCount = 2; Game.mode = "local";');

console.log('\n=========================================');
console.log(fails === 0 ? '第 2 关合作机关全部正常 ✓' : (fails + ' 项失败 ✗'));
process.exit(fails === 0 ? 0 : 1);
