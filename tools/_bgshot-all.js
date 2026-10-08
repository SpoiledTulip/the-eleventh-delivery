/* ============================================================
 * _bgshot-all.js — 给第 13~20 关各截一张图（诊断工具）
 * ============================================================
 * 用途：背景重构后，逐关截图，再用 `tools/_bgshot.js` 算配色指纹，
 *       以及人眼/OCR 复核"是不是真的不一样了"。
 *
 * 输出：dist/_bg_shots/ch3-levelNN.png（+ 第 20 关六阶段各一张）
 * ============================================================ */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const OUT = path.resolve(__dirname, '..', 'dist', '_bg_shots');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9766, HP = 9333;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
};
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

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'bgshot-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--window-size=1200,860', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });

  let tg = null;
  for (let i = 0; i < 50; i++) {
    await sleep(300);
    try { const l = await CDP.List({ port: PORT }); tg = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (tg) break; } catch (e) { }
  }
  const c = await CDP({ target: tg, port: PORT });
  const { Runtime, Page } = c; await Runtime.enable(); await Page.enable();
  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  await sleep(2500);
  await ev('(function(){ document.querySelectorAll(".overlay,.panel,#splash").forEach(function(n){ n.style.display="none"; }); if(window.STATE) Game.state=STATE.PLAYING; return 1; })()');

  const shot = async (id, tag) => {
    /* ⚠️⚠️ loadLevel 收的是**索引**，不是关卡 id。
     *     而且不能用 "总数 - 8 + (id-13)" 这种算式 ——
     *     实测项目里已经有 **30 关**（id 21~30 也已经存在），
     *     13~20 并不在数组末尾！
     *     ⇒ 唯一可靠的做法：**按 id 反查索引**。
     *     （踩过这个坑：8 张截图全是错的关，配色指纹却"看起来很成功"） */
    const loadExpr = '(function(){' +
      'var list=PLAYABLE_LEVELS();' +
      'var idx=-1; for(var i=0;i<list.length;i++){ if(list[i].id===' + id + '){idx=i;break;} }' +
      'if(idx<0) return -1;' +
      'loadLevel(idx); Game.state=STATE.PLAYING;' +
      'return PLAYABLE_LEVELS()[idx].id; })()';
    const gotId = await ev(loadExpr);
    if (gotId !== id) { console.log('  ❌ 第' + id + '关载入失败（拿到 id=' + gotId + '）'); return; }
    await sleep(900);
    /* 让背景动画跑几帧（雨/云要有动作） */
    await ev('(function(){ for(var i=0;i<40;i++){ if(typeof update==="function") update(1/60); } return 1; })()');
    await sleep(400);
    /* 把 HUD 藏掉 —— 验收要求"隐藏关卡标题和 HUD 后仍能区分" */
    await ev('(function(){ document.querySelectorAll("#hud,.hud,.hud-root,.ch3-hint,#ch3-hint").forEach(function(n){ n.style.display="none"; }); Game.message=""; return 1; })()');
    await sleep(120);
    const r = await Page.captureScreenshot({ format: 'png' });
    fs.writeFileSync(path.join(OUT, 'ch3-level' + id + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📷 ch3-level' + id + '.png' + (tag ? '  (' + tag + ')' : ''));
  };

  for (let id = 13; id <= 20; id++) {
    try { await shot(id, ''); } catch (e) { console.log('  ❌ 第' + id + '关截图失败: ' + e.message.slice(0, 90)); }
  }

  /* 第 20 关：六阶段各一张（把玩家 x 推到各阶段起点） */
  console.log('  ── 第 20 关六阶段 ──');
  const stageX = [0, 900, 1800, 2600, 3400, 4500];
  for (let i = 0; i < stageX.length; i++) {
    try {
      await ev('(function(){var list=PLAYABLE_LEVELS();var idx=-1;for(var i=0;i<list.length;i++){if(list[i].id===20){idx=i;break;}}loadLevel(idx);Game.state=STATE.PLAYING;return 1;})()');
      await sleep(700);
      await ev('(function(){ var x=' + stageX[i] + '; Game.players.forEach(function(p){ p.x=x; p.spawnX=x; }); Game.camera.x=Math.max(0,x-480); return 1; })()');
      await sleep(700);
      await ev('(function(){ document.querySelectorAll("#hud,.hud,.hud-root").forEach(function(n){ n.style.display="none"; }); Game.message=""; return 1; })()');
      await sleep(150);
      const r = await Page.captureScreenshot({ format: 'png' });
      fs.writeFileSync(path.join(OUT, 'ch3-l20-stage' + (i + 1) + '.png'), Buffer.from(r.data, 'base64'));
      console.log('  📷 ch3-l20-stage' + (i + 1) + '.png');
    } catch (e) { console.log('  ❌ 阶段' + (i + 1) + '截图失败: ' + e.message.slice(0, 90)); }
  }

  await c.close(); ch.kill(); server.close();
  console.log('\n输出目录: ' + OUT);
  process.exit(0);
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
