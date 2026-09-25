/* global __dirname */
// Local production-export preview, including the same-origin API proxy used on Vercel.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist');
const target = new URL(process.env.PWA_API_PROXY || 'http://127.0.0.1:8001');
const transport = target.protocol === 'https:' ? require('node:https') : http;
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.css': 'text/css',
};
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const proxy = transport.request(
        new URL(req.url, target),
        { method: req.method, headers: { ...req.headers, host: target.host } },
        (upstream) => {
          res.writeHead(upstream.statusCode, { ...upstream.headers, 'cache-control': 'no-store' });
          upstream.pipe(res);
        },
      );
      proxy.on('error', () => {
        res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ detail: 'API unavailable' }));
      });
      req.pipe(proxy);
      return;
    }
    let file = path.resolve(root, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (
        pathname.startsWith('/assets/') ||
        pathname.startsWith('/_expo/') ||
        path.extname(pathname)
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      file = path.join(root, 'index.html');
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(8083, '127.0.0.1', () => console.log('PWA preview: http://localhost:8083'));
