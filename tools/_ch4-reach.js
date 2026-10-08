/* ============================================================
 * tools/_ch4-reach.js — 第 21~30 关"玩家能不能到达"审计（只读）
 * ============================================================
 * 【为什么需要（和 check-coins-all.js 的分工）】
 *   `check-coins-all.js` 只回答"**这个订单本身能不能吃到**"——
 *   它把角色**直接放在订单下方的落脚面**上试。
 *   ⇒ 有个致命盲区：**它不验"玩家能不能走到那个落脚面"**。
 *   第 28 关就是被这个盲区放过的：高台离地面 352px（超上限 336px），
 *   订单全在平台上 → 工具报"23/23 可达"，但玩家**根本上不去**。
 *
 *   本工具补上这一层：**从出生点出发做连通性搜索**，只认可达的落脚面。
 *
 * 【关键：必须认识第 4 章的机制】
 *   这批关卡大量用"移动平台/风柱/货箱"当**唯一的上行通道**，
 *   不认识它们就会误判"够不到"。所以：
 *     · `m`（移动平台）→ 当成落脚面
 *     · `w`（风柱）→ 站进去会被向上弹 JET_LAUNCH，可当"电梯"
 *     · `j`（跳跃怪）→ 可踩，理论上也算，但保守起见不算
 *
 * 【能力上限（实测值，见 MEMORY）】
 *   连跳 + 冲刺：垂直 336px（10.5 格）、水平 ≈ 5.2 格
 *   风柱单次弹起：JET_LAUNCH(-13.4) → 145px（4.5 格）
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

/* 能站的字符：实心 + 平台 + 崩塌桥 + 移动平台 + 风柱顶（w 是"气流"，站进去会被弹） */
const STAND_ON = '#=S><IBm';
/* 能贴的墙（用于墙跳）：只认实心砖/台阶，平台不行 */
const SOLID_ONLY = '#I';
const PASSABLE_VERT = 'w';   // 风柱：可以"穿过"，且在里面被向上弹

const UP = 10;      // 单次上升上限（格）：336px / 32
const HORIZ = 5;    // 单次水平上限（格）
const UP_FAN = 4;   // 风柱单次弹起（格）
const WALL_UP = 4;  // 单次墙跳净上升（格）：4.3 格取 4

let bad = 0;

for (let id = 21; id <= 30; id++) {
  const B = run('typeof __CH4_LEVEL_BUILDERS !== "undefined" && __CH4_LEVEL_BUILDERS[' + id + ']');
  if (typeof B !== 'function') { console.log('第' + id + '关 ❌ 无构建器'); bad++; continue; }
  const raw = run('__CH4_LEVEL_BUILDERS[' + id + ']()');
  const rows = raw.map;
  const W = rows[0].length, H = rows.length;

  /* 可站格：自己空、脚下是实心/移动平台 */
  function stand(c, r) {
    if (c < 1 || c >= W - 1 || r < 1 || r >= H - 1) return false;
    if (STAND_ON.indexOf(rows[r + 1][c]) < 0) return false;
    if (STAND_ON.indexOf(rows[r][c]) >= 0) return false;
    return true;
  }
  /* 风柱格：char 'w' */
  function isFan(c, r) {
    return c >= 0 && c < W && r >= 0 && r < H && rows[r][c] === 'w';
  }

  // 出生点
  let sp = null;
  rows.forEach(function (row, r) {
    for (let c = 0; c < row.length; c++) if (row[c] === 'P') sp = { c: c, r: r - 1 };
  });
  if (!sp) { console.log('第' + id + '关 ❌ 找不到出生点'); bad++; continue; }

  const seen = new Set([sp.c + ',' + sp.r]);
  const q = [sp];
  while (q.length) {
    const cur = q.shift();
    function push(nc, nr) {
      if (nc < 1 || nc >= W - 1 || nr < 1 || nr >= H - 1) return;
      const k = nc + ',' + nr;
      if (seen.has(k)) return;
      if (!stand(nc, nr)) return;
      seen.add(k); q.push({ c: nc, r: nr });
    }
    // ① 向上/平移（跳跃 + 冲刺）
    for (let dr = -UP; dr <= 0; dr++) for (let dc = -HORIZ; dc <= HORIZ; dc++) push(cur.c + dc, cur.r + dr);
    // ② 往下掉（落到任意更低的面，横向也在范围内）
    for (let dr = 1; dr < H; dr++) for (let dc = -HORIZ; dc <= HORIZ; dc++) push(cur.c + dc, cur.r + dr);
    // ③ 风柱：只要附近有风柱格，就能被弹上去 UP_FAN 格（并可横向移动）
    let nearFan = false;
    for (let dr = 0; dr <= 2 && !nearFan; dr++)
      for (let dc = -1; dc <= 1 && !nearFan; dc++)
        if (isFan(cur.c + dc, cur.r + dr) || isFan(cur.c + dc, cur.r - dr)) nearFan = true;
    if (nearFan) {
      for (let dr = -UP_FAN; dr <= 0; dr++) for (let dc = -HORIZ; dc <= HORIZ; dc++) push(cur.c + dc, cur.r + dr);
    }
    /* ④ ★ 墙跳 ★（2026-10-07 补：第 26 关"高层医院"靠竖井墙跳上楼）
     * ------------------------------------------------------------
     * 竖井 = 两侧是实心墙（'#'）、井内是空的窄缝。
     * 玩家贴墙跳可以**逐级上升**（单次墙跳净上升 ≈ 4.3 格，见 MEMORY）。
     * ⚠️ 不加这一条会把"墙跳上楼"误判成"够不到"——
     *    第 26 关的竖井就是这么被误报的。 */
    (function () {
      // 当前格左右 ±1 是否贴墙
      const wallL = SOLID_ONLY.indexOf(rows[cur.r][cur.c - 1] || ' ') >= 0;
      const wallR = SOLID_ONLY.indexOf(rows[cur.r][cur.c + 1] || ' ') >= 0;
      if (!wallL && !wallR) return;
      for (let dr = -WALL_UP; dr <= 0; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nc = cur.c + dc, nr = cur.r + dr;
          if (nc < 1 || nc >= W - 1 || nr < 1 || nr >= H - 1) continue;
          // 井内必须是空的（保证真的是"在井里往上蹬"，不是穿墙）
          if (SOLID_ONLY.indexOf(rows[nr][nc]) >= 0) continue;
          push(nc, nr);
        }
      }
    })();
  }

  // 统计订单
  const coins = [];
  rows.forEach(function (row, r) {
    for (let c = 0; c < row.length; c++) if (row[c] === 'o') coins.push({ c: c, r: r });
  });
  const ratio = (raw.coinRequireRatio != null) ? raw.coinRequireRatio : 0.8;
  const need = Math.ceil(coins.length * ratio);

  let ok = 0;
  const miss = [];
  coins.forEach(function (co) {
    /* 订单"可达"的判据：同一个可站立格能跳到它（就近取 3 格内） */
    let hit = false;
    for (let dr = 0; dr <= 1 && !hit; dr++)
      for (let dc = -1; dc <= 1 && !hit; dc++)
        if (seen.has((co.c + dc) + ',' + (co.r + dr))) hit = true;
    if (hit) ok++; else miss.push(co.c + ',' + co.r);
  });

  const pass = ok >= need;
  if (!pass) bad++;
  console.log('第' + id + '关 ' + String(raw.district || '').padEnd(10) +
    ' 订单 ' + String(ok).padStart(3) + '/' + String(coins.length).padStart(3) +
    '  门槛 ' + String(need).padStart(3) + '  ' + (pass ? '✅' : '❌ 差 ' + (need - ok)));
  if (miss.length) {
    console.log('     ❌ 够不到：' + miss.join('  '));
  }
}

console.log('');
console.log(bad === 0 ? '全部关卡都能到达门槛内的订单 ✅' : bad + ' 关有问题 ❌');
