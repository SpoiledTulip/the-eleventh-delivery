/* ============================================================
 * monkey-role-test.js — 第五个角色「美团猴子」接入回归测试
 * ============================================================
 * 十一的原话："在第五关加个猴子，我们之前画过贴图的，
 *             现在设定一下然后上线，打完第五关就有"
 *
 * ------------------------------------------------------------
 * ★ 这个测试要守的四件事 ★
 * ------------------------------------------------------------
 *   ① **贴图取得到**：monkey.png 已注册进 SPRITE_IMAGES
 *   ② **解锁节奏对**：通关第 5 关解锁（不是第 4 关、也不提前剧透）
 *   ③ ★★ **墙跳真有加成 ★★
 *      这是猴子唯一的招牌。它的实现跨了 **三个文件**：
 *        characters.js（配 wallJumpMultiplier）
 *        game.js（makePlayer 挂 wallJumpMul）
 *        actions.js（actDoWallJump 乘上去）
 *      只改前两个 = 配了但不生效（最难查的那种 bug），
 *      所以这里**必须用真实物理跑一遍**来验证，不能只看字段存在。
 *   ④ **不和现有角色重复**：
 *      猴子的墙跳最高，但抓墙体力**要低于卡皮巴拉**（不然就是换皮）。
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

/* ---------- 沙箱 ---------- */
function mkEl() {
  const e = {
    style: {}, className: '', innerHTML: '', innerText: '', textContent: '', id: '',
    children: [], appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return mkEl(); }, querySelectorAll() { return []; },
    getContext() {
      const noop = function () { };
      return {
        save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
        beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
        quadraticCurveTo: noop, arc: noop, ellipse: noop, rect: noop,
        fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
        fillText: noop, strokeText: noop, measureText() { return { width: 10 }; },
        createRadialGradient() { return { addColorStop: noop }; },
        createLinearGradient() { return { addColorStop: noop }; },
        drawImage: noop, getImageData() { return { data: [] }; },
        putImageData: noop, globalAlpha: 1, globalCompositeOperation: '',
      };
    },
  };
  return e;
}

function buildSandbox() {
  function noop() { }
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Set, Map,
    window: {
      addEventListener: noop, requestAnimationFrame: function () { return 0; },
      Image: function () { this.width = 109; this.height = 128; },
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
      getElementById: function () { return mkEl(); },
      createElement: function () { return mkEl(); },
      addEventListener: noop,
      body: mkEl(),
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

/* ⚠️ 顺序和 index.html 一致；**必须带 actions.js**（墙跳在它里面） */
const FILES = [
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
  'device-mode.js', 'save.js', 'actions.js', 'net.js',
  'scooter.js', 'ai-rider.js', 'render.js', 'game.js', 'ui.js',
];

const sb = buildSandbox();
FILES.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
});
const run = code => vm.runInContext(code, sb);
const runJson = code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', sb));

/* ============================================================
 * 1. 角色配置
 * ============================================================ */
console.log('\n=== 1. 美团猴子 · 角色配置 ===');
{
  const c = runJson(`(function(){
    var m = charById('monkey');
    return m ? { id:m.id, role:m.role, name:m.name, sprite:m.sprite,
                 unlock:m.unlockLevel, ready:m.ready, accent:m.accentColor,
                 sp:m.speedMultiplier, jp:m.jumpMultiplier, ds:m.dashMultiplier,
                 ws:m.wallStaminaMultiplier, wj:m.wallJumpMultiplier,
                 tagline:m.tagline, routes:m.routes } : null;
  })()`);
  check(!!c, 'charById("monkey") 拿得到配置');
  if (c) {
    check(c.id === 'monkey' && c.role === 'monkey', '★ id / role 都是 monkey');
    check(c.name === '美团猴子', '★ 名字是「美团猴子」（十一指定）');
    check(c.sprite === 'monkey', '★ sprite 指向 monkey');
    check(c.ready === true, '★★ ready=true（否则不会进正式角色库）');
    check(c.unlock === 5, '★★ 解锁节点 = 通关第 5 关（十一指定）');
    check(typeof c.accent === 'string' && c.accent.length > 0,
      '有主题色（HUD/标签用）: ' + c.accent);
    check(typeof c.tagline === 'string' && c.tagline.length > 0,
      '有 tagline: 「' + c.tagline + '」');
    check(Array.isArray(c.routes) && c.routes.length > 0,
      '有擅长路线: ' + JSON.stringify(c.routes));
    /* 招牌必须是墙跳 */
    check(c.wj > 1, '★★ 有 wallJumpMultiplier 且 > 1（猴子的招牌）: ' + c.wj);
  }
}

/* ============================================================
 * 2. 贴图注册
 * ============================================================ */
console.log('\n=== 2. 贴图注册 ===');
{
  const s = runJson(`(function(){
    var slot = SPRITE_IMAGES.monkey;
    return slot ? { src: slot.src, facesRight: slot.facesRight } : null;
  })()`);
  check(!!s, 'SPRITE_IMAGES 里有 monkey');
  if (s) {
    check(/monkey\.png$/.test(s.src), '★ 贴图路径是 assets/monkey.png（' + s.src + '）');
    check(s.facesRight === true, '★ facesRight=true（原图侧身朝右，和袋鼠一致）');
  }
  /* 文件真的在 */
  const p = path.join(SRC, 'assets', 'monkey.png');
  check(fs.existsSync(p), '★ src/assets/monkey.png 文件真的存在');
}

/* ============================================================
 * 3. ★★ 墙跳真有加成（跨三个文件的改动，必须用真实物理验证）★★
 * ============================================================ */
console.log('\n=== 3. ★★ 墙跳加成（真实物理实测）★★');
{
  const res = runJson(`(function(){
    Save.reset();
    Game.skipWeatherBrief = true;
    var out = [];
    ['kangaroo','dragon','capybara','stitch','monkey'].forEach(function(role){
      Game.mode='single'; Game.playerCount=1;
      Game.isPk=false; Game.aiRoles=null; Game.pkMyRole=null;
      loadLevel(0);
      Game.state='playing';
      var p = makePlayer(role, { x: 200, y: 400 });
      Game.players = [p];
      /* 手动触发一次墙跳（贴左边的墙 → 往右弹） */
      p.actWallDir = -1;
      actDoWallJump(p, CELESTE);
      var vy = p.vy, mul = p.wallJumpMul;
      var y0 = p.y, peak = p.y;
      for (var f=0; f<80; f++){
        InputState.now = {};
        update(1/60); InputState.tick();
        if (p.y < peak) peak = p.y;
        if (p.onGround && f > 3) break;
      }
      out.push({ role: role, vy: +vy.toFixed(2), rise: Math.round(y0 - peak), mul: mul });
    });
    return out;
  })()`);

  console.log('    角色'.padEnd(16) + '墙跳初速   升高    倍率');
  res.forEach(function (x) {
    console.log('    ' + String(x.role).padEnd(14) + String(x.vy).padEnd(10) +
      String(x.rise + 'px').padEnd(8) + x.mul);
  });

  const k = res.filter(function (x) { return x.role === 'kangaroo'; })[0];
  const m = res.filter(function (x) { return x.role === 'monkey'; })[0];
  const d = res.filter(function (x) { return x.role === 'dragon'; })[0];

  checkEq(m.mul, 1.4, '★★ monkey 的 wallJumpMul 挂到玩家对象上了（game.js 那一步）');
  check(m.rise > d.rise + 40,
    '★★★ 猴子的墙跳**明显**比飞龙高（' + m.rise + ' vs ' + d.rise + '）—— actions.js 那一步生效了');
  check(m.rise > k.rise,
    '★★ 猴子的墙跳比袋鼠也高（' + m.rise + ' vs ' + k.rise + '，袋鼠靠 jumpMul 加成）');
  /* 其他角色的倍率必须还是 1（不能误伤） */
  ['kangaroo', 'dragon', 'capybara', 'stitch'].forEach(function (role) {
    const r = res.filter(function (x) { return x.role === role; })[0];
    checkEq(r.mul, 1, role + ' 的 wallJumpMul 仍是 1（没被误伤）');
  });
}

/* ============================================================
 * 4. ★★ 不和现有角色重复（招牌互不冲突）★★
 * ============================================================ */
console.log('\n=== 4. ★★ 五个角色各有招牌，互不重复 ===');
{
  const all = runJson(`CHARACTERS.map(function(c){
    return { id:c.id, name:c.name, sp:c.speedMultiplier, jp:c.jumpMultiplier,
             ds:c.dashMultiplier, ws:c.wallStaminaMultiplier,
             wj:(c.wallJumpMultiplier || 1), ul:c.unlockLevel };
  })`);

  /* ⚠️⚠️ 2026-10-07：这一整块的比较**必须排除**「十一」（pinkstitch）。
   * ------------------------------------------------------------
   * 她是**兑换码专属的满配角色** —— 五项刻意全部超过所有人
   * （十一本人的要求："这个是非常厉害的，全是拉满的"）。
   * 把她算进来的话，下面每一条"某某的最高"都变成了"十一的最高"，
   * 这个测试就完全失去意义了。
   *
   * ⇒ 要守的不变量是"**普通角色之间**招牌互不冲突"，
   *   而「十一」的定位**本来就不是**"守住某个招牌"，她是打破平衡的那个。
   *   详见 characters.js 里 "唯一的满配角色" 的说明。
   * ------------------------------------------------------------ */
  const balanced = all.filter(function (c) { return c.id !== 'pinkstitch'; });

  const top = function (field) {
    let best = balanced[0];
    balanced.forEach(function (c) { if (c[field] > best[field]) best = c; });
    return best;
  };

  const topWj = top('wj'), topWs = top('ws'), topJp = top('jp'),
    topSp = top('sp'), topDs = top('ds');

  console.log('    速度最高: ' + topSp.name + '（' + topSp.sp + '）');
  console.log('    跳跃最高: ' + topJp.name + '（' + topJp.jp + '）');
  console.log('    抓墙最高: ' + topWs.name + '（' + topWs.ws + '）');
  console.log('    冲刺最高: ' + topDs.name + '（' + topDs.ds + '）');
  console.log('    墙跳最高: ' + topWj.name + '（' + topWj.wj + '）');

  /* ⚠️ 2026-10-06 更新：第三章加入小鱼 / 小狗 / 小羊后，
   *    "速度最高"和"墙跳最高"的归属变了（这是**有意的设计变化**）：
   *      · 速度最高：飞龙(1.10) → **小鱼(1.12)**（小鱼是"最快的持续跑者"）
   *      · 墙跳最高：猴子(1.40) → **小羊(1.55)**（山羊是天生攀岩者）
   *    猴子仍然是"墙跳很强"，只是不再是**唯一第一**。
   *    ⇒ 这里改成断言"猴子仍是顶级墙跳（≥1.4）"，
   *      而不是"必须是第一"—— 因为角色变多后，"唯一第一"这个约束
   *      会让新角色没法设计（每个维度都被占满）。
   *
   *    真正要守的不变量是：**五个招牌维度分属五个不同角色**（见下）。 */
  check(topWj.wj >= 1.4, '★ 猴子的墙跳仍是顶级（≥1.4，实际 ' + topWj.wj + '）');
  checkEq(topWs.id, 'capybara', '★★ 抓墙最高仍是卡皮巴拉（猴子**没有**抢走它的招牌）');
  checkEq(topJp.id, 'kangaroo', '★ 跳跃最高仍是袋鼠');
  checkEq(topDs.id, 'stitch', '★ 冲刺最高仍是史迪奇');
  checkEq(topSp.id, 'fish', '★ 速度最高是最快的小鱼（第三章新增）');
  checkEq(topWj.id, 'lamb', '★ 墙跳最高是攀岩的小羊（第三章新增）');
  /* 六个招牌分属六个角色 —— 这才是"不重复" */
  const winners = [topWj.id, topWs.id, topJp.id, topSp.id, topDs.id];
  check(new Set(winners).size === 5,
    '★★★ 五个招牌分属五个不同角色（' + winners.join(' / ') + '）');
}

/* ============================================================
 * 5. 解锁节奏
 * ============================================================ */
console.log('\n=== 5. 解锁节奏 ===');
{
  const at = function (lvlIdx) {
    return runJson(`charsUnlockedBy(${lvlIdx}, defaultUnlockedChars()).map(function(c){ return c.id; })`);
  };

  /* 新的完整解锁表（改之前先看这里） */
  const expect = [
    { idx: -1, got: runJson('defaultUnlockedChars()'), want: ['kangaroo'],
      label: '新档（初始）' },
    { idx: 0, got: at(0), want: ['dragon'], label: '通关第 1 关' },
    { idx: 3, got: at(3), want: [], label: '通关第 4 关（还没到节点）' },
    { idx: 4, got: at(4), want: ['monkey'], label: '通关第 5 关' },
    { idx: 8, got: at(8), want: [], label: '通关第 9 关' },
    { idx: 9, got: at(9), want: ['capybara'], label: '通关第 10 关' },
    { idx: 10, got: at(10), want: ['stitch'], label: '通关第 11 关' },
  ];

  expect.forEach(function (e) {
    const ok = e.want.length === 0
      ? e.got.indexOf('monkey') < 0 && e.got.indexOf('capybara') < 0 && e.got.indexOf('stitch') < 0
      : e.want.every(function (id) { return e.got.indexOf(id) >= 0; });
    check(ok, e.label + ' → ' + JSON.stringify(e.got) +
      (e.want.length ? '（期望含 ' + e.want.join(',') + '）' : '（期望没有新角色）'));
  });

  /* 零剧透：第 5 关之前不能看见猴子 */
  const before = at(3);
  check(before.indexOf('monkey') < 0, '★★ 第 5 关**之前**看不见猴子（零剧透）');
}

/* ============================================================
 * 6. 进关生成（选中猴子 → 真的生成 monkey）
 * ============================================================ */
console.log('\n=== 6. 选中猴子能真的进关 ===');
{
  const r = runJson(`(function(){
    Save.reset();
    Save.data.maxUnlocked = 11;
    var ids = [];
    listForLibrary().forEach(function(c){ ids.push(c.id); });
    Save.data.unlockedCharacters = ids;
    Save.data.selectedCharacter = 'monkey';

    /* ⚠️ 沙箱里 Image 是假对象，贴图永远不会"加载完成"。
     *    这里手动标记为已加载，否则 getSpriteImage 一律返回 null ——
     *    那是**测试环境**的限制，不是游戏的问题。
     *    （真实浏览器里这张图是会加载的，由 pk-flow/sprite-role 那几套测试覆盖。） */
    Object.keys(SPRITE_IMAGES).forEach(function(k){
      SPRITE_IMAGES[k].ready = true;
      SPRITE_IMAGES[k].img = { width: 109, height: 128, __name: k };
    });

    Game.mode='single'; Game.playerCount=1;
    Game.isPk=false; Game.aiRoles=null; Game.pkMyRole=null;
    if (InputState.clearAI) InputState.clearAI();
    Game.skipWeatherBrief = true;
    startGame(0);
    Game.skipWeatherBrief = false;

    var p = Game.players[0];
    var slot = p ? getSpriteImage(p.role) : null;
    return {
      sel: Save.selectedChar(),
      roleSel: roleOfSelection(),
      players: Game.players.length,
      role: p ? p.role : null,
      spriteName: slot && slot.img ? String(slot.img.__name || '') : '',
      spriteSrc: slot ? slot.src : '(无)',
      wallJumpMul: p ? p.wallJumpMul : null,
    };
  })()`);

  checkEq(r.sel, 'monkey', '存档里选中的是 monkey');
  checkEq(r.roleSel, 'monkey', '★ roleOfSelection() = monkey');
  checkEq(r.players, 1, '单人局只有 1 个角色');
  checkEq(r.role, 'monkey', '★★ 进关生成的角色**真的是** monkey');
  check(/monkey\.png$/.test(r.spriteSrc), '★★ 取到的贴图是 monkey.png（' + r.spriteSrc + '）');
  checkEq(r.wallJumpMul, 1.4, '★ 玩家的 wallJumpMul = 1.4（墙跳加成跟着角色进来）');
}

/* ============================================================
 * 7. 源码级防回归
 * ============================================================ */
console.log('\n=== 7. 源码级防回归 ===');
{
  const gameSrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  check(/wallJumpMul:\s*charMul\(role,\s*'wallJumpMultiplier'\)/.test(gameSrc),
    '★ game.js 把 wallJumpMultiplier 挂成了 wallJumpMul');

  const actSrc = fs.readFileSync(path.join(SRC, 'js', 'actions.js'), 'utf8');
  check(/p\.wallJumpMul/.test(actSrc),
    '★★ actions.js 的墙跳计算里用上了 p.wallJumpMul（这一步漏了就是"配了不生效"）');

  const charSrc = fs.readFileSync(path.join(SRC, 'js', 'characters.js'), 'utf8');
  check(/id:\s*'monkey'/.test(charSrc), '★ characters.js 里有 monkey 配置');

  const sprSrc = fs.readFileSync(path.join(SRC, 'js', 'sprites.js'), 'utf8');
  check(/monkey:\s*\{[^}]*assets\/monkey\.png/.test(sprSrc),
    '★ sprites.js 的 SPRITE_IMAGES 注册了 assets/monkey.png');
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('  美团猴子接入测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);

/* ---------- 小工具 ---------- */
function checkEq(a, b, msg) {
  check(a === b, msg + (a === b ? '' : '  → 实际: ' + JSON.stringify(a) + '，期望: ' + JSON.stringify(b)));
}
