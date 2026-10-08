/* ============================================================
 * 教学引导 + 按键说明页 测试
 * ============================================================
 * 分两部分：
 *   A. 教学提示逻辑（纯 Node，不需要浏览器）
 *      - 该触发时触发、不该触发时不触发
 *      - 只提示一次（except 确认型）
 *      - 优先级：同一帧多条满足只出最高优先级的
 *      - 不抢场景提示（比如"桥在塌"）
 *   B. 说明页结构（真浏览器，因为它是 DOM）
 *      - 主菜单有入口
 *      - 点开后能渲染出各节内容
 *      - 返回能回主菜单
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
const problems = [];
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; problems.push(name); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

/* ---------- 搭沙箱（和 celeste-test.js 一致） ---------- */
function noop() {}
const ctxStub = new Proxy({}, { get: function () { return noop; }, set: function () { return true; } });
const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
  window: {
    addEventListener: noop,
    requestAnimationFrame: function () { return 0; },
    Image: function () { this.width = 0; this.height = 0; this.src = ''; },
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
    getElementById: function () {
      return { getContext: function () { return ctxStub; }, width: 0, height: 0, style: {} };
    },
    addEventListener: noop,
    createElement: function () {
      return {
        style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } },
        setAttribute: noop, appendChild: noop, addEventListener: noop, querySelectorAll: function () { return []; },
      };
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
  navigator: { maxTouchPoints: 0 },
  localStorage: (function () {
    const m = {};
    return {
      getItem: function (k) { return m[k] === undefined ? null : m[k]; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
    };
  })(),
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* 加载顺序要和 index.html 完全一致
 * （save.js 在 actions.js 之前 —— 后者要调 isActionUnlocked） */
const FILES = [
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js',
  'actions.js', 'tutorial.js', 'net.js', 'render.js', 'game.js', 'ui.js',
];
FILES.forEach(function (f) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
  } catch (e) {
    console.log('  加载 ' + f + ' 失败: ' + e.message);
  }
});

/* ★ 解锁全部动作 ★
 * 游戏默认"动作逐步解锁"（新档全锁）。这些测试测的是动作本身，
 * 不是解锁流程，所以先把动作全开 —— 否则会测出一堆假失败。
 * 解锁流程由 unlock-test.js 单独验证。 */
try {
  vm.runInContext('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;', sandbox);
} catch (e) { console.log('解锁动作失败: ' + e.message); }

const G = function (expr) { return vm.runInContext(expr, sandbox); };
const run = function (code) { return vm.runInContext(code, sandbox); };

console.log('教学引导 + 说明页 测试');
console.log('='.repeat(58));

/* ============================================================
 * A. 模块与结构
 * ============================================================ */
console.log('\n=== A. 模块加载 ===');
check('tutorial.js 已加载', G('typeof TUTORIAL') === 'object');
check('TUTORIAL 接口完整',
  G('typeof TUTORIAL.init') === 'function' && G('typeof TUTORIAL.update') === 'function');
const hintCount = G('TUTORIAL.hints.length');
console.log('   教学提示条数: ' + hintCount);
check('提示表非空', hintCount >= 5, hintCount + ' 条');
check('STATE.HELP 已定义', G('STATE.HELP') === 'help', G('STATE.HELP'));
check('buildHelp 函数存在', G('typeof buildHelp') === 'function');
check('八方向示意图绘制函数存在', G('typeof paintDir8Diagram') === 'function');
check('动作图标绘制函数存在', G('typeof paintActionIcon') === 'function');

/* ============================================================
 * B. 初始化
 * ============================================================ */
console.log('\n=== B. 教学初始化 ===');
run('Game.mode="local"; Game.playerCount=1; Game.pickRole="kangaroo"; loadLevel(0); Game.state="playing";');
check('loadLevel 后 Game.tutorial 已建立', G('!!Game.tutorial'));
check('seen 记录为空', G('Object.keys(Game.tutorial.seen).length') === 0);
check('dashUsedCount 从 0 开始', G('Game.tutorial.dashUsedCount') === 0);

/* ============================================================
 * C. 触发条件：该触发的
 * ============================================================ */
console.log('\n=== C. 触发条件（正向）===');

/* 统一的"跑一帧"辅助 */
function frame() { run('updateTutorial(1/60);'); }

/* ------------------------------------------------------------
 * ★ 每条用例前必须**完整重置玩家状态** ★
 * ------------------------------------------------------------
 * 踩过的坑：一开始只设了"这个用例关心"的字段，
 * 结果上一条用例残留的 `actDashes = 0` 让 dash_empty（优先级 45）
 * 抢走了 doublejump（优先级 10）—— 看着像逻辑 bug，实际是测试污染。
 *
 * 所以：先 clearHints() 把玩家恢复成"站在地上的正常状态"，
 * 再按用例需要覆盖个别字段。
 * ------------------------------------------------------------ */
function clearHints(extra) {
  run(`(function(){
    Game.tutorial.seen = {};
    Game.tutorial.lastSeenAt = {};
    Game.tutorial.lastMsgId = null;
    Game.tutorial.dashUsedCount = 0;
    /* ★ 2026-10-06 新增：跳跃计数也要清 ★
     * 新加的 single_jump_hint（"一次跳跃就够过缺口"）读这个字段。
     * 不清的话，同一测试里前面的用例跳过一次，这里就会
     * 被 single_jump_hint（优先级 12）抢走，兜底提示永远测不到。 */
    Game.tutorial.jumpUsedCount = 0;
    Game.tutorial._owned = false;
    Game.message = '';
    Game.messageTimer = 0;
    Game.elapsed = 1;                 // 默认别触发"25 秒兜底"
    Game.levelIndex = 0;
    Game.state = 'playing';
    var p = Game.players[0];
    /* 一个"干净的正常状态"：站在地上、满冲刺、没贴墙 */
    p.onGround = true;
    p.vy = 0;
    p.jumpsLeft = 2;
    p._tutWasGround = true;           // ← 同步跳跃检测状态，避免误计数
    p.actWallDir = 0;
    p.actGrabHeld = false;
    p.actWallSlide = false;
    p.actWallJumpLock = 0;
    p.actDashT = 0;
    p.actDashCool = 0;
    p.actDashes = CELESTE.dashMaxCount;
    p.actGrabStamina = CELESTE.grabStaminaFrames;
    p._tutDashCounted = false;
    /* ★★ 2026-10-06 新增：把玩家挪到"附近没有小怪"的位置 ★★
     * ------------------------------------------------------------
     * 【为什么】十一要求"第 1 关出生点附近加个小怪"，于是
     *   col9 多了一只巡逻怪。而本测试的玩家默认停在**出生点 col4**，
     *   两者相距 147px —— 正好落在 tut_stomp 的触发窗口
     *   （"怪在前方 90~260px"）里，于是**每条用例都被踩怪提示抢走**
     *   （教学测试一次性挂了 9 条）。
     *
     * 【修法】把玩家挪到** col60 的地面上**（x=1920, y=704）。
     *   第 1 关的小怪在 col9 / col28 / col44 / col72 ——
     *   离 col60 最近的是 col72（相距 12 格 ≈ 384px），
     *   **远在 260px 窗口之外**，tut_stomp 不会触发。
     *
     * ⚠️⚠️ 位置必须满足两个条件（踩过两次坑）：
     *   ① **要站在地面上** —— y = 23*32 - 32 = 704。
     *      第一版随手写了 y=640（离地 2 格），玩家悬空，
     *      反而触发 tut_jump，又挂 3 条。
     *   ② **p.spawnX 要跟着一起改**！
     *      tut_jump 的条件是 (p.x - p.spawnX) > 96（"往前走了一段"）。
     *      只挪 p.x、不改 spawnX，就等于宣称"玩家已经往前跑了 1792px"，
     *      于是 tut_jump（优先级 68）把别的提示全抢走了。
     *      ⇒ 两个一起设成同一个值，表示"刚站定、还没移动"。
     *
     * ⚠️ 教训 2：测试不该依赖"地图上恰好没有怪"这种巧合。
     *    凡是跟"附近有什么东西"相关的提示，
     *    测其他提示时都要先把"干扰物"移开。
     * ------------------------------------------------------------ */
    p.x = 1920; p.y = 704;
    p.spawnX = 1920;
  })()`);
  if (extra) run(extra);
}

/* ============================================================
 * C. 触发条件：该触发的
 * ============================================================ */

/* C-1 二连跳提示：在空中、上升时
 *
 * ⚠️ 2026-10-06 更新：这条提示现在有**两道门槛**（十一的要求）：
 *    ① 必须已解锁 doublejump
 *    ② **不在第 1 关出现**（第 1 关由 tut_move/tut_jump/tut_gap 负责）
 *    所以这里要解锁动作 + 把关卡设成第 2 关，测的才是"该触发"的场景。
 *
 *    另：还要把第 1 关那三条基础教学标记成已看过 ——
 *    它们的优先级（66~70）比二连跳（10）高，否则会把提示抢走。 */
clearHints(`(function(){
  Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];
  Game.levelIndex = 1;                 // 第 2 关（不在第 1 关）
  Game.tutorial.seen.tut_move = true;
  Game.tutorial.seen.tut_jump = true;
  Game.tutorial.seen.tut_gap = true;
  var p = Game.players[0];
  p.onGround = false; p.vy = -5; p.jumpsLeft = 1;
})()`);
frame();
check('空中上升时提示二连跳',
  G('Game.tutorial.seen.doublejump') === true,
  'msg=' + JSON.stringify(G('Game.message')));

/* C-1b ★ 第 1 关绝不许出现二连跳提示（十一明确要求）★ */
clearHints(`(function(){
  Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];  // 就算解锁了
  Game.levelIndex = 0;                 // 但这是**第 1 关**
  var p = Game.players[0];
  p.onGround = false; p.vy = -5; p.jumpsLeft = 1;
})()`);
frame();
check('★ 第 1 关不提示二连跳（即使动作已解锁）',
  G('Game.tutorial.seen.doublejump') !== true,
  'seen=' + G('JSON.stringify(Object.keys(Game.tutorial.seen))'));

/* C-1c ★ 没解锁时绝不提示二连跳 ★ */
clearHints(`(function(){
  Save.data.unlockedActions = [];      // 一个新档
  Game.levelIndex = 1;
  var p = Game.players[0];
  p.onGround = false; p.vy = -5; p.jumpsLeft = 1;
})()`);
frame();
check('★ 未解锁二连跳时绝不提示它',
  G('Game.tutorial.seen.doublejump') !== true,
  'seen=' + G('JSON.stringify(Object.keys(Game.tutorial.seen))'));

/* C-2 贴墙滑行提示 */
clearHints(`(function(){
  var p = Game.players[0];
  p.actWallDir = 1; p.actGrabHeld = false; p.onGround = false;
})()`);
frame();
check('贴墙（被动滑行）时提示滑墙',
  G('Game.tutorial.seen.wallslide') === true,
  'msg=' + JSON.stringify(G('Game.message')));

/* C-3 抓墙体力提示 */
clearHints(`(function(){
  var p = Game.players[0];
  p.actWallDir = 1; p.actGrabHeld = true;
  p.actGrabStamina = CELESTE.grabStaminaFrames * 0.5;   // 掉到 50%
})()`);
frame();
check('抓墙体力低于 70% 时提示体力机制',
  G('Game.tutorial.seen.wallgrab') === true,
  'msg=' + JSON.stringify(G('Game.message')));

/* C-4 墙跳引导提示 */
clearHints(`(function(){
  var p = Game.players[0];
  p.actWallDir = 1; p.actWallJumpLock = 0; p.vy = 2; p.actGrabHeld = false;
})()`);
frame();
check('贴墙未蹬时提示墙跳操作',
  G('Game.tutorial.seen.walljump_tip') === true,
  'msg=' + JSON.stringify(G('Game.message')));

/* C-5 冲刺成功确认 */
clearHints(`(function(){
  var p = Game.players[0];
  p.onGround = false; p.actDashT = 5;
})()`);
frame();
check('冲刺中提示"冲刺！"',
  G('Game.tutorial.seen.dash_done') === true,
  'msg=' + JSON.stringify(G('Game.message')));

/* C-6 冲刺次数用光 */
clearHints(`(function(){
  var p = Game.players[0];
  p.onGround = false; p.actDashes = 0;
})()`);
frame();
check('冲刺用光且在空中时提示落地恢复',
  G('Game.tutorial.seen.dash_empty') === true,
  'msg=' + JSON.stringify(G('Game.message')));

/* ============================================================
 * D. 触发条件：不该触发的
 * ============================================================ */
console.log('\n=== D. 不该触发的场景 ===');

/* D-1 站在地上不该提示二连跳 */
clearHints();
frame();
check('站在地上不提示任何动作', G('Object.keys(Game.tutorial.seen).length') === 0,
  '触发了: ' + G('Object.keys(Game.tutorial.seen).join(",")'));

/* D-2 冲刺提示只在第5关出现（关卡过滤） */
clearHints(`(function(){
  Game.levelIndex = 0;                 // 第 1 关
  Game.elapsed = 10;
  var p = Game.players[0];
  p.onGround = false; p.jumpsLeft = 0; p.vy = 0;
})()`);
frame();
check('第1关不弹"冲刺教学"（那是第5关的）',
  G('Game.tutorial.seen.dash_tip') !== true,
  'seen=' + G('JSON.stringify(Object.keys(Game.tutorial.seen))'));

/* D-3 只提示一次 */
clearHints(`(function(){
  var p = Game.players[0];
  p.actWallDir = 1; p.actGrabHeld = false; p.onGround = false;
})()`);
frame();
const firstSeen = G('Game.tutorial.seen.wallslide');
frame(); frame();
check('同一提示不会重复触发', firstSeen === true &&
  G('Game.tutorial.seen.wallslide') === true);

/* ============================================================
 * E. 优先级：同帧多条满足只出最高的
 * ============================================================ */
console.log('\n=== E. 优先级 ===');
clearHints(`(function(){
  var p = Game.players[0];
  /* 同时满足：贴墙（20分） + 墙跳引导（25分） → 应该出墙跳引导 */
  p.onGround = false;
  p.actWallDir = 1; p.actGrabHeld = false; p.vy = 2; p.actWallJumpLock = 0;
})()`);
frame();
check('同帧多条时只出一条（最高优先级的墙跳引导）',
  G('Game.tutorial.seen.walljump_tip') === true &&
  G('Game.tutorial.seen.wallslide') !== true,
  'seen=' + G('JSON.stringify(Object.keys(Game.tutorial.seen))'));

/* ============================================================
 * F. 不抢场景提示
 * ============================================================ */
console.log('\n=== F. 不抢场景提示 ===');
clearHints(`(function(){
  Game.message = '桥在塌！快跑！';
  Game.messageTimer = 60;
  var p = Game.players[0];
  p.onGround = false;
  p.actWallDir = 1; p.actGrabHeld = false;
})()`);
frame();
check('场景提示（桥在塌）不被教学提示覆盖',
  G('Game.message') === '桥在塌！快跑！',
  '实际=' + JSON.stringify(G('Game.message')));

/* ============================================================
 * G. 兜底：完全没试过冲刺
 * ============================================================ */
console.log('\n=== G. 兜底提示 ===');
clearHints(`(function(){
  Game.elapsed = 30;                    // 超过 25 秒
  Game.tutorial.dashUsedCount = 0;
  /* ★ 2026-10-06：把更高优先级的开场/单跳提示标记为"已看过" ★
   * 这一条测的是"完全没冲刺过"的兜底提示（优先级 5），
   * 而 tut_move（70）和 single_jump_hint（12）优先级都比它高，
   * 会在同一帧把它们抢走。所以这里显式跳过那两条。 */
  Game.tutorial.seen.tut_move = true;
  Game.tutorial.seen.tut_jump = true;
  Game.tutorial.seen.tut_gap = true;
  Game.tutorial.seen.single_jump_hint = true;
})()`);
frame();
check('玩了 25 秒还没冲刺过 → 兜底提示',
  G('Game.tutorial.seen.dash_unused') === true,
  'seen=' + G('JSON.stringify(Object.keys(Game.tutorial.seen))'));

/* ============================================================
 * H. 健壮性
 * ============================================================ */
console.log('\n=== H. 健壮性 ===');
check('Game.tutorial 被清空后不崩',
  (function () {
    try {
      run('Game.tutorial = null; updateTutorial(1/60);');
      return G('!!Game.tutorial') === true;   // 会自动补建
    } catch (e) { return false; }
  })());

check('非 playing 状态不提示',
  (function () {
    clearHints(`(function(){
      Game.state = 'paused';
      var p = Game.players[0];
      p.onGround = false;
      p.actWallDir = 1; p.actGrabHeld = false;
    })()`);
    frame();
    const n = G('Object.keys(Game.tutorial.seen).length');
    run('Game.state = "playing";');
    return n === 0;
  })());

check('每个提示都有 id / text / when',
  (function () {
    const bad = G(`TUTORIAL.hints.filter(function(h){
      return !h.id || !h.text || typeof h.when !== 'function';
    }).length`);
    return bad === 0;
  })());

check('提示 id 不重复',
  (function () {
    const dup = G(`(function(){
      var ids = TUTORIAL.hints.map(function(h){ return h.id; });
      return ids.length !== new Set(ids).size;
    })()`);
    return dup === false;
  })());

/* ============================================================
 * 结果
 * ============================================================ */
console.log('\n' + '='.repeat(58));
console.log('  教学引导测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) console.log('  失败项: ' + problems.join('、'));
console.log('='.repeat(58));
process.exit(FAIL > 0 ? 1 : 0);
