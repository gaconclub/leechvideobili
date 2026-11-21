import React, { useState } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  DownloadCloud,
  Loader2,
  GitBranch,
  Link2,
  RotateCcw,
  History,
  Calendar,
} from 'lucide-react';
import { ReleaseUpdateItem, UpdateStatusInfo } from './UpdateModal';
import { APP_VERSION } from '../version';
import defaultChangelog from '../changelog.json';

interface UpdatePanelProps {
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
}

export const UpdatePanel: React.FC<UpdatePanelProps> = ({
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
}) => {
  const [showRepoForm, setShowRepoForm] = useState(false);
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [branchInput, setBranchInput] = useState('main');
  const currentVersion = status?.localVersion || APP_VERSION;
  const versionLabel = status?.currentCommit
    ? `V${currentVersion} (${status.currentCommit})`
    : `V${currentVersion}`;
  const remoteRef = status?.remoteCommit || status?.latestCommit;
  const recentUpdates: ReleaseUpdateItem[] = (
    status?.recentUpdates && status.recentUpdates.length > 0
      ? status.recentUpdates
      : (defaultChangelog as ReleaseUpdateItem[])
  ).slice(0, 3);

  return (
    <section className="space-y-4">
      <div className="glass-card rounded-2xl p-5 max-w-4xl space-y-4 text-xs sm:text-sm">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-400/15 pb-4">
          <div>
            <h1 className="font-display text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white">
              Cập nhật GaConPro V{currentVersion}
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
                  {status.branch} ({status.currentCommit || `V${currentVersion}`})
                  {remoteRef && remoteRef !== status.currentCommit
                    ? ` → ${status.remoteVersion ? `V${status.remoteVersion} · ` : ''}${remoteRef}`
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

            {onConnectGithub && (!status.supported || showRepoForm) && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!repoUrlInput.trim() || isConnecting) return;
                  const ok = await onConnectGithub(repoUrlInput.trim(), branchInput.trim());
                  if (ok) setShowRepoForm(false);
                }}
                className="p-3 rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-500/30 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
                    <Link2 className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
                    <span>Kết nối kho GitHub để cập nhật tự động</span>
                  </span>
                  {status.supported && (
                    <button
                      type="button"
                      onClick={() => setShowRepoForm(false)}
                      className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                    >
                      Đóng
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="url"
                    required
                    disabled={isConnecting || isUpdating}
                    value={repoUrlInput}
                    onChange={(e) => setRepoUrlInput(e.target.value)}
                    placeholder="https://github.com/tai-khoan/ten-repo"
                    className="sm:col-span-8 h-9 px-3 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
                  />
                  <input
                    type="text"
                    disabled={isConnecting || isUpdating}
                    value={branchInput}
                    onChange={(e) => setBranchInput(e.target.value)}
                    placeholder="Nhánh (vd: main)"
                    className="sm:col-span-2 h-9 px-2.5 text-xs bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="submit"
                    disabled={isConnecting || isUpdating || !repoUrlInput.trim()}
                    className="sm:col-span-2 h-9 px-3 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition disabled:opacity-50 cursor-pointer whitespace-nowrap inline-flex items-center justify-center gap-1.5"
                  >
                    {isConnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isConnecting ? 'Đang nối...' : 'Kết nối'}</span>
                  </button>
                </div>
              </form>
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

            {(status.hasUpdate || canForceReset || (status.supported && onConnectGithub && !showRepoForm)) && (
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

                {status.supported && onConnectGithub && !showRepoForm && (
                  <button
                    type="button"
                    onClick={() => {
                      setRepoUrlInput((status as any).remoteUrl?.replace(/\.git$/, '') || '');
                      setBranchInput(status.branch || 'main');
                      setShowRepoForm(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 font-medium text-xs cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Đổi link GitHub</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 3 Latest Updates Changelog */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white inline-flex items-center gap-2">
              <History className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
              <span>3 lần cập nhật gần nhất</span>
            </h2>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Hiển thị ngày phát hành &amp; tóm tắt thay đổi
            </span>
          </div>

          <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300">
            {recentUpdates.map((item, idx) => (
              <div
                key={`${item.version}-${item.date}-${idx}`}
                className={`rounded-xl border p-3.5 space-y-2 ${
                  idx === 0
                    ? 'bg-gradient-to-br from-violet-500/8 via-slate-50 to-cyan-500/8 dark:from-violet-950/35 dark:via-[#0c1021]/95 dark:to-cyan-950/25 border-violet-300/60 dark:border-violet-400/30'
                    : 'bg-slate-50 dark:bg-[#0c1021]/90 border-slate-200 dark:border-slate-400/15'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold text-[11px] tabular-nums ${
                        idx === 0
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-400/30'
                          : 'bg-slate-200/75 dark:bg-white/10 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      V{item.version}
                    </span>
                    {idx === 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-400/25 text-[10px] font-semibold">
                        Mới nhất
                      </span>
                    )}
                    <span className="font-bold text-slate-900 dark:text-white">{item.title}</span>
                  </div>

                  <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{item.date}</span>
                    {item.commit && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-white/10 text-[10px]">
                        {item.commit}
                      </span>
                    )}
                  </div>
                </div>

                {item.changes && item.changes.length > 0 && (
                  <ul className="space-y-1 pl-4 list-disc text-slate-600 dark:text-slate-300 leading-relaxed">
                    {item.changes.map((line, cIdx) => (
                      <li key={cIdx}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
