/* ============================================================
 * account-delete-test.js — 删除账号 · 真浏览器验证（2026-10-07）
 * ============================================================
 * 十一要求："切换账号里面可以删除账号功能"。
 *
 * 这轮改动把删除入口**从设置页提前到账号选择页**，
 * 所以必须实测这几件事（纯逻辑测试测不到）：
 *   ① 账号卡上**真的渲染出了**「删除」按钮（不是建了对象没挂上去）
 *   ② **点删除不会误触发登录**（卡片整块绑了点击跳登录，
 *      删除按钮必须拦住冒泡 —— 这是最容易出的 bug）
 *   ③ 删除走完整两道关：二次确认弹窗 + 输密码
 *   ④ 密码错 → 删不掉；密码对 → 账号真的没了
 *   ⑤ 删的是**最后一个**账号时，页面优雅降级（不是白屏）
 *   ⑥ 从设置页进删除，取消时回设置页；从选择页进，取消回选择页
 *
 * ⚠️ 用真浏览器（不是 jsdom）：验证的是"按钮真的长出来、点得到、
 *    点了不会串到别的行为"——这类问题在纯逻辑测试里看不见。
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9689, HP = 9234;
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
  const tmp = path.join(process.env.TEMP || '/tmp', 'accdel-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
    '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1200,860',
    'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) { }
  }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime, Page } = c; await Runtime.enable(); await Page.enable();

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

  const clickByText = async (txt, scope) => {
    const ok = await ev(`(function(){
      var b=document.querySelectorAll(${JSON.stringify(scope || 'button')});
      for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf(${JSON.stringify(txt)})>=0){ b[i].click(); return true; } }
      return false;
    })()`);
    await sleep(600);
    return ok;
  };
  const setInput = async (sel, val) => ev(`(function(){
    var i = document.querySelector(${JSON.stringify(sel)});
    if (!i) return false;
    i.value = ${JSON.stringify(val)};
    i.dispatchEvent(new Event('input', {bubbles:true}));
    return true;
  })()`);
  const pageText = async () => ev('(function(){ return UI.root ? UI.root.innerText : ""; })()');

  await sleep(3200);

  console.log('======== 删除账号（切换账号页入口）· 真浏览器验证 ========');

  /* ---------- 0. 造两个账号 ---------- */
  await ev('(function(){ try{ localStorage.clear(); }catch(e){} return true; })()');
  await Page.reload({ ignoreCache: true });
  await sleep(3200);

  await ev(`(function(){
    ACCOUNT.register('十一', 'pass1234', 'pass1234');
    ACCOUNT.register('小红', 'other5678', 'other5678');
    return ACCOUNT.count();
  })()`);
  const n0 = await ev('ACCOUNT.count()');
  ck(n0 === 2, '环境准备：建了 2 个账号（实际 ' + n0 + '）');

  /* ---------- 1. 账号选择页：删除按钮真的渲染出来了 ---------- */
  await ev('gotoState(STATE.ACCOUNT_PICK)'); await sleep(700);
  const delCount = await ev('document.querySelectorAll(".acc-del").length');
  ck(delCount === 2, '★ 每张账号卡上都有「删除」按钮（实际 ' + delCount + ' 个）');

  const delText = await ev('(function(){ var b=document.querySelector(".acc-del"); return b ? b.textContent : ""; })()');
  ck(delText.indexOf('删除') >= 0, '删除按钮文字是「删除」（实际 "' + delText + '"）');

  const cardCount = await ev('document.querySelectorAll(".acc-card").length');
  ck(cardCount === 2, '账号卡也是 2 张（实际 ' + cardCount + '，删除按钮没把布局搞坏）');

  /* ---------- 2. ★ 点删除不能误触发登录 ---------- */
  await ev('(function(){ document.querySelector(".acc-del").click(); return true; })()');
  await sleep(700);
  /* ⚠️ STATE 只在页面上下文里存在（Node 侧没有），
   *    所以比较必须在页面里做完，只把**布尔结果**传回来。 */
  const wentToLogin = await ev('Game.state === STATE.ACCOUNT_LOGIN');
  ck(wentToLogin === false,
    '★★ 点「删除」**不会**误跳到登录页（拦住了冒泡）');
  const dlgText = await pageText();
  ck(dlgText.indexOf('真的不要这个账号了') >= 0,
    '★★ 而是打开了删除确认弹窗');

  /* ---------- 3. 取消能回去（从选择页进 → 回选择页） ---------- */
  await clickByText('算了，返回');
  const backToPick = await ev('Game.state === STATE.ACCOUNT_PICK');
  ck(backToPick === true,
    '★ 取消后回到「切换账号」页（不是被踢去设置页）');
  const stillThere = await ev('ACCOUNT.count()');
  ck(stillThere === 2, '取消后账号一个没少（还是 ' + stillThere + ' 个）');

  /* ---------- 4. 密码错 → 删不掉 ---------- */
  await ev('(function(){ document.querySelector(".acc-del").click(); return true; })()');
  await sleep(600);
  await setInput('.acc-input', 'wrongpass');
  await clickByText('确认删除');
  const nWrong = await ev('ACCOUNT.count()');
  ck(nWrong === 2, '★★ 密码错 → **删不掉**（还是 ' + nWrong + ' 个账号）');
  const stayInDialog = await pageText();
  ck(stayInDialog.indexOf('真的不要这个账号了') >= 0,
    '★ 密码错时**留在弹窗里**（不会莫名其妙退出去）');

  /* ---------- 5. 密码对 → 真的删掉 ---------- */
  /* ⚠️ 密码错后还停在弹窗里，.acc-card 不在 DOM ——
   *    所以要先记下"这次要删的是谁"，再输正确密码。
   *    弹窗顶部有账号名，从那里读。 */
  const warnText = await ev('(function(){ var w=document.querySelector(".acc-warn"); return w ? w.innerText : ""; })()');
  const firstName = warnText.indexOf('十一') >= 0 ? '十一' : '小红';
  const rightPass = firstName === '十一' ? 'pass1234' : 'other5678';

  await setInput('.acc-input', rightPass);
  await clickByText('确认删除');
  const nAfter = await ev('ACCOUNT.count()');
  ck(nAfter === 1, '★★ 密码对 → 账号真的删掉了（剩 ' + nAfter + ' 个）');

  const gone = await ev('ACCOUNT.list().map(function(a){return a.name}).indexOf(' + JSON.stringify(firstName) + ') < 0');
  ck(gone, '★ 被删的「' + firstName + '」确实不在列表里了');

  /* ---------- 6. 删最后一个 → 优雅降级 ---------- */
  await ev('gotoState(STATE.ACCOUNT_PICK)'); await sleep(700);
  const lastBtn = await ev('document.querySelectorAll(".acc-del").length');
  ck(lastBtn === 1, '还剩 1 张卡（还有 1 个删除按钮）');

  /* 这次从卡片上读名字（此时确实在选择页） */
  const lastName = await ev('(function(){ var c=document.querySelector(".acc-card"); return c ? c.getAttribute("data-acc-name") : ""; })()');
  const lastPass = lastName === '十一' ? 'pass1234' : 'other5678';

  await ev('(function(){ document.querySelector(".acc-del").click(); return true; })()');
  await sleep(600);
  await setInput('.acc-input', lastPass);
  await clickByText('确认删除');
  await sleep(800);

  const nZero = await ev('ACCOUNT.count()');
  ck(nZero === 0, '★ 删光所有账号（剩 ' + nZero + ' 个）');
  const emptyText = await pageText();
  ck(emptyText.indexOf('还没有任何账号') >= 0,
    '★★ 删光后页面优雅降级（显示"还没有任何账号"+创建引导，不是白屏）');
  const hasCreate = await ev('(function(){ var b=document.querySelectorAll("button"); for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf("创建")>=0) return true; } return false; })()');
  ck(hasCreate, '★ 且能直接创建一个新账号');

  /* ---------- 7. 设置页入口仍然可用（且取消回设置页） ---------- */
  await ev(`(function(){ ACCOUNT.register('测试员', 'test9999', 'test9999'); return true; })()`);
  await ev('ACCOUNT._forceLogin(ACCOUNT.list()[0].id)');
  await ev('gotoState(STATE.SETTINGS)'); await sleep(700);
  const setText = await pageText();
  ck(setText.indexOf('删除这个账号') >= 0, '设置页里的「删除这个账号」入口还在');

  await clickByText('删除这个账号');
  await clickByText('算了，返回');
  const backSet = await ev('Game.state === STATE.SETTINGS');
  ck(backSet === true,
    '★ 从设置页进删除，取消后回设置页');

  /* ---------- 8. 无 console 错误 ---------- */
  console.log('\n======== 控制台错误 ========');
  if (errors.length === 0) console.log('  无错误 ✅');
  else errors.slice(0, 8).forEach(e => console.log('  ⚠ ' + e));
  ck(errors.length === 0, '没有 console 异常');

  console.log('\n========================================');
  console.log('  删除账号 · 真浏览器: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  try { await c.close(); } catch (e) { }
  try { ch.kill(); } catch (e) { }
  server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(async e => {
  console.error('测试崩溃:', e.message);
  process.exit(1);
});
