/* ============================================================
 * coop-interp-test.js — 联机「副骑手卡顿」专项防回归（离线，不依赖云）
 * ============================================================
 * 十一反馈（2026-10-07）：
 *   "主骑手运行流畅不卡顿，但副骑手端非常卡顿。"
 *   "副骑手在操作的过程中非常卡顿，很难控制。"
 *
 * 【根因（实测抓到的）】
 *   `applyRemoteState()` 里对"对方角色"的位置校正 `local.x += 误差 * 系数`
 *   **每帧都做**。快照到达那一帧误差最大 ⇒ 位移被顶高；
 *   之后误差变小 ⇒ 位移回落 ⇒ 位移曲线呈"呼吸式"抽动。
 *   真浏览器实测：位移变异系数 **CV = 0.594（59%）**。
 *
 * 【修法】改成"独立偏移量 + 指数收敛"：
 *     显示位置 = 纯速度推进的预测位置 + 校正偏移量
 *   偏移量在快照到达时重新设定目标，之后平滑收敛 ⇒ **零尖峰**。
 *
 * 【本测试做什么】
 *   在浏览器里构造一个"客人端 + 远端骑手匀速移动"的场景，
 *   逐帧记录远端角色的位移，断言：
 *     ① 位移变异系数 CV 足够小（平滑，不抽动）
 *     ② 平均位移正确（没有因为优化而变慢/变快）
 *     ③ 没有倒退（位移恒为正）
 *     ④ 累计位置正确跟随（不漂移）
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs'), http = require('http');

const SRC = path.resolve(__dirname, '..', 'src');
const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9761, HP = 9301;
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
let PASS = 0, FAIL = 0;
function ck(ok, msg, extra) {
  if (ok) { console.log('  ✅ ' + msg); PASS++; }
  else { console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); FAIL++; }
}

(async () => {
  await new Promise(r => server.listen(HP, '127.0.0.1', r));
  const tmp = path.join(process.env.TEMP || '/tmp', 'ci-' + Date.now());
  const ch = spawn(CHROME, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + tmp,
    '--headless=new', '--no-first-run', '--window-size=1180,820',
    'http://127.0.0.1:' + HP + '/index.html'], { stdio: 'ignore' });

  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { const l = await CDP.List({ port: PORT }); t = l.find(x => x.type === 'page' && x.url.includes('index.html')); if (t) break; } catch (e) {}
  }
  if (!t) { console.error('❌ 打不开页面'); process.exit(1); }
  const c = await CDP({ target: t, port: PORT });
  const { Runtime } = c; await Runtime.enable();
  await sleep(3500);

  const ev = async e => {
    const r = await Runtime.evaluate({ expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' +
      (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  console.log('======== 副骑手插值平滑度（离线）========');

  const result = await ev(`(function(){
    try {
      DEVICE.set('mobile');
      Save.reset(); Save.data.maxUnlocked = 30; Save.save();
      ['doublejump','wallslide','walljump','dash'].forEach(function(a){ try{ SAVE().unlockAction(a); }catch(e){} });

      /* 构造"联机客人"场景：2 人关卡 + mode=online + role=guest */
      Game.mode = 'online'; Net.role = 'guest';
      Game.levelIndex = 4; Game.playerCount = 2;
      loadLevel(4); Game.state = STATE.PLAYING;

      var hostX = 300, hostVx = 3, snapN = 0;
      function snap(){
        snapN++;
        return {
          levelIndex: Game.levelIndex, coinsTaken:0, coinsTotal:1, coinsRequired:1,
          gameState: STATE.PLAYING,
          players: [
            { role:'kangaroo', x: hostX, y:500, vx:hostVx, vy:0, dir:1, hearts:3,
              onGround:true, invuln:0, squash:1, atGoal:false },
            { role:'dragon', x:200, y:500, vx:0, vy:0, dir:1, hearts:3,
              onGround:true, invuln:0, squash:1, atGoal:false }
          ],
          buttons:[], doorOpen:[], coinsTakenIdx:[], enemiesDead:[],
          bridges:[], wallsBroken:[], bombs:[], bombTimers:[], seesawAngles:[]
        };
      }

      var other = Game.players.find(function(p){ return p.role === 'kangaroo'; });
      other.x = hostX;
      Net._lastSeq = 0;
      Net.remoteState = snap();

      /* 预热到稳态 */
      for (var w = 0; w < 30; w++) { hostX += hostVx; applyRemoteState(1/60); }

      /* 采集 180 帧（3 秒），快照每 10 帧（≈160ms）到一次 */
      var steps = [];
      var lastX = other.x;
      var x0 = other.x;
      for (var i = 0; i < 180; i++) {
        if (i > 0 && i % 10 === 0) { Net._lastSeq++; Net.remoteState = snap(); }
        hostX += hostVx;
        applyRemoteState(1/60);
        steps.push(other.x - lastX);
        lastX = other.x;
      }

      function avg(a){ var s=0; for(var k=0;k<a.length;k++) s+=a[k]; return s/a.length; }
      function std(a){ var m=avg(a), s=0; for(var k=0;k<a.length;k++) s+=(a[k]-m)*(a[k]-m); return Math.sqrt(s/a.length); }
      var minStep = Math.min.apply(null, steps);
      var totalMoved = other.x - x0;
      var hostMoved = hostX - (300 + 30*hostVx);   // 采集期房主走了多少

      return {
        stepAvg: +avg(steps).toFixed(4),
        stepStd: +std(steps).toFixed(4),
        cv: +(std(steps) / Math.max(0.0001, Math.abs(avg(steps)))).toFixed(4),
        minStep: +minStep.toFixed(3),
        maxStep: +Math.max.apply(null, steps).toFixed(3),
        totalMoved: +totalMoved.toFixed(1),
        hostMoved: +hostMoved.toFixed(1),
        drift: +(totalMoved - hostMoved).toFixed(1),
        sample: steps.slice(5, 18).map(function(v){ return +v.toFixed(3); }),
      };
    } catch (e) { return { err: String(e && e.message ? e.message : e) }; }
  })()`);

  console.log('   测量:', JSON.stringify(result));
  if (result.err) { console.log('  ❌ 测量失败: ' + result.err); FAIL++; }
  else {
    /* ① 平滑度：CV 必须很小。
     *   ⚠️ 阈值 0.10 是"优化后实测 0.001"与"优化前实测 0.594"之间的安全分界。
     *      取 0.10 留了 100 倍余量，但依然远小于 0.594 ⇒ 真出问题一定抓得住。 */
    ck(result.cv <= 0.10, '★★★ 位移变异系数 CV ≤ 0.10（平滑不抽动）',
      'CV=' + result.cv + '（优化前实测 0.594）');
    /* ② 平均位移正确：房主 3px/帧，客人端应基本一致（允许 ~5% 误差） */
    ck(Math.abs(result.stepAvg - 3) < 0.15, '★★ 平均每帧位移 ≈ 3px（速度正确）',
      'avg=' + result.stepAvg);
    /* ③ 不倒退：优化中曾出现 -4.7px 的倒退（校正打架） */
    ck(result.minStep >= 0, '★★★ 没有倒退（每帧位移恒为正）',
      'min=' + result.minStep);
    /* ④ 不漂移：累计位置要跟上房主 */
    ck(Math.abs(result.drift) <= 3, '★★ 不累积漂移（终点位置对得上房主）',
      'drift=' + result.drift + 'px');
  }

  console.log('\n========================================');
  console.log('  副骑手插值测试: ' + PASS + ' 通过 / ' + FAIL + ' 失败');
  console.log('========================================');

  try { ch.kill(); } catch (e) {}
  process.exit(FAIL === 0 ? 0 : 1);
})();
