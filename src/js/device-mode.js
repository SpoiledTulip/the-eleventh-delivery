/* ============================================================
 * device-mode.js — 设备模式（电脑 / 手机）
 * ============================================================
 * 为什么要有这个文件（设计意图，别绕开它）：
 *
 *   原来的做法是 **自动探测**：
 *       isTouchDevice() → 是触屏就造虚拟手柄
 *
 *   这在"笔记本带触摸屏"和"手机接键盘"两种情况下**全都判错**：
 *     · 触屏 Windows 笔记本 → 明明用键盘玩，屏幕上却糊了一层虚拟按键
 *     · 手机外接键盘       → 明明用键盘玩，照样糊一层
 *     · 平板横屏           → 一半屏幕被按键占掉
 *
 *   十一的原话是"检测到触摸屏就弹按键"这件事很烦。
 *   所以改成：**玩家自己选，选完记住，自动探测只用来给个默认值。**
 *
 * ★ 三条铁律（改动前先读）★
 *
 *   1. 玩家手动选择 > 一切自动判断。
 *      一旦玩家选过（DEVICE.chosen() 为 true），
 *      **任何** ontouchstart / maxTouchPoints / pointer 事件
 *      都不许再改变模式。这是本模块存在的全部理由。
 *
 *   2. 没有"未选择"这个长期状态。
 *      玩家没选过时，用"猜"的结果当临时值，但**不算已经选择**
 *      （chosen() 仍返回 false）—— 这样第一次进游戏才会弹选择页。
 *
 *   3. 模式只影响"显不显示虚拟按键 / 用哪套操作提示"，
 *      **绝不影响存档、进度、解锁**。切换模式不能丢数据。
 * ============================================================ */

/* localStorage 键名。十一在需求里点名要这个字段名，别改。 */
const DEVICE_MODE_KEY = 'delivery-game-device-mode';

const DEVICE = {
  /* 'desktop' | 'mobile' —— 当前生效的模式 */
  mode: 'desktop',

  /* 玩家是否**显式选过**。
   * false = 现在这个 mode 只是"猜"的，第一次进游戏应该弹选择页 */
  _chosen: false,

  /* ---------------- 读 ---------------- */

  /** 玩家显式选择过设备模式吗 */
  chosen: function () {
    return !!this._chosen;
  },

  /** 当前是不是手机模式 */
  isMobile: function () {
    return this.mode === 'mobile';
  },

  /** 当前是不是电脑模式 */
  isDesktop: function () {
    return this.mode !== 'mobile';
  },

  /* ---------------- 写 ---------------- */

  /**
   * 设置设备模式（玩家点选时调用）。
   * @param m  'desktop' | 'mobile'
   *
   * ⚠️ 这是**唯一**能改变模式并落盘的入口。
   *    虚拟手柄那边绝对不要再自己判断、自己改。
   */
  set: function (m) {
    const next = (m === 'mobile') ? 'mobile' : 'desktop';
    this.mode = next;
    this._chosen = true;
    this._persist();
    this._applyBodyClass();
    /* 切换模式后，立刻把可能残留的按键状态清掉。
     * 否则从手机切到电脑时，如果某一根手指正按着虚拟键，
     * 那个"按住"的状态会留在 InputState 里 —— 角色会一直往一边跑。 */
    try { TouchPad.releaseAll(); } catch (e) { /* 触屏模块不在也不影响 */ }
    try { TouchPad.syncVisibility(); } catch (e) { /* 同上 */ }
    return this.mode;
  },

  /**
   * 自动探测（只用于给"第一次进游戏"一个合理的默认值）。
   *
   * ⚠️ 探测结果**永远不会覆盖玩家的手动选择**。
   *    调用点必须自己判断 chosen()，或者直接用 DEVICE.init()。
   */
  detect: function () {
    try {
      const touch = ('ontouchstart' in window) ||
                    (navigator.maxTouchPoints > 0) ||
                    (navigator.msMaxTouchPoints > 0);
      /* 光有触屏不算 —— 触屏笔记本也有。再看屏幕尺寸和 UA：
       * 小屏 + 触屏 ≈ 手机；大屏 + 触屏 ≈ 触屏笔记本。 */
      const smallScreen = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 820;
      const ua = (navigator.userAgent || '');
      const uaMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
      /* 手机判定：UA 像手机，或者"小屏 + 能触控" */
      return (uaMobile || (touch && smallScreen)) ? 'mobile' : 'desktop';
    } catch (e) {
      return 'desktop';   // 探测出错时退回电脑模式（键盘最稳，不会锁死玩家）
    }
  },

  /**
   * 启动时调用一次：读存档里的选择；没有就用探测值当临时值。
   * @return  { chosen: bool, mode: string }
   */
  init: function () {
    let stored = null;
    try {
      if (typeof localStorage !== 'undefined') {
        stored = localStorage.getItem(DEVICE_MODE_KEY);
      }
    } catch (e) { stored = null; }

    if (stored === 'desktop' || stored === 'mobile') {
      this.mode = stored;
      this._chosen = true;
    } else {
      /* 没存过 —— 用探测值，但标记"还没选过"，
       * 这样第一次进游戏仍会弹设备选择页。 */
      this.mode = this.detect();
      this._chosen = false;
    }
    this._applyBodyClass();
    return { chosen: this._chosen, mode: this.mode };
  },

  /** 写 localStorage。失败不抛异常（无痕模式/配额满都要能玩）。 */
  _persist: function () {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(DEVICE_MODE_KEY, this.mode);
      return true;
    } catch (e) {
      /* 存不下也不影响这一局 —— 只是下次打开要重新选 */
      return false;
    }
  },

  /**
   * 把模式同步到 <body> 的 class 上，CSS 靠它决定显隐。
   *
   * 用 class 而不是直接改元素 style，有两个好处：
   *   ① CSS 里可以写更复杂的联动（比如隐藏键盘提示、缩小 HUD）
   *   ② 出问题时在开发者工具里一眼能看出当前是什么模式
   */
  _applyBodyClass: function () {
    try {
      const b = document.body;
      if (!b) return;
      b.classList.toggle('dev-mobile', this.mode === 'mobile');
      b.classList.toggle('dev-desktop', this.mode !== 'mobile');
      /* 兼容旧 class：原代码里 'touch-mode' 控制虚拟手柄显示、
       * 控制键盘提示隐藏。保留它能让老的 CSS / 测试继续работать。 */
      b.classList.toggle('touch-mode', this.mode === 'mobile');
    } catch (e) { /* body 还没建好时静默跳过，init 之后会再调一次 */ }
  },
};

/* 兜底访问器 —— 和 SAVE() / PLAYABLE_LEVELS() 一个套路。
 * device-mode.js 万一没加载成功，游戏也不该崩：
 * 返回一个"电脑模式"的替身，键盘照样能玩。 */
function DEVICE_STATE() {
  try {
    if (typeof DEVICE !== 'undefined' && DEVICE) return DEVICE;
  } catch (e) { /* 取不到就兜底 */ }
  return {
    mode: 'desktop',
    chosen: function () { return true; },   // 兜底时别再弹选择页
    isMobile: function () { return false; },
    isDesktop: function () { return true; },
    set: function () { return 'desktop'; },
  };
}
