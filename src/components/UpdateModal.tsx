import React, { useState } from 'react';
import {
  X,
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  GitBranch,
  Link2,
  RotateCcw,
} from 'lucide-react';

import { APP_VERSION } from '../version';

export interface ReleaseUpdateItem {
  version: string;
  date: string;
  title: string;
  changes: string[];
  commit?: string;
}

export interface UpdateStatusInfo {
  supported: boolean;
  reason?: string;
  repoUrl?: string;
  remoteUrl?: string;
  branch?: string;
  currentCommit?: string;
  remoteCommit?: string;
  latestCommit?: string;
  behindCount?: number;
  hasUpdate?: boolean;
  latestMessage?: string;
  latestDate?: string;
  hasLocalChanges?: boolean;
  localVersion?: string;
  remoteVersion?: string;
  recentUpdates?: ReleaseUpdateItem[];
  checkedAt?: number;
  error?: string;
}

interface UpdateModalProps {
  isOpen: boolean;
  status: UpdateStatusInfo | null;
  isChecking: boolean;
  isUpdating: boolean;
  isConnecting?: boolean;
  isRestarting: boolean;
  updateError: string;
  canForceReset?: boolean;
  updateSuccessMsg: string;
  onCheckNow: () => void;
  onApplyUpdate: () => void;
  onForceUpdate?: () => void;
  onConnectGithub?: (repoUrl: string, branch?: string) => Promise<boolean>;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  status,
  isChecking,
  isUpdating,
  isConnecting = false,
  isRestarting,
  updateError,
  canForceReset = false,
  updateSuccessMsg,
  onCheckNow,
  onApplyUpdate,
  onForceUpdate,
  onConnectGithub,
  onClose,
}) => {
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [branchInput, setBranchInput] = useState('main');
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg glass-card-accent rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-400/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 text-white flex items-center justify-center">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Cập nhật GaConPro V{status?.localVersion || APP_VERSION}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Đồng bộ phiên bản mới nhất từ GitHub và tự khởi động lại server
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUpdating || isRestarting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {isRestarting ? (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/30 flex items-center gap-3 text-emerald-700 dark:text-emerald-300">
              <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-sm">Đang khởi động lại máy chủ để áp dụng bản mới...</p>
                <p className="text-[11px] opacity-85">
                  Trang web sẽ tự động tải lại trong vài giây khi server sẵn sàng.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Phiên bản đang chạy</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5 text-violet-500 dark:text-violet-300" />
                    {status?.branch || 'main'} · V{status?.localVersion || APP_VERSION}
                    {status?.currentCommit ? ` (${status.currentCommit})` : ''}
                  </span>
                </div>

                {status?.supported && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Bản mới nhất trên GitHub</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {status.remoteVersion ? `V${status.remoteVersion}` : ''}
                      {status.remoteVersion && (status.remoteCommit || status.latestCommit) ? ' · ' : ''}
                      {status.remoteCommit || status.latestCommit || (status.remoteVersion ? '' : '—')}
                      {status.behindCount ? (
                        <span className="ml-1.5 text-amber-600 dark:text-amber-300">
                          (+{status.behindCount} commit)
                        </span>
                      ) : null}
                    </span>
                  </div>
                )}

                {status?.latestMessage && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-400/15 space-y-0.5">
                    <span className="text-[11px] text-slate-400">Thay đổi mới nhất:</span>
                    <p className="text-slate-800 dark:text-slate-100 font-medium leading-snug">
                      {status.latestMessage}
                    </p>
                    {status.latestDate && (
                      <p className="text-[11px] text-slate-400 font-mono">{status.latestDate}</p>
                    )}
                  </div>
                )}
              </div>

              {status && !status.supported && (
                <div className="space-y-2.5">
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{status.reason || 'Không tìm thấy kho GitHub để cập nhật tự động.'}</span>
                  </div>
                  {onConnectGithub && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!repoUrlInput.trim() || isConnecting) return;
                        await onConnectGithub(repoUrlInput.trim(), branchInput.trim());
                      }}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-500/30 space-y-2"
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                        <Link2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
                        <span>Gắn link kho GitHub để cập nhật</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="url"
                          required
                          disabled={isConnecting || isUpdating}
                          value={repoUrlInput}
                          onChange={(e) => setRepoUrlInput(e.target.value)}
                          placeholder="https://github.com/tai-khoan/ten-repo"
                          className="flex-1 min-w-[200px] h-8 px-2.5 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
                        />
                        <input
                          type="text"
                          disabled={isConnecting || isUpdating}
                          value={branchInput}
                          onChange={(e) => setBranchInput(e.target.value)}
                          placeholder="main"
                          className="w-20 h-8 px-2 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
                        />
                        <button
                          type="submit"
                          disabled={isConnecting || isUpdating || !repoUrlInput.trim()}
                          className="h-8 px-3 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-50 cursor-pointer inline-flex items-center gap-1"
                        >
                          {isConnecting && <Loader2 className="w-3 h-3 animate-spin" />}
                          <span>{isConnecting ? 'Đang nối...' : 'Kết nối'}</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {status?.supported && !status.hasUpdate && !isChecking && !updateError && !updateSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-medium">
                    Bạn đang sử dụng phiên bản mới nhất trên GitHub!
                  </span>
                </div>
              )}

              {status?.hasUpdate && (
                <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/30 text-cyan-800 dark:text-cyan-200 space-y-1">
                  <p className="font-semibold">
                    Đã có {status.behindCount} bản cập nhật mới sẵn sàng cài đặt!
                  </p>
                  <p className="text-[11px] opacity-90">
                    Toàn bộ cookie, cấu hình thư mục, dự án Studio và tệp tải về của bạn sẽ được giữ nguyên an toàn.
                  </p>
                </div>
              )}

              {updateError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{updateError}</span>
                </div>
              )}

              {updateSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{updateSuccessMsg}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200/80 dark:border-slate-400/20 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-[#0c1021]/60">
          <button
            type="button"
            onClick={onCheckNow}
            disabled={isChecking || isUpdating || isRestarting}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Đang kiểm tra...' : 'Kiểm tra lại'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isUpdating || isRestarting}
              className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 rounded-xl transition-colors cursor-pointer disabled:opacity-40"
            >
              Đóng
            </button>

            {status?.hasUpdate && (
              <button
                type="button"
                onClick={onApplyUpdate}
                disabled={isUpdating || isRestarting || isChecking}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:brightness-110 disabled:opacity-50 rounded-xl transition cursor-pointer"
              >
                {isUpdating || isRestarting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5" />
                )}
                <span>{isUpdating ? 'Đang tải & cập nhật...' : 'Cập nhật ngay'}</span>
              </button>
            )}

            {canForceReset && onForceUpdate && (
              <button
                type="button"
                onClick={onForceUpdate}
                disabled={isUpdating || isRestarting || isChecking}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Cưỡng bức</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
