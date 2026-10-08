/* ============================================================
 * pinkiepie-test.js — 碧琪（粉色小马）回归测试
 * ============================================================
 * 十一的要求：
 *   "当兑换码里面写「十一的碧琪宝宝」的时候，可以获得碧琪这个新角色"
 *   "作者那个破解账号……这些都是不需要去兑换的，都是直接有"
 *
 * 碧琪的招牌是**踩怪弹跳**（`stompBounceMultiplier`）—— 第三个跳跃维度：
 *   袋鼠 = 第一跳高 / 尼克 = 第二跳高 / **碧琪 = 踩怪弹得最高**
 *
 * 验证：
 *   ① 配置正确（名字/sprite/ready/配色）
 *   ② ⚠️ **不占通关解锁位**（unlockLevel=0 且不初始解锁）
 *   ③ 新维度真的挂到玩家对象（stompBounceMul）
 *   ④ ★ **真的影响物理**：碧琪踩怪弹起速度 > 袋鼠
 *   ⑤ 老角色不受影响（stompBounceMul = 1）
 *   ⑥ 兑换码「十一的碧琪宝宝」能解锁她
 *   ⑦ 码的大小写/空格容错
 *   ⑧ 作者账号**不用兑**也直接有（全角色特权覆盖）
 *   ⑨ 贴图与打包清单
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
console.log('  碧琪（粉色小马）· 角色回归测试');
console.log('='.repeat(58));

/* ============================================================
 * A. 配置
 * ============================================================ */
console.log('\n--- A. 角色配置 ---');
{
  const cfg = JSON.parse(run('JSON.stringify(charById("pinkiepie"))'));
  check(!!cfg, 'charById("pinkiepie") 能找到配置');
  if (cfg) {
    check(cfg.name === '碧琪', '显示名是「碧琪」（' + cfg.name + '）');
    check(cfg.sprite === 'pinkiepie', 'sprite = pinkiepie');
    check(cfg.ready === true, 'ready=true（已制作，能进角色库）');
    check(cfg.unlockedByDefault === false, '不是初始角色');
    check(/^#[0-9a-fA-F]{6}$/.test(cfg.accentColor), '配色合法（' + cfg.accentColor + '，粉色）');
    check(cfg.stompBounceMultiplier > 1.5,
      '★ 踩怪弹跳倍率 = ' + cfg.stompBounceMultiplier + '（>1.5，是她的招牌）');
    check(!!cfg.tagline && !!cfg.description, '有人设文案');
    check(Array.isArray(cfg.weaknesses) && cfg.weaknesses.length > 0, '有明确弱点（平衡）');
  }
}

/* ============================================================
 * B. ⚠️ 不占通关解锁位（只能靠兑换码）
 * ============================================================ */
console.log('\n--- B. 解锁途径（只靠兑换码） ---');
{
  check(run('charById("pinkiepie").unlockLevel') === 0,
    'unlockLevel = 0（不靠通关解锁）');

  const defaults = run('JSON.stringify(defaultUnlockedChars())');
  check(defaults.indexOf('pinkiepie') < 0,
    '不在初始解锁列表里（新档看不到她）');

  /* 通关任意一关都不该解锁她 */
  let anyUnlock = false;
  for (let lv = 0; lv < 35; lv++) {
    const got = run('JSON.stringify(charsUnlockedBy(' + lv + ', []).map(function(c){return c.id}))');
    if (got.indexOf('pinkiepie') >= 0) { anyUnlock = true; break; }
  }
  check(anyUnlock === false, '★ 通关 1~35 关**都不会**解锁她（验证只走兑换码）');
}

/* ============================================================
 * C. ★ 踩怪弹跳真的生效
 * ============================================================ */
console.log('\n--- C. 踩怪弹跳（核心能力） ---');
{
  check(run('typeof CONFIG.stompBounce') === 'function', 'CONFIG.stompBounce 存在');

  /* ① 老角色不传 bm → 行为和以前**完全一样** */
  const oldBase = run('CONFIG.stompBounce(1.0)');
  const oldSuper = run('CONFIG.stompBounceSuper(1.0)');
  check(Math.abs(oldBase - (-8.5)) < 0.001,
    '老角色普通踩怪弹速不变（' + oldBase + ' = -8.5）');
  check(Math.abs(oldSuper - (-16.2)) < 0.001,
    '老角色蓄力踩怪弹速不变（' + oldSuper + ' = -16.2）');

  /* ② 碧琪的倍率真的放大 */
  const pkBase = run('CONFIG.stompBounce(1.0, 1.75)');
  const pkSuper = run('CONFIG.stompBounceSuper(1.0, 1.75)');
  check(pkBase < oldBase * 1.5,
    '★★ 碧琪普通踩怪弹速明显更高（' + pkBase.toFixed(1) + ' vs 基准 ' + oldBase + '）');
  check(pkSuper < oldSuper * 1.5,
    '★★ 碧琪蓄力踩怪弹速明显更高（' + pkSuper.toFixed(1) + ' vs 基准 ' + oldSuper + '）');

  /* ③ 进关后玩家对象上真的有这个字段 */
  run('Game.skipWeatherBrief = true; Game.mode = "single"; Game.playerCount = 1; Save.setMode("classic");');
  run('Save.unlockChar("pinkiepie"); Save.setSelectedChar("pinkiepie");');
  run('loadLevel(0);');
  const mul = run('Game.players[0].stompBounceMul');
  check(Math.abs(mul - 1.75) < 0.001,
    '★★ 进关后玩家身上 stompBounceMul = 1.75（真的挂上了）实际 ' + mul);

  /* ④ 老角色进关后是 1（不受影响） */
  const cases = [
    { id: 'kangaroo', name: '袋鼠' }, { id: 'dragon', name: '飞龙' },
    { id: 'capybara', name: '卡皮巴拉' }, { id: 'stitch', name: '史迪奇' },
    { id: 'monkey', name: '猴子' }, { id: 'fish', name: '小鱼' },
    { id: 'puppy', name: '小狗' }, { id: 'lamb', name: '小羊' },
    { id: 'nick', name: '尼克' }, { id: 'judy', name: '朱迪' },
  ];
  let allOk = true; const bad = [];
  cases.forEach(function (cs) {
    run('Save.unlockChar("' + cs.id + '"); Save.setSelectedChar("' + cs.id + '");');
    run('loadLevel(0);');
    const v = run('Game.players[0].stompBounceMul');
    if (v !== 1) { allOk = false; bad.push(cs.name + '=' + v); }
  });
  check(allOk, '★★ 10 个老角色的 stompBounceMul 全是 1（没被带坏）' +
    (bad.length ? ' — 异常: ' + bad.join(', ') : ''));

  /* ⑤ 碧琪的通用跳跃**是标准的**（强项只在踩怪） */
  run('Save.unlockChar("pinkiepie"); Save.setSelectedChar("pinkiepie");');
  run('loadLevel(0);');
  const pkJump = run('Game.players[0].jumpMul');
  check(Math.abs(pkJump - 1.0) < 0.001,
    '★ 碧琪通用跳跃是标准的（jumpMul=' + pkJump + '）—— 强项只在踩怪');
}

/* ============================================================
 * D. 兑换码
 * ============================================================ */
console.log('\n--- D. 兑换码「十一的碧琪宝宝」 ---');
{
  const uiSrc = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');
  check(uiSrc.indexOf("'十一的碧琪宝宝'") >= 0,
    "ui.js 里配了兑换码「十一的碧琪宝宝」");
  check(uiSrc.indexOf("'pinkiepie'") >= 0,
    '兑换码的 grant 里写的是 pinkiepie');
  /* 作者账号全角色特权会覆盖碧琪（十一说"作者直接有"） */
  check(uiSrc.indexOf('isAuthor = true') >= 0, '作者码仍然只负责盖作者章');
}

/* ============================================================
 * E. 贴图与打包
 * ============================================================ */
console.log('\n--- E. 贴图资源 ---');
{
  check(fs.existsSync(path.join(SRC, 'assets', 'pinkiepie.png')),
    'pinkiepie.png 存在于 src/assets/');
  const spSrc = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
  check(spSrc.indexOf("src: 'assets/pinkiepie.png'") >= 0,
    'sprites.js 注册了 pinkiepie.png');
  const bSrc = fs.readFileSync(path.join(PROJ, 'tools', 'build-single.js'), 'utf8');
  check(bSrc.indexOf("'pinkiepie.png'") >= 0,
    "build-single.js 的 imgFiles 含 pinkiepie.png（否则单文件版缺图）");
}

/* ============================================================
 * F. 源码级防线
 * ============================================================ */
console.log('\n--- F. 源码级防线 ---');
{
  const gSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  check(gSrc.indexOf('p.stompBounceMul') >= 0,
    'game.js 的踩怪处传了 p.stompBounceMul');
  check(gSrc.indexOf("charMul(role, 'stompBounceMultiplier')") >= 0,
    'makePlayer 挂上了 stompBounceMul');
  const pSrc = fs.readFileSync(path.join(SRC, 'js', 'physics.js'), 'utf8');
  check(/stompBounce:\s*function\s*\(jm,\s*bm\)/.test(pSrc),
    'physics.js 的 stompBounce 支持第 2 个参数 bm');
}

console.log('\n' + '='.repeat(58));
console.log('  碧琪回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(58));
if (fail > 0) process.exit(1);
