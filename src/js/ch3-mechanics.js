/* ============================================================
 * ch3-mechanics.js — 第 13~20 关的新机制集合（2026-10-06）
 * ============================================================
 * 十一的要求（重构 13~20 关）里点了名要这些机制：
 *   水位系统 / 潮汐状态 / 动态货柜 / 叉车路径 / 追逐控制器 /
 *   电弧周期 / 可破坏摊位 / 移动交通物 / 阶段切换 / 区域事件状态
 *
 * ------------------------------------------------------------
 * ★★ 为什么全部塞在一个文件里（而不是拆成 10 个）★★
 * ------------------------------------------------------------
 *   它们共享同一套"**周期 / 阶段 / 区域状态**"的骨架：
 *     · 每个机制都是"按帧推进一个计时器 → 改某个状态 → 影响物理或渲染"
 *     · 每个机制都要能"被关卡数据驱动"（参数从 level 里读）
 *     · 每个机制都要能"重进关卡时干净重置"
 *   ⇒ 拆成 10 个文件会有 10 份几乎一样的计时/重置/查表代码，
 *     反而更难维护。放一起、共用一套骨架，才是对的。
 *
 *   对外**只暴露一个 `CH3` 对象**（和 SCOOTER / AI_RIDER 的封装方式一致）：
 *     CH3.init(level)      进关时调一次，读关卡数据建状态
 *     CH3.update(dt, lv)   每帧推进
 *     CH3.speedMulFor(p)   查"这个角色现在速度该乘多少"（积水打滑等）
 *     CH3.hurtAt(p)        查"这个位置现在危不危险"（漏电/电弧/追车）
 *     CH3.draw*(ctx ...)   渲染各机制
 *   删掉本文件 = 这些机制全部失效，游戏照常能玩
 *   （所有调用点都有 `typeof CH3 !== 'undefined'` 保护）。
 *
 * ------------------------------------------------------------
 * ★★ 一条铁律：机制**绝不改 physics.js 和 CONFIG** ★★
 * ------------------------------------------------------------
 *   和 scooter.js 一样的规矩：
 *     · "打滑"不改角色属性，只是给**水平速度**乘一个系数
 *     · "伤害"不改角色血量上限，只是调 game.js 现成的 damagePlayer
 *     · "水位"不改碰撞，只是给经过的角色一个向上/向下的速度
 *   ⇒ 这样可达性判定（reachability-test）的模型**依然成立**：
 *     所有"能到哪"依然由跳跃/墙跳/冲刺决定，
 *     新机制只影响"手感和时机"，不影响"够不够得到"。
 *     ⚠️ 唯一的例外是气泡流/水柱（会把角色托上去），
 *        所以它们**只在设计上作为"额外通路"**，不能是唯一通路 ——
 *        否则可达性测试会判"够不到"（那是正确的警告）。
 * ============================================================ */

const CH3 = (function () {

  /* ============================================================
   * 通用参数（可在关卡里按机制覆盖）
   * ============================================================ */
  const CFG = {
    /* ---- 积水（第 13 关）---- */
    /* 积水里速度乘数 < 1 = 变慢；同时摩擦变小 = 打滑。
     * ⚠️ 不要调太低（<0.7 会让玩家觉得"被粘住"，很烦躁），
     *    打滑的"失控感"主要来自**摩擦**，不是速度。 */
    PUDDLE_SPEED_MUL: 0.86,
    /* 积水的水平推力（水流方向）—— 让角色被"冲"向低处 */
    PUDDLE_PUSH: 0.10,

    /* ---- 水柱（第 13 关排水塔）---- */
    /* 喷发周期（秒）：喷 X 秒 → 停 Y 秒。玩家要数拍子。 */
    JET_ON: 1.1,
    JET_OFF: 1.6,
    /* 被水柱顶起时给的向上速度（px/帧）。
     * ⚠️ 要明显大于跳跃（JUMP_POWER 约 -11.2），否则"被弹起来"
     *    和"自己跳"没区别，机制就不成立。 */
    JET_LAUNCH: -13.4,
    /* 水柱宽度（格）与高度（格） */
    JET_W: 1,
    JET_H: 5,

    /* ---- 漏电区（第 13 关广告牌）---- */
    /* 通电周期：带电 X 秒 → 断电 Y 秒。
     * ⚠️ 断电窗口必须**够长**（>= 1.8s），否则玩家"跑过去来不及"，
     *    那会变成拼手速而不是看节奏。 */
    ZAP_ON: 1.4,
    ZAP_OFF: 2.0,
    /* 通电前的预警时长（秒）—— 必须 > 0.5s，否则玩家没有反应时间 */
    ZAP_WARN: 0.7,

    /* ---- 水位 / 潮汐（第 15、18 关）---- */
    /* 涨落周期（秒）与水位变化范围（格） */
    TIDE_PERIOD: 25,
    TIDE_RISE_SEC: 8,          // 上涨用几秒
    /* 在水里的上浮速度与水平阻力 */
    WATER_FLOAT: -0.55,
    WATER_DRAG: 0.86,

    /* ---- 气泡流（第 18 关）---- */
    BUBBLE_LIFT: -0.9,

    /* ---- 电弧（第 19 关）---- */
    ARC_STEP_SEC: 0.42,        // 电弧沿线路跳一格的间隔
    ARC_WARN: 0.6,

    /* ---- 追车 / 追逐（第 16、20 关）---- */
    /* 追击者速度：略慢于玩家满速，靠"路线变化"甩开而不是靠速度 */
    CHASER_SPEED: 2.35,
    CHASER_WARN_SEC: 2.0,      // 追逐开始前的预警时长（公平性红线）

    /* ---- 叉车（第 14 关）---- */
    FORKLIFT_SPEED: 1.15,
    /* 被叉车撞到的"推走"力度（不是直接扣血，是击退 + 小伤害） */
    FORKLIFT_KNOCK: 5.2,

    /* ---- 移动货柜（第 14 关）---- */
    CARGO_SPEED: 0.85,
  };

  /* ============================================================
   * 运行时状态（每次进关重置）
   * ============================================================ */
  let S = null;

  function freshState() {
    return {
      t: 0,                  // 本关累计时间（秒）
      levelId: 0,

      /* 第 13 关 */
      puddles: [],           // {x,y,w,h,push}
      jets: [],              // {x,y,w,h,phase,on}
      zaps: [],              // {x,y,w,h,phase,on,warn}

      /* 第 14 关 */
      cargos: [],            // {x,y,w,h,axis,range,speed,base}
      forklifts: [],         // {x,y,w,h,left,right,dir}
      gates: [],             // {x,y,w,h,openT,period}

      /* 第 15 关 */
      water: null,           // {y, level0, level1, phase}
      pipes: [],             // {x,y,w,h,dir}

      /* 第 16 关 */
      traffic: [],           // {x,y,w,h,speed,dir,rideable}
      breaking: [],          // {x,y,w,h,armed,timer,gone,respawn}
      chaser: null,          // {x,active,started,warn,phase}

      /* 第 17 关 */
      awnings: [],           // 遮棚（视线）
      crowds: [],            // 人群 {x,y,w,h,dir,left,right}
      stalls: [],            // 可破坏摊位 {x,y,w,h,broken}

      /* 第 18 关 */
      tide: null,            // 潮汐（比 15 关更强）
      bubbles: [],           // 气泡流
      glass: [],             // 破裂玻璃 {x,y,w,h,crackT,broken}
      jelly: [],             // 水母（只在涨潮出现）

      /* 第 19 关 */
      nodes: [],             // 供电节点 {x,y,w,h,on}
      arcs: [],              // 电弧 {path:[{x,y}],step,on,phase}
      dark: false,           // 是否处于黑暗

      /* 第 20 关 */
      stage: 1,              // 当前阶段 1~6
      wind: 0,               // 当前风力（阶段推进时增强）
      lightning: [],         // 闪电预警 {x,y,w,h,warn,strike}
      debris: [],            // 坠落物
      cargoLift: [],         // 起重机货台
      drone: null,           // 终局追赶的无人机

      /* 事件钩子（渲染层读它做演出） */
      events: [],            // {type,text,ttl}
    };
  }

  /* ============================================================
   * 从关卡数据建状态
   * ============================================================
   * ⚠️ 关卡数据是**纯数据**（对象数组），不是函数 ——
   *    这样关卡表可以被 JSON 化、可以被测试直接读，不用执行代码。
   * ============================================================ */
  function init(level) {
    S = freshState();
    if (!level) return;
    S.levelId = level.id || 0;

    const d = (level && level.ch3) ? level.ch3 : null;
    if (!d) return;   // 这一关没用新机制 → 全部保持空数组，update 里会直接跳过

    /* ---- 13 关 ---- */
    if (Array.isArray(d.puddles)) {
      S.puddles = d.puddles.map(function (p) {
        return { x: p.x, y: p.y, w: p.w, h: p.h, push: (p.push == null ? CFG.PUDDLE_PUSH : p.push) };
      });
    }
    if (Array.isArray(d.jets)) {
      S.jets = d.jets.map(function (j, i) {
        return {
          x: j.x, y: j.y, w: j.w || CFG.JET_W * 32, h: j.h || CFG.JET_H * 32,
          /* 每个水柱错开相位，玩家才有"数拍子"的空间 */
          phase: (j.phase == null ? i * 0.37 : j.phase),
        };
      });
    }
    if (Array.isArray(d.zaps)) {
      S.zaps = d.zaps.map(function (z, i) {
        return {
          x: z.x, y: z.y, w: z.w, h: z.h,
          phase: (z.phase == null ? i * 0.5 : z.phase),
          on: false, warn: false,
        };
      });
    }

    /* ---- 14 关 ---- */
    if (Array.isArray(d.cargos)) {
      S.cargos = d.cargos.map(function (c) {
        return {
          x: c.x, y: c.y, w: c.w, h: c.h,
          axis: c.axis || 'x',
          range: (c.range == null ? 96 : c.range),
          speed: (c.speed == null ? CFG.CARGO_SPEED : c.speed),
          phase: c.phase || 0,
        };
      });
    }
    if (Array.isArray(d.forklifts)) {
      S.forklifts = d.forklifts.map(function (f) {
        return {
          x: f.x, y: f.y, w: f.w || 44, h: f.h || 26,
          left: f.left, right: f.right, dir: 1,
        };
      });
    }
    if (Array.isArray(d.gates)) {
      S.gates = d.gates.map(function (g, i) {
        return {
          x: g.x, y: g.y, w: g.w || 32, h: g.h || 32,
          openT: 1.2, closeT: 1.6, phase: (g.phase == null ? i * 0.8 : g.phase),
          open: false,
        };
      });
    }

    /* ---- 15 / 18 关 ---- */
    if (d.water || d.tide) {
      const w = d.water || d.tide;
      S.water = {
        col: w.col || 0, w: w.w || 600,
        lowY: w.lowY, highY: w.highY,
        period: w.period || CFG.TIDE_PERIOD,
        riseSec: w.riseSec || CFG.TIDE_RISE_SEC,
        y: w.lowY,
      };
    }
    if (Array.isArray(d.bubbles)) {
      S.bubbles = d.bubbles.map(function (b) {
        return { x: b.x, y: b.y, w: b.w || 32, h: b.h || 160 };
      });
    }
    if (Array.isArray(d.glass)) {
      S.glass = d.glass.map(function (g) {
        return { x: g.x, y: g.y, w: g.w || 64, h: g.h || 32, crackT: 0, broken: false, gone: 0 };
      });
    }
    if (Array.isArray(d.jelly)) {
      S.jelly = d.jelly.map(function (j) {
        return { x: j.x, y: j.y, baseY: j.y, dir: 1, phase: j.phase || 0 };
      });
    }

    /* ---- 16 关 ---- */
    if (Array.isArray(d.traffic)) {
      S.traffic = d.traffic.map(function (v, i) {
        return {
          x: v.x, y: v.y, w: v.w || 96, h: v.h || 28,
          speed: v.speed || 2.8, dir: v.dir || 1,
          rideable: v.rideable !== false,
          left: v.left, right: v.right,
          phase: v.phase || i * 60,
        };
      });
    }
    if (Array.isArray(d.breaking)) {
      S.breaking = d.breaking.map(function (b) {
        return { x: b.x, y: b.y, w: b.w || 64, h: b.h || 32, armed: false, timer: 0, gone: 0 };
      });
    }
    if (d.chaser) {
      S.chaser = {
        x: d.chaser.startX, y: d.chaser.y,
        active: false, started: false, warn: 0, warned: false,
        waves: d.chaser.waves || 1, wave: 0,
      };
    }

    /* ---- 17 关 ---- */
    if (Array.isArray(d.awnings)) {
      S.awnings = d.awnings.map(function (a) {
        return { x: a.x, y: a.y, w: a.w, h: a.h || 64 };
      });
    }
    if (Array.isArray(d.crowds)) {
      S.crowds = d.crowds.map(function (c) {
        return { x: c.x, y: c.y, w: c.w || 40, h: c.h || 34, dir: 1, left: c.left, right: c.right };
      });
    }
    if (Array.isArray(d.stalls)) {
      S.stalls = d.stalls.map(function (s) {
        return { x: s.x, y: s.y, w: s.w || 64, h: s.h || 24, broken: false, gone: 0 };
      });
    }

    /* ---- 19 关 ---- */
    if (Array.isArray(d.nodes)) {
      S.nodes = d.nodes.map(function (n) {
        return { x: n.x, y: n.y, w: 40, h: 56, id: n.id, on: false };
      });
    }
    if (Array.isArray(d.arcs)) {
      S.arcs = d.arcs.map(function (a, i) {
        return { path: a.path || [], step: 0, on: false, phase: (a.phase == null ? i * 0.3 : a.phase) };
      });
    }

    /* ---- 20 关 ---- */
    if (Array.isArray(d.lightning)) {
      S.lightning = d.lightning.map(function (l) {
        return { x: l.x, y: l.y, w: l.w || 64, h: l.h || 32, warn: 0, strike: 0 };
      });
    }
    if (Array.isArray(d.debris)) {
      S.debris = d.debris.map(function (x) {
        return { x: x.x, y: x.y, w: 28, h: 28, vy: 0, warned: false, active: false, baseY: x.y };
      });
    }
    if (Array.isArray(d.cargoLift)) {
      S.cargoLift = d.cargoLift.map(function (c) {
        return { x: c.x, y: c.y, w: c.w || 80, h: c.h || 22, range: c.range || 80, speed: c.speed || 0.8, phase: c.phase || 0 };
      });
    }
    if (d.drone) {
      S.drone = { x: d.drone.startX, y: d.drone.y, active: false, wave: 0 };
    }
    if (Array.isArray(d.stages)) {
      /* 阶段表：{ atX, stage, wind, event, text } —— 玩家越过 atX 就推进 */
      S.stageTable = d.stages;
      S.stage = 1;
      S.wind = d.stages[0] ? (d.stages[0].wind || 0) : 0;
    }
  }

  /* ============================================================
   * 每帧推进
   * ============================================================ */
  function update(dt, lv) {
    if (!S) return;
    S.t += dt;

    /* ---- 13 关：水柱与漏电的周期 ---- */
    S.jets.forEach(function (j) {
      const period = CFG.JET_ON + CFG.JET_OFF;
      const tt = (S.t + j.phase) % period;
      j.on = (tt < CFG.JET_ON);
      /* "刚喷完的前 0.3 秒"算作预警尾 —— 渲染层用它画水花 */
      j.justFired = (tt < 0.3);
    });

    S.zaps.forEach(function (z) {
      const period = CFG.ZAP_ON + CFG.ZAP_OFF;
      const tt = (S.t + z.phase) % period;
      z.on = (tt < CFG.ZAP_ON);
      /* ★ 预警：通电前 ZAP_WARN 秒开始闪 —— 这是"公平性"的关键，
       *   玩家必须能预判，否则就是"随机秒杀"。 */
      const warnStart = period - CFG.ZAP_WARN;
      z.warn = (tt >= warnStart);
    });

    /* ---- 14 关：货柜往返 ---- */
    S.cargos.forEach(function (c) {
      const off = Math.sin((S.t + c.phase) * c.speed) * c.range;
      c.offset = off;
    });

    /* ---- 14 关：叉车往返 ---- */
    S.forklifts.forEach(function (f) {
      f.x += CFG.FORKLIFT_SPEED * f.dir;
      if (f.x <= f.left) { f.x = f.left; f.dir = 1; }
      if (f.x >= f.right) { f.x = f.right; f.dir = -1; }
    });

    /* ---- 14 关：机械门 ---- */
    S.gates.forEach(function (g) {
      const period = g.openT + g.closeT;
      const tt = (S.t + g.phase) % period;
      g.open = (tt >= g.openT);       // 前段关、后段开
    });

    /* ---- 15 / 18 关：水位涨落 ---- */
    if (S.water) {
      const w = S.water;
      const period = w.period;
      const tt = S.t % period;
      let p;   // 0 = 最低, 1 = 最高
      const downSec = period - w.riseSec;
      if (tt < w.riseSec) p = tt / w.riseSec;                 // 涨
      else if (tt < w.riseSec + downSec * 0.5) p = 1;         // 高潮
      else p = Math.max(0, 1 - (tt - w.riseSec - downSec * 0.5) / (downSec * 0.5)); // 落
      w.y = w.lowY + (w.highY - w.lowY) * p;
      w.p = p;
    }

    /* ---- 18 关：玻璃裂纹 ---- */
    S.glass.forEach(function (g) {
      if (g.broken) { g.gone += dt; return; }
      /* 有人站在上面就开始裂 */
      if (g.crackT > 0) {
        g.crackT += dt;
        if (g.crackT > 1.6) { g.broken = true; g.gone = 0; }
      }
    });

    /* ---- 18 关：水母上下漂浮 ---- */
    S.jelly.forEach(function (j) {
      j.y = j.baseY + Math.sin(S.t * 1.4 + j.phase) * 26;
    });

    /* ---- 16 关：车流 ---- */
    S.traffic.forEach(function (v) {
      v.x += v.speed * v.dir;
      if (v.dir > 0 && v.x > v.right) { v.x = v.left; }
      if (v.dir < 0 && v.x < v.left) { v.x = v.right; }
    });

    /* ---- 16 关：断裂路面 ---- */
    S.breaking.forEach(function (b) {
      if (b.gone > 0) {
        b.gone -= dt;
        if (b.gone <= 0) { b.armed = false; b.timer = 0; }   // 复原
        return;
      }
      if (b.armed) {
        b.timer += dt;
        if (b.timer > 1.2) { b.gone = 3.0; }                 // 塌了，3 秒后复原
      }
    });

    /* ---- 16 关：追车 ---- */
    if (S.chaser) {
      const ch = S.chaser;
      if (ch.warn > 0) {
        ch.warn -= dt;
        if (ch.warn <= 0) { ch.active = true; }
      }
    }

    /* ---- 19 关：电弧 ---- */
    S.arcs.forEach(function (a) {
      if (!a.path || a.path.length < 2) return;
      const idx = Math.floor(S.t / CFG.ARC_STEP_SEC + a.phase) % a.path.length;
      a.step = idx;
      a.on = true;
    });
    /* 黑暗 = 三个节点全亮之前 */
    if (S.nodes.length) {
      const litCount = S.nodes.filter(function (n) { return n.on; }).length;
      S.dark = (litCount < S.nodes.length);
      S.litCount = litCount;
    }

    /* ---- 20 关：阶段推进 ---- */
    if (S.stageTable && lv && lv.spawns && lv.spawns.length) {
      /* 用"玩家最靠前的进度"推进阶段 */
      const maxX = (typeof Game !== 'undefined' && Game.players && Game.players.length)
        ? Game.players.reduce(function (m, p) { return Math.max(m, p.x); }, 0)
        : 0;
      for (let i = 0; i < S.stageTable.length; i++) {
        const st = S.stageTable[i];
        if (maxX >= st.atX && st.stage > S.stage) {
          S.stage = st.stage;
          S.wind = st.wind || 0;
          S.events.push({ type: 'stage', stage: st.stage, text: st.text || '', ttl: 3.2 });
        }
      }
    }

    /* ---- 20 关：闪电预警 ---- */
    S.lightning.forEach(function (l) {
      l.warn += dt;
      /* 周期：预警 1.1s → 落雷 0.35s → 停 2.2s */
      const cyc = (l.warn) % 3.65;
      l.charging = (cyc < 1.1);
      l.striking = (cyc >= 1.1 && cyc < 1.45);
    });

    /* ---- 20 关：坠落物 ---- */
    S.debris.forEach(function (d) {
      d.warned = ((S.t * 0.7) % 3.0) < 0.9;
      if (d.warned) { d.active = false; d.vy = 0; d.y = d.baseY - 260; }
      else if (d.y < d.baseY + 40) {
        d.active = true;
        d.vy += 0.55;
        d.y += d.vy;
      } else { d.active = false; d.vy = 0; d.y = d.baseY - 260; }
    });

    /* ---- 事件 ttl 递减 ---- */
    for (let i = S.events.length - 1; i >= 0; i--) {
      S.events[i].ttl -= dt;
      if (S.events[i].ttl <= 0) S.events.splice(i, 1);
    }
  }

  /* ============================================================
   * 查询接口（给 game.js 的物理层用）
   * ============================================================ */

  /** 某个矩形是否和某个机制区域重叠 */
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** 角色在积水里吗 → 返回速度倍率（不在就返回 1） */
  function speedMulFor(p) {
    if (!S) return 1;
    let mul = 1;
    for (let i = 0; i < S.puddles.length; i++) {
      if (overlap(p, S.puddles[i])) { mul *= CFG.PUDDLE_SPEED_MUL; break; }
    }
    /* 水里也变慢 */
    if (S.water && (p.y + p.h) > S.water.y) {
      const inX = (p.x + p.w) > S.water.col && p.x < S.water.col + S.water.w;
      if (inX) mul *= 0.88;
    }
    return mul;
  }

  /** 角色在积水/水里吗（给 physics 的摩擦力用 —— 让它打滑，不是变粘） */
  function isSlippery(p) {
    if (!S) return false;
    for (let i = 0; i < S.puddles.length; i++) {
      if (overlap(p, S.puddles[i])) return true;
    }
    if (S.water && (p.y + p.h) > S.water.y) return true;
    return false;
  }

  /** 积水的水流推力（每帧加到 vx 上） */
  function pushFor(p) {
    if (!S) return 0;
    for (let i = 0; i < S.puddles.length; i++) {
      const pd = S.puddles[i];
      if (overlap(p, pd)) return pd.push;
    }
    return 0;
  }

  /** 角色踩到水柱了吗 → 返回该给的向上速度（没踩到返回 0） */
  function jetLiftFor(p) {
    if (!S) return 0;
    for (let i = 0; i < S.jets.length; i++) {
      const j = S.jets[i];
      if (!j.on) continue;
      if (overlap(p, j)) return CFG.JET_LAUNCH;
    }
    return 0;
  }

  /** 角色踩到气泡流了吗 */
  function bubbleLiftFor(p) {
    if (!S) return 0;
    for (let i = 0; i < S.bubbles.length; i++) {
      if (overlap(p, S.bubbles[i])) return CFG.BUBBLE_LIFT;
    }
    return 0;
  }

  /* ============================================================
   * 危险判定（给 game.js 每帧调）
   * ============================================================
   * 返回一个"死因 id"或 null。
   * ⚠️ 死因 id 要**具体**（十一明确要求不许只说"配送失败"）——
   *    渲染结算页时会把它翻成中文。
   * ============================================================ */
  function hurtAt(p) {
    if (!S) return null;

    /* 漏电区（只在通电时） */
    for (let i = 0; i < S.zaps.length; i++) {
      if (S.zaps[i].on && overlap(p, S.zaps[i])) return 'electrocuted';
    }

    /* 电弧（第 19 关） */
    for (let i = 0; i < S.arcs.length; i++) {
      const a = S.arcs[i];
      if (!a.path || !a.path.length) continue;
      const pt = a.path[a.step];
      if (!pt) continue;
      const box = { x: pt.x - 12, y: pt.y - 12, w: 24, h: 24 };
      if (overlap(p, box)) return 'electrocuted';
    }

    /* 闪电落点（第 20 关） */
    for (let i = 0; i < S.lightning.length; i++) {
      const l = S.lightning[i];
      if (l.striking && overlap(p, l)) return 'lightning';
    }

    /* 坠落物（第 20 关） */
    for (let i = 0; i < S.debris.length; i++) {
      const d = S.debris[i];
      if (d.active && overlap(p, d)) return 'fall-debris';
    }

    /* 追车 / 无人机 */
    if (S.chaser && S.chaser.active) {
      const cb = { x: S.chaser.x, y: S.chaser.y, w: 120, h: 70 };
      if (overlap(p, cb)) return 'chase-caught';
    }
    if (S.drone && S.drone.active) {
      const db = { x: S.drone.x, y: S.drone.y, w: 140, h: 90 };
      if (overlap(p, db)) return 'chase-caught';
    }

    return null;
  }

  /** 被叉车撞到 → 返回击退信息（不是直接死） */
  function knockAt(p) {
    if (!S) return null;
    for (let i = 0; i < S.forklifts.length; i++) {
      const f = S.forklifts[i];
      if (overlap(p, f)) {
        return { vx: CFG.FORKLIFT_KNOCK * f.dir, vy: -3.2, reason: 'forklift' };
      }
    }
    return null;
  }

  /* ============================================================
   * 动态可站/可挡平台
   *
   * 这些物体原先只在渲染层变化颜色和位置，物理层看不到，
   * 会造成“看起来能踩但穿过去”或“颜色变了却仍然挡路”。
   * 每帧在 ACTIONS/CH3 更新后由 physics.collectSolids 读取，
   * 因此位置、开关状态和碰撞状态严格同步。
   * ============================================================ */
  function dynamicSolids() {
    if (!S) return [];
    const out = [];
    S.cargos.forEach(function (c) {
      out.push({ x: c.x + (c.offset || 0), y: c.y, w: c.w, h: c.h, isCh3Dynamic: true });
    });
    S.traffic.forEach(function (v) {
      if (v.rideable !== false) {
        out.push({ x: v.x, y: v.y, w: v.w, h: v.h, isCh3Dynamic: true });
      }
    });
    S.breaking.forEach(function (b) {
      if (!b.gone) out.push({ x: b.x, y: b.y, w: b.w, h: b.h, isCh3Dynamic: true });
    });
    S.glass.forEach(function (g) {
      if (!g.broken) out.push({ x: g.x, y: g.y, w: g.w, h: g.h, isCh3Dynamic: true });
    });
    S.gates.forEach(function (g) {
      if (!g.open) out.push({ x: g.x, y: g.y, w: g.w, h: g.h, isCh3Dynamic: true });
    });
    S.cargoLift.forEach(function (c) {
      const x = c.x + Math.sin(S.t * c.speed + c.phase) * c.range;
      out.push({ x: x, y: c.y, w: c.w, h: c.h, isCh3Dynamic: true });
    });
    return out;
  }

  /* ============================================================
   * 状态查询（渲染层 / 关卡逻辑用）
   * ============================================================ */
  function current() { return S; }
  function reset() { S = null; }

  /** 这一关有没有用任何新机制（渲染层据此决定要不要画额外层） */
  function active() {
    if (!S) return false;
    return !!(S.puddles.length || S.jets.length || S.zaps.length ||
      S.cargos.length || S.forklifts.length || S.gates.length ||
      S.water || S.bubbles.length || S.glass.length || S.jelly.length ||
      S.traffic.length || S.breaking.length || S.chaser ||
      S.awnings.length || S.crowds.length || S.stalls.length ||
      S.nodes.length || S.arcs.length || S.lightning.length ||
      S.debris.length || S.cargoLift.length || S.drone);
  }

  return {
    init: init,
    update: update,
    current: current,
    reset: reset,
    active: active,
    speedMulFor: speedMulFor,
    isSlippery: isSlippery,
    pushFor: pushFor,
    jetLiftFor: jetLiftFor,
    bubbleLiftFor: bubbleLiftFor,
    hurtAt: hurtAt,
    knockAt: knockAt,
    dynamicSolids: dynamicSolids,
    CFG: CFG,
    _internals: { overlap: overlap },
  };
})();

/* ============================================================
 * ★ 绘制 —— 每个机制都必须"看得见"（2026-10-06）★
 * ============================================================
 * 【为什么这段单独放在模块外、而不是塞进 CH3 内部】
 *   渲染需要 render.js 的 ctx 调用约定（世界坐标 + cam 偏移），
 *   而 CH3 的核心（物理）不该依赖任何渲染概念。
 *   分开之后：删掉这段 = 机制还是生效的，只是看不见
 *   （当然实际上要一起留，毕竟"看不见的机制等于不存在"）。
 *
 * 【坐标约定】这里的 ctx 已经在**世界坐标**下（render.js 里
 *   translate(-cam.x, -cam.y) 之后），所以直接用 sv.x/sv.y 画即可。
 * ============================================================ */
function drawCh3Mechanics(ctx, lv, cam, t) {
  if (typeof CH3 === 'undefined' || !CH3.active || !CH3.active()) return;
  const S = CH3.current();
  if (!S) return;

  ctx.save();

  /* ---------- 积水（第 13/15/18 关）：半透明蓝 + 波纹 ---------- */
  S.puddles.forEach(function (p) {
    ctx.fillStyle = 'rgba(90,170,220,0.42)';
    ctx.fillRect(p.x, p.y - 6, p.w, p.h + 6);
    /* 水面高光（跟着时间波动 —— 一眼看出"这是水"） */
    ctx.strokeStyle = 'rgba(200,240,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= p.w; x += 8) {
      const yy = p.y - 6 + Math.sin((x + t * 60) / 22) * 2;
      if (x === 0) ctx.moveTo(p.x + x, yy); else ctx.lineTo(p.x + x, yy);
    }
    ctx.stroke();
  });

  /* ---------- 水柱（第 13 关）：喷发时是白蓝柱 + 水花 ---------- */
  S.jets.forEach(function (j) {
    if (j.on) {
      const g = ctx.createLinearGradient(0, j.y, 0, j.y + j.h);
      g.addColorStop(0, 'rgba(220,245,255,0.85)');
      g.addColorStop(1, 'rgba(120,190,230,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(j.x + 4, j.y, j.w - 8, j.h);
      /* 顶部水花 */
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 3; i++) {
        const ox = j.x + 6 + i * ((j.w - 12) / 2);
        const oy = j.y - 6 - Math.abs(Math.sin(t * 9 + i)) * 8;
        ctx.fillRect(ox, oy, 4, 6);
      }
    } else {
      /* 喷发前：画个"蓄势"的水痕（★ 这是公平性 —— 玩家能预判） */
      ctx.fillStyle = 'rgba(140,200,235,0.30)';
      ctx.fillRect(j.x + 6, j.y + j.h - 14, j.w - 12, 10);
    }
  });

  /* ---------- 漏电区（第 13/17 关）：带电时是黄白电弧 ---------- */
  S.zaps.forEach(function (z) {
    if (z.on) {
      ctx.strokeStyle = 'rgba(255,240,120,0.9)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const xx = z.x + 6 + i * ((z.w - 12) / 3);
        ctx.beginPath();
        ctx.moveTo(xx, z.y);
        /* 锯齿状电弧 */
        for (let s = 1; s <= 5; s++) {
          ctx.lineTo(xx + (s % 2 ? 5 : -5), z.y + (z.h / 5) * s);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,240,120,0.20)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
    } else if (z.warn) {
      /* ★ 通电前预警：闪黄边（★ 公平性 —— 必须能预判） */
      const a = 0.35 + Math.abs(Math.sin(t * 14)) * 0.45;
      ctx.strokeStyle = 'rgba(255,210,80,' + a.toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }
  });

  /* ---------- 水位（第 15/18 关）：半透明水体 ---------- */
  if (S.water && S.water.y) {
    const w = S.water;
    ctx.fillStyle = 'rgba(60,140,200,0.36)';
    ctx.fillRect(w.col, w.y, w.w, 4000);
    ctx.strokeStyle = 'rgba(180,230,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w.w; x += 10) {
      const yy = w.y + Math.sin((x + t * 50) / 30) * 3;
      if (x === 0) ctx.moveTo(w.col + x, yy); else ctx.lineTo(w.col + x, yy);
    }
    ctx.stroke();
  }

  /* ---------- 气泡流（第 18 关）：向上冒的泡 ---------- */
  S.bubbles.forEach(function (b) {
    ctx.strokeStyle = 'rgba(200,240,255,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < 5; i++) {
      const ph = ((t * 0.6 + i * 0.2) % 1);
      const by = b.y + b.h - ph * b.h;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2 + Math.sin(ph * 8 + i) * 8, by, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  /* ---------- 移动货柜（第 14 关）---------- */
  S.cargos.forEach(function (c) {
    const x = c.x + (c.offset || 0);
    ctx.fillStyle = '#3a6f8f';
    ctx.fillRect(x, c.y, c.w, c.h);
    ctx.strokeStyle = '#8fd4f0';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, c.y, c.w, c.h);
    /* 箱体纹路 */
    ctx.strokeStyle = 'rgba(160,220,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (c.w / 3) * i, c.y + 4);
      ctx.lineTo(x + (c.w / 3) * i, c.y + c.h - 4);
      ctx.stroke();
    }
  });

  /* ---------- 叉车（第 14 关）---------- */
  S.forklifts.forEach(function (f) {
    ctx.fillStyle = '#d8a63a';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = '#5a4a20';
    ctx.fillRect(f.x + (f.dir > 0 ? f.w - 8 : 0), f.y + 4, 8, f.h - 8);   // 货叉
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(f.x + 4, f.y + f.h - 4, 8, 4);
    ctx.fillRect(f.x + f.w - 12, f.y + f.h - 4, 8, 4);
  });

  /* ---------- 机械门（第 14 关）---------- */
  S.gates.forEach(function (g) {
    ctx.fillStyle = g.open ? 'rgba(120,200,150,0.45)' : 'rgba(200,80,80,0.75)';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x, g.y, g.w, g.h);
  });

  /* ---------- 车流（第 16 关）---------- */
  S.traffic.forEach(function (v) {
    ctx.fillStyle = v.rideable ? '#4a7fd0' : '#c8463a';
    ctx.fillRect(v.x, v.y, v.w, v.h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(v.x + 4, v.y + 4, 10, 6);
    ctx.fillRect(v.x + v.w - 14, v.y + 4, 10, 6);
  });

  /* ---------- 断裂路面（第 16 关）---------- */
  S.breaking.forEach(function (b) {
    if (b.gone > 0) return;                       // 已塌，不画
    if (b.armed) {
      /* 踩上去后：裂纹越多越危险（★ 预警） */
      const k = Math.min(1, b.timer / 1.2);
      ctx.strokeStyle = 'rgba(255,120,80,' + (0.4 + k * 0.6).toFixed(2) + ')';
      ctx.lineWidth = 2 + k * 2;
      for (let i = 0; i < 5; i++) {
        const xx = b.x + (b.w / 5) * i + 10;
        ctx.beginPath();
        ctx.moveTo(xx, b.y);
        ctx.lineTo(xx + 8, b.y + b.h);
        ctx.stroke();
      }
    }
  });

  /* ---------- 追车 / 无人机（第 16/20 关）---------- */
  function drawChaser(cx, cy, w, h, warn) {
    ctx.fillStyle = warn ? 'rgba(255,200,60,0.85)' : 'rgba(200,40,40,0.9)';
    ctx.fillRect(cx, cy, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(cx + 8, cy + 8, w - 16, 8);
    if (warn) {
      ctx.strokeStyle = 'rgba(255,200,60,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 6, cy - 6, w + 12, h + 12);
    }
  }
  if (S.chaser) {
    if (S.chaser.warn > 0) {
      /* ★ 预警期：只画个警示框（★ 公平性 —— 不能"第一次就必死"） */
      drawChaser(S.chaser.x, S.chaser.y, 120, 70, true);
    } else if (S.chaser.active) {
      drawChaser(S.chaser.x, S.chaser.y, 120, 70, false);
    }
  }
  if (S.drone && S.drone.active) {
    drawChaser(S.drone.x, S.drone.y, 140, 90, false);
  }

  /* ---------- 遮棚（第 17 关）：半透明顶棚 ---------- */
  S.awnings.forEach(function (a) {
    ctx.fillStyle = 'rgba(40,30,50,0.55)';
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeStyle = 'rgba(255,180,120,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, a.w, a.h);
  });

  /* ---------- 人群（第 17 关）：一堆圆点 ---------- */
  S.crowds.forEach(function (c) {
    ctx.fillStyle = 'rgba(200,180,220,0.65)';
    for (let i = 0; i < 4; i++) {
      const ox = c.x + 6 + i * 8;
      ctx.beginPath();
      ctx.arc(ox, c.y + c.h / 2 + Math.sin(t * 3 + i) * 2, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  /* ---------- 可破坏摊位（第 17 关）---------- */
  S.stalls.forEach(function (st) {
    if (st.broken) return;
    ctx.fillStyle = '#b06a3a';
    ctx.fillRect(st.x, st.y, st.w, st.h);
    ctx.strokeStyle = '#e0a070';
    ctx.lineWidth = 1;
    ctx.strokeRect(st.x, st.y, st.w, st.h);
  });

  /* ---------- 供电节点（第 19 关）---------- */
  S.nodes.forEach(function (n) {
    ctx.fillStyle = n.on ? 'rgba(120,255,170,0.85)' : 'rgba(90,90,110,0.8)';
    ctx.fillRect(n.x, n.y, n.w, n.h);
    ctx.strokeStyle = n.on ? '#9affc0' : '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(n.x, n.y, n.w, n.h);
    if (n.on) {
      ctx.fillStyle = 'rgba(120,255,170,0.25)';
      ctx.beginPath();
      ctx.arc(n.x + n.w / 2, n.y + n.h / 2, 26 + Math.sin(t * 5) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  /* ---------- 电弧（第 19 关）---------- */
  S.arcs.forEach(function (a) {
    if (!a.path || !a.path.length) return;
    for (let i = 0; i < a.path.length; i++) {
      const pt = a.path[i];
      const active = (i === a.step);
      ctx.fillStyle = active ? 'rgba(255,250,150,0.95)' : 'rgba(120,120,140,0.5)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, active ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = 'rgba(255,250,150,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });

  /* ---------- 闪电落点（第 20 关）：预警圈 + 落雷 ---------- */
  S.lightning.forEach(function (l) {
    if (l.charging) {
      /* ★ 预警：画个闪烁的警示圈（★ 公平性） */
      const a = 0.25 + Math.abs(Math.sin(t * 10)) * 0.5;
      ctx.strokeStyle = 'rgba(255,230,100,' + a.toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(l.x, l.y - 40, l.w, l.h + 40);
    }
    if (l.striking) {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(l.x + l.w / 2 - 4, l.y - 300, 8, 300 + l.h);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(l.x - 10, l.y - 10, l.w + 20, l.h + 20);
    }
  });

  /* ---------- 坠落物（第 20 关）：★★ 必须有影子预警 ---------- */
  S.debris.forEach(function (d) {
    if (d.warned) {
      /* ★ 影子（玩家看到影子就知道"上面要掉东西"） */
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(d.x + d.w / 2, d.baseY + d.h, d.w * 0.7, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      /* 上方一个警示标记 */
      ctx.fillStyle = 'rgba(255,200,60,0.8)';
      ctx.fillRect(d.x + d.w / 2 - 3, d.baseY - 200, 6, 20);
    }
    if (d.active) {
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 1;
      ctx.strokeRect(d.x, d.y, d.w, d.h);
    }
  });

  /* ---------- 起重机货台（第 20 关）---------- */
  S.cargoLift.forEach(function (c) {
    const x = c.x + Math.sin(t * c.speed + c.phase) * c.range;
    /* 吊索 */
    ctx.strokeStyle = 'rgba(200,200,200,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + c.w / 2, c.y - 120);
    ctx.lineTo(x + c.w / 2, c.y);
    ctx.stroke();
    /* 货台 */
    ctx.fillStyle = '#7a6a4a';
    ctx.fillRect(x, c.y, c.w, c.h);
    ctx.strokeStyle = '#c0a878';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, c.y, c.w, c.h);
  });

  /* ---------- 破裂玻璃（第 18 关）---------- */
  S.glass.forEach(function (g) {
    if (g.broken) return;
    ctx.fillStyle = 'rgba(150,220,240,0.35)';
    ctx.fillRect(g.x, g.y, g.w, g.h);
    if (g.crackT > 0) {
      const k = Math.min(1, g.crackT / 1.6);
      ctx.strokeStyle = 'rgba(255,120,120,' + (0.4 + k * 0.6).toFixed(2) + ')';
      ctx.lineWidth = 1 + k * 2;
      for (let i = 0; i < 6; i++) {
        const xx = g.x + (g.w / 6) * i + 6;
        ctx.beginPath();
        ctx.moveTo(xx, g.y);
        ctx.lineTo(xx + 6, g.y + g.h / 2);
        ctx.lineTo(xx - 4, g.y + g.h);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(200,240,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(g.x, g.y, g.w, g.h);
  });

  /* ---------- 水母（第 18 关）---------- */
  S.jelly.forEach(function (j) {
    ctx.fillStyle = 'rgba(220,150,255,0.7)';
    ctx.beginPath();
    ctx.arc(j.x + 12, j.y, 12, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,200,255,0.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(j.x + 4 + i * 8, j.y);
      ctx.lineTo(j.x + 4 + i * 8 + Math.sin(t * 4 + i) * 4, j.y + 16);
      ctx.stroke();
    }
  });

  ctx.restore();
}
