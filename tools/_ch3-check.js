/* 临时：验证 13~20 全部新关 */
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
const FILES = ['levels.js', 'ch3-builder.js', 'levels-ch3.js'];
const sb = bs();
FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f }));
const run = c => vm.runInContext(c, sb);
const j = c => JSON.parse(run('JSON.stringify(' + c + ')'));

console.log('=== 13~20 关新关验证 ===');
console.log('关  尺寸      行宽  订单 门槛  敌  存档  出生  终点  district            机制');
console.log('-'.repeat(108));
let bad = 0;
for (let id = 13; id <= 20; id++) {
  try {
    const B = run('__CH3_LEVEL_BUILDERS[' + id + ']');
    if (typeof B !== 'function') { console.log('  ' + id + ' ❌ 找不到构建器'); bad++; continue; }
    const raw = j('__CH3_LEVEL_BUILDERS[' + id + ']()');
    const m = raw.map;
    const lens = {}; m.forEach(r => lens[r.length] = (lens[r.length] || 0) + 1);
    const widthOk = Object.keys(lens).length === 1;
    const lv = j('parseLevel(__CH3_LEVEL_BUILDERS[' + id + ']())');
    const need = Math.ceil(lv.coins.length * (raw.coinRequireRatio != null ? raw.coinRequireRatio : j('CONFIG.COIN_REQUIRE_RATIO')));
    const mech = raw.ch3 ? Object.keys(raw.ch3).join(',') : '-';
    console.log(
      String(id).padStart(2) + '  ' +
      String(lv.cols + 'x' + lv.rows).padEnd(9) +
      (widthOk ? ' ok  ' : ' BAD  ') +
      String(lv.coins.length).padStart(4) + ' ' +
      String(need).padStart(4) + ' ' +
      String(lv.enemies.length).padStart(3) + ' ' +
      String(lv.checkpoints.length).padStart(5) + ' ' +
      String(lv.spawns.length).padStart(5) + ' ' +
      String(!!lv.goal).padStart(5) + '  ' +
      String(lv.district).padEnd(18) +
      mech);
    if (!widthOk || !lv.goal || lv.spawns.length < 2 || lv.checkpoints.length < 1) bad++;
  } catch (e) {
    console.log(String(id).padStart(2) + '  X ' + e.message.slice(0, 70));
    bad++;
  }
}
console.log('-'.repeat(108));
console.log(bad === 0 ? '✅ 8 关全部可解析' : '❌ 有 ' + bad + ' 关有问题');
