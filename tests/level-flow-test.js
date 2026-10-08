/* ============================================================
 * level-flow-test.js — 关卡起始与衔接逻辑
 * ============================================================
 * 为什么单独写这个测试：
 *   2026-10-06 十一报了这个问题 ——
 *     "点开始跑单会直接进第五关，第五关结束后又跳回第一关"
 *
 *   根因是"该玩哪一关"这个概念在**四个地方各算了一遍**，
 *   而且其中两处算法是错的：
 *     · ui.js 开始跑单   用 maxUnlocked-1 → 全通关后恒落在最后一关
 *     · game.js 空格键   直接 +1 且 loadLevel 越界静默回绕 → 死循环
 *
 *   这类 bug 的特点是**不报错、不崩溃**，只是行为诡异，
 *   很容易在改动中被重新引入。所以固化成测试守住。
 *
 * 覆盖：
 *   A. loadLevel 的边界行为（不许静默回绕到第 1 关）
 *   B. nextLevelIndex：最后一关必须返回 null
 *   C. resumeLevelIndex：「开始跑单」的三条起始规则
 *   D. 从第 1 关连续推进 → 走完全部关卡后停下（无回绕）
 *   E. 「选择路线」任意关卡直达
 *   F. 存档异常时的兜底（不许崩、不许越界）
 *
 * 用法：node tests/level-flow-test.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else {
    FAIL++;
    problems.push(name + (detail ? ' → ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? '  → ' + detail : ''));
  }
}

/* ---- 沙箱（和 single-player-test.js 同一套桩）---- */
function makeSandbox(seed) {
  const store = Object.assign({}, seed || {});
  const sandbox = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON,
    String, Number, Boolean, Error, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout,
    performance: { now: function () { return Date.now(); } },
    localStorage: {
      getItem: function (k) { return store[k] === undefined ? null : store[k]; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
    },
    navigator: { userAgent: '', maxTouchPoints: 0 },
    window: {
      innerWidth: 1280, innerHeight: 720,
      addEventListener: function () {},
      PointerEvent: function () {},
    },
  };
  sandbox.window.document = { addEventListener: function () {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js',
   'characters.js', 'device-mode.js', 'save.js',
   'actions.js', 'tutorial.js', 'net.js', 'render.js', 'game.js'
  ].forEach(function (f) {
    vm.runInContext(
      fs.readFileSync(path.join(SRC, 'js', f), 'utf8'),
      sandbox, { filename: f }
    );
  });
  return sandbox;
}

const G = function (sb, expr) { return vm.runInContext(expr, sb); };

/* 三个函数必须都存在（这是本测试的前提） */
console.log('=========================================');
console.log('  关卡起始与衔接逻辑');
console.log('=========================================');

const sb = makeSandbox();
const N = G(sb, 'levelCount()');
console.log('\n关卡总数 = ' + N);
check('关卡总数 > 0', N > 0, 'N=' + N);

/* 三个单一真相源函数必须存在 */
['clampLevelIndex', 'nextLevelIndex', 'resumeLevelIndex', 'levelCount'].forEach(function (fn) {
  check('存在 ' + fn + '()（关卡索引单一真相源）',
    G(sb, 'typeof ' + fn) === 'function');
});

/* ============================================================
 * A. loadLevel 的边界行为
 * ============================================================ */
console.log('\n=== A. loadLevel 边界（不许静默回绕到第 1 关）===');

for (let i = 0; i < N; i++) {
  const r = G(sb, '(function(){loadLevel(' + i + ');return Game.levelIndex;})()');
  check('loadLevel(' + i + ') → index=' + i, r === i, '实际 ' + r);
}

/* ⚠️ 核心断言：越界不许回绕到 0 */
const over = [];
for (let i = N; i <= N + 3; i++) {
  over.push({ i: i, idx: G(sb, '(function(){loadLevel(' + i + ');return Game.levelIndex;})()') });
}
over.forEach(function (o) {
  check('★ loadLevel(' + o.i + ') 越界不回到第 1 关（夹到最后一关）',
    o.idx === N - 1,
    '实际 index=' + o.idx + '（若为 0 就是"静默回绕"的老 bug）');
});

/* 负数 / null / 非数字 → 第 1 关 */
[[-1, 0], [null, 0], ['abc', 0]].forEach(function (pair) {
  const lit = (pair[0] === null) ? 'null' : (typeof pair[0] === 'string' ? '"' + pair[0] + '"' : pair[0]);
  const r = G(sb, '(function(){loadLevel(' + lit + ');return Game.levelIndex;})()');
  check('loadLevel(' + lit + ') 兜底到第 1 关', r === 0, '实际 ' + r);
});

/* ============================================================
 * B. nextLevelIndex
 * ============================================================ */
console.log('\n=== B. nextLevelIndex（最后一关返回 null）===');

for (let i = 0; i < N - 1; i++) {
  const r = G(sb, 'nextLevelIndex(' + i + ')');
  check('nextLevelIndex(' + i + ') = ' + (i + 1), r === i + 1, '实际 ' + r);
}
const lastNext = G(sb, 'nextLevelIndex(' + (N - 1) + ')');
check('★ nextLevelIndex(最后一关) = null（不是 0，也不是最后一关）',
  lastNext === null, '实际 ' + JSON.stringify(lastNext));

/* ============================================================
 * C. resumeLevelIndex 三条起始规则
 * ============================================================ */
console.log('\n=== C. 「开始跑单」起始规则 ===');

/* C1. 新玩家 → 第 1 关 */
{
  const s = makeSandbox();
  const idx = G(s, 'resumeLevelIndex()');
  check('★ 规则①：新玩家（无进度）→ 第 1 关', idx === 0, '实际 ' + idx);
}

/* C2. 有进度没通关 → 接着下一关 */
{
  const s = makeSandbox();
  for (let i = 0; i < N - 1; i++) {
    G(s, 'Save.recordClear(' + i + ', 30, 10, 10, "kangaroo")');
    const idx = G(s, 'resumeLevelIndex()');
    check('★ 规则②：通关第 ' + (i + 1) + ' 关后 → 第 ' + (i + 2) + ' 关',
      idx === i + 1,
      '实际 index=' + idx + '（期望 ' + (i + 1) + '）');
  }
}

/* C3. 全部通关 → 回第 1 关（关键回归点） */
{
  const s = makeSandbox();
  for (let i = 0; i < N; i++) {
    G(s, 'Save.recordClear(' + i + ', 30, 10, 10, "kangaroo")');
  }
  const idx = G(s, 'resumeLevelIndex()');
  check('★ 规则③：全部通关后 → 回第 1 关（不是永远停在最后一关）',
    idx === 0,
    '实际 index=' + idx + '（若为 ' + (N - 1) + ' 就是本次修的 bug）');
}

/* ============================================================
 * D. 连续推进：不许回绕
 * ============================================================ */
console.log('\n=== D. 从第 1 关连续推进（走完就停）===');

{
  const s = makeSandbox();
  const seq = G(s, `(function(){
    Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(0);
    var out=[Game.levelIndex];
    for (var k=0;k<20;k++){
      var nx=nextLevelIndex(Game.levelIndex);
      if (nx==null) break;
      loadLevel(nx);
      out.push(Game.levelIndex);
    }
    return out;
  })()`);
  const expect = [];
  for (let i = 0; i < N; i++) expect.push(i);
  check('★ 推进序列 = [0..' + (N - 1) + '] 然后停下（没有回绕到 0）',
    JSON.stringify(seq) === JSON.stringify(expect),
    '实际 ' + JSON.stringify(seq));
  check('★ 推进次数恰好等于关卡数（不是无限循环）',
    seq.length === N, '实际 ' + seq.length + ' 步');
}

/* 模拟"最后一关通关后按空格"的完整路径 */
{
  const s = makeSandbox();
  /* ⚠️ showGameNotice 定义在 ui.js，本测试不加载 ui.js（它需要 DOM）。
   *    这里用一个同名桩替代，语义一致：只是"给玩家一句提示"。
   *    这样测的是**逻辑分支**（越界时不推进 + 有提示），不依赖 UI 实现。 */
  const r = G(s, `(function(){
    var noticed = null;
    function showGameNotice(t){ noticed = t; }   // 桩：替代 ui.js 的实现
    /* 完整复刻 update() 里 CLEAR 状态的空格分支 */
    Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(${N - 1});
    Game.state='clear';
    var before = Game.levelIndex;
    var next = nextLevelIndex(Game.levelIndex);
    if (next == null) { showGameNotice('全部路线已跑完 —— 可以重跑这一单，或回首页换条路线'); }
    else { loadLevel(next); }
    return { before: before, after: Game.levelIndex, noticed: noticed };
  })()`);
  check('★ 最后一关通关后按空格：留在原地，不跳回第 1 关',
    r.after === r.before,
    JSON.stringify(r));
  check('★ 并且给出了提示文案（不是静默无反应）',
    typeof r.noticed === 'string' && r.noticed.length > 0,
    JSON.stringify(r.noticed));
}

/* ============================================================
 * E. 「选择路线」任意关卡直达
 * ============================================================ */
console.log('\n=== E. 「选择路线」任意关卡直达 ===');

for (let i = 0; i < N; i++) {
  const s = makeSandbox();
  const r = G(s, '(function(){Game.mode="single";Game.playerCount=1;' +
    'Game.pickRole="kangaroo";loadLevel(' + i + ');' +
    'return {idx:Game.levelIndex,name:Game.level.name};})()');
  check('选第 ' + (i + 1) + ' 关 → 直达（' + r.name + '）', r.idx === i,
    '实际 ' + r.idx);
}

/* ============================================================
 * F. 存档异常兜底
 * ============================================================ */
console.log('\n=== F. 存档异常兜底（不许崩、不许越界）===');

{
  /* 关号远超实际范围（手改存档 / 以后删了关卡） */
  const s = makeSandbox();
  const r = G(s, `(function(){
    try {
      Save.data = { version:2, maxUnlocked:999, levels:{"999":{cleared:true}} };
      return { idx: resumeLevelIndex(), n: levelCount() };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('★ 存档关号越界（999）时不崩且夹在合法范围',
    !r.err && r.idx >= 0 && r.idx <= N - 1,
    JSON.stringify(r));
}

{
  /* levels 字段整个坏掉 */
  const s = makeSandbox();
  const r = G(s, `(function(){
    try {
      Save.data = { version:2, maxUnlocked:3, levels:null };
      return { idx: resumeLevelIndex() };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('levels 为 null 时 resumeLevelIndex 不崩',
    !r.err && typeof r.idx === 'number' && r.idx >= 0,
    JSON.stringify(r));
}

{
  /* 全部通关但 maxUnlocked 与实际成绩不一致（数据不同步） */
  const s = makeSandbox();
  const r = G(s, `(function(){
    try {
      /* levels 说全通关了，但 maxUnlocked 只有 1（模拟数据错位） */
      Save.data = {
        version:2, maxUnlocked:1, levels:{},
        selectedCharacter:'kangaroo', unlockedCharacters:['kangaroo','dragon'],
        characterRecords:{}, seenUnlockAnimations:[], settings:{},
      };
      ${JSON.stringify(null)};
      for (var i=0;i<${N};i++) Save.data.levels[String(i+1)] = { cleared:true, bestTime:10, bestStars:1, bestCoins:1 };
      return { idx: resumeLevelIndex() };
    } catch (e) { return { err: String(e) }; }
  })()`);
  check('★ 以实际成绩为准（levels 全通关 → 回第 1 关），不看 maxUnlocked',
    !r.err && r.idx === 0,
    JSON.stringify(r));
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n============================================================');
console.log('  关卡起始/衔接验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) {
  console.log('  失败项:');
  problems.forEach(function (p) { console.log('    - ' + p); });
}
console.log('============================================================');
process.exit(FAIL > 0 ? 1 : 0);
