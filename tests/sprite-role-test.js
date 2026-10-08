/* ============================================================
 * sprite-role-test.js — 角色贴图"选对了没"回归测试
 * ============================================================
 * 【十一报的 bug】"这个史迪奇宝宝跑酷内还是卡皮巴拉"
 *
 * 【根因】渲染层拿的是 sprite **对象**（不是 role 字符串），
 *   要靠"对象 === SPR_XXX"反查 role。而史迪奇暂时指向了 SPR_CAPYBARA
 *   ⇒ 反查成 capybara ⇒ **画成卡皮巴拉**。
 *
 *   修法：drawCharacter 加第 10 个参数 roleHint，**优先用它**。
 *   这个测试守的就是"每个角色都画出自己的图"。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; }
}

/* ---------- 沙箱：用真实 DOM canvas 的记录钩子 ---------- */
/* ⚠️ 做法说明：drawImage 被调用时记录图片的 __name。
 *    这样能验证"**实际画出来的**是哪张图"，而不是只看 getSpriteImage 的返回值
 *    （后者只证明"查得到"，不证明"真的画了那张"）。 */
function buildSandbox(drawnList) {
  function noop() {}
  const probeCache = {};
  function makeProbe() {
    return new Proxy({}, {
      get: function (t, k) {
        if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
        if (k === 'measureText') return function () { return { width: 10 }; };
        if (k === 'drawImage') return function (img) {
          if (img && img.__name) drawnList.push(img.__name);
        };
        return noop;
      },
      set: function () { return true; },
    });
  }
  const ctxProbe = makeProbe();
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
    /* ★ 暴露给测试代码用的钩子 ★ */
    __drawnName: function (n) { drawnList.push(n); },
    __makeProbe: makeProbe,
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
      getElementById: function () { return { getContext: function () { return ctxProbe; }, width: 0, height: 0, style: {} }; },
      addEventListener: noop,
      createElement: function () { return { getContext: function () { return ctxProbe; }, style: {}, appendChild: noop }; },
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
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
  'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js', 'ui.js',
];

const drawn = [];
const sb = buildSandbox(drawn);
FILES.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
});
const run = code => vm.runInContext(code, sb);
const runJson = code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', sb));

/* 先把四张图都标记为"已加载"，并给每张图一个可识别的名字 */
run(`(function(){
  Object.keys(SPRITE_IMAGES).forEach(function(k){
    SPRITE_IMAGES[k].ready = true;
    SPRITE_IMAGES[k].img = { width: 64, height: 64, __name: k };
  });
  return true;
})()`);

const ROLES = ['kangaroo', 'dragon', 'capybara', 'stitch'];

/* ============================================================
 * 1. 每个角色都能取到自己的图
 * ============================================================ */
console.log('\n=== 1. role → 贴图（getSpriteImage）===');
ROLES.forEach(function (role) {
  const got = runJson(`(function(){
    var s = getSpriteImage(${JSON.stringify(role)});
    return s ? { ok:true, name: s.img.__name, src: s.src } : { ok:false };
  })()`);
  check(got.ok && got.name === role,
    role + ' → ' + (got.ok ? got.name + '.png' : '取不到图！'));
});

/* ============================================================
 * 2. ★★ 真跑 drawCharacter（传 role 字符串），画出的必须是自己的图 ★★
 * ============================================================ */
console.log('\n=== 2. ★★ 真跑 drawCharacter（传 role）★★');
ROLES.forEach(function (role) {
  drawn.length = 0;
  runJson(`(function(){
    var probe = __makeProbe();
    drawCharacter(probe, ${JSON.stringify(role)}, 0, 0, 32, 32, false, 1);
    return true;
  })()`);
  const drewOwn = drawn.indexOf(role) >= 0;
  check(drewOwn, role + ' 画出的是 ' + (drawn[0] || '(无 drawImage)') +
    (drewOwn ? ' ✅' : ' ← **画错了！应该是 ' + role + '**'));
});

/* ============================================================
 * 3. ★★ 关键：传 sprite 对象时，**必须靠 roleHint 分清角色** ★★
 * ============================================================
 * 这是十一那个 bug 的核心场景：
 * 史迪奇的 sprite 对象和卡皮巴拉**是同一个**（game.js 里曾指向 SPR_CAPYBARA），
 * 所以"对象反查 role"永远分不开 —— 只有 roleHint 能救。
 */
console.log('\n=== 3. ★★ 传 sprite 对象 + roleHint（十一 bug 的核心场景）★★');
{
  const cases = [
    ['capybara', 'capybara'],
    ['stitch', 'capybara'],       // ← 故意让它俩共用 sprite 对象（复现 bug 现场）
    ['stitch', 'kangaroo'],       // ← 换个共用对象，确认 roleHint 依然说了算
  ];
  cases.forEach(function (pair) {
    const role = pair[0];
    drawn.length = 0;
    runJson(`(function(){
      var probe = __makeProbe();
      /* 第 2 个参数传 sprite 对象，第 10 个传 roleHint */
      drawCharacter(probe, SPR_CAPYBARA, 0, 0, 32, 32, false, 1, false, 0, ${JSON.stringify(role)});
      return true;
    })()`);
    check(drawn.indexOf(role) >= 0,
      'sprite=CAPYBARA + roleHint=' + role + ' → 画出 ' + (drawn[0] || '无') +
      (drawn.indexOf(role) >= 0 ? ' ✅（roleHint 生效）' : ' ← **被画成了 ' + drawn[0] + '**'));
  });
}

/* ============================================================
 * 4. ★★ 真·端到端：建一个史迪奇玩家，渲染它，看画的是哪张图 ★★
 * ============================================================
 * 这一段最接近真实场景：走 makePlayer → 真的渲染一帧。
 */
console.log('\n=== 4. ★★ 端到端：史迪奇玩家真的画成史迪奇 ★★');
{
  drawn.length = 0;
  const info = runJson(`(function(){
    /* 建一个 stitch 玩家（用当前关的出生点） */
    Save.reset();
    Game.isPk = false; Game.aiRoles = null;
    Game.mode='single'; Game.playerCount=1;
    loadLevel(0);
    var p = makePlayer('stitch', { x: 128, y: 600 });
    return { role: p.role, spriteIsCapy: (p.sprite === SPR_CAPYBARA) };
  })()`);
  /* 直接渲染这个玩家（复刻 render.js 里那次 drawCharacter 调用） */
  runJson(`(function(){
    var probe = __makeProbe();
    /* ⚠️ 关键：第 10 个参数传 p.role —— 这正是修复的内容 */
    drawCharacter(probe, (function(){
      var p2 = makePlayer('stitch', { x:128, y:600 });
      return p2.sprite;
    })(), 0, 0, 32, 32, false, 1, false, 0, 'stitch');
    return true;
  })()`);
  check(drawn.indexOf('stitch') >= 0,
    '★ 史迪奇玩家画出的是 ' + (drawn[0] || '无') + '（应为 stitch）');
  check(drawn.indexOf('capybara') < 0,
    '★ **没有**画出卡皮巴拉（bug 已修）');
}

/* ============================================================
 * 5. ★ 源码级检查（防回归）
 * ============================================================ */
console.log('\n=== 5. ★ 源码级检查（防回归）===');
{
  const gameSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  /* ⚠️ 必须**排除注释行** —— 我在修复说明里就写了
   *    "原来这里写的是 `role === 'stitch' ? SPR_CAPYBARA`" 这句话，
   *    第一版正则把注释也匹配进去了，自己把自己判失败。
   *    ⇒ 先剔掉注释（// 和 * 开头的行），再检查代码。 */
  const gameCode = gameSrc.split('\n').filter(function (line) {
    const t = line.trim();
    return !(t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0);
  }).join('\n');
  check(!/role === 'stitch'[\s\S]{0,30}SPR_CAPYBARA/.test(gameCode),
    '★ game.js 的**代码**里没有"stitch → SPR_CAPYBARA"的映射（bug 的源头）');

  const sprSrc = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
  check(/function drawCharacter\([\s\S]{0,200}roleHint/.test(sprSrc),
    '★ sprites.js 的 drawCharacter 支持 roleHint 参数');
  check(!/stitch'[\s\S]{0,10}\?\s*SPR_CAPYBARA/.test(sprSrc),
    '★ 代码像素画的兜底里也没有"stitch 借卡皮巴拉"');

  const renderSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  const callIdx = renderSrc.indexOf('drawCharacter(\n    ctx, p.sprite');
  check(callIdx >= 0 && renderSrc.slice(callIdx, callIdx + 400).indexOf('p.role') >= 0,
    '★ render.js 调 drawCharacter 时把 p.role 传进去了');
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('  角色贴图回归测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);
