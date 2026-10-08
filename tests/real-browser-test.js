/* ============================================================
 * real-browser-test.js — 用真实 Chrome 跑一遍完整用户流程
 *
 * 目的：Node 沙箱（browser-sim.js）用的是自己写的 DOM 桩，
 * 桩和真浏览器总有差异。这里用 CDP 控制真 Chrome，
 * 走真实的事件系统、真实的 CSS 布局、真实的网络。
 *
 * 流程：打开页面 → 点「选择路线」→ 点第 1 关 → 检查是否真进入游戏
 * 并全程收集 console 错误 + 页面异常。
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
const PORT = 9333;
const HTTP_PORT = 8899;
const ROOT = SRC;   // ← 迁移后：源码在 src/ 下

/* 自己起一个静态服务器。
 * ⚠️ 不要依赖外部 `python -m http.server &` —— 后台进程会随调用它的
 *    shell 会话一起结束，导致 Chrome 打开时服务器已经没了，
 *    页面变成 chrome-error://chromewebdata/，看起来像"游戏没加载"。 */
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

const URL = process.argv[2] || ('http://127.0.0.1:' + HTTP_PORT + '/index.html');
/* 传了外部 URL 时不需要本地服务器 */
const NEED_LOCAL_SERVER = !process.argv[2];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function main() {
  // 先起服务器并确认能访问
  if (NEED_LOCAL_SERVER) {
    await new Promise(function (resolve, reject) {
      server.once('error', reject);
      server.listen(HTTP_PORT, '127.0.0.1', resolve);
    });
  }
  // 只对本地服务器做可达性预检（外部 URL 由 Chrome 自己连）
  if (NEED_LOCAL_SERVER) {
    const reachable = await new Promise(function (resolve) {
      http.get(URL, function (r) { r.resume(); resolve(r.statusCode === 200); })
        .on('error', function () { resolve(false); });
    });
    if (!reachable) { console.log('X 本地服务器起不来'); process.exit(1); }
    console.log('本地服务器已就绪:', URL, '\n');
  }

  // 用一个临时用户目录，避免影响日常 Chrome
  const userDir = path.join(require('os').tmpdir(), 'chrome-test-profile-' + Date.now());

  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-proxy-server',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--window-size=1280,800',
    URL,
  ], { stdio: 'ignore' });

  let client;
  // 等 Chrome 起来
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      client = await CDP({ port: PORT });
      break;
    } catch (e) { /* 还没起来，继续等 */ }
  }
  if (!client) {
    console.log('X 连不上 Chrome 调试端口');
    chrome.kill();
    process.exit(1);
  }

  /* ⚠️ 关键：CDP 的默认 target 可能是 Chrome 的空白页，
   * 必须显式挑出那个 URL 匹配的 target，否则拿到的是别的上下文。 */
  try {
    const targets = await CDP.List({ port: PORT });
    const pageTargets = targets.filter(t => t.type === 'page');
    const want = pageTargets.find(t => t.url && (t.url.indexOf('index.html') >= 0 || t.url.indexOf('8899') >= 0));
    if (want && want.id !== client._targetId) {
      await client.close();
      client = await CDP({ port: PORT, target: want.id });
    }
  } catch (e) { /* 拿不到就沿用默认 */ }

  const { Page, Runtime, Console, Log } = client;
  await Promise.all([Page.enable(), Runtime.enable(), Console.enable(), Log.enable()]);

  const errors = [];
  const logs = [];
  Console.messageAdded(function (m) {
    const t = m.message;
    const line = '[' + t.level + '] ' + t.text;
    logs.push(line);
    // favicon.ico 的 404 是无害的（浏览器默认请求），不算游戏错误
    // 可忽略的网络失败：favicon、以及云端 SDK（联机用，单机不需要，且有兜底）
    var ignorable = line.indexOf('favicon') >= 0 || line.indexOf('workbuddy-cloud-sdk') >= 0 || line.indexOf('jsdelivr') >= 0;
    if (t.level === 'error' && !ignorable) errors.push(line);
  });
  Log.entryAdded(function (e) {
    const line = '[' + e.entry.level + '] ' + e.entry.text +
      (e.entry.url ? ' @ ' + e.entry.url : '');
    logs.push(line);
    var ig2 = line.indexOf('favicon') >= 0 || line.indexOf('workbuddy-cloud-sdk') >= 0 || line.indexOf('jsdelivr') >= 0;
    if (e.entry.level === 'error' && !ig2) errors.push(line);
  });
  Runtime.exceptionThrown(function (p) {
    const d = p.exceptionDetails;
    errors.push('[异常] ' + (d.exception && d.exception.description ? d.exception.description : d.text));
  });

  /* ⚠️ 不要 await Page.loadEventFired()！
   * CDP 的坑：事件监听是在连接建立之后才挂上的，
   * 而页面的 load 事件很可能在挂监听之前就已经发生了 ——
   * 这样 await 会**永远等下去**（实测卡了 2 分钟以上）。
   * 改成主动轮询页面状态，稳得多。 */
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const r = await Runtime.evaluate({ expression: 'document.readyState', returnByValue: true });
      if (r.result && r.result.value === 'complete') break;
    } catch (e) { /* 继续等 */ }
  }
  await sleep(1200);   // 再给脚本一点执行时间

  const evalJs = async (expr) => {
    const r = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: false });
    if (r.exceptionDetails) {
      return { __err: r.exceptionDetails.exception ?
        r.exceptionDetails.exception.description : r.exceptionDetails.text };
    }
    return r.result.value;
  };

  console.log('=========================================');
  console.log('真实 Chrome 流程测试');
  console.log('URL:', URL);
  console.log('=========================================\n');

  // 先确认当前页面是不是我们要的页面
  const pageUrl = await evalJs('location.href');
  const pageTitle = await evalJs('document.title');
  console.log('0) 当前页面 URL =', pageUrl);
  console.log('   标题 =', pageTitle);
  if (String(pageUrl).indexOf('index.html') < 0 && String(pageUrl).indexOf('8899') < 0) {
    console.log('X 当前不是目标页面，可能在 about:blank 或其他 tab');
    console.log('  所有日志：');
    logs.forEach(l => console.log('   ', l));
    await client.close(); chrome.kill(); process.exit(1);
  }

  // ---------- 1. 页面基本状态 ----------
  const ready = await evalJs('document.readyState');
  console.log('\n1) document.readyState =', ready);

  const hasGame = await evalJs('typeof Game !== "undefined"');
  console.log('   Game 已定义 =', hasGame);
  if (!hasGame) {
    console.log('X 游戏脚本没加载。所有日志：');
    logs.forEach(l => console.log('   ', l));
    // 看看 script 标签加载情况
    const scripts = await evalJs(
      'Array.prototype.map.call(document.scripts, function(s){ return s.src || "(inline)"; }).join("\\n")'
    );
    console.log('   页面里的 script 标签：');
    console.log(String(scripts).split('\n').map(s => '     ' + s).join('\n'));
    await client.close(); chrome.kill(); process.exit(1);
  }

  const st0 = await evalJs('Game.state');
  console.log('   初始 state =', st0);

  const uiPanelCount = await evalJs('(function(){var u=document.getElementById("ui");return u?u.children.length:-1;})()');
  console.log('   #ui 子元素数 =', uiPanelCount);

  // ---------- 2. ★新增：设备选择页★ ----------
  /* 2026-10-06 起，游戏第一次打开会先弹「选择游玩设备」。
   * 这个测试用的是一个全新的 Chrome profile（没有 localStorage），
   * 所以**必然**会停在这一页 —— 测试必须先选一个模式才能往下走。
   *
   * 这里选「电脑模式」：后面几步要验证"电脑模式全程不出现虚拟按键"，
   * 正好顺带把它测了。 */
  const clickByText = async (text) => {
    return await evalJs(`(function(){
      var u = document.getElementById('ui');
      if (!u) return 'no-ui';
      var btns = u.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.indexOf(${JSON.stringify(text)}) >= 0) {
          btns[i].click();
          return 'clicked:' + btns[i].textContent.slice(0, 24);
        }
      }
      return 'not-found:' + btns.length;
    })()`);
  };

  /* ---------- ★ 1.5 先过启动画面（2026-10-06 新增）★ ----------
   * 十一要求"打开游戏后先展示启动画面，玩家点击后方进入主菜单"。
   * 所以现在第一屏是 STATE.SPLASH，不是 menu 也不是 device_pick。
   * 所有真浏览器测试都要先点掉它 —— 不点的话后续断言全在
   * splash 上跑，看起来像游戏坏了（这正是本节存在的意义）。 */
  if (st0 === 'splash') {
    console.log('\n1.5) 启动画面 → 点击进入主菜单');
    const rSp = await evalJs(`(function(){
      var s = document.getElementById('splash');
      if (!s) return 'no-splash';
      s.click();
      return 'clicked-splash';
    })()`);
    console.log('   点击结果:', rSp);
    await sleep(400);
    const stAfter = await evalJs('Game.state');
    console.log('   之后 state =', stAfter, '(应为 menu)');
    if (stAfter !== 'menu') {
      console.log('   ⚠️ 启动画面没有正确进入主菜单！');
    }
    /* 标题必须存在且层级最高 —— 十一的硬性要求 */
    const titleInfo = await evalJs(`(function(){
      var t = document.querySelector('#splash, .panel h1');
      var h1 = document.querySelector('.panel h1');
      return h1 ? h1.textContent : '(无标题)';
    })()`);
    console.log('   主菜单标题 =', titleInfo, '(应为 第十一单外卖)');
  } else {
    console.log('\n1.5) 跳过启动画面（state=' + st0 + '）');
  }

  if (st0 === 'device_pick') {
    console.log('\n2) 首次打开 → 设备选择页');
    // 用设备卡片（div）而不是按钮来选 —— 卡片是 .device-card
    const rDev = await evalJs(`(function(){
      var c = document.querySelector('.device-card[data-device="desktop"]');
      if (!c) return 'no-device-card';
      c.click();
      return 'clicked-desktop';
    })()`);
    console.log('   选电脑模式:', rDev);
    await sleep(400);
    const stDev = await evalJs('Game.state');
    console.log('   之后 state =', stDev, '(应为 menu)');
    const devMode = await evalJs(
      '(function(){try{return localStorage.getItem("delivery-game-device-mode")}catch(e){return "err"}})()'
    );
    console.log('   localStorage 设备模式 =', devMode, '(应为 desktop)');
  } else {
    console.log('\n2) 跳过设备选择（已有选择记录）state =', st0);
    /* 补一步：确保是电脑模式，否则后面的虚拟按键断言会误判 */
    await evalJs('(function(){ try{ DEVICE.set("desktop"); }catch(e){} })()');
    await sleep(200);
  }

  // ---------- 2b. 点「选择路线」 ----------
  console.log('\n2b) 点「选择路线」');

  /* ★ 2026-10-06 第 5 期：E1 气象播报过场 ★
   * 单人模式下点关卡会先进"气象播报"过场（weather_brief），
   * 再点「收到」才真正进游戏。
   *
   * 本测试关注的是"点卡片 → 进游戏"这条链路能不能通，
   * 播报过场本身有专门的检查（见 celeste-browser-test 的 5.6 段）。
   * 所以这里用官方开关跳过播报，保持这条流程测试的纯粹。
   * ⚠️ 不要改成"去点过场 DOM"—— 那样播报界面一改这测试就碎。 */
  await evalJs('Game.skipWeatherBrief = true');

  const r1 = await clickByText('选择路线');
  console.log('   结果:', r1);
  await sleep(400);
  const st1 = await evalJs('Game.state');
  console.log('   之后 state =', st1);

  const cards = await evalJs('document.querySelectorAll(".lv-card").length');
  console.log('   卡片数量 =', cards);

  // ---------- 3. 点第 1 关 ----------
  console.log('\n3) 点第 1 张关卡卡片');
  const r2 = await evalJs(`(function(){
    var c = document.querySelectorAll('.lv-card');
    if (!c.length) return 'no-card';
    var cls = c[0].className;
    c[0].click();
    return 'clicked, class=' + cls;
  })()`);
  console.log('   结果:', r2);
  await sleep(500);

  const st2 = await evalJs('Game.state');
  const lvName = await evalJs('Game.level ? Game.level.name : null');
  const playerN = await evalJs('Game.players ? Game.players.length : -1');
  const frame = await evalJs('Game.frame');
  const uiVis = await evalJs('document.getElementById("ui").className');
  const px = await evalJs('Game.players[0] ? Math.round(Game.players[0].x) : null');
  const py = await evalJs('Game.players[0] ? Math.round(Game.players[0].y) : null');

  console.log('   state       =', st2);
  console.log('   level       =', lvName);
  console.log('   players     =', playerN);
  console.log('   frame       =', frame, '(在涨说明循环在跑)');
  console.log('   #ui.class   =', JSON.stringify(uiVis), '(应为空 = 浮层已隐藏)');
  console.log('   角色位置    =', px + ',' + py);

  // ---------- 4. ★新增：电脑模式必须彻底没有虚拟按键★ ----------
  /* 十一的验收标准：
   *   "在电脑模式下，从打开游戏到完成一关，全程不出现任何手机虚拟按键。"
   *   "即使电脑支持触控，也不能因为检测到 ontouchstart、触摸屏或
   *    pointer 事件而自动显示手机按键。"
   *
   * 这里检查三件事：
   *   1. #touchpad 没有 .tp-on（CSS 上就不会显示）
   *   2. 即使**手动**调用 syncVisibility（模拟窗口变化/状态切换），
   *      也依然不会显示 —— 这条最关键，它验证"探测不会盖过玩家选择"
   *   3. 整个过程中模式没有被自动改掉 */
  const padOn = await evalJs(
    "(function(){var t=document.getElementById('touchpad');return t? t.classList.contains('tp-on') : 'no-el';})()"
  );
  console.log('\n4) 虚拟手柄 .tp-on =', padOn, '(电脑模式应为 false)');

  // 模拟"窗口尺寸变化"这个最容易误触发显示的事件
  await evalJs('(function(){ try{ window.dispatchEvent(new Event("resize")); }catch(e){} })()');
  await sleep(250);
  const padOn2 = await evalJs(
    "(function(){var t=document.getElementById('touchpad');return t? t.classList.contains('tp-on') : 'no-el';})()"
  );
  console.log('   resize 之后 .tp-on =', padOn2, '(必须仍是 false)');

  const devStill = await evalJs('DEVICE.mode');
  console.log('   设备模式仍是 =', devStill, '(必须仍是 desktop)');

  // ---------- 5. 再等一会儿，看循环是否持续 ----------
  await sleep(800);
  const frame2 = await evalJs('Game.frame');
  console.log('\n5) 800ms 后 frame =', frame2, frame2 > frame ? '(✓ 游戏循环在跑)' : '(X 游戏循环停了！)');

  // ---------- 6. 截图 ----------
  try {
    const shot = await Page.captureScreenshot({ format: 'png' });
    const out = path.join(SRC, 'assets', '_realtest_shot.png');
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('\n6) 截图已保存:', out);
  } catch (e) { console.log('截图失败:', e.message); }

  // ---------- 7. 错误汇总 ----------
  console.log('\n=========================================');
  if (errors.length) {
    console.log('发现 ' + errors.length + ' 条错误：');
    errors.forEach(e => console.log('  ' + e));
  } else {
    console.log('没有 console 错误 ✓');
  }

  const noTouchPad = (padOn === false) && (padOn2 === false) && (devStill === 'desktop');
  const ok = st2 === 'playing' && frame2 > frame && uiVis === '' &&
             errors.length === 0 && noTouchPad;
  console.log('');
  if (!noTouchPad) console.log('X 电脑模式下虚拟手柄不应该出现（或设备模式被自动改了）');
  console.log(ok ? '✓ 真实浏览器流程通过' : 'X 真实浏览器流程有问题');
  console.log('=========================================');

  await client.close();
  chrome.kill();
  if (NEED_LOCAL_SERVER) server.close();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.log('测试脚本异常:', e.message);
  console.log(e.stack);
  try { if (NEED_LOCAL_SERVER) server.close(); } catch (x) {}
  process.exit(1);
});
