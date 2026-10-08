/* ============================================================
 * receiver-talk-test.js — 🧍 收餐人朝向 + 台词测试
 * ============================================================
 * 十一的两条要求：
 *   ① "我希望接外卖的人是对着骑手的，因为我发现生成的都是背对着骑手。"
 *   ② "收到外卖之后停个 10 秒钟，可以对骑手说一些话，
 *       什么谢谢啊，什么怎么这么慢，什么什么的。"
 *
 * ------------------------------------------------------------
 * ★ 本测试要守住的核心 ★
 * ------------------------------------------------------------
 *   ① ★★★ **说话绝不阻挡通关** ★★★
 *      这是最容易出人命的一条：10 秒一旦变成"必须等"，
 *      就从彩蛋变成惩罚。`blocksGoal()` 必须恒为 false。
 *   ② **朝向按骑手位置翻转**（骑手在左 → 朝左），
 *      而且要能挡住"像素级抖动导致左右横跳"（死区）。
 *   ③ 台词总时长**正好 10 秒**，而且是**分段**的（不是一句话挂 10 秒）。
 *   ④ 台词和"这次的表现"对得上（准时/超时/漏单 → 不同组）。
 *   ⑤ 每关**只触发一次**（门口来回走不该反复触发）。
 *   ⑥ 健壮性：模块缺席不崩。
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
function checkEq(a, b, msg) {
  check(a === b, msg + (a === b ? '' : '  → 实际: ' + JSON.stringify(a) + '，期望: ' + JSON.stringify(b)));
}

/* ---------- 沙箱 ---------- */
function buildSandbox() {
  function noop() {}
  const ctxProbe = new Proxy({}, {
    get: function (t, k) {
      if (k === 'createLinearGradient') return function () { return { addColorStop: noop }; };
      if (k === 'measureText') return function () { return { width: 60 }; };
      return noop;
    }, set: function () { return true; },
  });
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
    window: {
      addEventListener: noop, requestAnimationFrame: function () { return 0; },
      Image: function () { setTimeout(function () { if (this.onerror) this.onerror(); }, 0); },
      AudioContext: function () {
        return {
          state: 'running', currentTime: 0, sampleRate: 44100,
          createBuffer: function (ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; },
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
    },
    performance: { now: function () { return Date.now(); } },
    requestAnimationFrame: function () { return 0; },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: function () { return 0; }, clearInterval: noop,
    localStorage: {
      getItem: function () { return null; }, setItem: noop, removeItem: noop, clear: noop,
    },
  };
  sb.Image = sb.window.Image;
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

/* ⚠️ 顺序必须和 index.html 一致（receiver-talk.js 在 game.js / render.js 之前） */
const FILES = [
  'levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js',
  'device-mode.js', 'save.js', 'net.js',
  'receiver-talk.js',          // ← 本测试的主角
  'render.js', 'game.js',
];

function fresh(extraFiles) {
  const sb = buildSandbox();
  (extraFiles || FILES).forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sb, { filename: f });
  });
  return sb;
}
const mkRun = sb => code => vm.runInContext(code, sb);

const sb = fresh();
const run = mkRun(sb);

/* ============================================================
 * 1. 模块存在 + 参数
 * ============================================================ */
console.log('\n=== 1. 模块与参数 ===');
check(run('typeof RECEIVER_TALK === "object" && RECEIVER_TALK !== null'), 'RECEIVER_TALK 模块已加载');
const cfg = JSON.parse(run('JSON.stringify(RECEIVER_TALK.CFG)'));
checkEq(cfg.TALK_SECONDS, 10, '★ 说话时长 = 10 秒（十一明确要的）');
check(cfg.FADE > 0 && cfg.FADE < 1, '换句有淡入淡出（' + cfg.FADE + ' 秒）');
check(run('typeof receiverTalkReset === "function"'), 'receiverTalkReset 已定义');
check(run('typeof receiverTalkStart === "function"'), 'receiverTalkStart 已定义');
check(run('typeof receiverTalkSession === "function"'), 'receiverTalkSession 已定义');
check(run('typeof receiverTalkTick === "function"'), 'receiverTalkTick 已定义');
check(run('typeof receiverTalkSkip === "function"'), 'receiverTalkSkip 已定义');
check(run('typeof drawReceiverSpeech === "function"'), 'drawReceiverSpeech 已定义（气泡绘制）');

/* ============================================================
 * 2. ★★★ 红线：说话绝不阻挡通关 ★★★
 * ============================================================
 * 10 秒一旦变成"必须等"，就从彩蛋变成惩罚。
 * 两重检查：函数返回值 + 源码里没有"卡住终点"的分支。
 */
console.log('\n=== 2. ★★★ 红线：说话不阻挡通关 ★★★');
{
  checkEq(run('RECEIVER_TALK.blocksGoal()'), false,
    '★★★ blocksGoal() 恒为 false（说 10 秒话不挡终点）');
  const src = fs.readFileSync(path.join(SRC, 'js', 'receiver-talk.js'), 'utf8');
  /* 不许在 receipt 模块里碰通关/状态机 */
  check(!/Game\.state\s*=/.test(src), '★ receiver-talk.js 里没有改 Game.state（不插手状态机）');
  check(!/coinsRequired\s*=/.test(src), '★ 没有改订单门槛（不影响"能不能过关"）');
  /* game.js 里的调用只能是"推进计时"，不许 return / 挡住后续逻辑 */
  const gsrc = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  const idx = gsrc.indexOf('receiverTalkTick');
  check(idx > 0, 'game.js 里有推进调用');
  if (idx > 0) {
    const around = gsrc.slice(Math.max(0, idx - 500), idx + 200);
    check(!/return\s*;/.test(around), '★ 推进调用附近没有 return（不会提前掐断这一帧）');
  }
}

/* ============================================================
 * 3. ★ 朝向：按骑手位置翻转
 * ============================================================ */
console.log('\n=== 3. ★ 朝向骑手 ===');
{
  /* 收餐人在 x=1000 */
  const cx = 1000;
  checkEq(run('RECEIVER_TALK.facingSign(400, ' + cx + ')'), -1,
    '★ 骑手在**左边** → 朝左（-1，需要镜像翻转）');
  checkEq(run('RECEIVER_TALK.facingSign(1600, ' + cx + ')'), 1,
    '★ 骑手在**右边** → 朝右（+1，用贴图原方向）');
  checkEq(run('RECEIVER_TALK.facingSign(' + (cx - 5) + ', ' + cx + ')'), 1,
    '★ 骑手和自己几乎重合（死区内）→ 保持默认，不会左右横跳');
  checkEq(run('RECEIVER_TALK.facingSign(' + (cx + 5) + ', ' + cx + ')'), 1,
    '★ 死区对两侧都生效');
  checkEq(run('RECEIVER_TALK.facingSign(' + (cx - 40) + ', ' + cx + ')'), -1,
    '★ 出了死区就真的翻（-40px → 朝左）');
  checkEq(run('RECEIVER_TALK.facingSign(null, ' + cx + ')'), 1,
    '★ 拿不到骑手位置 → 用默认朝向（不崩）');
  checkEq(run('RECEIVER_TALK.facingSign(undefined, ' + cx + ')'), 1,
    '★ undefined 也不崩');

  /* riderToFace：双人取"最近的活人" */
  const r2 = run('RECEIVER_TALK.riderToFace([{x:100,y:0,w:26},{x:3000,y:0,w:26}], 1000)');
  checkEq(r2, 113, '★ 双人模式取**最近**的骑手（100+26/2 = 113，不是远处那个）');
  checkEq(run('RECEIVER_TALK.riderToFace([{x:100,y:0,w:26,dead:true},{x:3000,y:0,w:26}], 1000)'),
    3013, '★ 跳过已死亡的玩家');
  checkEq(run('RECEIVER_TALK.riderToFace([], 1000)'), null, '★ 没有玩家 → null（不崩）');
  checkEq(run('RECEIVER_TALK.riderToFace(null, 1000)'), null, '★ null → null');
}

/* ============================================================
 * 4. ★ 台词：10 秒 + 分段（不是一句话挂 10 秒）
 * ============================================================ */
console.log('\n=== 4. ★ 台词是分段播的（10 秒） ===');
{
  const sess = run('RECEIVER_TALK.buildSession({late:false, missing:false})');
  checkEq(sess.total, 10, '★ 会话总时长 = 10 秒');
  check(sess.lines.length >= 2,
    '★ 是**分段**的（' + sess.lines.length + ' 句），不是一句话挂 10 秒');
  check(sess.per >= 1.4,
    '★ 每句至少停 ' + sess.per.toFixed(2) + ' 秒（够读完，不会一闪而过）');

  /* 走完整段时间轴，验证"每句都会被说到" */
  const timeline = run(`(function(){
    var s = RECEIVER_TALK.buildSession({late:false,missing:false});
    var seen = {}, n = 0;
    var dt = 1/60;
    while (!s.done && n < 10000) {
      seen[RECEIVER_TALK.lineIndexAt(s)] = true;
      RECEIVER_TALK.tick(s, dt);
      n++;
    }
    var idxs = Object.keys(seen).map(Number).sort(function(a,b){return a-b;});
    return { seen: idxs, count: idxs.length, seconds: n/60, done: s.done,
             total: s.lines.length };
  })()`);
  checkEq(timeline.count, timeline.total,
    '★ 每一句都会被说到（' + timeline.count + '/' + timeline.total + '）');
  checkEq(timeline.seen.join(','), timeline.total === 1 ? '0'
    : Array.from({ length: timeline.total }, (_, i) => i).join(','),
    '★ 顺序播放（' + timeline.seen.join('→') + '）');
  check(Math.abs(timeline.seconds - 10) < 0.1,
    '★ 播完正好 ' + timeline.seconds.toFixed(2) + ' 秒');
  check(timeline.done, '★ 播完自动结束（不会永远挂着）');
}

/* ============================================================
 * 5. ★ 台词和"这次表现"对得上
 * ============================================================ */
console.log('\n=== 5. ★ 台词随表现变化 ===');
{
  checkEq(run('RECEIVER_TALK.pickGroup({late:false,missing:false})'), 'good',
    '准时 + 订单齐 → 满意组（"谢谢啊"）');
  checkEq(run('RECEIVER_TALK.pickGroup({late:true,missing:false})'), 'late',
    '超时 → 抱怨组（"怎么这么慢"）');
  checkEq(run('RECEIVER_TALK.pickGroup({late:false,missing:true})'), 'missing',
    '漏单 → 嫌弃组（"我的可乐呢"）');
  checkEq(run('RECEIVER_TALK.pickGroup({late:true,missing:true})'), 'bad',
    '又超又漏 → 崩了组');
  checkEq(run('RECEIVER_TALK.pickGroup(null)'), 'good', 'null 兜底 → good（不崩）');

  /* 十一点名要的两句必须在 */
  check(run('RECEIVER_TALK.linesOf("good").join(" ").indexOf("谢谢") >= 0'),
    '★ 满意组里有"谢谢"（十一点名的）');
  check(run('RECEIVER_TALK.linesOf("late").join(" ").indexOf("这么慢") >= 0'),
    '★ 抱怨组里有"怎么这么慢"（十一点名的）');
  /* 四组必须互不相同 */
  const groups = run('JSON.stringify(RECEIVER_TALK.allGroups())');
  const gs = JSON.parse(groups);
  checkEq(gs.length, 4, '共 4 组台词（' + gs.join('/') + '）');
  const allLines = run('JSON.stringify(RECEIVER_TALK.allGroups().map(function(g){return RECEIVER_TALK.linesOf(g).join("|")}))');
  const arr = JSON.parse(allLines);
  check(arr[0] !== arr[1] && arr[1] !== arr[2] && arr[0] !== arr[2],
    '★ 各组台词互不相同（不同表现看到不同话）');

  /* 台词不能太长（一行放不下会折行难看） */
  const tooLong = run(`(function(){
    var bad = [];
    RECEIVER_TALK.allGroups().forEach(function(g){
      RECEIVER_TALK.linesOf(g).forEach(function(l){ if (l.length > 14) bad.push(l); });
    });
    return bad;
  })()`);
  check(tooLong.length === 0,
    '★ 每句都够短（≤14 字，横排放得下）' + (tooLong.length ? '，过长: ' + tooLong.join(',') : ''));
}

/* ============================================================
 * 6. ★ 淡入淡出 + 最后一句不淡出
 * ============================================================ */
console.log('\n=== 6. 气泡的透明度曲线 ===');
{
  const r = run(`(function(){
    var s = RECEIVER_TALK.buildSession({late:false,missing:false});
    var a0 = RECEIVER_TALK.lineAlpha(s);            // 刚出现（应该淡入中，接近 0）
    RECEIVER_TALK.tick(s, 0.3);                     // 过了淡入
    var a1 = RECEIVER_TALK.lineAlpha(s);            // 应该全不透明
    /* 跳到第一句快结束时（但还没到最后一句） */
    var s2 = RECEIVER_TALK.buildSession({late:false,missing:false});
    RECEIVER_TALK.tick(s2, s2.per - 0.05);
    var a2 = RECEIVER_TALK.lineAlpha(s2);           // 应该正在淡出
    /* 最后一句的结尾**不该淡出** */
    var s3 = RECEIVER_TALK.buildSession({late:false,missing:false});
    RECEIVER_TALK.tick(s3, s3.total - 0.02);
    var a3 = RECEIVER_TALK.lineAlpha(s3);
    return { a0: a0, a1: a1, a2: a2, a3: a3, per: s.per, n: s.lines.length };
  })()`);
  check(r.a0 < 0.5, '★ 出现时淡入（alpha=' + r.a0.toFixed(2) + '）');
  check(Math.abs(r.a1 - 1) < 1e-6, '★ 稳定后完全不透明（alpha=1）');
  if (r.n > 1) {
    check(r.a2 < 1, '★ 换句前会淡出（alpha=' + r.a2.toFixed(2) + '）');
  } else {
    check(true, '（只有一句，跳过淡出检查）');
  }
  check(r.a3 > 0.9, '★ 最后一句**不淡出**（说完才是结束，alpha=' + r.a3.toFixed(2) + '）');
}

/* ============================================================
 * 7. ★ 跳过（10 秒太长，必须有出口）
 * ============================================================ */
console.log('\n=== 7. ★ 可以跳过 ===');
{
  const r = run(`(function(){
    receiverTalkReset();
    var started = receiverTalkStart({late:false, missing:false});
    var s1 = receiverTalkSession();
    var before = s1.done;
    receiverTalkSkip();
    var after = receiverTalkSession().done;
    var skipped = receiverTalkSession().skipped;
    /* 跳过后再 tick 不该"复活" */
    receiverTalkTick(1/60);
    var stillDone = receiverTalkSession().done;
    return { started: started, before: before, after: after, skipped: skipped, stillDone: stillDone };
  })()`);
  check(r.started, '★ 第一次触发 → 真的开始了');
  check(r.before === false, '触发后还没结束');
  check(r.after === true, '★ 按一下键 → 立刻结束（不用干等 10 秒）');
  check(r.skipped, '★ 记下了"是被跳过的"（不是自然播完）');
  check(r.stillDone, '跳过后不会复活');
}

/* ============================================================
 * 8. ★ 每关只触发一次
 * ============================================================
 * 玩家在门口来回走，不该反复触发台词。
 */
console.log('\n=== 8. ★ 每关只触发一次 ===');
{
  const r = run(`(function(){
    receiverTalkReset();
    var a = receiverTalkStart({late:false, missing:false});
    /* 让它播完 */
    for (var i=0;i<700;i++) receiverTalkTick(1/60);
    var done1 = receiverTalkSession().done;
    /* 玩家又走到门口 → 不该重新开始 */
    var b = receiverTalkStart({late:false, missing:false});
    var s = receiverTalkSession();
    /* 重进关 → 才能再次触发 */
    receiverTalkReset();
    var c = receiverTalkStart({late:true, missing:false});
    var g = receiverTalkSession().group;
    return { a: a, done1: done1, b: b, c: c, groupAfterReset: g };
  })()`);
  check(r.a, '第一次触发成功');
  check(r.done1, '播完后 done');
  check(r.b === false, '★★ 同一关再触发 → 被挡住（门口来回走不会反复说）');
  check(r.c, '★ 重进关后可以再次触发');
  checkEq(r.groupAfterReset, 'late', '★ 重进关按新的表现重新选台词组');
}

/* ============================================================
 * 9. ★ 进关重置（game.js 的接入点）
 * ============================================================ */
console.log('\n=== 9. 进关重置接入 ===');
{
  const g = fs.readFileSync(path.join(SRC, 'js', 'game.js'), 'utf8');
  check(/receiverTalkReset\(\)/.test(g), '★ game.js 进关时调了 receiverTalkReset()（不留上一关状态）');
  check(/receiverTalkTick\(/.test(g), '★ game.js 每帧调了 receiverTalkTick()（计时才会走）');
  const r = fs.readFileSync(path.join(SRC, 'js', 'render.js'), 'utf8');
  check(/receiverTalkStart\(/.test(r), '★ render.js 在"骑手到门口"时触发了说话');
  check(/RECEIVER_TALK\.facingSign/.test(r), '★ render.js 用 facingSign 决定朝向');
  check(/drawReceiverSpeech\(/.test(r), '★ render.js 画了台词气泡（贴图 + 代码两条路径都要有）');
  const speechCalls = (r.match(/drawReceiverSpeech\(ctx/g) || []).length;
  check(speechCalls >= 2,
    '★ 贴图路径和代码兜底路径**都**画气泡（实际 ' + speechCalls + ' 处）');
  /* 朝向必须在画图之前真正生效 */
  check(/ctx\.scale\(-1, 1\)/.test(r), '★ 用 scale(-1,1) 做镜像（不是假装翻转）');
}

/* ============================================================
 * 10. ★ 真物理：走到门口 → 触发说话，且不阻挡通关
 * ============================================================
 * 用真实 update 循环跑一遍。
 * ⚠️ "render 触发"这一步在离线沙箱里没有渲染，所以手动调一次
 *    receiverTalkStart 模拟 render 做过的事，验证**后续链路**：
 *    计时会走、不挡通关。
 */
console.log('\n=== 10. ★ 走一遍真实链路 ===');
{
  const r = run(`(function(){
    Game.mode='single'; Game.playerCount=1;
    Save.reset();
    loadLevel(0);
    Game.state='playing';
    var p = Game.players[0];
    /* 手动触发（等价于 render 检测到"骑手到门口 + 订单达标"） */
    receiverTalkReset();
    var started = receiverTalkStart({late:false, missing:false});
    /* 走 3 秒主循环 */
    for (var i=0;i<180;i++){ InputState.now={}; update(1/60); InputState.tick(); }
    var s = receiverTalkSession();
    var after3 = { elapsed: +(s.elapsed.toFixed(2)), done: s.done, line: RECEIVER_TALK.lineIndexAt(s) };
    /* ★ 关键：这 3 秒里游戏状态不该被改 */
    var st = Game.state;
    /* 走满 10 秒 */
    for (var j=0;j<700;j++){ InputState.now={}; update(1/60); InputState.tick(); }
    var afterAll = { done: receiverTalkSession().done, state: Game.state };
    return { started: started, after3: after3, st: st, afterAll: afterAll };
  })()`);
  check(r.started, '触发成功');
  check(r.after3.elapsed > 2.9 && r.after3.elapsed < 3.1,
    '★ 主循环推动下计时**真的在走**（3 秒后 elapsed=' + r.after3.elapsed + '）');
  check(r.after3.line >= 0, '★ 已经说到第 ' + (r.after3.line + 1) + ' 句');
  check(r.st === 'playing', '★★ 说话期间 Game.state **仍是 playing**（没被卡住/切状态）');
  check(r.afterAll.done, '★ 10 秒后自然结束');
  check(r.afterAll.state === 'playing', '★★ 说完了还是 playing（说明这 10 秒只是余韵）');
}

/* ============================================================
 * 11. 健壮性：模块缺席不崩
 * ============================================================ */
console.log('\n=== 11. 健壮性 ===');
{
  const noFiles = FILES.filter(f => f !== 'receiver-talk.js');
  const sbNo = fresh(noFiles);
  const runNo = mkRun(sbNo);
  let err = null;
  try {
    runNo('Game.mode="single"; Game.playerCount=1; Save.reset(); loadLevel(0); Game.state="playing";');
    for (let f = 0; f < 10; f++) runNo('InputState.now={}; update(1/60); InputState.tick();');
  } catch (e) { err = e.message; }
  check(err === null,
    '★ 没有 receiver-talk.js 时游戏照常跑（typeof 保护生效）' + (err ? '（实际: ' + err + '）' : ''));

  /* 渲染/更新函数也要能在模块缺席时安全跳过。
   * ⚠️ 这里必须**照抄调用点的写法**（`typeof xxx === 'function' && xxx()`）——
   *    第一版我直接写 `receiverTalkReset && receiverTalkReset()`，
   *    在"模块缺席"的沙箱里 `receiverTalkReset` 是个**未声明的标识符**，
   *    访问它就 ReferenceError（不是 undefined）。
   *    ⇒ 这正是项目里所有调用点都用 `typeof` 而不是"真值判断"的原因。 */
  let err2 = null;
  try {
    runNo('typeof receiverTalkReset === "function" && receiverTalkReset()');
    runNo('typeof receiverTalkTick === "function" && receiverTalkTick(1/60)');
    runNo('typeof receiverTalkSession === "function" ? receiverTalkSession() : null');
    runNo('typeof receiverTalkSkip === "function" && receiverTalkSkip()');
    runNo('typeof RECEIVER_TALK !== "undefined" && RECEIVER_TALK.facingSign');
  } catch (e) { err2 = e.message; }
  check(err2 === null,
    '★ 调用点用 typeof 包着（缺席不抛异常）' + (err2 ? '（实际: ' + err2 + '）' : ''));

  let err3 = null;
  try {
    run('receiverTalkStart(null)');
    run('receiverTalkStart({})');
    run('RECEIVER_TALK.tick(null, 1/60)');
    run('RECEIVER_TALK.skip(null)');
    run('RECEIVER_TALK.lineAlpha(null)');
    run('RECEIVER_TALK.lineIndexAt(null)');
    run('RECEIVER_TALK.linesOf("不存在")');
  } catch (e) { err3 = e.message; }
  check(err3 === null, '★ 传 null / 空对象 / 非法组合也不抛异常' + (err3 ? '（实际: ' + err3 + '）' : ''));
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
console.log('  收餐人朝向 + 台词测试: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(52));
process.exit(fail > 0 ? 1 : 0);
