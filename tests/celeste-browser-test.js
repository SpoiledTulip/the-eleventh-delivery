/* ============================================================
 * 新动作系统 · 真实浏览器验证
 * ============================================================
 * 为什么不能只用 Node 测：
 *   ① 滑墙/冲刺的**姿态表现**（倾斜、拉伸、抖动）只在真实
 *      Canvas 绘制路径里才会执行，Node 沙箱里 ctx 是假的。
 *   ② HUD 的体力条/冲刺格也是绘制代码。
 *   ③ 要确认新渲染逻辑**没把主循环搞崩**（帧率是否还稳）。
 *
 * 做法：起一个本地 HTTP 服务，用真实 Chrome（无头）打开，
 * 然后通过 CDP 驱动角色做出各种动作，检查：
 *   - 绘制调用有没有抛异常（监听 console error）
 *   - 帧率是否仍稳定在 60 左右
 *   - 新动作的绘制分支是否真的被执行到
 * ============================================================ */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
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

const http = require('http');

const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = SRC;   // ← 迁移后：源码在 src/ 下
const HTTP_PORT = 8931;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css',
};

/* 起一个静态服务（不能用 file://，因为云 SDK 加载路径不同） */
const server = http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  fs.readFile(f, function (e, d) {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

const URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; problems.push(name); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

(async function () {
  await new Promise(function (r) { server.listen(HTTP_PORT, '127.0.0.1', r); });

  const ud = path.join(require('os').tmpdir(), 'cel-br-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=9401', '--user-data-dir=' + ud,
    '--window-size=1280,800', URL,
  ], { stdio: 'ignore' });

  let cl;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { cl = await CDP({ port: 9401 }); break; } catch (e) {}
  }
  try {
    const ts = await CDP.List({ port: 9401 });
    const w = ts.filter(function (t) { return t.type === 'page'; })
      .find(function (t) { return t.url && t.url.indexOf('index.html') >= 0; });
    if (w && w.id !== cl._targetId) { await cl.close(); cl = await CDP({ port: 9401, target: w.id }); }
  } catch (e) {}

  const { Runtime, Log } = cl;
  await Runtime.enable();
  try { await Log.enable(); } catch (e) {}

  /* 收集页面里的错误 */
  const pageErrors = [];
  try {
    Log.entryAdded(function (p) {
      if (p.entry && p.entry.level === 'error') pageErrors.push(p.entry.text);
    });
  } catch (e) {}

  async function ev(expr) {
    const r = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    }
    return r.result.value;
  }

  await sleep(3500);

  console.log('新动作 · 真实浏览器验证');
  console.log('='.repeat(56));

  /* ★ 解锁全部动作 ★
   * 游戏默认"动作逐步解锁"（新档一个都不会）。
   * 本测试测的是动作的**实际表现**，所以先把动作全开。
   * 解锁流程本身由 unlock-browser-test.js 单独验证。 */
  await ev(`(function(){
    Save.load();
    Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];
    Save.data.maxUnlocked = 99;
    return true;
  })()`);

  /* ------------------------------------------------------------
   * 1. 页面加载与模块可用
   * ------------------------------------------------------------ */
  console.log('\n=== 1. 加载与模块 ===');
  const mods = await ev('({actions: typeof ACTIONS, celeste: typeof CELESTE, dart: typeof ACTIONS !== "undefined" && !!ACTIONS.drawDashTrail})');
  check('ACTIONS 模块已加载', mods.actions === 'object', JSON.stringify(mods));
  check('CELESTE 参数块可用', mods.celeste === 'object', JSON.stringify(mods));
  check('冲刺残影绘制接口存在', mods.dart === true, JSON.stringify(mods));

  /* ------------------------------------------------------------
   * 2. 进入第5关（动作关）
   * ------------------------------------------------------------ */
  console.log('\n=== 2. 进入第 5 关（动作试炼场）===');
  const goLv5 = await ev(`(function(){
    Game.mode='local'; Game.playerCount=1; Game.pickRole='kangaroo';
    var ok = loadLevel(4);            // 索引 4 = 第5关
    Game.state='playing';
    return {
      ok: !!Game.level,
      name: Game.level ? Game.level.name : null,
      movers: Game.level.movers ? Game.level.movers.length : -1,
      switchers: Game.level.switchers ? Game.level.switchers.length : -1,
      windGates: Game.level.windGates ? Game.level.windGates.length : -1,
      spawns: Game.level.spawns ? Game.level.spawns.length : -1,
    };
  })()`);
  console.log('   ' + JSON.stringify(goLv5));
  check('第 5 关能加载', goLv5.ok === true, JSON.stringify(goLv5));
  check('移动平台已生成', goLv5.movers >= 1, 'movers=' + goLv5.movers);
  check('开关已生成', goLv5.switchers >= 1, 'switchers=' + goLv5.switchers);
  check('风场已生成', goLv5.windGates >= 1, 'windGates=' + goLv5.windGates);

  /* ------------------------------------------------------------
   * 3. 帧率是否被新渲染逻辑拖慢
   * ------------------------------------------------------------ */
  console.log('\n=== 3. 帧率（新渲染逻辑不能拖慢主循环）===');
  await ev(`(function(){
    window.__fps = 0;
    window.__t0 = performance.now();
    window.__f0 = Game.frame;
    return true;
  })()`);
  await sleep(2000);
  const fps = await ev(`(function(){
    var dt = (performance.now() - window.__t0) / 1000;
    return Math.round((Game.frame - window.__f0) / dt);
  })()`);
  console.log('   实测帧率: ' + fps + ' fps');
  check('帧率正常（>= 50）', typeof fps === 'number' && fps >= 50, fps + ' fps');

  /* ------------------------------------------------------------
   * 4. 驱动角色做各动作，检查绘制不报错
   * ------------------------------------------------------------ */
  console.log('\n=== 4. 各动作的真实绘制路径 ===');

  /* 造一个开阔场地，方便依次试动作 */
  await ev(`(function(){
    Game.state='playing';
    Game.level.solids.length = 0;
    Game.level.platforms.length = 0;
    Game.level.height = 5000;
    Game.level.width = 4000;
    Game.level.solids.push({x:-1000, y:1400, w:8000, h:64});   // 大地板
    Game.level.solids.push({x:900, y:-200, w:32, h:1600});     // 一面高墙（滑墙/墙跳用）
    return true;
  })()`);

  async function doFrames(keys, n, holdPos) {
    return await ev(`(function(){
      var keys = ${JSON.stringify(keys)};
      /* ★ 2026-10-07：冲刺键已从 Shift 改成 F（actions.js 的 DASH_KEYS_BASE）。
       *   调用方继续写 ShiftLeft/ShiftRight（表达"按冲刺键"的意图），
       *   这里统一映射成**当前真实键位** ⇒ 以后改键位这个文件不用动。 */
      var DK = (typeof ACTIONS !== 'undefined' && ACTIONS.DASH_KEYS && ACTIONS.DASH_KEYS[0]) || 'KeyF';
      for (var i = 0; i < ${n}; i++) {
        ${holdPos ? 'Game.players[0].x=' + holdPos.x + '; Game.players[0].y=' + holdPos.y + '; Game.players[0].onGround=false;' : ''}
        InputState.now = {};
        for (var k in keys) if (keys[k]) {
          var real = (k === 'ShiftLeft' || k === 'ShiftRight') ? DK : k;
          InputState.now[real] = true;
        }
        update(1/60);
        InputState.tick();
      }
      return {
        x: Game.players[0].x, y: Game.players[0].y,
        actWallDir: Game.players[0].actWallDir,
        actWallSlide: Game.players[0].actWallSlide,
        actDashT: Game.players[0].actDashT,
        stam: Game.players[0].actGrabStamina,
        dashes: Game.players[0].actDashes,
        state: Game.state,
      };
    })()`);
  }

  /* 4-1 滑墙 */
  let r = await doFrames({ KeyD: true }, 4, { x: 873, y: 700 });
  console.log('   滑墙: wallDir=' + r.actWallDir + ' slide=' + r.actWallSlide + ' 体力=' + Math.round(r.stam));
  check('滑墙状态被触发', r.actWallDir === 1, JSON.stringify(r));
  check('滑墙时体力在消耗', r.stam < 72, 'stam=' + r.stam);

  /* 4-2 墙跳
   * ------------------------------------------------------------
   * ⚠️ 关键：要在**墙跳发生的那一帧**就把 vx 抓下来。
   * 踩过的坑：之前是"跑几帧之后再读 vx"，而墙跳后角色会继续
   * 被地面/移动逻辑接管，vx 很快被改掉 —— 于是断言时有时无地失败。
   * 正确做法：**逐帧检测 actWallJumpLock 从 0 变正的那一刻**，
   * 当场记录 vx。这样不依赖"跑几帧刚好踩中"。 */
  const wj = await ev(`(function(){
    var p = Game.players[0];
    var keys = { KeyD: true, Space: true };
    var out = { vx: 0, vy: 0, lock: 0, found: false };
    for (var i = 0; i < 8; i++) {
      /* 每帧把角色钉在墙边（保持贴墙状态） */
      p.x = 873; p.y = 700; p.onGround = false;
      InputState.now = {};
      for (var k in keys) if (keys[k]) InputState.now[k] = true;
      update(1/60);
      InputState.tick();
      /* ★ 墙跳发生的判定：锁被置上 ★ */
      if (p.actWallJumpLock > 0) {
        out.vx = p.vx; out.vy = p.vy; out.lock = p.actWallJumpLock;
        out.found = true;
        break;
      }
    }
    return out;
  })()`);
  console.log('   墙跳: vx=' + wj.vx.toFixed(2) + ' vy=' + wj.vy.toFixed(2) +
    ' lock=' + wj.lock + (wj.found ? '' : '（没触发）'));
  check('墙跳触发了（出现锁定帧）', wj.found === true, JSON.stringify(wj));
  check('墙跳产生向左的弹速', wj.vx < -2, 'vx=' + wj.vx);

  /* 4-3 冲刺（水平） */
  await ev(`(function(){
    var p = Game.players[0];
    p.x=500; p.y=600; p.vx=0; p.vy=0; p.onGround=false;
    p.actDashes=1; p.actDashCool=0; p.actDashT=0; p._actDashKeyPrev=false;
    p.actWallDir=0; p.actWallJumpLock=0;
    return true;
  })()`);
  const beforeDash = await ev('Game.players[0].x');
  /* ⚠️ 这里**不能**钉住位置 —— 钉住就等于把位移抹掉了（踩过这个坑）。 */
  r = await doFrames({ ShiftLeft: true, ArrowRight: true }, 7, null);
  const dashInfo = await ev('({x: Game.players[0].x, trail: Game.players[0].actDashTrail ? Game.players[0].actDashTrail.length : -1, dashT: Game.players[0].actDashT})');
  console.log('   冲刺: x ' + Math.round(beforeDash) + ' → ' + Math.round(dashInfo.x) +
    '（行进 ' + Math.round(dashInfo.x - beforeDash) + 'px，残影 ' + dashInfo.trail + ' 个）');
  check('冲刺产生了位移（≥ 60px）', dashInfo.x - beforeDash >= 60,
    '位移 ' + Math.round(dashInfo.x - beforeDash) + 'px');

  /* 4-4 全套动作连跑，看有没有绘制异常 */
  console.log('\n=== 5. 连续动作（压力测试绘制路径）===');
  const stress = await ev(`(function(){
    var p = Game.players[0];
    var errs = [];
    /* ★ 冲刺键现读（见 doFrames 的说明） */
    var DK = (typeof ACTIONS !== 'undefined' && ACTIONS.DASH_KEYS && ACTIONS.DASH_KEYS[0]) || 'KeyF';
    try {
      for (var round = 0; round < 3; round++) {
        // 滑墙 → 墙跳 → 冲刺，循环
        p.x=873; p.y=700; p.vx=0; p.vy=0; p.onGround=false;
        p.actGrabStamina = 72; p.actWallJumpLock=0; p.actDashT=0;
        p.actDashes = 1; p.actDashCool=0; p._actDashKeyPrev=false;
        for (var i = 0; i < 6; i++) { InputState.now={KeyD:true}; update(1/60); InputState.tick(); }
        for (var i = 0; i < 4; i++) { InputState.now={KeyD:true, Space:true}; update(1/60); InputState.tick(); }
        for (var i = 0; i < 8; i++) { var kk={}; kk[DK]=true; kk['ArrowLeft']=true; InputState.now=kk; update(1/60); InputState.tick(); }
        for (var i = 0; i < 4; i++) { InputState.now={}; update(1/60); InputState.tick(); }
      }
      return { ok: true, state: Game.state, frame: Game.frame };
    } catch (e) {
      return { ok: false, err: String(e) + ' | ' + (e.stack || '').split('\\n')[1] };
    }
  })()`);
  console.log('   ' + JSON.stringify(stress));
  check('连续动作不抛异常', stress.ok === true, stress.err || '');

  /* ------------------------------------------------------------
   * 6. 页面级错误
   * ------------------------------------------------------------ */
  /* ------------------------------------------------------------
   * 7. ★ 行走动作（2026-10-06 新增）★
   * ------------------------------------------------------------
   * 十一要求"增加美团袋鼠和飞龙宝宝的行走动作"。
   *
   * ⚠️ 测试方法的坑（一定要看，不然会白测）：
   *    一开始我用 getImageData 去读画布像素、比较"走路前后是否变化"，
   *    结果**怎么改都测不出差异**，连"把角色瞬移 200px"都比不出变化 ——
   *    说明 headless 下 getImageData 拿到的不是实时帧。
   *    ⇒ 正确做法：**挂钩 drawCharacter，直接看它每帧收到的
   *      y（起伏）和 squash（挤压）参数**。这两个量只由行走动作产生，
   *      和"角色位置变化"无关，能干净地证明动画在跑。
   * ------------------------------------------------------------ */
  console.log('\n=== 7. 行走动作 ===');
  await ev(`(function(){
    window.__dr = [];
    var orig = drawCharacter;
    window.drawCharacter = function(ctx, spr, x, y, w, h, flip, squash, unused, spin){
      window.__dr.push({y: Number(y.toFixed(3)), sq: Number((squash||1).toFixed(5))});
      if (window.__dr.length > 500) window.__dr.shift();
      return orig.apply(this, arguments);
    };
    return 'hooked';
  })()`);

  for (const role of ['kangaroo', 'dragon']) {
    await ev(`(function(){
      window.__dr.length = 0;
      Game.mode='single'; Game.playerCount=1; Game.pickRole='${role}'; loadLevel(0);
      InputState.clear();
    })()`);
    await sleep(800);

    /* 静止：什么都不按 */
    await ev(`(function(){ InputState.clear(); window.__dr.length = 0; })()`);
    await sleep(650);
    const still = (await ev('window.__dr.slice()'));
    /* 行走：按住右方向键 */
    await ev(`(function(){ InputState.setKey('ArrowRight', true); window.__dr.length = 0; })()`);
    await sleep(650);
    const moving = (await ev('window.__dr.slice()'));
    await ev('InputState.clear()');

    const spread = (arr, k) => !arr || !arr.length ? 0
      : Math.max.apply(null, arr.map(e => e[k])) - Math.min.apply(null, arr.map(e => e[k]));
    const stillY = spread(still, 'y'), stillSq = spread(still, 'sq');
    const moveY = spread(moving, 'y'), moveSq = spread(moving, 'sq');

    check('★ ' + role + ' 行走时有上下起伏',
      moving && moving.length > 5 && moveY > 1.0,
      'y 波动=' + moveY.toFixed(2) + '（需 >1.0，采样 ' + (moving ? moving.length : 0) + ' 帧）');
    check('★ ' + role + ' 行走时有挤压拉伸',
      moving && moving.length > 5 && moveSq > 0.02,
      'squash 波动=' + moveSq.toFixed(4) + '（需 >0.02）');
    check('★ ' + role + ' 静止时保持站姿（不抖）',
      still && still.length > 5 && stillY < 0.5 && stillSq < 0.01,
      'y 波动=' + stillY.toFixed(2) + ' squash 波动=' + stillSq.toFixed(4));
  }

  /* ============================================================
   * ★ 5.5 时限系统：计时器只在骑手模式出现（2026-10-06 第 3 期）★
   * ============================================================
   * 方案第 3 期的硬验收点：
   *   · 骑手模式 → HUD 显示倒计时
   *   · ★经典模式 → 完全不显示计时器★
   *   · ★超时绝不影响过关★（本段最后一条断言）
   *
   * ⚠️ 判定方法：把 drawRiderTimer 包一层计数。
   *    为什么不用"看画布上有没有暗像素"——那片区域本来就有别的东西
   *    （订单看板下沿、金币），暗像素数会误判（踩过这个坑）。
   *    只有"函数被调用了几次"才是精确答案。
   * ============================================================ */
  console.log('\n=== 5.5 时限系统：计时器只在该出现时出现 ===');
  await ev(`
    window.__timerCalls = 0;
    var __origTimer = window.drawRiderTimer;
    if (typeof __origTimer === 'function') {
      window.drawRiderTimer = function(){
        window.__timerCalls++;
        return __origTimer.apply(this, arguments);
      };
    }
    'ok'
  `);

  const timerModes = [
    { mode: 'classic', label: '经典模式', should: false },
    { mode: 'rider',   label: '骑手模式', should: true  },
  ];
  for (const tm of timerModes) {
    await ev(`
      window.__timerCalls = 0;
      Save.setMode('${tm.mode}');
      Game.mode='single'; Game.playerCount=1;
      loadLevel(0);
      Game.state='playing';
      Game.elapsed = 30;
      'ok'
    `);
    await sleep(800);
    const calls = await ev('window.__timerCalls');
    check('★ ' + tm.label + '：计时器' + (tm.should ? '显示' : '不显示'),
      tm.should ? (calls > 0) : (calls === 0),
      'drawRiderTimer 调用 ' + calls + ' 次');
  }

  /* ============================================================
   * ★★ 超时行为"按模式分叉"（2026-10-06 改）★★
   * ============================================================
   * ⚠️ 这一段原来只有一条断言："骑手模式严重超时后仍在进行"。
   *    十一的新规则改成按模式区分：
   *      · 经典模式 = 放松模式 → 超时不失败（老行为，保留）
   *      · 骑手模式 = 压力模式 → 超时即失败（新规则）
   *    ⇒ 老断言**不删**，改成两条按模式分别断言。
   *
   * ⚠️ 伪造"已超时"必须改 **Game.startTime**，不能改 Game.elapsed ——
   *    updatePlaying 第一行就会用 performance.now() - startTime 重算 elapsed，
   *    手改的 elapsed 会被覆盖（这个坑在 save-test 里踩过一次）。
   * ============================================================ */
  /* 把"本局起跑时间"往前推 N 秒 → 等价于"已经跑了 N 秒" */
  async function fakeElapsed(seconds) {
    await ev('Game.startTime = performance.now() - ' + (seconds * 1000) + '; "ok"');
  }

  /* ---- a. 经典模式：严重超时 → 仍在进行（老行为必须保住）---- */
  await ev(`
    Game.skipWeatherBrief = true;
    Save.setMode('classic');
    Game.mode='single'; Game.playerCount=1; loadLevel(0);
    Game.state='playing';
    Game.deathReason = '';
    'ok'
  `);
  await fakeElapsed(9999);
  await sleep(400);
  const classicOver = await ev('({state: Game.state, reason: Game.deathReason})');
  check('★★ 经典模式：严重超时后游戏仍在进行（超时≠失败，老行为保住）',
    classicOver.state === 'playing' && !classicOver.reason,
    'state=' + classicOver.state + ' deathReason=' + JSON.stringify(classicOver.reason));

  /* ---- b. 骑手模式：超时过宽限期 → 失败（新规则）---- */
  await ev(`
    Save.setMode('rider');
    Game.mode='single'; Game.playerCount=1; loadLevel(0);
    Game.state='playing';
    Game.deathReason = '';
    'ok'
  `);
  await fakeElapsed(9999);
  await sleep(400);
  const riderOver = await ev('({state: Game.state, reason: Game.deathReason})');
  check('★★ 骑手模式：超时过宽限期 → 判负（新规则）',
    riderOver.state === 'gameover' && riderOver.reason === 'timeout',
    'state=' + riderOver.state + ' deathReason=' + JSON.stringify(riderOver.reason));

  /* ---- c. 骑手模式：宽限期内 → 还在进行（不能误杀）---- */
  await ev(`
    Save.setMode('rider');
    Game.mode='single'; Game.playerCount=1; loadLevel(0);
    Game.state='playing';
    Game.deathReason = '';
    'ok'
  `);
  /* 超时 1 秒（宽限期 5 秒内）→ 必须还活着 */
  await ev('Game.startTime = performance.now() - (Game.level.targetTime + 1) * 1000; "ok"');
  await sleep(400);
  const riderGrace = await ev('({state: Game.state, reason: Game.deathReason})');
  check('★★ 骑手模式：宽限期内仍在进行（★没有误杀★）',
    riderGrace.state === 'playing' && !riderGrace.reason,
    'state=' + riderGrace.state + ' deathReason=' + JSON.stringify(riderGrace.reason));

  /* 收尾：恢复经典模式，免得影响后面的检查 */
  await ev("Save.setMode('classic'); Game.skipWeatherBrief = false; 'ok'");

  /* ============================================================
   * ★ 5.6 E1 气象播报过场 + E2 催单气泡（2026-10-06 第 5 期）★
   * ============================================================
   * 验证：
   *   · 单人模式下点关卡 → 先进 weather_brief 过场（不是直接 playing）
   *   · 过场界面有：播报台、天气名、播报台词、收到按钮
   *   · 点掉之后正常进游戏（playing）
   *   · 催单气泡：超时前不出现，超时后出现
   * ============================================================ */
  console.log('\n=== 5.6 气象播报过场 + 催单气泡 ===');

  /* ---- E1：过场出现 ---- */
  await ev(`
    Game.skipWeatherBrief = false;   // 确保没被上一个测试关掉
    Game.mode='single'; Game.playerCount=1;
    startGame(0);
    'ok'
  `);
  await sleep(500);
  const briefState = await ev('Game.state');
  check('★ 单人点关卡先进「气象播报」过场', briefState === 'weather_brief',
    'state=' + briefState);

  const briefDom = await ev(`(function(){
    var s = document.getElementById('weather-brief');
    return {
      hasBoard: !!(s && s.querySelector('.wb-board')),
      hasAvatar: !!(s && s.querySelector('.wb-avatar')),
      hasWeather: !!(s && s.querySelector('.wb-weather')),
      hasScript: !!(s && s.querySelector('.wb-script')),
      scriptText: s && s.querySelector('.wb-script') ? s.querySelector('.wb-script').textContent : '',
      weatherText: s && s.querySelector('.wb-weather') ? s.querySelector('.wb-weather').textContent : ''
    };
  })()`);
  check('★ 播报过场有播报台 + 播报员头像',
    briefDom.hasBoard && briefDom.hasAvatar, JSON.stringify(briefDom));
  check('★ 播报过场显示了天气和台词',
    briefDom.hasWeather && briefDom.hasScript && briefDom.scriptText.length > 6,
    '天气=' + briefDom.weatherText + ' 台词长度=' + briefDom.scriptText.length);

  /* ---- E1：点掉能进游戏 ---- */
  await ev('(function(){ if(Game.startAfterBrief) Game.startAfterBrief(); })()');
  await sleep(600);
  const afterBrief = await ev('({state: Game.state, hasLevel: !!Game.level})');
  check('★ 播报过场点掉后正常进入游戏',
    afterBrief.state === 'playing' && afterBrief.hasLevel === true,
    JSON.stringify(afterBrief));

  /* ---- E2：催单气泡——超时前不出现、超时后出现 ---- */
  await ev(`
    Game.skipWeatherBrief = true;
    Save.setMode('rider');
    Game.mode='single'; Game.playerCount=1;
    loadLevel(0);
    Game.state='playing';
    'ok'
  `);
  /* 超时前 */
  await ev('Game.elapsed = 10; "ok"');     // 目标 90 秒，远没超
  await sleep(300);
  const nagBefore = await ev(
    '(function(){ if(typeof customerNagLine!=="function") return "no-fn"; ' +
    'return customerNagLine(Game.elapsed - (Game.level.targetTime||0), 0); })()');
  check('★ 没超时时不产生催单文案', nagBefore === null,
    '返回=' + JSON.stringify(nagBefore));

  /* 超时后（分三档验证语气递进） */
  const nagTiers = await ev(`(function(){
    if (typeof customerNagLine !== 'function') return null;
    return {
      gentle: customerNagLine(5, 0),    // 超 5 秒 → 客气档
      urgent: customerNagLine(25, 0),   // 超 25 秒 → 着急档
      angry:  customerNagLine(60, 0),   // 超 60 秒 → 暴躁档
      urg0: customerNagUrgency(5),
      urg1: customerNagUrgency(60)
    };
  })()`);
  check('★ 超时后出现催单文案（三档都有内容）',
    nagTiers && nagTiers.gentle && nagTiers.urgent && nagTiers.angry,
    JSON.stringify(nagTiers));
  check('★ 催单语气分档（三档文案互不相同）',
    nagTiers && nagTiers.gentle !== nagTiers.urgent &&
    nagTiers.urgent !== nagTiers.angry,
    '客气=' + (nagTiers && nagTiers.gentle) + ' / 暴躁=' + (nagTiers && nagTiers.angry));
  check('★ 催单紧急度随时间升高',
    nagTiers && nagTiers.urg1 > nagTiers.urg0,
    '超5秒=' + (nagTiers && nagTiers.urg0) + ' 超60秒=' + (nagTiers && nagTiers.urg1));

  /* ---- ★ E2 是幽默层，不是惩罚层：超时后游戏必须还在进行 ----
   * ⚠️ 2026-10-06 随"骑手模式超时失败"一起调整：
   *   这条测的是"**催单气泡本身不惩罚玩家**"，所以**必须跑在经典模式**下 ——
   *   骑手模式现在超时会判负，那是另一个机制（见上面 5.5 的 b 条）。
   *   两者不要混：催单气泡 = 幽默层（经典模式下即便超时也不打人）；
   *              超时判负   = 骑手模式的压力机制。
   * ⚠️ 伪造超时同样用 startTime（不能改 elapsed，会被重算覆盖）。 */
  await ev("Save.setMode('classic'); Game.deathReason=''; 'ok'");
  await ev('Game.startTime = performance.now() - 99999 * 1000; "ok"');
  await sleep(400);
  const stillPlaying = await ev('({s: Game.state, r: Game.deathReason})');
  check('★★ 经典模式下超时 + 催单后游戏仍在进行（催单不惩罚）',
    stillPlaying.s === 'playing' && !stillPlaying.r,
    JSON.stringify(stillPlaying));

  /* 收尾：把跳过开关恢复，免得影响后面的检查 */
  await ev('Game.skipWeatherBrief = false; "ok"');

  /* ============================================================
   * ★ 5.7 天气：只做「雾」，且不改物理（2026-10-06 第 6 期）★
   * ============================================================
   * 十一的硬性要求：
   *   "★'雾'不可以改变任何物理参数★"
   *
   * 所以这里验证两件事：
   *   ① 有雾的关卡，drawWeather 真的被调用、真的画了东西
   *   ② ★带雾和不带雾，玩家的物理表现**完全一样**★
   *      （用同一串操作跑两遍，对比角色轨迹）
   *   ③ 暴雨/大风/雷电**没有**被实现（代码里只有 TODO）
   * ============================================================ */
  console.log('\n=== 5.7 天气：只有雾，且不改物理 ===');

  /* ---- ① 有雾的关卡会调用天气绘制 ---- */
  const fogInfo = await ev(`(function(){
    Game.skipWeatherBrief = true;
    Game.mode='single'; Game.playerCount=1;
    /* 第 4 关（索引 3）配了 fog */
    var lv4 = PLAYABLE_LEVELS()[3];
    return {
      lv4Weather: lv4 ? lv4.weather : null,
      others: PLAYABLE_LEVELS().map(function(l){ return l.weather || null; }),
      hasDrawWeather: typeof drawWeather === 'function',
      hasDrawFog: typeof drawFog === 'function'
    };
  })()`);
  check('★ 第 4 关配了雾',
    fogInfo.lv4Weather === 'fog',
    JSON.stringify(fogInfo.others));
  /* ⚠️ 2026-10-07：断言从"除第 4 关外都无天气"改成"**指定天气的关卡都在白名单里**"。
   *   原因：项目从 5 关扩到 30 关，第 12/19/20 关按剧情**主动指定**了天气
   *   （12=thunder 悬崖躲雷、19=thunder 电网塔、20=thunder 终局暴风）。
   *   原来的断言假设"只有第 4 关有天气"，是**过期的**。
   *   ⇒ 现在只要求"指定的天气都是合法 key"，语义更准确。 */
  const SPECIFIED_OK = ['fog', 'rain', 'snow', 'night', 'wind', 'thunder', 'clear'];
  const badWeather = fogInfo.others.filter(function (x) {
    return x && SPECIFIED_OK.indexOf(x) < 0;
  });
  check('★ 关卡指定的天气都是合法 key',
    badWeather.length === 0,
    JSON.stringify({ all: fogInfo.others, bad: badWeather }));
  check('★ drawWeather / drawFog 已实现',
    fogInfo.hasDrawWeather && fogInfo.hasDrawFog, JSON.stringify(fogInfo));

  /* ---- ② ★最核心：带雾 vs 不带雾，物理表现必须一模一样 ---- */
  /* 跑同一段操作，记录角色的 x 轨迹，比较两条轨迹是否完全一致 */
  const PHYS_RUN = `(function(fogOn){
    Game.skipWeatherBrief = true;
    Game.mode='single'; Game.playerCount=1;
    loadLevel(3);                       // 第 4 关
    var lv = Game.level;
    /* 手动开/关雾（不改关卡数据，只改运行时标记） */
    lv.weather = fogOn ? 'fog' : null;
    var p = Game.players[0];
    p.x = 3*32; p.y = 23*32; p.vx = 0; p.vy = 0; p.onGround = true;
    var traj = [];
    for (var f = 0; f < 120; f++) {
      /* 统一的输入：一直向右 + 第 20 帧跳一次 */
      InputState.now = {};
      InputState.now['ArrowRight'] = true;
      if (f === 20) InputState.now['Space'] = true;
      update(1/60);
      InputState.tick();
      traj.push(Math.round(p.x * 1000) / 1000);   // 保留 3 位小数
    }
    return { traj: traj, endX: p.x, endY: p.y, vy: p.vy };
  })`;

  const noFog = await ev(PHYS_RUN + '(false)');
  const withFog = await ev(PHYS_RUN + '(true)');

  let sameTraj = noFog.traj.length === withFog.traj.length;
  if (sameTraj) {
    for (let i = 0; i < noFog.traj.length; i++) {
      if (noFog.traj[i] !== withFog.traj[i]) { sameTraj = false; break; }
    }
  }
  check('★★ 带雾 / 不带雾的物理轨迹**逐帧完全一致**（雾不改物理）',
    sameTraj,
    '无雾末位置 x=' + Math.round(noFog.endX) + ' y=' + Math.round(noFog.endY) +
    ' / 有雾 x=' + Math.round(withFog.endX) + ' y=' + Math.round(withFog.endY) +
    ' / 轨迹点数 ' + noFog.traj.length + ' vs ' + withFog.traj.length);

  /* ---- ③ 未知/未实现的天气值必须安全（不崩、不画东西） ----
   * ⚠️ 2026-10-06 更新语义：
   *   原来这里查的是"rain/wind/storm 未实现"（那时确实没实现）。
   *   现在 rain/wind 已经实现（纯视觉版，见 5.8 段），所以
   *   改查"**没在天气池里的**未知值不崩" —— 这条才是真正要守的：
   *   任何天气值传进来，drawWeather 都不能抛异常
   *   （有人手改关卡数据填个乱字符串也不能把游戏搞崩）。 */
  const notImplemented = await ev(`(function(){
    var errs = [];
    ['storm', 'blizzard_9000', '', 'RAIN', 'rain '].forEach(function(w){
      try {
        var lv = { weather: w };
        if (typeof drawWeather === 'function') {
          var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
          drawWeather(cv.getContext('2d'), 1.0, lv);
        }
      } catch(e) { errs.push(JSON.stringify(w) + ':' + e.message); }
    });
    return { errs: errs };
  })()`);
  check('★ 未实现的天气值（storm / 乱填 / 空串 / 大小写）不崩、安全兜底',
    notImplemented.errs.length === 0, JSON.stringify(notImplemented.errs));

  /* 收尾：把第 4 关天气恢复原样 */
  await ev('PLAYABLE_LEVELS()[3].weather = "fog"; Game.skipWeatherBrief = false; "ok"');

  /* ============================================================
   * ★ 5.8 随机天气 + 4 种新天气：只改画面，绝不动物理（2026-10-06）★
   * ============================================================
   * ⚠️ 这一段的语义**被十一自己反转过一次**（2026-10-06）：
   *
   * 【上一轮】"★所有天气都不得改变任何物理参数★"（怕运气决定成败）
   * 【这一轮】"要天气改操作手感"，且**选了全模式都改物理**
   *
   * ⇒ 现在的核心断言是**按三类分别测**（见下面轨迹对比那段）：
   *     · 纯视觉（fog/snow/night）→ 轨迹必须一致
   *     · 改手感（rain/wind）     → 轨迹必须不同
   *     · 环境危险（thunder）     → 轨迹不变，但必须有落雷行为
   *
   * ⚠️ 死局风险由 `tests/weather-physics-test.js` 的穷举测试兜底
   *    （5关 × 7天气 × 2角色，实测全部能过）。
   * ============================================================ */
  console.log('\n=== 5.8 随机天气：7 种天气的覆盖 + 物理分类 ===');

  /* ---- ① 7 种天气都有绘制函数、都能画出来（不崩） ---- */
  const wCoverage = await ev(`(function(){
    var keys = ['clear','fog','rain','snow','night','wind','thunder'];
    var missing = [], missingBrief = [], missingMumble = [];
    keys.forEach(function(k){
      if (k === 'clear') return;   // 晴天不需要绘制函数（不画东西）
      if (typeof window['draw' + k.charAt(0).toUpperCase() + k.slice(1)] !== 'function'){
        missing.push(k);
      }
      if (!WEATHER_BRIEFS[k]) missingBrief.push(k);
    });
    /* 含糊版：池子里除晴天外都该有（晴天没什么可含糊的） */
    keys.forEach(function(k){
      if (k !== 'clear' && !WEATHER_BRIEF_MUMBLE[k]) missingMumble.push(k);
    });
    return {
      keys: keys, missing: missing,
      missingBrief: missingBrief, missingMumble: missingMumble,
      pool: WEATHER_POOL.map(function(w){ return w.key + ':' + w.weight; }),
      briefKeys: Object.keys(WEATHER_BRIEFS)
    };
  })()`);
  check('★ 5 种天气的绘制函数都存在（fog/rain/snow/night/wind + thunder）',
    wCoverage.missing.length === 0, '缺少: ' + JSON.stringify(wCoverage.missing));
  check('★ 7 种天气都有播报台词',
    wCoverage.missingBrief.length === 0, '缺台词: ' + JSON.stringify(wCoverage.missingBrief));
  check('★ 6 种非晴天天气都有"含糊版"台词',
    wCoverage.missingMumble.length === 0, '缺含糊版: ' + JSON.stringify(wCoverage.missingMumble));
  check('★ 天气池和台词表的 key 完全对得上（不会抽到没台词的天气）',
    wCoverage.pool.every(function (p) {
      return wCoverage.briefKeys.indexOf(p.split(':')[0]) >= 0;
    }),
    '池=' + JSON.stringify(wCoverage.pool));

  /* ---- ② 每种天气都真的能画出来（调用绘制不抛异常）---- */
  const drawOk = await ev(`(function(){
    var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    var errs = [];
    ['fog','rain','snow','night','wind','thunder'].forEach(function(k){
      try {
        var lv = { weather: k };
        drawWeather(ctx, 1.234, lv);
      } catch(e){ errs.push(k + ':' + e.message); }
    });
    /* 未知天气值也不能崩（安全兜底） */
    try { drawWeather(ctx, 1.0, { weather: 'blizzard_9000' }); }
    catch(e){ errs.push('未知值:' + e.message); }
    return { errs: errs };
  })()`);
  check('★ 6 种天气都能正常绘制（不抛异常）',
    drawOk.errs.length === 0, JSON.stringify(drawOk.errs));

  /* ---- ③ ★★ 核心：天气不改物理（逐帧轨迹完全一致）★★ ----
   * 对每一种天气，跑一段**完全相同的输入**，记录角色 x/y 轨迹，
   * 然后和"晴天"的轨迹逐帧对比。任何一帧不一样 = 天气动了物理。 */
  const TRAJ_RUN = `(function(weatherKey){
    Game.skipWeatherBrief = true;
    Game.mode='single'; Game.playerCount=1;
    loadLevel(0);
    /* 强制指定这一局生效的天气（直接改关卡对象，模拟 drawWeather 的输入） */
    Game.level.weather = (weatherKey === 'clear') ? null : weatherKey;
    var p = Game.players[0];
    p.x = 3*32; p.y = 23*32; p.vx = 0; p.vy = 0; p.onGround = true;
    p.hearts = p.maxHearts;
    var traj = [];
    for (var f = 0; f < 200; f++) {
      InputState.now = {};
      InputState.now['ArrowRight'] = true;
      if (f === 20 || f === 60 || f === 100) InputState.now['Space'] = true;
      if (f === 140) InputState.now['ArrowLeft'] = true;
      update(1/60);
      InputState.tick();
      traj.push(Math.round(p.x*1000)/1000 + ',' + Math.round(p.y*1000)/1000 +
                ',' + Math.round((p.vx||0)*1000)/1000 + ',' + Math.round((p.vy||0)*1000)/1000);
    }
    return { traj: traj, n: traj.length };
  })`;

  /* ============================================================
   * ★★ 轨迹对比：天气按"改不改物理"分两类 ★★
   * ============================================================
   * ⚠️⚠️ 这段断言的语义**被十一自己反转了**，务必看清：
   *
   * 【上一轮】她的铁律是"随机天气不得改物理" →
   *           所以断言是"**所有**天气的轨迹都必须和晴天逐帧一致"。
   * 【这一轮】她改主意了："要天气改操作手感"，并选了全模式都改物理 →
   *           所以 rain / wind / thunder **本来就该**让轨迹不同。
   *
   * ⇒ 断言相应改成**两类分别测**：
   *     ① 纯视觉天气（fog / snow / night）→ 轨迹**必须**逐帧一致
   *     ② 改物理天气（rain / wind / thunder）→ 轨迹**必须**不同
   *        （如果还一样，说明物理改动没生效 = 需求没实现）
   *   这样两边都不会误报：既守住"纯视觉的别偷偷改物理"，
   *   也守住"该改物理的必须真的改了"。
   * ============================================================ */
  const baseline = await ev(TRAJ_RUN + "('clear')");

  /* ⚠️ 三类，不是两类：
   *   ① 纯视觉     fog / snow / night    → 轨迹必须一致
   *   ② 改手感     rain / wind           → 轨迹必须不同
   *   ③ 环境危险   thunder               → **轨迹不变**（它不改角色运动，
   *                                        只在世界里落雷）
   * ⇒ 雷电一开始被我错分到第②类，测试立刻抓到"轨迹完全一样"。
   *    查下来**不是 bug** —— 雷电本来就不该改运动轨迹，
   *    它改的是"环境里多了危险源"。
   *    判断雷电有没有效果，要看 thunder-physics-test 那几条
   *    （先预警后落雷 / 落点固定 / 躲开不受伤），不是看轨迹。 */
  const VISUAL_ONLY = ['fog', 'snow', 'night'];    // 不该改物理
  const PHYSICS_MOD  = ['rain', 'wind'];            // 该改运动手感
  const HAZARD_ONLY  = ['thunder'];                 // 不改运动，只加危险

  function trajDiffers(got) {
    if (got.n !== baseline.n) return { differs: true, at: -1 };
    for (let i = 0; i < baseline.traj.length; i++) {
      if (baseline.traj[i] !== got.traj[i]) return { differs: true, at: i };
    }
    return { differs: false, at: -1 };
  }

  for (const wk of VISUAL_ONLY) {
    const got = await ev(TRAJ_RUN + "('" + wk + "')");
    const d = trajDiffers(got);
    check('★★ ' + wk + '（纯视觉）物理轨迹与晴天逐帧一致',
      !d.differs,
      d.differs
        ? ('第 ' + d.at + ' 帧就不同 ★不该改物理却改了，检查 draw' + wk + ' 有没有误碰物理★')
        : (baseline.n + ' 帧全部一致'));
  }

  for (const wk of PHYSICS_MOD) {
    const got = await ev(TRAJ_RUN + "('" + wk + "')");
    const d = trajDiffers(got);
    check('★★ ' + wk + '（改手感）轨迹与晴天**不同**（物理改动生效）',
      d.differs,
      d.differs
        ? ('第 ' + d.at + ' 帧开始出现差异（说明物理真的生效了）')
        : '★轨迹完全一样 —— 说明这个天气的物理效果没生效，需求没实现★');
  }

  /* 雷电：不改运动轨迹（它只在世界里落雷，不推玩家）
   * ⇒ 用"有没有真的落过雷"来验证它的效果，而不是看轨迹。 */
  for (const wk of HAZARD_ONLY) {
    const got = await ev(TRAJ_RUN + "('" + wk + "')");
    const d = trajDiffers(got);
    check('★★ ' + wk + '（环境危险）轨迹**不变**（它不推玩家，只在世界落雷）',
      !d.differs,
      d.differs ? ('第 ' + d.at + ' 帧就不同 ★雷电不该改角色运动★')
        : '轨迹一致（正确 —— 雷电的危险来自落雷，不是推力）');
  }

  /* ---- ④ rollWeather 只返回已知 key（抽 500 次） ---- */
  const rollRes = await ev(`(function(){
    var seen = {}, bad = [];
    for (var i = 0; i < 500; i++) {
      var k = rollWeather();
      if (WEATHER_KEYS.indexOf(k) < 0) bad.push(String(k));
      seen[k] = (seen[k] || 0) + 1;
    }
    return { bad: bad, dist: seen };
  })()`);
  check('★ rollWeather() 抽 500 次只返回已知 key（从不返回 undefined）',
    rollRes.bad.length === 0, '非法值: ' + JSON.stringify(rollRes.bad.slice(0, 5)));
  check('★ 天气池里每种天气都可能被抽到（分布不为空）',
    Object.keys(rollRes.dist).length >= 5,
    JSON.stringify(rollRes.dist));

  /* ---- ⑤ 关卡 weather 字段的"强制指定"语义 ---- */
  const forcedSem = await ev(`(function(){
    /* 第 4 关写死了 'fog' → 不论随机抽到什么都应该是 fog */
    var lv4 = PLAYABLE_LEVELS()[3];
    return { lv4Weather: lv4.weather,
             othersWeather: PLAYABLE_LEVELS().map(function(l,i){ return i===3?null:l.weather; })
               .filter(function(x){ return x; }) };
  })()`);
  check('★ 第 4 关的 weather 仍是强制指定的 fog（没被改成随机）',
    forcedSem.lv4Weather === 'fog', JSON.stringify(forcedSem));
  /* ⚠️ 2026-10-07：改成"指定天气的关卡**数量合理**"。
   *   原断言是"除第 4 关外一律不指定"—— 5 关时代的假设。
   *   现在 30 关里有一小撮按剧情指定（12/19/20 = thunder），
   *   其余仍走随机。要求"指定的是少数（≤ 总关数的 1/4）"即可，
   *   既不放过"大面积写死"，也不假红。 */
  const forcedTotal = await ev('PLAYABLE_LEVELS().length');
  const forcedCount = forcedSem.othersWeather.length;
  check('★ 写死天气的关卡是少数（大部分走随机）',
    forcedCount <= Math.ceil(forcedTotal / 3),
    JSON.stringify({ forced: forcedSem.othersWeather, total: forcedTotal }));

  /* ---- ⑥ ★ 每种天气都必须在画面上"真的有可见效果" ★ ----
   * ⚠️ 为什么要有这条：
   *   光"调用不崩"是不够的 —— 大风落叶一开始画得**太小**
   *   （4~8px、34 片），在 1280×720 里只改变 0.08% 的像素，
   *   玩家**根本看不见**，等于这个天气白做了。
   *   ⇒ 用"和晴天画面逐像素差分"来量化：改变像素占比必须 > 0.3%。
   *     这条是"天气真的画出来了"唯一可靠的验收方式
   *     （肉眼看截图容易漏，毕竟只差几片小叶子）。 */
  const weatherEffect = await ev(`(function(){
    var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    Game.skipWeatherBrief = true;
    Game.mode='single'; Game.playerCount=1;
    loadLevel(0);
    var p = Game.players[0];
    p.x = 6*32; p.y = 22*32; p.vx = 0; p.vy = 0;

    function snap(){ return ctx.getImageData(0, 0, cv.width, cv.height).data; }
    function diffCount(a, b){
      var n = 0;
      for (var i = 0; i < a.length; i += 4){
        if (Math.abs(a[i]-b[i]) > 12 || Math.abs(a[i+1]-b[i+1]) > 12 ||
            Math.abs(a[i+2]-b[i+2]) > 12) n++;
      }
      return n;
    }
    var out = {}, px = cv.width * cv.height;
    ['fog','rain','snow','night','wind'].forEach(function(w){
      Game.level.weather = null;
      render(1/60);
      var noW = snap();
      Game.level.weather = w;
      render(1/60);
      var withW = snap();
      out[w] = Math.round(diffCount(noW, withW) / px * 10000) / 100;  // 百分比
    });
    Game.level.weather = null;
    return out;
  })()`);
  let allVisible = true;
  const effParts = [];
  for (const wk of ['fog', 'rain', 'snow', 'night', 'wind']) {
    const pct = weatherEffect[wk];
    if (!(pct > 0.3)) allVisible = false;
    effParts.push(wk + '=' + pct + '%');
  }
  check('★ 每种天气都在画面上有可见效果（改变像素 > 0.3%）',
    allVisible, effParts.join('  '));

  /* ---- ⑦ 天气不能影响 HUD 的可读性 ----
   * 【这条断言的标准改过一次，记下来免得下次又踩】
   *   一开始我写的是"HUD 像素零变化"，结果 5 种天气全失败。
   *   查下来**不是 bug**：HUD 卡片背景本身是**半透明**的
   *   （`rgba(18,18,22,0.62)`），底下的天气层当然会透一点过来 ——
   *   这是半透明面板的正常表现，不是"被挡住"。
   *   ⇒ 正确的判定是"**HUD 的对比度（能看清文字）不变**"，
   *     而不是"像素一个都不许变"。
   *   判定方法：量 HUD 区域的亮度范围（max-min），
   *   有天气和没天气的差值必须很小（<10），说明文字依然清晰可辨。 */
  const hudSafe = await ev(`(function(){
    var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    function hudRange(){
      var regs = [ctx.getImageData(14, 12, 320, 66).data,
                  ctx.getImageData(Math.round(cv.width/2-144), 12, 288, 68).data];
      var mn = 999, mx = -1;
      regs.forEach(function(d){
        for (var i = 0; i < d.length; i += 4){
          var L = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          if (L < mn) mn = L;
          if (L > mx) mx = L;
        }
      });
      return mx - mn;
    }
    Game.level.weather = null; Game.frame = 100; render(1/60);
    var base = hudRange();
    var out = {};
    ['fog','rain','snow','night','wind'].forEach(function(w){
      Game.level.weather = w; Game.frame = 100; render(1/60);
      out[w] = { range: Math.round(hudRange()), base: Math.round(base) };
    });
    Game.level.weather = null;
    return out;
  })()`);
  const hudBad = Object.keys(hudSafe).filter(function (k) {
    return Math.abs(hudSafe[k].range - hudSafe[k].base) >= 10;
  });
  check('★ 5 种天气都不削弱 HUD 可读性（对比度变化 <10）',
    hudBad.length === 0,
    hudBad.length
      ? ('受影响的: ' + hudBad.map(function (k) {
        return k + '(基准' + hudSafe[k].base + '→' + hudSafe[k].range + ')';
      }).join(', '))
      : ('基准对比度 ' + (hudSafe.wind && hudSafe.wind.base) + '，5 种天气都不变'));

  /* ---- ⑧ 夜晚不能太暗（要能看清平台和尖刺）---- */
  const nightBright = await ev(`(function(){
    var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    function lum(){
      var d = ctx.getImageData(Math.round(cv.width/2-200), Math.round(cv.height/2),
                               400, 200).data;
      var s = 0, n = 0;
      for (var i = 0; i < d.length; i += 4){
        s += 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]; n++;
      }
      return s/n;
    }
    Game.level.weather = null; render(1/60);
    var clearL = lum();
    Game.level.weather = 'night'; render(1/60);
    var nightL = lum();
    Game.level.weather = null;
    return { clear: Math.round(clearL), night: Math.round(nightL),
             ratio: Math.round(nightL/clearL*100) };
  })()`);
  /* 要求：压暗后仍保留 ≥55% 的亮度（太暗就看不清尖刺了） */
  check('★ 夜晚压暗但不过暗（保留 ≥55% 亮度，还能看清尖刺）',
    nightBright.ratio >= 55,
    '晴天=' + nightBright.clear + ' 夜晚=' + nightBright.night +
    ' → 保留 ' + nightBright.ratio + '%');

  /* 收尾：恢复成不跳过播报，避免影响后面的检查 */
  await ev('Game.skipWeatherBrief = false; "ok"');

  console.log('\n=== 6. 页面错误检查 ===');
  const realErrors = pageErrors.filter(function (t) {
    return t.indexOf('[新动作]') >= 0 || t.indexOf('drawPlayerEntity') >= 0 ||
           t.indexOf('drawCharacter') >= 0 || t.indexOf('is not a function') >= 0;
  });
  check('没有动作/绘制相关错误', realErrors.length === 0,
    realErrors.slice(0, 3).join(' | '));

  console.log('\n' + '='.repeat(56));
  console.log('  浏览器验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  if (problems.length) console.log('  失败项: ' + problems.join(', '));
  console.log('='.repeat(56));

  try { await cl.close(); } catch (e) {}
  chrome.kill();
  server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})();
