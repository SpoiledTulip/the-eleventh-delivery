/* ============================================================
 * bg-draw.js — 通用背景绘制器库（2026-10-07 新增）
 * ============================================================
 * 十一的诉求原文（第 13~20 关背景返工）：
 *   "不要只在 bg-theme.js 中修改颜色字段。"
 *   "每关至少有：独立的远景绘制函数或独立图层配置、独立的中景、
 *     独立的前景装饰、独立的地标、独立的动态效果、独立的颜色和光照方案。"
 *   "可以复用通用绘制工具，例如 drawParallaxLayer / drawBuildingSilhouette /
 *     drawPipeNetwork / drawBridgeStructure / drawMarketStalls /
 *     drawUnderwaterTunnel / drawPowerTower / drawStormCloudLayer ——
 *     但每关的组合、位置、尺寸和构图必须不同。"
 *
 * ------------------------------------------------------------
 * ★★ 这个文件是什么、不是什么 ★★
 * ------------------------------------------------------------
 *   它**只是一堆画法**（painter），不含任何"哪一关用哪个"的知识 ——
 *   那部分在 `bg-theme.js` 的 `layers` 配置里。
 *
 *   为什么要这样分：
 *     · painter 是**可复用的笔刷**（管线/屋顶/起重机…）
 *     · theme 是**每关的构图配方**（用哪支笔、画在哪、多密）
 *   两者分开，才能做到"复用工具但构图各不相同"——
 *   如果连构图画法都写在一起，8 关必然长成一个样子（这正是上一版的问题）。
 *
 * ------------------------------------------------------------
 * ★ 独立性（项目规范）★
 * ------------------------------------------------------------
 *   本文件**不依赖任何其它模块**，也不改任何游戏状态。
 *   `bg-theme.js` 通过**字符串名字**引用 painter（`BP.oldTownRooftops`），
 *   所以：
 *     · 删掉本文件 → 找不到 painter → bg-theme 自动退回"纯配色"模式
 *     · 不会抛异常、不会白屏
 *
 * ------------------------------------------------------------
 * ★ 坐标约定（和 render.js 一致，很重要）★
 * ------------------------------------------------------------
 *   所有 painter 接收的 ctx **在屏幕坐标系下**（render.js 里背景是在
 *   `ctx.translate(-cam.x, -cam.y)` **之前**画的）。
 *   所以：
 *     · x 要自己减 `cam.x * parallax`（视差）
 *     · y 直接用屏幕坐标
 *
 *   ⚠️ 踩过的坑：如果把背景 painter 放到 translate(-cam.x) **之后**调，
 *      背景会跟着地图"粘"上去，失去视差感、而且宽地图上会整片消失。
 *
 * ------------------------------------------------------------
 * ★ 伪随机必须是"稳定"的 ★
 * ------------------------------------------------------------
 *   楼群/管道的位置一律用**确定性哈希**（见 hash01），绝不用 Math.random()。
 *   原因：背景每帧都重画，用随机数会导致楼群疯狂闪烁。
 * ============================================================ */

const BP = (function () {

  /* ------------------------------------------------------------
   * 确定性伪随机：同一个 seed 永远返回同一个 [0,1)
   * ------------------------------------------------------------
   * 用 Knuth 乘法哈希 + 位混合。**不是**为了密码学，只要"稳定且分布够散"。
   * ⚠️ 项目里 scooter.js 的"按关卡固定刷新率"也用同一类哈希 —— 保持一致。
   * ------------------------------------------------------------ */
  function hash01(n) {
    let h = (n * 2654435761) >>> 0;
    h ^= h >>> 15;
    h = (h * 2246822519) >>> 0;
    h ^= h >>> 13;
    h = (h * 3266489917) >>> 0;
    h ^= h >>> 16;
    return h / 4294967296;
  }
  function hashRange(i, lo, hi) { return lo + hash01(i) * (hi - lo); }

  /* ------------------------------------------------------------
   * 颜色工具：给同一层做明暗分层，避免手写一堆色值
   * ------------------------------------------------------------ */
  function parseColor(s) {
    if (typeof s !== 'string') return null;
    s = s.trim();
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length < 6) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const m = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }

  /** 加/减亮度：amt ∈ [-1,1]，正数变亮、负数变暗 */
  function shade(color, amt) {
    const c = parseColor(color);
    if (!c) return color;
    let r = c[0], g = c[1], b = c[2];
    if (amt >= 0) {
      r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
    } else {
      r *= (1 + amt); g *= (1 + amt); b *= (1 + amt);
    }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  /** 改成指定透明度（画远景时常用：越远越淡） */
  function alpha(color, a) {
    const c = parseColor(color);
    if (!c) return color;
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  /** 两色线性混合（t=0 取 a，t=1 取 b）—— 做"大气透视"用 */
  function mix(a, b, t) {
    const ca = parseColor(a), cb = parseColor(b);
    if (!ca || !cb) return a;
    return 'rgb(' + Math.round(ca[0] + (cb[0] - ca[0]) * t) + ',' +
      Math.round(ca[1] + (cb[1] - ca[1]) * t) + ',' +
      Math.round(ca[2] + (cb[2] - ca[2]) * t) + ')';
  }

  /** canvas 宽高
   * ------------------------------------------------------------------
   * ⚠️⚠️ 血泪坑（2026-10-07 发现）：
   *   原来写的是 `typeof CANVAS_W !== 'undefined' ? CANVAS_W : 960`，
   *   看着没问题 —— 但 `bg-draw.js` 在 index.html 里排在 **game.js 之前**，
   *   而 CANVAS_W/CANVAS_H 是在 game.js 里定义的！
   *   ⇒ 本模块**求值的那一刻**它们还不存在，
   *     于是 `VH()` 永远返回兜底的 600，而真实画布是 720。
   *   后果：所有"底部对齐"的背景元素都比预期高 120px，
   *        画面下半部留下一大片空白（实测截图里非常明显）。
   *
   *   修法：**每次调用时**重新查一次 —— 那一刻 game.js 早就执行完了。
   *   兜底值也改成真实值 1280×720，出错时不至于差太多。
   * ------------------------------------------------------------------ */
  function VW() {
    try { if (typeof CANVAS_W === 'number') return CANVAS_W; } catch (e) { }
    return 1280;
  }
  function VH() {
    try { if (typeof CANVAS_H === 'number') return CANVAS_H; } catch (e) { }
    return 720;
  }

  /**
   * 背景的"垂直锚点"补偿
   * ------------------------------------------------------------------
   * 【为什么需要】
   *   关卡又高又宽（最大 150×40 格 = 4800×1280px），相机 y 会大范围移动。
   *   而背景所有元素都用**屏幕坐标**画 —— 如果不补偿，
   *   玩家爬到高处时背景会整个"脱节"（看起来像背景被切掉了）。
   *
   * 【做法】
   *   取相机 y 的一个**很小的视差系数**（默认 0.18），
   *   让背景随镜头**轻微**上下移动：
   *     · 系数小 → 有纵深（背景比地形动得慢）
   *     · 不为 0 → 不会"背景钉死在屏幕上"的假感
   *   ⇒ 于是"把元素画在画面底部"这件事要按这个偏移修正。
   */
  function yAnchor(cam, par) {
    const p = (par == null) ? 0.18 : par;
    const cy = (cam && typeof cam.y === 'number') ? cam.y : 0;
    return -cy * p;
  }

  /** 底部基线（把元素对齐到"画面底 + 垂直视差补偿"） */
  function baseBottom(cam, ratio, par) {
    return VH() * (ratio == null ? 0.92 : ratio) + yAnchor(cam, par);
  }

  /* ============================================================
   * ① 通用骨架
   * ============================================================ */

  /**
   * 一层平行视差容器：负责算偏移、循环铺贴、视口裁剪。
   * 【为什么要它】
   *   宽地图（150 格 = 4800px）上如果按屏幕坐标画背景，
   *   相机一动背景就"跟丢了"。必须每隔 `repeat` 像素重画一份，
   *   并只画落在视口里的那些（性能 + 不闪）。
   * @param cfg { parallax, repeat, drawTile(ctx, x, i, yOff) }
   */
  function drawParallaxLayer(ctx, cam, cfg) {
    const par = (cfg.parallax == null) ? 0.3 : cfg.parallax;
    const rep = cfg.repeat || 400;
    const off = -cam.x * par;
    const yOff = -(cfg.camY || 0) * par;
    const vw = VW();

    const startI = Math.floor((-off - rep) / rep);
    const endI = Math.ceil((vw - off + rep) / rep);
    for (let i = startI; i <= endI; i++) {
      const x = off + i * rep;
      if (x > vw + rep || x + rep < -rep) continue;
      cfg.drawTile(ctx, x, i, yOff);
    }
  }

  /**
   * 建筑剪影层（★ 通用工具）
   * ------------------------------------------------------------------
   * ⚠️ 和 render.js 旧版 drawCitySilhouette 的区别（为什么重写）：
   *   旧版是 `i*130` 等距 + `(i*2654435761)%1000` 高低 —— 结果**每关一模一样**，
   *   这正是十一说的"所有关卡都使用同一排高楼剪影"。
   *   新版把**间距、宽度、高度范围、屋顶样式、窗户**全部参数化，
   *   每关给不同参数 ⇒ 构图真正不同。
   *
   * @param cfg {
   *   color, opacity, parallax, spacing, widthMin, widthMax,
   *   heightMin, heightMax, baseY, roofStyle, windows, windowColor,
   *   windowDensity, seedOffset
   * }
   */
  function drawBuildingSilhouette(ctx, cam, cfg) {
    const col = cfg.color || '#555';
    const op = (cfg.opacity == null) ? 1 : cfg.opacity;
    const wMin = cfg.widthMin || 40, wMax = cfg.widthMax || 90;
    const hMin = cfg.heightMin || 80, hMax = cfg.heightMax || 240;
    const spacing = cfg.spacing || 130;
    /* ★ 加 yAnchor：背景随镜头**轻微**上下移动（0.18 视差），
     *   否则又高又宽的关卡里背景会和地形脱节。 */
    const baseY = (cfg.baseY == null) ? VH() * 0.92 : cfg.baseY;
    const yA = yAnchor(cam, (cfg.vPar == null) ? 0.18 : cfg.vPar);
    const seed0 = cfg.seedOffset || 0;
    const roof = cfg.roofStyle || 'flat';
    const showWin = !!cfg.windows;
    const winCol = cfg.windowColor || 'rgba(255,220,140,0.5)';
    const winDensity = (cfg.windowDensity == null) ? 0.55 : cfg.windowDensity;
    const par = (cfg.parallax == null) ? 0.32 : cfg.parallax;
    /* ★ 楼间距（格）
     * ------------------------------------------------------------
     * 【为什么必须留缝】实测：楼与楼紧挨着（gap=0）时，
     *   整排楼会糊成一堵**均匀的墙** —— 远景层完全失去"这是城市"的信息，
     *   表现为地形图上一条平的横带（用 _bgshape.js 一眼看出来）。
     *   留缝之后每栋楼的高低差才看得见 = 真正的"天际线"。 */
    const gap = (cfg.gap == null) ? 10 : cfg.gap;

    const off = -cam.x * par;
    const vw = VW();
    const total = Math.ceil((vw + spacing * 4) / spacing) + 2;
    const i0 = Math.floor(-off / spacing);

    ctx.save();
    for (let k = -1; k < total; k++) {
      const si = k + i0;
      const r1 = hash01(seed0 + si * 7 + 1);
      const r2 = hash01(seed0 + si * 13 + 2);
      const r3 = hash01(seed0 + si * 29 + 3);
      const w = Math.min(wMin + r1 * (wMax - wMin), spacing - gap);
      const h = hMin + r2 * (hMax - hMin);
      const x = off + si * spacing + (r3 - 0.5) * spacing * 0.22;

      if (x + w < -60 || x > vw + 60) continue;
      if (r1 < 0.04) continue;                 // 偶尔留一个"空地"（更像真实街区）

      const y = baseY - h + yA;
      ctx.fillStyle = alpha(col, op);
      ctx.fillRect(x, y, w, h);

      /* 屋顶样式：每关不同 —— 这是"一眼区分"的关键之一 */
      if (roof === 'spire') {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y - h * 0.18); ctx.lineTo(x + w, y);
        ctx.closePath(); ctx.fill();
      } else if (roof === 'antenna') {
        ctx.fillRect(x + w * 0.45, y - h * 0.22, Math.max(2, w * 0.05), h * 0.22);
        ctx.fillRect(x + w * 0.15, y - 10, w * 0.7, 6);
      } else if (roof === 'tank') {
        /* 老城区标志性的屋顶水箱 */
        ctx.fillRect(x + w * 0.55, y - 22, w * 0.3, 22);
        ctx.fillRect(x + w * 0.62, y - 6, w * 0.16, 6);
      } else if (roof === 'stepped') {
        ctx.fillRect(x + w * 0.2, y - 16, w * 0.6, 16);
      } else if (roof === 'gable') {
        ctx.beginPath();
        ctx.moveTo(x - 4, y); ctx.lineTo(x + w / 2, y - 20); ctx.lineTo(x + w + 4, y);
        ctx.closePath(); ctx.fill();
      }

      /* 窗户（"大面积停电的城市只剩零散窗口"就靠这个） */
      if (showWin && w > 22) {
        ctx.fillStyle = winCol;
        const cols = Math.max(1, Math.floor(w / 18));
        const rows = Math.max(1, Math.floor(h / 26));
        for (let wx = 0; wx < cols; wx++) {
          for (let wy = 0; wy < rows; wy++) {
            /* ★ 关键：用稳定哈希决定"这扇窗亮不亮"，
             *   再乘 winDensity ⇒ 第 19 关可以做"大片黑"。
             *   ⚠️ 用 hash01 而不是 Math.random，否则窗户每帧乱闪。 */
            const wr = hash01(seed0 + si * 101 + wx * 17 + wy * 31);
            if (wr > winDensity) continue;
            ctx.fillRect(x + 8 + wx * 18, y + 10 + wy * 26, 6, 9);
          }
        }
      }
    }
    ctx.restore();
  }

  /* ============================================================
   * ② 工业 / 地下
   * ============================================================ */

  /**
   * 管道网络（★ 通用工具）—— 地下管网 / 海底管线 / 工业管道
   * @param cfg { color, highlight, parallax, rows[], r, joints, repeat, seedOffset }
   */
  function drawPipeNetwork(ctx, cam, cfg) {
    const col = cfg.color || '#3a4a42';
    const hi = cfg.highlight || shade(col, 0.25);
    const par = (cfg.parallax == null) ? 0.35 : cfg.parallax;
    const rows = cfg.rows || [140, 300];
    const r = cfg.r || 14;
    const vw = VW();
    const off = -cam.x * par;
    const rep = cfg.repeat || 520;
    const seed0 = cfg.seedOffset || 0;

    ctx.save();
    for (let i = -1; i <= Math.ceil((vw + rep) / rep) + 1; i++) {
      const x0 = off + i * rep;
      if (x0 > vw + rep || x0 + rep < -rep) continue;

      rows.forEach(function (ry, ri) {
        const y = ry + hashRange(seed0 + i * 31 + ri * 7, -10, 10);
        /* 主干管 */
        ctx.strokeStyle = col;
        ctx.lineWidth = r;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + rep, y);
        ctx.stroke();
        /* 顶部高光（让管子"有体积"而不是一条线） */
        ctx.strokeStyle = alpha(hi, 0.45);
        ctx.lineWidth = Math.max(2, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(x0, y - r * 0.28);
        ctx.lineTo(x0 + rep, y - r * 0.28);
        ctx.stroke();
        /* 法兰接头 */
        if (cfg.joints !== false) {
          for (let j = 0; j < 3; j++) {
            const jx = x0 + (rep / 3) * j + 30;
            ctx.fillStyle = col;
            ctx.fillRect(jx - 5, y - r * 0.72, 10, r * 1.44);
            ctx.fillStyle = alpha(hi, 0.6);
            ctx.fillRect(jx - 5, y - r * 0.72, 10, 3);
          }
        }
      });

      /* 竖直支管：把几条水平管连起来（偶尔出现，避免太规整） */
      const vr = hash01(seed0 + i * 53 + 9);
      if (vr < 0.55 && rows.length >= 2) {
        const vx = x0 + rep * (0.3 + vr * 0.5);
        ctx.strokeStyle = shade(col, -0.18);
        ctx.lineWidth = r * 0.6;
        ctx.beginPath();
        ctx.moveTo(vx, rows[0]);
        ctx.lineTo(vx, rows[rows.length - 1]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ============================================================
   * ③ 桥 / 高架
   * ============================================================ */

  /**
   * 桥 / 高架结构（★ 通用工具）—— 跨江桥、钢桁架、匝道
   * @param cfg { color, cableColor, parallax, deckY, towers[], towerW, towerH,
   *              cables, truss, repeat, seedOffset }
   */
  function drawBridgeStructure(ctx, cam, cfg) {
    const col = cfg.color || '#2a3550';
    const cableCol = cfg.cableColor || shade(col, 0.35);
    const par = (cfg.parallax == null) ? 0.3 : cfg.parallax;
    const vw = VW();
    const deckY = cfg.deckY || 320;
    const off = -cam.x * par;
    const rep = cfg.repeat || 900;
    const tw = cfg.towerW || 46;
    const towers = cfg.towers || [0.18, 0.68];
    const towerH = cfg.towerH || 300;

    ctx.save();
    for (let i = -1; i <= Math.ceil((vw + rep) / rep) + 1; i++) {
      const x0 = off + i * rep;
      if (x0 > vw + rep || x0 + rep < -rep) continue;

      /* 桥面（带厚度的横带） */
      ctx.fillStyle = col;
      ctx.fillRect(x0 - rep * 0.1, deckY, rep * 1.2, 12);
      ctx.fillStyle = shade(col, -0.2);
      ctx.fillRect(x0 - rep * 0.1, deckY + 12, rep * 1.2, 6);

      /* 钢桁架（可选，做"高架/工地"感觉） */
      if (cfg.truss) {
        ctx.strokeStyle = alpha(shade(col, 0.2), 0.5);
        ctx.lineWidth = 2;
        const span = rep * 1.2 / 16;
        for (let k = 0; k < 16; k++) {
          const bx = x0 - rep * 0.1 + k * span;
          ctx.beginPath();
          ctx.moveTo(bx, deckY);
          ctx.lineTo(bx + span / 2, deckY + 44);
          ctx.lineTo(bx + span, deckY);
          ctx.stroke();
        }
      }

      /* 主塔 */
      towers.forEach(function (tp) {
        const tx = x0 + rep * tp;
        ctx.fillStyle = shade(col, -0.12);
        ctx.fillRect(tx, deckY - towerH, tw, towerH);
        ctx.fillRect(tx - 10, deckY - towerH - 16, tw + 20, 14);
        /* 塔身镂空（桁架感） */
        ctx.fillStyle = alpha(shade(col, 0.25), 0.5);
        for (let k = 0; k < 7; k++) {
          ctx.fillRect(tx + 6, deckY - towerH + 24 + k * (towerH / 8), tw - 12, 5);
        }
      });

      /* 主缆 + 吊索（从塔顶垂下，抛物线近似） */
      if (cfg.cables !== false) {
        ctx.strokeStyle = alpha(cableCol, 0.75);
        ctx.lineWidth = 2.5;
        const t0 = x0 + rep * towers[0] + tw / 2;
        const t1 = x0 + rep * towers[towers.length - 1] + tw / 2;
        const topY = deckY - towerH - 8;
        ctx.beginPath();
        ctx.moveTo(t0, topY);
        ctx.quadraticCurveTo((t0 + t1) / 2, deckY - 40, t1, topY);
        ctx.stroke();
        for (let k = 1; k < 10; k++) {
          const tt = k / 10;
          const cx = t0 + (t1 - t0) * tt;
          const cyy = (1 - tt) * (1 - tt) * topY + 2 * tt * (1 - tt) * (deckY - 40) + tt * tt * topY;
          ctx.beginPath();
          ctx.moveTo(cx, cyy);
          ctx.lineTo(cx, deckY);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /* ============================================================
   * ④ 夜市 / 摊位
   * ============================================================ */

  /**
   * 夜市摊位 / 招牌（★ 通用工具）
   * @param cfg { seedOffset, parallax, canopyColors[], y, spacing,
   *              lanterns, signs, signColors[] }
   */
  function drawMarketStalls(ctx, cam, cfg) {
    const par = (cfg.parallax == null) ? 0.4 : cfg.parallax;
    const vw = VW();
    const baseY = (cfg.y == null) ? VH() * 0.82 : cfg.y;
    const yA = yAnchor(cam, (cfg.vPar == null) ? 0.18 : cfg.vPar);
    const spacing = cfg.spacing || 150;
    const off = -cam.x * par;
    const seed0 = cfg.seedOffset || 0;
    const canopies = cfg.canopyColors || ['#c8443a', '#d88a2a', '#3a7ac8'];
    const signCols = cfg.signColors || ['#ff5a4a', '#ffd24a', '#4ad8ff', '#ff8ad8'];
    const total = Math.ceil((vw + spacing * 4) / spacing) + 2;
    const i0 = Math.floor(-off / spacing);

    ctx.save();
    for (let k = -1; k < total; k++) {
      const si = k + i0;
      const r1 = hash01(seed0 + si * 11 + 1);
      const r2 = hash01(seed0 + si * 23 + 2);
      const r3 = hash01(seed0 + si * 41 + 3);
      const x = off + si * spacing + (r3 - 0.5) * spacing * 0.2;
      if (x + spacing < -80 || x > vw + 80) continue;

      const w = spacing * (0.62 + r1 * 0.28);
      const h = 46 + r2 * 26;

      /* 摊车本体 */
      ctx.fillStyle = '#3a2a26';
      ctx.fillRect(x, (baseY+yA), w, h);

      /* 遮棚（条纹） */
      const ccol = canopies[Math.floor(r1 * canopies.length) % canopies.length];
      ctx.fillStyle = ccol;
      ctx.fillRect(x - 6, (baseY+yA) - 20, w + 12, 20);
      ctx.fillStyle = alpha('#000', 0.22);
      for (let s = 0; s < 5; s++) {
        ctx.fillRect(x - 6 + s * ((w + 12) / 5), (baseY+yA) - 20, (w + 12) / 10, 20);
      }
      /* 棚柱 */
      ctx.fillStyle = '#2a2018';
      ctx.fillRect(x - 2, (baseY+yA) - 20, 4, 20);
      ctx.fillRect(x + w - 2, (baseY+yA) - 20, 4, 20);

      /* 招牌（★ 夜市的灵魂 —— 没有招牌就不像夜市） */
      if (cfg.signs !== false && r2 > 0.25) {
        const scol = signCols[Math.floor(r2 * signCols.length) % signCols.length];
        const sh = 14 + r1 * 10;
        ctx.fillStyle = scol;
        ctx.fillRect(x + 4, (baseY+yA) - 36 - sh, w * 0.7, sh);
        ctx.strokeStyle = alpha('#ffffff', 0.5);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 4, (baseY+yA) - 36 - sh, w * 0.7, sh);
      }

      /* 灯笼 */
      if (cfg.lanterns !== false && r3 > 0.4) {
        ctx.fillStyle = '#ff6a4a';
        for (let L = 0; L < 2; L++) {
          const lx = x + 16 + L * (w * 0.5);
          ctx.beginPath();
          ctx.ellipse(lx, (baseY+yA) - 62, 7, 9, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /* ============================================================
   * ⑤ 水下
   * ============================================================ */

  /**
   * 海底隧道（★ 通用工具）—— 玻璃管 + 外面海水 + 鱼群 + 海床
   * @param cfg { glassColor, frameColor, seabedColor, parallax, tunnelY,
   *              tunnelH, ribs, fish, fishCount, fishColor, speed, t, seedOffset }
   */
  function drawUnderwaterTunnel(ctx, cam, cfg) {
    /* ★ 垂直视差补偿（见 yAnchor 的注释） */
    const yA = yAnchor(cam, (cfg.vPar == null) ? 0.14 : cfg.vPar);
    const par = (cfg.parallax == null) ? 0.22 : cfg.parallax;
    const vw = VW(), vh = VH();
    const frame = cfg.frameColor || '#1d4a56';
    const tY = (cfg.tunnelY == null) ? vh * 0.24 : cfg.tunnelY;
    const tH = (cfg.tunnelH == null) ? vh * 0.5 : cfg.tunnelH;
    const off = -cam.x * par;
    const rep = cfg.repeat || 380;
    const seed0 = cfg.seedOffset || 0;

    ctx.save();

    /* 玻璃管壁 + 环肋 + 反光 */
    for (let i = -1; i <= Math.ceil((vw + rep) / rep) + 1; i++) {
      const x0 = off + i * rep;
      if (x0 > vw + rep || x0 + rep < -rep) continue;
      ctx.strokeStyle = alpha(frame, 0.85);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(x0, tY); ctx.lineTo(x0 + rep, tY);
      ctx.moveTo(x0, tY + tH); ctx.lineTo(x0 + rep, tY + tH);
      ctx.stroke();
      if (cfg.ribs !== false) {
        ctx.strokeStyle = alpha(frame, 0.55);
        ctx.lineWidth = 5;
        for (let k = 0; k < 3; k++) {
          const rx = x0 + (rep / 3) * k;
          ctx.beginPath();
          ctx.moveTo(rx, tY); ctx.lineTo(rx, tY + tH);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = 'rgba(200,245,255,0.14)';
      ctx.lineWidth = 14;
      for (let k = 0; k < 4; k++) {
        const gx = x0 + k * (rep / 4) + 30;
        ctx.beginPath();
        ctx.moveTo(gx, tY + 10); ctx.lineTo(gx + 26, tY + tH - 10);
        ctx.stroke();
      }
    }

    /* 海床起伏（远处沉船轮廓也画在这条线上） */
    if (cfg.seabedColor) {
      const sbOff = -cam.x * (par * 0.7);
      const baseY = tY + tH + 40;
      ctx.fillStyle = cfg.seabedColor;
      ctx.beginPath();
      ctx.moveTo(-100, vh + 100);
      for (let x = -100; x <= vw + 100; x += 40) {
        const yy = (baseY+yA) + Math.sin((x + sbOff) / 220) * 22 + Math.sin((x + sbOff) / 61) * 9;
        ctx.lineTo(x, yy);
      }
      ctx.lineTo(vw + 100, vh + 100);
      ctx.closePath();
      ctx.fill();
    }

    /* 鱼群（★ 水下专属动态；速度受水流影响 → 由 cfg.speed 传） */
    if (cfg.fish) {
      const n = cfg.fishCount || 14;
      const spd = (cfg.speed == null) ? 1 : cfg.speed;
      const tt = cfg.t || 0;
      for (let k = 0; k < n; k++) {
        const base = hash01(seed0 + k * 97);
        const fy = tY + 24 + hash01(seed0 + k * 53 + 1) * (tH - 48);
        const dirRight = hash01(seed0 + k * 31 + 2) > 0.5;
        const span = vw + 300;
        let fx = ((base * span + tt * spd * (24 + hash01(seed0 + k) * 30)) % span) - 150;
        if (!dirRight) fx = vw + 150 - fx;
        drawFish(ctx, fx, fy, 12 + hash01(seed0 + k * 7) * 10, dirRight,
          cfg.fishColor || 'rgba(150,220,235,0.5)');
      }
    }
    ctx.restore();
  }

  function drawFish(ctx, x, y, s, right, col) {
    ctx.save();
    ctx.translate(x, y);
    if (!right) ctx.scale(-1, 1);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 0, s, s * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s, 0); ctx.lineTo(-s - s * 0.7, -s * 0.42); ctx.lineTo(-s - s * 0.7, s * 0.42);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ============================================================
   * ⑥ 电网 / 楼群（带"灯亮灭"参数 → 第 19 关供电联动用）
   * ============================================================ */

  /**
   * 高压铁塔 + 架空电缆（★ 通用工具）
   * @param cfg { color, parallax, (baseY+yA), spacing, towerW, towerH,
   *              cableSag, seedOffset, lit }
   *   lit: 0~1，电缆通电程度（0 = 全黑，1 = 有电流）
   */
  function drawPowerTower(ctx, cam, cfg) {
    const col = cfg.color || '#1a2030';
    const par = (cfg.parallax == null) ? 0.32 : cfg.parallax;
    const vw = VW();
    const baseY = (cfg.baseY == null) ? VH() * 0.9 : cfg.baseY;
    const yA = yAnchor(cam, (cfg.vPar == null) ? 0.18 : cfg.vPar);
    const spacing = cfg.spacing || 420;
    const off = -cam.x * par;
    const tw = cfg.towerW || 78;
    const th = cfg.towerH || 260;
    const total = Math.ceil((vw + spacing * 3) / spacing) + 2;
    const i0 = Math.floor(-off / spacing);
    const lit = (cfg.lit == null) ? 0 : cfg.lit;

    ctx.save();

    /* 先画电缆（在塔后面，这样塔会盖住电缆交点，像真的） */
    ctx.strokeStyle = lit > 0.05 ? 'rgba(255,230,120,' + (0.25 + lit * 0.6).toFixed(2) + ')'
      : 'rgba(90,100,120,0.55)';
    ctx.lineWidth = lit > 0.4 ? 3 : 2;
    const sag = cfg.cableSag || 34;
    for (let k = -1; k < total; k++) {
      const si = k + i0;
      const x = off + si * spacing;
      if (x + spacing < -120 || x > vw + 120) continue;
      [26, 58].forEach(function (dy, ai) {
        ctx.beginPath();
        ctx.moveTo(x - 22 + ai * 4, (baseY+yA) - th + dy);
        ctx.quadraticCurveTo(x + spacing / 2, (baseY+yA) - th + dy + sag, x + spacing + 22 - ai * 4, (baseY+yA) - th + dy);
        ctx.stroke();
      });
    }

    /* 塔身 */
    for (let k = -1; k < total; k++) {
      const si = k + i0;
      const x = off + si * spacing;
      if (x + spacing < -120 || x > vw + 120) continue;
      const topY = (baseY+yA) - th;

      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, (baseY+yA)); ctx.lineTo(x + tw * 0.32, topY);
      ctx.moveTo(x + tw, (baseY+yA)); ctx.lineTo(x + tw * 0.68, topY);
      ctx.stroke();

      ctx.lineWidth = 3;
      const levels = 7;
      for (let L = 1; L <= levels; L++) {
        const ty = (baseY+yA) - (th / levels) * L;
        const kk = 1 - L / levels;
        const lx = x + tw * 0.32 * kk;
        const rx2 = x + tw - tw * 0.32 * kk;
        ctx.beginPath();
        ctx.moveTo(lx, ty); ctx.lineTo(rx2, ty);
        ctx.stroke();
        const ny = (baseY+yA) - (th / levels) * (L - 1);
        const nkk = 1 - (L - 1) / levels;
        ctx.beginPath();
        ctx.moveTo(lx, ty); ctx.lineTo(x + tw - tw * 0.32 * nkk, ny);
        ctx.moveTo(rx2, ty); ctx.lineTo(x + tw * 0.32 * nkk, ny);
        ctx.stroke();
      }

      /* 横臂 + 绝缘子 */
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 26, topY + 26); ctx.lineTo(x + tw + 26, topY + 26);
      ctx.moveTo(x - 18, topY + 58); ctx.lineTo(x + tw + 18, topY + 58);
      ctx.stroke();
      ctx.fillStyle = shade(col, 0.35);
      [-26, tw + 26, -18, tw + 18].forEach(function (dx) {
        ctx.fillRect(x + dx - 2, topY + 26, 4, 8);
      });
    }
    ctx.restore();
  }

  /* ============================================================
   * ⑦ 云 / 雷暴
   * ============================================================ */

  /**
   * 雷暴云层（★ 通用工具）
   * ------------------------------------------------------------------
   * ⚠️ 和旧版 drawClouds 的区别：
   *   旧版是**固定 7 个坐标**的白色圆团 —— 每关位置一样。
   *   新版支持：层数、高度带、颜色、密度、翻滚速度、
   *   **闪电照亮整体提亮**（flash 参数）。
   * @param cfg { layers, color, colorTop, parallax, y0, y1, density,
   *              seedOffset, flash, t, scroll }
   */
  function drawStormCloudLayer(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const layers = cfg.layers || 3;
    const par = (cfg.parallax == null) ? 0.18 : cfg.parallax;
    const y0 = (cfg.y0 == null) ? vh * 0.04 : cfg.y0;
    const y1 = (cfg.y1 == null) ? vh * 0.46 : cfg.y1;
    const seed0 = cfg.seedOffset || 0;
    const density = cfg.density || 7;
    const flash = cfg.flash || 0;
    const t = cfg.t || 0;
    const scroll = (cfg.scroll == null) ? 0.25 : cfg.scroll;
    const baseCol = cfg.color || 'rgba(90,96,118,0.85)';
    const topCol = cfg.colorTop || shade(baseCol, 0.22);

    ctx.save();
    for (let L = 0; L < layers; L++) {
      const tt = layers > 1 ? L / (layers - 1) : 0;
      const parL = par * (1 - tt * 0.45);          // 上层走得快 = 有纵深
      const off = -cam.x * parL;
      const bandY = y0 + (y1 - y0) * tt;
      const size = (0.7 + tt * 0.55);
      const col = mix(baseCol, topCol, tt);
      const rep = 300 + L * 90;
      const i0 = Math.floor(-off / rep);
      const total = Math.ceil((vw + rep * 3) / rep) + 2;

      /* ============================================================
       * ★★ 云的关键：**必须留缝**（2026-10-07 实测教训）★★
       * ============================================================
       * 【原来的写法怎么会糊成一堵黑墙】
       *   4 层云 × 每层 300~570px 铺一次 × 每团半径 30~56px ×
       *   还额外画了一条 190px 高的提亮带 —— 结果各层圆团互相重叠、
       *   叠成一条**又厚又实的暗色横带**盖满画面上半部。
       *   实测：截图 y=0~40 的平均色是 (13,13,16)，几乎纯黑，
       *   `_bgshape.js` 的字符图上就是一条 `------` 实心带。
       *   ⇒ 云看起来不像云，倒像"天花板"。
       *
       * 【修正三件事】
       *   ① 把每层实际的**绘制带收窄**（bandH），层与层之间有空隙
       *   ② 降低不透明度（0.85 → 0.3~0.5 区间），让天空色透出来
       *   ③ 保留 density 留白（r1 过滤）
       * ============================================================ */
      const bandH = (y1 - y0) * 0.42;              // 本层实际云的厚度
      const op = (flash > 0 ? 0.85 : 0.62) * (0.42 + tt * 0.26);
      ctx.fillStyle = alpha(col, op);
      for (let k = -1; k < total; k++) {
        const si = k + i0;
        const r1 = hash01(seed0 + L * 977 + si * 7 + 1);
        const r2 = hash01(seed0 + L * 977 + si * 13 + 2);
        const r3 = hash01(seed0 + L * 977 + si * 29 + 3);
        /* 云团：几个圆叠成蓬松形状 */
        const cx = off + si * rep + (r3 - 0.5) * rep * 0.4 +
          Math.sin(t * scroll * 0.6 + si) * 5;     // 轻微翻滚
        const cy = bandY + (r2 - 0.5) * bandH;
        if (cx + rep < -120 || cx > vw + 120) continue;
        /* 只画"有的"云（density 控制留白）——
         * density 越小留白越多。 */
        if (r1 > (density / 12)) continue;
        puff(ctx, cx, cy, (22 + r2 * 20) * size, 4);
      }

      /* 闪电照亮：整层加一层白 */
      if (flash > 0.02) {
        ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.22 * (0.5 + tt * 0.6)).toFixed(3) + ')';
        ctx.fillRect(-10, bandY - bandH, vw + 20, bandH * 2.4);
      }
    }
    ctx.restore();
  }

  /** 一团蓬松云（几个圆叠一起） */
  function puff(ctx, x, y, s, n) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = s * (0.55 + (i % 2) * 0.25);
      ctx.moveTo(x + Math.cos(a) * s * 0.9 + rr, y + Math.sin(a) * s * 0.32);
      ctx.arc(x + Math.cos(a) * s * 0.9, y + Math.sin(a) * s * 0.32, rr, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /* ============================================================
   * ⑧ 场景专用组合绘制器（每关一个"招牌风景"）
   * ============================================================ */

  /**
   * 老城屋顶群（第 13 关）—— 远/中/近三层屋顶 + 晾衣杆 + 水箱 + 排水塔地标
   * ⚠️ 和"高楼剪影"的根本区别：这是**屋顶线**（低、密、参差），
   *    不是"一排等距高楼"。构图上一眼就能分清。
   */
  function oldTownRooftops(ctx, cam, cfg) {
    /* ★ 垂直视差补偿（见 yAnchor 的注释） */
    const yA = yAnchor(cam, 0.18);
    const col = cfg.color || '#232844';
    const vw = VW(), vh = VH();
    const rain = cfg.rain || 0;          // 0~1，雨幕浓度（影响远处淡出）
    const seed0 = cfg.seedOffset || 0;

    /* --- 远层：密集低矮老楼 -----------------------------------------
     * ⚠️ 关键参数是 `gap` 和**高度跨度**。
     *   实测：高度范围小 + 楼与楼紧挨 ⇒ 整排糊成**一堵均匀的墙**，
     *   在 `_bgshape.js` 的地形图上就是一条平的横带，完全看不出"这是城市"。
     *   现在用 大跨度(56~210) + 明显间距(gap 16) ⇒ 天际线有起伏。 --- */
    drawBuildingSilhouette(ctx, cam, {
      color: mix(col, cfg.sky || '#28304f', 0.62 - rain * 0.22),
      opacity: 0.82 - rain * 0.16,
      parallax: 0.16, spacing: 78, gap: 16,
      widthMin: 30, widthMax: 58,
      heightMin: 56, heightMax: 210,
      baseY: vh * 0.80 + yA,
      roofStyle: 'tank', seedOffset: seed0 + 11,
    });

    /* --- 中层：居民楼（有窗、有天线）—— 更高、更少、更清晰 --- */
    drawBuildingSilhouette(ctx, cam, {
      color: mix(col, cfg.sky || '#28304f', 0.34),
      opacity: 0.94,
      parallax: 0.36, spacing: 148, gap: 34,
      widthMin: 62, widthMax: 112,
      heightMin: 110, heightMax: 268,
      baseY: vh * 0.98 + yA,
      roofStyle: 'antenna', windows: true,
      windowColor: cfg.windowColor || 'rgba(255,214,140,0.55)',
      windowDensity: 0.34, seedOffset: seed0 + 23,
    });

    /* --- 近景：屋檐 + 晾衣杆 + 电线（★ 前景遮挡物） --- */
    const par = 0.62;
    const off = -cam.x * par;
    const rep = 200;
    const i0 = Math.floor(-off / rep);
    const total = Math.ceil((vw + rep * 3) / rep) + 2;
    ctx.save();
    for (let k = -1; k < total; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const r1 = hash01(seed0 + si * 17 + 5);
      /* ⚠️ 近景只在**画面下缘 22%**以内 —— 不能太高，
       *   否则会盖住玩法区域（验收要求："背景不能遮挡角色/平台/订单/机关"）。 */
      const baseY = vh * (0.86 + r1 * 0.07);

      /* 屋檐剪影（近景要有"压住画面下缘"的东西） */
      ctx.fillStyle = alpha(shade(col, -0.45), 0.95);
      ctx.fillRect(x, (baseY+yA), rep * 0.8, vh - (baseY+yA));

      /* 晾衣杆 + 衣服 */
      if (r1 > 0.45) {
        ctx.strokeStyle = alpha('#0d0f18', 0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 12, (baseY+yA) - 40); ctx.lineTo(x + rep * 0.62, (baseY+yA) - 40);
        ctx.stroke();
        for (let c = 0; c < 3; c++) {
          const cxx = x + 26 + c * 26;
          ctx.fillStyle = ['#b9c2d8', '#d8b9b9', '#b9d8c2'][c] + '';
          ctx.globalAlpha = 0.75;
          ctx.fillRect(cxx, (baseY+yA) - 40, 16, 22);
          ctx.globalAlpha = 1;
        }
      }
      /* 电线 */
      ctx.strokeStyle = alpha('#0a0c14', 0.8);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 10, (baseY+yA) - 66);
      ctx.quadraticCurveTo(x + rep * 0.5, (baseY+yA) - 52, x + rep + 10, (baseY+yA) - 66);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 排水塔（第 13 关地标）—— 一座明显的老式排水塔 + 广告牌
   * @param cfg { x(屏幕比例), (baseY+yA), color, signColor }
   */
  function drainTower(ctx, cam, cfg) {
    /* ★ 垂直视差补偿（见 yAnchor 的注释） */
    const yA = yAnchor(cam, 0.16);
    const vw = VW(), vh = VH();
    const col = cfg.color || '#1c2033';
    const par = (cfg.parallax == null) ? 0.5 : cfg.parallax;
    /* x 用"世界比例"锚定（第 13 关在 62% 位置），但跟随相机 */
    const sx = (cfg.nx == null ? 0.62 : cfg.nx) * vw - cam.x * par * 0.35;
    const baseY = (cfg.baseY == null) ? vh * 0.74 : cfg.baseY;
    const W = cfg.w || 54, H = cfg.h || 150;

    ctx.save();
    /* 塔身（上窄下宽） */
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(sx - W * 0.5, (baseY+yA));
    ctx.lineTo(sx - W * 0.3, (baseY+yA) - H);
    ctx.lineTo(sx + W * 0.3, (baseY+yA) - H);
    ctx.lineTo(sx + W * 0.5, (baseY+yA));
    ctx.closePath();
    ctx.fill();
    /* 顶部蓄水池 */
    ctx.fillRect(sx - W * 0.42, (baseY+yA) - H - 26, W * 0.84, 26);
    ctx.fillStyle = shade(col, 0.18);
    ctx.fillRect(sx - W * 0.42, (baseY+yA) - H - 26, W * 0.84, 6);
    /* 塔身检修梯 */
    ctx.strokeStyle = alpha(shade(col, 0.35), 0.7);
    ctx.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      ctx.moveTo(sx - 8, (baseY+yA) - 18 - k * 18);
      ctx.lineTo(sx + 8, (baseY+yA) - 18 - k * 18);
      ctx.stroke();
    }
    /* 广告牌（可闪烁 → 由 cfg.led 控制） */
    const led = cfg.led == null ? 1 : cfg.led;
    if (led > 0.05) {
      ctx.fillStyle = alpha(cfg.signColor || '#ff5a7a', 0.35 + led * 0.55);
      ctx.fillRect(sx + W * 0.55, (baseY+yA) - H + 10, 46, 30);
      ctx.strokeStyle = alpha('#ffffff', 0.4 * led);
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + W * 0.55, (baseY+yA) - H + 10, 46, 30);
    }
    ctx.restore();
  }

  /**
   * 工业纵深（第 14 关）—— 冷库 / 高架输送管 / 货运塔
   */
  function logisticsYard(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#20404a';
    const seed0 = cfg.seedOffset || 0;

    /* 远：超大规模厂房体块（宽、平、整齐 → 和"参差屋顶"完全不同的气质） */
    ctx.save();
    const offF = -cam.x * 0.18;
    const repF = 340;
    const i0F = Math.floor(-offF / repF);
    for (let k = -1; k <= Math.ceil((vw + repF) / repF) + 1; k++) {
      const si = k + i0F;
      const x = offF + si * repF;
      if (x + repF < -80 || x > vw + 80) continue;
      const r = hash01(seed0 + si * 13 + 1);
      const w = repF * (0.7 + r * 0.25);
      const h = 150 + r * 120;
      ctx.fillStyle = alpha(mix(col, cfg.sky || '#0f2226', 0.5), 0.9);
      ctx.fillRect(x, vh * 0.86 - h, w, h + 60);
      /* 屋顶桁架（工业感） */
      ctx.fillStyle = alpha(shade(col, 0.12), 0.9);
      ctx.fillRect(x, vh * 0.86 - h - 10, w, 10);
    }
    ctx.restore();

    /* 中：高架输送管 + 货运塔 */
    drawPipeNetwork(ctx, cam, {
      color: mix(col, '#000000', 0.15), highlight: '#7ec8d8',
      parallax: 0.34, rows: [vh * 0.30, vh * 0.44], r: 17,
      repeat: 470, seedOffset: seed0 + 40,
    });

    ctx.save();
    const offM = -cam.x * 0.46;
    const repM = 520;
    const i0M = Math.floor(-offM / repM);
    for (let k = -1; k <= Math.ceil((vw + repM) / repM) + 1; k++) {
      const si = k + i0M;
      const x = offM + si * repM;
      if (x + repM < -80 || x > vw + 80) continue;
      /* 货运塔（带编号灯牌） */
      const tw = 60, th = 200;
      const ty = vh * 0.9 - th;
      ctx.fillStyle = alpha(shade(col, -0.25), 0.92);
      ctx.fillRect(x + repM * 0.2, ty, tw, th);
      ctx.fillStyle = 'rgba(255,90,90,0.75)';
      ctx.fillRect(x + repM * 0.2 + 8, ty + 16, tw - 16, 20);   // 红色警示灯牌
      ctx.fillStyle = 'rgba(200,240,245,0.35)';
      ctx.fillRect(x + repM * 0.2 + 8, ty + 50, tw - 16, 6);
      /* 冷库大门（巨大、双开） */
      const dw = 130, dh = 120;
      ctx.fillStyle = alpha(shade(col, -0.35), 0.9);
      ctx.fillRect(x + repM * 0.58, vh * 0.9 - dh, dw, dh);
      ctx.strokeStyle = 'rgba(160,230,240,0.4)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + repM * 0.58, vh * 0.9 - dh, dw, dh);
      ctx.beginPath();
      ctx.moveTo(x + repM * 0.58 + dw / 2, vh * 0.9 - dh);
      ctx.lineTo(x + repM * 0.58 + dw / 2, vh * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 地下管网枢纽（第 15 关）—— ★ 没有天空！只有拱顶
   * 这正是十一要求"第 15 关不能再出现普通室外城市天空"。
   */
  function undergroundVault(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#1a261c';

    /* 拱顶（用同心圆弧模拟巨大圆管内部） */
    ctx.save();
    const cx = vw / 2 - cam.x * 0.12;
    const R = vh * 0.95;
    for (let i = 4; i >= 0; i--) {
      const rr = R - i * 34;
      ctx.fillStyle = alpha(shade(col, 0.06 * (4 - i)), 0.5);
      ctx.beginPath();
      ctx.arc(cx, vh * 1.06, rr, Math.PI, 0);
      ctx.fill();
    }
    /* 拱顶上的检修灯（★ 一排暖色点，是这张图的"专属动态"） */
    const litN = cfg.lit == null ? 5 : cfg.lit;
    const off = -cam.x * 0.2;
    const rep = 210;
    const i0 = Math.floor(-off / rep);
    ctx.fillStyle = 'rgba(255,196,120,0.9)';
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      if (si % 2 !== 0 && litN < 9) continue;      // 有的灯不亮（逐个亮起的效果）
      const yy = vh * 0.13;
      ctx.beginPath();
      ctx.arc(x + rep * 0.5, yy, 5, 0, Math.PI * 2);
      ctx.fill();
      /* 灯光光晕 */
      const g = ctx.createRadialGradient(x + rep * 0.5, yy, 0, x + rep * 0.5, yy, 46);
      g.addColorStop(0, 'rgba(255,196,120,0.28)');
      g.addColorStop(1, 'rgba(255,196,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + rep * 0.5, yy, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,196,120,0.9)';
    }
    ctx.restore();

    /* 管道（粗大排水管 + 阀门） */
    drawPipeNetwork(ctx, cam, {
      color: '#243026', highlight: '#6a9a78',
      parallax: 0.42, rows: [vh * 0.62, vh * 0.78], r: 20,
      repeat: 430, seedOffset: (cfg.seedOffset || 0) + 7,
    });

    /* 检修桥（横跨的走道 + 栏杆） */
    ctx.save();
    const offB = -cam.x * 0.56;
    const repB = 380;
    const i0B = Math.floor(-offB / repB);
    for (let k = -1; k <= Math.ceil((vw + repB) / repB) + 1; k++) {
      const si = k + i0B;
      const x = offB + si * repB;
      if (x + repB < -60 || x > vw + 60) continue;
      const by = vh * (0.70 + hash01((cfg.seedOffset || 0) + si * 19) * 0.06);
      /* 桥面 */
      ctx.fillStyle = alpha(shade(col, -0.3), 0.9);
      ctx.fillRect(x, by, repB, 9);
      /* 栏杆 */
      ctx.strokeStyle = alpha('#8a9a86', 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, by - 22); ctx.lineTo(x + repB, by - 22);
      ctx.stroke();
      for (let p = 0; p < 8; p++) {
        ctx.beginPath();
        ctx.moveTo(x + p * (repB / 8), by - 22);
        ctx.lineTo(x + p * (repB / 8), by);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * 跨江高架夜线（第 16 关）—— 江面 + 对岸灯光 + 桥塔 + 匝道
   * ★ 十一要求"第 16 关必须能看到跨江桥或高架结构"
   */
  function riverBridge(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#1e2650';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;

    /* 对岸城市灯带（远处、低矮、密集亮点） */
    ctx.save();
    const offFar = -cam.x * 0.14;
    const repFar = 180;
    const i0F = Math.floor(-offFar / repFar);
    for (let k = -1; k <= Math.ceil((vw + repFar) / repFar) + 1; k++) {
      const si = k + i0F;
      const x = offFar + si * repFar;
      if (x + repFar < -60 || x > vw + 60) continue;
      const r = hash01(seed0 + si * 11 + 3);
      const h = 40 + r * 70;
      ctx.fillStyle = alpha(mix(col, cfg.sky || '#0d1430', 0.45), 0.9);
      ctx.fillRect(x, vh * 0.62 - h, repFar * 0.9, h);
      /* 窗口灯 */
      ctx.fillStyle = 'rgba(255,226,150,0.75)';
      for (let wy = 0; wy < 5; wy++) {
        for (let wx = 0; wx < 7; wx++) {
          if (hash01(seed0 + si * 71 + wx * 13 + wy * 29) > 0.5) continue;
          ctx.fillRect(x + 8 + wx * 22, vh * 0.62 - h + 8 + wy * 14, 5, 7);
        }
      }
    }
    ctx.restore();

    /* 江面（横向色带 + 倒影） */
    ctx.save();
    const waterTop = vh * 0.62;
    const g = ctx.createLinearGradient(0, waterTop, 0, vh);
    g.addColorStop(0, mix(col, '#3a5a8a', 0.5));
    g.addColorStop(1, mix(col, '#0a1024', 0.3));
    ctx.fillStyle = g;
    ctx.fillRect(0, waterTop, vw, vh - waterTop);
    /* 水面反光条（跟着时间轻微移动 = 江面在动） */
    for (let k = 0; k < 22; k++) {
      const r1 = hash01(seed0 + k * 37 + 5);
      const y = waterTop + 8 + r1 * (vh - waterTop - 16);
      const x = ((r1 * vw * 1.4 + k * 57 + t * 12) % (vw + 200)) - 100;
      ctx.fillStyle = 'rgba(255,226,150,' + (0.05 + r1 * 0.13).toFixed(2) + ')';
      ctx.fillRect(x, y, 30 + r1 * 60, 2);
    }
    ctx.restore();

    /* 主桥结构（桥面 + 主塔 + 主缆）★ 地标 */
    drawBridgeStructure(ctx, cam, {
      color: col, cableColor: '#7a8ac0',
      parallax: 0.34, deckY: vh * 0.50,
      towers: [0.16, 0.66], towerW: 50, towerH: 230,
      repeat: 820, truss: true, seedOffset: seed0 + 9,
    });

    /* 匝道（近处的一条斜带 + 护栏） */
    ctx.save();
    const offR = -cam.x * 0.56;
    const repR = 560;
    const i0R = Math.floor(-offR / repR);
    for (let k = -1; k <= Math.ceil((vw + repR) / repR) + 1; k++) {
      const si = k + i0R;
      const x = offR + si * repR;
      if (x + repR < -80 || x > vw + 80) continue;
      ctx.fillStyle = alpha(shade(col, -0.2), 0.95);
      ctx.beginPath();
      ctx.moveTo(x, vh * 0.86);
      ctx.lineTo(x + repR, vh * 0.74);
      ctx.lineTo(x + repR, vh * 0.80);
      ctx.lineTo(x, vh * 0.92);
      ctx.closePath();
      ctx.fill();
      /* 护栏灯（★ 车灯流动感：用 t 偏移） */
      for (let p = 0; p < 7; p++) {
        const px = x + p * (repR / 7);
        const py = vh * 0.86 - (p / 7) * (vh * 0.12) - 16;
        const on = ((Math.floor(t * 2) + p + si) % 4) < 2;
        ctx.fillStyle = on ? 'rgba(255,240,180,0.9)' : 'rgba(120,130,160,0.5)';
        ctx.fillRect(px, py, 5, 5);
      }
    }
    ctx.restore();
  }

  /**
   * 夜市迷城（第 17 关）—— 招牌层 + 摊位层 + 居民楼窗
   * ★ 十一要求"第 17 关必须能看到夜市摊位和招牌"
   */
  function nightMarket(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#2c1838';
    const seed0 = cfg.seedOffset || 0;

    /* 远：居民楼窗口（层层叠叠） */
    drawBuildingSilhouette(ctx, cam, {
      color: mix(col, cfg.sky || '#1a0e22', 0.5),
      opacity: 0.92, parallax: 0.18, spacing: 96, gap: 26,
      widthMin: 46, widthMax: 84, heightMin: 96, heightMax: 300,
      baseY: vh * 0.94, roofStyle: 'gable', windows: true,
      windowColor: 'rgba(255,206,140,0.6)', windowDensity: 0.5,
      seedOffset: seed0 + 3,
    });

    /* 中：招牌层（★ "招牌森林"是夜市的标志） */
    ctx.save();
    const offS = -cam.x * 0.34;
    const repS = 150;
    const i0S = Math.floor(-offS / repS);
    const signCols = ['#ff4a6a', '#ffd24a', '#4ad8ff', '#8aff6a', '#ff8ad8'];
    for (let k = -1; k <= Math.ceil((vw + repS) / repS) + 1; k++) {
      const si = k + i0S;
      const x = offS + si * repS;
      if (x + repS < -60 || x > vw + 60) continue;
      const r = hash01(seed0 + si * 23 + 7);
      if (r < 0.2) continue;
      const sc = signCols[Math.floor(r * signCols.length) % signCols.length];
      const sw = 46 + r * 40, sh = 18 + r * 14;
      const sy = vh * (0.12 + hash01(seed0 + si * 41) * 0.42);
      ctx.fillStyle = alpha(sc, 0.85);
      ctx.fillRect(x + 10, sy, sw, sh);
      ctx.strokeStyle = alpha('#ffffff', 0.45);
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 10, sy, sw, sh);
      /* 竖排招牌 */
      if (r > 0.6) {
        ctx.fillStyle = alpha(signCols[(Math.floor(r * 7)) % signCols.length], 0.8);
        ctx.fillRect(x + 62, sy + 10, 20, sh * 2.6);
      }
      /* 挂灯串 */
      ctx.strokeStyle = 'rgba(255,190,120,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, sy - 14);
      ctx.quadraticCurveTo(x + repS / 2, sy + 8, x + repS, sy - 14);
      ctx.stroke();
      for (let b = 1; b < 6; b++) {
        const bx = x + (repS / 6) * b;
        const by = sy - 14 + Math.sin((b / 6) * Math.PI) * 14;
        ctx.fillStyle = 'rgba(255,214,140,0.8)';
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    /* 近：摊位 + 遮棚 */
    drawMarketStalls(ctx, cam, {
      seedOffset: seed0 + 17, parallax: 0.5, y: vh * 0.88,
      spacing: 128, lanterns: true, signs: true,
      canopyColors: ['#c8443a', '#d8862a', '#2a8ac8', '#8a3ac8'],
    });

    /* 后巷（★ 十一要求"后巷区域暖光减少，加入狭窄砖墙和后门"）
     * —— 用一层砖墙纹理压在近景，只在画面右 25% 出现（后巷） */
    if (cfg.alley) {
      ctx.save();
      ctx.fillStyle = alpha('#241a20', 0.55);
      ctx.fillRect(vw * 0.74, 0, vw * 0.26, vh);
      ctx.strokeStyle = alpha('#3a2a30', 0.7);
      ctx.lineWidth = 1;
      for (let y = 0; y < vh; y += 14) {
        ctx.beginPath(); ctx.moveTo(vw * 0.74, y); ctx.lineTo(vw, y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  /**
   * 深海（第 18 关）—— ★ 没有天空、没有云
   * 十一要求"第 18 关不能使用普通天空、云层和城市高楼"。
   */
  function deepSeaTunnel(ctx, cam, cfg) {
    /* ★ 垂直视差补偿（见 yAnchor 的注释） */
    const yA = yAnchor(cam, 0.14);
    const vw = VW(), vh = VH();
    const col = cfg.color || '#0a2c38';
    const seed0 = cfg.seedOffset || 0;
    const water = cfg.water == null ? 0.5 : cfg.water;   // 0~1 涨潮程度

    /* 水体本身（上暗下亮，光从上面来） */
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, mix(col, '#000000', 0.35));
    g.addColorStop(0.55, col);
    g.addColorStop(1, mix(col, '#1a4a58', 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
    /* 水面光斑（★ "海水光斑移动"） */
    const t = cfg.t || 0;
    for (let k = 0; k < 16; k++) {
      const r1 = hash01(seed0 + k * 53 + 1);
      const bx = ((r1 * vw * 1.5 + t * 9 * (0.4 + r1)) % (vw + 240)) - 120;
      const by = hash01(seed0 + k * 97 + 2) * vh * 0.6;
      const rr = 40 + r1 * 70;
      const rg = ctx.createRadialGradient(bx, by, 0, bx, by, rr);
      rg.addColorStop(0, 'rgba(150,235,245,0.10)');
      rg.addColorStop(1, 'rgba(150,235,245,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(bx, by, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 远处沉船轮廓（★ 十一要求"远处沉船轮廓"） */
    ctx.save();
    const offShip = -cam.x * 0.12;
    const sx = 320 - offShip * 0.4 - cam.x * 0.04;
    ctx.fillStyle = alpha('#0c2028', 0.85);
    ctx.beginPath();
    ctx.moveTo(sx - 120, vh * 0.70);
    ctx.lineTo(sx + 130, vh * 0.70);
    ctx.lineTo(sx + 96, vh * 0.86);
    ctx.lineTo(sx - 88, vh * 0.86);
    ctx.closePath();
    ctx.fill();
    /* 断桅 */
    ctx.fillRect(sx - 10, vh * 0.58, 7, vh * 0.12);
    ctx.fillRect(sx + 40, vh * 0.62, 5, vh * 0.08);
    ctx.restore();

    /* 隧道 + 鱼群 */
    drawUnderwaterTunnel(ctx, cam, {
      frameColor: '#1d4a56', seabedColor: alpha('#0a2028', 0.9),
      parallax: 0.24, tunnelY: vh * 0.2, tunnelH: vh * 0.46,
      ribs: true, fish: true, fishCount: 16,
      fishColor: 'rgba(150,225,240,0.45)', speed: 1 + water * 0.8,
      t: t, seedOffset: seed0 + 5, repeat: 360,
    });

    /* 潮汐泵站（地标，右侧） */
    ctx.save();
    const pxx = vw * 0.82 - cam.x * 0.2;
    const pbase = vh * 0.70 - water * vh * 0.18;
    ctx.fillStyle = alpha('#123a46', 0.9);
    ctx.fillRect(pxx, pbase - 120, 90, 120);
    ctx.fillStyle = alpha('#1e6574', 0.85);
    ctx.beginPath();
    ctx.arc(pxx + 45, pbase - 130, 26, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,235,255,0.7)';
    ctx.beginPath();
    ctx.arc(pxx + 45, pbase - 132, 10 + water * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 全城断电 → 逐节点恢复（第 19 关）—— 铁塔 + 电缆 + 城市灯
   * ★ 十一要求"第 19 关必须能看到电网塔和电缆" +
   *   "三次供电必须产生三次可见的背景变化"
   * @param cfg { lit: 0~1 亮度（由供电节点数决定） }
   */
  function blackoutGrid(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#0e1626';
    const seed0 = cfg.seedOffset || 0;
    const lit = cfg.lit == null ? 0 : cfg.lit;    // 0 = 全黑，1 = 全亮

    /* 远：城市楼群（窗口亮灭由 lit 控制 —— 这就是"逐步恢复供电"） */
    drawBuildingSilhouette(ctx, cam, {
      color: mix(col, '#000000', 0.2),
      opacity: 0.95, parallax: 0.15, spacing: 104, gap: 30,
      widthMin: 44, widthMax: 92, heightMin: 70, heightMax: 250,
      baseY: vh * 0.90, roofStyle: 'antenna', windows: true,
      /* ★ 关键：窗口密度 = 0.06 + lit * 0.6
       *   ⇒ lit=0 时几乎全黑（只剩零星几扇窗），lit=1 时灯火通明。
       *   "大片停电"和"逐步亮起"全靠这一个参数。 */
      windowColor: 'rgba(255,224,150,' + (0.35 + lit * 0.5).toFixed(2) + ')',
      windowDensity: 0.06 + lit * 0.6,
      seedOffset: seed0 + 2,
    });

    /* 中：铁塔 + 架空电缆（★ 地标） */
    drawPowerTower(ctx, cam, {
      color: '#141c2c', parallax: 0.3, baseY: vh * 0.86,
      spacing: 400, towerW: 82, towerH: 250,
      cableSag: 36, lit: lit, seedOffset: seed0 + 13,
    });

    /* 近：检修平台 + 电缆 + 警示牌 */
    ctx.save();
    const off = -cam.x * 0.56;
    const rep = 330;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const r1 = hash01(seed0 + si * 29 + 11);
      const by = vh * (0.78 + r1 * 0.08);
      /* 检修平台 */
      ctx.fillStyle = alpha('#1a2436', 0.9);
      ctx.fillRect(x, by, rep * 0.7, 8);
      /* 下垂电缆（弧线） */
      ctx.strokeStyle = lit > 0.3 ? 'rgba(255,232,130,0.5)' : 'rgba(70,80,100,0.6)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, by - 30);
      ctx.quadraticCurveTo(x + rep * 0.35, by + 26, x + rep * 0.7, by - 30);
      ctx.stroke();
      /* 警示牌（黄黑斜纹） */
      if (r1 > 0.5) {
        ctx.fillStyle = '#d8b83a';
        ctx.fillRect(x + 14, by - 42, 26, 20);
        ctx.fillStyle = '#1a1a1a';
        for (let s = 0; s < 3; s++) ctx.fillRect(x + 14 + s * 9, by - 42, 4, 20);
      }
    }
    ctx.restore();
  }

  /**
   * 建筑工地高空（第 20 关阶段 3）—— 塔吊 + 钢梁 + 未完工楼层
   */
  function craneSite(ctx, cam, cfg) {
    /* ★ 垂直视差补偿（见 yAnchor 的注释） */
    const yA = yAnchor(cam, 0.1);
    const vw = VW(), vh = VH();
    const col = cfg.color || '#343a4c';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;

    /* 未完工楼层（骨架感：立柱 + 横梁，没有墙） */
    ctx.save();
    const off = -cam.x * 0.2;
    const rep = 300;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -80 || x > vw + 80) continue;
      const floors = 5;
      const fh = 52;
      const baseY = vh * 0.92;
      for (let f = 0; f < floors; f++) {
        const fy = (baseY+yA) - f * fh;
        const inset = f * 6;               // 越往上越窄（透视）
        ctx.fillStyle = alpha(shade(col, -0.25), 0.9);
        ctx.fillRect(x + inset, fy - fh, 8, fh);              // 左柱
        ctx.fillRect(x + rep * 0.62 - inset, fy - fh, 8, fh); // 右柱
        ctx.fillStyle = alpha(shade(col, -0.1), 0.85);
        ctx.fillRect(x + inset, fy - fh, rep * 0.62 - inset * 2, 7);   // 楼板
        /* 某几层有安全网（绿色半透明） */
        if (hash01(seed0 + si * 31 + f * 7) > 0.6) {
          ctx.fillStyle = 'rgba(90,150,90,0.28)';
          ctx.fillRect(x + inset, fy - fh, rep * 0.62 - inset * 2, fh);
        }
      }
    }
    ctx.restore();

    /* 塔吊（★ 地标）—— 吊臂随 t 缓慢摆动 */
    ctx.save();
    const offC = -cam.x * 0.42;
    const repC = 760;
    const i0C = Math.floor(-offC / repC);
    for (let k = -1; k <= Math.ceil((vw + repC) / repC) + 1; k++) {
      const si = k + i0C;
      const x = offC + si * repC;
      if (x + repC < -120 || x > vw + 120) continue;
      const mastX = x + repC * 0.3;
      const mastH = 380;
      const topY = vh * 0.92 - mastH;
      /* 塔身（桁架格子） */
      ctx.strokeStyle = '#d8c04a';
      ctx.lineWidth = 4;
      ctx.strokeRect(mastX, topY, 26, mastH);
      ctx.lineWidth = 2;
      for (let m = 0; m < 14; m++) {
        ctx.beginPath();
        ctx.moveTo(mastX, topY + m * (mastH / 14));
        ctx.lineTo(mastX + 26, topY + (m + 1) * (mastH / 14));
        ctx.moveTo(mastX + 26, topY + m * (mastH / 14));
        ctx.lineTo(mastX, topY + (m + 1) * (mastH / 14));
        ctx.stroke();
      }
      /* 吊臂（水平，带轻微摆动） */
      const swing = Math.sin(t * 0.35 + si) * 0.012;
      ctx.save();
      ctx.translate(mastX + 13, topY + 10);
      ctx.rotate(swing);
      ctx.strokeStyle = '#d8c04a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-repC * 0.42, 0); ctx.lineTo(repC * 0.5, 0);
      ctx.stroke();
      /* 吊索 + 吊钩 */
      ctx.strokeStyle = alpha('#e8e8e8', 0.7);
      ctx.lineWidth = 1.5;
      const hookX = repC * 0.3;
      ctx.beginPath();
      ctx.moveTo(hookX, 0); ctx.lineTo(hookX, 150);
      ctx.stroke();
      ctx.fillStyle = '#c8b040';
      ctx.fillRect(hookX - 6, 150, 12, 12);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * 城市应急配送站（第 20 关终局）—— ★ 暴风雨后的晨光
   * 十一要求"云层散开，出现日出/黎明或暴风雨后的光线"。
   */
  function emergencyStation(ctx, cam, cfg) {
    /* ★ 垂直视差补偿（见 yAnchor 的注释） */
    const yA = yAnchor(cam, 0.12);
    const vw = VW(), vh = VH();
    const col = cfg.color || '#4a5064';
    const dawn = cfg.dawn == null ? 1 : cfg.dawn;   // 0~1 黎明程度

    /* 朝霞（地平线暖光带） */
    ctx.save();
    const g = ctx.createLinearGradient(0, vh * 0.34, 0, vh * 0.86);
    g.addColorStop(0, alpha('#ffb86a', 0.28 * dawn));
    g.addColorStop(0.5, alpha('#ff8a6a', 0.18 * dawn));
    g.addColorStop(1, alpha('#ffd8a0', 0.06 * dawn));
    ctx.fillStyle = g;
    ctx.fillRect(0, vh * 0.34, vw, vh * 0.52);

    /* 云层散开后的天光（几道斜射光） */
    for (let k = 0; k < 5; k++) {
      const r1 = hash01((cfg.seedOffset || 0) + k * 37 + 1);
      const x = vw * (0.1 + r1 * 0.8);
      ctx.fillStyle = alpha('#fff0c8', 0.05 + r1 * 0.05 * dawn);
      ctx.beginPath();
      ctx.moveTo(x, vh * 0.2);
      ctx.lineTo(x + 46, vh * 0.2);
      ctx.lineTo(x + 150, vh * 0.9);
      ctx.lineTo(x + 66, vh * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* 远景：重新亮起的城市全景 */
    drawBuildingSilhouette(ctx, cam, {
      color: mix(col, '#2a2038', 0.5),
      opacity: 0.85, parallax: 0.14, spacing: 116, gap: 34,
      widthMin: 48, widthMax: 110, heightMin: 80, heightMax: 300,
      baseY: vh * 0.90, roofStyle: 'spire', windows: true,
      windowColor: 'rgba(255,236,170,0.75)', windowDensity: 0.62,
      seedOffset: (cfg.seedOffset || 0) + 31,
    });

    /* 应急站本体（★ 地标：高塔 + 停机坪 + 灯牌） */
    ctx.save();
    const sx = vw * 0.62 - cam.x * 0.2;
    const baseY = vh * 0.88;
    const W = 210, H = 190;
    /* 主体 */
    ctx.fillStyle = '#3a3f52';
    ctx.fillRect(sx, (baseY+yA) - H, W, H);
    ctx.fillStyle = alpha('#5a6478', 0.9);
    ctx.fillRect(sx, (baseY+yA) - H, W, 12);
    /* 玻璃幕墙（暖光） */
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 6; c++) {
        ctx.fillStyle = 'rgba(255,224,150,' + (0.35 + ((r + c) % 3) * 0.2) + ')';
        ctx.fillRect(sx + 16 + c * 30, (baseY+yA) - H + 30 + r * 30, 20, 18);
      }
    }
    /* 停机坪（顶部圆台） */
    ctx.fillStyle = '#4a5064';
    ctx.fillRect(sx + 40, (baseY+yA) - H - 16, W - 80, 16);
    ctx.strokeStyle = 'rgba(255,240,180,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx + W / 2, (baseY+yA) - H - 8, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,180,0.9)';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('H', sx + W / 2, (baseY+yA) - H + 2);
    /* 应急灯牌（红十字） */
    ctx.fillStyle = '#e34a4a';
    ctx.fillRect(sx + W - 54, (baseY+yA) - H + 40, 34, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx + W - 44, (baseY+yA) - H + 52, 14, 10);
    ctx.fillRect(sx + W - 40, (baseY+yA) - H + 48, 6, 18);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /* ============================================================
   * ⑨ 第 20 关专用：其余三个阶段的场景
   * ============================================================ */

  /**
   * 高楼外墙（第 20 关阶段 2）
   * ------------------------------------------------------------------
   * 十一要求："背景切换为高楼外立面。可以看到窗户、空调外机、
   *          清洁平台和玻璃幕墙。镜头高度明显上升。"
   * ⇒ 实现：把"楼的立面"当作**贴满整屏的纵向网格**（不是远景剪影），
   *   窗格 + 空调外机 + 玻璃幕墙反光，让人"贴着墙往上爬"的感觉。
   */
  function highriseFacade(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#2a3244';
    const camY = (cfg.camY == null) ? 0 : cfg.camY;   // ★ 垂直视差：镜头上升时立面滚动
    const off = -cam.x * 0.35;
    const rep = 260;
    const i0 = Math.floor(-off / rep);
    const yShift = -camY * 0.55;                      // ★ "镜头高度上升"的关键
    const seed0 = cfg.seedOffset || 0;

    ctx.save();
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -80 || x > vw + 80) continue;
      const r = hash01(seed0 + si * 17 + 1);

      /* 立面主体（整屏高，纵向无限延伸感） */
      ctx.fillStyle = mix(col, '#000000', 0.25 + r * 0.15);
      ctx.fillRect(x, -300 + yShift, rep, vh + 900);

      /* 玻璃幕墙竖楞 */
      ctx.fillStyle = alpha(shade(col, 0.18), 0.5);
      for (let g = 0; g < 5; g++) {
        ctx.fillRect(x + 20 + g * (rep / 5), -300 + yShift, 7, vh + 900);
      }

      /* 窗格（★ 主体细节）—— 用 yShift 让它在镜头上升时滚动 */
      const fh = 84, fw = rep / 3;
      const startF = Math.floor((300 - yShift) / fh);
      for (let f = startF; f < startF + 14; f++) {
        const fy = f * fh + yShift;
        if (fy < -120 || fy > vh + 120) continue;
        for (let c = 0; c < 3; c++) {
          const wx = x + 14 + c * fw;
          const litOn = hash01(seed0 + si * 311 + f * 13 + c * 7) > 0.55;
          ctx.fillStyle = litOn
            ? 'rgba(255,230,170,' + (0.25 + r * 0.2).toFixed(2) + ')'
            : 'rgba(90,110,140,0.22)';
          ctx.fillRect(wx, fy, fw - 16, fh - 26);
        }
      }

      /* 空调外机（★ 十一点名要的细节） */
      for (let a = 0; a < 3; a++) {
        const ay = ((a * 233 + si * 57) % (vh + 400)) - 200 + yShift;
        const ax = x + 24 + hash01(seed0 + si * 71 + a) * (rep - 60);
        ctx.fillStyle = '#4a5468';
        ctx.fillRect(ax, ay, 26, 18);
        ctx.fillStyle = '#2a3244';
        ctx.fillRect(ax + 3, ay + 3, 20, 12);
      }

      /* 清洁平台（吊篮）：偶尔出现一条横向平台 */
      if (r > 0.55) {
        const py = ((si * 197) % (vh + 300)) - 150 + yShift;
        ctx.fillStyle = '#c8b040';
        ctx.fillRect(x + 30, py, rep - 60, 6);
        ctx.strokeStyle = alpha('#e8e8e8', 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 30, py - 40); ctx.lineTo(x + 30, py);
        ctx.moveTo(x + rep - 30, py - 40); ctx.lineTo(x + rep - 30, py);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * 云海（第 20 关阶段 4）
   * ------------------------------------------------------------------
   * 十一要求："背景进入云层。远处只能看到云海、闪电和被照亮的建筑顶部。
   *          闪电发生时，背景短暂变亮。不要只是叠加一条闪电图片。"
   * ⇒ 实现：多层翻滚云 + 云缝里露出**被照亮的建筑顶部**（少数几个尖顶）。
   */
  function stormSea(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const flash = cfg.flash || 0;

    /* 云缝下的建筑顶部（★ "被照亮的建筑顶部"） */
    ctx.save();
    const off = -cam.x * 0.1;
    const rep = 210;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const r = hash01(seed0 + si * 13 + 1);
      if (r < 0.35) continue;                     // 大部分被云挡住
      const h = 60 + r * 90;
      /* 尖顶建筑（塔/尖塔），颜色在闪电时变亮 */
      ctx.fillStyle = flash > 0.05
        ? alpha('#8a92a8', 0.6 + flash * 0.4)
        : alpha('#3a4050', 0.75);
      ctx.beginPath();
      ctx.moveTo(x + rep * 0.3, vh * 0.78);
      ctx.lineTo(x + rep * 0.42, vh * 0.78 - h);
      ctx.lineTo(x + rep * 0.54, vh * 0.78);
      ctx.closePath();
      ctx.fill();
      /* 顶灯（闪电时更亮） */
      ctx.fillStyle = 'rgba(255,90,90,' + (0.5 + flash * 0.5).toFixed(2) + ')';
      ctx.fillRect(x + rep * 0.42 - 3, vh * 0.78 - h - 6, 6, 6);
    }
    ctx.restore();

    /* 云海（上下都在翻） */
    drawStormCloudLayer(ctx, cam, {
      layers: 4, color: 'rgba(120,126,156,0.9)', colorTop: 'rgba(180,188,214,0.85)',
      parallax: 0.2, y0: vh * 0.42, y1: vh * 0.98,
      density: 3, seedOffset: seed0 + 61, flash: flash, t: t, scroll: 0.7,
    });
    drawStormCloudLayer(ctx, cam, {
      layers: 2, color: 'rgba(72,78,104,0.75)', colorTop: 'rgba(120,128,158,0.7)',
      parallax: 0.3, y0: vh * 0.02, y1: vh * 0.2,
      density: 4, seedOffset: seed0 + 97, flash: flash, t: t, scroll: 0.9,
    });
  }

  /**
   * 追逐走廊（第 20 关阶段 5）
   * ------------------------------------------------------------------
   * 十一要求："背景快速移动。风暴云、闪电和城市灯光向后掠过。
   *          追逐物出现时，背景加入明显的速度变化和警报灯。"
   * ⇒ 实现：所有元素的视差系数被**显著放大**（`speed` 参数），
   *   加上一排向后流过的城市灯带 + 警报闪灯。
   *   ⚠️ 关键：这是"速度感"而不是"新场景" —— 用同一批元素跑得更快即可。
   */
  function chaseCorridor(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const speed = (cfg.speed == null) ? 1 : cfg.speed;     // 追逐时 > 1

    /* ① 向后掠过的城市灯带（★ 速度感的主要来源） */
    ctx.save();
    const off1 = -cam.x * (0.55 * speed);
    const rep1 = 170;
    const i01 = Math.floor(-off1 / rep1);
    for (let k = -1; k <= Math.ceil((vw + rep1) / rep1) + 1; k++) {
      const si = k + i01;
      const x = off1 + si * rep1;
      if (x + rep1 < -100 || x > vw + 100) continue;
      const r = hash01(seed0 + si * 19 + 1);
      /* 拖影（速度感）：拉长的光条 */
      const streak = 30 + speed * 90;
      ctx.fillStyle = 'rgba(255,214,140,' + (0.18 + r * 0.3).toFixed(2) + ')';
      ctx.fillRect(x, vh * (0.6 + r * 0.22), streak, 3);
      ctx.fillStyle = 'rgba(150,200,255,' + (0.12 + r * 0.2).toFixed(2) + ')';
      ctx.fillRect(x + rep1 * 0.4, vh * (0.68 + r * 0.18), streak * 0.7, 3);
    }
    ctx.restore();

    /* ② 高速掠过的风暴云（视差放大） */
    drawStormCloudLayer(ctx, cam, {
      layers: 4, color: 'rgba(64,70,96,0.92)', colorTop: 'rgba(110,118,148,0.85)',
      parallax: 0.45 * speed, y0: 0, y1: vh * 0.55,
      density: 2, seedOffset: seed0 + 33, flash: cfg.flash || 0,
      t: t, scroll: 1.5 * speed,
    });

    /* ③ 警报灯（★ 十一要求"警报灯"）—— 交替闪烁的红/蓝 */
    ctx.save();
    const blink = Math.floor(t * 4) % 2;
    const glow = ctx.createRadialGradient(vw * 0.12, vh * 0.2, 0, vw * 0.12, vh * 0.2, 260);
    glow.addColorStop(0, blink ? 'rgba(255,60,60,0.27)' : 'rgba(60,120,255,0.27)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, vw * 0.5, vh * 0.6);
    const glow2 = ctx.createRadialGradient(vw * 0.88, vh * 0.18, 0, vw * 0.88, vh * 0.18, 260);
    glow2.addColorStop(0, blink ? 'rgba(60,120,255,0.24)' : 'rgba(255,60,60,0.24)');
    glow2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(vw * 0.5, 0, vw * 0.5, vh * 0.6);
    ctx.restore();
  }

  /* ==========================================================================
   * ★★★ 第 21~30 关专属笔刷（2026-10-07 十一要求）★★★
   * ==========================================================================
   * 十一原话："请为第21到30关背景进行重新设计，因为目前它们的背景
   *          完全相同、缺乏区分度。请为这10个背景分别设计各具特色
   *          且能体现各自主题的视觉方案。"
   *
   * 【为什么要新写笔刷，而不是只改配色】
   *   第 21~30 关原来**只有配色、没有图层** ⇒ 每关就是一片渐变天空，
   *   构图完全一样，玩家当然觉得"背景相同"。
   *   ⇒ 每关配一支**专属笔刷**，画出该关的招牌风景（构图不同，不只是颜色不同）。
   *
   * 【每支笔刷的"一眼可辨特征"】
   *   21 机场货运区 → 跑道灯带 + 货机尾翼 + 集装箱堆
   *   22 风电山谷   → 山脊上一整排**旋转的风力机**
   *   23 山地索道   → 索道塔 + **悬空缆车缓缓移动**
   *   24 雪山公路   → 雪峰 + 盘山公路护栏 + 路灯
   *   25 废弃游乐园 → **摩天轮（缓转）** + 过山车轨道
   *   26 高层医院   → 成排方窗的医疗大楼 + 直升机坪
   *   27 高速列车   → 高架轨道 + **掠过的列车**（车头灯拖尾）
   *   28 洪水城区   → **半淹的楼房** + 水面倒影 + 漂浮物
   *   29 城市核心塔 → 巨型塔楼 + 环状光环
   *   30 黎明天空   → 天台天际线 + 日出光带
   *
   * ⚠️ 全部用**确定性哈希**定位（绝不用 Math.random）—— 背景每帧重画，
   *    用随机数会疯狂闪烁。
   * ⚠️ 每个 painter 只读 cfg、不改游戏状态；抛错由调用方逐层 try 兜住。
   * ========================================================================== */

  /** 21 · 机场货运区 —— 集装箱堆场 + 货机尾翼 + 跑道灯带
   *
   * ⚠️⚠️ 垂直位置是**这一组笔刷最容易踩的坑**（记下来）：
   *    关卡地形（大片实心砖）会盖住屏幕**下部约 70%**，
   *    只有**上部 15%~50% 那一带**是真正能看见背景的"可见带"。
   *    ⇒ 第一版我把集装箱/公路/摩天轮都画在 vh*0.7~0.95，
   *      **全被地形挡住** —— 截图里就是一片均匀色块，等于白做。
   *    ⇒ 所以所有笔刷的**招牌元素都必须落在 vh*0.12 ~ vh*0.55**。
   *      下部只留给"贴地装饰"（灯带、草），挡了也不可惜。 */
  function airportCargo(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#18222f';
    const seed0 = cfg.seedOffset || 0;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：集装箱堆场（★ 上移到可见带：vh*0.5 为堆场底线） */
    ctx.save();
    const off = -cam.x * 0.16;
    const rep = 46;
    const i0 = Math.floor(-off / rep);
    for (let k = -2; k <= Math.ceil((vw + rep) / rep) + 2; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const rows = 2 + Math.floor(hash01(seed0 + si * 13) * 3);
      for (let r = 0; r < rows; r++) {
        const hh = 18, ww = rep - 6;
        const y = vh * 0.52 + yA - r * (hh + 2);
        const pick = Math.floor(hash01(seed0 + si * 7 + r * 23) * 4) % 4;
        const tints = ['#8a5533', '#35547c', '#33662f', '#525259'];
        ctx.fillStyle = alpha(tints[pick], 0.9);
        ctx.fillRect(x + 3, y, ww, hh);
        ctx.fillStyle = alpha(shade(col, 0.42), 0.3);
        ctx.fillRect(x + 3, y, ww, 2);          // 顶面高光
        ctx.fillStyle = alpha('#000000', 0.22);
        ctx.fillRect(x + 3, y + hh - 2, ww, 2); // 底边阴影
      }
    }
    ctx.restore();

    /* ② 中：货机（机身 + 高耸尾翼 + 慢闪航空灯）—— 飞在可见带上方 */
    ctx.save();
    const offB = -cam.x * 0.3;
    const repB = 980;
    const i0B = Math.floor(-offB / repB);
    for (let k = -1; k <= Math.ceil((vw + repB) / repB) + 1; k++) {
      const si = k + i0B;
      const x = offB + si * repB;
      if (x + repB < -200 || x > vw + 200) continue;
      const bx = x + repB * 0.28;
      const baseY = vh * 0.36 + yA;                  // ★ 上部（天空里）
      ctx.fillStyle = alpha(shade(col, 0.08), 0.92);
      ctx.fillRect(bx - 120, baseY - 46, 280, 30);         // 机身
      /* 机头（圆润收尖） */
      ctx.beginPath();
      ctx.moveTo(bx - 120, baseY - 46);
      ctx.lineTo(bx - 158, baseY - 32);
      ctx.lineTo(bx - 120, baseY - 16);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();                                      // 尾翼
      ctx.moveTo(bx + 96, baseY - 46);
      ctx.lineTo(bx + 148, baseY - 172);
      ctx.lineTo(bx + 172, baseY - 172);
      ctx.lineTo(bx + 168, baseY - 46);
      ctx.closePath();
      ctx.fillStyle = alpha(shade(col, -0.18), 0.95);
      ctx.fill();
      const blink = (Math.sin((cfg.t || 0) * 2.2 + si) > 0);
      ctx.fillStyle = blink ? 'rgba(255,80,80,1)' : 'rgba(90,220,120,0.95)';
      ctx.beginPath();
      ctx.arc(bx + 160, baseY - 168, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* ③ 近：跑道灯带（贴地，挡了不可惜） */
    ctx.save();
    const offR = -cam.x * 0.5;
    const repR = 74;
    const i0R = Math.floor(-offR / repR);
    for (let k = -1; k <= Math.ceil((vw + repR) / repR) + 1; k++) {
      const si = k + i0R;
      const x = offR + si * repR;
      if (x + repR < -40 || x > vw + 40) continue;
      const y = vh * 0.955 + yA;
      ctx.fillStyle = alpha(col, 0.5);
      ctx.fillRect(x, y - 20, 3, 20);                       // 灯杆
      ctx.fillStyle = 'rgba(255,208,120,0.95)';             // 灯
      ctx.beginPath();
      ctx.arc(x + 1.5, y - 22, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 22 · 风电山谷 —— 山脊 + 一整排旋转的风力发电机 + 谷雾 */
  function windValley(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#3c5a5a';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：连绵山脊（★ 上移到可见带） */
    [{ par: 0.1, yb: 0.46, amp: 46, colr: shade(col, 0.16) },
     { par: 0.2, yb: 0.54, amp: 34, colr: shade(col, -0.08) }].forEach(function (L, li) {
      ctx.save();
      ctx.beginPath();
      const off = -cam.x * L.par;
      const step = 90;
      ctx.moveTo(-100, vh);
      for (let x = -100; x <= vw + 100; x += step) {
        const sx = x + off;
        const n = hash01(seed0 + li * 97 + Math.floor((x + 2000) / step) * 17);
        const y = vh * L.yb + yA - Math.sin((x + off) * 0.0018 + li) * L.amp - n * 40;
        ctx.lineTo(sx, y);
      }
      ctx.lineTo(vw + 100, vh);
      ctx.closePath();
      ctx.fillStyle = alpha(L.colr, li === 0 ? 0.62 : 0.9);
      ctx.fill();
      ctx.restore();
    });

    /* ② ★ 招牌：山脊上的风力机群（叶片真的在转） */
    const rep = 210;
    const offW = -cam.x * 0.34;
    const i0W = Math.floor(-offW / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0W;
      const x = offW + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const r0 = hash01(seed0 + si * 41);
      const baseY = vh * (0.46 + r0 * 0.06) + yA;      // ★ 山脊附近
      const towerH = 90 + r0 * 70;
      const topY = baseY - towerH;
      /* 塔柱（上细下粗的锥形） */
      ctx.beginPath();
      ctx.moveTo(x - 3, baseY);
      ctx.lineTo(x + 3, baseY);
      ctx.lineTo(x + 1.6, topY);
      ctx.lineTo(x - 1.6, topY);
      ctx.closePath();
      ctx.fillStyle = alpha(shade(col, 0.55), 0.95);
      ctx.fill();
      /* 机舱 */
      ctx.fillStyle = alpha(shade(col, 0.7), 1);
      ctx.beginPath();
      ctx.arc(x, topY, 4.6, 0, Math.PI * 2);
      ctx.fill();
      /* ★ 三枚叶片（按 t 旋转）+ 每台转速略不同（哈希错开相位） */
      const phase = t * (0.9 + r0 * 0.5) + si * 1.7;
      ctx.save();
      ctx.translate(x, topY);
      ctx.rotate(phase);
      ctx.fillStyle = alpha(shade(col, 0.82), 0.95);
      for (let b = 0; b < 3; b++) {
        ctx.rotate(Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.moveTo(-1.4, 0);
        ctx.lineTo(1.4, 0);
        ctx.lineTo(0.6, -30 - r0 * 14);
        ctx.lineTo(-0.6, -30 - r0 * 14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /* ③ 谷雾（横向半透明带，随时间微微起伏） */
    ctx.save();
    const fy = vh * 0.62 + yA + Math.sin(t * 0.4) * 4;
    const fog = ctx.createLinearGradient(0, fy - 60, 0, fy + 120);
    fog.addColorStop(0, 'rgba(220,240,235,0)');
    fog.addColorStop(1, 'rgba(220,240,235,0.34)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, fy - 60, vw, 180);
    ctx.restore();
  }

  /** 23 · 山地索道 —— 陡峭山壁 + 索道塔 + 悬空缆车缓缓移动 */
  function cableCar(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#4a5a78';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.12);

    /* ① 远：陡峭山壁（★ 上移） */
    ctx.save();
    ctx.beginPath();
    const off = -cam.x * 0.14;
    ctx.moveTo(-100, vh);
    for (let x = -100; x <= vw + 100; x += 60) {
      const n = hash01(seed0 + Math.floor((x + 3000) / 60) * 29);
      const y = vh * 0.5 + yA - n * 170 - Math.abs(Math.sin(x * 0.004)) * 60;
      ctx.lineTo(x + off, y);
    }
    ctx.lineTo(vw + 100, vh);
    ctx.closePath();
    ctx.fillStyle = alpha(shade(col, 0.1), 0.66);
    ctx.fill();
    ctx.restore();

    /* ② 钢缆（★ 上移到可见带） */
    const towerXs = [];
    const rep = 430;
    const offT = -cam.x * 0.4;
    const i0T = Math.floor(-offT / rep);
    const CABLE_Y = vh * 0.24;             // ★ 缆绳高度（可见带内）
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0T;
      const x = offT + si * rep;
      towerXs.push({ x: x, si: si });
    }
    ctx.save();
    ctx.strokeStyle = alpha(shade(col, 0.6), 0.85);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i < towerXs.length - 1; i++) {
      const a = towerXs[i], b = towerXs[i + 1];
      const ay = CABLE_Y + yA, by = CABLE_Y + 8 + yA;
      if (i === 0) ctx.moveTo(a.x, ay);
      ctx.quadraticCurveTo((a.x + b.x) / 2, Math.max(ay, by) + 34, b.x, by);
    }
    ctx.stroke();
    ctx.restore();

    /* ③ 索道塔（桁架塔，从缆绳高度往下延伸） */
    towerXs.forEach(function (tw) {
      const x = tw.x;
      if (x < -80 || x > vw + 80) return;
      const topY = CABLE_Y + yA, baseY = vh * 0.62 + yA;    // ★ 底端也上移
      ctx.save();
      ctx.strokeStyle = alpha(shade(col, 0.4), 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 12, baseY); ctx.lineTo(x - 5, topY);
      ctx.moveTo(x + 12, baseY); ctx.lineTo(x + 5, topY);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      for (let s = 0; s < 7; s++) {
        const y0 = baseY - (baseY - topY) * (s / 7);
        const y1 = baseY - (baseY - topY) * ((s + 1) / 7);
        const w0 = 12 - (12 - 5) * (s / 7);
        const w1 = 12 - (12 - 5) * ((s + 1) / 7);
        ctx.beginPath();
        ctx.moveTo(x - w0, y0); ctx.lineTo(x + w1, y1);
        ctx.moveTo(x + w0, y0); ctx.lineTo(x - w1, y1);
        ctx.stroke();
      }
      ctx.fillStyle = alpha(shade(col, 0.6), 0.95);
      ctx.fillRect(x - 8, topY - 3, 16, 6);
      ctx.restore();
    });

    /* ④ ★ 招牌：缆车（挂在缆绳上，沿绳缓慢移动） */
    ctx.save();
    const cars = 3;
    for (let c = 0; c < cars; c++) {
      const span = vw + 400;
      const prog = ((t * 26 + c * span / cars) % span) / span;   // 0~1
      const gx = -200 + prog * span;
      const gy = CABLE_Y + yA + Math.sin(prog * Math.PI) * 20;
      /* 吊臂 */
      ctx.strokeStyle = alpha(shade(col, 0.5), 0.95);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, gy + 14);
      ctx.stroke();
      /* 车厢（圆角矩形 + 窗） */
      const cw = 44, chh = 32;
      ctx.fillStyle = alpha(shade(col, -0.05), 0.97);
      ctx.fillRect(gx - cw / 2, gy + 14, cw, chh);
      ctx.fillStyle = 'rgba(255,236,190,0.95)';    // 窗（亮着）
      ctx.fillRect(gx - cw / 2 + 5, gy + 19, cw - 10, 13);
      ctx.fillStyle = alpha('#000000', 0.3);
      ctx.fillRect(gx - cw / 2, gy + 14 + chh, cw, 3);  // 底边
    }
    ctx.restore();
  }

  /** 24 · 雪山公路 —— 雪峰 + 盘山公路（护栏 + 路灯）+ 飘雪 */
  function snowRoad(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#7a8a9c';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：雪峰（★ 上移可见带） */
    ctx.save();
    const off = -cam.x * 0.12;
    const peaks = 5;
    ctx.beginPath();
    ctx.moveTo(-100, vh);
    for (let i = 0; i <= peaks; i++) {
      const px = -100 + (vw + 200) * (i / peaks) + off * 0.5;
      const n = hash01(seed0 + i * 53);
      const py = vh * 0.2 + yA - n * 110;              // ★ 峰顶
      ctx.lineTo(px, py);
      ctx.lineTo(px + (vw + 200) / peaks * 0.5, vh * 0.44 + yA - n * 34);  // 山坳
    }
    ctx.lineTo(vw + 100, vh);
    ctx.closePath();
    ctx.fillStyle = alpha(shade(col, 0.28), 0.72);
    ctx.fill();
    /* 雪顶（峰顶一截更白） */
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(248,252,255,0.82)';
    ctx.fillRect(0, 0, vw + 200, vh * 0.3 + yA);
    ctx.restore();
    ctx.restore();

    /* ② 中：盘山公路（★ 上移到可见带） */
    ctx.save();
    const roadY = vh * 0.42 + yA;                      // ★ 公路高度
    const offRd = -cam.x * 0.34;
    ctx.beginPath();
    ctx.moveTo(-50, roadY + 26);
    ctx.lineTo(vw + 50, roadY - 10);
    ctx.lineTo(vw + 50, roadY + 34);
    ctx.lineTo(-50, roadY + 76);
    ctx.closePath();
    ctx.fillStyle = alpha(shade(col, -0.4), 0.88);
    ctx.fill();
    /* 护栏（一排短竖线 + 暖黄路灯） */
    const rep = 34;
    const i0 = Math.floor(-offRd / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = offRd + si * rep;
      if (x < -20 || x > vw + 20) continue;
      const slope = -10 / (vw + 100);
      const y = roadY + 26 + (x + 50) * slope + 50;
      ctx.fillStyle = alpha(shade(col, -0.55), 0.95);
      ctx.fillRect(x, y - 22, 3, 24);
      ctx.fillStyle = alpha(shade(col, -0.3), 0.9);
      ctx.fillRect(x, y - 22, 12, 3);
      if (si % 3 === 0) {
        ctx.fillStyle = 'rgba(255,226,160,1)';
        ctx.beginPath();
        ctx.arc(x, y - 28, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    /* ③ 飘雪（★ 全屏，稳定哈希不闪） */
    ctx.save();
    for (let i = 0; i < 80; i++) {
      const sx = hash01(seed0 + i * 137) * vw;
      const sp = 12 + hash01(seed0 + i * 71) * 26;
      const sy = (hash01(seed0 + i * 31) * vh + t * sp) % (vh + 20);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + hash01(seed0 + i * 11) * 0.45).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(sx + Math.sin(t * 0.6 + i) * 6, sy - 10, 1.6 + hash01(seed0 + i * 5) * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 25 · 废弃游乐园 —— 摩天轮（缓转）+ 过山车轨道 + 荒草 */
  function abandonedPark(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#3a2540';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：过山车轨道（★ 上移可见带） */
    ctx.save();
    const off = -cam.x * 0.14;
    ctx.strokeStyle = alpha(shade(col, 0.1), 0.85);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let x = -100; x <= vw + 100; x += 12) {
      const y = vh * 0.3 + yA
        - Math.abs(Math.sin((x + off * 0.6) * 0.0032)) * 90
        - Math.sin(x * 0.009) * 16;
      if (x === -100) ctx.moveTo(x + off, y); else ctx.lineTo(x + off, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1.4;
    for (let x = -100; x <= vw + 100; x += 46) {
      const y = vh * 0.3 + yA
        - Math.abs(Math.sin((x + off * 0.6) * 0.0032)) * 90
        - Math.sin(x * 0.009) * 16;
      ctx.beginPath();
      ctx.moveTo(x + off, y);
      ctx.lineTo(x + off, y + 22);
      ctx.stroke();
    }
    ctx.restore();

    /* ② ★ 招牌：摩天轮（缓慢旋转 + 座舱）—— 圆心在可见带 */
    ctx.save();
    const offW = -cam.x * 0.4;
    const repW = 1100;
    const i0W = Math.floor(-offW / repW);
    for (let k = -1; k <= Math.ceil((vw + repW) / repW) + 1; k++) {
      const si = k + i0W;
      const x = offW + si * repW;
      if (x + repW < -260 || x > vw + 260) continue;
      const cx = x + repW * 0.35;
      const R = 132;
      const cy = vh * 0.2 + yA;                   // ★ 圆心上移
      const spin = t * 0.22;

      /* 支撑架（A 字形两条腿，伸到画面下方 —— 挡了不可惜） */
      ctx.strokeStyle = alpha(shade(col, 0.35), 0.9);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 52, vh * 0.72 + yA);
      ctx.lineTo(cx, cy);
      ctx.moveTo(cx + 52, vh * 0.72 + yA);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      /* 轮圈（双圈，加粗提亮提高辨识度） */
      ctx.lineWidth = 5;
      ctx.strokeStyle = alpha(shade(col, 0.55), 1);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R - 16, 0, Math.PI * 2);
      ctx.lineWidth = 2.6;
      ctx.stroke();

      /* 辐条 + 座舱（跟着 spin 转） */
      for (let s = 0; s < 12; s++) {
        const a = spin + s * Math.PI * 2 / 12;
        const ex = cx + Math.cos(a) * R, ey = cy + Math.sin(a) * R;
        ctx.strokeStyle = alpha(shade(col, 0.4), 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        /* 座舱（亮色描边，暗底也能看清） */
        ctx.fillStyle = alpha(shade(col, -0.35), 1);
        ctx.fillRect(ex - 7, ey - 6, 14, 13);
        ctx.strokeStyle = alpha(shade(col, 0.7), 1);
        ctx.lineWidth = 1.8;
        ctx.strokeRect(ex - 7, ey - 6, 14, 13);
        /* 少数座舱还亮着残灯（荒废感 + 提亮） */
        if (hash01(seed0 + si * 31 + s) > 0.6) {
          ctx.fillStyle = 'rgba(255,205,130,1)';
          ctx.fillRect(ex - 4, ey - 3, 8, 7);
        }
      }
      /* 轮心 */
      ctx.fillStyle = alpha(shade(col, 0.8), 1);
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* ③ 近：荒草（贴地，挡了不可惜） */
    ctx.save();
    const offG = -cam.x * 0.55;
    const repG = 11;
    const i0G = Math.floor(-offG / repG);
    for (let k = -1; k <= Math.ceil((vw + repG) / repG) + 1; k++) {
      const si = k + i0G;
      const x = offG + si * repG;
      if (x < -10 || x > vw + 10) continue;
      const hh = 10 + hash01(seed0 + si * 17) * 22;
      const bend = Math.sin(t * 1.2 + si * 0.5) * (2 + hh * 0.12);
      ctx.strokeStyle = alpha(shade(col, -0.35), 0.85);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, vh + yA);
      ctx.quadraticCurveTo(x + bend * 0.5, vh + yA - hh * 0.6, x + bend, vh + yA - hh);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 26 · 高层医院 —— 成排方窗的医疗大楼 + 直升机坪 + 红十字 */
  function hospitalTower(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#20404e';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：后排楼群（低矮、暗淡，衬托主楼） */
    ctx.save();
    drawBuildingSilhouette(ctx, cam, {
      color: shade(col, -0.22), opacity: 0.5, parallax: 0.1,
      widthMin: 70, widthMax: 130, heightMin: 90, heightMax: 200,
      seedOffset: seed0 + 11, baseY: 0.92,
    });
    ctx.restore();

    /* ② 主楼：一栋高耸的医疗大楼（成排方窗 + 顶部红十字 + 直升机坪）
     *    ⚠️ 楼顶必须落在可见带内（vh*0.1 附近），否则招牌元素看不见 */
    ctx.save();
    const off = -cam.x * 0.26;
    const rep = 760;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -240 || x > vw + 240) continue;
      const bx = x + rep * 0.2;
      const bw = 200;
      const baseY = vh * 0.78 + yA;                 // ★ 楼底（可见带下沿）
      const bh = vh * 0.62;
      const topY = baseY - bh;
      /* 楼体 */
      ctx.fillStyle = alpha(shade(col, 0.05), 0.95);
      ctx.fillRect(bx, topY, bw, bh);
      /* 侧面（立体感） */
      ctx.fillStyle = alpha(shade(col, -0.3), 0.92);
      ctx.fillRect(bx + bw, topY + 14, 28, bh - 14);
      /* ★ 成排方窗（医院招牌特征：密集、规整、有几扇亮着） */
      const cols = 6, rows = 12;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = bx + 15 + c * 30;
          const wy = topY + 26 + r * 32;
          if (wy > baseY - 14) continue;
          const lit = hash01(seed0 + si * 53 + r * 7 + c * 13);
          if (lit > 0.58) {
            const br = 0.6 + 0.3 * Math.sin(t * 1.1 + r * 0.7 + c);
            ctx.fillStyle = 'rgba(195,240,250,' + br.toFixed(2) + ')';
          } else {
            ctx.fillStyle = alpha(shade(col, 0.18), 0.5);
          }
          ctx.fillRect(wx, wy, 19, 21);
        }
      }
      /* ★ 顶部红十字（红底白十字的灯箱，慢闪） */
      const sy = topY - 34;
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 1.6));
      ctx.fillStyle = 'rgba(210,55,65,' + (0.6 + pulse * 0.4).toFixed(2) + ')';
      ctx.fillRect(bx + bw / 2 - 30, sy, 60, 34);
      ctx.fillStyle = 'rgba(255,248,248,' + (0.8 + pulse * 0.2).toFixed(2) + ')';
      ctx.fillRect(bx + bw / 2 - 7, sy + 5, 14, 24);       // 竖
      ctx.fillRect(bx + bw / 2 - 19, sy + 12, 38, 9);      // 横
      /* 直升机坪（楼顶圆环 + H） */
      const hy = topY - 6;
      ctx.strokeStyle = alpha(shade(col, 0.5), 0.9);
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.ellipse(bx + bw * 0.8, hy, 48, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(235,248,255,0.85)';
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.8 - 11, hy - 8); ctx.lineTo(bx + bw * 0.8 - 11, hy + 8);
      ctx.moveTo(bx + bw * 0.8 + 11, hy - 8); ctx.lineTo(bx + bw * 0.8 + 11, hy + 8);
      ctx.moveTo(bx + bw * 0.8 - 11, hy); ctx.lineTo(bx + bw * 0.8 + 11, hy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 27 · 高速列车 —— 高架轨道 + 掠过的列车（车头灯拖尾） */
  function bulletTrain(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#1c2430';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const speed = (cfg.speed == null) ? 1 : cfg.speed;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：夜色中的城市剪影（低对比，衬托列车） */
    ctx.save();
    drawBuildingSilhouette(ctx, cam, {
      color: shade(col, -0.1), opacity: 0.55, parallax: 0.12,
      widthMin: 50, widthMax: 110, heightMin: 80, heightMax: 240,
      seedOffset: seed0 + 7, baseY: 0.88,
    });
    ctx.restore();

    /* ② 高架轨道（★ 上移到可见带中下部） */
    ctx.save();
    const off = -cam.x * 0.3;
    const rep = 120;
    const i0 = Math.floor(-off / rep);
    const railY = vh * 0.48 + yA;                 // ★ 轨道高度
    /* 桥面 */
    ctx.fillStyle = alpha(shade(col, 0.1), 0.95);
    ctx.fillRect(0, railY, vw, 18);
    /* 桥墩（向下延伸到画面外，挡了不可惜） */
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x < -30 || x > vw + 30) continue;
      ctx.fillStyle = alpha(shade(col, -0.05), 0.9);
      ctx.fillRect(x, railY + 18, 15, vh);
      if (Math.sin(t * 2 + si) > 0.4) {
        ctx.fillStyle = 'rgba(255,70,70,0.9)';
        ctx.beginPath();
        ctx.arc(x + 7, railY + 24, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    /* 轨道（两条亮线） */
    ctx.strokeStyle = alpha(shade(col, 0.6), 0.85);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, railY + 3); ctx.lineTo(vw, railY + 3);
    ctx.moveTo(0, railY + 11); ctx.lineTo(vw, railY + 11);
    ctx.stroke();
    ctx.restore();

    /* ③ ★ 招牌：列车（含车头灯 + 向后拖尾的光带）—— 跑在轨道上 */
    ctx.save();
    const period = 6.5;
    const phase = (t / period + 0.3) % 1;
    const span = vw + 900;
    const tx = -700 + phase * span;
    const th = 48;
    const ty = railY - th - 2;
    const trainW = 640;
    /* 车身（流线型：车头用三角收尖） */
    ctx.fillStyle = alpha(shade(col, 0.45), 0.98);
    ctx.beginPath();
    ctx.moveTo(tx, ty + th);
    ctx.lineTo(tx + trainW, ty + th);
    ctx.lineTo(tx + trainW, ty);
    ctx.lineTo(tx + 120, ty);
    ctx.lineTo(tx, ty + th * 0.55);
    ctx.closePath();
    ctx.fill();
    /* 车窗灯带（一长条亮窗） */
    ctx.fillStyle = 'rgba(215,242,255,0.95)';
    ctx.fillRect(tx + 130, ty + 13, trainW - 160, 13);
    /* 车头灯（强光 + 拖尾） */
    const lg = ctx.createLinearGradient(tx, ty, tx - 280, ty + th * 0.5);
    lg.addColorStop(0, 'rgba(255,250,220,0.8)');
    lg.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(tx - 280, ty + 4, 280, th);
    ctx.fillStyle = 'rgba(255,255,245,1)';
    ctx.beginPath();
    ctx.arc(tx + 6, ty + th * 0.5, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* ④ 速度线（掠过的横线，速度感） */
    ctx.save();
    for (let i = 0; i < 26; i++) {
      const r0 = hash01(seed0 + i * 71);
      const spd = (140 + r0 * 320) * speed;
      const sy = vh * (0.1 + hash01(seed0 + i * 37) * 0.6) + yA;
      const sx = (hash01(seed0 + i * 19) * (vw + 400) - t * spd) % (vw + 400);
      const xx = sx < 0 ? sx + vw + 400 : sx;
      const len = 40 + r0 * 90;
      ctx.fillStyle = 'rgba(200,220,255,' + (0.06 + r0 * 0.10).toFixed(2) + ')';
      ctx.fillRect(xx - len, sy, len, 1.6);
    }
    ctx.restore();
  }

  /** 28 · 洪水城区 —— 半淹的楼房 + 水面倒影 + 漂浮物 */
  function floodDistrict(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#17323e';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.1);
    const waterY = vh * 0.46 + yA;             // ★ 水面线（可见带内）

    /* ① 楼群（下半截泡在水里 —— 这是"洪水"最直白的表达） */
    ctx.save();
    const off = -cam.x * 0.18;
    const rep = 96;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const r0 = hash01(seed0 + si * 23);
      const bw = 40 + r0 * 42;
      const bh = 120 + hash01(seed0 + si * 47) * 190;
      const topY = waterY - bh + 30;
      /* 楼体 */
      ctx.fillStyle = alpha(shade(col, 0.1), 0.94);
      ctx.fillRect(x, topY, bw, bh);
      /* 窗户（有几扇亮着 —— 停电前的余灯） */
      const lit = hash01(seed0 + si * 61);
      if (lit > 0.45) {
        ctx.fillStyle = 'rgba(255,214,150,0.62)';
        for (let wy = topY + 14; wy < waterY - 12; wy += 22) {
          for (let wx = x + 7; wx < x + bw - 9; wx += 17) {
            if (hash01(seed0 + si * 13 + wx * 3 + wy) > 0.55) {
              ctx.fillRect(wx, wy, 9, 11);
            }
          }
        }
      }
      /* ★ 水线（楼体在水面处的高亮横带 —— 表达"泡着"） */
      ctx.fillStyle = 'rgba(190,230,240,0.65)';
      ctx.fillRect(x, waterY - 4, bw, 5);
    }
    ctx.restore();

    /* ② 水面（横向波纹 + 倒影色块） */
    ctx.save();
    const wg = ctx.createLinearGradient(0, waterY, 0, waterY + 220);
    wg.addColorStop(0, 'rgba(50,110,125,0.7)');
    wg.addColorStop(1, 'rgba(15,50,65,0.95)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, waterY, vw, 260);
    /* 波纹（等距短横线，错相位起伏） */
    for (let i = 0; i < 46; i++) {
      const r0 = hash01(seed0 + i * 91);
      const wy = waterY + 8 + r0 * 200;
      const wx = ((hash01(seed0 + i * 31) * (vw + 200)) - t * (12 + r0 * 24)) % (vw + 200);
      const xx = wx < 0 ? wx + vw + 200 : wx;
      const wl = 26 + r0 * 64;
      ctx.fillStyle = 'rgba(200,240,245,' + (0.10 + r0 * 0.20).toFixed(2) + ')';
      ctx.fillRect(xx - wl, wy, wl, 1.8);
    }
    ctx.restore();

    /* ③ 漂浮物（木箱/油桶，缓慢漂移） */
    ctx.save();
    for (let i = 0; i < 5; i++) {
      const r0 = hash01(seed0 + i * 143);
      const span = vw + 400;
      const prog = ((t * (9 + r0 * 14) + i * span / 5) % span) / span;
      const x = -200 + prog * span;
      const y = waterY + 20 + r0 * 150 + Math.sin(t * 1.2 + i) * 3;
      const w = 22 + r0 * 24, h = 14 + r0 * 13;
      ctx.fillStyle = alpha(shade(col, -0.2), 0.95);
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(205,242,248,0.45)';
      ctx.fillRect(x, y, w, 2.6);
    }
    ctx.restore();
  }

  /** 29 · 城市核心塔 —— 巨型塔楼 + 环状光环 + 城市远景 */
  function coreTower(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#1a1a34';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const yA = yAnchor(cam, 0.1);

    /* ① 远：环抱核心塔的城市楼群（越低越暗，突出中心） */
    ctx.save();
    drawBuildingSilhouette(ctx, cam, {
      color: shade(col, 0.06), opacity: 0.55, parallax: 0.1,
      widthMin: 60, widthMax: 130, heightMin: 100, heightMax: 260,
      seedOffset: seed0 + 3, baseY: 0.94,
    });
    ctx.restore();

    /* ② ★ 招牌：巨型核心塔（巨大的梯形塔体 + 分层环带 + 顶部光环） */
    ctx.save();
    const off = -cam.x * 0.3;
    const rep = 1400;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -400 || x > vw + 400) continue;
      const cx = x + rep * 0.5;
      const baseY = vh * 0.8 + yA;                  // ★ 塔底（可见带下沿）
      const towerH = vh * 0.72;
      const bw = 186, tw = 100;
      const topY = baseY - towerH;                  // ★ 塔顶在 vh*0.08 附近
      /* 塔体（梯形） */
      ctx.fillStyle = alpha(shade(col, 0.08), 0.96);
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, baseY);
      ctx.lineTo(cx + bw / 2, baseY);
      ctx.lineTo(cx + tw / 2, topY);
      ctx.lineTo(cx - tw / 2, topY);
      ctx.closePath();
      ctx.fill();
      /* 分层横带（每层一条浅色线 —— 表现"巨型结构"的尺度） */
      for (let s = 1; s < 12; s++) {
        const f = s / 12;
        const y = baseY - towerH * f;
        const w = bw + (tw - bw) * f;
        ctx.fillStyle = alpha(shade(col, 0.34), 0.55);
        ctx.fillRect(cx - w / 2, y, w, 3);
      }
      /* 竖向棱线（立体感） */
      ctx.fillStyle = alpha(shade(col, -0.24), 0.6);
      ctx.fillRect(cx + tw * 0.18, topY, 10, towerH);
      /* ★ 顶部光环（多层同心环，随时间扩张呼吸） */
      const hx = cx, hy = topY - 26;
      for (let ring = 0; ring < 3; ring++) {
        const pr = ((t * 26 + ring * 40) % 120) / 120;
        const rr = 22 + pr * 82;
        const al = (1 - pr) * 0.65;
        ctx.strokeStyle = 'rgba(178,160,255,' + al.toFixed(2) + ')';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.ellipse(hx, hy, rr, rr * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      /* 核心（明亮光点 + 呼吸） */
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 1.4));
      const cg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 70);
      cg.addColorStop(0, 'rgba(215,200,255,' + (0.7 * pulse).toFixed(2) + ')');
      cg.addColorStop(1, 'rgba(150,130,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(hx, hy, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(245,240,255,1)';
      ctx.beginPath();
      ctx.arc(hx, hy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 30 · 全城终点·黎明天空 —— 天台天际线 + 日出光带 + 云散 */
  function dawnRooftop(ctx, cam, cfg) {
    const vw = VW(), vh = VH();
    const col = cfg.color || '#3a3050';
    const seed0 = cfg.seedOffset || 0;
    const t = cfg.t || 0;
    const dawn = (cfg.dawn == null) ? 1 : cfg.dawn;      // 0~1 黎明程度
    const yA = yAnchor(cam, 0.1);

    /* ① ★ 日出光带（地平线处的暖光，随 dawn 变强） */
    ctx.save();
    const sunX = vw * 0.62, sunY = vh * 0.62 + yA;
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, vw * 0.55);
    sg.addColorStop(0, 'rgba(255,226,170,' + (0.42 * dawn).toFixed(2) + ')');
    sg.addColorStop(0.4, 'rgba(255,180,140,' + (0.22 * dawn).toFixed(2) + ')');
    sg.addColorStop(1, 'rgba(255,140,120,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, vw, vh);
    ctx.restore();

    /* ② 云（被晨光染成暖色，缓缓向右飘散） */
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const r0 = hash01(seed0 + i * 83);
      const cy = vh * (0.1 + r0 * 0.34) + yA;
      const span = vw + 500;
      const cxp = (((hash01(seed0 + i * 29) * span) + t * (5 + r0 * 9)) % span);
      const cx = cxp - 250;
      const cw = 130 + r0 * 220, chh = 18 + r0 * 26;
      const cg = ctx.createLinearGradient(cx, cy - chh, cx, cy + chh);
      cg.addColorStop(0, 'rgba(255,' + Math.round(210 - r0 * 40) + ',' + Math.round(190 - r0 * 30) + ',' + (0.26 * dawn).toFixed(2) + ')');
      cg.addColorStop(1, 'rgba(210,180,200,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, chh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* ③ ★ 天台天际线（★ 楼顶落在可见带内） */
    ctx.save();
    const off = -cam.x * 0.22;
    const rep = 88;
    const i0 = Math.floor(-off / rep);
    for (let k = -1; k <= Math.ceil((vw + rep) / rep) + 1; k++) {
      const si = k + i0;
      const x = off + si * rep;
      if (x + rep < -60 || x > vw + 60) continue;
      const r0 = hash01(seed0 + si * 37);
      const bw = rep - 4;
      const bh = 90 + r0 * 210;
      const baseY = vh * 0.68 + yA;                 // ★ 楼底上移（可见带下沿）
      const topY = baseY - bh;
      /* 楼体（剪影感） */
      ctx.fillStyle = alpha(shade(col, 0.05), 0.95);
      ctx.fillRect(x, topY, bw, bh);
      /* 楼顶细节（按哈希挑一种）—— 这是"天台"的辨识点 */
      const kind = Math.floor(hash01(seed0 + si * 59) * 3);
      ctx.fillStyle = alpha(shade(col, -0.2), 0.95);
      if (kind === 0) {
        /* 水塔（小圆柱 + 支脚） */
        ctx.fillRect(x + bw * 0.2, topY - 20, 16, 20);
        ctx.beginPath();
        ctx.moveTo(x + bw * 0.2, topY - 20);
        ctx.lineTo(x + bw * 0.2 + 8, topY - 32);
        ctx.lineTo(x + bw * 0.2 + 16, topY - 20);
        ctx.closePath();
        ctx.fill();
      } else if (kind === 1) {
        /* 天线（细杆 + 红灯） */
        ctx.fillRect(x + bw * 0.6, topY - 38, 2.6, 38);
        if (Math.sin(t * 2 + si) > 0.3) {
          ctx.fillStyle = 'rgba(255,90,90,0.95)';
          ctx.beginPath();
          ctx.arc(x + bw * 0.6 + 1.3, topY - 40, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        /* 晾衣杆（两竖一横 + 挂着的布） */
        ctx.fillRect(x + bw * 0.15, topY - 22, 2, 22);
        ctx.fillRect(x + bw * 0.65, topY - 22, 2, 22);
        ctx.fillRect(x + bw * 0.15, topY - 23, bw * 0.5, 2);
        ctx.fillStyle = alpha(shade(col, -0.3), 0.9);
        ctx.fillRect(x + bw * 0.28, topY - 21, 8, 13);
        ctx.fillRect(x + bw * 0.46, topY - 21, 8, 13);
      }
      /* 窗户（黎明时几乎全灭，只余零星几盏） */
      if (r0 > 0.7) {
        ctx.fillStyle = 'rgba(255,220,170,0.55)';
        ctx.fillRect(x + 9, topY + 18, 10, 12);
      }
    }
    ctx.restore();
  }

  return {
    /* 工具 */
    hash01: hash01, hashRange: hashRange,
    parseColor: parseColor, shade: shade, alpha: alpha, mix: mix,
    /* 通用构件 */
    drawParallaxLayer: drawParallaxLayer,
    drawBuildingSilhouette: drawBuildingSilhouette,
    drawPipeNetwork: drawPipeNetwork,
    drawBridgeStructure: drawBridgeStructure,
    drawMarketStalls: drawMarketStalls,
    drawUnderwaterTunnel: drawUnderwaterTunnel,
    drawPowerTower: drawPowerTower,
    drawStormCloudLayer: drawStormCloudLayer,
    /* 场景组合（每关的"招牌风景"） */
    oldTownRooftops: oldTownRooftops,
    drainTower: drainTower,
    logisticsYard: logisticsYard,
    undergroundVault: undergroundVault,
    riverBridge: riverBridge,
    nightMarket: nightMarket,
    deepSeaTunnel: deepSeaTunnel,
    blackoutGrid: blackoutGrid,
    craneSite: craneSite,
    emergencyStation: emergencyStation,
    highriseFacade: highriseFacade,
    stormSea: stormSea,
    chaseCorridor: chaseCorridor,
    /* ★ 第 21~30 关专属笔刷（2026-10-07）★ */
    airportCargo: airportCargo,
    windValley: windValley,
    cableCar: cableCar,
    snowRoad: snowRoad,
    abandonedPark: abandonedPark,
    hospitalTower: hospitalTower,
    bulletTrain: bulletTrain,
    floodDistrict: floodDistrict,
    coreTower: coreTower,
    dawnRooftop: dawnRooftop,
  };
})();
