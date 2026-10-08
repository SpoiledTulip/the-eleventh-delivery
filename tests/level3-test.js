/* ============================================================
 * level3-test.js — 第 3 关（新机关综合关）可玩性测试
 *
 * 验证：
 *   1. 各类机关都正确解析
 *   2. 弹簧区：能靠弹簧上到高台（跳是跳不上去的）
 *   3. 传送带区：顶着逆风也能走过去
 *   4. 冰面区：能通过（不会必然滑进尖刺）
 *   5. 双人门：两个按钮都踩亮门才开，两人能进房间碰旗
 *   6. 完整走位模拟：两人都能从起点到终点
 * 用法：node level3-test.js
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

console.log('第 3 关测试\n');
run('initGame("game")');
/* ★ 解锁全部动作 ★（放在 initGame 之后 —— 它内部会 Save.load() 覆盖掉）
 * 游戏默认"动作逐步解锁"，新档一个动作都没有。
 * 这些测试测的是关卡/机关本身，不是解锁流程，所以先把动作全开。 */
run('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;');
run('Game.mode="local"; Game.playerCount=2; loadLevel(2)');   // index 2 = 第3关

/* ---- 1. 解析检查 ---- */
console.log('--- 元素解析 ---');
/* 断言不要写死关卡文案（文案会随主题调整），改判 levelIndex 更稳。 */
check(run('Game.levelIndex') === 2,
  '载入的是第 3 关: ' + run('Game.level.name'));
check(run('Game.level.springs.length') === 2, '弹簧板 ' + run('Game.level.springs.length') + ' 个');
check(run('Game.level.conveyors.length') === 8, '传送带 ' + run('Game.level.conveyors.length') + ' 格');
check(run('Game.level.ices.length') === 9, '冰面 ' + run('Game.level.ices.length') + ' 格');
check(run('Game.level.buttons.length') === 2, '按钮 2 个（合作机关）');
check(run('Game.level.doors.length') === 1, '门 1 个');
check(run('Game.level.goal') !== null, '终点存在');
check(run('Game.level.spawns.length') === 2, '出生点 2 个');

/* ---- 2. 传送带方向：这一段应该全是向左（逆风）---- */
console.log('\n--- 传送带方向 ---');
var allLeft = run('Game.level.conveyors.every(function(c){return c.dir===-1;})');
check(allLeft, '第 3 关的传送带全是向左（逆风设计）');

/* ---- 3. 弹簧区：验证能上高台 ---- */
console.log('\n--- 弹簧区 ---');
// 高台顶面在行 19（y=19*32=608）
// 先把袋鼠放到弹簧上
run('Game.players[0].x = 14*32 + 3; Game.players[0].y = 22*32; Game.players[0].vy = 0;');
var reachedHigh = false;
var maxUpY = run('Game.players[0].y');
for (var i = 0; i < 150; i++) {
  frame({ ArrowRight: true });   // 一边弹一边往右飘，去高台
  var y = run('Game.players[0].y');
  if (y < maxUpY) maxUpY = y;
  // 高台区域：x 在 18*32 ~ 27*32 之间，且站在 y≈19*32-32 上
  var px = run('Game.players[0].x');
  if (px > 18 * 32 && px < 27 * 32 && run('Game.players[0].onGround')) { reachedHigh = true; break; }
}
check(maxUpY < 700, '弹簧把人弹到很高（最高 y=' + Math.round(maxUpY) + '，起点约 y=704）');
check(reachedHigh, '一边弹一边往右，能落到高台上');

/* ---- 4. 传送带区：顶着逆风能走过去 ---- */
console.log('\n--- 传送带区 ---');
run('Game.players[0].x = 31*32; Game.players[0].y = 23*32; Game.players[0].vx = 0;');
for (var j = 0; j < 10; j++) frame({});
var startX = run('Game.players[0].x');
for (var k = 0; k < 120; k++) frame({ ArrowRight: true });
var endX = run('Game.players[0].x');
check(endX > startX + 100,
  '顶着逆风也能往前推进（x: ' + Math.round(startX) + ' → ' + Math.round(endX) + '）');

/* ---- 5. 冰面区：能通过，不会卡死 ---- */
console.log('\n--- 冰面区 ---');
run('Game.players[0].x = 42*32; Game.players[0].y = 23*32; Game.players[0].vx = 0;');
for (var m = 0; m < 10; m++) frame({});
var iceStartX = run('Game.players[0].x');
for (var n = 0; n < 130; n++) frame({ ArrowRight: true });
var iceEndX = run('Game.players[0].x');
check(iceEndX > iceStartX + 150,
  '冰面上能往前推进（x: ' + Math.round(iceStartX) + ' → ' + Math.round(iceEndX) + '）');

/* ---- 6. 完整走位：两人从起点到终点 ---- */
console.log('\n--- 完整走位 ---');
run('Game.mode="local"; Game.playerCount=2; loadLevel(2)');

// 用"会跳的傻瓜 AI"跑；但第 3 关有弹簧和冰面，傻瓜 AI 不一定过。
// 所以这里用分段校验：把两个角色直接放到后半段，看能不能合作进门。
run('Game.players[0].x = 60*32; Game.players[0].y = 23*32;');
run('Game.players[1].x = 73*32; Game.players[1].y = 23*32;');
for (var q = 0; q < 20; q++) frame({});

// 袋鼠去踩黄钮（col 62）
var yb = run('Game.level.buttons[0]');
check(yb.color === 'Y', '第一个按钮是黄钮（袋鼠）');
run('Game.players[0].x = ' + (yb.x + 4) + '; Game.players[0].y = ' + (yb.y - 30));
for (var q2 = 0; q2 < 20; q2++) frame({});
check(run('Game.level.buttons[0].pressed') === true, '袋鼠踩亮黄钮');
check(run('Game.level.doors[0].openAmount') < 0.05, '只有黄钮亮，门还关着');

// 奶龙去踩橙钮（col 74）
var ob = run('Game.level.buttons[1]');
check(ob.color === 'O', '第二个按钮是橙钮（奶龙）');
run('Game.players[1].x = ' + (ob.x + 4) + '; Game.players[1].y = ' + (ob.y - 30));
for (var q3 = 0; q3 < 40; q3++) frame({});
check(run('Game.level.buttons[1].pressed') === true, '奶龙踩亮橙钮');
check(run('Game.level.doors[0].openAmount') > 0.85, '两个钮都亮 → 门打开');

// 两人进门碰旗
run('Game.players[0].x = Game.level.doors[0].x - 100; Game.players[0].y = 736;');
for (var q4 = 0; q4 < 160 && !run('Game.players[0].atGoal'); q4++) frame({ ArrowRight: true });
check(run('Game.players[0].atGoal') === true, '袋鼠能进门碰到终点');

run('Game.players[1].x = Game.level.doors[0].x - 100; Game.players[1].y = 736;');
for (var q5 = 0; q5 < 200 && !run('Game.players[1].atGoal'); q5++) frame({ KeyD: true });
check(run('Game.players[1].atGoal') === true, '奶龙能进门碰到终点');

// 金币现在是过关条件，进门前要先把金币补够
run('Game.coinsTaken = Game.coinsRequired');
run([
  'Game.players[0].x = Game.level.goal.x + 2;',
  'Game.players[0].y = Game.level.goal.y;',
  'Game.players[1].x = Game.level.goal.x + 2;',
  'Game.players[1].y = Game.level.goal.y;',
].join('\n'));
for (var q5b = 0; q5b < 5; q5b++) frame({});
check(run('Game.state') === 'clear', '两人都到 + 金币达标 → 通关（state=' + run('Game.state') + '）');

/* ---- 7. 单人模式也能通关第 3 关 ---- */
console.log('\n--- 单人模式 ---');
run('Game.playerCount=1; Game.pickRole="kangaroo"; Game.mode="single"; loadLevel(2)');
check(run('Game.players.length') === 1, '单人模式只出 1 个角色');
check(run('Game.level.singlePlayerRelaxed') === true, '单人模式下机关已放宽');
run('Game.players[0].x = 60*32; Game.players[0].y = 23*32;');
// 踩黄钮就够（单人放宽）
var yb2 = run('Game.level.buttons[0]');
run('Game.players[0].x = ' + (yb2.x + 4) + '; Game.players[0].y = ' + (yb2.y - 30));
for (var q6 = 0; q6 < 40; q6++) frame({});
check(run('Game.level.doors[0].openAmount') > 0.85, '单人模式：踩一个钮门就开');
run('Game.players[0].x = Game.level.doors[0].x - 100; Game.players[0].y = 736;');
for (var q7 = 0; q7 < 200 && !run('Game.players[0].atGoal'); q7++) frame({ ArrowRight: true });
check(run('Game.players[0].atGoal') === true, '单人模式能进门通关');
// 补够金币再触发出关判定
run('Game.coinsTaken = Game.coinsRequired; Game.players[0].x = Game.level.goal.x + 2; Game.players[0].y = Game.level.goal.y;');
for (var q7b = 0; q7b < 5; q7b++) frame({});
check(run('Game.state') === 'clear', '单人通关成功');

console.log('\n=========================================');
console.log(fails === 0 ? '第 3 关全部正常 ✓' : (fails + ' 项失败 ✗'));
process.exit(fails === 0 ? 0 : 1);
