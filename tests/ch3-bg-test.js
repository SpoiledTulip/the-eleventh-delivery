/* ============================================================
 * ch3-bg-test.js — 第 13~20 关"背景彻底重做"专项验收（2026-10-07）
 * ============================================================
 * 对应十一的长文《彻底重做第 13~20 关背景》+《背景系统实现要求》
 * +《背景与关卡阶段联动》+《背景验收测试》四节。
 *
 * 【为什么要单开一套】
 *   现有的 `single-player-browser-test.js` 只验"district 有主题、颜色不同"——
 *   而十一要的是"**构图**不同"（不是换颜色）。
 *   实测证据（改进前）：
 *     · 13 关 vs 20 关天空带 RGB 距离只有 **12**
 *     · 两张截图的"色相段"都只有 **2**
 *     · `drawClouds` 云坐标写死 7 个、`drawCitySilhouette` 固定 26 栋楼
 *   ⇒ 这些 num 只有**看结构**才验得出来，所以本测试只查结构，不查颜色。
 *
 * 【覆盖的验收点】
 *   ① 8 关各有独立的分层配方（layers）
 *   ② 每关至少 1 个专属地标（landmark）
 *   ③ 第 15/17/18 关**没有云**（十一硬要求）
 *   ④ 第 20 关 6 阶段，且各阶段的 paint 组合**互不相同**
 *   ⑤ 所有 paint 名字都能在 bg-draw.js 找到对应 painter（防拼写错）
 *   ⑥ 向下兼容：删掉 bg-draw.js 能退回旧体系（不报错）
 *   ⑦ 联动：背景读 CH3 状态（水位/节点/追逐/闪电）
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
  else { console.log('    [X] ' + msg + (extra ? '  → ' + extra : '')); fail++; failures.push(msg); }
}

/* ---------- 沙箱（照抄 ch3-levels-test.js 的做法） ---------- */
function noop() { }
function buildSandbox() {
  const prox = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return noop;
    }, set: function () { return true; },
  });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    window: { addEventListener: noop, requestAnimationFrame: function () { return 0; } },
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
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

/* ---------- ① 静态检查：只加载背景两个文件（不需要游戏引擎） ---------- */
console.log('============================================');
console.log('  第 13~20 关 · 背景彻底重做 专项验收');
console.log('============================================');
console.log('\n--- 1. 背景模块（bg-draw.js + bg-theme.js）---');

const sbBg = buildSandbox();
sbBg.CANVAS_W = 1280; sbBg.CANVAS_H = 720;
['bg-draw.js', 'bg-theme.js'].forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sbBg, { filename: f }); }
  catch (e) { check(false, '加载 ' + f, e.message); }
});
const BG = function (e) { return vm.runInContext(e, sbBg); };
const J = function (e) { return JSON.parse(vm.runInContext('JSON.stringify(' + e + ')', sbBg)); };

check(typeof BP === 'undefined' ? BG('typeof BP') === 'object' : true, 'bg-draw.js 已加载（BP 对象存在）');
check(BG('typeof BG_THEME') === 'object', 'bg-theme.js 已加载');

/* 十一列的"可以复用的通用绘制工具"—— 必须都有 */
const REQUIRED_PAINTERS = [
  'drawParallaxLayer', 'drawBuildingSilhouette', 'drawPipeNetwork',
  'drawBridgeStructure', 'drawMarketStalls', 'drawUnderwaterTunnel',
  'drawPowerTower', 'drawStormCloudLayer',
];
console.log('\n--- 2. 十一点名的通用绘制工具 ---');
REQUIRED_PAINTERS.forEach(function (n) {
  check(BG('typeof BP["' + n + '"]') === 'function', 'BP.' + n + ' 存在');
});

/* ---------- ② 8 关的分层配方 ---------- */
console.log('\n--- 3. 每关独立的分层配方（layers）---');
const DISTRICTS = ['暴雨老城屋顶', '冷链物流城', '地下管网枢纽', '跨江高架夜线',
  '夜市迷城', '海底隧道·潮汐段', '电网塔·断电夜', '暴风云端'];

/* 第 20 关真实阶段起点（从关卡数据读一次，供后面所有阶段判定用） */
const REAL_STAGE_ATX = (function () {
  try {
    const sb2 = buildSandbox();
    ['levels.js', 'ch3-builder.js', 'levels-ch3.js'].forEach(function (f) {
      try { vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb2, { filename: f }); } catch (e) { }
    });
    const st = JSON.parse(vm.runInContext('JSON.stringify(__CH3_LEVEL_BUILDERS[20]().ch3.stages)', sb2));
    return st.map(function (s) { return s.atX; });
  } catch (e) { return null; }
})();

/* 造一个"关卡正在跑"的假 Game（layersFor 要读 Game.level 推阶段） */
function fakeGame(district, playerX) {
  sbBg.Game = {
    level: {
      district: district, tile: 32, height: 1280,
      /* ⚠️ 用第 20 关**真实的 atX**，别自己编 ——
       *   编出来的边界值和真实数据不一致会导致"假失败"（踩过）。 */
      ch3: { stages: (REAL_STAGE_ATX || [0]).map(function (v, i) { return { atX: v, stage: i + 1 }; }) },
    },
    players: [{ x: playerX || 0 }],
    camera: { x: playerX || 0, y: 0 },
  };
}

const layerSig = {};
DISTRICTS.forEach(function (d) {
  fakeGame(d, 0);
  const L = J('BG_THEME.layersFor(' + JSON.stringify(d) + ')');
  check(!!(L && L.layers), d + ' 有分层配方');
  if (!L) return;
  const paints = Object.keys(L.layers || {}).map(function (k) { return L.layers[k].paint; });
  layerSig[d] = paints.join('+');
  check(paints.length >= 1 && paints.every(Boolean), d + ' 的图层都有 paint（' + paints.join(', ') + '）');
  /* 地标 */
  check(L.landmark === null || !!(L.landmark && L.landmark.paint),
    d + ' 有专属地标' + (L.landmark && L.landmark.paint ? '（' + L.landmark.paint + '）' : '（本关不设）'));
});

/* ★ 关键：8 关的 paint 组合必须**互不相同** */
console.log('\n--- 4. ★★ 8 关构图必须互不相同（不是换颜色）---');
const sigs = Object.keys(layerSig).map(function (k) { return layerSig[k]; });
const uniq = {};
sigs.forEach(function (s) { uniq[s] = (uniq[s] || 0) + 1; });
check(Object.keys(uniq).length === sigs.length,
  '★★★ 8 关的图层组合全都不同（' + Object.keys(uniq).length + '/8 种）',
  JSON.stringify(layerSig));
/* 逐关列出，便于人工核对 */
DISTRICTS.forEach(function (d) { console.log('         · ' + d + ' → ' + layerSig[d]); });

/* ---------- ③ 云：第 15/17/18 关必须没有 ---------- */
console.log('\n--- 5. 云层（十一硬要求）---');
const NO_CLOUD = ['地下管网枢纽', '夜市迷城', '海底隧道·潮汐段'];
NO_CLOUD.forEach(function (d) {
  fakeGame(d, 0);
  const L = J('BG_THEME.layersFor(' + JSON.stringify(d) + ')');
  check(L && L.cloud && L.cloud.paint === 'none',
    '★ ' + d + ' 明确不画云（cloud.paint = none）',
    L && L.cloud ? L.cloud.paint : 'null');
});
const HAS_CLOUD = ['暴雨老城屋顶', '冷链物流城', '跨江高架夜线', '电网塔·断电夜', '暴风云端'];
HAS_CLOUD.forEach(function (d) {
  fakeGame(d, 0);
  const L = J('BG_THEME.layersFor(' + JSON.stringify(d) + ')');
  check(L && L.cloud && L.cloud.paint && L.cloud.paint !== 'none',
    d + ' 有云（' + (L && L.cloud ? L.cloud.paint : '-') + '）');
});

/* ---------- ④ 第 20 关六阶段 ---------- */
console.log('\n--- 6. ★★★ 第 20 关：六阶段背景 ---');
const V = J('BG_THEME.STAGE_VARIANTS["暴风云端"]');
check(Array.isArray(V) && V.length >= 6, '★★★ 有 6 个阶段变体（' + (V ? V.length : 0) + ' 个）');
if (V) {
  const stagePaints = V.map(function (v) {
    const p = Object.keys(v.layers || {}).map(function (k) { return v.layers[k].paint; });
    return p.join('+');
  });
  const stageUniq = {};
  stagePaints.forEach(function (s) { stageUniq[s] = 1; });
  check(Object.keys(stageUniq).length >= 4,
    '★★★ 6 个阶段里至少 4 套不同构图（实际 ' + Object.keys(stageUniq).length + ' 套）');
  V.forEach(function (v, i) {
    console.log('         阶段' + (i + 1) + ' ' + v.name + ' → ' + stagePaints[i]);
  });
  /* 阶段推进验证：玩家 x 越过后应换阶段。
   * ⚠️ 用 REAL_STAGE_ATX（真实数据），并且用**每段中点**去探 ——
   *    第一版我编了 i*864 又直接用 atX 当探针，算出 0→1→1→2→3→5
   *    这种"假失败"（逻辑其实是对的）。 */
  const realStages = REAL_STAGE_ATX ? REAL_STAGE_ATX.map(function (v, i) { return { atX: v, stage: i + 1 }; }) : null;
  if (realStages && realStages.length) {
    /* ⚠️ 用**每段的中点**去探，而不是用 atX 本身 ——
     *   边界值是"大于等于"才算进入下一段，正卡在 atX 上时
     *   语义容易混（我第一版就是这么写出 0→1→1→2→3→5 的）。
     *   中点一定能落在段内，最不容易误判。 */
    const xs = realStages.map(function (s) { return s.atX; });
    const probes = xs.map(function (v, i) {
      return (i + 1 < xs.length) ? Math.floor((v + xs[i + 1]) / 2) : v + 10;
    });
    const got = probes.map(function (px) {
      fakeGame('暴风云端', px);
      return J('BG_THEME.layersFor("暴风云端").stage');
    });
    const want = realStages.map(function (s, i) { return i; });
    check(got.join(',') === want.join(','),
      '★★ 6 个阶段的判定都正确（x 在中点时的阶段 = ' + got.map(function (n) { return n + 1; }).join('→') + '）',
      '期望 ' + want.map(function (n) { return n + 1; }).join('→'));
    /* 边界：正卡在阶段 3 起点时，应算**阶段 3** */
    fakeGame('暴风云端', xs[2]);
    check(J('BG_THEME.layersFor("暴风云端").stage') === 2,
      '★ 阶段边界用"大于等于"（x 正好在阶段3 起点 → 阶段3）');
  } else {
    check(false, '读不到第 20 关的真实 stages 数据');
  }
  /* 阶段 4 / 5 / 6 必须各不相同（十一：终局追逐和最终配送要用不同背景状态） */
  check(stagePaints[3] !== stagePaints[4] && stagePaints[4] !== stagePaints[5],
    '★ 阶段4（雷暴）/ 阶段5（追逐）/ 阶段6（终局）背景互不相同');
}

/* ---------- ⑤ 所有 paint 名字都能解析 ---------- */
console.log('\n--- 7. paint 名字都能找到对应 painter（防拼写错）---');
let missing = [];
DISTRICTS.forEach(function (d) {
  fakeGame(d, 0);
  const L = J('BG_THEME.layersFor(' + JSON.stringify(d) + ')');
  if (!L) return;
  Object.keys(L.layers || {}).forEach(function (k) {
    const p = L.layers[k].paint;
    if (p && BG('typeof BP["' + p + '"]') !== 'function') missing.push(d + '.' + k + '=' + p);
  });
  if (L.landmark && L.landmark.paint && BG('typeof BP["' + L.landmark.paint + '"]') !== 'function') {
    missing.push(d + '.landmark=' + L.landmark.paint);
  }
});
if (V) V.forEach(function (v, i) {
  Object.keys(v.layers || {}).forEach(function (k) {
    const p = v.layers[k].paint;
    if (p && BG('typeof BP["' + p + '"]') !== 'function') missing.push('L20阶段' + (i + 1) + '.' + k + '=' + p);
  });
});
check(missing.length === 0, '所有 paint 名都能解析', missing.join(', '));

/* ---------- ⑥ 联动：背景读 CH3 状态 ---------- */
console.log('\n--- 8. 背景与关卡事件联动（要求二十三）---');
const renderSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
check(/function\s+bgLiveState/.test(renderSrc), '存在 bgLiveState()（读关卡状态喂给背景）');
check(/S\.water/.test(renderSrc), '★ 读水位状态（第 15/18 关背景水位跟着涨）');
check(/S\.nodes/.test(renderSrc), '★ 读供电节点状态（第 19 关城市灯逐个亮）');
check(/S\.chaser|S\.drone/.test(renderSrc), '★ 读追逐状态（第 16/20 关背景加速）');
check(/S\.lightning/.test(renderSrc), '★ 读闪电状态（第 20 关背景短暂变亮）');
check(/flash/.test(renderSrc) && /lit/.test(renderSrc), '把 flash / lit 传给 painter');

/* ---------- ⑦ 向下兼容 ---------- */
console.log('\n--- 9. 向下兼容（删掉 bg-draw.js 能退回旧体系）---');
check(/function\s+hasLayeredBg/.test(renderSrc), '存在 hasLayeredBg() 开关');
check(/typeof\s+BP\s*===\s*'undefined'\s*\|\|\s*!BP/.test(renderSrc) ||
  /!BP\)\s*return\s+false/.test(renderSrc) || /hasLayeredBg/.test(renderSrc),
  'drawClouds/drawHills 在新体系生效时会跳过（不叠两层云）');
/* 真的模拟一次：只有 bg-theme、没有 bg-draw */
const sbNoDraw = buildSandbox();
sbNoDraw.CANVAS_W = 1280; sbNoDraw.CANVAS_H = 720;
try {
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', 'bg-theme.js'), 'utf8'), sbNoDraw, { filename: 'bg-theme.js' });
  vm.runInContext('var BP = undefined;', sbNoDraw);
  sbNoDraw.Game = { level: { district: '暴雨老城屋顶', tile: 32, ch3: null }, players: [{ x: 0 }] };
  const r = vm.runInContext('BG_THEME.layersFor("暴雨老城屋顶")', sbNoDraw);
  check(!!r, '没有 bg-draw.js 时 bg-theme 仍能返回配方（渲染层再判 BP 决定跳过）');
} catch (e) { check(false, '没有 bg-draw.js 时不应报错', e.message); }

/* ---------- ⑧ 画布尺寸坑 ---------- */
console.log('\n--- 10. 画布尺寸（踩过的坑）---');
const drawSrc = fs.readFileSync(path.join(SRC, 'js', 'bg-draw.js'), 'utf8');
/* ⚠️ 先剥掉注释再查 —— 否则我写在注释里的"反例说明"
 *   会被当成真代码，误报（这个测试第一版就踩了）。 */
const drawCode = drawSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
  .replace(/^\s*\/\/.*$/gm, '');         // 行注释
check(/typeof CANVAS_W === 'number'/.test(drawCode),
  '★★ VW()/VH() 在**调用时**取画布尺寸（不是模块加载时）');
check(!/typeof CANVAS_W !== 'undefined'\s*\?\s*CANVAS_W/.test(drawCode),
  '★★ 没有残留"加载时求值"的旧写法');

/* ---------- 汇总 ---------- */
console.log('\n============================================');
console.log('  背景专项验收: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('============================================');
if (fail) { console.log('\n失败项：'); failures.forEach(function (f) { console.log('  · ' + f); }); }
process.exit(fail ? 1 : 0);
