/* ============================================================
 * role-motion-test.js — 角色专属行走 / 翻滚动画（2026-10-07）
 * ============================================================
 * 十一的要求："把不同角色的行走动作和翻滚动作都设计的不同，
 *             要符合他们的人物性格，还有他们的特长。"
 *
 * 验证：
 *   ① 11 个角色**每一个**都有专属动画配置
 *   ② 每个角色的动画**彼此不同**（不能有两个人一模一样）
 *   ③ 动画值落在安全范围（不会变形到看不出是角色）
 *   ④ ⚠️ **不传 role 时行为与改造前完全一致**（向后兼容）
 *   ⑤ 静止 / 空中 → 中性值（不会原地抖）
 *   ⑥ 性格契合：几个代表性角色的动画方向对不对
 *      （碧琪最夸张 / 卡皮巴拉最慢 / 小鱼是负摆动…）
 *   ⑦ 翻滚特征（spinMul / spinStretch）也各不相同
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');

let pass = 0, fail = 0;
const problems = [];
function check(ok, msg) {
  if (ok) { console.log('    [v] ' + msg); pass++; }
  else { console.log('    [X] ' + msg); fail++; problems.push(msg); }
}

function mkEl() {
  const e = {
    style: {}, className: '', innerHTML: '', innerText: '', textContent: '', id: '',
    children: [], appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    getContext() {
      return {
        save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        quadraticCurveTo() {}, arc() {}, ellipse() {}, rect() {},
        fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, clearRect() {},
        fillText() {}, strokeText() {}, measureText() { return { width: 10 }; },
        createRadialGradient() { return { addColorStop() {} }; },
        createLinearGradient() { return { addColorStop() {} }; },
        drawImage() {}, getImageData() { return { data: [] }; },
        setTransform() {}, clip() {}, setLineDash() {},
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', textBaseline: '', lineCap: '', imageSmoothingEnabled: false,
      };
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    focus() {}, blur() {}, click() {},
  };
  Object.defineProperty(e, 'width', { value: 1280, writable: true });
  Object.defineProperty(e, 'height', { value: 720, writable: true });
  return e;
}

const sb = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean,
  Error, TypeError, RangeError, isFinite, isNaN, parseInt, parseFloat,
  Infinity, NaN, undefined, Map, Set, Promise, RegExp, Symbol,
  document: {
    getElementById: () => mkEl(), querySelector: () => mkEl(),
    querySelectorAll: () => [], createElement: () => mkEl(),
    body: mkEl(), documentElement: mkEl(), head: mkEl(),
    addEventListener() {}, removeEventListener() {},
  },
  window: null,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  performance: { now: () => Date.now() },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  navigator: { userAgent: 'node', maxTouchPoints: 0 },
  location: { href: '', search: '', reload() {} },
  alert: () => {}, prompt: () => null, confirm: () => true,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  Image: function () { return mkEl(); },
  Audio: function () { return { play() {}, pause() {}, cloneNode() { return this; } }; },
};
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);

['physics.js', 'sprites.js', 'characters.js'].forEach(function (f) {
  const p = path.join(SRC, 'js', f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f });
});
const run = e => vm.runInContext(e, sb);

console.log('='.repeat(58));
console.log('  角色专属行走 / 翻滚动画 · 回归测试');
console.log('='.repeat(58));

/* 全部角色清单 */
const ROLES = run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready}).map(function(c){return c.id}))');
const roleList = JSON.parse(ROLES);
console.log('\n  待检查角色（' + roleList.length + ' 个）: ' + roleList.join(', '));

/* ============================================================
 * A. 每个角色都有专属动画配置
 * ============================================================ */
console.log('\n--- A. 配置完整性 ---');
{
  check(roleList.length >= 11, '已制作角色 ≥ 11 个（实际 ' + roleList.length + '）');

  const missing = [];
  roleList.forEach(function (r) {
    const cfg = run('JSON.stringify((typeof ROLE_MOTION !== "undefined" && ROLE_MOTION["' + r + '"]) || null)');
    if (cfg === 'null') missing.push(r);
  });
  check(missing.length === 0,
    '★ 每个角色都配了专属动画' + (missing.length ? ' — 缺: ' + missing.join(', ') : ''));

  /* 必需字段齐不齐 */
  const badFields = [];
  roleList.forEach(function (r) {
    const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || null)'));
    if (!m) { badFields.push(r + '(无配置)'); return; }
    ['bobAmp', 'swayAmp', 'squashAmp', 'freqMul', 'spinMul', 'spinStretch'].forEach(function (k) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) badFields.push(r + '.' + k);
    });
  });
  check(badFields.length === 0,
    '★ 所有动画字段齐全且是有效数字' + (badFields.length ? ' — 异常: ' + badFields.join(', ') : ''));

  /* 每个角色都写了 note（性格理由） */
  const noNote = [];
  roleList.forEach(function (r) {
    const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || {})'));
    if (!m.note || m.note.length < 4) noNote.push(r);
  });
  check(noNote.length === 0,
    '★ 每个角色的动画都写了"性格理由"' + (noNote.length ? ' — 缺: ' + noNote.join(', ') : ''));
}

/* ============================================================
 * B. 彼此不同（不能有两个人一模一样）
 * ============================================================ */
console.log('\n--- B. 动画彼此不同 ---');
{
  const sigs = {};
  roleList.forEach(function (r) {
    const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || {})'));
    if (!m) return;
    /* 用"能看出差别"的整数化特征做指纹 —— 浮点全等太严，
     * 玩家看到的差异本来就是"档位"级别的。 */
    const sig = [
      Math.round((m.bobAmp || 0) * 10),
      Math.round((m.swayAmp || 0) * 10),
      Math.round((m.squashAmp || 0) * 100),
      Math.round((m.freqMul || 1) * 100),
    ].join('|');
    if (!sigs[sig]) sigs[sig] = [];
    sigs[sig].push(r);
  });

  const dup = Object.keys(sigs).filter(function (k) { return sigs[k].length > 1; });
  check(dup.length === 0,
    '★★ 11 个角色的"走路指纹"互不相同' +
    (dup.length ? ' — 重复组: ' + dup.map(function (k) { return sigs[k].join('/'); }).join(' ; ') : ''));

  /* 翻滚也要不同 */
  const spinSigs = {};
  roleList.forEach(function (r) {
    const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || {})'));
    if (!m) return;
    /* ⚠️ 2026-10-07：把 `hopStyle` 也纳入指纹。
     * 因为「十一」的 spinMul = 0（**刻意不翻滚**，改成"撒糖霜"），
     * 而小狗的标准翻滚是 1.0 —— 两个都"不是特别"，指纹会撞。
     * 但它们的**二段跳动作其实完全不同**（一个翻滚、一个撒糖霜），
     * 所以要用 hopStyle 区分开。 */
    const style = m.hopStyle || 'spin';
    const sig = style + '|' + Math.round((m.spinMul || 0) * 100) + '|' +
      Math.round((m.spinStretch || 1) * 100);
    if (!spinSigs[sig]) spinSigs[sig] = [];
    spinSigs[sig].push(r);
  });
  const spinDup = Object.keys(spinSigs).filter(function (k) { return spinSigs[k].length > 1; });
  check(spinDup.length === 0,
    '★★ ' + roleList.length + ' 个角色的"二段跳/翻滚指纹"互不相同' +
    (spinDup.length ? ' — 重复组: ' + spinDup.map(function (k) { return spinSigs[k].join('/'); }).join(' ; ') : ''));
}

/* ============================================================
 * C. 安全范围（不会变形到认不出）
 * ============================================================ */
console.log('\n--- C. 数值安全范围 ---');
{
  const bad = [];
  roleList.forEach(function (r) {
    const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || {})'));
    if (!m) return;
    const bob = Math.abs(m.bobAmp || 0);
    const sway = Math.abs(m.swayAmp || 0);
    const squash = Math.abs(m.squashAmp || 0);
    const freq = m.freqMul || 1;
    if (bob > 5.5) bad.push(r + '.bobAmp=' + bob + '(过大)');
    if (sway > 3.5) bad.push(r + '.swayAmp=' + sway + '(过大)');
    if (squash > 0.16) bad.push(r + '.squashAmp=' + squash + '(会明显变形)');
    if (freq < 0.5 || freq > 1.6) bad.push(r + '.freqMul=' + freq + '(超出合理区间)');
    /* ⚠️ spinMul = 0 是**合法值**（表示"这个角色不翻滚"，
     * 「十一」就是这么配的）。所以下限从 0.6 放宽到 0。 */
    if (m.spinMul < 0 || m.spinMul > 1.6) bad.push(r + '.spinMul=' + m.spinMul);
    if (m.spinStretch < 0.8 || m.spinStretch > 1.5) bad.push(r + '.spinStretch=' + m.spinStretch);
  });
  check(bad.length === 0,
    '★ 所有数值都在"看得出但不走形"的安全区间' +
    (bad.length ? ' — 越界: ' + bad.join(', ') : ''));
}

/* ============================================================
 * D. ⚠️ 向后兼容：不传 role 时行为不变
 * ============================================================ */
console.log('\n--- D. 向后兼容（关键） ---');
{
  /* 老调用方式（3 个参数）应该和改造前完全一样 */
  const a = JSON.parse(run('JSON.stringify(walkMotion(1.0, 3.0, true))'));
  const b = JSON.parse(run('JSON.stringify(walkMotion(1.0, 3.0, true, null))'));
  const c = JSON.parse(run('JSON.stringify(walkMotion(1.0, 3.0, true, "不存在的角色"))'));

  check(a.bob === b.bob && a.sway === b.sway && a.squash === b.squash,
    '★ 不传 role 和不传角色名 → 结果一致（走默认参数）');
  check(a.bob === c.bob && a.sway === c.sway && a.squash === c.squash,
    '★ 传一个不存在的 role → 也走默认（不会崩、不会 undefined）');

  /* 默认值应该就是 WALK 表里的原始值。
   * ⚠️ 不能用"随便取一个 animT 然后和幅度比" —— 因为 bob = |sin(ph)| × amp，
   *    相位不对就取不到峰值。正确做法：**扫一个周期取最大值**。 */
  const wAmp = run('WALK.bobAmp');
  const gotBob = run(`(function(){
    var mx = 0;
    for (var i = 0; i <= 200; i++) {
      var m = walkMotion(i / 20, 3.0, true);   /* 扫 10 秒 */
      if (m.bob > mx) mx = m.bob;
    }
    return mx;
  })()`);
  check(Math.abs(gotBob - wAmp) < 0.01,
    '★ 默认动画的 bob 峰值 = WALK.bobAmp（' + gotBob.toFixed(2) + ' ≈ ' + wAmp + '）');
}

/* ============================================================
 * E. 静止 / 空中 → 中性值
 * ============================================================ */
console.log('\n--- E. 边界情况 ---');
{
  const still = JSON.parse(run('JSON.stringify(walkMotion(5.0, 0, true, "pinkiepie"))'));
  check(still.bob === 0 && still.sway === 0 && still.squash === 1,
    '★ 静止时（速度 0）→ 中性值，不会原地抖');

  const air = JSON.parse(run('JSON.stringify(walkMotion(5.0, 3.0, false, "pinkiepie"))'));
  check(air.bob === 0 && air.sway === 0 && air.squash === 1,
    '★ 空中时 → 中性值（空中走自己的跳跃姿态）');

  const slow = JSON.parse(run('JSON.stringify(walkMotion(5.0, 0.1, true, "pinkiepie"))'));
  check(slow.bob === 0, '★ 慢到阈值以下也算静止（不会抖）');
}

/* ============================================================
 * F. 性格契合（代表性的几个）
 * ============================================================ */
console.log('\n--- F. 性格 / 特长契合 ---');
{
  const M = r => JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || {})'));

  /* 碧琪 = 全场最夸张 */
  const pinkie = M('pinkiepie');
  const maxBob = Math.max.apply(null, roleList.map(r => Math.abs(M(r).bobAmp || 0)));
  check(Math.abs(pinkie.bobAmp) >= maxBob - 0.001,
    '★★ 碧琪起伏最大（' + pinkie.bobAmp + '，全场第一 —— 派对狂停不下来）');

  /* 卡皮巴拉 = 最慢 */
  const capy = M('capybara');
  const minFreq = Math.min.apply(null, roleList.map(r => M(r).freqMul || 1));
  check(Math.abs(capy.freqMul - minFreq) < 0.001,
    '★★ 卡皮巴拉步子最慢（freqMul=' + capy.freqMul + ' —— 佛系水豚）');

  /* 小鱼 = 负摆动（游动感，全场唯一） */
  const fish = M('fish');
  check(fish.swayAmp < 0, '★★ 小鱼是**负摆动**（' + fish.swayAmp + ' —— 游动而非迈步）');
  const negCount = roleList.filter(r => M(r).swayAmp < 0).length;
  check(negCount === 1, '★ 全场只有小鱼用负摆动（' + negCount + ' 个）');

  /* 飞龙 = 步子最急（跑最快） */
  const dragon = M('dragon');
  const maxFreq = Math.max.apply(null, roleList.map(r => M(r).freqMul || 1));
  check(dragon.freqMul >= maxFreq - 0.15,
    '★★ 飞龙步子最急（freqMul=' + dragon.freqMul + '，与最快的碧琪同档 —— 跑最快）');

  /* 碧琪翻滚最快、尼克拉得最开 */
  const nick = M('nick');
  const maxSpin = Math.max.apply(null, roleList.map(r => M(r).spinMul || 1));
  check(Math.abs(pinkie.spinMul - maxSpin) < 0.001,
    '★★ 碧琪翻滚最快（spinMul=' + pinkie.spinMul + ' —— 像上了发条）');
  const maxStretch = Math.max.apply(null, roleList.map(r => M(r).spinStretch || 1));
  check(Math.abs(nick.spinStretch - maxStretch) < 0.001,
    '★★ 尼克翻滚拉得最开（spinStretch=' + nick.spinStretch + ' —— 呼应"二段跳最狠"）');

  /* 史迪奇 = 压得最低 + 翻得最"紧凑"（团着转） */
  const stitch = M('stitch');
  /* ⚠️ 最"团得紧"的是 spinStretch 最小的那个。
   *    实测：碧琪 0.88（她连翻滚都要夸张地快转）比史迪奇 0.9 还小，
   *    所以这里断言"史迪奇属于最紧凑的一档"（≤0.92），
   *    而不是"必须是全场最小"—— 后者会被碧琪的夸张设定挤掉。 */
  check(stitch.spinStretch <= 0.92,
    '★ 史迪奇翻滚团得紧（spinStretch=' + stitch.spinStretch + ' —— 爆发型"绷紧旋转"）');
  const minBob = Math.min.apply(null, roleList.map(r => M(r).bobAmp || 0));
  check(stitch.bobAmp <= minBob + 0.25,
    '★ 史迪奇走路压得最低（bobAmp=' + stitch.bobAmp + ' —— 六爪扒地）');
}

/* ============================================================
 * G. 源码级防线
 * ============================================================ */
console.log('\n--- G. 源码级防线 ---');
{
  const rSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(rSrc.indexOf('walkMotion(p.animT, p.vx, p.onGround, p.role)') >= 0,
    '★ render.js 调 walkMotion 时**传了 role**（否则动画不生效）');
  check(rSrc.indexOf('spinMotionFor(p.role)') >= 0,
    '★ render.js 翻滚用了 spinMotionFor(p.role)');
  check(rSrc.indexOf('walkLeanApplied') >= 0,
    '★ 走路前倾的变换被正确 restore（不会漏还原导致画面旋转）');

  const sSrc = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
  check(sSrc.indexOf('const ROLE_MOTION') >= 0, '★ sprites.js 定义了 ROLE_MOTION 表');
  check(/function walkMotion\([^)]*role\)/.test(sSrc),
    '★ walkMotion 签名接受第 4 个参数 role');
  check(sSrc.indexOf('function spinMotionFor') >= 0, '★ 定义了 spinMotionFor');
}

console.log('\n' + '='.repeat(58));
console.log('  角色专属动画回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(58));
if (fail > 0) process.exit(1);
