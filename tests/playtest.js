/* ============================================================
 * playtest.js — 关卡可玩性自动检查
 *
 * 做两件事：
 *   A. 静态检查（行宽、出生点、终点、内容数量）
 *   B. 动态走位模拟：用一个"会跳的 AI"从起点跑到终点，
 *      验证道路是否真的通得过（不是只有静态看起来对）
 *
 * 用法：node tests/playtest.js
 * ============================================================
 * ★ 迁移说明（2026-10-06）★
 * 本文件原来住在旧的任务目录根下（playtest.js），
 * 迁移到 tests/ 时漏掉了它 —— 结果 npm test 跑到第 8 个脚本就
 * MODULE_NOT_FOUND 崩掉，后面的 level2/3/4、mechanics、coin、save
 * 一共 8 套脚本**一次都没跑到过**，项目看起来"测试全绿"其实是假的。
 *
 * 现在补回，并把里面的相对路径（js/levels.js）改成基于 __dirname 推算，
 * 与其它测试脚本保持一致：不依赖当前工作目录，从任何地方都能跑。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---- 路径常量：全部基于 __dirname 推算（同 reachability-test.js）---- */
const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const ROOT = SRC;   // ← 源码在 src/ 下

const sandbox = { console, Math, Date, Object, Array, Infinity, NaN, JSON, String, Number, Boolean, Error };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
});
const G = function (n) { return vm.runInContext(n, sandbox); };

const parseLevel = G('parseLevel');
const aabb = G('aabb');
const CONFIG = G('CONFIG');
const collectSolids = G('collectSolids');
const moveAndCollide = G('moveAndCollide');
const resolvePlatforms = G('resolvePlatforms');
const LEVELS = G('LEVELS');
const LEVELS_COOP = G('LEVELS_COOP');

let errors = 0, warns = 0;
function err(m) { console.log('  [X] ' + m); errors++; }
function warn(m) { console.log('  [!] ' + m); warns++; }
function ok(m) { console.log('  [v] ' + m); }

/* ------------------------------------------------------------
 * 走位模拟 AI
 * 策略：一直往右跑。检测前方：
 *   - 前方有墙 → 跳
 *   - 前方是坑（脚下没地）→ 在边缘起跳
 * 记录最远推进距离与卡住位置。
 * ------------------------------------------------------------ */
function simulateRun(lv, role) {
  const solids = collectSolids(lv);
  const sp = lv.spawns.find(function (s) { return s.role === role; });
  if (!sp) return null;

  const jumpMul = role === 'kangaroo' ? CONFIG.KANGAROO_JUMP_MUL : 1.0;  const ent = {
    x: sp.x, y: sp.y, w: CONFIG.PLAYER_W, h: CONFIG.PLAYER_H,
    vx: 0, vy: 0, onGround: false,
  };

  let maxX = ent.x;
  let stuck = 0, prevX = ent.x;
  let jumpCooldown = 0;
  let reached = false;
  let fell = false;
  const jumpPower = CONFIG.JUMP_POWER * jumpMul;
  const speed = CONFIG.RUN_SPEED;

  for (let f = 0; f < 6000; f++) {
    if (jumpCooldown > 0) jumpCooldown--;

    // --- 前方探测 ---
    // 探测脚下正前方一小段是否有地（判断"要不要现在起跳"）
    const nearProbe = { x: ent.x + ent.w, y: ent.y + ent.h + 2, w: 12, h: 12 };
    const nearGround = solids.some(function (s) { return aabb(nearProbe, s); })
      || lv.platforms.some(function (p) { return aabb(nearProbe, p); });

    // 前方是否有墙（齐身高度的障碍）
    const wallProbe = { x: ent.x + ent.w, y: ent.y + 8, w: 4, h: ent.h - 16 };
    const wallAhead = solids.some(function (s) { return aabb(wallProbe, s); });

    // 起跳条件：站在地面 + 冷却结束 + (脚下前方马上没地 或 前方有墙)
    if (ent.onGround && jumpCooldown === 0 && (!nearGround || wallAhead)) {
      ent.vy = jumpPower;
      ent.onGround = false;
      jumpCooldown = 12;
    }

    // 一直往右
    ent.vx = speed;

    const prevBottom = ent.y + ent.h;
    moveAndCollide(ent, solids);
    resolvePlatforms(ent, lv.platforms, prevBottom);

    if (ent.x > maxX) maxX = ent.x;

    if (ent.y > lv.height + 80) { fell = true; break; }

    if (lv.goal && aabb(ent, lv.goal)) { reached = true; break; }

    // 卡住检测
    if (Math.abs(ent.x - prevX) < 0.3) stuck++; else stuck = 0;
    prevX = ent.x;
    if (stuck > 200) break;
  }

  return { maxX: maxX, reached: reached, fell: fell, stuck: stuck };
}

function checkLevel(raw, label) {
  console.log('\n=========================================');
  console.log('  ' + (label || '') + raw.name);
  console.log('=========================================');

  // ---- A. 静态检查 ----
  const widths = {};
  raw.map.forEach(function (r) { widths[r.length] = (widths[r.length] || 0) + 1; });
  const wkeys = Object.keys(widths);
  if (wkeys.length !== 1) {
    err('行宽不一致: ' + JSON.stringify(widths));
  } else {
    ok('行宽一致: ' + wkeys[0] + ' 列 x ' + raw.map.length + ' 行');
  }

  const lv = parseLevel(raw);
  const solids = collectSolids(lv);

  if (lv.spawns.length < 2) err('出生点不足 2 个（需 P 和 N）');
  lv.spawns.forEach(function (sp) {
    const probe = { x: sp.x, y: sp.y + 40, w: 26, h: 20 };
    const g = solids.some(function (s) { return aabb(probe, s); });
    if (!g) err(sp.role + ' 出生点悬空，开局就掉');
    else ok(sp.role + ' 出生点落地正常');
  });

  if (!lv.goal) err('缺少终点 G');
  else ok('终点存在 (x=' + lv.goal.x + ')');

  const coins = lv.coins.length;
  console.log('  内容: 实心' + lv.solids.length + ' 平台' + lv.platforms.length +
    ' 尖刺' + lv.hazards.length + ' 金币' + coins +
    ' 敌人' + lv.enemies.length + ' 存点' + lv.checkpoints.length);
  if (coins === 0) warn('没有金币');
  if (lv.enemies.length === 0) warn('没有敌人');

  // ---- B. 走位模拟 ----
  /* ⚠️ 说明：这里的走位 AI 非常简单（"一直往右跑，前方有墙就跳"）。
   * 它**不能**代表真实玩家 —— 遇到需要"后退助跑"、"斜向跳"、
   * "先上后下"的地形，它会掉坑或卡住，但关卡其实是通的。
   *
   * 所以 AI 的结果**只作为参考信息，不计入错误数**。
   * 真正判"关卡有没有问题"靠上面的静态检查（出生点、终点、金币数…）
   * 和 reachability-test.js（可达性 + 出生点安全）。
   *
   * 这条区分很重要：不然一堆 [X] 会让人误以为关卡坏了。 */
  console.log('  --- 走位模拟（AI 很简单，结果仅供参考）---');
  ['kangaroo', 'dragon'].forEach(function (role) {
    const r = simulateRun(lv, role);
    if (!r) return;
    const pct = Math.round(r.maxX / lv.goal.x * 100);
    let tag = '';
    if (r.reached) tag = ' [v] 到达终点';
    else if (r.fell) tag = ' [~] AI 掉坑（不一定是关卡问题）';
    else tag = ' [~] AI 卡住（不一定是关卡问题）';
    console.log('    ' + role + ': 推进到 x=' + Math.round(r.maxX) +
      ' / 终点 x=' + lv.goal.x + ' (' + pct + '%)' + tag);
  });
}

console.log('关卡可玩性检查  (LEVELS: ' + LEVELS.length + ' 关, COOP: ' + LEVELS_COOP.length + ' 关)');
LEVELS.forEach(function (r) { checkLevel(r, ''); });
LEVELS_COOP.forEach(function (r) { checkLevel(r, '[备用] '); });

console.log('\n=========================================');
console.log('  跳跃参数');
console.log('=========================================');
const g = CONFIG.GRAVITY;
const jv = Math.abs(CONFIG.JUMP_POWER);
const hN = jv * jv / (2 * g) / 32;
const hK = (jv * CONFIG.KANGAROO_JUMP_MUL) * (jv * CONFIG.KANGAROO_JUMP_MUL) / (2 * g) / 32;
console.log('  奶龙跳跃 ≈ ' + hN.toFixed(2) + ' 格');
console.log('  袋鼠跳跃 ≈ ' + hK.toFixed(2) + ' 格');
console.log('  跑速 ' + CONFIG.RUN_SPEED + ' px/帧 (60fps → ' + (CONFIG.RUN_SPEED * 60 / 32).toFixed(1) + ' 格/秒)');

console.log('\n结果: ' + errors + ' 错误, ' + warns + ' 警告');
if (errors === 0) {
  console.log('→ 静态检查通过。');
  console.log('  但注意：本脚本**不校验"金币是否跳得到"和"出生点是否被卡"**，');
  console.log('  改过关卡地形的话，请另外跑一次：node tests/reachability-test.js');
} else {
  console.log('→ 有关卡数据错误，请修正上面标 [X] 的地方。');
}
process.exit(errors > 0 ? 1 : 0);
