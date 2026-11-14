import React, { useState } from 'react';
import { Link2, Plus, Loader2, AlertCircle, ClipboardPaste, Trash2 } from 'lucide-react';
import { InspectError } from '../types/bilibili';
import { parseUrlsFromText } from '../utils/formatters';

interface BatchInputPanelProps {
  isInspecting: boolean;
  inspectErrors: InspectError[];
  onInspect: (urls: string[], expandPages: boolean) => Promise<void>;
  onClearErrors: () => void;
}

const SAMPLE_URLS = [
  'https://www.bilibili.com/video/BV1xx411c7mD',
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  'https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI',
].join('\n');

export const BatchInputPanel: React.FC<BatchInputPanelProps> = ({
  isInspecting,
  inspectErrors,
  onInspect,
  onClearErrors,
}) => {
  const [rawText, setRawText] = useState('');
  const [expandPages, setExpandPages] = useState(true);

  const detectedUrls = parseUrlsFromText(rawText);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (detectedUrls.length === 0 || isInspecting) return;
    await onInspect(detectedUrls, expandPages);
    setRawText('');
  };

  return (
    <section
      id="input-panel"
      className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-6 sm:p-7 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="space-y-1">
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white text-balance">
            Tải video Bilibili &amp; YouTube hàng loạt
          </h1>
          <p className="text-sm text-slate-500 dark:text-teal-100/80">
            Dán một hoặc nhiều liên kết Video, Shorts, Playlist hay Kênh để tự động tách danh sách và xử lý đồng loạt.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setRawText(SAMPLE_URLS)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-teal-100 hover:text-[#003B3E] dark:hover:text-white bg-slate-100/80 dark:bg-[#000A10] hover:bg-[#003B3E]/10 dark:hover:bg-[#000E16] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Dán mẫu thử</span>
          </button>
          {rawText && (
            <button
              type="button"
              onClick={() => setRawText('')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-teal-100/80 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa ô nhập</span>
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <textarea
            rows={4}
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              if (inspectErrors.length > 0) onClearErrors();
            }}
            placeholder={`https://www.youtube.com/watch?v=...\nhttps://www.youtube.com/playlist?list=...\nhttps://www.youtube.com/@tenkenh\nhttps://www.bilibili.com/video/BV1xx411c7mD\nhttps://space.bilibili.com/vi/512113889/upload/video`}
            className="w-full px-4 py-3.5 text-sm font-mono bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-teal-200/45 focus:outline-none focus:border-[#003B3E] dark:focus:border-[#1BA8AD] focus:ring-3 focus:ring-[#003B3E]/15 transition-all resize-y"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="inline-flex items-center gap-2.5 text-sm text-slate-700 dark:text-teal-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={expandPages}
                onChange={(e) => setExpandPages(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 dark:border-teal-700 accent-[#003B3E] cursor-pointer"
              />
              <span>Tự động tách tất cả tập (P1, P2...) nếu là video Bilibili nhiều phần</span>
            </label>

            <span
              className={`text-xs font-mono tabular-nums ${
                detectedUrls.length > 0
                  ? 'font-medium text-[#003B3E] dark:text-[#1BA8AD]'
                  : 'text-slate-500 dark:text-teal-100/75'
              }`}
            >
              {detectedUrls.length > 0
                ? `${detectedUrls.length} liên kết hợp lệ được nhận diện`
                : 'Hỗ trợ YouTube (Video, Shorts, Playlist, Kênh) & Bilibili (BV/av, b23.tv, Kênh)'}
            </span>
          </div>

          <button
            type="submit"
            disabled={detectedUrls.length === 0 || isInspecting}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] active:scale-[0.98] disabled:bg-slate-200 dark:disabled:bg-[#000A10] disabled:text-slate-400 dark:disabled:text-teal-200/40 disabled:cursor-not-allowed rounded-xl shadow-xs transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003B3E]"
          >
            {isInspecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang phân tích...</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Phân tích &amp; Thêm vào hàng đợi</span>
              </>
            )}
          </button>
        </div>
      </form>

      {inspectErrors.length > 0 && (
        <div className="mt-4 p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Một số liên kết không thể phân tích</span>
            </div>
            <button
              type="button"
              onClick={onClearErrors}
              className="text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
            >
              Ẩn thông báo
            </button>
          </div>
          <ul className="space-y-1 text-xs text-rose-700 dark:text-rose-300 font-mono">
            {inspectErrors.map((err, i) => (
              <li key={i} className="flex items-center gap-2 truncate">
                <Link2 className="w-3 h-3 shrink-0" />
                <span className="truncate">{err.url}</span>
                <span aria-hidden="true">—</span>
                <span className="font-sans">{err.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
