/* ============================================================
 * build-single.js — 把多文件游戏打包成「单文件 HTML」
 * ============================================================
 * 为什么需要这个：
 *
 *   原来的游戏是「index.html + 10 个 js 文件 + 3 张图片」，
 *   一共 15 次网络请求。手机（微信内置浏览器）和其他电脑上
 *   经常打不开 —— 只要有一次请求失败、或者微信拦截了相对路径
 *   资源，页面就白屏。
 *
 *   而十一那个能正常打开的「气象飞机大作战」是**单文件**：
 *   HTML/CSS/JS 全部内联，0 次外部请求，怎么传都能开。
 *
 *   所以这里照抄那个思路：把所有 js 内联进 <script>，
 *   把图片转成 base64 data URI 内嵌，产出一个自包含的 .html。
 *
 * 产出：dist/第十一单外卖-单文件版.html
 * ============================================================ */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------
 * 路径约定（迁移后新增，很重要）
 * ------------------------------------------------------------
 * 本项目现在分成了 src/ tests/ tools/ dist/ docs/ 几个子目录。
 * 这个脚本住在 tools/ 里，而它要读的源码在 src/、产物要写到 dist/。
 *
 * 所以：
 *   PROJ  = 项目根（tools 的上一级）—— 用来拼 dist/ 等
 *   SRC   = 源码根（PROJ/src）—— index.html、js/、assets/ 都在这下面
 *
 * ⚠️ 全部基于 __dirname 推算（而不是 process.cwd），
 *    这样无论在哪个目录敲命令都能跑：
 *      node tools/build-single.js           ← 从项目根
 *      cd tools && node build-single.js     ← 从 tools 里
 *    两种情况结果完全一样。
 * ------------------------------------------------------------ */
const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const OUT_DIR = path.join(PROJ, 'dist');
const OUT_FILE = path.join(OUT_DIR, '第十一单外卖-单文件版.html');

/* 读源码文件（相对 src/） */
function read(p) { return fs.readFileSync(path.join(SRC, p), 'utf8'); }
function readBuf(p) { return fs.readFileSync(path.join(SRC, p)); }

let html = read('index.html');
const report = [];

/* ------------------------------------------------------------
 * 1. 内联所有 <script src="js/xxx.js"></script>
 * ------------------------------------------------------------
 * 逐个替换成 <script>文件内容</script>。
 * ⚠️ 注意顺序：必须保持原有顺序，因为后面依赖前面（levels → sprites → ... → ui）。
 * ------------------------------------------------------------ */
const scriptTagRe = /<script\s+src="(js\/[^"]+)"\s*><\/script>/g;
html = html.replace(scriptTagRe, function (m, src) {
  let code = read(src);
  /* 防止内联脚本里出现 </script> 把标签提前闭合（字符串常量里可能有） */
  code = code.replace(/<\/script>/gi, '<\\/script>');
  report.push('  内联 ' + src + ' (' + code.length + ' 字节)');
  return '<script>\n/* ===== inlined: ' + src + ' ===== */\n' + code + '\n</script>';
});

/* ------------------------------------------------------------
 * 2. 内联图片：assets/xxx.png → base64 data URI
 * ------------------------------------------------------------
 * 图片是通过 JS 里的字符串路径引用的（sprites.js 里的 src: 'assets/kangaroo.png'），
 * 所以直接在全文里做字符串替换 —— 把 'assets/xxx.png' 换成 data URI。
 * ------------------------------------------------------------ */
const imgFiles = [
  'kangaroo.png', 'dragon.png', 'capybara.png', 'stitch.png',
  /* ★ 2026-10-06 新增：美团猴子（第五个角色）★
   * ⚠️⚠️ 加角色时**这个清单必须一起改** —— 漏了的话单文件版里
   *     `assets/monkey.png` 会保留成"相对路径"，
   *     而单文件版是发给朋友、不带 assets/ 目录的 →
   *     **猴子的图加载不出来**（会退回代码像素画或干脆不显示）。
   *     src 版（内测）不会有这个问题，所以**只有发出去才会暴露**，
   *     是很容易漏掉的一步。 */
  'monkey.png',
  /* ★ 2026-10-06 补：第 6~8 个角色的贴图 ★
   * · fish.png  —— 小鱼（第 14 关解锁，跑得最快）
   * · puppy.png —— 小狗（第 17 关解锁，全能）
   * · lamb.png  —— 小羊（第 20 关解锁，墙跳最高）
   * ⚠️ 又是同一个坑：漏了的话 **src 版完全正常**（assets/ 就在旁边），
   *    只有**发给朋友的单文件版**会加载失败、退回代码像素画。
   *    这次是靠下面那段**自动校验**抓出来的（构建时直接报错）。 */
  'fish.png', 'puppy.png', 'lamb.png',
  /* ★ 2026-10-07 补：第 9~10 个角色的贴图 ★
   * · nick.png —— 尼克（狐狸，第 25 关解锁，二段跳最强）
   * · judy.png —— 朱迪（兔子，第 30 关解锁，能连冲两发）
   * ⚠️ 老规矩：漏了的话 src 版正常，只有单文件版会缺图。 */
  'nick.png', 'judy.png',
  /* ★ 2026-10-07 补：第 11 个角色 ★
   * · pinkiepie.png —— 碧琪（粉色小马，兑换码「十一的碧琪宝宝」解锁）*/
  'pinkiepie.png',
  /* ★ 2026-10-07 补：第 12 个角色「十一」★
   * · pink-stitch.png —— 十一（粉色史迪仔·甜品主题，兑换码 `11` 解锁）*/
  'pink-stitch.png',
  /* ★ 2026-10-07 补：第 13 个角色「噜噜」★
   * · lulu.png —— 噜噜（恐龙装水豚，兑换码「宁宁」解锁，招牌能力"落速最慢"）
   * ⚠️⚠️ **这个坑踩过好几次了**：在 `sprites.js` 里写了
   *    `src: 'assets/xxx.png'` 之后，**必须**来这里加一行。
   *    两条清单一一对应，少一条的症状是：
   *      src 版（内测）完全正常，只有**发给朋友的单文件版**
   *      加载不到这个角色的贴图 ⇒ 退回代码像素画/不显示。
   *    ✅ 好消息：构建脚本下面有**自动校验**，漏了会当场报出来
   *       （`assets/xxx.png ← 文件存在，但没进 imgFiles 清单`），
   *       所以只要打包一次就能发现。 */
  'lulu.png',
  'bag-preview.png',
  /* ★ 2026-10-06 新增（AI 生成的像素图，共约 40 KB）★
   * · receiver.png —— 会点头的收餐人（站在终点门洞里）
   * · scooter.png  —— 电动车（骑上加速）
   * · charger.png  —— 充电桩（给电动车补电）
   * ⚠️ 这三个是"可选装饰"，**加载失败必须能优雅降级**
   *    （收餐人退回代码画的抽象小人、电动车干脆不出现），
   *    所以它们在代码里都走 `typeof img !== 'undefined' && img.ready` 判断。 */
  'receiver.png', 'scooter.png', 'charger.png',
];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

imgFiles.forEach(function (name) {
  const rel = 'assets/' + name;
  const abs = path.join(SRC, rel);
  if (!fs.existsSync(abs)) return;
  const buf = readBuf(rel);
  const mime = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
  const dataUri = 'data:' + mime + ';base64,' + buf.toString('base64');

  /* 同时替换单引号和双引号两种写法 */
  const before = html.length;
  html = html.split("'" + rel + "'").join("'" + dataUri + "'");
  html = html.split('"' + rel + '"').join('"' + dataUri + '"');
  report.push('  内嵌 ' + rel + ' (' + Math.round(buf.length / 1024) + 'KB → base64)');
});

/* ============================================================
 * ★★ 2.5 自动校验：有没有"漏内嵌"的图片（2026-10-06 加）★★
 * ============================================================
 * 【为什么要这一段】
 *   加美团猴子时我**又差点漏了** `monkey.png`（那个 imgFiles 清单）。
 *   这个漏法很阴险：
 *     · src 版（内测）**完全正常** —— 因为 assets/ 目录在旁边
 *     · **只有单文件版会坏** —— 它是发给朋友、不带 assets/ 的
 *   ⇒ 也就是说，**开发和自测都发现不了，只有朋友那边才看到"角色没图"**。
 *
 * 【怎么防】内嵌做完之后，全文扫一遍**还剩多少个 assets/*.png 引用**：
 *   还剩 → 说明有图片没被内嵌 → **直接报错让构建失败**（而不是静默产出坏包）。
 *
 * ⚠️ 只报"png/jpg/gif/webp"这类真正的图片。
 *    音频/字体等如果将来要用，也要照着这个思路加检查。
 * ============================================================ */
(function verifyNoMissingImages() {
  const left = [];
  const re = /['"]assets\/([A-Za-z0-9_\-.]+\.(?:png|jpg|jpeg|gif|webp))['"]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (left.indexOf(m[1]) < 0) left.push(m[1]);
  }
  if (left.length) {
    console.error('');
    console.error('❌ 单文件版里有 ' + left.length + ' 张图片**没有内嵌**：');
    left.forEach(function (n) {
      console.error('     · assets/' + n +
        (fs.existsSync(path.join(SRC, 'assets', n)) ? '  ← 文件存在，但没进 imgFiles 清单' : '  ← 文件根本不存在'));
    });
    console.error('   ⇒ 单文件版是发给朋友的，不带 assets/ 目录 ——');
    console.error('     这些图在朋友那边会**加载失败**。');
    console.error('   修法：把上面这些名字加进 tools/build-single.js 的 imgFiles 清单。');
    console.error('');
    process.exit(1);
  }
  report.push('  ✓ 所有图片都已内嵌（无遗留 assets/ 引用）');
})();

/* ------------------------------------------------------------
 * 3. 云 SDK：单文件版里改成「可选」且不阻塞
 * ------------------------------------------------------------
 * 单文件版的核心诉求是"打开就能玩"。
 * 联机 SDK 是外链，单文件版里如果它阻塞加载，就又回到老问题了。
 * 所以策略：
 *   - 保留多源降级的加载器（真需要联机时还能加载）
 *   - 但**绝不阻塞**，且 SDK 挂了游戏照常玩
 * 这样单文件版 = 单人/本地双人 100% 可用，联机则取决于网络。
 * ------------------------------------------------------------ */

/* ------------------------------------------------------------
 * 3. 云 SDK：单文件版里必须保留联机能力
 * ------------------------------------------------------------
 * 单文件版的核心诉求是"打开就能玩"。
 * 但注意：**打开就能玩 ≠ 不能联机**。
 *
 * 云 SDK 是外链，所以必须保证它**不阻塞**启动 ——
 * 主循环先跑起来，SDK 在后台异步加载，好了再 initCloud。
 * 这样即使 SDK 加载失败，单人/本地双人也能照常玩，
 * 只是在点"联机"时会提示不可用。
 *
 * ⚠️ 曾经踩过的坑：这里加过
 *      if (location.protocol === 'file:') return;   // ← 错误！
 * 想的是"本地打开不需要联网，秒开"。结果十一和朋友都用微信传的
 * 单文件版联机 → SDK 根本没加载 → 两边都报「云 SDK 未加载」。
 *
 * 教训：**单文件版也是要联机的**。file:// 下能不能连上云端，
 * 应该由云服务 SDK 自己去判定和报错，而不是我们提前一巴掌拍死。
 * 所以现在**不做任何协议拦截**，照常走多源降级加载。
 * ------------------------------------------------------------ */

html = html.replace(
  '<title>',
  '<!-- 单文件版：所有 JS/CSS/图片均已内联，0 个外部依赖。\n' +
  '     单人 / 本地双人：微信传文件或双击即可玩，不需要联网。\n' +
  '     异地联机：会尝试加载云 SDK（需联网）；若云端拒绝 file:// 来源，\n' +
  '               请改用在线网址 https://kangaroo-dragon.app.workbuddy.host/ -->\n<title>'
);

/* ------------------------------------------------------------
 * 4. 清理：统计残留的外部 script（应为 0）
 * ------------------------------------------------------------ */
const leftovers = html.match(/<script\s+src="[^"]*"/g) || [];
report.push('');
report.push('剩余外部 script 标签: ' + leftovers.length + ' 个');
leftovers.forEach(function (s) { report.push('  ' + s); });

/* ------------------------------------------------------------
 * 5. 输出
 * ------------------------------------------------------------ */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');

const outSize = fs.statSync(OUT_FILE).size;
console.log('打包完成\n');
report.forEach(function (l) { console.log(l); });
console.log('\n产出: ' + OUT_FILE);
console.log('大小: ' + (outSize / 1024).toFixed(1) + ' KB');
console.log('\n自检:');
console.log('  外部 <script src> 引用数: ' + leftovers.length + '（应为 0，云 SDK 走动态注入）');
console.log('  含 base64 图片: ' + (html.indexOf('data:image/png;base64,') >= 0 ? '是' : '否'));
console.log('  含内联 game.js: ' + (html.indexOf('inlined: js/game.js') >= 0 ? '是' : '否'));
