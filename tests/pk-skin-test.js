/* 临时：验证 PK 选骑手页"换皮肤"真的生效 */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9644, HP = 9188;
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
(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'sk-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1200,900', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(300); try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) { } }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime, Page } = c; await Runtime.enable(); await Page.enable();

  const errors = [];
  await c.on('Runtime.exceptionThrown', function (p) {
    errors.push('[异常] ' + ((p.exceptionDetails.exception || {}).description || p.exceptionDetails.text));
  });
  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await sleep(3000);

  console.log('======== PK 换皮肤验证 ========');

  /* 解锁所有角色（模拟老玩家，这样"我"也有得选）
   * ⚠️ 关键：角色解锁的真相源是 `data.unlockedCharacters`（角色 id 数组），
   *    **不是** `maxUnlocked` —— 只设 maxUnlocked 的话
   *    `listVisibleChars()` 照样只返回初始角色（我第一版就踩了这个）。 */
  await ev('(function(){ Save.reset(); Save.data.maxUnlocked = 11; var ids=[]; if (typeof listForLibrary === "function") listForLibrary().forEach(function(c){ ids.push(c.id); }); Save.data.unlockedCharacters = ids; Save.save(); return ids; })()');
  const unlockedCount = await ev('(function(){ return (typeof listVisibleChars === "function") ? listVisibleChars().length : -1; })()');
  console.log('  已解锁角色数: ' + unlockedCount);

  /* 进 PK 选骑手页 */
  await ev('gotoState(STATE.PK_PICK)'); await sleep(700);

  const before = await ev('(function(){ var n=document.querySelectorAll(".pk-vs-name"); return { mine: n[0]?n[0].textContent:"", ai: n[1]?n[1].textContent:"" }; })()');
  console.log('  初始: 我=' + before.mine + ' / AI=' + before.ai);

  /* 列出所有可选骑手 */
  const list = await ev('(function(){ var out=[]; document.querySelectorAll(".chars .cname").forEach(function(n){ out.push(n.textContent); }); return out; })()');
  console.log('  可选骑手: ' + list.join(' / '));
  ck(list.length >= 2, '至少有 2 个骑手可选（' + list.length + ' 个）');

  /* --- 点第 2 个骑手 --- */
  const click2 = await ev('(function(){ var b=document.querySelectorAll(".chars .char"); if(b.length<2) return false; b[1].click(); return true; })()');
  ck(click2, '点了第 2 个骑手');
  await sleep(700);

  const after = await ev('(function(){ var n=document.querySelectorAll(".pk-vs-name"); return { mine: n[0]?n[0].textContent:"", ai: n[1]?n[1].textContent:"", pickRole: Game.pickRole }; })()');
  console.log('  点击后: 我=' + after.mine + ' / AI=' + after.ai + '（Game.pickRole=' + after.pickRole + '）');
  ck(after.mine !== before.mine, '★★ 换皮肤**生效了**（' + before.mine + ' → ' + after.mine + '）');
  ck(after.mine === list[1], '★ 换成了点的那一个（期望「' + list[1] + '」）');
  ck(after.ai !== after.mine, '★★ AI 和你**仍然不是同一个骑手**（AI=' + after.ai + '）');

  /* --- 换一个对手 --- */
  const aiBefore = after.ai;
  const clicked = await ev('(function(){ var b=document.querySelectorAll("button"); for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf("换一个对手")>=0){ b[i].click(); return true; } } return false; })()');
  ck(clicked, '点了「换一个对手」');
  await sleep(700);
  const aiAfter = await ev('(function(){ var n=document.querySelectorAll(".pk-vs-name"); return { mine:n[0]?n[0].textContent:"", ai:n[1]?n[1].textContent:"" }; })()');
  console.log('  换对手: ' + aiBefore + ' → ' + aiAfter.ai);
  ck(aiAfter.ai !== aiAfter.mine, '★ 换对手后 AI 和你仍不同');
  /* 有 4 个角色时，"换一个"应该能换到别人 */
  if (list.length >= 3) {
    const tryMore = await ev('(function(){ var seen={}; for(var k=0;k<6;k++){ var b=document.querySelectorAll("button"); for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf("换一个对手")>=0){ b[i].click(); break; } } var n=document.querySelectorAll(".pk-vs-name"); seen[n[1]?n[1].textContent:""]=1; } return Object.keys(seen).length; })()');
    console.log('  连点 6 次换对手，出现过 ' + tryMore + ' 个不同的 AI');
    ck(tryMore >= 1, '★ 换对手有效（出现 ' + tryMore + ' 个不同 AI）');
  }

  /* --- 开跑，确认局内用的是我选的角色 --- */
  await ev('(function(){ var b=document.querySelectorAll("button"); for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf("开始 PK · 说跑就跑")>=0){ b[i].click(); return true; } } return false; })()');
  await sleep(300);
  const race = await ev('(function(){ var me=null, ai=null; Game.players.forEach(function(p){ if (Array.isArray(Game.aiRoles)&&Game.aiRoles.indexOf(p.role)>=0) ai=p; else me=p; }); return { meRole: me?me.role:null, aiRole: ai?ai.role:null, pkMy: Game.pkMyRole, spr: me && me.sprite ? (me.sprite.name||me.sprite.constructor.name) : null }; })()');
  console.log('  局内: 我=' + race.meRole + ' / AI=' + race.aiRole + '（pkMyRole=' + race.pkMy + '）');
  ck(race.meRole === after.pickRole, '★★ 局内用的是**我选的角色**（' + race.meRole + '）');
  ck(race.aiRole !== race.meRole, '★ 局内 AI 和我是不同角色');

  /* --- 截图 --- */
  const { data } = await Page.captureScreenshot({ format: 'png' });
  const dir = path.join(path.resolve(__dirname, '..'), 'dist', '_mod_shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pk-pick-real.png'), Buffer.from(data, 'base64'));
  console.log('    📷 dist/_mod_shots/pk-pick-real.png');

  console.log();
  console.log('======== 控制台错误 ========');
  if (errors.length) { errors.slice(0, 5).forEach(e => console.log('  ❌ ' + e)); }
  else console.log('  无错误 ✅');
  ck(errors.length === 0, '没有 console 异常');

  console.log();
  console.log('========================================');
  console.log('  PK 换皮肤验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  await c.close(); ch.kill(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
