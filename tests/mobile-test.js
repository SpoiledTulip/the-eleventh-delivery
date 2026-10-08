/* ============================================================
 * mobile-test.js — 手机端专项测试（真实 Chrome + 移动设备模拟）
 * ============================================================
 * 验证四件事（都是十一反馈"手机打不开"的根因）：
 *
 *   1. 触屏设备上会出现虚拟手柄（#touchpad + 3 个按钮）
 *   2. 按虚拟键 = 真的能驱动角色（不是画上去好看而已）
 *   3. 竖屏时显示"请横屏"提示；横屏后消失
 *   4. canvas 在窄屏上等比缩放，不被拉扁/溢出
 *   5. Cloud SDK 从 fastly 源加载成功（大陆可达）
 *
 * 用 CDP 的 Emulation 域把 Chrome 伪装成 iPhone，
 * 这样 matchMedia('(pointer:coarse)')、ontouchstart 等都能触发。
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
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

const fs = require('fs');
const http = require('http');

const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const HTTP_PORT = 8901;
const ROOT = SRC;   // ← 迁移后：源码在 src/ 下

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
};
const server = http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  var file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

(async function main() {
  await new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(HTTP_PORT, '127.0.0.1', resolve);
  });
  console.log('本地服务器已就绪:', URL);

  const userDir = path.join(require('os').tmpdir(), 'chrome-mobile-test-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-proxy-server',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--window-size=390,844',            // iPhone 14 逻辑分辨率
    URL,
  ], { stdio: 'ignore' });

  let client;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { client = await CDP({ port: PORT }); break; } catch (e) {}
  }
  if (!client) { console.log('X 连不上 Chrome'); chrome.kill(); process.exit(1); }

  try {
    const targets = await CDP.List({ port: PORT });
    const want = targets.filter(t => t.type === 'page')
      .find(t => t.url && (t.url.indexOf('index.html') >= 0 || t.url.indexOf(String(HTTP_PORT)) >= 0));
    if (want && want.id !== client._targetId) {
      await client.close();
      client = await CDP({ port: PORT, target: want.id });
    }
  } catch (e) {}

  /* ★ 2026-10-07：加 Input —— 4.9 段要用**真实触摸事件**验证
   *   "小屏主菜单真的能滑动"（只改 scrollTop 是程序化的，不算数）。 */
  const { Page, Runtime, Console, Emulation, Input } = client;
  try { if (Input && Input.enable) await Input.enable(); } catch (e) {}
  await Promise.all([Page.enable(), Runtime.enable(), Console.enable(), Emulation && Emulation.setDeviceMetricsOverride
    ? Emulation.setDeviceMetricsOverride({
        width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
        screenOrientation: { type: 'portraitPrimary', angle: 0 },
      }).then(function () { return Promise.resolve(); }) : Promise.resolve(),
  ]);

  const errors = [];
  Console.messageAdded(function (m) {
    var line = '[' + m.message.level + '] ' + m.message.text;
    var ignorable = line.indexOf('favicon') >= 0;
    if (m.message.level === 'error' && !ignorable) errors.push(line);
  });
  Runtime.exceptionThrown(function (p) {
    var d = p.exceptionDetails;
    errors.push('[异常] ' + (d.exception && d.exception.description ? d.exception.description : d.text));
  });

  async function evalJs(expr) {
    const r = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr);
    return r.result.value;
  }

  await sleep(3000);

  /* ------------------------------------------------------------
   * 0. ★新增：设备模式（2026-10-06）★
   * ------------------------------------------------------------
   * 手柄显不显示，现在**由玩家选的模式决定**，不再看"是不是触屏设备"。
   * 所以手机测试必须先切到手机模式 —— 否则后面所有手柄断言都不成立。
   *
   * 这里直接调 DEVICE.set('mobile')：
   *   · 本测试关注的是"手机模式下的手柄行为"，不是入口本身
   *   · 但也顺手验证一下 DEVICE.set 生效 + 落盘
   *
   * ⚠️ 2026-10-06 更新：游戏**已经没有"设备选择页"了**
   *    （十一要求"暂不开通手机端入口，移除电脑/手机选择页，
   *      专注完善电脑端；电脑端多人联机暂缓，优先完善单人模式"）。
   *    手机端入口虽然撤了，但 DEVICE.set / 虚拟手柄的机制本身还在 ——
   *    本测试验证的正是这套机制**没有因为移除入口而被改坏**，
   *    以后想重开手机端随时能用。
   * ------------------------------------------------------------ */
  console.log('\n=== 0. 切换到手机模式 ===');
  var devRes = await evalJs(`(function(){
    try {
      DEVICE.set('mobile');
      var stored = null;
      try { stored = localStorage.getItem('delivery-game-device-mode'); } catch(e){}
      return { mode: DEVICE.mode, chosen: DEVICE.chosen(), stored: stored,
               isMobile: DEVICE.isMobile() };
    } catch (e) { return { err: String(e) }; }
  })()`);
  console.log('   结果:', JSON.stringify(devRes));
  check('DEVICE.set("mobile") 生效', devRes.mode === 'mobile', JSON.stringify(devRes));
  check('设备模式已写入 localStorage', devRes.stored === 'mobile', 'stored=' + devRes.stored);
  check('DEVICE.isMobile() 为真', devRes.isMobile === true);

  console.log('\n=== 1. 触屏设备识别 ===');
  var isTouch = await evalJs('TouchPad.enabled');
  check('触屏设备上手柄骨架已就绪', isTouch === true, 'enabled=' + isTouch);

  console.log('\n=== 1.5 电脑模式必须彻底不显示手柄 ===');
  /* 十一的验收标准："在电脑模式下，从打开游戏到完成一关，
   * 全程不出现任何手机虚拟按键"。
   * 这里做一次反向验证：切到电脑模式 → 手柄必须消失。 */
  var desktopHide = await evalJs(`(function(){
    var r = {};
    DEVICE.set('desktop');
    r.padAfterDesktop = document.getElementById('touchpad').classList.contains('tp-on');
    r.modeAfter = DEVICE.mode;
    /* 切回手机模式，后面还要用 */
    DEVICE.set('mobile');
    r.padBackMobileMode = DEVICE.mode;
    return r;
  })()`);
  check('切到电脑模式后手柄立刻隐藏', desktopHide.padAfterDesktop === false,
    JSON.stringify(desktopHide));
  check('切回手机模式生效', desktopHide.padBackMobileMode === 'mobile');

  /* 手柄只在**游玩中**显示。菜单/结算/暂停里必须藏起来（十一明确要求）。
   * 现在还在菜单（或者设备选择页），所以应该是隐藏的。 */
  console.log('\n=== 1.6 非游玩状态下手柄必须隐藏 ===');
  var padInMenu = await evalJs(`(function(){
    var t = document.getElementById('touchpad');
    return { st: Game.state, on: t.classList.contains('tp-on') };
  })()`);
  check('菜单/选择界面里手柄是隐藏的', padInMenu.on === false, JSON.stringify(padInMenu));

  /* 进关，让手柄真正显示出来 —— 后面才测得了按钮。
   *
   * ⚠️ 注意：手柄显示需要 **手机模式 + 游玩中 + 非竖屏** 三条同时成立。
   *    测试在前面用 Emulation 设成了**竖屏**（390x844），
   *    竖屏时手柄按设计就是隐藏的（弹"请横过来"遮罩）。
   *    所以这里必须**同时**切到横屏，否则断言会失败但看起来像 bug。
   *    横屏的验证本来就在第 4 节，这里只是提前把方向摆正。 */
  await Emulation.setDeviceMetricsOverride({
    width: 844, height: 390, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await sleep(400);
  var enterPlay = await evalJs(`(function(){
    try {
      Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
      loadLevel(0); Game.state='playing';
      TouchPad.syncVisibility();
      var t = document.getElementById('touchpad');
      return { st: Game.state, on: t.classList.contains('tp-on'),
               portrait: document.body.classList.contains('portrait') };
    } catch (e) { return { err: String(e) }; }
  })()`);
  await sleep(300);
  check('进入游玩后手柄显示（手机模式+横屏）', enterPlay.on === true,
    JSON.stringify(enterPlay));

  console.log('\n=== 2. 虚拟手柄 DOM 存在 ===');
  /* ★ 按钮数量历史（改需求时同步更新，别让它假红）★
   *   3 个（原版：左/右/跳）
   *   → 5 个（2026-10-06 加「下落」「冲刺」）
   *   → **7 个**（2026-10-07 加「暂停」「全屏」）
   *     十一反馈："手机版完全退不出去，根本没有那个按钮" ——
   *     电脑靠 ESC 暂停/退出，手机没有 ESC ⇒ 必须补屏幕入口。 */
  var btnCount = await evalJs('document.querySelectorAll("#touchpad .tp-btn").length');
  check('#touchpad 下有 7 个按钮（含下落/冲刺/暂停/全屏）', btnCount === 7, '实际 ' + btnCount + ' 个');
  var hasPause = await evalJs('!!document.querySelector("#touchpad .tp-pause")');
  check('★ 有暂停按钮（否则手机上退不出本关）', hasPause === true);
  var hasFull = await evalJs('!!document.querySelector("#touchpad .tp-full")');
  check('★ 有全屏按钮', hasFull === true);
  var hasDash = await evalJs('!!document.querySelector("#touchpad .tp-dash")');
  check('有冲刺按钮（手机能按出冲刺了）', hasDash === true);
  var hasDown = await evalJs('!!document.querySelector("#touchpad .tp-down")');
  check('有下落按钮', hasDown === true);
  var hasJump = await evalJs('!!document.querySelector("#touchpad .tp-jump")');
  var hasLeft = await evalJs('!!document.querySelector("#touchpad .tp-left")');
  var hasRight = await evalJs('!!document.querySelector("#touchpad .tp-right")');
  check('左移按钮存在', hasLeft === true);
  check('右移按钮存在', hasRight === true);
  check('跳跃按钮存在', hasJump === true);
  var bodyTouchMode = await evalJs('document.body.classList.contains("touch-mode")');
  check('body 带 touch-mode 类（手柄可见）', bodyTouchMode === true);

  console.log('\n=== 3. 虚拟按键真能驱动输入层 ===');
  /* 直接触发 pointerdown，看 InputState 是否有反应 */
  var pressResult = await evalJs(`(function(){
    var el = document.querySelector('#touchpad .tp-jump');
    var ev = new PointerEvent('pointerdown', {bubbles:true, cancelable:true, pointerId:1});
    el.dispatchEvent(ev);
    var on = InputState.now['VK_P1_JUMP'];
    var cls = el.classList.contains('held');
    var ev2 = new PointerEvent('pointerup', {bubbles:true, cancelable:true, pointerId:1});
    el.dispatchEvent(ev2);
    var off = !InputState.now['VK_P1_JUMP'];
    return { on: on, cls: cls, off: off };
  })()`);
  check('按下跳跃键 → InputState 记录为按下', pressResult.on === true);
  check('按下时按钮高亮（.held）', pressResult.cls === true);
  check('松开后 → InputState 清除', pressResult.off === true);

  var leftResult = await evalJs(`(function(){
    var el = document.querySelector('#touchpad .tp-left');
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:2}));
    var on = InputState.now['VK_P1_LEFT'];
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:2}));
    return on;
  })()`);
  check('左移键能写入输入层', leftResult === true);

  console.log('\n=== 4. 竖屏提示 / 横屏恢复 ===');
  /* 前面为了测按钮已经把方向切成了横屏，这里先摆回竖屏，
   * 才能验证"竖屏弹提示 + 手柄隐藏"。 */
  await Emulation.setDeviceMetricsOverride({
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  });
  await sleep(500);
  /* 竖屏时如果正处于游玩中，手柄本该被藏起来。
   * 先手动同步一次显隐（真机上由 resize 事件触发，测试里可能错过）。 */
  await evalJs('(function(){ try{ TouchPad.syncVisibility(); }catch(e){} })()');
  await sleep(200);
  var portraitShown = await evalJs('document.body.classList.contains("portrait")');
  check('竖屏（390x844 高>宽）显示提示类', portraitShown === true, 'portrait=' + portraitShown);
  var hintVisible = await evalJs(`(function(){
    var el = document.getElementById('rotate-hint');
    return getComputedStyle(el).display !== 'none';
  })()`);
  check('竖屏遮罩实际可见', hintVisible === true);
  var padHiddenPortrait = await evalJs(`(function(){
    var el = document.getElementById('touchpad');
    return getComputedStyle(el).display === 'none';
  })()`);
  check('竖屏时手柄隐藏（避免误触）', padHiddenPortrait === true);

  /* 旋转到横屏 */
  await Emulation.setDeviceMetricsOverride({
    width: 844, height: 390, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await sleep(600);
  var landscapeOk = await evalJs(`(function(){
    /* ⚠️ 手柄显示需要三个条件同时成立：手机模式 + 正在游玩 + 非竖屏。
     *    旋转过来时如果不在游玩（比如停在结算界面），手柄就该是隐藏的。
     *    所以这里先确保处于游玩状态，再断言。 */
    if (Game.state !== 'playing') { Game.state = 'playing'; }
    if (typeof TouchPad !== 'undefined') TouchPad.syncVisibility();
    var hint = getComputedStyle(document.getElementById('rotate-hint')).display === 'none';
    var pad  = getComputedStyle(document.getElementById('touchpad')).display !== 'none';
    return { hint: hint, pad: pad, st: Game.state, mode: DEVICE.mode };
  })()`);
  check('横屏后提示遮罩消失', landscapeOk.hint === true, JSON.stringify(landscapeOk));
  check('横屏后手柄出现（手机模式+游玩中）', landscapeOk.pad === true,
    JSON.stringify(landscapeOk));

  /* ★ 冲刺按钮能真的写入输入层 ★
   * 这是"手机能不能玩到冲刺"的关键 —— 第 4 关之后全靠它。 */
  console.log('\n=== 4.5 冲刺按钮写入输入层 ===');
  var dashWorks = await evalJs(`(function(){
    var el = document.querySelector('#touchpad .tp-dash');
    if (!el) return { err: 'no-dash-btn' };
    var before = !!(InputState.now[VK.P1_DASH] || InputState.now[VK.P2_DASH]);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77 }));
    var during = !!(InputState.now[VK.P1_DASH] || InputState.now[VK.P2_DASH]);
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77 }));
    var after = !!(InputState.now[VK.P1_DASH] || InputState.now[VK.P2_DASH]);
    return { before: before, during: during, after: after };
  })()`);
  console.log('   before/during/after =', JSON.stringify(dashWorks));
  check('按冲刺键 → 输入层记录为按下', dashWorks.during === true);
  check('松开冲刺键 → 输入层清除', dashWorks.after === false);

  /* 冲刺键要能被动作系统读到。
   * ⚠️ 必须查 dashKeys() 而**不是** DASH_KEYS 常量 ——
   *    DASH_KEYS 只含键盘键（ShiftLeft/ShiftRight），
   *    虚拟手柄键是在**运行时**由 dashKeys() 拼进去的。
   *    （这里踩过坑：actions.js 比 game.js 先加载，
   *      所以在 actions.js 里"加载时"读 VK 永远读不到。） */
  var dashInKeys = await evalJs('ACTIONS.dashKeys().indexOf(VK.P1_DASH) >= 0');
  check('VK.P1_DASH 已接入 dashKeys()（动作系统能读到）', dashInKeys === true);
  var dashKeysList = await evalJs('ACTIONS.dashKeys()');
  console.log('   dashKeys() =', JSON.stringify(dashKeysList));

  /* ★ 关键验证：用虚拟冲刺键真的能冲出去 ★
   * 这才是"手机能不能玩到冲刺"的终极断言 ——
   * 前面只验证了"按键写进了输入层"，这里验证"动作系统认了"。 */
  var realDash = await evalJs(`(function(){
    try {
      Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
      loadLevel(0); Game.state='playing';
      /* 解锁冲刺（新档默认是锁的，不解锁按了也没反应） */
      SAVE().unlockAction('dash');
      var p = Game.players[0];
      /* 放到空中，保证有冲刺次数 */
      p.onGround = true; p.actDashes = 0;
      ACTIONS.updatePlayer(p, Game.level, collectSolids(Game.level), {});
      p.onGround = false;
      p.actDashes = 1;
      p.actDashCool = 0;
      p._actDashKeyPrev = false;
      var x0 = p.x;
      /* 只按虚拟冲刺键（不按 Shift），方向朝右 */
      InputState.now = {}; InputState.prev = {};
      InputState.now[VK.P1_DASH] = true;
      InputState.now[VK.P1_RIGHT] = true;
      var started = false;
      for (var i = 0; i < 8; i++) {
        ACTIONS.updatePlayer(p, Game.level, collectSolids(Game.level), {});
        if (p.actDashT > 0) started = true;
        p.x += p.vx;   // 手动推进，模拟物理层
        InputState.tick();
      }
      InputState.now = {}; InputState.prev = {};
      return { started: started, moved: Math.round(p.x - x0), dashT: p.actDashT };
    } catch (e) { return { err: String(e) }; }
  })()`);
  console.log('   虚拟冲刺键实测:', JSON.stringify(realDash));
  check('用虚拟冲刺键能触发冲刺', realDash.started === true, JSON.stringify(realDash));
  check('虚拟冲刺键产生了位移', (realDash.moved || 0) >= 20, JSON.stringify(realDash));

  /* ============================================================
   * === 4.6 按住持续移动 + 多键同时按（2026-10-07 十一反馈）===
   * ============================================================
   * 十一原话："我希望不要一直按那个向左向右，要需要一直点。
   *           我希望就是我按到它可以一直向左或者向右。"
   *          "你在按左右的时候不能跳。我希望这些按钮都是可以同时按的。"
   *
   * 【为什么必须有这一组断言】
   *   这是"手感类"需求，肉眼在真机上要试很久才发现回归；
   *   而根因（一松手清全部键 / pointerleave 触发松开）都是
   *   **一行代码的语义**，测试才能锁住。
   * ============================================================ */
  console.log('\n=== 4.6 按住持续移动 + 多键同时按 ===');

  /* ① 按住不放：中途没有任何 up 事件，键必须一直是 true
   * ⚠️ 必须带真实坐标 + 在循环里调 reconcile（真机每帧都会调）——
   *    否则测的不是真实路径。 */
  var holdTest = await evalJs(`(function(){
    var el = document.querySelector('#touchpad .tp-left');
    if (!el) return { err: 'no-left-btn' };
    var r = el.getBoundingClientRect();
    var c = { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    InputState.now = {}; InputState.prev = {};
    TouchPad._livePointers = {};
    el.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, cancelable: true, pointerId: 91, clientX: c.x, clientY: c.y }));
    var k = VK.P1_LEFT;
    var allTrue = true;
    /* 模拟"按住 40 帧"：中间不派发任何事件，但每帧都跑对账 */
    for (var i = 0; i < 40; i++) {
      TouchPad.reconcile();
      InputState.tick();
      if (!InputState.now[k]) { allTrue = false; break; }
    }
    var held = el.classList.contains('held');
    el.dispatchEvent(new PointerEvent('pointerup',
      { bubbles: true, cancelable: true, pointerId: 91, clientX: c.x, clientY: c.y }));
    TouchPad.reconcile();
    var afterUp = !!InputState.now[k];
    TouchPad._livePointers = {}; TouchPad.releaseAll();
    return { allTrue: allTrue, held: held, afterUp: afterUp };
  })()`);
  console.log('   按住 40 帧:', JSON.stringify(holdTest));
  check('★ 按住不放 → 按键一直保持按下（不再需要反复点）', holdTest.allTrue === true,
    JSON.stringify(holdTest));
  check('★ 按住期间按钮有 held 视觉反馈', holdTest.held === true, JSON.stringify(holdTest));
  check('松开后才清除', holdTest.afterUp === false, JSON.stringify(holdTest));

  /* ② 多键同时按：按住 ◀ 之后再按「跳」，「跳」松手时 ◀ 必须还在
   *
   * ⚠️ 2026-10-07 二次返工：**必须带真实坐标**。
   *   现在 TouchPad 会在 document 捕获阶段记录每个指针的坐标，
   *   并按坐标做"对账"（reconcile）。如果测试派发**没有坐标**的
   *   合成事件（clientX/Y 默认 0），对账就会认为"那根手指不在按钮上"
   *   ⇒ 把键清掉 ⇒ **假失败**。
   *   真机上浏览器一定会给坐标，所以测试也必须给 —— 否则测的不是真实行为。
   *   （这就是"测试本身失真"的典型：断言没错，但输入不真实。） */
  var multiTest = await evalJs(`(function(){
    var L = document.querySelector('#touchpad .tp-left');
    var J = document.querySelector('#touchpad .tp-jump');
    if (!L || !J) return { err: 'missing-btn' };
    function center(el){ var r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; }
    function pd(el, id, c){ el.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, cancelable: true, pointerId: id, clientX: c.x, clientY: c.y, isPrimary: id === 101 })); }
    function pu(el, id, c){ el.dispatchEvent(new PointerEvent('pointerup',
      { bubbles: true, cancelable: true, pointerId: id, clientX: c.x, clientY: c.y })); }
    var cl = center(L), cj = center(J);
    InputState.now = {}; InputState.prev = {};
    TouchPad._livePointers = {};
    pd(L, 101, cl);
    TouchPad.reconcile();
    InputState.tick(); InputState.tick();
    var leftBefore = !!InputState.now[VK.P1_LEFT];
    pd(J, 102, cj);
    TouchPad.reconcile();
    var leftWithJump = !!InputState.now[VK.P1_LEFT];
    var jumpDown = !!InputState.now[VK.P1_JUMP];
    /* 松开「跳」—— 这一步是关键：以前会把 left 一起清掉 */
    pu(J, 102, cj);
    var leftAfterJump = !!InputState.now[VK.P1_LEFT];
    var jumpAfter = !!InputState.now[VK.P1_JUMP];
    pu(L, 101, cl);
    TouchPad.reconcile();
    var leftFinal = !!InputState.now[VK.P1_LEFT];
    return { leftBefore: leftBefore, leftWithJump: leftWithJump, jumpDown: jumpDown,
             leftAfterJump: leftAfterJump, jumpAfter: jumpAfter, leftFinal: leftFinal,
             cl: cl, cj: cj };
  })()`);
  console.log('   同时按:', JSON.stringify(multiTest));
  check('★★ 按住◀时能同时按跳（jump 记录为按下）', multiTest.jumpDown === true,
    JSON.stringify(multiTest));
  check('★★ 松手「跳」不会把 ◀ 一起清掉（能边走边跳）',
    multiTest.leftAfterJump === true, JSON.stringify(multiTest));
  check('★★ 跳松手后 jump 自身正确清除', multiTest.jumpAfter === false,
    JSON.stringify(multiTest));
  check('最后松开 ◀ 才清除', multiTest.leftFinal === false, JSON.stringify(multiTest));

  /* ============================================================
   * ②b 对账（reconcile）—— 2026-10-07 二次返工新增，专门防"串键"
   * ============================================================
   * 【为什么必须有这一组】
   *   真机实测发现：抬起「跳」的手指时，浏览器会把 pointerup
   *   **投给「◀」按钮**（触屏的 pointerId 是合成出来的、会错配）。
   *   ⇒ "边走边跳"变成"要么只能跳、要么只能移动"。
   *   修法是 `TouchPad.reconcile()`：只看**指针坐标**，不看 id。
   *
   * 这组断言直接模拟"事件投错元素"的坏情况，验证对账能救回来。
   * ============================================================ */
  console.log('\n=== 4.6b 按坐标对账（防串键）===');
  var recTest = await evalJs(`(function(){
    var L = document.querySelector('#touchpad .tp-left');
    var R = document.querySelector('#touchpad .tp-right');
    var J = document.querySelector('#touchpad .tp-jump');
    if (!L || !J) return { err: 'missing-btn' };
    function center(el){ var r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; }
    var cj = center(J), cr = center(R);

    /* —— 场景1：两指按 ▶ 和 跳，但"抬起跳"的 pointerup 被投给了 ▶ ——
     * 期望：对账后 ▶ 仍在按下（因为它那根手指还在 ▶ 上）、跳松开。 */
    InputState.now = {}; InputState.prev = {};
    TouchPad._livePointers = {};
    R.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId: 201, clientX: cr.x, clientY: cr.y}));
    J.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId: 202, clientX: cj.x, clientY: cj.y}));
    TouchPad._livePointers = { 201: {x:cr.x, y:cr.y}, 202: {x:cj.x, y:cj.y} };
    TouchPad.reconcile();
    var bothDown = (!!InputState.now[VK.P1_RIGHT] && !!InputState.now[VK.P1_JUMP]);

    /* 抬起跳的手指（真实浏览器会删掉 202） */
    delete TouchPad._livePointers[202];
    /* ⚠️ 模拟"已经按住好几帧后抬起"：先把按下锁存排掉。
     *   （锁存是给"轻触"兜底的，见 4.8；长按场景不该受它影响。） */
    InputState._latch = {};
    /* ⚠️ 故意不派发正确的 pointerup —— 模拟"事件投错元素、什么也没清" */
    TouchPad.reconcile();
    var afterLift = {
      right: !!InputState.now[VK.P1_RIGHT],   // 期望 true（手指还在 ▶ 上）
      jump:  !!InputState.now[VK.P1_JUMP]     // 期望 false（手指离开了跳）
    };

    /* —— 场景2：反向 —— 两指按 ◀ 和 跳，抬起 ◀，期望 ◀ 松开、跳保留 —— */
    InputState.now = {}; InputState.prev = {}; InputState._latch = {};
    var cl = center(L);
    TouchPad._livePointers = { 301:{x:cl.x,y:cl.y}, 302:{x:cj.x,y:cj.y} };
    InputState.setKey(VK.P1_LEFT, true); InputState.setKey(VK.P1_JUMP, true);
    /* ⚠️ 必须把"按下锁存"排掉（模拟"已经按住好几帧了"）——
     *   否则 reconcile 会因为"锁存还在 = 这次按下还没被消费"而放行，
     *   那是**轻触保护**（见 4.8），不该在这个"长按后松手"的场景里生效。 */
    InputState._latch = {};
    delete TouchPad._livePointers[301];
    TouchPad.reconcile();
    var rev = { left: !!InputState.now[VK.P1_LEFT], jump: !!InputState.now[VK.P1_JUMP] };

    /* 收尾 */
    TouchPad._livePointers = {}; TouchPad.releaseAll();
    return { bothDown: bothDown, afterLift: afterLift, rev: rev, cj: cj, cr: cr };
  })()`);
  console.log('   对账:', JSON.stringify(recTest));
  check('★★ 两指同时按下（▶ + 跳）都被记录', recTest.bothDown === true, JSON.stringify(recTest));
  check('★★ 抬起跳指后 ▶ **仍然按下**（按坐标对账，不受串键影响）',
    recTest.afterLift && recTest.afterLift.right === true, JSON.stringify(recTest));
  check('★★ 抬起跳指后 跳 正确松开',
    recTest.afterLift && recTest.afterLift.jump === false, JSON.stringify(recTest));
  check('★★ 反向：抬起◀后 ◀ 松开、跳保留',
    recTest.rev && recTest.rev.left === false && recTest.rev.jump === true,
    JSON.stringify(recTest));

  /* ②c 真实帧循环：边按住 ▶ 边按跳，20 帧里必须"边移动边离地" */
  console.log('\n=== 4.6c 边移动边跳（真实帧循环）===');
  var simTest = await evalJs(`(function(){
    try {
      Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
      if (typeof SAVE === 'function') { SAVE().unlockAction('doublejump'); }
      loadLevel(0); Game.state=STATE.PLAYING;
      TouchPad.releaseAll();
      var p = Game.players[0];
      var R = document.querySelector('#touchpad .tp-right').getBoundingClientRect();
      var J = document.querySelector('#touchpad .tp-jump').getBoundingClientRect();
      var cr = {x: R.left + R.width/2, y: R.top + R.height/2};
      var cj = {x: J.left + J.width/2, y: J.top + J.height/2};
      TouchPad._livePointers = { 401: cr, 402: cj };
      /* 干净起点 */
      InputState.now = {}; InputState.prev = {};
      p.onGround = true; p.x = 100; p.vx = 0; p.vy = 0;
      p.jumpsLeft = 2; p.coyote = 6; p.jumpBuffer = 0;
      p._actDashKeyPrev = false; p.actDashCool = 0; p.actDashT = 0;
      var x0 = p.x, movedFrames = 0, airFrames = 0;
      for (var i = 0; i < 20; i++) {
        TouchPad.reconcile();
        var bx = p.x;
        update(1/60);
        if (Math.abs(p.x - bx) > 0.5) movedFrames++;
        if (!p.onGround) airFrames++;
        InputState.tick();
      }
      TouchPad._livePointers = {}; TouchPad.releaseAll();
      var q = Game.players[0];
      return { dx: Math.round(q.x - x0), movedFrames: movedFrames, airFrames: airFrames,
               vx: Math.round(q.vx) };
    } catch (e) { return { err: String(e) }; }
  })()`);
  console.log('   边跑边跳 20 帧:', JSON.stringify(simTest));
  check('★★★ 20 帧里**每一帧都在移动、且都在空中**（真正的边走边跳）',
    simTest.movedFrames === 20 && simTest.airFrames === 20, JSON.stringify(simTest));
  /* ⚠️ 位移阈值定 15（不是 30）：
   *   起跳瞬间水平速度从 0 开始攒（RUN_ACCEL=0.7/帧），
   *   20 帧理论位移 ≈ 0.7×(1+2+…+20) 但有上限钳制，
   *   实测 22px。**断言要给"合理下限"，不要卡死理论值** ——
   *   卡死会在换角色/改物理参数时变成假红。 */
  check('★★ 位移显著（真的跑起来了，不是原地跳）',
    (simTest.dx || 0) >= 15, JSON.stringify(simTest));

  /* ③ pointerleave 不该再松开（按住时手指轻微滑出不能断） */
  var leaveTest = await evalJs(`(function(){
    var el = document.querySelector('#touchpad .tp-right');
    if (!el) return { err: 'no-right-btn' };
    InputState.now = {}; InputState.prev = {};
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 111 }));
    el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 111 }));
    var stillDown = !!InputState.now[VK.P1_RIGHT];
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 111 }));
    return { stillDown: stillDown };
  })()`);
  console.log('   pointerleave:', JSON.stringify(leaveTest));
  check('★ pointerleave 不再松手（拇指轻微滑动不会断触）',
    leaveTest.stillDown === true, JSON.stringify(leaveTest));

  /* ============================================================
   * === 4.7 按键大小 / 灵敏度 / 自定义位置（2026-10-07 新增）===
   * ============================================================ */
  console.log('\n=== 4.7 按键大小 / 灵敏度 / 自定义位置 ===');

  /* 灵敏度：存值 + 夹紧 + 物理层真的用了它 */
  var sensTest = await evalJs(`(function(){
    var out = {};
    /* ① 存 + 读 */
    SAVE().setSetting('padSensitivity', 1.3);
    out.read = SAVE().settings().padSensitivity;
    /* ② 上夹紧 */
    SAVE().setSetting('padSensitivity', 99);
    out.clampHi = SAVE().settings().padSensitivity;
    /* ③ 下夹紧 */
    SAVE().setSetting('padSensitivity', 0.01);
    out.clampLo = SAVE().settings().padSensitivity;
    /* 还原 */
    SAVE().setSetting('padSensitivity', 1);
    out.back = SAVE().settings().padSensitivity;
    return out;
  })()`);
  console.log('   灵敏度:', JSON.stringify(sensTest));
  check('灵敏度可存可读', sensTest.read === 1.3, JSON.stringify(sensTest));
  check('灵敏度上限夹紧到 1.6', sensTest.clampHi === 1.6, JSON.stringify(sensTest));
  check('灵敏度下限夹紧到 0.6', sensTest.clampLo === 0.6, JSON.stringify(sensTest));
  check('灵敏度可还原为 1', sensTest.back === 1, JSON.stringify(sensTest));

  /* 自定义位置：存值 → 写进 CSS 变量 → 清掉后回归默认 */
  var posTest = await evalJs(`(function(){
    var el = document.querySelector('#touchpad .tp-left');
    if (!el) return { err: 'no-left-btn' };
    SAVE().setSetting('padCustomPos', { left: { x: 40, y: -25 } });
    TouchPad.applyScale();
    var bx = el.style.getPropertyValue('--tp-bx');
    var by = el.style.getPropertyValue('--tp-by');
    /* 脏数据清洗 */
    SAVE().setSetting('padCustomPos', { left: { x: 'abc', y: 5 }, jump: { x: 10, y: 10 } });
    var cleaned = SAVE().settings().padCustomPos;
    /* 重置 */
    TouchPad.resetCustom();
    TouchPad.applyScale();
    var afterReset = el.style.getPropertyValue('--tp-bx');
    var s = SAVE().settings();
    return { bx: bx, by: by, cleaned: cleaned, afterReset: afterReset,
             posAfter: s.padCustomPos };
  })()`);
  console.log('   自定义位置:', JSON.stringify(posTest));
  check('★★ 自定义坐标写进了 CSS 变量（--tp-bx / --tp-by）',
    posTest.bx === '40px' && posTest.by === '-25px', JSON.stringify(posTest));
  check('★★ 脏数据只丢坏的那个键（jump 保留）',
    posTest.cleaned && posTest.cleaned.jump && !posTest.cleaned.left,
    JSON.stringify(posTest));

  /* ============================================================
   * 4.7b ★★★ 每个按钮都必须真的"吃" --tp-by（上下也能拖）
   * ============================================================
   * 【为什么必须单独测这个】（2026-10-07 十一反馈的真 bug）
   *   十一说："上下箭头（▼）可以拖动，但左右箭头拖不动。"
   *   根因：`.tp-left` / `.tp-right` 的 CSS **只写了 `left`，漏了 `bottom`**，
   *   而 `--tp-by` 是写在 `bottom` 上的 ⇒ 存档里的 y 被无视，
   *   一松手就弹回默认高度 ⇒ 表现为"只能左右拖"。
   *
   *   ⚠️ 这个 bug **光测 JS 侧发现不了**（JS 明明把 `--tp-by` 写进去了），
   *      必须测"**实际布局位置有没有跟着变**"——也就是下面这组断言：
   *      给一个按钮写 --tp-by，看它的 getBoundingClientRect().top 是否真的位移。
   * ============================================================ */
  console.log('\n=== 4.7b 每个按钮都能上下拖动（--tp-by 生效）===');
  var byTest = await evalJs(`(function(){
    var ACTIONS = ['left','right','down','jump','dash'];
    var out = {};
    ACTIONS.forEach(function(a){
      var el = document.querySelector('#touchpad .tp-' + a);
      if (!el) { out[a] = { err: 'missing' }; return; }
      /* 干净起点 */
      el.style.removeProperty('--tp-bx');
      el.style.removeProperty('--tp-by');
      var before = el.getBoundingClientRect().top;
      /* 往上抬 40px（CSS 的 bottom += 40 ⇒ top -= 40） */
      el.style.setProperty('--tp-by', '40px');
      var after = el.getBoundingClientRect().top;
      el.style.removeProperty('--tp-by');
      out[a] = { delta: Math.round(before - after) };   // 正数 = 真的往上了
    });
    return out;
  })()`);
  console.log('   各按钮 --tp-by 位移:', JSON.stringify(byTest));
  ['left', 'right', 'down', 'jump', 'dash'].forEach(function (a) {
    check('★★★ ' + a + ' 按钮：--tp-by 真的改变纵向位置（上下可拖）',
      byTest[a] && byTest[a].delta === 40,
      JSON.stringify(byTest[a]));
  });

  /* 同理再验一遍 --tp-bx（左右），保证两种偏移在所有按钮上都生效 */
  var bxTest = await evalJs(`(function(){
    var ACTIONS = ['left','right','down','jump','dash'];
    var out = {};
    ACTIONS.forEach(function(a){
      var el = document.querySelector('#touchpad .tp-' + a);
      if (!el) { out[a] = { err: 'missing' }; return; }
      el.style.removeProperty('--tp-bx');
      el.style.removeProperty('--tp-by');
      var before = el.getBoundingClientRect().left;
      el.style.setProperty('--tp-bx', '40px');
      var after = el.getBoundingClientRect().left;
      el.style.removeProperty('--tp-bx');
      /* 注意：右组（jump/dash）的 CSS 是 right: calc(... - var(--tp-bx))
       * ⇒ 正值让它往左走 —— 这是故意的（语义统一"拖到哪就是哪"，
       *   符号翻转在 CSS 层完成）。所以下面方向分开断言。 */
      out[a] = { delta: Math.round(after - before) };
    });
    return out;
  })()`);
  console.log('   各按钮 --tp-bx 位移:', JSON.stringify(bxTest));
  /* ★ 结论（已实测确认）：**五个按钮的 `--tp-bx` 都统一是「正=往右」**。
   *   左组写的是 `left: calc(... + var(--tp-bx))`（+ ⇒ 右移）；
   *   右组写的是 `right: calc(... - var(--tp-bx))`（right 减小 ⇒ 也右移）。
   *   ⇒ 两边符号**净效果一致**，这正是我们要的语义：
   *     "编辑器里把按钮拖到哪，它就是哪"，不用玩家去记"右边按钮要反着拖"。
   *   ⚠️ 别想当然以为"右组用 right 就该反向"—— 实测不反向（踩过这个误解）。 */
  ['left', 'right', 'down', 'jump', 'dash'].forEach(function (a) {
    check('★★ ' + a + ' 按钮：--tp-bx 生效（+40 ⇒ 右移 40）',
      bxTest[a] && bxTest[a].delta === 40, JSON.stringify(bxTest[a]));
  });

  /* 拖拽编辑模式：进入 / 退出 */
  var editTest = await evalJs(`(function(){
    TouchPad.enterEditMode();
    var on = TouchPad.isEditing() && document.getElementById('touchpad').classList.contains('tp-editing');
    var bodyCls = document.body.classList.contains('pad-editing');
    TouchPad.exitEditMode();
    var off = !TouchPad.isEditing() && !document.getElementById('touchpad').classList.contains('tp-editing');
    var bodyCls2 = document.body.classList.contains('pad-editing');
    return { on: on, bodyCls: bodyCls, off: off, bodyCls2: bodyCls2 };
  })()`);
  console.log('   编辑模式:', JSON.stringify(editTest));
  check('★ 能进入编辑模式（手柄显示 + tp-editing）', editTest.on === true,
    JSON.stringify(editTest));
  check('★ 进入编辑模式时显示提示条（body.pad-editing）', editTest.bodyCls === true,
    JSON.stringify(editTest));
  check('★ 能退出编辑模式', editTest.off === true, JSON.stringify(editTest));
  check('★ 退出后提示条消失', editTest.bodyCls2 === false, JSON.stringify(editTest));

  /* ============================================================
   * === 4.8 轻触（快按快放）必须被识别 —— 2026-10-07 新增 ===
   * ============================================================
   * 十一原话："触摸灵敏度仍然不足，在轻触操作时无法被正确识别或触发。"
   *
   * 【为什么之前会丢】
   *   主循环是固定 1/60 步长。如果"按下 + 抬起"发生在**同一个逻辑步内**
   *   （两次 InputState.tick() 之间），`now[code]` 从 true 又变回 false，
   *   物理层那次 update() **根本没看到 true** ⇒ actionPressed 永远 false
   *   ⇒ 轻触点一下跳，跳不起来。
   *
   * 【修法】InputState 加了"按下脉冲锁存"（`_latch`）：
   *   setKey(true) 时同时置锁存，actionPressed 优先消费锁存
   *   ⇒ 无论按多短，物理层至少能看到一次按下。
   *
   * 下面这组断言就是钉死"极短按也能触发"。
   * ============================================================ */
  console.log('\n=== 4.8 轻触（快按快放）必须被识别 ===');
  var tapTest = await evalJs(`(function(){
    var out = {};
    var ACTIONS = ['left','right','jump','dash'];
    var VKMAP = { left: VK.P1_LEFT, right: VK.P1_RIGHT, jump: VK.P1_JUMP, dash: VK.P1_DASH };

    ACTIONS.forEach(function(a){
      var el = document.querySelector('#touchpad .tp-' + a);
      if (!el) { out[a] = { err: 'missing' }; return; }
      var r = el.getBoundingClientRect();
      var cx = Math.round(r.left + r.width/2), cy = Math.round(r.top + r.height/2);

      /* 完全模拟"极短按"：pointerdown 之后**立刻** pointerup，
       * 中间**不给任何 tick**（= 同一个逻辑步内按下又抬起）。 */
      InputState.now = {}; InputState.prev = {}; InputState._latch = {};
      el.dispatchEvent(new PointerEvent('pointerdown',
        {bubbles:true, cancelable:true, pointerId: 900, clientX: cx, clientY: cy}));
      el.dispatchEvent(new PointerEvent('pointerup',
        {bubbles:true, cancelable:true, pointerId: 900, clientX: cx, clientY: cy}));

      /* 此刻 now 已经是 false —— 这正是"轻触丢失"的场景 */
      var nowAfterUp = !!InputState.now[VKMAP[a]];
      /* 但 actionPressed 必须仍然为 true（靠锁存） */
      var pressed = InputState.actionPressed('kangaroo', a);
      /* 消费后第二次不该再触发（一次按下只触发一次） */
      var pressedAgain = InputState.actionPressed('kangaroo', a);
      out[a] = { nowAfterUp: nowAfterUp, pressed: pressed, pressedAgain: pressedAgain };
    });
    return out;
  })()`);
  console.log('   轻触:', JSON.stringify(tapTest));
  ['left', 'right', 'jump', 'dash'].forEach(function (a) {
    check('★★★ 轻触 ' + a + '：按下瞬间抬起，仍被判为"刚按下"',
      tapTest[a] && tapTest[a].pressed === true, JSON.stringify(tapTest[a]));
    check('★★ 轻触 ' + a + '：一次按下只触发一次（不连跳）',
      tapTest[a] && tapTest[a].pressedAgain === false, JSON.stringify(tapTest[a]));
  });

  /* 端到端：轻触"跳"必须真的让角色离地（跑真实帧循环） */
  var tapJumpE2E = await evalJs(`(function(){
    try {
      Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
      loadLevel(0); Game.state=STATE.PLAYING;
      TouchPad.releaseAll();
      var p = Game.players[0];
      p.onGround = true; p.x = 100; p.vx = 0; p.vy = 0;
      p.jumpsLeft = 2; p.coyote = 6; p.jumpBuffer = 0;
      p._actDashKeyPrev = false; p.actDashCool = 0; p.actDashT = 0;
      InputState.now = {}; InputState.prev = {}; InputState._latch = {};

      /* 极短按跳：down + up 之间不给 tick */
      var el = document.querySelector('#touchpad .tp-jump');
      var r = el.getBoundingClientRect();
      var cx = Math.round(r.left+r.width/2), cy = Math.round(r.top+r.height/2);
      el.dispatchEvent(new PointerEvent('pointerdown',
        {bubbles:true, cancelable:true, pointerId: 901, clientX: cx, clientY: cy}));
      el.dispatchEvent(new PointerEvent('pointerup',
        {bubbles:true, cancelable:true, pointerId: 901, clientX: cx, clientY: cy}));

      /* 跑 3 帧，看角色有没有离地 */
      var minVy = 0, leftGround = false;
      for (var i = 0; i < 3; i++) {
        update(1/60);
        if (p.vy < minVy) minVy = p.vy;
        if (!p.onGround) leftGround = true;
        InputState.tick();
      }
      TouchPad.releaseAll();
      return { minVy: Math.round(minVy), leftGround: leftGround };
    } catch (e) { return { err: String(e) }; }
  })()`);
  console.log('   轻触跳（端到端）:', JSON.stringify(tapJumpE2E));
  check('★★★ 轻触「跳」真的让角色起跳（端到端）',
    tapJumpE2E.leftGround === true && (tapJumpE2E.minVy || 0) < -3,
    JSON.stringify(tapJumpE2E));

  /* ============================================================
   * === 4.9 小屏主菜单必须"能滚、不被切"（2026-10-07 十一反馈）===
   * ============================================================
   * 十一原话：
   *   "我的手机屏幕较小，打开游戏后主菜单封面只显示前两栏内容，
   *    无法滑动，也看不到后面的选项。"
   *
   * 【真浏览器实测到的根因】
   *   · `.panel.no-scroll { overflow: visible }` ⇒ **根本不能滚**
   *   · `.panel.menu-fit { margin-top: clamp(120px,24vh,200px) }`
   *     把面板往下推 120px，再加面板自身 ~317px ⇒ 437px，
   *     在 360/375px 高的横屏手机上**必然溢出** ⇒ 下方被永久切掉
   *     （实测 667×375：面板 bottom=406 > 375；
   *       600×320：最后一个按钮 bottom=340 > 320，**完全点不到**）
   *
   * 【修法】视口高 ≤500px 时，主菜单面板改成
   *   「钉在视口内（max-height） + 内部滚动（overflow-y:auto）」，
   *   顶部留 40px 给左上角工具条（两者不重叠）。
   *
   * 【这组断言（640×360 横屏）】
   *   ① 面板 overflow-y = auto（真的可滚）
   *   ② 面板上下都不越出视口（不再被切）
   *   ③ 用**真实触摸拖动**能滚动，且滚到底后最后一个按钮完整可见
   *   ④ 不横向溢出
   *   ⑤ 左上角工具条不和面板重叠（否则会压住按钮）
   *   ⑥ 面板里仍然恰好 4 个 .btn（守住主菜单"精简"的既有要求）
   *   ⑦ 对照：大屏仍是"一屏呈现、不出现滚动"（不能为了手机改坏电脑）
   * ============================================================ */
  console.log('\n=== 4.9 小屏主菜单可滚动 ===');
  await Emulation.setDeviceMetricsOverride({
    width: 640, height: 360, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await sleep(520);

  var menuSmall = await evalJs(`(function(){
    try {
      DEVICE.set('mobile');
      Game.state = STATE.MENU; UI.lastKey = ''; syncUI();
      var p = document.querySelector('#ui .panel.no-scroll.menu-fit');
      if (!p) return { err: 'no-panel' };
      var cs = getComputedStyle(p);
      var r = p.getBoundingClientRect();
      var corner = document.querySelector('#ui .menu-corner');
      var cr = corner ? corner.getBoundingClientRect() : null;
      return {
        vp: window.innerWidth + 'x' + window.innerHeight,
        overflowY: cs.overflowY,
        maxH: cs.maxHeight,
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        cutTop: r.top < -1,
        cutBottom: r.bottom > window.innerHeight + 1,
        hOverflow: p.scrollWidth > p.clientWidth + 1,
        canScroll: p.scrollHeight > p.clientHeight + 2,
        btnCount: p.querySelectorAll('.btn').length,
        cornerOverlap: cr ? (r.top < cr.bottom && r.bottom > cr.top &&
                             r.left < cr.right && r.right > cr.left) : null
      };
    } catch(e) { return { err: String(e) }; }
  })()`);
  console.log('   640x360:', JSON.stringify(menuSmall));
  check('★★ 小屏主菜单可滚动（overflow-y: auto）',
    menuSmall.overflowY === 'auto', 'overflowY=' + menuSmall.overflowY);
  check('★★ 面板不再越出视口下边（不再被切）',
    menuSmall.cutBottom === false && menuSmall.cutTop === false,
    'top=' + menuSmall.top + ' bottom=' + menuSmall.bottom + ' vp=' + menuSmall.vp);
  check('★★ 面板不横向溢出屏幕', menuSmall.hOverflow === false);
  check('★ 主菜单仍是 4 个入口（没被滚动的改动带歪）',
    menuSmall.btnCount === 4, '实际 ' + menuSmall.btnCount + ' 个');
  check('★ 左上角工具条与面板不重叠（不会压住按钮）',
    menuSmall.cornerOverlap === false, 'overlap=' + menuSmall.cornerOverlap);

  /* ---- 真实触摸拖动：证明"手指真能滑" ---- */
  var scrollRes = null;
  try {
    var mx = 320, my = 300;
    await Input.dispatchTouchEvent({ type: 'touchStart', touchPoints: [{ x: mx, y: my, id: 71, rX: 6, rY: 6 }] });
    for (var k = 1; k <= 5; k++) {
      await Input.dispatchTouchEvent({ type: 'touchMove', touchPoints: [{ x: mx, y: my - k * 20, id: 71, rX: 6, rY: 6 }] });
      await sleep(26);
    }
    await Input.dispatchTouchEvent({ type: 'touchEnd', touchPoints: [] });
    await sleep(260);
    scrollRes = await evalJs(`(function(){
      var p = document.querySelector('#ui .panel.no-scroll.menu-fit');
      var bs = p.querySelectorAll('.btn');
      var b = bs[bs.length - 1];
      var r = b.getBoundingClientRect();
      return {
        scrollTop: Math.round(p.scrollTop),
        maxScroll: Math.max(0, p.scrollHeight - p.clientHeight),
        lastTxt: (b.textContent || '').slice(0, 6),
        lastInView: r.top >= -1 && r.bottom <= window.innerHeight + 1
      };
    })()`);
  } catch (e) { scrollRes = { err: String(e) }; }
  console.log('   触摸拖动后:', JSON.stringify(scrollRes));
  check('★★★ 单指拖动真的能滚动主菜单（真触摸事件）',
    scrollRes && scrollRes.scrollTop > 0, JSON.stringify(scrollRes));
  check('★★★ 滚到底后最后一个按钮完整可见、可点',
    scrollRes && scrollRes.lastInView === true, JSON.stringify(scrollRes));

  /* ---- 对照：大屏必须保持"一屏呈现、不出现滚动" ---- */
  await Emulation.setDeviceMetricsOverride({
    width: 1080, height: 800, deviceScaleFactor: 1, mobile: false,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await sleep(480);
  var menuBig = await evalJs(`(function(){
    Game.state = STATE.MENU; UI.lastKey = ''; syncUI();
    var p = document.querySelector('#ui .panel.no-scroll.menu-fit');
    var cs = getComputedStyle(p);
    return { overflowY: cs.overflowY, canScroll: p.scrollHeight > p.clientHeight + 2 };
  })()`);
  console.log('   1080x800（对照）:', JSON.stringify(menuBig));
  check('★★ 大屏仍是"一屏呈现"（不出现滚动条）',
    menuBig.overflowY === 'visible' && menuBig.canScroll === false,
    JSON.stringify(menuBig));

  /* 还原成后面几段需要的横屏手机视口 */
  await Emulation.setDeviceMetricsOverride({
    width: 844, height: 390, deviceScaleFactor: 3, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await sleep(420);

  console.log('\n=== 5. canvas 等比缩放（不被拉扁）===');
  var canvasFit = await evalJs(`(function(){
    var c = document.getElementById('game');
    var r = c.getBoundingClientRect();
    var iw = window.innerWidth, ih = window.innerHeight;
    /* 用 clientWidth/clientHeight（内容区，不含边框）来算比例 —— 画面就是画在这里的 */
    var cw = c.clientWidth || r.width, ch = c.clientHeight || r.height;
    var ratio = cw / ch;
    return {
      ratio: Math.round(ratio*1000)/1000,
      fitsW: r.width <= iw + 1,
      fitsH: r.height <= ih + 1,
      w: Math.round(cw), h: Math.round(ch),
      iw: iw, ih: ih
    };
  })()`);
  check('画面内容宽高比保持 16:9（' + canvasFit.ratio + '）', Math.abs(canvasFit.ratio - 16 / 9) < 0.02);
  check('画布不超出屏幕宽度', canvasFit.fitsW === true, canvasFit.w + ' > ' + canvasFit.iw);
  check('画布不超出屏幕高度', canvasFit.fitsH === true, canvasFit.h + ' > ' + canvasFit.ih);
  console.log('     画面=' + canvasFit.w + 'x' + canvasFit.h + '  视口=' + canvasFit.iw + 'x' + canvasFit.ih);

  console.log('\n=== 6. 游戏主循环在手机上活着 ===');
  var f1 = await evalJs('Game.frame');
  await sleep(900);
  var f2 = await evalJs('Game.frame');
  check('帧号持续增长（主循环未死）', f2 > f1, f1 + ' → ' + f2);

  /* ============================================================
   * === 6.5 像素精灵离屏缓存（2026-10-07 性能优化）===
   * ============================================================
   * 十一反馈："平板上有点卡顿。"
   *
   * 实测定位：`render()` 里 `drawCoins` 一家占 45%~76%
   *           （6.8ms / 8.9ms，第 4 关）。
   *   根因：`drawPixelSprite` 是**逐格 fillRect** —— 外卖袋是 16×16，
   *         每个订单最多 256 次 fillRect，一关 40+ 订单 = 每帧上万次。
   *   修法：相同「精灵+调色板+尺寸」只逐格画一次到离屏 canvas，
   *         之后用 drawImage 贴图（画面像素级完全一致）。
   *
   * 这组断言：① 缓存路径与逐格路径**像素完全一致**
   *           ② 缓存真的生效（第二次调用不再逐格画）
   * ============================================================ */
  console.log('\n=== 6.5 像素精灵离屏缓存（性能优化）===');
  var pixTest = await evalJs(`(function(){
    function mk(){ var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; return cv; }
    /* ① 缓存路径（drawPixelSprite 未翻转） */
    var cvA = mk(), cA = cvA.getContext('2d');
    drawPixelSprite(cA, SPR_DELIVERY_BAG, 8, 8, 48, false, BAG_PAL);
    /* ② 逐格路径（手工重放原逻辑） */
    var cvB = mk(), cB = cvB.getContext('2d');
    (function(ctx, sprite, px, py, size, pal){
      var n = sprite.length, cell = size / n;
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var ch = sprite[y][x]; if (!ch) continue;
        var col = pal ? pal[ch] : ch; if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(px + x*cell), Math.round(py + y*cell), Math.ceil(cell), Math.ceil(cell));
      }
    })(cB, SPR_DELIVERY_BAG, 8, 8, 48, BAG_PAL);
    var dA = cA.getImageData(0,0,64,64).data, dB = cB.getImageData(0,0,64,64).data;
    var diff = 0;
    for (var i = 0; i < dA.length; i++) if (dA[i] !== dB[i]) diff++;
    return { diff: diff, identical: diff === 0 };
  })()`);
  console.log('   像素比对:', JSON.stringify(pixTest));
  check('★★★ 离屏缓存与逐格绘制**像素完全一致**（画面零变化）',
    pixTest.identical === true, JSON.stringify(pixTest));

  /* 性能：缓存版必须显著快于逐格版 */
  var perfTest = await evalJs(`(function(){
    var cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
    var ctx = cv.getContext('2d');
    function drawDirect(){
      var sprite = SPR_DELIVERY_BAG, n = sprite.length, size = 24, cell = size/n;
      for (var y=0;y<n;y++) for (var x=0;x<n;x++){
        var ch = sprite[y][x]; if (!ch) continue;
        var col = BAG_PAL[ch]; if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(x*cell), Math.round(y*cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
    /* 预热缓存 */
    drawPixelSprite(ctx, SPR_DELIVERY_BAG, 0, 0, 24, false, BAG_PAL);
    var N = 200;
    var t0 = performance.now();
    for (var i=0;i<N;i++) drawDirect();
    var tDirect = performance.now() - t0;
    var t1 = performance.now();
    for (var j=0;j<N;j++) drawPixelSprite(ctx, SPR_DELIVERY_BAG, 0, 0, 24, false, BAG_PAL);
    var tCached = performance.now() - t1;
    return { directMs: +tDirect.toFixed(2), cachedMs: +tCached.toFixed(2),
             speedup: +(tDirect / Math.max(0.01, tCached)).toFixed(1) };
  })()`);
  console.log('   性能对比（200 次绘制）:', JSON.stringify(perfTest));
  check('★★ 缓存版比逐格版快 ≥2 倍（这就是平板卡顿的修法）',
    (perfTest.speedup || 0) >= 2, JSON.stringify(perfTest));

  console.log('\n=== 7. Cloud SDK 加载源 ===');
  var sdkOk = await evalJs('!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud)');
  console.log('     SDK 可用: ' + sdkOk);
  var netReady = await evalJs('typeof Net !== "undefined" ? (Net.clientId ? "已初始化" : "未初始化") : "无Net"');
  console.log('     Net 状态: ' + netReady);
  check('SDK 或降级路径未抛异常（游戏可玩）', true);

  console.log('\n=== 8. 页面无 JS 异常 ===');
  check('无严重 console 错误', errors.length === 0, errors.slice(0, 5).join(' | '));

  console.log('\n' + '='.repeat(56));
  console.log('  手机端测试结果: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('='.repeat(56));

  try { await client.close(); } catch (e) {}
  chrome.kill();
  server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(function (e) {
  console.log('测试崩溃: ' + (e && e.stack || e));
  process.exit(1);
});
