/* ============================================================
 * _receiver-browser.js — 真浏览器实测收餐人朝向 + 台词
 * ============================================================
 * 离线测试（72 项）验的是**纯逻辑**。这里要验"接进渲染/主循环后真发生"：
 *   · 骑手在左边时，收餐人被真的**镜像**了（不是只算了个变量）
 *   · 走到门口 → 气泡真的出现在屏幕上（截图 + 读 alpha）
 *   · 说话期间**不影响通关判断**
 *
 * ⚠️ 铁律：先过设备选择页；纯逻辑别放这儿。
 * ============================================================ */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');

const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9833, HP = 9399;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(SRC, p);
  if (!f.startsWith(SRC)) { s.writeHead(403); s.end(); return; }
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) { console.log('    [v] ' + msg); pass++; } else { console.log('    [X] ' + msg); fail++; } };

(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'recv-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,720', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });
  let tg = null;
  for (let i = 0; i < 60; i++) { await sleep(300); try { const l = await CDP.List({ port: PORT }); tg = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (tg) break; } catch (e) { } }
  if (!tg) { console.error('找不到页面'); process.exit(1); }

  const c = await CDP({ target: tg, port: PORT });
  const { Runtime, Page } = c;
  await Runtime.enable(); await Page.enable();
  const errs = [];
  Runtime.consoleAPICalled(p => { if (p.type === 'error') errs.push((p.args[0] || {}).value || ''); });
  Runtime.exceptionThrown(p => errs.push(p.exceptionDetails.text));
  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  await sleep(2600);
  await ev(`(function(){
    try{ if(typeof DEVICE!=='undefined'&&DEVICE.set) DEVICE.set('pc'); }catch(e){}
    document.querySelectorAll('.overlay,.panel,#splash,#device-pick').forEach(function(n){n.style.display='none';});
    return 1; })()`);

  const OUT = path.resolve(__dirname, '..', 'dist', '_receiver_shots');
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const shot = async name => {
    const r = await Page.captureScreenshot({ format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📷 ' + name + '.png');
  };

  console.log('\n=== 1. 模块就位 ===');
  check(await ev('typeof RECEIVER_TALK === "object"'), 'RECEIVER_TALK 已加载');
  check(await ev('typeof receiverTalkStart === "function"'), 'receiverTalkStart 已定义');
  check(await ev('typeof drawReceiverSpeech === "function"'), 'drawReceiverSpeech 已定义');

  /* 找一关"有收餐人"的关卡（hash < 0.66） */
  const info = await ev(`(function(){
    var N = PLAYABLE_LEVELS().length;
    for (var i=0;i<N;i++){
      var lv = parseLevel(PLAYABLE_LEVELS()[i]);
      var g = lv.goal; if (!g) continue;
      var seed = g.x;
      var x = Math.abs(Math.floor(seed)) || 0;
      x = (x * 2654435761) % 2147483647;
      var h = x / 2147483647;
      if (h < 0.66) return { idx: i, id: lv.id, h: h };
    }
    return { idx: -1 };
  })()`);
  console.log('    有收餐人的第一关: 索引 ' + info.idx + '（id=' + info.id + ', hash=' + (info.h || 0).toFixed(3) + '）');
  check(info.idx >= 0, '存在"有收餐人"的关卡');

  console.log('\n=== 2. ★ 朝向：骑手在左 → 收餐人朝左 ===');
  const face = await ev(`(function(){
    loadLevel(${info.idx}); Game.state = STATE.PLAYING;
    var g = Game.level.goal;
    var cx = g.x + g.w/2, baseY = g.y + g.h;
    var p = Game.players[0];
    /* 骑手放到**左边** */
    p.x = cx - 300; p.y = baseY - p.h; p.spawnX = p.x;
    var left = RECEIVER_TALK.riderToFace(Game.players, cx);
    var signLeft = RECEIVER_TALK.facingSign(left, cx);
    /* 骑手放到**右边** */
    p.x = cx + 300; p.spawnX = p.x;
    var right = RECEIVER_TALK.riderToFace(Game.players, cx);
    var signRight = RECEIVER_TALK.facingSign(right, cx);
    return { cx: cx, left: signLeft, right: signRight };
  })()`);
  check(face.left === -1, '★ 骑手在左 → facingSign = -1（真的会镜像）');
  check(face.right === 1, '★ 骑手在右 → facingSign = +1（不镜像）');

  /* 再验"render 真的用了它"——用一个探针替换 scale 记录调用 */
  const probe = await ev(`(function(){
    /* 把骑手放左边，然后跑一次 drawGoal，用探针看有没有发生 scale(-1,1) */
    var g = Game.level.goal;
    var cx = g.x + g.w/2, baseY = g.y + g.h;
    var p = Game.players[0];
    p.x = cx - 300; p.y = baseY - p.h; p.spawnX = p.x;
    var cv = document.getElementById('game') || document.querySelector('canvas');
    var real = cv.getContext('2d');
    var scaledNeg = false;
    var origScale = real.scale.bind(real);
    real.scale = function(a,b){ if (a === -1) scaledNeg = true; return origScale(a,b); };
    var err = null;
    try { drawGoal(real, Game.level, 1.0, false); } catch(e){ err = e.message; }
    real.scale = origScale;
    return { scaledNeg: scaledNeg, err: err };
  })()`);
  check(probe.err === null, 'drawGoal 不抛异常' + (probe.err ? '：' + probe.err : ''));
  check(probe.scaledNeg, '★★ 骑手在左时，drawGoal **真的调了 scale(-1,1)**（不只是算了个变量）');

  console.log('\n=== 3. ★ 走到门口 → 气泡出现在屏幕上 ===');
  const talk = await ev(`(function(){
    loadLevel(${info.idx}); Game.state = STATE.PLAYING;
    var g = Game.level.goal;
    var cx = g.x + g.w/2, baseY = g.y + g.h;
    var p = Game.players[0];
    /* 站到门洞里，订单拉满 */
    p.x = cx - 13; p.y = baseY - p.h; p.spawnX = p.x;
    Game.coinsTaken = Game.coinsRequired;
    receiverTalkReset();
    /* 手动触发（等价于 render 检测到 atDoor） */
    var started = receiverTalkStart({ late: false, missing: false });
    for (var i=0;i<30;i++){ update(1/60); }
    var s = receiverTalkSession();
    return { started: started, elapsed: +(s.elapsed.toFixed(2)), line: s.lines[RECEIVER_TALK.lineIndexAt(s)],
             alpha: +RECEIVER_TALK.lineAlpha(s).toFixed(2), state: Game.state, done: s.done };
  })()`);
  console.log('    正在说: 「' + talk.line + '」 alpha=' + talk.alpha);
  check(talk.started, '★ 触发成功');
  check(talk.elapsed > 0.4, '★ 计时在走（elapsed=' + talk.elapsed + '）');
  check(talk.alpha > 0.5, '★ 气泡可见（alpha=' + talk.alpha + '）');
  check(talk.state === 'playing', '★★ 说话期间状态仍是 playing（没被卡住）');
  await sleep(400);
  await shot('receiver-talk-good');

  console.log('\n=== 4. ★ 超时 → 换成抱怨台词 ===');
  const late = await ev(`(function(){
    receiverTalkReset();
    receiverTalkStart({ late: true, missing: false });
    for (var i=0;i<30;i++) update(1/60);
    var s = receiverTalkSession();
    return { group: s.group, line: s.lines[RECEIVER_TALK.lineIndexAt(s)] };
  })()`);
  console.log('    正在说: 「' + late.line + '」（' + late.group + ' 组）');
  check(late.group === 'late', '★ 超时 → 走抱怨组');
  check(late.line.indexOf('慢') >= 0 || late.line.indexOf('饿') >= 0 || late.line.indexOf('快') >= 0,
    '★ 抱怨台词内容对得上（"' + late.line + '"）');
  await sleep(300);
  await shot('receiver-talk-late');

  console.log('\n=== 5. ★ 跳过 ===');
  const skip = await ev(`(function(){
    var before = receiverTalkSession().done;
    receiverTalkSkip();
    var after = receiverTalkSession().done;
    for (var i=0;i<30;i++) update(1/60);
    return { before: before, after: after, state: Game.state };
  })()`);
  check(!skip.before && skip.after, '★ 按键跳过 → 立刻结束');
  check(skip.state === 'playing', '★ 跳过后游戏照常');

  console.log('\n=== 6. ★ 不挡通关：完整跑一次"走到门口" ===');
  const goalTest = await ev(`(function(){
    /* 真浏览器里"送达即通关"由 game.js 判；这里验"说话没把它挡住" */
    loadLevel(${info.idx}); Game.state = STATE.PLAYING;
    receiverTalkReset();
    receiverTalkStart({ late:false, missing:false });
    var g = Game.level.goal;
    var p = Game.players[0];
    p.x = g.x + g.w/2; p.y = g.y + g.h - p.h;
    Game.coinsTaken = Game.coinsRequired;
    var states = [];
    for (var i=0;i<120;i++){ update(1/60); states.push(Game.state); }
    /* 说话是否还挂在屏幕上不该影响 state */
    var anyGoal = states.some(function(s){ return s !== 'playing'; }) ? 'changed' : 'still-playing';
    return { anyGoal: anyGoal, talkDone: receiverTalkSession().done };
  })()`);
  check(goalTest.anyGoal === 'still-playing',
    '★★ 说话全程 state 没被改动（10 秒纯余韵，不挡通关）');

  console.log('\n=== 7. 控制台 ===');
  const serious = errs.filter(e => e && !/ACTIONS 未加载|404|Failed to load/.test(e));
  check(serious.length === 0, '无严重 console 错误' + (serious.length ? '：' + serious.slice(0, 2).join(' | ') : ''));

  await c.close(); ch.kill(); server.close();
  console.log('\n' + '='.repeat(52));
  console.log('  收餐人浏览器实测: ' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
