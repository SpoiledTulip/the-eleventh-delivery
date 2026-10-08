/* ============================================================
 * account-test.js — 本机账号系统 · 真浏览器验证（2026-10-06）
 * ============================================================
 * 验证十一真正会看到的流程：
 *   ① 首次打开（新浏览器）→ 点「开始跑单」→ **自动弹出创建账号页**
 *   ② 输昵称+密码 → 创建成功 → 进游戏
 *   ③ 设置页能看到「当前账号：XXX / 已登录」
 *   ④ 退出登录 → 回到未登录状态 → 未登录时点开始被拦
 *   ⑤ 再登录要输密码，错密码进不去
 *   ⑥ 两个账号各玩各的（**最关键的隔离验证**）
 *   ⑦ 昵称重复被拦
 *
 * ⚠️ 用真浏览器（不是 jsdom）的原因：这里验证的是**界面真的长出来、
 *    点得到、文字对**，纯逻辑测试测不到"按钮有没有渲染出来"这类问题
 *    （项目里踩过：元素建了但没挂到面板上，不报错、就是看不见）。
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9688, HP = 9233;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

const server = http.createServer(function (q, s) {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(SRC, p);
  if (!f.startsWith(SRC)) { s.writeHead(403); s.end(); return; }
  fs.readFile(f, function (e, d) {
    if (e) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    s.end(d);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
function ck(ok, msg, extra) {
  if (ok) { console.log('  ✅ ' + msg); PASS++; }
  else { console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); FAIL++; }
}

(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'acc-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
    '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1200,860',
    'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) { }
  }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime, Page, Input } = c; await Runtime.enable(); await Page.enable();

  const errors = [];
  await c.on('Runtime.exceptionThrown', function (p) {
    errors.push(((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text || '').split('\n')[0]);
  });

  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const j = async e => JSON.parse(await ev('JSON.stringify(' + e + ')'));

  /* 按文字点按钮 */
  const clickByText = async txt => {
    const ok = await ev(`(function(){
      var b=document.querySelectorAll('button');
      for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf(${JSON.stringify(txt)})>=0){ b[i].click(); return true; } }
      return false;
    })()`);
    await sleep(500);
    return ok;
  };
  const setInput = async (sel, val) => {
    return ev(`(function(){
      var i = document.querySelector(${JSON.stringify(sel)});
      if (!i) return false;
      i.value = ${JSON.stringify(val)};
      i.dispatchEvent(new Event('input', {bubbles:true}));
      return true;
    })()`);
  };
  const pageText = async () => await ev('(function(){ return UI.root ? UI.root.innerText : ""; })()');
  const pageHtml = async () => await ev('(function(){ return UI.root ? UI.root.innerHTML : ""; })()');

  await sleep(3200);

  console.log('======== 本机账号系统 · 真浏览器验证 ========');

  /* ---------- 0. 清干净，模拟"第一次打开游戏" ---------- */
  await ev('(function(){ try{ localStorage.clear(); }catch(e){} return true; })()');
  await ev('(function(){ Save.load(); Account_reset_noop=1; return true; })()').catch(() => { });
  await sleep(200);
  /* 重新注册一个空世界：清 localStorage 后重载页面最干净 */
  await Page.reload({ ignoreCache: true });
  await sleep(3200);

  const init = await j('({ accounts: ACCOUNT.count(), logged: ACCOUNT.isLoggedIn() })');
  ck(init.accounts === 0, '★ 全新浏览器：0 个账号');
  ck(init.logged === false, '★ 全新浏览器：未登录状态');

  /* ---------- 1. 首次点「开始跑单」→ 自动弹创建账号页 ---------- */
  await ev('gotoState(STATE.MENU)'); await sleep(400);
  ck(await clickByText('开始跑单'), '点「开始跑单」');
  const st1 = await ev('Game.state');
  ck(st1 === 'account_welcome', '★★★ 自动跳到了**创建账号页**（state=' + st1 + '）');

  const t1 = await pageText();
  ck(/起个名字|昵称/.test(t1), '页面上有"起个名字/昵称"的引导（' + t1.slice(0, 30).replace(/\n/g, ' ') + '）');

  /* ---------- 2. 创建账号 ---------- */
  const hasName = await setInput('.acc-input', '十一');
  ck(hasName, '找到了昵称输入框');
  const inputs = await ev('(function(){ return document.querySelectorAll(".acc-input").length; })()');
  ck(inputs === 3, '有 3 个输入框（昵称 + 密码 + 再输一次），实际 ' + inputs);

  /* ★★★ 输入框的 maxLength 必须是正数（2026-10-06 修的真 bug）★★★
   * ------------------------------------------------------------
   * 【十一报的 bug】"那个密码框里面不显示字，就是输不进去字"
   *
   * 【根因】我给输入框设 `maxLength = ACCOUNT._internals.PASS_MAX`，
   *   而 `_internals` 里**恰好漏了 PASS_MAX** → 赋值是 `undefined`
   *   → 浏览器把 maxLength 当 **0** → **一个字都打不进去**。
   *
   *   这个 bug 极其隐蔽：不报错、界面正常、看着就是个普通输入框。
   *
   * ⇒ 这条断言守着"**输入框必须真的能输入**"这件事本身。
   *   比单独断言某个数值更稳 —— 以后不管因为什么原因，
   *   只要有输入框变成了"打不进字"，这里就会红。
   * ------------------------------------------------------------ */
  const maxLens = JSON.parse(await ev(`(function(){
    var ins = document.querySelectorAll('.acc-input');
    var out = [];
    for (var i=0;i<ins.length;i++) out.push({ i:i, type:ins[i].type, maxLength:ins[i].maxLength });
    return JSON.stringify(out);
  })()`));
  maxLens.forEach(function (o) {
    ck(o.maxLength > 0, '★ 输入框[' + o.i + '](' + o.type + ') 的 maxLength=' + o.maxLength + ' > 0（否则打不进字）');
  });

  /* 真实敲键盘验证（最实在的一条）*/
  try {
    const boxPt = JSON.parse(await ev(`(function(){
      var i = document.querySelectorAll('.acc-input')[1];
      var r = i.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) });
    })()`));
    await Input.dispatchMouseEvent({ type: 'mousePressed', x: boxPt.x, y: boxPt.y, button: 'left', clickCount: 1 });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x: boxPt.x, y: boxPt.y, button: 'left', clickCount: 1 });
    await sleep(200);
    for (const ch2 of ['t', 'e', 's', 't']) {
      await Input.dispatchKeyEvent({ type: 'keyDown', key: ch2, code: 'Key' + ch2.toUpperCase(), windowsVirtualKeyCode: ch2.toUpperCase().charCodeAt(0) });
      await Input.dispatchKeyEvent({ type: 'char', text: ch2 });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: ch2, code: 'Key' + ch2.toUpperCase(), windowsVirtualKeyCode: ch2.toUpperCase().charCodeAt(0) });
      await sleep(60);
    }
    await sleep(250);
    const typedVal = await ev('(function(){ var i=document.querySelectorAll(".acc-input")[1]; return i?i.value:""; })()');
    ck(typedVal === 'test', '★★★ 真实敲键盘真的能输进密码框（框里="' + typedVal + '"）');
    /* 清掉，免得影响后面的用例 */
    await ev('(function(){ var i=document.querySelectorAll(".acc-input")[1]; i.value=""; return true; })()');
  } catch (e) {
    ck(false, '键盘输入验证（' + e.message + '）');
  }

  /* 先测：两次密码不一致 */
  await setInput('.acc-input:nth-of-type(1)', '十一');
  const allInputs = await ev(`(function(){
    var ins = document.querySelectorAll('.acc-input');
    ins[0].value='十一'; ins[1].value='pass1234'; ins[2].value='different';
    ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    return ins.length;
  })()`);
  ck(allInputs === 3, '填好了三个输入框');
  await clickByText('创建并开始');
  const st2 = await ev('Game.state');
  ck(st2 === 'account_welcome', '★ 两次密码不一致 → **停在原地**不创建');
  const err1 = await ev('(function(){ var e=document.querySelector(".acc-error"); return e?e.textContent:""; })()');
  ck(/不一样/.test(err1), '提示"两次输入的密码不一样"（' + err1 + '）');

  /* 再测：密码太短 */
  await ev(`(function(){
    var ins=document.querySelectorAll('.acc-input');
    ins[0].value='十一'; ins[1].value='12'; ins[2].value='12';
    ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await clickByText('创建并开始');
  const err2 = await ev('(function(){ var e=document.querySelector(".acc-error"); return e?e.textContent:""; })()');
  ck(/至少/.test(err2), '太短密码被拦（' + err2 + '）');

  /* 正式创建 */
  await ev(`(function(){
    var ins=document.querySelectorAll('.acc-input');
    ins[0].value='十一'; ins[1].value='mypass123'; ins[2].value='mypass123';
    ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await clickByText('创建并开始');
  await sleep(400);
  const after = await j('({ state: Game.state, count: ACCOUNT.count(), name: (ACCOUNT.current()||{}).name, logged: ACCOUNT.isLoggedIn() })');
  ck(after.count === 1, '★ 创建了 1 个账号');
  ck(after.name === '十一', '★★ 当前账号是「十一」');
  ck(after.logged === true, '★★ 自动登录了');
  ck(after.state === 'menu', '★★ 创建完直接进主菜单（state=' + after.state + '）');

  /* ---------- 3. 设置页能看到账号 ---------- */
  await ev('gotoState(STATE.SETTINGS)'); await sleep(500);
  const setText = await pageText();
  ck(/当前账号：十一/.test(setText), '★★ 设置页显示「当前账号：十一」');
  ck(/切换账号/.test(setText), '设置页有「切换账号」按钮');
  ck(/退出登录/.test(setText), '设置页有「退出登录」按钮');
  ck(/删除这个账号/.test(setText), '设置页有「删除这个账号」');

  /* ★ 设置页的「返回」必须在左上角（2026-10-06 十一要求）★
   * ------------------------------------------------------------
   * 十一："设置页面中的返回放在左上角。"
   *
   * 断言三件事：
   *   ① 它存在且是面板的**第一个**子元素（sticky 生效的前提）
   *   ② 位置确实在左上角（相对面板偏移很小）
   *   ③ **滚到底部后仍然在左上角** —— 这才说明是真的"固定",
   *      而不是"碰巧因为页面短才在顶上"
   * ------------------------------------------------------------ */
  const corner = JSON.parse(await ev(`(function(){
    var b = document.querySelector('.btn.corner-back');
    if (!b) return JSON.stringify({ found:false });
    var panel = document.querySelector('.panel');
    var r = b.getBoundingClientRect();
    var pr = panel.getBoundingClientRect();
    return JSON.stringify({
      found: true,
      isFirst: b === panel.firstElementChild,
      pos: getComputedStyle(b).position,
      dx: Math.round(r.left - pr.left),
      dy: Math.round(r.top - pr.top),
    });
  })()`));
  ck(corner.found, '★★ 设置页有左上角返回按钮（不是底部的）');
  ck(corner.isFirst === true, '★ 它是面板第一个子元素（sticky 的前提）');
  ck(corner.pos === 'sticky', '用的是 sticky（滚动时固定）');
  ck(corner.dx < 40 && corner.dy < 40, '★★ 在左上角（偏移 ' + corner.dx + ',' + corner.dy + '）');

  /* 滚到底再确认一次 */
  await ev('(function(){ var p=document.querySelector(".panel"); p.scrollTop = p.scrollHeight; return true; })()');
  await sleep(350);
  const corner2 = JSON.parse(await ev(`(function(){
    var b=document.querySelector('.btn.corner-back');
    var r=b.getBoundingClientRect();
    var pr=document.querySelector('.panel').getBoundingClientRect();
    return JSON.stringify({ dy: Math.round(r.top - pr.top) });
  })()`));
  ck(corner2.dy < 40, '★★★ 滚到设置页底部后，返回**依然固定在左上角**（y=' + corner2.dy + '）');
  await ev('(function(){ var p=document.querySelector(".panel"); p.scrollTop = 0; return true; })()');
  await sleep(200);

  /* ---------- 4. 退出登录 ---------- */
  await clickByText('退出登录');       // 第一次 = 变成"真的退出？"
  const btnTxt = await ev(`(function(){
    var b=document.querySelectorAll('button');
    for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf('真的退出')>=0) return b[i].textContent; }
    return '';
  })()`);
  ck(/真的退出/.test(btnTxt), '★ 第一次点变「真的退出？」（防误触生效）');

  await clickByText('真的退出');       // 第二次 = 真退出
  await sleep(300);
  const out = await j('({ logged: ACCOUNT.isLoggedIn(), count: ACCOUNT.count() })');
  ck(out.logged === false, '★★ 退出后是未登录状态');
  ck(out.count === 1, '★ 退出**不删账号**（还是 1 个）');

  /* ---------- 5. 未登录时点「开始跑单」被拦 ---------- */
  await ev('gotoState(STATE.MENU)'); await sleep(400);
  await clickByText('开始跑单');
  const st3 = await ev('Game.state');
  ck(st3 === 'account_pick', '★★★ 未登录点开始 → 跳到**选账号页**（state=' + st3 + '）');

  const pickText = await pageText();
  ck(/十一/.test(pickText), '选账号页里能看到「十一」');
  ck(/这局谁在玩/.test(pickText), '选账号页标题对（' + pickText.slice(0, 20).replace(/\n/g, ' ') + '）');

  /* ---------- 6. 点账号 → 输错密码 → 进不去 ---------- */
  const clicked = await ev(`(function(){
    var c=document.querySelector('.acc-card');
    if(!c) return false;
    c.click(); return true;
  })()`);
  ck(clicked, '点中了账号卡片');
  await sleep(400);
  const st4 = await ev('Game.state');
  ck(st4 === 'account_login', '★★ 进到输密码页（state=' + st4 + '）');

  await setInput('.acc-input', 'wrongpass');
  ck(await ev('(function(){ var i=document.querySelector(".acc-input"); return i?i.value:""; })()') === 'wrongpass',
    '密码框里是错密码');
  /* ★ 点「进入游戏」**并在同一个 evaluate 里读结果** ★
   * ------------------------------------------------------------
   * 【踩过的坑】原来我用 clickByText() 点、之后再分一次 evaluate 读错误提示，
   *   结果读到的永远是空字符串 —— 看起来像"输错密码没有提示"，其实是
   *   **两次 evaluate 之间的界面重建**把它冲掉了
   *   （syncUI 每 100ms 跑一次，500ms 的等待足够它跑 5 遍）。
   *
   *   ⇒ 正确做法：**点击和读取放在同一个 evaluate 里**，
   *     中间不给主循环任何插入的机会。这样读到的一定是
   *     "点完这一下的结果"，而不是"几帧之后的样子"。
   *     （这个手法也说明：**验证瞬态 UI 时，别跨 evaluate 读**）
   * ------------------------------------------------------------ */
  const clickRes = await ev(`(function(){
    var ins = document.querySelectorAll('.acc-input');
    if (ins.length) { ins[0].value = 'wrongpass'; }
    var btns = document.querySelectorAll('button');
    var hit = false;
    for (var i=0;i<btns.length;i++){ if (btns[i].textContent.indexOf('进入游戏')>=0){ btns[i].click(); hit=true; break; } }
    var e = document.querySelector('.acc-error');
    return JSON.stringify({ hit: hit, err: e ? e.textContent : '(无元素)', state: Game.state });
  })()`);
  const cr = JSON.parse(clickRes);
  ck(cr.hit, '点到了「进入游戏」');
  ck(cr.state === 'account_login', '★★ 错密码 → **进不去**，停在输密码页');
  ck(/密码不对/.test(cr.err), '★★ 实时提示"密码不对"（' + (cr.err || '(空)') + '）');

  /* ---------- 7. 对密码 → 进入 ---------- */
  await setInput('.acc-input', 'mypass123');
  await clickByText('进入游戏');
  await sleep(400);
  const back = await j('({ state: Game.state, logged: ACCOUNT.isLoggedIn(), name: (ACCOUNT.current()||{}).name })');
  ck(back.logged === true, '★★ 对密码 → 登录成功');
  ck(back.name === '十一', '★ 回到了「十一」的账号');
  ck(back.state === 'menu', '★ 进到主菜单');

  /* ---------- 8. 两个账号的进度互相独立（最关键） ---------- */
  /* 给十一设个显眼进度 */
  await ev('(function(){ Save.data.maxUnlocked = 8; Save.save(); return true; })()');
  const lvA = await ev('Save.data.maxUnlocked');

  /* 建第二个账号 */
  await ev('gotoState(STATE.ACCOUNT_WELCOME)'); await sleep(400);
  await ev(`(function(){
    var ins=document.querySelectorAll('.acc-input');
    ins[0].value='小红'; ins[1].value='hong4567'; ins[2].value='hong4567';
    ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await clickByText('创建账号');
  await sleep(500);
  const two = await j('({ count: ACCOUNT.count(), name: (ACCOUNT.current()||{}).name, lv: Save.data.maxUnlocked })');
  ck(two.count === 2, '★ 现在有 2 个账号');
  ck(two.name === '小红', '★ 切换到了「小红」');
  ck(two.lv === 1, '★★★ 小红的进度是全新的第 1 关（**没继承十一的第 8 关**）');

  /* 小红玩到第 3 关 */
  await ev('(function(){ Save.data.maxUnlocked = 3; Save.save(); return true; })()');

  /* 切回十一 */
  await ev('gotoState(STATE.ACCOUNT_PICK)'); await sleep(400);
  await ev(`(function(){
    var cards=document.querySelectorAll('.acc-card');
    for(var i=0;i<cards.length;i++){ if(cards[i].textContent.indexOf('十一')>=0){ cards[i].click(); return true; } }
    return false;
  })()`);
  await sleep(400);
  await setInput('.acc-input', 'mypass123');
  await clickByText('进入游戏');
  await sleep(500);
  const backA = await ev('Save.data.maxUnlocked');
  ck(backA === 8, '★★★ 切回十一 → 进度还是第 8 关（**没被小红的第 3 关覆盖**）');

  /* ---------- 9. 昵称重复被拦 ---------- */
  await ev('gotoState(STATE.ACCOUNT_WELCOME)'); await sleep(400);
  await ev(`(function(){
    var ins=document.querySelectorAll('.acc-input');
    ins[0].value='十一'; ins[1].value='another123'; ins[2].value='another123';
    ins[0].dispatchEvent(new Event('input',{bubbles:true}));
    ins[1].dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await sleep(200);
  const hint = await ev('(function(){ var h=document.querySelector(".acc-hint"); return h?h.textContent:""; })()');
  ck(/已经有人用/.test(hint), '★ 输入重复昵称时就**即时提示**（' + hint + '）');

  await clickByText('创建账号');
  const dup = await ev('ACCOUNT.count()');
  ck(dup === 2, '★★ 重复昵称**真的建不出来**（还是 2 个账号）');

  /* ---------- 10. 截图 ---------- */
  await ev('gotoState(STATE.ACCOUNT_PICK)'); await sleep(600);
  const { data } = await Page.captureScreenshot({ format: 'png' });
  const dir = path.join(path.resolve(__dirname, '..'), 'dist', '_mod_shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'account-pick.png'), Buffer.from(data, 'base64'));
  console.log('  📷 dist/_mod_shots/account-pick.png');

  await ev('gotoState(STATE.ACCOUNT_WELCOME)'); await sleep(600);
  const { data: d2 } = await Page.captureScreenshot({ format: 'png' });
  fs.writeFileSync(path.join(dir, 'account-welcome.png'), Buffer.from(d2, 'base64'));
  console.log('  📷 dist/_mod_shots/account-welcome.png');

  /* ---------- 报错检查 ---------- */
  console.log();
  console.log('======== 控制台错误 ========');
  const real = errors.filter(e => e && !/favicon|net::ERR/i.test(e));
  if (real.length) real.slice(0, 6).forEach(e => console.log('  ❌ ' + e));
  else console.log('  无错误 ✅');
  ck(real.length === 0, '没有 console 异常');

  console.log();
  console.log('========================================');
  console.log('  本机账号系统: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  await c.close(); ch.kill(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
