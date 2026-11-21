import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Square,
  Upload,
} from 'lucide-react';
import type {
  DerivativeAspectRatio,
  StudioProductionFormat,
  StudioProjectProfile,
  StudioVideoStyle,
} from '../types/bilibili';
import type {
  CommandCenterState,
  CommandTask,
  CommunicationChannelId,
  ConversationMessage,
  MuseAgentAvatarPreset,
  MuseAgentConfig,
  MuseAgentEngineMode,
  MuseAgentId,
  ProductionRun,
} from '../types/commandCenter';
import {
  AgentAvatar,
  MUSE_ACCENT_SWATCHES,
  MUSE_AVATAR_PRESETS,
  renderPresetSvgIcon,
} from './command-center/AgentAvatar';
import { CommunicationHub } from './command-center/CommunicationHub';
import { PerformanceMonitorTab } from './command-center/PerformanceMonitorTab';

type CommandCenterSubTab =
  | 'overview'
  | 'agents'
  | 'chat'
  | 'tasks'
  | 'pipeline'
  | 'qa'
  | 'perf'
  | 'logs'
  | 'backup'
  | 'cloud';

const SUB_TABS: { id: CommandCenterSubTab; label: string }[] = [
  { id: 'overview', label: 'Tổng quan & Lệnh tổng' },
  { id: 'agents', label: 'Đội ngũ 5 Muse AI' },
  { id: 'chat', label: 'Trung tâm giao tiếp' },
  { id: 'tasks', label: 'Giao việc & Nhiệm vụ' },
  { id: 'pipeline', label: 'Điều phối & Project Memory' },
  { id: 'qa', label: 'Giám sát chất lượng' },
  { id: 'perf', label: 'Hiệu năng & Kênh nhanh' },
  { id: 'logs', label: 'Tiến độ & Nhật ký' },
  { id: 'backup', label: 'Backup & Lưu trữ' },
  { id: 'cloud', label: 'Tài khoản & Cloud' },
];

const AGENT_STATUS_LABELS: Record<MuseAgentConfig['status'], string> = {
  online: 'Sẵn sàng',
  working: 'Đang làm việc',
  waiting: 'Đang chờ',
  supervising: 'Đang giám sát',
  paused: 'Tạm dừng',
  offline: 'Chưa kết nối',
  error: 'Gặp lỗi',
};

const AGENT_STATUS_TEXT_CLASS: Record<MuseAgentConfig['status'], string> = {
  online: 'text-emerald-600 dark:text-emerald-400',
  working: 'text-cyan-600 dark:text-cyan-400',
  waiting: 'text-amber-600 dark:text-amber-400',
  supervising: 'text-violet-600 dark:text-violet-400',
  paused: 'text-slate-500 dark:text-slate-400',
  offline: 'text-slate-500 dark:text-slate-400',
  error: 'text-rose-600 dark:text-rose-400',
};

const TASK_STATUS_LABELS: Record<CommandTask['status'], string> = {
  queued: 'Trong hàng đợi',
  blocked_by_deps: 'Chờ phụ thuộc',
  running: 'Đang thực thi',
  completed: 'Hoàn thành',
  failed: 'Thất bại',
  qa_rejected: 'QA trả về',
  cancelled: 'Đã hủy',
};

const TASK_STATUS_TEXT_CLASS: Record<CommandTask['status'], string> = {
  queued: 'text-sky-600 dark:text-sky-400',
  blocked_by_deps: 'text-amber-600 dark:text-amber-400',
  running: 'text-cyan-600 dark:text-cyan-400',
  completed: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-rose-600 dark:text-rose-400',
  qa_rejected: 'text-orange-600 dark:text-orange-400',
  cancelled: 'text-slate-500 dark:text-slate-400',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  idle: 'Chờ lệnh',
  planning: 'Tổng đạo diễn đang lập kế hoạch',
  producing: 'Đang sản xuất song song',
  inspecting: 'Muse AI 05 đang kiểm định',
  assembling: 'Đang ghép xuất phim',
  completed: 'Đã bàn giao hoàn chỉnh',
  paused: 'Đang tạm dừng',
  failed: 'Thất bại',
  needs_attention: 'Cần kiểm tra thủ công',
};

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function apiJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Phản hồi không hợp lệ (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Yêu cầu thất bại (HTTP ${res.status})`);
  }
  return data as T;
}

interface CommandCenterPanelProps {
  onOpenSettings?: () => void;
  onOpenProductionMonitor?: () => void;
  isActiveTab?: boolean;
  liveState: CommandCenterState | null;
  setLiveState: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  liveLoading: boolean;
  sseConnected: boolean;
  onRefreshLive: (forceHealth?: boolean) => Promise<CommandCenterState | null>;
  externalSubTabRequest?: { subTab: CommandCenterSubTab; nonce: number } | null;
}

export const CommandCenterPanel: React.FC<CommandCenterPanelProps> = ({
  onOpenProductionMonitor,
  isActiveTab = false,
  liveState: state,
  setLiveState: setState,
  liveLoading: loading,
  sseConnected,
  onRefreshLive,
  externalSubTabRequest,
}) => {
  const [subTab, setSubTab] = useState<CommandCenterSubTab>('overview');
  const [busyAction, setBusyAction] = useState<string>('');
  const [bannerError, setBannerError] = useState('');
  const [bannerNotice, setBannerNotice] = useState('');
  const [confirmCancelRun, setConfirmCancelRun] = useState<ProductionRun | null>(null);

  // Overview / Script Dispatcher form
  const [projectTitle, setProjectTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [productionFormat, setProductionFormat] = useState<StudioProductionFormat>('dialogue_film');
  const [aspectRatio, setAspectRatio] = useState<DerivativeAspectRatio>('16:9');
  const [videoStyle, setVideoStyle] = useState<StudioVideoStyle>('cinematic');
  const [studioProfiles, setStudioProfiles] = useState<StudioProjectProfile[]>([]);
  const [hasManualFormEdit, setHasManualFormEdit] = useState(false);
  const hydratedSyncAtRef = useRef<number>(0);

  // Agent editing draft
  const [editingAgentId, setEditingAgentId] = useState<MuseAgentId | null>(null);
  const [agentDraftName, setAgentDraftName] = useState('');
  const [agentDraftRole, setAgentDraftRole] = useState('');
  const [agentDraftDesc, setAgentDraftDesc] = useState('');
  const [agentDraftAccount, setAgentDraftAccount] = useState('auto');
  const [agentDraftEngine, setAgentDraftEngine] = useState<MuseAgentEngineMode>('muse2api');
  const [agentDraftPreset, setAgentDraftPreset] = useState<MuseAgentAvatarPreset>('director_clapboard');
  const [agentDraftColor, setAgentDraftColor] = useState('#7C3AED');
  const [agentDraftAvatarDataUrl, setAgentDraftAvatarDataUrl] = useState<string | undefined>(undefined);
  const [agentDraftClearAvatar, setAgentDraftClearAvatar] = useState(false);
  const [agentTestReplies, setAgentTestReplies] = useState<Record<string, string>>({});

  // Chat initial channel deep-link
  const [chatInitialChannel, setChatInitialChannel] = useState<CommunicationChannelId>('commander');

  // Manual Task form
  const [manualAgentId, setManualAgentId] = useState<MuseAgentId>('muse-01');
  const [manualTitle, setManualTitle] = useState('');
  const [manualInstructions, setManualInstructions] = useState('');
  const [manualSceneId, setManualSceneId] = useState('');

  // QA manual reject modal/inline
  const [qaFixInputs, setQaFixInputs] = useState<Record<string, string>>({});

  // Logs filter
  const [logAgentFilter, setLogAgentFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('all');

  // Backup & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAgentId, setSearchAgentId] = useState('all');
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [searchResults, setSearchResults] = useState<{ messages: ConversationMessage[]; tasks: CommandTask[] } | null>(
    null
  );

  // Cloud & Muse2API form
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudKey, setCloudKey] = useState('');
  const [parallelLimit, setParallelLimit] = useState(2);
  const [qaThreshold, setQaThreshold] = useState(80);
  const [maxRetries, setMaxRetries] = useState(2);
  const [autoBackup, setAutoBackup] = useState(true);
  const [newAccLabel, setNewAccLabel] = useState('');
  const [newAccCookie, setNewAccCookie] = useState('');
  const [cloudSyncedOnce, setCloudSyncedOnce] = useState(false);

  const applySyncedDirectiveToForm = useCallback(
    (dir: CommandCenterState['latestStudioDirective'] | null | undefined, mem?: CommandCenterState['projectMemory']) => {
      if (dir && dir.scriptOrCommand) {
        setProjectTitle(dir.title || '');
        setScriptText(dir.scriptOrCommand || '');
        setProductionFormat(dir.productionFormat || 'dialogue_film');
        setAspectRatio(dir.aspectRatio || '16:9');
        setVideoStyle(dir.videoStyle || 'cinematic');
        hydratedSyncAtRef.current = dir.syncedAt;
        return true;
      }
      if (mem && mem.originalScript) {
        setProjectTitle(mem.title || '');
        setScriptText(mem.originalScript || '');
        setProductionFormat(mem.productionFormat || 'dialogue_film');
        setAspectRatio(mem.aspectRatio || '16:9');
        setVideoStyle(mem.videoStyle || 'cinematic');
        hydratedSyncAtRef.current = mem.updatedAt;
        return true;
      }
      return false;
    },
    []
  );

  const fetchState = useCallback(
    async (forceHealth = false) => {
      const data = await onRefreshLive(forceHealth);
      return data;
    },
    [onRefreshLive]
  );

  useEffect(() => {
    if (!state) return;
    if (!cloudSyncedOnce) {
      setCloudUrl(state.cloudConfig.muse2ApiBaseUrl || '');
      setParallelLimit(state.cloudConfig.parallelLimit);
      setQaThreshold(state.cloudConfig.qaPassThreshold);
      setMaxRetries(state.cloudConfig.maxRetriesPerScene);
      setAutoBackup(state.cloudConfig.autoBackupRealtime);
      setCloudSyncedOnce(true);
    }
    const dir = state.latestStudioDirective;
    if (dir && dir.syncedAt > hydratedSyncAtRef.current && (!hasManualFormEdit || !scriptText.trim())) {
      applySyncedDirectiveToForm(dir, state.projectMemory);
    } else if (!hasManualFormEdit && !scriptText.trim() && state.projectMemory?.originalScript) {
      applySyncedDirectiveToForm(null, state.projectMemory);
    }
  }, [state, cloudSyncedOnce, hasManualFormEdit, scriptText, applySyncedDirectiveToForm]);

  const refreshStudioProjects = useCallback(() => {
    fetch('/api/studio/projects')
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d) => {
        if (Array.isArray(d?.projects)) setStudioProfiles(d.projects);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStudioProjects();
  }, [refreshStudioProjects]);

  useEffect(() => {
    if (isActiveTab) {
      refreshStudioProjects();
    }
  }, [isActiveTab, refreshStudioProjects]);

  useEffect(() => {
    if (externalSubTabRequest) {
      setSubTab(externalSubTabRequest.subTab);
    }
  }, [externalSubTabRequest]);

  const runAction = async (key: string, fn: () => Promise<CommandCenterState | null | void>, okNotice?: string) => {
    setBusyAction(key);
    setBannerError('');
    setBannerNotice('');
    try {
      const next = await fn();
      if (next && 'metrics' in next) {
        setState(next);
      } else {
        await fetchState(true);
      }
      if (okNotice) setBannerNotice(okNotice);
    } catch (err: any) {
      setBannerError(err?.message || 'Thao tác thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleStartProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scriptText.trim()) {
      setBannerError('Vui lòng nhập kịch bản hoặc câu lệnh sản xuất.');
      return;
    }
    await runAction(
      'start_production',
      () =>
        apiJson<CommandCenterState>('/api/command-center/productions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: projectTitle.trim(),
            script: scriptText.trim(),
            productionFormat,
            aspectRatio,
            videoStyle,
          }),
        }),
      'Đã bàn giao kịch bản cho Muse AI 01 — Tổng đạo diễn và khởi động hàng đợi Cloud.'
    );
  };

  const handleLoadStudioProject = (projId: string) => {
    if (projId === '__latest_studio_directive__') {
      if (applySyncedDirectiveToForm(state?.latestStudioDirective, state?.projectMemory)) {
        setHasManualFormEdit(false);
        setBannerNotice('Đã nạp chỉ thị mới nhất đồng bộ từ Studio vào Trung tâm giao nhiệm vụ tổng.');
      }
      return;
    }
    const proj = studioProfiles.find((p) => p.id === projId);
    if (!proj) return;
    setProjectTitle(proj.name);
    setVideoStyle(proj.videoStyle || 'cinematic');
    const summaryParts = [
      proj.description ? `Ý tưởng / Kịch bản: ${proj.description}` : '',
      proj.characterBible ? `Hồ sơ nhân vật: ${proj.characterBible}` : '',
      proj.settingBible ? `Bối cảnh: ${proj.settingBible}` : '',
      proj.costumeBible ? `Trang phục: ${proj.costumeBible}` : '',
      proj.continuityBible ? `Nối cảnh: ${proj.continuityBible}` : '',
    ].filter(Boolean);
    setScriptText(summaryParts.join('\n\n'));
    setHasManualFormEdit(true);
    setBannerNotice(`Đã nạp dữ liệu dự án "${proj.name}" từ Studio.`);
  };

  const openAgentEditor = (agent: MuseAgentConfig) => {
    setEditingAgentId(agent.id);
    setAgentDraftName(agent.name);
    setAgentDraftRole(agent.roleTitle);
    setAgentDraftDesc(agent.description);
    setAgentDraftAccount(agent.boundAccountId || 'auto');
    setAgentDraftEngine(agent.engineMode);
    setAgentDraftPreset(agent.avatarPreset || 'director_clapboard');
    setAgentDraftColor(agent.accentColor || '#7C3AED');
    setAgentDraftAvatarDataUrl(undefined);
    setAgentDraftClearAvatar(false);
  };

  const handleAgentLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAgentDraftAvatarDataUrl(String(reader.result || ''));
      setAgentDraftClearAvatar(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAgentEdit = async (agentId: MuseAgentId) => {
    await runAction(
      `save_agent_${agentId}`,
      () =>
        apiJson<CommandCenterState>(`/api/command-center/agents/${agentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: agentDraftName,
            roleTitle: agentDraftRole,
            description: agentDraftDesc,
            boundAccountId: agentDraftAccount,
            engineMode: agentDraftEngine,
            avatarPreset: agentDraftPreset,
            accentColor: agentDraftColor,
            ...(agentDraftAvatarDataUrl ? { avatarDataUrl: agentDraftAvatarDataUrl } : {}),
            ...(agentDraftClearAvatar ? { avatarUrl: '' } : {}),
          }),
        }),
      'Đã lưu cấu hình danh tính & kết nối Muse AI.'
    );
    setEditingAgentId(null);
  };

  const handleTestAgent = async (agentId: MuseAgentId) => {
    setBusyAction(`test_${agentId}`);
    setBannerError('');
    try {
      const res = await apiJson<{ ok: boolean; provider: string; reply: string }>(
        `/api/command-center/agents/${agentId}/test`,
        { method: 'POST' }
      );
      setAgentTestReplies((prev) => ({
        ...prev,
        [agentId]: `[${res.provider}] ${res.reply}`,
      }));
      await fetchState(false);
    } catch (err: any) {
      setBannerError(err?.message || 'Kiểm tra kết nối thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleCreateManualTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim() && !manualInstructions.trim()) {
      setBannerError('Vui lòng nhập tiêu đề hoặc nội dung nhiệm vụ.');
      return;
    }
    await runAction(
      'create_manual_task',
      () =>
        apiJson<CommandCenterState>('/api/command-center/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignedAgentId: manualAgentId,
            title: manualTitle.trim() || manualInstructions.trim().slice(0, 60),
            instructions: manualInstructions.trim() || manualTitle.trim(),
            sceneId: manualSceneId || undefined,
          }),
        }),
      'Đã giao nhiệm vụ vào hàng đợi thực thi.'
    );
    setManualTitle('');
    setManualInstructions('');
  };

  const handleSearchArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('search_archive');
    setBannerError('');
    try {
      const qs = new URLSearchParams({
        query: searchQuery,
        agentId: searchAgentId,
        dateFrom: searchDateFrom,
        dateTo: searchDateTo,
      });
      const res = await apiJson<{ messages: ConversationMessage[]; tasks: CommandTask[] }>(
        `/api/command-center/search?${qs.toString()}`
      );
      setSearchResults(res);
    } catch (err: any) {
      setBannerError(err?.message || 'Tìm kiếm kho lưu trữ thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSaveCloudConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await runAction(
      'save_cloud',
      () =>
        apiJson<CommandCenterState>('/api/command-center/cloud-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            muse2ApiBaseUrl: cloudUrl,
            muse2ApiKey: cloudKey || undefined,
            parallelLimit,
            qaPassThreshold: qaThreshold,
            maxRetriesPerScene: maxRetries,
            autoBackupRealtime: autoBackup,
          }),
        }),
      'Đã lưu cấu hình Cloud Orchestrator & kiểm tra kết nối Muse2API.'
    );
    setCloudKey('');
  };

  const handleAddMuseAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccCookie.trim()) return;
    await runAction(
      'add_muse_acc',
      async () => {
        await apiJson('/api/muse2api/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: newAccLabel.trim() || 'Muse Account',
            cookieHeader: newAccCookie.trim(),
          }),
        });
        return fetchState(true) as any;
      },
      'Đã thêm tài khoản Muse.ai vào Pool.'
    );
    setNewAccLabel('');
    setNewAccCookie('');
  };

  if (loading && !state) {
    return (
      <div className="glass-card rounded-2xl p-8 flex items-center justify-center gap-3 text-sm text-slate-600 dark:text-slate-300">
        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
        <span>Đang khởi tạo Phòng Điều Hành AI Muse...</span>
      </div>
    );
  }

  const metrics = state?.metrics;
  const agents = state?.agents || [];
  const memory = state?.projectMemory;
  const activeRun = state?.activeRun || null;
  const health = state?.integrationHealth;
  const filteredLogs = (state?.logs || []).filter((l) => {
    if (logAgentFilter !== 'all' && l.agentId !== logAgentFilter) return false;
    if (logLevelFilter !== 'all' && l.level !== logLevelFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Top Header & KPI Summary Bar */}
      <section className="glass-card rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/40 pb-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              AI Muse Command Center · Điều phối 5 AI sản xuất phim song song
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
              Phòng Điều Hành AI Muse
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busyAction === 'refresh'}
              onClick={() => runAction('refresh', () => fetchState(true))}
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'refresh' ? 'animate-spin' : ''}`} />
              <span>Kiểm tra kết nối</span>
            </button>

            <button
              type="button"
              disabled={busyAction === 'manual_backup'}
              onClick={() =>
                runAction(
                  'manual_backup',
                  () =>
                    apiJson<CommandCenterState>('/api/command-center/backups', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({}),
                    }),
                  'Đã tạo bản sao lưu trạng thái & hội thoại.'
                )
              }
              className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] hover:bg-slate-50 dark:hover:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Sao lưu ngay</span>
            </button>
          </div>
        </div>

        {/* 4 Tabular Metric Columns (flat surface, subtle hairline borders) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Muse AI kết nối thực tế</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {metrics?.connectedAgents ?? 0}/{metrics?.totalAgents ?? 5}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {health?.healthyAccounts ?? 0} tài khoản Muse.ai sẵn sàng
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Đang sản xuất</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
              {metrics?.workingAgents ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {metrics?.waitingAgents ?? 0} chờ dữ liệu · {metrics?.pausedAgents ?? 0} tạm dừng
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Giám sát QA (Muse 05)</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              {metrics?.supervisingAgents ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              Ngưỡng đạt: {state?.cloudConfig.qaPassThreshold ?? 80}/100
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5">
            <div className="text-xs text-slate-500 dark:text-slate-400">Tiến độ tác vụ Cloud</div>
            <div className="mt-1 text-2xl font-display font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {metrics?.completedTasks ?? 0}/{metrics?.totalTasks ?? 0}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {metrics?.runningTasks ?? 0} đang chạy · {metrics?.queuedTasks ?? 0} chờ
            </div>
          </div>
        </div>

        {/* Sub-navigation Segmented Control (9 management sections) */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200/80 dark:border-slate-700/40">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === t.id
                  ? 'bg-white dark:bg-[#1a2244] text-slate-900 dark:text-white shadow-sm border border-slate-200/80 dark:border-slate-600/40'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* Honest Integration Diagnostics & Alerts */}
      {health && health.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300/70 dark:border-amber-700/50 bg-amber-50/90 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-[260px]">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Kiểm tra tích hợp thực tế &amp; điều kiện chạy Cloud</span>
            </div>
            <ul className="space-y-0.5 pl-5 list-disc text-amber-800 dark:text-amber-200/90">
              {health.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setSubTab('cloud')}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Mở Cấu hình Tài khoản &amp; Cloud
          </button>
        </div>
      )}

      {bannerError && (
        <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 px-4 py-3 text-xs text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3">
          <span>{bannerError}</span>
          <button type="button" onClick={() => setBannerError('')} className="underline cursor-pointer shrink-0">
            Đóng
          </button>
        </div>
      )}

      {bannerNotice && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50 dark:bg-emerald-950/35 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3">
          <span>{bannerNotice}</span>
          <button type="button" onClick={() => setBannerNotice('')} className="underline cursor-pointer shrink-0">
            Đóng
          </button>
        </div>
      )}

      {/* =========================================================
          1. OVERVIEW & CENTRAL COMMAND DISPATCHER
         ========================================================= */}
      {subTab === 'overview' && (
        <div className="space-y-5">
          {/* 5 Muse AI Live Team Roster */}
          <section className="glass-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Đội ngũ 5 Muse AI
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Muse 01 điều phối · Muse 05 kiểm định độc lập · Muse 02–04 chuyên trách sản xuất
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubTab('agents')}
                className="text-xs font-medium text-violet-600 dark:text-violet-300 hover:underline cursor-pointer"
              >
                Tùy chỉnh vai trò &amp; tài khoản →
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              {agents.map((ag) => (
                <div
                  key={ag.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-white/80 dark:bg-[#0c1021]/85 p-3.5 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{ag.code}</span>
                      <span className={`font-semibold ${AGENT_STATUS_TEXT_CLASS[ag.status]}`}>
                        {AGENT_STATUS_LABELS[ag.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar agent={ag} size="md" showStatusDot />
                      <div className="min-w-0">
                        <div className="font-display font-bold text-sm text-slate-900 dark:text-white truncate">
                          {ag.name}
                        </div>
                        <div
                          className="text-xs font-medium truncate"
                          style={{ color: ag.accentColor || '#7C3AED' }}
                        >
                          {ag.roleTitle}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[2rem]">
                      {ag.currentTaskSummary || ag.lastError || ag.description}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/40 space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>Acc: {ag.boundAccountId === 'auto' ? 'Tự động' : ag.boundAccountId}</span>
                      <span>
                        {ag.stats.completed} xong · {ag.stats.failed} lỗi
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          runAction(`toggle_pause_${ag.id}`, () =>
                            apiJson<CommandCenterState>(
                              `/api/command-center/agents/${ag.id}/${ag.paused ? 'resume' : 'pause'}`,
                              { method: 'POST' }
                            )
                          )
                        }
                        className="flex-1 py-1.5 px-2 rounded-lg border border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        {ag.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                        <span>{ag.paused ? 'Tiếp tục' : 'Tạm dừng'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatInitialChannel(ag.id);
                          setSubTab('chat');
                        }}
                        className="py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                      >
                        Chat
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Split Grid: Central Command Dispatcher + Active Run Progress */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <form
              onSubmit={handleStartProduction}
              className="xl:col-span-7 glass-card rounded-2xl p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                    Trung tâm giao nhiệm vụ tổng
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Gửi một kịch bản hoặc lệnh sản xuất duy nhất — Muse AI 01 tự chia việc, khóa Project Memory và chạy song song.
                  </p>
                </div>

                {(studioProfiles.length > 0 || state?.latestStudioDirective) && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleLoadStudioProject(e.target.value);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-700 dark:text-slate-200"
                  >
                    <option value="">Nạp kịch bản từ Studio...</option>
                    {state?.latestStudioDirective && (
                      <option value="__latest_studio_directive__">
                        [Mới nhất từ Studio] {state.latestStudioDirective.title} ({state.latestStudioDirective.sceneCount} cảnh)
                      </option>
                    )}
                    {studioProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {state?.latestStudioDirective && (
                <div className="rounded-xl border border-cyan-500/35 bg-cyan-50/70 dark:bg-cyan-950/25 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-cyan-900 dark:text-cyan-200 truncate">
                      Đã nhận chỉ thị từ Studio: {state.latestStudioDirective.title}
                    </div>
                    <div className="text-[11px] text-cyan-800/80 dark:text-cyan-300/80 tabular-nums">
                      {state.latestStudioDirective.characterCount} nhân vật · {state.latestStudioDirective.sceneCount} phân cảnh · {state.latestStudioDirective.aspectRatio} · Đồng bộ lúc{' '}
                      {new Date(state.latestStudioDirective.syncedAt).toLocaleTimeString('vi-VN')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      applySyncedDirectiveToForm(state.latestStudioDirective, state.projectMemory);
                      setHasManualFormEdit(false);
                      setBannerNotice('Đã đồng bộ lại nội dung mới nhất từ Studio vào khung lệnh.');
                    }}
                    className="px-2.5 py-1 rounded-lg border border-cyan-500/40 bg-white/80 dark:bg-[#0c1021] text-[11px] font-medium text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/15 cursor-pointer whitespace-nowrap"
                  >
                    Nạp lại chỉ thị Studio
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Tên dự án / Tập phim
                  </label>
                  <input
                    type="text"
                    value={projectTitle}
                    onChange={(e) => {
                      setProjectTitle(e.target.value);
                      setHasManualFormEdit(true);
                    }}
                    placeholder="Ví dụ: Tập 01 - Cuộc gặp định mệnh"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Chế độ kịch bản
                  </label>
                  <select
                    value={productionFormat}
                    onChange={(e) => {
                      setProductionFormat(e.target.value as StudioProductionFormat);
                      setHasManualFormEdit(true);
                    }}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                  >
                    <option value="dialogue_film">Phim có lời thoại</option>
                    <option value="narration_story">Phim thuyết minh kể chuyện</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Tỷ lệ khung hình
                  </label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => {
                      setAspectRatio(e.target.value as DerivativeAspectRatio);
                      setHasManualFormEdit(true);
                    }}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                  >
                    <option value="16:9">16:9 Ngang điện ảnh</option>
                    <option value="9:16">9:16 Dọc Shorts/TikTok</option>
                    <option value="1:1">1:1 Vuông</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Kịch bản / Lệnh điều phối sản xuất
                </label>
                <textarea
                  rows={5}
                  value={scriptText}
                  onChange={(e) => {
                    setScriptText(e.target.value);
                    setHasManualFormEdit(true);
                  }}
                  placeholder="Nhập kịch bản chi tiết hoặc chỉ thị tổng (ví dụ: Hãy sản xuất tập phim ngắn theo kịch bản này, giữ đồng nhất gương mặt nhân vật, giọng nói theo độ tuổi và bối cảnh; kiểm định QA và tự sửa cảnh lỗi trước khi bàn giao)..."
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Cloud Worker ID: <span className="font-mono">{state?.cloudConfig.workerBootId}</span>
                </div>
                <button
                  type="submit"
                  disabled={busyAction === 'start_production'}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                >
                  {busyAction === 'start_production' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>Bắt đầu sản xuất</span>
                </button>
              </div>
            </form>

            {/* Active Production Run & Final Deliverable */}
            <section className="xl:col-span-5 glass-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Trạng thái phiên sản xuất
                </h2>
                {activeRun && (
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    Memory v{memory?.version ?? 1}
                  </span>
                )}
              </div>

              {!activeRun ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center space-y-2">
                  <Film className="w-6 h-6 text-slate-400 mx-auto" />
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Chưa có phiên sản xuất nào đang chạy
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Gửi kịch bản ở khung bên trái để Muse AI 01 lập kế hoạch và điều phối 5 AI thực thi.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{activeRun.title}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
                      <span>{RUN_STATUS_LABELS[activeRun.status] || activeRun.status}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {activeRun.completedScenes}/{activeRun.sceneCount} cảnh có video
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {activeRun.passedQaScenes}/{activeRun.sceneCount} đạt QA
                      </span>
                    </div>
                  </div>

                  {activeRun.error && (
                    <div className="rounded-xl border border-rose-300 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/35 p-3 text-xs text-rose-800 dark:text-rose-200">
                      {activeRun.error}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {activeRun.status !== 'paused' &&
                      activeRun.status !== 'completed' &&
                      activeRun.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() =>
                            runAction('pause_run', () =>
                              apiJson<CommandCenterState>(`/api/command-center/productions/${activeRun.id}/pause`, {
                                method: 'POST',
                              })
                            )
                          }
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Pause className="w-3.5 h-3.5" />
                          <span>Tạm dừng phiên</span>
                        </button>
                      )}

                    {(activeRun.status === 'paused' || activeRun.status === 'needs_attention') && (
                      <button
                        type="button"
                        onClick={() =>
                          runAction('resume_run', () =>
                            apiJson<CommandCenterState>(`/api/command-center/productions/${activeRun.id}/resume`, {
                              method: 'POST',
                            })
                          )
                        }
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Tiếp tục chạy</span>
                      </button>
                    )}

                    {activeRun.status !== 'completed' && activeRun.status !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => setConfirmCancelRun(activeRun)}
                        className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700/60 text-xs font-medium text-rose-700 dark:text-rose-300 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Square className="w-3 h-3" />
                        <span>Hủy phiên</span>
                      </button>
                    )}

                    {onOpenProductionMonitor && (
                      <button
                        type="button"
                        onClick={onOpenProductionMonitor}
                        className="px-3 py-1.5 rounded-lg bg-violet-600/15 hover:bg-violet-600/25 text-violet-700 dark:text-violet-300 text-xs font-medium cursor-pointer"
                      >
                        Mở Phiên Sản Xuất ({activeRun.overallProgressPct ?? 0}%) →
                      </button>
                    )}
                  </div>

                  {activeRun.finalVideoUrl && (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700/45 space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        <span>Phim hoàn chỉnh đã bàn giao ({activeRun.finalDurationSec}s)</span>
                        <a
                          href={activeRun.finalVideoUrl}
                          download={activeRun.finalVideoArtifactName || 'muse_final_film.mp4'}
                          className="inline-flex items-center gap-1 underline"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải MP4</span>
                        </a>
                      </div>
                      <video
                        src={activeRun.finalVideoUrl}
                        controls
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700/60 bg-black max-h-64"
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* =========================================================
          2. AGENTS MANAGEMENT (5 MUSE AI IDENTITY & PERMISSIONS)
         ========================================================= */}
      {subTab === 'agents' && (
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Hồ sơ danh tính, Logo &amp; Phân quyền 5 Muse AI
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Đổi tên, tải logo riêng hoặc chọn biểu tượng hệ thống, đặt màu nhận diện, gán tài khoản Muse2API và xem hiệu suất từng AI.
            </p>
          </div>

          <div className="space-y-3">
            {agents.map((ag) => {
              const isEditing = editingAgentId === ag.id;
              return (
                <div
                  key={ag.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white/75 dark:bg-[#0c1021]/85 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-[260px]">
                      <AgentAvatar agent={ag} size="lg" showStatusDot />
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-slate-500 dark:text-slate-400">{ag.code}</span>
                          <span aria-hidden="true">·</span>
                          <span className={`font-semibold ${AGENT_STATUS_TEXT_CLASS[ag.status]}`}>
                            {AGENT_STATUS_LABELS[ag.status]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {ag.engineMode === 'muse2api'
                              ? 'Chỉ chạy Muse2API thực tế'
                              : 'Muse2API + Gemini Dự phòng'}
                          </span>
                        </div>
                        <div className="text-base font-display font-bold text-slate-900 dark:text-white">
                          {ag.name} —{' '}
                          <span style={{ color: ag.accentColor || '#7C3AED' }}>{ag.roleTitle}</span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{ag.description}</p>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 pt-1 font-mono tabular-nums">
                          <span>Phạm vi: {ag.permissions.allowedDataScopes.join(', ')}</span>
                          {typeof ag.avgResponseMs === 'number' && ag.avgResponseMs > 0 && (
                            <span>TB phản hồi: {(ag.avgResponseMs / 1000).toFixed(1)}s</span>
                          )}
                          {typeof ag.successRate === 'number' && (
                            <span>Thành công: {ag.successRate}%</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyAction === `test_${ag.id}`}
                        onClick={() => handleTestAgent(ag.id)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        {busyAction === `test_${ag.id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Activity className="w-3.5 h-3.5" />
                        )}
                        <span>Thử kết nối</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          runAction(`pause_${ag.id}`, () =>
                            apiJson<CommandCenterState>(
                              `/api/command-center/agents/${ag.id}/${ag.paused ? 'resume' : 'pause'}`,
                              { method: 'POST' }
                            )
                          )
                        }
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        {ag.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        <span>{ag.paused ? 'Kích hoạt' : 'Tạm ngưng'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => (isEditing ? setEditingAgentId(null) : openAgentEditor(ag))}
                        className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                      >
                        {isEditing ? 'Đóng' : 'Hồ sơ & Logo'}
                      </button>
                    </div>
                  </div>

                  {agentTestReplies[ag.id] && (
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/50 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                      {agentTestReplies[ag.id]}
                    </div>
                  )}

                  {isEditing && (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-700/45 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                            Tên hiển thị AI
                          </label>
                          <input
                            type="text"
                            value={agentDraftName}
                            onChange={(e) => setAgentDraftName(e.target.value)}
                            className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#131a35] text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                            Vai trò phụ trách
                          </label>
                          <input
                            type="text"
                            value={agentDraftRole}
                            onChange={(e) => setAgentDraftRole(e.target.value)}
                            className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#131a35] text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                            Gán tài khoản Muse2API
                          </label>
                          <select
                            value={agentDraftAccount}
                            onChange={(e) => setAgentDraftAccount(e.target.value)}
                            className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#131a35] text-xs text-slate-900 dark:text-white"
                          >
                            <option value="auto">Tự động xoay vòng Pool</option>
                            {(health?.accounts || []).map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.label} ({acc.id}) {acc.ok === false ? '— Lỗi' : ''}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                            Chế độ thực thi AI
                          </label>
                          <select
                            value={agentDraftEngine}
                            onChange={(e) => setAgentDraftEngine(e.target.value as MuseAgentEngineMode)}
                            className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#131a35] text-xs text-slate-900 dark:text-white"
                          >
                            <option value="muse2api">Chỉ Muse2API (Tài khoản Muse.ai thực)</option>
                            <option value="muse2api_with_gemini_fallback">
                              Muse2API + Gemini Server Dự phòng
                            </option>
                          </select>
                        </div>
                      </div>

                      {/* Custom Logo Upload, SVG Preset & Accent Color */}
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#090d1c]/70 p-3.5">
                        <div className="lg:col-span-4 flex items-center gap-3">
                          <AgentAvatar
                            agent={ag}
                            avatarUrl={agentDraftClearAvatar ? '' : agentDraftAvatarDataUrl ?? ag.avatarUrl}
                            avatarPreset={agentDraftPreset}
                            accentColor={agentDraftColor}
                            size="lg"
                          />
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                              Logo nhận diện
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <label className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131a35] text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800">
                                <Upload className="w-3 h-3" />
                                <span>Tải logo</span>
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                  onChange={handleAgentLogoUpload}
                                  className="hidden"
                                />
                              </label>
                              {(ag.avatarUrl || agentDraftAvatarDataUrl) && !agentDraftClearAvatar && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAgentDraftAvatarDataUrl(undefined);
                                    setAgentDraftClearAvatar(true);
                                  }}
                                  className="px-2 py-1 rounded-lg text-[11px] text-rose-600 dark:text-rose-300 hover:underline cursor-pointer"
                                >
                                  Dùng icon hệ thống
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="lg:col-span-4 space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                            Biểu tượng hệ thống (Preset)
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {MUSE_AVATAR_PRESETS.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                title={p.label}
                                onClick={() => {
                                  setAgentDraftPreset(p.id);
                                  setAgentDraftClearAvatar(true);
                                  setAgentDraftAvatarDataUrl(undefined);
                                }}
                                className={`w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer transition ${
                                  agentDraftPreset === p.id
                                    ? 'border-violet-500 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {renderPresetSvgIcon(p.id, 'w-4 h-4')}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="lg:col-span-4 space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                            Màu nhận diện
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {MUSE_ACCENT_SWATCHES.map((sw) => (
                              <button
                                key={sw.hex}
                                type="button"
                                title={sw.label}
                                onClick={() => setAgentDraftColor(sw.hex)}
                                className={`w-6 h-6 rounded-full border-2 cursor-pointer transition ${
                                  agentDraftColor.toUpperCase() === sw.hex
                                    ? 'border-slate-900 dark:border-white scale-110'
                                    : 'border-transparent'
                                }`}
                                style={{ backgroundColor: sw.hex }}
                              />
                            ))}
                            <input
                              type="color"
                              value={agentDraftColor}
                              onChange={(e) => setAgentDraftColor(e.target.value)}
                              className="w-7 h-6 rounded border border-slate-200 dark:border-slate-700 bg-transparent cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-9">
                          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                            Mô tả nhiệm vụ &amp; chỉ thị mặc định
                          </label>
                          <input
                            type="text"
                            value={agentDraftDesc}
                            onChange={(e) => setAgentDraftDesc(e.target.value)}
                            className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#131a35] text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div className="md:col-span-3">
                          <button
                            type="button"
                            onClick={() => handleSaveAgentEdit(ag.id)}
                            className="w-full h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                          >
                            Lưu thay đổi
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* =========================================================
          3. COMMUNICATION HUB (MULTI-CHANNEL SLACK/DISCORD STYLE)
         ========================================================= */}
      {subTab === 'chat' && state && (
        <CommunicationHub
          state={state}
          setState={setState}
          initialChannel={chatInitialChannel}
          onJumpToTask={() => setSubTab('tasks')}
          onJumpToScene={() => setSubTab('pipeline')}
        />
      )}

      {/* =========================================================
          6B. FAST COMMUNICATION & PERFORMANCE MONITOR
         ========================================================= */}
      {subTab === 'perf' && state && (
        <PerformanceMonitorTab state={state} sseConnected={sseConnected} />
      )}

      {/* =========================================================
          4. TASKS & MANUAL ASSIGNMENT
         ========================================================= */}
      {subTab === 'tasks' && (
        <div className="space-y-5">
          <form onSubmit={handleCreateManualTask} className="glass-card rounded-2xl p-5 space-y-3">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Giao việc thủ công cho Muse AI
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-3">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Giao cho</label>
                <select
                  value={manualAgentId}
                  onChange={(e) => setManualAgentId(e.target.value as MuseAgentId)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                >
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name} — {ag.roleTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Gắn phân cảnh (tùy chọn)
                </label>
                <select
                  value={manualSceneId}
                  onChange={(e) => setManualSceneId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Nhiệm vụ tự do</option>
                  {(memory?.scenes || []).map((sc) => (
                    <option key={sc.sceneId} value={sc.sceneId}>
                      Cảnh {sc.index}: {sc.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-6">
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Tiêu đề nhiệm vụ</label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="Ví dụ: Viết lại thoại Cảnh 2 tự nhiên hơn"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="md:col-span-10">
                <input
                  type="text"
                  value={manualInstructions}
                  onChange={(e) => setManualInstructions(e.target.value)}
                  placeholder="Chỉ thị chi tiết gửi cho AI thực hiện..."
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="w-full h-9 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Giao việc</span>
                </button>
              </div>
            </div>
          </form>

          <section className="glass-card rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                Danh sách nhiệm vụ &amp; hàng đợi Cloud
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {state?.tasks.length || 0} tác vụ
              </span>
            </div>

            {!state?.tasks.length ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có tác vụ nào trong hàng đợi.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-3 font-medium">Mã</th>
                      <th className="py-2 pr-3 font-medium">Phụ trách</th>
                      <th className="py-2 pr-3 font-medium">Nhiệm vụ</th>
                      <th className="py-2 pr-3 font-medium">Trạng thái</th>
                      <th className="py-2 pr-3 font-medium">Thực thi / Kết quả</th>
                      <th className="py-2 text-right font-medium">Điều khiển</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 dark:divide-slate-700/40">
                    {state.tasks.map((t) => {
                      const ag = agents.find((a) => a.id === t.assignedAgentId);
                      return (
                        <tr key={t.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.02]">
                          <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {t.code}
                          </td>
                          <td className="py-2.5 pr-3 whitespace-nowrap text-slate-800 dark:text-slate-100 font-medium">
                            {ag?.name || t.assignedAgentId}
                          </td>
                          <td className="py-2.5 pr-3 max-w-xs">
                            <div className="font-medium text-slate-900 dark:text-white truncate">{t.title}</div>
                            {t.dependsOnTaskIds.length > 0 && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                Phụ thuộc {t.dependsOnTaskIds.length} tác vụ tiền đề
                              </div>
                            )}
                          </td>
                          <td className={`py-2.5 pr-3 whitespace-nowrap font-semibold ${TASK_STATUS_TEXT_CLASS[t.status]}`}>
                            {TASK_STATUS_LABELS[t.status]}
                          </td>
                          <td className="py-2.5 pr-3 max-w-sm">
                            {t.error ? (
                              <div className="text-rose-600 dark:text-rose-400 line-clamp-2">{t.error}</div>
                            ) : (
                              <div className="text-slate-600 dark:text-slate-300 line-clamp-2">
                                {t.executedByProvider ? `[${t.executedByProvider}] ` : ''}
                                {t.outputText || '—'}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap space-x-1.5">
                            {(t.status === 'failed' || t.status === 'blocked_by_deps' || t.status === 'cancelled') && (
                              <button
                                type="button"
                                onClick={() =>
                                  runAction(`retry_${t.id}`, () =>
                                    apiJson<CommandCenterState>(`/api/command-center/tasks/${t.id}/retry`, {
                                      method: 'POST',
                                    })
                                  )
                                }
                                className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] cursor-pointer"
                              >
                                Chạy lại
                              </button>
                            )}
                            {(t.status === 'queued' || t.status === 'blocked_by_deps') && (
                              <button
                                type="button"
                                onClick={() =>
                                  runAction(`cancel_${t.id}`, () =>
                                    apiJson<CommandCenterState>(`/api/command-center/tasks/${t.id}/cancel`, {
                                      method: 'POST',
                                    })
                                  )
                                }
                                className="px-2 py-1 rounded border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-[11px] cursor-pointer"
                              >
                                Hủy
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* =========================================================
          5. PARALLEL PIPELINE & PROJECT MEMORY
         ========================================================= */}
      {subTab === 'pipeline' && memory && (
        <div className="space-y-5">
          {/* Project Memory Locked Bible */}
          <section className="glass-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/45 pb-3">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Project Memory — Bộ hồ sơ sản xuất trung tâm (v{memory.version})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mọi Muse AI đọc cùng một phiên bản dữ liệu chuẩn; chỉ Muse AI 01 (Tổng đạo diễn) hoặc người dùng mới được khóa thay đổi phiên bản.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Cập nhật bởi: {memory.updatedByAgentId} · {fmtDateTime(memory.updatedAt)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70">
                <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">Visual &amp; Ánh sáng</div>
                <div className="text-slate-600 dark:text-slate-300">{memory.visualBible || 'Chưa phân tích'}</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70">
                <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">Bối cảnh tổng thể</div>
                <div className="text-slate-600 dark:text-slate-300">{memory.settingBible || 'Chưa phân tích'}</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70">
                <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">Trang phục đồng bộ</div>
                <div className="text-slate-600 dark:text-slate-300">{memory.costumeBible || 'Chưa phân tích'}</div>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/70">
                <div className="font-semibold text-slate-800 dark:text-slate-100 mb-1">Quy chuẩn nối cảnh</div>
                <div className="text-slate-600 dark:text-slate-300">{memory.continuityBible || 'Chưa phân tích'}</div>
              </div>
            </div>

            {/* Characters 5-Part Sync */}
            {memory.characters.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Nhân vật đồng bộ 5 thành phần ({memory.characters.length})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {memory.characters.map((ch) => (
                    <div
                      key={ch.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] p-3 flex gap-3"
                    >
                      {ch.artifactUrl || ch.dataUrl ? (
                        <img
                          src={ch.artifactUrl || ch.dataUrl}
                          alt={ch.name}
                          className="w-16 h-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}
                      <div className="text-xs space-y-0.5 min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {ch.name} · {ch.ageGroup} · {ch.gender === 'female' ? 'Nữ' : 'Nam'}
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 line-clamp-1">1. Mặt: {ch.syncProfile.face}</div>
                        <div className="text-slate-600 dark:text-slate-300 line-clamp-1">2. Dáng: {ch.syncProfile.physique}</div>
                        <div className="text-slate-600 dark:text-slate-300 line-clamp-1">3. Đồ: {ch.syncProfile.costume}</div>
                        <div className="text-slate-600 dark:text-slate-300 line-clamp-1">4. Giọng: {ch.syncProfile.voice}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Parallel vs Sequential Scene DAG */}
          <section className="glass-card rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                Luồng phân cảnh song song &amp; kế thừa nối cảnh ({memory.scenes.length} cảnh)
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Song song tối đa {state?.cloudConfig.parallelLimit} luồng
              </span>
            </div>

            {memory.scenes.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có phân cảnh nào được bóc tách. Hãy gửi kịch bản ở tab Tổng quan.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {memory.scenes.map((sc) => (
                  <div
                    key={sc.sceneId}
                    className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">
                        Cảnh {sc.index}: {sc.title}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {sc.durationSec}s · QA: {sc.qaScore !== undefined ? `${sc.qaScore}/100` : sc.qaStatus}
                      </span>
                    </div>

                    <div className="text-[11px] text-violet-700 dark:text-violet-300">
                      {sc.continuityAnchorFromSceneId
                        ? `Nối tiếp tuần tự (kế thừa từ ${sc.continuityAnchorFromSceneId.replace('_', ' ')})`
                        : 'Phân cảnh độc lập — chạy song song được'}
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300">{sc.actionDetail}</p>
                    {sc.dialogue && (
                      <div className="text-xs text-slate-700 dark:text-slate-200 italic">
                        Thoại ({sc.speakerName || 'Nhân vật'}): &ldquo;{sc.dialogue}&rdquo;
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700/60 p-1.5 bg-slate-50 dark:bg-[#131a35]">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">Keyframe (Muse 03)</div>
                        {sc.keyframeImageUrl ? (
                          <img src={sc.keyframeImageUrl} alt={sc.title} className="w-full h-24 object-cover rounded" />
                        ) : (
                          <div className="h-24 flex items-center justify-center text-[11px] text-slate-400">Chưa tạo ảnh</div>
                        )}
                      </div>
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700/60 p-1.5 bg-slate-50 dark:bg-[#131a35]">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-1">Video (Muse 04)</div>
                        {sc.videoUrl ? (
                          <video src={sc.videoUrl} controls className="w-full h-24 rounded bg-black object-cover" />
                        ) : (
                          <div className="h-24 flex items-center justify-center text-[11px] text-slate-400">Chưa dựng video</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Project Memory Version History */}
            {memory.snapshots.length > 0 && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-700/45 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Lịch sử phiên bản Project Memory
                </div>
                <div className="space-y-1.5">
                  {memory.snapshots.slice(0, 6).map((snap) => (
                    <div
                      key={snap.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs py-1.5 px-3 rounded-lg bg-slate-50 dark:bg-[#0c1021] border border-slate-200/70 dark:border-slate-700/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-violet-600 dark:text-violet-300">
                          v{snap.version}
                        </span>
                        <span className="text-slate-700 dark:text-slate-200">{snap.summary}</span>
                        <span className="text-slate-400 font-mono">{fmtDateTime(snap.createdAt)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(`restore_mem_${snap.id}`, () =>
                            apiJson<CommandCenterState>(
                              `/api/command-center/project-memory/snapshots/${snap.id}/restore`,
                              { method: 'POST' }
                            )
                          )
                        }
                        className="text-xs text-cyan-600 dark:text-cyan-300 hover:underline cursor-pointer"
                      >
                        Khôi phục bản này
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* =========================================================
          6. QUALITY ASSURANCE (MUSE AI 05)
         ========================================================= */}
      {subTab === 'qa' && (
        <div className="space-y-5">
          <section className="glass-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Hệ thống AI Muse giám sát đồng nhất (Muse AI 05)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Kiểm định 8 tiêu chí so sánh liên cảnh. Khi không đạt ngưỡng, Muse 05 tự trả về đúng cảnh lỗi để tạo lại.
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                Ngưỡng duyệt: {state?.cloudConfig.qaPassThreshold}/100 · Tối đa sửa: {state?.cloudConfig.maxRetriesPerScene} lần/cảnh
              </div>
            </div>

            {!state?.qaReports.length ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có báo cáo kiểm định nào. Sau khi Muse AI 04 xuất video phân cảnh, Muse AI 05 sẽ tự động kiểm định tại đây.
              </div>
            ) : (
              <div className="space-y-4">
                {state.qaReports.map((rep) => {
                  const sc = memory?.scenes.find((s) => s.sceneId === rep.sceneId);
                  return (
                    <div
                      key={rep.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                          <span>Cảnh {rep.sceneIndex}: {sc?.title || rep.sceneId}</span>
                          <span aria-hidden="true">·</span>
                          <span className={`font-mono tabular-nums ${rep.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {rep.overallScore}/100 ({rep.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'})
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          Lần {rep.attemptNumber} · Mốc {rep.timestampRange} · {fmtDateTime(rep.checkedAt)}
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 dark:text-slate-200">{rep.summary}</p>
                      {rep.fixInstruction && (
                        <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5">
                          Yêu cầu sửa gửi {rep.targetFixAgentId}: {rep.fixInstruction}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                        {rep.criteriaResults.map((cr) => (
                          <div
                            key={cr.criterion}
                            className="rounded-lg border border-slate-200/80 dark:border-slate-700/50 p-2 bg-slate-50/70 dark:bg-[#131a35]/60"
                          >
                            <div className="flex items-center justify-between font-medium">
                              <span className="truncate text-slate-800 dark:text-slate-100">{cr.label.split(' (')[0]}</span>
                              <span className={`font-mono tabular-nums ${cr.passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {cr.score}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                              {cr.note}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/40">
                        <input
                          type="text"
                          value={qaFixInputs[rep.sceneId] || ''}
                          onChange={(e) => setQaFixInputs((p) => ({ ...p, [rep.sceneId]: e.target.value }))}
                          placeholder="Ghi chú sửa riêng cho cảnh này (nếu muốn tạo lại)..."
                          className="flex-1 min-w-[200px] h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#131a35] text-xs text-slate-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            runAction(`qa_reject_${rep.sceneId}`, () =>
                              apiJson<CommandCenterState>(`/api/command-center/qa/${rep.sceneId}/reject`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ instruction: qaFixInputs[rep.sceneId] }),
                              })
                            )
                          }
                          className="h-8 px-3 rounded-lg border border-rose-300 dark:border-rose-700/60 text-rose-700 dark:text-rose-300 text-xs font-medium cursor-pointer whitespace-nowrap"
                        >
                          Yêu cầu tạo lại cảnh này
                        </button>
                        {!rep.passed && (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(`qa_approve_${rep.sceneId}`, () =>
                                apiJson<CommandCenterState>(`/api/command-center/qa/${rep.sceneId}/approve`, {
                                  method: 'POST',
                                })
                              )
                            }
                            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                          >
                            Duyệt thủ công
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* =========================================================
          7. ACTIVITY LOGS & PROGRESS
         ========================================================= */}
      {subTab === 'logs' && (
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Nhật ký hoạt động toàn hệ thống
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={logAgentFilter}
                onChange={(e) => setLogAgentFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-700 dark:text-slate-200"
              >
                <option value="all">Tất cả Muse AI</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="system">Hệ thống Cloud</option>
              </select>
              <select
                value={logLevelFilter}
                onChange={(e) => setLogLevelFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-700 dark:text-slate-200"
              >
                <option value="all">Mọi mức độ</option>
                <option value="info">Thông tin</option>
                <option value="success">Hoàn thành</option>
                <option value="warn">Cảnh báo</option>
                <option value="error">Lỗi</option>
              </select>
            </div>
          </div>

          <div className="divide-y divide-slate-200/70 dark:divide-slate-700/40 max-h-[520px] overflow-y-auto text-xs">
            {filteredLogs.length === 0 ? (
              <div className="py-10 text-center text-slate-500 dark:text-slate-400">Chưa có nhật ký phù hợp bộ lọc.</div>
            ) : (
              filteredLogs.map((log) => (
                <div key={log.id} className="py-2.5 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="space-x-2">
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {fmtTime(log.timestamp)}
                    </span>
                    <span
                      className={`font-semibold ${
                        log.level === 'error'
                          ? 'text-rose-600 dark:text-rose-400'
                          : log.level === 'warn'
                          ? 'text-amber-600 dark:text-amber-400'
                          : log.level === 'success'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {log.action}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">{log.detail}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">{log.agentId || 'system'}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* =========================================================
          8. BACKUP & ARCHIVE SEARCH
         ========================================================= */}
      {subTab === 'backup' && (
        <div className="space-y-5">
          <form onSubmit={handleSearchArchive} className="glass-card rounded-2xl p-5 space-y-3">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
              Tìm kiếm kho lưu trữ hội thoại &amp; kết quả
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-5">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo nội dung hội thoại, prompt, mã tác vụ..."
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div className="md:col-span-2">
                <select
                  value={searchAgentId}
                  onChange={(e) => setSearchAgentId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                >
                  <option value="all">Tất cả Muse AI</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <input
                  type="date"
                  value={searchDateFrom}
                  onChange={(e) => setSearchDateFrom(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div className="md:col-span-2">
                <input
                  type="date"
                  value={searchDateTo}
                  onChange={(e) => setSearchDateTo(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div className="md:col-span-1">
                <button
                  type="submit"
                  className="w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center justify-center cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {searchResults && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700/45 space-y-2 text-xs">
                <div className="font-semibold text-slate-700 dark:text-slate-200">
                  Tìm thấy {searchResults.messages.length} hội thoại và {searchResults.tasks.length} tác vụ
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {searchResults.messages.map((m) => (
                    <div
                      key={m.id}
                      className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021]"
                    >
                      <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{m.senderName}</span>
                        <span className="font-mono">{fmtDateTime(m.createdAt)}</span>
                      </div>
                      <div className="mt-1 text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{m.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>

          <section className="glass-card rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Bản sao lưu thời gian thực (Backup Snapshots)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Lưu toàn bộ Project Memory, kịch bản, hội thoại 5 Muse AI và hàng đợi tác vụ để khôi phục khi gián đoạn.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  runAction(
                    'manual_backup_tab',
                    () =>
                      apiJson<CommandCenterState>('/api/command-center/backups', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({}),
                      }),
                    'Đã tạo bản sao lưu mới.'
                  )
                }
                className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                Tạo Backup thủ công
              </button>
            </div>

            {!state?.backups.length ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có bản sao lưu nào. Hệ thống sẽ tự động sao lưu theo mỗi mốc hoàn thành.
              </div>
            ) : (
              <div className="divide-y divide-slate-200/70 dark:divide-slate-700/40 text-xs">
                {state.backups.map((b) => (
                  <div key={b.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{b.summary}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {fmtDateTime(b.createdAt)} · Memory v{b.memoryVersion} · {b.messageCount} hội thoại · {b.taskCount} tác vụ
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`/api/command-center/backups/${encodeURIComponent(b.id)}/export`}
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Tải JSON
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            `restore_${b.id}`,
                            () =>
                              apiJson<CommandCenterState>(
                                `/api/command-center/backups/${encodeURIComponent(b.id)}/restore`,
                                { method: 'POST' }
                              ),
                            'Đã khôi phục trạng thái từ bản sao lưu.'
                          )
                        }
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                      >
                        Khôi phục
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* =========================================================
          9. CLOUD ORCHESTRATOR & MUSE2API ACCOUNT POOL
         ========================================================= */}
      {subTab === 'cloud' && (
        <div className="space-y-5">
          <form onSubmit={handleSaveCloudConfig} className="glass-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Cấu hình Cloud Server &amp; Bộ điều phối chạy nền
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Kết nối tới máy chủ Muse2API trên Cloud (HTTPS/VPS) để 5 Muse AI chạy liên tục ngay cả khi máy tính cá nhân đã tắt.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {state?.cloudConfig.isCloudEndpoint ? 'Cloud Endpoint' : 'Localhost Endpoint'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Địa chỉ máy chủ Muse2API (Cloud URL hoặc Local)
                </label>
                <input
                  type="url"
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                  placeholder="http://127.0.0.1:18610 hoặc https://muse-cloud.tenmien.com"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  MUSE2API_KEY {state?.cloudConfig.maskedMuse2ApiKey ? `(Hiện tại: ${state.cloudConfig.maskedMuse2ApiKey})` : ''}
                </label>
                <input
                  type="password"
                  value={cloudKey}
                  onChange={(e) => setCloudKey(e.target.value)}
                  placeholder="Để trống nếu giữ nguyên key hiện tại..."
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Số luồng song song tối đa
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={parallelLimit}
                  onChange={(e) => setParallelLimit(Number(e.target.value) || 2)}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Ngưỡng điểm QA đạt (50–98)
                </label>
                <input
                  type="number"
                  min={50}
                  max={98}
                  value={qaThreshold}
                  onChange={(e) => setQaThreshold(Number(e.target.value) || 80)}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Giới hạn sửa lại mỗi cảnh
                </label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value) || 2)}
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs font-mono tabular-nums text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-end pb-1.5">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBackup}
                    onChange={(e) => setAutoBackup(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Tự động backup thời gian thực</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
              >
                Lưu cấu hình Cloud &amp; Kiểm tra
              </button>
            </div>
          </form>

          {/* Muse2API Account Pool */}
          <section className="glass-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white">
                  Pool Tài khoản Muse.ai ({health?.accounts.length ?? 0} tài khoản)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mỗi Muse AI (01–05) có thể gắn riêng một tài khoản trong danh sách dưới đây hoặc xoay vòng tự động.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!health?.muse2ApiReachable && (
                  <button
                    type="button"
                    onClick={() =>
                      runAction('start_local_muse', async () => {
                        await apiJson('/api/muse2api/process/start', { method: 'POST' });
                        return fetchState(true);
                      })
                    }
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
                  >
                    Khởi chạy Muse2API trên máy chủ
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    runAction('keepalive_all', async () => {
                      await apiJson('/api/muse2api/accounts/keepalive', { method: 'POST' });
                      return fetchState(true);
                    })
                  }
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Gia hạn toàn bộ phiên
                </button>
              </div>
            </div>

            <form onSubmit={handleAddMuseAccount} className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <input
                type="text"
                value={newAccLabel}
                onChange={(e) => setNewAccLabel(e.target.value)}
                placeholder="Tên gợi nhớ (vd: Muse AI 01)"
                className="md:col-span-3 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              />
              <input
                type="text"
                value={newAccCookie}
                onChange={(e) => setNewAccCookie(e.target.value)}
                placeholder="Dán Cookie Header của muse.ai..."
                className="md:col-span-7 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs font-mono text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                className="md:col-span-2 h-9 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer"
              >
                Thêm tài khoản
              </button>
            </form>

            {health && health.accounts.length > 0 ? (
              <div className="divide-y divide-slate-200/70 dark:divide-slate-700/40 text-xs">
                {health.accounts.map((acc) => (
                  <div key={acc.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {acc.label} <span className="font-mono text-slate-400">({acc.id})</span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {acc.enabled ? 'Đang bật' : 'Đang tắt'} · {acc.ok === false ? `Lỗi: ${acc.error || acc.status}` : 'Sẵn sàng'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          runAction(`test_acc_${acc.id}`, async () => {
                            await apiJson(`/api/muse2api/accounts/${encodeURIComponent(acc.id)}/test`, {
                              method: 'POST',
                            });
                            return fetchState(true);
                          })
                        }
                        className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] cursor-pointer"
                      >
                        Kiểm tra
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(`del_acc_${acc.id}`, async () => {
                            await apiJson(`/api/muse2api/accounts/${encodeURIComponent(acc.id)}`, {
                              method: 'DELETE',
                            });
                            return fetchState(true);
                          })
                        }
                        className="px-2.5 py-1 rounded border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-[11px] cursor-pointer"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có tài khoản Muse.ai nào trong Pool Muse2API.
              </div>
            )}
          </section>
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
                  Phiên <strong>{confirmCancelRun.title}</strong> ({confirmCancelRun.id}) sẽ hủy các tác vụ đang chờ/đang chạy và lưu vào lịch sử. Cảnh đã hoàn thành và backup không bị xóa.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancelRun(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Giữ lại
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetId = confirmCancelRun.id;
                  setConfirmCancelRun(null);
                  await runAction(
                    'cancel_run',
                    () =>
                      apiJson<CommandCenterState>(`/api/command-center/productions/${targetId}/cancel`, {
                        method: 'POST',
                      }),
                    'Đã hủy các tác vụ đang chờ của phiên và giữ nguyên dữ liệu đã hoàn thành.'
                  );
                }}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
              >
                Xác nhận hủy phiên
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
