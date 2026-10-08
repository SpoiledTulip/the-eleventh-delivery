/* ============================================================
 * achievement-test.js — 成就（称号）系统测试
 * ============================================================
 * 背景（2026-10-06）：十一要求"把已有的称号做成一个能看的地方"。
 * 成就的**存储/判定/清档早就有了**（`Save.data.titles`），
 * 本次只加了"成就页 + 两个入口"，所以这里重点是**守住这些既有行为**：
 *
 *   1. 新档：listTitles() 为空
 *   2. addTitle 一个 → 数量 +1，返回 true
 *   3. 重复 addTitle 同一个 → 返回 false，数量不变
 *   4. reset() 后 titles 回空
 *   5. ★ 旧档兼容：data.titles 是**字符串数组**时，hasTitle / listTitles 不崩
 *   6. ★ 数据是坏的时候（titles 是 null / 字符串 / 数字）也不能崩
 *   7. 成就页的数据源（MYSTERY_ORDERS）结构完整，且标题不与 titles 重复
 *
 * ⚠️ 为什么"坏数据"也要测：
 *    存档在玩家的 localStorage 里，可能被手动改、被别的版本写坏、
 *    或者老版本的格式。**读到坏数据时宁可少显示几个成就，也不能把游戏带崩。**
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; }
}
function checkEq(a, b, msg) {
  check(a === b, msg + (a === b ? '' : '  → 实际: ' + JSON.stringify(a) + '，期望: ' + JSON.stringify(b)));
}

/* ---------- 可配置的假 localStorage ---------- */
let store = {};
const fakeLS = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; },
  clear: function () { store = {}; },
};

function buildSandbox() {
  function noop() {}
  const ctxProbe = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    }, set: function () { return true; },
  });

  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
    window: {
      addEventListener: noop, requestAnimationFrame: function () { return 0; },
      Image: function () { setTimeout(function () { if (this.onerror) this.onerror(); }, 0); },
      AudioContext: function () {
        return {
          state: 'running', currentTime: 0,
          createOscillator: function () { return { frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }; },
          createGain: function () { return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }; },
          destination: {}, resume: noop,
        };
      },
    },
    document: {
      getElementById: function () { return { getContext: function () { return ctxProbe; }, width: 0, height: 0, style: {} }; },
      addEventListener: noop,
    },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: noop,
    localStorage: fakeLS,
  };
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

/* ⚠️ 加载列表必须和 index.html 一致（save.js 要在 actions/game 之前） */
const FILES = ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js'];

function freshSandbox() {
  const sb = buildSandbox();
  FILES.forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
  });
  return sb;
}
function mkRun(sb) {
  return function (code) { return vm.runInContext(code, sb); };
}

const SAVE_KEY = 'delivery-game-save-v1';

/* ============================================================
 * 1. MYSTERY_ORDERS 表本身是好的
 * ============================================================ */
console.log('\n=== 1. 成就表（MYSTERY_ORDERS）结构 ===');
{
  const sb = freshSandbox();
  const run = mkRun(sb);
  const orders = run('JSON.stringify(MYSTERY_ORDERS)');
  const list = JSON.parse(orders || '[]');

  check(list.length > 0, '成就表非空（当前 ' + list.length + ' 条）');
  check(list.every(function (o) { return typeof o.title === 'string' && o.title; }), '每条都有 title（称号名）');
  check(list.every(function (o) { return typeof o.condition === 'string' && o.condition; }), '每条都有 condition（条件文字）');
  check(list.every(function (o) { return typeof o.levelIndex === 'number'; }), '每条都有 levelIndex（所属关卡）');

  /* ★ 称号名不能重复 —— 否则 hasTitle 会串味 */
  const titles = list.map(function (o) { return o.title; });
  check(new Set(titles).size === titles.length, '称号名互不重复');
}

/* ============================================================
 * 2. 新档：没有成就
 * ============================================================ */
console.log('\n=== 2. 新档（成就 0 个）===');
let sb, run;
{
  store = {};
  sb = freshSandbox();
  run = mkRun(sb);
  run('Save.load()');

  checkEq(run('Save.listTitles().length'), 0, 'listTitles() 是空的');
  check(run('Array.isArray(Save.listTitles())'), 'listTitles() 返回数组（不是 undefined）');

  const list = JSON.parse(run('JSON.stringify(MYSTERY_ORDERS)'));
  const owned = list.filter(function (o) { return run('Save.hasTitle(' + JSON.stringify(o.title) + ')'); }).length;
  checkEq(owned, 0, '成就页统计 = 0 / ' + list.length);

  checkEq(run('Save.hasTitle("一单未取")'), false, 'hasTitle("一单未取") = false');
  checkEq(run('Save.hasTitle("不存在的称号")'), false, 'hasTitle(乱写的名字) = false（不崩）');
}

/* ============================================================
 * 3. addTitle：新解锁返回 true
 * ============================================================ */
console.log('\n=== 3. addTitle 解锁一个 ===');
{
  checkEq(run('Save.addTitle("一单未取")'), true, '第一次 addTitle 返回 true（是新解锁）');
  checkEq(run('Save.listTitles().length'), 1, '数量变成 1');
  checkEq(run('Save.hasTitle("一单未取")'), true, 'hasTitle 变 true');

  const list = JSON.parse(run('JSON.stringify(MYSTERY_ORDERS)'));
  const owned = list.filter(function (o) { return run('Save.hasTitle(' + JSON.stringify(o.title) + ')'); }).length;
  checkEq(owned, 1, '成就页统计 = 1 / ' + list.length);
}

/* ============================================================
 * 4. 重复 addTitle：返回 false，数量不变
 * ============================================================ */
console.log('\n=== 4. 重复解锁同一个 ===');
{
  checkEq(run('Save.addTitle("一单未取")'), false, '重复 addTitle 返回 false');
  checkEq(run('Save.listTitles().length'), 1, '数量还是 1（没有重复加进去）');
  checkEq(run('Save.addTitle("一单未取")'), false, '再重复一次还是 false');
  checkEq(run('Save.listTitles().length'), 1, '数量仍是 1');

  /* 空 / 非法参数不能加进去 */
  checkEq(run('Save.addTitle("")'), false, 'addTitle("") 返回 false');
  checkEq(run('Save.addTitle(null)'), false, 'addTitle(null) 返回 false（不崩）');
  checkEq(run('Save.addTitle(123)'), false, 'addTitle(数字) 返回 false（不崩）');
  checkEq(run('Save.listTitles().length'), 1, '这些都没混进去，数量仍 1');
}

/* ============================================================
 * 5. 解锁第二个 + 顺序无关
 * ============================================================ */
console.log('\n=== 5. 解锁多个 + 顺序无关 ===');
{
  run('Save.addTitle("金身不破")');
  checkEq(run('Save.listTitles().length'), 2, '数量变成 2');
  checkEq(run('Save.hasTitle("一单未取")'), true, '先拿的那个还在');
  checkEq(run('Save.hasTitle("金身不破")'), true, '后拿的也在');

  const t = JSON.parse(run('JSON.stringify(Save.listTitles())'));
  check(t.indexOf('一单未取') >= 0 && t.indexOf('金身不破') >= 0, '两个称号都能在 listTitles 里找到');
}

/* ============================================================
 * 6. 存档持久化（重新读回来还在）
 * ============================================================ */
console.log('\n=== 6. 存档持久化 ===');
{
  const savedRaw = store[SAVE_KEY];
  check(!!savedRaw, '存档已写入 localStorage');

  /* 用同一个 localStorage 新建沙箱重新载入 —— 模拟"刷新页面" */
  const sb2 = freshSandbox();
  const run2 = mkRun(sb2);
  run2('Save.load()');
  checkEq(run2('Save.listTitles().length'), 2, '重新载入后成就还在（2 个）');
  checkEq(run2('Save.hasTitle("一单未取")'), true, '「一单未取」还在');
}

/* ============================================================
 * 7. ★ 旧档兼容：titles 是字符串数组（当前格式）★
 * ============================================================ */
console.log('\n=== 7. ★ 旧档兼容：titles 是字符串数组 ===');
{
  /* 手工塞一个"老格式"存档进去（就是现在线上玩家的格式） */
  store = {};
  store[SAVE_KEY] = JSON.stringify({
    version: 2,
    maxUnlocked: 5,
    unlockedActions: ['doublejump', 'wallslide'],
    levels: {},
    selectedCharacter: 'kangaroo',
    unlockedCharacters: ['kangaroo', 'dragon'],
    characterRecords: {},
    seenUnlockAnimations: [],
    titles: ['一单未取'],                  // ← 字符串数组，老玩家的样子
  });

  const sb3 = freshSandbox();
  const run3 = mkRun(sb3);
  try {
    run3('Save.load()');
    check(true, '旧档载入不抛异常');
  } catch (e) {
    check(false, '旧档载入抛异常了: ' + e.message);
  }

  checkEq(run3('Save.listTitles().length'), 1, '旧档的 1 个称号被正确读出');
  checkEq(run3('Save.hasTitle("一单未取")'), true, 'hasTitle("一单未取") = true');
  checkEq(run3('Save.hasTitle("金身不破")'), false, '没拿过的还是 false');
  check(run3('Array.isArray(Save.listTitles())'), 'listTitles() 仍是数组');

  /* 旧档上继续加新称号，不能出问题 */
  checkEq(run3('Save.addTitle("金身不破")'), true, '旧档上还能继续解锁新称号');
  checkEq(run3('Save.listTitles().length'), 2, '加完变成 2 个');
}

/* ============================================================
 * 8. ★ 坏数据兜底（不能把游戏带崩）★
 * ============================================================ */
console.log('\n=== 8. ★ 坏数据兜底 ===');
[
  { name: 'titles 是 null', raw: { version: 2, maxUnlocked: 3, levels: {}, titles: null } },
  { name: 'titles 是字符串', raw: { version: 2, maxUnlocked: 3, levels: {}, titles: '一单未取' } },
  { name: 'titles 是数字', raw: { version: 2, maxUnlocked: 3, levels: {}, titles: 42 } },
  { name: 'titles 是对象', raw: { version: 2, maxUnlocked: 3, levels: {}, titles: { a: 1 } } },
  { name: '整个存档是垃圾字符串', raw: null, garbage: '{{{ 这不是 JSON' },
].forEach(function (cs) {
  store = {};
  store[SAVE_KEY] = cs.garbage !== undefined ? cs.garbage : JSON.stringify(cs.raw);
  const sbx = freshSandbox();
  const rx = mkRun(sbx);
  let err = null;
  try {
    rx('Save.load()');
    rx('Save.listTitles()');
    rx('Save.hasTitle("一单未取")');
    rx('Save.addTitle("测试称号")');
  } catch (e) { err = e.message; }

  check(err === null, cs.name + ' → 不抛异常' + (err ? '（实际: ' + err + '）' : ''));
  const len = (function () { try { return rx('Save.listTitles().length'); } catch (e) { return -1; } })();
  check(typeof len === 'number' && len >= 0, cs.name + ' → listTitles() 返回合法数组（长度 ' + len + '）');
  const has = (function () { try { return rx('Save.hasTitle("一单未取")'); } catch (e) { return 'ERROR'; } })();
  check(has === true || has === false, cs.name + ' → hasTitle() 返回布尔（' + has + '）');
});

/* ============================================================
 * 9. reset()：清档要清成就
 * ============================================================ */
console.log('\n=== 9. reset() 清档清成就 ===');
/* ⚠️ sb4 / run4 声明在块**外面** —— 第 10 段还要接着用它。
 *    一开始写在 `{}` 里，第 10 段就 ReferenceError 了（块级作用域）。 */
let sb4, run4;
{
  store = {};
  sb4 = freshSandbox();
  run4 = mkRun(sb4);
  run4('Save.load()');
  run4('Save.addTitle("一单未取")');
  run4('Save.addTitle("金身不破")');
  checkEq(run4('Save.listTitles().length'), 2, '先拿 2 个称号');

  run4('Save.reset()');
  checkEq(run4('Save.listTitles().length'), 0, 'reset() 后称号全部清空');
  checkEq(run4('Save.hasTitle("一单未取")'), false, '「一单未取」也清了');
  /* ⚠️ check 的签名是 (ok, msg) —— 只有两个参数。
   *    一开始写成了 check(表达式, true, '描述')，多传了 true，
   *    结果 msg 收到 true，日志打出一行莫名其妙的 "[v] true"。 */
  check(run4('Array.isArray(Save.listTitles())'), '清档后 listTitles() 仍是数组（不是 null）');
}

/* ============================================================
 * 10. 清档后仍能正常解锁（不能"清坏了"）
 * ============================================================ */
console.log('\n=== 10. 清档后还能继续解锁 ===');
{
  /* ⚠️ 这里必须用 run4（刚 reset 过的那个沙箱）。
   *    一开始我误用了第 2 段的 run，结果测的是"另一个还留着 2 个称号的沙箱"，
   *    断言全线对不上 —— 是**测试自己的 bug**，不是代码问题。 */
  checkEq(run4('Save.addTitle("一单未取")'), true, '清档后再拿同一个 → 又算"新解锁"（返回 true）');
  checkEq(run4('Save.listTitles().length'), 1, '数量 = 1');
}

/* ============================================================
 * 11. ★ 源码级检查：成就页必须"显示未解锁的 + 显示条件" ★
 * ============================================================
 * 这是方案 A 的核心（十一确认过）：未解锁的**不能藏起来**。
 * 用读源码的方式守 —— 比真的跑浏览器快，抓的正是"漏写"这类错。
 * ============================================================ */
console.log('\n=== 11. ★ 成就页的关键实现（源码级）===');
{
  const ui = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');

  check(/function\s+buildAchievements\s*\(/.test(ui), 'buildAchievements() 存在');
  check(/buildAchievements\s*\(\)/.test(ui) && /STATE\.ACHIEVEMENTS\s*\)\s*buildAchievements/.test(ui),
    'syncUI 路由里接上了 STATE.ACHIEVEMENTS → buildAchievements');

  /* ★ 未解锁的必须显示条件 —— 抓"???"这类藏起来的写法 */
  const fnStart = ui.indexOf('function buildAchievements');
  let fnBody = '';
  if (fnStart >= 0) {
    let i = ui.indexOf('{', fnStart), depth = 0, end = -1;
    for (; i < ui.length; i++) {
      if (ui[i] === '{') depth++;
      else if (ui[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    fnBody = ui.slice(fnStart, end + 1);
  }
  check(fnBody.length > 100, '能抠出 buildAchievements 的函数体');
  check(/o\.condition/.test(fnBody), '★ 渲染了条件文字（o.condition）');
  check(!/['"]\?{2,}['"]/.test(fnBody), '★ 没有把条件藏成 "???"');
  check(/已达成/.test(fnBody) && /未达成/.test(fnBody), '★ 状态有文字（已达成 / 未达成），不只靠颜色');
  check(/🏆/.test(fnBody) && /🔒/.test(fnBody), '★ 状态有图标（🏆 / 🔒）');

  /* ★ 角色库的零剧透逻辑不能被动过 */
  check(/listVisibleChars\s*\(\)/.test(ui), '★ 角色库仍在用 listVisibleChars()（零剧透没被破坏）');
  const libStart = ui.indexOf('function buildCharLibrary');
  let libBody = '';
  if (libStart >= 0) {
    let i = ui.indexOf('{', libStart), depth = 0, end = -1;
    for (; i < ui.length; i++) {
      if (ui[i] === '{') depth++;
      else if (ui[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    libBody = ui.slice(libStart, end + 1);
  }
  check(/if\s*\(\s*!unlocked\s*\)\s*return\s*;/.test(libBody),
    '★ 角色库的"未解锁直接 return"双保险还在');

  /* tab 切换必须走重绘，不是 CSS 显隐 */
  check(/function\s+buildLibTabs\s*\(/.test(ui), 'buildLibTabs() 存在（两个 tab）');
  check(/gotoState\s*\(/.test(ui.slice(ui.indexOf('function buildLibTabs'), ui.indexOf('function buildLibTabs') + 1600)),
    '★ tab 切换走 gotoState（重绘），不是 CSS 显隐');
  check(/STATE\.CHAR_LIBRARY/.test(ui) && /STATE\.ACHIEVEMENTS/.test(ui), '两个 tab 各自指向正确 state');

  /* 结算页可点跳转 */
  const clearStart = ui.indexOf('function buildClear');
  let clearBody = '';
  if (clearStart >= 0) {
    let i = ui.indexOf('{', clearStart), depth = 0, end = -1;
    for (; i < ui.length; i++) {
      if (ui[i] === '{') depth++;
      else if (ui[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    clearBody = ui.slice(clearStart, end + 1);
  }
  check(/newTitleThisClear/.test(clearBody), '结算页里用到了 newTitleThisClear');
  check(/STATE\.ACHIEVEMENTS/.test(clearBody), '★ 结算页的称号块能跳成就页');
  check(/查看成就/.test(clearBody), '★ 有"查看成就 →"文字暗示');
  /* ⚠️ 没拿到新称号时不能出现那行 —— 必须是 if 包着 */
  check(/if\s*\(\s*Game\.newTitleThisClear\s*\)/.test(clearBody),
    '★ 称号块在 `if (Game.newTitleThisClear)` 里（没拿到就不出现）');
}

/* ============================================================
 * 12. 红线：没改 titles 的数据结构 / 没碰清档行为
 * ============================================================ */
console.log('\n=== 12. 红线检查 ===');
{
  const save = fs.readFileSync(path.join(SRC, 'js', 'save.js'), 'utf8');
  /* titles 仍然是"字符串数组"的字面量初始值 */
  check(/titles:\s*\[\]/.test(save), '★ save.js 里 titles 仍是 `[]`（没改成对象数组）');
  /* reset 里确实清了 titles */
  const resetStart = save.indexOf('reset:');
  const resetBody = resetStart >= 0 ? save.slice(resetStart, resetStart + 1400) : '';
  check(/titles:\s*\[\]/.test(resetBody), '★ reset() 里仍然清 titles');
  /* 没有加时间戳字段 */
  check(!/\bat\s*:/.test(save.slice(save.indexOf('addTitle'), save.indexOf('addTitle') + 400)),
    '★ addTitle 里没有偷偷加时间戳（数据结构没变）');
}

/* ============================================================
 * 13. ★ 全局成就（2026-10-06 补到 9 个）★
 * ============================================================
 * 十一："候选成就清单补到 8~10 个"。
 * 新加的 6 个是**跨关卡的全局成就**（跑完全程 / 三星全收 / …），
 * 判定靠 `check(快照)` 而不是"每关一对一"。
 *
 * 这里重点测**判定逻辑本身**（用假快照调 check，不用起整个存档），
 * 外加"总数对得上""称号名不重复"。
 * ============================================================ */
console.log('\n=== 13. ★ 全局成就 ===');
{
  const sb5 = freshSandbox();
  const run5 = mkRun(sb5);
  run5('Save.load()');

  /* ---- 13a 表结构 ---- */
  const ga = JSON.parse(run5('JSON.stringify(GLOBAL_ACHIEVEMENTS.map(function(a){return {id:a.id,title:a.title,condition:a.condition};}))'));
  check(ga.length >= 5, '全局成就至少有 5 条（实际 ' + ga.length + '）');
  check(ga.every(function (a) { return a.title && a.condition; }), '每条都有 title 和 condition');

  /* 两张表的称号名**不能重复** —— 否则 hasTitle 会串味、数量也会错 */
  const moTitles = JSON.parse(run5('JSON.stringify(MYSTERY_ORDERS.map(function(o){return o.title;}))'));
  const gaTitles = ga.map(function (a) { return a.title; });
  const allTitles = moTitles.concat(gaTitles);
  check(new Set(allTitles).size === allTitles.length,
    '★ 两张表的称号名互不重复（共 ' + allTitles.length + ' 个）');

  /* id 也不能撞 */
  const moIds = JSON.parse(run5('JSON.stringify(MYSTERY_ORDERS.map(function(o){return o.id;}))'));
  const gaIds = ga.map(function (a) { return a.id; });
  const allIds = moIds.concat(gaIds);
  check(new Set(allIds).size === allIds.length, '★ 两张表的 id 互不重复');

  /* ---- 13b 总数函数 ---- */
  checkEq(run5('achievementTotal()'), allTitles.length, 'achievementTotal() = 两张表之和');
  check(allTitles.length >= 8 && allTitles.length <= 12,
    '★ 成就总数在 8~12 之间（十一要的 8~10 个）→ 实际 ' + allTitles.length);

  /* ---- 13c 判定逻辑（喂假快照）---- */
  /* 造一个"什么都没做"的空快照 */
  const emptySnap = {
    levels: {}, charRecords: {}, readyChars: ['kangaroo', 'dragon'],
    levelCount: 11, clearedCount: 0, totalClears: 0,
  };
  const evalCheck = function (id, snap) {
    return run5('(function(){' +
      'var a = GLOBAL_ACHIEVEMENTS.filter(function(x){return x.id===' + JSON.stringify(id) + ';})[0];' +
      'if (!a) return "NO_SUCH_ID";' +
      'return !!a.check(' + JSON.stringify(snap) + ');' +
      '})()');
  };

  checkEq(evalCheck('g_first_order', emptySnap), false, '空档：「开张大吉」未达成');
  checkEq(evalCheck('g_all_cleared', emptySnap), false, '空档：「单王」未达成');
  checkEq(evalCheck('g_all_stars', emptySnap), false, '空档：「五星骑手」未达成');
  checkEq(evalCheck('g_speed', emptySnap), false, '空档：「闪电骑手」未达成');
  checkEq(evalCheck('g_loyal', emptySnap), false, '空档：「专一骑手」未达成');
  checkEq(evalCheck('g_variety', emptySnap), false, '空档：「换着骑」未达成');
  checkEq(evalCheck('g_veteran', emptySnap), false, '空档：「全勤标兵」未达成');

  /* 通关 1 关 → 开张大吉 */
  checkEq(evalCheck('g_first_order', { levels: { '1': { cleared: true, bestStars: 1 } }, charRecords: {}, readyChars: ['kangaroo', 'dragon'], levelCount: 11, clearedCount: 1, totalClears: 1 }), true,
    '通关 1 关 → 「开张大吉」达成');

  /* 全部通关 → 单王 */
  const allCleared = { levels: {}, charRecords: {}, readyChars: ['kangaroo', 'dragon'], levelCount: 3, clearedCount: 3, totalClears: 3 };
  [1, 2, 3].forEach(function (n) { allCleared.levels[String(n)] = { cleared: true, bestStars: 1 }; });
  checkEq(evalCheck('g_all_cleared', allCleared), true, '全部通关 → 「单王」达成');
  checkEq(evalCheck('g_all_stars', allCleared), false, '★ 全通关但只有 1 星 → 「五星骑手」**不**达成（这一条最容易写成误判）');

  /* 全三星 → 五星骑手 */
  Object.keys(allCleared.levels).forEach(function (k) { allCleared.levels[k].bestStars = 3; });
  checkEq(evalCheck('g_all_stars', allCleared), true, '★ 每关都三星 → 「五星骑手」达成');

  /* 只玩过 1 关且三星 —— 不能算"五星骑手"（关卡没打全） */
  const oneStar3 = { levels: { '1': { cleared: true, bestStars: 3 } }, charRecords: {}, readyChars: ['kangaroo'], levelCount: 11, clearedCount: 1, totalClears: 1 };
  checkEq(evalCheck('g_all_stars', oneStar3), false,
    '★ 只玩过 1 关（哪怕三星）→ 「五星骑手」不达成（必须先跑完全程）');

  /* 闪电骑手：任意一关 ≤ 30 秒 */
  checkEq(evalCheck('g_speed', { levels: { '1': { cleared: true, bestTime: 30 } }, charRecords: {}, readyChars: [], levelCount: 11, clearedCount: 1, totalClears: 1 }), true,
    '★ 30 秒整 → 「闪电骑手」达成（边界值）');
  checkEq(evalCheck('g_speed', { levels: { '1': { cleared: true, bestTime: 30.01 } }, charRecords: {}, readyChars: [], levelCount: 11, clearedCount: 1, totalClears: 1 }), false,
    '★ 30.01 秒 → 不达成（边界值）');
  checkEq(evalCheck('g_speed', { levels: { '1': { cleared: true, bestTime: null } }, charRecords: {}, readyChars: [], levelCount: 11, clearedCount: 1, totalClears: 1 }), false,
    'bestTime 是 null → 不达成（不崩）');

  /* 专一骑手：某角色 uses ≥ 10 */
  checkEq(evalCheck('g_loyal', { levels: {}, charRecords: { kangaroo: { uses: 10, levels: {} } }, readyChars: ['kangaroo'], levelCount: 11, clearedCount: 0, totalClears: 10 }), true,
    '★ 某骑手送达 10 单 → 「专一骑手」达成');
  checkEq(evalCheck('g_loyal', { levels: {}, charRecords: { kangaroo: { uses: 9 }, dragon: { uses: 2 } }, readyChars: [], levelCount: 11, clearedCount: 0, totalClears: 11 }), false,
    '★ 最多只有 9 单 → 不达成（不是看总数）');

  /* 换着骑：每个 ready 角色都 ≥ 1 */
  checkEq(evalCheck('g_variety', { levels: {}, charRecords: { kangaroo: { uses: 5 }, dragon: { uses: 1 } }, readyChars: ['kangaroo', 'dragon'], levelCount: 11, clearedCount: 0, totalClears: 6 }), true,
    '两个骑手都出战过 → 「换着骑」达成');
  checkEq(evalCheck('g_variety', { levels: {}, charRecords: { kangaroo: { uses: 9 } }, readyChars: ['kangaroo', 'dragon'], levelCount: 11, clearedCount: 0, totalClears: 9 }), false,
    '★ 只骑过其中一个 → 不达成');
  checkEq(evalCheck('g_variety', { levels: {}, charRecords: {}, readyChars: [], levelCount: 11, clearedCount: 0, totalClears: 0 }), false,
    '★ readyChars 为空 → 不达成（不能"一个角色都没有"就算全骑过）');

  /* 全勤标兵：totalClears ≥ 20 */
  checkEq(evalCheck('g_veteran', { levels: {}, charRecords: {}, readyChars: [], levelCount: 11, clearedCount: 0, totalClears: 20 }), true,
    '累计 20 单 → 「全勤标兵」达成');
  checkEq(evalCheck('g_veteran', { levels: {}, charRecords: {}, readyChars: [], levelCount: 11, clearedCount: 0, totalClears: 19 }), false,
    '★ 累计 19 单 → 不达成（边界）');

  /* ---- 13d 快照函数本身 ---- */
  const snapEmpty = JSON.parse(run5('JSON.stringify(achievementSnapshot())'));
  check(typeof snapEmpty.levelCount === 'number' && snapEmpty.levelCount > 0, 'achievementSnapshot() 返回合法 levelCount（' + snapEmpty.levelCount + '）');
  check(Array.isArray(snapEmpty.readyChars) && snapEmpty.readyChars.length > 0, '快照里的 readyChars 非空（' + snapEmpty.readyChars.join(',') + '）');

  /* ---- 13e 通关后统一判定（checkGlobalAchievements 不崩、能返回数组）---- */
  let err = null, res = null;
  try {
    run5('Save.reset()');
    res = run5('JSON.stringify(checkGlobalAchievements())');
  } catch (e) { err = e.message; }
  check(err === null, 'checkGlobalAchievements() 不抛异常' + (err ? '（实际: ' + err + '）' : ''));
  check(Array.isArray(JSON.parse(res || 'null')), 'checkGlobalAchievements() 返回数组');

  /* ---- 13f 判定出错不能影响通关（坏快照）---- */
  let err2 = null;
  try {
    run5('(function(){' +
      'var a = GLOBAL_ACHIEVEMENTS[0];' +
      'var r = a.check({});' +          // ← 空对象，字段全 undefined
      'return r;' +
      '})()');
  } catch (e) { err2 = e.message; }
  check(err2 === null, '★ check() 收到空快照也不抛异常（容错）');
}

/* ============================================================
 * 14. ★ 成就页要能展示两张表（源码级）★
 * ============================================================ */
console.log('\n=== 14. ★ 成就页合并展示两张表 ===');
{
  const ui2 = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');
  const fnStart = ui2.indexOf('function buildAchievements');
  let body = '';
  if (fnStart >= 0) {
    let i = ui2.indexOf('{', fnStart), depth = 0, end = -1;
    for (; i < ui2.length; i++) {
      if (ui2[i] === '{') depth++;
      else if (ui2[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    body = ui2.slice(fnStart, end + 1);
  }
  check(/MYSTERY_ORDERS/.test(body), '成就页读了 MYSTERY_ORDERS');
  check(/GLOBAL_ACHIEVEMENTS/.test(body), '★ 成就页也读了 GLOBAL_ACHIEVEMENTS（两张表合并）');
  check(/progress/.test(body), '★ 支持显示进度（如 5 / 20）');

  /* 通关处必须接了全局判定，而且要在 recordClear **之后** */
  const gj = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  const iRec = gj.indexOf('SAVE().recordClear(');
  const iChk = gj.indexOf('checkGlobalAchievements()');
  check(iChk > 0, '★ 通关处调用了 checkGlobalAchievements()');
  check(iChk > iRec, '★ 判定在 recordClear() **之后**（否则"跑完全程"会永远差最后一关）');
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('  成就系统测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);
