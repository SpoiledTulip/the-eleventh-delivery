/* ============================================================
 * bg-theme.js — 每关专属背景主题（2026-10-06 新增）
 * ============================================================
 * 十一的要求：
 *   "我记得每一关不同的关卡要有自己的背景呀，
 *    怎么全都是蓝天的，所以记得要更改每一关自己的背景。"
 *
 * 【现状（改之前）】
 *   全 10 关共用一套背景：蓝天渐变 + 白云 + 绿山丘（drawSky/drawClouds/drawHills）。
 *   所以从第 1 关跑到第 10 关，**背景一模一样** —— 玩到后面感觉在重复同一关。
 *
 * 【做法：主题表 + 按区域名映射】
 *   给每个区域（district）定一套配色：
 *     sky     天空渐变三色（上 / 中 / 下）
 *     far     远景层（山/建筑的浅色）
 *     near    近景层（山/建筑的深色）
 *     cloud   云/其它装饰的颜色 + 透明度
 *     ground  地面装饰的色调偏移（可选，暂时只用于雾/光感）
 *
 *   ⚠️ 为什么按 **district 名字** 而不是关卡 id：
 *     · 关卡是"数据驱动"的，加一关只改 levels.js 一张表
 *     · 用名字做 key，说明性最强（'高架环线' 一眼知道是什么色调）
 *     · 找不到名字就退回默认蓝天 —— **绝不崩**（这是硬要求）
 *
 * 【★ 独立性（项目规范）★】
 *   本模块**只被 render.js 单向读取**，删掉它 render.js 会退回原版蓝天。
 *   调用点都带 `typeof BG_THEME !== 'undefined'` 保护。
 * ============================================================ */

const BG_THEME = (function () {

  /* 默认主题 = 原来的蓝天白云绿山，**一个像素都不改**
   * （启动画面 / 找不到区域时的兜底都走这套） */
  const DEFAULT = {
    sky:    ['#5c94fc', '#8fc4ff', '#c8e4ff'],
    far:    '#7fc46b',
    near:   '#5aa34a',
    cloud:  'rgba(255,255,255,0.92)',
    /* 山的高度倍数（1 = 原始高度）—— 城市里山要矮一点、楼要多 */
    hillScale: 1,
    /* 是否画"城市剪影"（高楼）而不是山丘 */
    city: false,
    cityColor: null,
  };

  /* ============================================================
   * 主题表：key = 关卡 district 名
   * ============================================================
   * ⚠️ 加新关卡时，如果 district 不在表里 → 自动用 DEFAULT（蓝天），
   *    绝不会因为"忘了加主题"而崩或者显示空白。
   * ============================================================ */
  const THEMES = {
    /* 01 城区老巷 —— 清晨老巷：淡青天 + 瓦灰墙剪影 */
    '城区老巷': {
      sky:   ['#7ba7d4', '#a9c4e0', '#e2dcc8'],
      far:   '#9aa7b0',
      near:  '#6d7a85',
      cloud: 'rgba(255,255,255,0.62)',
      city:  true,
      cityColor: '#8b98a3',
      hillScale: 0.55,
    },

    /* 02 商家连廊 —— 正午商圈：明亮蓝天（最接近原版，温暖） */
    '商家连廊': {
      sky:   ['#4f8ff7', '#8ec0ff', '#d6ecff'],
      far:   '#8fd07a',
      near:  '#63b154',
      cloud: 'rgba(255,255,255,0.95)',
      hillScale: 0.85,
    },

    /* 03 高架环线 —— 黄昏：橙紫天 + 灰色高架剪影 */
    '高架环线': {
      sky:   ['#2f3a63', '#8a5a7a', '#e8a06a'],
      far:   '#5a4a6a',
      near:  '#3a2f4a',
      cloud: 'rgba(255,200,170,0.55)',
      city:  true,
      cityColor: '#463a56',
      hillScale: 0.4,
    },

    /* 04 断桥工地 —— 阴天工地：灰黄 + 无云 */
    '断桥工地': {
      sky:   ['#6b7078', '#9aa0a6', '#c8c2ae'],
      far:   '#8a8578',
      near:  '#5f5a50',
      cloud: 'rgba(230,230,225,0.45)',
      hillScale: 0.6,
    },

    /* 05 配送特训营 —— 室内训练场：深蓝底面 + 亮色线条感 */
    '配送特训营': {
      sky:   ['#1b2340', '#2a3557', '#3c4a75'],
      far:   '#34406b',
      near:  '#232d52',
      cloud: 'rgba(160,190,255,0.35)',
      city:  true,
      cityColor: '#2c3860',
      hillScale: 0.35,
    },

    /* 06 老城屋顶 —— 傍晚屋顶：暖橘天际线 + 屋顶剪影 */
    '老城屋顶': {
      sky:   ['#3a4f8a', '#d08a6a', '#f2c88a'],
      far:   '#7a5a5f',
      near:  '#4e3a45',
      cloud: 'rgba(255,220,190,0.5)',
      city:  true,
      cityColor: '#5d4450',
      hillScale: 0.45,
    },

    /* 07 地下车库 —— 地下：深灰蓝 + 顶灯色 + 无云 */
    '地下车库': {
      sky:   ['#14161c', '#1e222c', '#2a2f3d'],
      far:   '#2b303c',
      near:  '#1c2027',
      cloud: 'rgba(120,140,170,0.14)',
      city:  true,
      cityColor: '#262b36',
      hillScale: 0.3,
    },

    /* 08 跨江大桥 —— 江面黄昏：青蓝到暖橙的横向感 */
    '跨江大桥': {
      sky:   ['#28486e', '#6a94b8', '#e4b98c'],
      far:   '#4a6a88',
      near:  '#2f4a62',
      cloud: 'rgba(255,240,220,0.58)',
      hillScale: 0.5,
    },

    /* 09 夜市街区 —— ★ 2026-10-06 补 ★
     * ------------------------------------------------------------
     * ⚠️ 十一发现"夜市街区点进去还是蓝天白云小山" ——
     *    因为这关是后来才做的，**主题表里漏了它**，
     *    于是落回默认蓝天（兜底逻辑是对的，但我忘了加主题）。
     *
     * 夜市场景该长什么样：
     *   · 天空 = **暖橙到紫的夜色**（不是纯黑 —— 夜市有灯光散射）
     *   · 远景 = 密集的**低矮摊位/楼群剪影**（比城市矮，因为摊位矮）
     *   · 云 = 几乎没有（夜里看不清云，给一层淡淡的暖雾）
     *   · hillScale 压到 0.3（摊位是矮的）
     * ------------------------------------------------------------ */
    '夜市街区': {
      sky:   ['#1a1430', '#3d2450', '#7a4a52'],
      far:   '#3a2a44',
      near:  '#241a2e',
      cloud: 'rgba(255,190,140,0.20)',   /* 暖色薄雾，不是白云 */
      city:  true,
      cityColor: '#2e2138',
      hillScale: 0.3,
    },

    /* 备用 · 云上索道（**目前没有这关**，十一要求留着当预留）
     * ------------------------------------------------------------
     * 以后如果加「云上索道」这一关，主题直接可用，不用现调色。
     * ⚠️ 它不在任何关卡的 district 里，所以**不影响现有 10 关**
     *    （forDistrict 只在 district 命中时才返回它）。
     * ⚠️ 「每关都有专属主题」那条回归测试是按**关卡列表**遍历的，
     *    所以多出来的预留主题不会让它误报。 */
    '云上索道': {
      sky:   ['#4a86d8', '#a8cdf0', '#f0f6ff'],
      far:   '#c8dcf0',
      near:  '#9ab8d8',
      cloud: 'rgba(255,255,255,1)',
      hillScale: 0.7,
    },

    /* 10 云端天台 —— 最终 BOSS：紫粉晚霞 + 密集剪影 */
    '云端天台': {
      sky:   ['#241a3a', '#5c3a6e', '#c86a88'],
      far:   '#4a3462',
      near:  '#2d1f40',
      cloud: 'rgba(255,190,220,0.45)',
      city:  true,
      cityColor: '#3a2a52',
      hillScale: 0.4,
    },

    /* ============================================================
     * ★★ 第三章（订单 12~20）新增区域的主题（2026-10-06 补）★★
     * ============================================================
     * ⚠️ 十一反馈："有的关卡没有背景"——
     *    根因就是这个表里**没有新关卡的 district**，
     *    于是全部落回 DEFAULT（蓝天白云小山），
     *    和第 9 关当初踩的是同一个坑。
     *
     * ⇒ 规律（记住，以后再加关卡必查）：
     *    **每加一个新区域名，就必须在这里补一条主题**，
     *    否则那个区域会显示成默认蓝天 —— 不报错，但视觉上"缺背景"。
     *
     * 下面 5 条覆盖第三章新增的全部区域。
     * （`老城屋顶` / `跨江大桥` 复用已有主题，`地下车库` / `夜市街区`
     *   也是复用；只有这 5 个是真·新区域。）
     * ============================================================ */

    /* 14 物流仓库 —— 室内仓储：冷白顶灯 + 灰蓝货架剪影 */
    '物流仓库': {
      sky:   ['#2a3038', '#3c454f', '#5a6472'],
      far:   '#4a545f',
      near:  '#333b45',
      cloud: 'rgba(200,215,235,0.16)',   /* 室内没有云，给一层冷光雾 */
      city:  true,
      cityColor: '#3d4650',              /* 货架的方块感 */
      hillScale: 0.28,
    },

    /* 16 悬崖栈道 —— 高山峡谷：青灰天 + 远山剪影 */
    '悬崖栈道': {
      sky:   ['#5b7a9a', '#8fa8bd', '#cfd8dc'],
      far:   '#7a8c9c',
      near:  '#4e5c68',
      cloud: 'rgba(255,255,255,0.7)',
      hillScale: 1.3,                     /* 山最高 —— 峡谷要"高耸"感 */
    },

    /* 18 隧道暗河 —— 地下隧道：近黑 + 幽绿水光 */
    '隧道暗河': {
      sky:   ['#0d1218', '#16202a', '#22333f'],
      far:   '#1c2c36',
      near:  '#111c24',
      cloud: 'rgba(90,160,180,0.12)',     /* 水汽反光 */
      city:  true,
      cityColor: '#18262f',
      hillScale: 0.24,
    },

    /* 19 摩天楼顶 —— 高空夜景：深蓝紫 + 密集高楼灯光 */
    '摩天楼顶': {
      sky:   ['#131a35', '#26305e', '#4a4a80'],
      far:   '#2e3560',
      near:  '#1a1f3c',
      cloud: 'rgba(180,190,255,0.22)',
      city:  true,
      cityColor: '#232a52',                /* 楼群剪影，越密越像"摩天" */
      hillScale: 0.35,
    },

    /* 20 雨夜天台 —— BOSS：暴雨夜 + 紫黑天 + 城市霓虹 */
    '雨夜天台': {
      sky:   ['#0f1226', '#1e2148', '#3a3060'],
      far:   '#2a2a52',
      near:  '#181a35',
      cloud: 'rgba(150,160,220,0.30)',     /* 雨云 */
      city:  true,
      cityColor: '#22244a',
      hillScale: 0.4,
    },

    /* ============================================================
     * ★★ 同类型场景的"分段"主题（2026-10-06）★★
     * ============================================================
     * 12/13/15/17 关和 8/6/7/9 关是**同类场景但不同地段**。
     * 为了满足"每关背景各不相同"（玩到后面不觉得在重复），
     * 给它们独立的 district 名 + 独立色调：
     *   既有辨识度（一眼看出"这还是桥/车库"），又有新鲜感（时段/色调不同）。
     * ============================================================ */

    /* 12 跨江大桥·下游段 —— 清晨冷调钢桁架桥（vs 第8关的江面黄昏） */
    '跨江大桥·下游段': {
      sky:   ['#4a6a8c', '#7ea3c0', '#c2d8e4'],
      far:   '#6a8aa4',
      near:  '#42607c',
      cloud: 'rgba(230,240,250,0.6)',
      hillScale: 0.45,
    },

    /* 13 老城西区屋顶 —— 清晨灰蓝屋顶（vs 第6关的傍晚暖橘） */
    '老城西区屋顶': {
      sky:   ['#3f5a8a', '#7d9bc4', '#c8d6e4'],
      far:   '#6a7d94',
      near:  '#455670',
      cloud: 'rgba(240,246,255,0.62)',
      city:  true,
      cityColor: '#556882',
      hillScale: 0.5,
    },

    /* 15 地下车库 B3 —— 更深的负三层（vs 第7关的地下车库） */
    '地下车库 B3': {
      sky:   ['#0c0e14', '#14171f', '#1e222c'],
      far:   '#1e222b',
      near:  '#12151b',
      cloud: 'rgba(90,110,150,0.12)',
      city:  true,
      cityColor: '#1a1e27',
      hillScale: 0.26,
    },

    /* 17 夜市街区·东段 —— 偏紫的小吃街（vs 第9关的暖橙夜市） */
    '夜市街区·东段': {
      sky:   ['#1c1030', '#4a2456', '#8a4460'],
      far:   '#42264e',
      near:  '#281634',
      cloud: 'rgba(255,170,200,0.22)',
      city:  true,
      cityColor: '#34203f',
      hillScale: 0.3,
    },

    /* ============================================================
     * ★★ 第 13~20 关重构版的主题（2026-10-06）★★
     * ============================================================
     * 十一要求："13~20 关不能只修改背景颜色，每关都需要独立主题，
     *            每关背景要能从画面上一眼区分。"
     *
     * ⚠️ 两张回归测试会拦（在 single-player-browser-test.js）：
     *    · 「每关都有专属背景主题」—— 有 district 没主题就红
     *    · 「每关背景色各不相同」—— 两关共用主题就红
     *  ⇒ 所以这 8 个主题的 sky 三段色**刻意彼此拉开**，
     *    而且和旧的 20 个主题也不重复。
     * ============================================================ */

    /* 13 暴雨老城屋顶 —— 深蓝紫暴雨 + 霓虹透光（雨幕感最强） */
    '暴雨老城屋顶': {
      sky:   ['#141a2e', '#28304f', '#4a4a6e'],
      far:   '#2e3450',                    /* 雨幕中的远处高楼 */
      near:  '#1c2033',
      cloud: 'rgba(170,185,230,0.42)',     /* 厚雨云 */
      city:  true,
      cityColor: '#232844',
      hillScale: 0.38,
    },

    /* 14 冷链物流城 —— 青蓝白冷光（仓库里灯很白，很"冷"） */
    '冷链物流城': {
      sky:   ['#0f2226', '#1e3f47', '#4a7a80'],
      far:   '#2a4f57',
      near:  '#17303a',
      cloud: 'rgba(200,240,245,0.30)',     /* 冷凝白雾 */
      city:  true,
      cityColor: '#20404a',
      hillScale: 0.34,
    },

    /* 15 地下管网枢纽 —— 墨绿褐（最暗的关，只有检修灯是暖的） */
    '地下管网枢纽': {
      sky:   ['#0a0f0c', '#141d16', '#243026'],
      far:   '#1a261c',
      near:  '#0e1511',
      cloud: 'rgba(120,160,120,0.14)',     /* 湿气 */
      city:  false,                        /* 地下没有楼群剪影 */
      cityColor: null,
      hillScale: 0.5,
    },

    /* 16 跨江高架夜线 —— 靛蓝紫 + 江面反光（开阔、有水面） */
    '跨江高架夜线': {
      sky:   ['#0d1430', '#1f2a5e', '#48508e'],
      far:   '#28325e',
      near:  '#161c3c',
      cloud: 'rgba(170,190,255,0.26)',
      city:  true,
      cityColor: '#1e2650',
      hillScale: 0.24,                     /* 低矮 = 开阔的江面感 */
    },

    /* 17 夜市迷城 —— 暖橙紫（和旧夜市区分：更"深巷"、油雾更重） */
    '夜市迷城': {
      sky:   ['#1a0e22', '#3f1c3e', '#7a3a52'],
      far:   '#3a1f42',
      near:  '#22122c',
      cloud: 'rgba(255,190,140,0.30)',     /* 油烟暖雾 */
      city:  true,
      cityColor: '#2c1838',
      hillScale: 0.42,
    },

    /* 18 海底隧道·潮汐段 —— 深青蓝（唯一"水下"主题） */
    '海底隧道·潮汐段': {
      sky:   ['#041418', '#0a2c38', '#1a5568'],
      far:   '#12404e',                    /* 海床剪影 */
      near:  '#071f28',
      cloud: 'rgba(120,220,230,0.20)',     /* 水中的光斑 */
      city:  false,                        /* 水下没有城市 */
      cityColor: null,
      hillScale: 0.62,                     /* 起伏的海床 */
    },

    /* 19 电网塔·断电夜 —— 近黑 + 闪电白（最暗，只有警示红） */
    '电网塔·断电夜': {
      sky:   ['#05070d', '#0c1220', '#1a2438'],
      far:   '#121a2c',
      near:  '#080c16',
      cloud: 'rgba(190,210,255,0.18)',     /* 雷雨云 */
      city:  true,
      cityColor: '#0e1626',
      hillScale: 0.18,                     /* 极低 = 大面积黑暗 */
    },

    /* 20 暴风云端 —— 铅灰 + 闪电（终局：云层翻涌，最"高"的关） */
    '暴风云端': {
      sky:   ['#1a1d26', '#3a3f52', '#6e7488'],
      far:   '#4a5064',                    /* 云层之上的远山 */
      near:  '#262a36',
      cloud: 'rgba(240,245,255,0.50)',     /* 厚云（最强云表现） */
      city:  true,
      cityColor: '#343a4c',
      hillScale: 0.7,                      /* 云海起伏 */
    },

    /* 第四章 21~30：每关使用独立地标色调，避免又回到蓝天白云。 */
    '机场货运区': { sky:['#26364d','#61758d','#c4b58f'], far:'#596b7c', near:'#293746', cloud:'rgba(235,220,185,.32)', city:true, cityColor:'#3d4c5e', hillScale:.22 },
    '风电山谷': { sky:['#244b63','#6fa0a8','#d9e1c5'], far:'#668b88', near:'#365c5b', cloud:'rgba(225,245,232,.55)', hillScale:1.35 },
    '山地索道': { sky:['#496d9a','#a8c4dc','#f3dfb0'], far:'#88a4b8', near:'#536c80', cloud:'rgba(255,255,255,.72)', hillScale:1.55 },
    '雪山公路': { sky:['#526b83','#aab9c5','#edf1ee'], far:'#9faeb8', near:'#647785', cloud:'rgba(250,252,255,.82)', hillScale:1.8 },
    '废弃游乐园': { sky:['#171126','#3b2055','#b05b70'], far:'#3a2750', near:'#1c142b', cloud:'rgba(255,180,210,.22)', city:true, cityColor:'#2a1c3b', hillScale:.3 },
    '高层医院': { sky:['#102638','#2d6070','#99c7c5'], far:'#355b67', near:'#183b4a', cloud:'rgba(210,250,245,.28)', city:true, cityColor:'#214653', hillScale:.18 },
    '高速列车': { sky:['#10151e','#29384a','#88929a'], far:'#465466', near:'#1b2633', cloud:'rgba(190,210,225,.18)', city:true, cityColor:'#263341', hillScale:.2 },
    '洪水城区': { sky:['#0b2838','#176276','#86b6b0'], far:'#276276', near:'#103542', cloud:'rgba(170,235,225,.24)', city:true, cityColor:'#1b4855', hillScale:.4 },
    '城市核心塔': { sky:['#090b18','#24275a','#7667a8'], far:'#343866', near:'#15182f', cloud:'rgba(180,185,255,.20)', city:true, cityColor:'#202650', hillScale:.12 },
    '全城终点·黎明天空': { sky:['#1b2345','#735d88','#f0b27d'], far:'#635274', near:'#302844', cloud:'rgba(255,215,190,.42)', city:true, cityColor:'#40324f', hillScale:.5 },

    /* ============================================================
     * ★★ 补齐第三章被改名关卡的背景主题（2026-10-07）★★
     * ============================================================
     * 【背景】第三章的 13~20 关后来被**重做并改名**了
     *   （`levels-ch3.js` 会覆盖 `levels.js` 里的同名关卡），
     *    但改名后**主题表没跟着改** ⇒ 好几关落回默认蓝天，
     *    或者一大片关卡共用同一个色调（浏览器回归测试报
     *    "每关背景色各不相同"失败）。
     *
     * ⚠️ 这是"加关卡必配主题"这条规则**第三次**踩坑了
     *    （第 9 关一次、第三章一次、这次再一次）。
     *    规律：**只要 district 名变了，就必须同步改这里**。
     *
     * 配色思路：延续各自关名的意象，且互相拉开色相 ——
     *   以便"每关天空色各不相同"那条测试能过。
     * ============================================================ */

    /* 13 暴雨老城屋顶 —— 灰蓝暴雨天 + 老城屋脊剪影 */
    '暴雨老城屋顶': { sky:['#2a3444','#4a5a6e','#8b98a8'], far:'#55637a', near:'#333d4e', cloud:'rgba(180,195,215,.40)', city:true, cityColor:'#3d4858', hillScale:.5 },

    /* 15 地下管网枢纽 —— 比车库更深的负层，幽绿管壁反光 */
    '地下管网枢纽': { sky:['#0a1410','#12241c','#1e3a2c'], far:'#1c3226', near:'#0f1e17', cloud:'rgba(110,200,150,.10)', city:true, cityColor:'#172b21', hillScale:.24 },

    /* 16 跨江高架夜线 —— 夜里的高架，霓虹橙线 */
    '跨江高架夜线': { sky:['#161a2e','#2c3350','#5a4a62'], far:'#333a5c', near:'#1c2038', cloud:'rgba(255,180,140,.22)', city:true, cityColor:'#272d4a', hillScale:.36 },

    /* 18 海底隧道·潮汐段 —— 深水蓝绿，透光感 */
    '海底隧道·潮汐段': { sky:['#06222e','#0d4455','#2b7a7e'], far:'#1d5f6b', near:'#0a3038', cloud:'rgba(140,230,225,.16)', city:true, cityColor:'#124049', hillScale:.2 },

    /* 19 电网塔·断电夜 —— 近黑天际 + 电弧黄绿 */
    '电网塔·断电夜': { sky:['#0e0c1a','#232040','#4a3d5e'], far:'#2e2a4e', near:'#171429', cloud:'rgba(200,190,255,.16)', city:true, cityColor:'#252146', hillScale:.14 },
  };

  /* ---- 对外接口 ---- */

  /**
   * 取某个区域的主题。**永远返回一个合法对象**（查不到就给默认蓝天）。
   * @param {string} district 关卡区域名
   * @return {object} 主题对象（含 sky/far/near/cloud/city/...）
   */
  function forDistrict(district) {
    if (!district || typeof district !== 'string') return DEFAULT;
    const t = THEMES[district];
    if (!t) return DEFAULT;
    /* 合并兜底：就算某一项漏写，也不会出现 undefined 导致画不出来 */
    return {
      sky:    Array.isArray(t.sky) && t.sky.length >= 3 ? t.sky : DEFAULT.sky,
      far:    t.far || DEFAULT.far,
      near:   t.near || DEFAULT.near,
      cloud:  t.cloud || DEFAULT.cloud,
      city:   !!t.city,
      cityColor: t.cityColor || t.near || DEFAULT.near,
      hillScale: (typeof t.hillScale === 'number') ? t.hillScale : 1,
    };
  }

  /**
   * 取**当前正在玩的关卡**的主题。
   * 关卡还没加载（启动页 / 主菜单）时返回默认蓝天 —— 和以前完全一样。
   */
  function current() {
    try {
      const lv = (typeof Game !== 'undefined' && Game) ? Game.level : null;
      if (lv && lv.district) {
        /* ★ 2026-10-06：把 district 名字也带出去 ★
         * 为什么：render.js 需要按"这是哪一关"分派**机关外观**
         *   （云上索道 → 缆车；其他 → 原来的砖块）。
         *   主题对象本来就该知道自己是谁，之前只是没暴露。
         *   只加一个字段，不影响任何现有读取方。 */
        const t = forDistrict(lv.district);
        t.district = lv.district;
        return t;
      }
    } catch (e) { /* 拿不到就兜底 */ }
    return DEFAULT;
  }

  /* ============================================================
   * ★★★ 分层背景配置（2026-10-07 十一要求"彻底重做背景"）★★★
   * ============================================================
   * 【为什么必须重做，而不是接着调颜色】
   *   十一的原话：
   *     "当前第 13~20 关虽然配置了不同 district 和颜色，
   *      但实际画面仍然大量复用：相同的城市高楼剪影、相同的云层构图、
   *      相同的远景轮廓、相同的天空布局、相同的前景装饰。"
   *
   *   实测确认（`tools/_bgshot.js` 的配色指纹）：
   *     · 第 13 关 vs 第 20 关的天空带 RGB 距离只有 **12**（肉眼几乎分不出）
   *     · 两关的"色相段数"都只有 **2** —— 典型的"单色换皮"
   *     · 根因：`drawClouds` 的云坐标写死 7 个，
   *             `drawCitySilhouette` 固定 26 栋楼、`i*130` 等距 ⇒ 8 关画的是同一排楼
   *
   * 【做法：给每关一份"构图配方"】
   *   上面 THEMES 的 7 个颜色字段**保留不动**（向下兼容 + 启动页兜底），
   *   这里另开一张表，每关声明：
   *     layers:  { far/mid/near: { paint, ...参数 } }  ← 用哪支笔、画在哪、多密
   *     landmark: { paint, ... }                        ← 专属地标（一眼认出是哪一关）
   *     cloud:    { paint:'storm'|'none', ... }          ← 'none' = 这一关没有云
   *     live:     { ... }                                ← 与关卡事件联动的开关
   *
   *   `paint` 是 **bg-draw.js 里 painter 的名字**（字符串）。
   *   ⚠️ 用字符串而不是函数引用，是为了：
   *      删掉 bg-draw.js → 名字找不到 → 自动退回"纯配色"模式（不崩）。
   *      这是项目规范"新模块删掉能退回原版"的硬要求。
   *
   * 【十一的逐关要求都落在这里了】
   *   13 暴雨老城：远景老城区屋顶/晾衣杆/天线（不是普通高楼）+
   *                中景水箱/广告牌/旧楼 + 前景屋檐/雨帘/电线 + 地标排水塔
   *   14 冷链物流城：物流园/冷库/货运塔/高架输送管 —— 工业纵深，不是高楼剪影
   *   15 地下管网：拱顶代替天空（**不许出现云**）+ 管道/检修桥/阀门 + 地标中央水闸
   *   16 跨江高架：江面 + 对岸灯光 + 桥塔（**必须能看到跨江桥**）+ 匝道
   *   17 夜市迷城：招牌森林 + 摊位/遮棚/灯笼（**必须能看到摊位和招牌**）+ 后巷砖墙
   *   18 海底隧道：深海 + 鱼群 + 沉船 + 玻璃管（**不许出现天空云层**）
   *   19 电网塔：铁塔 + 电缆 + 停电城市（**必须能看到电网塔和电缆**）
   *   20 暴风云端：六阶段 stageVariants（见下）
   * ============================================================ */
  const LAYERS = {

    /* ---------- 13 暴雨老城屋顶 ---------- */
    '暴雨老城屋顶': {
      layers: {
        far: { paint: 'oldTownRooftops' },        // 远景+中景+近景一体（内部三层）
      },
      landmark: { paint: 'drainTower', nx: 0.60, baseY: 0.76, w: 56, h: 156 },
      cloud: { paint: 'storm', layers: 3, color: 'rgba(84,90,124,0.9)',
        y0: 0.02, y1: 0.32, density: 5, seedOffset: 301, scroll: 0.42 },
      live: { rainFrom: 'ch3', signLED: true },
      /* 天空：不做"室外大蓝天"，改成"雨幕灰蓝"（天空带被雨遮住大半） */
      skyBand: { to: 0.42 },
    },

    /* ---------- 14 冷链物流城 ---------- */
    '冷链物流城': {
      layers: {
        far: { paint: 'logisticsYard' },          // 物流园纵深（一体）
      },
      landmark: { paint: 'drainTower', nx: 0.74, baseY: 0.86, w: 40, h: 96,
        color: '#16323c', signColor: '#5ad8e8' },   // 冷库塔（复用塔形，换配色）
      cloud: { paint: 'storm', layers: 2, color: 'rgba(150,200,215,0.5)',
        y0: 0.05, y1: 0.24, density: 3, seedOffset: 302, scroll: 0.2 },
      live: { fogPulse: true },
      skyBand: { to: 0.5 },
    },

    /* ---------- 15 地下管网枢纽 ---------- */
    '地下管网枢纽': {
      layers: {
        far: { paint: 'undergroundVault' },       // 拱顶 + 检修灯 + 管道 + 检修桥
      },
      landmark: { paint: 'drainTower', nx: 0.5, baseY: 0.94, w: 130, h: 120,
        color: '#101a12', signColor: '#7ac88a' },   // 中央大型水闸
      /* ★★ 十一硬要求："第 15 关不能再出现普通室外城市天空" ⇒ 明确声明没有云 */
      cloud: { paint: 'none' },
      live: { lampChain: true },                  // 检修灯逐个亮起
      skyBand: { to: 0.30 },
    },

    /* ---------- 16 跨江高架夜线 ---------- */
    '跨江高架夜线': {
      layers: {
        far: { paint: 'riverBridge' },            // 江面 + 对岸灯光 + 主桥 + 匝道
      },
      landmark: { paint: 'drainTower', nx: 0.30, baseY: 0.62, w: 34, h: 130,
        color: '#141c3c', signColor: '#8ab0ff' },   // 桥塔补强
      cloud: { paint: 'storm', layers: 2, color: 'rgba(90,105,150,0.55)',
        y0: 0.03, y1: 0.22, density: 4, seedOffset: 304, scroll: 0.3 },
      live: { trafficGlow: true, windFlags: true },
      skyBand: { to: 0.5 },
    },

    /* ---------- 17 夜市迷城 ---------- */
    '夜市迷城': {
      layers: {
        far: { paint: 'nightMarket' },            // 居民楼窗 + 招牌森林 + 摊位 + 后巷
      },
      landmark: { paint: 'drainTower', nx: 0.22, baseY: 0.80, w: 78, h: 92,
        color: '#2a1830', signColor: '#ffb04a' },   // 夜市主入口拱门
      cloud: { paint: 'none' },                   // 夜市抬头看不见云（被招牌挡住）
      live: { awningDark: true, crowdLayer: true },
      skyBand: { to: 0.34 },
    },

    /* ---------- 18 海底隧道·潮汐段 ---------- */
    '海底隧道·潮汐段': {
      layers: {
        far: { paint: 'deepSeaTunnel' },          // 深海 + 光斑 + 沉船 + 玻璃管 + 鱼群
      },
      landmark: { paint: 'drainTower', nx: 0.86, baseY: 0.72, w: 56, h: 110,
        color: '#0e3240', signColor: '#5ae8ff' },   // 潮汐泵站
      /* ★★ 十一硬要求："不能使用普通天空、云层和城市高楼" */
      cloud: { paint: 'none' },
      live: { tideWater: true, fishSpeed: true },
      skyBand: { to: 0.28 },
    },

    /* ---------- 19 电网塔·断电夜 ---------- */
    '电网塔·断电夜': {
      layers: {
        far: { paint: 'blackoutGrid' },           // 停电城市 + 铁塔 + 电缆 + 检修平台
      },
      landmark: { paint: 'drainTower', nx: 0.68, baseY: 0.88, w: 118, h: 210,
        color: '#0a1020', signColor: '#ff4a4a' },   // 塔顶控制室
      cloud: { paint: 'storm', layers: 3, color: 'rgba(60,70,100,0.9)',
        y0: 0.02, y1: 0.28, density: 4, seedOffset: 307, scroll: 0.5 },
      live: { nodeLights: true },                 // ★ 三个供电节点 → 背景灯逐个亮
      skyBand: { to: 0.4 },
    },

    /* ============================================================
     * ★★★ 第四章 21~30 关的背景图层（2026-10-07 十一要求）★★★
     * ============================================================
     * 十一原话："请为第21到30关背景进行重新设计，因为目前它们的背景
     *          完全相同、缺乏区分度。请为这10个背景分别设计各具特色
     *          且能体现各自主题的视觉方案，确保每个背景都有明显的
     *          辨识度，同时在整个系列中保持整体风格与配色的一致性。"
     *
     * 【问题诊断】
     *   这 10 关原来**只有 `THEMES` 配色**、没有 `layers` 配方 ⇒
     *   全部走旧体系（drawSky + 写死的 7 朵云 + 固定 26 栋楼），
     *   ⇒ 每关就是"同一片渐变天空换个色"，正是"缺乏区分度"。
     *
     * 【解决】
     *   每关配一支**专属笔刷**（写在 bg-draw.js），画出该关的招牌风景：
     *     21 机场货运区 → 集装箱堆 + 货机尾翼 + 跑道灯
     *     22 风电山谷   → 山脊 + 一整排**旋转的风力机**
     *     23 山地索道   → 陡壁 + 索道塔 + **悬空缆车移动**
     *     24 雪山公路   → 雪峰 + 盘山公路 + 飘雪
     *     25 废弃游乐园 → **摩天轮缓转** + 过山车轨道 + 荒草
     *     26 高层医院   → 医疗大楼（方窗阵列 + 红十字 + 直升机坪）
     *     27 高速列车   → 高架轨道 + **掠过的列车**
     *     28 洪水城区   → **半淹的楼房** + 水面倒影 + 漂浮物
     *     29 城市核心塔 → 巨型塔楼 + 扩张的环状光环
     *     30 黎明天空   → 天台天际线 + 日出光带
     *
     * 【一致性怎么保证】
     *   · 配色**沿用原来的 `THEMES`**（不变）—— 那是整个系列的统一基调
     *   · 每关的笔刷只画**剪影/结构**，颜色从 `cfg.color` 取（= 该关主题色）
     *   · 全部用同一套工具（shade/alpha/hash01/yAnchor），风格统一
     *   ⇒ 结果是"同一个世界里的十个不同地点"，而不是十种画风。
     *
     * ⚠️ 每关的 `layers.far.paint` **必须互不相同**（测试会校验）——
     *    这也是"辨识度"的硬保证。
     *
     * ⚠️⚠️ `layers.far.color` 必须**明显深于同关的天空色**（踩过的坑）：
     *    第一版我按"主题色"给了中间调（如第 27 关给 #1e2836，
     *    而它天空顶是 #10151e）—— 结果**元素画上去看不见**，
     *    截图里就是一片均匀色块，等于白做。
     *    远景的正确做法是**深色剪影**（比天空暗一档），
     *    这样轮廓才清晰。⇒ 这一版统一把 color 压到"天空顶色再暗 20% 左右"。
     * ============================================================ */

    /* ---------- 21 机场货运区 ---------- */
    '机场货运区': {
      layers: { far: { paint: 'airportCargo', color: '#18222f' } },
      cloud: { paint: 'storm', layers: 2, color: 'rgba(190,205,225,0.42)',
        y0: 0.04, y1: 0.2, density: 3, seedOffset: 401, scroll: 0.22 },
      live: { signalLights: true },
      skyBand: { to: 0.46 },
    },

    /* ---------- 22 风电山谷 ---------- */
    '风电山谷': {
      layers: { far: { paint: 'windValley', color: '#17323a' } },
      cloud: { paint: 'storm', layers: 2, color: 'rgba(220,238,235,0.5)',
        y0: 0.03, y1: 0.18, density: 3, seedOffset: 402, scroll: 0.18 },
      live: { turbineSpin: true },
      skyBand: { to: 0.44 },
    },

    /* ---------- 23 山地索道 ---------- */
    '山地索道': {
      layers: { far: { paint: 'cableCar', color: '#2c3a54' } },
      cloud: { paint: 'storm', layers: 2, color: 'rgba(230,240,250,0.55)',
        y0: 0.02, y1: 0.22, density: 3, seedOffset: 403, scroll: 0.3 },
      live: { gondolaMove: true },
      skyBand: { to: 0.4 },
    },

    /* ---------- 24 雪山公路 ---------- */
    '雪山公路': {
      layers: { far: { paint: 'snowRoad', color: '#3a4658' } },
      cloud: { paint: 'storm', layers: 3, color: 'rgba(245,250,255,0.6)',
        y0: 0.02, y1: 0.26, density: 4, seedOffset: 404, scroll: 0.24 },
      live: { snowfall: true },
      skyBand: { to: 0.52 },
    },

    /* ---------- 25 废弃游乐园 ----------
     * ⚠️ 这一档（25~29）的天空**本来就很暗**，如果笔刷也用暗色，
     *    元素会和背景糊在一起（实测对比度只有 38~47，太低）。
     *    ⇒ 这几关的笔刷色**反过来要比天空亮**（用"被月光/灯火照到"的调子），
     *      靠**亮色轮廓**立住形体。 */
    '废弃游乐园': {
      layers: { far: { paint: 'abandonedPark', color: '#8a6a9c' } },
      /* 荒废的夜里没有云（抬头是空的天，更显冷清） */
      cloud: { paint: 'none' },
      live: { ferrisSpin: true },
      skyBand: { to: 0.36 },
    },

    /* ---------- 26 高层医院 ---------- */
    '高层医院': {
      layers: { far: { paint: 'hospitalTower', color: '#4e8aa6' } },
      cloud: { paint: 'none' },          // 楼太高，云在脚下
      live: { wardLights: true },
      skyBand: { to: 0.3 },
    },

    /* ---------- 27 高速列车 ---------- */
    '高速列车': {
      layers: { far: { paint: 'bulletTrain', color: '#4a5c78' } },
      cloud: { paint: 'storm', layers: 2, color: 'rgba(140,160,190,0.35)',
        y0: 0.02, y1: 0.16, density: 2, seedOffset: 407, scroll: 0.6 },
      live: { trainPass: true },
      skyBand: { to: 0.34 },
    },

    /* ---------- 28 洪水城区 ---------- */
    '洪水城区': {
      layers: { far: { paint: 'floodDistrict', color: '#3a7a8c' } },
      cloud: { paint: 'storm', layers: 3, color: 'rgba(90,120,140,0.65)',
        y0: 0.02, y1: 0.24, density: 4, seedOffset: 408, scroll: 0.36 },
      live: { floodWater: true },
      skyBand: { to: 0.38 },
    },

    /* ---------- 29 城市核心塔 ---------- */
    '城市核心塔': {
      layers: { far: { paint: 'coreTower', color: '#6a5acc' } },
      cloud: { paint: 'none' },
      live: { corePulse: true },
      skyBand: { to: 0.32 },
    },

    /* ---------- 30 全城终点·黎明天空 ---------- */
    '全城终点·黎明天空': {
      layers: { far: { paint: 'dawnRooftop', color: '#6a4a72' } },
      cloud: { paint: 'storm', layers: 2, color: 'rgba(255,215,185,0.45)',
        y0: 0.04, y1: 0.3, density: 3, seedOffset: 410, scroll: 0.16 },
      live: { dawnGlow: true },
      skyBand: { to: 0.58 },
    },

    /* ---------- 20 暴风云端（六阶段） ---------- */
    '暴风云端': {
      /* 默认配方（正常情况下用不到，因为 STAGE_VARIANTS 会按阶段覆盖）。
       * ⚠️⚠️ 但**不能**顺手写成 oldTownRooftops ——
       *   那会和第 13 关（暴雨老城屋顶）的图层组合完全一样，
       *   测试里"8 关图层组合互不相同"会红，而且真出问题
       *   （阶段数据缺失时）背景会退化成第 13 关的样子。
       *   ⇒ 用一个**只属于第 20 关**的组合：工地高空 + 应急站。 */
      layers: {
        far: { paint: 'craneSite' },
        near: { paint: 'emergencyStation' },
      },
      landmark: { paint: 'drainTower', nx: 0.72, baseY: 0.9, w: 42, h: 120,
        color: '#2a2e3e', signColor: '#ffd24a' },
      cloud: { paint: 'storm', layers: 3, color: 'rgba(96,102,130,0.92)',
        y0: 0.02, y1: 0.38, density: 4, seedOffset: 320, scroll: 0.55 },
      live: { stageVariants: true, chaseSpeed: true },
      skyBand: { to: 0.5 },
    },
  };

  /* ============================================================
   * ★★★ 第 20 关：六阶段背景（十一要求"必须随六个阶段改变"）★★★
   * ============================================================
   * 十一的原文要求：
   *   阶段1 暴风街区 —— 被暴风雨笼罩的城市街道、吹动的广告牌、雨幕
   *   阶段2 高楼外墙 —— 楼外立面、窗户、空调外机、清洁平台、镜头高度上升
   *   阶段3 起重机   —— 建筑工地高空、塔吊、钢梁、吊篮、未完工楼层
   *   阶段4 雷暴平台 —— 云层、云海、闪电照亮建筑顶部
   *   阶段5 终局追逐 —— 背景快速移动、风暴云/闪电/城市灯向后掠过
   *   阶段6 最终配送 —— 最高天台/城市应急站、云层散开、日出
   *
   * ⇒ 用 `stageVariants` 数组按顺序对应 6 个阶段。
   *   每个变体是一份"图层配方"，paint 名字不同 ⇒ **构图真正不同**（不是换色）。
   *   阶段判定见 `stageFor()`：读 Game.level.ch3.stages（那是关卡自己维护的阶段表）。
   * ============================================================ */
  const STAGE_VARIANTS = {
    '暴风云端': [
      /* 阶段 1 · 暴风街区 ------------------------------------------
       * 十一要求："远景是被暴风雨笼罩的城市街道。
       *           有被吹动的广告牌、路灯和雨幕。"
       *
       * ⚠️⚠️ 这里**不能**图省事复用 'oldTownRooftops'：
       *   那是第 13 关（暴雨老城屋顶）的招牌构图，
       *   两关的图层组合一模一样 ⇒ "8 关构图互不相同"直接挂，
       *   而且玩家会觉得"第 20 关开头怎么跟第 13 关长得一样"。
       *   ⇒ 用 logisticsYard 打底（工业街区感）+ riverBridge 的
       *     下层元素做"街道纵深"，是**只属于第 20 关阶段 1**的组合。
       *     （第 14 关只用 logisticsYard 单层，组合仍不同。） */
      {
        name: '暴风街区',
        layers: {
          far: { paint: 'logisticsYard' },
          near: { paint: 'riverBridge' },
        },
        landmark: { paint: 'drainTower', nx: 0.5, baseY: 0.86, w: 44, h: 100 },
        cloud: { paint: 'storm', layers: 3, color: 'rgba(96,102,130,0.92)',
          y0: 0.02, y1: 0.38, density: 4, seedOffset: 321, scroll: 0.55 },
        sky: ['#1a1d26', '#3a3f52', '#6e7488'],
        live: { debrisWarn: true, windBloom: true },
      },
      /* 阶段 2 · 高楼外墙 */
      {
        name: '高楼外墙',
        layers: {
          far: { paint: 'highriseFacade' },
        },
        landmark: { paint: 'drainTower', nx: 0.78, baseY: 0.9, w: 30, h: 140,
          color: '#2a3244', signColor: '#9ad8ff' },   // 清洁吊篮
        cloud: { paint: 'storm', layers: 2, color: 'rgba(110,120,150,0.7)',
          y0: 0.36, y1: 0.62, density: 3, seedOffset: 322, scroll: 0.35 },
        /* 云被压到下半屏 ⇒ 视觉上"镜头升到楼顶以上"（十一要的"镜头高度上升"） */
        sky: ['#202838', '#3c465e', '#6a7488'],
        live: { elevation: true },
      },
      /* 阶段 3 · 起重机与移动货台 */
      {
        name: '起重机货台',
        layers: { far: { paint: 'craneSite' } },
        landmark: { paint: 'drainTower', nx: 0.86, baseY: 0.92, w: 44, h: 88,
          color: '#3a3428', signColor: '#ffd24a' },   // 料具堆场
        cloud: { paint: 'storm', layers: 2, color: 'rgba(120,126,150,0.6)',
          y0: 0.06, y1: 0.26, density: 3, seedOffset: 323, scroll: 0.4 },
        sky: ['#252a34', '#454c5e', '#7a8092'],
        live: { parallaxBoost: true },               // 货台移动时远景视差更明显
      },
      /* 阶段 4 · 雷暴平台 */
      {
        name: '雷暴云层',
        layers: { far: { paint: 'stormSea' } },      // ★ 只有云海，没有城市
        landmark: null,
        cloud: { paint: 'storm', layers: 4, color: 'rgba(130,136,164,0.95)',
          y0: 0.30, y1: 0.92, density: 5, seedOffset: 324, scroll: 0.7 },
        sky: ['#2a2e3c', '#4e5468', '#8a90a4'],
        live: { lightningFlash: true },              // 闪电时整屏变亮
      },
      /* 阶段 5 · 终局追逐 */
      {
        name: '终局追逐',
        layers: { far: { paint: 'chaseCorridor' } },  // ★ 高速掠过的风暴云+城市灯
        landmark: null,
        cloud: { paint: 'storm', layers: 4, color: 'rgba(70,76,104,0.9)',
          y0: 0.0, y1: 0.48, density: 5, seedOffset: 325, scroll: 1.5 },  // 快
        sky: ['#12151f', '#252a3a', '#464c60'],
        live: { chaseSpeed: true, alertLights: true },
      },
      /* 阶段 6 · 最终配送 */
      {
        name: '最终配送',
        layers: { far: { paint: 'emergencyStation' } },
        landmark: null,                              // 应急站本身就是地标
        cloud: { paint: 'storm', layers: 2, color: 'rgba(200,190,190,0.4)',
          y0: 0.02, y1: 0.20, density: 2, seedOffset: 326, scroll: 0.12 },  // 云散
        sky: ['#3a3550', '#8a6a70', '#e8b084'],      // 黎明
        live: { dawn: true },
      },
    ],
  };

  /* ============================================================
   * 分层配置取用接口
   * ============================================================ */

  /**
   * 取某区域的**分层配方**。查不到返回 null（⇒ 渲染层退回旧的换色逻辑）。
   * @param {string} district
   * @param {object=} liveState 运行时状态（用于 stageVariants 选阶段）
   */
  function layersFor(district, liveState) {
    if (!district || typeof district !== 'string') return null;
    const base = LAYERS[district];
    if (!base) return null;

    /* 第 20 关：按阶段覆盖 */
    const variants = STAGE_VARIANTS[district];
    if (variants && variants.length) {
      const idx = resolveStageIndex(district, liveState);
      const v = variants[Math.max(0, Math.min(variants.length - 1, idx))];
      if (v) {
        return {
          district: district,
          stage: idx,
          stageName: v.name || '',
          stageCount: variants.length,
          layers: v.layers || base.layers,
          landmark: (v.landmark === null) ? null : (v.landmark || base.landmark),
          cloud: v.cloud || base.cloud,
          sky: v.sky || null,
          live: v.live || base.live || {},
          skyBand: v.skyBand || base.skyBand || null,
        };
      }
    }
    return {
      district: district,
      stage: -1, stageName: '', stageCount: 0,
      layers: base.layers, landmark: base.landmark,
      cloud: base.cloud, sky: null, live: base.live || {},
      skyBand: base.skyBand || null,
    };
  }

  /**
   * 第 20 关的"当前是第几阶段"。
   * ------------------------------------------------------------------
   * 【阶段从哪来】
   *   关卡数据 `ch3.stages` 是阶段表，每项有 `atX`（**像素**列宽 * 32）
   *   和 `stage`（1 起的阶段号）。玩家跑过某个 atX 就属于那个阶段。
   *   ⇒ 用"玩家 x 坐标"推导，**不需要关卡自己维护状态**，最不容易出错。
   *
   *   ⚠️ 为什么不读 CH3 的运行时状态：
   *       CH3 是物理层、背景是渲染层；让渲染层依赖物理层内部字段会把两者绑死。
   *   ⚠️ 字段名兼容：优先 `atX`，其次 `from`/`col`（列号，会 * tile 换算）。
   *   ⚠️ 兜底：拿不到玩家 / 没有 stages 数据 → 返回 0（画阶段 1）。
   * @returns {number} 阶段索引（0 起）
   */
  function resolveStageIndex(district, liveState) {
    try {
      const lv = (typeof Game !== 'undefined' && Game) ? Game.level : null;
      if (!lv) return 0;
      const stages = (lv.ch3 && lv.ch3.stages) ? lv.ch3.stages : null;
      if (!stages || !stages.length) return 0;

      /* 玩家 x：单人取 p1，双人取最靠左的（"队伍进度"以最慢的人为准） */
      let px = 0;
      try {
        const ps = (Game.players && Game.players.length) ? Game.players : null;
        if (ps) {
          px = Math.min.apply(null, ps.map(function (p) { return p.x; }));
        } else if (typeof Game.camera !== 'undefined' && Game.camera) {
          px = Game.camera.x;
        }
      } catch (e) { px = 0; }

      const TILE = (lv.tile || 32);
      let idx = 0;
      for (let i = 0; i < stages.length; i++) {
        const st = stages[i] || {};
        /* atX 已经是像素；from/col 是列号 */
        const atPx = (typeof st.atX === 'number') ? st.atX
          : (typeof st.from === 'number') ? st.from * TILE
            : (typeof st.col === 'number') ? st.col * TILE : null;
        if (atPx == null) continue;
        if (px >= atPx) idx = i;
      }
      return idx;
    } catch (e) {
      return 0;
    }
  }

  /** 这个区域有没有分层配方（给测试和渲染层判断用） */
  function hasLayers(district) {
    return !!(district && LAYERS[district]);
  }

  /** 取阶段名（给测试/调试用；第 20 关会有 6 个） */
  function stageFor(district, idx) {
    const v = STAGE_VARIANTS[district];
    if (!v) return null;
    const i = Math.max(0, Math.min(v.length - 1, idx == null ? 0 : idx));
    return v[i] ? { name: v[i].name, index: i, count: v.length } : null;
  }

  return {
    DEFAULT: DEFAULT,
    THEMES: THEMES,
    LAYERS: LAYERS,
    STAGE_VARIANTS: STAGE_VARIANTS,
    forDistrict: forDistrict,
    current: current,
    /** 调试/测试用：列出所有已定义主题的区域名 */
    keys: function () { return Object.keys(THEMES); },
    /* ★ 2026-10-07 新增：分层背景 ★ */
    layersFor: layersFor,
    hasLayers: hasLayers,
    stageFor: stageFor,
    layerKeys: function (district) {
      const L = layersFor(district);
      return L ? Object.keys(L) : [];
    },
  };
})();
