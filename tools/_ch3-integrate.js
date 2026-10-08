/* 验证：新关卡真的进了 LEVELS_EXTRA */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.resolve(__dirname, '..', 'src');
function bs() {
  function noop() { }
  const prox = new Proxy({}, { get: function (t, k) { if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; }; if (k === 'measureText') return function () { return { width: 10 }; }; return noop; }, set: function () { return true; } });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise, String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    window: { addEventListener: noop, requestAnimationFrame: () => 0, Image: function () { this.width = 64; this.height = 64; }, AudioContext: function () { return { state: 'running', currentTime: 0, sampleRate: 44100, createBuffer: (c, l) => ({ getChannelData: () => new Float32Array(l) }), createBufferSource: () => ({ buffer: null, loop: false, connect: noop, start: noop, stop: noop }), createBiquadFilter: () => ({ type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { setValueAtTime: noop }, connect: noop }), createOscillator: () => ({ frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }), createGain: () => ({ gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }), destination: {}, resume: noop }; }, },
    document: { getElementById: () => ({ getContext: () => prox, width: 0, height: 0, style: {} }), addEventListener: noop, createElement: () => ({ getContext: () => prox, style: {}, appendChild: noop }) },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
  };
  sb.Image = sb.window.Image; sb.globalThis = sb; vm.createContext(sb); return sb;
}
/* ★ 按 index.html 的真实顺序加载 */
const FILES = ['cloud-config.js', 'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'account.js', 'save.js', 'actions.js', 'net.js', 'scooter.js', 'ai-rider.js', 'ch3-mechanics.js', 'bg-theme.js', 'egg.js', 'render.js', 'game.js', 'ui.js'];
const sb = bs();
const loaded = [];
FILES.forEach(f => {
  try {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
    loaded.push(f);
  } catch (e) {
    console.log('  ⚠️ ' + f + ' 加载失败: ' + e.message.slice(0, 60));
  }
});
const run = c => vm.runInContext(c, sb);
const j = c => JSON.parse(run('JSON.stringify(' + c + ')'));

console.log('加载了 ' + loaded.length + '/' + FILES.length + ' 个文件');
console.log();
console.log('=== LEVELS_EXTRA 里的 13~20 关（应该是重构版）===');
const list = j('LEVELS_EXTRA.map(function(l){ return { id:l.id, name:l.name, cols:l.map[0].length, rows:l.map.length, district:l.district, hasCh3: !!l.ch3 }; })');
list.filter(l => l.id >= 13).forEach(l => {
  console.log('  第' + String(l.id).padStart(2) + '关  ' + String(l.cols + 'x' + l.rows).padEnd(9) +
    String(l.district).padEnd(18) + 'ch3=' + l.hasCh3 + '  ' + l.name);
});
console.log();
const allNew = list.filter(l => l.id >= 13).every(l => l.hasCh3 && l.cols > 88);
console.log(allNew ? '✅ 13~20 全部是重构版（且都比 88 列宽）' : '❌ 有旧版混在里面');
console.log();
console.log('=== 总关卡数 ===');
console.log('  PLAYABLE_LEVELS 共 ' + j('PLAYABLE_LEVELS().length') + ' 关');
