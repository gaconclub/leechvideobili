import React, { useEffect, useRef, useState } from 'react';
import { Search, Zap, ShieldCheck, Moon, Sun, Loader2 } from 'lucide-react';

interface TopBarProps {
  darkMode: boolean;
  onToggleDark: () => void;
  onQuickSearch: (query: string) => void;
  onOpenHealth: () => void;
  onDownloadAll: () => void;
  pendingDownloadCount: number;
  isDownloading: boolean;
  configuredCookiesCount: number;
  ffmpegReady: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  darkMode,
  onToggleDark,
  onQuickSearch,
  onOpenHealth,
  onDownloadAll,
  pendingDownloadCount,
  isDownloading,
  configuredCookiesCount,
  ffmpegReady,
}) => {
  const [quickQuery, setQuickQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuery.trim();
    if (!q) return;
    onQuickSearch(q);
  };

  return (
    <header className="sticky top-0 z-20 glass-card border-b border-slate-200/80 dark:border-slate-400/15 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
      {/* Global Quick Search */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 flex-1 min-w-[210px] max-w-md rounded-xl bg-slate-100/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 focus-within:border-violet-500/70 dark:focus-within:border-violet-400/60 px-3 py-1.5"
      >
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={quickQuery}
          onChange={(e) => setQuickQuery(e.target.value)}
          placeholder="Tìm nhanh từ khóa, dán link hoặc Enter..."
          aria-label="Tìm nhanh toàn cục"
          className="w-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
        />
        <span className="hidden sm:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/80 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-white/10 shrink-0">
          ⌘K
        </span>
      </form>

      {/* Right System Pills & Actions */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#0c1021]/85 border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-300 whitespace-nowrap">
          <span
            className={`w-2 h-2 rounded-full ${
              ffmpegReady ? 'bg-cyan-500 dark:bg-cyan-400 animate-pulse' : 'bg-amber-400'
            }`}
          />
          <span>FFmpeg &amp; Queue Live</span>
        </div>

        <button
          type="button"
          onClick={onOpenHealth}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-medium transition cursor-pointer whitespace-nowrap"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="tabular-nums">
            Cookie &amp; AI Health ({configuredCookiesCount}/11)
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleDark}
          title={darkMode ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          aria-label={darkMode ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          className="p-2 rounded-xl bg-slate-100 dark:bg-[#0c1021]/85 hover:bg-slate-200/80 dark:hover:bg-white/10 border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 transition cursor-pointer shrink-0"
        >
          {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-300" /> : <Moon className="w-3.5 h-3.5 text-violet-600" />}
        </button>

        <button
          type="button"
          onClick={onDownloadAll}
          disabled={pendingDownloadCount === 0 && !isDownloading}
          className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 disabled:opacity-50 text-slate-950 font-bold shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
        >
          {isDownloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Zap className="w-3.5 h-3.5" />
          )}
          <span>
            {isDownloading
              ? 'Đang tải...'
              : pendingDownloadCount > 0
              ? `Tải tất cả (${pendingDownloadCount})`
              : 'Tải tất cả'}
          </span>
        </button>
      </div>
    </header>
  );
};
