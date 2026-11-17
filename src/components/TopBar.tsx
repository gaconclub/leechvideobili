import React from 'react';
import { Download, RefreshCw, Flame, Layers, Search, Settings, Clapperboard } from 'lucide-react';

export type AppTab = 'batch' | 'search' | 'trending' | 'studio' | 'settings';

interface TopBarProps {
  activeTab: AppTab;
  totalCount: number;
  isDownloading: boolean;
  hasCookie?: boolean;
  hasUpdate?: boolean;
  onChangeTab: (tab: AppTab) => void;
  onStartAll: () => void;
  onOpenUpdateModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  totalCount,
  isDownloading,
  hasCookie,
  hasUpdate,
  onChangeTab,
  onStartAll,
  onOpenUpdateModal,
}) => {
  const navItemClass = (isActive: boolean) =>
    `group relative py-2 text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#003B3E] rounded-sm ${
      isActive
        ? 'text-[#003B3E] dark:text-[#1BA8AD] font-semibold'
        : 'text-slate-600 dark:text-teal-100/85 hover:text-[#003B3E] dark:hover:text-white'
    }`;

  const underlineClass = (isActive: boolean) =>
    `pointer-events-none absolute inset-x-0 -bottom-[1px] h-[2px] rounded-full bg-[#003B3E] dark:bg-[#1BA8AD] origin-center transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
      isActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
    }`;

  return (
    <header className="sticky top-0 z-30 h-15 bg-white/92 dark:bg-[#000A10]/95 backdrop-blur-md border-b border-slate-200/90 dark:border-[#00464A]/80">
      <div className="max-w-[1320px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
        {/* Zone 1: Single-element Brand wordmark */}
        <button
          type="button"
          onClick={() => onChangeTab('batch')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white hover:text-[#003B3E] dark:hover:text-[#1BA8AD] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
        >
          GaConPro V1.0
        </button>

        {/* Zone 2: Clean single-line navigation links with animated underline */}
        <nav className="flex items-center gap-4 sm:gap-6 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => onChangeTab('batch')}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeTab === 'batch')}`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>
              Tải hàng loạt{totalCount > 0 ? ` (${totalCount})` : ''}
            </span>
            <span aria-hidden="true" className={underlineClass(activeTab === 'batch')} />
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('search')}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeTab === 'search')}`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Tìm kiếm</span>
            <span aria-hidden="true" className={underlineClass(activeTab === 'search')} />
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('trending')}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeTab === 'trending')}`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            <span>Xu hướng</span>
            <span aria-hidden="true" className={underlineClass(activeTab === 'trending')} />
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('studio')}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeTab === 'studio')}`}
          >
            <Clapperboard className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD]" />
            <span>Studio</span>
            <span aria-hidden="true" className={underlineClass(activeTab === 'studio')} />
          </button>

          <button
            type="button"
            onClick={() => onChangeTab('settings')}
            className={`inline-flex items-center gap-1.5 ${navItemClass(activeTab === 'settings')}`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Cấu hình{hasCookie ? ' · Đã lưu' : ''}</span>
            <span aria-hidden="true" className={underlineClass(activeTab === 'settings')} />
          </button>

          <button
            type="button"
            onClick={onOpenUpdateModal}
            className={`hidden sm:inline-flex items-center gap-1.5 ${navItemClass(false)}`}
          >
            <RefreshCw className="w-3.5 h-3.5 transition-transform duration-300 group-hover:rotate-90" />
            <span>{hasUpdate ? 'Cập nhật (Mới)' : 'Cập nhật'}</span>
            <span aria-hidden="true" className={underlineClass(false)} />
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={totalCount === 0 || isDownloading}
            onClick={() => {
              onChangeTab('batch');
              onStartAll();
            }}
            className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] active:scale-[0.98] disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg shadow-xs transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003B3E]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isDownloading ? 'Đang tải...' : 'Tải tất cả'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
