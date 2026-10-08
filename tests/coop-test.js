/* ============================================================
 * coop-test.js — 联机双人协作真实测试（两个 Chrome 实例）
 * ============================================================
 * 验证十一反馈的两个问题是否修好：
 *   1. 「副骑手动不了」  → 客人按键能否真的传到房主并驱动角色
 *   2. 「看主骑手一卡一卡」→ 插值是否基于时间（帧率无关）
 *
 * 做法：开两个真实 Chrome（房主 / 客人），都打开同一个 URL，
 * 真实地建房 → 加入 → 客人按键 → 检查房主那边的客人角色是否移动。
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
const HTTP_PORT = 8903;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
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
const URL = 'http://127.0.0.1:' + HTTP_PORT + '/index.html';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
let PASS = 0, FAIL = 0;
function check(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✅ ' + name); }
  else { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* 起一个 Chrome 实例并连上 CDP */
async function launch(port, userDir) {
  const ch = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--no-proxy-server',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDir,
    '--window-size=1280,800',
    URL,
  ], { stdio: 'ignore' });

  let client;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { client = await CDP({ port: port }); break; } catch (e) {}
  }
  if (!client) throw new Error('连不上 Chrome ' + port);

  try {
    const targets = await CDP.List({ port: port });
    const want = targets.filter(t => t.type === 'page')
      .find(t => t.url && t.url.indexOf('index.html') >= 0);
    if (want && want.id !== client._targetId) {
      await client.close();
      client = await CDP({ port: port, target: want.id });
    }
  } catch (e) {}

  await Promise.all([client.Runtime.enable(), client.Page.enable()]);
  const errs = [];
  client.Runtime.exceptionThrown(function (p) {
    var d = p.exceptionDetails;
    errs.push((d.exception && d.exception.description) || d.text);
  });
  client._errs = errs;
  return { chrome: ch, client: client };
}

function ev(client) {
  return async function (expr) {
    const r = await client.Runtime.evaluate({ expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    }
    return r.result.value;
  };
}

/* 彻底清空双方的输入状态 + 等待网络把那一次清空同步过去。
 * ⚠️ 这一步很重要：客人上报的按键要经过一个轮询周期才会到房主，
 * 如果不等同步就进下一节测试，上一个动作会"穿越"到下一节，
 * 导致断言莫名其妙地失败（实测会偶发）。 */
async function clearInputs(H, G, waitMs) {
  try { await H(`InputState.clear()`); } catch (e) {}
  try { await G(`InputState.clear()`); } catch (e) {}
  await sleep(waitMs || 1800);
  try { await H(`InputState.clear()`); } catch (e) {}
  try { await G(`InputState.clear()`); } catch (e) {}
  await sleep(300);
}

/* 把双方都重置到一个干净的 playing 状态。
 *
 * ⚠️ 为什么需要这个：
 * 前面的测试会让角色乱跑（可能掉坑、撞敌人、耗尽血量），
 * 游戏进入 gameover 后 update() 直接 return，角色当然不动，
 * 后续断言就会莫名其妙地失败。
 * 所以每一节测前都重新 loadLevel + 恢复血量，保证从同一个起点出发。
 */
async function resetGame(H, G) {
  await clearInputs(H, G, 1200);
  await Promise.all([
    H(`(function(){
      Game.mode='online'; Game.playerCount=2;
      loadLevel(0); Game.state='playing';
      Game.players.forEach(function(p){ p.hearts = 3; p.stun = 0; p.vx = 0; p.vy = 0; });
      return true;
    })()`),
    G(`(function(){
      Game.mode='online'; Game.playerCount=2;
      loadLevel(0); Game.state='playing';
      Game.players.forEach(function(p){ p.hearts = 3; p.stun = 0; p.vx = 0; p.vy = 0; });
      return true;
    })()`),
  ]);
  await sleep(1500);   // 等双方状态同步、位置稳定
}

/* 等某个条件成立（提高时序鲁棒性，避免固定 sleep 不够） */
async function waitFor(fn, timeoutMs, stepMs) {
  const t0 = Date.now();
  const step = stepMs || 200;
  while (Date.now() - t0 < timeoutMs) {
    let v;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    await sleep(step);
  }
  return null;
}

(async function main() {
  await new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(HTTP_PORT, '127.0.0.1', resolve);
  });
  console.log('本地服务器: ' + URL + '\n');

  const host = await launch(9351, path.join(require('os').tmpdir(), 'coop-host-' + Date.now()));
  const guest = await launch(9353, path.join(require('os').tmpdir(), 'coop-guest-' + Date.now()));
  const H = ev(host.client), G = ev(guest.client);

  console.log('=== 0. 等待两端 SDK ===');
  let hostReady = false, guestReady = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    if (!hostReady) hostReady = await H('!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud)');
    if (!guestReady) guestReady = await G('!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud)');
    if (hostReady && guestReady) { console.log('  两端 SDK 就绪（第 ' + (i + 1) + ' 秒）'); break; }
  }
  check('房主端 SDK 就绪', hostReady);
  check('客人端 SDK 就绪', guestReady);
  if (!hostReady || !guestReady) {
    console.log('\n⚠️ SDK 未就绪，后续测试无法进行');
    host.chrome.kill(); guest.chrome.kill(); server.close(); process.exit(1);
  }

  console.log('\n=== 1. 房主建房 ===');
  var code = await H(`hostRoom(window.CLOUD_CONFIG)`);
  check('房主成功创建房间', typeof code === 'string' && code.length === 6, String(code));
  if (typeof code !== 'string' || code.length !== 6) {
    host.chrome.kill(); guest.chrome.kill(); server.close(); process.exit(1);
  }
  console.log('     房间码 = ' + code);

  console.log('\n=== 2. 客人加入 + 双方进入游戏 ===');
  var joined = await G(`joinRoom('${code}', window.CLOUD_CONFIG)`);
  check('客人成功加入房间', joined === true, String(joined));

  /* 让双方都进入双人游戏模式（模拟点了"联机→开始"） */
  await H(`(function(){
    Game.mode = 'online'; Game.playerCount = 2;
    loadLevel(0); Game.state = 'playing';
    return true;
  })()`);
  await G(`(function(){
    Game.mode = 'online'; Game.playerCount = 2;
    loadLevel(0); Game.state = 'playing';
    return true;
  })()`);
  await sleep(2500);

  var hostState = await H(`({ mode: Game.mode, role: Net.role, players: Game.players.map(function(p){return p.role;}), state: Game.state })`);
  var guestState = await G(`({ mode: Game.mode, role: Net.role, players: Game.players.map(function(p){return p.role;}), state: Game.state })`);
  check('房主处于 online/host', hostState.role === 'host', JSON.stringify(hostState));
  check('客人处于 online/guest', guestState.role === 'guest', JSON.stringify(guestState));
  check('双方都进入 playing', hostState.state === 'playing' && guestState.state === 'playing');

  /* 测前重置到干净的 playing 状态 */
  await resetGame(H, G);

  console.log('\n=== 3. ★ 客人按键能否传到房主（修"副骑手动不了"）★ ===');
  /* 记录客人角色（dragon）在房主端的初始位置 */
  var dragonX = `(function(){ var d = Game.players.find(function(p){return p.role==='dragon';}); return d ? d.x : null; })()`;
  var beforeX = await H(dragonX);
  console.log('     客人角色初始 x = ' + beforeX);

  /* 客人按下"右"（模拟按键盘 D）*/
  await G(`InputState.clear(); InputState.setKey('KeyD', true)`);

  /* 等房主端的客人角色真的动起来（轮询周期 + 物理加速都需要时间） */
  var movedRight = await waitFor(async function () {
    var x = await H(dragonX);
    return (x != null && x > beforeX + 8) ? x : null;
  }, 6000);

  var guestSawInput = await G(`Net.localInput`);
  var afterX = await H(dragonX);
  console.log('     客人上报的按键 = ' + JSON.stringify(guestSawInput));
  console.log('     房主端客人角色 x = ' + beforeX + ' → ' + afterX);

  check('客人端采集到"右"按键', guestSawInput && guestSawInput.right === true, JSON.stringify(guestSawInput));
  check('房主端客人角色真的向右移动了', movedRight != null, beforeX + ' → ' + afterX);

  console.log('\n=== 4. 虚拟手柄（手机客人）也能驱动 ===');
  await resetGame(H, G);
  var beforeX2 = await H(dragonX);
  /* 模拟手机客人按虚拟手柄的"左"。
   *
   * ⚠️ 2026-10-06：必须先让客人端进入手机模式。
   *    新增的"电脑模式全程不许出现虚拟按键"逻辑会在 syncVisibility 里
   *    检查 DEVICE.isMobile()，电脑模式下虚拟键不显示、输入也不采集，
   *    所以这局必须显式切成手机模式（十一撤掉了手机端**入口**，
   *    但 DEVICE.set 机制还在，联机手机客人这条路依然要能走通）。 */
  await G(`(function(){ try { DEVICE.set('mobile'); } catch(e){} return true; })()`);
  await sleep(300);
  await G(`InputState.clear(); InputState.setKey('VK_P2_LEFT', true)`);

  var movedLeft = await waitFor(async function () {
    var x = await H(dragonX);
    return (x != null && x < beforeX2 - 8) ? x : null;
  }, 6000);

  var guestInput2 = await G(`Net.localInput`);
  var afterX2 = await H(dragonX);
  console.log('     客人上报（虚拟键）= ' + JSON.stringify(guestInput2));
  console.log('     房主端客人角色 x = ' + beforeX2 + ' → ' + afterX2);

  check('虚拟手柄按键被采集到', guestInput2 && guestInput2.left === true, JSON.stringify(guestInput2));
  check('房主端客人角色向左移动了', movedLeft != null, beforeX2 + ' → ' + afterX2);

  console.log('\n=== 5. ★ 客人看主骑手是否平滑（修"一卡一卡"）★ ===');
  await resetGame(H, G);
  /* 让房主一直往右跑 */
  await H(`InputState.setKey('ArrowRight', true)`);

  /* 先确认房主真的在动（否则测出来全是 0，没有意义） */
  var hostMoved = await waitFor(async function () {
    var x = await H(`(function(){var k=Game.players.find(function(p){return p.role==='kangaroo';});return k?k.x:null;})()`);
    return (x != null && x > 200) ? x : null;
  }, 6000);
  console.log('     房主端自身 x = ' + (hostMoved != null ? Math.round(hostMoved) : '未移动'));

  /* 等客人端也开始动起来，再采样（避免采到"还没收到第一个快照"的阶段） */
  await waitFor(async function () {
    var x = await G(`(function(){var k=Game.players.find(function(p){return p.role==='kangaroo';});return k?k.x:null;})()`);
    return (x != null && x > 140) ? x : null;
  }, 5000);

  var samples = [];
  for (var s = 0; s < 16; s++) {
    await sleep(110);
    var pos = await G(`(function(){
      var k = Game.players.find(function(p){return p.role==='kangaroo';});
      return k ? { x: Math.round(k.x*10)/10 } : null;
    })()`);
    if (pos) samples.push(pos);
  }
  await H(`InputState.setKey('ArrowRight', false)`);

  /* 计算相邻采样点的增量 */
  var diffs = [];
  for (var i = 1; i < samples.length; i++) diffs.push(samples[i].x - samples[i - 1].x);

  /* 分析：客人端看到的房主角色位置是否**均匀推进**（而不是一卡一卡）
   *
   * ⚠️ 判定方法要科学，不能用固定的像素阈值：
   * 增量大小取决于房主跑多快、采样间隔多长，写死 25px 会误判。
   * 正确做法：看增量的**波动性**——
   * 流畅时各次增量应该接近；卡顿时会出现"0.1 和 129"这种极端差。
   * 所以用「变异系数」（标准差 / 均值）来衡量：
   *   < 0.6   → 均匀流畅
   *   > 1.2   → 明显一卡一卡
   * 另外，开头允许 2 个采样点作为"插值起速"阶段，不参与判定。 */
  var moveDiffs = diffs.slice(2).filter(function (d) { return d > 0; });
  var mean = moveDiffs.reduce(function (a, b) { return a + b; }, 0) / (moveDiffs.length || 1);
  var variance = moveDiffs.reduce(function (a, d) { return a + (d - mean) * (d - mean); }, 0) / (moveDiffs.length || 1);
  var std = Math.sqrt(variance);
  var cv = mean > 0 ? std / mean : 99;

  console.log('     采样点（房主角色 x）:');
  console.log('     ' + samples.map(function (p) { return Math.round(p.x); }).join(', '));
  console.log('     增量: ' + diffs.map(function (d) { return d.toFixed(0); }).join(', '));
  console.log('     增量均值 ' + mean.toFixed(1) + 'px，标准差 ' + std.toFixed(1) +
              '，变异系数 ' + cv.toFixed(2));

  var moving = diffs.filter(function (d) { return d > 0; }).length;
  check('客人端能看到房主在移动', moving >= diffs.length * 0.8, moving + '/' + diffs.length);
  check('推进均匀（变异系数 < 0.8，不卡顿）', cv < 0.8, 'cv=' + cv.toFixed(2));

  console.log('\n=== 6. 帧率稳定性（房主端）===');
  var f1 = await H('Game.frame');
  await sleep(1000);
  var f2 = await H('Game.frame');
  var fps = f2 - f1;
  console.log('     房主端 1 秒内渲染 ' + fps + ' 帧');
  check('房主端帧率正常（>40fps）', fps > 40, fps + ' fps');

  console.log('\n=== 7. 清理 + 异常检查 ===');
  var cleaned = await H(`(function(){
    var c = Net.code;
    if (!c) return '无房间';
    return cloudClient.database.from('game_rooms').delete().eq('code', c)
      .then(function(r){ return r.error ? ('失败:'+JSON.stringify(r.error)) : ('已清理 '+c); })
      .catch(function(e){ return '异常:'+e; });
  })()`);
  console.log('     ' + cleaned);

  var hostErrs = host.client._errs.filter(function (e) { return e.indexOf('favicon') < 0; });
  var guestErrs = guest.client._errs.filter(function (e) { return e.indexOf('favicon') < 0; });
  check('房主端无 JS 异常', hostErrs.length === 0, hostErrs.slice(0, 2).join(' | '));
  check('客人端无 JS 异常', guestErrs.length === 0, guestErrs.slice(0, 2).join(' | '));

  console.log('\n' + '='.repeat(56));
  console.log('  联机双人测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('='.repeat(56));

  try { await host.client.close(); } catch (e) {}
  try { await guest.client.close(); } catch (e) {}
  host.chrome.kill(); guest.chrome.kill(); server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(function (e) {
  console.log('测试崩溃: ' + (e && e.stack || e));
  process.exit(1);
});
