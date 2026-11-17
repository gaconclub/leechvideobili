# Kết nối Edison với BiliBatch

Bộ nối này không nhúng Edison vào trong app, vì Edison chỉ chạy trong Muse và không có API key hay nút nhúng. Nó làm theo hướng ngược lại: thêm một API nhỏ vào BiliBatch, để Edison ở đây gọi vào app của bạn qua tunnel.

## Luồng làm việc sau khi nối

1. Bạn tải video mẫu bằng BiliBatch như bình thường, video nằm trong thư mục `BiliBatch_Downloads`.
2. Edison gọi `GET /api/edison/downloads` để xem danh sách video đã tải, rồi gọi `GET /api/edison/video?name=...` để tải video mẫu về phân tích.
3. Edison phân tích khung hình và âm thanh, viết kịch bản phái sinh, tạo các clip mới (mỗi clip khoảng 10 giây, tối đa 6 clip mỗi lần).
4. Edison gửi bạn link tải video phái sinh, bạn lưu vào thư mục `BiliBatch_Downloads` để dùng tiếp trong app.

## Cài đặt (5 phút)

Trong thư mục gốc của project BiliBatch, nơi có file `vite.config.js`:

1. Copy file `edison-bridge.mjs` trong thư mục này vào thư mục gốc của project.
2. Mở `vite.config.js`, thêm import và plugin:
```js
import { edisonBridge } from './edison-bridge.mjs';

// trong defineConfig, ở mảng plugins, thêm edisonBridge() vào, ví dụ:
plugins: [react(), tailwindcss(), edisonBridge()],
```
3. Đảm bảo trong `server` của `vite.config.js` có:
```js
server: {
  allowedHosts: true,
  // ... các dòng hmr, watch cũ giữ nguyên
}
```
4. Tắt hẳn server cũ bằng Ctrl+C, chạy lại `npm run dev`.
5. Mở `http://localhost:3000/api/edison/status` trên máy bạn, phải thấy `{"ok":true,"app":"BiliBatch"...}` thì API đã chạy.
6. Chạy tunnel như trước, ví dụ `npx.cmd localtunnel --port 3000`, rồi gửi mình link mới. Mình sẽ gọi `.../api/edison/status` qua link đó để kiểm chứng kết nối thật.

## Các endpoint

- `GET /api/edison/status` — kiểm tra API có chạy không.
- `GET /api/edison/downloads` — liệt kê file trong `BiliBatch_Downloads`.
- `GET /api/edison/video?name=<ten-file.mp4>` — tải một video đã tải về để phân tích.
- `POST /api/edison/derivative-request` — gửi yêu cầu phái sinh dạng JSON `{ source, direction, note }`, lưu vào `edison-requests.json`.

## Bảo mật

API này không có mật khẩu, chỉ dùng để test trên máy local qua tunnel tạm thời. Ai có link tunnel cũng gọi được các endpoint trên. Đừng để dữ liệu nhạy cảm trong thư mục tải lúc test, và tắt server / tunnel khi không dùng nữa. Khi đưa app lên production, cần thêm xác thực và chỉ cho phép host của bạn.
