/* ============================================================
 * account-save-test.js — 存档按账号隔离 + 旧档迁移
 * ============================================================
 * 这是整个账号改造里**最危险**的一块（碰存档 = 碰项目红线），
 * 所以单独一套测试守着：
 *
 *   ① 旧档自动迁移：无账号时代的老档（通关到第 5 关那种）
 *      在第一个账号注册时被"认领"，**进度一点都不能丢**
 *   ② 新账号是干净的：不继承别人的进度/设置/称号
 *   ③ 两个账号各玩各的：A 改进度不影响 B，B 改也不影响 A
 *   ④ 退出后用"游客档"兜底：未登录时存东西不崩、也不污染真账号
 *   ⑤ 删账号连带删存档：不留"孤儿档"
 *   ⑥ 删掉 account.js 也能跑（退回旧 key，向后兼容）
 *
 * ⚠️ 为什么必须有自己的存档空间（而不是共用一份再覆盖）：
 *   共用一份的话，"切账号"就变成了"清档 + 读档"，
 *   任何一步出错都会让玩家的进度归零。
 *   每账号一个 key 是**物理隔离**，出错的爆炸半径最小。
 * ============================================================ */

const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.resolve(__dirname, '..', 'src');

function makeSandbox() {
  const mem = {};
  function noop() { }
  const prox = new Proxy({}, { get: function (t, k) { if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; }; if (k === 'measureText') return function () { return { width: 10 }; }; return noop; }, set: function () { return true; } });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise, String, Number, Boolean,
    isNaN, parseInt, parseFloat, Proxy, Set, Map, Error,
    crypto: undefined,
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
      _mem: mem,
    },
    window: {
      addEventListener: noop, requestAnimationFrame: () => 0,
      Image: function () { this.width = 64; this.height = 64; },
      AudioContext: function () { return { state: 'running', currentTime: 0, sampleRate: 44100, createBuffer: (c, l) => ({ getChannelData: () => new Float32Array(l) }), createBufferSource: () => ({ buffer: null, loop: false, connect: noop, start: noop, stop: noop }), createBiquadFilter: () => ({ type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, Q: { setValueAtTime: noop }, connect: noop }), createOscillator: () => ({ frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }), createGain: () => ({ gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }), destination: {}, resume: noop }; },
    },
    document: { getElementById: () => ({ getContext: () => prox, width: 0, height: 0, style: {} }), addEventListener: noop, createElement: () => ({ getContext: () => prox, style: {}, appendChild: noop }) },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: () => 0, clearInterval: noop,
  };
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const FILES = ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'account.js', 'save.js'];
const sb = makeSandbox();
FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f }));
const run = c => vm.runInContext(c, sb);
const j = c => JSON.parse(run('JSON.stringify(' + c + ')'));

let P = 0, F = 0;
function ck(ok, msg, extra) { if (ok) { console.log('  [v] ' + msg); P++; } else { console.log('  [X] ' + msg + (extra ? '  → ' + extra : '')); F++; } }

console.log('=== 1. 旧存档自动迁移（红线：进度不能丢）===');
/* 造一份"无账号时代"的老存档：通关到第 5 关 */
const legacy = {
  version: 2, maxUnlocked: 5,
  unlockedActions: ['doubleJump', 'wallSlide', 'wallJump'],
  levels: { '1': { cleared: true, stars: 3 }, '2': { cleared: true, stars: 2 }, '3': { cleared: true, stars: 3 }, '4': { cleared: true, stars: 1 } },
  selectedCharacter: 'dragon', unlockedCharacters: ['kangaroo', 'dragon'],
  characterRecords: {}, seenUnlockAnimations: [],
  settings: { soundOn: false, volume: 0.4, shakeOn: true, hintsOn: true },
  mode: 'rider', titles: ['一单未取'],
};
run('localStorage.setItem("delivery-game-save-v1", ' + JSON.stringify(JSON.stringify(legacy)) + ')');
ck(j('localStorage.getItem("delivery-game-save-v1")') !== null, '老档已就位（模拟十一的老存档）');

/* 注册第一个账号 → 应自动认领老档 */
const r1 = j('ACCOUNT.register("十一", "mypass123")');
ck(r1.ok === true, '注册账号"十一"成功');
ck(j('localStorage.getItem("delivery-game-save-v1")') === null, '★ 老档被"认领"（旧 key 已清）');

const key1 = j('ACCOUNT.saveKey()');
ck(j('localStorage.getItem(' + JSON.stringify(key1) + ')') !== null, '★ 新 key 下确实有存档了');

run('Save.load()');
ck(j('Save.data.maxUnlocked') === 5, '★★ 迁移后进度没丢（maxUnlocked=5）');
ck(j('Save.data.selectedCharacter') === 'dragon', '★★ 选中角色没丢（dragon）');
ck(j('Save.data.mode') === 'rider', '★★ 模式没丢（rider）');
ck(j('Save.data.settings.soundOn') === false, '★★ 设置没丢（音效关着的）');
ck(j('Save.data.titles').length === 1, '★★ 称号没丢（一单未取）');
ck(j('Object.keys(Save.data.levels).length') === 4, '★★ 4 个关卡的记录都在');

console.log('\n=== 2. 新账号是干净的 ===');
const r2 = j('ACCOUNT.register("小红", "hong456")');
ck(r2.ok === true, '注册"小红"成功');
run('Save.reload()');
ck(j('Save.data.maxUnlocked') === 1, '★★ 小红的存档是全新的（maxUnlocked=1，没继承十一的进度）');
ck(j('Save.data.selectedCharacter') === 'kangaroo', '小红用默认角色');
ck(j('Save.data.titles').length === 0, '小红没有称号');
ck(j('Save.data.settings.soundOn') !== false, '★ 小红用的是自己的默认设置（不是十一的）');

console.log('\n=== 3. 切回十一，进度还在 ===');
const shi = j('ACCOUNT.list()').find(a => a.name === '十一');
ck(j('ACCOUNT.login("' + shi.id + '", "mypass123")').ok === true, '用密码登录十一');
run('Save.reload()');
ck(j('Save.data.maxUnlocked') === 5, '★★ 切回来进度还在（maxUnlocked=5）');
ck(j('Save.data.mode') === 'rider', '★★ 十一自己的模式也在');

console.log('\n=== 4. 两个账号各玩各的，互不影响 ===');
run('Save.data.maxUnlocked = 9; Save.save();');
ck(j('Save.data.maxUnlocked') === 9, '十一的进度改成 9');
const hong = j('ACCOUNT.list()').find(a => a.name === '小红');
j('ACCOUNT.login("' + hong.id + '", "hong456")');
run('Save.reload()');
ck(j('Save.data.maxUnlocked') === 1, '★★★ 切到小红 → 她的进度还是 1（**没被十一的 9 污染**）');
run('Save.data.maxUnlocked = 3; Save.save();');
j('ACCOUNT.login("' + shi.id + '", "mypass123")');
run('Save.reload()');
ck(j('Save.data.maxUnlocked') === 9, '★★★ 切回十一 → 她的进度还是 9（**没被小红的 3 覆盖**）');

console.log('\n=== 5. 退出后用游客档兜底（不崩）===');
j('ACCOUNT.logout()');
run('Save.reload()');
ck(j('Save.data.maxUnlocked') === 1, '未登录 → 读到游客档（干净的新档）');
run('Save.data.maxUnlocked = 99; Save.save()');
ck(j('Save.data.maxUnlocked') === 99, '★ 未登录时**能存**（顺手存一下的调用点不会炸）');
j('ACCOUNT.login("' + shi.id + '", "mypass123")');
run('Save.reload()');
ck(j('Save.data.maxUnlocked') === 9, '★★★ 游客档的改动**没污染**真账号（十一还是 9）');

console.log('\n=== 6. 删除账号连带删存档 ===');
const hong2 = j('ACCOUNT.list()').find(a => a.name === '小红');
const hongKey = 'delivery-game-save-v1::' + hong2.id;
ck(j('localStorage.getItem(' + JSON.stringify(hongKey) + ')') !== null, '小红的存档存在');
ck(j('ACCOUNT.remove("' + hong2.id + '", "hong456")').ok === true, '删除小红成功');
ck(j('localStorage.getItem(' + JSON.stringify(hongKey) + ')') === null, '★★ 小红的存档**也被删了**（不留孤儿档）');
ck(j('localStorage.getItem(' + JSON.stringify(key1) + ')') !== null, '★ 十一的存档**没被误删**');

console.log('\n=== 7. 删掉 account.js 也能跑（向后兼容）===');
(() => {
  const sb2 = makeSandbox();
  ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb2, { filename: f }));
  const r = c => vm.runInContext(r, sb2);
  const jj = c => JSON.parse(vm.runInContext('JSON.stringify(' + c + ')', sb2));
  sb2.localStorage.setItem('delivery-game-save-v1', JSON.stringify({ version: 2, maxUnlocked: 7, unlockedActions: [], levels: {}, selectedCharacter: 'kangaroo', unlockedCharacters: ['kangaroo'], characterRecords: {}, seenUnlockAnimations: [], settings: {}, mode: 'classic', titles: [] }));
  jj('Save.load()');
  ck(jj('Save.data.maxUnlocked') === 7, '★★ 没有 account.js 时，读的还是旧 key（兼容）');
})();

console.log('\n' + '='.repeat(52));
console.log('  存档隔离与迁移: ' + P + ' 通过 / ' + F + ' 失败');
console.log('='.repeat(52));
process.exit(F > 0 ? 1 : 0);
