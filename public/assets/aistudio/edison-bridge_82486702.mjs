// edison-bridge.mjs
// Vite plugin cho BiliBatch — thêm API nhỏ để Edison (Muse) kết nối tới app.
// Không cần cài thêm thư viện, chỉ dùng Node có sẵn.
// Cách dùng: copy file này vào thư mục gốc của project BiliBatch (cùng chỗ với vite.config.js),
// rồi thêm plugin vào vite.config.js như hướng dẫn trong README.md.
//
// Các endpoint (chạy cùng cổng Vite, ví dụ localhost:3000, qua cùng tunnel):
//   GET  /api/edison/status
//        -> { ok: true, app: "BiliBatch", version: "1.0", time: "..." }
//   GET  /api/edison/downloads
//        -> { ok: true, folder: "BiliBatch_Downloads", files: [{ name, size, mtime }] }
//   GET  /api/edison/video?name=<ten-file.mp4>
//        -> trả file video trong thư mục BiliBatch_Downloads để Edison tải về phân tích.
//        Chỉ cho phép tên file đơn giản, không cho đường dẫn ../ để tránh đọc file ngoài thư mục.
//   POST /api/edison/derivative-request  (JSON: { source, direction, note })
//        -> lưu yêu cầu vào file edison-requests.json trong thư mục project, trả { ok: true, id }
//        Edison ở đây sẽ đọc yêu cầu này, làm video phái sinh, rồi bạn tải video đó về
//        (hoặc Edison gửi link tải cho bạn) và lưu vào BiliBatch_Downloads.
//
// Lưu ý bảo mật: API này không có mật khẩu, chỉ dùng để test trên máy local qua tunnel
// tạm thời. Ai có link tunnel cũng gọi được. Đừng để dữ liệu nhạy cảm trong thư mục
// tải lúc test, và tắt server / tunnel khi không dùng nữa.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOWNLOAD_DIR_NAMES = ['BiliBatch_Downloads', 'Downloads'];

function findDownloadDir(root) {
  for (const name of DOWNLOAD_DIR_NAMES) {
    const p = path.join(root, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  // Chưa có thư mục thì tạo BiliBatch_Downloads để Edison có chỗ trả kết quả.
  const p = path.join(root, 'BiliBatch_Downloads');
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function safeName(name) {
  if (!name || typeof name !== 'string') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  return name;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2 * 1024 * 1024) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function edisonBridge() {
  return {
    name: 'edison-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/edison/')) return next();

        const root = process.cwd();
        const downloadDir = findDownloadDir(root);

        try {
          if (req.method === 'GET' && url.pathname === '/api/edison/status') {
            return sendJson(res, 200, {
              ok: true,
              app: 'BiliBatch',
              version: '1.0',
              time: new Date().toISOString(),
              downloadDir: path.basename(downloadDir),
            });
          }

          if (req.method === 'GET' && url.pathname === '/api/edison/downloads') {
            const files = fs
              .readdirSync(downloadDir)
              .filter((f) => fs.statSync(path.join(downloadDir, f)).isFile())
              .map((f) => {
                const st = fs.statSync(path.join(downloadDir, f));
                return { name: f, size: st.size, mtime: st.mtime.toISOString() };
              })
              .sort((a, b) => b.mtime.localeCompare(a.mtime));
            return sendJson(res, 200, { ok: true, folder: path.basename(downloadDir), files });
          }

          if (req.method === 'GET' && url.pathname === '/api/edison/video') {
            const name = safeName(url.searchParams.get('name'));
            if (!name) return sendJson(res, 400, { ok: false, error: 'invalid name' });
            const file = path.join(downloadDir, name);
            if (!fs.existsSync(file)) return sendJson(res, 404, { ok: false, error: 'not found' });
            const stat = fs.statSync(file);
            res.writeHead(200, {
              'content-type': 'video/mp4',
              'content-length': stat.size,
              'content-disposition': `attachment; filename="${name}"`,
            });
            fs.createReadStream(file).pipe(res);
            return;
          }

          if (req.method === 'POST' && url.pathname === '/api/edison/derivative-request') {
            const body = await readJsonBody(req);
            const id = `req-${Date.now()}`;
            const record = {
              id,
              time: new Date().toISOString(),
              source: body.source || null,
              direction: body.direction || null,
              note: body.note || null,
              status: 'pending',
            };
            const file = path.join(root, 'edison-requests.json');
            let list = [];
            if (fs.existsSync(file)) {
              try {
                list = JSON.parse(fs.readFileSync(file, 'utf-8'));
                if (!Array.isArray(list)) list = [];
              } catch {
                list = [];
              }
            }
            list.push(record);
            fs.writeFileSync(file, JSON.stringify(list, null, 2));
            return sendJson(res, 200, { ok: true, id, status: 'pending' });
          }

          return sendJson(res, 404, { ok: false, error: 'unknown edison endpoint' });
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
        }
      });
    },
  };
}

export default edisonBridge;
