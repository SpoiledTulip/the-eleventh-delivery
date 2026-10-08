/* ============================================================
 * new-roles-test.js — 第三章三个新角色（小鱼 / 小狗 / 小羊）回归测试
 * ============================================================
 * 守住四件事：
 *   ① 三个角色的配置正确（名字 / sprite / ready / unlockLevel）
 *   ② 定位不重复：小鱼=最快、小狗=全能无短板、小羊=墙跳最高
 *   ③ 选中后进关，生成的角色**真的是**它们（role / name / sprite 有值）
 *   ④ 解锁节点：小鱼=14、小狗=17、小羊=20
 *
 * ⚠️ 沙箱骨架复制自 stitch-role-test.js。
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
   'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'actions.js', 'thunder.js'].forEach(function (f) {
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
console.log('  第三章新角色 · 小鱼 / 小狗 / 小羊 回归测试');
console.log('='.repeat(58));

/* ============================================================
 * A. 三个角色的配置
 * ============================================================ */
console.log('\n--- A. 角色配置 ---');
{
  const cases = [
    { id: 'fish',  name: '小鱼', unlock: 14 },
    { id: 'puppy', name: '小狗', unlock: 17 },
    { id: 'lamb',  name: '小羊', unlock: 20 },
  ];
  cases.forEach(function (cs) {
    const cfg = JSON.parse(run('JSON.stringify(charById("' + cs.id + '"))'));
    check(!!cfg, 'charById("' + cs.id + '") 能找到配置');
    if (!cfg) return;
    check(cfg.name === cs.name, cs.name + '：显示名正确（' + cfg.name + '）');
    check(cfg.role === cs.id, cs.name + '：role = ' + cs.id);
    check(cfg.sprite === cs.id, cs.name + '：sprite = ' + cs.id);
    check(cfg.ready === true, cs.name + '：ready=true（能进角色库）');
    check(cfg.unlockLevel === cs.unlock, cs.name + '：解锁 = 通关第 ' + cs.unlock + ' 关（实际 ' + cfg.unlockLevel + '）');
    check(cfg.unlockedByDefault === false, cs.name + '：初始不直接解锁');
    check(/^#[0-9a-fA-F]{6}$/.test(cfg.accentColor), cs.name + '：主题色合法（' + cfg.accentColor + '）');
  });
}

/* ============================================================
 * B. 定位不重复（各占一个维度，防"完全上位替代"）
 * ============================================================ */
console.log('\n--- B. 定位不重复 ---');
{
  const all = JSON.parse(run(
    'JSON.stringify(CHARACTERS.filter(function(c){return c.ready}).map(function(c){' +
    'return {id:c.id,speed:c.speedMultiplier,jump:c.jumpMultiplier,dash:c.dashMultiplier,' +
    'wall:c.wallStaminaMultiplier,wj:c.wallJumpMultiplier||1}}))'
  ));

  const fish = all.find(c => c.id === 'fish');
  const puppy = all.find(c => c.id === 'puppy');
  const lamb = all.find(c => c.id === 'lamb');
  /* ⚠️ 2026-10-07：这个测试里的"全场最高"比较**必须排除**
   * 「十一」（pinkstitch）—— 她是**兑换码专属的满配角色**，
   * 五项刻意全部超过所有人（十一本人要求"全是拉满的"）。
   * ⇒ 把她算进来的话，小鱼/小羊/小狗这些"某项第一"的断言全会挂。
   *   详见 characters.js 里 "唯一的满配角色" 的说明。 */
  const balanced = all.filter(c => c.id !== 'pinkstitch');
  const others = balanced.filter(c => ['fish', 'puppy', 'lamb'].indexOf(c.id) < 0);

  /* 小鱼 = 跑速最快（普通角色范围内） */
  const maxSpeed = Math.max.apply(null, balanced.map(c => c.speed));
  check(Math.abs(fish.speed - maxSpeed) < 0.001,
    '★ 小鱼跑速全场最高（' + fish.speed + ' vs 其他最高 ' +
    Math.max.apply(null, others.map(c => c.speed)) + '）');
  check(fish.jump < Math.min.apply(null, others.map(c => c.jump)),
    '小鱼跳跃最弱（' + fish.jump + '，符合"没有腿"的设定）');

  /* 小狗 = 全能，没有短板 */
  const fields = ['speed', 'jump', 'dash', 'wall'];
  const allAbove1 = fields.every(function (f) { return puppy[f] > 1; });
  check(allAbove1, '★ 小狗所有维度都 > 1.0（全能无短板）');
  const anyTop = fields.some(function (f) {
    return balanced.every(function (c) { return puppy[f] >= c[f]; }) && puppy[f] > 1;
  });
  check(!anyTop, '★ 小狗没有任何一项是第一（避免变成"上位替代"）');

  /* 小羊 = 墙跳最高（普通角色范围内） */
  const maxWj = Math.max.apply(null, balanced.map(c => c.wj));
  check(Math.abs(lamb.wj - maxWj) < 0.001,
    '★★ 小羊墙跳力度全场最高（' + lamb.wj + ' vs 其他最高 ' +
    Math.max.apply(null, others.map(c => c.wj)) + '）');
  check(lamb.wj > 1.40, '小羊墙跳超过猴子（猴子 1.40）');

  /* 小鱼不能在冲刺上超过史迪奇 */
  const stitch = all.find(c => c.id === 'stitch');
  check(fish.dash < stitch.dash,
    '小鱼冲刺不越界（' + fish.dash + ' < 史迪奇 ' + stitch.dash + '）');
}

/* ============================================================
 * C. 选中后进关，生成的角色真的是它
 * ============================================================ */
console.log('\n--- C. 选中后进关 ---');
{
  const cases = [
    { id: 'fish', name: '小鱼' },
    { id: 'puppy', name: '小狗' },
    { id: 'lamb', name: '小羊' },
  ];
  run('Game.skipWeatherBrief = true; Game.mode = "single"; Game.playerCount = 1; Save.setMode("classic");');

  cases.forEach(function (cs) {
    run('Save.unlockChar("' + cs.id + '");');
    const ok = run('Save.setSelectedChar("' + cs.id + '")');
    check(ok === true, cs.name + '：能设为当前角色');
    run('loadLevel(0);');
    const p = run(`(function(){
      var pl = Game.players[0];
      return { role: pl.role, charId: pl.charId, name: pl.name,
               hasSprite: pl.sprite !== undefined && pl.sprite !== null,
               rollable: Math.abs(pl.vx) >= 0 };
    })()`);
    check(p.role === cs.id, cs.name + '：进关后 role = ' + cs.id + '（实际 ' + p.role + '）');
    check(p.name === cs.name, cs.name + '：HUD 显示名正确（' + p.name + '）');
    check(p.hasSprite, cs.name + '：sprite 有值（不会完全不显示）');

    /* 能跑起来 */
    const moved = run(`(function(){
      var pl = Game.players[0];
      var x0 = pl.x;
      for (var f = 0; f < 120; f++){
        InputState.now = {}; InputState.now['ArrowRight'] = true;
        update(1/60); InputState.tick();
      }
      return Math.round(pl.x - x0);
    })()`);
    check(moved > 10, cs.name + '：进关后能正常跑动（120 帧移动 ' + moved + 'px）');
  });
}

/* ============================================================
 * D. 解锁节点
 * ============================================================ */
console.log('\n--- D. 解锁节点 ---');
{
  const sb2 = loadAll(buildSandbox());
  const run2 = e => vm.runInContext(e, sb2);

  const vis0 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis0.indexOf('fish') < 0 && vis0.indexOf('puppy') < 0 && vis0.indexOf('lamb') < 0,
    '新档看不见三个新角色（' + JSON.stringify(vis0) + '）');

  /* 通关到第 14 关 → 小鱼 */
  run2('for (var i = 0; i < 14; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis14 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis14.indexOf('fish') >= 0, '★ 通关第 14 关后小鱼出现');
  check(vis14.indexOf('puppy') < 0, '通关第 14 关时小狗还没解锁');

  /* 通关到第 17 关 → 小狗 */
  run2('for (var i = 14; i < 17; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis17 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis17.indexOf('puppy') >= 0, '★ 通关第 17 关后小狗出现');
  check(vis17.indexOf('lamb') < 0, '通关第 17 关时小羊还没解锁');

  /* 通关到第 20 关 → 小羊 */
  run2('for (var i = 17; i < 20; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis20 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis20.indexOf('lamb') >= 0, '★ 通关第 20 关后小羊出现');
}

/* ============================================================
 * E. 前八个角色不受影响
 * ============================================================ */
console.log('\n--- E. 已有角色不受影响 ---');
{
  const cases = [
    { id: 'kangaroo', name: '美团袋鼠' },
    { id: 'dragon', name: '飞龙宝宝' },
    { id: 'capybara', name: '卡皮巴拉' },
    { id: 'stitch', name: '史迪奇宝宝' },
    { id: 'monkey', name: '美团猴子' },
  ];
  cases.forEach(function (cs) {
    run('Save.unlockChar("' + cs.id + '");');
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
               moved: Math.round(pl.x - x0) };
    })()`);
    check(r.role === cs.id && r.name === cs.name && r.sprite && r.moved > 10,
      cs.name + ' 仍正常（role=' + r.role + ' 移动' + r.moved + 'px）');
  });
}

console.log('\n' + '='.repeat(58));
console.log('  第三章新角色回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(58));
if (fail > 0) process.exit(1);
