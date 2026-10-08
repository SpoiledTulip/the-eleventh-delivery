/* ============================================================
 * stitch-role-test.js — 第四个角色「史迪奇宝宝」的回归测试
 * ============================================================
 * 守住四件事：
 *   ① 选中史迪奇后，进关生成的角色**真的是** stitch（含 sprite、出生点、名字）
 *   ② 手感倍率符合设计定位：**冲刺最远**（dashMul 1.35）、跑速略快、
 *      跳跃无加成、抓墙强但不极致 —— 与前三名不重复
 *   ③ 解锁节点 = 通关第 1 关（十一指定）
 *   ④ 前三个角色没被改坏
 *
 * ⚠️ 沙箱骨架复制自 capybara-role-test.js（同样的桩环境）。
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
    var _stitchJumpCalled = 0, _stitchLandCalled = 0;
    var Sound_probe = {
      jump: function(){}, land: function(){},
      capyJump: function(){}, capyLand: function(){},
      stitchJump: function(){ _stitchJumpCalled++; },
      stitchLand: function(){ _stitchLandCalled++; },
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
console.log('  史迪奇宝宝 · 角色回归测试');
console.log('='.repeat(58));

/* ============================================================
 * A. 配置表正确性
 * ============================================================ */
console.log('\n--- A. 角色配置 ---');
{
  const c = run('JSON.stringify(charById("stitch"))');
  const cfg = JSON.parse(c);
  check(!!cfg && cfg.id === 'stitch', 'charById("stitch") 能找到配置');
  check(cfg.name === '史迪奇宝宝', '显示名是「史迪奇宝宝」（实际 ' + cfg.name + '）');
  check(cfg.role === 'stitch', 'role 是 stitch');
  check(cfg.sprite === 'stitch', 'sprite 是 stitch');
  check(cfg.ready === true, '★ ready=true（制作完成，能进角色库）');
  check(cfg.unlockLevel === 11, '★ 解锁节点 = 通关第 11 关（实际 ' + cfg.unlockLevel + '）');
  check(cfg.unlockedByDefault === false, '初始不直接解锁（要靠通关第 11 关）');

  /* 定位：冲刺最远 */
  check(Math.abs(cfg.dashMultiplier - 1.35) < 0.001,
    '★ 冲刺倍率 1.35（冲刺最远，它的核心定位）实际 ' + cfg.dashMultiplier);
  check(cfg.jumpMultiplier === 1.0, '跳跃无加成（把优势让给袋鼠）');
  check(Math.abs(cfg.wallStaminaMultiplier - 1.25) < 0.001,
    '抓墙倍率 1.25（强但不极致，卡皮巴拉才是 1.6）实际 ' + cfg.wallStaminaMultiplier);
  check(cfg.accentColor && /^#[0-9a-fA-F]{6}$/.test(cfg.accentColor),
    '主题色是合法 hex（' + cfg.accentColor + '）');
}

/* ============================================================
 * B. 与前三名的定位不重复（防"完全上位替代"）
 * ============================================================ */
console.log('\n--- B. 四个角色定位不重复 ---');
{
  const all = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready}).map(function(c){return {id:c.id,dash:c.dashMultiplier,wall:c.wallStaminaMultiplier,jump:c.jumpMultiplier,speed:c.speedMultiplier}}))'));
  const stitch = all.find(c => c.id === 'stitch');
  const others = all.filter(c => c.id !== 'stitch');
  /* ⚠️ 2026-10-07：把「十一」（pinkstitch）排除在"平衡比较"之外。
   * 她是**兑换码专属的满配角色**，五项全部刻意超过所有人 ——
   * 所以"史迪奇冲刺最高"这条要在**普通角色**范围内成立。
   * 详见 characters.js 里 "唯一的满配角色" 的说明。 */
  const normal = all.filter(c => c.id !== 'pinkstitch');
  const normalOthers = normal.filter(c => c.id !== 'stitch');

  /* 史迪奇的冲刺必须是**普通角色里**最高的 */
  const maxDash = Math.max.apply(null, normal.map(c => c.dash));
  check(Math.abs(stitch.dash - maxDash) < 0.001,
    '★ 史迪奇的冲刺倍率全场最高（' + stitch.dash + ' vs 普通角色最高 ' +
    Math.max.apply(null, normalOthers.map(c => c.dash)) + '）');

  /* 跳跃不能也是最高（不然就重复了袋鼠） */
  const maxJump = Math.max.apply(null, normal.map(c => c.jump));
  check(stitch.jump < maxJump,
    '跳跃不是最高（普通角色里最高是袋鼠的 ' + maxJump + '，史迪奇 ' + stitch.jump + '）');

  /* 抓墙不能超过卡皮巴拉 */
  const capy = normal.find(c => c.id === 'capybara');
  check(stitch.wall <= capy.wall,
    '抓墙不超过卡皮巴拉（' + stitch.wall + ' <= ' + capy.wall + '）');
}

/* ============================================================
 * C. 选中史迪奇 → 进关生成的角色真的是史迪奇
 * ============================================================ */
console.log('\n--- C. 选中史迪奇后进关 ---');
{
  run(`
    Game.skipWeatherBrief = true;
    Game.mode = 'single'; Game.playerCount = 1;
    Save.setMode('classic');
  `);
  /* 先把史迪奇解锁出来（它 unlockLevel = 1） */
  run('Save.unlockChar("stitch");');
  const setOk = run('Save.setSelectedChar("stitch")');
  check(setOk === true, '能把史迪奇设为选中角色');

  run('loadLevel(0);');
  const p = run(`(function(){
    var pl = Game.players[0];
    return {
      role: pl.role, charId: pl.charId, name: pl.name,
      hasSprite: pl.sprite !== undefined && pl.sprite !== null,
      x: pl.x, y: pl.y,
      speedMul: pl.speedMul, dashMul: pl.dashMul, wallMul: pl.wallStaminaMul,
      jumpMul: pl.jumpMul,
      inBounds: pl.x > 0 && pl.y > 0 && pl.y < 2000
    };
  })()`);
  check(p.role === 'stitch', '★ 进关后 role 就是 stitch（没被二元分发吃掉）');
  check(p.charId === 'stitch', 'charId 是 stitch');
  check(p.name === '史迪奇宝宝', 'HUD 显示名是「史迪奇宝宝」（实际 ' + p.name + '）');
  check(p.hasSprite, 'sprite 有值（不是 undefined —— 那会让角色完全不显示）');
  check(p.inBounds, '出生点合法，被正常生成进关卡（x=' + p.x + ' y=' + p.y + '）');

  /* 手感倍率落到玩家身上 */
  check(Math.abs(p.dashMul - 1.35) < 0.001,
    '★ 进关后冲刺倍率生效 1.35（实际 ' + p.dashMul + '）');
  check(Math.abs(p.wallMul - 1.25) < 0.001,
    '抓墙倍率生效 1.25（实际 ' + p.wallMul + '）');
  check(Math.abs(p.speedMul - 1.05) < 0.001,
    '跑速倍率生效 1.05（实际 ' + p.speedMul + '）');

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
 * D. 专属音效分发（史迪奇走 stitchJump / stitchLand）
 * ============================================================ */
console.log('\n--- D. 专属音效分发 ---');
{
  check(run('typeof playJumpSound') === 'function', 'playJumpSound 存在（统一音效分发入口）');

  /* 用探针函数验证分发到 stitch 分支 */
  const r = run(`(function(){
    var _saved = Sound;
    var hits = { stitchJump: 0, stitchLand: 0, jump: 0, land: 0, capyJump: 0, capyLand: 0 };
    Sound = {
      stitchJump: function(){ hits.stitchJump++; },
      stitchLand: function(){ hits.stitchLand++; },
      jump: function(){ hits.jump++; },
      land: function(){ hits.land++; },
      capyJump: function(){ hits.capyJump++; },
      capyLand: function(){ hits.capyLand++; },
    };
    playJumpSound('stitch', 'jump');
    playJumpSound('stitch', 'land');
    playJumpSound('kangaroo', 'jump');
    playJumpSound('capybara', 'jump');
    Sound = _saved;
    return hits;
  })()`);
  check(r.stitchJump === 1, '★ 史迪奇起跳走 stitchJump（专属，不是通用）');
  check(r.stitchLand === 1, '★ 史迪奇落地走 stitchLand（专属）');
  check(r.jump === 1, '袋鼠起跳仍走通用 jump');
  check(r.capyJump === 1, '卡皮巴拉起跳仍走 capyJump（没被带坏）');
  check(r.jump === 1 && r.capyJump === 1 && r.stitchJump === 1,
    '★ 三个角色的起跳音效走各自分支，互不干扰');
}

/* ============================================================
 * E. 专属跳跃姿态（与卡皮巴拉的"压扁"区分）
 * ============================================================ */
console.log('\n--- E. 专属跳跃姿态 ---');
{
  check(run('typeof stitchJumpPose') === 'function', 'stitchJumpPose 已定义');
  check(run('typeof STITCH_JUMP') === 'object' || run('typeof stitchJumpPose') === 'function',
    'STITCH_JUMP / stitchJumpPose 已定义');

  /* 中性值：地面静止时不该有额外姿态 */
  const idle = run('JSON.stringify(stitchJumpPose({onGround:true, jumpBuffer:0, vy:0}))');
  const idleO = JSON.parse(idle);
  check(idleO.squash === 1 && idleO.yOff === 0, '地面静止时为中性（squash=1, yOff=0）');

  /* 起跳瞬间：极度拉伸（squash < 1 = 变瘦变长） */
  const launch = JSON.parse(run('JSON.stringify(stitchJumpPose({onGround:false, jumpBuffer:0, vy:-12}))'));
  check(launch.squash < 1, '★ 起跳瞬间是拉伸（squash<1，变瘦长）实际 ' + launch.squash);

  /* ★ 与卡皮巴拉对比：史迪奇起跳更瘦长、蓄力更短 */
  const capyLaunch = JSON.parse(run('JSON.stringify(capybaraJumpPose({onGround:false, jumpBuffer:0, vy:-12}))'));
  check(launch.squash < capyLaunch.squash,
    '★ 史迪奇起跳比卡皮巴拉更瘦长（' + launch.squash + ' < ' + capyLaunch.squash + '）');

  const sj = JSON.parse(run('JSON.stringify(STITCH_JUMP)'));
  const cj = JSON.parse(run('JSON.stringify(CAPY_JUMP)'));
  check(sj.crouchTime < cj.crouchTime,
    '★ 史迪奇蓄力更短（' + sj.crouchTime + 's < ' + cj.crouchTime + 's，爆发型说跳就跳）');
  check(sj.landSquash < cj.landSquash,
    '史迪奇落地更轻（' + sj.landSquash + ' < ' + cj.landSquash + '，小个子 vs 憨重）');

  /* 与另两个角色也要不同（不能退化成通用姿态） */
  check(sj.launchSquash < 0.9 && sj.launchSquash !== 1,
    '★ 起跳拉伸足够明显（launchSquash=' + sj.launchSquash + '），不是通用值');
}

/* ============================================================
 * F. 前三个角色没被改坏
 * ============================================================ */
console.log('\n--- F. 现有三个角色不受影响 ---');
{
  const cases = [
    { id: 'kangaroo', name: '美团袋鼠', role: 'kangaroo' },
    { id: 'dragon', name: '飞龙宝宝', role: 'dragon' },
    { id: 'capybara', name: '卡皮巴拉', role: 'capybara' },
  ];
  cases.forEach(function (cs) {
    /* ⚠️ 必须先解锁再选中 —— 卡皮巴拉 unlockLevel=10，
     *    直接 setSelectedChar 会被拒（角色没解锁），于是残留成上一个角色。
     *    这是测试的疏漏，不是游戏 bug。 */
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
               moved: Math.round(pl.x - x0), state: Game.state };
    })()`);
    check(r.role === cs.role && r.name === cs.name && r.sprite && r.moved > 10,
      cs.name + ' 仍正常（role=' + r.role + ' 移动' + r.moved + 'px 状态=' + r.state + '）');
  });
}

/* ============================================================
 * G. 解锁：通关第 11 关解锁史迪奇
 * ============================================================ */
console.log('\n--- G. 第 11 关解锁 ---');
{
  const sb2 = loadAll(buildSandbox());
  const run2 = e => vm.runInContext(e, sb2);

  const vis0 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis0.indexOf('stitch') < 0,
    '新档还没通关时，看不见史迪奇（' + JSON.stringify(vis0) + '）');

  /* 通关第 1~10 关（下标 0~9）—— 还不该解锁 */
  run2('for (var i = 0; i < 10; i++) SAVE().recordClear(i, 30, 10, 10, "kangaroo");');
  const vis10 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis10.indexOf('stitch') < 0,
    '通关前 10 关时，史迪奇还没解锁（' + JSON.stringify(vis10) + '）');

  /* 通关第 11 关（下标 10）—— 解锁 */
  run2('SAVE().recordClear(10, 30, 10, 10, "kangaroo");');
  const vis11 = run2('listVisibleChars().map(function(c){ return c.id; })');
  check(vis11.indexOf('stitch') >= 0,
    '★ 通关第 11 关后史迪奇出现（' + JSON.stringify(vis11) + '）');

  /* 解锁后能不能真的选中并进关 */
  const okSel = run2('SAVE().setSelectedChar("stitch")');
  check(okSel === true, '解锁后能把史迪奇设为当前角色');
}

console.log('\n' + '='.repeat(58));
console.log('  史迪奇宝宝回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(58));
if (fail > 0) process.exit(1);
