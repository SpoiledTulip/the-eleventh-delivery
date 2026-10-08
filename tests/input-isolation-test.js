/* ============================================================
 * input-isolation-test.js — 键位隔离专项测试
 * ============================================================
 * 验证十一反馈的三个问题：
 *   1. 能操控其他玩家的角色       → 角色只响应自己的键
 *   2. 双人同机按空格两个都跳     → 空格只影响 P1
 *   3. 按键不得影响其他角色       → 键位集两两不相交
 *
 * 这是纯逻辑测试（不需要浏览器），直接加载 js 文件在沙箱里跑，
 * 好处是快、稳、能精确断言每个按键对每个角色的影响。
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

const ROOT = SRC;   // ← 迁移后：源码在 src/ 下
let PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---- 搭一个最小沙箱，加载游戏的核心逻辑 ---- */
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => {},
  localStorage: (function () {
    const m = {};
    return {
      getItem: k => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: k => { delete m[k]; },
    };
  })(),
  document: {
    getElementById: () => null,
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {},
      querySelectorAll: () => [],
    }),
    querySelectorAll: () => [],
    addEventListener() {},
    body: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {} },
    head: { appendChild() {} },
    readyState: 'complete',
  },
  window: {
    addEventListener() {},
    innerWidth: 1280, innerHeight: 800,
    PointerEvent: function () {},
    navigator: { maxTouchPoints: 0 },
  },
  navigator: { maxTouchPoints: 0 },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  Math, Date, Object, Array, Infinity, NaN, JSON, String, Number, Boolean, Error,
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* 按 index.html 的顺序加载（顺序不能乱：后面依赖前面） */
const files = [
  'js/levels.js', 'js/sprites.js', 'js/audio.js',
  'js/physics.js', 'js/save.js', 'js/net.js',
  'js/render.js', 'js/game.js', 'js/ui.js',
];
files.forEach(function (f) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
  } catch (e) {
    console.log('加载 ' + f + ' 失败: ' + e.message);
  }
});

/* ⚠️ vm 沙箱里 `const` 不会挂到 sandbox 对象上，必须用表达式取值 */
const G = function (n) { return vm.runInContext(n, sandbox); };
const KEYMAP = G('KEYMAP');
const KEYMAP_SINGLE = G('KEYMAP_SINGLE');
const InputState = G('InputState');
const Game = G('Game');
const VK = G('VK');
const localRoles = G('localRoles');
const Net = G('Net');

console.log('键位隔离专项测试\n');
console.log('='.repeat(56));

/* ---------------- 1. 键位集两两不相交 ---------------- */
console.log('\n=== 1. 键位集必须两两不相交（串键的根源）===');

function keysOf(map) {
  const out = new Set();
  ['left', 'right', 'jump', 'down'].forEach(function (a) {
    (map[a] || []).forEach(function (k) { out.add(k); });
  });
  return out;
}

const kK = keysOf(KEYMAP.kangaroo);
const kD = keysOf(KEYMAP.dragon);

console.log('  袋鼠键集: ' + Array.from(kK).sort().join(', '));
console.log('  奶龙键集: ' + Array.from(kD).sort().join(', '));

const overlap = Array.from(kK).filter(function (k) { return kD.has(k); });
check('袋鼠与奶龙的键位无任何重叠', overlap.length === 0,
  '重叠键: ' + overlap.join(', '));

check('空格只属于袋鼠（不共用）',
  kK.has('Space') && !kD.has('Space'),
  'kangaroo有Space=' + kK.has('Space') + ', dragon有Space=' + kD.has('Space'));

check('方向键只属于袋鼠',
  kK.has('ArrowLeft') && kK.has('ArrowRight') && kK.has('ArrowUp') &&
  !kD.has('ArrowLeft') && !kD.has('ArrowRight') && !kD.has('ArrowUp'));

check('WASD 只属于奶龙',
  kD.has('KeyA') && kD.has('KeyD') && kD.has('KeyW') &&
  !kK.has('KeyA') && !kK.has('KeyD') && !kK.has('KeyW'));

/* ---------------- 2. 虚拟键也不共用 ---------------- */
console.log('\n=== 2. 虚拟键（触屏）归属清晰 ===');
check('P1 虚拟键只给袋鼠', kK.has(VK.P1_LEFT) && kK.has(VK.P1_RIGHT) && kK.has(VK.P1_JUMP) &&
  !kD.has(VK.P1_LEFT) && !kD.has(VK.P1_RIGHT) && !kD.has(VK.P1_JUMP));
check('P2 虚拟键只给奶龙', kD.has(VK.P2_LEFT) && kD.has(VK.P2_RIGHT) && kD.has(VK.P2_JUMP) &&
  !kK.has(VK.P2_LEFT) && !kK.has(VK.P2_RIGHT) && !kK.has(VK.P2_JUMP));

/* ---------------- 3. 模拟：按空格，只应 P1 起跳 ---------------- */
console.log('\n=== 3. ★按空格键：只有袋鼠跳，奶龙不动★ ===');

/* 设成双人同机模式 */
Game.playerCount = 2;
Game.mode = 'local';
Game.pickRole = 'kangaroo';

/* 清空输入，模拟按下空格 */
InputState.clear();
InputState.setKey('Space', true);

var kangoJump = InputState.actionPressed('kangaroo', 'jump') ||
                InputState.actionHeld('kangaroo', 'jump');
var dragonJump = InputState.actionPressed('dragon', 'jump') ||
                 InputState.actionHeld('dragon', 'jump');

check('按空格 → 袋鼠的 jump 被触发', kangoJump === true);
check('按空格 → 奶龙的 jump 不受影响', dragonJump === false,
  'dragonJump=' + dragonJump);

/* ---------------- 4. 模拟：按 D，只有奶龙向右 ---------------- */
console.log('\n=== 4. ★按 D 键：只有奶龙向右，袋鼠不动★ ===');
InputState.clear();
InputState.setKey('KeyD', true);

var kangoRight = InputState.actionHeld('kangaroo', 'right');
var dragonRight = InputState.actionHeld('dragon', 'right');

check('按 D → 奶龙受到"右"输入', dragonRight === true);
check('按 D → 袋鼠完全不受影响', kangoRight === false);

/* ---------------- 5. 模拟：按方向键右，只有袋鼠向右 ---------------- */
console.log('\n=== 5. ★按 → 键：只有袋鼠向右★ ===');
InputState.clear();
InputState.setKey('ArrowRight', true);

var kangoRight2 = InputState.actionHeld('kangaroo', 'right');
var dragonRight2 = InputState.actionHeld('dragon', 'right');

check('按 → → 袋鼠受到"右"输入', kangoRight2 === true);
check('按 → → 奶龙完全不受影响', dragonRight2 === false);

/* ---------------- 6. 模拟：按 W，只有奶龙跳 ---------------- */
console.log('\n=== 6. ★按 W 键：只有奶龙跳★ ===');
InputState.clear();
InputState.setKey('KeyW', true);

check('按 W → 奶龙 jump 触发', InputState.actionPressed('dragon', 'jump') || InputState.actionHeld('dragon', 'jump') === true);
check('按 W → 袋鼠不受影响', InputState.actionHeld('kangaroo', 'jump') === false);

/* ---------------- 7. 同时按多个键，互不干扰 ---------------- */
console.log('\n=== 7. 两人同时操作：互不干扰 ===');
InputState.clear();
InputState.setKey('ArrowRight', true);   // P1 向右
InputState.setKey('KeyA', true);          // P2 向左
InputState.setKey('Space', true);         // P1 跳

var p1R = InputState.actionHeld('kangaroo', 'right');
var p1L = InputState.actionHeld('kangaroo', 'left');
var p1J = InputState.actionHeld('kangaroo', 'jump');
var p2L = InputState.actionHeld('dragon', 'left');
var p2R = InputState.actionHeld('dragon', 'right');
var p2J = InputState.actionHeld('dragon', 'jump');

check('P1 收到 右+跳', p1R === true && p1J === true);
check('P1 没有收到"左"（那是 P2 的键）', p1L === false);
check('P2 收到 左', p2L === true);
check('P2 没有收到"右"和"跳"', p2R === false && p2J === false);

/* ---------------- 8. 联机模式：本机只操控自己的角色 ---------------- */
console.log('\n=== 8. ★联机：本机只能操控自己的角色★ ===');

Game.playerCount = 2;
Game.mode = 'online';

/* 房主视角 */
Net.role = 'host';
var hostRoles = localRoles();
check('房主 localRoles = [kangaroo]（只有自己）',
  hostRoles.length === 1 && hostRoles[0] === 'kangaroo',
  JSON.stringify(hostRoles));

/* 客人视角 */
Net.role = 'guest';
var guestRoles = localRoles();
check('客人 localRoles = [dragon]（只有自己）',
  guestRoles.length === 1 && guestRoles[0] === 'dragon',
  JSON.stringify(guestRoles));

/* 关键：房主按 A（奶龙的键），不应该动到奶龙
 * —— 因为奶龙由客人的上报驱动，本机键盘碰不到 */
Net.role = 'host';
InputState.clear();
InputState.setKey('KeyA', true);
var hostPressedDragonLeft = InputState.actionHeld('dragon', 'left');
/* 房主本机读的是 KEYMAP.dragon（含 KeyA），所以这里"读到"是正常的 ——
 * 但真正的隔离在 updatePlaying：房主只把自己的键盘用于自己的角色。
 * 所以这里断言的是 localRoles 不含 dragon。 */
check('房主不操控 dragon（即使按了对方的键）',
  localRoles().indexOf('dragon') < 0);

/* ---------------- 9. 远程输入通道隔离 ---------------- */
console.log('\n=== 9. ★远程输入走独立通道，不碰本地键★ ===');
InputState.clear();

/* 客人上报"向右" */
InputState.applyRemote('dragon', { left: false, right: true, jump: false });

check('远程"右"写入了奶龙（VK.R_RIGHT）',
  InputState.now[VK.R_RIGHT] === true);
check('远程输入没有污染真实键盘键（KeyD 仍为空）',
  !InputState.now['KeyD'],
  'KeyD=' + InputState.now['KeyD']);
check('奶龙能读到远程输入', InputState.actionHeld('dragon', 'right') === true);
check('袋鼠读不到远程输入（通道只挂给 dragon）',
  InputState.actionHeld('kangaroo', 'right') === false);

/* ---------------- 10. 单人模式仍然宽松 ---------------- */
console.log('\n=== 10. 单人模式：所有键都能用（不破坏体验）===');
Game.playerCount = 1;
Game.mode = 'local';
Game.pickRole = 'kangaroo';
InputState.clear();

InputState.setKey('ArrowRight', true);
check('单人：方向键可用', InputState.actionHeld('kangaroo', 'right') === true);

InputState.clear();
InputState.setKey('KeyD', true);
check('单人：D 也能用', InputState.actionHeld('kangaroo', 'right') === true);

InputState.clear();
InputState.setKey('Space', true);
check('单人：空格能跳', InputState.actionHeld('kangaroo', 'jump') === true);

InputState.clear();
InputState.setKey('KeyW', true);
check('单人：W 也能跳', InputState.actionHeld('kangaroo', 'jump') === true);

console.log('\n' + '='.repeat(56));
console.log('  键位隔离测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('='.repeat(56));
process.exit(FAIL > 0 ? 1 : 0);
