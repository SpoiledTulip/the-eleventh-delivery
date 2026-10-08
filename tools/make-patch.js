/* ============================================================
 * make-patch.js — 生成「变更包」（只含改动的文件）
 * ============================================================
 * 解决的问题：每次改一点点，就要把整个项目 zip 重发一遍，
 * 对方还得整个覆盖 —— 又慢又容易搞混版本。
 *
 * 做法：用**文件指纹（内容哈希）**判断哪些文件变了。
 *   · 每次运行会把当前所有源文件的指纹存到 `.file-fingerprints.json`
 *   · 下次运行只挑出"指纹和上次不一样"的文件打包
 *   · 不需要 git，不需要启动任何外部进程（纯 Node 读写文件）
 *
 * 用法：
 *   node make-patch.js              # 对比上次快照，生成变更包（推荐）
 *   node make-patch.js --all        # 强制打包全部源文件（首次交付用）
 *   node make-patch.js --core       # 只要核心代码，不带测试/文档（更小）
 *   node make-patch.js --reset      # 重置快照（当作新起点，不生成包）
 *
 * 产出：
 *   patches/变更包_YYYY-MM-DD_HH-MM.zip
 *   （zip 内附「变更说明.md」，写清怎么用）
 *
 * ============================================================
 * 【重要】这个脚本是"纯 Node 实现"，不依赖 git、不启动任何外部进程。
 * 它靠**文件内容哈希**判断改动：
 *   · 每次运行会把所有源文件的指纹存进 `.file-fingerprints.json`
 *   · 下次运行只挑出"和上次不一样"的文件
 * 所以第一次跑会打包全部，之后每次只打包你改过的那几个文件
 * （实测：改一个文件 → 6KB 的小包，而不是 486KB 的全包）。
 * ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

/* ------------------------------------------------------------
 * 路径约定（迁移后更新）
 * ------------------------------------------------------------
 * 本脚本住在 tools/ 里，项目结构是：
 *   src/    ← 源码（要同步）
 *   tests/  ← 测试（要同步，否则协作者改坏了不知道）
 *   tools/  ← 构建脚本（要同步）
 *   docs/   ← 文档（要同步）
 *   dist/   ← 产物（不同步，对方能自己构建）
 *
 * 指纹文件与产物都放**项目根**（不在 tools 里），
 * 这样和 .gitignore 的规则一致。
 * ------------------------------------------------------------ */
const PROJ = path.resolve(__dirname, '..');
const ROOT = PROJ;                                  // 扫描起点 = 项目根
const OUT_DIR = path.join(PROJ, 'patches');
const SNAP_FILE = path.join(PROJ, '.file-fingerprints.json');

const args = process.argv.slice(2);
const RESET = args.indexOf('--reset') >= 0;
const ALL = args.indexOf('--all') >= 0;
const CORE = args.indexOf('--core') >= 0;

/* ------------------------------------------------------------
 * --core 模式：只带"跑游戏必须的代码"，不带测试和文档
 * ------------------------------------------------------------
 * 什么时候用：协作者只是想**试玩游戏**或做个视觉调整，
 *            不需要跑测试。包能再小一点。
 * 什么时候**别**用：对方要改玩法逻辑 —— 一定带测试，
 *            否则他改坏了不知道（README 里也强调了这点）。
 * ------------------------------------------------------------ */
const isCore = function (rel) {
  rel = rel.replace(/\\/g, '/');
  if (/^tests\//.test(rel)) return false;            // 测试
  if (/^docs\//.test(rel)) return false;             // 文档
  if (/\.md$/i.test(rel)) return false;              // 根目录的 README 等
  if (/^src\/assets\/raw\//.test(rel)) return false; // 原始素材（674KB）
  return true;
};

/* ------------------------------------------------------------
 * 哪些文件算「源文件」（需要同步给协作者）
 * ------------------------------------------------------------
 * 原则：能自动生成的、体积大的、跟代码无关的 —— 都不算。
 * ------------------------------------------------------------ */
const isSource = function (rel) {
  rel = rel.replace(/\\/g, '/');
  if (rel.startsWith('dist/')) return false;         // 打包产物（对方能自己生成）
  if (rel.startsWith('patches/')) return false;      // 变更包自己
  if (rel.startsWith('backups/')) return false;      // 本机备份
  if (rel.startsWith('node_modules/')) return false;
  if (rel.startsWith('.')) return false;             // 隐藏文件/目录（含 .git）
  if (rel.startsWith('_')) return false;             // 临时目录
  if (/\/_/.test(rel)) return false;                 // 任意层的下划线开头文件
  if (/\.(zip|log|tmp|bak|swp|orig|pid)$/i.test(rel)) return false;
  return true;
};

/* 单独分类：文档（通常单独发，但改了也提示一下） */
const isDoc = function (rel) { return /\.md$/i.test(rel); };

function listFiles(dir, rel, out) {
  out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
    const abs = path.join(dir, d.name);
    const r = rel ? (rel + '/' + d.name) : d.name;
    if (d.isDirectory()) {
      /* 这些目录不扫：依赖、产物、备份、版本控制、临时 */
      if (d.name === '.git' || d.name === 'node_modules' ||
          d.name === 'dist' || d.name === 'patches' ||
          d.name === 'backups' || /^_/.test(d.name)) return;
      listFiles(abs, r, out);
    } else {
      out.push(r.replace(/\\/g, '/'));
    }
  });
  return out;
}

function fingerprint(abs) {
  const buf = fs.readFileSync(abs);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) + ':' + buf.length;
}

console.log('生成变更包');
console.log('='.repeat(56));

/* ---- 1. 计算当前所有源文件的指纹 ---- */
let allFiles = listFiles(ROOT, '').filter(isSource);
if (CORE) {
  const before = allFiles.length;
  allFiles = allFiles.filter(isCore);
  console.log('模式: --core（只要核心代码）→ 从 ' + before + ' 个筛到 ' + allFiles.length + ' 个');
  console.log();
}
const now = {};
allFiles.forEach(function (rel) {
  try { now[rel] = fingerprint(path.join(ROOT, rel)); } catch (e) {}
});

/* ---- 2. 读上次快照 ---- */
let prev = {};
if (fs.existsSync(SNAP_FILE)) {
  try { prev = JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')); } catch (e) { prev = {}; }
}

const isFirstRun = Object.keys(prev).length === 0;

if (RESET) {
  fs.writeFileSync(SNAP_FILE, JSON.stringify(now, null, 2), 'utf8');
  console.log('✅ 快照已重置（' + allFiles.length + ' 个文件已记录为当前状态）');
  console.log('   下次运行 make-patch.js 时，改动就会以现在为起点计算。');
  process.exit(0);
}

/* ---- 3. 找出改动 ---- */
const modified = [];   // 内容变了
const added = [];      // 新增
const removed = [];    // 删除

Object.keys(now).forEach(function (rel) {
  if (!(rel in prev)) added.push(rel);
  else if (prev[rel] !== now[rel]) modified.push(rel);
});
Object.keys(prev).forEach(function (rel) {
  if (!(rel in now)) removed.push(rel);
});

let toPack;
if (ALL) {
  toPack = Object.keys(now);
  console.log('模式: 强制打包全部源文件（--all）');
} else if (isFirstRun) {
  toPack = Object.keys(now);
  console.log('模式: 首次运行 —— 打包全部源文件（作为协作起点）');
} else {
  toPack = modified.concat(added);
}

console.log();
if (!isFirstRun && !ALL) {
  console.log('与上次快照相比：');
  if (modified.length) console.log('  改动 ' + modified.length + ' 个：' + modified.join(', '));
  if (added.length) console.log('  新增 ' + added.length + ' 个：' + added.join(', '));
  if (removed.length) console.log('  删除 ' + removed.length + ' 个：' + removed.join(', '));
  if (!modified.length && !added.length && !removed.length) console.log('  （没有任何改动）');
  console.log();
}

const srcToPack = toPack.filter(function (f) { return !isDoc(f); });
const docsChanged = toPack.filter(isDoc);

if (srcToPack.length === 0 && docsChanged.length === 0 && removed.length === 0) {
  console.log('没有需要打包的改动。');
  process.exit(0);
}
if (srcToPack.length === 0) {
  console.log('只有文档改动（' + docsChanged.join(', ') + '）—— 不算代码变更。');
  console.log('如果确实要把文档也同步，请单独发文件。');
  /* 仍然更新快照，避免下次又报一遍 */
  fs.writeFileSync(SNAP_FILE, JSON.stringify(now, null, 2), 'utf8');
  process.exit(0);
}

/* ---- 4. 生成「变更说明.md」 ---- */
let totalSize = 0;
const L = [];
L.push('# 变更包说明（外卖双人组）');
L.push('');
L.push('**生成时间**：' + new Date().toLocaleString('zh-CN'));
L.push('');
L.push('## 怎么用（3 步）');
L.push('');
L.push('1. **解压**这个 zip，会看到一个 `delivery-game` 文件夹');
L.push('2. 把里面的文件**覆盖**到你项目的对应位置（路径完全一致，直接覆盖）');
L.push('   - 如果说明里提到"删除"某文件，请把它删掉');
L.push('3. 覆盖完**跑一下测试**确认没问题，再重新打包：');
L.push('   ```');
L.push('   npm test          # 或 node tests/jump-test.js 这样单独跑');
L.push('   npm run build     # 生成单文件版');
L.push('   ```');
L.push('');
L.push('## 本次改动');
L.push('');

if (modified.length) {
  L.push('### 修改（' + modified.length + ' 个）');
  L.push('');
  L.push('| 文件 | 大小 |');
  L.push('|---|---|');
  modified.forEach(function (f) {
    const sz = Math.round(fs.statSync(path.join(ROOT, f)).size / 1024);
    totalSize += fs.statSync(path.join(ROOT, f)).size;
    L.push('| `' + f + '` | ' + sz + ' KB |');
  });
  L.push('');
}
if (added.length && !ALL && !isFirstRun) {
  L.push('### 新增（' + added.length + ' 个）');
  L.push('');
  added.forEach(function (f) { L.push('- `' + f + '`'); });
  L.push('');
}
if (removed.length && !ALL && !isFirstRun) {
  L.push('### ⚠️ 需要删除（' + removed.length + ' 个）');
  L.push('');
  L.push('这些文件在上个版本有、本版本没了，请从你项目里删掉：');
  L.push('');
  removed.forEach(function (f) { L.push('- ~~`' + f + '`~~'); });
  L.push('');
}
if (ALL || isFirstRun) {
  L.push('### 完整文件清单（' + srcToPack.length + ' 个）');
  L.push('');
  L.push('| 文件 | 大小 |');
  L.push('|---|---|');
  srcToPack.forEach(function (f) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) return;
    const sz = Math.round(fs.statSync(abs).size / 1024);
    totalSize += fs.statSync(abs).size;
    L.push('| `' + f + '` | ' + sz + ' KB |');
  });
  L.push('');
}
if (docsChanged.length) {
  L.push('### 文档也有改动（本次未打包，需要就单独发）');
  L.push('');
  docsChanged.forEach(function (f) { L.push('- `' + f + '`'); });
  L.push('');
}
L.push('---');
L.push('');
L.push('## 未包含的内容（这些不需要同步）');
L.push('');
L.push('| 内容 | 为什么不用同步 |');
L.push('|---|---|');
L.push('| `dist/` | 打包产物，本地跑 `npm run build` 就能生成 |');
L.push('| `backups/` | 本机备份，和代码无关 |');
L.push('| `patches/` | 变更包自己 |');
L.push('| `src/assets/raw/` | AI 生成的原始素材（674KB），游戏实际不读取 |');
L.push('');
L.push('## 遇到问题？');
L.push('');
L.push('项目根目录有 `README.md`，`docs/` 里有 `给协作者的说明.md`，里面有：');
L.push('- 代码结构 + "想改什么改哪个文件"索引');
L.push('- **关键架构约定**（锁帧 / 键位隔离 / 远程输入通道 等，改错会出大问题）');
L.push('- 完整测试清单');

/* ---- 5. 复制文件到暂存目录 ---- */
const stageRoot = path.join(ROOT, '_patch_stage_tmp');
if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
const target = path.join(stageRoot, 'delivery-game');

srcToPack.forEach(function (f) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) return;
  const dst = path.join(target, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
});
fs.writeFileSync(path.join(stageRoot, '变更说明.md'), L.join('\n'), 'utf8');

/* ---- 6. 打包 zip（零依赖实现，不调用任何外部命令） ---- */
function createZip(sourceDir, destZip) {
  const entries = [];
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
      const abs = path.join(dir, d.name);
      const r = rel ? (rel + '/' + d.name) : d.name;
      if (d.isDirectory()) walk(abs, r);
      else entries.push({ abs: abs, rel: r });
    });
  })(sourceDir, '');

  const TABLE = (function () {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }

  const chunks = [];
  const central = [];
  let offset = 0;

  entries.forEach(function (e) {
    const data = fs.readFileSync(e.abs);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const nameBuf = Buffer.from(e.rel.replace(/\\/g, '/'), 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);      // UTF-8 文件名
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(0, 42);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  });

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  fs.writeFileSync(destZip, Buffer.concat([Buffer.concat(chunks), cdBuf, end]));
  return entries.length;
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-').replace(/\./g, '');
const zipName = '变更包_' + stamp + '.zip';
const zipPath = path.join(OUT_DIR, zipName);

let fileCount = 0;
try {
  fileCount = createZip(stageRoot, zipPath);
} catch (e) {
  console.log('❌ 打包失败: ' + e.message);
  fs.rmSync(stageRoot, { recursive: true, force: true });
  process.exit(1);
}
fs.rmSync(stageRoot, { recursive: true, force: true });

/* ---- 7. 更新快照 ---- */
fs.writeFileSync(SNAP_FILE, JSON.stringify(now, null, 2), 'utf8');

const zipSize = fs.statSync(zipPath).size;
console.log('='.repeat(56));
console.log('✅ 变更包已生成');
console.log();
console.log('  文件: patches/' + zipName);
console.log('  大小: ' + Math.round(zipSize / 1024) + ' KB' +
  (totalSize ? '（原文件合计 ' + Math.round(totalSize / 1024) + ' KB）' : ''));
console.log('  含 ' + srcToPack.length + ' 个源文件');
if (removed.length && !ALL && !isFirstRun) {
  console.log('  ⚠️ 另有 ' + removed.length + ' 个文件需要对方删除（见包内说明）');
}
console.log();
console.log('把它发给协作者，解压后覆盖即可。');
console.log('（zip 里附了「变更说明.md」，写清了怎么用）');
console.log();
console.log('提示：快照已更新，下次运行只会打包"这次的改动之后"的新变更。');
