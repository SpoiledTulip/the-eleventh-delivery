/* ============================================================
 * capybara-role-test.js — 第三个角色的 role 分发回归测试
 * ============================================================
 * 【为什么要有这个测试】
 *   项目里原来到处写 `Game.pickRole === 'dragon' ? 'dragon' : 'kangaroo'`
 *   这种**二元三元表达式**。加第三个角色（卡皮巴拉）时，
 *   这种写法会把卡皮巴拉强制判成袋鼠 —— 表现是"选了卡皮巴拉却玩到袋鼠"。
 *
 *   2026-10-06 已经把全部二元分发改成 roleOfSelection()。
 *   这个测试守住三件事，防止以后有人改回二元：
 *     ① roleOfSelection() 对任何输入都返回合法 role（绝不 undefined/空）
 *     ② 选中卡皮巴拉后，进关生成的角色**真的是** capybara（含 sprite、出生点）
 *     ③ 两个老角色没被改坏
 *
 * ⚠️ 还要守住"零剧透"：新档不许看得见卡皮巴拉。
 *    （那部分由 unlock-test 的 H 节深度覆盖，这里只做一个冒烟检查。）
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
const problems = [];
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; problems.push(msg); }
}

/* ---------- 沙箱 ---------- */
function mkEl() {
  const e = {
    style: {}, className: '', innerHTML: '', innerText: '', textContent: '', id: '',
    children: [], appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    getContext() {
      return {
        save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        quadraticCurveTo() {}, arc() {}, ellipse() {}, rect() {},
        fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, clearRect() {},
        fillText() {}, strokeText() {}, measureText() { return { width: 10 }; },
        createRadialGradient() { return { addColorStop() {} }; },
        createLinearGradient() { return { addColorStop() {} }; },
        drawImage() {}, getImageData() { return { data: [] }; },
        setTransform() {}, clip() {}, setLineDash() {},
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', textBaseline: '', lineCap: '', imageSmoothingEnabled: false,
      };
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    focus() {}, blur() {}, click() {},
  };
  Object.defineProperty(e, 'width', { value: 1280, writable: true });
  Object.defineProperty(e, 'height', { value: 720, writable: true });
  return e;
}

function buildSandbox() {
  let store = {};
  const fakeLS = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { store = {}; },
  };
  const doc = {
    getElementById: () => mkEl(), querySelector: () => mkEl(),
    querySelectorAll: () => [], createElement: () => mkEl(),
    body: mkEl(), documentElement: mkEl(), head: mkEl(),
    addEventListener() {}, removeEventListener() {},
  };
  const sb = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean,
    Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat,
    Infinity, NaN, undefined, Map, Set, Promise, RegExp, Symbol,
    document: doc, window: null, localStorage: fakeLS,
    performance: { now: () => Date.now() },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    navigator: { userAgent: 'node', maxTouchPoints: 0 },
    location: { href: '', search: '', reload() {} },
    alert: () => {}, prompt: () => null, confirm: () => true,
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
    Image: function () { return mkEl(); },
    Audio: function () { return { play() {}, pause() {}, cloneNode() { return this; } }; },
    TouchEvent: function () {}, MouseEvent: function () {}, KeyboardEvent: function () {},
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

function loadAll(sb) {
  ['physics.js', 'sprites.js', 'save.js', 'characters.js', 'device-mode.js',
   'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'actions.js', 'thunder.js'].forEach(function (f) {
    const p = path.join(SRC, 'js', f);
    if (!fs.existsSync(p)) return;
    vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f });
  });
  /* game.js 依赖的外部桩 */
  vm.runInContext(`
    var UI = { root: null, lastKey: '', panel: null };
    var Net = { role: 'host', localInput: {}, notifyInputChanged: function(){} };
    var Sound = {
      bridge: function(){}, button: function(){}, checkpoint: function(){},
      coin: function(){}, coinShort: function(){}, crash: function(){},
      die: function(){}, door: function(){}, doubleJump: function(){},
      explode: function(){}, fuse: function(){}, hurt: function(){},
      jump: function(){}, land: function(){}, spring: function(){},
      stomp: function(){}, win: function(){}, dash: function(){},
    };
    function hideUI(){}
    function showGameNotice(){}
    function spawnFloatText(){}
    function syncUI(){}
  `, sb);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8'), sb, { filename: 'game.js' });
  /* ⚠️ 不要在这里再声明 `var Save` —— save.js 里已经有了
   *    （重复声明会报 "Identifier 'Save' has already been declared"）。
   *    直接用 SAVE() 取单例即可。 */
  return sb;
}

const sb = loadAll(buildSandbox());
const run = e => vm.runInContext(e, sb);

console.log('='.repeat(58));
console.log('  卡皮巴拉 · role 分发回归测试');
console.log('='.repeat(58));

/* ============================================================
 * A. roleOfSelection：任何输入都返回合法 role
 * ============================================================ */
console.log('\n--- A. roleOfSelection 的健壮性 ---');
{
  const legal = ['kangaroo', 'dragon', 'capybara'];

  check(run('typeof roleOfSelection') === 'function', 'roleOfSelection 存在（统一取值入口）');

  /* 正常取值 */
  check(run("roleOfSelection('capybara')") === 'capybara', "roleOfSelection('capybara') → capybara");
  check(run("roleOfSelection('kangaroo')") === 'kangaroo', "roleOfSelection('kangaroo') → kangaroo");
  check(run("roleOfSelection('dragon')") === 'dragon', "roleOfSelection('dragon') → dragon");

  /* ★ 红线：非法输入必须兜底，绝不返回 undefined / 空串 ★ */
  const bad = run(`(function(){
    var out = [];
    var inputs = [undefined, null, '', 'nope', 'CAT', 0, -1, {}, [], NaN, 'fourth_rider'];
    for (var i = 0; i < inputs.length; i++){
      out.push(roleOfSelection(inputs[i]));
    }
    return out;
  })()`);
  const allLegal = bad.every(function (r) { return legal.indexOf(r) >= 0; });
  check(allLegal, '非法输入（undefined/null/空串/未知 id/数字/对象/数组）一律兜底到合法 role');
  check(bad.indexOf(undefined) < 0 && bad.indexOf('') < 0 && bad.indexOf(null) < 0,
    '★ 绝不返回 undefined / null / 空字符串（实际: ' + JSON.stringify(bad) + '）');

  /* 未知 id 兜底到 kangaroo（这是约定） */
  check(run("roleOfSelection('nope')") === 'kangaroo', "未知 id 兜底到 'kangaroo'");

  /* ★ 2026-10-06 改成**动态断言**（原来写死"正好四个"）★
   * ------------------------------------------------------------
   * 加美团猴子时白名单变成 5 个，写死的数字就误报了。
   *
   * 这里真正要守的是**两条**（写死数字反而守不住）：
   *   ① 白名单包含所有"已制作"角色的 role
   *   ② 白名单里**没有多余项**（不许出现已经删掉的角色）
   *
   * ⚠️ 而且 VALID_ROLES 现在**从 CHARACTERS 自动派生**了
   *    （见 characters.js 里的说明）—— 加角色忘了改白名单
   *    导致"选了猴子却是袋鼠"的那个坑，已经从根上堵死。 */
  const wl = run('VALID_ROLES.slice()');
  const wantRoles = run('CHARACTERS.map(function(c){ return c.role; })');
  const missing = wantRoles.filter(function (r) { return wl.indexOf(r) < 0; });
  const extra = wl.filter(function (r) { return wantRoles.indexOf(r) < 0; });
  check(missing.length === 0,
    '★ 白名单覆盖所有角色（当前 ' + wl.length + ' 个：' + wl.join(',') + '）' +
    (missing.length ? '  ← 漏了 ' + missing.join(',') : ''));
  check(extra.length === 0,
    '★ 白名单没有多余项（都对应真实角色）' +
    (extra.length ? '  ← 多了 ' + extra.join(',') : ''));
  check(wl.length === wantRoles.length,
    '★ 白名单数量 = 角色表数量（' + wl.length + '，自动派生所以必然一致）');
}

/* ============================================================
 * B. 选中卡皮巴拉 → 进关生成的角色真的是卡皮巴拉
 * ============================================================ */
console.log('\n--- B. 选中卡皮巴拉后进关 ---');
{
  run(`
    Game.skipWeatherBrief = true;
    Game.mode = 'single'; Game.playerCount = 1;
    Save.setMode('classic');
  `);
  /* 先把卡皮巴拉解锁出来（它 unlockLevel = 10） */
  run('Save.unlockChar("capybara");');
  const setOk = run('Save.setSelectedChar("capybara")');
  check(setOk === true, '能把卡皮巴拉设为选中角色');

  run('loadLevel(0);');
  const p = run(`(function(){
    var pl = Game.players[0];
    return {
      role: pl.role, charId: pl.charId, name: pl.name,
      isCapySprite: (typeof SPR_CAPYBARA !== 'undefined') && pl.sprite === SPR_CAPYBARA,
      hasSprite: pl.sprite !== undefined && pl.sprite !== null,
      x: pl.x, y: pl.y,
      speedMul: pl.speedMul, wallMul: pl.wallStaminaMul,
      inBounds: pl.x > 0 && pl.y > 0 && pl.y < 2000
    };
  })()`);
  check(p.role === 'capybara', '★ 进关后 role 就是 capybara（没有被二元的"猜三元"吃掉）');
  check(p.charId === 'capybara', 'charId 是 capybara');
  check(p.name === '卡皮巴拉', '显示名是「卡皮巴拉」（实际 ' + p.name + '）');
  check(p.isCapySprite, '★ sprite 是 SPR_CAPYBARA（不是袋鼠/飞龙贴图）');
  check(p.hasSprite, 'sprite 有值（不是 undefined —— 那会让角色完全不显示）');
  check(p.inBounds, '出生点合法，被正常生成进关卡（x=' + p.x + ' y=' + p.y + '）');

  /* 手感倍率（卡皮巴拉的定位：抓墙超人、地面稍慢） */
  check(Math.abs(p.wallMul - 1.6) < 0.001,
    '★ 抓墙倍率 1.6（挂墙最稳，它的核心定位）实际 ' + p.wallMul);
  check(Math.abs(p.speedMul - 0.95) < 0.001,
    '★ 跑速倍率 0.95（地面稍慢）实际 ' + p.speedMul);

  /* 能跑起来（不卡死） */
  const moved = run(`(function(){
    var pl = Game.players[0];
    var x0 = pl.x;
    for (var f = 0; f < 120; f++){
      InputState.now = {}; InputState.now['ArrowRight'] = true;
      update(1/60); InputState.tick();
    }
    return Math.round(pl.x - x0);
  })()`);
  check(moved > 10, '进关后能正常跑动（120 帧移动 ' + moved + 'px）');
  check(run('Game.state') === 'playing', '游戏状态正常（playing）');
}

/* ============================================================
 * C. 两个老角色没被改坏
 * ============================================================ */
console.log('\n--- C. 现有两个角色不受影响 ---');
{
  const cases = [
    { id: 'kangaroo', name: '美团袋鼠' },
    { id: 'dragon', name: '飞龙宝宝' },
  ];
  cases.forEach(function (cs) {
    run('Save.setSelectedChar("' + cs.id + '");');
    run('loadLevel(0);');
    const r = run(`(function(){
      var pl = Game.players[0];
      var x0 = pl.x;
      for (var f = 0; f < 90; f++){
        InputState.now = {}; InputState.now['ArrowRight'] = true;
        update(1/60); InputState.tick();
      }
      return { role: pl.role, name: pl.name, sprite: !!pl.sprite,
               moved: Math.round(pl.x - x0), state: Game.state };
    })()`);
    check(r.role === cs.id && r.name === cs.name && r.sprite && r.moved > 10,
      cs.name + ' 仍正常（role=' + r.role + ' 移动' + r.moved + 'px 状态=' + r.state + '）');
  });
}

/* ============================================================
 * D. 零剧透冒烟检查（新档看不见卡皮巴拉）
 * ============================================================ */
console.log('\n--- D. 零剧透（冒烟） ---');
{
  /* 造一个全新存档 */
  const sb2 = loadAll(buildSandbox());
  const run2 = e => vm.runInContext(e, sb2);
  const vis = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis.length === 2 && vis.indexOf('capybara') < 0,
    '新档只能看见 2 个角色（' + JSON.stringify(vis) + '）');
  /* ★ 2026-10-06 改成动态断言（原来写死 === 4）★
   * 原因：加了第 5 个角色（美团猴子）之后，写死的数字会误报警。
   * 这里真正要守的是**两条**：
   *   ① 已制作角色 ≥ 4（后面那几位确实做完了）
   *   ② **已制作 > 新档可见**（说明"做完了但还没解锁"这个机制成立）
   * 写成动态的，以后再加角色就不用改这个测试。 */
  const madeCount = run2('listForLibrary().length');
  check(madeCount >= 4,
    '「已制作」有 ' + madeCount + ' 个（卡皮巴拉 / 史迪奇 / 猴子确实做完了）');
  check(madeCount > vis.length,
    '「已制作」(' + madeCount + ') > 新档可见 (' + vis.length + ') —— 零剧透机制成立');

  /* 先通关到第 11 关 → 史迪奇出现（unlockLevel=11） */
  run2('for (var i = 0; i < 11; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis1 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis1.indexOf('stitch') >= 0,
    '通关第 11 关后史迪奇出现（' + JSON.stringify(vis1) + '）');

  /* 逐关通关到第 10 关 → 卡皮巴拉出现 */
  run2('for (var i = 0; i < 10; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis2 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis2.indexOf('capybara') >= 0,
    '通关第 10 关后卡皮巴拉出现（' + JSON.stringify(vis2) + '）');

  /* ★ 源码检查：角色库渲染不许用 listForLibrary ★
   * ⚠️ 必须**先剔除注释**再查 —— ui.js 的注释里正好在解释
   *    "不要用 listForLibrary / 已删除 paintCharSilhouette"，
   *    直接 indexOf 会把说明文字误判成违规代码（第一次就踩了这个）。
   * ⇒ 用"去掉块注释和行注释"后的源码来查。 */
  const rawUi = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');
  const codeOnly = rawUi
    .replace(/\/\*[\s\S]*?\*\//g, '')      // 去块注释
    .replace(/^\s*\/\/.*$/gm, '');           // 去行注释

  /* ⚠️ PK 页（buildPkPick）的 AI 对手池用 listForLibrary() 是**合法**的
   *    —— 见 unlock-test.js 的同类豁免说明。这里先把该函数体挖掉再查。 */
  const uiLinesAll = codeOnly.split('\n');
  const pkStart = uiLinesAll.findIndex(function (l) { return l.indexOf('function buildPkPick(') >= 0; });
  let pkEnd = uiLinesAll.length;
  for (let i = pkStart + 1; i < uiLinesAll.length; i++) {
    if (/^function\s+[A-Za-z_$]/.test(uiLinesAll[i])) { pkEnd = i; break; }
  }
  const uiCodeNoPk = (pkStart >= 0)
    ? uiLinesAll.slice(0, pkStart).concat(uiLinesAll.slice(pkEnd)).join('\n')
    : codeOnly;

  check(uiCodeNoPk.indexOf('listForLibrary') < 0,
    '★ ui.js 的角色渲染代码里没有 listForLibrary 调用（PK 页 AI 池豁免）');
  check(uiCodeNoPk.indexOf('paintCharSilhouette') < 0,
    '★ ui.js 的代码里不再有角色剪影绘制（黑影/问号属于剧透）');
}

console.log('\n' + '='.repeat(58));
console.log('  role 分发回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(58));
if (fail > 0) process.exit(1);
