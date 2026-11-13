import React from 'react';
import { Download, RefreshCw } from 'lucide-react';

interface TopBarProps {
  totalCount: number;
  isDownloading: boolean;
  hasCookie?: boolean;
  hasUpdate?: boolean;
  onStartAll: () => void;
  onOpenCookieModal: () => void;
  onOpenUpdateModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  totalCount,
  isDownloading,
  hasCookie,
  hasUpdate,
  onStartAll,
  onOpenCookieModal,
  onOpenUpdateModal,
}) => {
  return (
    <header className="sticky top-0 z-30 h-14 bg-white/95 dark:bg-[#0F141F]/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-[1280px] mx-auto h-full px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand wordmark */}
        <a
          href="#top"
          className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          BiliBatch
        </a>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <a
            href="#input-panel"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Thêm liên kết
          </a>
          <a
            href="#output-config"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Cấu hình đầu ra
          </a>
          <a
            href="#download-queue"
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Hàng đợi tải
          </a>
          <button
            type="button"
            onClick={onOpenCookieModal}
            className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Cookie / Đăng nhập</span>
            {hasCookie && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          </button>
          <button
            type="button"
            onClick={onOpenUpdateModal}
            className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Cập nhật</span>
            {hasUpdate && <span className="w-1.5 h-1.5 rounded-full bg-[#FB7299]" />}
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={totalCount === 0 || isDownloading}
            onClick={onStartAll}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#FB7299] hover:bg-[#e55d85] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FB7299]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isDownloading ? 'Đang tải...' : 'Tải tất cả'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
