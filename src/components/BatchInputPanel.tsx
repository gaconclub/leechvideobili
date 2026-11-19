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
      className="glass-card rounded-2xl p-4 sm:p-5 space-y-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-2xl">
          <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            Tải video đa nền tảng hàng loạt
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Dán một hoặc nhiều liên kết Video, Reels, Watch, Playlist hay Kênh (Facebook, Bilibili, YouTube, TikTok, Douyin, Kuaishou, Xiaohongshu, Xigua...) để tự động tách danh sách và tải đồng loạt.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setRawText(SAMPLE_URLS)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/10 dark:bg-violet-500/15 hover:bg-violet-500/20 border border-violet-400/35 text-violet-700 dark:text-violet-200 text-xs font-semibold transition whitespace-nowrap cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Dán mẫu thử</span>
          </button>
          {rawText && (
            <button
              type="button"
              onClick={() => setRawText('')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-500 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-slate-200 dark:border-slate-400/20 transition whitespace-nowrap cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa</span>
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <textarea
          rows={5}
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            if (inspectErrors.length > 0) onClearErrors();
          }}
          placeholder={`https://www.facebook.com/reel/...\nhttps://fb.watch/...\nhttps://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/BV1xx411c7mD\nhttps://www.tiktok.com/@user/video/...`}
          className="w-full rounded-xl bg-slate-50 dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 focus:border-cyan-500 dark:focus:border-cyan-400/70 focus:outline-none p-3.5 text-xs sm:text-sm font-mono text-slate-900 dark:text-cyan-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-colors resize-y"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="space-y-1">
            <label className="inline-flex items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={expandPages}
                onChange={(e) => setExpandPages(e.target.checked)}
                className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
              />
              <span className="font-medium">
                Tự động tách tất cả tập (P1, P2...) nếu là video Bilibili nhiều phần
              </span>
            </label>
            <p
              className={`text-[11px] pl-6 font-mono tabular-nums ${
                detectedUrls.length > 0
                  ? 'text-cyan-700 dark:text-cyan-300 font-semibold'
                  : 'text-slate-500 dark:text-slate-400 font-sans'
              }`}
            >
              {detectedUrls.length > 0
                ? `${detectedUrls.length} liên kết hợp lệ được nhận diện`
                : 'Hỗ trợ Facebook (Video, Reels, Watch, Trang), YouTube, Bilibili, TikTok, Douyin, Kuaishou, Xiaohongshu, Xigua...'}
            </p>
          </div>

          <button
            type="submit"
            disabled={detectedUrls.length === 0 || isInspecting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed text-slate-950 font-bold text-xs sm:text-sm shadow-lg shadow-emerald-500/20 transition whitespace-nowrap shrink-0 cursor-pointer"
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
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/60 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Một số liên kết không thể phân tích</span>
            </div>
            <button
              type="button"
              onClick={onClearErrors}
              className="text-xs text-rose-600 dark:text-rose-300 hover:underline cursor-pointer"
            >
              Ẩn thông báo
            </button>
          </div>
          <ul className="space-y-1 text-xs text-rose-700 dark:text-rose-200 font-mono">
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
