/* ============================================================
 * _ch3-terrain.js — 第 13~20 关 地形 ASCII 可视化（诊断工具）
 * ============================================================
 * 用来看"这一关到底长什么样"。每 2 格宽 1 个字符，便于在终端里看构图。
 *   # 实心   = 单向平台   . 空气   ^ 尖刺   o 订单   P/N 出生
 *   A 存档   G 终点   m 移动平台   w 风场   B 断裂桥   I 冰面
 *   > < 传送带   S 弹簧   t 开关   h 开关门   M 巡逻怪   j 跳跳怪
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
function noop() { }
function sandbox() {
  const prox = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : (k === 'measureText' ? () => ({ width: 10 }) : noop)), set: () => true });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise, String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    window: { addEventListener: noop, requestAnimationFrame: () => 0 },
    document: { getElementById: () => ({ getContext: () => prox, width: 0, height: 0, style: {} }), addEventListener: noop, createElement: () => ({ getContext: () => prox, style: {}, appendChild: noop }) },
    performance: { now: () => Date.now() }, requestAnimationFrame: () => 0,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
  };
  sb.globalThis = sb; vm.createContext(sb); return sb;
}
const sb = sandbox();
['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'physics.js', 'ch3-mechanics.js'].forEach(f => {
  try { vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f }); } catch (e) { }
});
const J = e => JSON.parse(vm.runInContext('JSON.stringify(' + e + ')', sb));

const ids = process.argv.slice(2).filter(x => /^\d+$/.test(x));
const list = ids.length ? ids.map(Number) : [13, 20];

const W2C = { '#': '#', '=': '=', '.': '.', '^': '^', 'o': 'o', 'P': 'P', 'N': 'N', 'A': 'A', 'G': 'G', 'm': 'm', 'w': 'w', 'B': 'B', 'I': 'I', '>': '>', '<': '<', 'S': 'S', 't': 't', 'h': 'h', 'M': 'M', 'j': 'j', 'Q': 'Q', 'T': 'T', 'V': 'V', 'b': 'b', 'D': 'D', 'Y': 'Y', 'O': 'O' };

for (const id of list) {
  const raw = J('__CH3_LEVEL_BUILDERS[' + id + ']()');
  const map = raw.map;
  const H = map.length, W = map[0].length;
  console.log('\n================ 第 ' + id + ' 关 · ' + raw.name + ' (' + W + 'x' + H + ') ================');
  console.log('district=' + raw.district + '  weather=' + raw.weather + '  ch3=' + Object.keys(raw.ch3 || {}).join(','));
  /* 每 2 列合并：优先显示非空字符 */
  let hdr = '     ';
  for (let c = 0; c < W; c += 2) hdr += (c % 20 === 0) ? String(Math.floor(c / 10) % 10) : ' ';
  console.log(hdr);
  for (let r = 0; r < H; r++) {
    let line = String(r).padStart(3, ' ') + ' |';
    for (let c = 0; c < W; c += 2) {
      const a = map[r][c], b = (c + 1 < W) ? map[r][c + 1] : '.';
      const pick = (a !== '.') ? a : b;
      line += W2C[pick] != null ? W2C[pick] : '?';
    }
    console.log(line);
  }
}
