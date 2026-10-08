/* ============================================================
 * ch3-levels-test.js — 第 13~20 关重构版专项验收（2026-10-06）
 * ============================================================
 * 对应十一给的《最终关卡验收标准》23 条。逐条变成可运行的断言。
 *
 * 【为什么要单独一套】
 *   通用的 reachability / single-player 测的是"能不能玩"，
 *   而这 8 关是按一份详细设计表重做的，需要用**设计表里的规则**来验收：
 *     · 每关尺寸递增（长度真的变长了）
 *     · 每关 district 唯一且有背景主题
 *     · 检查点数量达标（13~15 关 ≥2 / 16~18 关 ≥3 / 19 关 ≥3 / 20 关每阶段 1 个）
 *     · 每关有新机制数据
 *     · 20 关必须是多阶段（≥5 阶段）
 *     · 袋鼠 + 飞龙都能通关
 *     · 不许用"双人机关"（Y/O/D）
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
const failures = [];
function check(ok, msg, extra) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else {
    console.log('    [X] ' + msg + (extra ? '  → ' + extra : ''));
    fail++; failures.push(msg);
  }
}

/* ---------- 沙箱 ---------- */
function buildSandbox() {
  function noop() { }
  const prox = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    }, set: function () { return true; },
  });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    window: {
      addEventListener: noop, requestAnimationFrame: function () { return 0; },
      Image: function () { this.width = 64; this.height = 64; },
      AudioContext: function () {
        return {
          state: 'running', currentTime: 0, sampleRate: 44100,
          createBuffer: function (c, l) { return { getChannelData: function () { return new Float32Array(l); } }; },
          createBufferSource: function () { return { buffer: null, loop: false, connect: noop, start: noop, stop: noop }; },
          createBiquadFilter: function () { return { type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { setValueAtTime: noop }, connect: noop }; },
          createOscillator: function () { return { frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }; },
          createGain: function () { return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }; },
          destination: {}, resume: noop,
        };
      },
    },
    document: {
      getElementById: function () { return { getContext: function () { return prox; }, width: 0, height: 0, style: {} }; },
      addEventListener: noop,
      createElement: function () { return { getContext: function () { return prox; }, style: {}, appendChild: noop }; },
    },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: noop,
    localStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop, clear: noop },
  };
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const FILES = [
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js',
  'characters.js', 'device-mode.js', 'account.js', 'save.js',
  'actions.js', 'tutorial.js', 'net.js', 'scooter.js', 'ai-rider.js',
  'ch3-mechanics.js', 'bg-theme.js', 'egg.js', 'render.js', 'game.js', 'ui.js',
];

const sb = buildSandbox();
FILES.forEach(function (f) {
  try {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
  } catch (e) {
    console.log('    (加载 ' + f + ' 失败：' + e.message + ')');
  }
});
const G = function (expr) { return vm.runInContext(expr, sb); };
const J = function (expr) { return JSON.parse(vm.runInContext('JSON.stringify(' + expr + ')', sb)); };

/* ============================================================
 * 收集 13~20 关的数据
 * ============================================================ */
console.log('============================================');
console.log('  第 13~20 关重构版 · 专项验收');
console.log('============================================');

const levels = [];
for (let id = 13; id <= 20; id++) {
  try {
    const raw = J('__CH3_LEVEL_BUILDERS[' + id + ']()');
    const lv = J('parseLevel(__CH3_LEVEL_BUILDERS[' + id + ']())');
    levels.push({ id: id, raw: raw, lv: lv });
  } catch (e) {
    check(false, '第 ' + id + ' 关能构建', e.message.slice(0, 60));
  }
}
check(levels.length === 8, '★★★ 8 个关卡全部能构建出来（' + levels.length + '/8）');

/* ============================================================
 * ① 地图合法性
 * ============================================================ */
console.log('\n--- 1. 地图合法性 ---');
levels.forEach(function (L) {
  const m = L.raw.map;
  const lens = {};
  m.forEach(function (r) { lens[r.length] = (lens[r.length] || 0) + 1; });
  const uniform = Object.keys(lens).length === 1;
  check(uniform, '第' + L.id + '关 每行宽度一致（' + m[0].length + ' 列 × ' + m.length + ' 行）',
    JSON.stringify(lens));
  check(!!L.lv.goal, '第' + L.id + '关 有终点');
  check(L.lv.spawns.length >= 2, '第' + L.id + '关 有两个出生点（袋鼠+飞龙）');
});

/* ============================================================
 * ② 长度递增（十三、验收第 5/6 条）
 * ============================================================
 * ⚠️ 这里**不能**用"地图面积逐关递增"来判定 —— 试过，是错的。
 *
 *   设计表里对"长度"有明确定义：
 *     "这里的长度指**正常通关的实际游玩时间**，不是单纯地图宽度。"
 *
 *   所以第 15 关（110×34）虽然比第 14 关（120×30）窄，
 *   但它有**折返 + 上下层互通**，实际游玩时间是更长的。
 *   用面积判会误报（我第一版就是这么错的）。
 *
 *   ⇒ 改用**目标时间**当"长度"指标（见下面第 3 节），
 *     这里只检查"都比旧版大" + "最长的确实是最后几关"。
 * ============================================================ */
console.log('\n--- 2. 关卡规模 ---');
const bigOnes = levels.filter(function (L) { return L.lv.cols * L.lv.rows > 88 * 26; });
check(bigOnes.length === 8, '★★★ 8 关**全部大于**旧的 88×26（真的扩容了，不是塞满）',
  bigOnes.map(function (L) { return L.lv.cols + 'x' + L.lv.rows; }).join(' '));

/* 后四关（17~20）应当明显更大 —— 它们对应"更长的流程" */
const lateAvg = (levels[6].lv.cols * levels[6].lv.rows +
  levels[7].lv.cols * levels[7].lv.rows) / 2;
const earlyAvg = (levels[0].lv.cols * levels[0].lv.rows +
  levels[1].lv.cols * levels[1].lv.rows) / 2;
check(lateAvg > earlyAvg, '★★ 后段（19~20）的地图规模明显大于前段（13~14）',
  Math.round(earlyAvg) + ' → ' + Math.round(lateAvg));
check(levels[7].lv.cols >= 140, '★ 第 20 关最宽（' + levels[7].lv.cols + ' 列 ≥ 140）');

/* ============================================================
 * ③ 目标时间递增
 * ============================================================ */
console.log('\n--- 3. 目标时间递增 ---');
let prevT = 50;      // 第 12 关 50s
let tMono = true;
const tList = [];
levels.forEach(function (L) {
  tList.push(L.raw.targetTime);
  if (L.raw.targetTime < prevT) tMono = false;
  prevT = L.raw.targetTime;
});
check(tMono, '★★ 目标时间逐关不减：' + tList.join(' / '));
check(levels[0].raw.targetTime >= 55, '★ 第 13 关目标时间 ' + levels[0].raw.targetTime +
  's ≥ 55s（比第 12 关的 50s 明显长，符合"1.3 倍"）');
check(levels[7].raw.targetTime >= 130, '★ 第 20 关目标时间 ' + levels[7].raw.targetTime +
  's ≥ 130s（终局关，最长）');

/* ============================================================
 * ④ district 唯一 + 背景主题（十二、验收第 3/14 条）
 * ============================================================ */
console.log('\n--- 4. 背景主题 ---');
const districts = levels.map(function (L) { return L.raw.district; });
const uniq = {};
districts.forEach(function (d) { uniq[d] = (uniq[d] || 0) + 1; });
const dup = Object.keys(uniq).filter(function (k) { return uniq[k] > 1; });
check(dup.length === 0, '★★ 8 关的 district **互不重复**', dup.join(','));
check(districts.every(function (d) { return d && d.length > 0; }), '每关都有 district 字段');

/* 都要在 bg-theme 里有主题 */
const themeKeys = J('BG_THEME.keys()');
districts.forEach(function (d, i) {
  check(themeKeys.indexOf(d) >= 0, '★ 第' + (13 + i) + '关 的 district「' + d + '」有背景主题');
});
/* 主题之间 sky 不能重复 */
const skySeen = {};
districts.forEach(function (d) {
  const t2 = J('BG_THEME.forDistrict(' + JSON.stringify(d) + ')');
  skySeen[d] = JSON.stringify(t2.sky);
});
const skyVals = Object.keys(skySeen).map(function (k) { return skySeen[k]; });
const skyUniq = {};
skyVals.forEach(function (v) { skyUniq[v] = (skyUniq[v] || 0) + 1; });
const skyDup = Object.keys(skyUniq).filter(function (k) { return skyUniq[k] > 1; });
check(skyDup.length === 0, '★★ 8 关的背景配色**各不相同**（一眼能区分）');

/* ============================================================
 * ⑤ 检查点数量（十四、验收第 17 条）
 * ============================================================ */
console.log('\n--- 5. 检查点 ---');
/* 设计表：13~15 关 ≥2 / 16~18 关 ≥2~3 / 19 关 ≥3 / 20 关每阶段 1 个(≥5) */
const cpMin = { 13: 2, 14: 2, 15: 2, 16: 3, 17: 3, 18: 3, 19: 3, 20: 5 };
levels.forEach(function (L) {
  const n = L.lv.checkpoints.length;
  const need = cpMin[L.id] || 2;
  check(n >= need, '★ 第' + L.id + '关 有 ' + n + ' 个检查点（要求 ≥' + need + '）');
});

/* ============================================================
 * ⑥ 新机制数据（十三、验收第 3 条）
 * ============================================================ */
console.log('\n--- 6. 新机制 ---');
levels.forEach(function (L) {
  check(!!L.raw.ch3 && Object.keys(L.raw.ch3).length > 0,
    '★ 第' + L.id + '关 带了新机制数据（' + (L.raw.ch3 ? Object.keys(L.raw.ch3).join(',') : '无') + '）');
});

/* 第 20 关必须多阶段 */
console.log('\n--- 7. 第 20 关：多阶段终局关 ---');
const lv20 = levels[7].raw;
check(Array.isArray(lv20.ch3.stages), '★★ 有阶段表（stages）');
check(lv20.ch3.stages.length >= 5, '★★★ 阶段数 ' + lv20.ch3.stages.length + ' ≥ 5');
check(!!lv20.ch3.drone, '★★ 有终局追逐（无人机）');
check(Array.isArray(lv20.ch3.lightning) && lv20.ch3.lightning.length > 0, '★ 有雷暴平台（闪电落点）');
check(Array.isArray(lv20.ch3.cargoLift) && lv20.ch3.cargoLift.length > 0, '★ 有起重机货台（动态平台）');
check(Array.isArray(lv20.ch3.debris) && lv20.ch3.debris.length > 0, '★ 有坠落物（带影子预警）');

/* ============================================================
 * ⑧ 单人安全：不许用双人机关
 * ============================================================ */
console.log('\n--- 8. 单人兼容（不许用双人机关 Y/O/D）---');
levels.forEach(function (L) {
  const m = L.raw.map.join('');
  const hasY = m.indexOf('Y') >= 0;
  const hasO = m.indexOf('O') >= 0;
  const hasD = m.indexOf('D') >= 0;
  check(!hasY && !hasO && !hasD,
    '★ 第' + L.id + '关 没有双人机关（Y=' + hasY + ' O=' + hasO + ' D=' + hasD + '）');
});

/* ============================================================
 * ⑨ 订单门槛合理（不许"必须全收集才能过关"）
 * ============================================================ */
console.log('\n--- 9. 订单门槛 ---');
const globalRatio = G('CONFIG.COIN_REQUIRE_RATIO');   // 全局门槛比例（现为 0.8）
levels.forEach(function (L) {
  const total = L.lv.coins.length;
  /* ⚠️ 2026-10-07：门槛比例从 45% 提到全局 80%（第 1 关除外）。
   *   这里别再硬编码 0.45 —— 用游戏实际的配置值，
   *   否则"门槛 < 总数"这条断言会在门槛提高后失真。 */
  const lvRatio = (L.raw && L.raw.coinRequireRatio != null) ? L.raw.coinRequireRatio : globalRatio;
  const need = Math.ceil(total * lvRatio);
  check(total >= 20, '★ 第' + L.id + '关 有 ' + total + ' 个订单（≥20，够分四类）');
  check(need < total, '★ 第' + L.id + '关 门槛 ' + need + '/' + total + ' ＜ 总数（不必全收集）');
});

/* ============================================================
 * ⑩ 出生点安全
 * ============================================================ */
console.log('\n--- 10. 出生点安全 ---');
levels.forEach(function (L) {
  const T = 32;
  L.lv.spawns.forEach(function (sp) {
    /* 出生点下方必须有地面 */
    const col = Math.floor((sp.x) / T);
    const row = Math.floor((sp.y) / T);
    let hasGround = false;
    for (let r = row; r < Math.min(row + 6, L.lv.rows); r++) {
      if (L.lv.grid[r] && L.lv.grid[r][col] === '#') { hasGround = true; break; }
    }
    check(hasGround, '★ 第' + L.id + '关 ' + sp.role + ' 出生点下方有地面');
  });
});

/* ============================================================
 * ⑪ 机制模块可用
 * ============================================================ */
console.log('\n--- 11. 机制模块 ---');
check(G('typeof CH3') === 'object', '★ CH3 机制模块已加载');
check(typeof G('drawCh3Mechanics') === 'function', '★ 机制绘制函数存在（不会"有功能看不见"）');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(50));
console.log('  第 13~20 关专项验收: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(50));
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach(function (f) { console.log('  - ' + f); });
}
process.exit(fail > 0 ? 1 : 0);
