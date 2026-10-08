/* ============================================================
 * single-file-test.js — 验证「单文件版」在 file:// 下能正常游玩
 * ============================================================
 * 这是最贴近真实使用场景的测试：
 *   - 用 file:// 协议打开（模拟"微信传文件后点开 / 双击打开"）
 *   - 断网环境（CDP 禁用网络）也要能玩 —— 因为理论上 0 外部依赖
 *   - 走完整流程：主菜单 → 单人模式 → 选角色 → 选关卡 → 真的进游戏
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

const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;

const FILE = path.join(PROJ, 'dist', '第十一单外卖-单文件版.html');
if (!fs.existsSync(FILE)) {
  console.log('X 单文件不存在: ' + FILE);
  console.log('  先运行: node build-single.js');
  process.exit(1);
}
const FILE_URL = 'file:///' + FILE.replace(/\\/g, '/');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

(async function main() {
  console.log('单文件版 file:// 测试');
  console.log('文件: ' + FILE);
  console.log('大小: ' + (fs.statSync(FILE).size / 1024).toFixed(1) + ' KB\n');

  const userDir = path.join(require('os').tmpdir(), 'chrome-single-test-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--no-proxy-server',
    '--allow-file-access-from-files',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--window-size=1280,800',
    FILE_URL,
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
      .find(t => t.url && t.url.indexOf('.html') >= 0);
    if (want && want.id !== client._targetId) {
      await client.close();
      client = await CDP({ port: PORT, target: want.id });
    }
  } catch (e) {}

  const { Page, Runtime, Console, Network } = client;
  await Promise.all([Page.enable(), Runtime.enable(), Console.enable()]);

  const errors = [];
  const warnings = [];
  Console.messageAdded(function (m) {
    var line = '[' + m.message.level + '] ' + m.message.text;
    if (m.message.level === 'error') errors.push(line);
    else warnings.push(line);
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

  await sleep(2500);

  console.log('=== 1. 页面加载 ===');
  var url = await evalJs('location.href');
  check('通过 file:// 打开', url.indexOf('file://') === 0, url);
  var title = await evalJs('document.title');
  check('标题正确（第十一单外卖）', title.indexOf('第十一单外卖') >= 0, title);
  var ready = await evalJs('document.readyState');
  check('DOM 加载完成', ready === 'complete' || ready === 'interactive', ready);

  console.log('\n=== 2. 依赖情况（关键）===');
  /* ⚠️ 语义说明：
   * 这里**不该**断言"零外部资源"。
   * 因为云 SDK 是外链（联机必需），它会被动态注入一个 <script>。
   * 真正要保证的是两件事：
   *   (a) 游戏本体的 JS/CSS/图片全部内联（不依赖任何外部文件）
   *   (b) 那唯一的外链（云 SDK）**失败了也不影响游玩**
   * 后者由第 6 节的"断网测试"来验证。 */
  var extRefs = await evalJs(`(function(){
    var out = [];
    document.querySelectorAll('script[src]').forEach(function(s){ out.push(s.getAttribute('src')); });
    document.querySelectorAll('link[href]').forEach(function(l){ out.push(l.getAttribute('href')); });
    document.querySelectorAll('img[src]').forEach(function(i){ out.push(i.getAttribute('src')); });
    return out;
  })()`);
  /* 唯一允许的外链：云 SDK（联机用）。其余一律视为依赖泄漏。 */
  /* 过滤规则：
   *   ① 云 SDK —— 联机必须联网，这个是**故意**留的外链
   *   ② data: URI —— 这是**内嵌**资源，不是外部引用
   *      踩过的坑：favicon 用 base64 内联后，被这条检查误判成"外部依赖"。
   *      data: 开头的都不发网络请求，不算外部资源。 */
  var illegalRefs = extRefs.filter(function (u) {
    if (u.indexOf('workbuddy-cloud-sdk') >= 0) return false;
    if (u.indexOf('data:') === 0) return false;
    return true;
  });
  check('无游戏本体依赖的外部资源（只允许云 SDK 外链）', illegalRefs.length === 0, JSON.stringify(illegalRefs));
  var externalCount = extRefs.filter(function (u) { return u.indexOf('data:') !== 0; }).length;
  console.log('     （真正的外部引用 ' + externalCount + ' 个，均为联机用云 SDK；' +
    '另有 ' + (extRefs.length - externalCount) + ' 个内嵌 data URI）');
  var hasBase64 = await evalJs('document.documentElement.outerHTML.indexOf("data:image/png;base64,") >= 0');
  check('角色图片已内嵌为 base64', hasBase64 === true);

  console.log('\n=== 3. 各模块是否都内联成功 ===');
  var mods = await evalJs(`({
    LEVELS: typeof LEVELS !== 'undefined' || typeof LEVEL_DEFS !== 'undefined' || typeof makeLevel !== 'undefined',
    Game: typeof Game !== 'undefined',
    InputState: typeof InputState !== 'undefined',
    Net: typeof Net !== 'undefined',
    Save: typeof Save !== 'undefined',
    TouchPad: typeof TouchPad !== 'undefined',
    CANVAS_W: typeof CANVAS_W !== 'undefined',
    CLOUD_CONFIG: typeof window.CLOUD_CONFIG !== 'undefined'
  })`);
  Object.keys(mods).forEach(function (k) {
    check('模块 ' + k + ' 已加载', mods[k] === true);
  });

  console.log('\n=== 4. 主循环活着 ===');
  var f1 = await evalJs('Game.frame');
  await sleep(900);
  var f2 = await evalJs('Game.frame');
  check('帧号持续增长', f2 > f1, f1 + ' → ' + f2);
  var st = await evalJs('Game.state');

  /* ★ 2026-10-06：首次打开会停在「启动画面」（第十一单外卖）★
   * 这个测试用的是全新 profile（无 localStorage），所以初始状态是
   * splash 而不是 menu。这不是 bug —— 是十一要求的新流程：
   * "打开游戏后先展示包含标题『第十一单外卖』及对应背景图的启动画面，
   *  玩家点击后方进入『开始跑单／选择路线』界面。"
   *
   * ⚠️ 历史：这里原来断言的是"设备选择页或菜单"，
   *    但十一已要求"移除电脑/手机选择页，暂不开通手机端入口"。
   *
   * 这里断言"初始状态是启动画面或菜单"（两者都合法：
   * 如果浏览器 profile 里恰好还留着旧状态，可能直接进菜单）。
   * 然后再点一下启动画面，让后面的流程能往下走。 */
  check('初始状态为启动画面或菜单', st === 'splash' || st === 'menu', st);

  if (st === 'splash') {
    console.log('   → 首次打开，点击启动画面进入主菜单');
    var spClick = await evalJs(`(function(){
      var s = document.getElementById('splash');
      if (!s) return 'no-splash';
      s.click();
      return 'clicked';
    })()`);
    await sleep(400);
    var stAfter = await evalJs('Game.state');
    check('点启动画面后进入主菜单', stAfter === 'menu', spClick + ' → ' + stAfter);
    /* ⚠️ 2026-10-07 改：不再断言"硬锁 desktop"。
     *   现在启动阶段**只 init 不决定**（真正的选择推迟到"开始跑单"），
     *   所以 localStorage 里**不该**有设备记录（首次打开）。
     *   这里改成断言"没被偷偷写入" —— 这才是当前规则。 */
    var storedMode = await evalJs(
      '(function(){try{return localStorage.getItem("delivery-game-device-mode")}catch(e){return "err"}})()'
    );
    check('★ 单文件版启动阶段不替玩家写死设备模式（留给"开始跑单"再问）',
      storedMode === null || storedMode === undefined || storedMode === 'null',
      'stored=' + storedMode);
  }

  console.log('\n=== 5. 完整流程：单人 → 选角色 → 选关 → 进游戏 ===');
  /* 先把状态切到选角色，并**等一拍**让面板真的建出来。
   * ⚠️ syncUI 是同步的，但它会按 UI.lastKey 判断"要不要重建" ——
   *    如果上一个状态的 key 恰好相同就会被跳过。
   *    这里先清 lastKey 强制重建，再等到 .char 出现为止（最多 1.5 秒）。 */
  await evalJs(`(function(){
    Game.playerCount = 1;
    Game.pickRole = 'kangaroo';
    Game.state = 'single_pick';
    UI.lastKey = '';        // 强制重建，避免被指纹跳过
    syncUI();
  })()`);
  var hasPick = 0;
  for (var i = 0; i < 15; i++) {
    hasPick = await evalJs("document.querySelectorAll('#ui .char').length");
    if (hasPick >= 1) break;
    await sleep(100);
  }
  console.log('   选角色卡片数 =', hasPick);

  var flow = await evalJs(`(function(){
    try {
      // 进关卡选择
      Game.state = 'level_select';
      UI.lastKey = '';
      if (typeof syncUI === 'function') syncUI();
      var cards = document.querySelectorAll('#ui .lv-card');
      return { cards: cards.length };
    } catch (e) { return { err: e.message }; }
  })()`);
  if (flow.err) {
    check('流程执行无异常', false, flow.err);
  } else {
    check('单人选角色界面出现（' + hasPick + ' 项）', hasPick >= 1, 'hasPick=' + hasPick);
    check('关卡选择出现 ' + flow.cards + ' 张卡片', flow.cards >= 1);
  }

  /* 点第一张关卡卡片，真进游戏
   * ★ 2026-10-06 第 5 期：E1 气象播报过场 ★
   *   单人模式点关卡会先进 weather_brief 过场。
   *   本测试验的是"单文件版能不能跑起来"，不是播报界面本身，
   *   所以用官方开关跳过（播报有专门测试，见 celeste-browser-test 5.6）。 */
  await evalJs('Game.skipWeatherBrief = true');
  var enter = await evalJs(`(function(){
    try {
      var card = document.querySelector('#ui .lv-card');
      if (!card) return { ok:false, why:'无卡片' };
      card.click();
      return { ok:true };
    } catch (e) { return { ok:false, why:e.message }; }
  })()`);
  await sleep(800);
  var after = await evalJs(`({
    state: Game.state,
    level: Game.level ? Game.level.name : null,
    players: Game.players.length,
    frame: Game.frame,
    uiClass: document.getElementById('ui').className
  })`);
  check('点击卡片无异常', enter.ok === true, enter.why || '');
  check('已进入 playing 状态', after.state === 'playing', after.state);
  check('关卡已载入（' + after.level + '）', !!after.level);
  check('玩家已生成（' + after.players + ' 人）', after.players >= 1);
  check('浮层已隐藏（UI 无 on 类）', after.uiClass.indexOf('on') < 0, after.uiClass);

  var p1 = await evalJs('Game.players[0].x');
  await sleep(1000);
  var f3 = await evalJs('Game.frame');
  check('进游戏后主循环仍在跑', f3 > after.frame, after.frame + ' → ' + f3);

  console.log('\n=== 6. 离线可用性（断网后重载）===');
  await Network.enable();
  await Network.emulateNetworkConditions({
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await Page.reload({ ignoreCache: true });
  await sleep(3000);
  var offlineOk = await evalJs(`(function(){
    try {
      return {
        loaded: typeof Game !== 'undefined',
        frame: typeof Game !== 'undefined' ? Game.frame : -1,
        state: typeof Game !== 'undefined' ? Game.state : null
      };
    } catch (e) { return { err: e.message }; }
  })()`);
  check('断网状态下页面仍能加载', offlineOk.loaded === true, JSON.stringify(offlineOk));
  check('断网下主循环照常运行', offlineOk.frame > 0, 'frame=' + offlineOk.frame);
  await Network.emulateNetworkConditions({
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

  /* ============================================================
   * ★ 6.5 真实鼠标全流程：必须能从播报页点进游戏（2026-10-06 修 bug）★
   * ============================================================
   * 【这条是在守什么】
   *   2026-10-06 出过一次阻断性 bug：点「收到·出发」完全没反应，游戏进不去。
   *   根因是 `#weather-brief` 没写 `pointer-events: auto` ——
   *   `#ui` 是 `pointer-events: none`，会继承给子孙，所以整层的点击
   *   穿透到了 canvas，按钮的 onClick **从未执行**。
   *
   *   ⇒ 这类 bug 的特点：**不报错、不崩溃、控制台干净**，只是功能全失效。
   *     靠"有没有报错"是测不出来的，只能靠**真实命中测试**守住。
   *
   * ⚠️⚠️ 必须用 CDP 的 Input.dispatchMouseEvent（真实鼠标事件）——
   *   绝对不能用 `element.click()`：它会**绕过命中检测**，
   *   即使 pointer-events 是 none 也会"点成功"，正好把这类 bug 放过去。
   *   （这就是当初 bug 溜到线上的原因。）
   * ============================================================ */
  console.log('\n=== 6.5 真实鼠标点击：播报页能不能点进游戏 ===');

  const { Input } = client;

  /* 真实鼠标点击（移动到坐标 → 按下 → 抬起） */
  async function realClick(x, y) {
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await new Promise(function (r) { setTimeout(r, 50); });
    await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await new Promise(function (r) { setTimeout(r, 50); });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /* 回到启动画面，走一遍完整流程 */
  await evalJs("location.reload(); 'reloading'");
  await new Promise(function (r) { setTimeout(r, 2600); });

  /* ① 启动画面 → 主菜单（真实点击） */
  await realClick(640, 600);
  await new Promise(function (r) { setTimeout(r, 700); });
  check('真实点击启动页 → 进入主菜单',
    (await evalJs('Game.state')) === 'menu', await evalJs('Game.state'));

  /* ①.5 ★ 👤 账号闸门（2026-10-06 新增）★
   * ------------------------------------------------------------
   * 【为什么这里要专门加一步】
   *   加了账号系统之后，「开始跑单」会先检查有没有登录 ——
   *   没有账号就去注册页、有账号但没登录就去选账号页。
   *   所以这套"单文件版能不能玩"的测试**必须先有个账号**，
   *   否则它会停在 account_welcome，后面的断言全部连锁失败。
   *
   *   ⚠️ 这里顺便**把闸门本身也测了** ——
   *      先确认"没账号时点开始会被拦"，再建账号放行。
   *      这样万一哪天闸门坏了（比如误删），这个测试会提醒。
   * ------------------------------------------------------------ */
  const noAccState = await evalJs(`(function(){
    /* 保证此刻是"一个账号都没有"的状态 */
    try { localStorage.clear(); } catch(e) {}
    ACCOUNT.logout();
    gotoState(STATE.MENU);
    return Game.state;
  })()`);
  await new Promise(function (r) { setTimeout(r, 300); });

  /* 点开始 → 应被拦去注册页 */
  const gatePt = await evalJs(`(function(){
    var b = document.querySelector('.panel.menu-fit .btn');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (gatePt) { await realClick(gatePt.x, gatePt.y); await new Promise(function (r) { setTimeout(r, 600); }); }
  check('★★ 没账号时点「开始跑单」被拦到创建账号页',
    (await evalJs('Game.state')) === 'account_welcome',
    'state=' + (await evalJs('Game.state')));

  /* 建一个账号（直接调 API，不走表单 —— 表单本身有专门的 account-test 守着） */
  await evalJs(`(function(){
    ACCOUNT.register('测试骑手', 'test1234');
    SAVE().reload();
    gotoState(STATE.MENU);
    return true;
  })()`);
  await new Promise(function (r) { setTimeout(r, 500); });
  check('★ 建完账号后回到主菜单，且已登录',
    (await evalJs('Game.state')) === 'menu' && (await evalJs('ACCOUNT.isLoggedIn()')) === true,
    'state=' + (await evalJs('Game.state')));

  /* ② 主菜单 → 点「开始跑单」（真实点击） */
  const startBtnPt = await evalJs(`(function(){
    var b = document.querySelector('.panel.menu-fit .btn');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
  })()`);
  if (startBtnPt) {
    await realClick(startBtnPt.x, startBtnPt.y);
    await new Promise(function (r) { setTimeout(r, 700); });
  }
  /* ★★ 2026-10-07 新增：设备选择闸门 ★★
   * ------------------------------------------------------------
   * 十一要求"点完开始游戏后，选择手机版或者电脑版"。
   * ⇒ 首次点"开始跑单"会先落到 **device_pick**（设备选择页），
   *   而不是直接进选骑手页。
   * 这里点「电脑模式」卡片，继续往下走。 */
  var stAfterStart = await evalJs('Game.state');
  if (stAfterStart === 'device_pick') {
    check('★ 首次点「开始跑单」弹出设备选择页（手机 / 电脑）',
      (await evalJs('document.querySelectorAll(".device-card").length')) === 2,
      '卡片数=' + (await evalJs('document.querySelectorAll(".device-card").length')));
    await evalJs(`(function(){
      var cards = document.querySelectorAll('.device-card');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-device') === 'desktop') { cards[i].click(); return 'ok'; }
      }
      return 'notfound';
    })()`);
    await new Promise(function (r) { setTimeout(r, 700); });
  }
  check('真实点击「开始跑单」→ 进入选骑手页',
    (await evalJs('Game.state')) === 'single_pick',
    'state=' + (await evalJs('Game.state')));

  /* ③ 选骑手页 → 点「开始跑单」（真实点击） */
  const pickPt = await evalJs(`(function(){
    var btns = document.querySelectorAll('#ui .btn');
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].textContent || '';
      if (t.indexOf('开始跑单') >= 0) {
        var r = btns[i].getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      }
    }
    return null;
  })()`);
  if (pickPt) {
    await realClick(pickPt.x, pickPt.y);
    await new Promise(function (r) { setTimeout(r, 800); });
  }
  check('真实点击后进入气象播报页',
    (await evalJs('Game.state')) === 'weather_brief',
    'state=' + (await evalJs('Game.state')));

  /* ④ ★ 检查播报层的 pointer-events（这是 bug 的直接原因）★ */
  const briefPe = await evalJs(`(function(){
    var s = document.getElementById('weather-brief');
    if (!s) return null;
    var btns = s.querySelectorAll('.btn');
    var b = btns.length ? btns[btns.length - 1] : null;
    var r = b ? b.getBoundingClientRect() : null;
    var cx = r ? Math.round(r.left + r.width/2) : 0;
    var cy = r ? Math.round(r.top + r.height/2) : 0;
    var hit = r ? document.elementFromPoint(cx, cy) : null;
    return {
      layerPE: getComputedStyle(s).pointerEvents,
      btnPE: b ? getComputedStyle(b).pointerEvents : null,
      btnCenter: r ? { x: cx, y: cy } : null,
      hitTag: hit ? (hit.tagName + (hit.id ? '#' + hit.id : '')) : null
    };
  })()`);
  check('★ #weather-brief 层 pointer-events = auto（否则点击会穿透到画布）',
    briefPe && briefPe.layerPE === 'auto',
    'layerPE=' + (briefPe && briefPe.layerPE));
  check('★ 播报页按钮位置命中自身（不是 CANVAS）',
    briefPe && briefPe.hitTag && briefPe.hitTag.indexOf('CANVAS') !== 0,
    '命中=' + (briefPe && briefPe.hitTag));

  /* ⑤ ★ 最关键：真实鼠标点「收到·出发」→ 必须进游戏 ★ */
  if (briefPe && briefPe.btnCenter) {
    await realClick(briefPe.btnCenter.x, briefPe.btnCenter.y);
    /* 只等 250ms —— 顺便验证"浮层立刻隐藏、不等定时器" */
    await new Promise(function (r) { setTimeout(r, 250); });
    const afterBrief = await evalJs(`({
      state: Game.state, hasLevel: !!Game.level,
      uiOn: (document.getElementById('ui') || {}).className,
      briefGone: !document.getElementById('weather-brief')
    })`);
    check('★★ 真实点击「收到·出发」→ 进入游戏（state=playing）',
      afterBrief.state === 'playing', JSON.stringify(afterBrief));
    check('★ 播报浮层立刻消失（不等定时器）',
      afterBrief.uiOn === '' && afterBrief.briefGone === true,
      JSON.stringify(afterBrief));

    /* ⑥ 验证真的能操作角色（按住方向键） */
    const x0 = await evalJs('Game.players[0].x');
    await Input.dispatchKeyEvent({
      type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    });
    await new Promise(function (r) { setTimeout(r, 450); });
    await Input.dispatchKeyEvent({
      type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
    });
    await new Promise(function (r) { setTimeout(r, 120); });
    const x1 = await evalJs('Game.players[0].x');
    check('★★ 进入游戏后角色能移动（真的可玩）',
      (x1 - x0) > 3,
      'x: ' + Math.round(x0) + ' → ' + Math.round(x1));
  }

  console.log('\n=== 7. 控制台 ===');
  var realErrors = errors.filter(function (l) {
    return l.indexOf('favicon') < 0;
  });
  check('无严重 console 错误', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));
  if (warnings.length) {
    console.log('     （有 ' + warnings.length + ' 条警告，通常无害）');
  }

  console.log('\n' + '='.repeat(56));
  console.log('  单文件版测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('='.repeat(56));

  try { await client.close(); } catch (e) {}
  chrome.kill();
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(function (e) {
  console.log('测试崩溃: ' + (e && e.stack || e));
  process.exit(1);
});
