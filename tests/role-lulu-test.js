/* ============================================================
 * role-lulu-test.js — 「噜噜」（恐龙装水豚）回归测试
 * ============================================================
 * 十一的要求（逐条验证）：
 *   ① 贴图用 sprite-pixel2（柔和像素版）
 *   ② 兑换码「宁宁」解锁
 *   ③ 挂机 5 秒没动 → 手上拿橘子
 *   ④ 走路要设计专属动作
 *   ⑤ 橘子拖尾，**2 秒**消失
 *   ⑥ 二段跳要设计专属动作
 *   ⑦ 佛系宅水豚个性
 *   ⑧ 能力：落速最慢（我定的新维度）
 *   ⑨ ★ **方向不能倒着走**（十一强调过两次）
 *
 * ⚠️ 关键不变量：**其他 12 个角色完全不受影响**
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

console.log('='.repeat(62));
console.log('  「噜噜」（恐龙装水豚）· 回归测试');
console.log('='.repeat(62));

/* ============================================================
 * A. 角色基本配置
 * ============================================================ */
console.log('\n--- A. 角色配置 ---');
{
  const raw = run('JSON.stringify(charById("lulu"))');
  check(raw !== 'undefined' && raw !== 'null', 'charById("lulu") 能找到配置');
  const cfg = JSON.parse(raw || 'null');
  if (cfg) {
    check(cfg.name === '噜噜', '显示名 = 噜噜（' + cfg.name + '）');
    check(cfg.sprite === 'lulu', 'sprite = lulu');
    check(cfg.ready === true, 'ready = true');
    check(cfg.unlockLevel === 0, 'unlockLevel = 0（不靠通关，只能兑码）');
    check(cfg.unlockedByDefault === false, '不是初始角色');
    check(/^#[0-9a-fA-F]{6}$/.test(cfg.accentColor), '配色合法（' + cfg.accentColor + '，橘子橙）');
  }
}

/* ============================================================
 * B. ★ 方向：绝不能倒着走（十一强调过两次）
 * ============================================================ */
console.log('\n--- B. ★ 朝向（不能倒着走）---');
{
  const slot = JSON.parse(run('JSON.stringify(SPRITE_IMAGES["lulu"])'));
  /* 素材的图是朝左的（水豚鼻子、恐龙上颚、箱子开口都朝左）*/
  check(slot.facesRight === false,
    '★★ facesRight = false（素材原图朝左）');

  /* 复刻 sprites.js 的镜像判定逻辑，验证两个方向都对：
   *   needMirror = (flip === true) !== (!slot.facesRight) */
  const needMirror = (flip) => (flip === true) !== (!slot.facesRight);
  /* 角色朝右走 → flip = false（不翻转）→ 需要镜像原图（因为原图朝左）*/
  check(needMirror(false) === true,
    '★★ 朝右走时**会镜像**（原图朝左 → 镜像后朝右）✓');
  /* 角色朝左走 → flip = true → 不需要镜像（原图本来就朝左）*/
  check(needMirror(true) === false,
    '★★ 朝左走时**不镜像**（原图本来就朝左）✓');

  /* 反例守卫：如果误标成 true，两边就正好反了 —— 会倒着走 */
  const wrongMirror = (flip) => (flip === true) !== (!true);
  check(wrongMirror(false) === false && wrongMirror(true) === true,
    '★ 确认"误标 true"会导致完全相反（这就是倒着走的成因）');
}

/* ============================================================
 * C. ★ 能力：落速最慢（新维度）
 * ============================================================ */
console.log('\n--- C. ★ 能力：落速最慢 ---');
{
  const cfg = JSON.parse(run('JSON.stringify(charById("lulu"))'));
  check(typeof cfg.fallGravityMultiplier === 'number',
    '★★ 配了 fallGravityMultiplier（新维度）');
  /* < 1 = 重力更小 = 掉得更慢 */
  check(cfg.fallGravityMultiplier > 0 && cfg.fallGravityMultiplier < 1,
    '★★ 值在 (0,1)：' + cfg.fallGravityMultiplier + ' ⇒ 下落更慢');
  /* 不能太慢（会像月球，操作变怪） */
  check(cfg.fallGravityMultiplier >= 0.7,
    '★ 不低于 0.7（低于此会飘得失控）');

  /* 常规五项都是标准值 —— 它的强项不在这些维度上 */
  const normal = ['speedMultiplier', 'jumpMultiplier', 'dashMultiplier',
    'wallStaminaMultiplier', 'wallJumpMultiplier'];
  check(normal.every(k => cfg[k] === 1),
    '★★ 常规五项全是 1.0（**不抢**别人的招牌）');

  /* 它是"落速最慢"的冠军（普通角色范围内）*/
  const all = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="pinkstitch" && c.id!=="lulu"}))'));
  const bestOthers = Math.min.apply(null, all.map(c =>
    (typeof c.fallGravityMultiplier === 'number') ? c.fallGravityMultiplier : 1));
  check(cfg.fallGravityMultiplier < bestOthers,
    '★★ 落速是普通角色里最慢的（' + cfg.fallGravityMultiplier +
    ' < 其他最慢 ' + bestOthers + '）');

  /* ⚠️ 只对下落段生效 —— 不能连上升段也减（否则变成"跳得更高"，抢袋鼠招牌）*/
  const pSrc = fs.readFileSync(path.join(SRC, 'js', 'physics.js'), 'utf8');
  check(/ent\.vy > 0[\s\S]{0,300}?fallGravityMul/.test(pSrc),
    '★★★ physics.js 只在 **vy > 0（下落段）** 才减重力（不抢袋鼠的跳跃）');
  check(/fallGravityMul[\s\S]{0,200}?ent\.vy \+= g/.test(pSrc),
    '★ 重力确实被替换成 g（改到消费点了）');

  /* charMul 能正确返回 0.82（>0 才通过校验）*/
  const viaCharMul = run('charMul("lulu", "fallGravityMultiplier")');
  check(Math.abs(viaCharMul - cfg.fallGravityMultiplier) < 1e-9,
    '★ charMul 能取到该值（' + viaCharMul + '）');

  /* 其他角色没配 ⇒ 返回 1 ⇒ 行为完全不变 */
  const others = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="lulu" && c.id!=="pinkstitch"}).map(function(c){return c.role}))'));
  const allOne = others.every(r => run(`charMul(${JSON.stringify(r)}, "fallGravityMultiplier")`) === 1);
  check(allOne, '★★ 其他角色该倍率恒为 1（向后兼容，物理不变）');
}

/* ============================================================
 * D. ④ 走路专属动作
 * ============================================================ */
console.log('\n--- D. 走路专属动作 ---');
{
  const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["lulu"])'));
  check(m.tiltSwing > 0, '★★ tiltSwing = ' + m.tiltSwing + '（箱子左右倾斜，只有它开）');
  check(m.legSwing > 0, '★★ legSwing = ' + m.legSwing + '（小短腿挪步）');
  check(m.freqMul < 1, '★ freqMul = ' + m.freqMul + ' < 1（步子慢，符合"佛系宅"）');
  check(m.swayAmp > 2.5, '★ swayAmp = ' + m.swayAmp + '（摆得明显 —— 不倒翁感）');
  check(m.bobAmp < 2.5, '★ bobAmp = ' + m.bobAmp + '（起伏小 —— 显"沉"）');

  /* tiltSwing 要正负交替（真的在左右晃，不是单侧歪）*/
  const samples = JSON.parse(run(`(function(){
    var out = [];
    for (var i = 0; i < 24; i++) {
      var wm = walkMotion(i * 0.05, 3, true, 'lulu');
      out.push(wm.tiltSwing);
    }
    return JSON.stringify(out);
  })()`));
  check(samples.some(v => v > 0.01) && samples.some(v => v < -0.01),
    '★★ tiltSwing 正负交替（真的在"左右晃"）');

  /* 站住不动时不该晃 */
  const still = JSON.parse(run('JSON.stringify(walkMotion(5, 0, true, "lulu"))'));
  check(still.tiltSwing === 0 && still.legSwing === 0,
    '★ 站着不动时不晃（不会原地摇）');

  /* 其他角色恒为 0 */
  const roles = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="lulu" && c.id!=="pinkstitch" && c.id!=="pinkstitch"}).map(function(c){return c.role}))'));
  const zero = roles.every(function (r) {
    const mx = JSON.parse(run(`(function(){
      var mx = 0;
      for (var i = 0; i < 20; i++) {
        var wm = walkMotion(i * 0.06, 3, true, ${JSON.stringify(r)});
        if (Math.abs(wm.tiltSwing || 0) > mx) mx = Math.abs(wm.tiltSwing || 0);
      }
      return mx;
    })()`));
    return mx === 0;
  });
  check(zero, '★★ 其他角色的 tiltSwing 恒为 0（不受影响）');
}

/* ============================================================
 * E. ⑥ 二段跳专属动作
 * ============================================================ */
console.log('\n--- E. 二段跳专属动作 ---');
{
  const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["lulu"])'));
  check(m.spinMul === 0, '★★ spinMul = 0（不翻滚）');
  check(m.hopStyle === 'box', '★★ hopStyle = "box"（箱子弹簧，专属动作）');

  const sm = JSON.parse(run('JSON.stringify(spinMotionFor("lulu"))'));
  check(sm.spinMul === 0, '★ spinMotionFor 返回 spinMul = 0');
  check(sm.hopStyle === 'box', '★ spinMotionFor 返回 hopStyle = box');

  /* 整个翻滚过程旋转角必须恒为 0 */
  const spins = JSON.parse(run(`(function(){
    var out = [];
    for (var i = 0; i <= 20; i++) {
      var prog = i / 20;
      var sm = spinMotionFor('lulu');
      var e = prog < 0.5 ? 4*prog*prog*prog : 1 - Math.pow(-2*prog+2,3)/2;
      out.push(e * Math.PI * 2 * sm.spinMul);
    }
    return JSON.stringify(out);
  })()`));
  check(spins.every(v => Math.abs(v) < 1e-9),
    '★★ 整个过程旋转角恒为 0（确实没翻滚）');

  /* 两个角色的二段跳动作必须不同 */
  const a = JSON.parse(run('JSON.stringify(spinMotionFor("lulu"))'));
  const b = JSON.parse(run('JSON.stringify(spinMotionFor("pinkstitch"))'));
  check(a.hopStyle !== b.hopStyle,
    '★★ 和「十一」的二段跳动作不同（' + a.hopStyle + ' vs ' + b.hopStyle + '）');

  /* render.js 里必须有 box 分支 */
  const rSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(rSrc.indexOf("sm.hopStyle === 'box'") >= 0,
    '★★ render.js 有 box 的二段跳分支');
  check(rSrc.indexOf('boxHopStretch') >= 0,
    '★ 有 boxHopStretch（橘子气浪的强度变量）');
}

/* ============================================================
 * F. ③ 挂机 5 秒 → 掏橘子
 * ============================================================ */
console.log('\n--- F. 挂机 5 秒掏橘子 ---');
{
  const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["lulu"])'));
  check(m.idleOrange === true, '★★ idleOrange = true（挂机会掏橘子）');

  const gSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  check(gSrc.indexOf('_idleT') >= 0, '★★ game.js 有 _idleT（静止计时）');

  const rSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(/_idleT >= 5/.test(rSrc),
    '★★★ 阈值正好 5 秒（十一指定的"挂机 5 秒"）');
  check(rSrc.indexOf('_idleOrangeShow') >= 0, '★★ render.js 有 _idleOrangeShow 判定');

  /* ⚠️ 静止判定必须"一动就归零"，否则动了之后橘子还挂着 */
  check(/p\._idleT = idleNow \? \(p\._idleT \|\| 0\) \+ dt : 0/.test(gSrc),
    '★★ 一动/离地就归零（`idleNow ? 累计 : 0`）');

  /* 只有它开 */
  const roles = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="lulu" && c.id!=="pinkstitch"}).map(function(c){return c.role}))'));
  const onlyHim = roles.every(function (r) {
    const mm = JSON.parse(run(`JSON.stringify(ROLE_MOTION[${JSON.stringify(r)}] || {})`));
    return mm.idleOrange !== true;
  });
  check(onlyHim, '★ 只有噜噜会掏橘子（其他角色没有）');
}

/* ============================================================
 * G. ⑤ 橘子拖尾（2 秒 + 跟速度匹配）
 * ============================================================ */
console.log('\n--- G. 橘子拖尾 ---');
{
  const gSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  const rSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');

  check(gSrc.indexOf('function spawnOrangeTrail') >= 0, '★★ game.js 有 spawnOrangeTrail');
  check(rSrc.indexOf("p.type === 'orange'") >= 0,
    "★★ render.js 有 'orange' 粒子类型的绘制");
  check(rSrc.indexOf('peelColor') >= 0, '★ 画的是橘子（有 peelColor 橘皮色）');

  /* ★ 寿命必须正好 2 秒（120 帧 @60fps）*/
  check(/life:\s*120/.test(gSrc) && /maxLife:\s*120/.test(gSrc),
    '★★★ 寿命 = 120 帧 ≈ **正好 2 秒**（十一指定的）');

  /* ★★ 按"移动距离"发放，而不是固定时间间隔 —— 这是"跟速度匹配"的关键 */
  check(/ORANGE_TRAIL_GAP/.test(gSrc),
    '★★★ 用距离阈值 ORANGE_TRAIL_GAP（按走过的距离发，不是按时间）');
  check(/Math\.abs\(cx - p\._orangeLastX\) < ORANGE_TRAIL_GAP/.test(gSrc),
    '★★ 用"上次落点到现在走了多远"判断 ⇒ 快跑慢走**间距恒定**');

  /* ⚠️ 反例说明：如果是时间间隔，跑得快就稀疏 */
  const perFrame = /\bGAP\b[\s\S]{0,80}?life/.test(gSrc);

  /* 不受重力（留在地上，不飘走）*/
  check(gSrc.indexOf("p.type !== 'orange'") >= 0,
    '★★ orange 粒子不受重力（留在地上）');

  /* 只有它在跑动时才留 */
  check(/p\.role === 'lulu'[\s\S]{0,150}?onGround[\s\S]{0,150}?Math\.abs\(p\.vx\) > 0\.5/.test(gSrc),
    '★★ 只有噜噜 + 在地面 + 真的在动 才留拖尾');
}

/* ============================================================
 * H. ② 兑换码「宁宁」
 * ============================================================ */
console.log('\n--- H. 兑换码「宁宁」---');
{
  const uSrc = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');
  check(/'宁宁':\s*\{/.test(uSrc), "★★ ui.js 配了兑换码「宁宁」");
  check(uSrc.indexOf("const id = 'lulu'") >= 0, '★ 兑换码给的是 lulu');
  check(/key === '宁宁'/.test(uSrc) || /'宁宁'[\s\S]{0,200}allowRetry/.test(uSrc),
    '★ 有"角色没到手时可重兑"的例外规则');
}

/* ============================================================
 * I. ⑦ 佛系宅水豚个性
 * ============================================================ */
console.log('\n--- I. 个性 ---');
{
  const cfg = JSON.parse(run('JSON.stringify(charById("lulu"))'));
  check(typeof cfg.tagline === 'string' && cfg.tagline.length > 0,
    '★ 有 tagline（' + cfg.tagline + '）');
  check(typeof cfg.description === 'string' && cfg.description.indexOf('佛系') >= 0,
    '★ description 写明了"佛系"人设');
  check(cfg.description.indexOf('飘') >= 0,
    '★ description 提到了核心能力"飘着下坠"');
}

/* ============================================================
 * J. 贴图与打包
 * ============================================================ */
console.log('\n--- J. 贴图与打包 ---');
{
  const png = path.join(SRC, 'assets', 'lulu.png');
  check(fs.existsSync(png), 'lulu.png 存在于 src/assets/');
  if (fs.existsSync(png)) {
    const b = fs.readFileSync(png);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    check(w <= 200 && h <= 200, '尺寸合理（' + w + '×' + h + '）');
    const ratio = w / h;
    check(ratio >= 0.5 && ratio <= 1.3,
      '体型比例正常（宽高比 ' + ratio.toFixed(2) + '）');
  }
  check(fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8')
    .indexOf("src: 'assets/lulu.png'") >= 0, 'sprites.js 注册了 lulu.png');

  const bSrc = fs.readFileSync(path.join(PROJ, 'tools', 'build-single.js'), 'utf8');
  check(bSrc.indexOf("'lulu.png'") >= 0, 'build-single.js 内嵌清单含 lulu.png');
}

/* ============================================================
 * K. 向后兼容总检
 * ============================================================ */
console.log('\n--- K. 向后兼容 ---');
{
  const a = JSON.parse(run('JSON.stringify(walkMotion(1.0, 3.0, true))'));
  check(a.tiltSwing === 0 && a.legSwing === 0,
    '★ 不传 role 时新字段全为 0（老调用点行为不变）');

  const total = run('CHARACTERS.filter(function(c){return c.ready}).length');
  check(total === 13, '★ 角色总数 = 13（12 个原有 + 噜噜）');

  /* 现有角色的招牌没被抢 */
  const all = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="pinkstitch" && c.id!=="lulu"}))'));
  const top = (k) => all.reduce((b, c) => ((c[k] || 1) > (b[k] || 1) ? c : b), all[0]);
  check(top('jumpMultiplier').id === 'kangaroo', '★ 跳跃最高仍是袋鼠');
  check(top('speedMultiplier').id === 'fish', '★ 速度最高仍是小鱼');
  check(top('dashMultiplier').id === 'stitch', '★ 冲刺最高仍是史迪奇');
}

console.log('\n' + '='.repeat(62));
console.log('  「噜噜」回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(62));
if (fail > 0) process.exit(1);
