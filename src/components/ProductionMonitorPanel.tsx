import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Film,
  History,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import type { CommandCenterState, ProductionRun, SceneProductionStage } from '../types/commandCenter';
import { AgentAvatar } from './command-center/AgentAvatar';
import { WorkspaceSyncSection } from './WorkspaceSyncSection';
import { commandCenterApiJson } from '../hooks/useCommandCenterLive';

interface ProductionMonitorPanelProps {
  state: CommandCenterState | null;
  setState: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  loading: boolean;
  sseConnected: boolean;
  onRefresh: (forceHealth?: boolean) => Promise<CommandCenterState | null>;
  onOpenCommandCenter?: (
    subTab?: 'overview' | 'chairman' | 'chat' | 'tasks' | 'pipeline' | 'qa' | 'incidents' | 'perf'
  ) => void;
}

const RUN_STATUS_META: Record<
  ProductionRun['status'],
  { label: string; textClass: string; borderClass: string }
> = {
  idle: {
    label: 'Sẵn sàng',
    textClass: 'text-slate-600 dark:text-slate-300',
    borderClass: 'border-slate-300 dark:border-slate-700',
  },
  planning: {
    label: 'Đang lập kế hoạch',
    textClass: 'text-violet-600 dark:text-violet-300',
    borderClass: 'border-violet-400/50',
  },
  producing: {
    label: 'Đang sản xuất',
    textClass: 'text-cyan-600 dark:text-cyan-300',
    borderClass: 'border-cyan-400/50',
  },
  inspecting: {
    label: 'Đang kiểm duyệt QA',
    textClass: 'text-indigo-600 dark:text-indigo-300',
    borderClass: 'border-indigo-400/50',
  },
  assembling: {
    label: 'Đang ghép xuất phim',
    textClass: 'text-emerald-600 dark:text-emerald-300',
    borderClass: 'border-emerald-400/50',
  },
  completed: {
    label: 'Hoàn thành',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    borderClass: 'border-emerald-400/50',
  },
  paused: {
    label: 'Đã tạm dừng',
    textClass: 'text-amber-600 dark:text-amber-300',
    borderClass: 'border-amber-400/50',
  },
  cancelled: {
    label: 'Đã hủy phiên',
    textClass: 'text-rose-600 dark:text-rose-400',
    borderClass: 'border-rose-400/50',
  },
  failed: {
    label: 'Thất bại',
    textClass: 'text-rose-600 dark:text-rose-400',
    borderClass: 'border-rose-400/50',
  },
  needs_attention: {
    label: 'Cần kiểm tra',
    textClass: 'text-orange-600 dark:text-orange-300',
    borderClass: 'border-orange-400/50',
  },
};

function isActiveRunningStatus(status?: ProductionRun['status']): boolean {
  return status === 'planning' || status === 'producing' || status === 'inspecting' || status === 'assembling';
}

const SCENE_STAGE_LABELS: Record<SceneProductionStage, string> = {
  waiting_data: 'Chờ dữ liệu',
  creating_image: 'Đang tạo ảnh',
  image_ready: 'Ảnh sẵn sàng',
  waiting_video: 'Chờ dựng video',
  creating_video: 'Đang dựng video',
  inspecting_qa: 'Đang kiểm duyệt QA',
  completed: 'Hoàn thành',
  failed: 'Lỗi',
  needs_regen: 'Cần tạo lại',
};

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtDateTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const ProductionMonitorPanel: React.FC<ProductionMonitorPanelProps> = ({
  state,
  setState,
  loading,
  sseConnected,
  onRefresh,
  onOpenCommandCenter,
}) => {
  const [busyKey, setBusyKey] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [confirmCancelRun, setConfirmCancelRun] = useState<ProductionRun | null>(null);
  const [detailTab, setDetailTab] = useState<'scenes' | 'tasks' | 'logs' | 'workspace'>('scenes');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const selectedRun: ProductionRun | null = useMemo(() => {
    if (!state) return null;
    if (state.selectedRunId) {
      const hit = state.runs.find((r) => r.id === state.selectedRunId);
      if (hit) return hit;
    }
    return state.activeRun || state.runs[0] || null;
  }, [state]);

  const isRunning = isActiveRunningStatus(selectedRun?.status);

  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const runAction = async (key: string, fn: () => Promise<CommandCenterState>, okMsg?: string) => {
    setBusyKey(key);
    setErrorMsg('');
    setNotice('');
    try {
      const next = await fn();
      setState(next);
      if (okMsg) setNotice(okMsg);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Thao tác phiên sản xuất thất bại.');
    } finally {
      setBusyKey('');
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newSessionTitle.trim();
    await runAction(
      'create_session',
      () =>
        commandCenterApiJson<CommandCenterState>('/api/command-center/productions/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        }),
      'Đã tạo phiên sản xuất mới và đặt làm phiên hiện hành.'
    );
    setNewSessionTitle('');
    setIsNewSessionOpen(false);
  };

  const handleSelectSession = async (runId: string) => {
    await runAction(
      `select_${runId}`,
      () =>
        commandCenterApiJson<CommandCenterState>(
          `/api/command-center/productions/${encodeURIComponent(runId)}/select`,
          { method: 'POST' }
        )
    );
  };

  const handleControlSession = async (runId: string, action: 'pause' | 'resume' | 'cancel') => {
    const okMsg =
      action === 'pause'
        ? 'Đã tạm dừng phiên ở điểm an toàn — trạng thái và các cảnh hoàn thành được giữ nguyên.'
        : action === 'resume'
        ? 'Đã kích hoạt tiếp tục các tác vụ chưa hoàn thành của phiên.'
        : 'Đã hủy các tác vụ đang chờ/đang chạy của phiên và bảo toàn kết quả đã hoàn thành.';
    await runAction(
      `${action}_${runId}`,
      () =>
        commandCenterApiJson<CommandCenterState>(
          `/api/command-center/productions/${encodeURIComponent(runId)}/${action}`,
          { method: 'POST' }
        ),
      okMsg
    );
    if (action === 'cancel') {
      setConfirmCancelRun(null);
    }
  };

  const sessionTasks = useMemo(() => {
    if (!state || !selectedRun) return [];
    return state.tasks.filter((t) => t.runId === selectedRun.id);
  }, [state, selectedRun]);

  const sessionLogs = useMemo(() => {
    if (!state || !selectedRun) return [];
    return state.logs.filter((l) => !l.runId || l.runId === selectedRun.id).slice(0, 80);
  }, [state, selectedRun]);

  const sessionOpenIncidents = useMemo(() => {
    if (!state || !selectedRun) return [];
    const list = Array.isArray(state.incidents) ? state.incidents : [];
    return list.filter((inc) => inc.runId === selectedRun.id && inc.status !== 'resolved');
  }, [state, selectedRun]);

  if (loading && !state) {
    return (
      <div className="glass-card rounded-2xl p-8 flex items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
        <span>Đang tải Trạm Theo Dõi Phiên Sản Xuất...</span>
      </div>
    );
  }

  const runs = state?.runs || [];
  const agents = state?.agents || [];
  const memory = state?.projectMemory;

  const perMuse = selectedRun?.perMuseProgress || [];
  const workingMuseCount = perMuse.filter((p) => p.runningTasks > 0).length;

  const elapsedMs = selectedRun
    ? (selectedRun.completedAt || selectedRun.cancelledAt || selectedRun.pausedAt || (isRunning ? nowMs : selectedRun.updatedAt)) -
      (selectedRun.startedAt || selectedRun.createdAt)
    : 0;

  return (
    <div className="space-y-5">
      {/* Header & Top Metrics */}
      <section className="glass-card rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/40 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>PRODUCTION MONITOR</span>
              <span aria-hidden="true">·</span>
              <span className={sseConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                {sseConnected ? 'Đẩy dữ liệu thời gian thực (SSE)' : 'Đang đồng bộ định kỳ'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
              Theo dõi Phiên Sản Xuất
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsNewSessionOpen(true)}
              className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tạo phiên mới</span>
            </button>

            {onOpenCommandCenter && (
              <button
                type="button"
                onClick={() => onOpenCommandCenter('overview')}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Giao kịch bản tại Phòng Điều Hành</span>
              </button>
            )}

            <button
              type="button"
              disabled={busyKey === 'refresh_mon'}
              onClick={async () => {
                setBusyKey('refresh_mon');
                await onRefresh(true);
                setBusyKey('');
              }}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyKey === 'refresh_mon' ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Tiến độ chung</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {selectedRun?.overallProgressPct ?? 0}%
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-300"
                style={{ width: `${selectedRun?.overallProgressPct ?? 0}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Muse đang chạy (phiên này)</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
              {workingMuseCount}/5
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              Toàn hệ thống: {state?.metrics.workingAgents ?? 0} đang xử lý
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Cảnh hoàn thành</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {selectedRun?.completedScenes ?? 0}/{selectedRun?.sceneCount ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {selectedRun?.passedQaScenes ?? 0} cảnh đạt kiểm duyệt QA
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Trạng thái cảnh (Chạy / Chờ / Lỗi)</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {selectedRun?.runningScenes ?? 0} / {selectedRun?.pendingScenes ?? 0} /{' '}
              <span className={(selectedRun?.failedScenes ?? 0) > 0 ? 'text-rose-500' : ''}>
                {selectedRun?.failedScenes ?? 0}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {selectedRun?.escalatedScenes ?? 0} cảnh cần xem xét thủ công
            </div>
          </div>
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-2">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/35 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} className="underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {sessionOpenIncidents.length > 0 && onOpenCommandCenter && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              Phiên này đang có <strong>{sessionOpenIncidents.length} sự cố</strong> cần Tổng đạo diễn và đội Muse phối hợp xử lý.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenCommandCenter('chairman')}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer whitespace-nowrap"
            >
              Gọi Chủ tịch chỉ đạo
            </button>
            <button
              type="button"
              onClick={() => onOpenCommandCenter('incidents')}
              className="px-3 py-1.5 rounded-lg border border-amber-400/60 text-amber-900 dark:text-amber-100 hover:bg-amber-100/70 dark:hover:bg-amber-900/40 font-medium cursor-pointer whitespace-nowrap"
            >
              Xem Trung tâm Sự cố
            </button>
          </div>
        </div>
      )}

      {/* Main Layout: Left Sessions List + Right Active/Selected Session Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Sessions History Column */}
        <aside className="xl:col-span-4 glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700/40 pb-2.5">
            <div className="flex items-center gap-2 text-sm font-display font-semibold text-slate-900 dark:text-white">
              <History className="w-4 h-4 text-violet-500" />
              <span>Danh sách phiên sản xuất</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {runs.length} phiên
            </span>
          </div>

          {runs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <Film className="w-6 h-6 mx-auto opacity-60" />
              <div>Chưa có phiên sản xuất nào. Nhấn "Tạo phiên mới" hoặc gửi kịch bản từ Phòng Điều Hành.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {runs.map((r) => {
                const isSelected = selectedRun?.id === r.id;
                const meta = RUN_STATUS_META[r.status] || RUN_STATUS_META.idle;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectSession(r.id)}
                    className={`w-full text-left rounded-xl p-3 border transition cursor-pointer space-y-2 ${
                      isSelected
                        ? 'border-violet-500/70 bg-violet-50/70 dark:bg-violet-950/25'
                        : 'border-slate-200 dark:border-slate-700/45 bg-white/75 dark:bg-[#0c1021]/75 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {r.title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {r.id} · {fmtDateTime(r.startedAt || r.createdAt)}
                        </div>
                      </div>
                      <span className={`text-[11px] font-semibold shrink-0 ${meta.textClass}`}>
                        {meta.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all"
                          style={{ width: `${r.overallProgressPct ?? 0}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 shrink-0">
                        {r.overallProgressPct ?? 0}%
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>{r.completedScenes}/{r.sceneCount} cảnh</span>
                      <span>{r.passedQaScenes} đạt QA</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Selected Session Live View */}
        <div className="xl:col-span-8 space-y-5">
          {!selectedRun ? (
            <div className="space-y-5">
              <section className="glass-card rounded-2xl p-8 text-center space-y-3">
                <Film className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Chọn hoặc tạo một phiên sản xuất để theo dõi trực tiếp
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Mọi phiên sản xuất đều lưu độc lập kịch bản, nhân vật, ảnh phân cảnh, video và nhật ký để có thể mở lại bất cứ lúc nào.
                </p>
              </section>
              <section className="glass-card rounded-2xl p-5">
                <WorkspaceSyncSection
                  selectedRun={null}
                  onAfterCommandDispatch={() => onRefresh(true)}
                />
              </section>
            </div>
          ) : (
            <>
              {/* Session Header + Timing + Pause/Resume/Cancel */}
              <section className="glass-card rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/40 pb-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-slate-500 dark:text-slate-400">{selectedRun.id}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`font-semibold ${(RUN_STATUS_META[selectedRun.status] || RUN_STATUS_META.idle).textClass}`}>
                        {(RUN_STATUS_META[selectedRun.status] || RUN_STATUS_META.idle).label}
                      </span>
                    </div>
                    <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white truncate">
                      {selectedRun.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        Bắt đầu: {fmtDateTime(selectedRun.startedAt || selectedRun.createdAt)}
                      </span>
                      <span>Thời gian chạy: {formatDurationMs(elapsedMs)}</span>
                      {isRunning && typeof selectedRun.estimatedRemainingSec === 'number' && selectedRun.estimatedRemainingSec > 0 && (
                        <span className="text-cyan-600 dark:text-cyan-400">
                          Dự kiến còn: ~{formatDurationMs(selectedRun.estimatedRemainingSec * 1000)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Session Control Buttons */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isRunning && (
                      <button
                        type="button"
                        disabled={busyKey === `pause_${selectedRun.id}`}
                        onClick={() => handleControlSession(selectedRun.id, 'pause')}
                        className="px-3.5 py-2 rounded-lg border border-amber-400/60 bg-amber-50/70 dark:bg-amber-950/25 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-xs font-semibold text-amber-800 dark:text-amber-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Tạm dừng phiên</span>
                      </button>
                    )}

                    {(selectedRun.status === 'paused' || selectedRun.status === 'needs_attention' || selectedRun.status === 'failed') && (
                      <button
                        type="button"
                        disabled={busyKey === `resume_${selectedRun.id}`}
                        onClick={() => handleControlSession(selectedRun.id, 'resume')}
                        className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Tiếp tục</span>
                      </button>
                    )}

                    {selectedRun.status !== 'completed' && selectedRun.status !== 'cancelled' && (
                      <button
                        type="button"
                        disabled={busyKey === `cancel_${selectedRun.id}`}
                        onClick={() => setConfirmCancelRun(selectedRun)}
                        className="px-3.5 py-2 rounded-lg border border-rose-400/60 bg-rose-50/70 dark:bg-rose-950/25 hover:bg-rose-100 dark:hover:bg-rose-950/45 text-xs font-semibold text-rose-700 dark:text-rose-300 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Square className="w-3 h-3" />
                        <span>Hủy phiên</span>
                      </button>
                    )}
                  </div>
                </div>

                {selectedRun.error && (
                  <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                    {selectedRun.error}
                  </div>
                )}

                {/* Per-Muse 5 AI Live Progress Matrix */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <span>Tiến độ từng Muse AI trong phiên</span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {sessionTasks.length} tác vụ tổng cộng
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {agents.map((ag) => {
                      const mp = perMuse.find((p) => p.agentId === ag.id) || {
                        agentId: ag.id,
                        progressPct: 0,
                        completedTasks: 0,
                        totalTasks: 0,
                        runningTasks: 0,
                        failedTasks: 0,
                      };
                      const barColor = ag.accentColor || '#7C3AED';
                      return (
                        <div
                          key={ag.id}
                          className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-white/80 dark:bg-[#0c1021]/80 p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <AgentAvatar agent={ag} size="sm" showStatusDot />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                    {ag.name}
                                  </span>
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                    {ag.roleTitle}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                  {mp.runningTasks > 1
                                    ? `Đang chạy ${mp.runningTasks} tác vụ song song · ${mp.currentTaskTitle || ''}`
                                    : mp.currentTaskTitle
                                    ? `Đang làm: ${mp.currentTaskTitle}`
                                    : mp.totalTasks === 0
                                    ? 'Chưa có tác vụ trong phiên này'
                                    : mp.completedTasks === mp.totalTasks
                                    ? 'Đã hoàn thành phần việc trong phiên'
                                    : 'Đang chờ điều phối phụ thuộc'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                {mp.runningTasks > 0 ? `${mp.runningTasks} đang chạy · ` : ''}
                                {mp.completedTasks}/{mp.totalTasks} tác vụ
                                {mp.failedTasks > 0 ? ` · ${mp.failedTasks} lỗi` : ''}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white w-10 text-right">
                                {mp.progressPct}%
                              </span>
                            </div>
                          </div>

                          <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${mp.progressPct}%`, backgroundColor: barColor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Final Delivered Video Preview */}
                {selectedRun.finalVideoUrl && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-700/45 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Video hoàn chỉnh đã bàn giao ({selectedRun.finalDurationSec || 0}s)
                      </span>
                      <a
                        href={selectedRun.finalVideoUrl}
                        download={selectedRun.finalVideoArtifactName || 'muse_final_film.mp4'}
                        className="inline-flex items-center gap-1 underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải MP4</span>
                      </a>
                    </div>
                    <video
                      src={selectedRun.finalVideoUrl}
                      controls
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-black max-h-72"
                    />
                  </div>
                )}
              </section>

              {/* Session Scenes / Tasks / Logs Inspector */}
              <section className="glass-card rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700/40 pb-3">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200/80 dark:border-slate-700/40">
                    {(
                      [
                        { id: 'scenes', label: `Phân cảnh (${memory?.scenes.length || 0})` },
                        { id: 'tasks', label: `Tác vụ phiên (${sessionTasks.length})` },
                        { id: 'workspace', label: 'Google Sheets & Drive' },
                        { id: 'logs', label: `Nhật ký (${sessionLogs.length})` },
                      ] as const
                    ).map((tb) => (
                      <button
                        key={tb.id}
                        type="button"
                        onClick={() => setDetailTab(tb.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                          detailTab === tb.id
                            ? 'bg-white dark:bg-[#1a2244] text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {tb.label}
                      </button>
                    ))}
                  </div>

                  {onOpenCommandCenter && (
                    <button
                      type="button"
                      onClick={() => onOpenCommandCenter('qa')}
                      className="text-xs font-medium text-violet-600 dark:text-violet-300 hover:underline cursor-pointer"
                    >
                      Mở bảng kiểm duyệt QA chi tiết →
                    </button>
                  )}
                </div>

                {detailTab === 'scenes' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {!memory?.scenes.length ? (
                      <div className="md:col-span-2 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                        Chưa có phân cảnh nào được lưu trong phiên này.
                      </div>
                    ) : (
                      memory.scenes.map((sc) => {
                        const producerLabel = sc.assignedProducerAgentId
                          ? sc.assignedProducerAgentId.replace('muse-', 'Muse ')
                          : 'Pool Muse 02–04';
                        const stageLabel = sc.productionStage
                          ? SCENE_STAGE_LABELS[sc.productionStage] || sc.productionStage
                          : null;
                        return (
                        <div
                          key={sc.sceneId}
                          className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-[#0c1021]/85 p-3.5 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                Cảnh {sc.index}: {sc.title}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                {sc.sceneId} · {sc.durationSec}s · {producerLabel}
                                {stageLabel ? ` · ${stageLabel}` : ''} · QA: {sc.qaStatus}
                                {typeof sc.qaScore === 'number' ? ` (${sc.qaScore}/100)` : ''}
                              </div>
                            </div>
                          </div>

                          {sc.videoUrl ? (
                            <video
                              src={sc.videoUrl}
                              controls
                              className="w-full h-36 rounded-lg border border-slate-200 dark:border-slate-700 bg-black"
                            />
                          ) : sc.keyframeImageUrl ? (
                            <img
                              src={sc.keyframeImageUrl}
                              alt={sc.title}
                              className="w-full h-36 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                            />
                          ) : (
                            <div className="h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-[11px] text-slate-400">
                              Chờ tạo hình ảnh / video
                            </div>
                          )}

                          <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                            {sc.dialogue || sc.narration || sc.actionDetail}
                          </p>
                        </div>
                        );
                      })
                    )}
                  </div>
                )}

                {detailTab === 'tasks' && (
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-700/40 max-h-96 overflow-y-auto text-xs">
                    {sessionTasks.length === 0 ? (
                      <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                        Chưa có tác vụ trong phiên này.
                      </div>
                    ) : (
                      sessionTasks.map((t) => {
                        const isChairmanTask = t.assignedAgentId === 'chairman';
                        const ag = agents.find((a) => a.id === t.assignedAgentId);
                        const ownerLabel = isChairmanTask
                          ? state?.chairmanConfig?.name || 'Gemini AI – Chủ tịch'
                          : ag?.name || t.assignedAgentId;
                        return (
                          <div key={t.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <AgentAvatar agent={ag} fallbackId={t.assignedAgentId} size="xs" />
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900 dark:text-white truncate">
                                  <span className="font-mono text-slate-500 mr-1.5">{t.code}</span>
                                  {t.title}
                                </div>
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {ownerLabel} · {t.error || t.outputText?.slice(0, 80) || t.status}
                                </div>
                              </div>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                              {t.status}
                              {t.durationMs ? ` (${(t.durationMs / 1000).toFixed(1)}s)` : ''}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {detailTab === 'workspace' && (
                  <WorkspaceSyncSection
                    selectedRun={selectedRun}
                    onAfterCommandDispatch={() => onRefresh(true)}
                  />
                )}

                {detailTab === 'logs' && (
                  <div className="divide-y divide-slate-200/70 dark:divide-slate-700/40 max-h-96 overflow-y-auto text-xs">
                    {sessionLogs.length === 0 ? (
                      <div className="py-8 text-center text-slate-500 dark:text-slate-400">
                        Chưa có nhật ký hoạt động cho phiên này.
                      </div>
                    ) : (
                      sessionLogs.map((l) => (
                        <div key={l.id} className="py-2 flex flex-wrap items-baseline justify-between gap-2">
                          <div className="space-x-2">
                            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                              {fmtDateTime(l.timestamp)}
                            </span>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{l.action}</span>
                            <span className="text-slate-600 dark:text-slate-300">{l.detail}</span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400">{l.agentId || 'system'}</span>
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

      {/* Create Empty Session Modal */}
      {isNewSessionOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSession}
            className="w-full max-w-md glass-card rounded-2xl p-5 border border-slate-200 dark:border-slate-700/60 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                Tạo phiên sản xuất mới
              </h3>
              <button
                type="button"
                onClick={() => setIsNewSessionOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Tên phiên / Dự án phim
              </label>
              <input
                type="text"
                autoFocus
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                placeholder="Ví dụ: Phim AI - Tập 02"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewSessionOpen(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                disabled={busyKey === 'create_session'}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
              >
                Tạo phiên
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Cancel Session Confirmation Modal (No window.confirm!) */}
      {confirmCancelRun && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md glass-card rounded-2xl p-5 border border-rose-400/50 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                  Xác nhận hủy phiên sản xuất?
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  Phiên <strong>{confirmCancelRun.title}</strong> ({confirmCancelRun.id}) sẽ dừng toàn bộ tác vụ đang chờ và đang chạy, đồng thời ghi nhận lịch sử hủy phiên.
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                  Dữ liệu cảnh đã hoàn thành, hình ảnh, video và bản backup vẫn được giữ nguyên.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmCancelRun(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Giữ lại phiên
              </button>
              <button
                type="button"
                disabled={busyKey === `cancel_${confirmCancelRun.id}`}
                onClick={() => handleControlSession(confirmCancelRun.id, 'cancel')}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
              >
                {busyKey === `cancel_${confirmCancelRun.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Xác nhận hủy phiên</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
