/* ============================================================
 * online-test.js — 联机功能专项测试
 * ============================================================
 * 十一反馈："和朋友玩不到异地联机，一直显示云SDK未加载"
 *
 * 这个测试要回答两个问题：
 *   1. SDK 到底有没有加载成功？（三个 CDN 源哪个通）
 *   2. file:// 协议下，云服务 endpoint 能否真正连通？
 *      （云端可能校验 Origin，file:// 的 Origin 是 null）
 *
 * 用真实 Chrome 打开真实的单文件（file://），
 * 实际调用 hostRoom() 建房，看云端返回什么。
 * ============================================================ */

const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const path = require('path');

/* ============================================================
 * ★ 路径常量（迁移后新增）★
 * ============================================================
 * 本项目结构：
 *   <项目根>/
 *     src/    ← index.html + js/ + assets/（源码）
 *     tests/  ← 本文件所在
 *     tools/  ← 构建脚本
 *     dist/   ← 单文件发布版
 *
 * 测试脚本住在 tests/ 里，要读 src/js 和 dist。
 * 下面这几个常量全部基于 __dirname 推算，
 * **不依赖当前工作目录** —— 从任何地方 node 都能跑。
 * ============================================================ */
const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const DIST = path.join(PROJ, 'dist');

const fs = require('fs');

const CHROME = 'C:\\Users\\spoiled tulip\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9345;

const FILE = process.argv[2] || path.join(PROJ, 'dist', '第十一单外卖-单文件版.html');
if (!fs.existsSync(FILE)) { console.log('X 文件不存在: ' + FILE); process.exit(1); }
const FILE_URL = 'file:///' + FILE.replace(/\\/g, '/');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const results = [];
function log(name, val) { results.push({ name: name, val: val }); console.log('  ' + name + ': ' + val); }

(async function main() {
  console.log('联机功能诊断');
  console.log('文件: ' + FILE, '\n');

  const userDir = path.join(require('os').tmpdir(), 'chrome-online-test-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--no-proxy-server',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--window-size=1280,800',
    FILE_URL,
  ], { stdio: 'ignore' });

  let client;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { client = await CDP({ port: PORT }); break; } catch (e) {}
  }
  if (!client) { console.log('X 连不上 Chrome'); chrome.kill(); process.exit(1); }

  try {
    const targets = await CDP.List({ port: PORT });
    const want = targets.filter(t => t.type === 'page').find(t => t.url && t.url.indexOf('.html') >= 0);
    if (want && want.id !== client._targetId) {
      await client.close();
      client = await CDP({ port: PORT, target: want.id });
    }
  } catch (e) {}

  const { Runtime, Console } = client;
  await Promise.all([Runtime.enable(), Console.enable()]);

  const netErrors = [];
  Console.messageAdded(function (m) {
    var t = m.message.text || '';
    if (t.indexOf('jsdelivr') >= 0 || t.indexOf('unpkg') >= 0 ||
        t.indexOf('cloud-sdk') >= 0 || t.indexOf('CORS') >= 0 ||
        t.indexOf('net::') >= 0) {
      netErrors.push('[' + m.message.level + '] ' + t);
    }
  });

  async function evalJs(expr, timeoutMs) {
    const r = await Runtime.evaluate({
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      return { __err: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text };
    }
    return r.result.value;
  }

  /* 给 SDK 加载留足时间（多源降级：最坏情况 6s × 3） */
  console.log('=== 等待云 SDK 加载（最多 25 秒）===');
  let sdkReady = false;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    sdkReady = await evalJs('!!(window.WorkBuddyCloud && window.WorkBuddyCloud.createWorkBuddyCloud)');
    if (sdkReady) { console.log('  ✅ SDK 在第 ' + (i + 1) + ' 秒加载成功'); break; }
  }
  if (!sdkReady) console.log('  ❌ 25 秒内 SDK 未加载成功');

  console.log('\n=== 1. 基础状态 ===');
  log('页面协议', await evalJs('location.protocol'));
  log('SDK 可用', sdkReady);
  log('Net.clientId', await evalJs('Net.clientId || "(空)"'));
  log('Net.lastError', await evalJs('Net.lastError || "(无)"'));
  log('cloudClient 已创建', await evalJs('typeof cloudClient !== "undefined" && !!cloudClient'));

  console.log('\n=== 2. CLOUD_CONFIG 内容 ===');
  var cfg = await evalJs('JSON.stringify(window.CLOUD_CONFIG)');
  log('配置', cfg);

  console.log('\n=== 3. 实际尝试建房（关键测试）===');
  if (!sdkReady) {
    console.log('  ⚠️ SDK 没加载，跳过建房测试');
  } else {
    var hostResult = await evalJs(`(function(){
      return hostRoom(window.CLOUD_CONFIG).then(function(code){
        return { ok: true, code: code, err: Net.lastError || null, status: Net.statusText };
      }).catch(function(e){
        return { ok: false, throw: String(e && e.message ? e.message : e), err: Net.lastError || null };
      });
    })()`);
    console.log('  建房结果: ' + JSON.stringify(hostResult));
    log('是否成功建房', hostResult && hostResult.ok ? '✅ 成功，房间码 ' + hostResult.code : '❌ 失败');
    if (hostResult && !hostResult.ok) {
      log('失败原因', hostResult.err || hostResult.throw || '(未知)');
    }
  }

  console.log('\n=== 4. 网络层错误 ===');
  if (netErrors.length) {
    netErrors.slice(0, 12).forEach(function (e) { console.log('  ' + e); });
  } else {
    console.log('  (无 SDK/CDN 相关错误)');
  }

  console.log('\n=== 5. 结论 ===');
  if (sdkReady && results.some(function (r) { return r.name.indexOf('是否成功建房') >= 0 && String(r.val).indexOf('成功') >= 0; })) {
    console.log('  ✅ file:// 下联机可用！云服务接受了 null-origin 请求');
  } else if (sdkReady) {
    console.log('  ⚠️ SDK 加载成功，但建房失败 → 云端可能校验 Origin');
    console.log('     → 建议用在线网址联机');
  } else {
    console.log('  ❌ SDK 加载失败 → CDN 全挂，需要把 SDK 也内联进单文件');
  }

  try { await client.close(); } catch (e) {}
  chrome.kill();
  process.exit(0);
})().catch(function (e) {
  console.log('测试崩溃: ' + (e && e.stack || e));
  process.exit(1);
});
