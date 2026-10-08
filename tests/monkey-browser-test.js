/* ============================================================
 * monkey-browser-test.js — 美团猴子 · 真浏览器验证
 * ============================================================
 * 验证"十一真正会看到的东西"：
 *   ① monkey.png 在浏览器里真的加载成功（不是"注册了但图挂了"）
 *   ② 通关第 5 关 → **解锁弹窗里出现猴子**（这是"打完第五关就有"的体感）
 *   ③ 选中猴子 → 角色库/选人页显示猴子
 *   ④ 进关后玩家真的是猴子，取到的贴图是 monkey.png
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C://Users//spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9677, HP = 9222;
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
  const tmp = path.join(process.env.TEMP || '/tmp', 'mk-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1200,800', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });
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
  await sleep(3500);

  console.log('======== 美团猴子 · 真浏览器验证 ========');

  /* ---- ① 贴图真的加载成功 ---- */
  const loaded = await ev('(function(){ var o={}; Object.keys(SPRITE_IMAGES).forEach(function(k){ o[k]=SPRITE_IMAGES[k].ready; }); return o; })()');
  console.log('  贴图加载: ' + JSON.stringify(loaded));
  ck(loaded.monkey === true, '★★ monkey.png 在浏览器里**真的加载成功了**');
  ck(Object.keys(loaded).length === 5, 'SPRITE_IMAGES 里有 5 个角色（' + Object.keys(loaded).join(',') + '）');

  /* ---- ② 通关第 5 关 → 解锁弹窗里出现猴子 ---- */
  const unlock = await ev(`(function(){
    Save.reset();                    // 新档
    Save.data.maxUnlocked = 4;       // 已通关到第 4 关
    /* 模拟"刚通关第 5 关" */
    var got = charsUnlockedBy(4, Save.unlockedChars());
    return got.map(function(c){ return { id:c.id, name:c.name, ready:c.ready }; });
  })()`);
  console.log('  通关第 5 关解锁: ' + JSON.stringify(unlock));
  ck(unlock.length === 1 && unlock[0].id === 'monkey',
    '★★ 通关第 5 关解锁的正是「' + (unlock[0] ? unlock[0].name : '?') + '」');
  ck(unlock[0] && unlock[0].name === '美团猴子', '★ 名字显示为「美团猴子」');
  ck(unlock[0] && unlock[0].ready === true, '★ ready=true（会真的弹解锁动画）');

  /* ---- ③ 角色库/选人页能看见猴子 ---- */
  const lib = await ev(`(function(){
    Save.reset();
    Save.data.maxUnlocked = 11;
    var ids = [];
    listForLibrary().forEach(function(c){ ids.push(c.id); });
    Save.data.unlockedCharacters = ids;
    Save.save();
    var vis = listVisibleChars().map(function(c){ return c.id; });
    return { vis: vis, inLib: (typeof listForLibrary === 'function') ? listForLibrary().map(function(c){ return c.id; }) : [] };
  })()`);
  console.log('  解锁全部后可见角色: ' + JSON.stringify(lib.vis));
  ck(lib.vis.indexOf('monkey') >= 0, '★★ 解锁后猴子出现在选人页');
  ck(lib.inLib.indexOf('monkey') >= 0, '★ 猴子在正式角色库里');

  /* ---- ④ 选中猴子 → 进关画的是猴子 ---- */
  const ingame = await ev(`(function(){
    Save.data.selectedCharacter = 'monkey';
    Save.save();
    Game.mode='single'; Game.playerCount=1;
    Game.isPk=false; Game.aiRoles=null; Game.pkMyRole=null;
    if (InputState.clearAI) InputState.clearAI();
    Game.skipWeatherBrief = true;
    startGame(0);
    Game.skipWeatherBrief = false;
    for (var i=0;i<20;i++){ update(1/60); InputState.tick(); }
    var p = Game.players[0];
    var slot = p ? getSpriteImage(p.role) : null;
    return {
      sel: Save.selectedChar(), role: p ? p.role : null,
      src: slot ? slot.src : '(无)',
      wallJumpMul: p ? p.wallJumpMul : null,
      tagline: (charByRole(p.role) || {}).tagline || '',
    };
  })()`);
  console.log('  局内: 选中=' + ingame.sel + ' role=' + ingame.role + ' 贴图=' + ingame.src);
  console.log('        墙跳倍率=' + ingame.wallJumpMul + '  标语=' + ingame.tagline);
  ck(ingame.sel === 'monkey', '★ 存档选中 monkey');
  ck(ingame.role === 'monkey', '★★ 局内玩家真的是 monkey（不是袋鼠）');
  ck(/monkey\.png$/.test(ingame.src), '★★ 取到的贴图是 monkey.png');
  ck(ingame.wallJumpMul === 1.4, '★ 墙跳加成跟着进关了（' + ingame.wallJumpMul + '）');

  /* ---- 截图 ---- */
  await sleep(600);
  const { data } = await Page.captureScreenshot({ format: 'png' });
  const dir = path.join(path.resolve(__dirname, '..'), 'dist', '_mod_shots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'monkey-ingame.png'), Buffer.from(data, 'base64'));
  console.log('  📷 dist/_mod_shots/monkey-ingame.png');

  console.log();
  console.log('======== 控制台错误 ========');
  if (errors.length) { errors.slice(0, 5).forEach(e => console.log('  ❌ ' + e)); }
  else console.log('  无错误 ✅');
  ck(errors.length === 0, '没有 console 异常');

  console.log();
  console.log('========================================');
  console.log('  美团猴子验证: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');
  await c.close(); ch.kill(); server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  process.exit(FAIL > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
