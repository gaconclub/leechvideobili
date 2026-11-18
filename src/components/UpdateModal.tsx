import React from 'react';
import { X, RefreshCw, DownloadCloud, CheckCircle2, AlertTriangle, GitBranch } from 'lucide-react';

export interface SystemUpdateStatus {
  supported: boolean;
  hasUpdate?: boolean;
  behindCount?: number;
  currentCommit?: string;
  latestCommit?: string;
  latestMessage?: string;
  branch?: string;
  remoteUrl?: string;
  supervisorActive?: boolean;
  fetchError?: string;
  reason?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  status: SystemUpdateStatus | null;
  isChecking: boolean;
  isUpdating: boolean;
  isRestarting: boolean;
  updateError: string;
  canForceReset?: boolean;
  updateSuccessMsg: string;
  onCheckNow: () => void;
  onApplyUpdate: () => void;
  onForceUpdate?: () => void;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  status,
  isChecking,
  isUpdating,
  isRestarting,
  updateError,
  canForceReset,
  updateSuccessMsg,
  onCheckNow,
  onApplyUpdate,
  onForceUpdate,
  onClose,
}) => {
  if (!isOpen) return null;

  const busy = isUpdating || isRestarting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <DownloadCloud className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <h2
              id="update-modal-title"
              className="font-display text-base font-semibold text-slate-900 dark:text-white"
            >
              Cập nhật ứng dụng từ GitHub
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isChecking && !status ? (
            <div className="flex items-center gap-3 py-4 text-sm text-slate-600 dark:text-slate-300">
              <RefreshCw className="w-4 h-4 animate-spin text-[#003B3E] dark:text-[#1BA8AD]" />
              <span>Đang kiểm tra phiên bản mới trên GitHub...</span>
            </div>
          ) : status && !status.supported ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-200 leading-relaxed flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-1">Tính năng tự cập nhật chưa khả dụng ở môi trường này</p>
                  <p>{status.reason || 'Thư mục chạy hiện tại không phải bản clone từ GitHub.'}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Khi chạy trên máy tính Windows từ thư mục đã kết nối GitHub (`git clone` hoặc đã gắn `git remote add origin`) và mở bằng file <strong>start-windows.bat</strong>, bạn chỉ cần bấm nút cập nhật tại đây để tự kéo bản mới và khởi động lại app.
              </p>
            </div>
          ) : status ? (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5" />
                    Nhánh &amp; Phiên bản hiện tại
                  </span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {status.branch || 'main'} · {status.currentCommit || 'unknown'}
                  </span>
                </div>
                {status.remoteUrl && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    Repo: {status.remoteUrl}
                  </div>
                )}
              </div>

              {status.fetchError ? (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-700 dark:text-amber-300">
                  Không thể kiểm tra GitHub lúc này: {status.fetchError}
                </div>
              ) : status.hasUpdate ? (
                <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <span>Có {status.behindCount || 1} bản cập nhật mới trên GitHub!</span>
                    {status.latestCommit && <span className="font-mono">{status.latestCommit}</span>}
                  </div>
                  {status.latestMessage && (
                    <p className="text-xs text-emerald-800 dark:text-emerald-200">
                      Nội dung mới nhất: <span className="font-medium">{status.latestMessage}</span>
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Bạn đang dùng phiên bản mới nhất trên GitHub.</span>
                </div>
              )}

              {!status.supervisorActive && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Mẹo: Mở app bằng file <strong>start-windows.bat</strong> để sau khi cập nhật app tự khởi động lại hoàn toàn.
                </p>
              )}
            </div>
          ) : null}

          {isRestarting && (
            <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50 flex items-center gap-2.5 text-xs text-sky-700 dark:text-sky-300">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
              <span>Đang khởi động lại máy chủ với phiên bản mới... Trang sẽ tự tải lại sau vài giây.</span>
            </div>
          )}

          {updateSuccessMsg && !isRestarting && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-700 dark:text-emerald-300">
              {updateSuccessMsg}
            </div>
          )}

          {updateError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400 space-y-2.5">
              <p className="break-words">{updateError}</p>
              {canForceReset && onForceUpdate && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onForceUpdate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Ghi đè xung đột &amp; Cập nhật theo GitHub</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 bg-slate-50 dark:bg-[#000A10]/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={isChecking || busy || !status?.supported}
            onClick={onCheckNow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>Kiểm tra lại</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
            >
              Đóng
            </button>
            {status?.supported && (
              <button
                type="button"
                disabled={busy || isChecking}
                onClick={onApplyUpdate}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                {isUpdating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang cập nhật...</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud className="w-3.5 h-3.5" />
                    <span>{status.hasUpdate ? 'Cập nhật & Khởi động lại' : 'Đồng bộ lại từ GitHub'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
