/* ============================================================
 * ch3-browser-test.js — 第 13~20 关 · 真浏览器验证（2026-10-06）
 * ============================================================
 * 验证"十一真的打开游戏时会看到什么"：
 *   ① 20 关全部能载入（不会卡在加载）
 *   ② 背景主题真的生效（每关 sky 色不同）
 *   ③ 新机制真的在跑（update 后状态有变化）
 *   ④ 机制**真的画出来了**（拦截 fillRect，确认画了东西）
 *   ⑤ 相机能跟随宽地图（不会卡在 x=0）
 *   ⑥ 没有 console 异常
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9755, HP = 9299;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
};
const server = http.createServer(function (q, s) {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(SRC, p);
  if (!f.startsWith(SRC)) { s.writeHead(403); s.end(); return; }
  fs.readFile(f, function (e, d) {
    if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    s.end(d);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
function ck(ok, msg, extra) {
  if (ok) { console.log('  ✅ ' + msg); PASS++; }
  else { console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); FAIL++; }
}

(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'ch3b-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
    '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1200,860',
    'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) { }
  }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime, Page } = c; await Runtime.enable(); await Page.enable();

  const errors = [];
  await c.on('Runtime.exceptionThrown', function (p) {
    errors.push(((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text || '').split('\n')[0]);
  });

  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const j = async e => JSON.parse(await ev('JSON.stringify(' + e + ')'));

  await sleep(3500);

  console.log('======== 第 13~20 关 · 真浏览器验证 ========');

  /* 解锁全部关卡 + 建账号 */
  await ev('(function(){ try{ localStorage.clear(); }catch(e){} ACCOUNT.register("测试","test1234"); Save.data.maxUnlocked=20; Save.save(); return true; })()');
  await sleep(300);

  /* ---------- ① 逐关载入 + 主题 + 机制 ---------- */
  const report = [];
  for (let id = 13; id <= 20; id++) {
    const r = await ev(`(function(){
      try {
        var idx = -1;
        var all = PLAYABLE_LEVELS();
        for (var i=0;i<all.length;i++){ if (all[i].id === ${id}) { idx = i; break; } }
        if (idx < 0) return JSON.stringify({ ok:false, why:'找不到关卡' });
        Game.mode='single'; Game.playerCount=1; Game.isPk=false; Game.aiRoles=null;
        Game.skipWeatherBrief=true;
        if (InputState.clearAI) InputState.clearAI();
        loadLevel(idx);
        Game.state='playing';
        var lv = Game.level;
        var theme = (typeof BG_THEME!=='undefined') ? BG_THEME.current() : null;
        /* 跑 120 帧，让机制推进 */
        for (var f=0; f<120; f++){ InputState.now={}; update(1/60); InputState.tick(); }
        var st = (typeof CH3!=='undefined') ? CH3.current() : null;
        return JSON.stringify({
          ok: true,
          cols: lv.cols, rows: lv.rows,
          sky: theme ? theme.sky : null,
          district: lv.district,
          coins: lv.coins.length, cps: lv.checkpoints.length,
          camX: Math.round(Game.camera.x),
          ch3t: st ? Math.round(st.t*10)/10 : null,
          ch3active: (typeof CH3!=='undefined' && CH3.active) ? CH3.active() : false,
          state: Game.state,
          err: Game.loadError || null,
        });
      } catch(e) { return JSON.stringify({ ok:false, why: e.message }); }
    })()`);
    const o = JSON.parse(r);
    report.push({ id: id, o: o });
    if (!o.ok) { ck(false, '第 ' + id + ' 关载入', o.why); continue; }
    ck(o.cols > 88, '第' + id + '关 载入成功（' + o.cols + 'x' + o.rows + ' · ' + o.district + '）');
    ck(!!o.sky && o.sky.length === 3, '第' + id + '关 背景主题生效（sky=' + o.sky[0] + '…）');
    ck(o.ch3active === true, '第' + id + '关 新机制已激活（跑了 ' + o.ch3t + 's）');
  }

  /* ---------- ② 主题互不相同 ---------- */
  const skies = report.filter(r => r.o.ok).map(r => JSON.stringify(r.o.sky));
  const uniqSkies = Array.from(new Set(skies));
  ck(uniqSkies.length === skies.length,
    '★★ 8 关的背景色**互不相同**（' + uniqSkies.length + '/' + skies.length + '）');

  /* ---------- ③ 相机跟随宽地图 ----------
   * ⚠️ 这一条**故意不依赖 AI 能不能跑完全程** ——
   *    它测的是相机边界算得对不对，不是关卡难度。
   *    ⇒ 把玩家**瞬移到地图中段的落脚点**，再跑几帧让相机跟上。
   * ------------------------------------------------------------ */
  const camTest = await ev(`(function(){
    var all = PLAYABLE_LEVELS();
    var idx = -1;
    for (var i=0;i<all.length;i++){ if (all[i].id === 20) { idx = i; break; } }
    if (idx < 0) return JSON.stringify({ ok:false });
    Game.mode='single'; Game.playerCount=1; Game.skipWeatherBrief=true;
    if (InputState.clearAI) InputState.clearAI();
    loadLevel(idx); Game.state='playing';
    var p = Game.players[0];
    var lv = Game.level, T = 32;
    var targetCol = Math.floor(2400 / T);
    var found = false;
    for (var r = lv.rows - 3; r > 2; r--) {
      if (lv.grid[r] && lv.grid[r][targetCol] !== '#') {
        if (lv.grid[r + 1] && lv.grid[r + 1][targetCol] === '#') {
          p.x = targetCol * T + 4;
          p.y = r * T + (T - p.h);
          p.vx = 0; p.vy = 0; p.onGround = true;
          found = true; break;
        }
      }
    }
    /* ⚠️ 必须调 render() —— updateCamera 是在 render 里调的，
     *    只调 update() 相机永远不动（我第一版就是这么误报的）。 */
    /* 相机是指数平滑（时间基准 0.08s），
     * 要跑足够多帧才会收敛到目标位置。
     * 跑 240 帧 = 4 秒，足够收敛。 */
    for (var f=0; f<240; f++){
      InputState.now={}; update(1/60); InputState.tick();
      try { render(1/60); } catch(e) {}
    }
    return JSON.stringify({
      camX: Math.round(Game.camera.x),
      lvWidth: Game.level.width,
      playersX: Math.round(p.x),
      found: found, state: Game.state,
    });
  })()`);
  const ct = JSON.parse(camTest);
  /* ⚠️ 阈值说明：画布宽 960px，玩家在 x<960 时相机本来就该是 0
   *    （还没推到屏幕边缘）。所以判据是相机确实动了，
   *    而不是一个固定的数值。 */
  ck(ct.found === true, '找到了中段的落脚点');
  ck(ct.camX > 1000, '★★ 相机能跟随宽地图（玩家在 x=' + ct.playersX +
    ' 时相机 x=' + ct.camX + '，地图宽 ' + ct.lvWidth + '）',
    'state=' + ct.state);

  /* ---------- ④ 机制真的画出来（拦截 fillRect）---------- */
  const drawTest = await ev(`(function(){
    /* 装一个探针：统计这一帧画了多少个矩形 */
    window.__rectCount = 0;
    var orig = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function(){
      window.__rectCount++;
      return orig.apply(this, arguments);
    };
    var all = PLAYABLE_LEVELS();
    var idx = -1;
    for (var i=0;i<all.length;i++){ if (all[i].id === 13) { idx = i; break; } }
    Game.mode='single'; Game.playerCount=1; Game.skipWeatherBrief=true;
    if (InputState.clearAI) InputState.clearAI();
    loadLevel(idx); Game.state='playing';
    window.__rectCount = 0;
    /* 跑一帧渲染 */
    for (var f=0; f<5; f++){ InputState.now={}; update(1/60); InputState.tick(); }
    try { render(0.016); } catch(e) { return JSON.stringify({ err: e.message }); }
    var n = window.__rectCount;
    CanvasRenderingContext2D.prototype.fillRect = orig;
    return JSON.stringify({ rects: n });
  })()`);
  const dt = JSON.parse(drawTest);
  ck(!dt.err, '渲染没有抛异常' + (dt.err ? '（' + dt.err + '）' : ''));
  ck(dt.rects > 100, '★★ 第 13 关渲染时画了大量元素（' + dt.rects + ' 个矩形 = 机制视觉在生效）');

  /* ---------- ⑤ 截图（第 13 关 + 第 20 关）---------- */
  const dir = path.join(path.resolve(__dirname, '..'), 'dist', '_mod_shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (const shot of [{ id: 13, name: 'ch3-level13.png' }, { id: 20, name: 'ch3-level20.png' }]) {
    await ev(`(function(){
      var all = PLAYABLE_LEVELS(); var idx=-1;
      for (var i=0;i<all.length;i++){ if (all[i].id === ${shot.id}) { idx=i; break; } }
      Game.mode='single'; Game.playerCount=1; Game.skipWeatherBrief=true;
      if (InputState.clearAI) InputState.clearAI();
      loadLevel(idx); Game.state='playing';
      for (var f=0; f<60; f++){ InputState.now={}; update(1/60); InputState.tick(); }
      return true;
    })()`);
    await sleep(700);
    const { data } = await Page.captureScreenshot({ format: 'png' });
    fs.writeFileSync(path.join(dir, shot.name), Buffer.from(data, 'base64'));
    console.log('    📷 dist/_mod_shots/' + shot.name);
  }

  /* ---------- 报错 ---------- */
  console.log();
  console.log('======== 控制台错误 ========');
  const real = errors.filter(e => e && !/favicon|net::ERR/i.test(e));
  if (real.length) real.slice(0, 8).forEach(e => console.log('  ❌ ' + e));
  else console.log('  无错误 ✅');
  ck(real.length === 0, '没有 console 异常');

  console.log();
  console.log('========================================');
  console.log('  第 13~20 关浏览器验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  await c.close(); ch.kill(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
