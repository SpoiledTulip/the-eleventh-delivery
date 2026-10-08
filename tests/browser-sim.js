/* ============================================================
 * browser-sim.js — 在 Node 里模拟浏览器，跑游戏主循环 + UI 层，抓运行时错误
 *
 * 它模拟了这些浏览器能力：
 *   Canvas 2D context（用 Proxy 兜住所有绘图调用）
 *   Image（故意触发 onerror，用来测"贴图加载失败"的降级路径）
 *   AudioContext（Web Audio）
 *   DOM（一个极简实现，够 ui.js 建按钮、绑事件）
 *
 * 用法：node browser-sim.js
 * ============================================================ */

const fs = require('fs');
const path = require('path');

/* ============================================================
 * ★ 路径常量（迁移后新增）★
 * ============================================================
 * 本项目结构：
 *   <项目根>/
 *     src/    ← index.html + js/ + assets/（源码）
 *     tests/  ← 本文件所在
 *     tools/  ← 构建脚本
 *     dist/   ← 单文件发布版
 *
 * 测试脚本住在 tests/ 里，要读 src/js 和 dist。
 * 下面这几个常量全部基于 __dirname 推算，
 * **不依赖当前工作目录** —— 从任何地方 node 都能跑。
 * ============================================================ */
const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const DIST = path.join(PROJ, 'dist');

const vm = require('vm');

function noop() {}

/* ---------- 极简 DOM 实现 ---------- */
function makeElement(tag) {
  const e = {
    tagName: (tag || 'div').toUpperCase(),
    className: '',
    style: {},
    children: [],
    _text: '',
    _html: '',
    _listeners: {},
    parentNode: null,
    disabled: false,
    value: '',
    placeholder: '',
    maxLength: 0,
    type: '',
    autocomplete: '',
    autocapitalize: '',
    spellcheck: false,
    width: 0,
    height: 0,
    dataset: {},
    classList: {
      _set: {},
      add: function (c) { this._set[c] = true; e.className = Object.keys(this._set).join(' '); },
      remove: function (c) { delete this._set[c]; e.className = Object.keys(this._set).join(' '); },
      contains: function (c) { return !!this._set[c]; },
    },
    _id: '',
    get id() { return this._id; },
    set id(v) {
      // 设了 id 之后要能被 getElementById 找到（ui.js 靠这个拿元素）
      this._id = v;
      if (v) ids[v] = e;
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    appendChild: function (c) { c.parentNode = e; e.children.push(c); return c; },
    removeChild: function (c) {
      const i = e.children.indexOf(c);
      if (i >= 0) e.children.splice(i, 1);
      c.parentNode = null;
      return c;
    },
    addEventListener: function (t, fn) { (e._listeners[t] = e._listeners[t] || []).push(fn); },
    removeEventListener: noop,
    setAttribute: function (k, v) { if (k === 'data-role') e.dataset.role = v; },
    getAttribute: function (k) { return k === 'data-role' ? e.dataset.role : null; },
    focus: noop, blur: noop, select: noop, click: noop,
    querySelectorAll: function (sel) {
      const out = [];
      (function walk(n) {
        n.children.forEach(function (c) {
          if (sel === '.char' && c.className.indexOf('char') >= 0) out.push(c);
          walk(c);
        });
      })(e);
      return out;
    },
    getContext: function () { return ctxProbe; },
    // 触发某个事件（测试用）
    _fire: function (type, ev) {
      (e._listeners[type] || []).forEach(function (fn) { fn(ev || { target: e, preventDefault: noop, stopPropagation: noop }); });
    },
  };
  return e;
}

const ctxProbe = new Proxy({}, {
  get: function (t, k) {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return function () { return { addColorStop: noop }; };
    }
    if (k === 'measureText') return function () { return { width: 10 }; };
    if (k === 'canvas') return { width: 1280, height: 720 };
    return noop;
  },
  set: function () { return true; },
});

/* 文档根：维护 id 索引 */
const docRoot = makeElement('body');
const ids = {};
function ensureEl(id) {
  if (!ids[id]) {
    const e = makeElement(id === 'game' ? 'canvas' : 'div');
    e.id = id;
    ids[id] = e;
    docRoot.appendChild(e);
  }
  return ids[id];
}
ensureEl('game');
ensureEl('ui');
ensureEl('net-status');

const documentStub = {
  body: docRoot,
  getElementById: function (id) { return ids[id] || null; },
  createElement: makeElement,
  addEventListener: noop,
  activeElement: null,
  execCommand: function () { return true; },
};

/* ---------- window ---------- */
const winListeners = {};
const win = {
  addEventListener: function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
  removeEventListener: noop,
  requestAnimationFrame: function () { return 0; },
  // 故意让贴图加载失败，验证降级到代码像素版
  Image: function () {
    const self = this;
    this.width = 0; this.height = 0; this.src = '';
    setTimeout(function () { if (self.onerror) self.onerror(); }, 0);
  },
  AudioContext: function () {
    return {
      state: 'running', currentTime: 0,
      createOscillator: function () {
        return { type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop };
      },
      createGain: function () {
        return { gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop };
      },
      destination: {}, resume: noop,
    };
  },
  location: { origin: 'https://example.test' },
  navigator: { clipboard: null },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: noop,
  WorkBuddyCloud: { createWorkBuddyCloud: function () { return { database: { from: function () { return {}; } } }; } },
};

const sandbox = {
  console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
  String, Number, Boolean, isNaN, parseInt, parseFloat, Proxy, Set, Map,
  window: win,
  document: documentStub,
  navigator: win.navigator,
  // 浏览器里 Image 是全局的（window.Image），沙箱里也要挂到全局
  Image: win.Image,
  performance: { now: function () { return Date.now(); } },
  requestAnimationFrame: function () { return 0; },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: function () { return 0; }, clearInterval: noop,
  localStorage: (function () {
    const s = {};
    return {
      getItem: function (k) { return s[k] === undefined ? null : s[k]; },
      setItem: function (k, v) { s[k] = String(v); },
      removeItem: function (k) { delete s[k]; },
    };
  })(),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['levels.js', 'ch3-builder.js', 'levels-ch3.js', 'sprites.js', 'audio.js', 'physics.js', 'characters.js', 'device-mode.js', 'save.js', 'net.js', 'render.js', 'game.js', 'ui.js'];
for (const f of files) {
  try {
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', f), 'utf8'), sandbox, { filename: f });
  } catch (e) {
    console.log('[X] 加载 ' + f + ' 失败: ' + e.message);
    process.exit(1);
  }
}
console.log('[v] 所有脚本加载成功');

function run(code) { return vm.runInContext(code, sandbox); }

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  [v] ' + msg);
  else { console.log('  [X] ' + msg); fails++; }
}

/* ---- 1. 初始化 ----
 * 注意：贴图加载是异步的（Image.onload/onerror），
 * 所以初始化回调要等一轮事件循环之后才会执行。
 * 这里用一个约定：把 initDone 挂到 sandbox 上，等它出现再继续测。 */
try {
  run('window.__initDone = false;');
  run('loadSpriteImages(function(){ initGame("game"); initUI(); syncUI(); window.__initDone = true; })');
} catch (e) {
  console.log('[X] 初始化崩溃: ' + e.message + '\n' + e.stack);
  process.exit(1);
}

// 等初始化回调跑完
const waitStart = Date.now();
(function waitInit() {
  if (run('window.__initDone')) {
    console.log('[v] 初始化完成（贴图加载失败 → 已降级到代码像素版）');
    afterInit();
  } else if (Date.now() - waitStart > 3000) {
    console.log('[X] 初始化超时未完成');
    process.exit(1);
  } else {
    setTimeout(waitInit, 5);
  }
})();

function afterInit() {

check(run('Game.state') === 'menu', '初始状态是菜单');

/* ---- 2. 菜单 UI 已生成 ---- */
  try {
    const ui = ids['ui'];
    check(ui.className.indexOf('on') >= 0, '菜单时 UI 浮层可见');
    check(ui.children.length > 0, '菜单面板已生成（' + ui.children.length + ' 个子元素）');

    /* ---- 3. 点「单人模式」按钮 ---- */
    const panel = ui.children[0];
    const btns = panel.children.filter(function (c) { return c.tagName === 'BUTTON'; });
    check(btns.length >= 3, '主菜单有 ' + btns.length + ' 个按钮（单人/本地双人/联机）');

    // 按钮的文字在子 span 里，写个辅助函数把所有后代文字拼起来
    function textOf(node) {
      if (node._text) return node._text;
      return node.children.map(textOf).join('');
    }

    // 点第一个包含「单人」的按钮
    let el = null;
    for (let i = 0; i < btns.length; i++) {
      if (textOf(btns[i]).indexOf('单人') >= 0) { el = btns[i]; break; }
    }
    check(!!el, '找到「单人模式」按钮');
    if (el) {
      el._fire('click');
      check(run('Game.state') === 'single_pick', '点按钮后进入选角色界面');

      // 选角色并开始。注意要精确匹配 class 里的 "char" 这个词，
      // 不能用 indexOf('char')，否则外层的 "chars" 容器也会被匹配进来。
      const ui2 = ids['ui'];
      const panel2 = ui2.children[0];
      const chars = [];
      function hasClass(node, name) {
        return String(node.className || '').split(/\s+/).indexOf(name) >= 0;
      }
      (function walk(n) { n.children.forEach(function (c) { if (hasClass(c, 'char')) chars.push(c); walk(c); }); })(panel2);
      check(chars.length === 2, '选角色界面有 2 个角色可选（实际找到 ' + chars.length + ' 个）');
      if (chars.length >= 2) {
        chars[1]._fire('click');   // 选奶龙
        check(run('Game.pickRole') === 'dragon', '点了奶龙 → pickRole = dragon');
      }
      // 点开始
      const startBtns = [];
      (function walk(n) { n.children.forEach(function (c) { if (c.tagName === 'BUTTON') startBtns.push(c); walk(c); }); })(panel2);
      const sb = startBtns.filter(function (b) { return textOf(b).indexOf('开始') >= 0; })[0];
      check(!!sb, '找到「开始游戏」按钮');
      if (sb) {
        sb._fire('click');
        check(run('Game.state') === 'playing', '点「开始游戏」→ 进入游戏');
        check(run('Game.playerCount') === 1, '单人模式 playerCount = 1');
        check(run('Game.players.length') === 1, '单人模式只生成 1 个角色');
        check(run('Game.players[0].role') === 'dragon', '生成的是所选角色（奶龙）');
      }
    }
  } catch (e) {
    console.log('[X] UI 交互测试崩溃: ' + e.message + '\n' + e.stack);
    fails++;
  }

  /* ---- 4. 单人模式跑游戏主循环 ---- */
  try {
    for (let i = 0; i < 200; i++) {
      run('InputState.now={}; InputState.now.KeyD=true; update(0.016); render(0.016); InputState.tick();');
    }
    const x = run('Game.players[0].x');
    check(x > 0, '单人模式游戏循环正常，角色已移动 x=' + Math.round(x));
    // 一路向右冲会掉进第 1 关的沟里 → 死亡也是正常结果。
    // 这里只要求状态是合法的（playing 或 gameover），不能是崩溃/未定义。
    const st = run('Game.state');
    check(st === 'playing' || st === 'gameover',
      '单人模式状态合法（' + st + '）—— 掉沟里算失败是正常的');
  } catch (e) {
    console.log('[X] 单人游戏循环崩溃: ' + e.message + '\n' + e.stack);
    fails++;
  }

  /* ---- 5. 本地双人仍然正常 ---- */
  try {
    run('Game.mode="local"; Game.playerCount=2; loadLevel(0)');
    check(run('Game.players.length') === 2, '本地双人生成 2 个角色');
    for (let i = 0; i < 100; i++) {
      run('InputState.now={}; InputState.now.ArrowRight=true; InputState.now.KeyD=true; update(0.016); render(0.016); InputState.tick();');
    }
    check(run('Game.state') === 'playing', '本地双人循环正常');
  } catch (e) {
    console.log('[X] 本地双人崩溃: ' + e.message);
    fails++;
  }

  /* ---- 6. 二连跳在游戏里生效 ---- */
  try {
    run('Game.mode="local"; Game.playerCount=2; loadLevel(0)');
    for (let i = 0; i < 60; i++) run('update(0.016); InputState.tick();');
    run('InputState.now={}; InputState.now.ArrowUp=true; update(0.016); InputState.tick();');
    const v1 = run('Game.players[0].vy');
    for (let i = 0; i < 8; i++) run('InputState.now={}; update(0.016); InputState.tick();');
    run('InputState.now={}; InputState.now.ArrowUp=true; update(0.016); InputState.tick();');
    const v2 = run('Game.players[0].vy');
    check(v1 < 0 && v2 < 0, '游戏内二连跳生效（' + v1.toFixed(1) + ' → ' + v2.toFixed(1) + '）');
  } catch (e) {
    console.log('[X] 二连跳测试崩溃: ' + e.message);
    fails++;
  }

  /* ---- 7. 暂停 / 失败 / 过关 界面能生成 ---- */
  try {
    run('Game.state="paused"; UI.lastKey=""; syncUI()');
    check(ids['ui'].children.length > 0, '暂停界面能生成');
    run('Game.state="gameover"; Game.message="测试失败"; UI.lastKey=""; syncUI()');
    check(ids['ui'].children.length > 0, '失败界面能生成');
    run('Game.state="clear"; UI.lastKey=""; syncUI()');
    check(ids['ui'].children.length > 0, '过关界面能生成');
  } catch (e) {
    console.log('[X] 界面生成崩溃: ' + e.message + '\n' + e.stack);
    fails++;
  }

  /* ---- 8. 联机输入房间码的输入框能正确过滤字符 ---- */
  try {
    run('Game.state="joining"; Game.joinCodeInput=""; UI.lastKey=""; syncUI()');
    const inp = ids['ui-code-input'];
    check(!!inp, '加入房间界面生成了输入框');
    if (inp) {
      inp.value = 'ab-c12!xyz';
      inp._fire('input', { target: inp, preventDefault: noop, stopPropagation: noop });
      check(inp.value === 'ABC12X', '输入框自动大写并过滤非法字符: "' + inp.value + '"');
      check(run('Game.joinCodeInput') === 'ABC12X', '过滤后的内容同步到 Game.joinCodeInput');
    }
  } catch (e) {
    console.log('[X] 输入框测试崩溃: ' + e.message + '\n' + e.stack);
    fails++;
  }

  /* ---- 9. 关卡选择界面 ---- */
  try {
    // 先模拟通关两关
    run('SAVE().load(); SAVE().reset();');
    run('SAVE().recordClear(0, 40, 18, 18)');
    run('SAVE().recordClear(1, 50, 7, 7)');
    check(run('SAVE().data.maxUnlocked') === 3, '通关两关 → 解锁 3 关');

    run('Game.state="level_select"; UI.lastKey=""; syncUI()');
    const uiEl = ids['ui'];
    const cards = [];
    (function walk(n) {
      n.children.forEach(function (c) {
        if (String(c.className).indexOf('lv-card') >= 0) cards.push(c);
        walk(c);
      });
    })(uiEl);

    const total = run('PLAYABLE_LEVELS().length');
    check(cards.length === total, '关卡选择界面生成了 ' + cards.length + ' 张卡片（关卡总数 ' + total + '）');

    const lockedCount = cards.filter(function (c) { return c.className.indexOf('locked') >= 0; }).length;
    check(lockedCount === total - 3, '未解锁的关卡显示为锁定（' + lockedCount + ' 张）');

    // 点已解锁的关卡 → 进入游戏
    if (cards[0]) {
      const uiBefore = String(ids['ui'].className);
      cards[0]._fire('click');
      check(run('Game.state') === 'playing', '点已解锁的关卡 → 进入游戏');
      check(run('Game.levelIndex') === 0, '进了正确的关卡（第 1 关）');
      check(run('Game.playerCount') === 1, '关卡选择走的是单人模式');
      check(run('Game.players.length') === 1, '单人模式只生成 1 个角色');

      /* ★回归测试★ 点击后浮层必须【立刻】消失，不能等定时器。
       * 踩过的坑：原来的写法只调 loadLevel()，浮层要等下一次 syncUI（最多 100ms，
       * 标签页在后台被节流时可能到 1 秒）才隐藏 —— 玩家看到卡片赖在屏幕上，
       * 以为"点不动、卡住了"。 */
      check(uiBefore.indexOf('on') >= 0, '（前置）点击前浮层是显示的');
      check(String(ids['ui'].className).indexOf('on') < 0,
        '★点击后浮层立即消失（不等 syncUI 定时器）');
      check(run('UI.panel') === null, '点击后 UI.panel 已清空');
    }

    // 点锁定关卡 → 不该有反应
    run('Game.state="level_select"; UI.lastKey=""; syncUI()');
    const cards2 = [];
    (function walk2(n) {
      n.children.forEach(function (c) {
        if (String(c.className).indexOf('lv-card') >= 0) cards2.push(c);
        walk2(c);
      });
    })(ids['ui']);
    const lockedCard = cards2.filter(function (c) { return c.className.indexOf('locked') >= 0; })[0];
    if (lockedCard) {
      lockedCard._fire('click');
      check(run('Game.state') === 'level_select', '点锁定关卡 → 没反应（仍停在选择界面）');
    }
  } catch (e) {
    console.log('[X] 关卡选择测试崩溃: ' + e.message + '\n' + e.stack);
    fails++;
  }

  /* ---- 10. 所有"开始游戏"的入口都要立即隐藏浮层 ---- */
  try {
    const entries = [
      { name: '单人开始', setup: 'Game.state="single_pick"; UI.lastKey=""; syncUI()', btnText: '开始跑单' },
      { name: '双人同屏', setup: 'Game.state="menu"; UI.lastKey=""; syncUI()', btnText: '双人同屏接单' },
    ];
    entries.forEach(function (en) {
      run(en.setup);
      // 找那个按钮
      let target = null;
      (function walk(n) {
        n.children.forEach(function (c) {
          if (c.tagName === 'BUTTON' && c.children[0] && c.children[0]._text.indexOf(en.btnText) >= 0) target = c;
          walk(c);
        });
      })(ids['ui']);
      if (!target) { check(false, '找到按钮：「' + en.btnText + '」'); return; }
      const before = String(ids['ui'].className);
      target._fire('click');
      const after = String(ids['ui'].className);
      check(before.indexOf('on') >= 0 && after.indexOf('on') < 0,
        '「' + en.name + '」点击后浮层立即消失');
      check(run('Game.state') === 'playing', '「' + en.name + '」进入了游戏');
    });
  } catch (e) {
    console.log('[X] 开始游戏入口测试崩溃: ' + e.message);
    fails++;
  }

  /* ---- 11. ★所有状态都必须能被 render 安全处理★ ----
   *
   * 踩过的坑（最惨的一次）：加关卡选择状态时，忘了在 render() 里加分支，
   * 结果 render 一路走到 drawTiles(ctx, Game.level=null)，
   * 崩在 "Cannot read properties of null (reading 'tile')"。
   * 而主循环的 requestAnimationFrame 排在 render 之后 —— 一崩就再也不调度下一帧，
   * 整个游戏彻底卡死（点什么都没反应，只能刷新）。
   *
   * 这个测试遍历【每一个】STATE，逐个调用 update+render，
   * 确保新增状态时不会再漏。 */
  try {
    const allStates = run('Object.keys(STATE).map(function(k){return STATE[k];})');
    let badStates = [];
    allStates.forEach(function (st) {
      try {
        // 每种状态都跑几帧，看会不会抛异常
        run('Game.state=' + JSON.stringify(st) + ';');
        for (let f = 0; f < 3; f++) {
          run('update(0.016); render(0.016); InputState.tick();');
        }
      } catch (e) {
        badStates.push(st + '(' + e.message + ')');
      }
    });
    check(badStates.length === 0,
      '所有 ' + allStates.length + ' 个状态都能被 update/render 安全处理' +
      (badStates.length ? '，出错：' + badStates.join(', ') : ''));
  } catch (e) {
    console.log('[X] 状态遍历测试崩溃: ' + e.message);
    fails++;
  }

  /* ---- 12. ★Game.level 为 null 时 render 不能崩★ ---- */
  try {
    run('Game.level = null; Game.state = "playing";');
    let crashed = false;
    try {
      run('update(0.016); render(0.016);');
    } catch (e) { crashed = true; }
    check(!crashed, '★Game.level 为 null 时 render 不崩（有兜底）');
    // 复位
    run('Game.state="menu"; loadLevel(0);');
  } catch (e) {
    console.log('[X] null level 测试崩溃: ' + e.message);
    fails++;
  }

  /* ---- 13. ★主循环异常不能把自己弄死★ ---- */
  try {
    /* 计数 requestAnimationFrame 被调了几次。
     * 注意：loop() 里直接用的是全局的 requestAnimationFrame（不是 window.xxx），
     * 所以这里要么替换全局，要么直接看 loop 是否把异常吞掉了。
     * 用一个更稳的判据：loop() 抛不抛异常。 */
    run('window.__origDrawTiles = drawTiles; drawTiles = function(){ throw new Error("测试用故意抛错"); };');
    let loopThrew = false;
    try {
      run('loop(16);');
    } catch (e) { loopThrew = true; }
    check(!loopThrew, '★render 抛异常时，loop() 自己不抛（异常被吞掉、循环不中断）');
    run('drawTiles = window.__origDrawTiles; loadLevel(0);');
  } catch (e) {
    console.log('[X] 主循环健壮性测试崩溃: ' + e.message);
    fails++;
  }

  console.log('\n=========================================');
  console.log(fails === 0 ? '运行时检查全部通过 ✓' : (fails + ' 项失败 ✗'));
  process.exit(fails === 0 ? 0 : 1);
}
