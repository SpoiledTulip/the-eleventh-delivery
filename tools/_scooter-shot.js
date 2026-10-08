/* 截一张"正在借车加速"的图 —— 看车、电量条、倒计时条长什么样 */
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9821, HP = 9388;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(SRC, p);
  fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'shot-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1280,720', 'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });
  let tg = null;
  for (let i = 0; i < 60; i++) { await sleep(300); try { const l = await CDP.List({ port: PORT }); tg = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (tg) break; } catch (e) { } }
  const c = await CDP({ target: tg, port: PORT }); const { Runtime, Page } = c;
  await Runtime.enable(); await Page.enable();
  const ev = async e => { const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true }); return r.result.value; };
  await sleep(2600);
  await ev(`(function(){ try{ if(typeof DEVICE!=='undefined'&&DEVICE.set) DEVICE.set('pc'); }catch(e){}
    document.querySelectorAll('.overlay,.panel,#splash,#device-pick').forEach(function(n){n.style.display='none';});
    document.querySelectorAll('#hud,.hud,.hud-root,#ch3-hint').forEach(function(n){n.style.display='none';});
    return 1; })()`);
  const OUT = path.resolve(__dirname, '..', 'dist', '_scooter_shots');
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const shot = async (name) => {
    const r = await Page.captureScreenshot({ format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📷 ' + name + '.png');
  };

  /* 第 1 关（有外卖车）—— 找到车，把玩家挪到车旁边 */
  await ev('loadLevel(0); Game.state = STATE.PLAYING;');
  await sleep(800);
  const placed = await ev(`(function(){
    var d = SCOOTER.current();
    if (!d.bikes.length) return null;
    var b = d.bikes[0], p = Game.players[0];
    p.x = b.x - 30; p.spawnX = p.x;
    p.y = b.y - 4;
    Game.camera.x = Math.max(0, p.x - 480);
    for (var i=0;i<40;i++) update(1/60);
    return { pfx: p.x, bikeX: b.x, timer: p.boostTimer, charge: b.charge };
  })()`);
  console.log('  放置结果:', JSON.stringify(placed));
  await sleep(400);
  await shot('scooter-boost');

  /* 把加速点亮得更满 + 玩家跑到车后面一点，看得清两条条 */
  await ev(`(function(){
    var p = Game.players[0]; p.boostTimer = 200;
    var d = SCOOTER.current(); if (d.bikes[0]) p.boostFrom = d.bikes[0];
    for (var i=0;i<6;i++) update(1/60);
    return 1;
  })()`);
  await sleep(300);
  await shot('scooter-boost-gauge');

  /* 没电的车长什么样 */
  await ev(`(function(){
    var d = SCOOTER.current(); if (d.bikes[0]) d.bikes[0].charge = 0;
    var p = Game.players[0]; p.boostTimer = 0; p.boostFrom = null;
    for (var i=0;i<6;i++) update(1/60);
    return 1;
  })()`);
  await sleep(300);
  await shot('scooter-dead');

  await c.close(); ch.kill(); server.close();
  console.log('  输出目录: ' + OUT);
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
