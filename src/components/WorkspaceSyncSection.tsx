import React, { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Check,
  Cloud,
  CloudUpload,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { ProductionRun } from '../types/commandCenter';
import {
  classifyGoogleAuthError,
  clearGoogleWorkspaceAccessToken,
  getGoogleWorkspaceAccessToken,
  initGoogleWorkspaceAuth,
  logoutGoogleWorkspace,
  signInGoogleWorkspace,
  type GoogleAuthErrorInfo,
} from '../lib/googleWorkspaceAuth';

interface UploadedDriveFileRecord {
  artifactKey: string;
  kind: 'character' | 'keyframe' | 'video' | 'final_film';
  label: string;
  sceneIndex?: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  webViewLink: string;
  webContentLink?: string;
  uploadedAt: number;
}

interface SessionDriveArchive {
  runId: string;
  runTitle: string;
  folderId: string;
  folderName: string;
  folderUrl: string;
  lastSyncedAt: number;
  files: UploadedDriveFileRecord[];
}

interface WorkspacePublicConfig {
  spreadsheetId?: string;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
  rootFolderId?: string;
  rootFolderName?: string;
  rootFolderUrl?: string;
  lastSyncedAt?: number;
  sessionArchives: Record<string, SessionDriveArchive>;
  bridgeReady: boolean;
}

interface LiveDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  webViewLink: string;
  webContentLink?: string;
  thumbnailLink?: string;
  createdTime?: string;
}

interface LiveSheetTaskRow {
  taskCode: string;
  runId: string;
  sceneIndex: string;
  taskType: string;
  agent: string;
  instruction: string;
  status: string;
  qaScore: string;
  resultLink: string;
  qaNote: string;
  updatedAt: string;
}

interface WorkspaceSyncSectionProps {
  selectedRun: ProductionRun | null;
  onAfterCommandDispatch?: () => Promise<any>;
}

type ConfirmAction =
  | {
      kind: 'init';
      title: string;
      description: string;
      details: string[];
      existingSpreadsheetId: string;
    }
  | {
      kind: 'push';
      title: string;
      description: string;
      details: string[];
      runId: string;
    }
  | {
      kind: 'pull';
      title: string;
      description: string;
      details: string[];
    };

function formatFileSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const WorkspaceSyncSection: React.FC<WorkspaceSyncSectionProps> = ({
  selectedRun,
  onAfterCommandDispatch,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => getGoogleWorkspaceAccessToken());
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getGoogleWorkspaceAccessToken());
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [config, setConfig] = useState<WorkspacePublicConfig | null>(null);
  const [existingSheetInput, setExistingSheetInput] = useState('');
  const [driveFiles, setDriveFiles] = useState<LiveDriveFile[]>([]);
  const [sheetTasks, setSheetTasks] = useState<LiveSheetTaskRow[]>([]);

  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [authErrorInfo, setAuthErrorInfo] = useState<GoogleAuthErrorInfo | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [confirmModal, setConfirmModal] = useState<ConfirmAction | null>(null);

  const [appsScriptModal, setAppsScriptModal] = useState<{
    code: string;
    rootFolderName: string;
  } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);

  useEffect(() => {
    const unsub = initGoogleWorkspaceAuth(
      (u, tok) => {
        setUser(u);
        setToken(tok);
        setNeedsAuth(false);
      },
      () => {
        setToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/workspace/config');
      if (res.ok) {
        const data: WorkspacePublicConfig = await res.json();
        setConfig(data);
      }
    } catch {
      // ignore initial config load error
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const workspaceFetch = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const activeToken = token || getGoogleWorkspaceAccessToken();
      if (!activeToken) {
        setNeedsAuth(true);
        throw new Error('Phiên đăng nhập Google đã hết hạn. Vui lòng đăng nhập lại bằng Google.');
      }
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${activeToken}`,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers || {}),
        },
      });
      const json: any = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearGoogleWorkspaceAccessToken();
        setToken(null);
        setNeedsAuth(true);
        throw new Error('Phiên truy cập Google đã hết hạn. Hãy nhấn "Đăng nhập bằng Google" để tiếp tục.');
      }
      if (!res.ok) {
        throw new Error(json?.error || `Lỗi đồng bộ Google Workspace (HTTP ${res.status})`);
      }
      return json as T;
    },
    [token]
  );

  const loadLiveReport = useCallback(
    async (runId?: string) => {
      const activeToken = token || getGoogleWorkspaceAccessToken();
      if (!activeToken) return;
      setBusyAction('load_report');
      setErrorMsg('');
      try {
        const target = runId || selectedRun?.id || 'all';
        const data = await workspaceFetch<{
          config: WorkspacePublicConfig;
          driveFiles: LiveDriveFile[];
          sheetTasks: LiveSheetTaskRow[];
        }>(`/api/workspace/sessions/${encodeURIComponent(target)}/report`);
        setConfig(data.config);
        setDriveFiles(data.driveFiles || []);
        setSheetTasks(data.sheetTasks || []);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể tải báo cáo từ Google Sheets & Drive.');
      } finally {
        setBusyAction('');
      }
    },
    [selectedRun?.id, token, workspaceFetch]
  );

  useEffect(() => {
    if (!needsAuth && token && config?.spreadsheetId) {
      void loadLiveReport(selectedRun?.id);
    }
  }, [needsAuth, token, config?.spreadsheetId, selectedRun?.id, loadLiveReport]);

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setErrorMsg('');
    setAuthErrorInfo(null);
    setNotice('');
    try {
      const res = await signInGoogleWorkspace();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        setNeedsAuth(false);
        setNotice(`Đã kết nối Google Sheets & Google Drive (${res.user.email || 'Google Account'}).`);
      }
    } catch (err: any) {
      const info = classifyGoogleAuthError(err);
      if (info.code === 'unauthorized-domain') {
        setAuthErrorInfo(info);
      } else {
        setErrorMsg(info.message);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCopyHostname = async (hostname: string) => {
    try {
      await navigator.clipboard.writeText(hostname);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleLogout = async () => {
    await logoutGoogleWorkspace();
    setUser(null);
    setToken(null);
    setNeedsAuth(true);
    setDriveFiles([]);
    setSheetTasks([]);
    setNotice('Đã ngắt phiên đăng nhập Google.');
  };

  const executeConfirmedAction = async () => {
    if (!confirmModal) return;
    const action = confirmModal;
    setConfirmModal(null);
    setErrorMsg('');
    setNotice('');

    try {
      if (action.kind === 'init') {
        setBusyAction('init');
        const nextCfg = await workspaceFetch<WorkspacePublicConfig>('/api/workspace/init', {
          method: 'POST',
          body: JSON.stringify({
            existingSpreadsheetId: action.existingSpreadsheetId.trim() || undefined,
          }),
        });
        setConfig(nextCfg);
        setExistingSheetInput('');
        setNotice(
          `Đã sẵn sàng Google Sheets "${nextCfg.spreadsheetTitle || ''}" và thư mục gốc Google Drive "${nextCfg.rootFolderName || 'Phong_Dieu_Hanh_AI_Muse'}".`
        );
        await loadLiveReport(selectedRun?.id);
      } else if (action.kind === 'push') {
        setBusyAction('push');
        const res = await workspaceFetch<{
          config: WorkspacePublicConfig;
          sessionArchive: SessionDriveArchive;
          uploadedNewFilesCount: number;
          syncedTasksCount: number;
        }>(`/api/workspace/sessions/${encodeURIComponent(action.runId)}/push`, {
          method: 'POST',
          body: JSON.stringify({ uploadMediaToDrive: true }),
        });
        setConfig(res.config);
        setNotice(
          `Đã đồng bộ ${res.syncedTasksCount} tác vụ lên Google Sheets và tải lên ${res.uploadedNewFilesCount} tệp mới vào thư mục Drive "${res.sessionArchive.folderName}".`
        );
        await loadLiveReport(action.runId);
      } else if (action.kind === 'pull') {
        setBusyAction('pull');
        const res = await workspaceFetch<{
          dispatchedCount: number;
          dispatchedItems: Array<{ rowNumber: number; taskCode: string; action: string }>;
        }>('/api/workspace/sheets/pull-and-execute', {
          method: 'POST',
        });
        if (res.dispatchedCount === 0) {
          setNotice('Không có dòng lệnh mới nào ở trạng thái QUEUED trong tab Tac_Vu_AI trên Google Sheets.');
        } else {
          setNotice(
            `Đã nhận ${res.dispatchedCount} lệnh từ Google Sheets và giao cho Chủ tịch Gemini AI + đội Muse thực thi ngay.`
          );
          if (onAfterCommandDispatch) {
            await onAfterCommandDispatch();
          }
        }
        await loadLiveReport(selectedRun?.id);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Thao tác đồng bộ Google Workspace thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const openAppsScriptGuide = async () => {
    setBusyAction('apps_script');
    setErrorMsg('');
    try {
      const res = await fetch('/api/workspace/apps-script');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể tải mã tự động 24/7.');
      setAppsScriptModal({
        code: data.code,
        rootFolderName: data.rootFolderName,
      });
      setCopiedScript(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạo mã Google Apps Script.');
    } finally {
      setBusyAction('');
    }
  };

  const handleCopyScript = async () => {
    if (!appsScriptModal?.code) return;
    try {
      await navigator.clipboard.writeText(appsScriptModal.code);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2500);
    } catch {
      // ignore clipboard error
    }
  };

  const sessionArchive = selectedRun?.id ? config?.sessionArchives?.[selectedRun.id] : undefined;

  return (
    <div className="space-y-4">
      {/* Top Connection & Actions Header */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/75 dark:bg-[#0c1021]/80 p-4 space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
              <Cloud className="w-4 h-4 text-emerald-500" />
              <span>Đồng bộ Google Sheets (Hàng đợi lệnh & Báo cáo) + Google Drive (Lưu file theo phiên)</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Đẩy tác vụ lên Google Sheets để AI tự nhận lệnh thực thi, lưu toàn bộ ảnh/video kết quả vào thư mục Google Drive riêng cho từng phiên và xem lại ngay khi mở ứng dụng.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {needsAuth ? (
              <button
                type="button"
                disabled={isLoggingIn}
                onClick={handleGoogleSignIn}
                className="inline-flex items-center gap-2.5 h-9 px-3.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold shadow-sm cursor-pointer transition disabled:opacity-60"
              >
                {isLoggingIn ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                ) : (
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    className="w-4 h-4 shrink-0"
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l7.98-6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                )}
                <span>Sign in with Google</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{user?.email || 'Đã kết nối Google'}</span>
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Ngắt kết nối</span>
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={busyAction === 'apps_script'}
              onClick={openAppsScriptGuide}
              className="px-3 py-2 rounded-lg border border-violet-400/50 bg-violet-500/10 hover:bg-violet-500/20 text-violet-700 dark:text-violet-300 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Chạy ngầm 24/7 khi tắt PC</span>
            </button>
          </div>
        </div>

        {/* Linked Sheet & Drive Root Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#11162b] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Bảng tính Google Sheets điều phối</div>
                <div className="font-semibold text-slate-900 dark:text-white truncate">
                  {config?.spreadsheetTitle || 'Chưa khởi tạo bảng tính'}
                </div>
              </div>
            </div>
            {config?.spreadsheetUrl && (
              <a
                href={config.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 shrink-0"
              >
                <span>Mở Sheets</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#11162b] px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {sessionArchive ? `Thư mục Drive của phiên này` : 'Thư mục gốc Google Drive'}
                </div>
                <div className="font-semibold text-slate-900 dark:text-white truncate">
                  {sessionArchive?.folderName || config?.rootFolderName || 'Chưa tạo thư mục Drive'}
                </div>
              </div>
            </div>
            {(sessionArchive?.folderUrl || config?.rootFolderUrl) && (
              <a
                href={sessionArchive?.folderUrl || config?.rootFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline inline-flex items-center gap-1 shrink-0"
              >
                <span>Mở Drive</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Action Controls (only active when signed in) */}
        {!needsAuth && (
          <div className="space-y-2.5 pt-1">
            {!config?.spreadsheetId && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={existingSheetInput}
                  onChange={(e) => setExistingSheetInput(e.target.value)}
                  placeholder="Để trống để tạo Google Sheets mới, hoặc dán link/ID bảng tính có sẵn..."
                  className="flex-1 min-w-[240px] h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#11162b] text-xs text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={busyAction === 'init'}
                  onClick={() =>
                    setConfirmModal({
                      kind: 'init',
                      title: 'Xác nhận khởi tạo Google Sheets & Google Drive',
                      description: existingSheetInput.trim()
                        ? 'Ứng dụng sẽ kết nối vào bảng tính Google Sheets bạn cung cấp và tạo 3 tab chuẩn (Phien_San_Xuat, Tac_Vu_AI, File_Ket_Qua) cùng thư mục gốc trên Google Drive.'
                        : 'Ứng dụng sẽ tạo mới 1 bảng tính Google Sheets điều phối sản xuất và 1 thư mục gốc "Phong_Dieu_Hanh_AI_Muse" trong Google Drive của bạn.',
                      details: [
                        'Tab Phien_San_Xuat: Báo cáo tổng hợp từng phiên sản xuất và link Drive.',
                        'Tab Tac_Vu_AI: Hàng đợi lệnh QUEUED/RUNNING/DONE và báo cáo kiểm định Muse 05.',
                        'Tab File_Ket_Qua: Danh sách ảnh/video/phim hoàn chỉnh theo phiên.',
                      ],
                      existingSpreadsheetId: existingSheetInput,
                    })
                  }
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {busyAction === 'init' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                  <span>Khởi tạo Sheets & Drive</span>
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {selectedRun && (
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() =>
                    setConfirmModal({
                      kind: 'push',
                      runId: selectedRun.id,
                      title: 'Xác nhận đẩy phiên lên Google Sheets & lưu file vào Google Drive',
                      description: `Ứng dụng sẽ tạo thư mục riêng trên Google Drive cho phiên "${selectedRun.title}" (${selectedRun.id}), tải toàn bộ ảnh nhân vật, ảnh phân cảnh, video cảnh và phim hoàn chỉnh lên Drive, đồng thời cập nhật bảng lệnh & báo cáo trên Google Sheets.`,
                      details: [
                        `Phiên đồng bộ: ${selectedRun.title} (${selectedRun.id})`,
                        `Thư mục lưu: Phong_Dieu_Hanh_AI_Muse / ${selectedRun.id} - ${selectedRun.title}`,
                        'Các tệp đã tải lên trước đó sẽ được tự động bỏ qua để không trùng lặp.',
                      ],
                    })
                  }
                  className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  {busyAction === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                  <span>Đẩy phiên & lưu file lên Drive + Sheets</span>
                </button>
              )}

              {config?.spreadsheetId && (
                <>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      setConfirmModal({
                        kind: 'pull',
                        title: 'Xác nhận đọc lệnh từ Google Sheets và chạy AI',
                        description:
                          'Ứng dụng sẽ đọc tab Tac_Vu_AI trên Google Sheets, tìm các dòng đang có trạng thái QUEUED (chờ chạy), cập nhật trạng thái dòng đó sang RUNNING và giao Chủ tịch Gemini AI + đội Muse thực thi ngay.',
                        details: [
                          `Bảng tính: ${config.spreadsheetTitle || config.spreadsheetId}`,
                          'Chỉ xử lý các dòng có cột Trạng Thái = QUEUED / PENDING / RUN.',
                        ],
                      })
                    }
                    className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {busyAction === 'pull' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>Nhận lệnh QUEUED từ Sheets cho AI chạy</span>
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void loadLiveReport(selectedRun?.id)}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#11162b] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'load_report' ? 'animate-spin' : ''}`} />
                    <span>Tải báo cáo & file Drive</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {authErrorInfo && authErrorInfo.code === 'unauthorized-domain' && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50/90 dark:bg-amber-950/30 p-4 space-y-3 text-xs text-slate-800 dark:text-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="font-semibold text-amber-800 dark:text-amber-300">
                Tên miền hiện tại chưa được cấp phép đăng nhập Google (auth/unauthorized-domain)
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                Firebase Authentication của dự án{' '}
                <code className="font-mono font-semibold text-slate-900 dark:text-white">
                  {authErrorInfo.firebaseProjectId}
                </code>{' '}
                chưa có tên miền{' '}
                <code className="font-mono font-semibold text-amber-800 dark:text-amber-300">
                  {authErrorInfo.currentHostname}
                </code>{' '}
                trong danh sách <strong>Authorized domains</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAuthErrorInfo(null)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <ol className="list-decimal pl-5 space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
            <li>
              Bấm nút <strong>Mở cài đặt Firebase Authorized Domains</strong> bên dưới.
            </li>
            <li>
              Vào mục <strong>Authorized domains</strong> → bấm <strong>Add domain</strong> → dán{' '}
              <code className="font-mono font-semibold">{authErrorInfo.currentHostname}</code> → bấm{' '}
              <strong>Add</strong>.
            </li>
            <li>
              Quay lại trang này (đợi 5–10 giây) rồi bấm <strong>Sign in with Google</strong> lại.
            </li>
          </ol>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void handleCopyHostname(authErrorInfo.currentHostname)}
              className="px-3 py-1.5 rounded-lg border border-amber-400/60 bg-white dark:bg-[#11162b] hover:bg-amber-100/60 dark:hover:bg-slate-800 text-[11px] font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedDomain ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>
                {copiedDomain ? 'Đã sao chép tên miền' : `Sao chép: ${authErrorInfo.currentHostname}`}
              </span>
            </button>

            <a
              href={authErrorInfo.firebaseAuthSettingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold inline-flex items-center gap-1.5"
            >
              <span>Mở cài đặt Firebase Authorized Domains</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/35 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {/* Session Files Stored in Google Drive */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4 text-amber-500" />
            <span>
              File kết quả đã lưu trên Google Drive ({driveFiles.length > 0 ? driveFiles.length : sessionArchive?.files.length || 0})
            </span>
          </span>
          {sessionArchive?.folderUrl && (
            <a
              href={sessionArchive.folderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              <span>Mở thư mục phiên trên Drive</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {driveFiles.length === 0 && (!sessionArchive || sessionArchive.files.length === 0) ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Chưa có file kết quả nào được lưu trên Google Drive cho phiên này. Hãy nhấn <strong>"Đẩy phiên & lưu file lên Drive + Sheets"</strong> hoặc để bộ chạy ngầm 24/7 tự động lưu.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {(driveFiles.length > 0
              ? driveFiles.map((f) => ({
                  id: f.id,
                  name: f.name,
                  mimeType: f.mimeType,
                  size: f.size,
                  webViewLink: f.webViewLink,
                  webContentLink: f.webContentLink,
                }))
              : (sessionArchive?.files || []).map((f) => ({
                  id: f.fileId,
                  name: f.fileName,
                  mimeType: f.mimeType,
                  size: f.sizeBytes,
                  webViewLink: f.webViewLink,
                  webContentLink: f.webContentLink,
                }))
            ).map((file) => {
              const isVideo = file.mimeType?.startsWith('video/');
              const isImage = file.mimeType?.startsWith('image/');
              return (
                <div
                  key={file.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] p-3 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
                      {isVideo ? (
                        <Film className="w-4 h-4 text-violet-500" />
                      ) : isImage ? (
                        <ImageIcon className="w-4 h-4 text-cyan-500" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{file.name}</div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {isVideo ? 'Video' : isImage ? 'Hình ảnh' : 'Tệp'}
                        {file.size ? ` · ${formatFileSize(file.size)}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={file.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Xem</span>
                    </a>
                    {file.webContentLink && (
                      <a
                        href={file.webContentLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                        title="Tải xuống từ Google Drive"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live Google Sheets Task & QA Report Table */}
      {sheetTasks.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            Bảng lệnh & Báo cáo kiểm định trên Google Sheets ({sheetTasks.length} dòng)
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700/50">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/80 dark:bg-[#0c1021] text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700/50">
                <tr>
                  <th className="px-3 py-2 font-semibold">Mã</th>
                  <th className="px-3 py-2 font-semibold">AI</th>
                  <th className="px-3 py-2 font-semibold">Lệnh thực thi</th>
                  <th className="px-3 py-2 font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 font-semibold">QA</th>
                  <th className="px-3 py-2 font-semibold">Kết quả / Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800 bg-white/80 dark:bg-[#11162b]/80">
                {sheetTasks.slice(0, 40).map((row, idx) => (
                  <tr key={`${row.taskCode}_${idx}`}>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {row.taskCode}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">{row.agent || '—'}</td>
                    <td className="px-3 py-2 max-w-[260px] truncate text-slate-800 dark:text-slate-200">
                      {row.instruction}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] font-semibold whitespace-nowrap">
                      <span
                        className={
                          row.status === 'DONE'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.status === 'RUNNING'
                            ? 'text-cyan-600 dark:text-cyan-400'
                            : row.status === 'ERROR'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap">{row.qaScore || '—'}</td>
                    <td className="px-3 py-2 text-[11px] max-w-[180px] truncate">
                      {row.resultLink?.startsWith('http') ? (
                        <a
                          href={row.resultLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-violet-600 dark:text-violet-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span>Mở Drive</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-500">{row.resultLink || row.qaNote || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mandatory Explicit User Confirmation Modal before Mutating Google Sheets / Drive */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-card rounded-2xl p-5 border border-emerald-400/50 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-display font-bold text-slate-900 dark:text-white">
                {confirmModal.title}
              </h3>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {confirmModal.description}
            </p>
            <ul className="space-y-1.5 rounded-xl bg-slate-100/80 dark:bg-[#0c1021] p-3 text-[11px] text-slate-600 dark:text-slate-300 list-disc pl-6">
              {confirmModal.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => void executeConfirmedAction()}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
              >
                Xác nhận thực hiện
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 24/7 PC-Off Google Apps Script Bridge Modal */}
      {appsScriptModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl glass-card rounded-2xl p-5 border border-violet-400/50 space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  Cài đặt chạy ngầm 24/7 trên Google Sheets (Tắt máy PC vẫn tự chạy)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Dán đoạn mã này vào <strong>Google Sheets → Tiện ích mở rộng → Apps Script</strong> và đặt lịch chạy mỗi 5 phút. Ngay cả khi tắt PC, Google Cloud vẫn tự đọc dòng <code className="font-mono">QUEUED</code>, gửi lệnh cho đội AI Cloud sản xuất, tự tải file về thư mục <strong>{appsScriptModal.rootFolderName}</strong> trên Google Drive theo từng phiên và cập nhật báo cáo!
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAppsScriptModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <pre className="flex-1 overflow-auto rounded-xl bg-slate-950 text-slate-100 p-3.5 text-[11px] font-mono leading-relaxed border border-slate-800">
              {appsScriptModal.code}
            </pre>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Lưu ý: Trong tab <strong>Tac_Vu_AI</strong>, chỉ cần gõ lệnh kịch bản vào cột F và đặt cột G = <strong>QUEUED</strong>.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyScript()}
                  className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedScript ? 'Đã sao chép mã' : 'Sao chép mã Apps Script'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAppsScriptModal(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
