/* ============================================================
 * pred-latency-test.js — 测量"客人端操作延迟"（预测是否真的生效）
 * ============================================================
 * 这是十一最关心的指标：客人按下键，多久看到自己的角色动？
 *
 * 对比：
 *   纯房主权威（旧）：键 → 上报 → 房主算 → 下发 → 插值 ≈ 330ms
 *   本地预测（新）  ：键 → 本地物理                        ≈ 16ms
 *
 * 测法：两个真实 Chrome，客人端按下键，量"本地角色位置何时变化"。
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
const HTTP_PORT = 8921;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png' };
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
const URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launch(port, tag) {
  const ud = path.join(require('os').tmpdir(), tag + '-' + Date.now());
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=' + port, '--user-data-dir=' + ud,
    '--window-size=1280,800', URL,
  ], { stdio: 'ignore' });
  let cl;
  for (let i = 0; i < 40; i++) { await sleep(300); try { cl = await CDP({ port: port }); break; } catch (e) {} }
  if (!cl) throw new Error('连不上 ' + port);
  try {
    const ts = await CDP.List({ port: port });
    const w = ts.filter(t => t.type === 'page').find(t => t.url && t.url.indexOf('index.html') >= 0);
    if (w && w.id !== cl._targetId) { await cl.close(); cl = await CDP({ port: port, target: w.id }); }
  } catch (e) {}
  await cl.Runtime.enable();
  return { ch: ch, cl: cl };
}
function mk(cl) {
  return async function (e) {
    const r = await cl.Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    return r.result.value;
  };
}

(async function main() {
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));

  const H = await launch(9411, 'lh');
  const G = await launch(9413, 'lg');
  const h = mk(H.cl), g = mk(G.cl);
  await sleep(3500);

  console.log('客人端操作延迟测量');
  console.log('='.repeat(56) + '\n');

  /* 建房 + 加入 */
  const code = await h('hostRoom(window.CLOUD_CONFIG)');
  await g(`joinRoom('${code}', window.CLOUD_CONFIG)`);
  await h(`Game.mode='online';Game.playerCount=2;loadLevel(0);Game.state='playing';true`);
  await g(`Game.mode='online';Game.playerCount=2;loadLevel(0);Game.state='playing';true`);
  await sleep(2500);

  const gs = await g(`({role:Net.role, players:Game.players.map(p=>p.role), state:Game.state})`);
  console.log('客人端状态: ' + JSON.stringify(gs));

  /* ⚠️ 关键测量：客人按下键 → 本地角色位置变化 */
  console.log('\n=== 测量：客人按键 → 本地角色开始移动 ===');
  var results = [];
  for (var trial = 0; trial < 5; trial++) {
    var r = await g(`(function(){
      return new Promise(function(resolve){
        /* 先复位：停下、清输入 */
        InputState.clear();
        var me = Game.players.find(function(p){ return p.role === 'dragon'; });
        if (!me) { resolve({err:'找不到客人角色'}); return; }
        me.vx = 0;
        var x0 = me.x;
        var t0 = performance.now();

        /* 按下"右" */
        InputState.setKey('KeyD', true);

        var frames = 0;
        function watch(){
          frames++;
          if (me.x > x0 + 0.05) {
            InputState.setKey('KeyD', false);
            resolve({ ms: Math.round((performance.now()-t0)*100)/100, frames: frames, moved: Math.round((me.x-x0)*10)/10 });
            return;
          }
          if (frames > 90) {
            InputState.setKey('KeyD', false);
            resolve({ ms: -1, frames: frames });
            return;
          }
          requestAnimationFrame(watch);
        }
        requestAnimationFrame(watch);
      });
    })()`);
    results.push(r);
    await sleep(600);
  }

  console.log('  5 次测量:');
  results.forEach(function (r, i) {
    console.log('    第' + (i+1) + '次: ' + (r.err || (r.ms + ' ms（' + r.frames + ' 帧内，位移 ' + r.moved + 'px）')));
  });

  var valid = results.filter(function (r) { return r && r.ms >= 0; });
  if (valid.length) {
    var avg = valid.reduce(function (a, r) { return a + r.ms; }, 0) / valid.length;
    console.log('\n  平均延迟: ' + (Math.round(avg * 100) / 100) + ' ms');

    console.log('\n' + '='.repeat(56));
    console.log('  结论');
    console.log('='.repeat(56));
    if (avg < 40) {
      console.log('  ✅ 客人操作延迟 ' + Math.round(avg) + 'ms —— 本地预测生效！');
      console.log('     （旧版纯房主权威约 330ms，现在快了约 ' + Math.round(330/Math.max(avg,1)) + ' 倍）');
    } else if (avg < 150) {
      console.log('  ⚠️ 延迟 ' + Math.round(avg) + 'ms，比预期高');
      console.log('     → 可能预测没生效，或路径上有额外等待');
    } else {
      console.log('  ❌ 延迟 ' + Math.round(avg) + 'ms，预测似乎完全没生效');
      console.log('     → 客人仍在等房主广播');
    }
  }

  /* 顺带验证：预测的位置和房主权威位置误差有多大（预测精度） */
  console.log('\n=== 预测精度：本地预测 vs 房主权威 ===');
  await g(`InputState.clear(); InputState.setKey('KeyD', true)`);
  await sleep(2000);
  var cmp = await g(`(function(){
    var me = Game.players.find(function(p){ return p.role === 'dragon'; });
    var st = Net.remoteState;
    var auth = null;
    if (st && st.players) {
      for (var i=0;i<st.players.length;i++) if (st.players[i].role === 'dragon') auth = st.players[i];
    }
    return {
      localX: me ? Math.round(me.x*10)/10 : null,
      authX: auth ? Math.round(auth.x*10)/10 : null,
      diff: (me && auth) ? Math.round(Math.abs(me.x - auth.x)*10)/10 : null
    };
  })()`);
  await g(`InputState.clear()`);
  console.log('  本地预测位置: ' + cmp.localX);
  console.log('  房主权威位置: ' + cmp.authX);
  console.log('  误差: ' + cmp.diff + ' px');
  if (cmp.diff !== null) {
    console.log(cmp.diff < 60
      ? '  ✅ 误差在容忍范围内（<60px），不会触发校正抖动'
      : '  ⚠️ 误差偏大（' + cmp.diff + 'px），会被缓慢拉回');
  }

  /* 清理 */
  await h(`(function(){
    var c = Net.code;
    if (!c) return 'ok';
    return cloudClient.database.from('game_rooms').delete().eq('code', c).then(function(){return 'cleaned';});
  })()`);

  try { await H.cl.close(); } catch (e) {}
  try { await G.cl.close(); } catch (e) {}
  H.ch.kill(); G.ch.kill(); server.close();
  process.exit(0);
})().catch(function (e) { console.log('崩溃: ' + (e && e.stack || e)); process.exit(1); });
