import React, { useState, useEffect, useRef } from 'react';
import { X, KeyRound, Upload } from 'lucide-react';

interface SessdataModalProps {
  isOpen: boolean;
  sessdata: string;
  ytCookies: string;
  onSave: (sessdata: string, ytCookies: string) => void;
  onClose: () => void;
}

export const SessdataModal: React.FC<SessdataModalProps> = ({
  isOpen,
  sessdata,
  ytCookies,
  onSave,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'bilibili' | 'youtube'>('youtube');
  const [biliVal, setBiliVal] = useState(sessdata);
  const [ytVal, setYtVal] = useState(ytCookies);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBiliVal(sessdata);
    setYtVal(ytCookies);
  }, [sessdata, ytCookies, isOpen]);

  if (!isOpen) return null;

  const handleUploadCookiesFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setYtVal(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sessdata-modal-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-[#FB7299]" />
            <h2
              id="sessdata-modal-title"
              className="font-display text-base font-semibold text-slate-900 dark:text-white"
            >
              Cấu hình Cookie đăng nhập (Tùy chọn)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Platform tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/70 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'youtube'
                ? 'border-red-500 text-red-600 dark:text-red-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            YouTube Cookies {ytVal.trim() ? '· Đã nhập' : ''}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bilibili')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'bilibili'
                ? 'border-[#FB7299] text-[#FB7299]'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Bilibili SESSDATA {biliVal.trim() ? '· Đã nhập' : ''}
          </button>
        </div>

        {activeTab === 'youtube' ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Nếu YouTube yêu cầu xác minh (<em>&ldquo;Sign in to confirm you&apos;re not a bot&rdquo;</em>) hoặc tải video giới hạn độ tuổi / thành viên, hãy dán nội dung tệp{' '}
              <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">cookies.txt</code>{' '}
              (định dạng Netscape) hoặc chuỗi Cookie từ trình duyệt.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="yt-cookies-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  YouTube Cookies
                </label>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    onChange={handleUploadCookiesFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Chọn tệp cookies.txt</span>
                  </button>
                </div>
              </div>
              <textarea
                id="yt-cookies-input"
                rows={5}
                value={ytVal}
                onChange={(e) => setYtVal(e.target.value)}
                placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\n\nhoặc dán chuỗi: SID=...; HSID=...; SAPISID=...'}
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-red-500 resize-y"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Cookie chỉ lưu cục bộ trên trình duyệt (localStorage) và chỉ dùng khi tải video YouTube.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Các video công khai trên Bilibili có thể tải ở độ phân giải 360P–1080P mà không cần đăng nhập. Nếu bạn muốn mở khóa{' '}
              <span className="font-semibold text-slate-900 dark:text-white">1080P60</span> hoặc{' '}
              <span className="font-semibold text-slate-900 dark:text-white">4K (2160P)</span>, hãy dán giá trị{' '}
              <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">SESSDATA</code> từ trình duyệt của bạn.
            </p>

            <div className="space-y-1.5">
              <label
                htmlFor="sessdata-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Giá trị SESSDATA
              </label>
              <input
                id="sessdata-input"
                type="password"
                value={biliVal}
                onChange={(e) => setBiliVal(e.target.value)}
                placeholder="Ví dụ: 8a1b2c3d%2C173..."
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#FB7299]"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Giá trị này chỉ được lưu cục bộ trên trình duyệt (localStorage) và gửi kèm khi gọi API Bilibili.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800">
          {(activeTab === 'youtube' ? ytVal : biliVal) && (
            <button
              type="button"
              onClick={() => {
                if (activeTab === 'youtube') {
                  setYtVal('');
                  onSave(biliVal.trim(), '');
                } else {
                  setBiliVal('');
                  onSave('', ytVal.trim());
                }
                onClose();
              }}
              className="px-3.5 py-2 text-xs font-medium text-rose-600 hover:text-rose-700 dark:text-rose-400 mr-auto cursor-pointer"
            >
              Xóa Cookie {activeTab === 'youtube' ? 'YouTube' : 'Bilibili'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(biliVal.trim(), ytVal.trim());
              onClose();
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 dark:bg-[#FB7299] hover:bg-slate-800 dark:hover:bg-[#e55d85] rounded-lg transition-colors cursor-pointer"
          >
            Lưu cấu hình
          </button>
        </div>
      </div>
    </div>
  );
};
