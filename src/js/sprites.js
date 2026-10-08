/* ============================================================
 * sprites.js — 像素角色绘制
 * 全部用代码画，不依赖任何图片。风格：超级玛丽式像素块。
 *
 * 绘制思路：用 16x16 的像素网格定义角色，每格一个颜色编号，
 * 再按 targetSize 放大绘制，得到硬边像素风。
 * ============================================================ */

/* ---------- 调色板 ---------- */
const PAL = {
  // 美团袋鼠（黄衣外卖服）
  k_hat:    '#f7c948',  // 帽子黄
  k_hatD:   '#d9a417',  // 帽檐暗黄
  k_body:   '#ffd93b',  // 制服黄
  k_bodyD:  '#e8b81c',  // 制服暗部
  k_face:   '#f5d5b0',  // 皮肤
  k_faceD:  '#d9b189',
  k_ear:    '#e8a978',  // 耳朵
  k_earI:   '#c98a5c',
  k_eye:    '#2b2118',
  k_shoe:   '#3a3a3a',
  k_pack:   '#4a9de0',  // 外卖箱蓝
  k_packD:  '#2b6ea8',
  k_mouth:  '#8a5a3a',

  // 奶龙（★ 2026-10-06 改版：外卖骑手形象 ★）
  /* 设计说明（十一的要求：穿黄制服 + 戴黄帽 + 保留圆润可爱 + 缩小后仍能看清）：
   *
   *   原来的奶龙是"奶白 + 橙斑"的宠物形象，和"外卖骑手"主题不搭。
   *   现在改成骑手上岗的样子，但**不能丢掉辨识度** ——
   *   做法是：
   *     · 保留圆润的身体轮廓和额头的角（这是奶龙的标志）
   *     · 头顶加一顶**黄色骑手帽**（带帽檐，深色描边保证和小黄帽区分）
   *     · 身体穿**黄色短袖制服**（胸口有橙色条纹 —— 美团的品牌色）
   *     · 下半身是**深色裤装**，和上半身形成对比（缩小后轮廓更清楚）
   *     · 背后背一个**小配送包**（蓝色，和袋鼠的外卖箱同色系）
   *     · 加深色描边，避免黄色服装糊在黄色背景/金币上
   *
   *   ⚠️ 关键取舍：黄色面积不能太大。
   *      如果整个身体都刷成黄，摘到 32px 尺寸时会和金币、按钮、
   *      背景的黄块混成一片。所以黄色只用在"帽 + 上衣"，
   *      脸和肚子保留奶白（这也是奶龙的可爱所在）。
   */
  d_body:   '#fff6e0',  // 奶白（脸部 / 露出的肚皮）
  d_bodyD:  '#e8dcc2',
  d_belly:  '#fffdf5',
  d_bellyD: '#efe6d2',
  d_spot:   '#ff9a3c',  // 橙色（制服条纹 / 角）
  d_spotD:  '#e07a1c',
  d_horn:   '#ffd166',  // 角
  d_hornD:  '#d9a83c',
  d_eye:    '#2b2118',
  d_cheek:  '#ffb3b3',
  d_mouth:  '#a8644a',
  /* 新增：骑手装备色 */
  d_uni:    '#ffd93b',  // 骑手制服黄（和袋鼠同一套品牌色）
  d_uniD:   '#e8b81c',  // 制服暗部
  d_cap:    '#ffd93b',  // 骑手帽
  d_capD:   '#d9a417',  // 帽檐 / 帽子暗部
  d_pants:  '#3a3a46',  // 深色裤装（和黄色形成对比）
  d_pantsD: '#2a2a34',
  d_bag:    '#4a9de0',  // 配送包（和袋鼠的外卖箱同色系）
  d_bagD:   '#2b6ea8',
  d_outline:'#2b2118',  // 深色描边（防黄衣服糊在黄背景上）

  // 卡皮巴拉（★ 2026-10-06 新增：第三骑手 ★）
  /* 设计说明（十一的要求：必须穿美团外卖服 + 戴帽子，保留卡皮巴拉的辨识度）：
   *
   *   卡皮巴拉的招牌 = 方头方鼻 + 淡定小眼 + 小圆耳 + 圆胖桶状身材。
   *   和袋鼠（细高肤色脸）、奶龙（奶白圆胖+腮红）站一起，
   *   靠"棕色 + 方脸 + 方鼻"第一时间就能认出来。
   *
   *   ⚠️ 骑手三件套（帽/制服/配送包）沿用品牌色，但**棕色必须占大头**：
   *      黄色 <60%、棕色 ≥25% —— 否则缩到 32px 就分不清是袋鼠还是卡皮巴拉。
   */
  c_fur:    '#a9784a',  // 毛（主色棕）
  c_furD:   '#8a5f38',  // 毛暗部
  c_face:   '#c19360',  // 脸（比身体亮，把五官托出来）
  c_ear:    '#7a5230',  // 耳廓（深棕，从帽子两侧露出）
  c_earI:   '#5e3c22',  // 耳内
  c_eye:    '#2b2118',
  c_muz:    '#b88450',  // 吻部（卡皮巴拉的方嘴）
  c_nose:   '#4a3020',  // 方鼻（★ 卡皮巴拉最强的辨识特征）
  c_belly:  '#c8a06a',  // 制服下摆露出的浅色肚皮
  c_cap:    '#ffd93b',  // 美团黄帽
  c_capD:   '#d9a417',  // 帽檐
  c_uni:    '#ffd93b',  // 外卖制服
  c_uniD:   '#e8b81c',  // 制服暗部
  c_stripe: '#ff9a3c',  // 胸口条纹（美团橙）
  c_pants:  '#3a3a46',  // 深色裤装
  c_pantsD: '#2a2a34',
  c_shoe:   '#3a3a3a',
  c_bag:    '#4a9de0',  // 配送包（和另外两位同色系）
  c_bagD:   '#2b6ea8',
  c_out:    '#2b2118',

  // 通用
  W: null,  // 透明
};

/* ---------- 美团袋鼠 16x16 ----------
 * 每行 16 个字符，字符含义见下面 legend
 */
const KANGAROO_SPRITE = [
  ".....kkkkkk.....",
  "....kkkkkkkk....",
  "....kkkkkkkk....",
  "...kkffffffff...",
  "..kkkffeffef....",
  "..kfffffffffff..",
  "..kffffmmfffff..",
  "..kfffffffffff..",
  ".keeffffffffff..",
  ".keefffffffff...",
  "..bbbbbbbbbbb...",
  ".bbbbbbbbbbbpp..",
  ".bbbbbBBbbbppp..",
  "..bbb..bbb..bb..",
  "..fff..fff..ff..",
  "..sss..sss..sss.",
];

/* 奶龙 16x16 —— ★ 外卖骑手版（2026-10-06 重画）★
 *
 * 图例（对应 DRAGON_KEY）：
 *   .  透明          o  深色描边
 *   C  骑手帽（黄）   c  帽檐/帽子暗部
 *   h  角（黄）       H  角暗部
 *   d  奶白身体       D  身体暗部
 *   e  眼睛           k  腮红
 *   m  嘴
 *   U  制服黄         u  制服暗部
 *   S  橙色条纹       s  橙色暗部
 *   b  肚皮白         B  肚皮暗部
 *   P  深色裤装       p  裤装暗部
 *   G  配送包蓝       g  配送包暗部
 *
 * ★ 三条设计约束（都是校验收出来的，别破坏）★
 *
 *   ① 黄色占比必须 <60%
 *      游戏主色调就是黄（金币、按钮、背景黄块）。
 *      第一版全身刷黄 → 黄占 75%，缩到 32px 会糊成一片。
 *      现在黄只给"帽 + 上衣"（上半身），脸和肚皮保留奶白。
 *
 *   ② 配送包（蓝）必须露出来
 *      它是"外卖骑手"最直白的符号，比制服更有识别力。
 *      放在屏幕左侧（角色背面），占 3 格宽。
 *
 *   ③ 轮廓要和袋鼠明显不同
 *      袋鼠是"细长 + 高 + 有耳朵"；奶龙要"矮胖 + 圆 + 头大"。
 *      这是两个角色站一起时**最先被分辨**的特征，
 *      比配色更有效（很多人是色弱）。
 *      → 所以奶龙**比袋鼠矮 1 行、宽 2 列、头明显更大**。
 *
 * 布局（从上到下）：
 *   ① 帽顶（比头略宽）
 *   ② 帽檐（暗黄，横向拉长 —— 帽子的关键特征）
 *   ③ 角从帽子左侧探出
 *   ④ 大脸（奶白，占 5 行 —— 头大是"圆润可爱"的关键）
 *   ⑤ 上衣（黄）+ 胸口橙条纹 + 左侧配送包
 *   ⑥ 肚皮（奶白）
 *   ⑦ 深色裤装 + 脚
 */
const DRAGON_SPRITE = [
  "................",
  "..CCCCCCCCCCCC..",
  ".cccccccccccccc.",
  "...hhddddddDDD..",
  "..hhdddddddDDD..",
  "..dddeeddddDeeD.",
  "..dddkkddddkkDD.",
  "..ddddmmmmmddd..",
  "ggdUUUUUUUUUUd..",
  "ggdUUUSSSUUUUd..",
  "ggdUUUUUUUUUUd..",
  "...ddUUUUUUdd...",
  "...dddbbbbDDd...",
  "...ddbbbbbbdd...",
  "...PPPddddPPPP..",
  "...ppppddppppp..",
];

/* 字符 → 调色板 key 映射 */
const SPRITE_MAP = {
  k: ['k_hatD', 'k_hat', 'k_body', 'k_bodyD'],
  f: ['k_face', 'k_face'],
  e: ['k_eye'],
  m: ['k_mouth'],
  b: ['k_pack', 'k_packD'],
  B: ['k_packD'],
  p: ['k_pack'],
  s: ['k_shoe'],

  d: ['d_body', 'd_bodyD'],
  h: ['d_horn', 'd_hornD'],
  b: ['d_belly', 'd_bellyD'],
  s: ['d_spot', 'd_spotD'],
  c: ['d_cheek'],
};

/* 把 sprite 定义转成二维颜色数组 */
function buildSprite(grid, mapSet) {
  const out = [];
  for (let y = 0; y < grid.length; y++) {
    const row = [];
    for (let x = 0; x < grid[y].length; x++) {
      const ch = grid[y][x];
      if (ch === '.') { row.push(null); continue; }
      const keys = mapSet[ch];
      if (keys) row.push(PAL[keys[0]]);
      else row.push(null);
    }
    out.push(row);
  }
  return out;
}

const SPR_KANGAROO = buildSprite(KANGAROO_SPRITE, SPRITE_MAP);

/* ---------- 奶龙单独构建（键名冲突，单独处理） ----------
 * ★ 2026-10-06：加入骑手装备的字符映射 ★
 *   C/c 帽子   h/H 角   U/u 制服   S/s 橙色条纹
 *   P/p 裤装   G/g 配送包   o 深色描边
 */
const DRAGON_KEY = {
  d: ['d_body', 'd_bodyD'],
  D: ['d_bodyD'],
  h: ['d_horn', 'd_hornD'],
  H: ['d_hornD'],
  b: ['d_belly', 'd_bellyD'],
  B: ['d_bellyD'],
  s: ['d_spot', 'd_spotD'],
  S: ['d_spot'],            // 橙色条纹（用亮橙，在黄制服上要能看出来）
  k: ['d_cheek'],
  c: ['d_capD'],            // 帽檐 / 帽子暗部
  C: ['d_cap'],             // 帽子主体
  e: ['d_eye'],
  m: ['d_mouth'],
  U: ['d_uni'],             // 制服黄
  u: ['d_uniD'],
  P: ['d_pants'],           // 深色裤装
  p: ['d_pantsD'],
  G: ['d_bag'],             // 配送包
  g: ['d_bagD'],
  o: ['d_outline'],         // 深色描边
};
const SPR_DRAGON = buildSprite(DRAGON_SPRITE, DRAGON_KEY);

/* ---------- 卡皮巴拉 16x16 —— ★ 第三骑手（2026-10-06）★ ----------
 *
 * 图例（对应 CAPYBARA_KEY）：
 *   .  透明
 *   C  帽子黄（美团黄）   c  帽檐暗黄
 *   E  耳廓（深棕）       I  耳内
 *   f  脸（亮棕）         e  眼睛
 *   m  吻部               N  方鼻（★ 卡皮巴拉的招牌）
 *   U  制服黄             u  制服暗部
 *   S  胸口橙色条纹
 *   b  浅色肚皮           P  裤装   s  鞋
 *   G  配送包蓝           g  包暗部  o  描边
 *
 * ★ 设计约束（tools/_capybara_design.js 的体检规则，别破坏）★
 *
 *   ① 黄色（帽+制服）占比 <60%、棕色（本体）≥25%
 *      三个骑手都戴黄帽穿黄制服是"同一家的团队感"，
 *      但卡皮巴拉必须一眼是棕色的 —— 要不就跟袋鼠混了。
 *
 *   ② 方鼻 + 方头 + 小圆耳是卡皮巴拉的命根子
 *      眼睛要小要淡定（卡皮巴拉的招牌表情）；
 *      吻部三层结构：吻(y7) → 鼻(y8) → 下巴(y9)。
 *
 *   ③ 轮廓 vs 袋鼠 / 奶龙 >15%（sprite-check 同款校验）
 *      头更宽更方（10 宽脸 + 帽檐 12 宽），身体是圆桶，
 *      和袋鼠的细高、奶龙的矮胖都拉开。
 *
 * 布局（从上到下）：
 *   ① 帽顶 ② 宽帽檐 ③ 耳朵从帽檐两侧探出 + 方脸
 *   ④ 淡定小眼 ⑤ 吻部三层（吻/方鼻/下巴）
 *   ⑥ 黄制服 + 胸口橙条纹 + 左侧配送包 ⑦ 下摆露肚皮 ⑧ 深裤 + 鞋
 */
const CAPYBARA_SPRITE = [
  "................",
  "....CCCCCCCC....",
  "..cccccccccccc..",
  ".EEffffffffffEE.",
  ".EIffffffffffIE.",
  "...feeffffeef...",
  "...ffffffffff...",
  "....mmmmmmmm....",
  ".....mNNNNm.....",
  "....ffffffff....",
  "gggUUUUUUUUUU...",
  "gggUUUSSSUUUU...",
  "gggUUUUUUUUUU...",
  "..uUUUbbbbUUUu..",
  "...PPPPPPPPPP...",
  "...ssss..ssss...",
];

/* 卡皮巴拉字符 → 调色板映射（独立一套，避免和袋鼠/奶龙的字符打架） */
const CAPYBARA_KEY = {
  f: ['c_face'],
  F: ['c_furD'],
  E: ['c_ear'],
  I: ['c_earI'],
  e: ['c_eye'],
  m: ['c_muz'],
  N: ['c_nose'],
  b: ['c_belly'],
  C: ['c_cap'],
  c: ['c_capD'],
  U: ['c_uni'],
  u: ['c_uniD'],
  S: ['c_stripe'],
  P: ['c_pants'],
  p: ['c_pantsD'],
  s: ['c_shoe'],
  G: ['c_bag'],
  g: ['c_bagD'],
  o: ['c_out'],
};
const SPR_CAPYBARA = buildSprite(CAPYBARA_SPRITE, CAPYBARA_KEY);

/* ============================================================
 * ★ 行走动作（2026-10-06 新增）★
 * ============================================================
 * 十一的要求："增加美团袋鼠和飞龙宝宝的行走动作。"
 *
 * ------------------------------------------------------------
 * 【⚠️ 走过的弯路：先试了"平移腿部"，在游戏尺寸下完全看不出来】
 * ------------------------------------------------------------
 *   第一版做法：把精灵图的"腿"那一条横向平移，做出迈步感。
 *   结果测出来画面**一个像素都没变**。查了两层原因：
 *
 *     ① 切分位置错了：我以为精灵是 16×16、最后 2 行是腿，
 *        但 assets/*.png 其实是 **128 像素高**的高清图
 *        （kangaroo 91×128、dragon 126×128），
 *        按 14/16 切会**切在躯干中间**。
 *     ② 就算切对了也没用：角色在游戏里只有 **26×32 像素**，
 *        袋鼠的腿在图上只占底部 4 行 → 显示出来**只有 1 像素高**。
 *        平移 1 像素的东西，肉眼根本看不见。
 *
 *   ⇒ 结论：**在这个尺寸下，"平移局部"是错误的技术选择。**
 *
 * ------------------------------------------------------------
 * 【现在采用的做法：整体摆动（业界最常用的实惠方案）】
 * ------------------------------------------------------------
 *   参考超级马里奥：角色只有十几个像素高，也一样"看起来在走路"。
 *   靠的不是腿部逐帧，而是三件事叠加：
 *
 *     ① 上下起伏 bob —— 像每一步都弹一下（频率和速度挂钩）
 *     ② 左右轻微摇摆 sway —— 像重心从一只脚换到另一只脚
 *     ③ 轻微的挤压拉伸 squash —— 起来时拉长、落下时压扁
 *
 *   这三样在 26×32 的尺寸下**都能看清**，而且两个角色、
 *   两条渲染路径（图片 / 像素网格）**自动都生效** ——
 *   因为它们是作用于"整个角色的绘制变换"，不依赖精灵数据。
 * ============================================================ */
const WALK = {
  /* 起伏幅度（屏幕像素）。2.2 在 32px 高的角色上很自然：
   * 再大就像在蹦，再小就看不出来。 */
  bobAmp: 2.2,
  /* 摆动幅度（屏幕像素）。横向挪一点点，像重心左右换脚。 */
  swayAmp: 1.2,
  /* 挤压拉伸幅度。±0.06 足够看出"一弹一压"而不变形。 */
  squashAmp: 0.06,
  /* 摆动基准频率（次/秒）。跑速 3 px/帧 时约 2.9 步/秒，
   * 接近真人小跑，落在平台游戏常见区间（2~4）里。 */
  baseFreq: 9.0,
  /* 速度小于这个值就算"站着"—— 不做任何摆动（避免原地抖） */
  minSpeed: 0.35,
};

/* ============================================================
 * 算出行走动作的三个分量
 * ============================================================
 * @param animT    玩家累计动画时间（秒）
 * @param speed    当前水平速度（px/帧）
 * @param onGround 是否在地面
 * @return { bob, sway, squash, phase }
 *         bob    —— 向上的位移（正数 = 抬起，调用方自己去减 y）
 *         sway   —— 横向位移（正负摆动）
 *         squash —— 挤压系数（1 附近，>1 压扁 <1 拉长）
 *         phase  —— 0~1 步态相位（给需要同步的东西用，比如尘土）
 *
 * ⚠️ 静止（速度 < minSpeed）时全部返回"中性值"，
 *    这样玩家停下来角色就是**规规矩矩的站姿**，不会原地抖。
 * ============================================================ */
function walkMotion(animT, speed, onGround) {
  const neutral = { bob: 0, sway: 0, squash: 1, phase: 0 };
  if (!onGround) return neutral;                  // 空中走自己的跳跃姿态
  const sp = Math.abs(speed || 0);
  if (sp < WALK.minSpeed) return neutral;         // 站着 → 不动

  /* 频率随速度提高：走得快 → 步子迈得急。上限 1.7 倍免得快到抽搐。 */
  const freq = WALK.baseFreq * Math.min(1.7, 0.6 + sp / 3);
  const ph = animT * freq;
  return {
    /* 起伏：用 |sin| 而不是 sin —— 每一次落地都归零，
     * 所以看起来是"一步一顿"，而不是"上下匀速晃"。 */
    bob: Math.abs(Math.sin(ph)) * WALK.bobAmp,
    /* 摆动：用 sin，和起伏差 90 度相位，
     * 于是"抬起来的时候正好偏向一侧"，像换脚。 */
    sway: Math.sin(ph) * WALK.swayAmp,
    /* 挤压：起身时拉长（<1）、落下时压扁（>1）—— 和 bob 反相 */
    squash: 1 + (Math.abs(Math.sin(ph)) - 0.5) * 2 * WALK.squashAmp,
    phase: ph / (Math.PI * 2),
  };
}

/* 周期 2π 归一化成 0~1 的辅助（给尘土等特效同步用） */
function walkPhase01(animT, speed) {
  const sp = Math.abs(speed || 0);
  if (sp < WALK.minSpeed) return 0;
  const freq = WALK.baseFreq * Math.min(1.7, 0.6 + sp / 3);
  const ph = (animT * freq) / (Math.PI * 2);
  return ph - Math.floor(ph);
}

/* ============================================================================
 * ★★★ 角色专属行走 / 翻滚动画（2026-10-07 十一要求）★★★
 * ============================================================================
 * 十一的原话："把不同角色的行走动作和翻滚动作都设计的不同，
 *             要符合他们的人物性格，还有他们的特长。"
 *
 * ------------------------------------------------------------
 * 【为什么不做成"逐帧腿部动画"】
 *   角色的腿在屏幕上只有 1~2px 高，逐帧画腿**根本看不见**，
 *   而且要画 11 套 × N 帧 = 工作量爆炸。
 *   真正能让玩家"一眼看出不是同一个角色"的，是**整体轮廓的动势**：
 *     · 起伏多高（蹦跳型 vs 沉稳型）
 *     · 左右摆多大（摇摆型 vs 直线型）
 *     · 挤压相位（先压还是先拉伸）
 *     · 频率快慢（急脾气 vs 慢性子）
 *   ⇒ 这四项组合起来，11 个角色能有 11 种截然不同的"气质"。
 *
 * ------------------------------------------------------------
 * 【怎么读这张表】（每项都有"性格理由"，不是随手填的数）
 * ------------------------------------------------------------
 *   bobAmp    起伏幅度  —— 大 = 蹦跳感（活泼/弹跳型）
 *   swayAmp   左右摆幅  —— 大 = 摇晃感（慢吞吞/摇摆型）
 *                        负值 = **反相摆动**（像鱼游、像蛇行）
 *   squashAmp 挤压幅度  —— 大 = 一压一弹很明显（爆发型）
 *   freqMul   频率倍率  —— >1 = 步子急（快节奏角色）
 *   lean      前倾角度  —— 正数 = 身体前倾（冲刺型）
 *   spinMul   翻滚速度倍率  —— 大 = 翻得快而利落
 *   spinStretch 翻滚时的拉伸量 —— 大 = 翻得"舒展"，小 = 团得紧
 *
 * ⚠️ 所有值都在"看不出变形"的安全范围内（bob ≤ 5px、sway ≤ 3px）。
 * ⚠️ 缺字段会走 WALK 的默认值 ⇒ 加新角色不加动画也能正常跑。
 * ============================================================================ */
const ROLE_MOTION = {
  /* ---- 袋鼠：跳跃最高 → "蹦"是它的本能 ---- */
  kangaroo: {
    bobAmp: 3.4, swayAmp: 1.0, squashAmp: 0.08, freqMul: 0.95,
    lean: 0, spinMul: 1.0, spinStretch: 1.14,
    note: '大幅弹跳 —— 全队跳跃最高的，走路都像在蹦',
  },

  /* ---- 飞龙：跑得最快 → 小碎步 + 前倾 ---- */
  dragon: {
    bobAmp: 1.5, swayAmp: 0.7, squashAmp: 0.05, freqMul: 1.35,
    lean: 0.06, spinMul: 1.15, spinStretch: 1.08,
    note: '急促小碎步、身体前倾 —— 全场跑最快，一路压着速度跑',
  },

  /* ---- 卡皮巴拉：抓墙久、最沉稳 → 慢吞吞左右晃 ---- */
  capybara: {
    bobAmp: 1.6, swayAmp: 2.4, squashAmp: 0.07, freqMul: 0.62,
    lean: 0, spinMul: 0.72, spinStretch: 1.22,
    note: '慢吞吞、左右大晃 —— 水豚的佛系步伐，翻起来也懒洋洋',
  },

  /* ---- 史迪奇：冲刺最远 → 压得低、爪爪扒地 ---- */
  stitch: {
    bobAmp: 1.3, swayAmp: 1.6, squashAmp: 0.11, freqMul: 1.25,
    lean: 0.08, spinMul: 1.3, spinStretch: 0.9,
    note: '压低身子六爪扒地 —— 626 号实验体的爆发前倾',
  },

  /* ---- 猴子：墙跳高 → 轻快窜跳 ---- */
  monkey: {
    bobAmp: 3.0, swayAmp: 1.5, squashAmp: 0.09, freqMul: 1.15,
    lean: 0.03, spinMul: 1.25, spinStretch: 0.94,
    note: '轻快窜跳、上蹿下跳 —— 猴子走路也不老实',
  },

  /* ---- 小鱼：跑最快但没腿 → 像在水里游 ---- */
  fish: {
    bobAmp: 1.1, swayAmp: -2.2, squashAmp: 0.04, freqMul: 1.3,
    lean: 0.05, spinMul: 1.05, spinStretch: 1.30,
    /* ⚠️ swayAmp 是**负数** ⇒ 摆动和起伏**反相**，
     *    配合"起伏很小"整体就是蛇行/游动的感觉。
     *    这是全场唯一用负值的 —— 因为鱼本来就不是"走"的。 */
    note: '像在水里游 —— 起伏极小、左右蛇行（没有腿，不走路）',
  },

  /* ---- 小狗：全能均衡 → 规规矩矩的轻快小跑 ---- */
  puppy: {
    bobAmp: 2.2, swayAmp: 1.2, squashAmp: 0.06, freqMul: 1.1,
    lean: 0.02, spinMul: 1.0, spinStretch: 1.0,
    note: '轻快小跑、摇着尾巴 —— 各项都标准，最"正常"的步伐',
  },

  /* ---- 小羊：墙跳最高 → 山羊式弹跳小跑 ---- */
  lamb: {
    bobAmp: 2.8, swayAmp: 0.9, squashAmp: 0.08, freqMul: 1.2,
    lean: 0.02, spinMul: 1.1, spinStretch: 1.05,
    note: '弹跳式小跑 —— 山羊蹄子一点一点地蹦',
  },

  /* ---- 尼克：二段跳强、狡猾 → 蹑手蹑脚 ---- */
  nick: {
    bobAmp: 1.9, swayAmp: 1.9, squashAmp: 0.05, freqMul: 0.85,
    lean: 0.04, spinMul: 0.95, spinStretch: 1.35,
    /* 翻滚拉伸最大（1.35）：呼应他"二段跳最狠"——
     * 空中那一下身体拉得最开，看起来窜得最高。 */
    note: '蹑手蹑脚、鬼鬼祟祟 —— 狐狸的滑头步伐；翻滚拉得最开（呼应二段跳）',
  },

  /* ---- 朱迪：冲两发、干劲十足 → 精神抖擞高抬腿 ---- */
  judy: {
    bobAmp: 2.6, swayAmp: 1.3, squashAmp: 0.09, freqMul: 1.4,
    lean: 0.07, spinMul: 1.2, spinStretch: 0.92,
    note: '精神抖擞高抬腿 —— 警官兔子，步子又快又有劲',
  },

  /* ---- 碧琪：踩怪弹最高、派对狂 → 蹦蹦跳跳停不下来 ---- */
  pinkiepie: {
    bobAmp: 4.2, swayAmp: 2.6, squashAmp: 0.13, freqMul: 1.5,
    lean: -0.02, spinMul: 1.45, spinStretch: 0.88,
    /* 四项全是"最夸张"的：起伏最大、摆得最大、挤压最猛、步子最急 ——
     * 这就是碧琪。翻滚转得最快（1.45），翻起来像上了发条。 */
    note: '蹦蹦跳跳停不下来 —— 起伏/摆动/挤压全是全场最夸张的',
  },

  /* ============================================================
   * ★★★ 「十一」：粉色史迪仔 · 甜品主题（2026-10-07）★★★
   * ============================================================
   * 十一的要求（连续三条，都在这一份里实现）：
   *   ① "跳跃的时候就不要翻滚了，重新设计一个动作"
   *   ② "然后走路的话，脚可以动起来"
   *   ③ "静止的时候，手上拿着一根棒棒糖 —— 彩色的"
   *
   * ------------------------------------------------------------
   * 【① 二段跳不翻滚 → 改成"甜甜地向上蹦"】
   *   `spinMul: 0` 让她**完全不转体**（render.js 里 0 就不产生旋转）。
   *   取而代之的是新字段 `hopStyle: 'candy'`：
   *   render.js 看到它就走"撒糖霜"分支 —— 向上拉伸 + 轻微后仰 +
   *   头顶冒粉色糖霜粒子。是个**甜、软、轻**的动作，不是炫技翻转。
   *
   * 【② 走路脚动起来 → legSwing】
   *   这是全场**唯一**开 `legSwing` 的角色。
   *   原理：用 `sin(相位)` 驱动一个**竖直方向的左右交错偏移**，
   *   视觉上像两条腿交替迈步（详见 render.js 的 legSwing 用法）。
   *
   * 【③ 静止时手握彩色棒棒糖 → lollipop: true】
   *   站着不动时，在身前画一根彩虹螺旋棒棒糖（render.js 实现）。
   *   这是她的"标志道具"—— 一停下来就掏糖吃。
   * ============================================================ */
  pinkstitch: {
    /* 走路：步子轻快但不夸张（她要"脚动起来"，靠 legSwing 而不是大起伏） */
    bobAmp: 2.6, swayAmp: 1.4, squashAmp: 0.07, freqMul: 1.25,
    lean: 0.02,
    /* ★ ① 不翻滚 */
    spinMul: 0, spinStretch: 1.0,
    /* ★ ② 腿会动（全场唯一） */
    legSwing: 3.4,
    /* ★ ③ 静止握棒棒糖 */
    lollipop: true,
    /* ★ ① 二段跳专属动作 */
    hopStyle: 'candy',
    note: '甜甜的小短腿：走路腿会交替迈步、二段跳不翻滚而是蹦着撒糖霜、' +
          '一停下来就掏出彩色棒棒糖',
  },

  /* ============================================================
   * ★★★ 「噜噜」：恐龙装水豚（2026-10-07 十一要求）★★★
   * ============================================================
   * 十一的要求：
   *   "挂机的时候，手上拿个橘子，挂机 5 秒没动算挂机"
   *   "走路的话要设计专属动作"
   *   "橘子拖尾，两秒消失"
   *   "二段跳要设计一个专属动作"
   *   "佛系宅水豚个性"
   *
   * ------------------------------------------------------------
   * 【人设 → 动作的推导】
   *   噜噜是**佛系宅水豚**：慢、沉、懒得动，但很可爱。
   *   所以它的动作关键词是「**慢悠悠 + 一晃一晃**」，
   *   和碧琪（蹦跳停不下来）、十一（甜甜地弹）形成鲜明对比。
   *
   * 【① 走路专属动作：箱子「不倒翁式」左右晃 + 小短腿挪步】
   *   噜噜整个身子套在恐龙纸箱里，所以走路时最像的形态是
   *   **箱子一摇一摆地往前挪**（像企鹅、像不倒翁）。
   *   ⇒ 三个参数一起做这件事：
   *     · swayAmp 调**大**（2.9）—— 左右摆得明显
   *     · bobAmp 调**小**（1.9）—— 起伏小，显"沉"
   *     · tiltSwing（新字段）—— 让**箱子整体跟着左右倾斜**
   *       （render.js 里绕脚底转，这是它独有的）
   *     · legSwing —— 箱子底下的小短腿交替挪
   *     · freqMul 0.78 —— 步子慢，符合"宅"
   *
   * 【② 二段跳专属动作：箱子弹簧 → 不翻滚，改成「猛地一弹」】
   *   spinMul: 0（不翻滚），改用 hopStyle: 'box'：
   *   箱子像弹簧一样**先缩后猛地拉长弹出去**，并甩出一圈小橘子。
   *   是个"笨重但努力"的弹跳，和尼克的利落翻滚完全不同。
   * ============================================================ */
  lulu: {
    /* 走路：晃 + 沉 + 慢 */
    bobAmp: 1.9, swayAmp: 2.9, squashAmp: 0.06, freqMul: 0.78,
    lean: 0,
    /* ★ 箱子左右倾斜（新字段，只有它开）—— 不倒翁感 */
    tiltSwing: 0.055,
    /* ★ 箱子底下的小短腿交替挪 */
    legSwing: 2.6,
    /* ★ 二段跳不翻滚 */
    spinMul: 0, spinStretch: 1.0,
    /* ★ 二段跳专属动作：箱子弹簧弹跳 */
    hopStyle: 'box',
    /* ★ 挂机 5 秒后手上拿橘子（render.js 实现） */
    idleOrange: true,
    note: '佛系宅水豚：走路箱子一晃一晃、脚步慢悠悠；' +
          '二段跳不翻滚而是像弹簧一样弹起来；挂机时掏出橘子啃',
  },
};

/** 取某个角色的动画特征（查不到 → 退回默认，绝不会 undefined） */
function motionFor(role) {
  const m = (role && ROLE_MOTION[role]) ? ROLE_MOTION[role] : null;
  if (!m) return null;
  return m;
}

/* ============================================================
 * 算出行走动作的三个分量（★ 2026-10-07 改成按角色出动画 ★）
 * ============================================================
 * @param animT    玩家累计动画时间（秒）
 * @param speed    当前水平速度（px/帧）
 * @param onGround 是否在地面
 * @param role     ★ 新增：角色 id（不传 = 用默认动画，行为同旧版）
 * @return { bob, sway, squash, phase, lean }
 *         bob    —— 向上的位移（正数 = 抬起，调用方自己去减 y）
 *         sway   —— 横向位移（正负摆动；**负值表示反相**）
 *         squash —— 挤压系数（1 附近，>1 压扁 <1 拉长）
 *         phase  —— 0~1 步态相位（给需要同步的东西用，比如尘土）
 *         lean   —— 前倾角度（弧度，0 = 不前倾）
 *
 * ⚠️ 静止（速度 < minSpeed）时全部返回"中性值"，
 *    这样玩家停下来角色就是**规规矩矩的站姿**，不会原地抖。
 * ⚠️ 不传 role 时用 WALK 的默认参数 —— **和改造前完全一致**，
 *    所以旧测试/旧调用点不会因为这次改动而变样。
 * ============================================================ */
function walkMotion(animT, speed, onGround, role) {
  const neutral = { bob: 0, sway: 0, squash: 1, phase: 0, lean: 0,
                    legSwing: 0, legPhase: 0, tiltSwing: 0 };
  if (!onGround) return neutral;                  // 空中走自己的跳跃姿态
  const sp = Math.abs(speed || 0);
  if (sp < WALK.minSpeed) return neutral;         // 站着 → 不动

  /* 取角色动画特征；没有就全用默认值（= 改造前的行为） */
  const M = motionFor(role);
  const bobAmp    = M ? M.bobAmp    : WALK.bobAmp;
  const swayAmp   = M ? M.swayAmp   : WALK.swayAmp;
  const squashAmp = M ? M.squashAmp : WALK.squashAmp;
  const freqMul   = M ? M.freqMul   : 1;
  const lean      = M ? (M.lean || 0) : 0;
  /* ★ 2026-10-07：「十一」的腿摆动幅度（只有她开，其他角色是 0） */
  const legAmp    = M ? (M.legSwing || 0) : 0;
  /* ★ 2026-10-07：「噜噜」的箱子倾斜幅度（只有它开）
   *   —— 走路时整个箱子像不倒翁一样左右晃 */
  const tiltAmp   = M ? (M.tiltSwing || 0) : 0;

  /* 频率随速度提高：走得快 → 步子迈得急。上限 1.7 倍免得快到抽搐。 */
  const freq = WALK.baseFreq * Math.min(1.7, 0.6 + sp / 3) * freqMul;
  const ph = animT * freq;

  /* ★ 腿的迈步相位：**比身体起伏快 1 倍**。
   * 为什么：身体的 bob 是"一步一顿"（|sin| 一个周期 = 两步），
   * 而腿是**左右各迈一次 = 两步** ⇒ 腿的相位应该是 bob 的 2 倍频，
   * 这样"每迈一步、身体起伏一次"才对得上。
   * ⚠️ 用 sin（不是 |sin|）—— 腿要**左右交替**（一前一后），
   *    用 |sin| 会变成"两条腿同时动"，看不出迈步。 */
  const legPh = ph * 2;

  return {
    /* 起伏：用 |sin| 而不是 sin —— 每一次落地都归零，
     * 所以看起来是"一步一顿"，而不是"上下匀速晃"。 */
    bob: Math.abs(Math.sin(ph)) * bobAmp,
    /* 摆动：用 sin，和起伏差 90 度相位，
     * 于是"抬起来的时候正好偏向一侧"，像换脚。
     * ⚠️ swayAmp 可以是**负数**（小鱼）—— 那样摆动与起伏同相，
     *    视觉上变成"蛇行/游动"，而不是"迈步"。 */
    sway: Math.sin(ph) * swayAmp,
    /* 挤压：起身时拉长（<1）、落下时压扁（>1）—— 和 bob 反相 */
    squash: 1 + (Math.abs(Math.sin(ph)) - 0.5) * 2 * squashAmp,
    phase: ph / (Math.PI * 2),
    /* 前倾：整体微微朝前（冲刺型角色的"压着跑"） */
    lean: lean,
    /* ★ 腿摆动：正值 = 当前"前腿"的方向感（render.js 用它做竖向交错） */
    legSwing: legAmp ? Math.sin(legPh) * legAmp : 0,
    legPhase: legPh,
    /* ★ 箱子倾斜（弧度）：render.js 绕脚底转，做出"不倒翁"感。
     * 用 sin(ph)（和 sway 同相）—— 重心偏左时箱子也往左歪，动作才自洽。 */
    tiltSwing: tiltAmp ? Math.sin(ph) * tiltAmp : 0,
  };
}

/* ============================================================
 * ★ 角色专属**翻滚**特征（2026-10-07 新增）★
 * ============================================================
 * 二连跳时角色会翻滚（render.js 里的 spin）。
 * 不同角色翻起来也该不一样：
 *   · spinMul     —— 翻得多快（碧琪最快 = 上了发条）
 *   · spinStretch —— 翻滚过程中身体拉伸多少（尼克最舒展）
 *   · tilt        —— 翻滚时的"歪斜感"（小鱼左右摆 = 像摆尾）
 *
 * @return { spinMul, spinStretch, tilt }
 *         查不到角色 → 中性值（完全不改变原行为）
 * ============================================================ */
function spinMotionFor(role) {
  const M = motionFor(role);
  if (!M) return { spinMul: 1, spinStretch: 1, tilt: 0, hopStyle: null };
  return {
    /* ⚠️⚠️ `spinMul: 0` 是**合法值**，表示"这个角色不翻滚"
     *    （「十一」就是这么配的：她二段跳改成"蹦一下撒糖霜"）。
     *
     *    踩过的坑：第一版这里写的是 `M.spinMul > 0 ? M.spinMul : 1`，
     *    把 0 当成"没设置"兜底成了 1 ⇒ **她照样翻滚**，
     *    "不要翻滚"的需求静默失效。
     *    ⇒ 正确的判断是"是不是**数字**"，而不是"是不是正数"。 */
    spinMul: (typeof M.spinMul === 'number' && isFinite(M.spinMul)) ? M.spinMul : 1,
    spinStretch: (typeof M.spinStretch === 'number' && M.spinStretch > 0) ? M.spinStretch : 1,
    /* 翻滚时的横向摆动：只有"游动型"（小鱼）有 —— 用 swayAmp 的符号判断 */
    tilt: (M.swayAmp < 0) ? 0.35 : 0,
    /* ★ 「十一」专属：二段跳的替代动作类型（render.js 读它走专属分支） */
    hopStyle: M.hopStyle || null,
  };
}


/* ============================================================
 * ★ 卡皮巴拉专属跳跃姿态（2026-10-06 新增）★
 * ============================================================
 * 十一的要求："要有他的独特跳跃动作。"
 *
 * ------------------------------------------------------------
 * 【为什么不能只是"跳得高一点"】
 * ------------------------------------------------------------
 *   三个角色的跳跃如果只是数值差异（跳多高、跳多远），
 *   玩家在屏幕上是**看不出来**的 —— 都只是"一个人往上飞"。
 *   要有"独特动作"，得让**起跳和空中的身体形态**不一样。
 *
 * ------------------------------------------------------------
 * 【设计思路：卡皮巴拉的"憨"就是它的辨识度】
 * ------------------------------------------------------------
 *   卡皮巴拉的人设是"淡定、慢、圆、憨"。所以它的跳跃
 *   不该是袋鼠那种干脆的弹跳，而应该是**笨拙但有力**的：
 *
 *     ① 蓄力下蹲（起跳前 0.12s）—— 先蹲下去再蹬地
 *        （这是它最像"真实水豚上岸"的一瞬）
 *     ② 蹬地时横向压扁 —— 圆身子被"挤压"再弹出去，
 *        像一颗被压扁的软糖，和袋鼠的"拉长弹射"正好相反
 *     ③ 空中抱团 —— 上升途中把身体**收圆**（压扁），
 *        像一只缩起来的毛球；下坠时才慢慢展开
 *     ④ 落地更沉 —— 落地时压得比别的角色更扁（惯性大）
 *
 *   ⇒ 一句话：**袋鼠是"拉长弹射"，卡皮巴拉是"压扁弹球"。**
 *      两个角色并排站着跳，一眼能看出不是一个人。
 *
 * ------------------------------------------------------------
 * 【技术实现：不动物理，只做"视觉姿态"】
 * ------------------------------------------------------------
 *   ⚠️ 这套东西**只改绘制**（squash / 偏移），完全不碰物理常量。
 *      为什么：物理一动就要重跑"每关 × 每角色可通关"的验证
 *      （tests/single-player-test.js 的 D 段），而且容易把
 *      关卡平衡改坏。而"独特跳跃动作"是**表现层**需求 ——
 *      在绘制层做，0 风险，也不会让某关卡变得过不去。
 *
 *   返回值和 walkMotion 同构（squash / yOff），
 *   在 render.js 里和行走 / 冲刺的姿态**相乘叠加**。
 * ============================================================ */
const CAPY_JUMP = {
  /* 蓄力下蹲的时长（秒）与压扁程度。
   * 0.12s 是"刚好看得出来"的下限 —— 再短就一闪而过，
   * 再长会让玩家觉得"跳得迟钝"（这是平台跳跃的大忌）。 */
  crouchTime: 0.12,
  crouchSquash: 1.18,     // 下蹲：横向变胖（>1 = 压扁）
  /* 蹬地瞬间：从"扁"猛地弹成"瘦"，制造爆发感 */
  launchSquash: 0.86,
  launchTime: 0.10,
  /* 空中抱团：上升时收成圆球（压扁），下坠时展开 */
  riseSquash: 1.12,
  /* 落地压得比其它角色更沉（惯性大 = 憨） */
  landSquash: 1.30,
};

/**
 * 算出卡皮巴拉本帧的"跳跃姿态"。
 *
 * @param p  玩家对象（读 vy / onGround / jumpBuffer / squash / animT）
 * @return { squash, yOff }
 *         squash —— 额外挤压系数（和 p.squash 相乘叠加）
 *         yOff   —— 额外竖向偏移（正 = 往下沉，用于蓄力下蹲）
 *
 * ⚠️ 任何异常都返回中性值（1 / 0），绝不抛异常 ——
 *    姿态是锦上添花，绝不能因为算不出来就不画角色。
 */
function capybaraJumpPose(p) {
  const neutral = { squash: 1, yOff: 0 };
  if (!p) return neutral;

  /* 蓄力下蹲：地面上、且按了跳但还没离地的那一小段 */
  if (p.onGround && p.jumpBuffer > 0) {
    return { squash: CAPY_JUMP.crouchSquash, yOff: 2 };
  }

  /* 空中姿态：按竖直速度分三段
   *   vy < 0 上升 → 抱团（压扁）
   *   vy ≈ 0 顶点 → 最圆
   *   vy > 0 下坠 → 逐渐展开（回到 1，交给通用逻辑） */
  if (!p.onGround) {
    const v = p.vy || 0;
    if (v < -0.5) {
      /* 刚离地那几帧用"蹬地弹射"（更瘦），之后转入抱团 */
      const justLaunched = Math.abs(v) > 9;
      return { squash: justLaunched ? CAPY_JUMP.launchSquash : CAPY_JUMP.riseSquash, yOff: 0 };
    }
    /* 下坠：不做额外处理，让通用 fall 拉伸接管（避免两套逻辑打架） */
    return neutral;
  }

  return neutral;
}

/* ============================================================
 * 史迪奇宝宝的专属跳跃姿态（2026-10-06）
 * ============================================================
 * 人设："626 号实验体"——六爪小怪物，爆发力爆炸、动作快、有点野。
 * 与另外三个角色的跳跃形态对比：
 *
 *   袋鼠     = 拉长弹射（敏捷、标准）
 *   卡皮巴拉 = 压扁弹球（憨、重、圆）
 *   史迪奇   = **"蹬地张牙"**（爆发、快、野）
 *
 * 三段式动作：
 *   ① 极短的下蹲（0.06s，比卡皮巴拉的 0.12s 短一半）—— 蓄力快、不拖泥带水
 *   ② 蹬地时**极度拉伸**（squash 0.78，比卡皮巴拉 0.86 更瘦更长）
 *      —— 这是全场最"瘦长"的起跳瞬间，像被橡皮筋弹出去
 *   ③ 空中快速收回（1.06，只轻微压扁）—— 不像卡皮巴拉那样缩成球，
 *      史迪奇在空中是"舒展 + 略扁"，保持攻击姿态的张力
 *
 * ⚠️ 和卡皮巴拉一样：**只改绘制，不碰物理**。
 * ============================================================ */
const STITCH_JUMP = {
  crouchTime: 0.06,       // 蓄力极短（爆发型，说跳就跳）
  crouchSquash: 1.24,     // 下蹲压得更狠
  launchSquash: 0.78,     // ★ 蹬地拉伸最狠（全场最瘦长的起跳）
  launchTime: 0.09,
  riseSquash: 1.06,       // 空中只轻微压扁（保持张力，不缩成球）
  landSquash: 1.16,       // 落地略压（比卡皮巴拉的 1.30 轻）
};

/** 算出史迪奇本帧的"跳跃姿态"（结构同 capybaraJumpPose）。
 *  ⚠️ 异常一律返回中性值，绝不抛异常。 */
function stitchJumpPose(p) {
  const neutral = { squash: 1, yOff: 0 };
  if (!p) return neutral;

  /* 蓄力下蹲：地面上、按了跳还没离地的极短一瞬 */
  if (p.onGround && p.jumpBuffer > 0) {
    return { squash: STITCH_JUMP.crouchSquash, yOff: 2 };
  }

  if (!p.onGround) {
    const v = p.vy || 0;
    if (v < -0.5) {
      /* 刚离地 → "蹬地拉伸"（最瘦）；之后转入舒展的空中姿态 */
      const justLaunched = Math.abs(v) > 9;
      return { squash: justLaunched ? STITCH_JUMP.launchSquash : STITCH_JUMP.riseSquash, yOff: 0 };
    }
    return neutral;
  }

  return neutral;
}

/* ============================================================
 * 贴图资源配置
 * ============================================================
 * 游戏同时支持两套角色表现：
 *   1. 图片贴图（assets/kangaroo.png / dragon.png）—— 优先用，更精致
 *   2. 代码画的像素网格（上面的 SPR_KANGAROO / SPR_DRAGON）—— 兜底
 * 图片加载失败（比如直接用 file:// 打开被浏览器拦了）时自动退回代码版，
 * 保证任何情况下都能玩。
 *
 * ⚠️ `facesRight` 表示"这张原图本身是否朝右"。
 *    游戏里角色统一按"朝右"为基准，朝左时整体水平镜像。
 *    所以如果某张 AI 生成的图方向是反的，只要把这里改成 false，
 *    代码会自动先把它翻正，不用去 P 图。
 * ============================================================ */

const SPRITE_IMAGES = {
  kangaroo: { img: null, ready: false, src: 'assets/kangaroo.png', facesRight: true },
  dragon:   { img: null, ready: false, src: 'assets/dragon.png',   facesRight: false },
  capybara: { img: null, ready: false, src: 'assets/capybara.png', facesRight: true },
  /* ★ 2026-10-06 新增：史迪奇宝宝（第四个角色）★
   * 贴图来自 src/assets/fanart/stitch/sprite.png 的副本（assets/stitch.png）。
   * 原图侧身朝右（facesRight: true），和袋鼠/卡皮巴拉一致。 */
  stitch:   { img: null, ready: false, src: 'assets/stitch.png',   facesRight: true },
  /* ★ 2026-10-06 新增：猴子（第五个角色）★
   * 贴图来自 src/assets/fanart/monkey/sprite.png 的副本（assets/monkey.png）。
   * 原图侧身朝右（facesRight: true），和袋鼠/卡皮巴拉/史迪奇一致。
   * 尺寸 109×128 —— 和其他角色同比例（都是 128 高）。 */
  monkey:   { img: null, ready: false, src: 'assets/monkey.png',   facesRight: true },
  /* ★ 2026-10-06 新增：小鱼 / 小狗 / 小羊（第三章配套角色）★
   * 贴图来自各自 src/assets/fanart/<role>/sprite.png 的副本。
   * 三张原图都是侧身朝右。 */
  fish:     { img: null, ready: false, src: 'assets/fish.png',     facesRight: true },
  puppy:    { img: null, ready: false, src: 'assets/puppy.png',    facesRight: true },
  lamb:     { img: null, ready: false, src: 'assets/lamb.png',     facesRight: true },
  /* ★ 2026-10-07 新增：尼克（狐狸）/ 朱迪（兔子）★
   * 贴图来自各自 src/assets/fanart/<role>/sprite.png 的副本。
   * 两张原图都是侧身朝右。 */
  nick:     { img: null, ready: false, src: 'assets/nick.png',     facesRight: true },
  judy:     { img: null, ready: false, src: 'assets/judy.png',     facesRight: true },
  /* ★ 2026-10-07 新增：碧琪（粉色小马）★
   * 贴图来自 src/assets/fanart/pinkiepie/sprite.png 的副本。
   * 原图侧身朝右。解锁方式：兑换码「十一的碧琪宝宝」。 */
  pinkiepie: { img: null, ready: false, src: 'assets/pinkiepie.png', facesRight: true },
  /* ★ 2026-10-07：「十一」（粉色史迪仔 · 甜品主题）★
   * 素材来自 fanart/pink-stitch/，是**蓝色史迪奇的图生图改色版**。
   * 解锁方式：兑换码 `11`。五项能力全满配。 */
  pinkstitch: { img: null, ready: false, src: 'assets/pink-stitch.png', facesRight: true },
  /* ★ 2026-10-07：「噜噜」（恐龙装水豚）★
   * 素材来自 fanart/lulu/sprite-pixel2.png（柔和像素版）。
   * ⚠️⚠️ **facesRight: false** —— 这张原图的头是朝**左**的
   *    （水豚鼻子、恐龙上颚、箱子开口都朝左，黄拳头在右侧）。
   *    标成 true 的话，角色向右走时会**倒着走**（踩过的坑）。
   * 解锁方式：兑换码「宁宁」。 */
  lulu: { img: null, ready: false, src: 'assets/lulu.png', facesRight: false },
};

/* 上/下两帧的贴图（可选）。留空则只用一个静态图。 */
const SPRITE_IMAGES_ALT = {};

function loadSpriteImages(onDone) {
  const slots = Object.keys(SPRITE_IMAGES).map(function (k) { return SPRITE_IMAGES[k]; });
  let pending = slots.length;
  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    if (onDone) onDone();
  }
  function done() {
    pending--;
    if (pending <= 0) finish();
  }

  if (pending === 0) { finish(); return; }

  /* ⚠️ 超时兜底：图片如果"挂住"（既不触发 onload 也不触发 onerror，
   *    比如网络极慢、连接一直 pending），整个游戏就永远不初始化 ——
   *    玩家看到的是永久白屏/卡住。
   *
   *    贴图只是"锦上添花"（加载失败会退回代码绘制的像素角色），
   *    绝不能因为它拖住整个游戏启动。所以不管图片怎么样，
   *    最多等 2.5 秒就必须放行。 */
  const timer = setTimeout(function () {
    if (!finished) {
      slots.forEach(function (slot) {
        if (!slot.ready) slot.ready = false;   // 没加载好就用代码绘制版
      });
      finish();
    }
  }, 2500);

  slots.forEach(function (slot) {
    const img = new Image();
    img.onload = function () { slot.img = img; slot.ready = true; done(); };
    img.onerror = function () { slot.ready = false; done(); };
    img.src = slot.src;
  });
}

/** 取某个角色的贴图信息（没有则返回 null，调用方走代码绘制） */
function getSpriteImage(role) {
  const slot = SPRITE_IMAGES[role];
  if (!slot || !slot.ready || !slot.img) return null;
  return slot;
}

/* ============================================================
 * ★ 装饰图（2026-10-06 新增）★
 * ============================================================
 * 和 SPRITE_IMAGES（角色贴图）的区别：
 *   · 角色贴图**必须**有（加载失败会退回代码像素画）
 *   · 装饰图是**可有可无**的（加载失败就干脆不画）
 *
 * 用途：收餐人（receiver）、外卖车（scooter）。
 * 这两个都是 AI 生成的像素图（见 skill: game-pixel-sprite-pipeline）。
 *
 * ⚠️ 为什么要单独一份、不复用 SPRITE_IMAGES：
 *    那边是按"角色 role"索引的（kangaroo/dragon/capybara），
 *    而收餐人不是可玩角色 —— 塞进去会污染角色表，
 *    以后 `charByRole('receiver')` 会拿到一个怪东西。
 * ⇒ 独立一张表，语义干净。
 *
 * ⚠️ 2026-10-07：`charger`（充电桩）已按十一要求删除。
 *    这一项**保留**是为了兼容历史引用（render 里已不画它），
 *    图片文件还在 assets/ 下 —— 以后要恢复"回电"机制时直接能用。
 * ============================================================ */
const DECOR_IMAGES = {
  receiver: { img: null, ready: false, src: 'assets/receiver.png' },
  scooter: { img: null, ready: false, src: 'assets/scooter.png' },
  charger: { img: null, ready: false, src: 'assets/charger.png' },
};

/** 加载全部装饰图。
 *  ⚠️ 和 loadSpriteImages 一样有**超时兜底** ——
 *     装饰图挂了绝不能让游戏卡在启动页。 */
function loadDecorImages(onDone) {
  const keys = Object.keys(DECOR_IMAGES);
  let pending = keys.length;
  let finished = false;
  function finish() { if (!finished) { finished = true; if (onDone) onDone(); } }
  function done() { pending--; if (pending <= 0) finish(); }
  if (pending === 0) { finish(); return; }
  const timer = setTimeout(function () {
    if (!finished) { keys.forEach(function (k) { if (!DECOR_IMAGES[k].ready) DECOR_IMAGES[k].ready = false; }); finish(); }
  }, 2500);
  keys.forEach(function (k) {
    const slot = DECOR_IMAGES[k];
    const img = new Image();
    img.onload = function () { slot.img = img; slot.ready = true; done(); };
    img.onerror = function () { slot.ready = false; done(); };
    img.src = slot.src;
  });
}

/** 取装饰图（没有 ready 就返回 null，调用方走代码绘制 / 不画） */
function getDecorImage(name) {
  const slot = DECOR_IMAGES[name];
  if (!slot || !slot.ready || !slot.img) return null;
  return slot;
}

/* ---------- 绘制函数 ---------- */

/* ============================================================
 * ★★★ 2026-10-07：像素精灵离屏缓存（性能优化，**画面零变化**）★★★
 * ============================================================
 * 【为什么必须做 —— 实测数据说话】
 *   在 iPad 尺寸的窗口里逐关测量 `render()`：
 *       第 4 关  render 均值 8.94ms，其中 `drawCoins` **6.81ms（76%）**
 *       第 17 关 render 均值 9.95ms，其中 `drawCoins` **4.45ms（45%）**
 *       第 30 关 render 均值 7.59ms，其中 `drawCoins` **3.60ms（47%）**
 *   而 `update()`（物理）只要 0.05~0.5ms —— 卡顿**全在绘制**。
 *
 * 【根因】`drawPixelSprite` 是**逐格 fillRect**：
 *   订单图标 `SPR_DELIVERY_BAG` 是 16×16 ⇒ 每个订单最多 **256 次 fillRect**。
 *   一关 40+ 个订单 ⇒ **每帧上万次 fillRect** ⇒ 6.8ms 均值 + 86ms 尖峰。
 *   （十一的原话是"平板上有点卡顿"—— 就是这里。）
 *
 * 【修法】相同「精灵 + 调色板 + 边长」只**逐格画一次**到一个离屏 canvas，
 *   之后所有同类调用改用 `drawImage` 贴图。
 *   · 40 个订单共用 1 张缓存图 ⇒ 每帧 40 次 drawImage（而不是 1 万次 fillRect）
 *   · 缓存键 = 精灵对象引用 + 调色板对象引用 + 尺寸（用 WeakMap 防内存泄漏）
 *
 * 【为什么"画面零变化"】
 *   离屏绘制用的是**和原来完全一样**的逐格 fillRect 逻辑，
 *   只是画到了另一张画布上，再整张贴过来 ⇒ 像素位置/颜色**一模一样**。
 *
 * ⚠️ 红线：**翻转（flip）和摆动的旋转不缓存** ——
 *   它们是"每次调用都不同"的变换，缓存反而更慢。只在**未翻转**时走缓存。
 * ⚠️ 尺寸变（比如 --tp-scale 改了、或订单大小随关卡变）时，
 *   缓存键里带 `size`，会自动生成新缓存 —— 不会串味。
 * ⚠️ 离屏 canvas 创建失败（极端环境）时**自动退回逐格画**，绝不崩。
 * ============================================================ */

/* 精灵 → (调色板 → (尺寸 → canvas)) 两级缓存。
 * 外层用 WeakMap：精灵对象被回收时缓存自动释放（地图重建不会泄漏）。 */
const _spriteCache = new WeakMap();

/** 取（或生成）某个精灵的离屏缓存；失败返回 null（调用方退回逐格画） */
function _getSpriteCanvas(sprite, size, pal) {
  if (!sprite || !sprite.length) return null;
  /* 只缓存"小而常用"的精灵。太大的（如角色贴图）用贴图/别的路径，
   * 缓存收益低且占内存。32×32 = 1024 格是上限。 */
  if (sprite.length > 32) return null;
  if (!(size > 0) || size > 512) return null;

  let byPal = _spriteCache.get(sprite);
  if (!byPal) { byPal = new Map(); _spriteCache.set(sprite, byPal); }
  const palKey = pal || null;
  let bySize = byPal.get(palKey);
  if (!bySize) { bySize = new Map(); byPal.set(palKey, bySize); }
  const sKey = Math.round(size * 2) / 2;          // 半像素精度，防浮点抖动刷屏
  let cv = bySize.get(sKey);
  if (cv) return cv;

  try {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const px = Math.max(1, Math.round(size));
    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(px * dpr));
    cv.height = Math.max(1, Math.ceil(px * dpr));
    const c2 = cv.getContext('2d');
    if (!c2) return null;
    c2.scale(dpr, dpr);
    c2.imageSmoothingEnabled = false;             // 像素风：别插值
    /* ⚠️ 这里**必须逐格画**（和原逻辑一字不差），否则画面会变 */
    const n = sprite.length;
    const cell = px / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const ch = sprite[y][x];
        if (!ch) continue;
        const col = pal ? pal[ch] : ch;
        if (!col) continue;
        c2.fillStyle = col;
        c2.fillRect(Math.round(x * cell), Math.round(y * cell),
                    Math.ceil(cell), Math.ceil(cell));
      }
    }
    cv.__logicalSize = px;
    cv.__dpr = dpr;
    bySize.set(sKey, cv);
    return cv;
  } catch (e) {
    return null;                                  // 任何异常都退回逐格画
  }
}

/**
 * 绘制像素角色
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<string|null>>} sprite
 * @param {number} px 目标左上角 x
 * @param {number} py 目标左上角 y
 * @param {number} size 目标边长（像素）
 * @param {boolean} flip 是否水平翻转（朝左）
 */
/**
 * 把像素网格画到 canvas 上。
 *
 * @param {Array<string>} sprite 每行一个字符串，每格一个字符
 * @param {number} px,py         左上角
 * @param {number} size          画的边长（网格按正方形算）
 * @param {boolean} flip         水平翻转
 * @param {object} [pal]         可选调色板：字符 → 颜色。
 *        不传时，网格里存的就是颜色本身（角色贴图是这种）；
 *        传了就用 pal[c] 查色（外卖袋是这种，用字符更好读）。
 */
function drawPixelSprite(ctx, sprite, px, py, size, flip, pal) {
  /* ★ 2026-10-07 性能优化：未翻转时走离屏缓存（画面完全一致）★
   * 翻转走下面的逐格路径（翻转是逐次不同的变换，缓存不划算）。 */
  if (!flip) {
    const cv = _getSpriteCanvas(sprite, size, pal);
    if (cv) {
      const L = cv.__logicalSize;
      ctx.drawImage(cv, Math.round(px), Math.round(py), L, L);
      return;
    }
  }
  const n = sprite.length;
  const cell = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = sprite[y][x];
      if (!c) continue;
      const col = pal ? pal[c] : c;
      if (!col) continue;
      ctx.fillStyle = col;
      const dx = flip ? (n - 1 - x) : x;
      ctx.fillRect(
        Math.round(px + dx * cell),
        Math.round(py + y * cell),
        Math.ceil(cell),
        Math.ceil(cell)
      );
    }
  }
}

/**
 * 绘制角色（带挤压拉伸效果 —— 超级玛丽式手感的关键）
 *
 * 优先使用图片贴图；没有图片时退回代码画的像素网格。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array|string} spriteOrRole
 *        传像素网格数组时按网格画；
 *        传 'kangaroo' / 'dragon' 字符串时优先用对应图片贴图。
 * @param {number} x 角色包围盒左上
 * @param {number} y
 * @param {number} w 包围盒宽
 * @param {number} h 包围盒高
 * @param {boolean} flip 是否水平翻转
 * @param {number} squash 挤压系数（1=正常, <1 压扁, >1 拉伸）
 */
/* ============================================================
 * drawCharacter — 画一个角色
 * ============================================================
 * @param ctx    画布
 * @param spriteOrRole  精灵网格 或 角色名
 * @param x,y,w,h       包围盒
 * @param flip          是否水平镜像（true = 朝左）
 * @param squash        挤压/拉伸（1 = 正常；<1 拉长，>1 压扁）
 * @param unused        保留位（历史遗留，别删，有调用方按位置传参）
 * @param spin          旋转角度（弧度）。二连跳空中翻滚用。
 *                      0 或不传 = 不旋转（默认，绝大多数情况）
 *
 * ⚠️ 旋转是围绕**角色中心**转的，而且旋转后仍然保持"底部对齐"语义
 *    （视觉上像是原地翻了个跟头，而不是绕着一个角甩出去）。
 * ============================================================ */
/* ============================================================
 * ★ drawCharacter（2026-10-06 加第 10 个参数 roleHint）★
 * ============================================================
 * 【十一报的 bug】"这个史迪奇宝宝跑酷内还是卡皮巴拉"
 *
 * 【根因】渲染层拿到的是 **sprite 对象**（不是 role 字符串），
 *   于是它靠"对象 === SPR_XXX"**反查** role。
 *   而 game.js 的映射里，史迪奇暂时指向了 `SPR_CAPYBARA`：
 *       else if (role === 'stitch') sprite = SPR_CAPYBARA;
 *   ⇒ 反查出来是 'capybara' → 取到卡皮巴拉的图 → **画成卡皮巴拉**。
 *
 *   更根本的问题是：**"对象反查 role"这套机制天生脆弱** ——
 *   两个角色共用同一个 sprite 对象时，就永远分不开。
 *
 * 【修法】加一个显式的 `roleHint`（第 10 个参数，可选）：
 *   调用方**知道 role 就直接传**，渲染层优先用它去查贴图
 *   （`getSpriteImage(roleHint)`），反查只作为兼容旧调用的兜底。
 *
 * ⚠️ 为什么不"给史迪奇也造一个 SPR_STITCH 常量"：
 *   那样要维护两套贴图来源（旧 SPR_ 常量 + 新 SPRITE_IMAGES atlas），
 *   而 atlas 那套才是现在的标准（电动车/充电桩/收餐人都在用）。
 *   传 role 是**让渲染层直接用标准那套**，不用再迁就旧的。
 * ============================================================ */
function drawCharacter(ctx, spriteOrRole, x, y, w, h, flip, squash, unused, spin, roleHint) {
  squash = squash || 1;
  const drawW = w / squash;
  const drawH = h * squash;
  const px = x + (w - drawW) / 2;
  const py = y + (h - drawH); // 底部对齐

  /* ---- 旋转包装：需要转的时候，先平移到中心、旋转、再画 ---- */
  const doSpin = typeof spin === 'number' && Math.abs(spin) > 0.001;
  if (doSpin) {
    ctx.save();
    // 绕角色包围盒中心旋转
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    ctx.translate(-cx, -cy);
  }

  drawCharacterBody(ctx, spriteOrRole, px, py, drawW, drawH, w, h, flip, roleHint);

  if (doSpin) ctx.restore();
}

/* 实际绘制（不含旋转）—— 从 drawCharacter 拆出来，让旋转逻辑干净 */
function drawCharacterBody(ctx, spriteOrRole, px, py, drawW, drawH, w, h, flip, roleHint) {
  // 1) 尝试用图片贴图
  /* ★ 优先用调用方给的 roleHint（2026-10-06）★
   * 为什么必须优先：史迪奇和卡皮巴拉在 sprite 对象上**分不开**
   *（game.js 里史迪奇暂时指向 SPR_CAPYBARA），
   * 只有 roleHint 才能把它们区分开。 */
  let role = null;
  if (typeof roleHint === 'string' && roleHint) role = roleHint;
  else if (typeof spriteOrRole === 'string') role = spriteOrRole;
  else if (spriteOrRole === SPR_KANGAROO) role = 'kangaroo';
  else if (spriteOrRole === SPR_DRAGON) role = 'dragon';
  else if (spriteOrRole === SPR_CAPYBARA) role = 'capybara';

  const slot = role ? getSpriteImage(role) : null;
  if (slot) {
    const img = slot.img;
    // 保持图片原始宽高比，按高度撑满包围盒，水平居中
    const ar = img.width / img.height;
    const ih = drawH;
    const iw = ih * ar;
    const ix = px + (drawW - iw) / 2;

    // 是否需要水平镜像：
    //   flip=true 表示"游戏里要朝左"。
    //   若原图本来朝右（facesRight），朝左时就要翻。
    //   若原图本来朝左（!facesRight），朝左时反而不用翻 —— 否则就画反了。
    const needMirror = (flip === true) !== (!slot.facesRight);

    ctx.save();
    if (needMirror) {
      ctx.translate(ix + iw, py);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, iw, ih);
    } else {
      ctx.drawImage(img, ix, py, iw, ih);
    }
    ctx.restore();
    return;
  }

  // 2) 退回代码画的像素网格
  /* ⚠️ 这段只在"图片贴图加载失败"时才会走到（比如 assets/ 没打包进去）。
   *    史迪奇**没有专属的代码像素画**（它只有图片），
   *    第一版这里给它借用卡皮巴拉 —— 结果表现就是
   *    "选了史迪奇，画出来是卡皮巴拉"（十一报的 bug 的第二个来源）。
   *
   *    ⇒ 现在改成：**有专属像素画的才用专属，没有的退回袋鼠**。
   *      虽然史迪奇临时长得像袋鼠也不理想，但比"长得像另一个存在的角色"好 ——
   *      后者会让玩家以为"选错角色了"，前者最多是"贴图没加载出来"。 */
  if (typeof spriteOrRole === 'string') {
    spriteOrRole = role === 'capybara' ? SPR_CAPYBARA
                 : role === 'dragon'   ? SPR_DRAGON
                 /* 其余角色（袋鼠本身 / 史迪奇 / 小鱼 / 小狗 / 小羊）
                  * 一律用袋鼠像素画兜底 —— 绝不借用**别的真实角色**。 */
                 : SPR_KANGAROO;
  }
  drawPixelSprite(ctx, spriteOrRole, px, py, Math.max(drawW, drawH), flip);
}


/* ---------- 外卖袋（收集品）----------
 * 原来这里画的是圆形金币。现在换成美团外卖袋：
 *   黄底袋身 + 黑色提手 + 袋面一条打包封条。
 * 用 16x16 像素网格定义，和角色用的是同一套渲染管线，
 * 保证风格统一（见下面的 drawPixelSprite）。
 *
 * 动画：原来是"旋转金币"。袋子转起来很怪（像被甩飞），
 * 改成轻微左右摆动（像挂着晃），更像一个挂在车把上的袋子。
 */
const SPR_DELIVERY_BAG = [
  "................",
  "................",
  ".....######.....",
  "....##....##....",
  "...##......##...",
  "...##......##...",
  "..############..",   // 袋口折边
  ".#KKKKKKKKKKKK#.",   // 袋口黑色折线
  ".#YYYYYYYYYYYY#.",   // 袋身（美团黄）
  ".#YYYYYYYYYYYY#.",
  ".#YY##YYYY##YY#.",   // 袋面一条打包封条
  ".#YY##YYYY##YY#.",
  ".#YYYYYYYYYYYY#.",
  ".#YYYYYYYYYYYY#.",
  ".#KKKKKKKKKKKK#.",   // 袋底阴影
  "..############..",
];

/* 袋子的配色表：Y=美团黄 K=黑 W=高光 */
const BAG_PAL = {
  Y: '#FFD100',   // 美团黄（主体）
  K: '#2A2A30',   // 近黑（提手 / 折线 / 袋底）
  W: '#FFF3B0',   // 高光
  '#': '#E0A800', // 描边：用深黄而不是深褐，小尺寸下更"黄"、更亮
};

/**
 * 画一个外卖袋
 * @param {number} cx,cy 中心点
 * @param {number} r     尺寸（原来金币的半径，这里当半高用）
 * @param {number} t     时间（做摆动动画）
 */
function drawCoin(ctx, cx, cy, r, t) {
  const swing = Math.sin(t * 2.2) * 0.10;       // 轻微摆动（弧度）
  const side = r * 2.15;                         // 网格边长

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(swing);
  drawPixelSprite(ctx, SPR_DELIVERY_BAG, -side / 2, -side / 2, side, false, BAG_PAL);
  ctx.restore();
}

/* ============================================================
 * 外卖主题的小图标（HUD 用）
 * 都是 8x8 或 12x12 的小像素图，画在数字前面当图标。
 * ============================================================ */

/* 小外卖袋（HUD 里标"订单"用） */
const SPR_ICON_BAG = [
  "...##...",
  "..#..#..",
  ".######.",
  ".#YYYY#.",
  ".#YKKY#.",
  ".#YYYY#.",
  ".#KKKK#.",
  ".######.",
];

/* 小头盔（标"骑手"用） */
const SPR_ICON_HELMET = [
  "..####..",
  ".######.",
  "##W##W##",
  "########",
  "##KKKK##",
  "########",
  "..####..",
  "........",
];

/* 送达定位图钉（标"送达点"用） */
const SPR_ICON_PIN = [
  "..####..",
  ".#KKKK#.",
  "#KK##KK#",
  "#K#WW#K#",
  "#KK##KK#",
  ".#KKKK#.",
  "..####..",
  "...##...",
];

const ICON_PAL = {
  Y: '#FFD100',
  K: '#2A2A30',
  W: '#FFF3B0',
  '#': '#E0A800',
};

/** 画一个外卖主题小图标。which: 'bag' | 'helmet' | 'pin' */
function drawIcon(ctx, which, x, y, size, alpha) {
  const g = which === 'helmet' ? SPR_ICON_HELMET
    : which === 'pin' ? SPR_ICON_PIN
      : SPR_ICON_BAG;
  ctx.save();
  if (alpha != null) ctx.globalAlpha = alpha;
  drawPixelSprite(ctx, g, x, y, size, false, ICON_PAL);
  ctx.restore();
}

/* ============================================================
 * ★ E1 气象播报员（2026-10-06 第 5 期）★
 * ============================================================
 * 一个一本正经的像素播报员：西装 + 领带 + 手里一张稿子。
 *
 * 【为什么用像素画而不是贴图】
 *   · 零新增美术资源（不用再画一张 PNG，不用改构建脚本的内嵌流程）
 *   · 风格和游戏里其它像素图标（头盔/袋子/图钉）完全一致
 *   · 想改颜色/造型只改这一张字符画，不用重开绘图软件
 *
 * 16×16 网格，配色见 WEATHER_CASTER_PAL：
 *   H 头发（深棕）  S 皮肤（米色）  J 西装（灰蓝）  T 领带（红）
 *   W 衬衫（白）    K 轮廓（深色）  # 稿纸（米白）  Y 麦克风（黄）
 *
 * ⚠️ 画的时候注意"缩小后能不能看清"：
 *    人物只有 16×16，五官只能靠**色块对比**（深色头发 + 米色脸），
 *    画太细的表情缩小后就是一团糊。这是 sprite-check.js 一直在守的规矩。
 * ============================================================ */
const SPR_WEATHER_CASTER = [
  '....KKKKKK......',
  '...KHHHHHHK.....',
  '..KHHHHHHHHK....',
  '..KHSSSSSSHK....',
  '..KHSSKKSSHK....',      // 眼睛（两个深色块）
  '..KHSSSSSSHK....',
  '..KHSSKKSSHK....',      // 嘴
  '..KHSSSSSSHK....',
  '...KSSSSSSK.....',
  '..KKJJJJJJKK....',      // 肩膀
  '.KJJJWTTWJJJK...',      // 衬衫 + 领带
  '.KJJJWTTWJJJKK..',
  '.KJJJWTTWJJJK#K.',      // 手里开始出现稿纸
  'KJJJJWTTWJJJK##K',
  'KJJJJJJJJJJJK##K',
  'KKKKKKKKKKKKKKKK',
];

const WEATHER_CASTER_PAL = {
  K: '#1a1a20',   // 轮廓
  H: '#4a3020',   // 头发（深棕）
  S: '#f0c8a0',   // 皮肤（米色）
  J: '#4a5a78',   // 西装（灰蓝）
  W: '#f0f0f0',   // 衬衫（白）
  T: '#c0392b',   // 领带（红）
  '#': '#efe8d0',  // 稿纸（米白）
};

/** 画气象播报员到指定画布（E1 过场用）
 * @param canvas  目标画布（会自适应尺寸，居中画） */
function drawWeatherCaster(canvas) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  const n = SPR_WEATHER_CASTER.length;
  const size = Math.min(W, H);
  const cell = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ch = SPR_WEATHER_CASTER[y][x];
      if (!ch || ch === '.') continue;
      const col = WEATHER_CASTER_PAL[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x * cell), Math.round(y * cell),
        Math.ceil(cell), Math.ceil(cell));
    }
  }
}
