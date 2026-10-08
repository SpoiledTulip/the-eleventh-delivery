/* ============================================================
 * 动作解锁系统测试
 * ============================================================
 * 这是"逐步解锁"功能的核心验证 —— 单独一个文件，
 * 因为其它测试都是"先解锁再测动作"，只有这里测解锁流程本身。
 *
 * 覆盖：
 *   A. 新档默认全锁
 *   B. 通关逐关解锁（且永久保留）
 *   C. 未解锁时动作真的不生效（不是"能用但不提示"）
 *   D. 旧存档兼容（老玩家不该突然失去能力）
 *   E. 存档损坏 / 异常时不会把玩家锁死
 *   F. 重玩旧关不会把已解锁的动作锁回去
 *   H. 未解锁角色「零剧透」—— UI 只能渲染"已制作 + 已解锁"的角色，
 *      免得把还没出场的新角色提前卖出去（2026-10-06 新增）
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

/* ---------- 沙箱 ---------- */
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

['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js',
 'actions.js', 'tutorial.js', 'net.js', 'render.js', 'game.js', 'ui.js'].forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f }); }
  catch (e) { console.log('  加载 ' + f + ' 失败: ' + e.message); }
});

const G = function (e) { return vm.runInContext(e, sandbox); };
const run = function (c) { return vm.runInContext(c, sandbox); };

console.log('动作解锁系统测试');
console.log('='.repeat(58));

/* ============================================================
 * A. 新档默认全锁
 * ============================================================ */
console.log('\n=== A. 新档默认全锁 ===');
run('Save.reset()');
const ids = ['doublejump', 'wallslide', 'walljump', 'dash'];
ids.forEach(function (id) {
  check('新档 ' + id + ' 未解锁', G('isActionUnlocked("' + id + '")') === false);
});
check('解锁表有 4 个动作', G('ACTION_UNLOCKS.length') === 4,
  G('ACTION_UNLOCKS.length') + ' 个');

/* ============================================================
 * B. 通关逐关解锁
 * ============================================================ */
console.log('\n=== B. 通关逐关解锁 ===');

/* B-1 通关第 1 关 → 解锁二连跳 */
run('Save.reset()');
const r1 = G(`(function(){ var r = Save.recordClear(0, 30, 10, 14);
  return { unlocked: r.unlocked.map(function(u){ return u.id; }) }; })()`);
console.log('   通关第1关解锁: ' + JSON.stringify(r1.unlocked));
check('通关第1关解锁 doublejump',
  r1.unlocked.indexOf('doublejump') >= 0, JSON.stringify(r1.unlocked));
check('通关第1关不解锁 wallslide',
  G('isActionUnlocked("wallslide")') === false);
check('通关第1关不解锁 dash',
  G('isActionUnlocked("dash")') === false);

/* B-2 逐关推进，每个动作在对的时机解锁 */
const expectByLevel = [
  [1, 'wallslide'],
  [2, 'walljump'],
  [3, 'dash'],
];
expectByLevel.forEach(function (pair) {
  const idx = pair[0];          // 通关的关卡下标
  const id = pair[1];
  run('Save.recordClear(' + idx + ', 30, 10, 14)');
  check('通关第 ' + (idx + 1) + ' 关后 ' + id + ' 已解锁',
    G('isActionUnlocked("' + id + '")') === true,
    'unlocked=' + G('JSON.stringify(Save.data.unlockedActions)'));
});

check('全部 4 个动作都解锁了',
  G('Save.data.unlockedActions.length') === 4,
  G('JSON.stringify(Save.data.unlockedActions)'));

/* B-3 解锁是"永久"的：换关不影响 */
run('Save.reset(); Save.recordClear(0, 30, 10, 14);');
run('Game.mode="local"; Game.playerCount=1; Game.pickRole="kangaroo"; loadLevel(0);');
check('解锁后玩第1关，二连跳仍可用',
  G('isActionUnlocked("doublejump")') === true);

/* ============================================================
 * C. 未解锁时动作真的不生效
 * ============================================================ */
console.log('\n=== C. 未解锁时动作不生效 ===');

/* C-1 二连跳：未解锁时空中按跳无反应 */
run('Save.reset()');
run('Game.mode="local"; Game.playerCount=1; Game.pickRole="kangaroo"; loadLevel(0); Game.state="playing";');
const noDJ = G(`(function(){
  var p = Game.players[0];
  /* 造一个高空环境，防止落地干扰 */
  p.x = 200; p.y = 100; p.vx = 0; p.vy = 0; p.onGround = false;
  p.jumpsLeft = 1;            // 空中还有一次机会（但没解锁）
  p.jumpBuffer = CONFIG.JUMP_BUFFER;
  p.coyote = 0;
  InputState.now = {}; InputState.now['ArrowUp'] = true;
  var before = p.vy;
  update(1/60);
  InputState.tick();
  return { before: before, after: p.vy, jumpsLeft: p.jumpsLeft };
})()`);
console.log('   未解锁二连跳：vy ' + noDJ.before.toFixed(2) + ' → ' + noDJ.after.toFixed(2) +
  '（jumpsLeft=' + noDJ.jumpsLeft + '）');
check('未解锁二连跳时按跳不产生起跳速度',
  noDJ.jumpsLeft === 1 && noDJ.after > noDJ.before,
  JSON.stringify(noDJ));
check('未解锁时 jumpsLeft 没被消耗', noDJ.jumpsLeft === 1);

/* C-2 冲刺：未解锁时按[冲刺键]无反应
 * ★ 2026-10-07 修：原来硬编码 'ShiftLeft'，但项目后来把冲刺键改成了 'KeyF'
 *   （见 actions.js 的 DASH_KEYS_BASE）⇒ 测试按 Shift 自然没反应，假失败。
 *   ⇒ 改成**从 ACTIONS.DASH_KEYS 现读**：以后改键位，测试自动跟随。 */
const DASH_KEY = G('(ACTIONS && ACTIONS.DASH_KEYS && ACTIONS.DASH_KEYS[0]) || "KeyF"');
console.log('   本局冲刺键 = ' + DASH_KEY);
run('Save.reset()');
const noDash = G(`(function(){
  var p = Game.players[0];
  p.x = 300; p.y = 100; p.vx = 0; p.vy = 0; p.onGround = false;
  p.actDashes = 1; p.actDashCool = 0; p.actDashT = 0; p._actDashKeyPrev = false;
  InputState.now = {}; InputState.now['${DASH_KEY}'] = true; InputState.now['ArrowRight'] = true;
  update(1/60);
  InputState.tick();
  return { dashT: p.actDashT, dashes: p.actDashes, vx: p.vx };
})()`);
console.log('   未解锁冲刺：actDashT=' + noDash.dashT + ' dashes=' + noDash.dashes);
check('未解锁冲刺时按下冲刺键不触发冲刺',
  noDash.dashT === 0 && noDash.dashes === 1,
  JSON.stringify(noDash));

/* C-3 解锁后冲刺可用（对照组，证明上面的失败是"被锁"而不是"坏了"） */
run('Save.reset(); Save.recordClear(0,30,10,14); Save.recordClear(1,30,10,14); ' +
    'Save.recordClear(2,30,10,14); Save.recordClear(3,30,10,14);');
const withDash = G(`(function(){
  var p = Game.players[0];
  p.x = 300; p.y = 100; p.vx = 0; p.vy = 0; p.onGround = false;
  p.actDashes = 1; p.actDashCool = 0; p.actDashT = 0; p._actDashKeyPrev = false;
  InputState.now = {}; InputState.now['${DASH_KEY}'] = true; InputState.now['ArrowRight'] = true;
  update(1/60);
  InputState.tick();
  return { dashT: p.actDashT, dashes: p.actDashes };
})()`);
console.log('   已解锁冲刺：actDashT=' + withDash.dashT + ' dashes=' + withDash.dashes);
/* ⚠️ 2026-10-06："冲刺改成无限用"之后，冲刺**不再扣次数**。
 *    原来这里断言 `dashes === 0`（冲一次就归零），现在是错的 ——
 *    正确行为是"次数保持满"（dashT > 0 说明确实冲了）。 */
check('解锁后冲刺正常触发（对照）',
  withDash.dashT > 0 && withDash.dashes === 1,
  JSON.stringify(withDash));

/* C-4 滑墙：未解锁时贴墙不减速 */
run('Save.reset()');
const noWall = G(`(function(){
  var p = Game.players[0];
  /* 造一面墙 + 把角色贴在墙上 */
  Game.level.solids.length = 0;
  Game.level.platforms.length = 0;
  Game.level.height = 5000;
  Game.level.solids.push({x: 400, y: 0, w: 32, h: 2000});
  p.x = 373; p.y = 500; p.vx = 0; p.vy = 0; p.onGround = false;
  p.actGrabStamina = 72;
  for (var i = 0; i < 6; i++) {
    p.y = 500; p.onGround = false;
    InputState.now = {}; InputState.now['KeyD'] = true;
    update(1/60); InputState.tick();
  }
  return { wallDir: p.actWallDir, vy: p.vy, slide: p.actWallSlide };
})()`);
console.log('   未解锁滑墙：wallDir=' + noWall.wallDir + ' vy=' + noWall.vy.toFixed(2) +
  ' slide=' + noWall.slide);
check('未解锁滑墙时 actWallDir 恒为 0', noWall.wallDir === 0, JSON.stringify(noWall));
check('未解锁滑墙时不产生滑墙状态', noWall.slide === false);

/* ============================================================
 * D. 旧存档兼容
 * ============================================================ */
console.log('\n=== D. 旧存档兼容（不能把老玩家锁死）===');
run(`localStorage.setItem('delivery-game-save-v1', JSON.stringify({
  version: 1,
  maxUnlocked: 5,
  levels: {
    "1": {cleared: true, bestTime: 20, bestStars: 3, bestCoins: 10},
    "2": {cleared: true, bestTime: 20, bestStars: 3, bestCoins: 10},
    "3": {cleared: true, bestTime: 20, bestStars: 3, bestCoins: 10},
    "4": {cleared: true, bestTime: 20, bestStars: 3, bestCoins: 10}
  }
}))`);
run('Save.load()');
console.log('   补全后: ' + G('JSON.stringify(Save.data.unlockedActions)'));
ids.forEach(function (id) {
  check('旧存档（已通关4关）' + id + ' 自动补全为已解锁',
    G('isActionUnlocked("' + id + '")') === true);
});

/* D-2 只通关 1 关的旧存档 */
run(`localStorage.setItem('delivery-game-save-v1', JSON.stringify({
  version: 1, maxUnlocked: 2,
  levels: { "1": {cleared: true, bestTime: 20, bestStars: 3, bestCoins: 10} }
}))`);
run('Save.load()');
check('旧存档（只通关1关）二连跳已解锁',
  G('isActionUnlocked("doublejump")') === true);
check('旧存档（只通关1关）冲刺仍未解锁',
  G('isActionUnlocked("dash")') === false);

/* ============================================================
 * E. 异常情况不能把玩家锁死
 * ============================================================ */
console.log('\n=== E. 异常兜底 ===');

/* E-1 未知动作 id → 放行 */
check('查询未定义的动作为"已解锁"（放行）',
  G('isActionUnlocked("这个动作不存在")') === true);

/* E-2 存档字段被破坏 */
run('Save.data.unlockedActions = "不是数组";');
check('unlockedActions 被破坏时不抛异常',
  (function () {
    try { const v = G('isActionUnlocked("dash")'); return typeof v === 'boolean'; }
    catch (e) { return false; }
  })());

/* E-3 SAVE() 不可用时不锁死 */
check('SAVE() 返回异常对象时放行',
  (function () {
    try {
      run('var __oldSave = Save;');
      const v = G(`(function(){
        /* 模拟"存档模块整个坏掉" */
        var ok;
        try {
          /* 直接把 hasAction 换成会抛异常的版本 */
          var bak = Save.hasAction;
          Save.hasAction = function(){ throw new Error('boom'); };
          ok = isActionUnlocked('dash');
          Save.hasAction = bak;
        } catch (e) { ok = 'THREW'; }
        return ok;
      })()`);
      return v === true;
    } catch (e) { return false; }
  })());

/* ============================================================
 * F. 重玩旧关不回锁
 * ============================================================ */
console.log('\n=== F. 重玩不回锁 ===');
run('Save.reset()');
/* 一路通关到第 4 关 */
run('for (var i = 0; i < 4; i++) Save.recordClear(i, 30, 10, 14);');
const before = G('JSON.stringify(Save.data.unlockedActions.slice().sort())');
/* 重玩第 1 关 */
run('Save.recordClear(0, 25, 14, 14)');
const after = G('JSON.stringify(Save.data.unlockedActions.slice().sort())');
console.log('   重玩前: ' + before);
console.log('   重玩后: ' + after);
check('重玩旧关不会把已解锁动作锁回去', before === after, before + ' → ' + after);
check('重玩后全部动作仍在', G('Save.data.unlockedActions.length') === 4);

/* ============================================================
 * G. reset 后完全清空
 * ============================================================ */
console.log('\n=== G. 清档 ===');
run('Save.reset()');
check('reset 后解锁列表清空',
  G('Save.data.unlockedActions.length') === 0,
  G('JSON.stringify(Save.data.unlockedActions)'));
ids.forEach(function (id) {
  check('reset 后 ' + id + ' 回到未解锁', G('isActionUnlocked("' + id + '")') === false);
});

/* ============================================================
 * H. 未解锁角色「零剧透」（2026-10-06 新增）
 * ============================================================
 * 十一的要求：新角色在解锁之前**一点线索都不给** ——
 * 不要提前显示卡片、不要剪影、不要"还有 N 名骑手没解锁"，
 * 要让它在通关第 10 关那一刻作为**惊喜**登场。
 *
 * 所以这里守的是一条通用性质：
 *   **任何需要解锁（unlockLevel > 0）的角色，
 *     只要不在存档的解锁列表里，就绝不许出现在 listVisibleChars() 里。**
 *
 * ⚠️ 这些断言写成"通用性质"而不是"针对卡皮巴拉"，
 *    这样以后加第 4、第 5 个角色会自动被同一条规则管住，
 *    不用记得回这里补测试。
 * ============================================================ */
console.log('\n=== H. 未解锁角色「零剧透」 ===');
run('Save.reset()');

check('存在 listVisibleChars()（UI 渲染角色只能用这个口径）',
  typeof G('listVisibleChars') === 'function');

/* ① 新档：看得见的必须正好等于初始就有的那几个 */
const visFresh = G('listVisibleChars().map(function(c){return c.id})');
const defFresh = G('defaultUnlockedChars()');
check('新档可见角色 = 初始角色（不多不少）',
  JSON.stringify(visFresh) === JSON.stringify(defFresh),
  JSON.stringify(visFresh) + ' vs ' + JSON.stringify(defFresh));

/* ② 通用性质：listVisibleChars 永远 ⊆ listForLibrary */
check('可见角色一定是"已制作"的子集',
  G('listVisibleChars().length') <= G('listForLibrary().length'));

/* ---------- 下面两节临时把卡皮巴拉置为 ready:true ----------
 * 卡皮巴拉现在 ready:false，直接测"解锁后要出现"会是空跑
 * （没有任何已制作又需解锁的角色）。
 * 这里模拟"入职之后"的状态，测完立刻还原。 */
const capy = G('charById("capybara") ? true : false');
if (capy) {
  const wasReady = G('charById("capybara").ready');
  run('charById("capybara").ready = true');

  /* ③ 还没解锁 → 哪怕已经制作完成，也不许露面 */
  run('Save.reset()');
  const visLocked = G('listVisibleChars().map(function(c){return c.id})');
  check('★ 卡皮巴拉已做好但没解锁 → 仍然看不见',
    visLocked.indexOf('capybara') < 0, JSON.stringify(visLocked));
  check('★ 主菜单计数（listVisibleChars().length）不含卡皮巴拉',
    G('listVisibleChars().length') === G('defaultUnlockedChars().length'),
    'N=' + G('listVisibleChars().length') +
    ' 初始=' + G('defaultUnlockedChars().length'));
  check('listForLibrary() 仍能查到卡皮巴拉（制作视角不受影响）',
    G('listForLibrary().map(function(c){return c.id})').indexOf('capybara') >= 0);

  /* ④ 解锁之后 → 必须立刻出现 */
  run('Save.data.unlockedCharacters.push("capybara")');
  const visGot = G('listVisibleChars().map(function(c){return c.id})');
  check('★ 解锁后卡皮巴拉出现在可见列表',
    visGot.indexOf('capybara') >= 0, JSON.stringify(visGot));

  /* ⑤ 存档读不出来时的兜底 —— 宁可少显示，也不能把没解锁的漏出去 */
  run('(function(){ Save.__bak = Save.unlockedChars; Save.unlockedChars = function(){ return []; }; })()');
  const visBad = G('listVisibleChars().map(function(c){return c.id})');
  run('(function(){ Save.unlockedChars = Save.__bak; delete Save.__bak; })()');
  check('★ 存档空/损坏时兜底不泄露（卡皮巴拉不出现在里头）',
    visBad.indexOf('capybara') < 0, JSON.stringify(visBad));
  const defsAll = G('defaultUnlockedChars()');
  check('兜底至少还能显示初始角色（角色库不会空掉）',
    visBad.length >= 1 && visBad.length === defsAll.length &&
    visBad.every(function (id) { return defsAll.indexOf(id) >= 0; }),
    JSON.stringify(visBad));

  run('charById("capybara").ready = ' + wasReady);
} else {
  console.log('  （跳过：找不到 capybara 配置，第 ③④⑤ 项没跑）');
}

/* ⑥ 源码级红线：ui.js 不许直接用 listForLibrary() 渲染（那会剧透）
 *    注释里提到没关系，只看真正的代码行。 */
/* ---------- ⑥ 源码级红线 ----------
 * 行为层的检查（①②~⑤）只能证明"现在没漏"，
 * 挡不住以后有人把渲染方式改回去。这里再钉一道源码红线。
 *
 * ⚠️ 扫描范围要小心：
 *    「通关第 N 关解锁」「还没解锁的」这些字眼在**按键说明页**是合法的 ——
 *    那是给"招式/动作"用的（ (__动作__) 本来就该让玩家知道还能学哪些）。
 *    这次要守的是**角色**不能提前露面，所以只扫角色库那一页。
 *    但 listForLibrary() 是全项目禁用（UI 一律不许用它渲染），全局扫。 */
const uiText = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
const uiLines = uiText.split('\n');

/* 全局：ui.js 不许直接调 listForLibrary() 渲染。
 *
 * ⚠️ 豁免：PK 页（buildPkPick）的 **AI 对手池** 是**合法**用途 ——
 *    AI 可以从"全部已制作角色"里抽，不受玩家解锁进度限制
 *    （十一的设计：AI 用谁都行，那不是剧透，只是对手）。
 *    这一处从 buildPkPick 开始到下一个顶层 function 结束之间豁免。 */
function uiFnRange(lines, fnName) {
  const start = lines.findIndex(function (l) { return l.indexOf('function ' + fnName + '(') >= 0; });
  if (start < 0) return [-1, -1];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^function\s+[A-Za-z_$]/.test(lines[i])) { end = i; break; }
  }
  return [start, end];
}
const PK_RANGE = uiFnRange(uiLines, 'buildPkPick');

const globLeaks = [];
uiLines.forEach(function (line, i) {
  const t = line.trim();
  if (t.indexOf('*') === 0 || t.indexOf('//') === 0 || t.indexOf('/*') === 0) return;  // 注释不算
  if (i >= PK_RANGE[0] && i < PK_RANGE[1]) return;   // PK 页 AI 池豁免（见上）
  if (line.indexOf('listForLibrary(') >= 0) globLeaks.push(i + 1);
});
check('★ 角色库相关代码没有直接调 listForLibrary() 渲染（PK 页 AI 池豁免）',
  globLeaks.length === 0, '出现在第 ' + globLeaks.join(', ') + ' 行');

/* 局部：只看 buildCharLibrary()（画角色卡的唯一入口）*/
const libStart = uiLines.findIndex(function (l) { return l.indexOf('function buildCharLibrary(') >= 0; });
let libEnd = -1;
for (let i = libStart + 1; i < uiLines.length; i++) {
  if (/^function\s+[A-Za-z_$]/.test(uiLines[i])) { libEnd = i; break; }
}
check('能定位到 buildCharLibrary()（角色卡渲染入口）',
  libStart >= 0 && libEnd > libStart,
  'start=' + libStart + ' end=' + libEnd);

const SPOILERS = [
  { pat: 'lib-unlock',                 why: '"通关第 N 关后解锁"文案' },
  { pat: 'locked-state',               why: '"🔒 未解锁"状态标记' },
  { pat: "'通关第 '",                  why: '"通关第 N 关解锁..."提示' },
  { pat: 'listForLibrary(',            why: '用了"已制作"口径（应为 listVisibleChars）' },
  { pat: 'CHARACTERS',                 why: '直接遍历了全角色表' },
];
const leaks = [];
if (libStart >= 0 && libEnd > libStart) {
  uiLines.slice(libStart, libEnd).forEach(function (line, k) {
    const t = line.trim();
    if (t.indexOf('*') === 0 || t.indexOf('//') === 0 || t.indexOf('/*') === 0) return;
    SPOILERS.forEach(function (s) {
      if (line.indexOf(s.pat) >= 0) leaks.push('第' + (libStart + k + 1) + '行 ' + s.why);
    });
  });
}
check('★ 角色库页里没有任何"没解锁的角色"的渲染痕迹',
  leaks.length === 0, leaks.join(' / '));

console.log('\n' + '='.repeat(58));
console.log('  解锁系统测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
if (problems.length) console.log('  失败项: ' + problems.join('、'));
console.log('='.repeat(58));
process.exit(FAIL > 0 ? 1 : 0);
