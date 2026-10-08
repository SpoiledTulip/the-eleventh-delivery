/* ============================================================
 * thunder-test.js — ⚡ 雷击伤害判定专项（2026-10-07 建）
 * ============================================================
 * 【为什么必须有这个测试】
 *   十一报过："有时候玩家并没被雷击命中，却仍然扣血。"
 *   排查发现 `thunder.js` 的判定**只比横向、完全不判纵向** ——
 *   玩家飞到地图顶端（离落点 720px）照样被劈。
 *
 *   ⇒ 这个测试把"什么位置该被劈、什么位置不该被劈"**逐条钉死**，
 *     以后再有人动雷电判定，这 4 类缺陷会立刻被抓出来：
 *       ① 纵向判定（缺了就"天上也被劈"）
 *       ② 落点不追随玩家（追随了就"跑不掉"）
 *       ③ 伪随机生效（失效就"每次劈同一个地方"）
 *       ④ 视觉与判定坐标系一致（不一致就"看到的位置≠判定的位置"）
 *
 * ⚠️ 为什么用**离线沙箱**而不是真浏览器：
 *   "纯物理/纯逻辑"的校验放离线（见项目测试铁律）——
 *   放真浏览器会与 rAF 打架产生假失败。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'js');

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, ok, extra) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; problems.push(name + (extra ? '  → ' + extra : '')); console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

function noop() { }
const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Set, Map,
  window: { addEventListener: noop, requestAnimationFrame: function () { return 0; } },
  document: {
    getElementById: function () {
      return { getContext: function () { return new Proxy({}, { get: function () { return function () { return { addColorStop: function () { } }; }; } }); }, style: {} };
    }, addEventListener: noop
  },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: noop,
  localStorage: (function () { var s = {}; return { getItem: function (k) { return s[k] === undefined ? null : s[k]; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } }; })(),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ⚠️ 必须**严格照抄 index.html 的加载顺序** ——
 *   漏一个就会报 "xxx is not defined"，而且顺序错了会出怪问题。
 *   （我排查时第一次就漏了 thunder.js，差点误判成"模块没引入"。） */
const FILES = [
  'cloud-config.js', 'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'levels-ch4.js',
  'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js',
  'account.js', 'save.js', 'actions.js', 'tutorial.js', 'thunder.js',
  'scooter.js', 'receiver-talk.js', 'ch3-mechanics.js', 'ai-rider.js',
  'bg-theme.js', 'bg-draw.js', 'net.js', 'egg.js', 'render.js', 'game.js', 'ui.js',
];
FILES.forEach(function (f) {
  try {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
  } catch (e) {
    console.log('    (加载 ' + f + ' 失败：' + e.message + ')');
  }
});
const run = function (c) { return vm.runInContext(c, sandbox); };
const J = function (c) { return JSON.parse(vm.runInContext('JSON.stringify(' + c + ')', sandbox)); };

run('initGame("game")');
run('Save.data.unlockedActions = ["doublejump","wallslide","walljump","dash"]');

/* 找一关 thunder 天气的关卡 */
const THUNDER_LEVELS = [];
for (let i = 0; i < run('PLAYABLE_LEVELS().length'); i++) {
  if (run('PLAYABLE_LEVELS()[' + i + '].weather === "thunder"')) THUNDER_LEVELS.push(i);
}

console.log('============================================');
console.log('  ⚡ 雷击伤害判定专项');
console.log('============================================');
console.log('');

check('thunder.js 已加载', run('typeof THUNDER !== "undefined"'));
check('★ 至少有一关是 thunder 天气（否则测不到）', THUNDER_LEVELS.length > 0,
  'thunder 关卡索引: ' + JSON.stringify(THUNDER_LEVELS));

/* 取第一关 thunder 做基准 */
const LI = THUNDER_LEVELS[0];

/* ============================================================
 * ① 纵向判定 —— 这是"没被劈到却扣血"的**核心缺陷**
 * ============================================================
 * 判据：危险区 = 从地面往上 COL_H 的矩形。
 *   脚在危险区内 → 判中；脚出了危险区 → 不判中。 */
console.log('');
console.log('--- ① 纵向判定（高位不该被劈）---');

function strikeAt(pxOffset, py, levelIdx) {
  /* 跑一关，触发一次落雷，把玩家钉在指定位置，看是否扣血
   * ⚠️ levelIdx 必须能指定 —— 否则"遍历多关"时会被写死成第一关
   *    （这正是我第一次写这个测试时踩的坑）。 */
  const LI_USE = (levelIdx == null) ? LI : levelIdx;
  run('Game.mode="single";Game.playerCount=1;loadLevel(' + LI_USE + ')');
  run('THUNDER.reset(Game.level)');
  /* 推进到进入预警，拿落点 */
  for (let i = 0; i < 120; i++) {
    run('THUNDER.update(Game.level, function(){})');
    if (run('THUNDER.pendingTarget()')) break;
  }
  const tg = J('THUNDER.pendingTarget()');
  if (!tg) return null;
  const px = tg.x + (pxOffset || 0) - 13;      // 玩家宽 26
  const h0 = run('Game.players[0].hearts');
  let hit = false;
  for (let i = 0; i < 40; i++) {
    run('Game.players[0].x=' + px + ';Game.players[0].y=' + py + ';Game.players[0].invuln=0;');
    run('THUNDER.update(Game.level, damagePlayer)');
    if (run('Game.players[0].hearts') < h0) { hit = true; break; }
  }
  return hit;
}

run('Game.mode="single";Game.playerCount=1;loadLevel(' + LI + ')');
const GROUND_Y = (run('Game.level.rows') - 2) * 32;
const COL_H = run('THUNDER.columnHeight()');

console.log('    第' + (LI + 1) + '关 地面世界y=' + GROUND_Y + '  危险区高度=' + COL_H + 'px');

/* 站在地面上 → 必须被劈 */
check('★ 站在地面（危险区内）→ 被劈中',
  strikeAt(0, GROUND_Y - 32) === true);

/* 站得远高于危险区 → 绝不能被劈（原来的 bug 就在这里） */
check('★★ 在高空（危险区之上）→ **不被劈**',
  strikeAt(0, GROUND_Y - COL_H - 200) === false,
  'y=' + (GROUND_Y - COL_H - 200));

check('★★ 在地图最顶端 → **不被劈**',
  strikeAt(0, 20) === false);

/* 地面下方（掉坑）→ 不该被劈 */
check('★ 在地面下方（掉坑）→ 不被劈',
  strikeAt(0, GROUND_Y + 60) === false);

/* 横向躲开 → 不被劈 */
check('★ 横向躲开 200px → 不被劈',
  strikeAt(200, GROUND_Y - 32) === false);

/* ============================================================
 * ② 落点不追随玩家
 * ============================================================
 * 玩家站在完全不同的位置，落点应该**只由锚点池决定**，与玩家无关。 */
console.log('');
console.log('--- ② 落点不追随玩家（"跑到别处躲开"必须成立）---');

const spots = [300, 1200, 2500];
const landing = [];
spots.forEach(function (px) {
  run('Game.mode="single";Game.playerCount=1;loadLevel(' + LI + ')');
  run('THUNDER.reset(Game.level)');
  run('Game.players[0].x=' + px);
  for (let i = 0; i < 120; i++) {
    run('Game.players[0].x=' + px);      // 钉住玩家
    run('THUNDER.update(Game.level, function(){})');
    if (run('THUNDER.pendingTarget()')) break;
  }
  const tg = J('THUNDER.pendingTarget()');
  landing.push(tg ? +tg.x.toFixed(1) : null);
});
console.log('    玩家x=' + JSON.stringify(spots) + ' → 落点=' + JSON.stringify(landing));
/* ⚠️ 2026-10-07 断言修正
 * ------------------------------------------------------------
 * 【原来的意图】防的是老 bug：落点写死成"玩家位置 ± 260px"，
 *   于是**永远劈在玩家附近**，所谓"跑到别处躲开"是假的。
 *
 * 【为什么不能断言"落点恒等"】后来发现"落点遍布全关"会让
 *   玩家**根本看不见雷**（落点在 x=2380、玩家在 x=47，屏幕只有 1280 宽）。
 *   所以落点改成**从「玩家附近可见范围内的锚点」里挑** ——
 *   它会随玩家位置变化，但**不是追随玩家**（是离散锚点，且预警时定死）。
 *
 * 【现在要守的两件事】
 *   ① 落点必须落在**预先布置的锚点**上（离散、可预期、可学习），
 *      而不是"玩家坐标 ± 随机偏移"这种连续、追人的公式；
 *   ② 落点必须在**玩家附近的可见范围**内（否则看不见 = 之前的 bug）。 */
const anchors = J('THUNDER.anchorList ? THUNDER.anchorList() : []');
const allOnAnchors = landing.every(function (x) {
  return x !== null && anchors.some(function (a) { return Math.abs(a - x) < 0.5; });
});
console.log('    锚点池 = ' + JSON.stringify(anchors));
check('★★ 落点落在「预设锚点」上（不是"玩家坐标+随机偏移"）', allOnAnchors,
  '落点=' + JSON.stringify(landing) + ' 锚点=' + JSON.stringify(anchors));

/* 落点必须在玩家横向 ±900px 内（屏幕宽 1280，保证看得见） */
const allVisible = landing.every(function (x, i) {
  return x !== null && Math.abs(x - (spots[i] + 13)) <= 900;
});
check('★★ 落点在玩家附近的可见范围内（否则玩家看不见雷）', allVisible,
  '落点=' + JSON.stringify(landing) + ' 玩家=' + JSON.stringify(spots));

/* ============================================================
 * ③ ★ 落点跟随玩家移动（预判命中）
 * ============================================================
 * ⚠️ 2026-10-07 断言改写
 * ------------------------------------------------------------
 * 【原来测的是】"玩家不动，落点也应该到处变"（伪随机）。
 * 【为什么改】十一要求"落点按目标移动方向和速度预判" ⇒
 *   **玩家不动时落点本来就该稳定压在身上**（这才叫预判）。
 *   所以"玩家不动 ⇒ 落点 1 个"是**正确行为**，不是 bug。
 * 【现在测什么】
 *   ① 玩家静止 → 落点**贴身**（偏差 ≤ 34px，落在判定区内）；
 *   ② 玩家往右跑 → 落点**在玩家前方**（预判生效）；
 *   ③ 玩家往左跑 → 落点**在玩家后方**。
 */
console.log('');
console.log('--- ③ ★ 落点按"玩家移动"预判（2026-10-07 新需求）---');

function aimFor(vx) {
  run('Game.mode="single";Game.playerCount=1;loadLevel(' + LI + ')');
  run('THUNDER.reset(Game.level)');
  for (let i = 0; i < 200; i++) {
    run('Game.players[0].x=1400;Game.players[0].vx=' + vx + ';');
    run('THUNDER.update(Game.level, function(){})');
    if (run('THUNDER.pendingTarget()')) break;
  }
  const t = J('THUNDER.pendingTarget()');
  return t ? t.x : null;
}
const aimIdle = aimFor(0);
const aimRight = aimFor(5);
const aimLeft = aimFor(-5);
const PCENT = 1413;                       /* 玩家中心（x=1400 + 26/2） */
console.log('    玩家中心 x=' + PCENT);
console.log('    静止 → 落点 ' + aimIdle + '（偏差 ' + (aimIdle - PCENT) + '）');
console.log('    右跑 → 落点 ' + aimRight + '（偏差 ' + (aimRight - PCENT) + '）');
console.log('    左跑 → 落点 ' + aimLeft + '（偏差 ' + (aimLeft - PCENT) + '）');

check('★★ 玩家静止时落点贴身（|偏差| ≤ 34，即落在判定区内）',
  aimIdle !== null && Math.abs(aimIdle - PCENT) <= 34,
  '偏差=' + (aimIdle - PCENT));

check('★★ 玩家往右跑 → 落点落在玩家**前方**（预判生效）',
  aimRight !== null && aimRight > PCENT,
  '落点=' + aimRight + ' 玩家中心=' + PCENT);

check('★★ 玩家往左跑 → 落点落在玩家**后方**（预判生效）',
  aimLeft !== null && aimLeft < PCENT,
  '落点=' + aimLeft + ' 玩家中心=' + PCENT);

check('★★ 落点会随移动方向变化（不是固定一处）',
  aimRight !== aimLeft, '右=' + aimRight + ' 左=' + aimLeft);

/* ============================================================
 * ④ 落雷标记带 groundY（绘制用它对齐，缺陷 ④ 的数据基础）
 * ============================================================ */
console.log('');
console.log('--- ④ 落雷标记带世界坐标的地面高度 ---');
run('Game.mode="single";Game.playerCount=1;loadLevel(' + LI + ')');
run('THUNDER.reset(Game.level)');
let mark = null;
for (let f = 0; f < 300; f++) {
  run('THUNDER.update(Game.level, function(){})');
  const st = J('THUNDER.strikes()');
  if (st.length) { mark = st[0]; break; }
}
check('★ 落雷标记记录了 groundY（render.js 靠它做世界坐标换算）',
  !!mark && typeof mark.groundY === 'number' && mark.groundY > 0,
  JSON.stringify(mark));

/* ============================================================
 * ⑤ 多关覆盖：所有 thunder 关都不能"天上被劈"
 * ============================================================ */
console.log('');
console.log('--- ⑤ 所有 thunder 关都通过"高位不被劈" ---');
THUNDER_LEVELS.forEach(function (li) {
  run('Game.mode="single";Game.playerCount=1;loadLevel(' + li + ')');
  const gy = (run('Game.level.rows') - 2) * 32;
  const ch = run('THUNDER.columnHeight()');
  /* ⚠️ 把 li 传进去（否则 strikeAt 内部会回到第一关 thunder 关） */
  const highY = Math.max(20, gy - ch - 200);
  const hitHigh = strikeAt(0, highY, li);
  console.log('    第' + (li + 1) + '关 地面y=' + gy + ' 测试位y=' + highY);
  check('★ 第' + (li + 1) + '关：高位不被劈', hitHigh === false);
});

/* ============================================================
 * ⑥ ★★★ 雷必须"看得见"（2026-10-07 十一报"雷都消失了"）★★★
 * ============================================================
 * 【为什么必须测这条】
 *   我上一轮把雷柱的纵向位置改成"世界坐标换算"，但读的 `cam` 是
 *   `drawScene` 的**局部变量**、在 drawThunder 里读不到 ⇒ 恒为 0
 *   ⇒ 雷柱被画到 y=768（画布只有 720）⇒ **玩家完全看不见雷**。
 *
 *   ⇒ 这条断言直接**记录 drawThunder 实际画出的坐标**，
 *     要求它们落在画布范围内。以后谁再改坐标，这条会立刻抓住。 */
console.log('');
console.log('--- ⑥ 雷柱画在可见范围内（不能画到画面外）---');

/* 造一个假 ctx，记录所有绘制坐标 */
const drawn = [];
const fakeCtx = new Proxy({}, {
  get: function (o, k) {
    if (k === 'canvas') return { width: 1280, height: 720 };
    if (k === 'createRadialGradient' || k === 'createLinearGradient') {
      return function () { return { addColorStop: function () { } }; };
    }
    if (k === 'measureText') return function () { return { width: 10 }; };
    return function () {
      const args = Array.prototype.slice.call(arguments).filter(function (x) { return typeof x === 'number'; });
      if (args.length >= 2) drawn.push({ m: k, y: args[1], x: args[0] });
    };
  },
});
sandbox.__CTX__ = fakeCtx;

THUNDER_LEVELS.forEach(function (li) {
  run('Game.mode="single";Game.playerCount=1;loadLevel(' + li + ')');
  /* 跑真实渲染循环（update + updateCamera），让相机到位 */
  for (let f = 0; f < 180; f++) {
    run('Game.players[0].x=400;update(1/60);updateCamera(1/60);');
  }
  /* 触发一次落雷 */
  run('THUNDER.reset(Game.level)');
  for (let i = 0; i < 200; i++) {
    run('THUNDER.update(Game.level, function(){})');
    if (run('THUNDER.strikes().length > 0')) break;
  }
  drawn.length = 0;
  run('drawThunder(__CTX__, 1.0)');
  /* 只看"雷柱"的 moveTo/lineTo（预警圈是椭圆，另外算） */
  const ys = drawn.filter(function (d) { return d.m === 'moveTo' || d.m === 'lineTo'; })
    .map(function (d) { return d.y; });
  const H = run('CANVAS_H');
  const minY = ys.length ? Math.min.apply(null, ys) : null;
  const maxY = ys.length ? Math.max.apply(null, ys) : null;
  console.log('    第' + (li + 1) + '关 雷柱 y 范围: ' + minY + ' ~ ' + maxY +
    '（画布高 ' + H + '，camY=' + run('Game.camera.y').toFixed(0) + '）');
  check('★ 第' + (li + 1) + '关：雷柱画在画面内（0 ≤ y ≤ ' + H + '）',
    ys.length > 0 && minY >= 0 && maxY <= H, 'y=' + minY + '~' + maxY);
});

/* 兜底：相机未初始化时也不能消失 */
run('Game.mode="single";Game.playerCount=1;loadLevel(' + LI + ')');
run('Game.camera.y=0');
run('THUNDER.reset(Game.level)');
for (let i = 0; i < 200; i++) {
  run('THUNDER.update(Game.level, function(){})');
  if (run('THUNDER.strikes().length > 0')) break;
}
drawn.length = 0;
run('drawThunder(__CTX__, 1.0)');
const ys0 = drawn.filter(function (d) { return d.m === 'moveTo' || d.m === 'lineTo'; }).map(function (d) { return d.y; });
const H0 = run('CANVAS_H');
check('★★ 兜底：相机未初始化（camY=0）时雷仍可见',
  ys0.length > 0 && Math.min.apply(null, ys0) >= 0 && Math.max.apply(null, ys0) <= H0,
  'y=' + (ys0.length ? Math.min.apply(null, ys0) + '~' + Math.max.apply(null, ys0) : 'none'));

/* 预警圈必须画出来（"可预判位置"） */
run('THUNDER.reset(Game.level)');
for (let i = 0; i < 80; i++) {
  run('THUNDER.update(Game.level, function(){})');
  if (run('THUNDER.pendingTarget()')) break;
}
drawn.length = 0;
run('drawThunder(__CTX__, 1.0)');
const ells = drawn.filter(function (d) { return d.m === 'ellipse'; });
console.log('    预警圈椭圆数 = ' + ells.length);
check('★★ 预警圈画出来了（玩家能预判落点）', ells.length >= 2, 'ellipse=' + ells.length);

/* 预警圈的横向位置必须和落点一致 */
const tgPos = J('THUNDER.pendingTarget()');
const ellX = ells.length ? ells[0].x : null;
const camPos = run('Game.camera.x');
check('★★ 预警圈画在"落点"所在的列（横向对齐）',
  tgPos && ellX != null && Math.abs(ellX - (tgPos.x - camPos)) < 2,
  'ellipse.x=' + ellX + ' 落点屏幕x=' + (tgPos ? (tgPos.x - camPos) : 'n/a'));

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('');
console.log('============================================================');
console.log('  雷击判定专项: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) {
  console.log('  失败项:');
  problems.forEach(function (p) { console.log('    - ' + p); });
}
console.log('============================================================');
process.exit(FAIL === 0 ? 0 : 1);
