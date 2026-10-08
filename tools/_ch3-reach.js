/* ============================================================
 * _ch3-reach.js — 角色机动能力实测（用**真物理**，不是估算）
 * ============================================================
 * 【为什么必须实测】
 *   写关卡最关键的数字是"这个坑玩家跳得过去吗"。
 *   估算完全不可靠（我第一版估 2.09 格，实测差一倍）。
 *   ⇒ 直接复刻 physics.js 的逐帧积分，拿真实轨迹。
 *
 * 【复刻的公式（从 physics.js / actions.js 抄，不改参数）】
 *   重力   vy += CONFIG.GRAVITY           每帧
 *   起跳   vy = -CONFIG.JUMP_POWER
 *   二段跳 vy = -JUMP_POWER * DOUBLE_JUMP_MUL（在空中且还有次数时）
 *   冲刺   vx/vy 直接设为 dashSpeed 的方向分量，持续 dashFrames 帧
 *   落回   脚底 y 回到起跳高度即结束
 *
 * ⚠️ 上一版我把冲刺写成"先归零再给速度"，还把二段跳条件判错，
 *   导致"跳+冲刺 反而比 跳 短"这种明显错误的结论 —— 已重写。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', 'src');
function noop() { }
function buildSandbox() {
  const prox = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    }, set: function () { return true; },
  });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    window: { addEventListener: noop, requestAnimationFrame: function () { return 0; } },
    document: {
      getElementById: function () { return { getContext: function () { return prox; }, width: 0, height: 0, style: {} }; },
      addEventListener: noop,
      createElement: function () { return { getContext: function () { return prox; }, style: {}, appendChild: noop }; },
    },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: noop,
    localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop, clear: noop },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const sb = buildSandbox();
['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'physics.js', 'characters.js',
  'actions.js', 'save.js', 'account.js', 'device-mode.js', 'sprites.js'].forEach(function (f) {
    try { vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f }); } catch (e) { }
  });
const J = function (e) { return JSON.parse(vm.runInContext('JSON.stringify(' + e + ')', sb)); };
const R = function (e) { return vm.runInContext(e, sb); };

const C = J('CONFIG');
const CE = J('CELESTE');
const G = C.GRAVITY, RUN = C.RUN_SPEED, JUMP = Math.abs(C.JUMP_POWER);
const TILE = 32;

console.log('============================================');
console.log('  角色机动能力实测（逐帧积分）');
console.log('============================================');
console.log('重力 ' + G + ' ｜ 跑速 ' + RUN + ' ｜ 跳跃 ' + JUMP + ' ｜ 二段跳倍率 ' + C.DOUBLE_JUMP_MUL);
console.log('冲刺 ' + CE.dashFrames + ' 帧 × ' + CE.dashSpeed + ' = ' + CE.dashDistance + 'px');
console.log('');

/* ============================================================
 * 轨迹模拟（严格复刻 physics 的积分顺序：先加重力，再位移）
 * ============================================================
 * @param opt {
 *   doubleJump  是否在最高点用二段跳
 *   dashAt      第几帧冲刺（null = 不冲）
 *   dashDir     'right' | 'up' | 'diag'（右上 45°，和"八方向冲刺"一致）
 *   startX/startVX  初速（默认满跑速）
 * }
 * @return { dx, up, endY }  dx = 落回同高度时的水平距离
 * ============================================================ */
function sim(opt) {
  opt = opt || {};
  let x = 0, y = 0;
  let vx = (opt.startVX == null) ? RUN : opt.startVX;
  let vy = -JUMP;
  let maxUp = 0;
  let dashing = 0;
  let usedDouble = false;
  let dashed = false;

  for (let f = 0; f < 600; f++) {
    /* ---- 冲刺触发 ---- */
    if (!dashed && opt.dashAt != null && f === opt.dashAt) {
      dashed = true; dashing = CE.dashFrames;
      if (opt.dashDir === 'up') { vx = 0; vy = -CE.dashSpeed; }
      else if (opt.dashDir === 'diag') { vx = CE.dashSpeed * 0.7071; vy = -CE.dashSpeed * 0.7071; }
      else { vx = CE.dashSpeed; vy = 0; }
    }

    /* ---- 二段跳（在最高点且还没用过） ---- */
    if (opt.doubleJump && !usedDouble && f > 2 && vy >= -0.4) {
      vy = -JUMP * C.DOUBLE_JUMP_MUL;
      usedDouble = true;
    }

    /* ---- 积分 ---- */
    if (dashing > 0) {
      dashing--;
      /* 冲刺期间：速度恒定，重力不生效（这是 Celeste 式冲刺的常见做法，
       * 也从"上冲能垂直上升 8.8 格"这个实测值反推确认了） */
    } else {
      vy += G;
      /* 冲刺结束后恢复水平跑速 */
      if (dashed && dashing === 0) vx = RUN;
      /* 玩家持续按右：水平保持满速（简化，不模拟加速过程） */
      vx = RUN;
    }
    x += vx;
    y += vy;
    if (-y > maxUp) maxUp = -y;

    if (f > 4 && y >= 0) break;          // 落回起跳高度
  }
  return { dx: x, up: maxUp };
}

function f2(px) { return Math.round(px) + 'px = ' + (px / TILE).toFixed(2) + ' 格'; }

console.log('--- ① 水平跨越能力（一直按右，落回同高度）---');
const a1 = sim({});
console.log('  单跳            : 距离 ' + f2(a1.dx) + ' ｜ 高度 ' + f2(a1.up));
const a2 = sim({ doubleJump: true });
console.log('  单跳 + 二段跳   : 距离 ' + f2(a2.dx) + ' ｜ 高度 ' + f2(a2.up));
const a3 = sim({ dashAt: 6 });
console.log('  单跳 + 空中冲刺 : 距离 ' + f2(a3.dx) + ' ｜ 高度 ' + f2(a3.up));
const a4 = sim({ doubleJump: true, dashAt: 6 });
console.log('  跳+二段跳+冲刺  : 距离 ' + f2(a4.dx) + ' ｜ 高度 ' + f2(a4.up));

console.log('\n--- ② 纯冲刺（平地）---');
console.log('  一次冲刺        : ' + f2(CE.dashFrames * CE.dashSpeed));
const a5 = sim({ dashAt: 0, startVX: 0 });
console.log('  起跳瞬间冲刺    : 距离 ' + f2(a5.dx));

console.log('\n--- ③ 垂直上升 ---');
const b1 = sim({ dashAt: 2, dashDir: 'up' });
console.log('  跳 + 向上冲刺   : 高度 ' + f2(b1.up));
const b2 = sim({ doubleJump: true, dashAt: 2, dashDir: 'up' });
console.log('  跳+二段+上冲    : 高度 ' + f2(b2.up));
const b3 = sim({ dashAt: 2, dashDir: 'diag' });
console.log('  跳 + 右上斜冲   : 距离 ' + f2(b3.dx) + ' ｜ 高度 ' + f2(b3.up));

console.log('\n--- ④ 墙跳（读真实函数）---');
const wjY = R('CELESTE.wallJumpSpeedY(1.12)');
console.log('  单次墙跳初速    : ' + wjY.toFixed(2) + ' px/帧（袋鼠 1.12 倍）');
console.log('  单次墙跳净上升  : ' + f2((wjY * wjY) / (2 * G)));
console.log('  ⚠️ 但"墙跳会重置跳跃次数" ⇒ 墙跳后可再接一次跳/二段跳');

/* 连续墙跳一口井能爬多高：井宽 W 格，每次换边耗时 = W*32 / wallJumpSpeedX */
console.log('\n--- ⑤ 连续墙跳（竖井）---');
[2, 3, 4, 5].forEach(function (W) {
  const crossFrames = (W * TILE) / CE.wallJumpSpeedX;
  /* 每次墙跳的净上升：从墙跳初速上升到再次贴墙 */
  const rise = wjY * crossFrames - 0.5 * G * crossFrames * crossFrames;
  console.log('  井宽 ' + W + ' 格：换边 ' + crossFrames.toFixed(1) + ' 帧，' +
    '单次净上升 ' + f2(rise) + ' ⇒ 爬 10 格约需 ' + Math.ceil(10 * TILE / rise) + ' 次墙跳');
});

console.log('\n--- ⑥ 墙滑 ---');
console.log('  普通墙滑最大下滑: ' + CE.wallSlideSpeed + ' px/帧 = ' + (CE.wallSlideSpeed * 60) + ' px/秒');
console.log('  抓墙（卡皮巴拉）: ' + CE.grabSlideSpeed + ' px/帧，耐力 ' + CE.grabStaminaFrames + ' 帧');

console.log('\n============================================');
console.log('  ★ 关卡设计硬数字（袋鼠基准 = 最慢不能低于此）');
console.log('============================================');
const sgl = a1.dx / TILE, dbl = a2.dx / TILE, dsh = a3.dx / TILE;
console.log('  单跳可越          ≤ ' + sgl.toFixed(2) + ' 格');
console.log('  二段跳可越        ≤ ' + dbl.toFixed(2) + ' 格');
console.log('  跳+冲刺可越       ≤ ' + dsh.toFixed(2) + ' 格');
console.log('');
console.log('  ⇒ 要"**必须冲刺**"：缺口设 ' + (dbl + 0.3).toFixed(1) + ' ~ ' + (dsh + 1).toFixed(1) + ' 格');
console.log('  ⇒ 要"**必须二段跳**"：缺口设 ' + (sgl + 0.3).toFixed(1) + ' ~ ' + (dbl - 0.3).toFixed(1) + ' 格');
console.log('  ⇒ 要"**只能墙跳**"：竖井宽 3~4 格、深 ≥ 8 格（无其他落脚面）');
console.log('  ⇒ 单跳最大高度 ' + (a1.up / TILE).toFixed(2) + ' 格（决定台阶高度上限）');
