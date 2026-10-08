/* ============================================================
 * receiver-talk.js — 🧍 收餐人朝向 + 收到外卖后的台词（2026-10-07）
 * ============================================================
 * 十一的两条要求：
 *   ① "我希望接外卖的人是对着骑手的，因为我发现生成的都是背对着骑手。"
 *   ② "如果出现了接外卖的人，可以在收到外卖之后停个 10 秒钟，
 *       可以对骑手说一些话，什么谢谢啊，什么怎么这么慢，什么什么的。"
 *
 * ------------------------------------------------------------
 * ★ 需求 ①：朝向问题（为什么"看起来背对"）
 * ------------------------------------------------------------
 *   贴图 `receiver.png` 是**侧身**的（AI 出图 prompt 规定 side view），
 *   而它站在门洞里、固定不动。玩家（骑手）从左边跑过来，
 *   侧身小人却朝着右边 ⇒ 看起来就是"背对着骑手"。
 *
 *   单纯用 `ctx.scale(-1,1)` 镜像成"永远朝左"也不行 ——
 *   玩家有时从右边过来（比如第 20 关那种高处终点）。**朝左也是错的**。
 *
 *   ⇒ 正确做法：**按骑手的实际方向翻转**。
 *     骑手在左边 → 小人朝左（scale -1）；骑手在右边 → 朝右（不翻）。
 *     玩家还没到 → 保持默认朝向（看着路口，像在等人）。
 *
 *   ⚠️ 这条规则本身要能单独测（`facingSign()` 是纯函数，不吃渲染上下文）。
 *
 * ------------------------------------------------------------
 * ★ 需求 ②：收到外卖后说 10 秒钟话
 * ------------------------------------------------------------
 *   触发条件（三条同时满足）：
 *     · 这一关有收餐人
 *     · 订单达标（`Game.coinsTaken >= Game.coinsRequired`）
 *     · 骑手**走到门口**（碰到送达点）
 *
 *   然后收餐人停下来说话，持续 10 秒。
 *
 *   ⚠️⚠️ 关键设计：**绝不挡终点**
 *     "停 10 秒"很容易被做成"必须等 10 秒才能过关"——
 *     那是惩罚玩家。这里的情况正好相反：
 *     本作**送达即通关**（碰到终点立刻结算），所以这 10 秒是
 *     **在结算画面/庆祝动画上叠加的"彩蛋式余韵"**，
 *     玩家可随时按键跳过，游戏节奏一点没被拖慢。
 *     ⇒ `blocksGoal()` 永远返回 false，写死在代码里（防止后人改成"真卡关"）。
 *
 *   ⚠️ 10 秒很长，台词必须**分段**（不是一句话挂 10 秒）。
 *     做法：一份台词表按顺序播，每句有**停在屏幕上多久**，
 *     全部播完（或时间到）就收工。双人模式下标点更密。
 * ============================================================ */

const RECEIVER_TALK = (function () {

  const CFG = {
    /* ★ 收到外卖后说话的总时长（秒）—— 十一明确要 10 秒 */
    TALK_SECONDS: 10,

    /* 台词换句的淡出/淡入时间（秒）。
     * ⚠️ 不换句直接切换会很突兀（像文字在跳），必须有个过渡。 */
    FADE: 0.28,

    /* 气泡显示的最大宽度（格）—— 太宽会横跨半个屏幕，太窄会疯狂折行 */
    BUBBLE_MAX_COLS: 12,

    /* 气泡距离头顶的高度（像素） */
    BUBBLE_GAP: 14,

    /* 双人模式：两人都在门口，还是一个人到了就算？（本作用"任一玩家到达"） */
    ANY_PLAYER: true,
  };

  /* ============================================================
   * ★ 台词表 ★
   * ============================================================
   * 十一要"谢谢啊、怎么这么慢、什么什么的"。
   *
   * 【为什么分成 4 组而不是 1 组】
   *   10 秒的时长配一组台词会显得很空（一句话挂 10 秒很尴尬）。
   *   而且本作有"评价系统"（好评率）：
   *     · 准时到 / 超时 → 两种截然不同的顾客态度
   *     · 全好评 / 差评  → 态度又要变
   *   ⇒ 按"玩家这次的表现"选一组，让台词**和结果对得上**：
   *     送得快 + 订单齐 = 好评组；拖到超时 = 抱怨组。
   *     这样同样的 10 秒，不同玩法看到的台词不同，重复可玩性也更好。
   *
   * ⚠️ 写台词的三条规矩：
   *   ① 短句（一行放得下），别写成小作文
   *   ② 口语化（"怎么这么慢"，不是"配送时效未达预期"）
   *   ③ 不要说教玩家（"你要提高效率"这种会让人烦）
   * ============================================================ */
  const LINES = {
    /* ---------- 准时 + 订单齐全：满意 ---------- */
    good: [
      '谢谢啊！',
      '这么快就到了？',
      '饭还热着呢，太好了',
      '五星好评，回头还点你家',
    ],
    /* ---------- 超时了（但订单齐）：催单式抱怨 ---------- */
    late: [
      '怎么这么慢啊…',
      '我都等饿死了',
      '算了算了，凉了也能吃',
      '下次能不能快点',
    ],
    /* ---------- 订单没齐（漏单）：嫌弃 ---------- */
    missing: [
      '诶？我的可乐呢',
      '少了一份啊老板',
      '这单不全吧…',
      '算了，凑合吃吧',
    ],
    /* ---------- 又超时又漏单：崩了 ---------- */
    bad: [
      '又慢又少，服了',
      '我要投诉了啊',
      '你们这单送得…',
      '唉，晚饭算是毁了',
    ],
  };

  /* ============================================================
   * 选台词组（纯函数，好吃测试）
   * ------------------------------------------------------------
   * @param snap { late:boolean, missing:boolean }
   * @returns 组名字符串
   * ============================================================ */
  function pickGroup(snap) {
    const late = !!(snap && snap.late);
    const missing = !!(snap && snap.missing);
    if (late && missing) return 'bad';
    if (late) return 'late';
    if (missing) return 'missing';
    return 'good';
  }

  /* 取某一组的台词数组（副本，外部改不动内部表） */
  function linesOf(group) {
    const g = LINES[group] || LINES.good;
    return g.slice();
  }

  /* ============================================================
   * 生成一次"说话会话"
   * ------------------------------------------------------------
   * 每句分到的时间 = 总时长 / 句数（但每句有最小值，防止句子一闪而过）。
   * ⇒ 句数多的时候会自动把每句压到很短，这时候**减少句数**更好。
   *   所以先按"每句至少 MIN_PER_LINE 秒"算出这次最多能说几句。
   * ============================================================ */
  const MIN_PER_LINE = 1.4;

  function buildSession(snap) {
    const group = pickGroup(snap);
    const all = linesOf(group);
    const maxLines = Math.max(1, Math.floor(CFG.TALK_SECONDS / MIN_PER_LINE));
    const used = all.slice(0, Math.min(all.length, maxLines));
    const per = CFG.TALK_SECONDS / used.length;      // 每句停留秒数
    return {
      group: group,
      lines: used,
      per: per,
      total: CFG.TALK_SECONDS,
      elapsed: 0,
      /* ---------- 运行时状态 ---------- */
      done: false,        /* 说完了 */
      skipped: false,     /* 被玩家跳过 */
      /* ★ 一次性"说话开始"标记（用来播音效/弹提示）*/
      justStarted: true,
    };
  }

  /* 当前说第几句（0 起）；超出范围返回最后一句 */
  function lineIndexAt(sess) {
    if (!sess || !sess.lines.length) return 0;
    const i = Math.floor(sess.elapsed / sess.per);
    return Math.max(0, Math.min(sess.lines.length - 1, i));
  }

  /* 当前这句话相对本句时段已经过了多久（秒）—— 用于算淡入淡出 */
  function phaseInLine(sess) {
    if (!sess) return 0;
    return sess.elapsed - lineIndexAt(sess) * sess.per;
  }

  /* 当前这句话的不透明度 0~1（句首淡入、句尾淡出） */
  function lineAlpha(sess) {
    if (!sess) return 0;
    const ph = phaseInLine(sess);
    const inA = Math.min(1, ph / CFG.FADE);
    const outA = Math.min(1, (sess.per - ph) / CFG.FADE);
    /* ⚠️ 最后一句不淡出 —— 说完才是结束，淡出会让人以为"没说完就关了" */
    const isLast = (lineIndexAt(sess) === sess.lines.length - 1);
    return Math.max(0, Math.min(1, isLast ? inA : Math.min(inA, outA)));
  }

  /* ============================================================
   * 推进会话（每帧调）
   * ------------------------------------------------------------
   * ⚠️ 参数用 dt 而不是"固定 1/60"—— 虽然本项目锁 60fps，
   *    但这里只是计时，用 dt 更稳（万一将来允许变步长也不会错）。
   * ============================================================ */
  function tick(sess, dt) {
    if (!sess || sess.done) return;
    sess.elapsed += dt;
    if (sess.elapsed >= sess.total) {
      sess.elapsed = sess.total;
      sess.done = true;
    }
  }

  /* 玩家按键/操作跳过（十一没要求，但 10 秒对重复游玩太长了，
   * 必须给一个"我看到了，走"的出口） */
  function skip(sess) {
    if (!sess || sess.done) return;
    sess.done = true;
    sess.skipped = true;
  }

  /* ============================================================
   * ★★ 语义保证：说话**绝不挡终点** ★★
   * ------------------------------------------------------------
   * 本作"送达即通关"，所以这段 10 秒只能是余韵。
   * 这里显式写死返回 false —— 如果以后有人想改成"必须等说完"，
   * 就会先看到这个函数名和注释，知道当初是刻意不做成卡关的。
   * ============================================================ */
  function blocksGoal() { return false; }

  /* ============================================================
   * ★ 朝向（需求 ①）
   * ------------------------------------------------------------
   * @param riderX 骑手中心 x（可以传 null = "还没看到骑手"）
   * @param cx     收餐人自己中心 x
   * @returns {number} +1 = 朝右（不翻转，用贴图原方向）
   *                   -1 = 朝左（需要 ctx.scale(-1,1)）
   *
   * ⚠️ 死区：骑手和收餐人水平距离极近时**不翻转**。
   *    否则骑手站在门口时，人会因为一两像素的抖动左右横跳。
   * ============================================================ */
  const DEAD_ZONE = 12;

  function facingSign(riderX, cx) {
    if (typeof riderX !== 'number' || !isFinite(riderX)) return 1;
    const d = riderX - cx;
    if (Math.abs(d) < DEAD_ZONE) return 1;      // 太近 → 保持默认
    return d < 0 ? -1 : 1;                       // 骑手在左 → 朝左
  }

  /* 找"最值得看的那个骑手"—— 取离终点最近（先到）的活着的玩家。
   * ⚠️ 为什么不是"最左边的"：双人模式里两人分头跑，
   *    先到门口的那个才是收餐人该看的人。 */
  function riderToFace(players, cx) {
    if (!players || !players.length) return null;
    let best = null, bestD = Infinity;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p || p.dead) continue;
      const px = p.x + (p.w || 0) / 2;
      const d = Math.abs(px - cx);
      if (d < bestD) { bestD = d; best = px; }
    }
    return best;
  }

  /* ============================================================
   * 台词总表（测试/调试用；外部别直接改）
   * ============================================================ */
  function allGroups() { return Object.keys(LINES); }

  return {
    CFG: CFG,
    LINES: LINES,
    allGroups: allGroups,
    pickGroup: pickGroup,
    linesOf: linesOf,
    buildSession: buildSession,
    lineIndexAt: lineIndexAt,
    phaseInLine: phaseInLine,
    lineAlpha: lineAlpha,
    tick: tick,
    skip: skip,
    blocksGoal: blocksGoal,
    facingSign: facingSign,
    riderToFace: riderToFace,
  };
})();

/* ============================================================
 * 收餐人运行时状态（每关一份）
 * ------------------------------------------------------------
 * ⚠️ 为什么放全局而不是 Game 上：
 *    和 scooter.js / thunder.js 的姿势一致 —— 独立模块自己管状态，
 *    render.js 只读。删掉本文件 = 收餐人不再说话，朝向退回"不翻转"。
 * ============================================================ */
let _receiverSess = null;
let _receiverStarted = false;     // 已经触发过说话（每关只触发一次）

/** 进关时重置（game.js 在 loadLevel 之后调） */
function receiverTalkReset() {
  _receiverSess = null;
  _receiverStarted = false;
}

/**
 * 触发"收餐人说话"（由 render 检测到"骑手碰到终点 + 订单达标"时调用）
 * ⚠️ 每关只触发一次 —— 玩家在门口来回走不该反复触发。
 * @returns {boolean} 本次是否真的开始了（第一次 true，之后 false）
 */
function receiverTalkStart(snap) {
  if (_receiverStarted) return false;
  _receiverStarted = true;
  _receiverSess = RECEIVER_TALK.buildSession(snap);
  return true;
}

/** 取当前会话（没有返回 null） */
function receiverTalkSession() { return _receiverSess; }

/** 每帧推进（game.js 调） */
function receiverTalkTick(dt) {
  if (_receiverSess && !_receiverSess.done) RECEIVER_TALK.tick(_receiverSess, dt);
}

/** 玩家按键跳过 */
function receiverTalkSkip() {
  if (_receiverSess) RECEIVER_TALK.skip(_receiverSess);
}
