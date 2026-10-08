/* 临时：真浏览器走完整 PK 流程（十一反馈的 4 点验证） */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9622, HP = 9166;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
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
  const tmp = path.join(process.env.TEMP || '/tmp', 'pkf-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,900', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(300); try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) { } }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime, Page } = c; await Runtime.enable(); await Page.enable();
  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await sleep(3000);

  const clickByText = async txt => {
    const ok = await ev('(function(){ var b=document.querySelectorAll("button"); for(var i=0;i<b.length;i++){ if(b[i].textContent.indexOf(' + JSON.stringify(txt) + ')>=0){ b[i].click(); return true; } } return false; })()');
    await sleep(700);
    return ok;
  };

  console.log('======== PK 完整流程（真浏览器）========');

  /* 先解锁几关（模拟老玩家），这样"随机地图"才有意义 */
  await ev('(function(){ Save.reset(); Save.data.maxUnlocked = 6; Save.save(); return true; })()');

  /* 1. 进「其他模式」→「开始 PK」 */
  await ev('gotoState(STATE.MENU)'); await sleep(400);
  ck(await clickByText('其他模式'), '点进「其他模式」');
  ck(await clickByText('开始 PK'), '点「开始 PK」');

  /* 2. 应该到"选骑手页" */
  const pick = await ev('(function(){ var txt = UI.root ? UI.root.innerText : ""; var vs = document.querySelector(".pk-vs"); return { state: Game.state, hasVs: !!vs, text: txt.slice(0,260).split(String.fromCharCode(10)).join(" | ") }; })()');
  ck(pick.state === 'pk_pick', '★ 到了 PK 选骑手页（state=' + pick.state + '）');
  ck(pick.hasVs, '★ 有「我 vs AI」的对战预览');
  console.log('    页面: ' + pick.text);

  /* 3. AI 随机抽到了谁 */
  const aiInfo = await ev('(function(){ var n = document.querySelectorAll(".pk-vs-name"); return { mine: n[0] ? n[0].textContent : "", ai: n[1] ? n[1].textContent : "" }; })()');
  ck(!!aiInfo.ai, '★ 页面上显示了 AI 是谁: 「' + aiInfo.ai + '」');
  ck(!!aiInfo.mine, '★ 页面上显示了你是: 「' + aiInfo.mine + '」');
  ck(aiInfo.mine !== aiInfo.ai, '★ AI 和你**不是同一个骑手**（' + aiInfo.mine + ' vs ' + aiInfo.ai + '）');

  /* 4. 换一个对手 */
  const beforeAi = aiInfo.ai;
  await clickByText('换一个对手');
  const afterAi = await ev('(function(){ var n=document.querySelectorAll(".pk-vs-name"); return n[1]?n[1].textContent:""; })()');
  console.log('    「换一个对手」: ' + beforeAi + ' → ' + afterAi);
  ck(!!afterAi, '★ 「换一个对手」后仍显示对手（' + afterAi + '）');

  /* --- 5. 开跑 --- */
  ck(await clickByText('开始 PK · 说跑就跑'), '点「开始 PK · 说跑就跑」');
  /* ⚠️ 别 sleep 太久：AI 一生成就开始跑了，等久了位置就变了 ——
   *    测"同一起跑线"必须读**刚生成那一刻**的坐标。
   *    做法：暂停主循环的推进（把 state 之外的更新停掉），立即读坐标。 */
  await ev('(function(){ Game.paused = true; return true; })()');
  await sleep(150);

  const race = await ev('(function(){ var me=null, ai=null; Game.players.forEach(function(p){ if (Array.isArray(Game.aiRoles) && Game.aiRoles.indexOf(p.role) >= 0) ai = p; else me = p; }); return { isPk: Game.isPk, state: Game.state, players: Game.players.length, aiRoles: Game.aiRoles, pkLevel: Game.pkLevelIndex, levelName: Game.level ? Game.level.name : "", meRole: me ? me.role : null, aiRole: ai ? ai.role : null, dx: (me&&ai) ? Math.round(Math.abs(me.x-ai.x)) : -1, dy: (me&&ai) ? Math.round(Math.abs(me.y-ai.y)) : -1, meX: me ? Math.round(me.x) : -1, aiX: ai ? Math.round(ai.x) : -1, spawnX: Math.round(Game.level.spawns[0].x) }; })()');
  console.log('    关卡: ' + race.levelName + '（index ' + race.pkLevel + '）');
  console.log('    玩家 ' + race.meRole + ' @x' + race.meX + ' / AI ' + race.aiRole + ' @x' + race.aiX + '（出生点 x' + race.spawnX + '）');
  ck(race.players === 2, '★★ 场上是 2 个角色（玩家 + AI）');
  ck(race.dx <= 40 && race.dy <= 4, '★★ 同一起跑线（水平差 ' + race.dx + 'px，高度差 ' + race.dy + 'px）');
  ck(Math.abs(race.meX - race.spawnX) <= 20 && Math.abs(race.aiX - race.spawnX) <= 20,
    '★★ 两人都在**出生点**上（不是各用一个出生点）');
  ck(race.meRole !== race.aiRole, '★ 玩家和 AI 用的是不同骑手');

  /* 恢复运行 */
  await ev('(function(){ Game.paused = false; return true; })()');

  /* 6. WASD 和方向键**各自独立**测（别连着测 —— 先按 WASD 会把人推到墙边，
   *    再按方向键就撞墙位移 0，那是测试方法的错，不是功能坏了） */
  await ev('(function(){ if (PK_RACE.current()) PK_RACE.current().countdown = 0; return true; })()');
  const wasd = await ev('(function(){ var me=null; Game.players.forEach(function(p){ if (!(Array.isArray(Game.aiRoles)&&Game.aiRoles.indexOf(p.role)>=0)) me=p; }); var x0 = me.x; for (var f=0;f<40;f++){ InputState.now={}; InputState.now["KeyD"]=true; update(1/60); InputState.tick(); } return Math.round(me.x - x0); })()');
  ck(wasd > 20, '★★ PK 里 WASD 能控制（位移 ' + wasd + 'px）');

  /* 用**新的一局**测方向键，避免上一段把位置推到墙边 */
  const arrow = await ev('(function(){ Game.mode="local"; Game.playerCount=2; loadLevel(Game.pkLevelIndex||0); Game.state="playing"; if (PK_RACE.current()) PK_RACE.current().countdown = 0; var me=null; Game.players.forEach(function(p){ if (!(Array.isArray(Game.aiRoles)&&Game.aiRoles.indexOf(p.role)>=0)) me=p; }); var x0 = me.x; for (var f=0;f<40;f++){ InputState.now={}; InputState.now["ArrowRight"]=true; update(1/60); InputState.tick(); } return Math.round(me.x - x0); })()');
  ck(arrow > 20, '★★ PK 里方向键也能控制（位移 ' + arrow + 'px，独立一局测的）');

  /* 7. 截图 */
  await ev('(function(){ for(var f=0;f<30;f++){ InputState.now={}; update(1/60); InputState.tick(); } return true; })()');
  await sleep(400);
  const { data } = await Page.captureScreenshot({ format: 'png' });
  const dir = path.join(path.resolve(__dirname, '..'), 'dist', '_mod_shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pk-same-start.png'), Buffer.from(data, 'base64'));
  console.log('    📷 dist/_mod_shots/pk-same-start.png');

  /* 8. 退出 PK → **走真实的"开始跑单"路径** → 不能变成 AI 赛跑
   * ⚠️ 必须走 startGame（真实入口），而不是直接 loadLevel ——
   *    清理是 startGame 的职责（它是 PK 状态的唯一设置点）。
   *    直接调 loadLevel 相当于"绕过所有入口"，那是测试方法不对。 */
  const leak = await ev('(function(){ Game.mode="single"; Game.playerCount=1; Game.skipWeatherBrief=true; startGame(0); Game.skipWeatherBrief=false; return { players: Game.players.length, isPk: Game.isPk, aiRoles: Game.aiRoles, pkMyRole: Game.pkMyRole, aiCount: Object.keys(InputState.aiInput).length, state: Game.state }; })()');
  ck(leak.players === 1, '★★★ 普通开始跑单**只有 1 个角色**（没变成 AI 赛跑）');
  ck(leak.isPk === false, '★★★ isPk 被复位');
  ck(leak.aiRoles === null && leak.aiCount === 0 && leak.pkMyRole === null,
    '★★★ PK 状态彻底清掉了');

  console.log();
  console.log('========================================');
  console.log('  PK 完整流程: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  await c.close(); ch.kill(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
