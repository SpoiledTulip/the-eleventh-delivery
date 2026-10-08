/* ============================================================
 * mechanics2-test.js — 第三批机关测试
 *   断裂桥 / 炸弹 / 可炸墙 / 跷跷板 / 跳跳怪
 *
 * 测试原则（跟上一批一致）：
 *   测"实际行为"，不是"能不能解析"。
 *   每个机关都要验证它对玩家/世界的真实影响。
 * ============================================================ */

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

const vm = require('vm');

let pass = 0, fail = 0;
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; }
}

/* ---------- 搭一个带 canvas 的假浏览器 ---------- */
function noop() {}
const ctxProbe = new Proxy({}, {
  get: function (t, k) {
    if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
    if (k === 'measureText') return function () { return { width: 10 }; };
    return noop;
  }, set: function () { return true; },
});
const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
  window: {
    addEventListener: noop, requestAnimationFrame: function () { return 0; },
    Image: function () { setTimeout(function () { if (this.onerror) this.onerror(); }, 0); },
    AudioContext: function () {
      return {
        state: 'running', currentTime: 0,
        createOscillator: function () { return { frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }; },
        createGain: function () { return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }; },
        destination: {}, resume: noop,
      };
    },
  },
  document: {
    getElementById: function () { return { getContext: function () { return ctxProbe; }, width: 0, height: 0, style: {} }; },
    addEventListener: noop,
  },
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: noop,
  localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop },
};
sandbox.Image = sandbox.window.Image;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js']
  .forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
  });

const run = function (code) { return vm.runInContext(code, sandbox); };
run('initGame("game")');
/* ★ 解锁全部动作 ★（放在 initGame 之后 —— 它内部会 Save.load() 覆盖掉）
 * 游戏默认"动作逐步解锁"，新档一个动作都没有。
 * 这些测试测的是关卡/机关本身，不是解锁流程，所以先把动作全开。 */
run('Save.load(); Save.data.unlockedActions = ' +
    '["doublejump","wallslide","walljump","dash"]; Save.data.maxUnlocked = 99;');

/* 跑一帧（不带任何输入） */
function frame(keys) {
  const k = keys || {};
  const expr = 'InputState.now={};' +
    Object.keys(k).map(function (name) { return 'InputState.now.' + name + '=' + JSON.stringify(k[name]) + ';'; }).join('') +
    'update(0.016);InputState.tick();';
  run(expr);
}

/* ---------- 造一个测试关卡 ---------- */
/* 网格布局（行 23 是玩家站立层，行 24-25 是地板）：
 *   行 22:  T(炸弹) 放在地上，旁边是 b(可炸墙)
 *   行 23:  断裂桥 B
 */
function makeLevel(mapRows) {
  return run('parseLevel(' + JSON.stringify({
    id: 90, name: 'test', gravity: 0.62, map: mapRows,
  }) + ')');
}

var blank = [];
for (var i = 0; i < 26; i++) blank.push('.'.repeat(88));

function withRow(row, ch, col) {
  var r = blank.slice();
  var s = r[row].split('');
  s[col] = ch;
  r[row] = s.join('');
  return r;
}
function mapOf(items) {
  var r = blank.slice();
  items.forEach(function (it) {
    var s = r[it[0]].split('');
    for (var c = it[2]; c <= (it[3] != null ? it[3] : it[2]); c++) s[c] = it[1];
    r[it[0]] = s.join('');
  });
  // 铺地板
  var f = r[24].split(''); for (var c2 = 2; c2 <= 85; c2++) f[c2] = '#';
  r[24] = f.join('');
  var f2 = r[25].split(''); for (var c3 = 2; c3 <= 85; c3++) f2[c3] = '#';
  r[25] = f2.join('');
  return r;
}

function loadTest(mapRows) {
  var lv = makeLevel(mapRows);
  run('Game.level = ' + JSON.stringify(null) + ';');   // 先清掉引用
  // 把解析结果塞进沙箱
  sandbox.__testLevel = lv;
  run('Game.level = __testLevel;');
  run('Game.mode="local";Game.playerCount=2;Game.state="playing";Game.coinsTaken=0;Game.coinsRequired=0;Game.coinsTotal=0;');
  run('Game.players = [makePlayer("kangaroo", {x: 3*32, y: 23*32}), makePlayer("dragon", {x: 3*32+40, y: 23*32})];');
  run('Game.players[0].onGround=true; Game.players[1].onGround=true;');
  return lv;
}

/* ============================================================
 * 1. 断裂桥
 * ============================================================ */
console.log('\n--- 断裂桥 ---');
{
  // 桥在列 10-12，玩家在列 3
  var map = mapOf([[23, 'B', 10, 12]]);
  var lv = loadTest(map);
  check(lv.bridges.length === 3, '解析出 3 块断裂桥（' + lv.bridges.length + '）');
  check(run('collectSolids(Game.level).length') > 0, '断裂桥初始是实心可站的');

  // 把玩家放到桥上
  run('Game.players[0].x = 10*32; Game.players[0].y = 22*32;');
  for (var f = 0; f < 8; f++) frame({});
  check(run('Game.level.bridges[0].pressed') === true, '踩上去后开始倒计时（pressed=true）');

  // 等它塌
  var collapsed = false;
  for (var f2 = 0; f2 < 90; f2++) {
    frame({});
    if (run('Game.level.bridges[0].gone') === true) { collapsed = true; break; }
  }
  check(collapsed, '倒计时结束后桥塌了');

  // 塌了之后玩家应该掉下去（不再有碰撞）
  var yBefore = run('Game.players[0].y');
  for (var f3 = 0; f3 < 50; f3++) frame({});
  var yAfter = run('Game.players[0].y');
  check(yAfter > yBefore + 20, '桥塌后玩家掉下去了（y: ' + Math.round(yBefore) + ' → ' + Math.round(yAfter) + '）');

  // 恢复
  var respawned = false;
  for (var f4 = 0; f4 < 260; f4++) {
    frame({});
    if (run('Game.level.bridges[0].gone') === false && run('Game.level.bridges[0].respawn') === 0) { respawned = true; break; }
  }
  check(respawned, '一段时间后桥自动恢复');
}

/* ============================================================
 * 2. 炸弹 + 可炸墙
 * ============================================================ */
console.log('\n--- 炸弹 + 可炸墙 ---');
{
  // 炸弹在列 20，可炸墙在列 22-24
  var map = mapOf([[23, 'T', 20], [23, 'b', 22, 24]]);
  var lv = loadTest(map);
  check(lv.bombs.length === 1, '解析出 1 颗炸弹');
  var wallCount = run('Game.level.solids.filter(function(s){return s.destructible;}).length');
  check(wallCount === 3, '解析出 3 块可炸墙（' + wallCount + '）');
  check(run('Game.level.solids.filter(function(s){return s.destructible && !s.broken;}).length') === 3,
    '可炸墙初始是完好的（挡路）');

  // 玩家走过去碰炸弹
  run('Game.players[0].x = 20*32; Game.players[0].y = 22*32;');
  for (var f = 0; f < 6; f++) frame({});
  check(run('Game.level.bombs[0].lit') === true, '碰到炸弹 → 引信点燃');

  var fuseStart = run('Game.level.bombs[0].timer');
  check(fuseStart > 0, '引信开始倒计时（' + fuseStart + ' 帧）');

  // 等爆炸
  var exploded = false;
  for (var f2 = 0; f2 < 200; f2++) {
    frame({});
    if (run('Game.level.bombs[0].exploded') === true) { exploded = true; break; }
  }
  check(exploded, '引信烧完 → 炸弹爆炸');

  var broken = run('Game.level.solids.filter(function(s){return s.destructible && s.broken;}).length');
  check(broken === 3, '爆炸炸开了可炸墙（' + broken + '/3）');

  // 炸开后玩家能通过
  check(run('Game.level.solids.filter(function(s){return s.destructible && !s.broken;}).length') === 0,
    '可炸墙全部炸开后不再挡路');
}

/* 炸弹炸不炸得到远处的墙（半径限制） */
{
  var map = mapOf([[23, 'T', 20], [23, 'b', 60, 62]]);
  var lv = loadTest(map);
  run('Game.players[0].x = 20*32; Game.players[0].y = 22*32;');
  for (var f = 0; f < 200; f++) {
    frame({});
    if (run('Game.level.bombs[0].exploded')) break;
  }
  var broken = run('Game.level.solids.filter(function(s){return s.destructible && s.broken;}).length');
  check(broken === 0, '爆炸半径外的墙不受影响（正确，炸到 0 块）');
}

/* 炸弹炸死敌人 */
{
  var map = mapOf([[23, 'T', 20], [22, 'M', 21]]);
  var lv = loadTest(map);
  run('Game.players[0].x = 20*32; Game.players[0].y = 22*32;');
  for (var f = 0; f < 200; f++) {
    frame({});
    if (run('Game.level.bombs[0].exploded')) break;
  }
  check(run('Game.level.enemies[0].dead') === true, '爆炸范围内的敌人被炸死');
}

/* ============================================================
 * 3. 跷跷板（踩下即压沉的弹射板）
 * ============================================================ */
console.log('\n--- 跷跷板 ---');
{
  var map = mapOf([[23, 'V', 20]]);
  var lv = loadTest(map);
  check(lv.seesaws.length === 1, '解析出 1 个跷跷板');
  var s0 = run('Game.level.seesaws[0]');
  check(Math.abs(s0.angle) < 0.01, '初始是平的（angle≈0）');

  // 一个人站右端 → 右端下沉（angle 变正）
  run('Game.players[0].x = Game.level.seesaws[0].cx + 26;');
  run('Game.players[0].y = Game.level.seesaws[0].cy - 40;');
  run('Game.players[0].onGround = true;');
  run('Game.players[1].x = 3*32; Game.players[1].y = 23*32;');   // 另一个走远
  for (var f = 0; f < 60; f++) frame({});
  var ang1 = run('Game.level.seesaws[0].angle');
  check(ang1 > 0.3, '一个人站右端 → 右端沉下去（angle=' + ang1.toFixed(3) + '）');

  // 他走到左边 → 翻过来
  run('Game.players[0].x = Game.level.seesaws[0].cx - 26;');
  run('Game.players[0].y = Game.level.seesaws[0].cy - 40;');
  for (var f2 = 0; f2 < 60; f2++) frame({});
  var ang2 = run('Game.level.seesaws[0].angle');
  check(ang2 < -0.3, '走到左端 → 左端沉下去（angle=' + ang2.toFixed(3) + '）');

  // 两人各站一端 → 回平
  run('Game.players[1].x = Game.level.seesaws[0].cx + 26; Game.players[1].y = Game.level.seesaws[0].cy - 40;');
  run('Game.players[1].onGround = true;');
  var settled = -1;
  for (var f3 = 0; f3 < 200; f3++) {
    frame({});
    if (Math.abs(run('Game.level.seesaws[0].angle')) < 0.12) { settled = f3; break; }
  }
  check(settled >= 0, '两人各站一端 → 板子回平（第 ' + settled + ' 帧）');
}

/* 跷跷板弹射（双人配合的核心）
 *
 * 物理方向别搞反：
 *   甲压住【右端】→ 右端下沉 → 【左端抬起】→ 站在左端的乙被弹飞。
 *   （一开始我把测试写成"甲压左端、乙站右端"，那乙是在正在下沉的那端，
 *     自然弹不起来 —— 这不是代码 bug，是测试把方向弄反了。） */
{
  var map2 = mapOf([[23, 'V', 20]]);
  var lv2 = loadTest(map2);
  var s = run('Game.level.seesaws[0]');

  // 甲站右端（把右端压沉）
  run('Game.players[0].x = ' + (s.cx + 26) + ';');
  run('Game.players[0].y = ' + (s.cy - 40) + '; Game.players[0].onGround = true;');
  // 乙先站远处
  run('Game.players[1].x = 3*32; Game.players[1].y = 23*32; Game.players[1].onGround = true;');

  // 等右端沉下去（angle 变正）
  for (var f = 0; f < 60; f++) frame({});
  var angDown = run('Game.level.seesaws[0].angle');
  check(angDown > 0.3, '甲站右端 → 右端沉下去（angle=' + angDown.toFixed(3) + '）');

  // 乙站到【左端】（此时左端高高翘起）
  var surfL = run('seesawSurfaceY(Game.level.seesaws[0], ' + (s.cx - 26) + ')');
  run('Game.players[1].x = ' + (s.cx - 26) + ';');
  run('Game.players[1].y = ' + (surfL - 32 - 4) + '; Game.players[1].onGround = true;');

  // 甲一离开 → 右端变轻 → 左端落下（方向反了）。真正好用的配合次序见下方重测。
  // 重新来一遍，用"乙先站左端、甲后跳右端"这个正确次序：
  var map3 = mapOf([[23, 'V', 20]]);
  var lv3 = loadTest(map3);
  var s3 = run('Game.level.seesaws[0]');

  // 乙（player[1]）先站左端，把左端压沉
  run('Game.players[1].x = ' + (s3.cx - 26) + ';');
  run('Game.players[1].y = ' + (s3.cy - 40) + '; Game.players[1].onGround = true;');
  // 甲（player[0]）站远处
  run('Game.players[0].x = 3*32; Game.players[0].y = 23*32; Game.players[0].onGround = true;');

  for (var f2 = 0; f2 < 60; f2++) frame({});
  check(run('Game.level.seesaws[0].angle') < -0.3,
    '乙站左端 → 左端沉下去（angle=' + run('Game.level.seesaws[0].angle').toFixed(3) + '）');

  // 甲跳到右端（右端突然变重 → 板子翻转 → 左端被猛抬 → 乙被弹飞）
  var surfR3 = run('seesawSurfaceY(Game.level.seesaws[0], ' + (s3.cx + 26) + ')');
  run('Game.players[0].x = ' + (s3.cx + 26) + ';');
  run('Game.players[0].y = ' + (surfR3 - 32 - 4) + '; Game.players[0].onGround = true;');

  var launched = false, maxUp = 9999;
  var startY = run('Game.players[1].y');
  for (var f3 = 0; f3 < 90; f3++) {
    frame({});
    var vy = run('Game.players[1].vy');
    var y = run('Game.players[1].y');
    if (y < maxUp) maxUp = y;
    if (vy < -10) launched = true;
  }
  check(launched, '甲跳上另一端 → 乙被跷跷板弹飞（vy < -10）');
  var rise = startY - maxUp;
  check(rise > 190, '乙被弹起 ' + Math.round(rise) + 'px（超过二连跳上限 183px）');
}

/* ============================================================
 * 4. 跳跳怪
 * ============================================================ */
console.log('\n--- 跳跳怪 ---');
{
  // 跳跳怪在列 30，地面在行 23
  var map = mapOf([[23, 'j', 30]]);
  var lv = loadTest(map);
  check(lv.enemies.length === 1, '解析出 1 只跳跳怪');
  check(run('Game.level.enemies[0].type') === 'hopper', '类型是 hopper');

  // 玩家站远处，观察跳跳怪是否真的会跳
  run('Game.players[0].x = 3*32; Game.players[1].x = 3*32+40;');
  var minY = 9999, maxY = -9999;
  for (var f = 0; f < 300; f++) {
    frame({});
    var y = run('Game.level.enemies[0].y');
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (run('Game.level.enemies[0].dead')) break;
  }
  var range = maxY - minY;
  check(range > 40, '跳跳怪会周期性起跳（纵向活动范围 ' + Math.round(range) + 'px）');

  // 水平漂移
  var minX = 9999, maxX = -9999;
  for (var f2 = 0; f2 < 300; f2++) {
    frame({});
    var x = run('Game.level.enemies[0].x');
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  check(maxX - minX > 10, '跳跳怪会左右漂移（范围 ' + Math.round(maxX - minX) + 'px）');
}

/* 跳跳怪能被踩死 */
{
  var map = mapOf([[23, 'j', 30]]);
  var lv = loadTest(map);
  run('Game.level.enemies[0].hopTimer = 999;');   // 别让它跳走
  run('Game.players[0].x = Game.level.enemies[0].x;');
  run('Game.players[0].y = Game.level.enemies[0].y - 40;');
  run('Game.players[0].vy = 6;');
  run('Game.players[0].onGround = false;');
  for (var f = 0; f < 20; f++) {
    frame({});
    if (run('Game.level.enemies[0].dead')) break;
  }
  check(run('Game.level.enemies[0].dead') === true, '跳跳怪可以被踩死');
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n=========================================');
console.log(pass + ' 项通过, ' + fail + ' 项失败');
if (fail > 0) {
  console.log(fail + ' 项失败 ✗');
  process.exit(1);
}
console.log('第三批机关全部正常 ✓');
