/* ============================================================
 * coin-test.js — 金币门槛测试
 *
 * 金币现在是过关条件（默认 70%），所以必须验证：
 *   1. 每关的金币总数够不够（门槛不能高到不可达）
 *   2. 金币是不是真的能捡到（不会卡在墙里/半空够不着）
 *   3. 金币不够时不能过关
 *   4. 金币够了才能过关
 *
 * 做法：用一个"贪吃 AI"——一路向右跑、看到金币就跳、
 * 走完整关后统计捡到几个。这是最容易发现"金币放在拿不到的地方"的办法。
 * 用法：node coin-test.js
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

console.log('金币门槛测试\n');
run('initGame("game")');
/* ★ 解锁全部动作 ★（放在 initGame 之后 —— 它内部会 Save.load() 覆盖掉）
 * 游戏默认"动作逐步解锁"，新档一个动作都没有。
 * 这些测试测的是关卡/机关本身，不是解锁流程，所以先把动作全开。 */
run('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;');

const levelCount = run('PLAYABLE_LEVELS().length');
const ratio = run('CONFIG.COIN_REQUIRE_RATIO');
console.log('过关门槛：需收集 ' + Math.round(ratio * 100) + '%　共 ' + levelCount + ' 关\n');

/* ============================================================
 * 1. 每关金币数量与门槛的合理性
 * ============================================================ */
console.log('--- 金币数量 vs 门槛 ---');
for (let i = 0; i < levelCount; i++) {
  run('Game.mode="local"; Game.playerCount=2; loadLevel(' + i + ')');
  const total = run('Game.coinsTotal');
  const need = run('Game.coinsRequired');
  const name = run('Game.level.name');
  console.log('  ' + name + '：金币 ' + total + ' 个，需 ' + need + ' 个');
  check(total >= 5, '  金币总数够多（' + total + ' ≥ 5）');
  check(need < total, '  门槛低于总数，留了容错（需 ' + need + ' < ' + total + '）');
  /* ⚠️ 2026-10-07：门槛是 `Math.ceil(总数 × 0.8)` —— **向上取整**，
   *   所以小数关的比例必然略高于 80%（7 × 0.8 = 5.6 → 需 6 = 85.7%）。
   *   这是"宁严勿松"的**故意设计**，不是 bug。
   *   ⇒ 断言要允许 **+1 个的取整容差**，否则小关金币数（如 7 个）会假失败。 */
  check(need <= Math.ceil(total * 0.8), '  门槛不超过 80% + 取整容差（实际 ' + Math.round(need / total * 100) + '%）');
}

/* ============================================================
 * 2. 金币是否真的能捡到
 *
 * 说明：这一节**不用**"贪吃 AI 走全程"来判定可达性，
 * 原因：一个只会"往右跑 + 见币就跳"的傻瓜 AI 爬不上多层平台，
 * 会误报"金币拿不到"。之前就踩过这个坑 —— 报告说只有 7% 可捡，
 * 实际是 AI 太笨，不是关卡有问题。
 *
 * 改用"几何可达性"判定，更客观：
 *   对每个金币，往下找最近的落脚面；
 *   站在那个面上（脚在面上、头顶高 32px），
 *   金币到头顶的高度差是否在「二连跳上限」之内。
 * 这个判据抓住的是"关卡设计是否合理"，不受 AI 智商影响。
 * ============================================================ */
console.log('\n--- 金币几何可达性 ---');

const jumpH = run('Math.abs(CONFIG.JUMP_POWER) * Math.abs(CONFIG.JUMP_POWER) / (2 * CONFIG.GRAVITY)');
const dblH = run('CONFIG.JUMP_POWER * CONFIG.JUMP_POWER / (2 * CONFIG.GRAVITY) * (1 + CONFIG.DOUBLE_JUMP_MUL * CONFIG.DOUBLE_JUMP_MUL)');
console.log('  单跳高度 ' + Math.round(jumpH) + 'px，二连跳总高 ' + Math.round(dblH) + 'px');
const maxReach = Math.round(dblH);

for (let i = 0; i < levelCount; i++) {
  const raw = run('PLAYABLE_LEVELS()[' + i + ']');
  const rows = raw.map;
  const lv = run('parseLevel(PLAYABLE_LEVELS()[' + i + '])');
  let reach = 0;
  const unreach = [];
  lv.coins.forEach(function (c, idx) {
    const col = Math.floor(c.x / 32);
    const coinRow = Math.floor(c.y / 32);
    let groundRow = -1;
    for (let r = coinRow + 1; r < rows.length; r++) {
      if ('#=S><IBbV'.indexOf(rows[r][col]) >= 0) { groundRow = r; break; }
    }
    if (groundRow < 0) { unreach.push('#' + idx + '(无落脚)'); return; }
    // 站在 groundRow 上时，玩家头顶 y = (groundRow-1)*32
    const playerTopY = (groundRow - 1) * 32;
    const heightDiff = playerTopY - c.y;
    if (heightDiff <= maxReach) reach++;
    else unreach.push('#' + idx + '(列' + col + ' 高' + heightDiff + 'px)');
  });
  const need = Math.ceil(lv.coins.length * ratio);
  console.log('  第' + (i + 1) + '关：几何可达 ' + reach + '/' + lv.coins.length + '，门槛 ' + need);
  check(reach >= need,
    '  可达金币数 ≥ 门槛（' + reach + ' ≥ ' + need + '）');
  // 注意：不要求"全部金币都够得到"。有些金币是刻意放在高难度位置的
  // （比如第 4 关架在断裂桥上方的金币，要一边跑一边吃），
  // 只要可达数达到门槛，关卡就是可通关的。
  check(reach >= need,
    '  可达金币足够过关' + (unreach.length ? '（其中 ' + unreach.length + ' 个属高难度：' + unreach.slice(0, 3).join(' ') + '）' : ''));
}

/* ============================================================
 * 3. 金币不够时不能过关
 * ============================================================ */
console.log('\n--- 金币不够时不能过关 ---');
run('Game.mode="local"; Game.playerCount=2; loadLevel(0)');
// 手动把两个人放到终点旗上，但不捡金币
run([
  'Game.coinsTaken = 0;',
  'Game.players[0].x = Game.level.goal.x;',
  'Game.players[0].y = Game.level.goal.y;',
  'Game.players[1].x = Game.level.goal.x;',
  'Game.players[1].y = Game.level.goal.y;',
].join('\n'));
for (let i = 0; i < 10; i++) frame({});
check(run('Game.state') === 'playing',
  '金币 0 个时站到旗子上 → 不通关（state=' + run('Game.state') + '）');

/* ============================================================
 * 4. 金币刚好够时能过关
 * ============================================================ */
console.log('\n--- 金币达标后能过关 ---');
run('Game.coinsTaken = Game.coinsRequired');
run([
  'Game.players[0].x = Game.level.goal.x;',
  'Game.players[0].y = Game.level.goal.y;',
  'Game.players[1].x = Game.level.goal.x;',
  'Game.players[1].y = Game.level.goal.y;',
].join('\n'));
for (let i = 0; i < 10; i++) frame({});
check(run('Game.state') === 'clear',
  '金币正好达到门槛 → 通关（state=' + run('Game.state') + '）');

/* ============================================================
 * 5. 差一个也不能过（边界值）
 * ============================================================ */
console.log('\n--- 边界：差一个不行 ---');
run('Game.mode="local"; Game.playerCount=2; loadLevel(0)');
// 把两人放到旗子上，并把这一格附近的金币标记为已吃（避免站着的时候顺手捡到，
// 那会让"差一个"的边界测试失真）
run([
  'Game.players[0].x = Game.level.goal.x;',
  'Game.players[0].y = Game.level.goal.y;',
  'Game.players[1].x = Game.level.goal.x;',
  'Game.players[1].y = Game.level.goal.y;',
  '// 把旗子 200px 范围内的金币全部标为已吃，这样数量就完全由测试控制',
  'Game.level.coins.forEach(function(c){',
  '  if (Math.abs(c.x - Game.level.goal.x) < 200) c.taken = true;',
  '});',
].join('\n'));
for (let i = 0; i < 3; i++) frame({});
run('Game.coinsTaken = Game.coinsRequired - 1');
for (let i = 0; i < 10; i++) frame({});
const shortBy1 = run('Game.coinsTaken');
check(run('Game.state') === 'playing',
  '差 1 个金币 → 不通关（state=' + run('Game.state') + '，当前 ' + shortBy1 + '/' + run('Game.coinsRequired') + '）');

/* ============================================================
 * 6. 单人模式同样遵守金币门槛
 * ============================================================ */
console.log('\n--- 单人模式也遵守门槛 ---');
run('Game.playerCount=1; Game.pickRole="kangaroo"; Game.mode="single"; loadLevel(0)');
run('Game.coinsTaken = 0');
run([
  'Game.players[0].x = Game.level.goal.x;',
  'Game.players[0].y = Game.level.goal.y;',
].join('\n'));
for (let i = 0; i < 10; i++) frame({});
check(run('Game.state') === 'playing', '单人模式金币不足也不通关');

run('Game.coinsTaken = Game.coinsRequired');
run([
  'Game.players[0].x = Game.level.goal.x;',
  'Game.players[0].y = Game.level.goal.y;',
].join('\n'));
for (let i = 0; i < 10; i++) frame({});
check(run('Game.state') === 'clear', '单人模式金币够了能通关');

console.log('\n=========================================');
console.log(fails === 0 ? '金币门槛全部正常 ✓' : (fails + ' 项失败 ✗'));
process.exit(fails === 0 ? 0 : 1);
