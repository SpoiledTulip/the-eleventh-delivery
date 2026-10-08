/* ============================================================
 * audio.js — 音效合成（Web Audio API）
 * 不依赖任何音频文件，全部用振荡器实时合成，保证单文件可分发。
 * ============================================================ */

const Sound = (function () {
  let ctx = null;
  let muted = false;
  /* ★ 2026-10-06 新增：总音量（0~1）★
   * 设置页要把"音效开关"和"音量"真正接上 ——
   * 十一的要求里两者都要能调。
   * 实现方式：所有音都先乘这个系数再输出。
   * 之所以用**乘系数**而不是再插一个 GainNode：
   *   本模块每次发声都新建 osc/gain，没有常驻的 master 节点可挂，
   *   插一个反而要在 ensure() 里做更多状态管理（且 AudioContext
   *   在 ensure 之前是 null，早期调用会漏掉）。乘系数最简单可靠。 */
  let volume = 0.7;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* 音量系数：静音或音量 0 → 返回 0（等于不发声）。
   * 单独抽出来是因为 tone() 和 slide() 都要用，不能写两份。 */
  function volScale() {
    if (muted) return 0;
    return Math.max(0, Math.min(1, volume));
  }

  /**
   * 播放一个音符
   * @param {number} freq 频率
   * @param {number} dur 时长(秒)
   * @param {string} type 波形
   * @param {number} vol 音量
   * @param {number} delay 延迟(秒)
   */
  function tone(freq, dur, type, vol, delay) {
    const c = ensure();
    const vs = volScale();
    if (!c || vs <= 0) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime((vol == null ? 0.12 : vol) * vs, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /* ============================================================
   * ★ 噪声源（2026-10-06 新增，为天气音效准备的）★
   * ============================================================
   * 十一的要求："天气音效加上真实的 —— 雷声用真实的雷声采样、
   *              雨声用真实雨声。"
   *
   * 【为什么不做真采样，改用噪声合成】
   *   本文件第一行就写死了设计目标：
   *   "不依赖任何音频文件，全部用振荡器实时合成，**保证单文件可分发**"。
   *   单文件版现在是 1258 KB，加两段真实采样（雷+雨）要再多 100 KB 左右，
   *   而且音频 base64 体积膨胀比图片更狠（1 秒 ≈ 30~60 KB）。
   *   ⇒ 十一拍板：**用合成技法拟真**（包体不变）。
   *
   * 【为什么噪声比振荡器"真"】
   *   振荡器发的是**单一频率的正弦/方波** —— 听起来永远是"电子音"。
   *   而现实里的雷声/雨声/风声都是**宽频噪声**：
   *     · 雨 = 高频白噪声 + 轻微低频抖动 → 用 highpass 滤掉低频
   *     · 风 = 低频噪声 + 缓慢起伏 → 用 lowpass + 音量 LFO
   *     · 雷 = 低频噪声 + 极陡的爆炸包络 → lowpass + 快起慢落
   *   ⇒ 用噪声 + 滤波器，能做出"像真的"的质感，而且**零资源**。
   *
   * 【BufferSource vs 实时生成】
   *   这里在首次调用时生成一段 2 秒的白噪声 Buffer 并**缓存**，
   *   之后每次发声都复用它（loop = true）。
   *   好处：不用每帧算随机数，性能稳；坏处：要 2 秒 × 44100 × 4B ≈ 350KB 内存，
   *   但那是临时的 AudioBuffer，不进存档也不进包体，无所谓。
   * ============================================================ */
  let _noiseBuf = null;
  function noiseBuffer() {
    const c = ensure();
    if (!c) return null;
    if (_noiseBuf) return _noiseBuf;
    const len = Math.floor(c.sampleRate * 2);      // 2 秒
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    _noiseBuf = buf;
    return buf;
  }

  /* 播一段噪声（可滤波、可包络）
   * @param opt.filter  'lowpass' | 'highpass' | 'bandpass'
   * @param opt.freq    滤波截止频率
   * @param opt.q       滤波 Q 值（越大越"窄"）
   * @param opt.dur     时长（秒）
   * @param opt.vol     音量
   * @param opt.attack  起音时间（秒，默认 0.01）
   * @param opt.delay   延迟（秒）
   * @param opt.sweepTo 截止频率的终点（不传就固定；雷声用它做"闷到响"）
   */
  function noise(opt) {
    const c = ensure();
    const vs = volScale();
    if (!c || vs <= 0) return;
    const buf = noiseBuffer();
    if (!buf) return;

    const o = opt || {};
    const dur = o.dur || 0.5;
    const t0 = c.currentTime + (o.delay || 0);

    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    /* 滤波器（可选）—— 这是"像不像"的关键 */
    let node = src;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq || 1000, t0);
      if (o.sweepTo) {
        f.frequency.exponentialRampToValueAtTime(Math.max(o.sweepTo, 20), t0 + dur * 0.6);
      }
      if (o.q) f.Q.setValueAtTime(o.q, t0);
      src.connect(f);
      node = f;
    }

    const gain = c.createGain();
    const atk = (o.attack == null) ? 0.01 : o.attack;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime((o.vol == null ? 0.12 : o.vol) * vs, t0 + atk);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    node.connect(gain);
    gain.connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* 频率滑音（用于跳跃/受伤） */
  function slide(f1, f2, dur, type, vol) {
    const c = ensure();
    const vs = volScale();
    if (!c || vs <= 0) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t0 + dur);
    gain.gain.setValueAtTime((vol == null ? 0.12 : vol) * vs, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  return {
    unlock: function () { ensure(); },
    isMuted: function () { return muted; },
    toggleMute: function () { muted = !muted; return muted; },

    /* ---- ★ 设置页用的接口（2026-10-06 新增）★ ---- */

    /** 音效开关。等价于"静音"的反面。
     * 为什么用 enabled 而不是 muted：
     *   设置页的语义是"音效：已开启/已关闭"，
     *   直接映射到 muted 会有一个反号的转换点（容易写反）。 */
    setEnabled: function (on) { muted = !on; return !muted; },

    /** 当前是否开启音效 */
    isEnabled: function () { return !muted; },

    /** 设置总音量 0~1 */
    setVolume: function (v) {
      const n = Number(v);
      volume = isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.7;
      return volume;
    },

    /** 当前音量 */
    getVolume: function () { return volume; },

    jump: function () { slide(420, 760, 0.14, 'square', 0.10); },
    doubleJump: function () { slide(620, 1080, 0.16, 'triangle', 0.11); },

    /* ★ 卡皮巴拉专属起跳音（2026-10-06）★
     * ============================================================
     * 十一要求"要有他的独特跳跃动作"，声音也是动作的一部分 ——
     * 光有姿态没有声音，玩家还是觉得"跟别人一样"。
     *
     * 设计：卡皮巴拉是"憨、重、圆"。所以它的起跳音**比袋鼠更低、
     * 更闷、更短**，像一个软东西被压扁再弹开 ——
     *   · 起点比袋鼠低 100Hz（420 → 320）
     *   · 终点也低（760 → 560），整体音域下移 = 更"重"
     *   · 波形用 sine 而不是 square（square 更"脆"，sine 更"闷"）
     *   · 时长略短（0.11 vs 0.14）—— 下蹲到弹起很干脆
     * 加上起跳前那一声"蓄力"的下行音，就有了"先蹲后跳"的听感。 */
    capyJump: function () {
      /* 先一声短促的下行（下蹲蓄力），隔 50ms 再一声低闷的上行（蹬地弹起）。
       * ⚠️ slide() 没有 delay 参数（和 tone 不同），所以第二声用
       *    setTimeout 错开 —— 这个"一蹲再一弹"的间隔正是音效的灵魂。 */
      slide(300, 220, 0.06, 'sine', 0.09);
      setTimeout(function () { slide(320, 560, 0.11, 'sine', 0.11); }, 50);
    },
    /* 卡皮巴拉落地：比通用的更沉（惯性大） */
    capyLand: function () { tone(120, 0.09, 'sine', 0.09); },

    /* ★ 史迪奇宝宝专属音效（2026-10-06）★
     * ============================================================
     * 史迪奇是"626 号实验体"，特点是**爆发快、爪牙利、有点野**。
     * 形象定位与卡皮巴拉的"憨重"完全相反，音效也要反着来：
     *   · 起跳音**比通用更高、更尖、更短**（袋鼠是 420→760Hz，
     *     史迪奇用 560→980Hz）—— 像小怪物"嗖"地窜起
     *   · 落地音用高频短促的"啪"（tone 520Hz），不像卡皮巴拉那样闷
     * 这样四个角色的跳跃听感各不相同，闭着眼也能分辨。 */
    stitchJump: function () { slide(560, 980, 0.10, 'triangle', 0.10); },
    stitchLand: function () { tone(520, 0.05, 'square', 0.06); },
    // 弹簧：从低到高的快速滑音，像"崩"一下
    spring: function () { slide(180, 1400, 0.30, 'sine', 0.14); },
    land: function () { tone(180, 0.06, 'triangle', 0.06); },
    coin: function () {
      tone(988, 0.07, 'square', 0.10, 0);
      tone(1319, 0.12, 'square', 0.09, 0.06);
    },
    // 金币不足，站到旗子上的提示音（两声低沉的下行，表示"还不行"）
    coinShort: function () {
      tone(392, 0.10, 'triangle', 0.10, 0);
      tone(294, 0.16, 'triangle', 0.10, 0.10);
    },
    hurt: function () { slide(320, 90, 0.28, 'sawtooth', 0.14); },
    die: function () {
      tone(392, 0.12, 'square', 0.13, 0);
      tone(330, 0.12, 'square', 0.13, 0.12);
      tone(262, 0.10, 'square', 0.13, 0.24);
      tone(196, 0.30, 'square', 0.13, 0.34);
    },
    stomp: function () { slide(700, 260, 0.12, 'square', 0.12); },
    button: function () { tone(660, 0.08, 'triangle', 0.10); },

    /* 断裂桥：咯吱一声（低频抖动），提示"这块地要塌了" */
    bridge: function () {
      tone(150, 0.05, 'sawtooth', 0.08, 0);
      tone(132, 0.05, 'sawtooth', 0.08, 0.07);
      tone(118, 0.09, 'sawtooth', 0.09, 0.14);
    },
    /* 塌落：一串下行的闷响 */
    crash: function () {
      slide(220, 55, 0.42, 'sawtooth', 0.16);
      tone(72, 0.24, 'triangle', 0.13, 0.06);
    },
    /* 引信点燃：高频细碎的"滋滋"声 */
    fuse: function () {
      slide(1500, 2400, 0.20, 'square', 0.055);
      tone(1800, 0.06, 'square', 0.04, 0.16);
      tone(2100, 0.06, 'square', 0.04, 0.24);
    },
    /* 爆炸：低频轰鸣 + 噪声感（用快速下行滑音 + 叠几个低频） */
    explode: function () {
      slide(900, 45, 0.46, 'sawtooth', 0.22);
      tone(58, 0.42, 'square', 0.18, 0.02);
      tone(46, 0.52, 'triangle', 0.16, 0.08);
    },
    door: function () {
      tone(440, 0.10, 'triangle', 0.09, 0);
      tone(554, 0.10, 'triangle', 0.09, 0.08);
      tone(659, 0.18, 'triangle', 0.09, 0.16);
    },

    /* ★ 🛵 外卖车借力音效（2026-10-07 补）★
     * ============================================================
     * ⚠️ 这三个其实在 2026-10-06 的 scooter.js 里就被调用了，
     *    但 audio.js **从来没实现过** —— 因为调用点写的是
     *    `Sound.scooterOn && Sound.scooterOn()` 这种"有就调"的保护写法，
     *    缺方法时**静默跳过**，所以一直没人发现（车是无声的）。
     *    这次顺手补齐。
     *
     * 声音设计：外卖车是"电机"——比引擎更细、更高、更滑。
     *   · scooterOn：上行短滑音（"嗖"地借到力）
     *   · scooterOff：下行短滑音（力气用完，收）
     *   · charge：两声短促的高音（充电桩已删，但接口保留，
     *     方便以后要加"回电"之类的东西时有现成的声音）
     * ============================================================ */
    scooterOn: function () { slide(300, 900, 0.16, 'triangle', 0.10); },
    scooterOff: function () { slide(700, 220, 0.18, 'triangle', 0.08); },
    charge: function () {
      tone(1047, 0.07, 'sine', 0.09, 0);
      tone(1568, 0.10, 'sine', 0.08, 0.07);
    },

    checkpoint: function () {
      tone(659, 0.10, 'sine', 0.11, 0);
      tone(880, 0.16, 'sine', 0.11, 0.09);
    },
    win: function () {
      const notes = [523, 659, 784, 1047, 784, 1047, 1319];
      notes.forEach(function (f, i) { tone(f, 0.16, 'square', 0.11, i * 0.12); });
    },
    uiClick: function () { tone(520, 0.05, 'square', 0.07); },
  };
})();
