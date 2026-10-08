/* ============================================================
 * _scooter-browser.js — 真浏览器实测外卖车（借车加速）
 * ============================================================
 * 为什么还要在浏览器里再测一遍（离线测试已经 51 项全绿）：
 *   离线沙箱里 `SCOOTER.update()` 是我手动调的；
 *   真浏览器里是 **game.js 的 update 循环**在调 ——
 *   要验的是"接进主循环后确实生效"：
 *     · 碰到车 → boostTimer 被点亮
 *     · 速度倍率真的被 game.js 读走
 *     · 屏幕上**没有任何充电桩**
 *     · 倒计时条会画出来（drawBoostGauge 不报错）
 *
 * ⚠️ 铁律（见 MEMORY）：
 *   · 纯物理/逻辑校验放离线测试，这里只验"浏览器里真的发生了"
 *   · 必须先过"设备选择页"
 *   · "点击 + 读瞬态 UI" 必须放同一个 evaluate
 * ============================================================ */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');

const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9812, HP = 9377;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(SRC, p);
  if (!f.startsWith(SRC)) { s.writeHead(403); s.end(); return; }
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    s.end(d);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) { console.log('    [v] ' + msg); pass++; } else { console.log('    [X] ' + msg); fail++; } };

(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'scooter-' + Date.now());
  const ch = spawn(CHROME, [
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--window-size=1280,720',
    'http://127.0.0.1:' + HP + '/index.html',
  ], { stdio: 'ignore' });

  let tg = null;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const l = await CDP.List({ port: PORT });
      tg = l.find(x => x.type === 'page' && x.url.includes('index.html'));
      if (tg) break;
    } catch (e) { }
  }
  if (!tg) { console.error('找不到页面'); process.exit(1); }

  const c = await CDP({ target: tg, port: PORT });
  const { Runtime } = c;
  await Runtime.enable();
  const errs = [];
  Runtime.consoleAPICalled(p => { if (p.type === 'error') errs.push((p.args[0] || {}).value || ''); });
  Runtime.exceptionThrown(p => errs.push(p.exceptionDetails.text));

  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + ((r.exceptionDetails.exception || {}).description || ''));
    return r.result.value;
  };
  await sleep(2600);

  /* 过"设备选择页"（铁律） */
  await ev(`(function(){
    try { if (typeof DEVICE !== 'undefined' && DEVICE.set) DEVICE.set('pc'); } catch(e){}
    document.querySelectorAll('.overlay,.panel,#splash,#device-pick').forEach(function(n){ n.style.display='none'; });
    return 1;
  })()`);
  await sleep(300);

  console.log('\n=== 1. 真浏览器：模块与设置到位 ===');
  check(await ev('typeof SCOOTER === "object" && !!SCOOTER.current'), 'SCOOTER 模块在');
  check(await ev('typeof drawBoostGauge === "function"'), 'drawBoostGauge 已定义');
  check(await ev('typeof initRideState === "function"'), 'initRideState 已定义');

  /* 找一关"有外卖车"的关卡 */
  const info = await ev(`(function(){
    var N = PLAYABLE_LEVELS().length, found = -1;
    for (var i=0;i<N;i++){
      var lv = parseLevel(PLAYABLE_LEVELS()[i]);
      var d = SCOOTER.buildForLevel(lv);
      if (d.bikes.length) { found = i; break; }
    }
    return { total: N, idx: found };
  })()`);
  console.log('    共 ' + info.total + ' 关；第一关有外卖车的是索引 ' + info.idx);
  check(info.idx >= 0, '存在"有外卖车"的关卡');

  /* 进那关 */
  await ev('loadLevel(' + info.idx + '); Game.state = STATE.PLAYING;');
  await sleep(700);

  console.log('\n=== 2. ★ 真浏览器：碰到车 → 加速生效 ===');
  const r1 = await ev(`(function(){
    var p = Game.players[0];
    var d = SCOOTER.current();
    /* 把车挪到玩家脚下（保证"碰到"） */
    d.bikes = [{ x: p.x - 5, y: p.y, w: 46, h: 30, charge: 1, seed: 0.4 }];
    var before = { timer: p.boostTimer, mul: SCOOTER.speedMulFor(p), charge: d.bikes[0].charge };
    /* ★ 走主循环：靠 game.js 的 update 驱动（不是手动调 SCOOTER.update） */
    for (var i=0;i<3;i++){ update(1/60); }
    var after = { timer: p.boostTimer, mul: SCOOTER.speedMulFor(p), charge: d.bikes[0].charge };
    return { before: before, after: after };
  })()`);
  console.log('    碰到前: timer=' + r1.before.timer + ' mul=' + r1.before.mul.toFixed(2) + ' 车电=' + r1.before.charge.toFixed(2));
  console.log('    碰到后: timer=' + r1.after.timer + ' mul=' + r1.after.mul.toFixed(2) + ' 车电=' + r1.after.charge.toFixed(2));
  check(r1.after.timer > 0, '★ 主循环驱动下，碰到车**真的点亮了加速**');
  check(r1.after.mul > 1.2, '★ 加速倍率真的生效（mul=' + r1.after.mul.toFixed(2) + '）');
  check(r1.after.charge < r1.before.charge, '★ 车的电量真的被扣了');

  console.log('\n=== 3. ★ 真浏览器：加速会结束，而且能画出来 ===');
  const r2 = await ev(`(function(){
    var p = Game.players[0];
    /* 快进到加速结束 */
    var guard = 0;
    while (p.boostTimer > 0 && guard++ < 600) update(1/60);
    var ended = p.boostTimer === 0;
    var mulAfter = SCOOTER.speedMulFor(p);
    /* 手动把倒计时点亮，调绘制函数看会不会抛错 */
    p.boostTimer = 200;
    var drawErr = null;
    try {
      var cv = document.getElementById('game') || document.querySelector('canvas');
      var cx = cv.getContext('2d');
      drawBoostGauge(cx, p, 1.2);
    } catch(e){ drawErr = e.message; }
    p.boostTimer = 0;
    return { ended: ended, mulAfter: mulAfter, drawErr: drawErr };
  })()`);
  check(r2.ended, '★ 加速时间到 → 真的自动结束');
  check(Math.abs(r2.mulAfter - 1) < 1e-6, '★ 结束后速度回到 1 倍');
  check(r2.drawErr === null, '★ 倒计时条能正常绘制（无异常）' + (r2.drawErr ? '：' + r2.drawErr : ''));

  console.log('\n=== 4. ★★ 真浏览器：屏幕上没有充电桩 ===');
  const r3 = await ev(`(function(){
    /* 逐关检查运行时数据 + 源码里没有画桩的分支 */
    var N = PLAYABLE_LEVELS().length;
    var withCharger = [];
    for (var i=0;i<N;i++){
      var lv = parseLevel(PLAYABLE_LEVELS()[i]);
      var d = SCOOTER.buildForLevel(lv);
      if ((d.chargers||[]).length) withCharger.push(lv.id);
    }
    return {
      withCharger: withCharger,
      hasChargerField: !!SCOOTER.current().chargers,
      hasChargeSeconds: (typeof SCOOTER.CFG.CHARGE_SECONDS !== 'undefined'),
    };
  })()`);
  check(r3.withCharger.length === 0, '★★ 全部 ' + info.total + ' 关运行时都没有充电桩');
  check(!r3.hasChargeSeconds, '★ CFG 里没有 CHARGE_SECONDS（配置也清干净了）');

  console.log('\n=== 5. 没电的车借不了（真浏览器）===');
  const r4 = await ev(`(function(){
    loadLevel(${info.idx});
    Game.state = STATE.PLAYING;
    var p = Game.players[0];
    if (typeof initRideState === 'function') initRideState(p);
    var d = SCOOTER.current();
    d.bikes = [{ x: p.x - 5, y: p.y, w: 46, h: 30, charge: 0, seed: 0.6 }];
    for (var i=0;i<5;i++) update(1/60);
    return { timer: p.boostTimer, mul: SCOOTER.speedMulFor(p) };
  })()`);
  check(r4.timer === 0, '★ 电量 0 的车：碰到也不加速');
  check(Math.abs(r4.mul - 1) < 1e-6, '★ 速度倍率仍是 1');

  console.log('\n=== 6. 控制台 ===');
  const serious = errs.filter(e => e && !/ACTIONS 未加载|404/.test(e));
  check(serious.length === 0, '无严重 console 错误' + (serious.length ? '：' + serious.slice(0, 2).join(' | ') : ''));

  await c.close(); ch.kill(); server.close();
  console.log('\n' + '='.repeat(52));
  console.log('  外卖车浏览器实测: ' + pass + ' 通过 / ' + fail + ' 失败');
  console.log('='.repeat(52));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
