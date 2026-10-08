/* ============================================================
 * net-sim.js — 联机逻辑测试（不需要真实云服务）
 *
 * 做法：搭一个假的"云数据库"（内存里的一行记录），
 * 让两个独立沙箱（模拟房主和客人）分别跑 net.js 的轮询逻辑，
 * 验证：
 *   1. 房主能建房、生成房间码
 *   2. 客人能用房间码加入
 *   3. 房主的输入能传到客人（世界状态同步）
 *   4. 客人的按键能传到房主（客人能操控奶龙）
 *   5. 两人在线时游戏能跑起来不崩
 *
 * 这就是"没有真实网络也能验证联机逻辑"的办法。
 * 用法：node net-sim.js
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

/* ---------------- 假的云数据库 ---------------- */
/* 模拟 Supabase 风格的 from().select()/.insert()/.update() API */
function makeFakeCloud(sharedRows) {
  function matches(row, filters) {
    return filters.every(function (f) { return row[f.col] === f.val; });
  }
  function applyFilters(rows, filters) {
    return rows.filter(function (r) { return matches(r, filters); });
  }

  return {
    database: {
      from: function (table) {
        var filters = [];
        var pendingUpdate = null;
        var pendingInsert = null;
        var wantSelect = false;

        var builder = {
          select: function () { wantSelect = true; return builder; },
          insert: function (row) { pendingInsert = row; return builder; },
          update: function (patch) { pendingUpdate = patch; return builder; },
          delete: function () { return builder; },
          eq: function (col, val) { filters.push({ col: col, val: val }); return builder; },
          maybeSingle: function () {
            if (pendingInsert) {
              sharedRows.push(Object.assign({}, pendingInsert));
              return Promise.resolve({ data: wantSelect ? [pendingInsert] : null, error: null });
            }
            if (pendingUpdate) {
              var hit = applyFilters(sharedRows, filters);
              hit.forEach(function (r) { Object.assign(r, pendingUpdate); });
              return Promise.resolve({ data: hit.length ? hit : null, error: null });
            }
            var found = applyFilters(sharedRows, filters);
            return Promise.resolve({ data: found.length ? found[0] : null, error: null });
          },
          then: function (resolve, reject) {
            // 支持 await 不带 .select()/.maybeSingle() 的情况
            var result;
            if (pendingInsert) {
              var newRow = Object.assign({}, pendingInsert);
              sharedRows.push(newRow);
              result = { data: wantSelect ? [newRow] : null, error: null };
            } else if (pendingUpdate) {
              var hit = applyFilters(sharedRows, filters);
              hit.forEach(function (r) { Object.assign(r, pendingUpdate); });
              result = { data: wantSelect ? hit : null, error: null };
            } else {
              var found = applyFilters(sharedRows, filters);
              result = { data: wantSelect ? found : null, error: null };
            }
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      },
    },
  };
}

/* ---------------- 沙箱工厂 ---------------- */
function makeSandbox(cloudStub, name) {
  function noop() {}
  const ctxProbe = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    },
    set: function () { return true; },
  });

  const sandbox = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
    window: {
      addEventListener: noop,
      requestAnimationFrame: function () { return 0; },
      AudioContext: function () {
        return {
          state: 'running', currentTime: 0,
          createOscillator: function () {
            return { type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop };
          },
          createGain: function () {
            return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop };
          },
          destination: {}, resume: noop,
        };
      },
      // 假云 SDK：initCloud 会去找这个
      WorkBuddyCloud: {
        createWorkBuddyCloud: function () { return cloudStub; },
      },
    },
    document: { getElementById: function () { return { getContext: function () { return ctxProbe; }, width: 0, height: 0, style: {} }; }, addEventListener: noop },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; },   // 测试里手动推轮询，不用真定时器
    clearInterval: noop,
    localStorage: (function () {
      var store = {};
      return {
        getItem: function (k) { return store[k] === undefined ? null : store[k]; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; },
      };
    })(),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
  });
  sandbox.__name = name;
  return sandbox;
}

function run(sb, code) { return vm.runInContext(code, sb); }

/* ---------------- 测试 ---------------- */
let failed = 0;
function check(cond, msg) {
  if (cond) console.log('  [v] ' + msg);
  else { console.log('  [X] ' + msg); failed++; }
}

async function main() {
  console.log('联机逻辑测试（内存模拟云端）\n');

  // 共享的"云数据库"
  const rows = [];

  // 两个沙箱，用不同的 clientId
  const hostSb = makeSandbox(makeFakeCloud(rows), 'host');
  const guestSb = makeSandbox(makeFakeCloud(rows), 'guest');
  // 让两边 clientId 不同
  run(hostSb, 'localStorage.setItem("waimai_client_id", "client_host")');
  run(guestSb, 'localStorage.setItem("waimai_client_id", "client_guest")');

  run(hostSb, 'initGame("game")');
  run(guestSb, 'initGame("game")');

  // --- 1. 初始化云 ---
  run(hostSb, 'initCloud({endpoint:"https://x.test", publishableKey:"pk_test"})');
  run(guestSb, 'initCloud({endpoint:"https://x.test", publishableKey:"pk_test"})');
  check(run(hostSb, 'Net.clientId') === 'client_host', '房主 clientId 正确');
  check(run(guestSb, 'Net.clientId') === 'client_guest', '客人 clientId 正确');

  // --- 2. 房主建房 ---
  const code = await run(hostSb, 'hostRoom({endpoint:"https://x.test", publishableKey:"pk_test"})');
  check(typeof code === 'string' && code.length === 6, '房主生成了 6 位房间码: ' + code);
  check(rows.length === 1, '云端出现 1 条房间记录');
  check(rows[0].host_id === 'client_host', '房间的 host_id 正确');

  // --- 3. 客人加入 ---
  const joined = await run(guestSb, 'joinRoom("' + code + '", {endpoint:"https://x.test", publishableKey:"pk_test"})');
  check(joined === true, '客人成功加入房间');
  check(rows[0].guest_id === 'client_guest', '房间的 guest_id 已登记为客人');

  // --- 4. 客人加入错误房间码 ---
  const badJoin = await run(guestSb, 'joinRoom("ZZZZZZ", {endpoint:"https://x.test", publishableKey:"pk_test"})');
  check(badJoin === false, '错误房间码被拒绝');
  check(run(guestSb, 'Net.lastError').indexOf('不存在') >= 0, '错误提示正确: ' + run(guestSb, 'Net.lastError'));

  // --- 5. 房主开局 ---
  run(hostSb, 'Game.mode="online"; loadLevel(0); Game.state="playing"');
  run(guestSb, 'Game.mode="online"; loadLevel(0); Game.state="playing"');
  check(run(hostSb, 'Game.state') === 'playing', '房主进入游戏');
  check(run(guestSb, 'Game.state') === 'playing', '客人进入游戏');

  // --- 6. 房主跑几帧，把状态打包 ---
  for (let i = 0; i < 10; i++) {
    run(hostSb, 'InputState.setKey("ArrowRight", true); update(0.016); render(0.016); InputState.tick();');
  }
  const packed = run(hostSb, 'Net._outState');
  check(packed && packed.players && packed.players.length === 2, '房主打包了世界状态（含 2 个角色）');
  check(packed.players[0].x > 0, '房主里袋鼠已移动 x=' + Math.round(packed.players[0].x || 0));

  // --- 7. 房主轮询：把状态写进云端 ---
  await run(hostSb, 'hostPoll()');
  const cloudRow = rows[0];
  check(!!cloudRow.state, '云端已有世界状态');
  check(cloudRow.seq > 0, 'seq 已递增: ' + cloudRow.seq);

  // --- 8. 客人轮询：读到世界状态 ---
  await run(guestSb, 'guestPoll()');
  const guestRemote = run(guestSb, 'Net.remoteState');
  check(!!guestRemote, '客人读到了世界状态');
  check(guestRemote && guestRemote.players[0].x === cloudRow.state.players[0].x, '客人拿到的袋鼠 x 与房主一致');

  // --- 9. 客人上报按键 → 房主读到 → 驱动奶龙 ---
  run(guestSb, 'Net.localInput = {left:false, right:true, jump:true}');
  await run(guestSb, 'guestPoll()');
  check(rows[0].guest_input && rows[0].guest_input.right === true, '客人的按键已写入云端');
  await run(hostSb, 'hostPoll()');
  check(run(hostSb, 'InputState.now.KeyD') === true, '房主收到了客人的"右"键');
  check(run(hostSb, 'InputState.now.KeyW') === true, '房主收到了客人的"跳"键');

  // --- 10. 房主里奶龙确实动了 ---
  const dragonXBefore = run(hostSb, 'Game.players[1].x');
  for (let i = 0; i < 15; i++) {
    run(hostSb, 'update(0.016); render(0.016); InputState.tick();');
    // 每帧维持客人按键（模拟客人持续按住）
    run(hostSb, 'InputState.now.KeyD = true; InputState.now.KeyW = (Game.frame % 20 === 0);');
  }
  const dragonXAfter = run(hostSb, 'Game.players[1].x');
  check(dragonXAfter > dragonXBefore, '奶龙在房主端确实向右移动了 (' +
    Math.round(dragonXBefore) + ' → ' + Math.round(dragonXAfter) + ')');

  // --- 11. 客人渲染不崩（套用远端状态） ---
  try {
    run(guestSb, 'render(0.016)');
    check(true, '客人端渲染远端世界状态不崩溃');
    const gx = run(guestSb, 'Game.players[0].x');
    check(gx > 0, '客人端角色位置已同步 x=' + Math.round(gx));
  } catch (e) {
    check(false, '客人渲染崩溃: ' + e.message);
  }

  // --- 12. 房主状态里包含机关信息 ---
  const st2 = run(hostSb, 'packWorldState()');
  check(Array.isArray(st2.buttons), '世界状态包含按钮数组');
  check(Array.isArray(st2.doorOpen), '世界状态包含门开合数组');
  check(Array.isArray(st2.coinsTakenIdx), '世界状态包含已吃金币');

  // --- 13. 第二关（合作机关）能正确打包按钮 ---
  run(hostSb, 'Game.level = parseLevel(LEVELS_COOP[0]); Game.state="playing"');
  const st3 = run(hostSb, 'packWorldState()');
  check(st3.buttons.length === 2, '第二关打包了 2 个按钮');
  check(st3.doorOpen.length === 1, '第二关打包了 1 道门');

  // --- 14. 退出房间 ---
  await run(hostSb, 'leaveRoom()');
  check(run(hostSb, 'Net.role') === null, '房主退出后 role 清空');
  check(run(hostSb, 'Net.enabled') === false, '房主退出后联机关闭');

  console.log('\n=========================================');
  console.log(failed === 0 ? '全部通过 ✓' : (failed + ' 项失败 ✗'));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.log('\n[X] 测试崩溃: ' + e.message);
  console.log(e.stack);
  process.exit(1);
});
