import React from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  DownloadCloud,
  Loader2,
  GitBranch,
  RotateCcw,
} from 'lucide-react';
import { UpdateStatusInfo } from './UpdateModal';

interface UpdatePanelProps {
  status: UpdateStatusInfo | null;
  isChecking: boolean;
  isUpdating: boolean;
  isRestarting: boolean;
  updateError: string;
  canForceReset?: boolean;
  updateSuccessMsg: string;
  onCheckNow: () => void;
  onApplyUpdate: () => void;
  onForceUpdate?: () => void;
}

export const UpdatePanel: React.FC<UpdatePanelProps> = ({
  status,
  isChecking,
  isUpdating,
  isRestarting,
  updateError,
  canForceReset = false,
  updateSuccessMsg,
  onCheckNow,
  onApplyUpdate,
  onForceUpdate,
}) => {
  const versionLabel = status?.currentCommit
    ? `V1.0 (${status.currentCommit})`
    : status?.localVersion
    ? `V${status.localVersion}`
    : 'V1.0';

  return (
    <section className="space-y-4">
      <div className="glass-card rounded-2xl p-5 max-w-4xl space-y-4 text-xs sm:text-sm">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-400/15 pb-4">
          <div>
            <h1 className="font-display text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
              Cập nhật GaConPro V1.0
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Phiên bản hiện tại:{' '}
              <strong className="text-emerald-600 dark:text-emerald-300 font-mono">{versionLabel}</strong>
              {status?.branch ? ` • Nhánh ${status.branch}` : ''} • Sẵn sàng tải hàng loạt &amp; dựng video phái sinh hàng loạt
            </p>
          </div>

          <button
            type="button"
            onClick={onCheckNow}
            disabled={isChecking || isUpdating || isRestarting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:brightness-110 disabled:opacity-50 text-white font-bold text-xs shadow cursor-pointer whitespace-nowrap"
          >
            {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            <span>{isChecking ? 'Đang kiểm tra...' : 'Kiểm tra bản cập nhật mới'}</span>
          </button>
        </div>

        {/* Real Git Update Status Card */}
        {status && (
          <div className="rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                <GitBranch className="w-4 h-4 text-violet-500 dark:text-violet-300" />
                <span>
                  {status.branch} ({status.currentCommit || '—'})
                  {status.remoteCommit && status.remoteCommit !== status.currentCommit
                    ? ` → ${status.remoteCommit}`
                    : ''}
                </span>
              </div>

              {status.hasUpdate ? (
                <span className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/30 font-semibold tabular-nums">
                  Có {status.behindCount} bản mới từ GitHub
                </span>
              ) : status.supported ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Đang dùng bản mới nhất
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-medium">
                  Chế độ cục bộ
                </span>
              )}
            </div>

            {status.latestMessage && (
              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                <span className="text-slate-400">Commit mới nhất: </span>
                <span className="font-medium">{status.latestMessage}</span>
                {status.latestDate && (
                  <span className="ml-2 font-mono text-slate-400">({status.latestDate})</span>
                )}
              </div>
            )}

            {status.reason && !status.supported && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{status.reason}</p>
            )}

            {status.hasLocalChanges && status.hasUpdate && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Máy chủ phát hiện chỉnh sửa cục bộ chưa commit. Bạn có thể bấm Cập nhật ngay (tự động stash) hoặc Đồng bộ cưỡng bức.
                </span>
              </div>
            )}

            {updateError && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{updateError}</span>
              </div>
            )}

            {updateSuccessMsg && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{updateSuccessMsg}</span>
              </div>
            )}

            {(status.hasUpdate || canForceReset) && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {status.hasUpdate && (
                  <button
                    type="button"
                    onClick={onApplyUpdate}
                    disabled={isUpdating || isRestarting}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 disabled:opacity-50 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    {isUpdating || isRestarting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <DownloadCloud className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isRestarting
                        ? 'Đang khởi động lại máy chủ...'
                        : isUpdating
                        ? 'Đang cập nhật...'
                        : 'Cập nhật ngay'}
                    </span>
                  </button>
                )}

                {canForceReset && onForceUpdate && (
                  <button
                    type="button"
                    onClick={onForceUpdate}
                    disabled={isUpdating || isRestarting}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-amber-700 dark:text-amber-300 font-semibold text-xs cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Đồng bộ cưỡng bức từ GitHub</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Feature Highlights Changelog */}
        <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
          <div className="rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/15 p-3.5">
            <div className="font-bold text-cyan-700 dark:text-cyan-300">
              • Luồng Tải hàng loạt &amp; Xử lý FFmpeg
            </div>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Tách tập Bilibili P1/P2 tự động, xóa logo gốc, gắn logo thương hiệu, biến đổi khung hình và xuất ZIP theo thư mục cấu hình.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/15 p-3.5">
            <div className="font-bold text-violet-700 dark:text-violet-300">
              • Studio Phái Sinh &amp; Sáng Tạo Hàng Loạt (3 Giai đoạn)
            </div>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Hỗ trợ Series và Nhiều video độc lập, khóa nhân vật đồng bộ 5 thành phần, lên kịch bản hàng loạt và dựng xuất MP4 với giọng đọc AI / VieNeu-TTS Offline.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/15 p-3.5">
            <div className="font-bold text-emerald-700 dark:text-emerald-300">
              • Gộp Xu hướng &amp; Tìm kiếm Độc lập + Trung tâm Cấu hình 3 Tab
            </div>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Chuyển đổi tức thì giữa bảng xếp hạng Xu hướng và Tìm kiếm trực tiếp không giới hạn, cùng bảng 3 tab hợp nhất Cookies · AI Kịch bản · Muse2API Pool.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
