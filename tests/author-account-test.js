/* ============================================================
 * author-account-test.js — 作者身份（靠兑换码 code）+ 版本同步
 * ============================================================
 * 十一的需求演变：
 *   ① "帮我做一个作者账号"           → 第一版：昵称「二十二」= 作者
 *   ② "每次更新作者账号可以同步更新
 *      所有的关卡和角色"             → 加了 syncAuthorPerks
 *   ③ **"改成只靠 code 认作者"**     → 现在这一版
 *
 * 所以最终形态：
 *   · 作者身份**只看存档标记 `isAuthor`**
 *   · 唯一获得方式 = **在兑换码框输入 `code`**
 *   · 昵称不再有任何特权（所有昵称一视同仁、都要密码）
 *   · 拿到身份后，每次读档自动同步全角色/全动作/全关卡（并跟版本更新）
 *
 * 验证：
 *   【作者身份】
 *     ① 普通昵称建号 = 普通账号（没有作者标记）
 *     ② 输 `code` → 盖作者章 + 全解锁
 *     ③ 任何昵称都能通过 code 成为作者（不挑昵称）
 *     ④ 作者身份**跟着存档**（切走再切回来还在）
 *     ⑤ 新账号是干净的普通账号（存档隔离）
 *
 *   【版本更新自动同步】
 *     ⑥ 降级存档 → 重开后自动补齐
 *     ⑦ 再删角色模拟"新内容" → 再读档又补回来
 *     ⑧ 幂等
 *     ⑨ 普通账号不会被同步
 *
 *   【界面】
 *     ⑩ 设置页有兑换框 / 作者徽章 / 普通号无徽章 / 错误码提示
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9692, HP = 9237;
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
  const tmp = path.join(process.env.TEMP || '/tmp', 'author2-' + Date.now());
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

  await sleep(3200);
  console.log('======== 作者身份（靠 code）· 真浏览器验证 ========');

  await ev('(function(){ try{ localStorage.clear(); }catch(e){} return true; })()');
  await Page.reload({ ignoreCache: true });
  await sleep(3200);

  /* ============================================================
   * 一、作者身份 = 兑换码 code
   * ============================================================ */
  console.log('\n--- 一、作者身份靠 code ---');

  /* ① 用**任意昵称**建号（不挑昵称了） */
  const reg = await ev(`(function(){
    var r = ACCOUNT.register('随便起的名字', 'mypass123', 'mypass123');
    return { ok: r.ok, name: r.account ? r.account.name : null };
  })()`);
  ck(reg.ok === true, '① 任意昵称都能正常建号（' + reg.name + '）');

  const beforeAuthor = await ev(`(function(){
    SAVE().reload();
    return { isAuthor: ACCOUNT.isCurrentAuthor(),
             maxLv: SAVE().data.maxUnlocked, marked: SAVE().data.isAuthor === true };
  })()`);
  ck(beforeAuthor.isAuthor === false, '① 建完**还不是**作者（' + JSON.stringify(beforeAuthor) + '）');
  ck(beforeAuthor.maxLv < 30, '① 关卡也没全解锁（maxUnlocked=' + beforeAuthor.maxLv + '）');

  /* ② 输 code → 变成作者 */
  const redeem = await ev(`(function(){
    var r = redeemCode('code');
    return { ok: r.ok, msg: r.message };
  })()`);
  ck(redeem.ok === true, '② 输入 code → 兑换成功（' + redeem.msg + '）');

  const afterAuthor = await ev(`(function(){
    var lib = listForLibrary().length;
    return {
      isAuthor: ACCOUNT.isCurrentAuthor(),
      marked: SAVE().data.isAuthor === true,
      chars: SAVE().data.unlockedCharacters.length,
      lib: lib,
      acts: SAVE().data.unlockedActions.length,
      maxLv: SAVE().data.maxUnlocked,
      total: levelCount()
    };
  })()`);
  ck(afterAuthor.isAuthor === true && afterAuthor.marked === true,
    '②★ 变成了作者（存档里有 isAuthor 标记）');
  ck(afterAuthor.chars === afterAuthor.lib,
    '②★ 全角色立刻解锁（' + afterAuthor.chars + '/' + afterAuthor.lib + '）');
  ck(afterAuthor.acts === 4, '②★ 全动作解锁（' + afterAuthor.acts + '/4）');
  ck(afterAuthor.maxLv === afterAuthor.total,
    '②★ 全关卡解锁（' + afterAuthor.maxLv + '/' + afterAuthor.total + '）');

  /* ③ 作者身份跟着存档走（切走再切回来还在）
   * ⚠️ 必须放在"把第二个号也变成作者"之前 ——
   *    否则找不到"普通账号"可以切（踩过这个坑）。 */
  const persist = await ev(`(function(){
    /* 现造一个普通账号，好有个"切过去"的目标 */
    var r = ACCOUNT.register('陪跑的', 'escort123', 'escort123');
    if (!r.ok) return { err: r.message };
    SAVE().reload();
    var plainId = ACCOUNT.list()[ACCOUNT.list().length - 1].id;
    /* 先切到陪跑号（此时还登录着第一个号） */
    ACCOUNT._forceLogin(plainId); SAVE().reload();
    var atPlain = ACCOUNT.isCurrentAuthor();
    /* 切回第一个号（它是作者） */
    var authorAcc = null;
    ACCOUNT.list().forEach(function(a){
      if (a.id === plainId) return;
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (d && d.isAuthor) authorAcc = a;
    });
    if (!authorAcc) return { err: 'no-author' };
    ACCOUNT._forceLogin(authorAcc.id); SAVE().reload();
    var back = ACCOUNT.isCurrentAuthor();
    return { atPlain: atPlain, back: back };
  })()`);
  ck(persist.atPlain === false && persist.back === true,
    '③★ 作者身份跟着存档 —— 切到普通号不是作者、切回来还是作者' +
    (persist.err ? '（' + persist.err + '）' : ''));

  /* ④ 换一个昵称的账号也能通过 code 变作者（证明不挑昵称） */
  const other = await ev(`(function(){
    var r = ACCOUNT.register('另一个人', 'other12345', 'other12345');
    if (!r.ok) return { err: r.message };
    SAVE().reload();
    var before = ACCOUNT.isCurrentAuthor();
    redeemCode('code');
    return { before: before, after: ACCOUNT.isCurrentAuthor() };
  })()`);
  ck(other.before === false && other.after === true,
    '④★ 完全不同的昵称也能靠 code 成为作者（不挑昵称）');

  /* ⑤ 新账号是干净的普通账号 */
  const fresh = await ev(`(function(){
    var r = ACCOUNT.register('新来的', 'fresh1234', 'fresh1234');
    if (!r.ok) return { err: r.message };
    SAVE().reload(); SAVE().reload();
    return { isAuthor: ACCOUNT.isCurrentAuthor(), maxLv: SAVE().data.maxUnlocked };
  })()`);
  ck(fresh.isAuthor === false, '⑤★ 新账号是普通账号（不是作者）');
  ck(fresh.maxLv < 30, '⑤★ 新账号关卡没全解锁（maxUnlocked=' + fresh.maxLv + '）—— 存档隔离有效');

  /* ============================================================
   * 二、版本更新自动同步
   * ============================================================ */
  console.log('\n--- 二、版本更新自动同步 ---');

  /* 切回作者账号 */
  await ev(`(function(){
    var acc = null;
    ACCOUNT.list().forEach(function(a){
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (d && d.isAuthor) acc = a;
    });
    if (acc) { ACCOUNT._forceLogin(acc.id); SAVE().reload(); }
    return !!acc;
  })()`);

  /* ⑥ 降级存档 → 重开自动补齐 */
  const degraded = await ev(`(function(){
    var s = SAVE();
    s.data.unlockedCharacters = ['kangaroo', 'dragon'];
    s.data.unlockedActions = [];
    s.data.maxUnlocked = 3;
    s.save();
    return { chars: s.data.unlockedCharacters.length, maxLv: s.data.maxUnlocked };
  })()`);
  ck(degraded.chars === 2 && degraded.maxLv === 3, '⑥ 已把作者存档降级成旧版本状态');

  const resynced = await ev(`(function(){
    SAVE().reload();
    var s = SAVE();
    return { chars: s.data.unlockedCharacters.length, lib: listForLibrary().length,
             acts: s.data.unlockedActions.length, maxLv: s.data.maxUnlocked, total: levelCount() };
  })()`);
  ck(resynced.chars === resynced.lib, '⑥★ 重开后角色自动补齐（' + resynced.chars + '/' + resynced.lib + '）');
  ck(resynced.acts === 4, '⑥★ 动作自动补齐（' + resynced.acts + '/4）');
  ck(resynced.maxLv === resynced.total, '⑥★ 关卡自动补齐（' + resynced.maxLv + '/' + resynced.total + '）');

  /* ⑦ 再删一个角色（模拟"新加的角色"）→ 再读档又补回来 */
  const newChar = await ev(`(function(){
    var s = SAVE();
    var victim = s.data.unlockedCharacters[s.data.unlockedCharacters.length - 1];
    s.data.unlockedCharacters = s.data.unlockedCharacters.filter(function(id){ return id !== victim; });
    s.save();
    SAVE().reload();
    return { victim: victim, restored: SAVE().data.unlockedCharacters.indexOf(victim) >= 0 };
  })()`);
  ck(newChar.restored === true, '⑦★ 模拟新角色（' + newChar.victim + '）→ 再读档自动补回来');

  /* ⑧ 幂等 */
  const idem = await ev(`(function(){
    SAVE().reload();
    var a = JSON.stringify(SAVE().data.unlockedCharacters.slice().sort()) + '|' + SAVE().data.maxUnlocked;
    SAVE().reload(); SAVE().reload();
    var b = JSON.stringify(SAVE().data.unlockedCharacters.slice().sort()) + '|' + SAVE().data.maxUnlocked;
    return { same: a === b };
  })()`);
  ck(idem.same === true, '⑧ 幂等：连读多次档数据完全不变');

  /* ⑨ 普通账号不被同步 */
  const normal = await ev(`(function(){
    ACCOUNT.logout();
    var plain = null;
    ACCOUNT.list().forEach(function(a){
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (!(d && d.isAuthor)) plain = a;
    });
    if (!plain) return { skip: true };
    ACCOUNT._forceLogin(plain.id);
    SAVE().reload(); SAVE().reload();
    return { maxLv: SAVE().data.maxUnlocked };
  })()`);
  if (normal.skip) console.log('  （没有普通账号可测，跳过 ⑨）');
  else ck(normal.maxLv < 30, '⑨★★ 普通账号不会被同步全解锁（关卡仍 ' + normal.maxLv + '）');

  /* ============================================================
   * 三、界面
   * ============================================================ */
  console.log('\n--- 三、界面 ---');
  await ev('(function(){ ACCOUNT.logout(); gotoState(STATE.SETTINGS); return true; })()');
  await sleep(700);
  const hasInput = await ev('!!document.querySelector(".redeem-input")');
  ck(hasInput === true, '⑩ 设置页有兑换码输入框');

  await ev(`(function(){
    var acc = null;
    ACCOUNT.list().forEach(function(a){
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (d && d.isAuthor) acc = a;
    });
    if (acc) { ACCOUNT._forceLogin(acc.id); SAVE().reload(); }
    gotoState(STATE.SETTINGS);
    return true;
  })()`); await sleep(700);
  const badge = await ev('(function(){ return UI.root ? UI.root.innerText : ""; })()');
  ck(badge.indexOf('作者') >= 0, '⑩ 作者账号显示「★ 作者」徽章');

  /* ⑪ 普通账号**不**显示徽章 */
  await ev(`(function(){
    ACCOUNT.logout();
    var plain = null;
    ACCOUNT.list().forEach(function(a){
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (!(d && d.isAuthor)) plain = a;
    });
    if (plain) { ACCOUNT._forceLogin(plain.id); SAVE().reload(); }
    gotoState(STATE.SETTINGS);
    return true;
  })()`); await sleep(700);
  const plainBadge = await ev('(function(){ return UI.root ? UI.root.innerText : ""; })()');
  ck(plainBadge.indexOf('作者') < 0, '⑪ 普通账号**不显示**作者徽章');

  /* ⑫ 空 / 错误码 */
  const badCodes = await ev(`(function(){
    var a = redeemCode('');
    var b = redeemCode('nope123');
    return { a: a.ok, am: a.message, b: b.ok, bm: b.message };
  })()`);
  ck(badCodes.a === false && badCodes.am.indexOf('请输入') >= 0, '⑫ 空输入有提示（' + badCodes.am + '）');
  ck(badCodes.b === false && badCodes.bm.indexOf('不存在') >= 0, '⑫ 错误码有提示（' + badCodes.bm + '）');

  /* ============================================================
   * 四、碧琪专属兑换码（十一的碧琪宝宝）
   * ============================================================
   * 十一："当兑换码里面写「十一的碧琪宝宝」的时候，可以获得碧琪"
   *      "作者那个账号……这些都是不需要去兑换的，都是直接有"
   * ============================================================ */
  console.log('\n--- 四、碧琪兑换码 ---');

  /* ⑬ 普通账号（非作者）输码 → 拿到碧琪 */
  const pinkie = await ev(`(function(){
    ACCOUNT.logout();
    var plain = null;
    ACCOUNT.list().forEach(function(a){
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (!(d && d.isAuthor)) plain = a;
    });
    if (!plain) return { skip: true };
    ACCOUNT._forceLogin(plain.id); SAVE().reload();
    /* 先确认她没有碧琪 */
    var before = (SAVE().data.unlockedCharacters || []).indexOf('pinkiepie') >= 0;
    var r = redeemCode('十一的碧琪宝宝');
    return { before: before, ok: r.ok, msg: r.message,
             after: SAVE().data.unlockedCharacters.indexOf('pinkiepie') >= 0 };
  })()`);
  if (pinkie.skip) console.log('  （没有普通账号可测，跳过 ⑬）');
  else {
    ck(pinkie.before === false, '⑬ 兑换前普通账号**没有**碧琪');
    ck(pinkie.ok === true, '⑬★ 输「十一的碧琪宝宝」→ 兑换成功（' + pinkie.msg + '）');
    ck(pinkie.after === true, '⑬★★ 碧琪真的进车队了');
  }

  /* ⑭ 再兑一次 → 提示已拥有（不报错） */
  const again = await ev(`(function(){
    var r = redeemCode('十一的碧琪宝宝');
    return { ok: r.ok, msg: r.message,
             still: SAVE().data.unlockedCharacters.indexOf('pinkiepie') >= 0 };
  })()`);
  ck(again.still === true, '⑭ 重复兑换后碧琪还在（不会把她弄丢）');

  /* ⑮ ★ 作者账号不用兑也直接有碧琪 */
  const authorHas = await ev(`(function(){
    var acc = null;
    ACCOUNT.list().forEach(function(a){
      var raw = localStorage.getItem(ACCOUNT.getStore().saveKeyFor(a.id));
      var d = raw ? JSON.parse(raw) : null;
      if (d && d.isAuthor) acc = a;
    });
    if (!acc) return { skip: true };
    /* 作者账号一登录，全角色特权应把碧琪也带上 */
    ACCOUNT._forceLogin(acc.id); SAVE().reload();
    return { has: SAVE().data.unlockedCharacters.indexOf('pinkiepie') >= 0,
             chars: SAVE().data.unlockedCharacters.length,
             lib: listForLibrary().length };
  })()`);
  if (authorHas.skip) console.log('  （没有作者账号可测，跳过 ⑮）');
  else {
    ck(authorHas.has === true,
      '⑮★★ 作者账号**不用兑换**也直接有碧琪（全角色特权覆盖）');
    ck(authorHas.chars === authorHas.lib,
      '⑮ 作者账号角色数 = 全量（' + authorHas.chars + '/' + authorHas.lib + '）');
  }

  console.log('\n======== 控制台错误 ========');
  if (errors.length === 0) console.log('  无错误 ✅');
  else errors.slice(0, 8).forEach(e => console.log('  ⚠ ' + e));
  ck(errors.length === 0, '没有 console 异常');

  console.log('\n========================================');
  console.log('  作者身份（靠 code）: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  try { await c.close(); } catch (e) { }
  try { ch.kill(); } catch (e) { }
  server.close();
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(async e => {
  console.error('测试崩溃:', e.message);
  process.exit(1);
});
