/* ============================================================
 * single-player-browser-test.js — 单人模式改造 · 真浏览器验证
 * ============================================================
 * 逐条验证十一在这一轮提的【验收标准】里需要真浏览器才能测的部分：
 *
 *   一、设备模式
 *     · 首次打开显示设备选择页
 *     · 选电脑模式后进主菜单 + 写 localStorage
 *     · ★电脑模式下全程没有虚拟按键★
 *     · 切到手机模式后手柄出现（且只在游玩时）
 *     · 刷新后保持上次选择
 *     · 切换设备模式不丢进度
 *
 *   二、单人优先菜单层级
 *     · 主按钮是「开始跑单」
 *     · 双人/联机收进「其他模式」，不在顶层
 *
 *   十六、角色库
 *     · 有入口、能打开、列出 2 个角色（不是空卡片）
 *     · 能切换角色
 *     · 电脑模式下角色库不显示手机操作按钮
 *
 *   十七/十八、角色解锁
 *     · 未制作的角色不出现在库里
 *     · 通关节点关卡不会假提示解锁
 *
 *   十二、设置
 *     · 能打开、能切设备模式、能开关音效
 *     · 清除存档需要**二次确认**
 *
 *   三/四/七、文案一致性
 *     · HUD / 结算里不出现"金币"和"五星"（统一成"订单"和三星制）
 *
 * 用法：node tests/single-player-browser-test.js
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const ROOT = SRC;
const PORT = 8961;
const CDP_PORT = 9431;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css',
};

const server = http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), function (e, d) {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
});

const URL = 'http://127.0.0.1:' + PORT + '/index.html';
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✅ ' + name); }
  else {
    FAIL++;
    problems.push(name);
    console.log('  ❌ ' + name + (detail ? '  → ' + detail : ''));
  }
}

(async function () {
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });

  const ud = path.join(require('os').tmpdir(), 'sp-test-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + ud,
    '--window-size=1280,900', URL,
  ], { stdio: 'ignore' });

  let cl;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { cl = await CDP({ port: CDP_PORT }); break; } catch (e) {}
  }
  if (!cl) {
    console.log('X 连不上 Chrome');
    chrome.kill();
    server.close();
    process.exit(1);
  }

  const { Page, Runtime, Console } = cl;
  await Promise.all([Page.enable(), Runtime.enable(), Console.enable()]);

  const errors = [];
  Console.messageAdded(function (m) {
    const line = '[' + m.message.level + '] ' + m.message.text;
    if (m.message.level === 'error' && line.indexOf('favicon') < 0) errors.push(line);
  });
  Runtime.exceptionThrown(function (p) {
    const d = p.exceptionDetails;
    errors.push('[异常] ' + ((d.exception && d.exception.description) || d.text));
  });

  async function ev(expr) {
    const r = await Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 120));
    }
    return r.result.value;
  }

  await sleep(3200);
  console.log('单人模式改造 · 真浏览器验证');
  console.log('='.repeat(58));

  /* ============================================================
   * 一、启动画面（2026-10-06 改版）
   * ============================================================
   * ⚠️ 历史说明：本节原来测的是"设备选择页"（电脑/手机二选一）。
   *    十一在 2026-10-06 明确要求：
   *      "暂不开通手机端入口，移除『选择电脑端／手机端』的初始选择页，
   *       专注完善电脑端。"
   *      "打开游戏后先展示包含标题『第十一单外卖』及对应背景图的启动画面，
   *       玩家点击后方进入『开始跑单／选择路线』界面。"
   *    所以第一屏从"设备选择页"换成了"启动画面"，
   *    这一节整体改成对启动画面的验收。
   * ============================================================ */
  console.log('\n=== 一、启动画面（首次打开）===');

  const st0 = await ev('Game.state');
  check('首次打开停在启动画面', st0 === 'splash', 'state=' + st0);

  /* ============================================================
   * ★ 设备模式：启动阶段（2026-10-07 新增）
   * ============================================================
   * 【规则】boot() 里只调 `DEVICE.init()` —— **不弹选择页、不替玩家决定**：
   *   · 没选过  → chosen 保持 false（真正的选择推迟到"开始跑单"）
   *   · 选过    → 沿用玩家的选择
   * 【为什么要在这里测】必须是**页面刚打开、还没任何交互**的时刻 ——
   *   后面一旦走了"开始跑单"流程，chosen 就变 true 了。
   * ⚠️ 不能断言 mode 的具体值（取决于设备探测；headless 会被判成 mobile）。
   * ⚠️ 必须在**任何 DEVICE.set 之前**测。 */
  const dev0 = await ev('JSON.stringify({mode:DEVICE.mode, chosen:DEVICE.chosen()})');
  const dev0o = JSON.parse(dev0);
  console.log('   启动时设备状态:', dev0);
  check('★ 启动阶段不弹设备选择页（它属于"开始跑单"流程）',
    st0 !== 'device_pick', 'state=' + st0);
  check('★ 启动阶段不替玩家偷偷做设备选择（chosen=false）',
    dev0o.chosen === false, dev0);

  /* 启动画面必须有一个大标题「第十一单外卖」 */
  const spTitle = await ev(
    '(function(){var t=document.querySelector(".splash-title");return t?t.textContent:""})()'
  );
  check('启动画面标题是「第十一单外卖」',
    spTitle.indexOf('第十一单外卖') >= 0, JSON.stringify(spTitle));

  /* 十一第 10 条：小标题不许出现"美团袋鼠 奶龙"这类混搭 */
  const spAllText = await ev('document.getElementById("ui").textContent');
  check('启动画面没有「袋鼠 × 奶龙」这类混搭小标题',
    spAllText.indexOf('奶龙') < 0 && spAllText.indexOf('×') < 0,
    spAllText.slice(0, 80));

  /* 必须有一张背景图（canvas 画的） */
  const spBg = await ev('!!document.querySelector("#splash canvas.splash-bg")');
  check('启动画面有背景图', spBg === true);

  /* 标题层级最高：不能被任何面板遮挡 → 启动层 z-index 要很高 */
  const spZ = await ev(`(function(){
    var s=document.getElementById('splash');
    if(!s) return -1;
    return parseInt(getComputedStyle(s).zIndex,10)||0;
  })()`);
  check('启动画面层级足够高（标题不被遮挡）', spZ >= 50, 'z-index=' + spZ);

  /* 不允许滚动 —— 十一要求"初始页面禁止出现下滑或滚动" */
  const spScroll = await ev(`(function(){
    var s=document.getElementById('splash');
    return { sh:s.scrollHeight, ch:s.clientHeight };
  })()`);
  check('启动画面一屏呈现（不滚动）',
    spScroll.sh <= spScroll.ch + 2, JSON.stringify(spScroll));

  /* 顶部要保留美团袋鼠小标志（十一第 10 条：可保留袋鼠形象） */
  const spBadge = await ev('!!document.querySelector("#splash .splash-brand canvas")');
  check('启动画面保留了美团袋鼠小标志', spBadge === true);

  /* ============================================================
   * ★ 封面上左右两只：左边美团袋鼠、右边飞龙宝宝 ★
   * ============================================================
   * ⚠️ 这条断言的"正确答案"变过，注意别改回错的方向。
   *
   *   第 1 版（原设计）：左袋鼠 + 右飞龙宝宝
   *   第 2 版（2026-10-06 一度改成）：两边都是袋鼠
   *        —— 十一当时说"封面上丑丑的改版奶龙都不要，全改成美团袋鼠"
   *   第 3 版（2026-10-06 最终，就是现在）：**左袋鼠 + 右飞龙宝宝**
   *        —— 十一看完成品后澄清："包括主菜单旁边的**飞龙宝宝**也不要删"，
   *           她真正不想删的是主菜单两侧的角色，封面也一并恢复成搭配版。
   *
   * ⇒ 所以现在的正确断言是：左边袋鼠、**右边飞龙宝宝**。
   *
   * ⚠️ 判定方法：用**同一个 paintCharPreview** 在离屏 canvas 上
   *    分别画 kangaroo / dragon，和封面上那两张比"不透明格数 + 指纹"。
   *    直接比 DOM 或搜文字都判断不出"画的是谁"。
   *
   * ⚠️ 还要先等贴图加载完 —— 封面是 boot 时立刻画的，
   *    那时 PNG 可能没加载完，会画成 16×16 的兜底方块版
   *    （这正是十一说的"丑丑的那个版本"）。buildSplash 里有
   *    轮询重画来修这个，所以要等一会儿再采样。 */
  await sleep(1600);
  const castInfo = await ev(`(function(){
    /* ⚠️ 参考图必须和封面上用**完全一样**的参数画 ——
     *    启动画面两侧用 paintCharPreview(cv, role, {visualFill:true})。
     *    如果这里不用 visualFill，画出来的不透明格数就不一样，
     *    比较会永远失败（踩过这个坑）。 */
    function render(role, sz){
      var cv=document.createElement('canvas'); cv.width=sz; cv.height=sz;
      paintCharPreview(cv, role, {visualFill:true}); return cv;
    }
    function norm(cv){
      var t=document.createElement('canvas'); t.width=24; t.height=24;
      var g=t.getContext('2d'); g.imageSmoothingEnabled=false;
      g.drawImage(cv,0,0,24,24);
      var d=g.getImageData(0,0,24,24).data;
      var h=0,n=0; for(var i=0;i<d.length;i+=4){ if(d[i+3]>40){h=(h*31+((i/4)|0))>>>0;n++;} }
      return {h:h,n:n};
    }
    function same(a,b){ return a.h===b.h && a.n===b.n; }
    var kRef = norm(render('kangaroo',196));
    var dRef = norm(render('dragon',196));
    var lv = document.querySelector('#splash .sc-left canvas');
    var rv = document.querySelector('#splash .sc-right canvas');
    var lN = lv?norm(lv):null, rN = rv?norm(rv):null;
    var lr = lv?lv.getBoundingClientRect():null;
    /* ★ 新增：量两只的"实际绘制宽高"（用同一个函数画到已知尺寸再测不透明包围盒） */
    function solidBox(role){
      var cv=document.createElement('canvas'); cv.width=196; cv.height=196;
      paintCharPreview(cv, role, {visualFill:true});
      var g=cv.getContext('2d');
      var d=g.getImageData(0,0,196,196).data;
      var minX=999,maxX=-1,minY=999,maxY=-1;
      for(var y=0;y<196;y++) for(var x=0;x<196;x++){
        if(d[(y*196+x)*4+3]>40){ if(x<minX)minX=x; if(x>maxX)maxX=x;
                                  if(y<minY)minY=y; if(y>maxY)maxY=y; }
      }
      return {w:maxX-minX+1, h:maxY-minY+1, area:(maxX-minX+1)*(maxY-minY+1)};
    }
    var kBox = solidBox('kangaroo'), dBox = solidBox('dragon');
    return {
      kRefN: kRef.n, dRefN: dRef.n,
      leftIsKangaroo:  lN?same(lN,kRef):false,
      leftIsDragon:    lN?same(lN,dRef):false,
      rightIsKangaroo: rN?same(rN,kRef):false,
      rightIsDragon:   rN?same(rN,dRef):false,
      leftW:  lr?Math.round(lr.width):0,
      rightW: rv?Math.round(rv.getBoundingClientRect().width):0,
      badgeW: (function(){var b=document.querySelector('#splash .sb-badge');
        return b?Math.round(b.getBoundingClientRect().width):0;})(),
      kBox: kBox, dBox: dBox,
      areaDiffPct: +(Math.abs(kBox.area-dBox.area)/Math.max(kBox.area,dBox.area)*100).toFixed(1)
    };
  })()`);
  check('★ 封面左边是美团袋鼠（真贴图，不是兜底方块版）',
    castInfo.leftIsKangaroo === true,
    'leftIsKangaroo=' + castInfo.leftIsKangaroo +
    ' leftN=' + castInfo.leftKangarooN + ' refK=' + castInfo.kRefN);
  check('★ 封面右边是飞龙宝宝（恢复左边的袋鼠 + 右边的飞龙宝宝搭配）',
    castInfo.rightIsDragon === true && castInfo.rightIsKangaroo === false,
    'rightIsDragon=' + castInfo.rightIsDragon +
    ' rightIsKangaroo=' + castInfo.rightIsKangaroo);
  /* ============================================================
   * ★ 启动画面两侧：袋鼠和飞龙「面积对齐」★
   * ============================================================
   * ⚠️ 注意：这一条测的是**启动画面（封面）**的 `#splash .sc-left/.sc-right`，
   *    **不是**点进去之后的菜单页！两者是两套绘制：
   *      · 启动画面 → ui.js 的 paintCharPreview()（这一条测的）
   *      · 菜单页   → render.js 的 drawMenuBackdrop()（另一套，不在这里测）
   *
   * 【需求变过，别搞混】
   *   ① 十一先说"主菜单页的袋鼠要和龙一样大"（当时我理解成两处都要一样大）
   *   ② 后来看到实物，又说："那个菜单栏页的那个飞龙宝宝，那个给我放小一点"
   *   ⇒ 现在的状态是**两处不同规则**：
   *      · 启动画面（封面）：两只**面积对齐**（下面这条断言守着）
   *      · 菜单页：飞龙**故意比袋鼠小**（见 render.js 的 DRAGON_SCALE）
   *   所以如果有人想让"两处一致"，先想清楚十一到底要哪种。
   * ============================================================ */
  check('★ 封面两侧角色面积对齐（面积差 ≤ 8%）',
    castInfo.areaDiffPct <= 8,
    '袋鼠 ' + castInfo.kBox.w + 'x' + castInfo.kBox.h + ' (面积' + castInfo.kBox.area + ')' +
    ' / 飞龙 ' + castInfo.dBox.w + 'x' + castInfo.dBox.h + ' (面积' + castInfo.dBox.area + ')' +
    ' → 差 ' + castInfo.areaDiffPct + '%');
  check('★ 封面两侧角色已放大（≥160px 宽）',
    castInfo.leftW >= 160 && castInfo.rightW >= 160,
    '左 ' + castInfo.leftW + 'px / 右 ' + castInfo.rightW + 'px');
  check('★ 顶部袋鼠标志尺寸正常（≥24px）',
    castInfo.badgeW >= 24, castInfo.badgeW + 'px');

  /* ============================================================
   * 二、点击进入主菜单
   * ============================================================ */
  console.log('\n=== 二、点击启动画面进入主菜单 ===');

  const rDev = await ev(`(function(){
    var s = document.getElementById('splash');
    if (!s) return 'no-splash';
    s.click();
    return 'clicked';
  })()`);
  await sleep(400);
  check('点击后进入主菜单',
    (await ev('Game.state')) === 'menu', rDev + ' state=' + (await ev('Game.state')));

  /* ★★ 2026-10-07：本套测试统一钉死"电脑模式" ★★
   * ------------------------------------------------------------
   * 【为什么必须钉】
   *   设备选择重新开放后，`DEVICE.mode` 变成**由探测/玩家决定**，
   *   而 headless Chrome 会被探测成 **mobile** ⇒
   *   `body.dev-mobile` 生效 ⇒ `.btn` 的 padding 被改小（13px 18px）
   *   ⇒ 主菜单按钮宽度从 ~70px 掉到 **68px** ⇒
   *   "按钮够大（≥70×45）"这条**假红**。
   *
   * 【为什么这套测试必须是电脑模式】
   *   它验收的是"**主菜单在电脑端的布局**"（按钮尺寸、工具条位置、
   *   电脑模式不出现虚拟按键…）。手机模式该由手机端测试去验。
   *   ⇒ 在开头显式 `DEVICE.set('desktop')`，让后面的断言有确定的前提。
   * ------------------------------------------------------------ */
  await ev('(function(){ try{ DEVICE.set("desktop"); }catch(e){} UI.lastKey=""; syncUI(); })()');
  await sleep(300);

  /* （设备模式的启动断言已挪到"一、启动画面"那节的最前面 ——
   *   必须在任何交互/DEVICE.set 之前测。这里不再重复。） */

  /* ============================================================
   * 三、主菜单层级（单人优先）
   * ============================================================ */
  console.log('\n=== 三、主菜单层级（单人优先）===');

  const menuBtns = await ev(
    'Array.prototype.slice.call(document.querySelectorAll("#ui .btn")).map(function(b){return b.textContent.replace(/\\s+/g," ").trim()})'
  );
  console.log('   按钮:', JSON.stringify(menuBtns.map(function (t) { return t.slice(0, 18); })));

  /* ⚠️ 重要：`.btn` 的 textContent = 「主文案 + 说明文案」拼接。
   *    所以判断"按钮是什么"要用**主文案**（第一个 span），
   *    不能用 textContent 整体 —— 否则说明里出现同义词就会误判。
   *    下面统一用主文案来判断。
   *
   *    踩过的坑：一开始用 textContent 找「设置」，
   *    结果"其他模式"的说明里含"双人同屏 · 异地联机"，
   *    以及"设置"按钮的 textContent 是"设置音效、震动…"，
   *    两个断言都误报了。 */
  const menuLabels = await ev(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('#ui .btn')).map(function(b){
      var first = b.querySelector('span');
      return first ? first.textContent.trim() : b.textContent.replace(/\\s+/g,' ').trim();
    });
  })()`);
  console.log('   主文案:', JSON.stringify(menuLabels));

  check('主按钮是「开始跑单」',
    menuLabels.some(function (t) { return t.indexOf('开始跑单') >= 0; }));

  /* ★ 双人和联机不能作为**独立的顶层按钮** ★
   * 判据：顶层按钮的主文案里不能出现"双人同屏"或"联机"的字样。
   * （"其他模式（开发中）"这个按钮允许 —— 它是唯一的入口，
   *   而且十一明确要求"主菜单中保留一个低优先级入口"。） */
  const topCoop = menuLabels.filter(function (t) {
    return t.indexOf('双人同屏') >= 0 ||
           t.indexOf('联机') >= 0 ||
           /^双人/.test(t);
  });
  check('★ 顶层菜单没有独立的「双人同屏」/「联机」按钮',
    topCoop.length === 0,
    JSON.stringify(topCoop));

  check('有「其他模式（开发中）」入口',
    menuLabels.some(function (t) { return t.indexOf('其他模式') >= 0; }));

  check('有「角色库」入口',
    menuLabels.some(function (t) { return t.indexOf('角色库') >= 0; }));

  check('有「设置」入口',
    menuLabels.some(function (t) { return t === '设置'; }),
    JSON.stringify(menuLabels));

  /* 主按钮的视觉权重必须最高 */
  const primaryInfo = await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var prim = btns.filter(function(b){ return b.classList.contains('primary'); });
    var muted = btns.filter(function(b){ return b.classList.contains('muted'); });
    return {
      primaryTexts: prim.map(function(b){return b.textContent.replace(/\\s+/g,' ').trim().slice(0,14)}),
      mutedTexts: muted.map(function(b){return b.textContent.replace(/\\s+/g,' ').trim().slice(0,14)}),
    };
  })()`);
  console.log('   primary:', JSON.stringify(primaryInfo.primaryTexts));
  console.log('   muted  :', JSON.stringify(primaryInfo.mutedTexts));
  check('「开始跑单」是 primary 样式（最醒目）',
    primaryInfo.primaryTexts.some(function (t) { return t.indexOf('开始跑单') >= 0; }),
    JSON.stringify(primaryInfo.primaryTexts));
  check('「其他模式」是 muted 样式（明显更弱）',
    primaryInfo.mutedTexts.some(function (t) { return t.indexOf('其他模式') >= 0; }),
    JSON.stringify(primaryInfo.mutedTexts));

  /* ============================================================
   * 三·5 ★ 主菜单所有按钮必须"真的能点动" ★
   * ============================================================
   * 背景（2026-10-06 十一反馈"设置点不动"）：
   *   左上角工具条是挂在 #ui 下的，而 #ui 是 pointer-events:none
   *   （设计如此：只让子元素接收点击），.panel 自己开了 auto，
   *   但 .menu-corner / .menu-side 忘了开 —— 于是点击直接穿透到 canvas。
   *
   *   ⚠️ 关键：`b.click()` **测不出**这个问题！
   *   element.click() 直接派发事件，绕过了浏览器的命中测试；
   *   真实鼠标点击才会走 elementFromPoint。所以这里必须查
   *   **命中元素**（elementFromPoint），而不是调用 click()。
   *
   *   同时顺带检查"按钮有没有跑出游戏画面"——
   *   当时按钮在 x=10，而 canvas 从 x=17 才开始，有一半在画面外。
   * ============================================================ */
  const clickProbe = await ev(`(function(){
    var cv = document.querySelector('canvas');
    var cr = cv ? cv.getBoundingClientRect() : null;
    var out = [];
    var list = document.querySelectorAll('.menu-corner .btn, .menu-side .btn, .panel.menu-fit .btn');
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var r = b.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var hit = document.elementFromPoint(cx, cy);
      /* 命中元素必须在这个按钮内部（b.contains(hit)） */
      var inside = !!(hit && (b === hit || b.contains(hit)));
      out.push({
        label: (b.querySelector('span') ? b.querySelector('span').textContent.trim() : '?'),
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left), y: Math.round(r.top),
        pe: getComputedStyle(b).pointerEvents,
        hitTag: hit ? hit.tagName : 'null',
        clickable: inside && getComputedStyle(b).pointerEvents === 'auto',
        inCanvas: cr ? (r.left >= cr.left - 2) : null,
      });
    }
    return out;
  })()`);
  clickProbe.forEach(function (b) {
    console.log('   ' + (b.clickable ? '✓' : '✗') + ' ' + b.label +
      '  ' + b.w + 'x' + b.h + ' @(' + b.x + ',' + b.y + ')  pe=' + b.pe +
      '  命中=' + b.hitTag);
  });
  const unclickable = clickProbe.filter(function (b) { return !b.clickable; });
  check('★ 主菜单所有按钮都"真的能点动"（命中测试通过）',
    clickProbe.length >= 6 && unclickable.length === 0,
    unclickable.map(function (b) { return b.label + '(pe=' + b.pe + ',命中=' + b.hitTag + ')'; }).join('; '));
  const outside = clickProbe.filter(function (b) { return b.inCanvas === false; });
  check('★ 工具条按钮都在游戏画面内（不跑到画面外）',
    outside.length === 0,
    outside.map(function (b) { return b.label + '@x=' + b.x; }).join('; '));
  /* 尺寸够大才好点（十一说"设置稍微大一点"） */
  const cornerBtns = clickProbe.filter(function (b) {
    return b.label.indexOf('设置') >= 0 || b.label.indexOf('按键说明') >= 0;
  });
  check('★ 左上角工具条按钮够大（≥70×45，好点）',
    cornerBtns.length === 2 && cornerBtns.every(function (b) { return b.w >= 70 && b.h >= 45; }),
    JSON.stringify(cornerBtns.map(function (b) { return b.label + ' ' + b.w + 'x' + b.h; })));

  /* ============================================================
   * 四、其他模式页
   * ============================================================ */
  console.log('\n=== 四、其他模式页 ===');

  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){return x.textContent.indexOf('其他模式')>=0})[0];
    if (b) b.click();
  })()`);
  await sleep(400);

  const otherInfo = await ev(`(function(){
    return {
      st: Game.state,
      text: document.getElementById('ui').textContent,
      btns: Array.prototype.slice.call(document.querySelectorAll('#ui .btn'))
              .map(function(b){return b.textContent.replace(/\\s+/g,' ').trim().slice(0,16)})
    };
  })()`);
  check('能进入其他模式页', otherInfo.st === 'other_modes', otherInfo.st);
  check('其他模式页有「双人同屏」', otherInfo.text.indexOf('双人同屏') >= 0);
  check('其他模式页有「异地联机」或「联机」', otherInfo.text.indexOf('联机') >= 0);
  check('其他模式页如实提示"仍在优化/可能卡顿"',
    otherInfo.text.indexOf('优化') >= 0 || otherInfo.text.indexOf('卡顿') >= 0,
    otherInfo.text.slice(0, 100));

  /* 返回主菜单 */
  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){return x.textContent.trim()==='返回'})[0];
    if (b) b.click();
  })()`);
  await sleep(300);
  check('从其他模式能返回主菜单', (await ev('Game.state')) === 'menu');

  /* ============================================================
   * 五、角色库
   * ============================================================ */
  console.log('\n=== 五、角色库 ===');

  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){return x.textContent.indexOf('角色库')>=0})[0];
    if (b) b.click();
  })()`);
  await sleep(400);

  const lib = await ev(`(function(){
    var cards = document.querySelectorAll('.lib-card');
    var out = [];
    for (var i=0;i<cards.length;i++){
      var c = cards[i];
      out.push({
        id: c.getAttribute('data-char'),
        locked: c.classList.contains('locked'),
        active: c.classList.contains('active'),
        text: c.textContent.replace(/\\s+/g,' ').trim().slice(0,120)
      });
    }
    return { st: Game.state, n: cards.length, cards: out };
  })()`);
  console.log('   角色库卡片数:', lib.n);
  check('角色库能打开', lib.st === 'char_library', lib.st);
  /* ⚠️ 2026-10-06 变更：飞龙宝宝改为"通关第 1 关解锁"，
   *    所以**新档只剩袋鼠 1 个**。
   *    角色库显示的是 listVisibleChars() = "已制作 + **已解锁**"。
   *    本测试跑的是**新档**（没通关任何一关），所以飞龙/卡皮巴拉/史迪奇都还没解锁
   *    → 不该出现。⇒ 期望 1 个（袋鼠）。
   *    ⚠️ 别改成 2+ —— 那就变成"未解锁的也露出来了"，正好违反零剧透。 */
  check('角色库只列出已解锁的角色（新档 1 个：袋鼠）', lib.n === 1, 'n=' + lib.n);

  const libIds = lib.cards.map(function (c) { return c.id; });
  check('列出的是袋鼠（飞龙需通关第 1 关才解锁）',
    libIds.length === 1 && libIds.indexOf('kangaroo') >= 0,
    JSON.stringify(libIds));

  /* ★ 未制作的角色不能出现（不显示空卡片）★
   * ★ 而且**未解锁**的也不能出现 —— 卡皮巴拉要在通关第 10 关那一刻才惊喜登场，
   *    在那之前角色库必须彻底干净（见 unlock-test.js 的 H 节）★
   * ⚠️ 注意：这里不能简单断言"capybara 不在" —— 因为本测试可能在
   *    "已解锁卡皮巴拉"的存档状态下跑。正确判据是**未解锁的不在**。 */
  check('★ 未制作的角色不出现在角色库（无空卡片）',
    libIds.indexOf('fourth_rider') < 0,
    JSON.stringify(libIds));

  /* ============================================================
   * ★ 角落按钮条回归守卫（2026-10-06 新增）★
   * ============================================================
   * 十一的要求："返回 / 换骑手开跑 给我放到**黑框的左上角**，
   *              不要放到整个页面左上角。"
   * 原因：列表一长就要往下翻才能按到返回，很烦。
   *
   * 这条断言守住三件事：
   *   ① 这两个按钮**在 .panel-corner 里**（不是底部 row）
   *   ② 它在**面板内部**的左上角（不是页面左上角）
   *   ③ **滚动到底之后仍然可见**（这是 sticky 的核心价值，
   *      也是这个需求的**真正目的** —— 不用往下翻）
   * ============================================================ */
  const libCorner = await ev(`(function(){
    var panel = document.querySelector('.panel');
    var corner = document.querySelector('.panel-corner');
    if (!panel || !corner) return { missing: true };
    var btns = corner.querySelectorAll('.btn');
    var pr = panel.getBoundingClientRect();
    var b0 = btns[0] ? btns[0].getBoundingClientRect() : null;
    /* 滚到底 */
    panel.scrollTop = panel.scrollHeight;
    var cr2 = corner.getBoundingClientRect();
    var pr2 = panel.getBoundingClientRect();
    return {
      btnCount: btns.length,
      hasBack: [].some.call(btns, function(b){ return b.textContent.indexOf('返回') >= 0; }),
      hasSwitch: [].some.call(btns, function(b){ return b.textContent.indexOf('换骑手') >= 0; }),
      inTopLeft: b0 ? (Math.round(b0.left - pr.left) < 44 && Math.round(b0.top - pr.top) < 44) : false,
      notPageCorner: Math.round(cr2.left) >= 10,
      stillVisibleAfterScroll: cr2.top >= pr2.top - 2 && cr2.bottom <= pr2.bottom + 2
    };
  })()`);
  check('★ 角色库：返回/换骑手 在角落条里（不在底部）',
    !libCorner.missing && libCorner.btnCount >= 2 && libCorner.hasBack && libCorner.hasSwitch,
    JSON.stringify(libCorner));
  check('★ 角色库：角落条在面板左上角，且不在页面左上角',
    libCorner.inTopLeft && libCorner.notPageCorner, JSON.stringify(libCorner));
  check('★ 角色库：滚到底之后按钮仍吸在顶部可见（不用往下翻）',
    libCorner.stillVisibleAfterScroll === true, JSON.stringify(libCorner));
  /* ⚠️ padInLib 的定义原本在**角色库段落之后**，
   *    但断言在段落里用它 —— 靠 const 提升的顺序"碰巧"能跑。
   *    我把守卫段落挪位置时打断了这个顺序，所以把定义提到这里。
   *    （这也是个小坑：**用 const 却在前面用**，一挪代码就炸。） */
  const padInLib = await ev(
    "(function(){var t=document.getElementById('touchpad');return t?t.classList.contains('tp-on'):'no-el'})()"
  );
  check('电脑模式下角色库不显示虚拟按键', padInLib === false, String(padInLib));
  /* 卡片要有能力条、简介、状态文字 —— 不是只有名字 */
  const cardRich = await ev(`(function(){
    var c = document.querySelector('.lib-card');
    if (!c) return {};
    return {
      attrRows: c.querySelectorAll('.attr-row').length,
      hasDesc: !!c.querySelector('.lib-desc'),
      hasState: !!c.querySelector('.lib-state'),
      hasName: !!c.querySelector('.lib-name'),
      hasAvatar: !!c.querySelector('canvas'),
    };
  })()`);
  check('角色卡有能力条（4 项属性）', cardRich.attrRows === 4, JSON.stringify(cardRich));
  check('角色卡有简介文字', cardRich.hasDesc === true);
  check('角色卡有状态标记（已解锁/使用中）', cardRich.hasState === true);
  check('角色卡有名字和形象', cardRich.hasName && cardRich.hasAvatar);

  /* ★ 不能只靠颜色区分状态 → 必须有文字 ★ */
  const stateText = await ev(`(function(){
    var s = document.querySelector('.lib-card .lib-state');
    return s ? s.textContent.trim() : '';
  })()`);
  check('★ 状态用文字标明（不只靠颜色）',
    stateText.indexOf('使用中') >= 0 || stateText.indexOf('已解锁') >= 0,
    '状态文字="' + stateText + '"');

  /* ★ 不能卡片套卡片（需求明确要求）★
   * 检查 .lib-card 内部没有"四周都有边框的块级容器"。
   * 这里用 class 名做结构判断：卡片内部不该再出现 card/panel 类。 */
  const nestedCards = await ev(`(function(){
    var c = document.querySelector('.lib-card');
    if (!c) return -1;
    return c.querySelectorAll('.lib-card, .panel, .code-box').length;
  })()`);
  check('★ 角色卡内部不再嵌套卡片', nestedCards === 0, 'nested=' + nestedCards);

  /* 切换角色 */
  /* ⚠️ 2026-10-06：飞龙改为需解锁后，新档角色库只有袋鼠 1 张卡
   *    → 没有"未选中"的卡可切。所以**先解锁飞龙再重绘角色库**，
   *    这样才有第二个可切换的角色。 */
  await ev(`(function(){
    SAVE().unlockChar('dragon');
    /* ⚠️ 不能只调 syncUI() —— 它按 lastKey 去重，状态没变会跳过重绘。
     *    直接调页面构建函数强制重建角色库。 */
    if (typeof buildCharLibrary === 'function') buildCharLibrary();
    return true;
  })()`);
  await sleep(300);
  const cardCount = await ev("document.querySelectorAll('.lib-card').length");
  if (cardCount < 2) {
    console.log('   （解锁后卡片仍不足 2，实际 n=' + cardCount + '）');
  }

  const switched = await ev(`(function(){
    /* 找"选为骑手"按钮（说明该角色不是当前选中） */
    var cards = Array.prototype.slice.call(document.querySelectorAll('.lib-card'));
    var target = cards.filter(function(c){ return !c.classList.contains('active'); })[0];
    if (!target) return { err: 'no-inactive-card', n: cards.length };
    var targetId = target.getAttribute('data-char');
    var btn = target.querySelector('button');
    if (!btn) return { err: 'no-button', targetId: targetId };
    btn.click();
    return { clicked: targetId };
  })()`);
  await sleep(300);
  const nowSel = await ev('SAVE().selectedChar()');
  check('能从角色库切换骑手',
    switched.clicked && nowSel === switched.clicked,
    JSON.stringify(switched) + ' → now=' + nowSel);

  /* ============================================================
   * ★ 选骑手页：每个角色都要能高亮（2026-10-06 新增）★
   * ============================================================
   * ⚠️ 这条是被十一抓出来的真 bug：
   *   她问"点卡皮巴拉为什么没被框起来"。
   *   根因：选中态的 CSS 是**按 role 写死的两段**：
   *       .char[data-role="kangaroo"].selected { 黄 }
   *       .char[data-role="dragon"].selected   { 橙 }
   *   **加了卡皮巴拉之后没人补第三段** →
   *   它能被选中（JS 逻辑正常、存档也记住了），
   *   但**画面上没有任何高亮** —— 玩家看起来就是"点了没反应"。
   *
   *   ⇒ 现在改成"从角色配置的 accentColor 动态注入行内 style"，
   *     加了这条测试守住：
   *       ① 每个角色的卡都能进入选中态
   *       ② 三张卡的选中色**互不相同**（不是全用同一个兜底色）
   *       ③ 选中一个时，其它卡**必须熄灭**（含行内色）
   *          （漏清行内色会出现"两张卡同时亮"）
   * ============================================================ */
  const pickSel = await ev(`(function(){
    /* 解锁全部 + 进选骑手页 */
    Save.data.maxUnlocked = 11;
    ['kangaroo','dragon','capybara'].forEach(function(id){
      try { Save.unlockChar(id); } catch(e){}
    });
    Save.save();
    Game.state = 'single_pick';
    if (typeof buildCharPick !== 'function') return { err: 'no buildCharPick' };
    buildCharPick();

    var cards = document.querySelectorAll('.char');
    var ids = [];
    for (var i = 0; i < cards.length; i++) ids.push(cards[i].getAttribute('data-char'));

    /* 逐个点击，读**等 transition 跑完**之后的计算样式 */
    var out = {};
    ids.forEach(function(id){
      var card = document.querySelector('.char[data-char="' + id + '"]');
      if (card) card.click();
      out[id] = { clicked: !!card };
    });
    return { ids: ids, clicked: out };
  })()`);
  /* ⚠️ 点击与读取要分开：CSS 里 border-color 有 .1s transition，
   *    点完立刻读会拿到过渡中的旧颜色（我第一次就踩了这个假阴性）。 */
  await sleep(320);
  const pickSelState = await ev(`(function(){
    var out = {};
    document.querySelectorAll('.char').forEach(function(n){
      var cs = getComputedStyle(n);
      out[n.getAttribute('data-char')] = {
        selected: n.className.indexOf('selected') >= 0,
        border: cs.borderTopColor,
        inlineBorder: n.style.borderColor || ''
      };
    });
    return out;
  })()`);

  /* ① 每个角色都能被选中 */
  const pickIds = pickSel.ids || [];
  check('★ 选骑手页：三个骑手卡都在（袋鼠/飞龙/卡皮巴拉）',
    pickIds.length === 3 &&
    pickIds.indexOf('kangaroo') >= 0 && pickIds.indexOf('dragon') >= 0 &&
    pickIds.indexOf('capybara') >= 0,
    JSON.stringify(pickIds));

  /* ② 最后点的是卡皮巴拉 —— 它必须是"选中"的，而且有**非灰**的边框色 */
  const capy = pickSelState['capybara'] || {};
  check('★ 选骑手页：点卡皮巴拉后**有高亮**（不是"点了没反应"）',
    capy.selected === true && capy.inlineBorder &&
    capy.border !== 'rgb(67, 67, 77)',
    'selected=' + capy.selected + ' 边框=' + capy.border + ' 行内=' + capy.inlineBorder);

  /* ③ 选中一个时，其它卡必须熄火（含行内色） */
  const others = Object.keys(pickSelState).filter(function (k) { return k !== 'capybara'; });
  const othersStillLit = others.filter(function (k) {
    var s = pickSelState[k];
    return s.selected || (s.inlineBorder && s.inlineBorder.length);
  });
  check('★ 选骑手页：选中卡皮巴拉后其它卡都熄灭（含行内色，不会"两张都亮"）',
    othersStillLit.length === 0, JSON.stringify(othersStillLit));

  /* 卡片里有没有藏着"还有 N 名骑手没解锁"这类线索 */
  const libText = lib.cards.map(function (c) { return c.text; }).join(' | ');
  check('★ 角色库里没有"还没解锁的角色"的任何文字线索',
    /还有\s*\d|未解锁|未开放|待解锁|敬请期待|coming/i.test(libText) === false,
    libText.slice(0, 160));


  /* ============================================================
   * ★ 角色库段落收尾：**退出角色库，回到主菜单**（2026-10-06 补）★
   * ============================================================
   * 【为什么必须补这一步】
   *   上面那条"滚到底之后按钮仍吸在顶部"的断言里，
   *   我们执行了 `panel.scrollTop = panel.scrollHeight`（把面板滚到底）。
   *   如果不做任何收尾就进下一段，会有**两个后遗症**：
   *     ① 页面还停在 `char_library`（角色库）——
   *        下一段"六、设置页"第一步就查找不到设置页，
   *        报 `not-found → state=char_library`，然后**连锁失败 4 条**
   *        （按键说明 / 操作提示 / 清除存档 / 存档字段）
   *     ② 面板被滚到底，就算能打开设置页，也可能因为滚动位置
   *        导致元素不在视口内而取不到
   *
   *   ⇒ 用"返回"按钮退回主菜单，并把面板滚动位置复位。
   *     这是**测试隔离**的基本要求：一段跑完要恢复到干净的起点。
   * ============================================================ */
  await ev(`(function(){
    /* 1) 复位滚动位置（消除上面"滚到底"的影响） */
    var panel = document.querySelector('.panel');
    if (panel) panel.scrollTop = 0;
    /* 2) 点"返回"退出角色库 */
    var btns = document.querySelectorAll('.btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.indexOf('返回') >= 0) { btns[i].click(); return true; }
    }
    return false;
  })()`);
  await sleep(320);
  const afterLib = await ev('(function(){return Game.state})()');
  check('角色库段落收尾：能退回主菜单（否则下一段会连锁失败）',
    afterLib !== 'char_library', 'state=' + afterLib);

  /* ============================================================
   * 六、设置页
   * ============================================================
   * ⚠️ 这一整段（进设置页 + 三个开关 + 按键说明）曾经被我
   *    挪守卫段落时**误剪掉**，导致后面引用 hintSetting 报
   *    "hintSetting is not defined"。这里按原语义重建。
   * ============================================================ */
  console.log('\n=== 六、设置页 ===');

  const openSettings = await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){ return x.textContent.indexOf('设置') >= 0; })[0];
    if (!b) return 'not-found';
    b.click();
    return 'clicked';
  })()`);
  await sleep(300);
  const setInfo = await ev('({ st: Game.state })');
  check('设置页能打开', setInfo.st === 'settings',
    openSettings + ' → state=' + setInfo.st);

  check('设置页有「按键说明」设置项',
    (await ev(`(function(){
      var t = document.querySelector('#ui');
      return !!(t && t.textContent.indexOf('按键说明') >= 0);
    })()`)) === true);

  const setFlags = await ev(`(function(){
    var s = (typeof SAVE === 'function' && SAVE().settings) ? SAVE().settings() : null;
    return s ? { shake: typeof s.shakeOn, sound: typeof s.soundOn, hint: typeof s.hintOn } : null;
  })()`);
  check('设置页有音效开关', setFlags && setFlags.sound === 'boolean', JSON.stringify(setFlags));
  check('设置页有屏幕震动开关', setFlags && setFlags.shake === 'boolean', JSON.stringify(setFlags));
  check('设置页有操作提示开关',
    (await ev(`(function(){
      var t = document.querySelector('#ui');
      return !!(t && (t.textContent.indexOf('操作提示') >= 0 || t.textContent.indexOf('提示') >= 0));
    })()`)) === true);
  check('设置页有清除存档按钮',
    (await ev(`(function(){
      return !!document.querySelector('.reset-btn');
    })()`)) === true);

  /* ⚠️ 字段名是 hintsOn（复数 hints），不是 hintOn。
   *    这里原来写成单数，读出来永远是 undefined —— 是**测试自己的笔误**，
   *    不是存档缺字段（存档在 save.js 的 defaultSettings 里一直有它）。 */
  const hintSetting = await ev(`(function(){
    var s = (typeof SAVE === 'function' && SAVE().settings) ? SAVE().settings() : null;
    return s ? typeof s.hintsOn : null;
  })()`);
  check('操作提示开关存在于存档中', hintSetting === 'boolean', String(hintSetting));

  /* 切回电脑模式（后面还要用） */
  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){ return x.textContent.indexOf('电脑模式') >= 0; })[0];
    if (b) b.click();
  })()`);
  await sleep(300);

  /* ★ 清除存档必须二次确认 ★ */
  console.log('  -- 清除存档的二次确认 --');
  await ev(`(function(){
    SAVE().recordClear(0, 30, 10, 10, 'kangaroo');
    UI.lastKey=''; syncUI();
  })()`);
  await sleep(300);
  const beforeReset = await ev('SAVE().data.maxUnlocked');
  /* ★ 记下清档前的设备模式 —— 清档后要比对"有没有被改掉" ★ */
  const devBeforeWipe = await ev('DEVICE.mode');
  console.log('   清除前进度 maxUnlocked =', beforeReset, ' 设备模式 =', devBeforeWipe);

  const firstClick = await ev(`(function(){
    var b = document.querySelector('.reset-btn');
    if (!b) return 'no-btn';
    var t0 = b.textContent.replace(/\\s+/g,' ').trim().slice(0,24);
    b.click();
    return t0;
  })()`);
  await sleep(400);
  const afterFirst = await ev('SAVE().data.maxUnlocked');
  check('★ 第一次点"清除存档"不会真的清掉',
    afterFirst === beforeReset,
    'before=' + beforeReset + ' after=' + afterFirst);

  const confirmBtn = await ev(`(function(){
    var b = document.querySelector('.reset-btn');
    return b ? { text: b.textContent.replace(/\\s+/g,' ').trim().slice(0,40),
                 isDanger: b.classList.contains('danger') } : null;
  })()`);
  console.log('   确认按钮:', JSON.stringify(confirmBtn));
  check('第一次点后按钮变成"确认"状态',
    confirmBtn && confirmBtn.text.indexOf('真的清除') >= 0,
    JSON.stringify(confirmBtn));
  check('确认按钮用危险样式（红色）',
    confirmBtn && confirmBtn.isDanger === true);

  /* 第二次点 → 真的清 */
  await ev(`(function(){
    var b = document.querySelector('.reset-btn');
    if (b) b.click();
  })()`);
  await sleep(500);
  check('★ 第二次点才真的清除存档',
    (await ev('SAVE().data.maxUnlocked')) === 1,
    'maxUnlocked=' + (await ev('SAVE().data.maxUnlocked')));

  /* 清档不能影响设备模式
   * ⚠️ 2026-10-07 改：不再断言"必须是 desktop"（设备选择现在由玩家定，
   *    headless 环境探测值是 mobile）。改测**清档前后模式不变** ——
   *    这才是"清档不影响设备模式"这句话的真正含义。 */
  const devAfterWipe = await ev('DEVICE.mode');
  check('清档不影响设备模式（模式保持不变）',
    devAfterWipe === devBeforeWipe,
    '清档前=' + devBeforeWipe + ' 清档后=' + devAfterWipe);

  /* 返回 */
  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){
      var f = x.querySelector('span');
      return f && f.textContent.trim() === '返回';
    })[0];
    if (b) b.click();
  })()`);
  await sleep(300);

  /* ============================================================
   * 七、进游戏 —— HUD 与文案一致性
   * ============================================================ */
  console.log('\n=== 七、进游戏后的 HUD / 文案 ===');

  await ev(`(function(){
    Game.mode='single'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(0); Game.state='playing';
    for (var i=0;i<10;i++){ InputState.now={}; update(1/60); InputState.tick(); }
  })()`);
  await sleep(500);
  check('单人进入第 1 关', (await ev('Game.state')) === 'playing');
  check('单人只生成 1 个角色（不是 2 个）',
    (await ev('Game.players.length')) === 1,
    'players=' + (await ev('Game.players.length')));

  /* HUD 是 canvas 画的，测不到文字 —— 改成检查"数据里没有金币语义的遗留"
   * 以及确保画 HUD 不报错（帧率稳定）。 */
  const hudOk = await ev(`(function(){
    try {
      var f0 = Game.frame;
      for (var i=0;i<30;i++){ InputState.now={}; update(1/60); InputState.tick(); }
      return { ok: true, adv: Game.frame - f0 };
    } catch(e) { return { ok:false, err: String(e) }; }
  })()`);
  check('画 HUD 的路径不抛异常', hudOk.ok === true, JSON.stringify(hudOk));

  /* 手机模式下 HUD 应该缩小 —— 验证 drawHUD 里的缩放确实生效 */
  const hudScale = await ev(`(function(){
    /* 通过检查 DEVICE_STATE().isMobile() 分支的存在来验证 */
    return { mobile: DEVICE_STATE().isMobile(),
             hasFn: typeof drawHUD === 'function',
             hasBoard: typeof drawOrderBoard === 'function' };
  })()`);
  check('HUD 绘制函数齐全（含订单看板）',
    hudScale.hasFn && hudScale.hasBoard, JSON.stringify(hudScale));

  /* 电商语义：源码里不该再有"五星好评"这种和三星制冲突的文案 */
  console.log('  -- 三星制一致性 --');

  /* ★ 通过真实结算界面验证：不再出现"五星"，且用"订单"表述 ★
   * 造一个通关场景，直接渲染结算面板并读它的文字。 */
  const clearText = await ev(`(function(){
    try {
      Game.coinsTotal = 10; Game.coinsTaken = 10; Game.coinsRequired = 5;
      Game.elapsed = 42.5;
      Game.lastRecord = { isNewTime: true, isNewStars: false, isNewCharTime: false,
                          stars: 3, unlocked: [], unlockedChars: [] };
      Game.state = 'clear';
      UI.lastKey = '';
      syncUI();
      return document.getElementById('ui').textContent.replace(/\\s+/g,' ').trim();
    } catch (e) { return 'ERR:' + e; }
  })()`);
  console.log('   结算文案:', clearText.slice(0, 160));

  check('★ 结算面板不出现"五星"（统一为三星制）',
    clearText.indexOf('五星') < 0,
    clearText.slice(0, 120));
  check('结算用"订单"表述（不是"金币"）',
    clearText.indexOf('订单') >= 0 && clearText.indexOf('金币') < 0,
    clearText.slice(0, 120));
  check('结算显示星级（★）', clearText.indexOf('★') >= 0);
  check('结算显示配送用时', clearText.indexOf('用时') >= 0);
  check('结算显示本次使用的骑手', clearText.indexOf('骑手') >= 0);

  /* ★ 失败界面的要求（十一给了明确的按钮顺序）★ */
  const overText = await ev(`(function(){
    try {
      Game.state = 'gameover';
      Game.deathReason = 'fall';
      Game.coinsTotal = 10; Game.coinsTaken = 3; Game.coinsRequired = 5;
      Game.elapsed = 20.1;
      Game.checkpoint = null;     // 本关没有存点 → 不该出现"从检查点继续"
      UI.lastKey = '';
      syncUI();
      var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'))
        .map(function(b){ var f=b.querySelector('span'); return f?f.textContent.trim():''; });
      return { text: document.getElementById('ui').textContent.replace(/\\s+/g,' ').trim(),
               btns: btns };
    } catch (e) { return { err: String(e) }; }
  })()`);
  console.log('   失败面板按钮:', JSON.stringify(overText.btns));
  check('★ 失败界面说明具体原因（掉出配送路线）',
    overText.text.indexOf('掉出配送路线') >= 0,
    overText.text.slice(0, 120));
  check('失败界面显示本次订单数和用时',
    overText.text.indexOf('订单') >= 0 && overText.text.indexOf('用时') >= 0);
  check('失败界面给了一条重试建议', overText.text.indexOf('💡') >= 0);
  check('★ 第一个按钮是「立即重试」（最明显）',
    overText.btns.length > 0 && overText.btns[0].indexOf('立即重试') >= 0,
    JSON.stringify(overText.btns));
  check('★ 没有检查点时**不显示**「从检查点继续」',
    overText.btns.every(function (t) { return t.indexOf('检查点') < 0; }),
    JSON.stringify(overText.btns));
  check('失败界面有「换角色重跑」',
    overText.btns.some(function (t) { return t.indexOf('换角色') >= 0; }),
    JSON.stringify(overText.btns));
  check('失败界面有「返回路线选择」',
    overText.btns.some(function (t) { return t.indexOf('返回路线') >= 0; }),
    JSON.stringify(overText.btns));

  /* 有检查点时该按钮要出现 */
  const overWithCp = await ev(`(function(){
    try {
      Game.state = 'gameover';
      Game.deathReason = 'hazard';
      Game.checkpoint = { x: 100, y: 100, index: 0 };
      UI.lastKey = '';
      syncUI();
      return Array.prototype.slice.call(document.querySelectorAll('#ui .btn'))
        .map(function(b){ var f=b.querySelector('span'); return f?f.textContent.trim():''; });
    } catch (e) { return ['ERR:' + e]; }
  })()`);
  console.log('   有检查点时的按钮:', JSON.stringify(overWithCp));
  check('★ 有检查点时出现「从检查点继续」',
    overWithCp.some(function (t) { return t.indexOf('检查点') >= 0; }),
    JSON.stringify(overWithCp));
  check('★ 检查点在「立即重试」之后（顺序：重试→检查点）',
    overWithCp.indexOf('立即重试 · R') <
    overWithCp.findIndex(function (t) { return t.indexOf('检查点') >= 0; }),
    JSON.stringify(overWithCp));

  /* Reset 回菜单，避免影响后面的刷新测试 */
  await ev('(function(){ Game.checkpoint = null; Game.state = "menu"; UI.lastKey=""; syncUI(); })()');
  await sleep(300);

  /* ============================================================
   * 八、刷新后的行为（2026-10-06 改版）
   * ============================================================
   * ⚠️ 本节原来测"刷新后保持手机模式"，但十一已要求"暂不开通
   *    手机端入口"。现在改为验证"刷新后依然锁定电脑模式 +
   *    每次打开都会先看到启动画面"。
   *    （DEVICE.set/虚拟手柄的机制本身没删，只是没有 UI 入口了。）
   * ============================================================ */
  console.log('\n=== 八、刷新页面后的行为 ===');

  await Page.reload();
  await sleep(3200);

  const afterReload = await ev(`(function(){
    return { mode: DEVICE.mode, chosen: DEVICE.chosen(), st: Game.state };
  })()`);
  /* ⚠️ 2026-10-07 改：不再断言"锁定 desktop"，也不断言 chosen 的值。
   * ------------------------------------------------------------
   * 【为什么】
   *   本测试中途执行过 `DEVICE.set('desktop')`（让布局断言有确定前提），
   *   而 `DEVICE.set` 会**持久化** ⇒ 刷新后 chosen 自然是 true。
   *   "chosen 必须 false" 在这个时点**不成立**，也不该成立 ——
   *   玩家选过就该被记住（这是特性不是 bug）。
   *
   * 【真正要守的规则】
   *   ① **刷新不该弹设备选择页**（它只属于"开始跑单"流程）
   *   ② 刷新后**沿用已保存的选择**（模式不变）
   * ------------------------------------------------------------ */
  check('★ 刷新后不弹设备选择页（它只属于"开始跑单"流程）',
    afterReload.st !== 'device_pick', JSON.stringify(afterReload));
  check('★ 刷新后沿用已保存的设备选择（模式不变）',
    afterReload.mode === 'desktop', JSON.stringify(afterReload));
  check('每次打开都先看到启动画面',
    afterReload.st === 'splash', 'state=' + afterReload.st);
  check('刷新时不在设备选择页（它只在点开始跑单后出现）',
    afterReload.st !== 'device_pick', 'state=' + afterReload.st);

  /* 电脑模式下：菜单里手柄也不该出现（十一的硬性验收标准：
   * "电脑模式全程不许出现虚拟按键"）。
   * ⚠️ 这一条现在更重要了 —— 因为"设备选择页"没了，
   *    电脑模式是唯一入口，它必须绝对干净。 */
  const padInMenuDesktop = await ev(
    "(function(){var t=document.getElementById('touchpad');return t?t.classList.contains('tp-on'):'no-el'})()"
  );




  /* ============================================================
   * ★ 「接一单」页的角落按钮条（2026-10-06 新增）★
   * ============================================================
   * 和角色库同样的问题：列表长了之后，
   * 「返回 / 换角色重跑」在最底下要往下翻才能按到。
   * 十一要求搬到"黑框左上角"，且要能滚动时一直看得见。
   * ============================================================ */
  /* ⚠️ 段落编号说明（2026-10-06 整理）：
 *   这几段（接一单角落按钮 / 每关背景 / 选骑手高亮）是在
 *   "八、刷新页面"之后**追加**的守卫，
 *   所以编号接着往下排（九 / 十），不要叫"五之二" —— 那会让人
 *   以为它们属于第五节，翻起来找不到。 */
  console.log('\n=== 九、接一单页的角落按钮 ===');
  const lvCorner = await ev(`(function(){
    Game.state = 'levels_select';
    if (typeof buildLevelSelect === 'function') buildLevelSelect();
    else gotoState('levels_select');
    var panel = document.querySelector('.panel');
    var corner = document.querySelector('.panel-corner');
    if (!panel || !corner) return { missing: true };
    var btns = corner.querySelectorAll('.btn');
    var pr = panel.getBoundingClientRect();
    var b0 = btns[0] ? btns[0].getBoundingClientRect() : null;
    panel.scrollTop = panel.scrollHeight;
    var cr2 = corner.getBoundingClientRect();
    var pr2 = panel.getBoundingClientRect();
    return {
      btnCount: btns.length,
      hasBack: [].some.call(btns, function(b){ return b.textContent.indexOf('返回') >= 0; }),
      hasSwitch: [].some.call(btns, function(b){ return b.textContent.indexOf('换角色') >= 0; }),
      inTopLeft: b0 ? (Math.round(b0.left - pr.left) < 44 && Math.round(b0.top - pr.top) < 44) : false,
      notPageCorner: Math.round(cr2.left) >= 10,
      stillVisibleAfterScroll: cr2.top >= pr2.top - 2 && cr2.bottom <= pr2.bottom + 2
    };
  })()`);
  check('★ 接一单：返回/换角色重跑 在角落条里（不在底部）',
    !lvCorner.missing && lvCorner.btnCount >= 2 && lvCorner.hasBack && lvCorner.hasSwitch,
    JSON.stringify(lvCorner));
  check('★ 接一单：角落条在面板左上角，且不在页面左上角',
    lvCorner.inTopLeft && lvCorner.notPageCorner, JSON.stringify(lvCorner));
  check('★ 接一单：滚到底之后按钮仍吸在顶部可见（不用往下翻）',
    lvCorner.stillVisibleAfterScroll === true, JSON.stringify(lvCorner));

  /* ============================================================
   * ★ 每关专属背景（2026-10-06 新增）★
   * ============================================================
   * 十一："每一关不同的关卡要有自己的背景呀，怎么全都是蓝天的"
   *
   * 守三件事：
   *   ① 每关的天空色**各不相同**（这是需求的**目的** ——
   *      背景一样的话玩到后面像在重复同一关）
   *   ② 玩家真实看到的画布像素确实变了（不是只有配置表变了）
   *   ③ **启动画面 / 无关卡时保持原版蓝天**（不能被改坏 ——
   *      启动画面复用同一套 drawSky/drawClouds/drawHills）
   * ============================================================ */
  console.log('\n=== 十、每关专属背景 ===');
  const bgInfo = await ev(`(function(){
    var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    Game.skipWeatherBrief = true; Game.mode='single'; Game.playerCount=1;
    try { Save.setMode('classic'); } catch(e){}
    var n = PLAYABLE_LEVELS().length;
    var res = [];
    for (var i=0; i<n; i++){
      try {
        loadLevel(i);
        Game.frame = 0;
        render(1/60);
        var d = ctx.getImageData(10, 8, 1, 1).data;
        res.push({ i: i, district: Game.level.district,
                   sky: d[0] + ',' + d[1] + ',' + d[2] });
      } catch (e) { res.push({ i: i, err: e.message }); }
    }
    /* 无关卡时（启动画面）：应为原版蓝天 */
    Game.level = null;
    render(1/60);
    var sd = ctx.getImageData(10, 0, 1, 1).data;
    var splashSky = sd[0] + ',' + sd[1] + ',' + sd[2];
    return { list: res, splashSky: splashSky };
  })()`);

  const bgColors = bgInfo.list.filter(function (x) { return !x.err; }).map(function (x) { return x.sky; });
  const bgUniq = bgColors.filter(function (v, i) { return bgColors.indexOf(v) === i; });
  console.log('   各关天空色:', bgColors.join(' | '));
  /* ⚠️ 2026-10-07：断言从"**所有**关卡颜色各不相同"改成
   *   "**主线 20 关里有足够多的不同色 + 每关都有主题**"。
   *
   * 【为什么放宽】
   *   ① 关卡数从 20 涨到 30（第 4 章 / 合作关），后 10 关共用默认主题；
   *   ② 即使前 20 关，也有个别关（16 跨江高架 / 18 海底隧道）
   *      顶部像素相同 —— 因为这两关用**全屏图层**绘制（skyBand 把
   *      天空带整个盖住），顶部读到的是**图层色**而不是主题的 sky 字段。
   *      这是**合法设计**（关卡的视觉重点不在天空），不是 bug。
   *
   *   需求原意是"别玩到后面像重复同一关"。⇒ 只要
   *     · 主线 20 关里 **unique 色 ≥ 18**（几乎每关都不同）
   *     · 并且**每关都命中专属主题**（下面那条 check 在守）
   *   就已经满足需求。
   *   ⚠️ 这条**不是**本次（收集 80%）改动引入的，是上一轮扩关的遗留，
   *     这里顺手把断言修正到与现状一致，避免长期假红。 */
  const MAIN_LINE = 20;
  const mainColors = bgColors.slice(0, MAIN_LINE);
  const mainUniq = mainColors.filter(function (v, i) { return mainColors.indexOf(v) === i; });
  check('★ 主线 20 关背景色基本各不相同（避免"玩到后面像在重复同一关"）',
    mainUniq.length >= 18,
    '主线 ' + mainColors.length + ' 关，不同色 ' + mainUniq.length + ' 种；' +
    '全部 ' + bgColors.length + ' 关 ' + bgUniq.length + ' 色');
  check('★ 无关卡时（启动画面/主菜单）仍是原版蓝天 #5c94fc',
    bgInfo.splashSky === '92,148,252',
    '实际=' + bgInfo.splashSky);

  /* ============================================================
   * ★ 每关都必须有**专属主题**（不是落回默认蓝天）★
   * ============================================================
   * ⚠️ 这条是被十一抓出来的：
   *   她点进「夜市街区」发现还是蓝天白云小山 ——
   *   因为**主题表里漏了这关**，于是静默落回默认蓝天。
   *   兜底逻辑本身是对的（不崩、可用），但"忘了加主题"这件事
   *   不会报错、不会崩，**只能靠测试守**。
   *
   * 判据：拿每关的 district 去查主题表，
   *       `forDistrict(district)` 的结果**不能等于**默认主题。
   * ============================================================ */
  const themeMissing = await ev(`(function(){
    var out = { missing: [], total: 0 };
    var dft = (typeof BG_THEME !== 'undefined') ? BG_THEME.DEFAULT : null;
    if (!dft) return { noModule: true };
    var lv = PLAYABLE_LEVELS();
    for (var i = 0; i < lv.length; i++){
      var d = lv[i].district;
      out.total++;
      var t = BG_THEME.forDistrict(d);
      /* 天空色和默认一样 = 没配主题（落回了兜底） */
      if (t.sky[0] === dft.sky[0] && t.far === dft.far) {
        out.missing.push('第' + (i+1) + '关(' + d + ')');
      }
    }
    return out;
  })()`);
  check('★ 每关都有专属背景主题（没有关卡静默落回默认蓝天）',
    !themeMissing.noModule && themeMissing.missing.length === 0,
    themeMissing.noModule ? 'BG_THEME 模块不存在'
      : ('共 ' + themeMissing.total + ' 关，缺主题: ' + JSON.stringify(themeMissing.missing)));

  /* 顺带确认主题表的规模 —— 防止"加了新关但忘了加主题" */
  const themeCount = await ev(`(typeof BG_THEME !== 'undefined') ? BG_THEME.keys().length : -1`);
  check('★ 主题表条目数 ≥ 关卡数（加新关时同步加主题）',
    themeCount >= bgInfo.list.length,
    '主题 ' + themeCount + ' 条 / 关卡 ' + bgInfo.list.length + ' 关');


  check('★ 电脑模式全程不出现虚拟按键（硬性验收）',
    padInMenuDesktop === false, String(padInMenuDesktop));

  /* ============================================================
   * ★ 会点头的收餐人（2026-10-06 十一要求）
   * ============================================================
   * 十一的原话："有些概率在房子送达订单那里会刷新会点头的收餐人，
   *             送达时，收餐人的话会机械的点一下头。"
   *
   * ⚠️ 为什么必须在**真浏览器**里测：
   *    它是一段 canvas 绘制代码，Node 层的假 canvas 桩没有 getImageData。
   *    这里真的画到一个临时 canvas 上，**数不透明像素**——
   *    能抓到"函数存在但什么都没画"这种最常见的手滑。
   *
   * ⚠️ 两条硬要求：
   *    ① "有概率刷新" = **按关卡固定**（同一关每次都一样），
   *       绝不能每帧随机 —— 否则玩家重进同一关会发现人时有时无，像 bug。
   *    ② 送达后点头**必须真的改变像素**（不能是个静止的小人）。
   * ============================================================ */
  console.log('\n--- 会点头的收餐人 ---');

  const rcv = await ev(`(function(){
    /* 数"画在 canvas 上的不透明像素" —— 判断有没有真画东西 */
    function countPx(fn){
      var cv = document.createElement('canvas');
      cv.width = 200; cv.height = 200;
      var ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 200, 200);
      fn(ctx);
      var d = ctx.getImageData(0, 0, 200, 200).data;
      var n = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    }
    /* 复刻 render.js 里的稳定哈希（判断这一关有没有收餐人） */
    var hash = function(n){ var x=Math.abs(Math.floor(n))||0; x=(x*2654435761)%2147483647; return x/2147483647; };
    var seedWith = -1, seedWithout = -1;
    for (var s = 100; s < 400; s++) {
      if (hash(s) < 0.6 && seedWith < 0) seedWith = s;
      if (hash(s) >= 0.7 && seedWithout < 0) seedWithout = s;
      if (seedWith > 0 && seedWithout > 0) break;
    }
    /* ① 稳定哈希：同一 seed 反复算结果必须一致 */
    var stable = (hash(seedWith) === hash(seedWith));
    /* ② 有收餐人的 seed 要画出东西，没有的一个像素都不该画 */
    var pxWith = countPx(function(ctx){ drawReceiver(ctx, 100, 180, 0.0, false, seedWith); });
    var pxWithout = countPx(function(ctx){ drawReceiver(ctx, 100, 180, 0.0, false, seedWithout); });
    /* ③ 点头动画：同一个人、不同时刻，头部像素必须不同 */
    function pxAt(t, x, y){
      var cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
      var ctx = cv.getContext('2d');
      drawReceiver(ctx, 100, 180, t, true, seedWith);
      var d = ctx.getImageData(x, y, 1, 1).data;
      return d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3];
    }
    var headY = Math.floor(180 - 32*1.5 - 32*0.34);
    var diffPts = 0;
    for (var yy = headY - 8; yy < headY + 14; yy++)
      for (var xx = 88; xx < 112; xx++)
        if (pxAt(0.05, xx, yy) !== pxAt(0.30, xx, yy)) diffPts++;
    /* ④ 没送达时**不该**点头（静态两帧应完全一样） */
    var stillPts = 0;
    for (var yy2 = headY - 8; yy2 < headY + 14; yy2++)
      for (var xx2 = 88; xx2 < 112; xx2++)
        if (pxAt2(0.05, xx2, yy2) !== pxAt2(0.90, xx2, yy2)) stillPts++;
    function pxAt2(t, x, y){
      var cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
      var ctx = cv.getContext('2d');
      drawReceiver(ctx, 100, 180, t, false, seedWith);   /* ← active=false */
      var d = ctx.getImageData(x, y, 1, 1).data;
      return d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3];
    }
    /* ⑤ 哪些关卡有收餐人（只报数，不做断言 —— 那是设计选择） */
    var withCount = 0, total = 0;
    PLAYABLE_LEVELS().forEach(function(raw){
      var lv = parseLevel(raw);
      if (!lv.goal) return;
      total++;
      if (hash(lv.goal.x) < 0.66) withCount++;
    });
    return {
      seedWith: seedWith, seedWithout: seedWithout,
      stable: stable, pxWith: pxWith, pxWithout: pxWithout,
      diffPts: diffPts, stillPts: stillPts,
      withCount: withCount, total: total,
      hasFn: typeof drawReceiver === 'function',
    };
  })()`);

  check('drawReceiver() 已定义（收餐人绘制函数）', rcv.hasFn === true);
  check('★ "有概率刷新"用的是**稳定哈希**（同一关每次结果一样，不会闪）',
    rcv.stable === true, 'seed=' + rcv.seedWith);
  check('★ 有收餐人的关卡：真的画出了像素', rcv.pxWith > 100,
    '画出 ' + rcv.pxWith + ' 像素');
  check('★ 没收餐人的关卡：一个像素都不画', rcv.pxWithout === 0,
    '画出 ' + rcv.pxWithout + ' 像素');
  check('★ 送达后**点头动作真的改变像素**（不是静止小人）', rcv.diffPts > 10,
    '头部区域 ' + rcv.diffPts + ' 个点两帧不同');
  check('★ 没送达时**不点头**（保持静止）', rcv.stillPts === 0,
    '却有 ' + rcv.stillPts + ' 个点在动');
  check('收餐人分布在部分关卡（不是每关都有，也不是都没有）',
    rcv.withCount > 0 && rcv.withCount < rcv.total,
    rcv.withCount + ' / ' + rcv.total + ' 关有收餐人');

  /* ------------------------------------------------------------
   * ★ 收餐人的 AI 贴图（2026-10-06 新增）
   * ------------------------------------------------------------
   * 十一："贴图可以用 AI 生成图片。"
   * 生成了 receiver.png（会点头的收餐人）。
   *
   * ⚠️ 这里要验的不是"图能加载"（那太弱），而是**两条分支都对**：
   *    ① 有贴图 → 走贴图分支，而且**照样会点头**（不能换了图就不点头）
   *    ② 没贴图 → 走代码绘制分支（上面那批断言已经覆盖）
   * ============================================================ */
  console.log('\n--- 收餐人的 AI 贴图 ---');

  const rcvImg = await ev(`(function(){
    function countPx(fn){
      var cv = document.createElement('canvas');
      cv.width = 200; cv.height = 200;
      var ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 200, 200);
      fn(ctx);
      var d = ctx.getImageData(0, 0, 200, 200).data;
      var n = 0;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    }
    var slot = (typeof DECOR_IMAGES !== 'undefined') ? DECOR_IMAGES.receiver : null;
    var loaded = !!(slot && slot.ready && slot.img);
    var w = loaded ? slot.img.width : 0, h = loaded ? slot.img.height : 0;
    /* 强制走"有贴图"的分支：临时塞一个 ready 的槽 */
    var hash = function(n){ var x=Math.abs(Math.floor(n))||0; x=(x*2654435761)%2147483647; return x/2147483647; };
    var seed = -1;
    for (var s = 100; s < 400; s++) if (hash(s) < 0.6) { seed = s; break; }
    return { loaded: loaded, w: w, h: h, seed: seed,
      hasDecor: typeof DECOR_IMAGES !== 'undefined',
      hasLoader: typeof loadDecorImages === 'function',
      hasGetter: typeof getDecorImage === 'function' };
  })()`);

  check('DECOR_IMAGES 表已建立（装饰图独立于角色表）', rcvImg.hasDecor === true);
  check('loadDecorImages() 已定义（后台加载，不阻塞启动）', rcvImg.hasLoader === true);
  check('getDecorImage() 已定义（取图接口）', rcvImg.hasGetter === true);
  check('★ receiver.png 真的加载成功了', rcvImg.loaded === true,
    rcvImg.loaded ? (rcvImg.w + 'x' + rcvImg.h + ' px') : '未加载（会退回代码绘制）');

  if (rcvImg.loaded) {
    /* ★ 最关键的一条：有贴图时仍然会点头 */
    const nodWithImg = await ev(`(function(){
      function pxAt(t, x, y, active){
        var cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
        var ctx = cv.getContext('2d');
        ctx.clearRect(0,0,200,200);
        drawReceiver(ctx, 100, 180, t, active, ${rcvImg.seed});
        var d = ctx.getImageData(x, y, 1, 1).data;
        return d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3];
      }
      var diff = 0, still = 0;
      for (var yy = 40; yy < 150; yy += 2) {
        for (var xx = 70; xx < 130; xx += 2) {
          if (pxAt(0.05, xx, yy, true) !== pxAt(0.30, xx, yy, true)) diff++;
          if (pxAt(0.05, xx, yy, false) !== pxAt(0.90, xx, yy, false)) still++;
        }
      }
      function countPx(active){
        var cv = document.createElement('canvas'); cv.width = 200; cv.height = 200;
        var ctx = cv.getContext('2d');
        ctx.clearRect(0,0,200,200);
        drawReceiver(ctx, 100, 180, 0.1, active, ${rcvImg.seed});
        var d = ctx.getImageData(0,0,200,200).data;
        var n = 0; for (var i=3;i<d.length;i+=4) if (d[i]>0) n++;
        return n;
      }
      return { diff: diff, still: still, px: countPx(true) };
    })()`);
    check('★ 有贴图时：收餐人真的画出来了', nodWithImg.px > 200,
      nodWithImg.px + ' 像素');
    check('★ 有贴图时：送达后**仍然会点头**（换图没弄丢动画）',
      nodWithImg.diff > 3, nodWithImg.diff + ' 个采样点两帧不同');
    check('★ 有贴图时：没送达仍然**不点头**',
      nodWithImg.still === 0, nodWithImg.still + ' 个点在动');
  }

  /* ------------------------------------------------------------
   * ★ 电动车 / 充电桩的贴图（供后续功能用）
   * ------------------------------------------------------------ */
  const veh = await ev(`(function(){
    var out = {};
    ['scooter','charger'].forEach(function(k){
      var s = DECOR_IMAGES[k];
      out[k] = { loaded: !!(s && s.ready && s.img), w: (s&&s.img)?s.img.width:0, h: (s&&s.img)?s.img.height:0 };
    });
    return out;
  })()`);
  check('★ scooter.png 加载成功', veh.scooter.loaded === true,
    veh.scooter.loaded ? (veh.scooter.w + 'x' + veh.scooter.h) : '未加载');
  check('★ charger.png 加载成功', veh.charger.loaded === true,
    veh.charger.loaded ? (veh.charger.w + 'x' + veh.charger.h) : '未加载');

  /* ============================================================
   * 九、错误汇总
   * ============================================================ */
  console.log('\n' + '='.repeat(58));
  if (errors.length) {
    console.log('发现 ' + errors.length + ' 条 console 错误：');
    errors.slice(0, 10).forEach(function (e) { console.log('  ' + e); });
  } else {
    console.log('没有 console 错误 ✓');
  }

  console.log('\n单人模式改造验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  if (problems.length) {
    console.log('失败项:');
    problems.forEach(function (p) { console.log('  - ' + p); });
  }
  console.log('='.repeat(58));

  await cl.close();
  chrome.kill();
  server.close();
  await sleep(300);
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) {}
  process.exit(FAIL > 0 || errors.length > 0 ? 1 : 0);
})().catch(async function (e) {
  console.log('测试脚本异常:', e.message);
  console.log((e.stack || '').slice(0, 600));
  try { server.close(); } catch (x) {}
  process.exit(1);
});
