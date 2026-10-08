/* ============================================================
 * role-eleven-test.js — 「十一」（粉色史迪仔·甜品主题）回归测试
 * ============================================================
 * 十一的要求（连续五条，都在这一份里验证）：
 *   ① "这个的名字就叫十一吧。"              → 显示名 = 十一
 *   ② "这个是非常厉害的，全是拉满的。"        → 五项全满配
 *   ③ "跳跃的时候就不要翻滚了，重新设计一个动作" → 不翻滚 + 专属动作
 *   ④ "走路的话，脚可以动起来。"            → legSwing
 *   ⑤ "静止的时候，手上拿着一根棒棒糖…彩色的"  → lollipop
 *   ⑥ "移动拖尾…留下小蛋糕的样子…两三秒消失"  → dessert 拖尾
 *   ⑦ 兑换码 `11` 解锁
 *
 * ⚠️ 关键不变量：**其他 11 个角色完全不受影响**
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

console.log('='.repeat(60));
console.log('  「十一」（粉色史迪仔）· 回归测试');
console.log('='.repeat(60));

/* ============================================================
 * A. 角色基本配置
 * ============================================================ */
console.log('\n--- A. 角色配置 ---');
{
  const cfgRaw = run('JSON.stringify(charById("pinkstitch"))');
  check(cfgRaw !== 'undefined' && cfgRaw !== 'null', 'charById("pinkstitch") 能找到配置');
  const cfg = JSON.parse(cfgRaw || 'null');
  if (cfg) {
    check(cfg.name === '十一', '★ 显示名 = 「十一」（' + cfg.name + '）');
    check(cfg.sprite === 'pinkstitch', 'sprite = pinkstitch');
    check(cfg.ready === true, 'ready=true');
    check(cfg.unlockLevel === 0, 'unlockLevel=0（不靠通关解锁，只能兑码）');
    check(cfg.unlockedByDefault === false, '不是初始角色');
    check(/^#[0-9a-fA-F]{6}$/.test(cfg.accentColor), '配色合法（' + cfg.accentColor + '，糖果粉）');

    /* ★ ② 五项全满配 */
    check(cfg.strengths && cfg.strengths.speed === 5 && cfg.strengths.jump === 5 &&
          cfg.strengths.dash === 5 && cfg.strengths.wall === 5,
      '★★ 五项全满星 ' + JSON.stringify(cfg.strengths));
    check(Array.isArray(cfg.weaknesses) && cfg.weaknesses.length === 0,
      '★★ 不给弱点（满配角色没有短板）');

    /* 实际数值也要是"全场最高" */
    const all = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="pinkstitch"}))'));
    const maxOf = k => Math.max.apply(null, all.map(c => c[k] || 1));
    check(cfg.speedMultiplier > maxOf('speedMultiplier'),
      '★ 速度顶配（' + cfg.speedMultiplier + ' > 其他最高 ' + maxOf('speedMultiplier') + '）');
    check(cfg.jumpMultiplier > maxOf('jumpMultiplier'),
      '★ 跳跃顶配（' + cfg.jumpMultiplier + ' > ' + maxOf('jumpMultiplier') + '）');
    check(cfg.dashMultiplier > maxOf('dashMultiplier'),
      '★ 冲刺顶配（' + cfg.dashMultiplier + ' > ' + maxOf('dashMultiplier') + '）');
    check(cfg.wallStaminaMultiplier > maxOf('wallStaminaMultiplier'),
      '★ 抓墙顶配（' + cfg.wallStaminaMultiplier + ' > ' + maxOf('wallStaminaMultiplier') + '）');
    check(cfg.wallJumpMultiplier > maxOf('wallJumpMultiplier'),
      '★ 墙跳顶配（' + cfg.wallJumpMultiplier + ' > ' + maxOf('wallJumpMultiplier') + '）');
  }
}

/* ============================================================
 * B. ③ 二段跳不翻滚 + 专属动作
 * ============================================================ */
console.log('\n--- B. 二段跳不翻滚 ---');
{
  const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["pinkstitch"])'));
  check(m.spinMul === 0, '★★ spinMul = 0（完全不翻滚）');
  check(m.hopStyle === 'candy', '★★ hopStyle = candy（专属"撒糖霜"动作）');

  const sm = JSON.parse(run('JSON.stringify(spinMotionFor("pinkstitch"))'));
  check(sm.spinMul === 0, 'spinMotionFor 返回 spinMul=0');

  /* 实际算一下：转过的角度必须是 0 */
  const spinAt = run(`(function(){
    var out = [];
    for (var i = 0; i <= 20; i++) {
      var prog = i / 20;
      var sm = spinMotionFor('pinkstitch');
      var e = prog < 0.5 ? 4*prog*prog*prog : 1 - Math.pow(-2*prog+2,3)/2;
      out.push(e * Math.PI * 2 * sm.spinMul);
    }
    return JSON.stringify(out);
  })()`);
  const spins = JSON.parse(spinAt);
  check(spins.every(v => Math.abs(v) < 1e-9),
    '★★ 整个过程旋转角度恒为 0（确实没翻滚）');

  /* 对比：其他角色还是会翻滚 */
  const others = ['kangaroo', 'dragon', 'pinkiepie', 'nick', 'stitch'];
  const stillSpin = others.every(function (r) {
    const s = JSON.parse(run('JSON.stringify(spinMotionFor("' + r + '"))'));
    return s.spinMul > 0;
  });
  check(stillSpin, '★ 其他角色仍然会翻滚（没被误改）');
}

/* ============================================================
 * C. ④ 走路腿动
 * ============================================================ */
console.log('\n--- C. 走路腿会动 ---');
{
  const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["pinkstitch"])'));
  check(m.legSwing > 0, '★★ legSwing = ' + m.legSwing + '（腿会摆动）');

  /* 走路时 legSwing 应该随时间正负交替 */
  const samples = JSON.parse(run(`(function(){
    var out = [];
    for (var i = 0; i < 24; i++) {
      var wm = walkMotion(i * 0.05, 3, true, 'pinkstitch');
      out.push(wm.legSwing);
    }
    return JSON.stringify(out);
  })()`));
  const hasPos = samples.some(v => v > 0.5);
  const hasNeg = samples.some(v => v < -0.5);
  check(hasPos && hasNeg, '★★ legSwing 正负交替（真的在"迈步"而不是单侧偏移）');

  /* ⚠️ 其他角色必须恒为 0
   * ⚠️ 2026-10-07：把「噜噜」也排除 —— 它是第二个开 legSwing 的角色
   *    （恐龙装水豚的"小短腿挪步"）。断言改成"**只有这两个**有腿动画"。 */
  const roleList = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="pinkstitch" && c.id!=="lulu"}).map(function(c){return c.role}))'));
  const zero = roleList.every(function (r) {
    const mx = JSON.parse(run(`(function(){
      var mx = 0;
      for (var i = 0; i < 20; i++) {
        var wm = walkMotion(i * 0.06, 3, true, ${JSON.stringify(r)});
        if (Math.abs(wm.legSwing || 0) > mx) mx = Math.abs(wm.legSwing || 0);
      }
      return mx;
    })()`));
    return mx === 0;
  });
  check(zero, '★★ 除十一/噜噜外的角色 legSwing 恒为 0（不受影响）');

  /* 站住不动时腿也不动 */
  const still = JSON.parse(run('JSON.stringify(walkMotion(5, 0, true, "pinkstitch"))'));
  check(still.legSwing === 0, '★ 站着不动时腿不摆（不会原地抖）');
}

/* ============================================================
 * D. ⑤ 静止握棒棒糖
 * ============================================================ */
console.log('\n--- D. 静止握棒棒糖 ---');
{
  const m = JSON.parse(run('JSON.stringify(ROLE_MOTION["pinkstitch"])'));
  check(m.lollipop === true, '★★ lollipop = true（静止时握棒棒糖）');

  const others = JSON.parse(run('JSON.stringify(CHARACTERS.filter(function(c){return c.ready && c.id!=="pinkstitch"}).map(function(c){return c.role}))'));
  const onlyHer = others.every(function (r) {
    const mm = JSON.parse(run('JSON.stringify(ROLE_MOTION["' + r + '"] || {})'));
    return mm.lollipop !== true;
  });
  check(onlyHer, '★ 只有她有棒棒糖（其他角色没有）');
}

/* ============================================================
 * E. ⑥ 小蛋糕拖尾
 * ============================================================ */
console.log('\n--- E. 移动拖尾 ---');
{
  const rSrc = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(rSrc.indexOf("p.type === 'dessert'") >= 0,
    "★★ render.js 有 'dessert' 粒子类型的绘制");
  check(/dessert[\s\S]{0,400}?纸杯|paper|cup/i.test(rSrc) || rSrc.indexOf('cupColor') >= 0,
    "★ 蛋糕拖尾画的是纸杯蛋糕（有 cupColor）");

  const gSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  check(gSrc.indexOf('function spawnDessertTrail') >= 0, '★★ game.js 有 spawnDessertTrail');
  check(/p\._dessertGap\s*=\s*14/.test(gSrc), '★ 有冷却计数器（每 14 帧一枚，避免刷爆）');
  check(/life:\s*144/.test(gSrc), '★ 寿命 144 帧 ≈ 2.4 秒（十一要的"两三秒消失"）');
  check(gSrc.indexOf("p.type !== 'dessert'") >= 0,
    '★★ dessert 粒子不受重力（留在地上，不飘走）');

  /* 只有她会留痕迹 */
  check(/p\.role === 'pinkstitch'[\s\S]{0,120}onGround[\s\S]{0,120}Math\.abs\(p\.vx\) > 0\.5/.test(gSrc),
    '★★ 只有她 + 在地面 + 真的在动 才留痕迹');
}

/* ============================================================
 * F. ⑦ 兑换码
 * ============================================================ */
console.log('\n--- F. 兑换码 `11` ---');
{
  const uSrc = fs.readFileSync(path.join(SRC, 'js', 'ui.js'), 'utf8');
  check(/'11':\s*\{/.test(uSrc), "★★ ui.js 配了兑换码 '11'");
  check(uSrc.indexOf("const id = 'pinkstitch'") >= 0,
    '★ 兑换码给的是 pinkstitch');
  check(uSrc.indexOf("key === '11'") >= 0 || uSrc.indexOf('"11"') >= 0 ||
        /'11'[\s\S]{0,200}allowRetry/.test(uSrc),
    '★ 有"角色没到手时可重兑"的例外规则');
}

/* ============================================================
 * G. 贴图与打包
 * ============================================================ */
console.log('\n--- G. 贴图与打包 ---');
{
  check(fs.existsSync(path.join(SRC, 'assets', 'pink-stitch.png')),
    'pink-stitch.png 存在于 src/assets/');
  const dims = (function () {
    const b = fs.readFileSync(path.join(SRC, 'assets', 'pink-stitch.png'));
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  })();
  /* ⚠️ 必须是"矮胖"体型（宽高比 ≥ 0.9）—— 第一版做成了 0.63 的瘦长条，
   *    十一说"太丑了"。这条断言就是为了防止回归。 */
  const ratio = dims.w / dims.h;
  check(ratio >= 0.9,
    '★★ 体型是"矮胖可爱"型（' + dims.w + '×' + dims.h + '，宽高比 ' + ratio.toFixed(2) + ' ≥ 0.9）');

  const spSrc = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
  check(spSrc.indexOf("src: 'assets/pink-stitch.png'") >= 0,
    'sprites.js 注册了 pink-stitch.png');
  const bSrc = fs.readFileSync(path.join(PROJ, 'tools', 'build-single.js'), 'utf8');
  check(bSrc.indexOf("'pink-stitch.png'") >= 0,
    'build-single.js 内嵌清单含 pink-stitch.png');
}

/* ============================================================
 * H. 向后兼容总检
 * ============================================================ */
console.log('\n--- H. 向后兼容 ---');
{
  /* 不传 role ⇒ 和改造前完全一致 */
  const a = JSON.parse(run('JSON.stringify(walkMotion(1.0, 3.0, true))'));
  check(a.legSwing === 0, '★ 不传 role 时 legSwing = 0（老调用点行为不变）');

  /* ⚠️ 2026-10-07：再加了「噜噜」⇒ 总数 13。
   *    这条断言的作用是"防止角色被误删/漏注册"，
   *    所以每次加角色都要同步改这里。 */
  const total = run('CHARACTERS.filter(function(c){return c.ready}).length');
  check(total === 13, '★ 角色总数 = 13（12 个原有 + 噜噜）');
}

console.log('\n' + '='.repeat(60));
console.log('  「十一」回归: ' + pass + ' 通过 / ' + fail + ' 失败');
if (problems.length) problems.forEach(p => console.log('    · ' + p));
console.log('='.repeat(60));
if (fail > 0) process.exit(1);
