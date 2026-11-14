import React, { useState } from 'react';
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

type NavKey = 'input' | 'config' | 'queue' | 'cookie' | 'update';

export const TopBar: React.FC<TopBarProps> = ({
  totalCount,
  isDownloading,
  hasCookie,
  hasUpdate,
  onStartAll,
  onOpenCookieModal,
  onOpenUpdateModal,
}) => {
  const [activeNav, setActiveNav] = useState<NavKey>('input');

  const navItemClass = (isActive: boolean) =>
    `group relative py-2 text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#003B3E] rounded-sm ${
      isActive
        ? 'text-[#003B3E] dark:text-[#1BA8AD]'
        : 'text-slate-600 dark:text-teal-100/85 hover:text-[#003B3E] dark:hover:text-white'
    }`;

  const underlineClass = (isActive: boolean) =>
    `pointer-events-none absolute inset-x-0 -bottom-[1px] h-[2px] rounded-full bg-[#003B3E] dark:bg-[#1BA8AD] origin-center transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
      isActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
    }`;

  return (
    <header className="sticky top-0 z-30 h-15 bg-white/92 dark:bg-[#000A10]/95 backdrop-blur-md border-b border-slate-200/90 dark:border-[#00464A]/80">
      <div className="max-w-[1320px] mx-auto h-full px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand wordmark */}
        <a
          href="#top"
          onClick={() => setActiveNav('input')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white hover:text-[#003B3E] dark:hover:text-[#1BA8AD] transition-colors duration-150 whitespace-nowrap shrink-0"
        >
          GaConPro V1.0
        </a>

        {/* Zone 2: Clean single-line navigation links with animated underline */}
        <nav className="hidden md:flex items-center gap-7">
          <a
            href="#input-panel"
            onClick={() => setActiveNav('input')}
            className={navItemClass(activeNav === 'input')}
          >
            <span>Thêm liên kết</span>
            <span aria-hidden="true" className={underlineClass(activeNav === 'input')} />
          </a>
          <a
            href="#output-config"
            onClick={() => setActiveNav('config')}
            className={navItemClass(activeNav === 'config')}
          >
            <span>Cấu hình đầu ra</span>
            <span aria-hidden="true" className={underlineClass(activeNav === 'config')} />
          </a>
          <a
            href="#download-queue"
            onClick={() => setActiveNav('queue')}
            className={navItemClass(activeNav === 'queue')}
          >
            <span>Hàng đợi tải</span>
            <span aria-hidden="true" className={underlineClass(activeNav === 'queue')} />
          </a>
          <button
            type="button"
            onClick={() => {
              setActiveNav('cookie');
              onOpenCookieModal();
            }}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeNav === 'cookie')}`}
          >
            <span>{hasCookie ? 'Cookie (Đã lưu)' : 'Cookie / Đăng nhập'}</span>
            <span aria-hidden="true" className={underlineClass(activeNav === 'cookie')} />
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveNav('update');
              onOpenUpdateModal();
            }}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeNav === 'update')}`}
          >
            <RefreshCw className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-90" />
            <span>{hasUpdate ? 'Cập nhật (Mới)' : 'Cập nhật'}</span>
            <span aria-hidden="true" className={underlineClass(activeNav === 'update')} />
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={totalCount === 0 || isDownloading}
            onClick={onStartAll}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] active:scale-[0.98] disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg shadow-xs transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003B3E]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isDownloading ? 'Đang tải...' : 'Tải tất cả'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
