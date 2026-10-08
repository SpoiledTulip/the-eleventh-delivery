/* ============================================================
 * make-qr-base64.js — 把作者微信二维码转成 base64 写进 src/js/egg.js
 * ============================================================
 * 用法：
 *   node tools/make-qr-base64.js
 *   node tools/make-qr-base64.js "D:\别的路径\二维码.jpg"     （换图时）
 *
 * 【为什么要写这个脚本，而不是手抄 base64】
 *   820×1210 的 JPEG，转 base64 后约 25 万个字符。
 *   **手抄必错**（错一个字符整张图就废了，而且极难查）。
 *   一条命令搞定，还能重复跑。
 *
 * 【它会做什么】
 *   ① 读原图（默认是十一给的那张，路径写死在下面 DEFAULT_SRC）
 *   ② 校验是不是真 JPEG（看魔数 FF D8 FF），防止拿到别的格式
 *   ③ 把整个文件转成 base64
 *   ④ **覆盖**写 src/js/egg.js，把 EGG_QR_IMG / EGG_QR_W / EGG_QR_H 三个常量填好
 *   ⑤ 打印体积统计（原图 KB / base64 KB / 涨幅）
 *
 * ⚠️ 这个脚本会**整个重写 egg.js**，所以 egg.js 里除这三个常量之外的
 *    手写代码都写在下面的模板里（不要在 egg.js 里手改那些常量 —— 会被覆盖）。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const OUT = path.join(PROJ, 'src', 'js', 'egg.js');

/* 默认原图路径（十一给的）。
 * ⚠️ 用正斜杠写，Windows / Git Bash 都能认。 */
const DEFAULT_SRC = 'C:/Users/spoiled tulip/Pictures/微信图片_20261006144052_93_1.jpg';

const srcPath = process.argv[2] || DEFAULT_SRC;

/* ---- 1. 读原图 ---- */
if (!fs.existsSync(srcPath)) {
  console.error('❌ 找不到图片：' + srcPath);
  console.error('   用法： node tools/make-qr-base64.js "图片路径"');
  process.exit(1);
}
const buf = fs.readFileSync(srcPath);

/* ---- 2. 校验是 JPEG ---- */
/* JPEG 文件头固定是 FF D8 FF（SOI + APPn 标记）。
 * 为什么校验：万一给的是 PNG 或 HEIC，扩展名可能骗人，
 * 而 data URI 的 MIME 写错了浏览器就**完全不显示**（还不报错，很难查）。 */
const isJpeg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
if (!isJpeg) {
  console.error('❌ 这不是 JPEG 文件（文件头不是 FF D8 FF）。');
  console.error('   请先转成 JPEG 再跑这个脚本。');
  process.exit(1);
}

/* ---- 3. 读图片尺寸（从 JPEG 的 SOFn 段里取，不引第三方库）---- */
function readJpegSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    /* SOF0~SOF15（0xC0~0xCF），排除 0xC4(DHT) / 0xC8 / 0xCC */
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    const len = b.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}
const size = readJpegSize(buf);

/* ---- 4. 转 base64 ---- */
const b64 = buf.toString('base64');
const dataUri = 'data:image/jpeg;base64,' + b64;

/* ---- 5. 算显示尺寸（保持原图比例，宽度定 130）---- */
const DISPLAY_W = 130;
let DISPLAY_H = 192;
if (size && size.w > 0) {
  DISPLAY_H = Math.round(DISPLAY_W * size.h / size.w);
}

/* ---- 6. 生成 egg.js ---- */
const file = `/* ============================================================
 * egg.js — 作者彩蛋素材（第 11 关起点的微信二维码）
 * ============================================================
 * ⚠️⚠️ 这个文件由 tools/make-qr-base64.js **自动生成**。
 *     里面的 EGG_QR_IMG / EGG_QR_W / EGG_QR_H 三个常量**不要手改** ——
 *     下次跑脚本会被覆盖。
 *     要换二维码：node tools/make-qr-base64.js "新图片路径"
 *
 * 【为什么内嵌 base64 而不是放 src/assets/】
 *   单文件版（dist/*.html）要求所有资源都塞进一个 HTML。
 *   外部图片路径在单文件版里会 404（因为单文件版没有 assets 目录）。
 *   所以二维码以 data URI 形式内联，零外部依赖。
 *
 * 【体积】
 *   原图 ${(buf.length / 1024).toFixed(1)} KB → base64 ${(b64.length / 1024).toFixed(1)} KB。
 *   这是单文件版里最大的单块资源（十一已知情并接受）。
 * ============================================================ */

/* 二维码图片（data URI）
 * 原图：${size ? size.w + ' × ' + size.h + ' px' : '(尺寸未知)'} JPEG
 * 显示尺寸按原图比例缩放（宽定 ${DISPLAY_W}） */
const EGG_QR_IMG = '${dataUri}';

/* 卡片显示尺寸（逻辑像素）——
 * ⚠️ 定稿是 130 × 192，但这里用**按原图比例算出来的**值，
 *    这样换一张比例不同的二维码时不用手改高度。 */
const EGG_QR_W = ${DISPLAY_W};
const EGG_QR_H = ${DISPLAY_H};

/* ============================================================
 * 彩蛋文案（定稿，不要再改）
 * ============================================================
 * ⚠️ 十一确认过的原句：「如果有什么建议，可以加作者微信提出来**鸭**」
 *    （她特意在结尾加了「鸭」—— 这是她的语气，别"帮"她改掉。）
 */
const EGG_MESSAGE = '如果有什么建议，可以加作者微信提出来鸭';

/* 进关时的左下角提示（约 4 秒淡出）
 * ⚠️ 和上面那句不同：这句是**引导语**，只在"刚进关"时飘一次，
 *    不跟着踏板走。 */
const EGG_HINT = '左边那块板子，踩踩看？';

/* 提示显示时长（帧）= 4 秒 × 60fps */
const EGG_HINT_FRAMES = 240;

/* ============================================================
 * 彩蛋的状态与绘制（渲染调用）
 * ============================================================
 * ⚠️ 这个彩蛋**不存任何状态**（红线）：
 *    每次进关都能重新踩，退出关卡就重置。
 *    所以这里只有一个"图片加载缓存"，不写存档。
 * ============================================================ */

/* 图片对象缓存（浏览器里 Image 解码一次就够了，不要每帧新建） */
let _eggQrImage = null;
let _eggQrReady = false;

/**
 * 懒加载二维码图片。返回 Image 对象（可能还没解码完）。
 * 第一次调用时发起解码，之后复用。
 *
 * ⚠️ 252 KB 的 base64，浏览器**异步解码**要一点时间（实测约 0.5~2 秒）。
 *    如果等玩家踩上踏板才开始解码，第一次踩会看到"加载中…"占位。
 *    ⇒ 所以下面有 preloadEggQr()，在**页面加载时就预热**。
 */
function eggQrImage() {
  if (_eggQrImage) return _eggQrImage;
  try {
    const img = new Image();
    img.onload = function () { _eggQrReady = true; };
    img.onerror = function () { _eggQrReady = false; };
    img.src = EGG_QR_IMG;
    _eggQrImage = img;
  } catch (e) {
    /* 拿不到 Image（比如在离线测试的 Node 环境里）→ 返回 null，
     * 调用方会退回"画一个占位方框"，测试照样能跑。 */
    _eggQrImage = null;
  }
  return _eggQrImage;
}

/** 二维码是否已经解码好（可以画真图了） */
function eggQrReady() { return _eggQrReady; }

/* ============================================================
 * 预热（2026-10-06 加）
 * ============================================================
 * ⚠️ 为什么必须预热：这张 base64 有 252 KB，浏览器**异步解码**
 *    实测要 0.5~2 秒。如果不预热，玩家进关后很快踩上踏板时，
 *    卡片会先显示"二维码加载中…"的占位（不致命，但不好看，
 *    而且十一的验收标准第 3 条是"走上去 → 浮现二维码卡片"，
 *    不该看到占位）。
 *
 * 做法：脚本一加载就发起解码（不等到踩踏板）。
 *   到玩家真的走到第 11 关、再走到踏板时，早就解码完几百次了。
 *
 * ⚠️ 这个预热**不阻塞任何东西**：Image 解码在浏览器后台线程做，
 *    主线程照常跑游戏。
 * ============================================================ */
function preloadEggQr() { eggQrImage(); }
try {
  /* DOM 就绪后预热；如果已经就绪就直接来 */
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', preloadEggQr);
    } else {
      preloadEggQr();
    }
  }
} catch (e) { /* 预热失败不影响游戏（踩踏板时还会再试一次解码） */ }
`;

fs.writeFileSync(OUT, file, 'utf8');

/* ---- 7. 打印结果 ---- */
console.log('✅ 已生成 ' + path.relative(PROJ, OUT));
console.log('   原图    : ' + srcPath);
console.log('   尺寸    : ' + (size ? size.w + ' × ' + size.h : '(未能读取)') + ' px');
console.log('   原图体积: ' + (buf.length / 1024).toFixed(1) + ' KB');
console.log('   base64  : ' + (b64.length / 1024).toFixed(1) + ' KB（涨 ' +
  (((b64.length / buf.length) - 1) * 100).toFixed(1) + '%）');
console.log('   显示尺寸: ' + DISPLAY_W + ' × ' + DISPLAY_H);
console.log('   egg.js  : ' + (file.length / 1024).toFixed(1) + ' KB');
