import React, { useState } from 'react';
import {
  Download,
  Flame,
  Clapperboard,
  Settings,
  RefreshCw,
  Rocket,
  Menu,
  X,
  Cpu,
  Activity,
} from 'lucide-react';
import { ServerCapabilitiesStatus } from '../types/bilibili';
import { APP_VERSION } from '../version';

export type AppNavTab =
  | 'download'
  | 'trending'
  | 'search'
  | 'studio'
  | 'command_center'
  | 'production_monitor'
  | 'settings'
  | 'update';

interface SidebarProps {
  activeTab: AppNavTab;
  onSelectTab: (tab: Exclude<AppNavTab, 'search'>) => void;
  queueCount: number;
  trendingCount: number;
  configuredCookiesCount: number;
  updateAvailable: boolean;
  subfolderName: string;
  capabilities: ServerCapabilitiesStatus | null;
  appVersion?: string;
  onRunBatchAction: () => void;
  activeProductionProgressPct?: number;
  activeProductionRunning?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  queueCount,
  trendingCount,
  configuredCookiesCount,
  updateAvailable,
  subfolderName,
  capabilities,
  appVersion = APP_VERSION,
  onRunBatchAction,
  activeProductionProgressPct,
  activeProductionRunning = false,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const normalizedTab = activeTab === 'search' ? 'trending' : activeTab;
  const muse = capabilities?.aiProviders?.muse2api;
  const ffmpegAvailable = capabilities?.localTools?.ffmpeg?.available ?? true;
  const museStatusText = muse?.configured
    ? `${muse.healthyAccounts}/${muse.accountsCount || 1} kênh`
    : muse?.reachable
    ? 'Chưa nạp acc'
    : 'Sẵn sàng tự host';

  const handleNavClick = (tab: Exclude<AppNavTab, 'search'>) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <aside className="w-full lg:w-[258px] lg:shrink-0 glass-card border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-400/15 flex flex-col justify-between p-4 lg:sticky lg:top-0 lg:h-screen overflow-y-auto z-30">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-400/15">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-violet-600/30 font-display font-extrabold text-white text-sm shrink-0">
              GP
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-display font-extrabold text-sm tracking-tight text-slate-900 dark:text-white">
                  GaConPro
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-500/15 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-400/30 tabular-nums">
                  V{appVersion}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Batch &amp; Derivative AI Suite</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Mở menu điều hướng"
            className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
            <span>Menu</span>
          </button>
        </div>

        {/* Navigation Groups */}
        <div className={`${mobileMenuOpen ? 'block' : 'hidden'} lg:block space-y-5`}>
          <div>
            <div className="px-2.5 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-400">
              LUỒNG CHÍNH
            </div>
            <ul className="space-y-1 text-xs sm:text-[13px]">
              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('download')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'download'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Download className="w-4 h-4 text-cyan-600 dark:text-cyan-300 shrink-0" />
                    <span>Tải hàng loạt</span>
                  </span>
                  <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-400/25 font-semibold">
                    {queueCount}
                  </span>
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('trending')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'trending'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Flame className="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0" />
                    <span>Xu hướng</span>
                  </span>
                  <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/25 font-semibold">
                    {trendingCount > 0 ? trendingCount : 'Hot'}
                  </span>
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('studio')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'studio'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Clapperboard className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0" />
                    <span>Studio</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-violet-500/15 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-400/30 font-semibold whitespace-nowrap">
                    3 Pha
                  </span>
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('command_center')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'command_center'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Cpu className="w-4 h-4 text-cyan-600 dark:text-cyan-300 shrink-0" />
                    <span className="truncate">Phòng Điều Hành</span>
                  </span>
                  <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-400/25 font-semibold whitespace-nowrap">
                    5 AI
                  </span>
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('production_monitor')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'production_monitor'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Activity
                      className={`w-4 h-4 shrink-0 ${
                        activeProductionRunning
                          ? 'text-emerald-500 animate-pulse'
                          : 'text-emerald-600 dark:text-emerald-300'
                      }`}
                    />
                    <span className="truncate">Phiên Sản Xuất</span>
                  </span>
                  <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/25 font-semibold whitespace-nowrap">
                    {typeof activeProductionProgressPct === 'number' ? `${activeProductionProgressPct}%` : 'Live'}
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <div>
            <div className="px-2.5 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-400">
              HỆ THỐNG &amp; DỮ LIỆU
            </div>
            <ul className="space-y-1 text-xs sm:text-[13px]">
              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('settings')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'settings'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Settings className="w-4 h-4 text-slate-500 dark:text-slate-300 shrink-0" />
                    <span className="truncate">
                      Cấu hình {configuredCookiesCount > 0 ? `• ${configuredCookiesCount}/11` : '• Đã lưu'}
                    </span>
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      configuredCookiesCount > 0 ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-amber-400'
                    }`}
                  />
                </button>
              </li>

              <li>
                <button
                  type="button"
                  onClick={() => handleNavClick('update')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition cursor-pointer ${
                    normalizedTab === 'update'
                      ? 'bg-gradient-to-r from-violet-600/15 via-violet-500/10 to-cyan-500/10 dark:from-violet-600/35 dark:to-cyan-500/15 text-slate-900 dark:text-white border border-violet-400/45 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
                    <span>Cập nhật</span>
                  </span>
                  {updateAvailable ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">
                      Có bản mới
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-300 font-mono font-medium">
                      V{appVersion}
                    </span>
                  )}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Batch Engine CTA Card */}
      <div className={`${mobileMenuOpen ? 'block' : 'hidden'} lg:block mt-6 rounded-2xl glass-card-accent p-3.5 space-y-3`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-200">
            Batch Engine
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30 font-semibold whitespace-nowrap">
            {ffmpegAvailable ? 'FFmpeg Ready' : 'FFmpeg Check'}
          </span>
        </div>

        <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
          <div className="flex justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Muse2API Pool:</span>
            <span className="text-cyan-700 dark:text-cyan-300 font-medium font-mono tabular-nums truncate">
              {museStatusText}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500 dark:text-slate-400">Thư mục xuất:</span>
            <span className="text-slate-900 dark:text-white font-medium truncate max-w-[125px]">
              {subfolderName.trim() || 'Downloads'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onRunBatchAction}
          className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:brightness-110 text-white font-bold text-xs shadow-lg shadow-violet-600/25 transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Rocket className="w-3.5 h-3.5 shrink-0" />
          <span>{normalizedTab === 'studio' ? 'Đi tới Xuất Lô MP4' : 'Chạy Lô Phái Sinh / Tải'}</span>
        </button>

        <div className="text-[10px] text-center text-slate-500 dark:text-slate-400">
          © 2026 GaConPro • FFmpeg Stream
        </div>
      </div>
    </aside>
  );
};
