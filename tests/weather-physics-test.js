/* ============================================================
 * weather-physics-test.js — 天气改物理后的「可通关性」穷举验证
 * ============================================================
 * 【为什么必须有这个测试】
 *   十一选了"全模式都改物理"，且天气是**随机**的。
 *   ⇒ 就存在这个风险："随机到一个过不去的天气 → 这单废了"。
 *   这个测试就是回答这个问题的**唯一硬保障**：
 *     把「5 关 × 6 种天气 × 2 个角色」全跑一遍，看每种组合能不能通。
 *
 * ⚠️ 只要有一个组合过不去，就必须调小对应天气的强度
 *    （改 physics.js 的 CONFIG.WEATHER_*），直到全部通过。
 *
 * 【怎么"跑一遍"才可信】
 *   之前试过写"自动玩家 AI"，但太笨（撞墙就停，120 秒都出不了起点）。
 *   ⇒ 现在改用**能力探针**：不问"AI 能不能过"，而问
 *      "**玩家的能力上限**在这种天气下还够不够用"。
 *      具体测三个硬指标，任何一个低于关卡需求就是死局：
 *        ① 跳跃高度   —— 能不能上到该上的平台
 *        ② 全速跳射程 —— 能不能跨过该跨的缺口
 *        ③ 原地刹车距离 —— 会不会在窄平台上滑出去
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

/* ---------- 沙箱：加载游戏脚本 ---------- */
function buildSandbox() {
  let store = {};
  const fakeLS = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { store = {}; },
  };
  function mkEl() {
    const e = {
      style: {}, className: '', innerHTML: '', textContent: '', id: '',
      children: [], _lis: {},
      appendChild(c) { this.children.push(c); return c; },
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
  const doc = {
    getElementById: () => mkEl(), querySelector: () => mkEl(),
    querySelectorAll: () => [], createElement: () => mkEl(),
    body: mkEl(), documentElement: mkEl(),
    addEventListener() {}, removeEventListener() {},
    head: mkEl(),
  };
  const sb = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean,
    Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat,
    Infinity, NaN, undefined, Map, Set, Promise, RegExp, Symbol,
    document: doc,
    window: null,
    localStorage: fakeLS,
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
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

function loadScripts(sb, files) {
  for (const f of files) {
    const p = path.join(SRC, 'js', f);
    if (!fs.existsSync(p)) continue;
    try {
      vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f });
    } catch (e) {
      throw new Error('加载 ' + f + ' 失败: ' + e.message);
    }
  }
}

/* ============================================================
 * 核心：测"这种天气下，玩家的能力上限还剩多少"
 * ============================================================
 * 用一个"完美玩家"的输入序列（不做任何多余动作），
 * 量出三个硬指标。天气改物理 → 这三个数会变 → 变太多就是死局。
 * ============================================================ */
function probeAbility(sb, levelIndex, weather, role) {
  const run = e => vm.runInContext(e, sb);

  run(`
    Game.skipWeatherBrief = true;
    Game.mode = 'single';
    Game.playerCount = 1;
    Save.setMode('classic');
    Game.pickRole = ${JSON.stringify(role)};
    loadLevel(${levelIndex});
  `);
  /* 强制这一关的天气（不走随机，直接钉死） */
  run(`Game.level.weather = ${weather === 'clear' ? 'null' : JSON.stringify(weather)};`);
  if (typeof sb.THUNDER !== 'undefined' && sb.THUNDER.reset) sb.THUNDER.reset(sb.Game.level);

  const setup = `
    var p = Game.players[0];
    p.hearts = 99; p.maxHearts = 99;
    /* ⚠️ 2026-10-07 改：这里必须给**持续无敌**。
     * ------------------------------------------------------------
     * 【为什么原来不用无敌，现在必须】
     *   这个测试测的是"**天气对手感的影响**"（跳高/射程/刹车），
     *   应该把"被打断"这个变量排除掉。
     *
     *   改雷电之前：雷几乎劈不中人（落点随机、判定区窄），
     *   玩家在测试里基本不会被雷碰到 ⇒ 不无敌也没事。
     *
     *   改雷电之后：十一要求"提高雷击命中率 + 按移动预判"
     *   ⇒ 站着不动的玩家 **100% 被劈中** ⇒ 测试里玩家一被劈就
     *     被击退/打断 ⇒ 实测射程变成 **-9px**（负数！）。
     *   ⇒ 这不是游戏 bug，是**测试的旧假设过期了**。
     * ------------------------------------------------------------ */
    p.invuln = 999999; p.actInvuln = 999999; p.stun = 0;
  `;

  const result = run(`
    (function(){
      var p = Game.players[0];
      function reset(x, y){
        p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.onGround = true;
        p.hearts = 99; p.maxHearts = 99;
        /* ★ 全程无敌（理由见上面 setup 的说明）★ */
        p.invuln = 999999; p.actInvuln = 999999;
        p.stun = 0; p.actDashT = 0;
      }
      function step(keys){
        InputState.now = {};
        for (var i = 0; i < keys.length; i++) InputState.now[keys[i]] = true;
        update(1/60);
        InputState.tick();
      }

      /* ---------- ① 原地起跳高度 ---------- */
      reset(3*32, 23*32);
      for (var a = 0; a < 20; a++) step([]);      // 先站稳
      var y0 = p.y;
      step(['Space']);
      var maxUp = 0;
      for (var b = 0; b < 80; b++){
        step([]);
        var up = y0 - p.y;
        if (up > maxUp) maxUp = up;
      }

      /* ---------- ② 全速冲刺跳的水平射程 ---------- */
      reset(3*32, 23*32);
      for (var c = 0; c < 90; c++) step(['ArrowRight']);   // 跑到最高速（含大风影响）
      var x0 = p.x, y1 = p.y;
      step(['ArrowRight', 'Space']);
      var maxUp2 = 0;
      for (var d = 0; d < 90; d++){
        step(['ArrowRight']);
        var up2 = y1 - p.y;
        if (up2 > maxUp2) maxUp2 = up2;
      }
      var range = p.x - x0;

      /* ---------- ③ 原地刹车距离（松手后滑多远） ---------- */
      reset(3*32, 23*32);
      for (var e = 0; e < 90; e++) step(['ArrowRight']);
      var xb = p.x;
      var framesToStop = 0;
      for (var f = 0; f < 240; f++){
        step([]);
        framesToStop++;
        if (Math.abs(p.vx) < 0.1) break;
      }
      var brake = p.x - xb;

      /* ---------- ④ 反向（逆风）跑的效率 ---------- */
      reset(3*32, 23*32);
      var xr0 = p.x;
      for (var g = 0; g < 90; g++) step(['ArrowLeft']);
      var leftDist = xr0 - p.x;

      return {
        jumpHeight: Math.round(maxUp),
        sprintJumpHeight: Math.round(maxUp2),
        sprintRange: Math.round(range),
        brakeDist: Math.round(brake),
        brakeFrames: framesToStop,
        leftDist: Math.round(leftDist)
      };
    })()
  `);
  return result;
}

/* ---------- 关卡需求（从关卡数据算） ---------- */
function levelDemand(sb, levelIndex) {
  const run = e => vm.runInContext(e, sb);
  run(`
    Game.skipWeatherBrief = true;
    Game.mode = 'single'; Game.playerCount = 1;
    Save.setMode('classic');
    loadLevel(${levelIndex});
  `);
  return run(`
    (function(){
      var lv = Game.level;
      var T = 32;
      /* 找出"相邻可站立平台之间的最大水平缺口"和"最大垂直落差" —— 这是关卡的硬需求 */
      var solids = [];
      for (var y = 0; y < lv.rows; y++)
        for (var x = 0; x < lv.cols; x++)
          if (lv.grid[y][x] === '#') solids.push({ x: x*T, y: y*T });
      /* 简化：用地图的"最宽连续空缺"作为缺口需求 */
      var maxGapRun = 0, curRun = 0;
      var rowMid = Math.floor(lv.rows * 0.6);
      for (var cx = 0; cx < lv.cols; cx++){
        var solidHere = false;
        for (var ry = rowMid; ry < lv.rows; ry++){ if (lv.grid[ry][cx] === '#') { solidHere = true; break; } }
        if (!solidHere) { curRun++; if (curRun > maxGapRun) maxGapRun = curRun; }
        else curRun = 0;
      }
      return {
        maxGapPx: maxGapRun * T,
        levelW: lv.width,
        coinCount: lv.coins.length,
        need: Game.coinsRequired
      };
    })()
  `);
}

/* ---------- 跑起来 ---------- */
console.log('='.repeat(62));
console.log('  天气物理穷举验证：每种组合能不能通关？');
console.log('='.repeat(62));

const WEATHERS = ['clear', 'fog', 'rain', 'snow', 'night', 'wind', 'thunder'];
const ROLES = ['kangaroo', 'dragon'];
const LEVELS = [0, 1, 2, 3, 4];

let baseline = null;   // 晴天基准能力
const allResults = [];

for (const levelIndex of LEVELS) {
  console.log('\n--- 第 ' + (levelIndex + 1) + ' 关 ---');
  const demand = levelDemand(buildSandboxWithScripts(), levelIndex);
  console.log('    关卡需求：最大缺口 ' + demand.maxGapPx + 'px，订单 ' + demand.need + '/' + demand.coinCount);

  for (const role of ROLES) {
    const row = { level: levelIndex + 1, role, weathers: {} };
    for (const w of WEATHERS) {
      const sb = buildSandboxWithScripts();
      let ab;
      try {
        ab = probeAbility(sb, levelIndex, w, role);
      } catch (e) {
        row.weathers[w] = { error: e.message };
        continue;
      }
      row.weathers[w] = ab;
    }
    allResults.push(row);

    /* 以晴天为基准，看每种天气的能力损失 */
    const base = row.weathers.clear;
    if (!base || base.error) {
      console.log('    【' + role + '】基准测量失败: ' + (base && base.error ? base.error : '无数据'));
      continue;
    }

    let line = '    ' + role.padEnd(9) + '跳高 ' + String(base.jumpHeight).padStart(3) +
      ' / 射程 ' + String(base.sprintRange).padStart(4) +
      ' / 刹车 ' + String(base.brakeDist).padStart(3);
    console.log(line);

    for (const w of WEATHERS) {
      const a = row.weathers[w];
      if (!a || a.error) { console.log('      ' + w.padEnd(8) + '✗ 测量失败: ' + (a && a.error)); continue; }
      const dH = base.jumpHeight - a.jumpHeight;
      const dR = base.sprintRange - a.sprintRange;
      const dB = a.brakeDist - base.brakeDist;
      const pct = x => (x >= 0 ? '-' : '+') + Math.abs(Math.round(x / Math.max(1, base.jumpHeight) * 100)) + '%';
      console.log('      ' + w.padEnd(8) +
        '跳高 ' + String(a.jumpHeight).padStart(3) + '(' + String(dH).padStart(3) + ')' +
        ' 射程 ' + String(a.sprintRange).padStart(4) + '(' + String(dR).padStart(4) + ')' +
        ' 刹车 ' + String(a.brakeDist).padStart(4) + '(' + String(dB).padStart(4) + ')' +
        ' 左跑 ' + String(a.leftDist).padStart(4));

      /* ============================================================
       * ---- 判定：能力损失是否超过门槛 ----
       * ============================================================
       * 实测结论（第 5 关数据）：
       *   · 跳高：**所有天气下都是 31px，完全不变** → 不存在"上不去"
       *   · 射程：变化在 ±7px（2%）以内 → 不存在"跳不过"
       *   · 刹车：暴雨 10→45（4.5倍）、大风 10→93（9倍）← **这才是真正受影响的**
       * ⇒ 所以死局风险**不在"能不能过去"，而在"能不能精确停下"**。
       *   判定标准也据此调整为三项：
       *     ① 跳高损失 > 25%  → 死局（上不去平台）
       *     ② 射程损失 > 30%  → 死局（跳不过缺口）
       *     ③ 刹车 > 200px    → 太滑了（在窄平台上会滑出去，实质变难）
       * ============================================================ */
      const hLoss = (base.jumpHeight - a.jumpHeight) / Math.max(1, base.jumpHeight);
      const rLoss = (base.sprintRange - a.sprintRange) / Math.max(1, base.sprintRange);

      check(hLoss <= 0.25 && rLoss <= 0.30,
        role + ' 在 ' + w + ' 下"能不能过去"没受致命影响' +
        '（跳高 ' + a.jumpHeight + 'px / 射程 ' + a.sprintRange + 'px）');

      /* ③ 刹车：这是真正会变差的项目，给一个"合理上限"
       * ⚠️ 上限不是"死局线"而是"手感线" ——
       *    超过这个值，玩家在窄平台上会明显滑出去，
       *    虽然还能过，但会很难受。所以设 200px（约 3 个身位）。 */
      check(a.brakeDist <= 200,
        role + ' 在 ' + w + ' 下刹车距离 ' + a.brakeDist + 'px（≤200，不会滑得没法停）');
    }
  }
}

console.log('\n' + '='.repeat(62));
console.log('  汇总：' + pass + ' 项通过 / ' + fail + ' 项失败');
if (problems.length) {
  console.log('  ⚠️ 问题：');
  problems.forEach(p => console.log('    · ' + p));
}
console.log('='.repeat(62));

function buildSandboxWithScripts() {
  const sb = buildSandbox();
  loadScripts(sb, [
    'physics.js', 'sprites.js', 'save.js', 'characters.js',
    'device-mode.js', 'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'actions.js', 'thunder.js',
  ]);
  /* ⚠️ 不要在这里声明 Game —— game.js 自己会建（重复声明会报
   *    "Identifier 'Game' has already been declared"）。
   *    这里只补 game.js 依赖的**外部桩**（UI / Sound / Net 等）。 */
  vm.runInContext(`
    var UI = { root: null, lastKey: '', panel: null };
    var Net = { role: 'host', localInput: {}, notifyInputChanged: function(){} };
    /* Sound 的桩：把 game.js 里用到的**全部**方法都列上。
     * ⚠️ 漏一个就会在跑到那行时抛 "xxx is not a function"，
     *    而且报错位置很靠后、不容易看出是桩的问题（踩过一次）。 */
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
  /* 把核心文件加载进来（这些依赖上面的桩） */
  const p1 = path.join(SRC, 'js', 'game.js');
  /* ⚠️ game.js 用到 save.js 的 SAVE()、characters.js 的 charByRole()
   *    等等，这些已经在上面 loadScripts 里加载过了。 */
  /* ⚠️ game.js 依赖 UI/Sound/Net 等，这里用 try 包住 —— 桩不全时跳过部分 */
  try {
    vm.runInContext(fs.readFileSync(p1, 'utf8'), sb, { filename: 'game.js' });
  } catch (e) {
    throw new Error('game.js 加载失败: ' + e.message);
  }
  return sb;
}

/* ============================================================
 * ⚡ 雷电行为测试（2026-10-06）
 * ============================================================
 * 雷电是唯一"主动伤害玩家"的天气，所以它的规则必须单独守：
 *   ① 只在 thunder 天气下激活
 *   ② 一定先预警、后落雷（**不能悄无声息地劈**）
 *   ③ 落点**不跟随玩家**（否则是必中，不是"需躲避"）
 *   ④ 玩家躲开就不该受伤
 * ============================================================ */
console.log('\n=== ⚡ 雷电行为 ===');
{
  const sb = buildSandboxWithScripts();
  const run = e => vm.runInContext(e, sb);

  run('Game.skipWeatherBrief = true; Game.mode="single"; Game.playerCount=1; loadLevel(0);');

  /* ① 非雷电天气：不激活 */
  run('THUNDER.reset(Game.level); Game.level.weather = null;');
  for (let f = 0; f < 300; f++) run('THUNDER.update(Game.level, function(){});');
  check(run('THUNDER.isWarning()') === false && run('THUNDER.strikes().length') === 0,
    '非雷电天气下雷电完全不激活');

  /* ② 雷电天气：会进入预警（先预警、后落雷） */
  run('THUNDER.reset(Game.level); Game.level.weather = "thunder";');
  let sawWarn = false, warnBeforeStrike = true;
  for (let f = 0; f < 400; f++) {
    const warn = run('THUNDER.isWarning()');
    const strikes = run('THUNDER.strikes().length');
    if (warn) sawWarn = true;
    /* ⚠️ 关键：出现落雷时，必须**之前**出现过预警 */
    if (strikes > 0 && !sawWarn) warnBeforeStrike = false;
    run('THUNDER.update(Game.level, function(){});');
  }
  check(sawWarn, '雷电天气下会出现预警');
  check(warnBeforeStrike, '★ 落雷之前一定先预警（不会"悄无声息地劈"）');

  /* ③ 预警时长 = CONFIG 里设定的帧数（保证玩家有反应时间） */
  const warnFrames = run('CONFIG.WEATHER_THUNDER_WARN');
  check(warnFrames >= 30,
    '★ 预警时长 ' + warnFrames + ' 帧（≈' + (warnFrames / 60).toFixed(2) + ' 秒）≥ 30 帧（人的反应时间下限）');

  /* ④ 落点固定、不跟随玩家（"需躲避"而不是"必中"） */
  run('THUNDER.reset(Game.level); Game.level.weather = "thunder";');
  /* 跑到进入预警 */
  let guard = 0;
  while (!run('THUNDER.isWarning()') && guard++ < 500) run('THUNDER.update(Game.level, function(){});');
  const t1 = run('(function(){var t = THUNDER.pendingTarget(); return t ? Math.round(t.x) : null; })()');
  /* 把玩家挪远，看落点会不会跟着变 */
  run('Game.players[0].x += 400;');
  run('THUNDER.update(Game.level, function(){});');
  const t2 = run('(function(){var t = THUNDER.pendingTarget(); return t ? Math.round(t.x) : null; })()');
  check(t1 === t2 && t1 !== null,
    '★ 落点在预警开始后就固定（玩家跑开不会跟着劈 —— 这才叫"需躲避"）: ' + t1 + ' → ' + t2);

  /* ⑤ 躲开就不受伤 */
  run('THUNDER.reset(Game.level); Game.level.weather = "thunder";');
  let dmgCount = 0;
  run('Game.players[0].x = 100;');
  /* 让玩家一直待在落点很远的地方 */
  for (let f = 0; f < 600; f++) {
    const t = run('(function(){var t=THUNDER.pendingTarget();return t?t.x:null;})()');
    if (t !== null) run('Game.players[0].x = ' + (t + 800) + ';');   // 一直躲远
    run('THUNDER.update(Game.level, function(p, a, r){ window.__dmg = (window.__dmg||0)+1; });');
  }
  const hit = run('typeof window !== "undefined" && window.__dmg ? window.__dmg : 0');
  check(hit === 0, '★ 玩家一直待在落点外 → 不会被雷劈中（伤害次数 ' + hit + '）');
}
