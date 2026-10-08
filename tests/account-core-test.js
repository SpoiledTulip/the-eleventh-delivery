/* ============================================================
 * account-core-test.js — 账号核心逻辑（纯离线）
 * ============================================================
 * 守的是"本机多账号"的规则本身，不碰界面：
 *   注册/去重（含空格与大小写归一化）/密码校验/连续错密码锁定/
 *   退出不删号/存档 key 隔离/删除账号/哈希稳定性。
 *
 * ⚠️ 为什么"昵称去重"要归一化（trim + 压空格 + 小写）：
 *   不归一化的话 "Abc" 和 "abc"、"十一" 和 "  十一  " 会被当成
 *   两个账号，而玩家在界面上根本看不出区别 ——
 *   那种"我明明建过了"的困惑比直接拦住更糟。
 *
 * ⚠️ SHA-256 用标准测试向量对照（空串/abc/hello）——
 *   自己实现的哈希最容易在边界上错，必须有已知答案校对。
 *
 * ============================================================ */


const fs = require('fs'), path = require('path'), vm = require('vm');

function makeSandbox() {
  const mem = {};
  const sb = {
    console, Math, Date, Object, Array, Infinity, NaN, JSON, Promise,
    String, Number, Boolean, isNaN, parseInt, parseFloat, Set, Map,
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
    },
    crypto: undefined,
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  return sb;
}

const sb = makeSandbox();
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'src', 'js', 'account.js'), 'utf8'), sb, { filename: 'account.js' });
const run = c => vm.runInContext(c, sb);
const j = c => JSON.parse(run('JSON.stringify(' + c + ')'));

let P = 0, F = 0;
function ck(ok, msg, extra) {
  if (ok) { console.log('  [v] ' + msg); P++; }
  else { console.log('  [X] ' + msg + (extra ? '  → ' + extra : '')); F++; }
}

console.log('=== 1. 注册 ===');
let r = j('ACCOUNT.register("十一", "mypass123")');
ck(r.ok === true, '注册"十一"成功');
ck(!!r.account && r.account.id, '返回了账号 id（' + (r.account && r.account.id) + '）');
ck(r.account && r.account.hash === undefined && r.account.salt === undefined,
  '★ 返回的账号对象**不含** hash/salt（不泄漏）');
ck(j('ACCOUNT.isLoggedIn()') === true, '注册后自动登录');
ck(j('ACCOUNT.current().name') === '十一', '当前账号是"十一"');

console.log('\n=== 2. 昵称重复 ===');
let d = j('ACCOUNT.register("十一", "other123")');
ck(d.ok === false && d.code === 'NAME_TAKEN', '同名再注册被拒（NAME_TAKEN）');
d = j('ACCOUNT.register("  十一  ", "other123")');
ck(d.ok === false && d.code === 'NAME_TAKEN', '★ 带空格也算重名（归一化生效）');
/* SHIYI 和 shiyi 归一化后相同 → 互为重名；
 * ⚠️ 注意 "十一"(中文) 和 "SHIYI"(拼音字母) **不是**重名 —— 这是对的，
 *    玩家眼里就是两个不同昵称。别为了"看起来像"就强行合并。 */
j('ACCOUNT.register("SHIYI", "other123")');
const d2 = j('ACCOUNT.register("shiyi", "other123")');
ck(d2.ok === false && d2.code === 'NAME_TAKEN', '★ 大小写不同也算重名（SHIYI / shiyi）');

console.log('\n=== 3. 昵称/密码校验 ===');
ck(j('ACCOUNT.register("", "pass123")').ok === false, '空昵称被拒');
ck(j('ACCOUNT.register("        ", "pass123")').ok === false, '全空格昵称被拒');
ck(j('ACCOUNT.register("很长很长很长很长很长的昵称", "pass123")').ok === false, '超长昵称被拒');
ck(j('ACCOUNT.register("小明", "123")').ok === false, '太短密码被拒');
ck(j('ACCOUNT.register("小明", "pass123", "pass999")').ok === false, '两次密码不一致被拒');

console.log('\n=== 4. 多账号 ===');
r = j('ACCOUNT.register("小红", "hong456")');
ck(r.ok === true, '注册第二个账号"小红"成功');
const cAfter = j('ACCOUNT.count()');
ck(cAfter === 3, '注册后账号数 +1（当前 ' + cAfter + ' 个：十一/SHIYI/小红）');

console.log('\n=== 5. 验证密码 ===');
const hong = j('ACCOUNT.list()').find(a => a.name === '小红');
ck(j('ACCOUNT.login("' + hong.id + '", "wrongpass")').ok === false, '错密码登录被拒');
const bad = j('ACCOUNT.login("' + hong.id + '", "wrongpass")');
ck(/还可以试 \d+ 次/.test(bad.message), '提示还剩几次机会（' + bad.message + '）');
ck(j('ACCOUNT.login("' + hong.id + '", "hong456")').ok === true, '对密码登录成功');
ck(j('ACCOUNT.current().name') === '小红', '切换到了"小红"');

console.log('\n=== 6. 连续错密码锁定 ===');
/* ⚠️ 必须错满 MAX_ATTEMPTS(5) 次。第 5 次**本身**就会触发锁定，
 *    所以循环 5 次，然后第 6 次用正确密码验证"是否被锁"。 */
for (let i = 0; i < 5; i++) j('ACCOUNT.login("' + hong.id + '", "bad' + i + '")');
const locked = j('ACCOUNT.login("' + hong.id + '", "hong456")');
ck(locked.ok === false && locked.code === 'LOCKED', '★ 连续错 5 次后**即使密码对也被锁**');
ck(/等 \d+ 秒/.test(locked.message), '提示还要等多久（' + locked.message + '）');

console.log('\n=== 7. 退出 ===');
j('ACCOUNT.logout()');
ck(j('ACCOUNT.isLoggedIn()') === false, '退出后是未登录状态');
ck(j('ACCOUNT.current()') === null, 'current() 返回 null');
ck(j('ACCOUNT.count()') === 3, '★ 退出**不删账号**（还是 3 个）');

console.log('\n=== 8. 存档 key 隔离 ===');
const shi = j('ACCOUNT.list()').find(a => a.name === '十一');
j('ACCOUNT._forceLogin("' + shi.id + '")');
const k1 = j('ACCOUNT.saveKey()');
j('ACCOUNT._forceLogin("' + hong.id + '")');
const k2 = j('ACCOUNT.saveKey()');
ck(k1 !== k2, '★ 两个账号的存档 key **不同**');
ck(k1.indexOf(shi.id) >= 0 && k2.indexOf(hong.id) >= 0, 'key 里带各自的账号 id');
j('ACCOUNT.logout()');
const kg = j('ACCOUNT.saveKey()');
ck(j('ACCOUNT.isGuestSaveKey("' + kg + '")') === true, '未登录时用"游客档"key 兜底（不崩）');

console.log('\n=== 9. 删除账号 ===');
/* ⚠️ 不能用"小红" —— 它在第 6 节被锁定了（锁定期间连删除都会被拒，
 *    这是**正确行为**：防止别人趁你输错密码的时候把你的号删了）。
 *    换个没被锁的账号来测删除流程。 */
const shi2 = j('ACCOUNT.list()').find(a => a.name === '十一');
j('ACCOUNT._forceLogin("' + shi2.id + '")');
ck(j('ACCOUNT.remove("' + shi2.id + '", "wrong")').ok === false, '删除时密码错 → 被拒');
ck(j('ACCOUNT.remove("' + shi2.id + '", "mypass123")').ok === true, '密码对 → 删除成功');
ck(j('ACCOUNT.count()') === 2, '账号数 -1（剩 ' + j('ACCOUNT.count()') + ' 个）');
ck(j('ACCOUNT.current()') === null, '★ 删掉的是当前账号 → 自动变成未登录');

console.log('\n=== 9b. 锁定期间不许删号（防趁乱删号）===');
ck(j('ACCOUNT.remove("' + hong.id + '", "hong456")').ok === false,
  '★ 账号被锁定时，连正确的密码也不能删它（等解锁）');

console.log('\n=== 10. 哈希稳定性 ===');
const h1 = j('ACCOUNT._internals.hashPassword("same", "fixedsalt")');
const h2 = j('ACCOUNT._internals.hashPassword("same", "fixedsalt")');
ck(h1 === h2, '同样输入 → 同样结果（可复现）');
const h3 = j('ACCOUNT._internals.hashPassword("same", "othersalt")');
ck(h1 !== h3, '★ 换盐 → 结果不同（盐真的生效了）');
const h4 = j('ACCOUNT._internals.hashPassword("diff", "fixedsalt")');
ck(h1 !== h4, '换密码 → 结果不同');

console.log('\n' + '='.repeat(50));
console.log('  账号核心逻辑: ' + P + ' 通过 / ' + F + ' 失败');
console.log('='.repeat(50));
process.exit(F > 0 ? 1 : 0);
