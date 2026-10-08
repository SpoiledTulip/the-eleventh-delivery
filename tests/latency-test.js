/* ============================================================
 * latency-test.js — 延迟量化诊断
 * ============================================================
 * 把"延迟"拆成三块分别测量，找出真正的大头：
 *
 *   A. 本地操作延迟：按键 → 角色位置变化（应 < 32ms，即 2 帧内）
 *   B. 单帧耗时：update + render 各占多少（看是否渲染过重）
 *   C. 网络往返：一轮轮询的真实耗时（联机延迟的主要来源）
 *
 * 用真实 Chrome 跑，因为要测真实渲染性能。
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
const ROOT = SRC;   // ← 迁移后：源码在 src/ 下
const HTTP_PORT = 8919;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  var f = path.join(ROOT, p);
  fs.readFile(f, function (e, d) {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function line(t) { console.log(t); }

(async function main() {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html';

  const ud = path.join(require('os').tmpdir(), 'lat-' + Date.now());
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=9401', '--user-data-dir=' + ud,
    '--window-size=1280,800', URL,
  ], { stdio: 'ignore' });

  let cl;
  for (let i = 0; i < 40; i++) { await sleep(300); try { cl = await CDP({ port: 9401 }); break; } catch (e) {} }
  if (!cl) { console.log('X 连不上 Chrome'); ch.kill(); process.exit(1); }
  try {
    const ts = await CDP.List({ port: 9401 });
    const w = ts.filter(t => t.type === 'page').find(t => t.url && t.url.indexOf('index.html') >= 0);
    if (w && w.id !== cl._targetId) { await cl.close(); cl = await CDP({ port: 9401, target: w.id }); }
  } catch (e) {}

  const { Runtime } = cl;
  await Runtime.enable();
  async function ev(e) {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  }

  await sleep(3500);

  line('延迟量化诊断');
  line('='.repeat(56));

  /* ---------- A. 本地操作延迟 ---------- */
  line('\n=== A. 本地操作延迟（按键 → 角色移动）===');
  /* 进入单人游戏 */
  await ev(`(function(){
    Game.mode='local'; Game.playerCount=1; Game.pickRole='kangaroo';
    loadLevel(0); Game.state='playing';
    return true;
  })()`);
  await sleep(800);

  /* 在页面里测：记录按下时刻的角色 x，然后看多少毫秒后 x 变了 */
  var localLat = await ev(`(function(){
    return new Promise(function(resolve){
      var k = Game.players[0];
      InputState.clear();
      var t0 = performance.now();
      var x0 = k.x;
      InputState.setKey('ArrowRight', true);
      var frames = 0, firstMoveAt = -1;
      function watch(){
        frames++;
        if (firstMoveAt < 0 && k.x > x0 + 0.05) {
          firstMoveAt = performance.now() - t0;
          InputState.setKey('ArrowRight', false);
          resolve({ ms: Math.round(firstMoveAt*100)/100, frames: frames });
          return;
        }
        if (frames > 120) { InputState.setKey('ArrowRight', false); resolve({ ms: -1, frames: frames }); return; }
        requestAnimationFrame(watch);
      }
      requestAnimationFrame(watch);
    });
  })()`);
  line('  按键到角色开始移动: ' + localLat.ms + ' ms（' + localLat.frames + ' 帧内）');
  line('  参考：一帧 60fps = 16.7ms。若 > 33ms 说明有输入采样延迟');

  /* ---------- B. 单帧耗时拆解 ---------- */
  line('\n=== B. 单帧耗时拆解（update / render 各占多少）===');
  var frameCost = await ev(`(function(){
    Game.state='playing';
    var ups=[], rds=[];
    var origUpdate=null, origRender=null;
    /* 直接采样：连续测 60 帧的 update 与 render 耗时 */
    return new Promise(function(resolve){
      var n=0;
      function tick(){
        n++;
        if (n>60) {
          var avg=function(a){ return a.length? a.reduce(function(x,y){return x+y;},0)/a.length : 0; };
          resolve({
            update: Math.round(avg(ups)*100)/100,
            render: Math.round(avg(rds)*100)/100,
            fps: Math.round(Game.frame / ((performance.now()-t0)/1000))
          });
          return;
        }
        var t0=performance.now();
        try { update(1/60); } catch(e){}
        ups.push(performance.now()-t0);
        var t1=performance.now();
        try { render(1/60); } catch(e){}
        rds.push(performance.now()-t1);
        requestAnimationFrame(tick);
      }
      var t0=performance.now();
      requestAnimationFrame(tick);
    });
  })()`);
  line('  update 平均: ' + frameCost.update + ' ms/帧');
  line('  render 平均: ' + frameCost.render + ' ms/帧');
  line('  合计: ' + (Math.round((frameCost.update + frameCost.render)*100)/100) + ' ms/帧');
  line('  理论最高帧率: ' + Math.round(1000 / (frameCost.update + frameCost.render)) + ' fps');

  /* ---------- C. 粒子/绘制对象数量 ---------- */
  line('\n=== C. 渲染负载 ===');
  var load = await ev(`(function(){
    var lv = Game.level;
    return {
      solids: lv.solids ? lv.solids.length : 0,
      coins: lv.coins ? lv.coins.length : 0,
      enemies: lv.enemies ? lv.enemies.length : 0,
      particles: Game.particles.length,
      canvasW: Game.canvas.width, canvasH: Game.canvas.height,
      offscreenCanvas: document.querySelectorAll('canvas').length
    };
  })()`);
  line('  实体: 固体块 ' + load.solids + ' / 金币 ' + load.coins + ' / 敌人 ' + load.enemies);
  line('  粒子: ' + load.particles);
  line('  画布: ' + load.canvasW + 'x' + load.canvasH + '，页面上共 ' + load.offscreenCanvas + ' 个 canvas');

  /* ---------- D. 检查每帧是否重绘了不该重绘的东西 ---------- */
  line('\n=== D. 渲染热点检查 ===');
  var hotspots = await ev(`(function(){
    var out = {};
    /* 是否每帧都创建新对象（GC 压力） */
    out.particlesPerFrame = Game.particles.length;
    /* 是否每帧都调用 getImageData / createLinearGradient 等昂贵操作 */
    var src = '';
    try { src = render.toString(); } catch(e){}
    out.hasGradient = src.indexOf('createLinearGradient') >= 0 || src.indexOf('createRadialGradient') >= 0;
    out.hasGetImageData = src.indexOf('getImageData') >= 0;
    out.hasShadowBlur = src.indexOf('shadowBlur') >= 0;
    out.hasFilter = src.indexOf('ctx.filter') >= 0;
    /* 文字绘制数量（昂贵操作） */
    out.textCalls = (src.match(/fillText/g) || []).length;
    return out;
  })()`);
  line('  使用渐变: ' + hotspots.hasGradient);
  line('  使用 getImageData: ' + hotspots.hasGetImageData + '（最贵的操作之一）');
  line('  使用 shadowBlur: ' + hotspots.hasShadowBlur + '（第二贵）');
  line('  使用 ctx.filter: ' + hotspots.hasFilter);
  line('  fillText 调用点: ' + hotspots.textCalls + ' 处');

  /* ---------- 总结 ---------- */
  line('\n' + '='.repeat(56));
  line('  诊断结论');
  line('='.repeat(56));
  var frameTotal = frameCost.update + frameCost.render;
  if (localLat.ms >= 0 && localLat.ms > 33) {
    line('  ⚠️ 本地操作延迟 ' + localLat.ms + 'ms 偏高（>33ms）');
    line('     → 可能是输入在帧首采样、或物理有缓冲。需要查 input→physics 路径');
  } else {
    line('  ✅ 本地操作延迟 ' + localLat.ms + 'ms，正常（1-2 帧内响应）');
  }
  if (frameTotal > 10) {
    line('  ⚠️ 单帧合计 ' + Math.round(frameTotal*100)/100 + 'ms 偏重（>10ms）');
    line('     → 渲染或物理是瓶颈，需要优化');
  } else {
    line('  ✅ 单帧合计 ' + Math.round(frameTotal*100)/100 + 'ms，很轻');
  }

  try { await cl.close(); } catch (e) {}
  ch.kill(); server.close(); process.exit(0);
})().catch(e => { console.log('崩溃: ' + (e && e.stack || e)); process.exit(1); });
