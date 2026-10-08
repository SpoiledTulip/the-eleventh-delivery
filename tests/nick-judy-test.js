/* ============================================================
 * nick-judy-test.js — 尼克（狐狸）/ 朱迪（兔子）回归测试
 * ============================================================
 * 十一要求：第 25 关解锁尼克、第 30 关解锁朱迪。
 * （25/30 关还没做，先把角色备好。）
 *
 * 这两个角色各自**新开了一个能力维度**，所以测试的重点是
 * "**配了到底有没有生效**" —— 项目里踩过这个坑：
 * 猴子加 wallJumpMultiplier 时配好了但没接进 actions.js，
 * 变成"死数据"（配了不生效、还不报错）。
 *
 *   尼克 = doubleJumpMultiplier（二段跳力度）→ 要改 3 处
 *   朱迪 = dashMaxBonus（冲刺次数 +1）      → 要改 3 处
 *
 * 所以这里逐条验证：
 *   ① 配置正确（名字 / sprite / ready / unlockLevel 25、30）
 *   ② 新维度**真的进了玩家对象**（doubleJumpMul / dashBonus）
 *   ③ 新维度**真的影响了物理**（二段跳更高 / 冲刺发数变 2）
 *   ④ HUD 显示的上限也跟着变（朱迪要画 2 格冲刺）
 *   ⑤ 老角色完全不受影响（doubleJumpMul=1、dashBonus=0）
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
   'levels.js', 'actions.js', 'thunder.js'].forEach(function (f) {
    const p = path.join(SRC, 'js', f);
    if (!fs.existsSync(p)) return;
    vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f });
  });
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
      capyJump: function(){}, capyLand: function(){},
      stitchJump: function(){}, stitchLand: function(){},
    };
    function hideUI(){}
    function showGameNotice(){}
    function spawnFloatText(){}
    function syncUI(){}
  `, sb);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8'), sb, { filename: 'game.js' });
  return sb;
}

const sb = loadAll(buildSandbox());
const run = e => vm.runInContext(e, sb);

console.log('='.repeat(58));
console.log('  尼克（狐狸）/ 朱迪（兔子）· 角色回归测试');
console.log('='.repeat(58));

/* ============================================================
 * A. 配置正确性
 * ============================================================ */
console.log('\n--- A. 角色配置 ---');
{
  const cases = [
    { id: 'nick', name: '尼克', unlock: 25 },
    { id: 'judy', name: '朱迪', unlock: 30 },
  ];
  cases.forEach(function (cs) {
    const cfg = JSON.parse(run('JSON.stringify(charById("' + cs.id + '"))'));
    check(!!cfg, 'charById("' + cs.id + '") 能找到配置');
    if (!cfg) return;
    check(cfg.name === cs.name, cs.name + '：显示名正确（' + cfg.name + '）');
    check(cfg.role === cs.id, cs.name + '：role = ' + cs.id);
    check(cfg.sprite === cs.id, cs.name + '：sprite = ' + cs.id);
    check(cfg.ready === true, cs.name + '：ready=true（能进角色库）');
    check(cfg.unlockLevel === cs.unlock,
      cs.name + '：★ 解锁 = 通关第 ' + cs.unlock + ' 关（实际 ' + cfg.unlockLevel + '）');
    check(cfg.unlockedByDefault === false, cs.name + '：初始不直接解锁');
    check(/^#[0-9a-fA-F]{6}$/.test(cfg.accentColor),
      cs.name + '：主题色合法（' + cfg.accentColor + '）');
    check(!!cfg.tagline && !!cfg.description, cs.name + '：有人设文案（tagline + description）');
    check(Array.isArray(cfg.weaknesses) && cfg.weaknesses.length > 0,
      cs.name + '：有明确弱点（平衡要求）');
  });
}

/* ============================================================
 * B. 新维度真的进了玩家对象（防"配了不生效"）
 * ============================================================ */
console.log('\n--- B. 新能力维度已接入 ---');
{
  run('Game.skipWeatherBrief = true; Game.mode = "single"; Game.playerCount = 1; Save.setMode("classic");');

  /* 尼克：doubleJumpMul */
  run('Save.unlockChar("nick"); Save.setSelectedChar("nick");');
  run('loadLevel(0);');
  const nickMul = run('Game.players[0].doubleJumpMul');
  check(Math.abs(nickMul - 1.5) < 0.001,
    '★★ 尼克进关后 doubleJumpMul = 1.5（真的挂到了玩家对象上）实际 ' + nickMul);

  /* 朱迪：dashBonus */
  run('Save.unlockChar("judy"); Save.setSelectedChar("judy");');
  run('loadLevel(0);');
  const judyBonus = run('Game.players[0].dashBonus');
  check(judyBonus === 1,
    '★★ 朱迪进关后 dashBonus = 1（真的挂到了玩家对象上）实际 ' + judyBonus);

  /* 老角色不能受影响 */
  const cases = [
    { id: 'kangaroo', name: '袋鼠' },
    { id: 'dragon', name: '飞龙' },
    { id: 'capybara', name: '卡皮巴拉' },
    { id: 'stitch', name: '史迪奇' },
    { id: 'monkey', name: '猴子' },
    { id: 'fish', name: '小鱼' },
    { id: 'puppy', name: '小狗' },
    { id: 'lamb', name: '小羊' },
  ];
  let allOldOk = true, detail = [];
  cases.forEach(function (cs) {
    run('Save.unlockChar("' + cs.id + '"); Save.setSelectedChar("' + cs.id + '");');
    run('loadLevel(0);');
    const r = run('JSON.stringify({dj: Game.players[0].doubleJumpMul, db: Game.players[0].dashBonus})');
    const o = JSON.parse(r);
    if (o.dj !== 1 || o.db !== 0) { allOldOk = false; detail.push(cs.name + '(dj=' + o.dj + ',db=' + o.db + ')'); }
  });
  check(allOldOk,
    '★★ 8 个老角色都不受新字段影响（doubleJumpMul=1、dashBonus=0）' +
    (detail.length ? ' — 异常: ' + detail.join(', ') : ''));
}

/* ============================================================
 * C. ★ 新维度真的影响物理（最关键）
 * ============================================================ */
console.log('\n--- C. 能力真的生效（物理层） ---');
{
  /* ---- 尼克的二段跳应该比袋鼠更高 ---- */
  /* ============================================================
   * 【测量方法为什么改了三版（记下来别再踩）】
   *   ① 第一版读"某一帧的 vy" → 时机对不准，读到 0
   *   ② 第二版测"实际跳跃高度" → 只有 40px，远小于理论 101px。
   *      原因：**第 1 关是室内关，出生点上方就是砖**，
   *      角色一跳就撞头 —— 而且我清 `lv.solids` 也清不干净
   *      （还有 platforms 等其它碰撞源）。
   *   ③ ✅ 最终版：**直接读"二段跳触发那一帧的 vy"**。
   *      这个值由 `p.vy = JUMP_POWER × jumpMul × DOUBLE_JUMP_MUL × doubleJumpMul`
   *      算出，**完全不受地形影响**，是"能力差异"最纯净的证据。
   *      用 `p.doubleJumped` 标志捕捉那一帧。
   * ============================================================ */
  function doubleJumpVy(roleId) {
    run('Save.unlockChar("' + roleId + '"); Save.setSelectedChar("' + roleId + '");');
    run('loadLevel(0);');
    return run(`(function(){
      var pl = Game.players[0];
      /* 让它先落地（出生瞬间是悬空的） */
      for (var f = 0; f < 60; f++){ InputState.clear(); update(1/60); InputState.tick(); }

      var captured = null;
      for (var f = 0; f < 200; f++){
        var jlBefore = pl.jumpsLeft;
        var airBefore = !pl.onGround;
        /* ⚠️ 时机很重要：第 1 关空间小，第一跳很快就落地了。
         *    原来在第 40 帧按第二跳，那时人已经落地 → 永远抓不到。
         *    ⇒ 改成第 18 帧（第一跳刚起、肯定还在空中）。 */
        if (f === 5)  { InputState.setKey('Space', true); }
        if (f === 7)  { InputState.setKey('Space', false); }
        if (f === 18) { InputState.setKey('Space', true); }
        if (f === 20) { InputState.setKey('Space', false); }
        update(1/60); InputState.tick();
        if (airBefore && jlBefore > 0 && pl.jumpsLeft < jlBefore && captured === null) {
          captured = pl.vy;
        }
      }
      return (captured === null) ? null : Math.round(Math.abs(captured) * 100) / 100;
    })()`);
  }

  /* ⚠️ 二段跳要"通关第 1 关"后才解锁，所以先把动作放出来 */
  run('(function(){ try { Save.data.unlockedActions = ["dash","doublejump","walljump","wallslide"]; Save.data.maxUnlocked = 99; } catch(e){} })()');

  const nickVy = doubleJumpVy('nick');
  const kangVy = doubleJumpVy('kangaroo');
  check(nickVy !== null && kangVy !== null,
    '★ 两个角色都成功触发了二段跳（尼克 ' + nickVy + ' / 袋鼠 ' + kangVy + '）');
  check(nickVy > kangVy,
    '★★ 尼克二段跳初速 > 袋鼠（尼克 ' + nickVy + ' vs 袋鼠 ' + kangVy + '）');
  const ratio = nickVy / kangVy;
  /* ⚠️ 为什么阈值是 130% 而不是 150%：
   *    二段跳公式是 `JUMP_POWER × jumpMul × 0.9 × doubleJumpMul`。
   *      · 尼克：jumpMul=1.0、doubleJumpMul=1.5 → 11.2 × 1.0 × 0.9 × 1.5 = 15.12
   *      · 袋鼠：jumpMul=1.12、doubleJumpMul=1.0 → 11.2 × 1.12 × 0.9 × 1.0 = 11.29
   *    比值 15.12/11.29 ≈ **134%**（尼克并不因为二段跳强就高过袋鼠，袋鼠第一跳也强）。
   *    所以这里校验"至少比袋鼠高二段跳 30% 以上"这个真实设计值。 */
  check(ratio > 1.25,
    '★★ 提升幅度合理（实际 ' + Math.round(ratio * 100) + '%，应 ≥125%）');

  /* 同时验证：尼克的第一跳**没有**加成（定位是"第二跳强"） */
  const nickFirst = run(`(function(){
    Save.unlockChar("nick"); Save.setSelectedChar("nick"); loadLevel(0);
    var pl = Game.players[0];
    for (var f = 0; f < 60; f++){ InputState.clear(); update(1/60); InputState.tick(); }
    var captured = null;
    for (var f = 0; f < 80; f++){
      var wasGround = pl.onGround;
      if (f === 10) { InputState.setKey('Space', true); }
      if (f === 12) { InputState.setKey('Space', false); }
      update(1/60); InputState.tick();
      if (wasGround && !pl.onGround && captured === null) captured = pl.vy;
    }
    return (captured === null) ? null : Math.round(Math.abs(captured) * 100) / 100;
  })()`);
  const kangFirst = run(`(function(){
    Save.unlockChar("kangaroo"); Save.setSelectedChar("kangaroo"); loadLevel(0);
    var pl = Game.players[0];
    for (var f = 0; f < 60; f++){ InputState.clear(); update(1/60); InputState.tick(); }
    var captured = null;
    for (var f = 0; f < 80; f++){
      var wasGround = pl.onGround;
      if (f === 10) { InputState.setKey('Space', true); }
      if (f === 12) { InputState.setKey('Space', false); }
      update(1/60); InputState.tick();
      if (wasGround && !pl.onGround && captured === null) captured = pl.vy;
    }
    return (captured === null) ? null : Math.round(Math.abs(captured) * 100) / 100;
  })()`);
  /* 袋鼠第一跳 ×1.12、尼克第一跳 ×1.0 → 袋鼠应该略高 */
  check(nickFirst !== null && kangFirst !== null && kangFirst > nickFirst,
    '★★ 尼克的第一跳**不如**袋鼠（' + nickFirst + ' vs ' + kangFirst +
    '）—— 印证"强在第二跳，不是全面变强"');

  /* ---- 朱迪的冲刺发数应该是 2 ---- */
  run('Save.unlockChar("judy"); Save.setSelectedChar("judy");');
  run('loadLevel(0);');
  const judyMax = run('(typeof ACTIONS !== "undefined" && ACTIONS.dashesMax) ? ACTIONS.dashesMax(Game.players[0]) : -1');
  check(judyMax === 2, '★★ 朱迪的冲刺上限 = 2 发（实际 ' + judyMax + '）');

  run('Save.unlockChar("kangaroo"); Save.setSelectedChar("kangaroo");');
  run('loadLevel(0);');
  const kangMax = run('(typeof ACTIONS !== "undefined" && ACTIONS.dashesMax) ? ACTIONS.dashesMax(Game.players[0]) : -1');
  check(kangMax === 1, '★ 袋鼠的冲刺上限仍是 1 发（实际 ' + kangMax + '）');

  run('Save.unlockChar("stitch"); Save.setSelectedChar("stitch");');
  run('loadLevel(0);');
  const stitchMax = run('(typeof ACTIONS !== "undefined" && ACTIONS.dashesMax) ? ACTIONS.dashesMax(Game.players[0]) : -1');
  check(stitchMax === 1,
    '★ 史迪奇仍是 1 发（它是"冲得远"，不是"冲得多"，两个维度不混）实际 ' + stitchMax);

  /* ---- 朱迪进关后实际拿到的冲刺次数 ---- */
  run('Save.unlockChar("judy"); Save.setSelectedChar("judy");');
  run('loadLevel(0);');
  const judyLeft = run('Game.players[0].actDashes');
  check(judyLeft === 2, '★ 朱迪进关后 actDashes = 2（初始就是 2 发）实际 ' + judyLeft);
}

/* ============================================================
 * D. 解锁节点
 * ============================================================ */
console.log('\n--- D. 解锁节点（第 25 / 30 关） ---');
{
  const sb2 = loadAll(buildSandbox());
  const run2 = e => vm.runInContext(e, sb2);

  const vis0 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis0.indexOf('nick') < 0 && vis0.indexOf('judy') < 0,
    '新档看不见尼克和朱迪（' + JSON.stringify(vis0) + '）');

  /* 通关到 24 关 → 尼克还没解锁 */
  run2('for (var i = 0; i < 24; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis24 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis24.indexOf('nick') < 0, '通关 24 关时尼克还没解锁');

  /* 通关第 25 关 → 尼克 */
  run2('SAVE().recordClear(24, 30, 10, 10, "kangaroo");');
  const vis25 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis25.indexOf('nick') >= 0, '★ 通关第 25 关后尼克出现');
  check(vis25.indexOf('judy') < 0, '通关第 25 关时朱迪还没解锁');

  /* 通关到第 30 关 → 朱迪 */
  run2('for (var i = 25; i < 30; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis30 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis30.indexOf('judy') >= 0, '★ 通关第 30 关后朱迪出现');
}

/* ============================================================
 * E. 贴图与打包清单
 * ============================================================ */
console.log('\n--- E. 贴图资源 ---');
{
  ['nick', 'judy'].forEach(function (r) {
    const p = path.join(SRC, 'assets', r + '.png');
    check(fs.existsSync(p), r + '.png 存在于 src/assets/');
  });

  const spriteSrc = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
  check(spriteSrc.indexOf("src: 'assets/nick.png'") >= 0, "sprites.js 注册了 nick.png");
  check(spriteSrc.indexOf("src: 'assets/judy.png'") >= 0, "sprites.js 注册了 judy.png");

  const buildSrc = fs.readFileSync(path.join(PROJ, 'tools', 'build-single.js'), 'utf8');
  check(buildSrc.indexOf("'nick.png'") >= 0,
    "build-single.js 的 imgFiles 含 nick.png（否则单文件版缺图）");
  check(buildSrc.indexOf("'judy.png'") >= 0,
    "build-single.js 的 imgFiles 含 judy.png");
}

/* ============================================================
 * F. 源码级防线（防止以后有人改回去）
 * ============================================================ */
console.log('\n--- F. 源码级防线 ---');
{
  const gameSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  /* 两处二段跳都要乘 doubleJumpMul */
  const djHits = (gameSrc.match(/DOUBLE_JUMP_MUL \* \(p\.doubleJumpMul \|\| 1\)/g) || []).length;
  check(djHits === 2,
    '★★ game.js 的**两处**二段跳都乘了 doubleJumpMul（实际 ' + djHits + ' 处，应为 2）');

  const actSrc = fs.readFileSync(path.join(SRC, 'js', 'actions.js'), 'utf8');
  check(actSrc.indexOf('function actDashMax') >= 0, 'actions.js 定义了 actDashMax');
  check(actSrc.indexOf('p.actDashes = actDashMax(p)') >= 0,
    'actions.js 的落地补满走了 actDashMax（不是写死全局值）');
  check(actSrc.indexOf('dashesMax:') >= 0, 'ACTIONS 暴露了 dashesMax 查询接口');

  const renderSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(renderSrc.indexOf('ACTIONS.dashesMax') >= 0,
    'render.js 的 HUD 用 dashesMax 画格子（朱迪才会显示 2 格）');
}

console.log('\n' + '='.repeat(58));
console.log('  尼克 / 朱迪回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(58));
if (fail > 0) process.exit(1);
