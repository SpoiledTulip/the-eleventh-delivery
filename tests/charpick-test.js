/* ============================================================
 * charpick-test.js — 选骑手页"常用 4 个 + 角色库入口"验证
 * ============================================================
 * 十一的要求：
 *   "顶部默认只展示四个角色皮肤（玩家最常用的四个），
 *    其余角色不直接显示，可通过「角色库」浏览与选择。
 *    请确保默认展示的四个皮肤清晰突出、支持点击选中，
 *    且角色库入口明显易用。"
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9688, HP = 9233;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer(function (q, s) {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(SRC, p);
  if (!f.startsWith(SRC)) { s.writeHead(403); s.end(); return; }
  fs.readFile(f, function (e, d) { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
function ck(ok, msg, extra) { if (ok) { console.log('  ✅ ' + msg); PASS++; } else { console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); FAIL++; } }

(() => { })();
(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'cp-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1200,900', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(300); try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) { } }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime, Page } = c; await Runtime.enable(); await Page.enable();

  const errors = [];
  await c.on('Runtime.exceptionThrown', function (p) {
    errors.push('[异常] + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text)');
  });
  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await sleep(3500);

  console.log('======== 选骑手页 · 常用 4 个 + 角色库入口 ========');

  /* 解锁**全部已制作角色**（模拟老玩家，这样才测得出"顶部只显示前几张"）
   * ⚠️ 2026-10-06：角色数不再写死 —— 第三章加了小鱼/小狗/小羊后，
   *    从 5 个变成 9 个。这里改成**动态取全部已制作角色**。 */
  await ev(`(function(){
    Save.reset();
    Save.data.maxUnlocked = 25;
    var ids = [];
    listForLibrary().forEach(function(c){ ids.push(c.id); });
    Save.data.unlockedCharacters = ids;
    Save.save();
    return ids;
  })()`);
  const visCount = await ev('(function(){ return listVisibleChars().length; })()');
  const libCount = await ev('(function(){ return listForLibrary().length; })()');
  console.log('  已解锁角色数: ' + visCount + ' / 已制作 ' + libCount);
  ck(visCount === libCount, '环境准备好了：全部 ' + libCount + ' 个已制作角色都已解锁');

  /* 进"开始跑单"页（选骑手页） */
  await ev('gotoState(STATE.SINGLE_PICK)'); await sleep(800);

  /* ---- ① 顶部只显示固定的前几张卡（当前设计是 4 张）---- */
  const cards = await ev('(function(){ var out=[]; document.querySelectorAll(".chars .char").forEach(function(n){ out.push(n.getAttribute("data-char")); }); return out; })()');
  console.log('  页面上的角色卡: ' + JSON.stringify(cards));
  ck(cards.length === 4, '★★ 顶部**正好 4 张**角色卡（实际 ' + cards.length + '）');
  /* 把"全部可见角色"和"顶部那几张"对一下：
   * 剩下的都应该被收进角色库（数量 = 可见总数 - 顶部张数） */
  var allVis = await ev('listVisibleChars().map(function(c){ return c.id; })');
  var missing = allVis.filter(function(id){ return cards.indexOf(id) < 0; });
  ck(missing.length === allVis.length - cards.length && missing.length > 0,
    '★★ 有且只有 ' + missing.length + ' 个角色被收进角色库（' +
    JSON.stringify(missing) + '）');
  ck(new Set(cards).size === cards.length, '★ 4 张卡没有重复');

  /* ---- ② 角色库入口存在且明显 ---- */
  const libBtn = await ev(`(function(){
    var b = document.querySelector('.btn.lib-entry');
    if (!b) return null;
    var st = window.getComputedStyle(b);
    var r = b.getBoundingClientRect();
    return { text: b.textContent, w: Math.round(r.width), h: Math.round(r.height),
             borderStyle: st.borderStyle, visible: (r.width > 100 && r.height > 20) };
  })()`);
  console.log('  角色库入口: ' + (libBtn ? JSON.stringify(libBtn) : '(找不到!)'));
  ck(!!libBtn, '★★ 有「角色库」入口按钮');
  if (libBtn) {
    ck(libBtn.visible, '★★ 入口真的可见（' + libBtn.w + 'x' + libBtn.h + '）');
    ck(libBtn.borderStyle === 'dashed', '★ 用虚线框（视觉上区别于主按钮）');
    ck(/还有\s*1\s*名骑手/.test(libBtn.text) || /查看全部骑手/.test(libBtn.text),
      '★ 文案说明还有更多: 「' + libBtn.text + '」');
    ck(!/没解锁|未解锁|还差/.test(libBtn.text),
      '★★ 文案**没有**暴露未解锁角色的信息（零剧透）');
  }

  /* ---- ③ 点卡片能选中 ---- */
  const before = await ev('Save.selectedChar()');
  const clicked = await ev(`(function(){
    var cards = document.querySelectorAll('.chars .char');
    for (var i=0;i<cards.length;i++){
      if (cards[i].getAttribute('data-char') !== Save.selectedChar()) { cards[i].click(); return cards[i].getAttribute('data-char'); }
    }
    return null;
  })()`);
  await sleep(500);
  const after = await ev('Save.selectedChar()');
  const selCount = await ev('(function(){ return document.querySelectorAll(".chars .char.selected").length; })()');
  console.log('  点击卡片: ' + before + ' → ' + clicked + '（存档现在=' + after + '）');
  ck(!!clicked, '点了另一张卡');
  ck(after === clicked, '★★ 点击卡片**真的选中了**（存档已更新）');
  ck(selCount === 1, '★★ 高亮**只有一张**（不会两张同时亮）');

  /* ---- ④ 点角色库入口能跳过去 ---- */
  const jumped = await ev(`(function(){
    var b = document.querySelector('.btn.lib-entry');
    if (!b) return null;
    b.click();
    return Game.state;
  })()`);
  await sleep(700);
  const libState = await ev('Game.state');
  console.log('  点角色库入口后 state = ' + libState);
  ck(libState === 'char_library', '★★ 点入口**真的进了角色库**（state=' + libState + '）');

  const libChars = await ev('(function(){ var out=[]; document.querySelectorAll(".lib-list .lib-card").forEach(function(n){ var id=n.getAttribute("data-char"); if(id) out.push(id); }); return out; })()');
  console.log('  角色库里的角色: ' + JSON.stringify(libChars));
  ck(libChars.length >= 5, '★★ 角色库里能看到**全部 5 个**角色（' + libChars.length + '）');

  /* ---- ⑤ 新档（只有 1 个角色）不能崩 ---- */
  const fresh = await ev(`(function(){
    Save.reset();
    gotoState(STATE.MENU);
    UI.lastKey = '';
    gotoState(STATE.SINGLE_PICK);
    var cards = document.querySelectorAll('.chars .char');
    var lib = document.querySelector('.btn.lib-entry');
    return { cards: cards.length, hasLib: !!lib, libText: lib ? lib.textContent : '' };
  })()`);
  await sleep(600);
  console.log('  新档（1 个角色）: ' + JSON.stringify(fresh));
  ck(fresh.cards >= 1, '★ 新档至少显示 1 张卡（不崩）');
  ck(fresh.hasLib, '★ 新档也有角色库入口');
  ck(!/还有\s*\d+\s*名骑手/.test(fresh.libText),
    '★★ 新档**不显示**"还有 N 名骑手"（那时确实没有藏起来的）');

  /* ---- ⑥ ★ 当前选中的角色一定可见（哪怕它不在"常用 4 个"里）----
   * ------------------------------------------------------------
   * 【为什么要测这个】
   *   刚解锁新角色（比如通关第 5 关拿到猴子）时：
   *     · 玩家会立刻想试试新角色 → 系统也把 selectedCharacter 设成它
   *     · 但它的 uses = 0、也不在 recentChars 里 → **排不进常用 4 个**
   *   ⇒ 会出现"4 张卡里没一个高亮"，玩家不知道自己在用谁。
   *
   *   所以 buildCharPick 里有一段兜底：**当前选中的角色一定会出现在顶部**
   *   （需要时把最后一张卡换成它）。这一段必须守住。 */
  const selVisible = await ev(`(function(){
    Save.reset();
    Save.data.maxUnlocked = 11;
    var ids = [];
    listForLibrary().forEach(function(c){ ids.push(c.id); });
    Save.data.unlockedCharacters = ids;
    /* 造出"猴子刚解锁、还没用过、但已经选中"的状态 */
    Save.data.characterRecords = {
      kangaroo:{ uses:12, levels:{} }, dragon:{ uses:8, levels:{} },
      capybara:{ uses:3, levels:{} }, stitch:{ uses:1, levels:{} }
    };
    Save.data.recentChars = ['dragon','kangaroo'];
    Save.data.selectedCharacter = 'monkey';
    Save.save();
    Game.pickRole = null;
    gotoState(STATE.MENU); UI.lastKey = '';
    gotoState(STATE.SINGLE_PICK);
    var cards = [];
    document.querySelectorAll('.chars .char').forEach(function(n){ cards.push(n.getAttribute('data-char')); });
    var sel = document.querySelectorAll('.chars .char.selected');
    return { cards: cards, selCount: sel.length,
             selChar: sel.length ? sel[0].getAttribute('data-char') : null };
  })()`);
  await sleep(300);
  console.log('  刚解锁猴子并选中它: 卡片=' + JSON.stringify(selVisible.cards) +
    ' 高亮=' + selVisible.selChar);
  ck(selVisible.cards.length === 4, '★ 仍是 4 张卡（' + selVisible.cards.length + '）');
  ck(selVisible.cards.indexOf('monkey') >= 0,
    '★★★ **当前选中的猴子出现在了顶部**（兜底生效）');
  ck(selVisible.selCount === 1 && selVisible.selChar === 'monkey',
    '★★ 猴子被正确高亮（不会"一张都没亮"）');

  /* ---- 截图 ---- */
  await ev('(function(){ Save.reset(); Save.data.maxUnlocked=11; var ids=[]; listForLibrary().forEach(function(c){ids.push(c.id);}); Save.data.unlockedCharacters=ids; Save.save(); gotoState(STATE.SINGLE_PICK); return true; })()');
  await sleep(900);
  const { data } = await Page.captureScreenshot({ format: 'png' });
  const dir = path.join(path.resolve(__dirname, '..'), 'dist', '_mod_shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'charpick-4.png'), Buffer.from(data, 'base64'));
  console.log('  📷 dist/_mod_shots/charpick-4.png');

  console.log();
  console.log('========================================');
  console.log('  选骑手页验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');
  await c.close(); ch.kill(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
