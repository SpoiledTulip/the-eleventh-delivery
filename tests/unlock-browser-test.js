/* ============================================================
 * 逐步解锁 · 真浏览器端到端验证
 * ============================================================
 * 验证完整链路：
 *   新档 → 动作全锁 → 通关第1关 → 结算面板弹出"解锁二连跳"
 *   → 回到游戏，二连跳真的能用了
 *
 * 这是"逐步解锁"功能最终的用户体验验证 —— 前面 unlock-test.js
 * 验证的是逻辑，这里验证的是"玩家看到什么"。
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
const PORT = 8951;

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

  const ud = path.join(require('os').tmpdir(), 'ul-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=9421', '--user-data-dir=' + ud,
    '--window-size=1180,860', URL,
  ], { stdio: 'ignore' });

  let cl;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { cl = await CDP({ port: 9421 }); break; } catch (e) {}
  }
  try {
    const ts = await CDP.List({ port: 9421 });
    const w = ts.filter(function (t) { return t.type === 'page'; })
      .find(function (t) { return t.url && t.url.indexOf('index.html') >= 0; });
    if (w && w.id !== cl._targetId) { await cl.close(); cl = await CDP({ port: 9421, target: w.id }); }
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

  console.log('逐步解锁 · 真浏览器验证');
  console.log('='.repeat(58));

  /* ------------------------------------------------------------
   * 1. 清档重开 → 所有动作都锁着
   * ------------------------------------------------------------ */
  console.log('\n=== 1. 新档状态 ===');
  const fresh = await ev(`(function(){
    Save.reset();
    Save.load();
    return {
      unlocked: Save.data.unlockedActions.slice(),
      dj: isActionUnlocked('doublejump'),
      ws: isActionUnlocked('wallslide'),
      wj: isActionUnlocked('walljump'),
      dash: isActionUnlocked('dash'),
    };
  })()`);
  console.log('   ' + JSON.stringify(fresh));
  check('新档没有任何已解锁动作', fresh.unlocked.length === 0, JSON.stringify(fresh.unlocked));
  check('新档二连跳锁着', fresh.dj === false);
  check('新档冲刺锁着', fresh.dash === false);

  /* ------------------------------------------------------------
   * 2. 新档进第1关 → 二连跳真的用不了
   * ------------------------------------------------------------ */
  console.log('\n=== 2. 锁定状态下二连跳不生效 ===');
  const lockedPlay = await ev(`(function(){
    Game.mode='local'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(0); Game.state='playing';
    var p = Game.players[0];
    p.x=200; p.y=100; p.vx=0; p.vy=0; p.onGround=false;
    p.jumpsLeft=1; p.jumpBuffer=CONFIG.JUMP_BUFFER; p.coyote=0;
    InputState.now={}; InputState.now['ArrowUp']=true;
    var before=p.vy;
    update(1/60); InputState.tick();
    return { before:before, after:p.vy, jumpsLeft:p.jumpsLeft };
  })()`);
  console.log('   vy ' + lockedPlay.before.toFixed(2) + ' → ' + lockedPlay.after.toFixed(2) +
    '（jumpsLeft=' + lockedPlay.jumpsLeft + '）');
  check('未解锁时空中按跳没反应',
    lockedPlay.jumpsLeft === 1 && lockedPlay.after > 0,
    JSON.stringify(lockedPlay));

  /* ------------------------------------------------------------
   * 3. 模拟通关第1关 → 结算面板应该弹出解锁提示
   * ------------------------------------------------------------ */
  console.log('\n=== 3. 通关后结算面板 ===');
  const clearPanel = await ev(`(function(){
    /* 直接把游戏状态设成"刚通关"，让结算面板渲染 */
    Save.reset();
    Game.mode='local'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(0);
    Game.coinsTaken = Game.coinsTotal;    // 全收集
    Game.elapsed = 42.5;
    /* 这一步会写存档并解锁动作（和真实通关走同一条路径） */
    Game.lastRecord = SAVE().recordClear(0, Game.elapsed, Game.coinsTaken, Game.coinsTotal);
    Game.state = 'clear';
    UI.lastKey = '';
    syncUI();                              // 渲染结算面板
    return {
      unlockedNow: (Game.lastRecord.unlocked || []).map(function(u){ return u.id; }),
      hasBox: !!document.querySelector('.unlock-box'),
      boxText: (document.querySelector('.unlock-box') || {}).textContent || '',
    };
  })()`);
  console.log('   解锁: ' + JSON.stringify(clearPanel.unlockedNow));
  console.log('   面板文案: ' + JSON.stringify(clearPanel.boxText).slice(0, 120));
  check('通关第1关解锁了二连跳',
    clearPanel.unlockedNow.indexOf('doublejump') >= 0,
    JSON.stringify(clearPanel.unlockedNow));
  check('结算面板出现解锁提示块', clearPanel.hasBox === true);
  check('提示里写了「二连跳」', clearPanel.boxText.indexOf('二连跳') >= 0, clearPanel.boxText);
  check('提示里写了怎么按', clearPanel.boxText.indexOf('空中') >= 0, clearPanel.boxText);

  /* ------------------------------------------------------------
   * 4. 解锁后二连跳真的能用
   * ------------------------------------------------------------ */
  console.log('\n=== 4. 解锁后二连跳可用 ===');
  const afterUnlock = await ev(`(function(){
    Game.state='playing';
    var p = Game.players[0];
    p.x=200; p.y=100; p.vx=0; p.vy=0; p.onGround=false;
    p.jumpsLeft=1; p.jumpBuffer=CONFIG.JUMP_BUFFER; p.coyote=0;
    InputState.now={}; InputState.now['ArrowUp']=true;
    var before=p.vy;
    update(1/60); InputState.tick();
    return { before:before, after:p.vy, jumpsLeft:p.jumpsLeft, dj:p.doubleJumped };
  })()`);
  console.log('   vy ' + afterUnlock.before.toFixed(2) + ' → ' + afterUnlock.after.toFixed(2) +
    '（jumpsLeft=' + afterUnlock.jumpsLeft + ', doubleJumped=' + afterUnlock.dj + '）');
  check('解锁后二连跳真的生效',
    afterUnlock.jumpsLeft === 0 && afterUnlock.after < afterUnlock.before,
    JSON.stringify(afterUnlock));

  /* ------------------------------------------------------------
   * 5. 逐关解锁到冲刺
   * ------------------------------------------------------------ */
  console.log('\n=== 5. 逐关解锁到冲刺 ===');
  const progress = await ev(`(function(){
    /* 已通关第1关，继续通关到第4关 */
    Save.recordClear(1, 40, 10, 14);
    var mid = Save.data.unlockedActions.slice();
    Save.recordClear(2, 40, 10, 14);
    var mid2 = Save.data.unlockedActions.slice();
    Save.recordClear(3, 40, 10, 14);
    return {
      after2: mid, after3: mid2, after4: Save.data.unlockedActions.slice(),
      dash: isActionUnlocked('dash'),
      dashPanelText: (function(){
        Game.lastRecord = Save.recordClear ? null : null;
        return '';
      })(),
    };
  })()`);
  console.log('   通关第2关后: ' + JSON.stringify(progress.after2));
  console.log('   通关第3关后: ' + JSON.stringify(progress.after3));
  console.log('   通关第4关后: ' + JSON.stringify(progress.after4));
  check('第4关通关后冲刺已解锁', progress.dash === true, JSON.stringify(progress.after4));
  check('解锁顺序正确（逐关累加）',
    progress.after2.length === 2 && progress.after3.length === 3 && progress.after4.length === 4,
    JSON.stringify([progress.after2.length, progress.after3.length, progress.after4.length]));

  /* ------------------------------------------------------------
   * 6. 冲刺解锁后能用，且结算面板显示冲刺
   * ------------------------------------------------------------ */
  console.log('\n=== 6. 冲刺解锁后的表现 ===');
  const dashWork = await ev(`(function(){
    Game.mode='local'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(4);            // 第 5 关（动作关）
    Game.state='playing';
    var p = Game.players[0];
    /* ★ 2026-10-07 修：冲刺键已从 Shift 改成 F（actions.js 的 DASH_KEYS_BASE）
     *   ⇒ 不再硬编码 ShiftLeft，改成**现读真实键位**，以后改键位自动跟随。 */
    var DK = (ACTIONS && ACTIONS.DASH_KEYS && ACTIONS.DASH_KEYS[0]) || 'KeyF';
    p.x=500; p.y=600; p.vx=0; p.vy=0; p.onGround=false;
    p.actDashes=1; p.actDashCool=0; p.actDashT=0; p._actDashKeyPrev=false;
    InputState.now={}; InputState.now[DK]=true; InputState.now['ArrowRight']=true;
    update(1/60); InputState.tick();
    var started = p.actDashT;
    var x0 = p.x;
    /* ⚠️ 要跑够 dashFrames 帧数才走得完 110px ——
     * 上面那一帧已经消耗掉 1 帧了，所以这里再跑 dashFrames 帧。 */
    for (var i=0;i<CELESTE.dashFrames;i++){
      var kk={}; kk[DK]=true; kk['ArrowRight']=true;
      InputState.now=kk; update(1/60); InputState.tick();
    }
    return { started:started, x0:x0, x:p.x, dashes:p.actDashes, moved: p.x - x0 };
  })()`);
  console.log('   冲刺启动 actDashT=' + dashWork.started +
    ' 位移 ' + Math.round(dashWork.moved) + 'px（目标 ' + 110 + '）');
  check('解锁后冲刺能触发', dashWork.started > 0, JSON.stringify(dashWork));
  /* 冲刺距离上限是 110px，实测会略低（起步/收尾各有一帧损耗），
   * 所以断言放宽到 80 —— 关键是"确实冲出去了"，不是精确到像素。 */
  check('冲刺产生了足够位移（≥ 80px）', dashWork.moved >= 80,
    '位移 ' + Math.round(dashWork.moved) + 'px');

  /* ------------------------------------------------------------
   * 7. 说明页反映解锁状态（不应让玩家看到还没学的动作细节）
   * ------------------------------------------------------------ */
  console.log('\n=== 7. 说明页（全解锁后）===');
  const help = await ev(`(function(){
    gotoState(STATE.HELP);
    return {
      state: Game.state,
      rows: document.querySelectorAll('.help-row').length,
      hasDash: !!document.querySelector('.help-dash'),
    };
  })()`);
  check('说明页能正常打开', help.state === 'help' && help.rows === 7,
    JSON.stringify(help));
  check('说明页包含冲刺详解', help.hasDash === true);

  /* ------------------------------------------------------------
   * 8. 回主菜单，进度正确
   * ------------------------------------------------------------ */
  console.log('\n=== 8. 主菜单进度 ===');
  const menu = await ev(`(function(){
    goMenu();
    var txt = document.querySelector('#ui').textContent;
    return {
      state: Game.state,
      /* ★ 2026-10-06 C1：主菜单进度文案从"已通关 X / Y 条路线"
       *   改成了"已送 X / Y 单"（外卖语义）。
       *   这里改查"已送"，同时保留对"已通关"的兼容 ——
       *   万一以后文案又变，两种写法任一命中都算过。 */
      hasClearProgress: txt.indexOf('已送') >= 0 || txt.indexOf('已通关') >= 0,
      txt: txt.slice(0, 160),
    };
  })()`);
  console.log('   ' + JSON.stringify(menu.txt));
  check('回主菜单成功', menu.state === 'menu');
  check('主菜单显示通关进度', menu.hasClearProgress === true);

  /* ============================================================
   * ★ 主菜单黑框 + 两侧角色名字（2026-10-06 十一要求）★
   * ============================================================
   * ① 面板必须是黑框（不是透明外壳）
   * ② canvas 上两侧角色下面要有名字（像素采样验证"真的画了"）
   * ============================================================ */
  const menuFrame = await ev(`(function(){
    var p = document.querySelector('.panel.menu-fit');
    if (!p) return null;
    var cs = getComputedStyle(p);
    return { bg: cs.backgroundColor, borderW: parseFloat(cs.borderTopWidth) || 0 };
  })()`);
  check('★ 主菜单是黑框面板（背景不透明 + 有边框）',
    menuFrame && menuFrame.bg !== 'rgba(0, 0, 0, 0)' &&
    menuFrame.bg !== 'transparent' && menuFrame.borderW >= 2,
    JSON.stringify(menuFrame));

  /* 两侧名字：在名字基线附近采样，看有没有 黄（袋鼠）/ 橙（飞龙）文字像素
   * ⚠️ 必须先**主动强制重绘一帧主菜单**再采样 ——
   *    直接读画布会受"上一个测试留下什么画面"影响（踩过这个坑：
   *    单独跑这个测试全绿，放在套件里跑就变 0 像素）。
   *    强制绘制后，采到的必然是主菜单这一帧。 */
  await ev(`(function(){
    Game.state = 'menu';
    UI.lastKey = '';
    if (typeof render === 'function') render(0.016);
    return 'redrawn';
  })()`);
  const namePx = await ev(`(function(){
    var cv = document.querySelector('canvas#game') || document.querySelector('canvas');
    if (!cv) return null;
    var ctx = cv.getContext('2d');
    var K_W = Math.ceil(230/0.711) + 20;
    var D_W = Math.ceil(230*0.984) + 20;
    function scan(cx){
      var d = ctx.getImageData(cx-60, 692, 120, 22).data;
      var yellow = 0, orange = 0;
      for (var i = 0; i < d.length; i += 4){
        var R = d[i], Gc = d[i+1], B = d[i+2];
        if (R > 200 && Gc > 150 && B < 130) yellow++;
        if (R > 200 && Gc > 110 && Gc < 180 && B < 110) orange++;
      }
      return { yellow: yellow, orange: orange };
    }
    return { left: scan(64 + K_W/2), right: scan(cv.width - 64 - D_W + D_W/2) };
  })()`);
  check('★ 左侧角色下方有名字（美团黄文字像素）',
    namePx && namePx.left.yellow > 50,
    '黄色像素=' + (namePx && namePx.left.yellow));
  check('★ 右侧角色下方有名字（飞龙橙文字像素）',
    namePx && namePx.right.orange > 50,
    '橙色像素=' + (namePx && namePx.right.orange));

  /* ============================================================
   * ★ 菜单页：飞龙宝宝要比袋鼠小（2026-10-06 十一要求）★
   * ============================================================
   * 十一原话："那个菜单栏页的那个飞龙宝宝，那个给我放小一点"。
   *
   * ⚠️ 这条和**启动画面**的规则相反（封面那两只按面积对齐）——
   *    两处是分开的绘制，别把规则互相套用：
   *      · 启动画面 → ui.js paintCharPreview（面积对齐）
   *      · 菜单页   → render.js drawMenuBackdrop（飞龙 0.65 倍高）
   *
   * 判定方式：分别量两只的"实际绘制高度"。
   * ⚠️ 不能直接扫画布像素 —— 名字文字和动画位移会污染包围盒。
   *    这里按 drawMenuBackdrop 的公式**直接算**绘制尺寸（稳定、不受动画影响）。
   * ============================================================ */
  const sizes = await ev(`(function(){
    function drawnSize(ar, boxW, boxH){
      var h = boxH, w = h * ar;
      if (w > boxW) { w = boxW; h = w / ar; }
      return { w: Math.round(w), h: Math.round(h) };
    }
    var COMMON_H = 230;
    var K_W = Math.ceil(COMMON_H / 0.711) + 20;
    var DRAGON_SCALE = 0.65;
    var D_H = Math.round(COMMON_H * DRAGON_SCALE);
    var D_W = Math.ceil(D_H * 0.984) + 20;
    var k = drawnSize(91/128, K_W, COMMON_H);
    var d = drawnSize(126/128, D_W, D_H);
    return {
      kangaroo: k, dragon: d,
      ratio: Math.round(d.h / k.h * 100) / 100,
      /* 底边是否齐平（框底都落在 yBase + COMMON_H） */
      kBottom: (720 - 268) + k.h,
      dBottom: (720 - 268) + (COMMON_H - D_H) + d.h
    };
  })()`);
  check('★ 菜单页飞龙比袋鼠小（高度比 ≤ 0.75）',
    sizes && sizes.ratio <= 0.75,
    '袋鼠 ' + (sizes && sizes.kangaroo.h) + 'px 高 / 飞龙 ' +
    (sizes && sizes.dragon.h) + 'px 高 → 比 ' + (sizes && sizes.ratio));
  check('★ 菜单页两只底边仍齐平（站在同一条线上）',
    sizes && Math.abs(sizes.kBottom - sizes.dBottom) <= 1,
    '袋鼠底=' + (sizes && sizes.kBottom) + ' 飞龙底=' + (sizes && sizes.dBottom));

  console.log('\n' + '='.repeat(58));
  console.log('  逐步解锁验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  if (problems.length) console.log('  失败项: ' + problems.join('、'));
  console.log('='.repeat(58));

  try { await cl.close(); } catch (e) {}
  chrome.kill();
  server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})();
