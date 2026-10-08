/* ============================================================
 * 按键说明页 · 真浏览器验证
 * ============================================================
 * 为什么必须用浏览器：说明页是纯 DOM（不是 canvas 画的），
 * 只有真实浏览器才能验证：
 *   · 主菜单真的有入口按钮
 *   · 点进去能渲染出各节内容（3 节 + 9 行 + 冲刺详解）
 *   · 返回能回主菜单
 *   · 面板能滚动（内容比屏幕长）
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
const PORT = 8941;

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
  else { FAIL++; problems.push(name); console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}

(async function () {
  await new Promise(function (r) { server.listen(PORT, '127.0.0.1', r); });

  const ud = path.join(require('os').tmpdir(), 'help-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=9411', '--user-data-dir=' + ud,
    '--window-size=1280,900', URL,
  ], { stdio: 'ignore' });

  let cl;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { cl = await CDP({ port: 9411 }); break; } catch (e) {}
  }
  try {
    const ts = await CDP.List({ port: 9411 });
    const w = ts.filter(function (t) { return t.type === 'page'; })
      .find(function (t) { return t.url && t.url.indexOf('index.html') >= 0; });
    if (w && w.id !== cl._targetId) { await cl.close(); cl = await CDP({ port: 9411, target: w.id }); }
  } catch (e) {}

  const { Runtime } = cl;
  await Runtime.enable();

  async function ev(expr) {
    const r = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    }
    return r.result.value;
  }

  await sleep(3200);

  console.log('按键说明页 · 真浏览器验证');
  console.log('='.repeat(58));

  /* ------------------------------------------------------------
   * 0. ★先过启动画面（2026-10-06 改版）★
   * ------------------------------------------------------------
   * 2026-10-06 起首次打开会停在「启动画面」（第十一单外卖），
   * 点一下才进主菜单（这个测试用的是全新 profile，每次都是首次打开）。
   *
   * ⚠️ 历史说明：这里原来测的是"设备选择页"（电脑/手机二选一），
   *    但十一已要求"移除电脑/手机选择页，暂不开通手机端入口"，
   *    所以第一屏换成了启动画面，本节也随之改成点启动画面。
   * ------------------------------------------------------------ */
  const st0 = await ev('Game.state');
  if (st0 === 'splash') {
    console.log('\n=== 0. 启动画面（首次打开）===');
    const rSp = await ev(`(function(){
      var s = document.getElementById('splash');
      if (!s) return 'no-splash';
      s.click();
      return 'clicked';
    })()`);
    await sleep(400);
    const stSp = await ev('Game.state');
    console.log('   点启动画面: ' + rSp + ' → state = ' + stSp);
    check('启动画面能点进主菜单', stSp === 'menu', 'state = ' + stSp);
  } else {
    console.log('\n=== 0. 跳过启动画面（state=' + st0 + '）===');
  }

  /* ------------------------------------------------------------
   * 1. 设置页入口（2026-10-06 从主菜单迁移过来）
   * ------------------------------------------------------------
   * 十一第 1 条要求："将『按键说明』从初始页面迁移至『设置』页面中，
   * 作为设置项之一统一展示，不再在主流程中以其他形式单独出现。"
   *
   * 所以这里要验**两件事**：
   *   · 主菜单【不再】有"按键说明"按钮（迁移走了）
   *   · 设置页【有】"按键说明"入口
   * ------------------------------------------------------------ */
  console.log('\n=== 1. 入口位置（设置页，不在主菜单）===');
  /* ⚠️ 判定要用**按钮主文案**（第一个 span），不能用整个 textContent：
   *    "设置"按钮的说明里含"按键说明"四个字（因为它确实是设置项之一），
   *    用 textContent 判断会误报"主菜单还有按键说明入口"。
   *    这个坑和 single-player-browser-test 里记的是同一个。 */
  const menuLabels = await ev(`(function(){
    return Array.prototype.slice.call(document.querySelectorAll('#ui .btn')).map(function(b){
      var f = b.querySelector('span');
      return f ? f.textContent.trim() : b.textContent.trim();
    });
  })()`);
  console.log('   主菜单按钮: ' + JSON.stringify(menuLabels));

  /* ★ 2026-10-06 调整（十一第 1 条 + 第 3 条）★
   * 十一本轮把要求细化了：
   *   "将『设置』『按键说明』移至左上角，
   *    中间主区域只保留『开始跑单』『选择路线』『角色库』等核心入口"
   *
   * 所以现在的正确状态是：
   *   · 主菜单**保留**「按键说明」按钮，但它属于**左上角工具条**
   *     （和「设置」并排、字体更小、不占中间通道）
   *   · 设置页**同时**有「按键说明」设置项（两处指向同一个页面）
   *   · **中间主区域只应该有 3 个核心入口**
   *
   * 原来这条断言写的是"主菜单不再有按键说明"（上一轮的简化版），
   * 现在按十一的最新要求改成"它在角落里、且中间区域干净"。 */
  const menuLayout = await ev(`(function(){
    var corner = document.querySelector('.menu-corner');
    var panel = document.querySelector('.panel.menu-fit');
    function labels(root){
      if(!root) return [];
      return Array.prototype.slice.call(root.querySelectorAll('.btn')).map(function(b){
        var f=b.querySelector('span'); return f?f.textContent.trim():b.textContent.trim();
      });
    }
    return { corner: labels(corner), center: labels(panel) };
  })()`);
  console.log('   左上角工具条: ' + JSON.stringify(menuLayout.corner));
  console.log('   中间主区域  : ' + JSON.stringify(menuLayout.center));

  check('★ 「按键说明」在左上角工具条里',
    menuLayout.corner.some(function (t) { return t.indexOf('按键说明') >= 0; }),
    JSON.stringify(menuLayout.corner));
  check('★ 「设置」也在左上角工具条里',
    menuLayout.corner.some(function (t) { return t === '设置'; }),
    JSON.stringify(menuLayout.corner));
  /* ★ 2026-10-06 更新：中间主区域现在是 **4 个**入口 ★
   * 十一要求"那个其他模式，还是放在中间吧，跟这个开始跑单放在一起，
   * 放在这个底下" —— 所以「其他模式」从右下角挪回了中间。
   *
   * 顺序也一并断言（十一明确说的是"放在开始跑单底下"），
   * 所以是：开始跑单 → 选择路线 → 角色库 → 其他模式。 */
  check('★ 中间主区域有 4 个入口（其他模式已挪回中间）',
    menuLayout.center.length === 4,
    '实际 ' + menuLayout.center.length + ' 个: ' + JSON.stringify(menuLayout.center));
  check('★ 中间主区域包含 开始跑单/选择路线/角色库/其他模式',
    menuLayout.center.some(function (t) { return t.indexOf('开始跑单') >= 0; }) &&
    menuLayout.center.some(function (t) { return t.indexOf('选择路线') >= 0; }) &&
    menuLayout.center.some(function (t) { return t.indexOf('角色库') >= 0; }) &&
    menuLayout.center.some(function (t) { return t.indexOf('其他模式') >= 0; }),
    JSON.stringify(menuLayout.center));
  check('★ 「其他模式」排在「开始跑单」后面（十一要求放它底下）',
    menuLayout.center.indexOf('其他模式（开发中）') > 0,
    JSON.stringify(menuLayout.center));

  /* ============================================================
   * 1.4 ★ 主菜单必须是"黑色像素面板框"（2026-10-06 十一要求）★
   * ============================================================
   * 十一原话："我要改回老版的样子：**按钮组装在一个黑色的像素风面板框里**。"
   *
   * 这一条专门守"别再被改回透明外壳"——
   * 因为在它之前有一轮把它改成了 `background:transparent / border:none`，
   * 现在**恢复成继承 .panel 的黑底 + 双层硬边框**。
   *
   * ⚠️ 用 computedStyle 查**实际生效的**背景和边框，而不是查 CSS 源码 ——
   *    源码里可能有覆盖规则，只有 computed 才是玩家真正看到的。 */
  const menuFrame = await ev(`(function(){
    var p = document.querySelector('.panel.menu-fit');
    if (!p) return null;
    var cs = getComputedStyle(p);
    return {
      bg: cs.backgroundColor,
      borderW: parseFloat(cs.borderTopWidth) || 0,
      shadow: cs.boxShadow
    };
  })()`);
  check('★ 主菜单是黑框面板（背景不透明）',
    menuFrame && menuFrame.bg !== 'rgba(0, 0, 0, 0)' &&
    menuFrame.bg !== 'transparent',
    '背景=' + (menuFrame && menuFrame.bg));
  check('★ 主菜单有像素硬边框（≥2px）',
    menuFrame && menuFrame.borderW >= 2,
    '边框=' + (menuFrame && menuFrame.borderW) + 'px');
  check('★ 主菜单有双层投影（面板外的深色描边）',
    menuFrame && menuFrame.shadow && menuFrame.shadow !== 'none',
    '投影=' + (menuFrame && menuFrame.shadow));

  /* ============================================================
   * 1.5 ★ 主菜单标题与品牌栏：不能重复、不能互相遮挡 ★
   * ============================================================
   * 【为什么这里查的东西变过】
   *   ① 十一先说"把开始跑单上面那很小的『美团专送骑手版』删去"
   *   ② 后来澄清："主菜单顶部**不要**删掉「美团专送 · 骑手版」小字，
   *      包括主菜单旁边的飞龙宝宝也不要删，主菜单改回去，
   *      删去**下面一行**美团专送骑手版就好了。"
   *   ③ 最后又提出："主菜单那几行黑底栏目往下面移，不要挡住上面的标题。"
   *
   * 【查出来的真问题】
   *   菜单页上标题**画了两遍**，两层叠在一起：
   *     · canvas 层（render.js 的 drawMenuBackdrop）
   *       品牌栏 + 66px 大标题 + 副标题
   *     · HTML 层（.panel.menu-fit 里）
   *       .brand + <h1> + .sub
   *   HTML 那个 .brand 深色块正好压在 canvas 大标题上 ——
   *   这就是十一看到的"黑底栏目挡住标题"。
   *
   * 【现在的正确状态】
   *   · HTML 层**不再有** .brand / h1 / .sub（标题交给 canvas 独占）
   *   · canvas 层保留品牌栏（含「美团专送 · 骑手版」）
   *   · 按钮组用 padding-top 往下推，和 canvas 标题拉开 ≥15px
   *
   * ⚠️ 这条要用**元素级**检查，不能用 document.body.textContent 搜文字 ——
   *    canvas 里画的内容 textContent 搜不到；而且别的界面标题里
   *    也可能出现"美团专送"。
   */
  const brandInfo = await ev(`(function(){
    var p = document.querySelector('.panel.menu-fit');
    return {
      /* HTML 层不该再有标题/品牌栏（避免和 canvas 层重复叠字） */
      htmlBrand: !!(p && p.querySelector('.brand')),
      htmlH1: !!(p && p.querySelector('h1')),
      htmlSub: !!(p && p.querySelector('.sub')),
      /* 按钮组要还在 */
      btnCount: p ? p.querySelectorAll('.btn').length : 0
    };
  })()`);
  check('★ 主菜单 HTML 层不再重复画标题/品牌栏（避免遮挡 canvas 标题）',
    brandInfo.htmlBrand === false && brandInfo.htmlH1 === false &&
    brandInfo.htmlSub === false,
    JSON.stringify(brandInfo));
  check('★ 主菜单按钮组还在（4 个入口）',
    brandInfo.btnCount === 4, '实际 ' + brandInfo.btnCount + ' 个');
  check('★ canvas 层的品牌栏仍在绘制（保留「美团专送 · 骑手版」）',
    (await ev('typeof drawMenuBackdrop === "function"')) === true,
    'drawMenuBackdrop 应存在');
  check('★ 主菜单底部「设备模式 · 当前骑手」那一行已删掉',
    (await ev('!!document.querySelector(".panel.menu-fit .menu-info")')) === false,
    'menu-info 应不存在');

  /* 先点「设置」进设置页 */
  const openSet = await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){
      var f = x.querySelector('span');
      return f && f.textContent.trim() === '设置';
    })[0];
    if (!b) return 'not-found';
    b.click();
    return 'clicked';
  })()`);
  await sleep(400);
  const stSet = await ev('Game.state');
  console.log('   点设置: ' + openSet + ' → state = ' + stSet);
  check('能进入设置页', stSet === 'settings', 'state = ' + stSet);

  const setText = await ev('document.getElementById("ui").textContent');
  check('★ 设置页有「按键说明」设置项', setText.indexOf('按键说明') >= 0,
    setText.slice(0, 120));

  /* ------------------------------------------------------------
   * 2. 点进去能渲染
   * ------------------------------------------------------------ */
  console.log('\n=== 2. 点开说明页 ===');
  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){
      var f = x.querySelector('span');
      return f && f.textContent.trim() === '按键说明';
    })[0];
    if (b) b.click();
    return true;
  })()`);
  await sleep(500);

  const helpState = await ev(`(function(){
    return {
      state: Game.state,
      hasBox: !!document.querySelector('.help-box'),
      title: (document.querySelector('.help-title') || {}).textContent || '',
      sections: document.querySelectorAll('.help-sec').length,
      rows: document.querySelectorAll('.help-row').length,
      icons: document.querySelectorAll('.hr-icon').length,
      dashBox: !!document.querySelector('.help-dash'),
      diagram: !!document.querySelector('.hd-diagram'),
      steps: document.querySelectorAll('.hd-step').length,
    };
  })()`);
  console.log('   ' + JSON.stringify(helpState));

  check('状态切到 HELP', helpState.state === 'help', helpState.state);
  check('说明面板已渲染', helpState.hasBox === true);
  check('标题是「按键说明」', helpState.title === '按键说明', helpState.title);
  check('分了 3 节', helpState.sections === 3, helpState.sections + ' 节');
  check('有 7 条动作说明', helpState.rows === 7, helpState.rows + ' 条');
  check('每条都有图标 canvas', helpState.icons === helpState.rows,
    helpState.icons + ' / ' + helpState.rows);
  check('有冲刺详解区', helpState.dashBox === true);
  check('有八方向示意图', helpState.diagram === true);
  check('冲刺步骤是 3 步', helpState.steps === 3, helpState.steps + ' 步');

  /* ------------------------------------------------------------
   * 3. 关键文案检查（提醒用户"冲刺怎么按"必须写清）
   * ------------------------------------------------------------ */
  console.log('\n=== 3. 关键文案 ===');
  /* ⚠️ 加空值兜底 —— 如果说明页没渲染出来（比如跑测试时状态被前面
   *    的用例带偏了），.help-box 会是 null，直接 .textContent 会抛
   *    "TypeError: Cannot read properties of null"，
   *    整个测试脚本当场崩掉、后面的断言全看不到（排查体验极差）。
   *    这里退化成空字符串，让断言正常报"找不到 XX"而不是崩。 */
  const text = await ev(
    '(function(){var b=document.querySelector(".help-box");return b?b.textContent:""})()'
  );
  const mustHave = [
    /* ★ 2026-10-07 修：冲刺键已从 Shift 改成 F（见 actions.js 的 DASH_KEYS_BASE），
     *   帮助页文案也跟着改成了「按住 F 键」⇒ 这里再找 "Shift" 就永远找不到。
     *   ⚠️ 改键位时**这里要跟着改**（或改成从 ACTIONS.DASH_KEYS 反查，
     *      但那是 KeyF 这种 code 名，文案里写的是 "F"，映射不直接，
     *      所以这里保留字面量并加注释提醒）。 */
    /* ★ 检查具体短语而不是单个字母 "F"（那太容易误命中） */
    ['提到冲刺键 F', 'F 键'],
    ['提到八方/八个方向', '八个方向'],
    ['提到空中限 1 次', '落地'],
    ['提到墙跳', '墙跳'],
    ['提到抓墙体力', '体力'],
  ];
  mustHave.forEach(function (pair) {
    check('说明里' + pair[0], text.indexOf(pair[1]) >= 0,
      '找不到「' + pair[1] + '」');
  });

  /* ------------------------------------------------------------
   * 3.5 ★ 未解锁的动作要显示成"锁着" ★
   * ------------------------------------------------------------
   * 这是"逐步解锁"系统的重要配套：
   * 如果玩家看到自己还不会的动作的操作说明，按了没反应，
   * 会以为是 bug。所以未解锁的必须**视觉上就区分开**。
   * ------------------------------------------------------------ */
  console.log('\n=== 3.5 解锁状态在说明页的体现 ===');

  /* 先看"全解锁"状态 */
  await ev(`(function(){
    Save.load();
    Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];
    gotoState(STATE.HELP);
  })()`);
  await sleep(300);
  const allUnlocked = await ev(`(function(){
    return {
      lockedRows: document.querySelectorAll('.help-row.locked').length,
      lockedTags: document.querySelectorAll('.hr-locked-tag').length,
    };
  })()`);
  console.log('   全解锁时：锁着的行 ' + allUnlocked.lockedRows + ' 个');
  check('全解锁时没有锁着的行',
    allUnlocked.lockedRows === 0 && allUnlocked.lockedTags === 0,
    JSON.stringify(allUnlocked));

  /* 再看"全新档"状态 —— 进阶动作应全部显示为锁着 */
  await ev(`(function(){
    Save.reset();
    gotoState(STATE.HELP);
  })()`);
  await sleep(300);
  const freshArchive = await ev(`(function(){
    var locked = Array.prototype.slice.call(document.querySelectorAll('.help-row.locked'));
    return {
      lockedRows: locked.length,
      lockedTags: document.querySelectorAll('.hr-locked-tag').length,
      tagTexts: Array.prototype.slice.call(document.querySelectorAll('.hr-locked-tag'))
        .map(function(t){ return t.textContent; }),
      lockedTitles: locked.map(function(r){
        return (r.querySelector('.hr-title') || {}).textContent || '';
      }),
    };
  })()`);
  console.log('   新档时：锁着的行 ' + freshArchive.lockedRows + ' 个');
  console.log('   标签文案: ' + JSON.stringify(freshArchive.tagTexts));
  check('新档时进阶动作显示为锁着',
    freshArchive.lockedRows >= 4, freshArchive.lockedRows + ' 个');
  check('锁着的行带「通关第 N 关解锁」标签',
    freshArchive.tagTexts.length > 0 &&
    freshArchive.tagTexts[0].indexOf('通关第') >= 0,
    JSON.stringify(freshArchive.tagTexts));
  check('基础操作（移动/暂停）不受锁影响',
    freshArchive.lockedTitles.indexOf('左右移动') < 0 &&
    freshArchive.lockedTitles.indexOf('暂停 / 重开') < 0,
    JSON.stringify(freshArchive.lockedTitles));
  check('冲刺在新档时是锁着的',
    freshArchive.lockedTitles.indexOf('八方冲刺 ★') >= 0,
    JSON.stringify(freshArchive.lockedTitles));

  /* ------------------------------------------------------------
   * 4. 面板可滚动（内容比屏幕长）
   * ------------------------------------------------------------ */
  console.log('\n=== 4. 滚动 ===');
  const scroll = await ev(`(function(){
    var b = document.querySelector('.help-box');
    return { scrollH: b.scrollHeight, clientH: b.clientHeight, canScroll: b.scrollHeight > b.clientHeight };
  })()`);
  console.log('   内容高 ' + scroll.scrollH + 'px，可视高 ' + scroll.clientH + 'px');
  check('说明面板可以滚动', scroll.canScroll === true,
    scroll.scrollH + ' vs ' + scroll.clientH);

  /* ------------------------------------------------------------
   * 5. 返回主菜单
   * ------------------------------------------------------------ */
  console.log('\n=== 5. 返回 ===');
  await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    var b = btns.filter(function(x){ return x.textContent.indexOf('返回主菜单') >= 0; })[0];
    if (b) b.click();
    return true;
  })()`);
  await sleep(500);
  const back = await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('#ui .btn'));
    return {
      state: Game.state,
      /* ⚠️ 2026-10-06：主按钮文案从「开始接单（单人）」改成了「开始跑单」
       *    （十一要求"默认主按钮必须是：开始跑单"）。
       *    这里用"跑单"匹配，同时兼容旧的"接单"写法，
       *    以后再改文案也不会又断一次。 */
      isMenu: btns.some(function(b){
        return b.textContent.indexOf('开始跑单') >= 0 ||
               b.textContent.indexOf('开始接单') >= 0;
      })
    };
  })()`);
  check('返回后回到主菜单', back.state === 'menu' && back.isMenu === true,
    JSON.stringify(back));

  /* ------------------------------------------------------------
   * 6. 不影响游戏（点完说明还能正常开局）
   * ------------------------------------------------------------ */
  console.log('\n=== 6. 不影响游玩 ===');
  const canPlay = await ev(`(function(){
    try {
      Game.mode='local'; Game.playerCount=1; Game.pickRole='kangaroo';
      loadLevel(0); Game.state='playing';
      for (var i=0;i<10;i++){ InputState.now={}; update(1/60); InputState.tick(); }
      return { ok: true, frame: Game.frame, state: Game.state };
    } catch (e) { return { ok: false, err: String(e) }; }
  })()`);
  check('看过说明后游戏照常能跑', canPlay.ok === true, JSON.stringify(canPlay));

  /* ------------------------------------------------------------
   * 7. 教学提示在真实帧循环里能触发
   * ------------------------------------------------------------ */
  console.log('\n=== 7. 教学提示实跑 ===');
  /* ⚠️ 2026-10-06 更新：二连跳提示现在【要求已解锁】才会出现。
   *    这个测试用的是全新 profile（新档 = 没有二连跳），
   *    所以必须先解锁 doublejump，这条断言才有意义 ——
   *    否则测的其实是"正确的不提示"，会误判成 bug。
   *    这正对应十一的反馈："第一关还没解锁二连跳，
   *    却提示玩家用二连跳" —— 现在被修掉了，这里也顺手验一下。 */
  const tut = await ev(`(function(){
    try {
      Save.load();
      /* 先验证"新档（未解锁）时不提示二连跳" */
      Save.data.unlockedActions = [];
      Game.state='playing';
      Game.levelIndex = 0;
      Game.tutorial = null;               // 强制重建
      updateTutorial(1/60);
      var p = Game.players[0];
      p.onGround = false; p.vy = -5; p.jumpsLeft = 1;
      p.actWallDir = 0; p.actDashT = 0; p.actDashes = CELESTE.dashMaxCount;
      Game.message = ''; Game.messageTimer = 0;
      Game.tutorial.seen = {};
      updateTutorial(1/60);
      var lockedSeen = Object.keys(Game.tutorial.seen);
      var lockedMsg = Game.message;

      /* 再解锁二连跳，同样操作 → 这次必须提示 */
      Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];
      Game.tutorial = null;
      updateTutorial(1/60);
      var p2 = Game.players[0];
      p2.onGround = false; p2.vy = -5; p2.jumpsLeft = 1;
      p2.actWallDir = 0; p2.actDashT = 0;
      Game.message = ''; Game.messageTimer = 0;
      Game.tutorial.seen = {};
      updateTutorial(1/60);

      /* ⚠️ 注意：第 1 关的三条基础教学（tut_move / tut_jump / tut_gap，
       *    优先级 66~70）会压过 doublejump（10）。
       *    为了精确验证"解锁后二连跳提示会被触发"：
       *      · 把它们标记成已看过
       *      · 清掉 lastMsgId（"同一句别连续刷"的守卫）
       *      · **关卡索引改成 1（第 2 关）** —— 十一要求
       *        "第 1 关不许出现二连跳提示"，所以第 1 关永远测不到它 */
      Game.tutorial.seen.tut_move = true;
      Game.tutorial.seen.tut_jump = true;
      Game.tutorial.seen.tut_gap = true;
      Game.tutorial.seen.single_jump_hint = true;
      Game.levelIndex = 1;
      Game.tutorial.lastMsgId = null;
      Game.message = ''; Game.messageTimer = 0;
      updateTutorial(1/60);

      return {
        ok: true,
        lockedSeen: lockedSeen,
        lockedHintedDoubleJump: lockedSeen.indexOf('doublejump') >= 0,
        seen: Object.keys(Game.tutorial.seen),
        msg: Game.message,
      };
    } catch (e) { return { ok: false, err: String(e) + ' | ' + (e.stack||'').split('\\n')[1] }; }
  })()`);
  console.log('   ' + JSON.stringify(tut));
  check('★ 未解锁二连跳时不提示二连跳（修复"教了做不到的动作"）',
    tut.ok === true && tut.lockedHintedDoubleJump === false,
    tut.err || JSON.stringify(tut));
  check('解锁后教学提示正常生效',
    tut.ok === true && tut.seen && tut.seen.indexOf('doublejump') >= 0,
    tut.err || JSON.stringify(tut));

  /* ★ 十一本轮明确要求：第 1 关开局不许出现"再点一次可以跳得更高" ★ */
  const lv1Tut = await ev(`(function(){
    try {
      Save.load();
      Save.data.unlockedActions = ['doublejump','wallslide','walljump','dash'];
      Game.state='playing';
      Game.levelIndex = 0;              // ★ 第 1 关
      /* tut_move 要求进关 1 秒后才提示（避免一进关就弹字），
       * 这里把 elapsed 拨过阈值，模拟"玩家已经跑了 2 秒" */
      Game.elapsed = 2;
      Game.tutorial = null;
      updateTutorial(1/60);
      var p = Game.players[0];
      p.onGround = false; p.vy = -5; p.jumpsLeft = 1;   // 空中上升（最容易触发二连跳提示）
      Game.message = ''; Game.messageTimer = 0;
      Game.tutorial.seen = {};
      updateTutorial(1/60);
      return { hinted: !!Game.tutorial.seen.doublejump, msg: Game.message };
    } catch (e) { return { err: String(e) }; }
  })()`);
  console.log('   第1关空中时: ' + JSON.stringify(lv1Tut));
  check('★ 第 1 关不提示「再点一次可以跳得更高」（十一明确要求）',
    lv1Tut.hinted !== true,
    'hinted=' + lv1Tut.hinted + ' msg=' + JSON.stringify(lv1Tut.msg));
  check('★ 第 1 关反而给出「左右移动」教学（十一要求增加）',
    lv1Tut.msg && lv1Tut.msg.indexOf('左右移动') >= 0,
    'msg=' + JSON.stringify(lv1Tut.msg));

  console.log('\n' + '='.repeat(58));
  console.log('  说明页验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  if (problems.length) console.log('  失败项: ' + problems.join('、'));
  console.log('='.repeat(58));

  try { await cl.close(); } catch (e) {}
  chrome.kill();
  server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})();
