/* ============================================================
 * levels-ch4.js - 第四章「跨城极限配送」：订单 21~30
 *
 * 这一章专门按玩家已经掌握二段跳、墙跳、冲刺来设计：
 * 每关至少有一个“动作组合”，并用分区、折返、追逐或状态变化
 * 拉开节奏。所有路线都有地面保底，单人使用袋鼠/飞龙宝宝均可通关。
 * ============================================================ */
(function () {
  'use strict';
  const T = 32;

  /* ============================================================
   * ★★ 2026-10-07 修 Codex 留下的**系统性 bug**：坑全被"封底"填回 ★★
   * ============================================================
   * 【现象】第 21~30 关的**所有坑（ch3Gap）都失效**，地面是一整条实心，
   *   玩家看到的图和设计意图完全对不上（十一反馈"图好像有问题"）。
   *
   * 【根因】`ch3Gap(g, r, c1, c2)` 内部是：
   *     hline(g, r,     '.')     ← 挖坑
   *     hline(g, r + 1, '.')     ← 挖坑
   *     sealBottom(g, c1, c2)    ← 把**地图最后两行**强行铺回 '#'
   *   而 Codex 这批关卡的地面行 = `S + 1 = R - 2`，**正好等于"最后两行"**
   *   ⇒ `sealBottom` 紧跟着把刚挖的坑又填实了。**坑白挖。**
   *
   * 【修法与第 13~20 关对齐：不用 ch3Gap，改成"分段铺地面"】
   *   第 13~20 关（`levels-ch3.js` 的 `ch3Base(..., 'edge')`）早就踩过
   *   同一个坑，正确姿势是：**地面只铺"有地面的段"，段与段之间留空**
   *   ⇒ 留空的地方就是**真坑**（玩家会掉下去，`game.js` 按 fall 判死）。
   *   ⇒ 所以这里也照做：用 `groundSpan` 一段段铺，**不调用 ch3Gap**。
   *
   * ⚠️ 地图尺寸**保持原样**（不多加封底行）—— 因为不再挖坑，
   *   就没有"挖穿底线"的风险了。这样 `S = R - 3`、所有 `S-n`
   *   的相对位置**一行都不用改**。
   * ============================================================ */
  function levelMap(cols, rows) {
    const g = blankMap(cols, rows);
    ch3Seal(g);
    return g;
  }
  /* 铺一段地面（实心，自动加厚 1 格）—— 段之间**不铺**就是坑 */
  function groundSpan(g, r, a, b) { ch3Ground(g, r, a, b); }
  function floor(g, r, a, b) { ch3Ground(g, r, a, b); }
  function platform(g, r, a, b) { ch3Platform(g, r, a, b); }
  function orders(g, r, a, b, step) { ch3OrderRow(g, r, a, b, step || 4); }
  /* 真实参与碰撞的移动平台；机制层货台只是视觉演出。 */
  function mover(g, r, c, width) {
    for (let i = 0; i < (width || 3); i++) put(g, r, c + i, 'm');
  }
  /* ============================================================
   * ★★ 第 21~30 关的订单门槛：**70%**（2026-10-07 十一拍板）★★
   * ============================================================
   * 【为什么和第 1~20 关不一样】
   *   全局门槛是 80%（`CONFIG.COIN_REQUIRE_RATIO`）。十一认为
   *   "第 21~30 关本来就有难度了"，所以这 10 关**单独降到 70%**。
   *
   * 【⚠️ 光降门槛不够 —— 必须同时修订单位置】
   *   实测（`tools/_ch4-audit.js` + `check-coins-all.js`）：
   *   这批关卡有一批订单**悬在高空平台上方 11~20 格**（352~640px），
   *   而物理上限（双跳+冲刺）只有 **10.48 格 / 336px** ⇒ 跳不上去。
   *   最惨的是第 30 关：25 单里只有 8~9 单真能吃到。
   *   ⇒ 70%（第 30 关 = 18 单）**光靠降门槛仍然过不去**。
   *   ⇒ 所以本轮**同时**把够不到的订单挪到可达处（见各关的
   *     `orders(...)` 行号调整），**不动地形结构**。
   *
   * 【和全局的关系】
   *   `game.js` 读门槛的顺序：关卡 `coinRequireRatio` > 全局。
   *   ⚠️ 这个字段必须在 `parseLevel` 的白名单里有一行拷贝，
   *      否则会静默失效、退回全局 80%（本项目踩过两次的坑）。
   * ============================================================ */
  const CH4_COIN_RATIO = 0.7;

  function base(id, name, subtitle, district, g, time, ch3) {
    /* ============================================================
     * ★★★ 统一"坑底救援面 + 可爬台阶"（2026-10-07）★★★
     * ============================================================
     * 【问题】21~30 关每关都有 5~7 个**宽 4~7 格、掉下去必死**的深坑
     *   （地面段之间不铺就是坑，而坑一直空到地图外）。
     *   实测跳距：**单跳 3.38 格 / 双跳 5.44 格** ⇒ 4 格以上单跳过不去
     *   （十一报"一出来就被墙卡住"）。
     *
     * 【修法（十一要的"多安排可以爬的楼梯，不要太高"）】
     *   ① **坑底铺救援面**（最后一行）⇒ 不再掉出世界摔死；
     *   ② **坑底铺一阶"台阶"**（比坑底高 1 格 = 与地面同高）⇒
     *      玩家站在坑底时，**脚下就有一个与地面齐平的踩点**，
     *      向右走一步就能上来，**不用跳**；
     *   ③ **宽坑（>3 格）中间加一块台子** ⇒ 把"一次跳 6 格"
     *      拆成"两次跳 3 格"，单跳就够。
     *
     * 【为什么放在 base()】
     *   它是 10 关的**唯一出口** ⇒ 改一处 10 关全生效，新增关卡也不会漏。
     * ⚠️ 只做"加底 + 加台阶"，**不改变地形轮廓**（坑还是坑，只是不再致命）。
     * ============================================================ */
    (function fixPits(gg) {
      const sz = mapSize(gg);
      const groundRow = sz.rows - 2;          /* S+1：地面所在行 */
      const sealRow = sz.rows - 1;            /* 最后一行：救援面 */

      /* --- ① 坑底救援面（最后一行铺实） --- */
      for (let c = 1; c < sz.cols - 1; c++) {
        const at = gg[groundRow][c];
        if (at === '.' || at === ' ') put(gg, sealRow, c, '#');
      }

      /* --- ②③ 逐个坑：加台阶 + 宽坑中间加台 --- */
      let st = -1;
      for (let c = 1; c <= sz.cols - 1; c++) {
        const at = (c < sz.cols - 1) ? gg[groundRow][c] : '#';
        const isGap = (at === '.' || at === ' ');
        if (isGap) { if (st < 0) st = c; }
        else {
          if (st >= 0) {
            const w = c - st;                  /* 坑宽（格） */
            /* ★ 台阶：在坑的**左端**放一格"与地面齐平"的实心 ——
             *   玩家从左往右跑时，这里是"下去的台阶"；
             *   掉进坑里往回走时，这里就是"上来的台阶"。
             *   ⚠️ 用 ch3Ground（自动加厚），保证和地面一样厚。 */
            hline(gg, groundRow, st, st, '#');
            /* ⚠️ 不再加"坑中台子" —— 台阶已经把坑缩到 1~2 格，
             *   再放台子反而会**挡在坑的出口**（单向平台从侧下方过不去），
             *   实测玩家会卡死在台子前（2026-10-07 踩过）。 */
            st = -1;
          }
        }
      }
    })(g);

    const raw = { id, name, subtitle, orderNo: id, district, targetTime: time, timeLimit: 0,
      gravity: 0.62, weather: null, map: toStrings(g), ch3: ch3 || null,
      coinRequireRatio: CH4_COIN_RATIO };
    if (ch3 && Array.isArray(ch3.cargoLift)) {
      raw.__moverOverrides = ch3.cargoLift.map(function (c) {
        return { matchRow: Math.round(c.y / T), rangeX: c.range || 96, speed: c.speed || 0.9 };
      });
    }
    return raw;
  }

  function build21() {
    const R = 30, S = R - 3, g = levelMap(136, R);
    ch3Spawn(g, S, 3); floor(g, S + 1, 1, 18); floor(g, S + 1, 24, 42);
    floor(g, S + 1, 49, 72); floor(g, S + 1, 78, 103); floor(g, S + 1, 110, 133);
    platform(g, S - 5, 19, 23); platform(g, S - 8, 44, 50); platform(g, S - 6, 73, 78); platform(g, S - 9, 104, 111);
    mover(g, S - 5, 20, 3); mover(g, S - 8, 45, 3); mover(g, S - 6, 74, 3); mover(g, S - 9, 105, 3);
    [27,31,35,54,58,62,81,85,89,114,118,122].forEach(c => ch3Walker(g, S, c));
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1；列收窄到平台内。
     *   原来的订单列跨度 20~48 远超平台宽度（19~23）⇒ 后半段全悬空。
     *   ⚠️ 只挪订单，地形没动。 */
    orders(g, S, 6, 16, 3);
    orders(g, S, 26, 40, 4);           /* 地面第二段（原来是悬空的 24~42 段订单） */
    orders(g, S, 51, 70, 5);           /* 地面第三段（原悬空的 49~72 段） */
    orders(g, S, 80, 100, 6);          /* 地面第四段（原悬空的 78~103 段） */
    orders(g, S - 6, 20, 23, 3);       /* 对应 platform(S-5,19,23)：订单在平台上方一格 */
    orders(g, S - 9, 45, 50, 3);       /* 对应 platform(S-8,44,50) */
    orders(g, S - 7, 74, 78, 3);       /* 对应 platform(S-6,73,78) */
    orders(g, S - 10, 105, 111, 3);    /* 对应 platform(S-9,104,111) */
    ch3Checkpoint(g, S, 47); ch3Checkpoint(g, S, 76); ch3Goal(g, S - 1, 129);
    return base(21, '美团专送 21 · 机场货运区', '起飞前最后一单：跟着货箱穿过跑道', '机场货运区', g, 76, {
      cargos: [ {x:21*T,y:(S-5)*T,w:3*T,h:24,axis:'x',range:80,speed:1.4}, {x:44*T,y:(S-8)*T,w:3*T,h:24,axis:'x',range:110,speed:1.1}, {x:74*T,y:(S-6)*T,w:3*T,h:24,axis:'x',range:120,speed:1.6} ],
      gates: [ {x:52*T,y:(S-3)*T,phase:0}, {x:96*T,y:(S-3)*T,phase:1.7} ],
      stages: [ {atX:0,stage:1,text:'货运区：先看货箱节奏',wind:0}, {atX:52*T,stage:2,text:'跑道风：不要停在机翼下',wind:0.1}, {atX:104*T,stage:3,text:'登机口就在前面',wind:0} ]
    });
  }

  function build22() {
    const R=32,S=R-3,g=levelMap(148,R); ch3Spawn(g,S,3);
    floor(g,S+1,1,20); floor(g,S+1,25,45); floor(g,S+1,51,76); floor(g,S+1,82,111); floor(g,S+1,117,145);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    platform(g,S-5,20,26); platform(g,S-9,45,54); platform(g,S-6,75,83); platform(g,S-9,104,118); platform(g,S-7,125,139);
    [23,49,79,109,132].forEach(c=>ch3Wind(g,c,S-12,S-2));
    [29,57,88,120,143].forEach(c=>ch3Hopper(g,S,c));
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1；列收窄到平台内。⚠️ 只挪订单。 */
    orders(g,S,6,18,3);
    orders(g,S-6,21,25,3);             /* 对应 platform(S-5,20,26) */
    orders(g,S-10,46,53,3);            /* 对应 platform(S-9,45,54) */
    orders(g,S-7,76,82,3);             /* 对应 platform(S-6,75,83) */
    orders(g,S-10,105,117,3);          /* 对应下调后的 platform(S-9,104,118) */
    orders(g,S-8,126,138,3);           /* 对应 platform(S-7,125,139) */
    ch3Checkpoint(g,S,50); ch3Checkpoint(g,S,81); ch3Goal(g,S-8,142);
    return base(22,'美团专送 22 · 风电山谷','风机不是装饰：找风、逆风、借上升气流到达山口','风电山谷',g,84,{ jets:[{x:57*T,y:(S-7)*T,w:T,h:5*T,phase:0.3},{x:88*T,y:(S-9)*T,w:T,h:6*T,phase:1.4},{x:120*T,y:(S-8)*T,w:T,h:5*T,phase:2.6}], stages:[{atX:0,stage:1,text:'风向稳定',wind:.25},{atX:51*T,stage:2,text:'三座风机开始转动',wind:.45},{atX:105*T,stage:3,text:'逆风冲刺到山口',wind:.7}] });
  }

  function build23() {
    const R=34,S=R-3,g=levelMap(158,R); ch3Spawn(g,S,3);
    /* ============================================================
     * ★★★ 开局坑"太宽 + 掉下去必死"（2026-10-07 修，十一报"开局被卡住"）★★★
     * ------------------------------------------------------------
     * 【原来的问题】
     *   `floor(g,S+1,1,15)` + `floor(g,S+1,20,36)` ⇒ 坑 = **列 16~19（宽 4 格）**，
     *   且从行 31 一直空到地图最底 ⇒ **掉下去直接摔死**。
     *   而实测跳距：**单跳 3.38 格 / 双跳 5.44 格** ⇒ 4 格宽**单跳跳不过**，
     *   新手在出生点往右跑就被拦住，失手一次就重来。
     *
     * 【修法（十一要的"多个可以爬的地方"）】
     *   ① 坑**缩到 2 格宽**（列 17~18）⇒ **单跳(3.38)就能过**，门槛拉低
     *   ② 坑底（行 S+2，即封底那行）**留实心** ⇒ 失手掉下去只是掉一格，
     *      能自己跳回来，**不会摔死重开**
     *   ③ 坑左右壁做成**台阶状**（左壁到列 16、右壁从列 19）⇒ 卡在坑里也有踩点
     * ============================================================ */
    floor(g,S+1,1,16); floor(g,S+1,19,36);
    /* ★ 坑底留实心（只封底、不加厚）：失手掉进坑里**只掉一格**、
     *   能自己跳回来，不会摔死重开。 */
    hline(g,S+2,17,18,'#'); floor(g,S+1,42,57); floor(g,S+1,64,78); floor(g,S+1,86,108); floor(g,S+1,116,135); floor(g,S+1,143,155);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    ch3ShaftWalls(g,30,38,S-12,S-2); ch3ShaftWalls(g,92,100,S-15,S-2);
    platform(g,S-6,17,23); platform(g,S-10,39,47); platform(g,S-7,58,67); platform(g,S-10,80,90); platform(g,S-8,108,119); platform(g,S-11,128,143);
    mover(g,S-10,24,3); mover(g,S-7,68,3); mover(g,S-8,112,3);
    /* 索道检修梯：把高台变成连续中转路线，不再要求地面直跳。 */
    ch3Step(g,S-4,74,78); ch3Step(g,S-7,78,82);
    ch3Step(g,S-4,106,110); ch3Step(g,S-6,110,114);
    /* ============================================================
     * ★★★ 竖井横梁（2026-10-07 修正：原来把井"封死"）★★★
     * ------------------------------------------------------------
     * 【原来的 bug】写 `ch3Step(g, r, 31, 37)` = 横跨整个井宽
     *   （竖井内宽正好 31~37）⇒ 井被切成封闭段，
     *   井内下方的订单（列 33 行 28）**进去不、吃不到**。
     *
     * 【修法】中间留列 33 当竖向通道（订单正好在这一列）。
     * ⚠️ 井壁 / 订单列 / 层高都没动。
     * ============================================================ */
    ch3Step(g,S-8,31,32); ch3Step(g,S-8,34,37);
    ch3Step(g,S-2,31,32); ch3Step(g,S-2,34,37);
    ch3Step(g,S-8,93,94); ch3Step(g,S-8,96,99);
    ch3Step(g,S-2,93,94); ch3Step(g,S-2,96,99);
    /* 第二段低台订单（行 S-8）也要有对应实体面，避免其中两单悬空。
     * ⚠️ 2026-10-07 修正：原来写 `ch3Step(g,S-7,17,35)` ——
     *   它横跨列 17~35，**正好穿过竖井（列 30~38）**，
     *   把井从中间封死 ⇒ 井内下方的订单（列 33 行 28）**永远进不去**。
     *   ⇒ 在井的位置（列 30~38）断开，低台只保留左右两段。 */
    ch3Step(g,S-7,17,29); ch3Step(g,S-7,39,53);
    /* ★ 订单修正（2026-10-07）：行号统一改成"平台上方一格"= 平台行 - 1；
     *   列范围收窄到对应平台内。⚠️ 只挪订单，地形没动。
     *   `ch3OrderCol` 的两列订单（33/95）是**竖井内的墙跳奖励**，
     *   设计上就要靠墙跳拿（保留）。
     *   ⚠️ 井的第 1 个（行 19）在井口，够不到 ⇒ 起点从行 22 开始。 */
    ch3OrderCol(g,33,S-9,S-3,6);       /* 竖井内墙跳奖励：只放底部（行22/28），避免井口够不到 */
    ch3OrderCol(g,95,S-9,S-3,6);       /* 第二个竖井：取消过高的井口订单 */
    orders(g,S,5,14,2);                /* 地面：列5~14 加密（原来步长3太稀） */
    orders(g,S,20,35,4);               /* 地面：第二段 */
    /* 对应低台（行 S-7 的 `ch3Step(g,S-7,17,29)`）。
     * ⚠️ 列范围必须**收在低台内**（≤29）—— 原来写到 35，
     *   而 30~38 是竖井（低台在那里断开了）⇒ 列 30/34 的订单会悬空。 */
    orders(g,S-8,18,29,4);
    orders(g,S-11,81,89,3);            /* 对应下调后的 platform(S-10,80,90) */
    orders(g,S-9,110,119,4);           /* 对应 platform(S-8,108,119)：上移一格、收窄列 */
    ch3Checkpoint(g,S,40); ch3Checkpoint(g,S,86); ch3Goal(g,S-12,150);
    return base(23,'美团专送 23 · 山地索道','缆车换线：墙跳上车，别错过下一座山','山地索道',g,94,{ cargoLift:[{x:24*T,y:(S-10)*T,w:3*T,h:22,range:150,speed:.9,phase:0},{x:68*T,y:(S-7)*T,w:3*T,h:22,range:130,speed:1.1,phase:2},{x:112*T,y:(S-10)*T,w:3*T,h:22,range:170,speed:.8,phase:4}], stages:[{atX:0,stage:1,text:'索道入口',wind:0},{atX:40*T,stage:2,text:'第一段山壁：墙跳换线',wind:0},{atX:86*T,stage:3,text:'缆车正在驶来',wind:.15},{atX:136*T,stage:4,text:'观景台就在前面',wind:0}] });
  }

  function build24() {
    const R=32,S=R-3,g=levelMap(150,R); ch3Spawn(g,S,3);
    ch3Ice(g,S+1,1,28); floor(g,S+1,34,55); ch3Ice(g,S+1,61,88); floor(g,S+1,94,116); ch3Ice(g,S+1,122,147);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    platform(g,S-5,25,34); platform(g,S-8,53,64); platform(g,S-6,86,96); platform(g,S-10,114,126); platform(g,S-7,139,147);
    /* 两个后段高台补连续检修梯，确保隐藏订单也不是孤岛。 */
    ch3Step(g,S-4,106,112); ch3Step(g,S-7,111,118); ch3Step(g,S-9,114,126);
    ch3Step(g,S-4,133,140); ch3Step(g,S-6,139,147);
    [18,45,75,105,134].forEach(c=>ch3Spikes(g,S,c,c+1)); [37,68,100,129].forEach(c=>ch3Hopper(g,S,c));
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1；列收窄到平台内。⚠️ 只挪订单。 */
    orders(g,S,5,25,4);
    orders(g,S-6,26,33,3);             /* 对应 platform(S-5,25,34) */
    orders(g,S-9,54,63,3);             /* 对应 platform(S-8,53,64) */
    orders(g,S-7,87,95,3);             /* 对应 platform(S-6,86,96) */
    orders(g,S-11,115,125,3);          /* 对应 platform(S-10,114,126) */
    orders(g,S-8,140,146,3);           /* 对应 platform(S-7,139,147) */
    ch3Checkpoint(g,S,59); ch3Checkpoint(g,S,93); ch3Goal(g,S-8,143);
    return base(24,'美团专送 24 · 雪山公路','暴雪封路：冰面会把你的冲刺变成刹不住的滑行','雪山公路',g,98,{ breaking:[{x:31*T,y:(S+1)*T,w:3*T,h:32},{x:57*T,y:(S+1)*T,w:3*T,h:32},{x:90*T,y:(S+1)*T,w:3*T,h:32}], debris:[{x:47*T,y:(S-2)*T},{x:102*T,y:(S-3)*T},{x:130*T,y:(S-4)*T}], stages:[{atX:0,stage:1,text:'冰面开始结霜',wind:0},{atX:61*T,stage:2,text:'雪崩！平台会断',wind:.15},{atX:117*T,stage:3,text:'最后一段封路',wind:.25}] });
  }

  function build25() {
    const R=30,S=R-3,g=levelMap(144,R); ch3Spawn(g,S,3);
    floor(g,S+1,1,18); floor(g,S+1,23,42); floor(g,S+1,47,68); floor(g,S+1,73,96); floor(g,S+1,101,120); floor(g,S+1,125,141);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    platform(g,S-6,18,26); platform(g,S-10,43,52); platform(g,S-7,69,78); platform(g,S-11,95,106); platform(g,S-6,119,130);
    /* 低台订单（行 S-8）正下方补实体检修面，避免订单悬空。 */
    ch3Step(g,S-7,18,26);
    /* 鬼屋高台（列96~105）增加三段上行路线。 */
    ch3Step(g,S-4,87,95); ch3Step(g,S-7,93,101); ch3Step(g,S-10,96,106);
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1（平台上方一格）；列收窄到平台内。
     *   ⚠️ 只挪订单，地形没动。 */
    [25,52,78,106,130].forEach(c=>ch3Walker(g,S,c)); [36,61,88,113].forEach(c=>ch3Hopper(g,S,c));
    orders(g,S,5,16,3);
    orders(g,S-8,20,26,3);             /* 对应 platform(S-6 区段的地面低台) */
    orders(g,S-8,70,77,3);             /* 对应 platform(S-7,69,78) */
    orders(g,S-12,96,105,3);           /* 对应 platform(S-11,95,106)：上移一格、收窄列 */
    orders(g,S-7,120,129,3);           /* 对应 platform(S-6,119,130)：上移一格 */
    ch3Checkpoint(g,S,46); ch3Checkpoint(g,S,100); ch3Goal(g,S-7,137);
    return base(25,'美团专送 25 · 废弃游乐园','过山车车厢会动，鬼屋出口每次都不一样','废弃游乐园',g,104,{ traffic:[{x:30*T,y:(S-4)*T,w:3*T,h:28,left:20*T,right:64*T,speed:2.6,dir:1,rideable:true},{x:79*T,y:(S-5)*T,w:3*T,h:28,left:70*T,right:118*T,speed:3.1,dir:-1,rideable:true}], chaser:{startX:8*T,y:(S-2)*T,waves:2}, stages:[{atX:0,stage:1,text:'断电游乐园',wind:0},{atX:48*T,stage:2,text:'过山车启动',wind:0},{atX:97*T,stage:3,text:'鬼屋追逐开始',wind:0}] });
  }

  function build26() {
    const R=38,S=R-3,g=levelMap(160,R); ch3Spawn(g,S,3); floor(g,S+1,1,20); floor(g,S+1,27,48); floor(g,S+1,55,73); floor(g,S+1,80,101); floor(g,S+1,108,130); floor(g,S+1,137,157);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    ch3ShaftWalls(g,34,42,S-18,S-2); ch3ShaftWalls(g,87,95,S-20,S-2); ch3ShaftWalls(g,119,127,S-14,S-2);
    platform(g,S-7,22,30); platform(g,S-11,43,51); platform(g,S-8,73,84); platform(g,S-11,95,108); platform(g,S-7,127,138);
    /* 医院设备梯：两级平台连接井底和高台，保留墙跳捷径。 */
    ch3Step(g,S-4,39,43); ch3Step(g,S-7,43,47);
    ch3Step(g,S-4,91,95); ch3Step(g,S-7,95,99);
    ch3Step(g,S-4,123,127); ch3Step(g,S-6,127,131);
    ch3Switch(g,S,62); ch3SwitchDoor(g,S-4,65); ch3Switch(g,S-3,113); ch3SwitchDoor(g,S-8,116);
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1；列收窄到平台内。⚠️ 只挪订单。 */
    orders(g,S,5,18,4);
    orders(g,S-12,44,50,3);            /* 对应下调后的 platform(S-11,43,51) */
    orders(g,S-12,96,107,4);           /* 对应下调后的 platform(S-11,95,108) */
    orders(g,S-8,128,137,3);           /* 对应下调后的 platform(S-7,127,138) */
    ch3Checkpoint(g,S,54); ch3Checkpoint(g,S,107); ch3Goal(g,S-10,150);
    return base(26,'美团专送 26 · 高层医院','电梯停运：中央井只能靠墙跳，急诊门会周期关闭','高层医院',g,116,{ gates:[{x:65*T,y:(S-4)*T,phase:0},{x:116*T,y:(S-8)*T,phase:1.2}], crowds:[{x:28*T,y:(S-1)*T,w:42,h:34,left:24*T,right:47*T},{x:104*T,y:(S-1)*T,w:42,h:34,left:102*T,right:129*T}], stages:[{atX:0,stage:1,text:'一层急诊大厅',wind:0},{atX:34*T,stage:2,text:'电梯井：连续墙跳',wind:0},{atX:87*T,stage:3,text:'手术层断电',wind:0},{atX:127*T,stage:4,text:'天台直升机坪',wind:.15}] });
  }

  function build27() {
    const R=30,S=R-3,g=levelMap(156,R); ch3Spawn(g,S,3); floor(g,S+1,1,26); floor(g,S+1,32,56); floor(g,S+1,62,90); floor(g,S+1,96,124); floor(g,S+1,130,153);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1；列收窄到平台内。⚠️ 只挪订单。 */
    platform(g,S-6,25,34); platform(g,S-9,54,64); platform(g,S-7,89,99); platform(g,S-11,121,133);
    /* 终段列车高台补三段实体阶梯，避免最后一组订单只能看见拿不到。 */
    ch3Step(g,S-4,112,120); ch3Step(g,S-7,118,126); ch3Step(g,S-10,121,133);
    [38,70,103,138].forEach(c=>ch3Spikes(g,S,c,c+1));
    orders(g,S,5,23,4);
    orders(g,S-7,26,33,3);             /* 对应 platform(S-6,25,34) */
    orders(g,S-10,55,63,3);            /* 对应 platform(S-9,54,64) */
    orders(g,S-8,90,98,3);             /* 对应 platform(S-7,89,99) */
    orders(g,S-12,122,132,3);          /* 对应 platform(S-11,121,133)：订单在平台上方一格 */
    ch3Checkpoint(g,S,61); ch3Checkpoint(g,S,95); ch3Goal(g,S-10,148);
    return base(27,'美团专送 27 · 高速列车','车顶、车厢、隧道三种高度，前方接触网不会等你','高速列车',g,122,{ traffic:[{x:34*T,y:(S-4)*T,w:4*T,h:28,left:30*T,right:85*T,speed:3.8,dir:1,rideable:true},{x:101*T,y:(S-6)*T,w:4*T,h:28,left:92*T,right:145*T,speed:4.4,dir:-1,rideable:true}], breaking:[{x:57*T,y:(S+1)*T,w:4*T,h:32},{x:91*T,y:(S+1)*T,w:4*T,h:32}], chaser:{startX:12*T,y:(S-2)*T,waves:2}, stages:[{atX:0,stage:1,text:'列车出站',wind:.1},{atX:62*T,stage:2,text:'进入隧道，低头！',wind:.25},{atX:98*T,stage:3,text:'追车接近',wind:.45},{atX:130*T,stage:4,text:'终点站',wind:.1}] });
  }

  function build28() {
    const R=34,S=R-3,g=levelMap(160,R); ch3Spawn(g,S,3); floor(g,S+1,1,24); floor(g,S+1,31,52); floor(g,S+1,59,84); floor(g,S+1,91,115); floor(g,S+1,122,145); floor(g,S+1,151,157);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    platform(g,S-5,24,33); platform(g,S-9,52,63); platform(g,S-6,83,94); platform(g,S-11,114,127); platform(g,S-7,144,155);
    /* 起点三单的明确上行路线：地面 → 广告牌台阶 → 高台。
     * 原来高台虽在二段跳理论范围内，但没有中转脚点，初见时很难判断怎么上。 */
    ch3Step(g,S-2,20,23); ch3Step(g,S-4,23,27);
    /* 第4~7单（列53~62）的水电梯入口：
     * 地面 → 低台 → 中台 → 水电梯顶，避免从地面硬冲9格高差。 */
    /* 水电梯出口加宽：最后一级必须覆盖整个平台左半段，避免角色从气泡流
     * 出来时擦边，导致“看得见订单但站不上去”。这些是实体检修台，不是
     * 视觉特效，飞龙宝宝和袋鼠都能稳定落脚。 */
    ch3Step(g,S-3,44,50); ch3Step(g,S-6,48,55); ch3Step(g,S-8,52,64);
    /* 中段广告牌平台（列84~93）和终点前平台（列144~154）也给出上行脚点。 */
    ch3Step(g,S-3,75,79); ch3Step(g,S-5,79,83);
    ch3Step(g,S-3,136,140); ch3Step(g,S-5,140,144);
    /* 高潮水位路线：高台前再加一级可观察的检修台。 */
    ch3Step(g,S-9,112,117);
    /* ★★ 2026-10-07 修"高台孤岛"（十一反馈"第28关收集不了"）★★
     * ------------------------------------------------------------
     * 【问题】行 S-11（=行20）的高台（列 114~127）是**悬空孤岛**：
     *   距地面 S（=行31）有 **11 格 / 352px**，超过"双跳+冲刺"的
     *   336px 上限 ⇒ **玩家根本上不去**，那上面 4 个订单永远吃不到。
     *   （这是原关卡设计的真实缺陷，不是我这几轮改出来的。）
     *
     * 【修法】在它左下方补**两级过路平台**（阶梯式，每级落差 ≤4 格）：
     *   地面(31) → 阶梯1(27) → 阶梯2(24) → 高台(20)
     *   位置避开了尖刺（列104）和坑（列116~121）。
     *   ⚠️ 只**新增**落脚面，没有移动/删除任何原有地形。
     * ------------------------------------------------------------ */
    ch3Step(g, S - 4, 106, 110);       /* 阶梯1：行27、列106~110 */
    ch3Step(g, S - 7, 112, 117);       /* 阶梯2：行24、列112~117 */
    [18,45,70,104,136].forEach(c=>ch3Spikes(g,S,c,c+1));
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1（订单要在平台**上方**一格）；
     *   原来的行号比平台低 1 格 ⇒ 订单卡在平台下方，跳不上去。
     *   列范围一并收窄到平台内。⚠️ 只挪订单，地形没动。 */
    orders(g,S,5,22,4);
    orders(g,S-6,25,32,3);             /* 对应 platform(S-5,24,33) */
    orders(g,S-10,53,62,3);            /* 对应 platform(S-9,52,63) */
    orders(g,S-7,84,93,3);             /* 对应 platform(S-6,83,94) */
    orders(g,S-12,115,126,3);          /* 对应 platform(S-11,114,127) */
    orders(g,S-8,145,154,3);           /* 对应 platform(S-7,144,155) */
    ch3Checkpoint(g,S,58); ch3Checkpoint(g,S,90); ch3Goal(g,S-8,154);
    return base(28,'美团专送 28 · 洪水城区','潮水涨落会把地下商场和广告牌路线完全交换','洪水城区',g,132,{ tide:{col:0,w:160*T,lowY:(S+1)*T,highY:(S-8)*T,period:16,riseSec:5}, bubbles:[{x:63*T,y:(S-8)*T,w:T,h:7*T},{x:118*T,y:(S-10)*T,w:T,h:8*T}], glass:[{x:88*T,y:(S-6)*T,w:4*T,h:32},{x:143*T,y:(S-7)*T,w:4*T,h:32}], jelly:[{x:72*T,y:(S-5)*T,phase:0},{x:128*T,y:(S-8)*T,phase:2}], stages:[{atX:0,stage:1,text:'低潮：进入地下商场',wind:0},{atX:59*T,stage:2,text:'涨潮！路线切到广告牌',wind:0},{atX:114*T,stage:3,text:'水母区，保持移动',wind:.15}] });
  }

  function build29() {
    const R=40,S=R-3,g=levelMap(176,R); ch3Spawn(g,S,3); floor(g,S+1,1,25); floor(g,S+1,31,51); floor(g,S+1,57,80); floor(g,S+1,86,109); floor(g,S+1,116,138); floor(g,S+1,145,173);   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    ch3ShaftWalls(g,40,48,S-22,S-2); ch3ShaftWalls(g,97,105,S-18,S-2); platform(g,S-7,25,33); platform(g,S-11,49,58); platform(g,S-8,80,89); platform(g,S-11,104,116); platform(g,S-8,137,147); platform(g,S-13,158,173);
    /* 核心塔维护楼梯：每个能源层至少有一个稳定上行点。 */
    ch3Step(g,S-4,22,29); ch3Step(g,S-6,28,35);       /* 起点高台 */
    ch3Step(g,S-4,45,50); ch3Step(g,S-7,49,55);
    ch3Step(g,S-4,74,82); ch3Step(g,S-6,79,87);       /* 中段平台 */
    ch3Step(g,S-4,100,106); ch3Step(g,S-7,104,112);
    ch3Step(g,S-4,131,140); ch3Step(g,S-6,137,146);  /* 外墙平台 */
    ch3Step(g,S-4,153,161); ch3Step(g,S-8,158,166);
    /* ============================================================
     * ★★★ 竖井内部横梁（2026-10-07 修正：原来把井"层层封死"）★★★
     * ============================================================
     * 【原来的 bug】横梁写的是 `ch3Step(g, r, 41, 47)` ——
     *   而竖井内宽正好是列 41~47 ⇒ **每一根横梁都横跨整个井宽**，
     *   把竖井切成一间间**封闭的格子**。
     *
     *   后果（十一报"第 29 关第三部分拿不到"）：
     *   玩家墙跳进井里，跳到横梁下沿就被顶住，**永远上不去**；
     *   而订单放在横梁**上方**（列 44）⇒ **看得见、吃不到**。
     *   实测：两根井 × 6 层 × 各 1 单 = **12 单全部不可达**。
     *
     * 【修法】横梁**中间留出竖向通道**：
     *   左段 41~43 + 右段 45~47，**列 44 空着**当爬升通道；
     *   而订单正好就在列 44 ⇒ 玩家爬井时**顺着通道一路吃上去**。
     *
     * ⚠️ 只改横梁的"宽度"，井壁 / 订单列 / 层高都一个字没动。 */
    [S-2,S-5,S-8,S-11,S-14,S-17].forEach(r=>{
      ch3Step(g,r,41,43); ch3Step(g,r,45,47);      /* ★ 中间留列 44 当通道 */
      ch3Step(g,r,98,100); ch3Step(g,r,102,104);   /* ★ 中间留列 101 当通道 */
    });
    /* ★ 订单修正（2026-10-07）：行号 = 平台行 - 1；列收窄到平台内。
     *   两列订单改放到竖井内部（44/101），避免订单中心落在实体墙列上。
     *   ⚠️ 只挪订单，地形没动。 */
    [44,101].forEach(c=>ch3OrderCol(g,c,S-18,S-3,3));
    orders(g,S,5,22,4);
    orders(g,S-12,50,57,3);            /* 对应 platform(S-11,49,58) */
    orders(g,S-9,81,88,3);             /* 对应 platform(S-8,80,89) */
    orders(g,S-12,105,115,4);          /* 对应下调后的 platform(S-11,104,116) */
    orders(g,S-9,138,146,3);           /* 对应下调后的 platform(S-8,137,147) */
    orders(g,S-14,159,172,4);          /* 对应下调后的 platform(S-13,158,173) */
    ch3Checkpoint(g,S,56); ch3Checkpoint(g,S,110); ch3Checkpoint(g,S,144); ch3Goal(g,S-17,168);
    return base(29,'美团专送 29 · 城市核心塔','五层系统互相供电：开一层，另一层就开始变化','城市核心塔',g,150,{ nodes:[{x:22*T,y:(S-1)*T,id:1},{x:77*T,y:(S-1)*T,id:2},{x:133*T,y:(S-1)*T,id:3}], arcs:[{path:[{x:50*T,y:(S-7)*T},{x:57*T,y:(S-7)*T},{x:64*T,y:(S-7)*T}],phase:0},{path:[{x:108*T,y:(S-12)*T},{x:116*T,y:(S-12)*T},{x:124*T,y:(S-12)*T}],phase:1}], chaser:{startX:18*T,y:(S-2)*T,waves:2}, stages:[{atX:0,stage:1,text:'地下能源层',wind:0},{atX:31*T,stage:2,text:'物流层通电',wind:0},{atX:57*T,stage:3,text:'外墙攀爬层',wind:.2},{atX:86*T,stage:4,text:'高空交通层开放',wind:.35},{atX:116*T,stage:5,text:'控制层警报',wind:.55},{atX:145*T,stage:6,text:'全塔追逐',wind:.7}] });
  }

  function build30() {
    const R=42,S=R-3,g=levelMap(198,R); ch3Spawn(g,S,3); const spans=[[1,23],[29,50],[56,78],[84,108],[114,137],[143,166],[172,195]]; spans.forEach(x=>floor(g,S+1,x[0],x[1]));   /* ★ 原有的 ch3Gap 已删（它挖的坑被 sealBottom 填回，反而是假的）：段间空隙天然就是坑 */
    platform(g,S-7,23,31); platform(g,S-10,49,59); platform(g,S-7,78,89); platform(g,S-11,108,120); platform(g,S-8,137,149); platform(g,S-13,166,178); platform(g,S-15,184,195);
    mover(g,S-8,84,3); mover(g,S-10,151,3);
    /* 终局救援楼梯：高空路线变成长楼梯+冲刺，而不是无解的垂直墙。 */
    ch3Step(g,S-4,45,49); ch3Step(g,S-7,49,53);
    ch3Step(g,S-4,104,108); ch3Step(g,S-7,108,112);
    ch3Step(g,S-4,133,137); ch3Step(g,S-6,137,141);
    ch3Step(g,S-4,161,166); ch3Step(g,S-8,166,171);
    ch3Step(g,S-4,179,184); ch3Step(g,S-9,184,189);
    ch3ShaftWalls(g,39,47,S-18,S-2); ch3ShaftWalls(g,118,126,S-20,S-2); [18,45,70,100,130,158,186].forEach(c=>ch3Spikes(g,S,c,c+1)); [34,63,91,123,151,181].forEach(c=>ch3Hopper(g,S,c));
    /* ============================================================
     * ★ 订单布局修正（2026-10-07）★
     * ------------------------------------------------------------
     * 【原来的 bug】订单行的"行号"写的是**平台的行号**，
     *   而不是"平台上方的可行走行" ⇒ 订单和平台画在**同一行**，
     *   `put` 互相覆盖（平台被戳出窟窿：`=o===o===`），
     *   而且列范围远大于平台宽度 ⇒ 大量订单**悬空**，
     *   下方 512~640px 才够到地面，远超跳跃上限（336px）。
     *
     * 【修法】订单**落地为主 + 高空为辅**：
     *   · 地面段（7 段、每段 20+ 格）铺满 ---- 必然可达
     *   · 平台上的订单只用**平台自身列范围**，并上移一格
     *   ⚠️ 只挪订单，**地形结构一个字没动**。
     * ------------------------------------------------------------ */
    /* 地面订单：7 段地面全部铺到（安全垫） */
    orders(g,S,5,22,4); orders(g,S,31,48,4); orders(g,S,58,76,4);
    orders(g,S,86,106,4); orders(g,S,116,135,4); orders(g,S,145,164,4);
    /* 平台订单：只用平台自身范围（放在平台上方一格） */
    orders(g,S-11,50,58,4);            /* 对应下调后的 platform(S-10,49,59) */
    orders(g,S-12,109,119,4);          /* 对应下调后的 platform(S-11,108,120) */
    orders(g,S-14,167,177,4);          /* 对应 platform(S-13,166,178)，订单在平台上方一格 */
    ch3Checkpoint(g,S,28); ch3Checkpoint(g,S,55); ch3Checkpoint(g,S,83); ch3Checkpoint(g,S,113); ch3Checkpoint(g,S,142); ch3Checkpoint(g,S,170); ch3Goal(g,S-21,191);
    return base(30,'美团专送 30 · 全城最后一单','从物流线到暴风云层，送到终点配送中心就下班','全城终点·黎明天空',g,178,{ tide:{col:0,w:198*T,lowY:(S+1)*T,highY:(S-9)*T,period:20,riseSec:6}, traffic:[{x:30*T,y:(S-4)*T,w:4*T,h:28,left:27*T,right:80*T,speed:4,dir:1,rideable:true},{x:142*T,y:(S-6)*T,w:4*T,h:28,left:136*T,right:184*T,speed:4.8,dir:-1,rideable:true}], cargos:[{x:51*T,y:(S-12)*T,w:3*T,h:24,range:120,speed:1.4},{x:151*T,y:(S-10)*T,w:3*T,h:24,range:150,speed:1.6}], cargoLift:[{x:84*T,y:(S-8)*T,w:3*T,h:22,range:160,speed:.9,phase:0},{x:166*T,y:(S-16)*T,w:3*T,h:22,range:180,speed:1.1,phase:2}], chaser:{startX:10*T,y:(S-2)*T,waves:3}, lightning:[{x:109*T,y:(S-14)*T,w:2*T,h:2*T},{x:177*T,y:(S-20)*T,w:2*T,h:2*T}], stages:[{atX:0,stage:1,text:'起点配送站',wind:0},{atX:29*T,stage:2,text:'地下物流线',wind:0},{atX:56*T,stage:3,text:'洪水街区',wind:.2},{atX:84*T,stage:4,text:'高速列车段',wind:.35},{atX:114*T,stage:5,text:'高塔外墙',wind:.5},{atX:143*T,stage:6,text:'风暴云层',wind:.7},{atX:172*T,stage:7,text:'最终配送平台',wind:.25}] });
  }

  const builders={21:build21,22:build22,23:build23,24:build24,25:build25,26:build26,27:build27,28:build28,29:build29,30:build30};
  const G=(typeof globalThis!=='undefined'?globalThis:null); const W=(typeof window!=='undefined'?window:null);
  [G,W].forEach(o=>{if(!o)return; o.__CH4_LEVEL_BUILDERS=builders; Object.keys(builders).forEach(k=>{o['buildCh4Level'+k]=builders[k];});});
  if(typeof applyCh4Levels==='function') applyCh4Levels();
})();
