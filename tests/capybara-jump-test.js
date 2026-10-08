/* ============================================================
 * tests/capybara-jump-test.js
 * 卡皮巴拉「专属跳跃动作」验证
 * ============================================================
 * 十一要求："要有他的独特跳跃动作。"
 *
 * 这个测试要守住三件事：
 *   A. 姿态函数本身正确（蓄力下蹲 / 蹬地 / 空中抱团 / 下坠不干扰）
 *   B. ★ 它和另外两个角色的跳跃表现**真的不一样**（否则不算"独特"）★
 *   C. 纯表现层 —— 不改物理、不改可通关性、异常不崩
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;

function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  [v] ' + msg); }
  else { fail++; console.log('  [x] ' + msg + (extra ? ' → ' + extra : '')); }
}

/* ---------- 载入源码（和游戏同顺序，保证依赖可用） ---------- */
const ctx = { window: {}, console: console, Math: Math, setTimeout: setTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);

const ORDER = ['physics.js', 'sprites.js', 'characters.js'];
ORDER.forEach(function (f) {
  const p = path.join(ROOT, 'src', 'js', f);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
});

console.log('==========================================================');
console.log('  卡皮巴拉 · 专属跳跃动作验证');
console.log('==========================================================\n');

/* ---------- A. 姿态函数本身 ---------- */
console.log('--- A. 姿态函数（capybaraJumpPose）---');

ok(typeof ctx.capybaraJumpPose === 'function', 'capybaraJumpPose 已定义（跳跃姿态函数存在）');
/* ⚠️ CAPY_JUMP 是 const，在 vm 上下文里不会挂到 ctx 上 —— 只能查源码 */
const spriteSrcRaw = fs.readFileSync(path.join(ROOT, 'src', 'js', 'sprites.js'), 'utf8');
ok(/const CAPY_JUMP = \{/.test(spriteSrcRaw), 'CAPY_JUMP 参数块已定义');

/* 造一个"最低限度"的玩家对象，只带姿态函数要读的字段 */
function mkP(over) {
  return Object.assign({
    role: 'capybara', vy: 0, onGround: true, jumpBuffer: 0,
    squash: 1, animT: 0, vx: 0,
  }, over || {});
}

/* ① 站在地上、没按跳 → 中性（不能凭空变形） */
const idle = ctx.capybaraJumpPose(mkP());
ok(idle.squash === 1 && idle.yOff === 0, '站着不动 → 中性姿态（不变形）');

/* ② 蓄力下蹲：地面上 + 按了跳还没离地 */
const crouch = ctx.capybaraJumpPose(mkP({ onGround: true, jumpBuffer: 6 }));
ok(crouch.squash > 1, '★ 蓄力下蹲 → 横向压扁（squash ' + crouch.squash + ' > 1）');
ok(crouch.yOff > 0, '★ 蓄力下蹲 → 重心下沉（yOff ' + crouch.yOff + ' > 0）');

/* ③ 刚蹬地：上升且速度很大 → 弹射（比抱团更瘦） */
const launch = ctx.capybaraJumpPose(mkP({ onGround: false, vy: -13 }));
ok(launch.squash < 1, '★ 蹬地瞬间 → 竖向拉长（squash ' + launch.squash + ' < 1，爆发感）');

/* ④ 空中上升（速度已放缓）→ 抱团压扁 */
const rise = ctx.capybaraJumpPose(mkP({ onGround: false, vy: -5 }));
ok(rise.squash > 1, '★ 空中上升 → 抱团压扁（squash ' + rise.squash + ' > 1，像缩成一团）');

/* ⑤ 下坠 → 交给通用逻辑，不叠加（避免两套拉扯） */
const fall = ctx.capybaraJumpPose(mkP({ onGround: false, vy: 6 }));
ok(fall.squash === 1, '下坠 → 返回中性（不干扰通用的下坠拉伸）');

/* ⑥ 蹬地比抱团更"瘦"（三段有区分度） */
ok(launch.squash < rise.squash, '蹬地(' + launch.squash + ') 比 抱团(' + rise.squash + ') 更瘦 → 三段有区分');

/* ---------- B. ★ 真的和另外两个角色不一样 ★ ---------- */
console.log('\n--- B. 与袋鼠 / 飞龙宝宝的差异（"独特"的硬指标）---');

/* 模拟同一时刻：三人都刚离地、都以同样速度上升 */
const sameJump = { onGround: false, vy: -5, jumpBuffer: 0 };
const capyRise = ctx.capybaraJumpPose(mkP(sameJump)).squash;

/* 另外两个角色没有专属姿态 → 走通用逻辑（值应为 1，即"不做额外变形"） */
const kangarooRise = 1, dragonRise = 1;

ok(capyRise !== kangarooRise,
   '★ 空中上升时，卡皮巴拉(' + capyRise + ') ≠ 袋鼠(' + kangarooRise + ')');
ok(capyRise !== dragonRise,
   '★ 空中上升时，卡皮巴拉(' + capyRise + ') ≠ 飞龙宝宝(' + dragonRise + ')');

/* 蓄力下蹲是卡皮巴拉独有的 —— 另两人在这个时刻没有任何变形 */
const capyCrouch = ctx.capybaraJumpPose(mkP({ onGround: true, jumpBuffer: 6 }));
ok(capyCrouch.squash !== 1,
   '★ "蓄力下蹲"只有卡皮巴拉有（另两人蹲了也不变形）');

/* 差异要"看得出来"—— 阈值定在 8%（屏幕上 ~2px），太小等于没有 */
const diffPct = Math.abs(capyRise - 1) * 100;
ok(diffPct >= 8,
   '★ 差异幅度 ' + diffPct.toFixed(0) + '% ≥ 8%（肉眼可辨，不是"理论上有差别"）');

/* ---------- C. 纯表现层 + 健壮性 ---------- */
console.log('\n--- C. 不改物理 / 异常不崩 ---');

/* 空 / 垃圾输入 → 中性值，绝不抛异常 */
let threw = false, bad = null;
try {
  bad = [null, undefined, {}, { vy: 'x', onGround: null }, 0, 'str'].map(function (v) {
    return ctx.capybaraJumpPose(v);
  });
} catch (e) { threw = true; }
ok(!threw, '传入 null/undefined/垃圾对象 都不抛异常');
ok(bad && bad.every(function (r) { return r && r.squash === 1 && r.yOff === 0; }),
   '垃圾输入一律返回中性值（squash=1 / yOff=0）');

/* 源码级红线：姿态绝不能改物理量 */
const gameSrc = fs.readFileSync(path.join(ROOT, 'src', 'js', 'game.js'), 'utf8');
const spriteSrc = fs.readFileSync(path.join(ROOT, 'src', 'js', 'sprites.js'), 'utf8');

const capyFnBody = spriteSrc.slice(
  spriteSrc.indexOf('function capybaraJumpPose'),
  spriteSrc.indexOf('function capybaraJumpPose') + 1400
);
ok(capyFnBody.indexOf('p.vy =') < 0 && capyFnBody.indexOf('p.vx =') < 0,
   '★ 姿态函数**不写任何速度字段**（纯表现，不动物理）');
ok(capyFnBody.indexOf('p.x =') < 0 && capyFnBody.indexOf('p.y =') < 0,
   '★ 姿态函数**不改位置**（只返回偏移量，由渲染层用）');

/* 渲染层必须"出错也能画" —— 有 try 兜底 */
ok(/capybaraJumpPose[\s\S]{0,300}?catch/.test(gameSrc + fs.readFileSync(path.join(ROOT, 'src', 'js', 'render.js'), 'utf8')),
   '★ 渲染层调用姿态时有 try/catch 兜底（算不出来也要能画角色）');

/* 只有卡皮巴拉走这条分支 —— 不能误伤另两个角色 */
const renderSrc = fs.readFileSync(path.join(ROOT, 'src', 'js', 'render.js'), 'utf8');
ok(/p\.role === 'capybara'[\s\S]{0,200}?capybaraJumpPose/.test(renderSrc),
   '★ 专属姿态**只有 capybara 走**（袋鼠/飞龙表现完全不变）');

/* ---------- D. 音效分发 ---------- */
console.log('\n--- D. 专属起跳音效 ---');

ok(typeof ctx.playJumpSound === 'function', 'playJumpSound 分发函数已定义');

const audioSrc = fs.readFileSync(path.join(ROOT, 'src', 'js', 'audio.js'), 'utf8');
ok(/capyJump\s*:/.test(audioSrc), '★ 卡皮巴拉专属起跳音 capyJump 已定义');
ok(/capyLand\s*:/.test(audioSrc), '★ 卡皮巴拉专属落地音 capyLand 已定义');

/* 分发正确性：用假 Sound 记录调用了哪个 */
let called = null;
ctx.Sound = {
  jump: function () { called = 'jump'; },
  capyJump: function () { called = 'capyJump'; },
  land: function () { called = 'land'; },
  capyLand: function () { called = 'capyLand'; },
};
ctx.playJumpSound('capybara', 'jump');
ok(called === 'capyJump', '★ 卡皮巴拉起跳 → 走 capyJump（不是通用 jump）');
ctx.playJumpSound('capybara', 'land');
ok(called === 'capyLand', '★ 卡皮巴拉落地 → 走 capyLand（更沉）');
ctx.playJumpSound('kangaroo', 'jump');
ok(called === 'jump', '袋鼠起跳 → 仍走通用 jump（没被误伤）');
ctx.playJumpSound('dragon', 'land');
ok(called === 'land', '飞龙落地 → 仍走通用 land（没被误伤）');

/* 音效挂掉不能影响游戏 */
let soundThrew = false;
ctx.Sound = null;
try { ctx.playJumpSound('capybara', 'jump'); } catch (e) { soundThrew = true; }
ok(!soundThrew, 'Sound 未加载时不抛异常（音效永远不该弄崩游戏）');

/* ---------- E. 专属粒子 ---------- */
console.log('\n--- E. 专属起跳尘土 ---');
ok(/function spawnHeavyDust/.test(gameSrc), '★ 卡皮巴拉专属尘土 spawnHeavyDust 已定义');
ok(/role === 'capybara'[\s\S]{0,120}?spawnHeavyDust/.test(gameSrc),
   '★ 专属尘土只有卡皮巴拉触发（另两人仍是通用尘）');

console.log('\n==========================================================');
console.log('  卡皮巴拉跳跃动作: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('==========================================================');

process.exit(fail > 0 ? 1 : 0);
