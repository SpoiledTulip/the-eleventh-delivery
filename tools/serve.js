/* ============================================================
 * serve.js — 本地开发服务器
 * ============================================================
 * 为什么需要它：
 *   直接双击 src/index.html 用 file:// 打开，联机功能会被浏览器
 *   当成"无来源"页面，云服务会拒绝请求；而且某些浏览器对
 *   file:// 下的 fetch / localStorage 有限制。
 *   用一个本地 HTTP 服务就没有这些问题，和线上环境一致。
 *
 * 用法：
 *   node tools/serve.js              → http://127.0.0.1:8080
 *   node tools/serve.js 3000         → 换端口
 *
 * 它只服务 src/ 目录（源码），所以改完代码刷新浏览器即可看到效果。
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJ = path.resolve(__dirname, '..');
const SRC = path.join(PROJ, 'src');
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer(function (req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end('Bad Request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  /* ★ 防目录穿越 ★
   * 检查解析后的绝对路径必须以 SRC 开头，
   * 否则像 /../../secret 这样的请求就能读到项目外的文件。 */
  const filePath = path.resolve(SRC, '.' + urlPath);
  if (!filePath.startsWith(SRC)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 找不到：' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      /* 开发时不要缓存，否则改了代码刷新还用旧的 */
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', function () {
  console.log('');
  console.log('  外卖双人组 · 本地开发服务器');
  console.log('  ' + '─'.repeat(46));
  console.log('  地址：  http://127.0.0.1:' + PORT + '/');
  console.log('  源码：  ' + SRC);
  console.log('  ' + '─'.repeat(46));
  console.log('  改完代码直接刷新浏览器即可看到效果（已禁用缓存）。');
  console.log('  按 Ctrl+C 停止。');
  console.log('');
});
