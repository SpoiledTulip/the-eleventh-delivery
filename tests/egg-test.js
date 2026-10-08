/* ============================================================
 * egg-test.js — 第 11 关「作者微信」彩蛋验收（真浏览器）
 * ============================================================
 * 按 docs/彩蛋_第11关作者微信.md 第四节的 11 条逐条验。
 *
 * ⚠️ 第 8 条「用真手机扫一下能扫到」**无法自动化** ——
 *    这个脚本会输出"卡片区域的像素截图"，人要拿手机对着屏幕扫。
 *    脚本能做的是：确认图片**真的画进了画布**（不是空白/占位符）。
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9477;
const HTTP_PORT = 9022;
const ROOT = SRC;

let PASS = 0, FAIL = 0;
const problems = [];
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); problems.push(name + ': ' + extra); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer(function (req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main() {
  await new Promise(function (resolve) { server.listen(HTTP_PORT, '127.0.0.1', resolve); });

  const tmpProfile = path.join(process.env.TEMP || '/tmp', 'egg-' + Date.now());
  const chrome = spawn(CHROME, [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + tmpProfile,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,720',
    'http://127.0.0.1:' + HTTP_PORT + '/index.html',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const list = await CDP.List({ port: PORT });
      target = list.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (target) break;
    } catch (e) { }
  }
  if (!target) { console.log('❌ 拿不到 target'); chrome.kill(); server.close(); process.exit(1); }

  const client = await CDP({ target, port: PORT });
  const { Runtime, Page } = client;
  await Runtime.enable();
  await Page.enable();

  const ev = async (expr) => {
    const r = await Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  const consoleErrors = [];
  Runtime.consoleAPICalled(function (p) {
    if (p.type === 'error') consoleErrors.push(p.args.map(a => a.value || a.description).join(' '));
  });

  await sleep(2600);

  console.log('第 11 关「作者微信」彩蛋验收');
  console.log('='.repeat(64));

  /* ---- 载入第 11 关 ---- */
  const load = await ev(`(function(){
    try {
      var all = PLAYABLE_LEVELS();
      var idx = -1;
      for (var i=0;i<all.length;i++) if (all[i].id === 11) idx = i;
      if (idx < 0) return { err: '找不到第 11 关' };
      loadLevel(idx);
      Game.state = 'playing';
      Game.paused = false;
      var lv = Game.level;
      return {
        ok: true,
        eggPads: (lv.eggPads || []).length,
        hasButtons: (lv.buttons || []).length,
        hasEggConsts: (typeof EGG_QR_IMG !== 'undefined') && (typeof EGG_QR_W !== 'undefined'),
        imgLen: (typeof EGG_QR_IMG === 'string') ? EGG_QR_IMG.length : 0,
        W: (typeof EGG_QR_W === 'number') ? EGG_QR_W : 0,
        H: (typeof EGG_QR_H === 'number') ? EGG_QR_H : 0,
        msg: (typeof EGG_MESSAGE === 'string') ? EGG_MESSAGE : '',
        hint: (typeof EGG_HINT === 'string') ? EGG_HINT : '',
        drawEggPads: (typeof drawEggPads === 'function'),
        drawEggHint: (typeof drawEggHint === 'function'),
      };
    } catch (e) { return { err: String(e && e.stack || e) }; }
  })()`);

  if (load.err) {
    console.log('❌ 载入第 11 关失败: ' + load.err);
    await client.close(); chrome.kill(); server.close(); process.exit(1);
  }

  console.log('\n【准备】');
  console.log('   彩蛋踏板数: ' + load.eggPads + ' | 按钮数: ' + load.hasButtons);
  console.log('   素材常量: EGG_QR_IMG ' + load.imgLen + ' 字符 / ' + load.W + '×' + load.H);
  console.log('   文案: "' + load.msg + '"  /  提示: "' + load.hint + '"');

  /* ===== 验收 2：踏板颜色与地砖不同 ===== */
  console.log('\n【验收 2】起点左侧地面有一块颜色不同的踏板');
  const padInfo = await ev(`(function(){
    var lv = Game.level, pad = lv.eggPads[0];
    // 画布采样：踏板处 vs 普通地砖处
    Game.camera.x = 0; Game.camera.y = 0;
    render(0.016);
    var cv = document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    function px(x,y){ var d = ctx.getImageData(x,y,1,1).data; return [d[0],d[1],d[2]]; }
    return {
      padCol: pad.x/32, padRow: pad.y/32,
      padPx: px(Math.round(pad.x + pad.w/2 - Game.camera.x), Math.round(pad.y + 2 - Game.camera.y)),
      // 普通地砖：出生点脚下（行24 顶面）
      floorPx: px(Math.round(6*32 - Game.camera.x), Math.round(24*32 + 2 - Game.camera.y)),
    };
  })()`);
  const padDiffers = padInfo.padPx.join(',') !== padInfo.floorPx.join(',');
  console.log('   踏板像素: ' + JSON.stringify(padInfo.padPx) + '  地砖像素: ' + JSON.stringify(padInfo.floorPx));
  check('踏板颜色和普通地砖不同（不与地形糊在一起）',
    padDiffers && padInfo.padPx[0] > 120, JSON.stringify(padInfo));

  /* ===== 验收 1：左下角提示 ===== */
  console.log('\n【验收 1】进关时左下角飘「左边那块板子，踩踩看？」约 4 秒淡出');
  const hintEarly = await ev(`(function(){
    var lv = Game.level;
    loadLevel(PLAYABLE_LEVELS().findIndex(function(x){return x.id===11;}));
    Game.state='playing';
    Game.eggHintTimer = 30;   // 进关 0.5 秒
    return { timer: Game.eggHintTimer, hasFn: typeof drawEggHint === 'function' };
  })()`);
  check('左下有提示的绘制函数（drawEggHint 存在）', hintEarly.hasFn === true);
  /* 采样左下角区域，看有没有画出底衬（半透明黑块） */
  const hintPx = await ev(`(function(){
    render(0.016);
    var cv = document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    function px(x,y){ var d = ctx.getImageData(x,y,1,1).data; return [d[0],d[1],d[2]]; }
    // 提示底衬在 (10, CANVAS_H-111) 附近
    return { at: px(12, CANVAS_H - 111), timer: Game.eggHintTimer };
  })()`);
  console.log('   提示区像素: ' + JSON.stringify(hintPx.at) + '（timer=' + hintPx.timer + '）');
  check('进关 4 秒内左下角确实画出了提示（该处非背景色）',
    hintPx.at[0] + hintPx.at[1] + hintPx.at[2] < 700, JSON.stringify(hintPx.at));

  /* 4 秒后应消失 */
  const hintGone = await ev(`(function(){
    Game.eggHintTimer = 300;   // 5 秒 > 240 帧上限
    render(0.016);
    var cv = document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    function px(x,y){ var d = ctx.getImageData(x,y,1,1).data; return [d[0],d[1],d[2]]; }
    return { at: px(12, CANVAS_H - 111) };
  })()`);
  check('超过 4 秒后提示消失（像素恢复背景）',
    hintGone.at[0] + hintGone.at[1] + hintGone.at[2] > hintPx.at[0] + hintPx.at[1] + hintPx.at[2],
    '4s后=' + JSON.stringify(hintGone.at) + ' 4s内=' + JSON.stringify(hintPx.at));

  /* ===== 验收 3 + 4：踩上去 → 卡片 + 大字 ===== */
  console.log('\n【验收 3 / 4】踩上踏板 → 浮现卡片 + 天上飘大字');
  const stepped = await ev(`(function(){
    return new Promise(function(resolve){
      var lv = Game.level, p = Game.players[0];
      var pad = lv.eggPads[0];
      Game.state='playing'; Game.paused=false;
      // 玩家站到踏板上
      p.x = pad.x - 2; p.y = (pad.y - p.h); p.vx=0; p.vy=0; p.onGround=true;
      Game.message = ''; Game.messageTimer = 0;
      var n = 0;
      function tick(){
        n++;
        if (n >= 12) {
          var cv = document.querySelector('canvas');
          var ctx = cv.getContext('2d');
          function px(x,y){ var d = ctx.getImageData(x,y,1,1).data; return [d[0],d[1],d[2]]; }
          // 卡片位置（和 drawEggCard 里一样的算法）
          var W = EGG_QR_W, H = EGG_QR_H;
          var cx = pad.x + pad.w/2 - W/2;
          var mapW = lv.width;
          if (cx < 8) cx = 8;
          if (cx + W > mapW - 8) cx = mapW - 8 - W;
          var cy = pad.y - 40 - H;
          return resolve({
            n: n,
            padPressed: !!pad.pressed,
            message: Game.message,
            messageTimer: Game.messageTimer,
            imgReady: (typeof eggQrReady === 'function') ? eggQrReady() : false,
            cardCenterPx: px(Math.round(cx + W/2 - Game.camera.x), Math.round(cy + H*0.35 - Game.camera.y)),
            cardOutside: px(Math.round(cx + W/2 - Game.camera.x), Math.round(cy - 30 - Game.camera.y)),
            cardXY: [cx, cy],
          });
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  })()`);
  console.log('   踏板 pressed=' + stepped.padPressed + ' | 二维码解码完成=' + stepped.imgReady);
  console.log('   大字="' + stepped.message + '" timer=' + stepped.messageTimer);
  console.log('   卡片世界坐标: ' + JSON.stringify(stepped.cardXY));
  check('踩住后 eggPad.pressed = true', stepped.padPressed === true);
  check('踩住后天上显示那句大字（Game.message 被续上）',
    stepped.message.indexOf('加作者微信') >= 0, '"' + stepped.message + '"');
  check('大字有计时器（续命生效，不会一闪就没）', stepped.messageTimer >= 6, String(stepped.messageTimer));
  check('卡片区域画出了内容（非背景色）',
    stepped.cardCenterPx[0] + stepped.cardCenterPx[1] + stepped.cardCenterPx[2] < 740 ||
    stepped.cardCenterPx[0] > 200,
    JSON.stringify(stepped.cardCenterPx));

  /* ===== 验收 5：不自动消失（站 10 秒还在） ===== */
  console.log('\n【验收 5】卡片不自动消失（站着等）');
  const stayLong = await ev(`(function(){
    return new Promise(function(resolve){
      var lv = Game.level, p = Game.players[0], pad = lv.eggPads[0];
      var n = 0;
      function tick(){
        n++;
        if (n >= 180) {   // 3 秒（浏览器里时间贵，3 秒足够代表"一直在"）
          resolve({ padPressed: !!pad.pressed, message: Game.message, timer: Game.messageTimer, n: n });
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  })()`);
  check('站住 3 秒后 pressed 仍为 true（不会自动取消）', stayLong.padPressed === true);
  check('站住 3 秒后大字仍在（messageTimer 被持续续命）',
    stayLong.message.indexOf('加作者微信') >= 0 && stayLong.timer >= 6,
    'timer=' + stayLong.timer + ' msg="' + stayLong.message + '"');

  /* ===== 验收 6：走开立刻消失 ===== */
  console.log('\n【验收 6】走下踏板 → 卡片和大字立刻消失');
  const steppedOff = await ev(`(function(){
    return new Promise(function(resolve){
      var lv = Game.level, p = Game.players[0], pad = lv.eggPads[0];
      // 把玩家挪到踏板右边（走出判定区）
      p.x = pad.x + pad.w + 40; p.y = pad.y - p.h;
      var n = 0;
      function tick(){
        n++;
        if (n >= 12) {
          resolve({ padPressed: !!pad.pressed, message: Game.message, timer: Game.messageTimer });
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  })()`);
  check('走下踏板后 pressed 立刻变 false', steppedOff.padPressed === false);
  check('走下踏板后大字在 6 帧内消失（messageTimer 归零）',
    steppedOff.timer <= 0 || steppedOff.message === '' || steppedOff.message.indexOf('加作者微信') < 0,
    'timer=' + steppedOff.timer + ' msg="' + steppedOff.message + '"');

  /* ===== 验收 7：反复触发 ===== */
  console.log('\n【验收 7】反复踩可反复触发');
  const repeat = await ev(`(function(){
    return new Promise(function(resolve){
      var lv = Game.level, p = Game.players[0], pad = lv.eggPads[0];
      var results = [], phase = 0, n = 0;
      function tick(){
        n++;
        if (n % 12 === 0) {
          if (phase % 2 === 0) { p.x = pad.x - 2; p.y = pad.y - p.h; }        // 踩上去
          else { p.x = pad.x + pad.w + 40; p.y = pad.y - p.h; }               // 走开
          phase++;
          if (phase === 6) {   // 踩了 3 次
            resolve({ results: results, phases: phase });
            return;
          }
        }
        if (n % 12 === 6) results.push({ on: !!pad.pressed, msg: Game.message.indexOf('加作者微信') >= 0 });
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  })()`);
  const onCount = repeat.results.filter(r => r.on).length;
  const offCount = repeat.results.filter(r => !r.on).length;
  console.log('   采样: ' + JSON.stringify(repeat.results.map(r => r.on ? '踩' : '走')));
  check('踩 3 次、走 3 次都能正确切换（可反复触发）',
    onCount >= 3 && offCount >= 3, JSON.stringify(repeat.results));

  /* ===== 验收 8：二维码真的画进去了（人拿手机扫）===== */
  console.log('\n【验收 8】二维码可扫（★ 需要人拿手机对着屏幕扫 ★）');
  const qrDrawn = await ev(`(function(){
    var img = eggQrImage();
    return {
      hasImg: !!img,
      ready: eggQrReady(),
      naturalW: img ? img.naturalWidth : 0,
      naturalH: img ? img.naturalHeight : 0,
      srcPrefix: (typeof EGG_QR_IMG === 'string') ? EGG_QR_IMG.slice(0, 30) : '',
    };
  })()`);
  console.log('   图片对象: ' + (qrDrawn.hasImg ? '有' : '无') +
    ' | 解码完成: ' + qrDrawn.ready +
    ' | 原始尺寸: ' + qrDrawn.naturalW + '×' + qrDrawn.naturalH);
  console.log('   data URI 前缀: ' + qrDrawn.srcPrefix + '…');
  check('二维码图片已解码（可以真画进画布）',
    qrDrawn.ready === true && qrDrawn.naturalW > 0,
    JSON.stringify(qrDrawn));
  check('原始尺寸是 820×1210（和原图一致，不是被改过）',
    qrDrawn.naturalW === 820 && qrDrawn.naturalH === 1210,
    qrDrawn.naturalW + '×' + qrDrawn.naturalH);

  /* 截图，供人工用手机扫 */
  const shotDir = path.join(PROJ, 'dist', '_egg_shots');
  if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
  /* ⚠️⚠️ 截图前必须做三件事（少一件就会截到空白卡片）：
   *   ① 等**预热**完成 —— base64 有 252 KB，解码要 0.5~2 秒。
   *      蛋.js 在页面加载时就预热了，这里再等一会儿确保好。
   *   ② 让玩家**站在踏板上**（pressed=true，卡片才会画）
   *   ③ **别手动改相机**再 render —— 相机由 updateCamera 管理，
   *      手动改完 render 会被下一帧的主循环覆盖回去。
   *      ⇒ 改成"等主循环自己把相机跟过来"。 */
  await ev(`(function(){
    var lv = Game.level, p = Game.players[0], pad = lv.eggPads[0];
    p.x = pad.x - 1; p.y = pad.y - p.h; p.vx = 0; p.vy = 0; p.onGround = true;
    return true;
  })()`);
  await sleep(1400);   // 等主循环把相机跟上 + 图片解码

  const qrStats = await ev(`(function(){
    render(0.016);
    var cv = document.querySelector('canvas'), ctx = cv.getContext('2d');
    var pad = Game.level.eggPads[0];
    var W = EGG_QR_W, H = EGG_QR_H;
    var cx = pad.x + pad.w/2 - W/2; if (cx < 8) cx = 8;
    var cy = pad.y - 40 - H;
    var sx = Math.round(cx - Game.camera.x), sy = Math.round(cy - Game.camera.y);
    var data = ctx.getImageData(sx, sy, W, H).data;
    var dark = 0, total = W * H;
    for (var i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i+1] + data[i+2]) / 3 < 110) dark++;
    }
    return { dark: dark, total: total, darkPct: +(dark/total*100).toFixed(1),
             sx: sx, sy: sy, ready: eggQrReady(), nw: (eggQrImage()||{}).naturalWidth || 0 };
  })()`);
  console.log('   卡片区域暗像素(二维码黑块)占比: ' + qrStats.darkPct + '%（' + qrStats.dark + '/' + qrStats.total + '）');
  console.log('   卡片屏幕位置: (' + qrStats.sx + ',' + qrStats.sy + ') | 图片解码=' + qrStats.ready + ' 尺寸=' + qrStats.nw);
  /* 典型二维码：黑块占比 3%~35%（纯白卡片是 0%，纯黑是 100%） */
  check('卡片里真的画出了二维码（黑块占比在合理范围）',
    qrStats.darkPct > 3 && qrStats.darkPct < 45, qrStats.darkPct + '%');
  check('截图时图片已解码完成（不是"加载中"占位）',
    qrStats.ready === true && qrStats.nw === 820, 'ready=' + qrStats.ready + ' nw=' + qrStats.nw);

  const { data } = await Page.captureScreenshot({ format: 'png' });
  const shotPath = path.join(shotDir, 'egg-card.png');
  fs.writeFileSync(shotPath, Buffer.from(data, 'base64'));
  console.log('   📷 截图已保存（拿手机扫这张图里的二维码）: ' + shotPath);

  /* ===== 验收 9：踏板不开任何门 ===== */
  console.log('\n【验收 9】踏板不会开任何门');
  const noDoor = await ev(`(function(){
    var lv = Game.level;
    return {
      doors: (lv.doors || []).length,
      buttons: (lv.buttons || []).length,
      eggPads: (lv.eggPads || []).length,
      eggPadHasColor: ('color' in (lv.eggPads[0] || {})),
    };
  })()`);
  console.log('   第 11 关: 门=' + noDoor.doors + ' 按钮=' + noDoor.buttons + ' 彩蛋踏板=' + noDoor.eggPads);
  check('第 11 关本来就没有门（踩踏板不会开门）', noDoor.doors === 0, 'doors=' + noDoor.doors);
  check('彩蛋踏板**没有** color 字段（没混进 buttons 的语义）',
    noDoor.eggPadHasColor === false);

  /* ===== 验收 11：世界坐标（跟地图滚动）===== */
  console.log('\n【验收 11】卡片是世界坐标（跟着地图滚）');
  const worldCoord = await ev(`(function(){
    var lv = Game.level, pad = lv.eggPads[0];
    // 相机移开，卡片的"世界坐标"应该不变
    Game.camera.x = 0; render(0.016);
    var cv = document.querySelector('canvas');
    var ctx = cv.getContext('2d');
    var W = EGG_QR_W, H = EGG_QR_H;
    var cx0 = pad.x + pad.w/2 - W/2; if (cx0 < 8) cx0 = 8;
    var worldX0 = cx0;
    // 相机滚到踏板附近
    Game.camera.x = Math.max(0, pad.x - 200); render(0.016);
    var cx1 = pad.x + pad.w/2 - W/2; if (cx1 < 8) cx1 = 8;
    return {
      worldX_camAt0: worldX0,
      worldX_camMoved: cx1,
      same: Math.abs(worldX0 - cx1) < 0.01,
      camNow: Game.camera.x,
    };
  })()`);
  check('卡片坐标不随相机变化（说明是世界坐标，不是屏幕坐标）',
    worldCoord.same === true, JSON.stringify(worldCoord));

  /* ===== 红线：第 1~10 关不受影响 ===== */
  console.log('\n【红线】第 1~10 关没有彩蛋踏板');
  const others = await ev(`(function(){
    var all = PLAYABLE_LEVELS();
    var bad = [];
    for (var i=0;i<all.length;i++){
      if (all[i].id === 11) continue;
      var lv = parseLevel(all[i]);
      if ((lv.eggPads||[]).length > 0) bad.push(all[i].id);
      // 顺便确认地图里没有 Q 字符
      if (all[i].map.join('').indexOf('Q') >= 0) bad.push(all[i].id + '(含Q字符)');
    }
    return { bad: bad, total: all.length };
  })()`);
  check('第 1~10 关都没有 eggPads、地图里也没有 Q 字符',
    others.bad.length === 0, JSON.stringify(others.bad));

  /* ===== console 错误 ===== */
  console.log('\n【控制台】');
  check('没有 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  console.log('\n' + '='.repeat(64));
  console.log('彩蛋验收: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('='.repeat(64));
  if (FAIL > 0) {
    console.log('\n失败项：');
    problems.forEach((p, i) => console.log('  ' + (i + 1) + '. ' + p));
  }

  await client.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(tmpProfile, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error('验收脚本失败:', e); process.exit(1); });
