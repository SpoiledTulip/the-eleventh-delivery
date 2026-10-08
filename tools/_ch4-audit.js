/* ============================================================
 * tools/_ch4-audit.js — 第 21~30 关订单可达性审计（只读，不改 src）
 *
 * 【为什么写这个】
 *   门槛从 45% 提到 80% 后，第 21~30 关（levels-ch4.js，上一轮产物）
 *   暴露出大量"订单吃不到"的问题。这个脚本把问题**量化**：
 *     对每个金币，用它下方/附近的落脚面 + 该关可用能力，
 *     判断"站着跳能不能吃到"；吃不到的给出坐标和高差。
 *
 * 【和 check-coins-all.js 的分工】
 *   这个是**纯几何**审计（快，能一次跑完 10 关），
 *   那个是**真物理实测**（慢，但权威）。两个都跑，结论一致才是真 bug。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function noop() {}
const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Set, Map,
  window: { addEventListener: noop, requestAnimationFrame: function () { return 0; } },
  document: { getElementById: function () { return { getContext: function () { return {}; }, style: {} }; }, addEventListener: noop },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: noop,
  localStorage: (function () { var s = {}; return { getItem: function (k) { return s[k] === undefined ? null : s[k]; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } }; })(),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['cloud-config.js', 'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'levels-ch4.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8'), sandbox, { filename: f });
});
const run = function (code) { return vm.runInContext(code, sandbox); };

const T = 32;
const SOLID = '#=S><IB';

/* 能力基准：第 21 关起，玩家已解锁全部动作（冲刺在通关第 4 关后解锁） */
const JUMP2 = 242;                        // 双跳净上升（px）
const DASH_UP = 110 * 0.85;               // 冲刺的净上升
const JUMP_DASH = JUMP2 + DASH_UP;        // 连跳+冲刺

console.log('第 21~30 关订单可达性审计（几何口径）');
console.log('='.repeat(66));
console.log('能力上限：连跳+冲刺 = ' + JUMP_DASH.toFixed(0) + 'px（' + (JUMP_DASH / T).toFixed(2) + ' 格）');
console.log('');

let problems = 0;

for (let id = 21; id <= 30; id++) {
  const B = run('typeof __CH4_LEVEL_BUILDERS !== "undefined" && __CH4_LEVEL_BUILDERS[' + id + ']');
  if (typeof B !== 'function') { console.log('第' + id + '关 ❌ 没有构建器'); problems++; continue; }
  const raw = run('__CH4_LEVEL_BUILDERS[' + id + ']()');
  const rows = raw.map;
  const W = rows[0].length;

  // 收集金币
  const coins = [];
  rows.forEach(function (row, r) {
    for (let c = 0; c < row.length; c++) if (row[c] === 'o') coins.push({ c: c, r: r });
  });

  // 可达性判定：从金币往下/横向找"最近的可站面"
  function findFace(col, coinRow) {
    // 候选 A：横向 ±4、下方 1~8
    let best = null, bestScore = 1e9;
    for (let dc = -4; dc <= 4; dc++) {
      const cc = col + dc;
      if (cc < 0 || cc >= W) continue;
      for (let r = coinRow + 1; r <= coinRow + 8 && r < rows.length; r++) {
        if (SOLID.indexOf(rows[r][cc]) >= 0) {
          if (SOLID.indexOf(rows[r - 1][cc]) >= 0) continue;   // 上面要能站人
          const score = (r - coinRow) * 10 + Math.abs(dc) * 30;
          if (score < bestScore) { bestScore = score; best = { c: cc, r: r }; }
          break;
        }
      }
    }
    // 候选 B：正下方一路到底
    for (let r = coinRow + 1; r < rows.length; r++) {
      if (SOLID.indexOf(rows[r][col]) >= 0) {
        if (SOLID.indexOf(rows[r - 1][col]) >= 0) break;
        const score = (r - coinRow) * 10;
        if (score < bestScore) { bestScore = score; best = { c: col, r: r }; }
        break;
      }
    }
    return best;
  }

  let reach = 0;
  const bad = [];
  coins.forEach(function (co, i) {
    const face = findFace(co.c, co.r);
    if (!face) { bad.push('#' + i + '(列' + co.c + ' 行' + co.r + ' 无落脚面)'); return; }
    // 站立时脚在 face.r，头顶在 face.r-1；金币中心在 co.r
    const rise = (face.r - 1 - co.r) * T;
    if (rise <= JUMP_DASH + 8) reach++;
    else bad.push('#' + i + '(列' + co.c + ' 行' + co.r + ' 需上升' + rise + 'px，站行' + face.r + ' 列' + face.c + ')');
  });

  const need = Math.ceil(coins.length * 0.8);
  const ok = reach >= need;
  if (!ok) problems++;
  console.log('第' + id + '关 ' + String(raw.district || '').padEnd(12) +
    ' 共' + String(coins.length).padStart(3) + ' 单  可达' + String(reach).padStart(3) +
    '  门槛' + String(need).padStart(3) + '  ' + (ok ? '✅' : '❌ 差 ' + (need - reach) + ' 单'));
  if (bad.length) {
    console.log('     吃不到的：');
    bad.forEach(function (b) { console.log('       ' + b); });
  }
}

console.log('');
console.log('='.repeat(66));
console.log(problems === 0 ? '全部关卡可达成门槛 ✅' : '有 ' + problems + ' 关无法达成门槛 ❌');
