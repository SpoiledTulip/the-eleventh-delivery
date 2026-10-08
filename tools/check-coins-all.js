/* ============================================================
 * tools/check-coins-all.js — 逐金币可达性实测
 *
 * 对每一关的**每一个金币**做实测：
 *   把它下方最近的落脚面找出来 → 把角色放到那个面上 → 走/跳到金币位置
 *   → 看能不能真的吃到。
 *
 * 这比"几何算高度"更严格，也比"傻瓜 AI 跑全程"更公平：
 *   傻瓜 AI 会因为自己不会玩而误报，逐金币测试只验证"这个金币本身能不能拿到"。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    addEventListener: noop, requestAnimationFrame: function () { return 0; },
    Image: function () { const s = this; this.width = 0; this.height = 0; this.src = ''; setTimeout(function () { if (s.onerror) s.onerror(); }, 0); },
    AudioContext: function () {
      return { state: 'running', currentTime: 0,
        createOscillator: function () { return { type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }; },
        createGain: function () { return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }; },
        destination: {}, resume: noop };
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
  localStorage: (function () { var s = {}; return { getItem: function (k) { return s[k] === undefined ? null : s[k]; }, setItem: function (k, v) { s[k] = String(v); }, removeItem: function (k) { delete s[k]; } }; })(),
};
sandbox.Image = sandbox.window.Image;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ⚠️ 源码在 src/js/（2026-10 目录迁移后），不是 js/。
 *   这里曾经写成 '..', 'js' → 直接 ENOENT 跑不起来，已修。
 *   加载顺序**照抄 src/index.html** —— 漏一个文件就会在后面某处
 *   报 "xxx is not defined"，而且报的位置离真正缺的东西很远，很难查。 */
['cloud-config.js', 'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'levels-ch4.js',
 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js',
 'actions.js', 'tutorial.js', 'ch3-mechanics.js', 'bg-theme.js', 'net.js', 'render.js',
 'game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8'), sandbox, { filename: f });
});
function run(code) { return vm.runInContext(code, sandbox); }
function frame(keys) {
  keys = keys || {};
  const parts = ['InputState.now = {};'];
  for (const k in keys) if (keys[k]) parts.push('InputState.now["' + k + '"]=true;');
  parts.push('update(0.016); InputState.tick();');
  run(parts.join(''));
}

run('initGame("game")');
const levelCount = run('PLAYABLE_LEVELS().length');

console.log('逐金币可达性实测\n');
console.log('方法：对每个金币，找到它下方最近的落脚面，');
console.log('      把角色放到那个面上，然后走过去/跳上去看能不能吃到。\n');

let totalFails = 0;

for (let li = 0; li < levelCount; li++) {
  const raw = run('PLAYABLE_LEVELS()[' + li + ']');
  const rows = raw.map;
  const levelName = run('PLAYABLE_LEVELS()[' + li + '].name');
  const coinCount = run('parseLevel(PLAYABLE_LEVELS()[' + li + ']).coins.length');
  /* 门槛按"这一关实际用的比例"算 —— 第 1 关有 perLevel 覆盖（教学关放宽），
   * 不能一律用全局 CONFIG.COIN_REQUIRE_RATIO，否则会把教学关算得比实际严。 */
  const lvRatio = run('(PLAYABLE_LEVELS()[' + li + '].coinRequireRatio != null) ? PLAYABLE_LEVELS()[' + li + '].coinRequireRatio : CONFIG.COIN_REQUIRE_RATIO');
  const need = Math.ceil(coinCount * lvRatio);
  /* ★ 能力基准必须按"打到这一关时实际拥有什么"算（2026-10-07）★
   * ------------------------------------------------------------
   * 动作是**逐关解锁**的（save.js ACTION_UNLOCKS）：
   *   双跳 = 通关 1 之后 / 滑墙 = 通关 2 后 / 墙跳 = 通关 3 后 / 冲刺 = 通关 4 后
   * ⇒ 测第 1 关时玩家只有「单跳」，测第 2 关有「双跳」，第 4 关起才有「冲刺」。
   *
   * ⚠️ 之前这个工具**只会按单跳（ArrowUp）测** → 把这些金币全判成"够不到"：
   *     · 第 2~5 关靠双跳/墙跳/冲刺才能拿的金币 → 假阳性（其实拿得到）
   *     · 于是 80% 门槛下满屏"关卡无法通关"，全是误报
   *   ⇒ 现在按"该关可用能力"给角色预解锁动作，并在测试里用对应的按键序列。
   *
   * ⚠️ 阈值 1/2/3/4 是 afterLevel（通关第 N 关后解锁）——
   *    所以第 li+1 关（1 起算）能用的动作 = afterLevel < li+1。
   * ------------------------------------------------------------ */
  const levelNo = li + 1;
  const canDouble = levelNo > 1;   // 通关第 1 关后
  const canWall = levelNo > 3;     // 通关第 3 关后（墙跳）
  const canDash = levelNo > 4;     // 通关第 4 关后

  console.log('===== ' + levelName + ' （金币 ' + coinCount + '，门槛 ' + need +
    '，能力：' + (canDash ? '连跳+墙跳+冲刺' : canDouble ? (canWall ? '连跳+墙跳' : '双跳') : '单跳') + '）=====');

  let reachable = 0;
  const details = [];

  for (let ci = 0; ci < coinCount; ci++) {
    // 每测一个金币都重开关卡，保证互不影响
    run('Game.mode="local"; Game.playerCount=1; Game.pickRole="kangaroo"; loadLevel(' + li + ')');
    run('Game.players = [makePlayer("kangaroo", Game.level.spawns[0])]');
    /* ★ 按该关可用能力，把动作"预解锁"给角色（测试专用）★
     * 真相源是 Save.data.unlockedActions（**字符串数组**，见 save.js hasAction）。
     * ⚠️ 一开始我写成了 S.data.actions = {} —— 字段名错，hasAction 读
     *    `data.unlockedActions` → 找不到数组就 return false → 双跳/冲刺
     *    全部静默不可用，测试里看起来"双跳也没用"（其实根本没开）。
     * ⚠️ 只影响测试沙箱，不改游戏本身。 */
    run('(function(){ var S = Save.data; if(!S) return;' +
        'if(!Array.isArray(S.unlockedActions)) S.unlockedActions = [];' +
        'function add(id){ if(S.unlockedActions.indexOf(id) < 0) S.unlockedActions.push(id); }' +
        (canDouble ? 'add("doublejump");' : '') +
        (canWall ? 'add("wallslide"); add("walljump");' : '') +
        (canDash ? 'add("dash");' : '') + '})()');

    const coin = run('Game.level.coins[' + ci + ']');
    const col = Math.floor(coin.x / 32);
    const coinRow = Math.floor(coin.y / 32);

    /* ---- 找"哪个面能吃到这个金币" ----
     * ⚠️⚠️ 2026-10-07 修正：原来只从金币**正下方**往下扫，
     *   于是"栈道关（第 12 关）"整片误报 —— 栈道的木板之间有缝，
     *   金币正下方那一列恰好是缝 → 一路扫到**崖底行 25** →
     *   把角色放崖底去够栈道上方的金币 → 当然够不到。
     *
     * ⇒ 规则改成：**先正下方一路扫（原版行为，保持基准）**；
     *   只有当"正下方的面太远（>4 格）或没有"时，才退而看左右 ±2 格
     *   的近端面 —— 这样"站在旁边平台上跑过去吃"也能被正确建模，
     *   而不会改变绝大多数金币的原有判定（避免大面积回归）。 */
    /* ⚠️ SOLID 必须**包含 'B'（崩塌桥）**：
     *   第 12 关（悬崖栈道）的金币全铺在崩塌桥面上，
     *   不把 B 算作落脚面 → 找面会一路扫到**崖底行 25**，
     *   把角色放到崖底去够栈道上的金币 → 全部误判"够不到"
     *   （实测：加 B 之前 11/15，加 B 之后 15/15）。
     *   ⚠️ 崩塌桥会塌，但玩家**经过时它是实心的**，所以算落脚面是对的。 */
    const SOLID = '#=S><IB';
    let bestGr = -1, bestCol = col, bestScore = 1e9;

    /* ★ 选面策略（2026-10-07 第三版，第 21~30 关暴露问题后重写）★
     * ------------------------------------------------------------
     * 【前两版的问题】
     *   ① 只扫正下方 → 栈道关（12 关）金币正下方是桥缝，扫到崖底 → 假红
     *   ② 只扫"正下方 4 格内 + 横向 ±2"→ 高台关（21~30 关）金币
     *      正下方 4 格内没面（面在横向 3~4 格外的高台上）→ 假红
     *
     * 【这一版】用**统一评分**在所有候选面里挑最近的：
     *     score = 垂直距离 × 10 + 水平偏离 × 30
     *   候选范围：横向 ±4 格、下方 1~8 格（覆盖"站在旁边高台上跳"）。
     *   再叠加"正下方一路扫到地图底"的兜底候选（也参与评分）。
     *   ⇒ 只保留一个总最优，不再"先到先得"，避免横向近面被兜底远面盖住。
     * ------------------------------------------------------------ */
    function consider(cc, rr) {
      if (cc < 0 || cc >= rows[0].length || rr >= rows.length || rr < 1) return;
      if (SOLID.indexOf(rows[rr][cc]) < 0) return;          // 必须是实心格
      if (SOLID.indexOf(rows[rr - 1][cc]) >= 0) return;      // 它上面要能站人
      const score = (rr - coinRow) * 10 + Math.abs(cc - col) * 30;
      if (score < bestScore) { bestScore = score; bestGr = rr; bestCol = cc; }
    }
    // 候选 A：横向 ±4 格、下方 1~8 格（近处的面，含"旁边高台"）
    for (let dc = -4; dc <= 4; dc++) {
      for (let r = coinRow + 1; r <= coinRow + 8 && r < rows.length; r++) {
        if (SOLID.indexOf(rows[r][col + dc]) >= 0) { consider(col + dc, r); break; }
      }
    }
    // 候选 B：正下方一路到底（"必须爬很高"的兜底；也参与评分）
    for (let r = coinRow + 1; r < rows.length; r++) {
      if (SOLID.indexOf(rows[r][col]) >= 0) { consider(col, r); break; }
    }
    if (bestGr < 0) { details.push({ ci: ci, ok: false, why: '下方无落脚面' }); continue; }
    const gr = bestGr;

    // 把角色放在落脚面上（脚底贴住面），水平对齐金币所在列
    const footY = gr * 32;
    run('Game.players[0].x = ' + (bestCol * 32 + 16) + ' - 13; Game.players[0].y = ' + (footY - 32) + '; Game.players[0].vy = 0;');
    // 跑几帧让它稳定
    for (let f = 0; f < 8; f++) frame({});

    let got = run('Game.level.coins[' + ci + '].taken');
    /* ---- 尝试①：原地反复单跳（最简单） ---- */
    if (!got) {
      for (let f = 0; f < 120 && !got; f++) {
        const jump = (f % 18 === 0);
        frame({ ArrowUp: jump, ArrowRight: false });
        got = run('Game.level.coins[' + ci + '].taken');
      }
    }
    /* ---- 尝试②：左右微调 + 跳 ---- */
    if (!got) {
      for (let f = 0; f < 90 && !got; f++) {
        const dir = (f % 30 < 15);
        frame({ ArrowUp: (f % 12 === 0), ArrowRight: dir, ArrowLeft: !dir });
        got = run('Game.level.coins[' + ci + '].taken');
      }
    }
    /* ---- 尝试②b：先横向跑到金币正下方，再起跳 ----
     * 覆盖"落脚面在旁边的平台上，要跑过去再跳"的情况
     * （第 5 关滑墙走廊、栈道关这类"面不在正下方"的布局）。 */
    if (!got) {
      const targetX = coin.x - 13;
      for (let f = 0; f < 70 && !got; f++) {
        const curX = run('Game.players[0].x');
        const goRight = curX < targetX - 3;
        const goLeft = curX > targetX + 3;
        frame({ ArrowRight: goRight, ArrowLeft: goLeft, ArrowUp: (f % 20 === 0) });
        got = run('Game.level.coins[' + ci + '].taken');
      }
      // 站到正下方之后再跳几次
      for (let f = 0; f < 90 && !got; f++) {
        frame({ ArrowUp: (f % 15 === 0) });
        got = run('Game.level.coins[' + ci + '].taken');
      }
    }
    /* ---- 尝试③：双跳（空中按第二下）----
     * 关键：**空中再按一次**才算第二段跳，所以要"跳 → 等几帧 → 再按"。
     * 用固定节奏容易和物理帧错开，所以扫几组间隔试。 */
    if (!got && canDouble) {
      for (let gap = 6; gap <= 26 && !got; gap += 4) {
        for (let rep = 0; rep < 3 && !got; rep++) {
          run('Game.players[0].x = ' + (bestCol * 32 + 16) + ' - 13; Game.players[0].y = ' + (footY - 32) +
              '; Game.players[0].vy = 0; Game.players[0].onGround = true;');
          for (let f = 0; f < 6; f++) frame({});
          frame({ ArrowUp: true });                       // 第一跳
          for (let f = 0; f < gap; f++) frame({});        // 等上升
          frame({ ArrowUp: true });                       // 第二跳（边沿触发）
          for (let f = 0; f < 60 && !got; f++) {
            frame({});
            got = run('Game.level.coins[' + ci + '].taken');
          }
        }
      }
    }
    /* ---- 尝试④：冲刺（Shift + 方向）---- */
    if (!got && canDash) {
      const dashDirs = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowLeft'];
      for (let d = 0; d < dashDirs.length && !got; d++) {
        run('Game.players[0].x = ' + (bestCol * 32 + 16) + ' - 13; Game.players[0].y = ' + (footY - 32) +
            '; Game.players[0].vy = 0; Game.players[0].onGround = true;');
        for (let f = 0; f < 6; f++) frame({});
        // 先跳一下再冲（很多金币高出落脚面，得先离地）
        const k1 = {}; k1.ArrowUp = true; frame(k1);
        for (let f = 0; f < 8; f++) frame({});
        const k2 = { Shift: true }; k2[dashDirs[d]] = true;
        frame(k2);
        for (let f = 0; f < 50 && !got; f++) {
          frame({});
          got = run('Game.level.coins[' + ci + '].taken');
        }
      }
    }

    if (got) reachable++;
    else details.push({ ci: ci, ok: false, why: '列' + col + ' 行' + coinRow + '（站在行' + gr + '上够不到）' });
  }

  console.log('  可吃到 ' + reachable + ' / ' + coinCount + '，门槛 ' + need);
  if (reachable >= need) {
    console.log('  [v] 可达成门槛 ✓');
  } else {
    console.log('  [X] 可吃到的不够门槛！关卡无法通关');
    totalFails++;
  }
  details.forEach(function (d) { console.log('      ❌ 金币#' + d.ci + '：' + d.why); });
  console.log('');
}

console.log('=========================================');
console.log(totalFails === 0 ? '所有关卡的金币都够达成门槛 ✓' : (totalFails + ' 关有问题 ✗'));
process.exit(totalFails === 0 ? 0 : 1);
