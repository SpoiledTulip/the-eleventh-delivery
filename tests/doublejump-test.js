/* ============================================================
 * doublejump-test.js — 二段跳专项测试
 * ============================================================
 * 验证十一反馈的问题是否修好：
 *   1. 二段跳速度不再被"松键截断"砍掉
 *   2. 上升高度恢复正常
 *   3. 有翻滚动画（spinT 被点亮且会耗尽）
 *   4. 有强化特效（多个环 + 速度线 + 星芒）
 *
 * 方式：纯逻辑模拟，逐帧推进物理，记录完整轨迹。
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

/* ---- 沙箱 ---- */
const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, String, Number, Boolean, Error,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelectorAll: () => [] }),
    querySelectorAll: () => [], addEventListener() {},
    body: { classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, appendChild() {} },
    head: { appendChild() {} }, readyState: 'complete',
  },
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800, PointerEvent: function () {}, navigator: { maxTouchPoints: 0 } },
  navigator: { maxTouchPoints: 0 },
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js', 'ui.js'].forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f }); }
  catch (e) { console.log('load ' + f + ': ' + e.message); }
});

/* ★ 解锁全部动作 ★
 * 游戏默认"动作逐步解锁"（新档全锁）。本测试测的是二连跳本身，
 * 所以先解锁 —— 否则会测出"二连跳完全没反应"的假失败。
 * 解锁流程由 unlock-test.js 单独验证。 */
vm.runInContext('Save.load(); Save.data.unlockedActions = ' +
  '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;', sandbox);

const G = function (n) { return vm.runInContext(n, sandbox); };

const CONFIG = G('CONFIG');
const Game = G('Game');
const InputState = G('InputState');
const collectSolids = G('collectSolids');
const loadLevel = G('loadLevel');

/* ---------- 逐帧模拟二段跳 ---------- */
/* ⚠️ 输入编排必须精确，否则会误判：
 * 踩过的坑：一开始我在第 0 帧按下跳键后**没有及时松开**，
 * 于是第 1 帧 "jumpBuffer 还在 + 已在空中" 立刻又消耗掉一次 → 二段跳
 * 发生得太早，测出来"第1帧就二段跳"，看着像 bug，其实是测试写错了。
 *
 * 正确的真实操作时序（也顺便验证了"松键→二段跳"这个原 bug 场景）：
 *   帧 0 : 按下跳键   → 一段跳
 *   帧 3 : 松开跳键   ← 可变跳高的正常用法（且是原 bug 的触发前提）
 *   帧 14: 再按下     → 二段跳（此时确实在空中）
 *   帧 16: 立刻松开   ← ★ 真实玩家双击后松手，原 bug 就在这里被截断
 */
function simulateDoubleJump(opts) {
  opts = opts || {};
  Game.mode = 'local';
  Game.playerCount = 1;
  Game.pickRole = 'kangaroo';
  loadLevel(0);
  Game.state = 'playing';

  const p = Game.players[0];
  /* ⚠️ 站位必须"真正站在地面上"。
   * 踩过的坑：一开始手动设 p.y = 500 并置 onGround = true，
   * 但 500 在半空 —— 第一帧物理就跑向下落，角色很快落地（帧 8），
   * 于是"二段跳"变成落地后的另一次地面跳，spinT 永远为 0。
   *
   * 正确做法：用关卡出生点（y=708，紧贴地面），先空跑几帧让它落地站稳。 */
  p.vx = 0; p.vy = 0;
  const DT = 1 / 60;
  InputState.clear();
  for (let i = 0; i < 30; i++) {
    G('updatePlaying')(DT);
    InputState.tick();
  }
  /* 确认已站稳；若不是（比如落进了坑），退回到出生点重来 */
  if (!p.onGround) {
    p.x = p.spawnX; p.y = p.spawnY;
    p.vx = 0; p.vy = 0;
    for (let i = 0; i < 30; i++) {
      G('updatePlaying')(DT);
      InputState.tick();
    }
  }
  const startY = p.y;

  const JUMP2_AT = (opts.secondAt != null) ? opts.secondAt : 14;
  const trace = [];

  let secondJumpFrame = -1;
  let secondJumpVy = null;
  let maxSpinT = 0;
  let spinAliveFrames = 0;
  let peakY = p.y;
  /* 记录二段跳当帧的粒子类型（用于验证特效） */
  let particleTypesAtDoubleJump = [];
  let ringCountAtDoubleJump = 0;

  InputState.clear();

  for (let f = 0; f < 200; f++) {
    /* --- 输入编排 --- */
    if (f === 0) {
      InputState.setKey('Space', true);            // 一段跳：按下
    } else if (f === 3) {
      InputState.setKey('Space', false);           // 松开（可变跳高）
    } else if (f === JUMP2_AT) {
      InputState.setKey('Space', true);            // 二段跳：按下
    } else if (f === JUMP2_AT + 2) {
      InputState.setKey('Space', false);           // ★ 立刻松手（原 bug 场景）
    }

    const prevJumpsLeft = p.jumpsLeft;
    const prevSpinT = p.spinT;
    G('updatePlaying')(DT);

    /* ⚠️ 必须推进输入状态！
     * InputState.tick() 会把 now 复制到 prev，用于判断"刚按下"。
     * 真实游戏在 loop() 里每帧调用它；测试里漏了的话，
     * actionPressed() 会永远返回 true → 跳跃每帧连发，
     * 测出来的现象就是"第 1 帧就二段跳了"，看着像 bug 其实是测试没模拟完整。 */
    InputState.tick();

    /* 检测二段跳：用 spinT 从 0 变正来判定（这是二段跳独有的标记），
     * 比看 jumpsLeft 更准 —— jumpsLeft 在两个阶段都会减，容易误判。 */
    if (secondJumpFrame < 0 && prevSpinT === 0 && p.spinT > 0) {
      secondJumpFrame = f;
      secondJumpVy = p.vy;
      particleTypesAtDoubleJump = Array.from(new Set(Game.particles.map(function (x) { return x.type; })));
      ringCountAtDoubleJump = Game.particles.filter(function (x) { return x.type === 'ring'; }).length;
    }

    trace.push({
      f: f, y: p.y, vy: p.vy, onGround: p.onGround,
      spinT: p.spinT, doubleJumped: p.doubleJumped,
      particles: Game.particles.length,
    });

    if (p.y < peakY) peakY = p.y;
    if (p.spinT > maxSpinT) maxSpinT = p.spinT;
    if (p.spinT > 0) spinAliveFrames++;

    if (f > JUMP2_AT + 5 && p.onGround) break;     // 落地结束
  }

  return {
    trace, secondJumpFrame, secondJumpVy, maxSpinT, spinAliveFrames,
    riseHeight: startY - peakY,
    particleTypes: particleTypesAtDoubleJump,
    ringCount: ringCountAtDoubleJump,
    p,
  };
}

console.log('二段跳专项测试');
console.log('='.repeat(56));

/* ================= 1. 速度不再被截断 ================= */
console.log('\n=== 1. ★二段跳速度（原 bug：被松键截断砍 27.5%）★ ===');
const r1 = simulateDoubleJump();

console.log('  二段跳发生帧: ' + r1.secondJumpFrame);
console.log('  二段跳瞬间 vy: ' + (r1.secondJumpVy !== null ? r1.secondJumpVy.toFixed(2) : 'N/A'));

/* 理论值：JUMP_POWER × DOUBLE_JUMP_MUL × 袋鼠系数。
 * ⚠️ 实测会比理论值略小，因为这一帧开头先加了重力（-11.29 → -10.67）。
 *    第一跳的理论值同理：-12.54 实测 -11.92。
 *    所以判定要允许"一帧重力"的误差（CONFIG.GRAVITY）。 */
const expectedVy = CONFIG.JUMP_POWER * CONFIG.DOUBLE_JUMP_MUL * CONFIG.KANGAROO_JUMP_MUL;
const oneFrameGravity = CONFIG.GRAVITY;
console.log('  理论初速: ' + expectedVy.toFixed(2) +
  '（JUMP_POWER ' + CONFIG.JUMP_POWER + ' × DOUBLE_JUMP_MUL ' + CONFIG.DOUBLE_JUMP_MUL +
  ' × 袋鼠 ' + CONFIG.KANGAROO_JUMP_MUL + '）');
console.log('  允许一帧重力误差: ' + oneFrameGravity.toFixed(2) + '（实测必然略小于理论）');

const vyOk = r1.secondJumpVy !== null && r1.secondJumpVy <= expectedVy + oneFrameGravity + 0.5;
check('二段跳初速未被截断', vyOk,
  '实际 ' + (r1.secondJumpVy !== null ? r1.secondJumpVy.toFixed(2) : 'null') +
  ' vs 理论 ' + expectedVy.toFixed(2));

/* 对照：截断后会是多少 */
const cutMul = 1 - (1 - CONFIG.JUMP_CUT) * 0.5;
const cutVy = expectedVy * cutMul;
console.log('  （对照）若被截断会是: ' + cutVy.toFixed(2) + ' —— 现已避免');
check('明显优于"截断后"的数值（差 > 1.5）',
  r1.secondJumpVy !== null && r1.secondJumpVy < cutVy - 1.5,
  '实际 ' + (r1.secondJumpVy !== null ? r1.secondJumpVy.toFixed(2) : 'null') +
  ' vs 截断值 ' + cutVy.toFixed(2));

/* ================= 2. 上升高度恢复 ================= */
console.log('\n=== 2. 上升高度（原 bug：从 87px 掉到 47px）===');
console.log('  实测最高上升: ' + r1.riseHeight.toFixed(0) + ' px');

function riseFrom(v0) { let y = 0, v = v0; for (let i = 0; i < 300 && v < 0; i++) { y += v; v += CONFIG.GRAVITY; } return Math.abs(y); }
const singleRise = riseFrom(CONFIG.JUMP_POWER * CONFIG.KANGAROO_JUMP_MUL);
const doubleRise = riseFrom(expectedVy);
const cutRise = riseFrom(cutVy);
console.log('  单段跳理论高度: ' + singleRise.toFixed(0) + ' px');
console.log('  二段跳理论增量: ' + doubleRise.toFixed(0) + ' px');
console.log('  （对照）截断情景增量: ' + cutRise.toFixed(0) + ' px');

check('二段跳有实际高度（总上升 > 90px）', r1.riseHeight > 90,
  r1.riseHeight.toFixed(0) + ' px');
check('高度未腰斩（明显优于截断情景）',
  r1.riseHeight > doubleRise * 0.75,
  r1.riseHeight.toFixed(0) + ' px（理论增量 ' + doubleRise.toFixed(0) + 'px）');

/* ================= 3. 翻滚动画 ================= */
console.log('\n=== 3. ★二段跳翻滚动画★ ===');
console.log('  翻滚时长配置: ' + CONFIG.DOUBLE_JUMP_SPIN_FRAMES + ' 帧');
console.log('  实测 spinT 峰值: ' + r1.maxSpinT);
console.log('  翻滚持续帧数: ' + r1.spinAliveFrames);

check('二段跳触发了翻滚（spinT > 0）', r1.maxSpinT > 0, 'maxSpinT=' + r1.maxSpinT);
/* spinT 在触发的同一帧末尾就被递减了一次，所以实测峰值 = 配置值 - 1 */
check('翻滚时长符合配置（允许当帧递减的 -1）',
  r1.maxSpinT === CONFIG.DOUBLE_JUMP_SPIN_FRAMES - 1,
  r1.maxSpinT + ' vs ' + (CONFIG.DOUBLE_JUMP_SPIN_FRAMES - 1));
check('翻滚会自然结束（不会卡住一直转）', r1.p.spinT === 0,
  '落地后 spinT=' + r1.p.spinT);

/* 对照：只跳一段不触发翻滚 */
const r2 = simulateDoubleJump({ secondAt: 9999 });   // 永不触发二段跳
console.log('  （对照）只跳一段时 spinT 峰值: ' + r2.maxSpinT);
check('一段跳不触发翻滚（与二段跳区分明显）', r2.maxSpinT === 0, 'maxSpinT=' + r2.maxSpinT);

/* ================= 4. 强化特效 ================= */
console.log('\n=== 4. ★二段跳强化特效★ ===');
const r3 = simulateDoubleJump();
console.log('  二段跳当帧特效类型: ' + JSON.stringify(r3.particleTypes));
console.log('  扩散环数量: ' + r3.ringCount + '（内层白 + 外层蓝 = 双层）');

check('有扩散环（ring）', r3.particleTypes.indexOf('ring') >= 0, JSON.stringify(r3.particleTypes));
check('有速度线（streak）', r3.particleTypes.indexOf('streak') >= 0, JSON.stringify(r3.particleTypes));
check('有星芒（star）', r3.particleTypes.indexOf('star') >= 0, JSON.stringify(r3.particleTypes));
check('有尘土（dust）', r3.particleTypes.indexOf('dust') >= 0, JSON.stringify(r3.particleTypes));
check('扩散环是双层的（≥ 2 个环）', r3.ringCount >= 2, r3.ringCount + ' 个');
check('特效种类丰富（≥ 4 类）', r3.particleTypes.length >= 4, r3.particleTypes.length + ' 类');

/* ================= 5. 时序合理性 ================= */
console.log('\n=== 5. 时序合理性 ===');
const jumpFrame = r3.secondJumpFrame;
const beforeJump = r3.trace[Math.max(0, jumpFrame - 1)];
console.log('  二段跳前 1 帧: onGround=' + beforeJump.onGround + ', vy=' + beforeJump.vy.toFixed(2));
check('二段跳时角色在空中', beforeJump.onGround === false);
check('二段跳发生在合理的帧（不是第 0/1 帧）', jumpFrame > 5, '第 ' + jumpFrame + ' 帧');

console.log('\n' + '='.repeat(56));
console.log('  二段跳测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('='.repeat(56));
process.exit(FAIL > 0 ? 1 : 0);
