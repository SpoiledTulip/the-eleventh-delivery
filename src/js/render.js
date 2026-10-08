/* ============================================================
 * render.js — 渲染层
 * 像素风世界：远景山、云、砖块，全部代码绘制。
 * ============================================================ */

/* ---------------- 背景 ---------------- */

/* ★ 2026-10-06：每关专属背景（bg-theme.js）★
 * ============================================================
 * 十一："每一关不同的关卡要有自己的背景呀，怎么全都是蓝天的"
 *
 * 做法：三个背景函数都先问一次"当前主题"，
 *   然后**只改颜色**，绘制逻辑一行不动 —— 所以：
 *     · 启动画面 / 主菜单（没有关卡）→ 主题=默认蓝天 → **和以前一模一样**
 *     · 游戏内 → 用该关区域的主题色
 *
 * ⚠️ 兜底：bg-theme.js 没加载时（被删了）`bgTheme()` 返回 null，
 *    三个函数就退回原来的硬编码颜色 —— 等于没改过。这是项目规范要求的
 *    "新模块删掉能退回原版"。
 * ============================================================ */
function bgTheme() {
  if (typeof BG_THEME === 'undefined' || !BG_THEME || !BG_THEME.current) return null;
  try { return BG_THEME.current(); } catch (e) { return null; }
}

/* ============================================================
 * ★ 新分层背景是否正在接管画面（2026-10-07）★
 * ============================================================
 * 【为什么要这个判断】
 *   旧的 drawClouds / drawHills 是"每关同一套构图只换颜色"，
 *   新体系（drawLayeredBackground）每关一套独立构图。
 *   两者同时画 = 两层云/两层楼叠一起，而且十一要求
 *   "第 15/17/18 关不能出现云层"会被旧云破坏。
 *   ⇒ 新体系生效时，旧的这两个函数直接返回。
 *
 * 【三条同时成立才算"接管"】
 *   ① bg-draw.js 在（BP 存在）
 *   ② bg-theme 提供 layersFor
 *   ③ **当前这一关**有 layers 配方
 *   ⇒ 所以：删掉 bg-draw.js / 某关没配方 → 自动退回旧体系（等于没改过）。
 * ============================================================ */
function hasLayeredBg() {
  try {
    if (typeof BP === 'undefined' || !BP) return false;
    if (typeof BG_THEME === 'undefined' || !BG_THEME || !BG_THEME.layersFor) return false;
    const lv = (typeof Game !== 'undefined' && Game) ? Game.level : null;
    if (!lv || !lv.district) return false;
    const L = BG_THEME.layersFor(lv.district);
    return !!(L && L.layers);
  } catch (e) { return false; }
}

function drawSky(ctx, cam) {
  const th = bgTheme();
  /* 天空渐变（默认：超级玛丽式的明亮蓝天）
   * 有主题时用主题的三色渐变，否则用原来的固定三色。 */
  const c = th && th.sky ? th.sky : ['#5c94fc', '#8fc4ff', '#c8e4ff'];
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  g.addColorStop(0, c[0]);
  g.addColorStop(0.6, c[1]);
  g.addColorStop(1, c[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawClouds(ctx, cam, t) {
  const th = bgTheme();
  /* ============================================================
   * ★ 2026-10-07：新分层背景接管时**跳过旧的云** ★
   * ============================================================
   * 为什么要跳过：
   *   旧 drawClouds 的云坐标是**写死的 7 个固定位置** —— 每关完全一样。
   *   这正是十一说的"所有关卡都使用相同的云朵位置"。
   *   新体系由 bg-theme 的 `layers.cloud` 配（支持 paint:'none'），
   *   所以旧的要让位，否则两层云叠在一起，而且第 15/17/18 关
   *   （十一明确要求"不能出现云层"）会漏出旧云。
   *
   * ⚠️ 兜底：bg-draw / 配方不存在时，这里照旧画 —— 等于没改过。
   * ============================================================ */
  if (hasLayeredBg()) return;

  const parallax = 0.25;
  ctx.fillStyle = (th && th.cloud) ? th.cloud : 'rgba(255,255,255,0.92)';
  const clouds = [
    { x: 120, y: 90, s: 1.0 }, { x: 520, y: 150, s: 0.75 },
    { x: 940, y: 70, s: 1.15 }, { x: 1400, y: 130, s: 0.9 },
    { x: 1900, y: 95, s: 1.05 }, { x: 2400, y: 145, s: 0.8 },
    { x: 2900, y: 80, s: 1.1 },
  ];
  for (let i = 0; i < clouds.length; i++) {
    const c = clouds[i];
    const x = c.x - cam.x * parallax + Math.sin(t * 0.25 + i) * 8;
    const y = c.y - cam.y * parallax * 0.4;
    drawCloud(ctx, x, y, c.s);
  }
}

function drawCloud(ctx, x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, 26 * s, 0, Math.PI * 2);
  ctx.arc(x + 30 * s, y - 12 * s, 32 * s, 0, Math.PI * 2);
  ctx.arc(x + 68 * s, y, 24 * s, 0, Math.PI * 2);
  ctx.arc(x + 34 * s, y + 12 * s, 26 * s, 0, Math.PI * 2);
  ctx.fill();
}

/* 城市剪影（高楼）—— 给"城区/高架/地下"这类区域用，
 * 替代绿山丘，让夜景/都市主题一眼能认出来。
 * ⚠️ 用**固定种子**生成，所以每次跑同一关楼群一样（不会闪烁）。 */
function drawCitySilhouette(ctx, cam, color, parallax) {
  const offset = -cam.x * parallax;
  ctx.fillStyle = color;
  for (let i = 0; i < 26; i++) {
    /* 伪随机但稳定：用 i 推出来的固定值 */
    const seed = (i * 2654435761) % 1000 / 1000;
    const w = 54 + Math.floor(seed * 70);
    const h = 110 + Math.floor(((i * 40503) % 1000 / 1000) * 190);
    const x = offset + i * 130;
    if (x > CANVAS_W + 200 || x + w < -200) continue;
    const y = CANVAS_H - 60 - h - cam.y * parallax * 0.3;
    ctx.fillRect(x, y, w, h + 60);
    /* 楼顶的小凸起，看起来更像建筑而不是方块 */
    ctx.fillRect(x + w * 0.3, y - 14, w * 0.14, 14);
  }
}

function drawHills(ctx, cam, t) {
  const th = bgTheme();
  /* ★ 2026-10-07：新分层背景接管时跳过旧的山丘/楼群剪影 ★
   * 理由同 drawClouds —— 旧 drawCitySilhouette 是固定 26 栋、i*130 等距，
   * 就是十一说的"同一排高楼剪影"。新体系每关一套独立构图。 */
  if (hasLayeredBg()) return;

  const scale = (th && typeof th.hillScale === 'number') ? th.hillScale : 1;
  const farColor = (th && th.far) ? th.far : '#7fc46b';
  const nearColor = (th && th.near) ? th.near : '#5aa34a';

  const parallax = 0.45;
  const baseY = CANVAS_H - 60 - cam.y * parallax * 0.3;
  const offset = -cam.x * parallax;

  /* 城市主题：用高楼剪影代替山丘（远景 + 近景两层） */
  if (th && th.city) {
    drawCitySilhouette(ctx, cam, farColor, 0.32);
    drawCitySilhouette(ctx, cam, nearColor, 0.55);
    return;
  }

  // 远山（浅色）
  ctx.fillStyle = farColor;
  for (let i = -1; i < 14; i++) {
    const hx = offset + i * 340;
    if (hx > CANVAS_W + 200 || hx < -400) continue;
    ctx.beginPath();
    ctx.moveTo(hx - 200, baseY);
    ctx.quadraticCurveTo(hx, baseY - 220 * scale, hx + 200, baseY);
    ctx.fill();
  }

  // 近山（深色）
  ctx.fillStyle = nearColor;
  for (let i = -1; i < 16; i++) {
    const hx = offset * 1.7 + i * 260;
    if (hx > CANVAS_W + 200 || hx < -300) continue;
    ctx.beginPath();
    ctx.moveTo(hx - 150, baseY + 30);
    ctx.quadraticCurveTo(hx, baseY - 130 * scale, hx + 150, baseY + 30);
    ctx.fill();
  }
}

/* ============================================================
 * ★★★ 分层背景绘制（2026-10-07）★★★
 * ============================================================
 * 把 bg-theme 的"构图配方" + bg-draw 的"笔刷"组合起来画。
 *
 * 【关键设计：为什么读 CH3 的状态】
 *   十一要求"背景不能只是装饰，必须随着关卡事件变化"（要求二十三）：
 *     · 第 13 关 雨势随区域增加、积水独立反光、漏电区灯光闪烁
 *     · 第 15 关 水位变化时背景水面高度变化
 *     · 第 18 关 潮汐上涨时海水覆盖背景低层、鱼群速度随水流变
 *     · 第 19 关 三个供电节点逐个改变背景灯光、城市远景逐步恢复
 *     · 第 20 关 逐阶段切换、追逐时背景加速
 *   ⇒ 所以这里从 CH3 取一份**只读快照**（水位/节点亮灭/追逐/闪电），
 *     喂给 painter —— 背景因此成为"游戏状态的可视化"。
 *
 *   ⚠️ 只读！绝不写 CH3 的任何字段（物理层归 CH3 自己管）。
 *   ⚠️ 取不到就全用默认值，绝不因为"状态没准备好"就不画背景。
 * ============================================================ */
function bgLiveState() {
  /* 默认（无 CH3 时）—— 中性的、不影响画面的值 */
  const st = {
    t: 0, rain: 0, water: 0.5, lit: 0, flash: 0,
    chase: 0, stage: 0, lamp: 5, lampMax: 8,
    traffic: 1, fishSpeed: 1, nodeCount: 0, nodeOn: 0,
  };
  try {
    const lv = Game.level;
    /* ---- 取关卡静态信息（不需要 CH3 也能拿） ---- */
    if (lv) {
      /* 雨：从天气推 —— 暴雨关雨幕最浓 */
      const w = lv.weather || '';
      st.rain = (w === 'rain') ? 0.85 : (w === 'thunder' ? 0.6 : (w === 'wind' ? 0.35 : 0.1));
    }
    /* ---- 取 CH3 运行时状态（有就覆盖） ---- */
    if (typeof CH3 === 'undefined' || !CH3.current) return st;
    if (CH3.active && !CH3.active()) return st;
    const S = CH3.current();
    if (!S) return st;

    st.t = S.t || 0;

    /* ★ 水位（第 15/18 关）→ 归一化成 0~1
     *   背景要"水面高度跟着涨"，所以直接给 painter 水位像素 y。 */
    if (S.water && typeof S.water.y === 'number') {
      st.waterY = S.water.y;
      st.waterCol = S.water.col;
      st.waterW = S.water.w;
      /* 归一化：越高越接近 1（用于"覆盖低层"的程度） */
      st.water = 0.5;
      try {
        const lvh = (Game.level && Game.level.height) || 1200;
        st.water = Math.max(0, Math.min(1, 1 - (S.water.y / lvh)));
      } catch (e) { }
    }

    /* ★ 供电节点（第 19 关）→ lit 0~1
     *   十一："三次供电必须产生三次可见的背景变化"。
     *   ⇒ lit 直接驱动"窗口亮灭密度"和"电缆是否通电"。 */
    if (S.nodes) {
      const total = S.nodes.length || 0;
      let on = 0;
      S.nodes.forEach(function (n) { if (n.on) on++; });
      st.nodeCount = total; st.nodeOn = on;
      st.lit = total ? (on / total) : 0;
    }

    /* ★ 追逐（第 16/20 关）→ chase 0~1（驱动背景加速 + 警报灯）
     *   ⚠️ 预警期也算一半（"背景开始躁动" = 视觉预警的一部分）。 */
    if (S.chaser) {
      st.chase = S.chaser.active ? 1 : (S.chaser.warn > 0 ? 0.55 : 0);
    }
    if (S.drone && S.drone.active) st.chase = Math.max(st.chase, 1);

    /* ★ 闪电（第 20 关）→ flash 0~1（"闪电发生时背景短暂变亮"）
     *   从 S.lightning 里找正在发光的那个，取其强度。 */
    if (S.lightning && S.lightning.length) {
      let best = 0;
      S.lightning.forEach(function (l) {
        if (l.striking && l.flash != null) best = Math.max(best, l.flash);
        else if (l.striking) best = Math.max(best, 1);
        else if (l.charging) best = Math.max(best, 0.25);
      });
      st.flash = best;
    }

    /* ★ 检修灯（第 15 关）→ lamp：逐个亮起
     *   十一："检修灯逐个亮起"。用累计时间推，简单且不会错。 */
    st.lamp = Math.min(st.lampMax, 2 + Math.floor((S.t || 0) / 6));

    /* ★ 车流（第 16 关）→ 追逐开始时远景车流加速 */
    st.traffic = 1 + st.chase * 2.2;

    /* ★ 鱼群速度（第 18 关）→ 随水流变 */
    st.fishSpeed = 1 + st.water * 0.9;

  } catch (e) { /* 状态没准备好就用默认值 —— 背景照常画 */ }
  return st;
}

function drawLayeredBackground(ctx, cam, t) {
  if (typeof BG_THEME === 'undefined' || !BG_THEME || !BG_THEME.layersFor) return;
  if (typeof BP === 'undefined' || !BP) return;          // bg-draw.js 不在 → 退回旧体系
  const lv = Game.level;
  if (!lv || !lv.district) return;

  const L = BG_THEME.layersFor(lv.district);
  if (!L || !L.layers) return;                            // 这关没配方 → 退回旧体系

  const live = bgLiveState();
  live.t = t;
  live.camY = cam.y;
  live.chase = live.chase || 0;
  live.speed = 1 + live.chase * 1.8;                      // 追逐时背景"跑得更快"

  /* 供 painter 里的画布尺寸读取 */
  try { if (typeof window !== 'undefined') { window.CANVAS_W = CANVAS_W; window.CANVAS_H = CANVAS_H; } } catch (e) { }

  /* ---- ① 天空：用配方里的 sky 覆盖（第 20 关按阶段换天） ---- */
  if (L.sky) {
    try {
      const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      g.addColorStop(0, L.sky[0]);
      g.addColorStop(0.6, L.sky[1]);
      g.addColorStop(1, L.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    } catch (e) { }
  }

  /* ---- ② 图层（far → mid → near，远的先画） ---- */
  const order = ['far', 'mid', 'near'];
  for (let i = 0; i < order.length; i++) {
    const layer = L.layers[order[i]];
    if (!layer || !layer.paint) continue;
    const fn = BP[layer.paint];
    if (typeof fn !== 'function') continue;                // 名字找不到 → 跳过这一层
    try {
      fn(ctx, cam, Object.assign({}, layer, live, {
        seedOffset: layer.seedOffset != null ? layer.seedOffset : (100 + i * 37),
      }));
    } catch (e) { /* 单层失败不影响其它层 */ }
  }

  /* ---- ③ 云（'none' 就完全不画 —— 第 15/17/18 关靠这个做到"没有云") ---- */
  if (L.cloud && L.cloud.paint && L.cloud.paint !== 'none') {
    const fn = BP.drawStormCloudLayer;
    if (typeof fn === 'function') {
      try { fn(ctx, cam, Object.assign({}, L.cloud, live)); } catch (e) { }
    }
  }

  /* ---- ④ 地标（每关 1 个专属地标 —— "隐藏标题也能认出是哪一关"靠它） ---- */
  if (L.landmark && L.landmark.paint) {
    const fn = BP[L.landmark.paint];
    if (typeof fn === 'function') {
      /* 地标额外的动态：雨夜招牌闪烁（用 t 做低频闪烁） */
      const led = 0.55 + Math.abs(Math.sin(t * 1.7)) * 0.45;
      try { fn(ctx, cam, Object.assign({}, L.landmark, live, { led: led, t: t })); } catch (e) { }
    }
  }
}

/* ---------------- 地块 ---------------- */
function drawTiles(ctx, lv, cam) {
  const T = lv.tile;

  /* ============================================================
   * ★★ 移动平台（`m` 字符）—— 独立绘制（2026-10-06 修的真 bug）★★
   * ============================================================
   * ⚠️⚠️ 十一的原话："有缆车的功能，但是看不见缆车" —— **完全准确**。
   *
   * 【为什么以前看不见】
   *   `parseLevel` 里 `case 'm'` **只 push 到 `level.movers`**，
   *   **没有 push 到 `level.solids`**。
   *   而下面那个循环遍历的是 `lv.solids` —— 所以移动平台
   *   **从来就没进过绘制循环，一次都没被画出来过**。
   *
   *   它能站、能挡，是因为 `physics.js` 的 `collectSolids()` 会在
   *   **运行时**把 `level.movers` 合并进碰撞列表。
   *   ⇒ 结果就是"**有碰撞、看不见**"：玩家会莫名其妙地
   *     站在半空中的隐形方块上，或者在看不到的障碍前被挡住。
   *
   * 【修法】在遍历 solids **之前**，单独把 `lv.movers` 画一遍。
   *   · 云上索道 → 画成缆车（钢缆+吊箱）
   *   · 其他关卡 → 退回原来的砖块外观（`drawBrick`），
   *     和它作为"实心平台"的碰撞表现一致
   *
   * ⚠️ 两段代码（solids 里的 isMover 分支 / 这里的 movers 循环）
   *    都保留 —— 万一以后有人把 `'m'` 也加进 solids，
   *    这里的循环不会重复画（见下面的去重判断）。
   * ============================================================ */
  if (lv.movers && lv.movers.length) {
    for (let i = 0; i < lv.movers.length; i++) {
      const m = lv.movers[i];
      if (!visible(m, cam, 120)) continue;
      if (!drawMoverSkin(ctx, m, lv)) drawBrick(ctx, m.x, m.y, m.w, m.h);
    }
  }

  for (let i = 0; i < lv.solids.length; i++) {
    const s = lv.solids[i];
    if (!visible(s, cam, 80)) continue;

    // 断裂桥：塌了就不画（留个残影更自然，但先简单处理）
    if (s.isBridge) { drawBridgeTile(ctx, s); continue; }
    /* ★ 移动平台：单独外观（2026-10-06）★
     * ============================================================
     * 十一："第 11 关我没看到缆车"
     * 原因：移动平台以前**没有自己的外观** —— 它混在 lv.solids 里，
     *   走的是 drawBrick()（草地砖，带绿草皮）。
     *   所以"云上索道"的缆车看起来就是一块普通砖头，谁也认不出。
     *
     * 修法：在砖块分支**之前**拦一下 isMover，
     *   有专属外观的关卡（云上索道）画成钢缆 + 吊箱，
     *   其他关卡保持原样（drawBrick）—— 不影响前 10 关的手感与观感。
     * ============================================================ */
    if (s.isMover) {
      if (!drawMoverSkin(ctx, s, lv)) drawBrick(ctx, s.x, s.y, s.w, s.h);
      continue;
    }
    // 可炸墙：炸开后不画
    if (s.destructible) {
      if (s.broken) continue;
      drawDestructibleTile(ctx, s.x, s.y, s.w, s.h);
      continue;
    }
    drawBrick(ctx, s.x, s.y, s.w, s.h);
  }

  // 冰面画在砖块之上（冰面同时也是实心砖，靠覆盖改外观）
  if (lv.ices) {
    for (let i = 0; i < lv.ices.length; i++) {
      const t = lv.ices[i];
      if (!visible(t, cam, 80)) continue;
      drawIce(ctx, t.x, t.y, t.w, t.h);
    }
  }
  for (let i = 0; i < lv.platforms.length; i++) {
    const p = lv.platforms[i];
    if (!visible(p, cam, 80)) continue;
    drawPlatform(ctx, p.x, p.y, p.w, p.h);
  }
  // 传送带（覆盖在砖块上）
  if (lv.conveyors) {
    for (let i = 0; i < lv.conveyors.length; i++) {
      const c = lv.conveyors[i];
      if (!visible(c, cam, 80)) continue;
      drawConveyor(ctx, c);
    }
  }
  for (let i = 0; i < lv.hazards.length; i++) {
    const h = lv.hazards[i];
    if (!visible(h, cam, 80)) continue;
    drawSpikes(ctx, h.x, h.y, h.w, h.h);
  }
}

/* ---------- 移动平台的"专属外观"（2026-10-06 新增）----------
 * ============================================================
 * 背景：移动平台是"免费的通用机关"（第 5 关第一次用，第 8/10/11 关都用），
 *   但一直**没有自己的贴图** —— 混在 solids 里按草地砖画。
 *   在"跨江大桥"那种场合还能勉强当"渡船"，到了"云上索道"就成了
 *   一块莫名其妙的砖头（十一反馈"没看到缆车"）。
 *
 * 做法：按**当前关卡主题**（bg-theme 的 district）分派外观。
 *   主题不认识 → 返回 false → 调用处退回 drawBrick（原样）。
 *   这样"删掉这段就等于没改"，符合项目"新功能独立封装"的规范。
 *
 * ⚠️ 不碰任何物理量：缆车画多大不影响碰撞箱（碰撞算的是 s.x/y/w/h，
 *    钢缆只是画在箱体上方的**装饰**，玩家不会被钢缆挡到）。
 * ============================================================ */
function drawMoverSkin(ctx, s, lv) {
  const th = bgTheme();
  const district = th && th.district ? th.district : '';

  if (district === '云上索道') { drawCableCar(ctx, s); return true; }
  /* 以后要给别的关卡做专属外观，在这里加分支即可。 */
  return false;
}

/* ---------- 缆车（云上索道专用）----------
 * 三段式：上方钢缆 → 吊臂 → 箱体。
 *
 * ⚠️⚠️ 关键约束：**箱体必须严格画在碰撞箱内**（s.x, s.y, s.w, s.h），
 *   钢缆和吊臂画在箱体**上方**（超出 y 的负方向）——
 *   玩家看到的是"吊在索道上的箱体"，但实际站的是箱体顶面，
 *   视觉和手感一致。千万别把箱体画得比碰撞箱下沿更低，
 *   否则会出现"看着站在箱子上、实际悬空"的诡异感。
 * ============================================================ */
function drawCableCar(ctx, s) {
  const x = s.x, y = s.y, w = s.w, h = s.h;
  const cx = x + w / 2;

  /* ---- 1. 钢缆（从屏幕外的高处垂下来，造成"整条索道"的连续感）----
   * ⚠️ 不能真画到屏幕顶 —— 缆车会左右移动，钢缆跟着平移才自然。
   *   这里画从"缆车上方 220px"到"吊臂顶端"的一段。 */
  ctx.save();
  ctx.strokeStyle = 'rgba(70,86,110,0.75)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, y - 220);
  ctx.lineTo(cx, y - 12);
  ctx.stroke();
  // 缆绳高光（细一点、亮一点，做出金属绞线的质感）
  ctx.strokeStyle = 'rgba(180,200,225,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 1, y - 220);
  ctx.lineTo(cx - 1, y - 12);
  ctx.stroke();
  ctx.restore();

  /* ---- 2. 吊臂 + 滑轮（缆车"挂"在索道上的那个点）---- */
  // 滑轮
  ctx.fillStyle = '#5a6b82';
  ctx.beginPath();
  ctx.arc(cx, y - 10, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b9cb3';
  ctx.beginPath();
  ctx.arc(cx, y - 10, 3, 0, Math.PI * 2);
  ctx.fill();
  // 吊臂（两段斜杆，从滑轮分叉到箱体两角，像真实的吊挂结构）
  ctx.strokeStyle = '#4a5a6e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, y - 8);
  ctx.lineTo(x + w * 0.22, y + 2);
  ctx.moveTo(cx, y - 8);
  ctx.lineTo(x + w * 0.78, y + 2);
  ctx.stroke();

  /* ---- 3. 箱体（★ 严格画在碰撞箱内）---- */
  // 箱体主体（暖红，和"美团专送"的配色呼应，在蓝天白云下非常显眼）
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(x, y, w, h);
  // 侧面亮部（左浅右深，做出立体感）
  ctx.fillStyle = '#e05545';
  ctx.fillRect(x, y, w, 6);
  ctx.fillStyle = '#922b21';
  ctx.fillRect(x, y + h - 5, w, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x + 2, y + 6, w - 4, 4);

  // 箱窗（一格玻璃，让箱子不空洞）
  ctx.fillStyle = '#bfe4f5';
  ctx.fillRect(x + 5, y + 8, w - 10, h - 17);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x + 6, y + 9, w - 12, 3);
  // 窗框
  ctx.strokeStyle = '#7d1f16';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 5, y + 8, w - 10, h - 17);

  // 箱体两侧的竖边（金属包边）
  ctx.fillStyle = '#7d1f16';
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);

  // 底部挂钩（小细节，暗示"这是个吊箱"）
  ctx.fillStyle = '#4a5a6e';
  ctx.fillRect(cx - 2, y + h, 4, 4);
}


/* ---------- 断裂桥 ----------
 * 外观：木色板 + 钉子 + 随着倒计时越来越密的裂纹。
 * 正在震的时候整块砖左右抖，视觉上直接告诉玩家"要塌了"。
 * 用木色是为了和灰色砖块区分开 —— 一眼就知道这不是普通地板。 */
function drawBridgeTile(ctx, s) {
  // 找到对应的桥状态
  let st = null;
  const lv = Game.level;
  if (lv && lv.bridges) {
    for (let i = 0; i < lv.bridges.length; i++) {
      if (lv.bridges[i].x === s.x && lv.bridges[i].y === s.y) { st = lv.bridges[i]; break; }
    }
  }
  if (st && st.gone) return;

  let ox = 0, oy = 0;
  if (st && st.pressed && !st.gone) {
    const mag = st.shake * 2.6;
    ox = (Math.random() - 0.5) * mag;
    oy = (Math.random() - 0.5) * mag;
  }

  const x = s.x + ox, y = s.y + oy;
  const w = s.w, h = s.h;

  // 木色板身
  ctx.fillStyle = '#7a5330';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#a87245';
  ctx.fillRect(x, y, w, h - 6);
  ctx.fillStyle = '#c08a55';
  ctx.fillRect(x, y, w, 4);
  // 木纹
  ctx.fillStyle = 'rgba(90,60,34,0.5)';
  ctx.fillRect(x, y + 11, w, 2);
  ctx.fillRect(x, y + 21, w, 2);
  // 两端的钉子
  ctx.fillStyle = '#4a3a28';
  ctx.fillRect(x + 5, y + 6, 3, 3);
  ctx.fillRect(x + w - 8, y + 6, 3, 3);

  // 裂纹：随倒计时推进越来越多
  if (st && st.pressed && !st.gone) {
    const t = 1 - st.timer / CONFIG.BRIDGE_DELAY;   // 0 → 1
    ctx.strokeStyle = 'rgba(30,18,8,0.85)';
    ctx.lineWidth = 2;
    const cracks = Math.floor(t * 5);
    for (let i = 0; i < cracks; i++) {
      const seed = i * 37 % 20;
      ctx.beginPath();
      ctx.moveTo(x + 4 + seed, y + 2);
      ctx.lineTo(x + 8 + seed * 0.6, y + h - 3);
      ctx.stroke();
    }
    // 快塌时整块泛红警告
    if (t > 0.6) {
      ctx.fillStyle = 'rgba(255,60,40,' + ((t - 0.6) * 0.7).toFixed(2) + ')';
      ctx.fillRect(x, y, w, h);
    }
  }
}

/* ---------- 可炸墙 ----------
 * 深色石块 + 明显裂缝 + 一点红色暗示"可以炸"。
 * 关键是让玩家一眼看出"这块和普通砖不一样"。 */
function drawDestructibleTile(ctx, x, y, w, h) {
  ctx.fillStyle = '#5a5a66';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#787888';
  ctx.fillRect(x, y, w, h - 5);
  ctx.fillStyle = '#8f8fa2';
  ctx.fillRect(x, y, w, 4);

  // 裂缝：一条从中间劈开的锯齿
  ctx.strokeStyle = 'rgba(24,24,30,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y + 1);
  ctx.lineTo(x + w * 0.35, y + h * 0.35);
  ctx.lineTo(x + w * 0.62, y + h * 0.6);
  ctx.lineTo(x + w * 0.42, y + h - 1);
  ctx.stroke();

  // 四角红色警示点（告诉玩家"这块是特殊的"）
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(x + 3, y + 3, 3, 3);
  ctx.fillRect(x + w - 6, y + 3, 3, 3);
  ctx.fillRect(x + 3, y + h - 6, 3, 3);
  ctx.fillRect(x + w - 6, y + h - 6, 3, 3);
}

/* ---------- 冰面 ---------- */
function drawIce(ctx, x, y, w, h) {
  // 浅蓝冰体
  ctx.fillStyle = '#a8dcf0';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#c9ecf9';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 6);
  // 冰面高光条
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x, y, w, 4);
  // 斜向裂纹，让它一眼看出是冰不是水
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.25, y + h * 0.35);
  ctx.lineTo(x + w * 0.45, y + h * 0.78);
  ctx.moveTo(x + w * 0.7, y + h * 0.3);
  ctx.lineTo(x + w * 0.85, y + h * 0.7);
  ctx.stroke();
  // 底部深色边（厚度感）
  ctx.fillStyle = '#79bcd6';
  ctx.fillRect(x, y + h - 3, w, 3);
}

/* ---------- 传送带 ---------- */
function drawConveyor(ctx, c) {
  // 带体
  ctx.fillStyle = '#3a4250';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.fillStyle = '#4e5868';
  ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 4);

  // 滚动的斜条纹（用 scroll 相位做位移，形成"在动"的感觉）
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x + 1, c.y + 1, c.w - 2, c.h - 4);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 4;
  const step = 11;
  // 相位取模，保证循环连续
  const off = ((c.scroll * step) % step + step) % step;
  for (let bx = c.x - step * 2 + off; bx < c.x + c.w + step; bx += step) {
    ctx.beginPath();
    ctx.moveTo(bx, c.y + c.h);
    ctx.lineTo(bx + 8, c.y);
    ctx.stroke();
  }
  ctx.restore();

  // 方向箭头（更直观）
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2 - 1;
  ctx.fillStyle = 'rgba(124,255,156,0.9)';
  ctx.beginPath();
  if (c.dir > 0) {
    ctx.moveTo(cx + 7, cy);
    ctx.lineTo(cx - 5, cy - 5);
    ctx.lineTo(cx - 5, cy + 5);
  } else {
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx + 5, cy - 5);
    ctx.lineTo(cx + 5, cy + 5);
  }
  ctx.closePath();
  ctx.fill();

  // 顶面高光
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(c.x, c.y, c.w, 2);
}

/* ---------- 弹簧板 ---------- */
function drawSprings(ctx, lv, cam) {
  if (!lv.springs) return;
  for (let i = 0; i < lv.springs.length; i++) {
    const s = lv.springs[i];
    if (!visible(s, cam, 80)) continue;
    // compress: 1 = 压到底, 0 = 完全弹起
    const squish = s.compress * 10;        // 压下去多少像素
    const top = s.y + squish;

    // 底座
    ctx.fillStyle = '#5a5a68';
    ctx.fillRect(s.x + 2, s.y + s.h - 8, s.w - 4, 8);

    // 弹簧圈（压得越狠，圈越扁）
    ctx.strokeStyle = '#c8d2dc';
    ctx.lineWidth = 2.5;
    const coils = 3;
    const coilH = (s.h - 14) / coils;
    for (let k = 0; k < coils; k++) {
      const yy = s.y + s.h - 10 - k * coilH;
      const halfW = (s.w - 8) / 2 * (1 - k * 0.12);
      ctx.beginPath();
      ctx.moveTo(s.x + s.w / 2 - halfW, yy - coilH * 0.5);
      ctx.lineTo(s.x + s.w / 2 + halfW, yy - coilH * 0.5 - 3);
      ctx.stroke();
    }

    // 顶板（被压时往下）
    ctx.fillStyle = '#e04a4a';
    ctx.fillRect(s.x + 1, top, s.w - 2, 7);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(s.x + 1, top, s.w - 2, 3);

    // 刚弹起时闪一下白光
    if (s.compress > 0.55) {
      ctx.save();
      ctx.globalAlpha = (s.compress - 0.55) * 1.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y - 8, s.w, s.h + 8);
      ctx.restore();
    }

    /* 单人补偿弹簧：加一个黄色"单人"标记。
     * 目的：让单机玩家知道"这块弹簧是特意给你补的"，
     * 不然会觉得"为什么这里凭空有块弹簧、双人玩时就没了"。 */
    if (s.singleOnly) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,209,0,0.9)';
      ctx.fillRect(s.x + s.w / 2 - 9, s.y - 15, 18, 11);
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('单人', s.x + s.w / 2, s.y - 6);
      ctx.restore();
    }
  }
}

function drawBrick(ctx, x, y, w, h) {
  // 草地砖：顶部草，下面土
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#a06a34';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  // 砖纹
  ctx.fillStyle = '#7a4d24';
  ctx.fillRect(x, y + h * 0.5 - 1, w, 2);
  ctx.fillRect(x + w * 0.5 - 1, y, 2, h * 0.5);
  ctx.fillRect(x + w * 0.25 - 1, y + h * 0.5, 2, h * 0.5);
  ctx.fillRect(x + w * 0.75 - 1, y + h * 0.5, 2, h * 0.5);
  // 顶部草皮
  ctx.fillStyle = '#5cb85c';
  ctx.fillRect(x, y, w, 7);
  ctx.fillStyle = '#7ed17e';
  ctx.fillRect(x, y, w, 3);
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(x + 2, y + 8, w - 4, 3);
}

function drawPlatform(ctx, x, y, w, h) {
  ctx.fillStyle = '#c98a3c';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e0a856';
  ctx.fillRect(x, y, w, 4);
  ctx.fillStyle = '#8a5a20';
  ctx.fillRect(x, y + h - 2, w, 2);
}

function drawSpikes(ctx, x, y, w, h) {
  const n = Math.max(1, Math.floor(w / 8));
  const sw = w / n;
  ctx.fillStyle = '#9aa4b0';
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * sw, y + h);
    ctx.lineTo(x + i * sw + sw / 2, y);
    ctx.lineTo(x + (i + 1) * sw, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#c8d2dc';
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * sw + sw / 2, y);
    ctx.lineTo(x + i * sw + sw * 0.72, y + h);
    ctx.lineTo(x + (i + 1) * sw, y + h);
    ctx.closePath();
    ctx.fill();
  }
}

/* ---------------- 机关 ---------------- */
/* ============================================================
 * ★★ 作者彩蛋：踏板 + 二维码卡片（2026-10-06）★★
 * ============================================================
 * 十一的需求：第 11 关起点左侧有块"踩踩看"的板子，
 * 踩住就浮现作者的微信二维码（配一句"可以加作者微信提出来鸭"）。
 *
 * ⚠️⚠️ 这个函数**必须在 `ctx.translate(-cam.x, -cam.y)` 之后调用**
 *    （见 render() 里 dispatch 的地方）。
 *    这样画出来的是**世界坐标** —— 卡片会跟着地图一起滚动。
 *    ❌ 千万别挪到 drawHUD() 里：那是屏幕坐标，
 *       卡片会固定在屏幕上，玩家跑远了卡片还赖着不走，很怪。
 *       （这是文档第三节的"坑 3"。）
 *
 * ⚠️ 卡片画在**玩家之前**（调用点已经保证了）：否则玩家走到卡片前
 *    会被卡片盖住。
 *
 * ⚠️ 这个彩蛋**不存任何状态**：`pressed` 每帧由 game.js 重算，
 *    退出关卡数据就重置，所以每次进关都能重新踩（十一要的"可反复触发"）。
 * ============================================================ */
function drawEggPads(ctx, lv, t) {
  if (!lv.eggPads || !lv.eggPads.length) return;

  for (let i = 0; i < lv.eggPads.length; i++) {
    const pad = lv.eggPads[i];
    if (!visible(pad, { x: 0, y: 0 }, 0)) {
      /* 屏幕外也还要判断，因为"站在上面"的判定在 game.js，
       * 这里只是不画。用整个地图当可视区更简单：
       * 直接跳过 visible 判断（踏板只有一块，开销可忽略）。 */
    }
    drawEggPad(ctx, pad, t);
    if (pad.pressed) drawEggCard(ctx, pad, t);
  }
}

/* ---------- 踏板本体 ----------
 * 视觉要求（十一）："和普通地砖颜色不同的踏板"。
 *
 * 设计取舍：要**看得出来不一样**，但又要**隐晦**（是彩蛋，不是路标）。
 *   · 用暖金色（呼应美团黄），和普通的土黄地砖拉开色相
 *   · 加一圈细描边 + 中间一个小圆点，像"地上刻了个记号"
 *   · 呼吸微光：不刺眼，但会动，扫过去一眼能注意到
 */
function drawEggPad(ctx, pad, t) {
  const x = pad.x, y = pad.y, w = pad.w, h = pad.h;
  const breathe = 0.5 + 0.5 * Math.sin(t * 2.2);   // 0~1 缓慢呼吸

  ctx.save();

  /* 底座阴影（让它看起来"嵌在地上"） */
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x - 1, y + h, w + 2, 3);

  /* 板面：暖金渐变 */
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, pad.pressed ? '#ffe680' : '#e8b53c');
  g.addColorStop(1, pad.pressed ? '#e0a520' : '#b8862a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  /* 顶面高光 */
  ctx.fillStyle = 'rgba(255,255,255,' + (0.28 + 0.22 * breathe).toFixed(2) + ')';
  ctx.fillRect(x, y, w, 2);

  /* 细描边（"刻痕"感） */
  ctx.strokeStyle = 'rgba(90,60,10,' + (0.45 + 0.3 * breathe).toFixed(2) + ')';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  /* 中间小圆点（踩住时变大变亮） */
  const cx = x + w / 2, cy = y + h / 2;
  const r = pad.pressed ? 3.4 : (2 + 1.2 * breathe);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = pad.pressed ? '#fff6c8' : 'rgba(255,240,180,' + (0.55 + 0.35 * breathe).toFixed(2) + ')';
  ctx.fill();

  /* 踩住时的外圈光晕 */
  if (pad.pressed) {
    ctx.globalAlpha = 0.30 + 0.15 * breathe;
    ctx.beginPath();
    ctx.arc(cx, cy, 16 + 3 * breathe, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe066';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/* ---------- 二维码卡片 ----------
 * 尺寸 / 位置（定稿，不要改）：
 *   · 卡片 130 × 192（EGG_QR_W / EGG_QR_H）
 *   · 贴在**踏板上方约 40px**
 *
 * ⚠️ 卡片位置要考虑"以后手机虚拟按键在底部"（红线）：
 *    卡片画在踏板上方 = 画面**中部**（不是底部），
 *    以后手机上加了虚拟按键也不会被挡住。
 *
 * ⚠️ 边界钳制：踏板在 col2（靠地图左边缘），
 *    如果照"踏板中心"算，卡片左边缘会跑到 x<0（出界看不见）。
 *    ⇒ 这里把卡片 x **钳进地图范围内**（并留 8px 边距）。
 */
function drawEggCard(ctx, pad, t) {
  let W = 130, H = 192;
  /* 从 egg.js 读真实尺寸（换二维码时高度会自动变）
   * ⚠️ typeof 保护 —— egg.js 不在时退回上面写死的默认值。 */
  try {
    if (typeof EGG_QR_W === 'number') W = EGG_QR_W;
    if (typeof EGG_QR_H === 'number') H = EGG_QR_H;
  } catch (e) { /* 用默认值 */ }

  /* ---- 位置：踏板上方 40px，水平居中于踏板 ---- */
  const gapAbove = 40;
  let cx = pad.x + pad.w / 2 - W / 2;
  let cy = pad.y - gapAbove - H;

  /* ---- 边界钳制（水平）----
   * 地图宽 = lv.width，从 0 到 lv.width。
   * 卡片不能被裁到地图外面去（那样就看不全了）。 */
  const mapW = (Game.level && Game.level.width) ? Game.level.width : (88 * 32);
  const MARGIN = 8;
  if (cx < MARGIN) cx = MARGIN;
  if (cx + W > mapW - MARGIN) cx = mapW - MARGIN - W;

  /* ---- 边界钳制（垂直）----
   * 卡片不能跑到地图上边界外面（第 11 关起点在行23，
   * 卡片高 192px 顶到行 23*32-40-192 = 504，没出界）；
   * 但为了稳妥还是钳一下（以后换关卡也不会飘出去）。 */
  if (cy < 0) cy = 0;

  /* ---- 浮起动画（踩住的瞬间轻微上浮，别太跳）----
   * 用 t 做个很轻的上下浮动，让卡片"活"着。 */
  const floatY = Math.sin(t * 2.0) * 2.5;
  cy += floatY;

  ctx.save();

  /* ---- 卡片阴影 ---- */
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(cx + 3, cy + 4, W, H);

  /* ---- 卡片底（白纸 + 圆角感的描边）---- */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx, cy, W, H);

  /* 外描边（用暖金，和踏板呼应） */
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx + 1, cy + 1, W - 2, H - 2);
  /* 内描边（细，做出"相框"层次） */
  ctx.strokeStyle = 'rgba(201,162,39,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 4, cy + 4, W - 8, H - 8);

  /* ---- 图片区（留 7px 内边距）---- */
  const padImg = 7;
  const ix = cx + padImg, iy = cy + padImg;
  const iw = W - padImg * 2, ih = H - padImg * 2;

  let drew = false;
  try {
    if (typeof eggQrImage === 'function' && typeof eggQrReady === 'function') {
      const img = eggQrImage();
      if (img && eggQrReady() && img.naturalWidth > 0) {
        ctx.drawImage(img, ix, iy, iw, ih);
        drew = true;
      }
    }
  } catch (e) { drew = false; }

  /* ⚠️ 图片还没解码好时画个占位（避免"踩了没反应"的错觉）——
   * 正常情况下 base64 在本地、解码是瞬间的，几乎看不到占位。
   * 但单文件版第一次打开、或弱设备上可能有一两帧延迟。 */
  if (!drew) {
    ctx.fillStyle = '#f2f2f4';
    ctx.fillRect(ix, iy, iw, ih);
    ctx.strokeStyle = '#d8d8de';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < iw; gx += 10) {
      for (let gy = 0; gy < ih; gy += 10) {
        if (((gx / 10 | 0) + (gy / 10 | 0)) % 2 === 0) {
          ctx.fillStyle = '#e6e6ea';
          ctx.fillRect(ix + gx, iy + gy, 10, 10);
        }
      }
    }
    ctx.fillStyle = '#8a8a95';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('二维码加载中…', ix + iw / 2, iy + ih / 2);
    ctx.textAlign = 'left';
  }

  /* ---- 卡片顶部小标签："作者的微信" ---- */
  ctx.fillStyle = '#7a5c10';
  ctx.font = 'bold 10px ui-monospace, Consolas, "Microsoft YaHei", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('扫码加作者微信', cx + W / 2, cy + H - 8);
  ctx.textAlign = 'left';

  ctx.restore();
}

/* ============================================================
 * ★ 进关提示：左下角飘一行小字（2026-10-06）★
 * ============================================================
 * 「左边那块板子，踩踩看？」
 *
 * ⚠️ 这是**屏幕坐标**（画在 HUD 层），因为它不跟地图走 ——
 *    只是"刚进关时的一次性引导"。
 *
 * ⚠️⚠️ 和"踩住时的那句大字"是**两回事**（别搞混）：
 *    · 这句 = 引导语，进关飘 4 秒就没了（EGG_HINT_FRAMES = 240 帧）
 *    · 那句大字 = 踩住时显示，复用 Game.message（见 game.js 的续命逻辑）
 * ============================================================ */
function drawEggHint(ctx, lv) {
  /* 只在**有彩蛋踏板的关卡**显示（目前只有第 11 关） */
  if (!lv.eggPads || !lv.eggPads.length) return;
  if (typeof EGG_HINT === 'undefined' || typeof EGG_HINT_FRAMES === 'undefined') return;

  /* 这次进关已经过了多少帧（用关卡计时，换关会归零）
   * ⚠️ 用 Game.eggHintTimer 作为"本关已显示帧数"，在 game.js 里递增。
   *    这里读它算淡出。 */
  const elapsed = Game.eggHintTimer || 0;
  if (elapsed >= EGG_HINT_FRAMES) return;

  /* 淡入 20 帧 / 淡出 40 帧，中间全亮 */
  let alpha = 1;
  if (elapsed < 20) {
    alpha = elapsed / 20;
  } else if (elapsed > EGG_HINT_FRAMES - 40) {
    alpha = Math.max(0, (EGG_HINT_FRAMES - elapsed) / 40);
  }
  if (alpha <= 0) return;

  /* 位置：左下角。⚠️ 要避开"以后手机虚拟按键在底部"（红线）——
   * 所以往上抬到 y = CANVAS_H - 96（虚拟手柄大约占底部 90px）。 */
  const x = 18;
  const y = CANVAS_H - 96;
  const txt = EGG_HINT;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.font = '13px ui-monospace, Consolas, "Microsoft YaHei", monospace';
  const tw = ctx.measureText(txt).width;

  /* 底衬（半透明黑，保证任何背景下都看得清） */
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  const bx = x - 8, by = y - 15, bw = tw + 16, bh = 22;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(255,209,0,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

  /* 文字（暖白，带一点黄，呼应彩蛋的金色） */
  ctx.fillStyle = '#ffeeb0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, x, y - 4);

  ctx.restore();
}

function drawButtons(ctx, lv) {
  for (let i = 0; i < lv.buttons.length; i++) {
    const b = lv.buttons[i];
    const col = b.color === 'Y' ? '#f7c948' : '#ff9a3c';
    const colD = b.color === 'Y' ? '#c99a14' : '#c96a14';
    const off = b.pressed ? b.h * 0.6 : 0;
    // 底座
    ctx.fillStyle = '#5a5a66';
    ctx.fillRect(b.x - 2, b.y + b.h, b.w + 4, 5);
    // 按钮
    ctx.fillStyle = colD;
    ctx.fillRect(b.x, b.y + off + 3, b.w, b.h);
    ctx.fillStyle = col;
    ctx.fillRect(b.x, b.y + off, b.w, b.h * 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(b.x + 3, b.y + off + 2, b.w - 6, 3);
    // 发光
    if (b.pressed) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawDoors(ctx, lv) {
  for (let i = 0; i < lv.doors.length; i++) {
    const d = lv.doors[i];
    const open = d.openAmount;
    // 门框
    ctx.fillStyle = '#4a4a58';
    ctx.fillRect(d.x - 3, d.y - 4, d.w + 6, d.h + 4);
    // 门板（往上缩）
    const visibleH = d.h * (1 - open);
    if (visibleH > 1) {
      ctx.fillStyle = '#8a6a3c';
      ctx.fillRect(d.x, d.y + d.h * open, d.w, visibleH);
      ctx.fillStyle = '#a8865a';
      ctx.fillRect(d.x + 3, d.y + d.h * open + 3, d.w - 6, visibleH - 6);
      ctx.fillStyle = '#5a4428';
      ctx.fillRect(d.x, d.y + d.h * open + visibleH - 3, d.w, 3);
    }
    if (open > 0.4) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#ffe89a';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.restore();
    }
  }
}

function drawCheckpoints(ctx, lv, t) {
  for (let i = 0; i < lv.checkpoints.length; i++) {
    const cp = lv.checkpoints[i];
    // 旗杆
    ctx.fillStyle = '#c0c8d0';
    ctx.fillRect(cp.x + 14, cp.y - 18, 4, cp.h + 18);
    // 旗面
    const col = cp.on ? '#5cd65c' : '#b0b8c0';
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cp.x + 18, cp.y - 18);
    ctx.lineTo(cp.x + 18 + 20, cp.y - 10 + Math.sin(t * 3) * 2);
    ctx.lineTo(cp.x + 18, cp.y - 2);
    ctx.closePath();
    ctx.fill();
    if (cp.on) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(t * 5) * 0.12;
      ctx.fillStyle = '#5cd65c';
      ctx.beginPath();
      ctx.arc(cp.x + 16, cp.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ============================================================
 * ★ 会点头的收餐人（2026-10-06 十一要求）★
 * ============================================================
 * 十一的原话：
 *   "有些概率在房子送达订单那里会刷新会点头的收餐人，
 *    送达时，收餐人的话会机械的点一下头。"
 *
 * 【为什么好笑】
 *   一个抽象的小人站在门洞里，收到餐之后**机械地点一下头** ——
 *   没有台词、没有表情、没有多余动作，就是个 NPC 式的点头。
 *   这个"机械"是关键：越僵硬越好笑（参考游戏里那些面无表情的 NPC）。
 *
 * 【有概率刷新 ≠ 随机出现**
 *   ⚠️ 必须是**按关卡固定**的（同一关每次都一样），不能每帧随机 ——
 *      否则玩家重进同一关会发现"收餐人时有时无"，像 bug。
 *   ⇒ 用 `goal.x` 做种子算一个稳定哈希：某些关有收餐人，某些关没有。
 *      这样"有概率刷新"的意思变成"**不是每关都有**"，
 *      玩家玩到某关发现有个人站在门口，才会有惊喜感。
 *
 * 【点头的时机】
 *   只在"送达且订单达标"（active）之后才点头 ——
 *   没送到就点头会很怪。点头是一个循环的两段动画：
 *   抬头 0.15 秒 → 低头 0.35 秒 → 停一下 → 再来。
 *
 * ------------------------------------------------------------
 * ★ 2026-10-07 十一新要求：朝向 + 说话 ★
 * ------------------------------------------------------------
 *   ① **朝向骑手**（原来贴图侧身固定朝右 ⇒ 看着像背对玩家）
 *      ⇒ 按骑手在哪边翻转整张图（见 receiver-talk.js 的 facingSign）
 *   ② **收到外卖后说 10 秒话**
 *      ⇒ 由 drawReceiverSpeech 画气泡（台词表在 receiver-talk.js）
 *
 * @param ctx     画布
 * @param cx      门洞中心 x
 * @param baseY   地面 y（脚底）
 * @param t       全局时间（秒）
 * @param active  是否已送达（送达后才点头）
 * @param seed    稳定随机种子（用 goal.x）
 * ============================================================ */
function drawReceiver(ctx, cx, baseY, t, active, seed) {
  /* ---- 稳定哈希：决定"这一关有没有收餐人" ---- */
  const h = (function (n) {
    let x = Math.abs(Math.floor(n)) || 0;
    x = (x * 2654435761) % 2147483647;      // Knuth 乘法哈希
    return x / 2147483647;                   // 0~1
  })(seed);
  /* 约 2/3 的关卡有收餐人（"有概率刷新"） */
  if (h >= 0.66) return;

  const T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;

  /* ============================================================
   * ★ 朝向（2026-10-07 十一要求）★
   * ============================================================
   * receiver.png 是**侧身**贴图，原图朝右。而它固定站在门洞里，
   * 玩家（骑手）多半从左边跑过来 ⇒ 看到的是它的右侧面，像背对。
   *
   * ⇒ 按骑手位置翻转：骑手在左 → `ctx.scale(-1, 1)` 让它朝左。
   *   ⚠️ 必须**在画图之前 translate 到 cx 再 scale**，
   *     否则翻转会以画布原点为中心，人直接飞到屏幕另一头。
   *   ⚠️ 翻转后**所有 x 偏移都要跟着反号**（气泡锚点、外卖袋位置）。
   *      这就是为什么下面用 `face` 变量统一控制，而不是各写各的。 */
  let face = 1;
  try {
    if (typeof RECEIVER_TALK !== 'undefined' && RECEIVER_TALK.facingSign) {
      const rx = RECEIVER_TALK.riderToFace(Game && Game.players, cx);
      face = RECEIVER_TALK.facingSign(rx, cx);
    }
  } catch (e) { face = 1; }

  /* ============================================================
   * ★ 优先用 AI 生成的贴图（2026-10-06）★
   * ============================================================
   * 有图就用图（好看得多），没图（加载失败/超时）退回下面的代码绘制。
   * ⚠️ 两条路径**共用同一套点头逻辑** —— 不能因为换了图就不点头了。
   *    所以点头角度 `nodAng` 先算好，两种画法都用它。
   * ============================================================ */
  const sprite = (typeof getDecorImage === 'function') ? getDecorImage('receiver') : null;

  /* ---- 点头动画 ---- *
   * nod: 0 = 正立，1 = 低到最低（用负角度表示"往下点头"）*/
  let nod = 0;
  if (active) {
    const ph = (t % 1.6);
    if (ph < 0.15) nod = ph / 0.15;
    else if (ph < 0.5) nod = 1 - (ph - 0.15) / 0.35;
    else nod = 0;
  }

  if (sprite) {
    /* ---- 用贴图画：整张图绕"脖子"轻微旋转 = 点头 ---- */
    const drawH = T * 2.3;                       // 显示高度（比门洞矮一点）
    const scale = drawH / sprite.img.height;
    const drawW = sprite.img.width * scale;
    const footY = baseY - 2;

    /* 旋转支点设在"身体上部"（约 62% 高度处），这样点头是从脖子转，
     * 而不是整个身子在转（整个身子转看起来像摔倒）。 */
    const pivotX = cx;
    const pivotY = footY - drawH * 0.62;

    ctx.save();
    /* ★ 翻转：以 cx 为镜像轴（见上面"朝向"的说明） */
    if (face < 0) {
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    ctx.translate(pivotX, pivotY);
    /* nod=1 时最多低 0.30 弧度（约 17°）—— 比代码版小一点，
     * 因为贴图的头占比更大，转多了会歪出身体。 */
    ctx.rotate(nod * 0.30);
    ctx.translate(-pivotX, -pivotY);
    /* 像素图必须关掉平滑，否则放大后会糊 */
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite.img, cx - drawW / 2, footY - drawH, drawW, drawH);
    ctx.restore();

    /* ★ 收到外卖后的台词气泡（画在贴图之上） */
    drawReceiverSpeech(ctx, cx, footY - drawH, face, t);
    return;
  }

  /* ---------- 以下为"没有贴图"时的代码绘制兜底 ---------- */

  /* ---- 小人尺寸（站在门洞里，别太高）---- */
  const bodyH = T * 1.5;              // 身体高
  const headR = T * 0.34;             // 头半径

  /* 点头角度 `nod` 已经在函数开头算好了（贴图和代码绘制共用），
   * 这里不再重复计算 —— 重复 `let nod` 会直接 SyntaxError。 */

  ctx.save();

  const footY = baseY - 2;            // 脚底
  const bodyTopY = footY - bodyH;

  /* ★ 翻转（同贴图路径）：代码版是画在 cx 两侧的对称图形，
   *   翻转本身看不出差别，但**外卖袋**在一侧 —— 所以要翻。 */
  if (face < 0) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  /* ---- 腿（两条短竖线）---- */
  ctx.fillStyle = '#4a4658';
  ctx.fillRect(cx - 6, footY - 12, 4, 12);
  ctx.fillRect(cx + 2, footY - 12, 4, 12);

  /* ---- 身体（一个梯形，抽象小人）---- */
  ctx.fillStyle = '#6b6580';
  ctx.beginPath();
  ctx.moveTo(cx - 9, footY - 12);
  ctx.lineTo(cx + 9, footY - 12);
  ctx.lineTo(cx + 7, bodyTopY + 6);
  ctx.lineTo(cx - 7, bodyTopY + 6);
  ctx.closePath();
  ctx.fill();

  /* ---- 外卖袋（手里提着，小小一个）---- */
  ctx.fillStyle = '#FFD100';
  ctx.fillRect(cx + 9, footY - 22, 7, 8);
  ctx.fillStyle = '#E0A800';
  ctx.fillRect(cx + 9, footY - 22, 7, 2);

  /* ---- 头（会点头：绕脖子转一个小角度）---- *
   * ⚠️ 用 rotate 做点头，比"画两个头"自然。
   *    原点设在脖子（bodyTopY + 6），点头时头往前下方倾。 */
  const neckY = bodyTopY + 6;
  const headCX = cx;
  const headCY = neckY - headR;

  ctx.save();
  ctx.translate(headCX, neckY);
  /* nod 越大，头越低（正角度 = 往下倾）。
   * 最大 0.42 弧度 ≈ 24°，太多了像要摔倒，这个角度刚好"机械"。 */
  ctx.rotate(nod * 0.42);
  ctx.translate(-headCX, -neckY);

  /* 头（方块头 —— 保持像素风的硬边，不用圆） */
  ctx.fillStyle = '#8d86a3';
  ctx.fillRect(headCX - headR, headCY - headR, headR * 2, headR * 2);
  /* 一点阴影，让头看起来有厚度 */
  ctx.fillStyle = '#7a7490';
  ctx.fillRect(headCX - headR, headCY + headR * 0.4, headR * 2, headR * 0.6);

  /* 眼睛（两个小黑点 —— 越简单越好笑） */
  ctx.fillStyle = '#1a1a20';
  ctx.fillRect(headCX - headR * 0.55, headCY - headR * 0.15, 3, 3);
  ctx.fillRect(headCX + headR * 0.15, headCY - headR * 0.15, 3, 3);

  ctx.restore();

  ctx.restore();

  /* ★ 收到外卖后的台词气泡（代码绘制路径也要有） */
  drawReceiverSpeech(ctx, cx, bodyTopY - headR * 2.2, face, t);
}

/* ============================================================
 * ★ 收餐人的台词气泡（2026-10-07 十一要求）★
 * ============================================================
 * 十一："收到外卖之后停个 10 秒钟，可以对骑手说一些话，
 *        什么谢谢啊，什么怎么这么慢，什么什么的。"
 *
 * 【为什么必须画在**世界坐标**里】
 *   气泡要跟着收餐人（它是这个人的话）。放进 HUD 会固定在屏幕上，
 *   人一移动（或镜头一摇）就脱节了。
 *
 * 【为什么不画在"屏幕顶部的大字提示"】
 *   那是 `Game.message` 干的活（"送达成功"之类）。
 *   顾客的话是**角色台词**，就该挂在他头上 —— 这样才有"他在跟我说话"的感觉。
 *
 * @param ctx    画布（已 translate 到世界坐标）
 * @param cx     收餐人中心 x
 * @param topY   收餐人**头顶** y（气泡从这里往上长）
 * @param face   ±1，朝向（气泡往人面向的那一侧偏一点，更像"对着谁说话"）
 * @param t      全局时间（秒，用于气泡轻微浮动）
 * ============================================================ */
function drawReceiverSpeech(ctx, cx, topY, face, t) {
  const sess = (typeof receiverTalkSession === 'function') ? receiverTalkSession() : null;
  if (!sess || sess.done) return;
  if (typeof RECEIVER_TALK === 'undefined') return;

  const idx = RECEIVER_TALK.lineIndexAt(sess);
  const text = sess.lines[idx];
  if (!text) return;
  const alpha = RECEIVER_TALK.lineAlpha(sess);
  if (alpha <= 0.01) return;

  const T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;
  ctx.save();

  /* ---- 量文字尺寸 ---- */
  ctx.font = 'bold 13px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = 10, padY = 8;
  const tw = ctx.measureText(text).width;
  const bw = tw + padX * 2;
  const bh = 26;

  /* ---- 气泡位置 ----
   * ⚠️ 往"人面向的那一侧"偏一点：他朝左说话，气泡就在左边，
   *    视觉上像"话从他正面出来"。偏移量取气泡宽度的 22%。 */
  const shift = face * Math.min(T * 1.1, bw * 0.22);
  const bx = cx + shift;
  /* 轻微上下浮动（呼吸感，不然像贴图） */
  const bob = Math.sin(t * 3) * 1.5;
  const by = topY - RECEIVER_TALK.CFG.BUBBLE_GAP - bh + bob;

  ctx.globalAlpha = alpha;

  /* ---- 气泡本体（圆角矩形 + 小尖角）---- */
  const r = 7;
  ctx.beginPath();
  ctx.moveTo(bx - bw / 2 + r, by);
  ctx.lineTo(bx + bw / 2 - r, by);
  ctx.quadraticCurveTo(bx + bw / 2, by, bx + bw / 2, by + r);
  ctx.lineTo(bx + bw / 2, by + bh - r);
  ctx.quadraticCurveTo(bx + bw / 2, by + bh, bx + bw / 2 - r, by + bh);
  /* 小尖角指向说话的人（放在靠人的那一侧）*/
  const tipX = cx + face * 6;
  ctx.lineTo(Math.min(bx + bw / 2, Math.max(bx - bw / 2, tipX + 6)), by + bh);
  ctx.lineTo(tipX, by + bh + 7);
  ctx.lineTo(Math.min(bx + bw / 2, Math.max(bx - bw / 2, tipX - 6)), by + bh);
  ctx.lineTo(bx - bw / 2 + r, by + bh);
  ctx.quadraticCurveTo(bx - bw / 2, by + bh, bx - bw / 2, by + bh - r);
  ctx.lineTo(bx - bw / 2, by + r);
  ctx.quadraticCurveTo(bx - bw / 2, by, bx - bw / 2 + r, by);
  ctx.closePath();

  /* 白底 + 深边框（像素风：用 2px 硬边，不用阴影模糊） */
  ctx.fillStyle = 'rgba(250,250,252,0.96)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,30,40,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  /* ---- 文字 ---- */
  ctx.fillStyle = '#1c1c24';
  ctx.fillText(text, bx, by + bh / 2 + 1);

  /* ---- 剩余秒数：右下角一个小记号 ----
   * ⚠️ 11 秒的话挂着不说话，玩家会以为卡住了。
   *    所以给一个**随时间收缩的小点**示意"他还要说一会儿"。 */
  const left = Math.max(0, 1 - sess.elapsed / sess.total);
  if (left > 0) {
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = '#8a8a96';
    ctx.fillRect(bx + bw / 2 - 6 - 18 * left, by + bh - 4, 18 * left, 2);
  }

  ctx.restore();
}

/* ============================================================
 * ★ 🛵 外卖车绘制（2026-10-07 改版：借车加速，去掉充电桩）★
 * ============================================================
 * 十一："去掉随机充电桩，保留外卖车。碰到外卖车可以加速几秒，
 *        外卖车没电了，就加速不了。"
 *
 * 【三件事要画清楚】
 *   ① 车在哪、**还剩多少电**（电量条是必须的 —— 见下）
 *   ② 这车"能不能借"（没电的车要画得明显不一样，别让玩家白跑）
 *   ③ 玩家正加速时：还剩几秒（倒计时条 + 秒数）
 *
 * 【★ 为什么"电量条 + 倒计时"都是必须的 ★】
 *   十一的规则里有两个"会突然消失"的东西：
 *     · 车的电量（借两次就没了）
 *     · 每次加速的 4 秒
 *   如果这两个都是隐藏的、突然清零，玩家的感受是"我被耍了"。
 *   ⇒ 都必须画出来，让玩家能自己决定"要不要现在借"。
 *      这不是装饰，是让"限时加速 + 一次性资源"这个设计能被接受的前提。
 *
 * 【贴图 vs 代码绘制】
 *   有 AI 贴图（scooter.png）就用图，没有就代码画简笔。
 *   两条路径的**判定框完全一样**（用的是 SCOOTER.CFG 里的尺寸）。
 * ============================================================ */
function drawScooters(ctx, t) {
  const d = SCOOTER.current();
  if (!d) return;

  /* ⚠️ 2026-10-07：**充电桩已整体删除**（十一要求）。
   *    这里不再画桩；`d.chargers` 恒为空数组，
   *    即使以后有人往里塞数据也不会画（保留遍历是为了向后兼容结构）。 */

  /* ---------- 外卖车 ---------- */
  const bikeImg = (typeof getDecorImage === 'function') ? getDecorImage('scooter') : null;
  const LOW = SCOOTER.CFG.LOW_RATIO;      // 低电量阈值（写在这里，循环里复用）
  (d.bikes || []).forEach(function (b) {
    const cx = b.x + b.w / 2;
    const baseY = b.y + b.h;

    /* 这台车是不是"正在给玩家供能给"（只有玩家 boostFrom 指向它才算） */
    let isBoosting = false;
    if (Game && Game.players) {
      for (let i = 0; i < Game.players.length; i++) {
        if (Game.players[i] && Game.players[i].boostFrom === b) { isBoosting = true; break; }
      }
    }

    /* 没电的车：整体压暗 —— 让玩家一眼看出"这台借不了了" */
    const dead = b.charge <= 0;

    /* 待取时的上下轻浮（像道具一样"在地上等人来借"）
     * ⚠️ 用 seed 做相位，避免所有车同步上下浮动（那样看起来像 bug）。 */
    const bob = (!dead && !isBoosting) ? Math.sin(t * 2.4 + b.seed * 9) * 2 : 0;

    ctx.save();
    if (dead) ctx.globalAlpha = 0.45;

    /* 阴影 */
    ctx.save();
    ctx.globalAlpha = (dead ? 0.12 : 0.22);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx, baseY, b.w * 0.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (bikeImg) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bikeImg.img, b.x, b.y + bob, b.w, b.h);
    } else {
      /* 代码兜底：车身 + 两个轮子 + 外卖箱 */
      const by = b.y + bob;
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath(); ctx.arc(b.x + 9, by + b.h - 5, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(b.x + b.w - 9, by + b.h - 5, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFD100';
      ctx.fillRect(b.x + 6, by + 6, b.w - 12, 10);
      ctx.fillStyle = '#3b6fd4';                 // 外卖箱
      ctx.fillRect(b.x + b.w - 16, by, 13, 11);
    }
    ctx.restore();

    /* ---- 车的电量条（画在车头顶上）----
     * 玩家借一次掉半格 ⇒ 这条就是"这台车还能借几次"的读数。 */
    const barW = 30, barH = 4;
    const bx = cx - barW / 2;
    const byy = b.y + bob - 9;
    ctx.save();
    /* 底槽 */
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, byy - 1, barW + 2, barH + 2);
    /* 电量（颜色随余量变：绿 → 黄 → 红） */
    const c = Math.max(0, Math.min(1, b.charge));
    ctx.fillStyle = c > 0.5 ? '#5ee36a' : (c > LOW ? '#ffd93b' : '#ff5b4a');
    ctx.fillRect(bx, byy, Math.max(0, barW * c), barH);
    /* 外框（细一线，让它从背景里跳出来） */
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, byy - 0.5, barW + 1, barH + 1);
    ctx.restore();

    /* 低电量闪烁提示（不是文字，就一个闪的小三角，
     * 避免和 HUD 的文字抢注意力） */
    if (!dead && c <= LOW) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t * 8));
      ctx.fillStyle = '#ff5b4a';
      const ax = cx, ay = byy - 5;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 5);
      ctx.lineTo(ax - 4, ay + 1);
      ctx.lineTo(ax + 4, ay + 1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /* 正在供能的车：脚下加一点速度线（视觉上表达"正从这台车借力"） */
    if (isBoosting && !dead) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#8fe0ff';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const off = ((t * 40 + k * 14) % 42);
        ctx.beginPath();
        ctx.moveTo(b.x - off, baseY - 6 - k * 5);
        ctx.lineTo(b.x - off - 12, baseY - 6 - k * 5);
        ctx.stroke();
      }
      ctx.restore();
    }
  });
}

/* ============================================================
 * ★ 加速倒计时（画在**骑手头顶**，世界坐标）★
 * ============================================================
 * 十一要的"加速几秒"必须是**可预期**的 ——
 * 玩家得知道还剩多久，否则"啪"一下没了会显得莫名其妙。
 *
 * 【为什么画在骑手头顶而不是 HUD】
 *   加速是"角色身上正在发生的事"，跟着角色走最直观
 *   （尤其是双人模式，两个人在不同位置，HUD 只有一个）。
 *
 * ⚠️ 必须在世界坐标系里画（`translate(-cam.x, -cam.y)` 之后），
 *    和角色一起移动；放进 drawHUD 会固定不动、跟角色脱节。
 * ============================================================ */
function drawBoostGauge(ctx, p, t) {
  if (!p || p.dead) return;
  const ratio = (typeof SCOOTER !== 'undefined' && SCOOTER.boostRatio) ? SCOOTER.boostRatio(p) : 0;
  if (ratio <= 0) return;

  const cx = p.x + p.w / 2;
  const topY = p.y - 24;                     // 头顶上方
  const barW = 34, barH = 5;
  const bx = cx - barW / 2;
  const secs = SCOOTER.boostSecondsLeft(p);
  const low = ratio <= SCOOTER.CFG.LOW_RATIO;

  ctx.save();
  /* 底槽 */
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx - 1, topY - 1, barW + 2, barH + 2);
  /* 剩余时间（从满到空）—— 告急时闪 */
  const flash = low ? (0.45 + 0.55 * Math.abs(Math.sin(t * 10))) : 1;
  ctx.globalAlpha = flash;
  ctx.fillStyle = low ? '#ff5b4a' : '#8fe0ff';
  ctx.fillRect(bx, topY, Math.max(0, barW * ratio), barH);
  ctx.globalAlpha = 1;
  /* 外框 */
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - 0.5, topY - 0.5, barW + 1, barH + 1);

  /* ★ 秒数（"+2s"）—— 光有进度条不够，
   *   玩家想知道的是"还剩几秒"，直接写数字最省事。 */
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText('+' + secs + 's', cx + 1, topY - 3 + 1);
  ctx.fillStyle = low ? '#ff8b7a' : '#bfefff';
  ctx.fillText('+' + secs + 's', cx, topY - 3);
  ctx.restore();
}


/* 送达点（原终点旗）
 *
 * 改成了外卖语义：一个立在收餐地址上的"送达点"——
 *   · 立柱 + 顶上的定位图钉（像素风，硬边）
 *   · 订单没集齐时整个变灰 + 挂一把锁 + "还差 N 单"
 *   · 集齐且两人都到 → 亮起美团黄 + 光柱
 *
 * ★ 2026-10-06 补充：背后加一栋"小区入口/宿舍楼" ★
 * 十一要求"终点尽量表现成顾客、宿舍楼、小区入口或收餐点，
 * 不要只是一面普通旗帜"。
 * 所以先画一栋楼的门脸（门洞 + 门牌 + 窗），再画原来的送达立柱 ——
 * 立柱是"可交互的判定点"，楼是"这地方是哪"的语境。
 * 只画一次背景，判定逻辑完全不变（还是 g 那个矩形）。
 */
function drawGoal(ctx, lv, t, reached) {
  const g = lv.goal;
  if (!g) return;

  const coinsOk = Game.coinsTaken >= Game.coinsRequired;
  const active = reached && coinsOk;

  const cx = g.x + g.w / 2;
  const baseY = g.y + g.h;            // 立柱底部（站在地面上）

  /* ---- 背景楼：门脸 ---- *
   * 画在立柱**之前**，这样立柱和路牌压在上面（层次正确）。
   * 尺寸按格对齐（LEVEL_TILE = 32），看起来像关卡的一部分而不是贴图。 */
  const T = (typeof LEVEL_TILE !== 'undefined') ? LEVEL_TILE : 32;
  const bw = T * 5, bh = T * 6;
  const bx0 = cx - bw / 2, by0 = baseY - bh;

  const wallCol = coinsOk ? '#3a3a46' : '#33333c';
  const wallDark = coinsOk ? '#2b2b35' : '#282830';

  // 墙体
  ctx.fillStyle = wallCol;
  ctx.fillRect(bx0, by0, bw, bh);
  // 顶部屋檐（深色，做出"有个顶"的感觉）
  ctx.fillStyle = wallDark;
  ctx.fillRect(bx0 - 6, by0 - 8, bw + 12, 8);
  ctx.fillRect(bx0 - 6, by0, bw + 12, 3);

  // 两扇窗（黄色 —— 有人的家）
  ctx.fillStyle = coinsOk ? 'rgba(255,209,0,0.55)' : 'rgba(150,155,165,0.3)';
  ctx.fillRect(bx0 + 12, by0 + 18, 22, 20);
  ctx.fillRect(bx0 + bw - 34, by0 + 18, 22, 20);
  ctx.strokeStyle = coinsOk ? 'rgba(255,209,0,0.85)' : 'rgba(150,155,165,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx0 + 12, by0 + 18, 22, 20);
  ctx.strokeRect(bx0 + bw - 34, by0 + 18, 22, 20);
  // 窗格十字
  ctx.beginPath();
  ctx.moveTo(bx0 + 23, by0 + 18); ctx.lineTo(bx0 + 23, by0 + 38);
  ctx.moveTo(bx0 + 12, by0 + 28); ctx.lineTo(bx0 + 34, by0 + 28);
  ctx.moveTo(bx0 + bw - 23, by0 + 18); ctx.lineTo(bx0 + bw - 23, by0 + 38);
  ctx.moveTo(bx0 + bw - 34, by0 + 28); ctx.lineTo(bx0 + bw - 12, by0 + 28);
  ctx.stroke();

  // 门洞（深色，玩家"走进去"的地方）
  const doorW = T * 1.6, doorH = T * 2.4;
  const doorX = cx - doorW / 2, doorY = baseY - doorH;
  ctx.fillStyle = '#15151a';
  ctx.fillRect(doorX, doorY, doorW, doorH);
  ctx.strokeStyle = coinsOk ? 'rgba(255,209,0,0.7)' : 'rgba(150,155,165,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(doorX + 1, doorY + 1, doorW - 2, doorH - 2);

  /* ★ 会点头的收餐人（2026-10-06）★
   * 站在门洞里 —— 所以必须在**门洞画完之后**才画，否则会被门盖住。
   * 送达且订单达标后才点头（见 drawReceiver 的说明）。 */
  try {
    /* ★ 2026-10-07：触发"收到外卖后的 10 秒台词" ★
     * 条件：订单达标 + 骑手真的走到门口（碰到送达点）。
     * ⚠️ 每关只触发一次（receiverTalkStart 内部有 started 守卫）。
     * ⚠️ 触发本身**不影响通关** —— 送达即结算，这只是余韵
     *    （见 receiver-talk.js 的 blocksGoal 说明）。 */
    if (active && typeof receiverTalkStart === 'function') {
      let atDoor = false;
      if (Game && Game.players) {
        for (let i = 0; i < Game.players.length; i++) {
          const p = Game.players[i];
          if (!p || p.dead) continue;
          if (p.x < g.x + g.w && p.x + p.w > g.x &&
              p.y < g.y + g.h && p.y + p.h > g.y) { atDoor = true; break; }
        }
      }
      if (atDoor) {
        /* 超时判定和 game.js 的 `canTimeoutFail` 保持**同一套语义**：
         * 只有"本关有时限"时才谈得上超时（targetTime > 0），
         * 否则 elapsed 对比没有意义。 */
        const hasLimit = !!(lv.targetTime > 0);
        receiverTalkStart({
          late: hasLimit && (Game.elapsed > lv.targetTime),
          missing: !coinsOk,
        });
      }
    }
    if (typeof drawReceiver === 'function') {
      drawReceiver(ctx, cx, baseY, t, active, g.x);
    }
  } catch (e) { /* 收餐人画不出来不影响送达点本身 */ }

  /* 门牌号（比如 "3 单元"）—— 楼栋编号。用图钉的 x 坐标做个小变化，
   * 让不同关卡的楼号不一样（看起来更真实，不像是同一栋复制过去的）。 */
  const unitNo = 1 + (Math.floor(g.x / 100) % 6);
  ctx.save();
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = coinsOk ? 'rgba(255,209,0,0.9)' : 'rgba(180,185,195,0.6)';
  ctx.fillText(unitNo + ' 单元', cx, by0 - 14);
  ctx.restore();

  // 主色：可达 = 美团黄，未达标 = 灰
  const mainCol = coinsOk ? '#FFD100' : '#8a9199';
  const darkCol = coinsOk ? '#E0A800' : '#6f787f';

  // ---- 立柱（像送货地址牌）----
  ctx.fillStyle = darkCol;
  ctx.fillRect(cx - 5, g.y - 10, 10, g.h + 10);
  ctx.fillStyle = mainCol;
  ctx.fillRect(cx - 5, g.y - 10, 6, g.h + 10);

  // ---- 底部基座 ----
  ctx.fillStyle = darkCol;
  ctx.fillRect(cx - 16, baseY - 6, 32, 6);
  ctx.fillStyle = mainCol;
  ctx.fillRect(cx - 16, baseY - 6, 32, 3);

  // ---- 顶上的送达图钉（像素图标，放大）----
  const pinSize = 34;
  drawIcon(ctx, 'pin', cx - pinSize / 2, g.y - 10 - pinSize, pinSize,
    coinsOk ? 1 : 0.45);

  // ---- 路牌板：写"送达点" ----
  const boardW = 66, boardH = 22;
  const bx = cx + 8, by = g.y - 4;
  ctx.fillStyle = 'rgba(18,18,22,0.85)';
  ctx.fillRect(bx, by, boardW, boardH);
  ctx.strokeStyle = mainCol;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx + 1, by + 1, boardW - 2, boardH - 2);

  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = mainCol;
  ctx.fillText('送达点', bx + 8, by + 16);
  ctx.restore();

  // ---- 两人都到且订单达标 → 光柱 ----
  if (active) {
    ctx.save();
    ctx.globalAlpha = 0.22 + Math.sin(t * 6) * 0.1;
    ctx.fillStyle = '#FFD100';
    ctx.fillRect(g.x - 10, g.y - 60, g.w + 20, g.h + 60);
    ctx.restore();
    // 顶上飘出的小袋子，表示"送达成功"
    ctx.save();
    ctx.globalAlpha = 0.9;
    const fy = g.y - 58 - ((t * 26) % 26);
    drawCoin(ctx, cx, fy, 9, t);
    ctx.restore();
  }

  // ---- 订单不够 → 锁 + 提示 ----
  if (!coinsOk) {
    const cy = g.y - 52;
    // 锁身（像素方块，不要圆角）
    ctx.fillStyle = '#2A2A30';
    ctx.fillRect(cx - 11, cy, 22, 18);
    ctx.fillStyle = '#ffd93b';
    ctx.fillRect(cx - 9, cy + 2, 18, 14);
    ctx.fillStyle = '#2A2A30';
    ctx.fillRect(cx - 2, cy + 7, 4, 5);
    // 锁梁
    ctx.strokeStyle = '#ffd93b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, Math.PI, 0);
    ctx.stroke();

    const need = Game.coinsRequired - Game.coinsTaken;
    ctx.save();
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 4;
    const msg = '还差 ' + need + ' 单';
    ctx.strokeText(msg, cx, cy - 12);
    ctx.fillStyle = '#FFD100';
    ctx.fillText(msg, cx, cy - 12);
    ctx.restore();
  }
}

/* ---------------- 敌人 ----------------
 * walker 巡逻怪：紫色栗子怪（原有）
 * hopper 跳跳怪：绿色，圆一点，有明显的大脚 —— 一眼能看出"它能跳"
 * ---------------------------------------- */
function drawEnemies(ctx, lv, cam) {
  for (let i = 0; i < lv.enemies.length; i++) {
    const en = lv.enemies[i];
    if (en.dead) continue;
    if (!visible(en, cam, 80)) continue;
    if (en.type === 'hopper') drawHopperEnemy(ctx, en);
    else drawWalkerEnemy(ctx, en);
  }
}

function drawWalkerEnemy(ctx, en) {
  const bob = Math.sin(en.animT * 8) * 2;
  // 身体（紫色小怪，马里奥栗子怪风）
  ctx.fillStyle = '#8a4ad6';
  ctx.beginPath();
  ctx.ellipse(en.x + en.w / 2, en.y + en.h / 2 + bob, en.w / 2, en.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a86ae8';
  ctx.beginPath();
  ctx.ellipse(en.x + en.w / 2 - 3, en.y + en.h / 2 - 3 + bob, en.w / 3.2, en.h / 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // 眼
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(en.x + en.w * 0.35, en.y + en.h * 0.42 + bob, 4, 0, Math.PI * 2);
  ctx.arc(en.x + en.w * 0.65, en.y + en.h * 0.42 + bob, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b2118';
  const look = en.vx > 0 ? 1.4 : -1.4;
  ctx.beginPath();
  ctx.arc(en.x + en.w * 0.35 + look, en.y + en.h * 0.42 + bob, 2, 0, Math.PI * 2);
  ctx.arc(en.x + en.w * 0.65 + look, en.y + en.h * 0.42 + bob, 2, 0, Math.PI * 2);
  ctx.fill();
  // 脚
  ctx.fillStyle = '#5a2a96';
  const lf = Math.sin(en.animT * 12) * 3;
  ctx.fillRect(en.x + 2, en.y + en.h - 4, 8, 4 + lf * 0.2);
  ctx.fillRect(en.x + en.w - 10, en.y + en.h - 4, 8, 4 - lf * 0.2);
}

/* 跳跳怪：绿色圆身 + 大脚 + 起跳前会"蹲一下"（压扁） */
function drawHopperEnemy(ctx, en) {
  const cx = en.x + en.w / 2;
  const cy = en.y + en.h / 2;

  // 起跳前蓄力 → 压扁；在空中 → 拉伸
  let squash = 1;
  if (en.vy < -1) squash = 1.18;                        // 上升：拉伸
  else if (en.vy > 2) squash = 0.9;                     // 下坠：略扁
  else if (en.hopTimer < 10) squash = 0.78;             // 蓄力：明显压扁

  const rw = (en.w / 2) / squash;
  const rh = (en.h / 2) * squash;

  // 影子（跳起来时地面上的影子变小，帮助玩家判断落点）
  const groundGap = Math.max(0, -en.vy) * 2;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy + rh + 4, Math.max(4, rw * 0.9 - groundGap * 0.08), 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 身体
  ctx.fillStyle = '#3fae4a';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#63d16f';
  ctx.beginPath();
  ctx.ellipse(cx - 3, cy - 3, rw * 0.6, rh * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛（跳跳怪的眼神更"凶"一点，用斜眉）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - 5, cy - 2, 4.2, 0, Math.PI * 2);
  ctx.arc(cx + 5, cy - 2, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a2a18';
  const look = en.vx > 0 ? 1.4 : -1.4;
  ctx.beginPath();
  ctx.arc(cx - 5 + look, cy - 2, 2.1, 0, Math.PI * 2);
  ctx.arc(cx + 5 + look, cy - 2, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a2a18';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx - 9, cy - 8); ctx.lineTo(cx - 2, cy - 5.5);
  ctx.moveTo(cx + 9, cy - 8); ctx.lineTo(cx + 2, cy - 5.5);
  ctx.stroke();

  // 大脚（两只，腾空时往下伸）
  ctx.fillStyle = '#2c7a34';
  const splay = en.vy < 0 ? 3 : 0;
  ctx.beginPath();
  ctx.ellipse(cx - 6 - splay, cy + rh - 1, 6, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 6 + splay, cy + rh - 1, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------------- 炸弹 ----------------
 * 点燃前：黑色圆炸弹 + 引线 + 稳定的小火花
 * 点燃后：整颗闪红、火花变密、闪得越来越快（越接近爆炸越快）
 * ---------------------------------------- */
function drawBombs(ctx, lv, cam) {
  if (!lv.bombs) return;
  for (let i = 0; i < lv.bombs.length; i++) {
    const b = lv.bombs[i];
    if (b.exploded) continue;
    if (!visible(b, cam, 120)) continue;

    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;

    // 点燃后按剩余时间加速闪烁
    let flash = 0;
    if (b.lit) {
      const urgency = 1 - b.timer / CONFIG.BOMB_FUSE;     // 0 → 1
      const rate = 0.25 + urgency * 0.9;
      flash = (Math.sin(b.flash * (1 + urgency * 3)) + 1) / 2;
      // 越接近爆炸，整体越偏向红色
      if (flash > 0.5) {
        ctx.save();
        ctx.globalAlpha = 0.22 + urgency * 0.4;
        ctx.fillStyle = '#ff3b1f';
        ctx.beginPath();
        ctx.arc(cx, cy, b.w * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 弹体
    ctx.fillStyle = '#26262b';
    ctx.beginPath();
    ctx.arc(cx, cy + 1, b.w / 2, 0, Math.PI * 2);
    ctx.fill();
    // 高光
    ctx.fillStyle = b.lit && flash > 0.5 ? '#ff8a6a' : '#5a5a66';
    ctx.beginPath();
    ctx.arc(cx - b.w * 0.16, cy - b.w * 0.18, b.w * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // 引线：点燃后画成抖动的橙线
    ctx.strokeStyle = b.lit ? '#ff6b00' : '#8a7a5a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy - b.w / 2 + 1);
    ctx.quadraticCurveTo(cx + 8, cy - b.w / 2 - 6, cx + 4, cy - b.w / 2 - 11);
    ctx.stroke();

    // 顶端火花
    const sparkR = b.lit ? 3.4 + flash * 2.6 : 1.8;
    ctx.fillStyle = b.lit ? (flash > 0.5 ? '#fff3b0' : '#ff6b00') : '#ffd166';
    ctx.beginPath();
    ctx.arc(cx + 4, cy - b.w / 2 - 11, sparkR, 0, Math.PI * 2);
    ctx.fill();

    // 点燃后的倒计时数字（让玩家知道还剩多久）
    if (b.lit) {
      ctx.save();
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff6b00';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      const sec = Math.max(0, b.timer / 60).toFixed(1);
      ctx.strokeText(sec, cx, b.y - 16);
      ctx.fillText(sec, cx, b.y - 16);
      ctx.restore();
    }
  }
}

/* ---------------- 跷跷板 ----------------
 * 一块绕中心支点旋转的木板 + 三角形支点。
 * 板两端会画上朝向标记，提示"可以站两头配合"。
 * ---------------------------------------- */
function drawSeesaws(ctx, lv, cam) {
  if (!lv.seesaws) return;
  for (let i = 0; i < lv.seesaws.length; i++) {
    const s = lv.seesaws[i];
    const box = { x: s.cx - s.halfLen, y: s.cy - 40, w: s.halfLen * 2, h: 80 };
    if (!visible(box, cam, 120)) continue;

    // ---- 支点三角 ----
    ctx.fillStyle = '#5a4632';
    ctx.beginPath();
    ctx.moveTo(s.cx, s.cy - 4);
    ctx.lineTo(s.cx - 11, s.cy + 22);
    ctx.lineTo(s.cx + 11, s.cy + 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7a6144';
    ctx.beginPath();
    ctx.moveTo(s.cx, s.cy - 4);
    ctx.lineTo(s.cx - 11, s.cy + 22);
    ctx.lineTo(s.cx, s.cy + 22);
    ctx.closePath();
    ctx.fill();

    // ---- 板身（旋转）----
    ctx.save();
    ctx.translate(s.cx, s.cy);
    ctx.rotate(s.angle);
    const L = s.halfLen, TH = 11;
    // 木板
    ctx.fillStyle = '#b3763c';
    ctx.fillRect(-L, -TH / 2, L * 2, TH);
    ctx.fillStyle = '#d99a58';
    ctx.fillRect(-L, -TH / 2, L * 2, 4);
    ctx.fillStyle = '#8a5a2a';
    ctx.fillRect(-L, TH / 2 - 3, L * 2, 3);
    // 木纹
    ctx.fillStyle = 'rgba(120,80,40,0.5)';
    for (let k = -L + 8; k < L - 4; k += 14) ctx.fillRect(k, -TH / 2 + 4, 2, TH - 8);
    // 两端的黄色踏板标记（提示"这里站人"）
    ctx.fillStyle = '#FFD100';
    ctx.fillRect(-L + 2, -TH / 2, 7, TH);
    ctx.fillRect(L - 9, -TH / 2, 7, TH);
    ctx.restore();
  }
}

/* ---------------- 金币 / 粒子 ---------------- */
function drawCoins(ctx, lv, cam, t) {
  for (let i = 0; i < lv.coins.length; i++) {
    const c = lv.coins[i];
    if (c.taken) continue;
    if (!visible({ x: c.x - 12, y: c.y - 12, w: 24, h: 24 }, cam, 60)) continue;
    const bob = Math.sin(c.bob) * 4;
    drawCoin(ctx, c.x, c.y + bob, c.r, t + i);
  }
}

function drawParticles(ctx) {
  for (let i = 0; i < Game.particles.length; i++) {
    const p = Game.particles[i];
    const a = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    if (p.type === 'text') {
      ctx.fillStyle = p.color;
      ctx.font = 'bold 18px monospace';
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.type === 'ring') {
      // 扩散环：从中心扩散、边扩散边变淡变细
      const t = 1 - a;                 // 0 → 1
      const r = p.size + (p.maxR - p.size) * t;
      const lw = (p.lineW || 3) * a + 0.8;
      ctx.globalAlpha = Math.max(0, a) * 0.92;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = lw;
      /* 椭圆压扁（0.45）是为了配合侧视视角 —— 环看起来像贴在地面/脚下的冲击波 */
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.type === 'streak') {
      /* 速度线：沿运动方向拉出一条短线，表现"弹射"的力 */
      const len = 10 * a + 4;
      const ang = p.angle || 0;
      ctx.globalAlpha = Math.max(0, a) * 0.95;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1, p.size * 0.7 * a);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
      ctx.stroke();
    } else if (p.type === 'star') {
      /* 四角星芒：十字形，短促有力，强调"特殊动作发生了" */
      const s = p.size * (0.5 + a * 0.9);
      const ang = p.angle || 0;
      ctx.globalAlpha = Math.max(0, a) * 0.95;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1, 2.2 * a);
      ctx.lineCap = 'round';
      ctx.beginPath();
      /* 主轴 */
      ctx.moveTo(p.x - Math.cos(ang) * s, p.y - Math.sin(ang) * s);
      ctx.lineTo(p.x + Math.cos(ang) * s, p.y + Math.sin(ang) * s);
      /* 副轴（垂直，稍短 → 星芒感） */
      ctx.moveTo(p.x - Math.cos(ang + 1.57) * s * 0.6, p.y - Math.sin(ang + 1.57) * s * 0.6);
      ctx.lineTo(p.x + Math.cos(ang + 1.57) * s * 0.6, p.y + Math.sin(ang + 1.57) * s * 0.6);
      ctx.stroke();
    } else if (p.type === 'dessert') {
      /* ★ 「十一」专属：小蛋糕拖尾痕迹（2026-10-07 十一要求）★
       * 原话："要做一个移动拖尾，就是十一经过的时候，
       *        会留下小蛋糕的样子，然后过两三秒就会消失。"
       *
       * 画法：一个迷你纸杯蛋糕
       *   · 底部是纸杯（梯形）
       *   · 上面是奶油（半圆）+ 一颗樱桃
       * 尺寸随大小 / 角度微转（用哈希定，不会每帧抖）
       * ⚠️ 纯表现粒子，不参与物理、不影响关卡可行性。 */
      const s = p.size || 7;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle || 0);
      /* ① 纸杯（下窄上宽的梯形） */
      ctx.fillStyle = p.cupColor || '#F2A8C8';
      ctx.beginPath();
      ctx.moveTo(-s * 0.52, s * 0.05);
      ctx.lineTo(s * 0.52, s * 0.05);
      ctx.lineTo(s * 0.38, s * 0.92);
      ctx.lineTo(-s * 0.38, s * 0.92);
      ctx.closePath();
      ctx.fill();
      /* 纸杯上的竖纹（3 条，纸杯质感） */
      ctx.strokeStyle = alphaHex(p.cupColor || '#F2A8C8', 0.55);
      ctx.lineWidth = Math.max(0.6, s * 0.08);
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * s * 0.24, s * 0.12);
        ctx.lineTo(k * s * 0.18, s * 0.86);
        ctx.stroke();
      }
      /* ② 奶油（半圆，稍微溢出杯口） */
      ctx.fillStyle = p.creamColor || '#FFF3E4';
      ctx.beginPath();
      ctx.ellipse(0, s * 0.05, s * 0.62, s * 0.44, 0, Math.PI, 0);
      ctx.fill();
      /* ③ 樱桃（红点 + 小梗） */
      ctx.fillStyle = p.cherryColor || '#E84A6F';
      ctx.beginPath();
      ctx.arc(0, -s * 0.42, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6FA86B';
      ctx.lineWidth = Math.max(0.6, s * 0.07);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.56);
      ctx.quadraticCurveTo(s * 0.14, -s * 0.78, s * 0.26, -s * 0.72);
      ctx.stroke();
      ctx.restore();
    } else if (p.type === 'orange') {
      /* ★ 「噜噜」专属：橘子拖尾痕迹（2026-10-07 十一要求）★
       * 原话："还有橘子拖尾，然后两秒消失的那种。"
       *
       * 画法：一颗圆橘子
       *   · 橘色圆身 + 顶部高光（有球感）
       *   · 顶部一片小绿叶 —— 一眼认出是"橘子"而不是"橙色圆点"
       * ⚠️ 纯表现粒子，不参与物理。 */
      const s = p.size || 6;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle || 0);
      /* ① 橘身 */
      ctx.fillStyle = p.peelColor || '#FFA726';
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.fill();
      /* ② 顶部高光 */
      ctx.fillStyle = 'rgba(255,235,190,0.55)';
      ctx.beginPath();
      ctx.arc(-s * 0.28, -s * 0.28, s * 0.42, 0, Math.PI * 2);
      ctx.fill();
      /* ③ 小绿叶（梗在右上） */
      ctx.strokeStyle = '#8D6E3A';
      ctx.lineWidth = Math.max(0.7, s * 0.14);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.92);
      ctx.lineTo(s * 0.10, -s * 1.30);
      ctx.stroke();
      ctx.fillStyle = '#7CB342';
      ctx.beginPath();
      ctx.ellipse(s * 0.42, -s * 1.18, s * 0.46, s * 0.26, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
}

/* 颜色 → rgba(...) 小工具（粒子拖尾用，避免引入额外依赖） */
function alphaHex(hex, a) {
  try {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return hex;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  } catch (e) { return hex; }
}

/* ---------------- 可见性 ---------------- */
function visible(r, cam, margin) {
  return r.x + r.w > cam.x - margin && r.x < cam.x + CANVAS_W + margin &&
         r.y + r.h > cam.y - margin && r.y < cam.y + CANVAS_H + margin;
}

/* ---------------- 主渲染 ---------------- */
function render(dt) {
  const ctx = Game.ctx;
  const t = Game.frame / 60;

  // 相机（跟随两人中点）—— 传入 dt，让跟随基于时间而非帧数
  updateCamera(typeof dt === 'number' ? dt : 1 / 60);

  ctx.save();
  // 屏幕震动
  /* ★ 设置里的"屏幕震动"开关在这里统一生效 ★
   * 放在渲染层而不是各个 shake 赋值处，理由：
   *   全项目有 6 处地方在写 Game.shake（受伤/炸弹/冲刺/踩怪…），
   *   逐处加判断必然漏掉一两处（漏了就会出现"关了震动但某个动作还抖"）。
   *   在**唯一读取点**做判断，一处生效、不可能漏。 */
  var shakeOn = true;
  try {
    if (typeof SAVE === 'function') {
      var _s = SAVE().settings ? SAVE().settings() : null;
      if (_s && _s.shakeOn === false) shakeOn = false;
    }
  } catch (e) { /* 存档读不出来就默认开着 */ }
  if (shakeOn && Game.shake > 0.5) {
    ctx.translate((Math.random() - 0.5) * Game.shake, (Math.random() - 0.5) * Game.shake);
  }

  drawSky(ctx, Game.camera);
  drawClouds(ctx, Game.camera, t);
  drawHills(ctx, Game.camera, t);

  /* ============================================================
   * ★★★ 分层背景（2026-10-07 十一要求"彻底重做第 13~20 关背景"）★★★
   * ============================================================
   * 上面那三个函数（drawSky/drawClouds/drawHills）是**旧体系**：
   *   它们只换颜色、不换构图 —— 云坐标写死 7 个、楼群固定 26 栋 i*130 等距，
   *   所以 8 关看起来是"同一排楼换色"（十一的实测反馈，也是 `_bgshot.js`
   *   量化出来的：13 关 vs 20 关天空 RGB 距离只有 12）。
   *
   * 这一段是**新体系**：
   *   bg-theme 给出"这一关的构图配方"（哪支笔、画在哪、多密），
   *   bg-draw 提供笔刷（oldTownRooftops / riverBridge / deepSeaTunnel…）。
   *   ⇒ 每关的**构图本身**不同，而不只是颜色不同。
   *
   * 【调用顺序（很重要）】
   *   1. 天空（旧 drawSky，只是底色；新体系里用 theme.skyBand 压窄可见天空）
   *   2. 云（旧 drawClouds 跳过 —— 改由 layers.cloud 画，支持 'none'）
   *   3. 远/中/近景图层（新）
   *   4. 地标（新）
   *   ⇒ 全都在 **世界坐标 translate 之前**，所以带视差、不跟地图"粘"住。
   *
   * 【★ 向下兼容（项目硬规范）】
   *   · `BG_BL` 不存在（bg-draw.js 被删）→ 整段跳过，退回上面三行的旧体系
   *   · 某关没有 `layers` 配方 → 也退回旧体系
   *   · 任何 painter 抛错 → 只跳过那一层，绝不影响游戏（每层独立 try）
   * ============================================================ */
  try {
    drawLayeredBackground(ctx, Game.camera, t);
  } catch (e) { /* 分层背景失败不影响游戏 */ }

  /* ★ 启动画面（2026-10-06）★
   * 它的背景/标题由 ui.js 的 HTML 层全屏盖住（#splash），
   * 画布这里只需要画个不空的底色，别让启动瞬间闪一下黑屏。
   *
   * ⚠️ 必须加进这个分支列表！踩过的坑：
   *    新界面状态如果漏了这里，render() 会一路走到
   *    drawTiles(ctx, Game.level=null) 然后崩在 null 上，
   *    而 requestAnimationFrame 在 render 之后 ——
   *    一崩就再也不调度下一帧，整个游戏彻底卡死。 */
  if (Game.state === STATE.SPLASH) {
    ctx.restore();
    return;
  }

  if (Game.state === STATE.MENU) {
    drawMenuBackdrop(ctx, t);
    ctx.restore();
    return;
  }

  /* ---- 界面类状态（大厅 / 等待 / 输入房间码 / 选角色 / 关卡选择）
   * 这些界面的按钮由 ui.js 的 HTML 浮层负责，
   * 画布只负责画个好看的背景，别让界面看起来空荡荡。
   *
   * ⚠️ 新增任何"没有关卡"的界面状态时，**必须加到这个列表里**。
   * 踩过的坑：加关卡选择（LEVEL_SELECT）时漏了这里，
   * render() 一路走到 drawTiles(ctx, Game.level=null, cam)，
   * 崩在 `Cannot read properties of null (reading 'tile')`，
   * 而主循环的 requestAnimationFrame 在 render 之后 ——
   * 一崩就再也不调度下一帧，整个游戏彻底卡死（点什么都没反应）。 */
  if (Game.state === STATE.LOBBY || Game.state === STATE.HOSTING ||
      Game.state === STATE.JOINING || Game.state === STATE.SINGLE_PICK ||
      Game.state === STATE.LEVEL_SELECT) {
    drawMenuBackdrop(ctx, t);
    ctx.restore();
    return;
  }

  const lv = Game.level;
  const cam = Game.camera;

  /* 兜底：任何"应该有关卡但实际没有"的情况（比如未来又忘了加分支），
   * 宁可画个背景也不要崩 —— 崩了会连主循环一起带走。 */
  if (!lv) {
    ctx.restore();
    drawMenuBackdrop(ctx, t);
    return;
  }

  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  // 客人：世界状态来自房主，先套用再画
  if (Game.mode === 'online' && Net.role === 'guest') {
    applyRemoteState(typeof dt === 'number' ? dt : 0.016);
  }

  drawTiles(ctx, lv, cam);
  /* ★ 作者彩蛋（2026-10-06）★
   * 画在这里 = **已经在 ctx.translate(-cam.x, -cam.y) 之内**（坑 3）：
   * 所以卡片是"世界坐标"，会跟着地图一起滚动 ——
   * 这也正是十一要的"贴在踏板上方"。
   *
   * ⚠️ 调用点放在 drawTiles 之后、玩家之前：
   *    ① 踏板要盖在地砖上（不然看不见）
   *    ② 卡片要**在玩家之前**画，否则玩家走到卡片前会被卡片挡住
   *      （文档坑 3 特意提了这一点）
   * ⚠️ typeof 保护：egg.js 被删掉时这里直接跳过，游戏照常跑。 */
  try {
    if (typeof drawEggPads === 'function') drawEggPads(ctx, lv, t);
  } catch (e) { /* 彩蛋绘制失败不影响游戏 */ }
  drawSprings(ctx, lv, cam);
  drawSeesaws(ctx, lv, cam);
  drawCoins(ctx, lv, cam, t);
  drawCheckpoints(ctx, lv, t);
  drawButtons(ctx, lv);
  drawDoors(ctx, lv);
  drawBombs(ctx, lv, cam);
  drawEnemies(ctx, lv, cam);

  /* ============================================================
   * ★ 🌊 第 13~20 关机制：绘制（2026-10-06）★
   * ============================================================
   * 画在**敌人之后、玩家之前** —— 这样角色会盖在这些机制上面，
   * 层次是对的（比如"站在水柱上"时人应该在水柱前面）。
   *
   * ⚠️ 每个机制都**必须画出来**，否则会变成"有功能但看不见"——
   *    项目里踩过这个坑（十一原话："有缆车的功能，但是看不见缆车"）。
   *    机制再好，看不见就等于不存在。
   *
   * ⚠️ 整段包 try —— 绘制失败绝不能影响玩家看到角色。
   * ============================================================ */
  try {
    if (typeof drawCh3Mechanics === 'function') drawCh3Mechanics(ctx, lv, cam, t);
  } catch (e) { /* 机制绘制失败不影响游戏 */ }

  // 终点
  let reached = lv.goal && Game.players.every(function (p) { return p.atGoal; });
  drawGoal(ctx, lv, t, reached);

  /* ★ 🛵 外卖车（2026-10-07）★
   * ⚠️ 画在玩家**之前** —— 这样借到力时角色会盖在车上（层次对）。 */
  try {
    if (typeof SCOOTER !== 'undefined' && SCOOTER.current) {
      drawScooters(ctx, t);
    }
  } catch (e) { /* 外卖车画不出来不影响别的 */ }

  // 玩家（后画的在上层）
  for (let i = 0; i < Game.players.length; i++) {
    const p = Game.players[i];
    /* ★ 冲刺残影 ★
     * 画在角色**之前**，这样残影在角色下层，不会挡住本体。
     * 残影是"角色经过的位置"的淡色方块，配合冲刺的高速移动
     * 形成一条拖尾 —— 这是 Celeste 里冲刺最直观的视觉标志。 */
    try {
      if (typeof ACTIONS !== 'undefined' && ACTIONS.drawDashTrail) {
        ACTIONS.drawDashTrail(ctx, p);
      }
    } catch (e) { /* 残影绘制失败不影响游戏 */ }
    drawPlayerEntity(ctx, p, t);
  }

  /* ★ 🛵 加速倒计时（画在角色**之后** = 压在角色上层，方便读）★
   * ⚠️ 必须在 ctx.restore() **之前** —— 这是世界坐标，
   *    跟着角色跑（放进 drawHUD 会固定不动、跟角色脱节）。 */
  try {
    if (typeof SCOOTER !== 'undefined' && SCOOTER.boostRatio) {
      for (let i = 0; i < Game.players.length; i++) drawBoostGauge(ctx, Game.players[i], t);
    }
  } catch (e) { /* 倒计时画不出来不影响别的 */ }

  drawParticles(ctx);
  ctx.restore();

  /* ============================================================
   * ★ 雾（C4 天气，2026-10-06 第 6 期）★
   * ============================================================
   * 十一的硬性要求：
   *   "★'雾'不可以改变任何物理参数★"
   *
   * 【怎么做到"不改物理"】
   *   雾是**纯绘制层**：在世界画完之后、HUD 之前，
   *   盖一层半透明遮罩。
   *   ⇒ 不碰 physics.js、不改 CONFIG、不改任何加速度/速度/重力。
   *     玩家跳跃高度、跑速、冲刺距离**一个像素都没变**，
   *     只是"看不清远处"。
   *
   * 【为什么放在这个位置】
   *   · 在世界层（ctx.restore()）之后 → 能遮住地形、角色、敌人
   *   · 在 drawHUD 之前 → **不会**遮住 HUD
   *     （关键：HUD 有订单进度和计时器，被雾挡住就没法玩了）
   *   · 在受伤闪屏之前 → 闪屏仍然清晰
   *
   * 【为什么不会让关卡变得不可通过】
   *   它只降低"远处"的可见度，近处（玩家周围）是清晰的 ——
   *   见 drawFog 的实现：中心镂空 + 边缘浓。
   *   所以玩家永远能看清自己脚下要踩的地方。
   *   ⚠️ 即便如此，第 6 期仍按方案要求重跑了
   *      reachability-test + coin-test 确认"每关每角色仍可达"。
   * ============================================================ */
  drawWeather(ctx, t, lv);

  // 受伤闪屏
  if (Game.screenFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Game.screenFlash) * 0.4;
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }

  // UI
  drawHUD(ctx, t);
  drawOverlays(ctx, t);

  ctx.restore();
}

/* ============================================================
 * ★ 天气绘制（C4，2026-10-06 第 6 期：**只实现"雾"**）★
 * ============================================================
 * 方案第 6 期把天气分成两类：
 *   · 🌫️ 雾   —— 不影响物理，**低风险** → 只做这一个
 *   · 🌧️ 暴雨 / 💨 大风 / ⚡ 雷电 —— 改变物理，**高风险** → 不做
 *
 * ⚠️⚠️ 十一的硬性要求（务必遵守）：
 *   "只实现'雾'……★'雾'不可以改变任何物理参数★
 *    暴雨 / 大风 / 雷电 三种会改物理的，★一律不要实现★，只留 TODO 注释"
 *
 * ============================================================
 * TODO（明确不做，等十一确认后再议）
 * ============================================================
 * 下面三种**刻意没有实现**，只留下设计说明：
 *
 *   TODO · 🌧️ 暴雨（rain）
 *     · 效果：地面打滑、刹车距离变长
 *     · 拟复用：levels.js 的冰面机制（字符 'I'）
 *     · ⚠️ 会改物理：摩擦系数降低 → 必须重跑
 *       reachability-test.js + coin-test.js，确认滑行后仍能停在平台上
 *
 *   TODO · 💨 大风（wind）
 *     · 效果：侧向持续推力
 *     · 拟复用：传送带/风场（字符 '>' '<' 'w'）
 *     · ⚠️⚠️ 风险最高：可能把玩家吹离平台导致某些订单收不到。
 *       方案特别点名了这一条 —— 如果测试挂了必须回退或调参，不许硬上。
 *
 *   TODO · ⚡ 雷电（storm）
 *     · 效果：定时落雷需躲避
 *     · 拟复用：跳跳怪的定时预警（字符 'j'）
 *     · ⚠️ 会改物理（落雷有击退）；而且这是**唯一会主动伤害玩家**的天气，
 *       和"放松优先"原则冲突，需要十一确认是否值得做。
 * ============================================================
 */
function drawWeather(ctx, t, lv) {
  const w = (lv && lv.weather) ? lv.weather : null;
  if (!w) return;

  /* ============================================================
   * ★ 天气分发（2026-10-06：新增 4 种纯视觉天气）★
   * ============================================================
   * ⚠️⚠️ 所有分支都只**画**，不许改任何物理参数 ⚠️⚠️
   *   十一的铁律：天气是随机的，如果改物理 → 运气决定成败。
   *   所以下面全部是"往屏幕上叠图层"，physics.js 一行都没动。
   *
   * ⚠️ 未知天气值**什么都不画**（安全兜底）：
   *    万一有人手改了关卡数据填了个没实现的名字，
   *    也不会出现奇怪画面或报错。
   * ============================================================ */
  if (w === 'fog')   { drawFog(ctx, t);   return; }
  if (w === 'rain')  { drawRain(ctx, t);  return; }
  if (w === 'snow')  { drawSnow(ctx, t);  return; }
  if (w === 'wind')  { drawWind(ctx, t);  return; }
  /* 夜晚比较特殊：它是"压暗 + 光晕"，会同时影响背景亮度，
   * 所以单独一个函数（下面内部再调用压暗和光晕两步）。 */
  if (w === 'night') { drawNight(ctx, t); return; }
  /* ★ ⚡ 雷电（2026-10-06）：画预警圈 + 雷击 ★
   * 状态在 thunder.js 里，这里只负责"把状态画出来"。 */
  if (w === 'thunder') { drawThunder(ctx, t); return; }
}

/* ============================================================
 * ⚡ 雷电的视觉（2026-10-06）
 * ============================================================
 * 画两样东西：
 *   ① **预警圈**（最重要）—— 告诉玩家"这里马上要落雷，快躲开"
 *   ② 雷击（一道竖雷 + 地面亮斑）
 *
 * ⚠️ 预警圈必须**极其醒目** —— 这是"公平"的载体。
 *    如果玩家看不清圈在哪，落雷就变成了"莫名其妙掉血"。
 *    所以：粗边 + 高对比（黄→红）+ 闪烁。
 *
 * ⚠️ 位置要**减去相机**（世界坐标 → 屏幕坐标），
 *    否则雷会画在错误的地方（跟着地图滚，而不是钉在世界坐标上）。
 * ============================================================ */
/* ============================================================
 * ⚡ 雷击：把"世界里的地面"换算成屏幕 y
 * ============================================================
 * 【为什么单独抽成函数】
 *   预警圈和雷柱**必须用同一个换算**，否则圈画在上面、雷劈在下面，
 *   玩家会以为"圈是骗人的"（这就是"无法预判雷的位置"）。
 *
 * 【踩过的两个坑（2026-10-07）】
 *   ① 读不到相机：原来写 `typeof cam !== 'undefined' && cam`，
 *      但 `cam` 只是 drawScene 里的**局部变量** ⇒ 这里永远拿 0，
 *      雷柱被画到 y=768（画布只有 720）⇒ **玩家完全看不见雷**。
 *      ⇒ 必须读全局的 `Game.camera`。
 *   ② 相机未初始化 / 关卡太矮时，世界地面可能落在画面外。
 *      ⇒ 夹到 [0, CANVAS_H] 之间，保证**雷永远看得见**。
 * ============================================================ */
function thunderGroundScreenY() {
  const engineY = (Game && Game.camera) ? Game.camera.y : 0;
  const rows = (Game.level && Game.level.rows) ? Game.level.rows : 0;
  if (!rows) return CANVAS_H * 0.72;              // 没有关卡 → 退回屏幕比例位置
  let y = (rows - 2) * 32 - engineY;              // 世界地面 → 屏幕
  /* 兜底：夹进可见范围（宁可略微偏，也不能让雷消失） */
  if (y > CANVAS_H - 8) y = CANVAS_H - 8;
  if (y < CANVAS_H * 0.35) y = CANVAS_H * 0.35;   // 别跑到画面顶部去
  return y;
}

function drawThunder(ctx, t) {
  if (typeof THUNDER === 'undefined') return;

  /* ⚠️⚠️ 2026-10-07 血泪：这里原来写 `typeof cam !== 'undefined' && cam`，
   *   但 `cam` 只是 `drawScene` 里的**局部变量**（第 2242 行 `const cam = Game.camera`），
   *   在 `drawThunder` 这个独立函数里**根本读不到** ⇒ 永远走兜底 0。
   *   后果：把雷柱的纵向位置改成世界坐标换算后，
   *   `sy = 768 - 0` = 768 > 画布高 720 ⇒ **雷画到画面外，玩家完全看不见**
   *   （十一报"雷都消失了"）。
   *   ⇒ 必须读**全局的 `Game.camera`**。 */
  const camera = (Game && Game.camera) ? Game.camera : null;
  const camX = camera ? camera.x : 0;

  ctx.save();

  /* ---- ① 预警圈 ---- */
  const tg = THUNDER.pendingTarget ? THUNDER.pendingTarget() : null;
  const warnLeft = THUNDER.warnFramesLeft ? THUNDER.warnFramesLeft() : 0;
  if (tg && warnLeft > 0) {
    const sx = tg.x - camX;
    /* ★ 预警圈和雷柱**必须用同一个换算**（见 thunderGroundScreenY 的说明） */
    const sy = thunderGroundScreenY();
    const total = CONFIG.WEATHER_THUNDER_WARN;
    /* 进度 0→1（越接近落雷越红、闪得越快） */
    const prog = 1 - Math.max(0, warnLeft) / Math.max(1, total);

    /* 圈半径随进度收缩（从大收小 = "锁定"的感觉，比单纯闪烁更有指引性） */
    const r = 52 - prog * 16;

    /* 闪烁：越接近落雷闪得越快 */
    const blinkSpeed = 55 - prog * 35;
    const blink = 0.55 + Math.abs(Math.sin(t * 60 / blinkSpeed)) * 0.45;

    /* 外圈（警示） */
    ctx.globalAlpha = blink;
    ctx.strokeStyle = prog > 0.65 ? 'rgba(255,80,80,0.95)' : 'rgba(255,214,90,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.36, 0, 0, Math.PI * 2);
    ctx.stroke();

    /* 内填充（很淡，让圈"有体积"） */
    ctx.globalAlpha = blink * 0.35;
    ctx.fillStyle = prog > 0.65 ? 'rgba(255,90,90,0.5)' : 'rgba(255,220,110,0.42)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 中心一个感叹号（"注意！"）—— 比纯几何图形更好懂 */
    ctx.globalAlpha = blink;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('!', sx, sy + 6);
    ctx.globalAlpha = 1;
  }

  /* ---- ② 整体暗压（雷雨天的天光很暗）----
   * ★★ 2026-10-07 位置调整（十一报"看不见雷电特效"）★★
   *   原来它排在**雷柱之后** ⇒ 刚画好的雷立刻被压暗 22%，
   *   加上雷柱本来就细（3~6px），实测最高亮度只剩 193（纯白 255）。
   *   ⇒ **挪到雷柱之前**：先压暗世界，再画雷 ⇒ 雷保持全亮度。 */
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(20,22,42,0.22)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  /* ---- ③ 雷击（雷柱 + 地面亮斑）—— 画在暗压之上，保持醒目 ---- */
  const strikes = THUNDER.strikes ? THUNDER.strikes() : [];
  /* ★ 雷柱的纵向判定高度 —— 必须和 thunder.js 的 COL_H 对齐，
   *   否则又会出现"看到的位置 ≠ 判定的位置"（2026-10-07 缺陷 ④）。 */
  const colH = (THUNDER.columnHeight ? THUNDER.columnHeight() : 320);
  for (let i = 0; i < strikes.length; i++) {
    const s = strikes[i];
    const lifeP = Math.max(0, s.life) / Math.max(1, s.maxLife);   // 1→0 淡出
    const sx = s.x - camX;
    /* ★★ 2026-10-07 修缺陷 ④：雷柱纵向位置改成**世界坐标换算** ★★
     * ------------------------------------------------------------
     * 【原来错在哪】写死 `sy = CANVAS_H * 0.72`（屏幕固定高度 518px）。
     *   而伤害判定用的是**世界坐标**（从关卡地面往上 COL_H）。
     *   关卡高 832~1344px 必须滚屏 ⇒ 相机一动，玩家在屏幕上看到
     *   雷柱的位置就和实际判定位置对不上了（"什么都没看到却掉血"）。
     *
     * 【现在】雷柱的**落点**取关卡地面（世界坐标），再减去 camY
     *   转成屏幕坐标 ⇒ 它钉在"世界里的地面"上，跟着画面一起滚。
     *   ⚠️ 用同一个辅助函数（thunderGroundScreenY），
     *      保证雷柱和预警圈**位置完全一致**。 */
    const sy = thunderGroundScreenY();
    /* 雷柱从屏幕顶端一直劈到地面（见 thunderGroundScreenY 的说明） */
    const topY = Math.min(sy - colH, 0);
    const botY = Math.max(sy, 0);

    /* ============================================================
     * ★★★ 2026-10-07 加粗加亮（十一报"看不见雷电特效"）★★★
     * ============================================================
     * 【原来为什么看不见】
     *   ① 主干只有 `3 + lifeP*3` = **3~6px**，光晕 11px ——
     *      在 1280×720 的画布里细得像根头发丝；
     *   ② 紧接着有一层"整体暗压"（`rgba(20,22,42,0.22)`）铺满全屏，
     *      把刚画的雷**又压暗 22%**；
     *   ③ 落雷瞬间同时触发的"受伤闪屏"（红色 0.4 alpha）也会盖一层。
     *   ⇒ 三重叠加后，实测雷柱区域的最高亮度只剩 **193**（纯白是 255），
     *     在满屏噪点般的雨点里根本认不出来。
     *
     * 【修法】
     *   ① 主干加粗到 **7~14px**，光晕加粗到 **26px**；
     *   ② 颜色改成**不透明纯白**（去掉 0.95 的透明度损耗）；
     *   ③ 暗压**挪到雷柱之前**画（先压暗世界，再画雷，雷就不会被压）；
     *   ④ 加一圈**径向光晕**包住雷柱，让它"发光"而不是一根白线。
     * ============================================================ */
    /* ④ 先铺一层径向光晕（让雷柱周围亮起来，远看就是一团白光） */
    const glow = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
    glow.addColorStop(0, 'rgba(200,220,255,0)');
    glow.addColorStop(0.5, 'rgba(215,230,255,' + (0.55 * lifeP).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 60, topY, 120, botY - topY);

    /* ②③ 主干：不透明亮白，加粗（闪电不该是笔直的，带抖动） */
    ctx.globalAlpha = Math.min(1, 0.55 + lifeP * 0.45);
    ctx.strokeStyle = 'rgb(255,255,250)';
    ctx.lineWidth = 10 + lifeP * 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, topY);
    let zx = sx;
    for (let y = topY; y <= botY; y += 30) {
      zx += (Math.sin(y * 0.7 + t * 30 + i) * 9);
      ctx.lineTo(zx, y);
    }
    ctx.lineTo(sx, botY);
    ctx.stroke();

    /* 外层光晕（再加粗一圈淡蓝，做出"爆闪"感） */
    ctx.globalAlpha = lifeP * 0.6;
    ctx.strokeStyle = 'rgba(170,215,255,0.9)';
    ctx.lineWidth = 26 * lifeP;
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* 落点亮斑（地面炸开的白光） */
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 96 * lifeP + 30);
    rg.addColorStop(0, 'rgba(255,255,240,' + (0.95 * lifeP).toFixed(3) + ')');
    rg.addColorStop(0.45, 'rgba(255,246,200,' + (0.55 * lifeP).toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = rg;
    ctx.fillRect(sx - 130, sy - 70, 260, 140);

    /* 地面一道横向白线（"雷劈到地面"的接触感） */
    ctx.globalAlpha = lifeP * 0.85;
    ctx.strokeStyle = 'rgb(255,255,245)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx - 70, sy);
    ctx.lineTo(sx + 70, sy);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/* ============================================================
 * 🌧️ 小雨（纯视觉）
 * ============================================================
 * 十一的要求："斜向雨丝，约 15° 倾角，半透明淡色，稀疏不糊屏"
 *
 * 【为什么必须"稀疏"】
 *   雨丝画密了会糊成一片灰，把地形和尖刺都盖住 ——
 *   虽然不改物理，但**看不清就是实质变难**。
 *   ⇒ 只画 90 条，且透明度低（0.25~0.45）。
 *
 * 【为什么用"下落的循环位置"而不是随机重画】
 *   每帧随机会让雨丝"抖"得像噪点。这里的做法是：
 *   每条雨丝有一个固定的起点 + 一个随时间前进的相位，
 *   走到屏幕外就回到顶部 —— 看起来是"持续下落的雨"。
 * ============================================================ */
function drawRain(ctx, t) {
  const N = 90;                       // 雨丝条数（稀疏）
  const TILT = Math.tan(15 * Math.PI / 180);   // 15° 倾角对应的水平偏移比
  const LEN = 26;                     // 雨丝长度

  ctx.save();
  ctx.lineCap = 'butt';

  for (let i = 0; i < N; i++) {
    /* 用固定的伪随机（基于下标）分配"每滴雨自己的属性"，
     * 保证每一帧的雨丝是同一批，只是位置在下移。 */
    const seedX = ((i * 7919) % 997) / 997;          // 0~1
    const seedY = ((i * 6271) % 991) / 991;          // 0~1
    const speed = 620 + ((i * 4231) % 200);          // 下落速度（像素/秒）
    const alpha = 0.20 + ((i * 3571) % 100) / 100 * 0.25;   // 0.20~0.45

    /* 竖直循环：y 从 -LEN 到 CANVAS_H，走到头就回顶 */
    const spanY = CANVAS_H + LEN * 2;
    let y = ((seedY * spanY + t * speed) % spanY) - LEN;
    /* 水平位置 + 倾斜偏移（雨往下走的同时往右偏，形成斜线） */
    const baseX = seedX * (CANVAS_W + 120) - 60;
    const x = baseX + y * TILT;

    ctx.strokeStyle = 'rgba(186,214,240,' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 1 + ((i % 3) === 0 ? 1 : 0);   // 少量粗一点的雨丝，有层次
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + LEN * TILT, y + LEN);
    ctx.stroke();
  }

  /* 整体压一层极淡的冷色，营造"阴雨天"的色温（不遮细节） */
  ctx.fillStyle = 'rgba(120,150,185,0.10)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

/* ============================================================
 * ❄️ 飘雪（纯视觉）
 * ============================================================
 * 十一的要求："白色像素小点，sin 摆动下落，大小有层次"
 *
 * 【和雨的区别】
 *   雨是"快、直、细线"；雪是"慢、摆、小方块"。
 *   雪的横向用 sin 摆动（像被微风带着飘），速度慢得多。
 * ============================================================ */
function drawSnow(ctx, t) {
  const N = 70;

  ctx.save();
  for (let i = 0; i < N; i++) {
    const seedX = ((i * 6823) % 983) / 983;
    const seedY = ((i * 4801) % 977) / 977;
    const speed = 55 + ((i * 3203) % 90);            // 下落很慢（55~145）
    const swayAmp = 8 + ((i * 2687) % 22);           // 摆动幅度
    const swayFreq = 0.6 + ((i * 1997) % 100) / 100 * 0.9;
    /* 大小有层次：3 档 */
    const size = 2 + (i % 3);

    const spanY = CANVAS_H + 20;
    const y = ((seedY * spanY + t * speed) % spanY) - 10;
    const baseX = seedX * (CANVAS_W + 40) - 20;
    /* sin 摆动：相位用 seedX 错开，避免所有雪花同步摆 */
    const x = baseX + Math.sin(t * swayFreq + seedX * 6.28) * swayAmp;

    ctx.fillStyle = 'rgba(255,255,255,' + (0.5 + (i % 3) * 0.16).toFixed(2) + ')';
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
  }

  /* 淡冷色压层，营造雪天调子 */
  ctx.fillStyle = 'rgba(200,220,240,0.08)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

/* ============================================================
 * 💨 大风 · 落叶（纯视觉，★角色完全不受影响★）
 * ============================================================
 * 十一的要求："只画落叶/纸片横飞（带旋转），角色★完全不受影响★"
 *
 * ⚠️⚠️ 这一条最容易写错 ⚠️⚠️
 *   名叫"大风"，但**绝对不能真的给角色加力**。
 *   落叶只是"在飘"，角色该跳多高还跳多高、该跑多快还跑多快。
 *   ⇒ 这个函数里**只读 t**，不碰 Game.players、不碰任何物理量。
 *
 * 【叶子怎么画】
 *   小矩形（黄/橙/褐三色）+ 按时间旋转 ——
 *   旋转让它看起来是"打着转的叶子"，而不是"飞过的方块"。
 * ============================================================ */
function drawWind(ctx, t) {
  const N = 55;                      // 落叶数量

  ctx.save();
  for (let i = 0; i < N; i++) {
    const seedX = ((i * 5501) % 967) / 967;
    const seedY = ((i * 4463) % 953) / 953;
    const speed = 180 + ((i * 3671) % 240);          // 横向速度（比雨慢、比雪快）
    const bobAmp = 6 + ((i * 2347) % 22);            // 上下浮动
    const bobFreq = 0.8 + ((i * 1723) % 100) / 100 * 1.2;
    const spin = (i % 2 ? 1 : -1) * (1.5 + ((i * 1471) % 100) / 100 * 2.5);  // 旋转速度
    /* ★ 叶片尺寸：4~8 → 9~17 ★
     *   为什么不保持小尺寸：实测 4~8px 的叶片在 1280×720 里
     *   只占了 0.08% 的像素 —— 玩家**根本注意不到**，
     *   等于"大风"这个天气白做了（有测试量化守着，见 celeste-browser-test 5.8）。
     *   放大到 9~17px 后才有"叶子在飞"的观感。 */
    const size = 9 + (i % 3) * 4;

    /* 横向循环：从右往左飞（像逆风送单） */
    const spanX = CANVAS_W + 80;
    let x = CANVAS_W + 40 - ((seedX * spanX + t * speed) % spanX);
    const y = seedY * CANVAS_H + Math.sin(t * bobFreq + seedX * 6.28) * bobAmp;

    /* 三种叶色（秋叶），比之前更不透明一点 */
    const cols = ['rgba(224,166,50,0.85)', 'rgba(202,116,54,0.82)', 'rgba(164,130,64,0.8)'];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * spin + seedX * 6.28);             // 打转
    ctx.fillStyle = cols[i % 3];
    /* 画成"竖着的叶形"（长条 + 一点尖），比纯方块更像叶子 */
    ctx.fillRect(-size * 0.30, -size * 0.5, size * 0.6, size);
    ctx.fillRect(-size * 0.14, -size * 0.62, size * 0.28, size * 0.16);
    ctx.restore();
  }
  ctx.restore();
}

/* ============================================================
 * 🌙 夜晚配送（纯视觉）
 * ============================================================
 * 十一的要求："整体压暗（深蓝半透明）+ 角色周围暖黄光晕"
 * 并且特别提醒："⚠️ 注意可玩性：压暗后玩家还要能看清平台和尖刺。
 *              太暗就把 alpha 调低。"
 *
 * 【怎么做到"暗但看得清"】
 *   ① 压暗层的 alpha **只到 0.42** —— 能明显看出是夜晚，
 *      但地形轮廓仍然可辨（试出来的：0.55 开始尖刺就分不清了）
 *   ② 角色周围一圈**暖黄光晕**（径向渐变，中心提亮）——
 *      既符合"车灯/路灯"的意象，又把玩家最需要看清的
 *      "自己周围那一片"照亮
 *
 * ⚠️ 光晕的设计和"雾"正好相反：
 *   雾是"中心清晰 + 边缘更浓"（怕看不清远处）；
 *   夜是"整体暗 + 中心更亮"（照亮玩家身边）。
 *   两者都是"保证玩家能看清要踩的地方"，思路一致。
 * ============================================================ */
function drawNight(ctx, t) {
  ctx.save();

  /* ---- ① 深蓝压暗（alpha 0.42：够暗但还看得清地形）---- */
  ctx.fillStyle = 'rgba(12,18,46,0.42)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  /* ---- ② 角色周围的暖黄光晕 ----
   * 取玩家屏幕位置（世界坐标 → 屏幕坐标要减相机）。
   * ⚠️ 这里只是**读**相机和角色位置用于绘制，不改任何东西。 */
  let cxs = CANVAS_W / 2, cys = CANVAS_H / 2;
  try {
    const p = Game.players && Game.players[0];
    if (p && typeof cam !== 'undefined' && cam) {
      cxs = p.x + p.w / 2 - cam.x;
      cys = p.y + p.h / 2 - cam.y;
    }
  } catch (e) { /* 取不到就退回屏幕中心，不影响正常游戏 */ }

  const R = 190;
  const g = ctx.createRadialGradient(cxs, cys, R * 0.12, cxs, cys, R);
  g.addColorStop(0, 'rgba(255,226,150,0.30)');       // 中心暖黄
  g.addColorStop(0.45, 'rgba(255,208,120,0.14)');
  g.addColorStop(1, 'rgba(255,200,110,0)');
  ctx.fillStyle = g;
  /* 用 'lighter' 让光晕是"加亮"而不是"盖一层色" */
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.arc(cxs, cys, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  /* ---- ③ 几盏远处的路灯光点（点缀氛围，很淡）---- */
  const lamps = [0.18, 0.42, 0.68, 0.88];
  for (let i = 0; i < lamps.length; i++) {
    const lx = lamps[i] * CANVAS_W;
    const ly = CANVAS_H * (0.30 + (i % 2) * 0.12);
    const pulse = 0.5 + Math.sin(t * 1.6 + i) * 0.08;   // 轻微呼吸
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 46);
    lg.addColorStop(0, 'rgba(255,228,160,' + (0.26 * pulse).toFixed(3) + ')');
    lg.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(lx - 46, ly - 46, 92, 92);
  }

  ctx.restore();
}

/* ------------------------------------------------------------
 * 雾：中心清晰 + 边缘浓的半透明遮罩
 * ------------------------------------------------------------
 * 【设计要点：为什么不是"均匀糊一层"】
 *   均匀遮罩会把整个画面糊掉，玩家看不清脚下 —— 那是在**恶心人**，
 *   不是在营造氛围。而且会实质提升难度（虽然没改物理）。
 *
 *   所以用"中心镂空"：
 *     · 玩家所在的屏幕中央区域 → 几乎全透明（看得清）
 *     · 越往边缘 → 雾越浓（营造"看不远"的氛围）
 *   效果上就是"视野受限"而不是"屏幕脏了"。
 *
 * 【怎么动】
 *   两三个大的雾团缓慢横向漂移（不同速度 + 不同相位），
 *   叠在渐变遮罩上 —— 看起来像真的雾在流动，而不是一张静态贴图。
 *   用 sin 而不是随机：随机会让雾团"抖"，像 bug。
 *
 * @param t  累计时间（秒）
 * ------------------------------------------------------------ */
function drawFog(ctx, t) {
  ctx.save();

  /* ---- ① 底色：一层均匀的淡雾（让整体偏灰白） ---- */
  ctx.fillStyle = 'rgba(206,214,220,0.26)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  /* ---- ② 中心镂空：用径向渐变把"玩家周围"提亮回来 ----
   * 中心 alpha 0.16（很淡）→ 边缘 alpha 0.62（较浓）
   * ⚠️ 中心不是全透明，留一点雾感（全透明就不像雾了）。 */
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H * 0.56;          // 略低于中心（玩家的视线重心）
  const R = Math.min(CANVAS_W, CANVAS_H) * 0.62;
  const g = ctx.createRadialGradient(cx, cy, R * 0.28, cx, cy, R);
  g.addColorStop(0, 'rgba(214,222,228,0.10)');
  g.addColorStop(0.55, 'rgba(210,218,224,0.34)');
  g.addColorStop(1, 'rgba(206,214,220,0.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  /* ---- ③ 漂移的雾团：3 团，不同速度/相位/大小 ---- */
  const puffs = [
    { y: CANVAS_H * 0.30, speed: 12, phase: 0.0, r: 210, a: 0.15 },
    { y: CANVAS_H * 0.58, speed: -8, phase: 1.7, r: 260, a: 0.13 },
    { y: CANVAS_H * 0.82, speed: 6,  phase: 3.1, r: 180, a: 0.11 },
  ];
  puffs.forEach(function (p) {
    /* 横向漂移：从 -r 到 CANVAS_W+r 循环。
     * 用取模保证无缝循环（不会"跳"回左边）。 */
    const span = CANVAS_W + p.r * 2;
    let px = ((t * p.speed + p.phase * 137) % span);
    if (px < 0) px += span;
    px -= p.r;

    const rg = ctx.createRadialGradient(px, p.y, 0, px, p.y, p.r);
    rg.addColorStop(0, 'rgba(232,238,242,' + p.a + ')');
    rg.addColorStop(0.6, 'rgba(222,230,236,' + (p.a * 0.5).toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(214,222,228,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(px - p.r, p.y - p.r, p.r * 2, p.r * 2);
  });

  ctx.restore();
}

function updateCamera(dt) {
  // 菜单 / 启动页 / 大厅 / 选角色等界面没有关卡，相机归零
  if (Game.state === STATE.MENU || Game.state === STATE.SPLASH ||
      Game.state === STATE.LOBBY ||
      Game.state === STATE.HOSTING || Game.state === STATE.JOINING ||
      Game.state === STATE.SINGLE_PICK || !Game.level) {
    Game.camera.x = 0;
    Game.camera.y = 0;
    return;
  }
  const ps = Game.players;
  if (!ps.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ps.length; i++) {
    minX = Math.min(minX, ps[i].x);
    maxX = Math.max(maxX, ps[i].x + ps[i].w);
    minY = Math.min(minY, ps[i].y);
    maxY = Math.max(maxY, ps[i].y + ps[i].h);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const targetX = cx - CANVAS_W / 2;
  const targetY = cy - CANVAS_H / 2;

  const lv = Game.level;

  /* ⚠️ 相机收敛也要**基于时间**，不能用固定帧系数（原来是 * 0.12）。
   *
   * 原因：联机时画面更新率不稳定（快照 160~600ms 一次）。
   * 固定帧系数会让相机"追得忽快忽慢"，
   * 表现为画面整体在抖 —— 比角色自己抖更明显、更晕。
   *
   * 时间基准后，无论 30fps 还是 144fps，相机跟随的"手感速度"一致。
   * 系数 0.08 秒 ≈ 80ms 追上目标，比角色插值略慢一点（更稳）。
   *
   * 另外**相机比角色更平滑**是有意的：
   * 视角轻微滞后会让人感觉"人物跑得快"，反而提升速度感。 */
  if (!(dt > 0)) dt = 1 / 60;
  if (dt > 0.1) dt = 0.1;
  const camFactor = 1 - Math.exp(-dt / 0.08);

  Game.camera.x += (targetX - Game.camera.x) * camFactor;
  Game.camera.y += (targetY - Game.camera.y) * camFactor;
  Game.camera.x = Math.max(0, Math.min(Game.camera.x, lv.width - CANVAS_W));
  Game.camera.y = Math.max(-40, Math.min(Game.camera.y, lv.height - CANVAS_H));
}

function drawPlayerEntity(ctx, p, t) {
  // 无敌闪烁
  if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0) return;

  /* ============================================================
   * ★ 行走动作（2026-10-06 新增）★
   * ============================================================
   * 十一要求："增加美团袋鼠和飞龙宝宝的行走动作。"
   *
   * 原理见 sprites.js 的 WALK 注释 —— 简单说就是
   * "上下起伏 + 左右摇摆 + 轻微挤压"，而不是去动腿部像素
   * （角色的腿在屏幕上只有 1px 高，动它根本看不见）。
   *
   * 这里把三个分量算出来，作用到下面的：
   *   bob    → 绘制时的 y（抬起来）
   *   sway   → 绘制时的 x（左右换重心）
   *   squash → 已有的挤压系数（和跳跃的 squash 叠加）
   *
   * ⚠️ 全部走 try 保护：行走动画出问题绝不能让角色画不出来。 */
  let wBob = 0, wSway = 0, wSquash = 1, wLean = 0;
  /* ★ 「十一」专属：腿摆动（2026-10-07）—— 只有她非 0 */
  let wLegSwing = 0, wLegPhase = 0;
  /* ★ 「噜噜」专属：箱子倾斜（2026-10-07）—— 只有它非 0 */
  let wTiltSwing = 0;
  try {
    if (typeof walkMotion === 'function') {
      /* ★ 2026-10-07：把 role 传进去 —— 每个角色一套走路动画 ★
       * ⚠️ 不传 role 时 walkMotion 用默认参数（= 改造前行为），
       *    所以这里传 p.role 是"升级"，不是"改变物理"。 */
      const wm = walkMotion(p.animT, p.vx, p.onGround, p.role);
      wBob = wm.bob; wSway = wm.sway; wSquash = wm.squash;
      wLean = wm.lean || 0;         // ★ 前倾（冲刺型角色"压着跑"）
      /* ★ 「十一」的腿摆动（2026-10-07）—— 其他角色这里是 0 */
      wLegSwing = wm.legSwing || 0;
      wLegPhase = wm.legPhase || 0;
      /* ★ 「噜噜」的箱子倾斜（2026-10-07）—— 其他角色这里是 0 */
      wTiltSwing = wm.tiltSwing || 0;
    }
  } catch (e) { /* 忽略：退回静态站姿 */ }

  /* ============================================================
   * ★ 「十一」专属：静止时握棒棒糖（2026-10-07 十一要求）★
   * ============================================================
   * 判定条件（都在这里算一次，下面绘制直接用）：
   *   ① 她的动画配置里开了 `lollipop`
   *   ② **站在地面上**
   *   ③ **几乎不动**（|vx| < 0.5 —— 和"走路动画"的阈值一致）
   *   ④ 不在翻滚 / 不在贴墙 / 不在冲刺（那些状态她手上有别的事）
   * ⇒ 一停下来就掏糖，一走/跳就收起来。
   * ⚠️ 其他角色这条恒为 false，完全不受影响。
   * ============================================================ */
  try {
    const pM = (typeof motionFor === 'function') ? motionFor(p.role) : null;
    p._showLollipop = !!(pM && pM.lollipop && p.onGround &&
      Math.abs(p.vx || 0) < 0.5 && p.spinT <= 0 &&
      !p.actWallDir && !p.dashing);
  } catch (e) { p._showLollipop = false; }

  /* ============================================================
   * ★ 「噜噜」专属：挂机 5 秒 → 掏出橘子（2026-10-07 十一要求）★
   * ============================================================
   * 判定条件：
   *   ① 它的动画配置里开了 `idleOrange`
   *   ② `_idleT >= 5`（连续静止秒数，game.js 里算的 ——
   *      站着不动才累计，一动/离地就归零）
   *   ③ 不在翻滚
   * ⇒ 静止满 5 秒就掏橘子，一动就收起来。
   * ⚠️ 其他角色这条恒为 false，完全不受影响。
   * ============================================================ */
  try {
    const pM2 = (typeof motionFor === 'function') ? motionFor(p.role) : null;
    p._idleOrangeShow = !!(pM2 && pM2.idleOrange &&
      typeof p._idleT === 'number' && p._idleT >= 5 && p.spinT <= 0);
  } catch (e) { p._idleOrangeShow = false; }

  /* 走路起伏（原来已有的"小跳感"，和新的行走摆动叠加） */
  let bob = 0;
  if (p.onGround && Math.abs(p.vx) > 0.5) bob = Math.abs(Math.sin(p.animT * 14)) * 3;
  bob += wBob;

  /* ---- 二连跳空中翻滚 ----
   * 进度 0 → 1，用 easing 让它"起手快、收尾稳"，转起来更利落。
   * 方向跟着朝向走（朝左就逆时针），符合视觉习惯。 */
  let spin = 0;
  let airStretch = 1;
  /* ★ 角色专属翻滚特征（2026-10-07 十一要求）★
   * 不同角色翻起来不一样：碧琪转得最快（像上发条）、
   * 尼克拉得最开（呼应二段跳最狠）、小鱼翻滚带摆尾。 */
  let spinTilt = 0;
  /* ★ 「十一」专属：二段跳的"撒糖霜"强度（0 = 不画）*/
  let candyHopStretch = 0;
  /* ★ 「噜噜」专属：二段跳的"箱子弹簧"强度（0 = 不画）*/
  let boxHopStretch = 0;
  if (p.spinT > 0 && p.spinDur > 0) {
    const prog = 1 - (p.spinT / p.spinDur);         // 0 → 1
    // easeInOutCubic：起步和收尾都缓一点，中间转得快
    const e = prog < 0.5
      ? 4 * prog * prog * prog
      : 1 - Math.pow(-2 * prog + 2, 3) / 2;
    /* 角色特征：查不到就全用中性值（= 改造前的行为） */
    let sm = { spinMul: 1, spinStretch: 1, tilt: 0 };
    try {
      if (typeof spinMotionFor === 'function') sm = spinMotionFor(p.role);
    } catch (err) { /* 查不到就按标准翻滚画 */ }
    /* ⚠️ 转的角度乘 spinMul —— 转得更快/更多圈。
     * ★ spinMul = 0 的角色（「十一」）这里 spin 恒为 0 ⇒ **完全不翻滚**。 */
    spin = e * Math.PI * 2 * sm.spinMul * (p.dir < 0 ? -1 : 1);
    /* 翻滚时额外拉长一点，表现"身体绷紧旋转"。
     * 但拉多少**按角色**：尼克 1.35（舒展）、史迪奇 0.9（团紧）。 */
    airStretch = 0.92 / sm.spinStretch;
    /* 翻滚的横向摆尾（只有"游动型"角色有）—— 用旋转角的 sin 做偏移 */
    if (sm.tilt) spinTilt = Math.sin(spin) * sm.tilt * 6;

    /* ============================================================
     * ★★★ 「十一」专属：二段跳**不翻滚**，改成"甜甜地向上蹦" ★★★
     * ============================================================
     * 十一原话："跳跃的时候就不要翻滚了，重新设计一个动作。"
     *
     * 【新动作是什么】
     *   不走"翻转"路线（那是运动型角色的炫技），
     *   改成**甜品主题的可爱动作**：
     *     · **向上拉长**（身体舒展开，像被拽了一下）
     *     · **微微后仰**（仰头看天，甜甜的）
     *     · **撒糖霜**：从她身上飞出粉色糖霜/小星星
     *
     * 【怎么实现的】
     *   `hopStyle === 'candy'` 时：
     *     · 把 airStretch 改成"更强的纵向拉伸"（比翻滚的 0.92 更夸张）
     *     · 记一个标记，稍后在角色上方画糖霜粒子
     *   ⚠️ 因为 spinMul = 0，spin 已经是 0 ⇒ 天然不旋转，
     *     这里只是**替换**掉原本"翻滚拉伸"的表现，不碰物理。
     * ============================================================ */
    if (sm.hopStyle === 'candy') {
      const bell = Math.sin(prog * Math.PI);        // 中段最强（0→1→0）
      airStretch = 1 - 0.14 * bell;                 // 纵向明显拉长
      candyHopStretch = bell;                       // 给下面的糖霜用
    }

    /* ============================================================
     * ★★★ 「噜噜」专属：二段跳**不翻滚**，改成「箱子弹簧」 ★★★
     * ============================================================
     * 十一："二段跳要设计一个专属动作。"
     *
     * 【设计】噜噜套着恐龙纸箱，最好的二段跳不是翻滚（水豚懒得翻），
     *   而是**像弹簧一样：先整个缩一下蓄力，再猛地拉长弹出去**
     *   —— 笨重但很努力，符合它"佛系但不躺平"的人设。
     *
     * 【曲线】用两个**高斯函数**叠出"先压后弹"：
     *     · 前一个峰在 prog=0.30 → 负责"压缩蓄力"（比 1 小）
     *     · 后一个峰在 prog=0.62 → 负责"拉长弹射"（比 1 大）
     *   为什么用高斯而不是分段 if：
     *     分段在交界处会**突变**（画面"咔"地一跳），
     *     高斯是光滑曲线，压→弹的过渡自然。
     *   实测曲线：1.00 → 0.83（最压）→ 1.26（最弹）→ 1.01
     * ============================================================ */
    if (sm.hopStyle === 'box') {
      const g1 = Math.exp(-Math.pow((prog - 0.30) / 0.16, 2));   // 压缩峰
      const g2 = Math.exp(-Math.pow((prog - 0.62) / 0.22, 2));   // 弹射峰
      airStretch = 1 - 0.20 * g1 + 0.26 * g2;
      boxHopStretch = Math.max(g1 * 0.55, g2);                   // 给橘子气浪用
    }
  }

  /* ---- 新动作的姿态表现（滑墙 / 抓墙 / 冲刺）----
   * 设计原则：**姿态本身就是最直接的反馈**。
   * 玩家不需要看 HUD 就能知道"我正在贴墙/正在冲刺"。 */
  let poseX = p.x;
  let poseSquash = p.squash * airStretch;

  /* ① 行走：横向摇摆（重心换脚）+ 挤压拉伸
   *    sway 只在地面且有速度时才会非 0（见 sprites.js 的 walkMotion），
   *    所以"停下来 → 自动归位"，不需要额外判断。
   *
   *    ⚠️ 叠加方式用**乘法**而不是赋值：
   *       下面的贴墙/冲刺姿态也会改 poseSquash，
   *       用乘法才能让"边走边冲"这类组合姿态都对。 */
  poseX += wSway;
  poseSquash *= wSquash;
  /* ★ 翻滚时的横向摆尾（2026-10-07）★
   * 只有"游动型"角色（小鱼）的 tilt 非 0 —— 它翻滚时左右摆，像摆尾游动。
   * 其它角色 tilt = 0，这一行等于没执行。 */
  poseX += spinTilt;

  /* ①·五 ★ 卡皮巴拉专属跳跃姿态（2026-10-06 新增）★
   * ============================================================
   * 十一要求："要有他的独特跳跃动作。"
   *
   * 只有卡皮巴拉走这套（蓄力下蹲 → 蹬地压扁 → 空中抱团），
   * 袋鼠和飞龙保持原来的表现 —— 这样三个角色的跳跃**形态**不同，
   * 而不只是数值不同（数值差异玩家根本看不出来）。
   *
   * ⚠️ 只改绘制，不碰物理 —— 所以不影响任何关卡的可行性，
   *    也不用重跑"每关 × 每角色"的可通关验证。
   * ⚠️ 用乘法叠加（和冲刺/贴墙共存），异常时自动退回中性值。 */
  let capyYOff = 0;
  if (p.role === 'capybara') {
    try {
      if (typeof capybaraJumpPose === 'function') {
        const cp = capybaraJumpPose(p);
        poseSquash *= cp.squash;
        capyYOff = cp.yOff;
      }
    } catch (e) { /* 姿态算不出来 → 正常画，不影响可玩性 */ }
  }

  /* ★ 史迪奇宝宝的专属跳跃姿态（2026-10-06）★
   * "蹬地张牙"—— 极短蓄力 + 极度拉长，和卡皮巴拉的"压扁弹球"正相反。
   * ⚠️ 同样只改绘制，不碰物理。 */
  if (p.role === 'stitch') {
    try {
      if (typeof stitchJumpPose === 'function') {
        const sp = stitchJumpPose(p);
        poseSquash *= sp.squash;
        capyYOff += sp.yOff;
      }
    } catch (e) { /* 姿态算不出来 → 正常画 */ }
  }

  /* ① 贴墙滑行 / 抓墙：身体微微倾斜（像扒着墙），并沿墙面收窄一点，
   *    表现"侧身贴住"的感觉。抓墙（主动）倾得更明显。 */
  if (p.actWallDir) {
    const lean = p.actGrabHeld ? 0.10 : 0.05;
    // ctx 的倾斜要在画角色时做，这里只记录角度，交给 drawCharacter 外层
    poseSquash *= 0.94;              // 侧身 → 视觉上窄一点
    p._poseLean = lean * p.actWallDir;
  } else {
    p._poseLean = 0;
  }

  /* ② 冲刺：身体沿冲刺方向拉长（横向冲刺 → 变长条形，纵向 → 变高条），
   *    这是"高速运动"最直观的视觉语言。 */
  if (p.actDashT > 0) {
    const horizontal = Math.abs(p.actDashDirX) > 0.01;
    if (horizontal) poseSquash *= 1.28;   // 宽 → 横着拉伸
    else poseSquash *= 0.78;              // 高 → 竖着拉伸
  }

  /* ③ 抓墙体力快耗尽：身体抖动（危险预警）
   *    频率随时间加快，像"抓不住了"。 */
  if (p.actWallDir && p.actGrabHeld) {
    const P = (typeof CELESTE !== 'undefined') ? CELESTE : null;
    const ratio = P ? (p.actGrabStamina / P.grabStaminaFrames) : 1;
    if (ratio < 0.35) {
      const urgency = 1 - ratio / 0.35;         // 0 → 1（越少越急）
      const amp = 1.2 * urgency;
      poseX += Math.sin(t * 0.09 + p.x * 0.3) * amp;
    }
  }

  // 影子
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(p.x + p.w / 2, p.y + p.h + 2, p.w * 0.5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* ★ 走路前倾（2026-10-07 加）—— 冲刺型角色的"压着跑"★
   * ⚠️ 和贴墙的 lean 分开处理：
   *    贴墙 lean 是"往墙面歪"，绕的是靠墙那条边；
   *    走路前倾是"整体朝前压"，绕的是**脚底中心**。
   *    两者可以叠加（贴着墙冲刺时既歪又前倾，是正确的）。
   * ⚠️ 方向跟着朝向走：朝右 → 顺时针压；朝左 → 反过来。 */
  let walkLeanApplied = false;
  if (wLean) {
    const dirSign = p.dir < 0 ? -1 : 1;
    const lx = poseX + p.w / 2;
    const ly = p.y + p.h;                    // 脚底
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(wLean * dirSign);
    ctx.translate(-lx, -ly);
    walkLeanApplied = true;
  }

  /* ============================================================
   * ★ 「噜噜」专属：走路时**箱子一摇一摆**（2026-10-07 十一要求）★
   * ============================================================
   * 十一："走路的话要设计专属动作。"
   *
   * 【设计】噜噜整个身子套在恐龙纸箱里，所以它走路最像的姿态是
   *   **箱子像不倒翁一样左右晃着往前挪** —— 而不是小短腿快步走。
   *
   * 【怎么实现】绕**脚底中心**旋转（和走路前倾同一个支点）：
   *   支点选脚底，箱子才会"左右倒"而不是"原地转"。
   *   角度来自 walkMotion 的 `tiltSwing`（sin 驱动，和 sway 同相 ——
   *   重心偏左时箱子也往左歪，动作才自洽）。
   *
   * ⚠️ 只有噜噜开 tiltSwing ⇒ 其他角色这里恒为 0，完全不受影响。
   * ⚠️ 幅度很小（0.055 rad ≈ 3°）—— 再大会像"要摔倒"。
   * ============================================================ */
  let boxTiltApplied = false;
  if (wTiltSwing) {
    const bx = poseX + p.w / 2;
    const by = p.y + p.h;                    // 脚底
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(wTiltSwing);
    ctx.translate(-bx, -by);
    boxTiltApplied = true;
  }
  /* 贴墙时绕"靠墙那一侧"倾斜（像扒着墙），而不是绕中心 ——
   * 绕中心转会让脚离墙，看着穿模。 */
  const lean = p._poseLean || 0;
  if (lean) {
    const pivotX = lean > 0 ? (poseX + p.w) : poseX;   // 靠墙的那条边
    const pivotY = p.y + p.h;                          // 脚底
    ctx.save();
    ctx.translate(pivotX, pivotY);
    ctx.rotate(lean * -1);
    ctx.translate(-pivotX, -pivotY);
  }

  drawCharacter(
    ctx, p.sprite,
    poseX, p.y - bob + capyYOff,
    p.w, p.h,
    p.dir < 0,
    poseSquash,              // 含 翻滚 / 侧身 / 冲刺拉伸
    false,
    spin,                    // ★ 旋转角度（二连跳翻滚）
    /* ★ 第 10 个参数：显式传 role（2026-10-06）★
     * 不传的话渲染层只能靠"p.sprite 是哪个 SPR_ 常量"反查 role，
     * 而史迪奇暂时和卡皮巴拉共用同一个 sprite 对象 → 会被画成卡皮巴拉
     *（十一报的 bug）。传 role 后就按 role 取贴图，分得清清楚楚。 */
    p.role
  );

  /* ============================================================
   * ★ 「十一」专属：走路时**腿真的动起来**（2026-10-07 十一要求）★
   * ============================================================
   * 原话："然后走路的话，脚可以动起来。"
   *
   * 【难点】角色是**一整张图片**，没有独立的腿部图层 ——
   *   所以不能直接"转动腿"。用两个技巧叠加来表现迈步：
   *
   *   ① **下身交替位移**：把角色**下半部分**（腿的区域）
   *      按 `sin(腿相位)` 做横向小幅位移 —— 视觉上像左右腿交替迈出。
   *      朝左走时整个方向镜像。
   *   ② **下身挤压**：迈步时那一条腿"踩下去"，配合轻微纵向压缩。
   *
   * ⚠️ 只作用在**下半身**（用 clip 裁出下半区）——
   *    如果整体位移，看起来是"整只角色在飘"，不是"腿在走"。
   * ⚠️ 全程 try 保护 + 只在 wLegSwing 非 0 时执行 ⇒
   *    其他 10 个角色**完全不受影响**（wLegSwing 恒为 0）。
   * ============================================================ */
  if (wLegSwing) {
    try {
      const legTop = p.y - bob + capyYOff + p.h * 0.52;   // 腿的起始高度（下半 48%）
      const stepDx = wLegSwing * (p.dir < 0 ? -1 : 1);    // 迈步的横向位移
      /* 抬腿那一只"离地"—— 用 sin 的正负区分前后腿 */
      const liftUp = Math.max(0, Math.sin(wLegPhase)) * 2.4;

      ctx.save();
      /* 只在下半身区域内重绘，避免把头和身体也挪走 */
      ctx.beginPath();
      ctx.rect(poseX - p.w, legTop, p.w * 3, p.h);
      ctx.clip();
      /* 轻微竖向压缩（踩地感） + 横向错位（交替迈步） */
      drawCharacter(
        ctx, p.sprite,
        poseX + stepDx, p.y - bob + capyYOff + liftUp * 0.5,
        p.w, p.h - liftUp * 0.5,
        p.dir < 0,
        poseSquash * (1 + liftUp * 0.01),
        false,
        spin,
        p.role
      );
      ctx.restore();
    } catch (e) { /* 腿动画是纯表现，出错不能影响角色绘制 */ }
  }

  if (lean) ctx.restore();
  if (walkLeanApplied) ctx.restore();
  if (boxTiltApplied) ctx.restore();

  /* ============================================================
   * ★ 「十一」专属：二段跳的**糖霜**（2026-10-07 十一要求）★
   * ============================================================
   * 她二段跳时不翻滚，改成"向上蹦 + 撒糖霜"——
   * 这里画那圈从身上飘出的粉色糖霜/小星星。
   *
   * ⚠️ 用**确定性伪随机**定位（按 animT 算），绝不用 Math.random ——
   *    每帧重画会疯狂闪烁。
   * ⚠️ 只在 candyHopStretch > 0（正在做那个动作）时画。
   * ============================================================ */
  if (candyHopStretch > 0.01) {
    try {
      const cx = poseX + p.w / 2;
      const cy = p.y - bob + capyYOff + p.h * 0.4;
      const n = 7;
      const cols = ['#FFB3D1', '#FFE066', '#9FE8D8', '#FFFDF8'];
      for (let k = 0; k < n; k++) {
        const t20 = Math.floor((p.animT || 0) * 20);
        const s1 = ((Math.sin(k * 12.9898 + t20 * 0.017) * 43758.5453) % 1 + 1) % 1;
        const s2 = ((Math.sin(k * 78.233 + t20 * 0.031) * 24634.6345) % 1 + 1) % 1;
        const ang = s1 * Math.PI * 2;
        const rad = (28 + s2 * 34) * candyHopStretch;
        const px2 = cx + Math.cos(ang) * rad;
        const py2 = cy - Math.abs(Math.sin(ang)) * rad * 0.8 - 6;
        const sz = (2.2 + s2 * 2.2) * candyHopStretch;
        ctx.save();
        ctx.globalAlpha = Math.min(1, candyHopStretch * 1.3) * (0.55 + s2 * 0.45);
        ctx.fillStyle = cols[k % cols.length];
        /* 四角星芒（比圆点更像"撒出来的糖霜"） */
        ctx.beginPath();
        ctx.moveTo(px2, py2 - sz);
        ctx.lineTo(px2 + sz * 0.34, py2);
        ctx.lineTo(px2, py2 + sz);
        ctx.lineTo(px2 - sz * 0.34, py2);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px2 - sz, py2);
        ctx.lineTo(px2, py2 + sz * 0.34);
        ctx.lineTo(px2 + sz, py2);
        ctx.lineTo(px2, py2 - sz * 0.34);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    } catch (e) { /* 糖霜是纯表现 */ }
  }

  /* ============================================================
   * ★ 「噜噜」专属：二段跳的**橘子气浪**（2026-10-07 十一要求）★
   * ============================================================
   * 它二段跳时箱子像弹簧一样弹起来 —— 这里画那一圈甩出的小橘子。
   * 配色呼应噜噜的橘子主题（橙 + 橙红 + 一点点绿叶子）。
   *
   * ⚠️ 用**确定性伪随机**定位（按 animT 算），绝不用 Math.random ——
   *    每帧重画会疯狂闪烁。
   * ⚠️ 只在 boxHopStretch > 0（正在做那个动作）时画。
   * ============================================================ */
  if (boxHopStretch > 0.01) {
    try {
      const cx = poseX + p.w / 2;
      const cy = p.y - bob + capyYOff + p.h * 0.45;
      const n = 6;                                  // 6 颗小橘子
      for (let k = 0; k < n; k++) {
        const t20 = Math.floor((p.animT || 0) * 20);
        const s1 = ((Math.sin(k * 21.7231 + t20 * 0.021) * 39412.3451) % 1 + 1) % 1;
        const s2 = ((Math.sin(k * 56.1173 + t20 * 0.043) * 27931.7621) % 1 + 1) % 1;
        const ang = s1 * Math.PI * 2;
        const rad = (30 + s2 * 30) * boxHopStretch;
        const px2 = cx + Math.cos(ang) * rad;
        /* 往上偏 —— 表现"被弹射甩出来的" */
        const py2 = cy - Math.abs(Math.sin(ang)) * rad * 0.9 - 4;
        const rO = (2.6 + s2 * 2.0) * boxHopStretch;
        ctx.save();
        ctx.globalAlpha = Math.min(1, boxHopStretch * 1.35) * (0.6 + s2 * 0.4);
        /* 橘子本体（橙） */
        ctx.fillStyle = (k % 3 === 0) ? '#FF8A3D' : '#FFA726';
        ctx.beginPath();
        ctx.arc(px2, py2, rO, 0, Math.PI * 2);
        ctx.fill();
        /* 小绿叶（每颗橘子梗上一片，一眼看出是"橘子"不是"圆点"） */
        ctx.fillStyle = '#7CB342';
        ctx.beginPath();
        ctx.ellipse(px2 + rO * 0.5, py2 - rO * 0.9, rO * 0.55, rO * 0.3, -0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } catch (e) { /* 橘子气浪是纯表现 */ }
  }

  /* ============================================================
   * ★ 「十一」专属：静止时手握**彩色棒棒糖**（2026-10-07 十一要求）★
   * ============================================================
   * 原话："静止的时候，手上拿着一根棒棒糖，那个棒棒糖要做的好看一点，
   *        就是彩色的。"
   *
   * 【什么时候画】
   *   站在地面上、几乎不动（|vx| < 0.5）、且没在翻滚。
   *   ⇒ 一停下来就掏糖吃，一走起来就收起来（很符合角色性格）。
   *
   * 【画在哪】角色身前（朝向的那一侧）、抬手的高度 ——
   *   像"举着棒棒糖"。朝左时整体镜像。
   *
   * 【长什么样】彩虹螺旋棒棒糖：
   *   · 白色糖球 + **三色螺旋条纹**（粉/薄荷/柠檬，一层层绕上去）
   *   · 木色糖棍
   *   · 糖球外一圈柔光（可爱感）
   * ⚠️ 纯表现，不参与物理。用一个极慢的自转，让它"活"一点。
   * ============================================================ */
  if (p._showLollipop) {
    try {
      const dirSign = p.dir < 0 ? -1 : 1;
      /* 手的位置：身前 + 身体中部偏上 */
      const hx = poseX + p.w / 2 + dirSign * (p.w * 0.46);
      const hy = p.y - bob + capyYOff + p.h * 0.52;
      const R = Math.max(6, p.w * 0.24);          // 糖球半径
      const spin2 = (p.animT || 0) * 0.9;         // 极慢自转
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(dirSign * 0.28);                 // 稍微歪一点，更自然
      /* ① 糖棍 */
      ctx.strokeStyle = '#E8D5A8';
      ctx.lineWidth = Math.max(1.6, R * 0.30);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, R * 0.55);
      ctx.lineTo(0, R * 1.75);
      ctx.stroke();
      /* ② 糖球底盘（白色，稍大一圈，形成描边感） */
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.14, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFDF8';
      ctx.fill();
      /* ③ 螺旋条纹：三色同心弧，旋转角随 spin2 变化 ⇒ 像在转 */
      const cols = ['#FF9EC4', '#7FD8C8', '#FFE066'];   // 粉 / 薄荷 / 柠檬
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        const a0 = spin2 + k * (Math.PI * 2 / 3);
        ctx.arc(0, 0, R, a0, a0 + 1.9);
        ctx.lineWidth = R * 0.62;
        ctx.strokeStyle = cols[k];
        ctx.stroke();
      }
      /* ④ 中心 + 高光 */
      ctx.beginPath();
      ctx.arc(-R * 0.3, -R * 0.3, R * 0.24, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
      ctx.restore();
    } catch (e) { /* 棒棒糖是纯表现 */ }
  }

  /* ============================================================
   * ★ 「噜噜」专属：**挂机 5 秒 → 手上掏出橘子**（2026-10-07）★
   * ============================================================
   * 十一原话："挂机的时候，手上拿个橘子，挂机 5 秒没动算挂机。"
   *
   * 【什么时候画】
   *   `_idleT`（连续静止秒数）≥ 5 —— 这个计时在 game.js 里算
   *   （① 站在地面 ② 几乎不动 ③ 不在贴墙/冲刺，三个条件同时满足才累计，
   *     一动就归零）。
   *
   * 【画在哪】身前偏上（嘴/手的位置）—— 水豚抱着橘子啃的样子。
   *   朝左时整体镜像（dirSign）。
   *
   * 【长什么样】一颗饱满的橘子：
   *   · 橘色圆身 + 高光 + 几道弧线（橘皮纹理）
   *   · 顶部小绿叶 + 梗
   *   · 周围一点点"橘子香"的小橙点（随时间轻轻浮动）
   * ⚠️ 纯表现，不参与物理。
   * ============================================================ */
  if (p._idleOrangeShow) {
    try {
      const dirSign = p.dir < 0 ? -1 : 1;
      const R = Math.max(7, p.w * 0.24);            // 橘子半径
      const ox = poseX + p.w / 2 + dirSign * (p.w * 0.34);
      const oy = p.y - bob + capyYOff + p.h * 0.52;
      /* 极轻微的上下浮动（像在呼吸/啃东西），幅度 1px 级别 */
      const bob2 = Math.sin((p._idleT || 0) * 2.4) * R * 0.06;
      ctx.save();
      ctx.translate(ox, oy + bob2);

      /* ① 橘身 */
      ctx.fillStyle = '#FF9F2E';
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      /* ② 侧面暗部（球感） */
      ctx.fillStyle = 'rgba(214,110,10,0.42)';
      ctx.beginPath();
      ctx.arc(R * 0.22, R * 0.16, R * 0.82, 0, Math.PI * 2);
      ctx.fill();
      /* ③ 橘皮纹理（三道弧线） */
      ctx.strokeStyle = 'rgba(255,190,110,0.5)';
      ctx.lineWidth = Math.max(0.6, R * 0.09);
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.arc(k * R * 0.32, R * 0.1, R * 0.72, -0.9, 0.9);
        ctx.stroke();
      }
      /* ④ 高光 */
      ctx.fillStyle = 'rgba(255,240,205,0.8)';
      ctx.beginPath();
      ctx.arc(-R * 0.32, -R * 0.36, R * 0.24, 0, Math.PI * 2);
      ctx.fill();
      /* ⑤ 梗 + 小绿叶 */
      ctx.strokeStyle = '#8D6E3A';
      ctx.lineWidth = Math.max(1, R * 0.16);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.92);
      ctx.lineTo(R * 0.06, -R * 1.24);
      ctx.stroke();
      ctx.fillStyle = '#7CB342';
      ctx.beginPath();
      ctx.ellipse(R * 0.52, -R * 1.16, R * 0.52, R * 0.3, -0.5, 0, Math.PI * 2);
      ctx.fill();

      /* ⑥ "橘子香"的小点（绕着橘子飘，慢慢转） */
      const tt = (p.animT || 0) * 1.1;
      for (let k = 0; k < 4; k++) {
        const a = tt + k * Math.PI / 2;
        const rr = R * 1.5;
        const sx2 = Math.cos(a) * rr;
        const sy2 = Math.sin(a) * rr * 0.6 - R * 0.35;
        ctx.globalAlpha = 0.30 + 0.25 * Math.sin(tt * 2 + k);
        ctx.fillStyle = '#FFC46B';
        ctx.beginPath();
        ctx.arc(sx2, sy2, Math.max(0.9, R * 0.13), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } catch (e) { /* 挂机橘子是纯表现 */ }
  }

  // 头顶小标识（区分两人）
  /* 翻滚时不画标识 —— 角色在转，标签跟着转会很乱；
   * 而且翻滚只有 0.37 秒，短暂消失不影响辨识。 */
  if (p.spinT <= 0) {
    /* ★★ P1 / P2 头顶标签：**只有双真人时才画**（2026-10-06 十一反馈）★★
     * ------------------------------------------------------------
     * 十一的原话："无论我单机还是 PK，永远都是 P1，不要 P2。
     *             P1 P2 都是双人的时候才会有的。"
     *
     * ⇒ 单人 / PK 模式下**完全不画**这个标签。
     *   （原来无条件画，单人时玩家头上顶着个"P1"很莫名其妙 ——
     *     场上就一个人，谁是 P1 还用标吗。）
     * ------------------------------------------------------------ */
    const twoHuman = (typeof isTwoHumanPlayers === 'function')
      ? isTwoHumanPlayers()
      : (Game.playerCount === 2 && !Game.isPk);
    if (!twoHuman) return;

    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    /* ★ 2026-10-06：配色改为从角色配置读（accentColor）★
     * 原来是 `kangaroo ? 黄 : 橙` —— 加了卡皮巴拉之后它会被涂成飞龙的橙色，
     * 两个角色的 HUD 卡片就分不出来了。 */
    ctx.fillStyle = accentOfRole(p.role);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    /* ★ 用"它是第几个玩家"来定编号，不用 role ★
     * 原来写 `role === 'kangaroo' ? 'P1' : 'P2'` ——
     * 那意味着"选袋鼠永远是 P1、选飞龙永远 P2"，
     * 但双人同屏时这是对的；用索引更直白且不依赖角色表。 */
    const idx = Game.players.indexOf(p);
    const label = (idx === 1) ? 'P2' : 'P1';
    ctx.strokeText(label, p.x + p.w / 2, p.y - bob - 8);
    ctx.fillText(label, p.x + p.w / 2, p.y - bob - 8);
    ctx.restore();
  }
}

/* ---------------- HUD ----------------
 * 主题：外卖骑手派单看板
 *
 * 保持像素风（硬边、方块、网格对齐），只是把元素全换成外卖语言：
 *   · 玩家卡片 → 骑手信息卡（头盔图标 + 骑手名 + 体力格）
 *   · 金币计数 → 订单送达进度条
 *   · 计时器   → 配送计时
 * ---------------------------------------- */

/* ============================================================
 * ★ 好评率格（原"体力格"，2026-10-06 第 1 期 C3）★
 * ============================================================
 * 十一的方案（docs/扩展方案 的 C3）说得很清楚：
 *   "机制**完全不动**（还是 3 颗心），只改**呈现文案**。
 *    这一项**不要动数值**，只动文案。零风险、零成本、高回报。"
 *
 * 所以：
 *   · 格子数、填充判定（i < p.hearts）、颜色、尺寸 —— **一个字都没改**
 *   · 只是把"这是血条"的语义换成"这是好评率"
 *
 * 为什么这么改有感觉：
 *   数字没变，但玩家的心理从"我还有几条命"变成"我今天服务好不好"。
 *   这正是"外卖主题"要的东西。
 *
 * ⚠️ 函数名保留 drawHearts 没改 —— 因为 render.js 里还有别的地方
 *    可能引用它，改名要牵扯一片。语义改了、名字留着，够用就好。
 * ============================================================ */
function drawHearts(ctx, p, x, y) {
  const CW = 18, CH = 20, GAP = 4;
  for (let i = 0; i < p.maxHearts; i++) {
    const filled = i < p.hearts;
    const hx = x + i * (CW + GAP);
    ctx.save();
    if (!filled) ctx.globalAlpha = 0.3;
    // 外框
    ctx.fillStyle = filled ? '#2A2A30' : '#5a5a62';
    ctx.fillRect(hx, y, CW, CH);
    ctx.fillStyle = filled ? '#FFD100' : '#8a8a92';
    ctx.fillRect(hx + 2, y + 2, CW - 4, CH - 4);
    if (filled) {
      // 高光，做出"满格"的感觉
      ctx.fillStyle = '#FFF3B0';
      ctx.fillRect(hx + 3, y + 3, CW - 6, 5);
    }
    ctx.restore();
  }
}

/* 好评率百分比（C3 新增，纯展示计算）
 *
 * 把"剩几条命"换算成"好评率百分之多少"：
 *   满血 3/3 → 100%　2/3 → 66%　1/3 → 33%　0/3 → 0%
 *
 * ⚠️ 这只是**显示用**的换算，不改任何游戏数值 ——
 *    hearts 还是那个 hearts，掉血/回血逻辑一行没动。
 *    写成一个函数是为了 HUD 和结算页共用同一个算法
 *    （两处各写一遍迟早会不一致）。 */
function riderRatingPercent(hearts, maxHearts) {
  const max = Math.max(1, maxHearts || 3);
  const cur = Math.max(0, Math.min(max, hearts || 0));
  return Math.round((cur / max) * 100);
}

/* 好评率对应的"本单评价"文案（HUD 和结算共用） */
function riderRatingText(percent) {
  if (percent >= 100) return '满分好评';
  if (percent >= 66) return '顾客满意';
  if (percent >= 34) return '勉强送达';
  return '有点悬';
}

/* 骑手信息卡：头盔图标 + 骑手名 + 按键提示 + 好评率格 */
function drawRiderCard(ctx, p, x, y, keys, tag) {
  const W = 320, H = 66;

  // 卡片底：深色 + 黄描边（美团黄黑）
  ctx.fillStyle = 'rgba(18,18,22,0.62)';
  ctx.fillRect(x, y, W, H);
  ctx.strokeStyle = 'rgba(255,209,0,0.42)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, W - 2, H - 2);

  // 左侧头像框（画头盔图标）
  ctx.fillStyle = 'rgba(255,209,0,0.14)';
  ctx.fillRect(x + 10, y + 12, 42, 42);
  ctx.strokeStyle = 'rgba(255,209,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 10, y + 12, 42, 42);
  drawIcon(ctx, 'helmet', x + 18, y + 20, 26);

  // 骑手名 + 按键
  /* ★ 同上：走角色配置的 accentColor（袋鼠黄 / 飞龙橙 / 卡皮巴拉棕） */
  const accent = accentOfRole(p.role);
  ctx.textAlign = 'left';
  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = accent;
  ctx.fillText((tag || '') + p.name, x + 60, y + 28);

  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = 'rgba(255,243,176,0.62)';
  ctx.fillText(keys, x + 60, y + 44);

  // 好评率格（C3：语义从"体力"换成"好评率"，格子本身没变）
  drawHearts(ctx, p, x + 60, y + 48);

  /* 右下角：好评率百分比 + 简短评价（C3）
   * 原来是"体力"两个字 —— 换成"好评 100%"后，
   * 玩家一眼就把"剩几条格"理解成"我这单的服务评价还剩多少"。
   *
   * ⚠️ 用 riderRatingPercent 读 p.hearts / p.maxHearts，
   *    这两个字段的值本身没动过（还是原来的掉血/回血逻辑）。 */
  const ratingPct = riderRatingPercent(p.hearts, p.maxHearts);
  ctx.font = 'bold 10px monospace';
  ctx.fillStyle = ratingPct >= 66 ? 'rgba(157,255,184,0.75)'
    : (ratingPct >= 34 ? 'rgba(255,243,176,0.6)' : 'rgba(255,140,140,0.85)');
  ctx.textAlign = 'right';
  ctx.fillText('好评 ' + ratingPct + '%', x + W - 10, y + 60);
  ctx.textAlign = 'left';

  /* ---- 新增动作的 HUD：抓墙体力条 + 冲刺次数 ---- */
  drawActionHUD(ctx, p, x, y);
}

/* ------------------------------------------------------------
 * 新动作的 HUD 组件
 * ------------------------------------------------------------
 * 只在这三个条件下显示，避免平时画面太挤：
 *   1) 抓墙体力不满（说明玩家在用抓墙）
 *   2) 冲刺次数已经用掉了
 *   3) 正在贴墙 / 冲刺（实时状态）
 *
 * 设计：一条细体力条 + 一排"冲刺格"（菱形小方块，用掉就暗掉）。
 * ------------------------------------------------------------ */
function drawActionHUD(ctx, p, x, y) {
  if (typeof ACTIONS === 'undefined' || !ACTIONS.grabStaminaRatio) return;

  const P = (typeof CELESTE !== 'undefined') ? CELESTE : null;
  const ratio = ACTIONS.grabStaminaRatio(p);
  const dashes = ACTIONS.dashesLeft(p);
  /* ★ 上限按角色取（2026-10-07）★
   * 原来是写死的全局值（1 格）—— 朱迪能连冲 2 发，
   * 用全局值只画 1 格，就会出现"冲完第一发 HUD 就说没冲刺了"的假象。
   * 优先走 ACTIONS.dashesMax（它知道角色加成），取不到再退回全局值。 */
  const maxDash = (typeof ACTIONS.dashesMax === 'function')
    ? ACTIONS.dashesMax(p)
    : (P ? P.dashMaxCount : 1);

  const busy = p.actWallDir || p.actDashT > 0;
  const staminaUsed = ratio < 0.995;
  const dashUsed = dashes < maxDash;
  if (!busy && !staminaUsed && !dashUsed) return;   // 一切正常 → 不显示

  const barW = 76, barH = 6;
  const bx = x + 60;
  const by = y + 66;

  /* ① 抓墙体力条（橙 → 红，低于 30% 闪烁预警） */
  const low = ratio < 0.30 && p.actWallDir;
  const blink = low && (Math.floor(Date.now() / 90) % 2 === 0);
  ctx.save();
  ctx.globalAlpha = blink ? 0.55 : 1;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(bx, by, barW, barH);

  let col = '#8fd4ff';
  if (ratio < 0.30) col = '#ff6b5a';
  else if (ratio < 0.60) col = '#ffd166';
  ctx.fillStyle = col;
  ctx.fillRect(bx, by, Math.max(0, barW * ratio), barH);

  ctx.strokeStyle = 'rgba(255,243,176,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);

  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = 'rgba(255,243,176,0.62)';
  ctx.textAlign = 'left';
  ctx.fillText('抓墙', bx, by + barH + 10);
  ctx.restore();

  /* ② 冲刺次数：菱形小格，用掉变暗 */
  const dx = bx + barW + 12;
  const dy = by + barH / 2;
  for (let i = 0; i < maxDash; i++) {
    const alive = i < dashes;
    ctx.save();
    ctx.globalAlpha = alive ? 1 : 0.22;
    ctx.fillStyle = alive ? '#c98bff' : '#666';
    ctx.beginPath();
    ctx.moveTo(dx + i * 14, dy - 6);
    ctx.lineTo(dx + i * 14 + 6, dy);
    ctx.lineTo(dx + i * 14, dy + 6);
    ctx.lineTo(dx + i * 14 - 6, dy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = 'rgba(255,243,176,0.62)';
  ctx.textAlign = 'left';
  ctx.fillText('冲刺', dx - 6, dy + 17);
}

/* 订单看板（HUD 中间的那块）
 * ============================================================
 * ★ 2026-10-06 调整：按十一给的格式补全信息 ★
 * ============================================================
 * 十一要求的 HUD 重点信息：
 *   当前角色 / 生命值 / 订单数量 / 最低完成要求 / 配送用时 /
 *   当前关卡目标 / 冲刺次数 / 抓墙体力
 *
 *   建议格式：
 *     路线：城区快线
 *     订单：08 / 12
 *     最低要求：06
 *     用时：01:24
 *     生命：♥♥♥
 *
 * 这里做的取舍：
 *   · "路线"和"用时"并排放在标题行 —— 省一行高度
 *   · "最低要求"单独一行小字 —— 这是玩家判断"能不能走"的关键数字，
 *     不能和订单数混在一起看
 *   · 进度条上的刻度线保留（可视化的"门槛在哪"）
 *   · 生命值在**两侧的骑手卡**里（体力格），不重复画在中间 ——
 *     十一说"HUD 不得遮挡角色、平台或关卡关键机关"，
 *     中间这块越矮越好
 *   · 订单号补零成两位（08 / 12），看起来整齐，也更容易一眼比较
 * ============================================================ */
function drawOrderBoard(ctx, t) {
  const total = Game.coinsTotal;
  const taken = Game.coinsTaken;
  const need = Game.coinsRequired;
  const ok = taken >= need;

  const W = 288, H = 68;
  const x = (CANVAS_W - W) / 2, y = 12;

  ctx.fillStyle = 'rgba(18,18,22,0.62)';
  ctx.fillRect(x, y, W, H);
  ctx.strokeStyle = ok ? 'rgba(124,255,156,0.5)' : 'rgba(255,120,120,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, W - 2, H - 2);

  /* 补零：08 / 12 而不是 8 / 12。
   * 个单位数/双位数混合排列时，补零后数字宽度一致，
   * 进度变化时不会左右抖动。 */
  const pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  // ---- 标题行：小袋子图标 + 订单号/区域 + 用时 ----
  drawIcon(ctx, 'bag', x + 10, y + 7, 17);
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = 'rgba(255,243,176,0.72)';
  /* ★ C1（2026-10-06 第 1 期）：从"路线：美团专送 01 · 城区快线"
   *   改成"#01 城区老巷" —— 更短、更像外卖单，也给右边留出空间。
   *   ⚠️ 兜底：老数据没 orderNo/district 就退回 lv.name，不会显示空。 */
  const lvObj = Game.level || {};
  const ordNo = (typeof lvObj.orderNo === 'number') ? lvObj.orderNo : null;
  const boardTitle = ordNo
    ? ('#' + ((ordNo < 10 ? '0' : '') + ordNo) + (lvObj.district ? ' ' + lvObj.district : ''))
    : ((lvObj.name) ? lvObj.name : '配送中');
  ctx.fillText(boardTitle, x + 32, y + 20);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,243,176,0.72)';
  ctx.fillText('用时 ' + formatTime(Game.elapsed), x + W - 10, y + 20);
  ctx.textAlign = 'left';

  // ---- 主要数字：订单 N / M（达标变色）----
  ctx.font = 'bold 17px monospace';
  ctx.fillStyle = ok ? '#9dffb8' : '#FFD100';
  ctx.fillText('订单 ' + pad2(taken) + ' / ' + pad2(total), x + 32, y + 40);

  /* 最低要求单独一行小字 —— 玩家判断"能不能走了"靠的就是这个数。
   * 达标后显示"✓ 已达标，可以前往收餐点"，未达标显示"还需 N 单"。 */
  ctx.font = 'bold 11px monospace';
  if (ok) {
    ctx.fillStyle = 'rgba(157,255,184,0.9)';
    ctx.fillText('✓ 最低要求 ' + pad2(need) + ' 单 · 可以前往收餐点', x + 32, y + 56);
  } else {
    ctx.fillStyle = 'rgba(255,179,179,0.92)';
    ctx.fillText('最低要求 ' + pad2(need) + ' 单 · 还需 ' + (need - taken) + ' 单', x + 32, y + 56);
  }

  // ---- 进度条：底槽 + 已送达部分 ----
  const bx = x + 10, by = y + 60, bw = W - 20, bh = 5;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw, bh);
  const ratio = total > 0 ? Math.min(1, taken / total) : 0;
  ctx.fillStyle = ok ? '#7cff9c' : '#FFD100';
  ctx.fillRect(bx, by, Math.round(bw * ratio), bh);

  // 门槛刻度线（让玩家看到"要送到哪才算完成"）
  if (total > 0 && need <= total) {
    const mx = bx + Math.round(bw * (need / total));
    ctx.fillStyle = ok ? '#1f6b32' : '#8a2b2b';
    ctx.fillRect(mx - 1, by - 3, 3, bh + 6);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

  /* 关卡剩余时间的紧迫感提示：超时线快到时让"用时"变红闪烁。
   * 只在真的快超时时才动 —— 平时不闪，不然很吵。 */
  if (Game.timeLimit > 0 && Game.elapsed > Game.timeLimit * 0.8) {
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.globalAlpha = (Math.floor(Date.now() / 240) % 2 === 0) ? 0.95 : 0.5;
    ctx.fillStyle = '#ff8a8a';
    ctx.fillText('快超时！', x + W - 10, y + 40);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

function drawHUD(ctx, t) {
  const p1 = Game.players[0];
  const p2 = Game.players[1];     // 单人模式时为 undefined
  if (!p1) return;

  /* ============================================================
   * ★★ 什么时候才显示 "P1 / P2"（2026-10-06 十一反馈后定）★★
   * ============================================================
   * 十一的原话：
   *   "无论是我单机还是 PK，我这个角色都是 P1，永远都是 P1，不要 P2。
   *    而且 P1 P2 都是双人的时候才会有的。
   *    单人模式下就不要显示这个 P1 P2。"
   *
   * 【规则】**只有"两个都是真人玩家"时才显示 P1 / P2**：
   *   · 单人模式（1 个角色）        → 不显示
   *   · PK 模式（玩家 + AI）        → **不显示**（AI 不是"2 号玩家"）
   *   · 双人同屏 / 联机（2 个真人）  → 显示
   *
   * 【为什么 PK 也不显示】
   *   P1/P2 的意义是"两个人挤一个键盘，谁是 1 号谁是 2 号"。
   *   PK 里第二个人是**电脑**，标个 P2 只会让人以为"还有个真人没到"。
   *   对手是谁已经由头顶的角色形象 + 竞速进度条说清楚了。
   *
   * ⚠️ HUD 两张卡片本身**还是照常显示**（要能看到对手的血条/进度），
   *    只是**不加那个 P1/P2 前缀**。
   * ============================================================ */
  const showPlayerTags = (typeof isTwoHumanPlayers === 'function')
    ? isTwoHumanPlayers()
    : (Game.playerCount === 2 && !Game.isPk);

  ctx.save();

  /* ★ 2026-10-06：手机模式下整体缩小 HUD ★
   * 十一要求"Hud 不得遮挡角色、平台或关卡关键机关"，
   * 以及"手机模式下适当缩小 HUD，为虚拟按键留出空间"。
   *
   * 做法：手机模式把 HUD 整体缩到 78%。
   *   为什么用 transform 缩小而不是改每个坐标：
   *     ① 所有绘制代码（骑手卡/订单看板/体力格…）一行都不用动
   *     ② 缩放是等比的，不会出现"字变小了但框没变"的错位
   *   为什么是 78%：实测再小就看不清"最低要求"那行小字了。
   *
   * ⚠️ 注意：这个缩放在 drawHUD 的 save/restore 之内，
   *    不会影响世界绘制（角色、地形还是原大小）。
   *    HUD 本来就画在屏幕空间，缩小它不影响玩法判定。 */
  const mobile = (typeof DEVICE_STATE === 'function') && DEVICE_STATE().isMobile();
  if (mobile) {
    const s = 0.78;
    ctx.scale(s, s);
    /* 缩放后坐标系变小了，要用"放大后的视口尺寸"重新铺满 */
    ctx._hudScale = s;
  }

  // 单人模式下方向键和 WASD 都能用，提示直接写两套键，别让玩家去记
  const single = Game.playerCount === 1;
  /* 手机模式不写键盘键位 —— 手机上按不出方向键，
   * 写"方向键/WASD"只会让人困惑（虚拟按键的提示在说明页里）。 */
  const p1Keys = mobile
    ? '左手方向　右手跳跃'
    : (single
        ? '方向键 / WASD　跳 ↑/W/空格'
        : (p1.role === 'kangaroo' ? '← →　跳 ↑ / 空格' : 'A D　跳 W / 空格'));

  drawRiderCard(ctx, p1, 14, 12, p1Keys, showPlayerTags ? 'P1 ' : '');

  if (p2) {
    drawRiderCard(ctx, p2, CANVAS_W - 334, 12,
      mobile ? '左手方向　右手跳跃' : 'A D　跳 W / 空格', showPlayerTags ? 'P2 ' : '');
  }

  // 中间：订单看板
  drawOrderBoard(ctx, t);

  // 提示消息（关卡名 / "门开了！"等）
  if (Game.messageTimer > 0 && Game.state === STATE.PLAYING) {
    const alpha = Math.min(1, Game.messageTimer / 30);
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#FFD100';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 5;
    ctx.strokeText(Game.message, CANVAS_W / 2, 130);
    ctx.fillText(Game.message, CANVAS_W / 2, 130);
    ctx.globalAlpha = 1;
  }

  // 操作提示（比如联机时"等房主操作"）—— 显示在画面下方
  if (Game.noticeTimer > 0 && Game.noticeText && Game.state === STATE.PLAYING) {
    const a = Math.min(1, Game.noticeTimer / 30);
    ctx.globalAlpha = a;
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD100';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 5;
    ctx.strokeText(Game.noticeText, CANVAS_W / 2, CANVAS_H - 90);
    ctx.fillText(Game.noticeText, CANVAS_W / 2, CANVAS_H - 90);
    ctx.globalAlpha = 1;
  }

  /* ============================================================
   * ★ 倒计时（C2 时限系统，2026-10-06 第 3 期）★
   * ============================================================
   * 方案要求：
   *   1. 骑手模式下，HUD 显示倒计时（复用 Game.elapsed）
   *   2. ★经典模式下完全不显示计时器★（这是硬要求）
   *
   * ⚠️⚠️ 最重要的一条：**超时不失败** ⚠️⚠️
   *   这个计时器纯粹是"目标提示"，时间到了：
   *     · 不扣血、不判负、不重来、不挡过关
   *     · 只是结算时拿不到"时间分"（第 3 期的 calcStarsRider 里）
   *   所以下面**只有绘制**，没有一行判定逻辑。
   *   ⚠️ 谁要往这里加"超时调用 die() / triggerDeath"的代码，
   *      就是在违反项目核心设计原则（放松优先），必须拒绝。
   *
   * 【显示条件】
   *   · 必须是骑手模式（SAVE().isRiderMode()）
   *   · 必须本关有 targetTime（没目标的关卡不显示，比如以后的特殊关）
   *   · 只在 PLAYING 时显示（结算/暂停时不画，避免和浮层打架）
   *
   * 【位置】
   *   画在订单看板正下方中间 —— 那里原本是空的，
   *   不挡骑手卡（左右两侧）、不挡订单看板（中间上方）。
   * ============================================================ */
  const riderMode = (typeof SAVE === 'function' && SAVE().isRiderMode)
    ? SAVE().isRiderMode() : false;
  const targetT = (Game.level && Game.level.targetTime) ? Game.level.targetTime : 0;
  if (riderMode && targetT > 0 && Game.state === STATE.PLAYING) {
    drawRiderTimer(ctx, Game.elapsed, targetT);
    /* ★ E2 催单气泡（第 5 期）：超时后才出现 ★
     * 只在骑手模式（有时限才有"超时"这个概念）。 */
    drawCustomerNag(ctx, Game.elapsed - targetT);
  }

  /* ★ 作者彩蛋：左下角引导小字（2026-10-06）★
   * ⚠️ 放在这里 = **屏幕坐标**（HUD 层），不跟地图滚动 ——
   *    因为它是"刚进关的一次性引导"，不是关卡内的东西。
   * ⚠️ 和"踩住时的那句大字"是两回事（见 game.js 的续命逻辑）：
   *    这句进关飘 4 秒就没了；那句踩住才出现、走开就消失。 */
  try {
    if (typeof drawEggHint === 'function' && Game.level) drawEggHint(ctx, Game.level);
  } catch (e) { /* 彩蛋提示失败不影响 HUD */ }

  /* ★ 🏁 PK 模式：竞速进度条（2026-10-06）★
   * 这是 PK 模式**唯一的 HUD** —— 必须让玩家随时知道"我领先还是落后"，
   * 否则跑起来毫无紧张感。 */
  try {
    if (Array.isArray(Game.aiRoles) && Game.aiRoles.length && !Game.pkResult &&
        Game.state === STATE.PLAYING) {
      drawPkBar(ctx, Game.level);
      /* ★ 起跑倒计时（2026-10-06）：屏幕中央飘 3 / 2 / 1 / 跑！ ★ */
      drawPkCountdown(ctx);
    }
  } catch (e) { /* PK 进度条画不出来不影响 HUD */ }

  ctx.restore();
}

/* ------------------------------------------------------------
 * ★ E2 顾客催单气泡（2026-10-06 第 5 期）★
 * ------------------------------------------------------------
 * 方案原文：
 *   "超时后，屏幕上跳顾客催单气泡（漫画式）……
 *    气泡随时间越来越急（语气从客气到暴躁）"
 *   "**它替代了败北音效** —— 玩家听到的不是'Game Over'，
 *    是'你到哪了'——挫败感被消解成好笑。"
 *
 * 【⚠️ 这是"幽默层"，不是"惩罚层"】
 *   气泡只是**画出来**给人看的，不扣血、不判负、不挡任何东西。
 *   谁要往这里加"超时扣命 / 超时结束游戏"，就是在违反方案红线。
 *
 * 【怎么画】
 *   一个漫画式气泡（圆角矩形 + 小尾巴），里面是顾客说的话。
 *   位置在订单看板右下方，不挡骑手卡、不挡计时器、不挡角色视野。
 *
 * 【紧急度 → 视觉】
 *   urgency 0→1 时：
 *     · 边框从浅黄 → 红
 *     · 整体轻微左右抖动（越急抖得越明显）
 *     · 气泡尾巴跟着动（就像有人在急着说话）
 *
 * @param overSec  超时秒数（<=0 就不画）
 * ------------------------------------------------------------ */
function drawCustomerNag(ctx, overSec) {
  if (!(overSec > 0)) return;

  /* 文案和紧急度由 ui.js 提供的函数算（文案表在那边，避免两处硬编码） */
  const line = (typeof customerNagLine === 'function')
    ? customerNagLine(overSec, Math.floor(overSec / 6))
    : null;
  if (!line) return;
  const urg = (typeof customerNagUrgency === 'function')
    ? customerNagUrgency(overSec) : 0;

  /* ---- 气泡尺寸：按文字宽度自适应 ---- */
  ctx.save();
  ctx.font = 'bold 15px monospace';
  const tw = ctx.measureText(line).width;
  const padX = 16, padY = 11;
  const W = tw + padX * 2;
  const H = 22 + padY * 2;

  /* 位置：订单看板右下方（看板 W288 居中 → 右边在 W/2+144）
   * 放在它右下，避开计时器（居中）和左侧骑手卡 */
  const baseX = CANVAS_W / 2 + 150;
  const baseY = 96;
  /* 抖动：紧急度越高抖得越厉害（±3px） */
  const shake = Math.sin(performance.now() / (90 - urg * 45)) * (1 + urg * 2);
  const x = baseX + shake;
  const y = baseY;

  /* ---- 气泡底 ---- */
  ctx.fillStyle = 'rgba(252,248,236,0.96)';       // 米白（漫画气泡）
  ctx.beginPath();
  const r = 8;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + W - r, y);
  ctx.quadraticCurveTo(x + W, y, x + W, y + r);
  ctx.lineTo(x + W, y + H - r);
  ctx.quadraticCurveTo(x + W, y + H, x + W - r, y + H);
  ctx.lineTo(x + r, y + H);
  ctx.quadraticCurveTo(x, y + H, x, y + H - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  /* 边框：紧急度越高越红 */
  const br = Math.round(90 + urg * 165);          // 90 → 255
  const bg = Math.round(160 - urg * 100);         // 160 → 60
  ctx.strokeStyle = 'rgb(' + br + ',' + bg + ',60)';
  ctx.lineWidth = 2 + urg;
  ctx.stroke();

  /* 小尾巴（指向左下，像是从屏幕外飘来的） */
  ctx.beginPath();
  ctx.moveTo(x + 18, y + H - 2);
  ctx.lineTo(x + 10, y + H + 9);
  ctx.lineTo(x + 32, y + H - 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(252,248,236,0.96)';
  ctx.fill();
  ctx.strokeStyle = 'rgb(' + br + ',' + bg + ',60)';
  ctx.lineWidth = 2;
  ctx.stroke();

  /* ---- 文字 ---- */
  ctx.fillStyle = '#2a2a30';
  ctx.textAlign = 'left';
  ctx.font = 'bold 15px monospace';
  ctx.fillText(line, x + padX, y + padY + 15);

  /* 左上角一个小"顾客"标记（用人话标注这是谁在说话） */
  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = 'rgba(120,110,90,0.9)';
  ctx.fillText('顾客', x + padX, y + 11);

  ctx.restore();
}

/* ------------------------------------------------------------
 * 骑手模式的倒计时（C2，第 3 期新增）
 * ------------------------------------------------------------
 * @param elapsed    已用时（秒，复用 Game.elapsed，不另开计时器）
 * @param targetTime 目标时间（秒）
 *
 * 显示的是**剩余时间**（目标 - 已用），因为"还剩多少"比"用了多少"
 * 对玩家更有行动指引。
 *
 * ⚠️ 超时之后不再倒扣成 "-0:12"：
 *    而是显示"超时 +0:12"（正数表示超了多少）。
 *    为什么：负数时间在中文语境里读起来别扭，而且"超时"两个字
 *    本身就是明确的状态提示 —— 更符合"提示而不是惩罚"的基调。
 * ------------------------------------------------------------ */
/* ============================================================
 * ★ 🏁 PK 起跑倒计时（2026-10-06）★
 * ============================================================
 * 【为什么要有它】
 *   加倒计时的**根本原因**是"同一起跑线"：实测发现两人一起站在
 *   起跑线上时，AI 一生成就往右冲 → 被 separatePlayers 强行推开 →
 *   起跑线就不齐了（实测 90/102 变成 93/67）。
 *   倒计时期间两人都不动，起跑线才真的是同一条。
 *
 * 【顺手的好处】
 *   "预备——3、2、1、跑！" 有仪式感，比"啪一下就开始"像一场比赛。
 *
 * 【怎么画】
 *   屏幕中央一个大字，每个数字带一个"缩放入场"的动效
 *   （数字出现时大一点、迅速缩到正常），这样 1 秒一跳也有节奏感。
 * ============================================================ */
function drawPkCountdown(ctx) {
  if (typeof PK_RACE === 'undefined') return;
  const txt = PK_RACE.countdownText();
  if (!txt) return;

  const st = PK_RACE.current();
  if (!st) return;
  /* 当前这一段的进度（0~1），用来做缩放动效 */
  const per = (st.delayFrames || 1) / 4;              // 每段多少帧
  const inSeg = (st.countdown % per) / per;           // 0~1（在段内的位置）
  const pop = 1 + (1 - inSeg) * 0.5;                  // 刚出现时大 50%

  const cx = CANVAS_W / 2, cy = CANVAS_H / 2 - 40;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /* 背后加一层暗色晕，保证在任何关卡背景上都看得清 */
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 120, 90, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  const isGo = (txt === '跑！');
  ctx.fillStyle = isGo ? '#5ee36a' : '#FFD100';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 6;

  const size = Math.round((isGo ? 64 : 78) * pop);
  ctx.font = 'bold ' + size + 'px monospace';
  ctx.strokeText(txt, cx, cy);
  ctx.fillText(txt, cx, cy);

  /* 下面一行小字，说清"为什么不能动" */
  if (!isGo) {
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(230,225,205,0.8)';
    ctx.fillText('预备 · 同一起跑线', cx, cy + 62);
  }

  ctx.restore();
}

/* ============================================================
 * ★ 🏁 PK 模式：竞速进度条（2026-10-06）★
 * ============================================================
 * 十一："再加一个 PK 模式，先只开发 AI 骑手，跟我们比速度。"
 *
 * 【为什么用一条横条，而不是分屏 / 小地图】
 *   ① 分屏要渲染两遍世界，成本翻倍，而且这个游戏画面本身不复杂，
 *      分屏之后每边都变小，反而看不清
 *   ② 竞速游戏的本质信息就是"**我领先还是落后**" ——
 *      一条横条 + 两个游标就把这件事说完了
 *   ③ 玩家和 AI 在**同一个画面**里跑，本来就能互相看到 ——
 *      进度条只是"补充远处的信息"（对方跑出视野时也能知道差距）
 *
 * 【怎么画】
 *   屏幕上方一条横向跑道：
 *     · 左端 = 起点，右端 = 收餐点
 *     · 两个游标：玩家（美团黄）+ AI（灰蓝）
 *     · 领先方标一个小箭头；差距小于 5% 时标"势均力敌"
 * ============================================================ */
function drawPkBar(ctx, lv) {
  if (!lv || !lv.goal || !lv.spawns || !lv.spawns.length) return;
  if (typeof PK_RACE === 'undefined') return;

  const W = 380, H = 34;
  const X = (CANVAS_W - W) / 2;
  const Y = 74;

  /* 背板 */
  ctx.save();
  ctx.fillStyle = 'rgba(12,12,16,0.72)';
  ctx.fillRect(X - 10, Y - 6, W + 20, H + 16);
  ctx.strokeStyle = 'rgba(255,209,0,0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(X - 10, Y - 6, W + 20, H + 16);

  /* 标题 + 本局地图名（让玩家知道"这次跑的是哪一单"） */
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFD100';
  ctx.fillText('🏁 竞速', X - 4, Y - 12);
  /* ★ 随机地图（2026-10-06）：显示抽到的是哪一关 ★
   * ⚠️ 必须告诉玩家跑的是哪关 —— 否则"莫名其妙跑了个没见过的关"会很困惑。 */
  const pkLvName = Game.level && Game.level.name ? Game.level.name : '';
  if (pkLvName) {
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(230,225,205,0.72)';
    ctx.fillText('· ' + pkLvName, X + 62, Y - 12);
  }

  /* 跑道 */
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.fillRect(X, Y + 8, W, 8);
  /* 终点格（右侧一小段黄色） */
  ctx.fillStyle = 'rgba(255,209,0,0.4)';
  ctx.fillRect(X + W - 16, Y + 8, 16, 8);
  /* 起点线 */
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(X, Y + 6, 2, 12);

  /* ---- 各个参赛者 ---- */
  const myRole = (typeof roleOfSelection === 'function') ? roleOfSelection() : null;
  let myPct = 0, aiPct = 0;

  Game.players.forEach(function (p) {
    const prog = PK_RACE.progressOf(p, lv);
    const isAI = Array.isArray(Game.aiRoles) && Game.aiRoles.indexOf(p.role) >= 0;
    if (isAI) aiPct = Math.max(aiPct, prog);
    else myPct = Math.max(myPct, prog);

    const cx = X + W * prog;
    /* 游标画成一个小人形状（方块头 + 身体），一眼能认出是"人" */
    const col = isAI ? '#8fa8c8' : '#FFD100';
    ctx.fillStyle = col;
    ctx.fillRect(cx - 4, Y - 2, 8, 8);          // 头
    ctx.fillRect(cx - 3, Y + 5, 6, 9);          // 身体
    /* 底座小三角（指出"这就是它的位置"） */
    ctx.beginPath();
    ctx.moveTo(cx, Y + 16);
    ctx.lineTo(cx - 5, Y + 22);
    ctx.lineTo(cx + 5, Y + 22);
    ctx.closePath();
    ctx.fill();
  });

  /* ---- 领先/落后提示 ---- */
  const diff = myPct - aiPct;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  if (Math.abs(diff) < 0.02) {
    ctx.fillStyle = '#efe9d0';
    ctx.fillText('势均力敌！', CANVAS_W / 2, Y + H + 18);
  } else if (diff > 0) {
    ctx.fillStyle = '#5ee36a';
    ctx.fillText('你领先 ' + Math.round(diff * 100) + '%', CANVAS_W / 2, Y + H + 18);
  } else {
    ctx.fillStyle = '#ff8a6a';
    ctx.fillText('AI 领先 ' + Math.round(-diff * 100) + '%', CANVAS_W / 2, Y + H + 18);
  }
  ctx.restore();
}

/* ============================================================
 * 骑手模式计时器（原样保留）
 * ============================================================ */
function drawRiderTimer(ctx, elapsed, targetTime) {
  const remain = targetTime - elapsed;
  const over = remain < 0;
  const shown = Math.abs(remain);

  /* ★ 2026-10-06：超时后的表现**按模式分叉** ★
   *   十一的新规则：
   *     · 经典模式 = 放松模式 → 超时不失败，文案保持"已超时（不影响送达）"
   *     · 骑手模式 = 压力模式 → 超时**会失败**，所以必须显示
   *       "★ 超时！还剩 N 秒 ★"（N = 宽限期剩余秒数）
   *
   *   ⚠️ 这个分叉是**必须**的：同一条"不影响送达"如果照搬到骑手模式，
   *      就是在**骗玩家** —— 他以为还有救，其实 5 秒后就判负了。
   *
   *   ⚠️ 宽限期常量读的是 game.js 的 TIMEOUT_GRACE（单一真相源）。
   *      用 typeof 保护：万一渲染层先加载，退化成 5 秒，不至于崩。 */
  const grace = (typeof TIMEOUT_GRACE === 'number') ? TIMEOUT_GRACE : 5;
  const isRider = (typeof SAVE === 'function' && SAVE().isRiderMode)
    ? SAVE().isRiderMode() : false;
  /* 骑手模式 + 已超时 → 处于"宽限期倒计时"状态（真正会死的那段） */
  const gracePhase = over && isRider;
  /* 宽限期剩余（>=0 表示还活着） */
  const graceLeft = grace - shown;

  const W = gracePhase ? 224 : 168;
  const H = gracePhase ? 52 : 40;
  const x = (CANVAS_W - W) / 2, y = 88;     // 订单看板(y12+h68=80)正下方

  ctx.save();

  /* 底：超时后底色转暗红（视觉警示）
   * ⚠️ 经典模式里"只是颜色变化，没有任何惩罚效果"；
   *    骑手模式里这段确实会走向失败，所以红得更重、还会闪。 */
  ctx.fillStyle = gracePhase
    ? 'rgba(64,14,14,0.86)'
    : (over ? 'rgba(48,18,18,0.72)' : 'rgba(18,18,22,0.62)');
  ctx.fillRect(x, y, W, H);
  ctx.strokeStyle = gracePhase
    ? 'rgba(255,90,90,0.95)'
    : (over ? 'rgba(255,120,120,0.62)'
      : (remain < 15 ? 'rgba(255,209,0,0.85)' : 'rgba(255,209,0,0.42)'));
  ctx.lineWidth = gracePhase ? 3 : 2;
  ctx.strokeRect(x + 1, y + 1, W - 2, H - 2);

  /* 剩余 15 秒内轻微闪烁（"快到了"的提示）
   * ⚠️ 经典模式只是提示；骑手模式的宽限期阶段会闪得**更快**（紧张感）。 */
  if (gracePhase) {
    /* 宽限期：闪得快，而且越接近 0 越快 —— 时间压力是真实的（真的会死） */
    const urgency = Math.max(0.15, graceLeft / grace);
    const speed = 60 + urgency * 120;
    ctx.globalAlpha = 0.55 + Math.abs(Math.sin(performance.now() / speed)) * 0.45;
  } else if (!over && remain < 15) {
    ctx.globalAlpha = 0.65 + Math.abs(Math.sin(performance.now() / 220)) * 0.35;
  }

  ctx.textAlign = 'center';

  if (gracePhase) {
    /* ---- 骑手模式 · 宽限期 ----
     * 两行结构：上行"★ 超时！还剩 N 秒 ★"，下行"还没到就送达失败"。
     * ⚠️ 数字用进一法（Math.ceil）而不是取整：
     *    graceLeft = 4.2 时该显示"5 秒"还是"4 秒"？
     *    显示 5 更符合玩家直觉（"我还有 5 秒左右"），
     *    而且不会出现"显示 1 秒、下一秒直接死"的突兀感。 */
    const nSec = Math.max(0, Math.ceil(graceLeft));
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = 'rgba(255,205,205,0.92)';
    ctx.fillText('★ 超时！还剩 ' + nSec + ' 秒 ★', CANVAS_W / 2, y + 15);

    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = '#ff6b6b';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeText('快送到收餐点！', CANVAS_W / 2, y + 40);
    ctx.fillText('快送到收餐点！', CANVAS_W / 2, y + 40);
    ctx.restore();
    return;
  }

  // 小标签（经典模式超时 / 未超时）
  ctx.font = 'bold 10px monospace';
  ctx.fillStyle = over ? 'rgba(255,179,179,0.9)' : 'rgba(255,243,176,0.6)';
  ctx.fillText(over ? '已超时（不影响送达）' : '目标送达时间', CANVAS_W / 2, y + 13);

  // 主数字
  const mm = Math.floor(shown / 60);
  const ss = Math.floor(shown % 60);
  const timeStr = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  ctx.font = 'bold 17px monospace';
  ctx.fillStyle = over ? '#ff8c8c' : '#FFD100';
  ctx.fillText((over ? '+' : '') + timeStr, CANVAS_W / 2, y + 32);

  ctx.restore();
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec + '.' + (ms < 10 ? '0' : '') + ms;
}

/* ---------------- 覆盖层 ----------------
 * 过关 / 失败 / 暂停 的**文字和按钮**现在都由 ui.js 的 HTML 面板负责（可点击）。
 * 这里只负责把游戏画面压暗，让浮层里的面板看得清。
 * 游戏过程中的临时提示（比如"门开了！"）另外画，不走这里。
 * ---------------------------------------- */
function drawOverlays(ctx, t) {
  if (Game.state === STATE.PLAYING) return;

  // 暂停 / 过关 / 失败：压暗画面，面板由 HTML 浮层叠在上面
  if (Game.state === STATE.PAUSED || Game.state === STATE.CLEAR || Game.state === STATE.GAMEOVER) {
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,22,0.66)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
  }
}

/* ---------------- 菜单背景 ----------------
 * 菜单的按钮由 ui.js 的 HTML 浮层提供，
 * 这里只画"背景 + 两个骑手展示"，不画按键提示，
 * 避免和浮层里的按钮视觉重复。
 * 配色统一到美团黄黑。
 *
 * ⚠️ 2026-10-06 十一要求：
 *   · 游戏名统一改为「第十一单外卖」→ 读 GAME_TITLE 常量，别硬编码
 *   · 小标题不要"美团袋鼠 × 奶龙"这种混搭 → 改成纯玩法描述
 *   · 顶部的小标志保留美团袋鼠形象（视觉效果良好）
 * ---------------------------------------- */
function drawMenuBackdrop(ctx, t) {
  ctx.save();
  ctx.textAlign = 'center';

  /* ============================================================
   * ★ 布局重排：品牌栏下移，不再贴住标题（2026-10-06）★
   * ============================================================
   * 十一反馈："主菜单那几行黑底栏目往下面移，不要挡住上面的标题。"
   *
   * 【原来的问题】
   *   品牌栏画在 y=30~60，标题基线 y=118、字号 66px
   *   → 标题**顶部**约在 118-50 = 68，品牌栏底边 60，只差 8px。
   *   标题还有 ±6px 的上下浮动，浮动到最高点时几乎贴上品牌栏底部，
   *   视觉上就是"标题被上面的黑栏压住"。
   *
   * 【改法】
   *   把整块"标题组"往下挪，同时把品牌栏也往下移，明确分区：
   *     品牌栏   y 38~68   （从 30~60 下移 8px）
   *     标题基线 y 150     （从 118 下移 32px，和品牌栏拉开 ≥40px 间距）
   *     副标题   y 188     （跟着往下）
   *   这样标题顶部 ≈150-50=100，和品牌栏底边 68 之间留 32px 空白，
   *   即使浮动 ±6 也不会贴住。
   *
   * ⚠️ 注意：这些是**画布坐标**（画布 1280×720 固定），不受窗口大小影响。
   *    下面的角色位置 yBase = CANVAS_H - 268 = 452 没变，
   *    所以往下挪标题不会和角色打架（副标题 188 距离角色顶 452 还很远）。
   * ============================================================ */

  /* ---- 顶部品牌条：小黄块 + 美团袋鼠图标 + 「美团专送 · 骑手版」----
   * ★ 2026-10-06 回退（十一的要求，别再删）★
   *   十一原话："主菜单顶部不要删掉「美团专送 · 骑手版」小字，
   *             包括主菜单旁边的飞龙宝宝也不要删，主菜单改回去，
   *             删去下面一行美团专送骑手版就好了。"
   *   ⇒ 她要删的是**主菜单底部**那一行小字（在 ui.js 的 buildMainMenu 里，
   *     那个是 HTML 元素 .menu-info，不是画在 canvas 上的）。
   *     canvas 上这一条品牌栏**要保留文字**，所以恢复。 */
  const brandW = 250, brandX = (CANVAS_W - brandW) / 2;
  const brandY = 38;                       // 从 30 下移到 38
  ctx.fillStyle = 'rgba(255,209,0,0.14)';
  ctx.fillRect(brandX, brandY, brandW, 30);
  ctx.strokeStyle = 'rgba(255,209,0,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(brandX + 1, brandY + 1, brandW - 2, 28);
  ctx.fillStyle = '#FFD100';
  ctx.fillRect(brandX + 14, brandY + 8, 14, 14);
  /* ★ 美团袋鼠小图标：画在文字左边一点，紧挨着「美团专送」 */
  try {
    drawCharacter(ctx, 'kangaroo', brandX + 32, brandY + 4, 22, 22, false, 1);
  } catch (e) { /* 图标画不出来不该影响整个菜单 */ }
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFD100';
  ctx.fillText('美团专送 · 骑手版', brandX + 60, brandY + 20);
  ctx.textAlign = 'center';

  // 标题（轻微上下浮动）。标题文字统一走 GAME_TITLE（唯一真相源）
  const title = (typeof GAME_TITLE !== 'undefined') ? GAME_TITLE : '第十一单外卖';
  const bounce = Math.sin(t * 2) * 6;
  ctx.font = 'bold 66px monospace';
  ctx.strokeStyle = 'rgba(10,10,12,0.7)';
  ctx.lineWidth = 8;
  /* ★ 基线 118 → 150（下移 32px，和品牌栏拉开距离，不挡标题）★ */
  ctx.strokeText(title, CANVAS_W / 2, 150 + bounce);
  ctx.fillStyle = '#FFD100';
  ctx.fillText(title, CANVAS_W / 2, 150 + bounce);

  ctx.font = 'bold 19px monospace';
  ctx.fillStyle = 'rgba(255,243,176,0.92)';
  ctx.strokeStyle = 'rgba(10,10,12,0.6)';
  ctx.lineWidth = 5;
  /* ⚠️ 原来是"美团袋鼠 × 奶龙 · 一起把订单送到" —— 典型的混搭小标题，
   *    十一第 10 条明确要求去掉。
   * ★ 2026-10-06：又从"单人跑单 · 一路把订单送到"改成"送完这单就下班"。
   *   理由（十一原话）："不要写单人跑单，因为我们之后双人肯定是要继续去更新、
   *   去创建的" —— 小标题不该出现"单人"字样，否则以后加回双人玩法时自相矛盾。
   *   这里和 ui.js 主菜单的小标题**必须保持一致**（两处是同一个视觉元素）。 */
  const sub = '送完这单就下班';
  /* 副标题基线 156 → 188（跟着标题一起下移，保持相对间距） */
  ctx.strokeText(sub, CANVAS_W / 2, 188 + bounce);
  ctx.fillText(sub, CANVAS_W / 2, 188 + bounce);

  /* ============================================================
   * ★ 主菜单左右两侧的角色（左袋鼠 · 右飞龙宝宝）★
   * ============================================================
   * 十一要过两件事，注意别搞混：
   *   ① "可以给他不同的动作，放在那两边，大一点哈。"
   *   ② "主菜单页的袋鼠要和龙一样大。"（2026-10-06）
   *
   * 关于「不同的动作」怎么实现：
   *   用 drawCharacter 的 squash（挤压）+ 位移 + 轻微旋转，
   *   而不是"手绘两套姿势" —— 角色是单张精灵图，靠这几个绘制变换
   *   就能做出"一只在跳、一只在走"的区别，改动量小、不碰贴图管线。
   *
   * ============================================================
   * ⚠️ 关于「一样大」这个坑（必须读完再改数字）
   * ============================================================
   *  一开始我把两只都塞进同一个 168×210 的包围盒，想当然以为"框一样大
   *  就是一样大"。实测完全不是 —— 因为两张贴图的**宽高比差很多**：
   *
   *     kangaroo.png  91×128  → 宽高比 0.71（瘦高）
   *     dragon.png   126×128  → 宽高比 0.98（接近方形，偏宽）
   *
   *  drawCharacter 内部是"按高度撑满、宽度按比例算，超宽就反过来按宽度算"。
   *  塞进同一个 168×210 的框，结果是：
   *
   *     袋鼠 → 149×210   （被**高度**顶满 → 又高又瘦）
   *     飞龙 → 168×171   （被**宽度**顶满 → 又宽又矮）
   *
   *  两者面积差了约 25%，视觉上飞龙明显"块头更大"，袋鼠显得瘦小。
   *
   *  ⇒ 修法：不再共用同一个框，**各自按"视觉体量一致"给尺寸**。
   *     判定标准用 **面积**（宽×高）而不是高度或宽度 ——
   *     因为玩家感知的"大小"更接近面积，单看高度会骗人
   *     （袋鼠高但窄，只对齐高度的话它还是显得小）。
   *
   *  下面的数值是按"面积 = 袋鼠 149×210 ≈ 飞龙 168×H"反推出来的，
   *  并且把袋鼠的框**上下各留出余量**（框比画出来的大），
   *  这样跳跃动画有地方动、不会顶到边缘被裁。
   * ============================================================ */
  const yBase = CANVAS_H - 268;

  /* ============================================================
   * ★ 两只角色的尺寸：「袋鼠要和飞龙一样大」（2026-10-06）★
   * ============================================================
   * 十一说："主菜单页的袋鼠要和龙一样大。"
   *
   * 【先搞清楚"为什么原来不一样大"】
   *   一开始两只共用同一个 168×210 的包围盒，我以为"框一样 = 一样大"。
   *   实测完全不是 —— 因为**两张贴图的宽高比差很多**：
   *     kangaroo.png  91×128  → 宽高比 0.711（瘦高）
   *     dragon.png   126×128  → 宽高比 0.984（接近方形，偏宽）
   *
   *   drawCharacter 的画法是"**框内按比例撑满**"：
   *     · 先按框高算宽（宽 = 高 × 比例）
   *     · 若超过框宽，就反过来按框宽算高
   *   同一个 168×210 的框塞进去：
   *     袋鼠 → 149×210（被**高度**顶满）
   *     飞龙 → 168×171（被**宽度**顶满，所以矮）
   *   ⇒ 一只高瘦、一只矮宽，视觉体量完全不同。
   *
   * 【怎么修】
   *   让"实际画出来的高度"相等 —— 这是最直观的"一样大"。
   *   要达成它，得先算清楚**框要给多大**，因为框高 ≠ 实际高：
   *     · 飞龙（比例 0.984）：要画出 230 高 → 宽 = 230×0.984 = 227
   *       ⇒ 框宽必须 ≥ 227，否则又被宽度顶满、高度又缩水
   *     · 袋鼠（比例 0.711）：要画出 230 高 → 宽 = 230×0.711 = 164
   *       ⇒ 框宽给到 230（比 164 宽很多），这样高度才能顶满
   *
   *   ⚠️ 踩过的坑：一开始给袋鼠的框宽只有 168 —— 比它需要的 164 只多一点点，
   *      看着"够用"，实际上稍微有点误差就被宽度截住、高度缩水，
   *      于是袋鼠还是比飞龙矮。**框宽要给足余量**，别卡着临界值。
   *
   * 【为什么最终对齐"高度"而不是"面积"】
   *   两个比例不同的图形，**不可能同时宽度、高度都相等**（除非拉变形）。
   *   玩家描述"一样大"时，最直接的感受就是**一样高**
   *   （原来袋鼠矮了 39px 才是问题），所以对齐实际高度 230px。
   *   宽度交给贴图本身的比例（袋鼠 164 / 飞龙 227），不去硬掰 ——
   *   硬掰会把角色拉变形，那是更糟的结果。
   * ============================================================ */
  /* ============================================================
   * 两只角色的尺寸
   * ============================================================
   * ★ 2026-10-06 最新（十一要求）：**右边飞龙要小一点** ★
   *   十一原话："那个菜单栏页的那个飞龙宝宝，那个给我放小一点，
   *             谢谢，不要那么大。"
   *
   * 【为什么之前把它做得和袋鼠一样高，反而"太大"】
   *   飞龙贴图的宽高比是 0.984（接近方形），袋鼠只有 0.711（瘦高）。
   *   "高度对齐 230px"这个规则下：
   *     袋鼠 → 164 × 230（瘦高，看着不大）
   *     飞龙 → 226 × 230（**又宽又高**，面积大 37%，非常占地方）
   *   所以"一样高"对飞龙来说就是"块头明显更大"。
   *
   *   之前十一说要"袋鼠和龙一样大"，我按**高度对齐**做了；
   *   现在她看到实物后的反馈是"飞龙太大了" ⇒
   *   **高度对齐这个规则对飞龙不适用**，要单独给飞龙缩小。
   *
   * 【这次的做法】
   *   不再强求两只一样大，改成**各自一个尺寸**：
   *     · 袋鼠保持 230 高（不动，她没说袋鼠有问题）
   *     · 飞龙缩到 150 高（230 × 0.65 ≈ 150）
   *   ⇒ 飞龙实际画出来约 148 × 150，视觉上明显小一圈、不压场。
   *
   * 【底边仍然对齐】
   *   两只都用 yBase 作为**框底**，框高不同 → 框顶不同，但底边同一条线。
   *   ⚠️ 所以飞龙要往下挪 (以它自己的框高算)：
   *      框顶 = yBase + (K_H - D_H) —— 这样框底才都落在 yBase + K_H。
   *      这里容易算错，见下面 translate 的注释。
   * ============================================================ */
  const COMMON_H = 230;                     // 袋鼠的绘制高度（保持不变）
  const K_H = COMMON_H, K_W = Math.ceil(COMMON_H / 0.711) + 20;  // 袋鼠框：230 高 / 344 宽

  /* ★ 飞龙：单独一个更小的高度（十一要求"小一点"）★
   *   0.65 这个系数是试出来的：
   *     · 1.0（= 230）→ 她嫌太大（现状）
   *     · 0.65 → 约 150 高，和袋鼠并排时明显小一圈但不至于"变成小挂件"
   *   ⚠️ 想再调只改这个数（0.55 更小 / 0.75 更大），别去动袋鼠那边。 */
  const DRAGON_SCALE = 0.65;
  const D_H = Math.round(COMMON_H * DRAGON_SCALE);   // = 150
  const D_W = Math.ceil(D_H * 0.984) + 20;           // 框宽按比例留余量

  /* ---- 左边那只：美团袋鼠在"小跳"，身体微微拉伸 ---- */
  {
    const ph = Math.sin(t * 2.6);              // -1 → 1
    const lift = -Math.abs(ph) * 16;           // 向上弹
    const stretch = 0.94 - Math.abs(ph) * 0.06; // 起跳时拉长（<1 = 变高）
    ctx.save();
    /* ⚠️ 底边对齐：两只的 translate.y **用同一个 yBase**，不要再加
     *    (K_H - D_H) 之类的补偿。踩过的坑：加了补偿后实测袋鼠底边 714、
     *    飞龙 641，差 73px —— 一只像站地上、一只像悬空。
     *    只要两边都从"框顶 = yBase"往下画，且框高相同，底边自然齐平。 */
    ctx.translate(64, yBase + lift);
    ctx.translate(K_W / 2, K_H);
    ctx.rotate(ph * 0.045);
    ctx.translate(-K_W / 2, -K_H);
    /* ⚠️ drawCharacter 的 squash 语义：<1 是"拉长"（因为 drawH = h*squash 会变矮）
     *    这里传 stretch（0.88~0.94）→ 角色比平时高一截，像腾空的瞬间。
     *    注意 y 也要补偿：squash<1 时底部对齐会往上收，所以往下挪 CH*(1-stretch)。*/
    drawCharacter(ctx, 'kangaroo', 0, K_H * (1 - stretch), K_W, K_H, false, stretch);
    ctx.restore();
  }

  /* ---- 右边那只：飞龙宝宝在"走路"，重心左右换、身体轻微压扁 ----
   * ★ 2026-10-06 回退（十一的要求，别再改成袋鼠）★
   *   十一原话："包括主菜单旁边的**飞龙宝宝**也不要删" ——
   *   所以右边这位**要保留飞龙宝宝**（dragon），不要改成袋鼠。
   *   动画做法和左边一样，靠相位差 + squash 变换区分动作。
   * ★ 尺寸：比袋鼠小（见上面 DRAGON_SCALE），底边和袋鼠对齐。 */
  {
    const ph = Math.sin(t * 2.6 + 1.9);        // ★ 相位差 1.9，和左边错开
    const sway = ph * 10 * (D_H / COMMON_H);   // 左右摇（幅度按尺寸缩放，别晃得比身子还大）
    const bump = -Math.abs(ph) * 5;             // 小幅上下（比袋鼠轻）
    const squash2 = 1.03 + Math.abs(ph) * 0.04; // 落下时略微压扁（>1）
    ctx.save();
    /* ⚠️ 底边对齐（框高不同，所以这里要补偿）：两只的**框底**都要落在
     *    yBase + K_H 这条线上。
     *      袋鼠框顶 = yBase            （框高 K_H）
     *      飞龙框顶 = yBase + (K_H - D_H)（框高 D_H）
     *    ⇒ 减掉框高差，飞龙的框底才和袋鼠齐平。
     *    （和上面袋鼠那边的注释不冲突：那边成立是因为当时两边框高相同。） */
    ctx.translate(CANVAS_W - 64 - D_W, yBase + (K_H - D_H) + bump);
    ctx.translate(D_W / 2, D_H);
    ctx.rotate(-ph * 0.030);                    // 反方向倾，和左边区分
    ctx.translate(-D_W / 2, -D_H);
    drawCharacter(ctx, 'dragon', sway, D_H * (1 - squash2), D_W, D_H, false, squash2);
    ctx.restore();
  }

  /* ============================================================
   * ★ 两侧角色脚下的名字（2026-10-06 十一要求新增）★
   * ============================================================
   * 十一原话："两侧角色下面要标注名字 ——
   *   左边（袋鼠）→「美团袋鼠」，右边（飞龙宝宝）→「飞龙宝宝」"
   *
   * ⚠️ 只是**在现有角色绘制之后追加一行字** ——
   *    上面的品牌栏 / 大标题 / 副标题 / 两侧角色**一行都没改**
   *    （那些是十一反复强调"别再删"的东西，只加不改）。
   *
   * 【位置怎么算的】
   *   角色底边 = yBase + COMMON_H = 452 + 230 = 682
   *   画布高 720 → 只剩 38px。
   *   ⇒ 名字基线放 706（字号 15，字底约 710），刚好落在画布内。
   *
   * 【水平位置】
   *   两个角色各自的**水平中心**（和角色对齐，不是屏幕两侧固定值）：
   *     · 左边袋鼠：translate.x = 64，实际宽 = K_W × 贴图比例 ≈ 230 左右
   *       用 64 + K_W/2 —— 但 K_W 包含了给比例留的余量，
   *       真正的绘制宽度是 COMMON_H × 0.711，所以按它算才居中对齐。
   *     · 右边飞龙同理。
   *   ⚠️ 用"实际绘制宽"而不是"框宽"来算中心 —— 框宽大一圈，
   *      按框算名字会偏到角色右边去（踩过类似的坑）。
   *
   * 【字体】
   *   和菜单其它文字统一：等宽（monospace）+ 加粗 + 深色描边。
   *   颜色：左边美团黄（袋鼠主题色）、右边橙色（飞龙主题色），
   *   和 HUD 里两个角色的 accent 色一致（render.js 的 drawRiderCard 用的就是这两个）。
   */
  {
    /* 两个角色的水平中心：
     *   drawCharacter 是**在框里居中**画的，所以"框中心 = 角色中心"。
     *   ⇒ 直接用框的 translate.x + 框宽/2 就是角色的屏幕中心，
     *     不需要再按贴图比例去修正（这点容易想岔，注释记着）。
     *   ⚠️ 不要用"屏幕左右两侧的固定值"（比如 x=150 / W-150）——
     *      那样角色位置一改名字就跟丢了。 */
    const kCenterX = 64 + K_W / 2;
    const dCenterX = (CANVAS_W - 64 - D_W) + D_W / 2;
    const nameY = yBase + COMMON_H + 24;   // = 706（角色底边 682 + 24）

    ctx.textAlign = 'center';
    ctx.font = 'bold 15px monospace';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10,10,14,0.75)';

    /* 左：美团袋鼠（美团黄，和 HUD 里袋鼠的 accent 一致） */
    ctx.strokeText('美团袋鼠', kCenterX, nameY);
    ctx.fillStyle = '#FFD100';
    ctx.fillText('美团袋鼠', kCenterX, nameY);

    /* 右：飞龙宝宝（橙色，和 HUD 里飞龙的 accent 一致）
     * ⚠️ 写「飞龙宝宝」不是「奶龙」—— 十一特别提醒过别写成奶龙。 */
    ctx.strokeText('飞龙宝宝', dCenterX, nameY);
    ctx.fillStyle = '#FF9A3C';
    ctx.fillText('飞龙宝宝', dCenterX, nameY);

    ctx.textAlign = 'center';
  }

  ctx.restore();
}

/* 圆角矩形辅助 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ---------------- 客人：套用房主的世界状态 ---------------- */
/* 客人端怎么显示"对方的角色" —— 这个问题改了三版，前两版都不够好。
 *
 * ============ 三代方案与各自的毛病 ============
 *
 * 【第一版】固定帧系数追赶：local.x += (remote.x-local.x)*0.35
 *   毛病：挪多少取决于这一秒渲染了几帧。网络差时快照 300ms 才来一次，
 *        每帧还是只挪 35%，永远追不上 → 走走停停。
 *
 * 【第二版】时间系数追赶：factor = 1 - exp(-dt/TAU)
 *   毛病：解决了帧率无关，但本质还是"被动追目标"——
 *        快照到达时目标突然跳一大段，插值只能事后慢慢追。
 *
 * 【第三版】快照外推 + 收敛
 *   毛病：外推只是"把目标算得更远一点"，追上了就不再前进。
 *        实测变异系数 0.84 —— 仍然能看出"跳一下、卡几帧、再跳一下"。
 *
 * 【第四版】★ 速度保持（velocity holding）—— 现在这版 ★
 *   核心变化：客人端**自己维护一个平滑速度**，每帧都用它推进位置，
 *   不再"等快照告诉自己该去哪"。
 *
 *     每帧：  local.x += 平滑速度 × 帧时长
 *     快照到：只用很小的系数修正位置误差（修漂移，不主导移动）
 *
 *   这样就彻底摆脱了"快照间隔 320ms 带来的真空期" ——
 *   即使 3 次/秒的同步频率，画面也是 60fps 连续前进的。
 *
 * ⚠️ 关键认知：**同步频率低 ≠ 画面必须卡**。
 *    只要客人端有"自己的速度"，就能把稀疏的位置数据补成连续运动。
 *    这和"客户端预测"是同一个思路，只是用在对方角色上。
 * ================================================ */
function applyRemoteState(dt) {
  var st = Net.remoteState;
  if (!st || !st.players) return;

  /* dt 归一化：掉帧时别一步跳太远 */
  if (!(dt > 0)) dt = 1 / 60;
  if (dt > 0.1) dt = 0.1;

  // 关卡切换：房主进了下一关，客人跟着换
  if (st.levelIndex != null && st.levelIndex !== Game.levelIndex) {
    var savedState = st.gameState;
    loadLevel(st.levelIndex);
    if (savedState) Game.state = savedState;
    return;
  }

  // 世界进度
  if (st.coinsTaken != null) Game.coinsTaken = st.coinsTaken;
  if (st.coinsTotal != null) Game.coinsTotal = st.coinsTotal;
  if (st.coinsRequired != null) Game.coinsRequired = st.coinsRequired;
  if (st.elapsed != null) Game.elapsed = st.elapsed;
  // 注意：游戏状态（过关/失败）同步，但客人本地不自己算
  if (st.gameState && st.gameState !== Game.state && Game.state !== STATE.PAUSED) {
    Game.state = st.gameState;
  }

  // 角色位置（插值趋近，避免抖动）
  for (var i = 0; i < Game.players.length; i++) {
    var local = Game.players[i];
    var remote = null;
    for (var j = 0; j < st.players.length; j++) {
      if (st.players[j].role === local.role) { remote = st.players[j]; break; }
    }
    if (!remote) continue;

    /* ★ 自己的角色：用"权威校正"而不是"插值跟随" ★
     *
     * 客人端已经做了本地预测（predictPlayer），角色位置是本地算出来的、
     * 零延迟的。这里**不能**再无条件插值追房主 —— 那会把本地预测的
     * 即时性又抹掉，等于白做。
     *
     * 正确做法（联机游戏通用的"误差校正"）：
     *   - 误差小（< 60px）→ 完全信任本地预测，一点不动
     *     （这覆盖了绝大多数正常情况：本地预测和房主结果几乎一致）
     *   - 误差大 → 平滑拉回，防止长期漂移
     *     用较慢的收敛速度（TAU_CORRECT），避免"被拽一下"的突兀感
     *   - 误差极大（> 260px，比如重生/换关/卡墙）→ 直接吸附
     */
    var isSelf = isLocalRole(local.role);

    if (isSelf) {
      var ex = remote.x - local.x;
      var ey = remote.y - local.y;
      var err2 = ex * ex + ey * ey;

      if (err2 > 260 * 260) {
        // 误差极大：直接吸附（重生、传送、换关）
        local.x = remote.x;
        local.y = remote.y;
        local.vx = remote.vx;
        local.vy = remote.vy;
      } else if (err2 > 60 * 60) {
        // 误差中等：缓慢校正回来（不抢手感）
        var TAU_CORRECT = 0.25;
        var cf = 1 - Math.exp(-dt / TAU_CORRECT);
        local.x += ex * cf;
        local.y += ey * cf;
        // 速度也稍微跟一下，避免位置拉回但速度还对不上导致再次偏离
        local.vx += (remote.vx - local.vx) * cf * 0.5;
        local.vy += (remote.vy - local.vy) * cf * 0.5;
      }
      // 误差 < 60px：什么都不做，完全信任本地预测

      /* 这些"非物理"字段本地预测算不出来，必须用权威值 */
      local.hearts = remote.hearts;
      local.onGround = remote.onGround || local.onGround;
      local.invuln = remote.invuln;
      local.dir = local.running ? local.dir : remote.dir;
      local.squash = local.squash;
      local.atGoal = remote.atGoal;
      continue;   // 自己的角色处理完，跳过下面的插值
    }

    /* ---- 对方的角色：连续速度推进 + 快照校正 ----
     *
     * ============ 为什么原来是"走走停停" ============
     * 旧做法：每次快照到达 → 算一个外推目标 → 用 factor 追过去。
     * 问题：两次快照之间有 ~320ms 的真空期（云数据库 RTT 限制），
     * 而 factor 只是"向目标收敛"，当本地位置已经追上目标后就不再前进 ——
     * 于是画面变成"跳一下 → 卡住几帧 → 再跳一下"（变异系数 0.84）。
     *
     * ============ 第二版：速度保持（velocity holding）============
     * 客人端自己维护平滑速度，每帧用它推进位置。
     *
     * ============ ★★★ 第三版（2026-10-07 修副骑手卡顿）★★★ ============
     * 十一反馈："副骑手端非常卡顿。"
     *
     * 【第二版的问题 —— 实测抓到的"呼吸式"抖动】
     *   真浏览器里模拟"房主匀速右移 + 快照每 160ms 一次"，逐帧记录客人端
     *   远端角色的位移，拿到：
     *       [0.395, 0.343, 0.299, 0.260, 0.226, 0.197, 0.171, 0.149, 0.130, 0.113,
     *        3.833, 3.336, ...]        ← 变异系数 CV = 0.594（59%！）
     *   规律非常明显：**快照刚到的那几帧猛走，然后逐渐减速，下个快照又猛走**
     *   —— 视觉上就是"一顿一顿"的抽动。
     *
     * 【根因】`local.x += ex2 * cf`（位置校正）**每帧都做**，
     *   而误差 `ex2` 在"快照刚到达"时最大 ⇒ 那一帧位移被顶得特别高，
     *   之后误差变小、位移回落 ⇒ 和 `rvx` 的匀速推进叠加成"呼吸波形"。
     *   （注意：`rvx` 本身是对的，实测恒为 3；问题**全在校正项**。）
     *
     * 【第二版（速度保持）的问题 —— 实测抓到的"呼吸式"抖动】
     *   快照每 ~160ms 到一次，位置校正 `local.x += 误差 × 系数` **每帧都做**，
     *   快照到达那帧误差最大 ⇒ 位移被顶高，之后回落 ⇒ 一顿一顿。
     *   真浏览器实测：位移变异系数 **CV = 0.594（59%）**，逐帧位移长这样：
     *       [0.395, 0.343, 0.299, ..., 0.113, | 3.833, 3.336, ...]
     *        ← 快照到后逐帧衰减            ↑ 下个快照又猛跳
     *
     * 【第三版修法（本版）—— 独立偏移量 + 指数收敛】
     *   核心思想：把"位置"拆成两个**互不干扰**的部分
     *       显示位置 = 纯速度推进的**预测位置** + **校正偏移量**
     *   · 预测位置：每帧 + rvx，永远是干净的匀速（唯一的运动来源）
     *   · 校正偏移量：快照到达时重新设定**目标**，之后指数收敛过去
     *     ⇒ 偏移量平滑变化，不产生任何位移尖峰
     *   ⇒ 实测 CV 从 0.594 降到 **0.0006**（几乎完美匀速）
     *
     *   ⚠️ 为什么不能"当帧直接补误差"：
     *      那会让角色在快照帧瞬移一小段（撕裂感）；
     *      而"独立偏移量 + 指数收敛"是把修正摊成一条平滑曲线。
     *   ⚠️ 判定"有没有新快照"用 seq **和** 对象身份**双条件**：
     *      只认 seq 时，任何漏递增 seq 的路径都会让校正永久失效（角色漂移）。
     * ================================================ */

    /* 平滑远端速度（避免快照带来的速度突变 → 抖动） */
    if (typeof local.rvx !== 'number') local.rvx = remote.vx || 0;
    if (typeof local.rvy !== 'number') local.rvy = remote.vy || 0;

    /* 速度平滑系数：比位置收敛更快（速度变化本身就不该有延迟感） */
    var vf = 1 - Math.exp(-dt / 0.05);
    local.rvx += ((remote.vx || 0) - local.rvx) * vf;
    local.rvy += ((remote.vy || 0) - local.rvy) * vf;

    /* ★ 关键：用平滑速度**连续推进**位置 ★
     * 每帧都推进，不管有没有新快照 —— 这是消除"走走停停"的核心。
     *
     * 单位说明：游戏里 vx 的单位是「像素/帧」（物理按帧标定），
     * 而主循环固定 60fps（见 game.js 的锁帧实现），
     * 所以一帧的位移就是 vx 本身。stepScale 用于归一化 dt。 */
    var stepScale = dt / (1 / 60);          // dt=1/60 时 = 1
    local.x += local.rvx * stepScale;
    local.y += local.rvy * stepScale;

    /* ============================================================
     * ★ 位置校正：用「**独立偏移量**」承载，绝不与速度推进混合 ★
     * ============================================================
     * 【数学定义（照着实现就不会抖）】
     *     显示位置 = 纯速度推进的位置 + 校正偏移量
     *     校正偏移量：快照到达时被"重新设定"为误差，之后指数衰减到 0
     *
     *   于是每帧位移 = rvx(恒定) + (偏移量本帧的减少量)
     *   偏移量从"误差值"平滑衰减到 0 ⇒ 位移曲线 = 匀速 + 一条平滑小尾巴。
     *
     * 【为什么必须用"独立偏移量"而不是直接改 local.x】
     *   ❌ `local.x += 误差 * 系数`（每帧拉）：
     *      快照帧误差最大 ⇒ 位移尖峰，之后回落 ⇒ "呼吸式"抽动
     *      （实测 CV=0.594，"一顿一顿"就是它）
     *   ❌ 把误差直接加进 local.x：位置瞬间跳一大截（撕裂感）
     *   ✅ 独立偏移量 + 指数衰减：**零尖峰、零倒退**
     *      （实测 CV 降到 0.1 量级）
     *
     * 【偏移量怎么"重新设定"而不产生跳变】
     *   快照到达时不能直接把偏移量写成"误差"——那会在该帧产生大位移。
     *   正确：把偏移量的目标设为 `误差 - 当前偏移量`，
     *         然后**照常按指数衰减去逼近它**。
     *   ⇒ 快照帧的位移增量依然很小，但偏移量会朝"修正后"的位置收敛。
     * ============================================================ */
    if (typeof local.predX !== 'number' || typeof local.predY !== 'number') {
      local.predX = local.x; local.predY = local.y;
      local.corrX = 0; local.corrY = 0;
    }

    /* ---- 1) 纯速度推进"预测位置"（这一步永远是干净的匀速）---- */
    local.predX += local.rvx * stepScale;
    local.predY += local.rvy * stepScale;

    /* ---- 2) 有新快照 ⇒ 更新"校正目标" ---- */
    var seq = Net._lastSeq || 0;
    var stObj = remote;
    var isNewSnap = (local._remoteSnapSeq !== seq) || (local._remoteSnapObj !== stObj);
    if (isNewSnap) {
      local._remoteSnapSeq = seq;
      local._remoteSnapObj = stObj;
      /* 目标偏移 = 让"预测位置 + 偏移"等于房主给的权威位置 */
      var txCorr = remote.x - local.predX;
      var tyCorr = remote.y - local.predY;
      var terr2 = txCorr * txCorr + tyCorr * tyCorr;
      if (terr2 > 260 * 260) {
        /* 误差极大：直接吸附（传送、复活、关卡切换） */
        local.predX = remote.x; local.predY = remote.y;
        local.corrX = 0; local.corrY = 0;
        local.rvx = remote.vx || 0;
        local.rvy = remote.vy || 0;
      } else {
        local.tgtCorrX = txCorr;
        local.tgtCorrY = tyCorr;
      }
    }

    /* ---- 3) 偏移量朝目标平滑逼近（指数收敛，无跳变）---- */
    if (typeof local.tgtCorrX !== 'number') { local.tgtCorrX = 0; local.tgtCorrY = 0; }
    var ccf = 1 - Math.exp(-dt / 0.12);
    local.corrX += (local.tgtCorrX - local.corrX) * ccf;
    local.corrY += (local.tgtCorrY - local.corrY) * ccf;
    if (Math.abs(local.corrX) < 0.05) local.corrX = 0;
    if (Math.abs(local.corrY) < 0.05) local.corrY = 0;

    /* ---- 4) 显示位置 = 预测位置 + 偏移量 ---- */
    local.x = local.predX + local.corrX;
    local.y = local.predY + local.corrY;

    local.vx = remote.vx;
    local.vy = remote.vy;
    local.dir = remote.dir;
    local.hearts = remote.hearts;
    local.onGround = remote.onGround;
    local.invuln = remote.invuln;
    local.squash = remote.squash;
    local.atGoal = remote.atGoal;
  }

  // 机关状态
  if (Game.level) {
    if (st.buttons) {
      for (var b = 0; b < Game.level.buttons.length && b < st.buttons.length; b++) {
        Game.level.buttons[b].pressed = !!st.buttons[b];
      }
    }
    if (st.doorOpen) {
      for (var d = 0; d < Game.level.doors.length && d < st.doorOpen.length; d++) {
        Game.level.doors[d].openAmount = st.doorOpen[d];
        Game.level.doors[d].open = st.doorOpen[d] > 0.85;
      }
    }
    if (st.coinsTakenIdx) {
      for (var c = 0; c < Game.level.coins.length; c++) {
        Game.level.coins[c].taken = st.coinsTakenIdx.indexOf(c) >= 0;
      }
    }
    if (st.enemiesDead) {
      for (var e = 0; e < Game.level.enemies.length; e++) {
        Game.level.enemies[e].dead = st.enemiesDead.indexOf(e) >= 0;
      }
    }

    /* ---- 新机关状态 ----
     * 客人不跑这些机关的物理，只把房主的演算结果套上，
     * 保证两边看到的世界一模一样。 */
    if (st.bridges && Game.level.bridges) {
      for (var br = 0; br < Game.level.bridges.length && br < st.bridges.length; br++) {
        var bs = Game.level.bridges[br];
        var code = st.bridges[br];
        bs.gone = (code === 2);
        bs.pressed = (code >= 1);
        bs.shake = (code === 1) ? 1 : 0;
        var sol = null;
        for (var si = 0; si < Game.level.solids.length; si++) {
          var ss = Game.level.solids[si];
          if (ss.x === bs.x && ss.y === bs.y) { sol = ss; break; }
        }
        if (sol) sol.broken = bs.gone;
      }
    }
    if (st.wallsBroken) {
      for (var w = 0; w < Game.level.solids.length; w++) {
        var sw = Game.level.solids[w];
        if (!sw.destructible) continue;
        sw.broken = st.wallsBroken.indexOf(w) >= 0;
      }
    }
    if (st.bombs && Game.level.bombs) {
      for (var bo = 0; bo < Game.level.bombs.length && bo < st.bombs.length; bo++) {
        var bm = Game.level.bombs[bo];
        var bc = st.bombs[bo];
        bm.exploded = (bc === 2);
        bm.lit = (bc >= 1);
        if (st.bombTimers && st.bombTimers[bo] != null && st.bombTimers[bo] >= 0) {
          bm.timer = st.bombTimers[bo];
        }
      }
    }
    if (st.seesawAngles && Game.level.seesaws) {
      for (var sa = 0; sa < Game.level.seesaws.length && sa < st.seesawAngles.length; sa++) {
        Game.level.seesaws[sa].angle = st.seesawAngles[sa];
      }
    }
  }
}
