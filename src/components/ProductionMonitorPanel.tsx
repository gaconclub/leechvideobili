import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Film,
  FolderOpen,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import type { CommandCenterState } from '../types/commandCenter';
import type {
  CoordinationCenterState,
  CoordinationSession,
  CoordinationTaskRow,
  CoordinationTaskStatus,
  IndependentVideoSource,
} from '../types/coordinationCenter';
import { useCoordinationCenterLive } from '../hooks/useCoordinationCenterLive';
import { getGoogleWorkspaceAccessToken } from '../lib/googleWorkspaceAuth';

interface ProductionMonitorPanelProps {
  state?: CommandCenterState | null;
  setState?: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  loading?: boolean;
  sseConnected?: boolean;
  onRefresh?: (forceHealth?: boolean) => Promise<CommandCenterState | null>;
  onOpenCommandCenter?: (
    subTab?: 'overview' | 'progress' | 'chairman' | 'chat' | 'tasks' | 'pipeline' | 'qa' | 'incidents' | 'perf'
  ) => void;
}

const SOURCE_META: Record<IndependentVideoSource, { label: string; short: string }> = {
  gemini: { label: 'Gemini AI (Độc lập)', short: 'Gemini AI' },
  qwen: { label: 'AI Qwen · Alibaba (Độc lập)', short: 'AI Qwen' },
  muse: { label: 'Muse AI · Muse2API (Độc lập)', short: 'Muse AI' },
  google_flow: { label: 'Google Flow · Veo (Độc lập)', short: 'Google Flow' },
};

function fmtDateTime(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

function sessionStatusMeta(status: CoordinationSession['status']): {
  label: string;
  badge: string;
} {
  switch (status) {
    case 'DANG_CHAY':
      return {
        label: 'Đang sản xuất',
        badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35',
      };
    case 'HOAN_THANH':
      return {
        label: 'Hoàn thành',
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
      };
    case 'CO_LOI':
      return {
        label: 'Có lỗi',
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35',
      };
    case 'CHO_FLOW':
      return {
        label: 'Chờ nạp Google Flow',
        badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
      };
    case 'TAM_DUNG':
      return {
        label: 'Đã tạm dừng',
        badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
      };
    default:
      return {
        label: 'Đang chờ đến phiên',
        badge: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35',
      };
  }
}

function taskStatusMeta(status: CoordinationTaskStatus): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'HOAN_THANH':
      return {
        label: 'Hoàn thành',
        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
      };
    case 'DANG_LAM':
      return {
        label: 'Đang làm',
        cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35',
      };
    case 'LOI':
      return {
        label: 'Lỗi',
        cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35',
      };
    case 'CHO_NHAP_FLOW':
      return {
        label: 'Chờ nạp Flow',
        cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
      };
    default:
      return {
        label: 'Chờ nhận',
        cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/30',
      };
  }
}

export const ProductionMonitorPanel: React.FC<ProductionMonitorPanelProps> = ({
  onOpenCommandCenter,
}) => {
  const { state, setState, loading, sseConnected, refreshState } = useCoordinationCenterLive(true);
  const [selectedIdOverride, setSelectedIdOverride] = useState<string>('');
  const [detailTab, setDetailTab] = useState<'scenes' | 'reports'>('scenes');
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const sessions = state?.sessions || [];

  const selectedSession: CoordinationSession | null = useMemo(() => {
    if (sessions.length === 0) return null;
    if (selectedIdOverride) {
      const hit = sessions.find((s) => s.sessionId === selectedIdOverride);
      if (hit) return hit;
    }
    if (state?.activeSessionId) {
      const active = sessions.find((s) => s.sessionId === state.activeSessionId);
      if (active) return active;
    }
    return sessions[0] || null;
  }, [sessions, selectedIdOverride, state?.activeSessionId]);

  const callCoordApi = async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const tok = getGoogleWorkspaceAccessToken();
    const headers: Record<string, string> = {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    };
    const res = await fetch(url, { ...init, headers });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Thao tác thất bại (HTTP ${res.status})`);
    }
    if (data?.state) {
      setState(data.state as CoordinationCenterState);
    }
    return data as T;
  };

  const handleSelectSession = async (sessionId: string) => {
    setSelectedIdOverride(sessionId);
    setErrorMsg('');
    try {
      const next = await callCoordApi<CoordinationCenterState>(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/select`,
        { method: 'POST' }
      );
      setState(next);
    } catch {
      // keep local selection even if select endpoint fails
    }
  };

  const handleRunSession = async (sessionId: string, retryErrors = false) => {
    setBusyKey(retryErrors ? `retry_${sessionId}` : `run_${sessionId}`);
    setErrorMsg('');
    setNotice('');
    try {
      await callCoordApi(`/api/coordination/sessions/${encodeURIComponent(sessionId)}/run`, {
        method: 'POST',
        body: JSON.stringify({ retryErrors }),
      });
      setNotice(
        retryErrors
          ? `Đang chạy lại các tác vụ lỗi của phiên ${sessionId}.`
          : `Đã khởi động sản xuất tuần tự cho phiên ${sessionId}.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chạy phiên sản xuất.');
    } finally {
      setBusyKey('');
    }
  };

  const handlePauseSession = async (sessionId: string) => {
    setBusyKey(`pause_${sessionId}`);
    setErrorMsg('');
    try {
      await callCoordApi(`/api/coordination/sessions/${encodeURIComponent(sessionId)}/pause`, {
        method: 'POST',
      });
      setNotice(`Đã tạm dừng an toàn phiên ${sessionId}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạm dừng phiên.');
    } finally {
      setBusyKey('');
    }
  };

  const handleRunAllQueued = async () => {
    setBusyKey('run_all');
    setErrorMsg('');
    setNotice('');
    try {
      const res = await callCoordApi<{ startedSessionIds?: string[]; queuedSessionIds?: string[] }>(
        '/api/coordination/queue/run-parallel',
        {
          method: 'POST',
          body: JSON.stringify({ retryErrors: false }),
        }
      );
      const count = res.startedSessionIds?.length || res.queuedSessionIds?.length || 0;
      setNotice(
        count > 0
          ? `Đã mở ${count} luồng chạy SONG SONG độc lập trong Trung Tâm Điều Phối AI.`
          : 'Không có kịch bản nào đang chờ chạy.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chạy song song hàng đợi.');
    } finally {
      setBusyKey('');
    }
  };

  const handleAutoDistributeAndRun = async () => {
    setBusyKey('distribute_run');
    setErrorMsg('');
    setNotice('');
    try {
      const res = await callCoordApi<{
        startedSessionIds?: string[];
        assignments?: Array<{ sessionId: string }>;
        activeProviders?: string[];
      }>('/api/coordination/queue/distribute-run', {
        method: 'POST',
        body: JSON.stringify({ includeErrorSessions: true }),
      });
      const count = res.startedSessionIds?.length || res.assignments?.length || 0;
      setNotice(
        count > 0
          ? `Đã chia tải ${count} phiên sang các AI sẵn sàng (${(res.activeProviders || []).join(', ')}) và kích hoạt chạy song song.`
          : 'Không có phiên chờ/lỗi nào cần chia tải.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chia tải đa luồng tự động.');
    } finally {
      setBusyKey('');
    }
  };

  const handleRegenerateSceneImage = async (sessionId: string, sceneIndex: number) => {
    setBusyKey(`regen_${sessionId}_${sceneIndex}`);
    setErrorMsg('');
    setNotice('');
    try {
      await callCoordApi(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/scenes/${sceneIndex}/regenerate-image`,
        {
          method: 'POST',
          body: JSON.stringify({ autoResumeVideo: true }),
        }
      );
      setNotice(
        `Đang tạo lại Ảnh Phân cảnh #${sceneIndex} (${sessionId}) và tự động chạy tiếp bước Video → Ghép phim.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể tạo lại ảnh Phân cảnh #${sceneIndex}.`);
    } finally {
      setBusyKey('');
    }
  };

  const handleRetryTaskWithSource = async (
    sessionId: string,
    taskCode: string,
    overrideVideoSource: IndependentVideoSource
  ) => {
    setBusyKey(`retry_src_${sessionId}_${taskCode}_${overrideVideoSource}`);
    setErrorMsg('');
    setNotice('');
    try {
      await callCoordApi(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskCode)}/retry`,
        {
          method: 'POST',
          body: JSON.stringify({ overrideVideoSource, autoContinueSession: true }),
        }
      );
      setNotice(
        `Đã giữ nguyên Ảnh Bước 1, chuyển ${taskCode} sang ${SOURCE_META[overrideVideoSource].short} và kích hoạt chạy lại ngay.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể đổi nguồn & chạy lại ${taskCode}.`);
    } finally {
      setBusyKey('');
    }
  };

  const handleChangeSource = async (sessionId: string, videoSource: IndependentVideoSource) => {
    setBusyKey(`src_${sessionId}`);
    setErrorMsg('');
    try {
      await callCoordApi(`/api/coordination/sessions/${encodeURIComponent(sessionId)}/source`, {
        method: 'POST',
        body: JSON.stringify({ videoSource }),
      });
      setNotice(`Đã khóa nguồn video độc lập ${SOURCE_META[videoSource].short} cho phiên ${sessionId}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể đổi nguồn video.');
    } finally {
      setBusyKey('');
    }
  };

  const handleRunTask = async (sessionId: string, taskCode: string) => {
    setBusyKey(`task_${sessionId}_${taskCode}`);
    setErrorMsg('');
    setNotice('');
    try {
      await callCoordApi(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskCode)}/run`,
        { method: 'POST' }
      );
      setNotice(`Đã thực thi xong tác vụ ${taskCode}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể chạy tác vụ ${taskCode}.`);
    } finally {
      setBusyKey('');
    }
  };

  const sessionStats = useMemo(() => {
    if (!selectedSession) {
      return { totalTasks: 0, doneTasks: 0, runningTasks: 0, failedTasks: 0, completedScenes: 0, pct: 0 };
    }
    const totalTasks = selectedSession.tasks.length;
    const doneTasks = selectedSession.tasks.filter((t) => t.status === 'HOAN_THANH').length;
    const runningTasks = selectedSession.tasks.filter((t) => t.status === 'DANG_LAM').length;
    const failedTasks = selectedSession.tasks.filter((t) => t.status === 'LOI').length;
    const completedScenes = selectedSession.scenes.filter((sc) => {
      const vid = selectedSession.tasks.find(
        (t) => t.taskCode.includes('-VID-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
      );
      return vid?.status === 'HOAN_THANH';
    }).length;
    const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    return { totalTasks, doneTasks, runningTasks, failedTasks, completedScenes, pct };
  }, [selectedSession]);

  const queueWaitingCount = sessions.filter((s) => s.status !== 'HOAN_THANH').length;
  const readyEnginesCount = (state?.readiness || []).filter((r) => r.status === 'ready').length;
  const totalEnginesCount = (state?.readiness || []).length;

  const sessionReports = useMemo(() => {
    const all = state?.meetingMessages || [];
    if (!selectedSession) return all.slice(-50).reverse();
    return all
      .filter((m) => m.sessionId === selectedSession.sessionId || m.sessionId === 'GLOBAL')
      .slice(-60)
      .reverse();
  }, [state?.meetingMessages, selectedSession]);

  const canRunTask = (sess: CoordinationSession, task: CoordinationTaskRow): boolean => {
    if (task.status === 'DANG_LAM') return false;
    return task.dependsOnTaskCodes.every((depCode) => {
      const dep = sess.tasks.find((t) => t.taskCode === depCode);
      return dep?.status === 'HOAN_THANH';
    });
  };

  if (loading && !state) {
    return (
      <div className="glass-card rounded-2xl p-8 flex items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
        <span>Đang đồng bộ dữ liệu từ Trung Tâm Điều Phối AI...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header & Top Metrics (100% live-synced with Trung Tâm Điều Phối AI) */}
      <section className="glass-card rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/40 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>ĐỒNG BỘ TRUNG TÂM ĐIỀU PHỐI AI</span>
              <span aria-hidden="true">·</span>
              <span className={sseConnected ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-amber-600 dark:text-amber-400'}>
                {sseConnected ? 'Trực tiếp thời gian thực (SSE)' : 'Đang kết nối lại'}
              </span>
              {state?.workspace?.spreadsheetUrl && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={state.workspace.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300 hover:underline font-semibold"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Sổ Google Sheets</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
              Theo dõi Phiên Sản Xuất
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {queueWaitingCount > 0 && (
              <>
                <button
                  type="button"
                  disabled={busyKey === 'distribute_run'}
                  onClick={() => void handleAutoDistributeAndRun()}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:brightness-110 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {busyKey === 'distribute_run' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Layers className="w-3.5 h-3.5" />
                  )}
                  <span>Chia tải AI &amp; Chạy song song</span>
                </button>
                <button
                  type="button"
                  disabled={busyKey === 'run_all'}
                  onClick={() => void handleRunAllQueued()}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:brightness-110 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  {busyKey === 'run_all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>Chạy song song ({queueWaitingCount})</span>
                </button>
              </>
            )}

            {onOpenCommandCenter && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenCommandCenter('overview')}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Cpu className="w-3.5 h-3.5 text-cyan-500" />
                  <span>Trung Tâm Điều Phối</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCommandCenter('chat')}
                  className="px-3 py-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-xs font-semibold text-cyan-700 dark:text-cyan-300 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Phòng họp AI</span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={busyKey === 'refresh_mon'}
              onClick={async () => {
                setBusyKey('refresh_mon');
                await refreshState(true);
                setBusyKey('');
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyKey === 'refresh_mon' ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {/* 4 Live KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Tiến độ phiên đang chọn</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {sessionStats.pct}%
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
                style={{ width: `${sessionStats.pct}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Phân cảnh hoàn thành</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {sessionStats.completedScenes}/{selectedSession?.scenes.length ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {sessionStats.doneTasks}/{sessionStats.totalTasks} tác vụ (Ảnh + Video + Ghép)
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Hàng đợi kịch bản</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              {sessions.length} phiên
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {queueWaitingCount} đang chờ/chạy · {sessions.filter((s) => s.status === 'HOAN_THANH').length} hoàn thành
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">AI sẵn sàng &amp; Lỗi phiên</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {readyEnginesCount}/{totalEnginesCount}{' '}
              <span className={sessionStats.failedTasks > 0 ? 'text-rose-500 text-lg' : 'text-emerald-500 text-lg'}>
                ({sessionStats.failedTasks} lỗi)
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {selectedSession ? `Nguồn khóa: ${SOURCE_META[selectedSession.videoSource].short}` : 'Chưa chọn phiên'}
            </div>
          </div>
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </span>
          <button type="button" onClick={() => setErrorMsg('')} className="p-0.5 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/35 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </span>
          <button type="button" onClick={() => setNotice('')} className="p-0.5 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Split: Left All Queued Sessions + Right Live Scene Progress */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <aside className="xl:col-span-4 glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700/40 pb-2.5">
            <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900 dark:text-white">
              <History className="w-4 h-4 text-cyan-500" />
              <span>Tất cả phiên từ Trung Tâm Điều Phối</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {sessions.length}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <Film className="w-6 h-6 mx-auto opacity-60" />
              <div className="font-semibold text-slate-700 dark:text-slate-200">
                Chưa có phiên sản xuất nào.
              </div>
              <div>
                Hãy chọn phân cảnh hoặc kịch bản ở <strong>Studio AI</strong> rồi bấm{' '}
                <strong>Đẩy sang Trung Tâm Điều Phối AI</strong> — tiến độ sẽ tự động hiện tại đây theo thời gian thực.
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[680px] overflow-y-auto pr-1">
              {sessions.map((s, idx) => {
                const isSelected = selectedSession?.sessionId === s.sessionId;
                const done = s.tasks.filter((t) => t.status === 'HOAN_THANH').length;
                const err = s.tasks.filter((t) => t.status === 'LOI').length;
                const pct = s.tasks.length > 0 ? Math.round((done / s.tasks.length) * 100) : 0;
                const meta = sessionStatusMeta(s.status);
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    onClick={() => void handleSelectSession(s.sessionId)}
                    className={`w-full text-left rounded-xl p-3 border transition cursor-pointer space-y-2 ${
                      isSelected
                        ? 'border-cyan-500/70 bg-cyan-50/70 dark:bg-cyan-950/25'
                        : 'border-slate-200 dark:border-slate-700/45 bg-white/75 dark:bg-[#0c1021]/75 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          #{idx + 1} · {s.title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {s.sessionId} · {fmtDateTime(s.createdAt)}
                        </div>
                      </div>
                      <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border shrink-0 ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            err > 0 ? 'bg-rose-500' : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 shrink-0">
                        {pct}%
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>{s.scenes.length} cảnh · {done}/{s.tasks.length} bước</span>
                      <span>{SOURCE_META[s.videoSource].short}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Right Live Scene Inspector */}
        <div className="xl:col-span-8 space-y-5">
          {!selectedSession ? (
            <section className="glass-card rounded-2xl p-10 text-center space-y-3">
              <Activity className="w-8 h-8 text-cyan-500 mx-auto opacity-80" />
              <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Chưa có phiên sản xuất nào được chọn
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Khi bạn đẩy kịch bản hoặc các phân cảnh từ Studio AI sang Trung Tâm Điều Phối AI, toàn bộ thông tin phiên và tiến độ từng phân cảnh sẽ hiển thị trực tiếp tại đây.
              </p>
            </section>
          ) : (
            <>
              <section className="glass-card rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/40 pb-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-500 dark:text-slate-400">
                        {selectedSession.sessionId}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                          sessionStatusMeta(selectedSession.status).badge
                        }`}
                      >
                        {selectedSession.status === 'DANG_CHAY' && (
                          <Loader2 className="w-2.5 h-2.5 inline mr-1 animate-spin" />
                        )}
                        {sessionStatusMeta(selectedSession.status).label}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {selectedSession.aspectRatio} · {selectedSession.scenes.length} phân cảnh
                      </span>
                    </div>
                    <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white">
                      {selectedSession.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        Tạo: {fmtDateTime(selectedSession.createdAt)}
                      </span>
                      <span>Cập nhật: {fmtTime(selectedSession.updatedAt)}</span>
                      {selectedSession.driveFolderUrl && (
                        <a
                          href={selectedSession.driveFolderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300 hover:underline font-sans font-semibold"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>Thư mục Drive</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {selectedSession.status !== 'DANG_CHAY' ? (
                      <button
                        type="button"
                        disabled={busyKey === `run_${selectedSession.sessionId}`}
                        onClick={() => void handleRunSession(selectedSession.sessionId, false)}
                        className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:brightness-110 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {busyKey === `run_${selectedSession.sessionId}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        <span>Chạy phiên này</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyKey === `pause_${selectedSession.sessionId}`}
                        onClick={() => void handlePauseSession(selectedSession.sessionId)}
                        className="px-3.5 py-2 rounded-xl bg-amber-600 hover:brightness-110 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Tạm dừng</span>
                      </button>
                    )}

                    {sessionStats.failedTasks > 0 && selectedSession.status !== 'DANG_CHAY' && (
                      <button
                        type="button"
                        disabled={busyKey === `retry_${selectedSession.sessionId}`}
                        onClick={() => void handleRunSession(selectedSession.sessionId, true)}
                        className="px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-700 dark:text-rose-200 hover:bg-rose-500/25 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Chạy lại {sessionStats.failedTasks} lỗi</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Locked Independent Video Source Bar */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/75 dark:bg-[#0c1021]/65 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Lock className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      Nguồn sáng tạo video khóa độc lập:
                    </span>
                    <span className="font-bold text-cyan-600 dark:text-cyan-300">
                      {SOURCE_META[selectedSession.videoSource].label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['gemini', 'qwen', 'muse', 'google_flow'] as IndependentVideoSource[]).map((srcId) => {
                      const active = selectedSession.videoSource === srcId;
                      return (
                        <button
                          key={srcId}
                          type="button"
                          disabled={selectedSession.status === 'DANG_CHAY' || busyKey === `src_${selectedSession.sessionId}`}
                          onClick={() => void handleChangeSource(selectedSession.sessionId, srcId)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'bg-cyan-600 text-white border-cyan-600'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-cyan-500'
                          }`}
                        >
                          {SOURCE_META[srcId].short}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedSession.lastError && (
                  <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                    <strong>Lỗi gần nhất:</strong> {selectedSession.lastError}
                  </div>
                )}

                {/* Detail Tabs */}
                <div className="flex items-center gap-2 border-b border-slate-200/80 dark:border-slate-700/40 pb-2">
                  <button
                    type="button"
                    onClick={() => setDetailTab('scenes')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                      detailTab === 'scenes'
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    Tiến độ từng phân cảnh ({selectedSession.scenes.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab('reports')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                      detailTab === 'reports'
                        ? 'bg-cyan-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    Nhật ký &amp; Báo cáo AI ({sessionReports.length})
                  </button>
                </div>

                {detailTab === 'scenes' ? (
                  <div className="space-y-3">
                    {selectedSession.scenes.map((sc) => {
                      const imgTask = selectedSession.tasks.find(
                        (t) => t.taskCode.includes('-IMG-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
                      );
                      const vidTask = selectedSession.tasks.find(
                        (t) => t.taskCode.includes('-VID-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
                      );
                      const imgMeta = imgTask ? taskStatusMeta(imgTask.status) : null;
                      const vidMeta = vidTask ? taskStatusMeta(vidTask.status) : null;

                      return (
                        <div
                          key={`${selectedSession.sessionId}_${sc.sceneId}_${sc.sceneIndex}`}
                          className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/70 dark:bg-[#0c1124]/80 p-3.5 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-violet-600/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                                Phân cảnh #{sc.sceneIndex}
                              </span>
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {sc.title}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                ({sc.durationSec}s)
                              </span>
                            </div>
                            {selectedSession.status !== 'DANG_CHAY' && imgTask && (
                              <button
                                type="button"
                                disabled={busyKey === `regen_${selectedSession.sessionId}_${sc.sceneIndex}`}
                                onClick={() => void handleRegenerateSceneImage(selectedSession.sessionId, sc.sceneIndex)}
                                title="Tạo lại Ảnh Phân cảnh Bước 1 và tự động chạy tiếp bước Video → Ghép phim"
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer disabled:opacity-50 ${
                                  vidTask?.status === 'LOI' || imgTask.status === 'LOI'
                                    ? 'bg-amber-600 text-white border-amber-500 hover:brightness-110'
                                    : 'bg-white dark:bg-[#131a35] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:border-amber-500'
                                }`}
                              >
                                {busyKey === `regen_${selectedSession.sessionId}_${sc.sceneIndex}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3 h-3" />
                                )}
                                <span>Tạo lại ảnh &amp; Chạy tiếp</span>
                              </button>
                            )}
                          </div>

                          {(sc.actionDetail || sc.dialogue) && (
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                              {sc.actionDetail}
                              {sc.dialogue ? ` · Thoại: "${sc.dialogue}"` : ''}
                            </p>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            {/* Step 1: Scene Image */}
                            {imgTask && imgMeta && (
                              <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-600/35 bg-white/85 dark:bg-[#101730]/85 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-100">
                                    <ImageIcon className="w-3.5 h-3.5 text-violet-500" />
                                    <span>Ảnh phân cảnh · {imgTask.taskCode}</span>
                                  </span>
                                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${imgMeta.cls}`}>
                                    {imgTask.status === 'DANG_LAM' && (
                                      <Loader2 className="w-2.5 h-2.5 inline mr-1 animate-spin" />
                                    )}
                                    {imgMeta.label}
                                  </span>
                                </div>

                                {imgTask.localOutputUrl && /\.(png|jpe?g|webp)$/i.test(imgTask.localOutputUrl) && (
                                  <a
                                    href={imgTask.localOutputUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black/20"
                                  >
                                    <img
                                      src={imgTask.localOutputUrl}
                                      alt={imgTask.taskCode}
                                      className="w-full h-36 object-cover"
                                    />
                                  </a>
                                )}

                                {imgTask.resultSummary && (
                                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                    {imgTask.resultSummary}
                                  </p>
                                )}
                                {imgTask.errorReason && (
                                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-700 dark:text-rose-200">
                                    {imgTask.errorReason}
                                  </div>
                                )}

                                <div className="flex items-center justify-between gap-2 pt-1">
                                  <span className="text-[10px] text-slate-400 truncate">
                                    {imgTask.assignedAiLabel}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={
                                      selectedSession.status === 'DANG_CHAY' ||
                                      !canRunTask(selectedSession, imgTask) ||
                                      busyKey === `task_${selectedSession.sessionId}_${imgTask.taskCode}`
                                    }
                                    onClick={() => void handleRunTask(selectedSession.sessionId, imgTask.taskCode)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-900 dark:bg-white/10 text-white hover:bg-cyan-600 cursor-pointer disabled:opacity-40"
                                  >
                                    <Play className="w-2.5 h-2.5" />
                                    <span>{imgTask.status === 'HOAN_THANH' ? 'Tạo lại' : 'Chạy ảnh'}</span>
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Step 2: Scene Video */}
                            {vidTask && vidMeta && (
                              <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-600/35 bg-white/85 dark:bg-[#101730]/85 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-100">
                                    <Film className="w-3.5 h-3.5 text-cyan-500" />
                                    <span>Video phân cảnh · {vidTask.taskCode}</span>
                                  </span>
                                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${vidMeta.cls}`}>
                                    {vidTask.status === 'DANG_LAM' && (
                                      <Loader2 className="w-2.5 h-2.5 inline mr-1 animate-spin" />
                                    )}
                                    {vidMeta.label}
                                  </span>
                                </div>

                                {vidTask.localOutputUrl && /\.(mp4|webm|mov)$/i.test(vidTask.localOutputUrl) && (
                                  <video
                                    src={vidTask.localOutputUrl}
                                    controls
                                    className="w-full h-36 rounded-lg bg-black object-contain"
                                  />
                                )}

                                {vidTask.resultSummary && (
                                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                    {vidTask.resultSummary}
                                  </p>
                                )}
                                {vidTask.errorReason && (
                                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-700 dark:text-rose-200 space-y-2">
                                    <div>{vidTask.errorReason}</div>
                                    {selectedSession.status !== 'DANG_CHAY' && (
                                      <div className="pt-1.5 border-t border-rose-500/20 flex flex-wrap items-center gap-1.5">
                                        <span className="text-[10px] font-semibold">Đổi nguồn chạy lại (giữ ảnh B1):</span>
                                        {(['gemini', 'qwen', 'google_flow', 'muse'] as IndependentVideoSource[]).map((srcId) => (
                                          <button
                                            key={srcId}
                                            type="button"
                                            disabled={Boolean(busyKey)}
                                            onClick={() =>
                                              void handleRetryTaskWithSource(selectedSession.sessionId, vidTask.taskCode, srcId)
                                            }
                                            className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-[#131a35] border border-rose-400/45 text-slate-800 dark:text-slate-100 hover:border-cyan-500 cursor-pointer disabled:opacity-50"
                                          >
                                            {SOURCE_META[srcId].short}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                <div className="flex items-center justify-between gap-2 pt-1">
                                  <span className="text-[10px] text-slate-400 truncate">
                                    {vidTask.assignedAiLabel}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={
                                      selectedSession.status === 'DANG_CHAY' ||
                                      !canRunTask(selectedSession, vidTask) ||
                                      busyKey === `task_${selectedSession.sessionId}_${vidTask.taskCode}`
                                    }
                                    onClick={() => void handleRunTask(selectedSession.sessionId, vidTask.taskCode)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-900 dark:bg-white/10 text-white hover:bg-cyan-600 cursor-pointer disabled:opacity-40"
                                  >
                                    <Play className="w-2.5 h-2.5" />
                                    <span>{vidTask.status === 'HOAN_THANH' ? 'Tạo lại' : 'Chạy video'}</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Step 3: Final Film */}
                    {(() => {
                      const finalTask = selectedSession.tasks.find((t) => t.taskCode.endsWith('-FINAL'));
                      if (!finalTask) return null;
                      const fm = taskStatusMeta(finalTask.status);
                      return (
                        <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/5 p-3.5 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Film className="w-4 h-4 text-emerald-500" />
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                Bước 3 · {finalTask.title} ({finalTask.taskCode})
                              </span>
                              <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${fm.cls}`}>
                                {fm.label}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {selectedSession.finalVideoLocalUrl && (
                                <a
                                  href={selectedSession.finalVideoLocalUrl}
                                  download={`${selectedSession.sessionId}.mp4`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white hover:brightness-110"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Tải MP4</span>
                                </a>
                              )}
                              <button
                                type="button"
                                disabled={
                                  selectedSession.status === 'DANG_CHAY' ||
                                  !canRunTask(selectedSession, finalTask) ||
                                  busyKey === `task_${selectedSession.sessionId}_${finalTask.taskCode}`
                                }
                                onClick={() => void handleRunTask(selectedSession.sessionId, finalTask.taskCode)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-900 dark:bg-white/10 text-white hover:bg-emerald-600 cursor-pointer disabled:opacity-40"
                              >
                                <Play className="w-3 h-3" />
                                <span>Ghép phim</span>
                              </button>
                            </div>
                          </div>
                          {finalTask.errorReason && (
                            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-200">
                              {finalTask.errorReason}
                            </div>
                          )}
                          {selectedSession.finalVideoLocalUrl && (
                            <video
                              src={selectedSession.finalVideoLocalUrl}
                              controls
                              className="w-full max-h-[380px] rounded-xl bg-black"
                            />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {sessionReports.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                        Chưa có báo cáo tiến độ nào cho phiên này.
                      </div>
                    ) : (
                      sessionReports.map((msg) => (
                        <div
                          key={msg.id}
                          className={`p-3 rounded-xl border text-xs space-y-1 ${
                            msg.kind === 'error'
                              ? 'border-rose-500/35 bg-rose-500/5'
                              : msg.kind === 'completed'
                              ? 'border-emerald-500/30 bg-emerald-500/5'
                              : 'border-slate-200 dark:border-slate-700/45 bg-white/80 dark:bg-[#0c1124]/80'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <strong className="text-slate-900 dark:text-white">{msg.senderName}</strong>
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                                {msg.senderRole}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">{fmtTime(msg.createdAt)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200 leading-relaxed">
                            {msg.content}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
