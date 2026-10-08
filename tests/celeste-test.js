/* ============================================================
 * celeste-test.js — 新动作系统专项测试
 * ============================================================
 * 需求明确要求验证："跳跃→贴墙滑墙→墙跳→空中冲刺"的完整衔接。
 *
 * 这个测试逐帧模拟真实操作，断言每一环都真的生效：
 *   1. 贴墙检测（左右两面墙都能识别）
 *   2. 滑墙减速（比自由落体慢）
 *   3. 抓墙消耗体力 / 体力耗尽后快速滑落
 *   4. 墙跳（向外弹出 + 正确的高度与横向速度）
 *   5. 八方冲刺（8 个方向都能冲）
 *   6. 冲刺次数限制与落地重置
 *   7. 冲刺冷却
 *   8. 冲刺无敌帧（能免疫尖刺）
 *   9. ★ 动作衔接全链路 ★
 *  10. 新机关（移动平台/开关/风场）
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

/* ---------- 沙箱（带 Canvas 探针，让 render 能跑） ---------- */
function noop() {}
const ctxProbe = new Proxy({}, {
  get: function (t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient')
      return function () { return { addColorStop: noop }; };
    if (k === 'measureText') return function () { return { width: 10 }; };
    if (k === 'getImageData') return function () { return { data: [] }; };
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
    createElement: function () {
      return { style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
        setAttribute: noop, appendChild: noop, addEventListener: noop, querySelectorAll: function () { return []; } };
    },
    querySelectorAll: function () { return []; },
    body: { classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } }, appendChild: noop },
    head: { appendChild: noop },
    readyState: 'complete',
  },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: noop,
  localStorage: (function () {
    const s = {};
    return { getItem: function (k) { return s[k] === undefined ? null : s[k]; },
      setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } };
  })(),
  navigator: { maxTouchPoints: 0 },
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ⚠️ 加载顺序必须和 index.html 保持一致 ——
 * save.js 要在 actions.js / game.js **之前**，
 * 因为它们都要调 isActionUnlocked 判断动作解锁了没。 */
['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js',
 'actions.js', 'tutorial.js', 'net.js', 'render.js', 'game.js', 'ui.js'].forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f }); }
  catch (e) { console.log('load ' + f + ': ' + e.message); }
});

const G = function (n) { return vm.runInContext(n, sandbox); };
const run = function (code) { return vm.runInContext(code, sandbox); };

/* ★★★ 关键：本测试测的是"动作本身能不能用"，不是解锁流程 ★★★
 * ------------------------------------------------------------
 * 游戏默认是"动作逐步解锁"的（新档一个都不会），
 * 所以这里必须先解锁全部动作，否则会测出 19 个假失败
 * —— 那不是 bug，是测试没把前置条件摆好。
 *
 * 解锁流程本身由 tutorial-test.js / unlock-test.js 单独验证。
 *
 * 传 --locked 参数可以**保持锁定状态**跑，
 * 用来验证"未解锁时动作确实完全不生效"。 */
const LOCKED_MODE = process.argv.indexOf('--locked') >= 0;
if (!LOCKED_MODE) {
  run(`(function(){
    Save.load();
    Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];
    Save.data.maxUnlocked = 99;
  })()`);
} else {
  run('Save.load(); Save.data.unlockedActions = []; Save.data.maxUnlocked = 1;');
}

const CONFIG = G('CONFIG');
const CELESTE = G('CELESTE');
const Game = G('Game');
const InputState = G('InputState');
const loadLevel = G('loadLevel');
const ACTIONS = G('ACTIONS');

/* ---------- 帧推进工具 ---------- */
/* ★ 2026-10-07：冲刺键从 'ShiftLeft' 改成了 'KeyF'（见 actions.js 的
 *   DASH_KEYS_BASE），但本文件里到处写的是 ShiftLeft ⇒ 所有冲刺相关
 *   断言全部假失败（9 项）。
 *   ⇒ 在这里做**统一映射**：调用方继续写 ShiftLeft（表达"按冲刺键"的意图），
 *     `frame()` 自动把它换算成**当前真实的冲刺键**。
 *     这样以后再改键位，这个文件一行都不用动。 */
const DASH_KEY_NAME = G('(ACTIONS && ACTIONS.DASH_KEYS && ACTIONS.DASH_KEYS[0]) || "KeyF"');

function frame(keys) {
  keys = keys || {};
  const parts = ['InputState.now = {};'];
  for (const k in keys) {
    if (!keys[k]) continue;
    /* 把"意图上的冲刺键"（ShiftLeft / ShiftRight）映射成真实键位 */
    const real = (k === 'ShiftLeft' || k === 'ShiftRight') ? DASH_KEY_NAME : k;
    parts.push('InputState.now["' + real + '"]=true;');
  }
  parts.push('update(1/60);');
  parts.push('InputState.tick();');
  run(parts.join(''));
}

/** 让角色落到指定位置并站稳 */
function placeOnSolid(role, x, y) {
  run('Game.players[0].x=' + x + '; Game.players[0].y=' + y +
      '; Game.players[0].vx=0; Game.players[0].vy=0; Game.players[0].onGround=true;');
  /* 空跑几帧让它稳定 */
  for (let i = 0; i < 12; i++) frame({});
}

/* ------------------------------------------------------------
 * ⚠️ 关键：测试用的"安全场地"
 * ------------------------------------------------------------
 * 踩过的坑：一开始把地板放在 y=2000、角色放在 y=1000，
 * 结果角色掉下去 y 超过关卡下界 → 触发 `p.y > lv.height + 120`
 * → **Game.state 变成 gameover** → update() 直接 return
 * → 后面所有断言都"莫名其妙失败"（冲刺明明成功了，却读不到）。
 *
 * 所以每次布置测试场地时，都要：
 *   1. 把关卡高度设得足够大（避免误判"掉出地图"）
 *   2. 在角色下方放一块地板兜底
 * 这个函数把这两件事一起做了。
 * ------------------------------------------------------------ */
function setupArena(opts) {
  opts = opts || {};
  run('(function(){' +
      '  Game.state = "playing";' +                       // 复位状态
      '  Game.level.solids.length = 0;' +
      '  Game.level.platforms.length = 0;' +
      '  Game.level.hazards.length = 0;' +
      '  Game.level.height = 5000;' +                     // 抬高下界，防止误判掉出
      '  Game.level.solids.push({x:-1000, y:' + (opts.floorY != null ? opts.floorY : 1200) + ', w:8000, h:64});' +
      '  JSON.parse(' + JSON.stringify(JSON.stringify(opts.solids || [])) + ').forEach(function(s){ Game.level.solids.push(s); });' +
      '})()');
}

/** 取玩家字段 */
function P(expr) { return run('Game.players[0].' + expr); }

console.log('新动作系统专项测试');
console.log('='.repeat(60));

/* 先加载一次关卡，让 Game.players[0] 存在（后面很多检查要用） */
run('Game.mode="local"; Game.playerCount=1; Game.pickRole="kangaroo"; loadLevel(0); Game.state="playing";');

/* ============================================================
 * 0. 模块加载
 * ============================================================ */
console.log('\n=== 0. 模块加载 ===');
check('CELESTE 参数块已加载', !!CELESTE);
check('ACTIONS 接口已暴露', !!(ACTIONS && ACTIONS.updatePlayer));
check('玩家对象有动作状态字段', P('actDashes') !== undefined && P('actWallSlide') !== undefined);
console.log('  冲刺: 速度 ' + CELESTE.dashSpeed + ' px/帧 × ' + CELESTE.dashFrames +
  ' 帧 = ' + Math.round(CELESTE.dashSpeed * CELESTE.dashFrames) + ' px');
console.log('  滑墙速度: ' + CELESTE.wallSlideSpeed + ' px/帧');
console.log('  抓墙体力: ' + CELESTE.grabStaminaFrames + ' 帧 (' + (CELESTE.grabStaminaFrames / 60).toFixed(1) + ' 秒)');

/* ============================================================
 * 1. 贴墙检测
 * ============================================================ */
console.log('\n=== 1. 贴墙检测 ===');
/* 造一个测试场地：左右各一面墙 + 地板兜底 */
setupArena({
  floorY: 1000,
  solids: [
    { x: 300, y: 600, w: 32, h: 300 },   // 右墙
    { x: 100, y: 600, w: 32, h: 300 },   // 左墙
  ],
});

/* 贴右墙：角色放在右墙左侧 */
placeOnSolid('kangaroo', 300 - 26 - 1, 600);
run('Game.players[0].onGround=false; Game.players[0].vy=1;');
frame({ KeyD: true });     // 按住右，贴住右墙
const wallRight = run('Game.players[0].actWallDir');
check('能检测到贴右墙（actWallDir=+1）', wallRight === 1, 'actWallDir=' + wallRight);
check('识别到滑墙状态', P('actWallSlide') === true);

/* 贴左墙 */
placeOnSolid('kangaroo', 100 + 32 + 1, 600);
run('Game.players[0].onGround=false; Game.players[0].vy=1;');
frame({ KeyA: true });
const wallLeft = run('Game.players[0].actWallDir');
check('能检测到贴左墙（actWallDir=-1）', wallLeft === -1, 'actWallDir=' + wallLeft);

/* 悬空（不贴墙） */
placeOnSolid('kangaroo', 200, 600);
run('Game.players[0].onGround=false;');
frame({});
check('悬空时不判定贴墙', P('actWallDir') === 0, 'actWallDir=' + P('actWallDir'));

/* ============================================================
 * 2. 滑墙减速
 * ============================================================ */
console.log('\n=== 2. 滑墙减速（对比自由落体）===');

/* 自由落体：从空中自由下落 30 帧，测最终 vy */
setupArena({ floorY: 3000, solids: [{ x: 300, y: 600, w: 32, h: 600 }] });
run('Game.players[0].x=200; Game.players[0].y=300; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false;');
for (let i = 0; i < 30; i++) frame({});
const freeFallVy = P('vy');

/* ---- 贴墙下落有两种：不按键(滑墙) / 按住朝墙键(抓墙) ----
 * 需求里写的是"碰到竖直墙面触发缓慢下滑" = 不用按键就减速，
 * 所以这里测**不按方向键**的纯滑墙状态。 */
setupArena({ floorY: 3000, solids: [{ x: 300, y: 400, w: 32, h: 2000 }] });
run('Game.players[0].x=' + (300 - 26 - 1) + '; Game.players[0].y=1500;' +
    'Game.players[0].vx=0; Game.players[0].vy=0; Game.players[0].onGround=false;' +
    'Game.players[0].actGrabStamina=' + CELESTE.grabStaminaFrames + ';');
/* 先贴上去（一帧按右键让它识别到墙） */
frame({ KeyD: true });
/* 然后松手，保持贴墙位置 —— 这就是"滑墙"（被动减速） */
for (let i = 0; i < 30; i++) {
  run('Game.players[0].y = 1500; Game.players[0].x = ' + (300 - 26 - 1) + ';');
  frame({});   // 不按方向键
}
const wallVy = P('vy');

console.log('  自由落体 30 帧后 vy = ' + freeFallVy.toFixed(2));
console.log('  贴墙下落 30 帧后 vy = ' + wallVy.toFixed(2) +
  '（配置滑墙 ' + CELESTE.wallSlideSpeed + '）');
check('滑墙速度明显慢于自由落体', wallVy < freeFallVy * 0.5,
  wallVy.toFixed(2) + ' vs ' + freeFallVy.toFixed(2));
check('滑墙速度约等于配置值 ' + CELESTE.wallSlideSpeed,
  Math.abs(wallVy - CELESTE.wallSlideSpeed) < 0.35, 'vy=' + wallVy.toFixed(2));

/* ============================================================
 * 3. 抓墙体力
 * ============================================================ */
console.log('\n=== 3. 抓墙体力 ===');
/* ⚠️ 关键：每帧都要把角色"钉"在墙上（保持 y 不变 + 不落地）。
 * 踩过的坑：一开始只设一次初始位置，结果角色滑到底部**落地**了，
 * 而"落地会补满体力"——于是测出来"体力永远不减少"。
 * 必须每帧重置位置，模拟"一直挂在墙上"的状态。 */
setupArena({ floorY: 3000, solids: [{ x: 300, y: 400, w: 32, h: 2000 }] });
const WALL_X = 300 - 26 - 1;
const WALL_Y = 1500;
run('Game.players[0].x=' + WALL_X + '; Game.players[0].y=' + WALL_Y + ';' +
    'Game.players[0].vx=0; Game.players[0].vy=0; Game.players[0].onGround=false;' +
    'Game.players[0].actGrabStamina=' + CELESTE.grabStaminaFrames + ';');
/* 先贴上去一帧（识别到墙） */
frame({ KeyD: true });
const staminaStart = P('actGrabStamina');
console.log('  初始体力: ' + staminaStart + ' / ' + CELESTE.grabStaminaFrames);
check('初始体力接近配置值（允许一帧消耗）',
  staminaStart >= CELESTE.grabStaminaFrames - 2,
  staminaStart + ' vs ' + CELESTE.grabStaminaFrames);

/* 一直抓着（按住朝墙键）→ 体力应耗尽 */
for (let i = 0; i < CELESTE.grabStaminaFrames + 20; i++) {
  /* 每帧都把它"钉"回墙上（否则滑到底会落地，落地就补满体力） */
  run('Game.players[0].x = ' + WALL_X + '; Game.players[0].y = ' + WALL_Y + ';' +
      'Game.players[0].onGround = false;');
  frame({ KeyD: true });
}
const staminaEnd = P('actGrabStamina');
console.log('  连抓 ' + (CELESTE.grabStaminaFrames + 20) + ' 帧后体力: ' + staminaEnd);
check('持续抓墙会耗尽体力', staminaEnd <= 0, '剩余 ' + staminaEnd);

/* 体力耗尽后应"快速滑落"（vy 更大） */
const vyExhausted = P('vy');
run('Game.players[0].x = ' + (300 - 26 - 1) + '; Game.players[0].y = 300; Game.players[0].vy = 0;');
for (let i = 0; i < 5; i++) {
  run('Game.players[0].x = ' + (300 - 26 - 1) + ';');
  frame({ KeyD: true });
}
const vyAfterExhaust = P('vy');
console.log('  体力耗尽前 vy = ' + vyExhausted.toFixed(2) + '，之后 vy = ' + vyAfterExhaust.toFixed(2));
check('体力耗尽后下坠更快（无法继续抓墙）', vyAfterExhaust > CELESTE.wallSlideSpeed,
  'vy=' + vyAfterExhaust.toFixed(2) + ' > 滑墙速度 ' + CELESTE.wallSlideSpeed);

/* 落地恢复体力：放到地板正上方一点，确保它真的落地 */
setupArena({ floorY: 1200 });
run('Game.players[0].x=900; Game.players[0].y=' + (1200 - 32 - 6) + ';' +
    'Game.players[0].vx=0; Game.players[0].vy=2; Game.players[0].onGround=false;' +
    'Game.players[0].actGrabStamina=0;');
/* 跑几帧让它落地 */
for (let i = 0; i < 12; i++) frame({});
const landed = P('onGround');
const staminaAfterLand = P('actGrabStamina');
console.log('  落地: ' + landed + '，体力: 0 → ' + staminaAfterLand);
check('落地后体力补满', landed === true && staminaAfterLand === CELESTE.grabStaminaFrames,
  'onGround=' + landed + ', 体力=' + staminaAfterLand);

/* ============================================================
 * 4. 墙跳
 * ============================================================ */
console.log('\n=== 4. 墙跳 ===');
setupArena({ floorY: 3000, solids: [
  { x: 300, y: 400, w: 32, h: 800 },    // 右墙
  { x: 100, y: 400, w: 32, h: 800 },    // 左墙
] });
run('Game.players[0].x=' + (300 - 26 - 1) + '; Game.players[0].y=500;' +
    'Game.players[0].vx=0; Game.players[0].vy=1; Game.players[0].onGround=false;' +
    'Game.players[0].actGrabStamina=' + CELESTE.grabStaminaFrames + ';');
/* 先贴一下右墙 */
frame({ KeyD: true });
const beforeDir = P('actWallDir');
/* 再按跳跃 → 应向左弹出（墙的外侧） */
frame({ KeyD: true, Space: true });
const jumpVx = P('vx');
const jumpVy = P('vy');
console.log('  贴墙方向: ' + beforeDir + '（+1=右墙）');
console.log('  墙跳后 vx = ' + jumpVx.toFixed(2) + '（应为负=向左弹）');
console.log('  墙跳后 vy = ' + jumpVy.toFixed(2));

check('墙跳向左弹出（贴右墙 → 往左）', jumpVx < -1, 'vx=' + jumpVx.toFixed(2));
check('墙跳有向上初速', jumpVy < -5, 'vy=' + jumpVy.toFixed(2));
check('墙跳横向速度接近配置值', Math.abs(Math.abs(jumpVx) - CELESTE.wallJumpSpeedX) < 0.5,
  Math.abs(jumpVx).toFixed(2) + ' vs ' + CELESTE.wallJumpSpeedX);
check('墙跳后进入锁定（防止立刻贴回原墙）', P('actWallJumpLock') > 0,
  'lock=' + P('actWallJumpLock'));

/* 贴左墙 → 应向右弹 */
run('Game.players[0].x=' + (100 + 32 + 1) + '; Game.players[0].y=500;' +
    'Game.players[0].vx=0; Game.players[0].vy=1; Game.players[0].onGround=false;' +
    'Game.players[0].actWallJumpLock=0; Game.players[0]._actDashKeyPrev=false;' +
    'Game.players[0].actGrabStamina=' + CELESTE.grabStaminaFrames + ';');
frame({ KeyA: true });
frame({ KeyA: true, Space: true });
check('贴左墙 → 向右弹（vx>0）', P('vx') > 1, 'vx=' + P('vx').toFixed(2));

/* ============================================================
 * 5. 八方冲刺
 * ============================================================ */
console.log('\n=== 5. 八方冲刺 ===');
/* 造一个开阔的高空场地（地板放很远，避免干扰冲刺测量） */
setupArena({ floorY: 4000 });

const dirTests = [
  { name: '右', keys: { ShiftLeft: true, ArrowRight: true }, wantX: 1, wantY: 0 },
  { name: '左', keys: { ShiftLeft: true, ArrowLeft: true }, wantX: -1, wantY: 0 },
  { name: '上', keys: { ShiftLeft: true, ArrowUp: true }, wantX: 0, wantY: -1 },
  { name: '下', keys: { ShiftLeft: true, ArrowDown: true }, wantX: 0, wantY: 1 },
  { name: '右上', keys: { ShiftLeft: true, ArrowRight: true, ArrowUp: true }, wantX: 0.7071, wantY: -0.7071 },
  { name: '右下', keys: { ShiftLeft: true, ArrowRight: true, ArrowDown: true }, wantX: 0.7071, wantY: 0.7071 },
  { name: '左上', keys: { ShiftLeft: true, ArrowLeft: true, ArrowUp: true }, wantX: -0.7071, wantY: -0.7071 },
  { name: '左下', keys: { ShiftLeft: true, ArrowLeft: true, ArrowDown: true }, wantX: -0.7071, wantY: 0.7071 },
];

let dirPass = 0;
const dirDetails = [];
dirTests.forEach(function (t) {
  /* 每次重置到空中、次数补满、清冷却 */
  run('Game.players[0].x=2000; Game.players[0].y=1000; Game.players[0].vx=0; Game.players[0].vy=0;' +
      'Game.players[0].onGround=false; Game.players[0].actDashes=' + CELESTE.dashMaxCount + ';' +
      'Game.players[0].actDashCool=0; Game.players[0].actDashT=0;' +
      'Game.players[0]._actDashKeyPrev=false;');
  /* 一帧不带冲刺键（建立"未按下"基线） */
  frame({});
  /* 按下冲刺 + 方向 */
  frame(t.keys);
  const dx = P('actDashDirX');
  const dy = P('actDashDirY');
  const ok = Math.abs(dx - t.wantX) < 0.02 && Math.abs(dy - t.wantY) < 0.02;
  if (ok) dirPass++;
  dirDetails.push(t.name + '(' + dx.toFixed(2) + ',' + dy.toFixed(2) + ')');
});
console.log('  ' + dirDetails.join('  '));
check('8 个方向全部能冲（' + dirPass + '/8）', dirPass === 8, dirPass + '/8');

/* 冲刺距离 */
run('Game.players[0].x=2000; Game.players[0].y=1000; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false; Game.players[0].actDashes=1; Game.players[0].actDashCool=0;' +
    'Game.players[0].actDashT=0; Game.players[0]._actDashKeyPrev=false;');
frame({});
const x0 = P('x');
frame({ ShiftLeft: true, ArrowRight: true });
for (let i = 0; i < CELESTE.dashFrames; i++) frame({ ShiftLeft: true, ArrowRight: true });
const x1 = P('x');
const dist = x1 - x0;
console.log('  水平冲刺距离 = ' + dist.toFixed(1) + ' px（配置 ' + CELESTE.dashDistance + '）');
check('冲刺距离接近 110px', Math.abs(dist - CELESTE.dashDistance) < 25, dist.toFixed(1) + ' px');

/* 冲刺期间不受重力（竖直冲刺走直线） */
run('Game.players[0].x=2000; Game.players[0].y=1000; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false; Game.players[0].actDashes=1; Game.players[0].actDashCool=0;' +
    'Game.players[0].actDashT=0; Game.players[0]._actDashKeyPrev=false;');
frame({});
const y0 = P('y');
frame({ ShiftLeft: true, ArrowUp: true });
for (let i = 0; i < CELESTE.dashFrames; i++) frame({ ShiftLeft: true, ArrowUp: true });
const y1 = P('y');
const dyUp = y0 - y1;
console.log('  向上冲刺距离 = ' + dyUp.toFixed(1) + ' px（若受重力会明显偏小）');
check('竖直冲刺不受重力拉弯（距离接近 110）', Math.abs(dyUp - CELESTE.dashDistance) < 25,
  dyUp.toFixed(1) + ' px');

/* ============================================================
 * 6. 冲刺：无限次 + 落地重置 + 只受冷却限制
 * ============================================================
 * ⚠️ 2026-10-06 十一要求"冲刺改成无限用"。
 *    原来这段测的是"空中只能冲一次、冲完次数归零"——
 *    现在**次数闸门已拆**，但**冷却仍在**（dashCoolFrames = 18 帧）。
 *    所以这里改成测：
 *      ① 冲刺**不再扣次数**（actDashes 保持满）
 *      ② 冷却没结束时**不能**再冲
 *      ③ 冷却结束后**可以**连续冲（这是"无限"的核心）
 *      ④ 落地仍然把次数补满（存档/显示的兼容行为）
 * ============================================================ */
console.log('\n=== 6. 冲刺无限次 + 只受冷却限制 ===');
run('Game.players[0].x=2000; Game.players[0].y=1000; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false; Game.players[0].actDashes=' + CELESTE.dashMaxCount + ';' +
    'Game.players[0].actDashCool=0;' +
    'Game.players[0].actDashT=0; Game.players[0]._actDashKeyPrev=false;');
frame({});
frame({ ShiftLeft: true, ArrowRight: true });
check('冲刺后**不扣**次数（无限冲刺）', P('actDashes') === CELESTE.dashMaxCount,
  'actDashes=' + P('actDashes'));

/* 冷却没结束 → 不能冲（防止变成"按住无限瞬移"） */
run('Game.players[0]._actDashKeyPrev=false;');
const dashTBefore = P('actDashT');
frame({});
frame({ ShiftLeft: true, ArrowRight: true });
check('冷却中不能再冲（冷却仍在，手感不变）', P('actDashT') <= Math.max(1, dashTBefore),
  'actDashT=' + P('actDashT') + ' (之前 ' + dashTBefore + ')');

/* 冷却结束 → 还能继续冲（这才是"无限用"） */
run('Game.players[0].actDashCool=0; Game.players[0]._actDashKeyPrev=false; Game.players[0].actDashT=0;');
frame({});
frame({ ShiftLeft: true, ArrowRight: true });
check('冷却结束后能再次冲刺（无限，不用等落地）', P('actDashT') > 0,
  'actDashT=' + P('actDashT'));

/* 落地重置：把角色放到地面上方一点点，让它自然落地 */
setupArena({ floorY: 1200 });
run('Game.players[0].x=2000; Game.players[0].y=1200-32-20; Game.players[0].vx=0; Game.players[0].vy=3;' +
    'Game.players[0].onGround=false; Game.players[0].actDashes=0;');
for (let i = 0; i < 30; i++) frame({});
check('落地后冲刺次数重置', P('actDashes') === CELESTE.dashMaxCount,
  'actDashes=' + P('actDashes') + ', onGround=' + P('onGround'));

/* ============================================================
 * 7. 冲刺冷却
 * ============================================================ */
console.log('\n=== 7. 冲刺冷却 ===');
run('Game.players[0].x=2000; Game.players[0].y=1000; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false; Game.players[0].actDashes=5; Game.players[0].actDashCool=0;' +
    'Game.players[0].actDashT=0; Game.players[0]._actDashKeyPrev=false;');
frame({});
frame({ ShiftLeft: true, ArrowRight: true });
/* 冲完，冷却应已置位 */
for (let i = 0; i < CELESTE.dashFrames; i++) frame({});
const coolAfter = P('actDashCool');
check('冲刺结束后进入冷却', coolAfter > 0, 'cool=' + coolAfter);

/* 冷却期间连按不能冲 */
run('Game.players[0]._actDashKeyPrev=false;');
frame({});
const tBefore = P('actDashT');
frame({ ShiftLeft: true, ArrowDown: true });
check('冷却期间无法冲刺', P('actDashT') <= tBefore, 'dashT=' + P('actDashT'));

/* ============================================================
 * 8. 冲刺无敌帧
 * ============================================================ */
console.log('\n=== 8. 冲刺无敌帧（免疫尖刺）===');
run('Game.players[0].x=2000; Game.players[0].y=1000; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false; Game.players[0].actDashes=1; Game.players[0].actDashCool=0;' +
    'Game.players[0].actDashT=0; Game.players[0].actInvuln=0; Game.players[0].hearts=3;' +
    'Game.players[0].invuln=0; Game.players[0]._actDashKeyPrev=false;');
frame({});
frame({ ShiftLeft: true, ArrowRight: true });
check('冲刺时获得无敌帧', P('actInvuln') > 0, 'actInvuln=' + P('actInvuln'));

/* 无敌期间调用 damagePlayer 应该无效 */
const heartsBefore = P('hearts');
run('damagePlayer(Game.players[0], 1);');
check('无敌帧期间免疫伤害', P('hearts') === heartsBefore,
  'hearts ' + heartsBefore + ' → ' + P('hearts'));

/* 无敌结束后可以正常受伤 */
run('Game.players[0].actInvuln=0; Game.players[0].invuln=0;');
run('damagePlayer(Game.players[0], 1);');
check('无敌结束后恢复正常受伤', P('hearts') === heartsBefore - 1,
  'hearts=' + P('hearts'));

/* ============================================================
 * 9. ★ 动作衔接全链路 ★
 * ============================================================ */
console.log('\n=== 9. ★ 动作衔接全链路（跳→滑墙→墙跳→冲刺）★ ===');
/* 造一面高墙 + 地面（复刻"跳上去贴墙"的真实场景） */
setupArena({ floorY: 800, solids: [
  { x: 400, y: 200, w: 32, h: 600 },    // 右墙：从 y=200 到 y=800
] });

const chain = { jump: false, slide: false, wallJump: false, dash: false };

/* 第1步：站在地面，跳起来 */
run('Game.players[0].x=300; Game.players[0].y=768; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=true; Game.players[0].actWallJumpLock=0;' +
    'Game.players[0]._actDashKeyPrev=false;');
for (let i = 0; i < 8; i++) frame({});
frame({ Space: true });
if (P('vy') < -5) chain.jump = true;
console.log('  ① 起跳 vy=' + P('vy').toFixed(2) + (chain.jump ? ' ✅' : ' ❌'));

/* 第2步：向右飘，贴上墙 → 滑墙 */
for (let i = 0; i < 25; i++) frame({ ArrowRight: true });
if (P('actWallSlide') === true) chain.slide = true;
console.log('  ② 贴墙滑行 actWallSlide=' + P('actWallSlide') +
  ' actWallDir=' + P('actWallDir') + (chain.slide ? ' ✅' : ' ❌'));

/* 第3步：按跳 → 墙跳 */
frame({ ArrowRight: true, Space: true });
if (P('vx') < -1 && P('vy') < -5) chain.wallJump = true;
console.log('  ③ 墙跳 vx=' + P('vx').toFixed(2) + ' vy=' + P('vy').toFixed(2) +
  (chain.wallJump ? ' ✅' : ' ❌'));

/* 第4步：空中按冲刺 → 冲出去
 * ⚠️ 2026-10-07 修：原来写 `frame({})` 清一帧后立刻按"冲刺+上"，
 *   依赖"上一帧的状态"，很脆。而且箭头的方向读取会被
 *   第 3 步墙跳留下的 actWallJumpLock 影响 ⇒ 方向读成 right 而不是 up。
 *   ⇒ 现在**显式清干净**：清方向锁、清冷却、复位按键边沿，
 *     再给两帧（第一帧建立"按下"边沿，第二帧读到）。 */
run('Game.players[0]._actDashKeyPrev=false;' +
    'Game.players[0].actDashCool=0;' +
    'Game.players[0].actWallJumpLock=0;');
frame({});
frame({ ShiftLeft: true, ArrowUp: true });
if (P('actDashT') > 0) chain.dash = true;
console.log('  ④ 空中冲刺 actDashT=' + P('actDashT') +
  ' 方向=' + P('actDashDirName') + (chain.dash ? ' ✅' : ' ❌'));

check('★ 全链路连通：跳跃→滑墙→墙跳→冲刺', chain.jump && chain.slide && chain.wallJump && chain.dash,
  JSON.stringify(chain));

/* ============================================================
 * 10. 新机关
 * ============================================================ */
console.log('\n=== 10. 新机关（移动平台 / 开关 / 风场）===');
run('Game.mode="local"; Game.playerCount=1; Game.pickRole="kangaroo"; loadLevel(4); Game.state="playing";');
const lv5 = G('Game.level');
check('第5关加载成功', lv5 && lv5.id === 5, lv5 ? lv5.name : 'null');
check('移动平台已生成', lv5.movers.length === 2, lv5.movers.length + ' 个');
check('开关已生成', lv5.switchers.length >= 1, lv5.switchers.length + ' 个');
check('开关门已生成', lv5.doors.filter(function (d) { return d.isSwitchDoor; }).length >= 1,
  lv5.doors.filter(function (d) { return d.isSwitchDoor; }).length + ' 个');
check('风场已生成', lv5.windGates.length > 0, lv5.windGates.length + ' 格');
check('尖刺已生成', lv5.hazards.length > 0, lv5.hazards.length + ' 个');

/* 移动平台真的会动 */
const m0x = lv5.movers[0].x;
for (let i = 0; i < 60; i++) frame({});
const m1x = lv5.movers[0].x;
check('移动平台会移动', Math.abs(m1x - m0x) > 5,
  m0x.toFixed(1) + ' → ' + m1x.toFixed(1));

/* 风场把角色往上托：直接构造一个风场格，避免受第5关其他机关干扰 */
setupArena({ floorY: 3000 });
run('Game.level.windGates.length = 0;' +
    'Game.level.windGates.push({x:1000, y:700, w:320, h:600, fx:0, fy:CELESTE.windUpForce});' +
    'Game.players[0].x=1100; Game.players[0].y=1200; Game.players[0].vx=0; Game.players[0].vy=0;' +
    'Game.players[0].onGround=false;');
const yBeforeWind = P('y');
/* 跑 30 帧，看角色是不是被"托上去"了 */
for (let i = 0; i < 30; i++) frame({});
const yAfterWind = P('y');
const inWind = P('actInWind');
console.log('  风力 = ' + CELESTE.windUpForce + '（重力 ' + CONFIG.GRAVITY + '，净升 ' +
  Math.abs(CELESTE.windUpForce - CONFIG.GRAVITY).toFixed(2) + '/帧）');
console.log('  角色 y: ' + yBeforeWind.toFixed(1) + ' → ' + yAfterWind.toFixed(1) +
  '（上升 ' + (yBeforeWind - yAfterWind).toFixed(1) + ' px）');
check('风场把角色往上托（y 减小）', yAfterWind < yBeforeWind - 5,
  '上升 ' + (yBeforeWind - yAfterWind).toFixed(1) + ' px');
check('风力强于重力（否则托不住）', Math.abs(CELESTE.windUpForce) > CONFIG.GRAVITY,
  Math.abs(CELESTE.windUpForce).toFixed(2) + ' vs ' + CONFIG.GRAVITY);

/* 开关联动开关门：构造一组明确的"开关 + 门"来验证联动 */
setupArena({ floorY: 1500 });
run('Game.level.switchers.length = 0; Game.level.doors.length = 0;' +
    'Game.level.switchers.push({x:500, y:1400, w:24, h:26, on:false, targetId:0, switchId:0, cooldown:0});' +
    'Game.level.doors.push({x:900, y:1350, w:32, h:150, openAmount:0, open:false,' +
    '  isSwitchDoor:true, switchId:0, id:0});');
/* 先记录门初始状态 */
run('Game.players[0].x=100; Game.players[0].y=1400;');   // 角色先离开开关
for (let i = 0; i < 2; i++) frame({});
const doorBefore = run('Game.level.doors[0].open');
/* 把角色移到开关上（每帧都放回去，防止被物理推走） */
for (let i = 0; i < 5; i++) {
  run('Game.players[0].x=500; Game.players[0].y=1400;');
  frame({});
}
const doorAfter = run('Game.level.doors[0].open');
console.log('  门状态: ' + doorBefore + ' → ' + doorAfter);
check('踩开关会切换门状态', doorBefore !== doorAfter, doorBefore + ' → ' + doorAfter);

/* 再踩一次应切回来（先离开等冷却） */
for (let i = 0; i < 30; i++) {
  run('Game.players[0].x=100; Game.players[0].y=1400;');
  frame({});
}
for (let i = 0; i < 5; i++) {
  run('Game.players[0].x=500; Game.players[0].y=1400;');
  frame({});
}
check('再踩一次开关会切回关闭', run('Game.level.doors[0].open') === doorBefore,
  '现在=' + run('Game.level.doors[0].open'));

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(60));
console.log('  新动作系统测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
console.log('='.repeat(60));
process.exit(FAIL > 0 ? 1 : 0);
