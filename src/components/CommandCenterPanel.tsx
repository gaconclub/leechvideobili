import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Link2,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Music,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { CommandCenterState } from '../types/commandCenter';
import type {
  AiEngineReadinessItem,
  CoordinationCenterState,
  CoordinationSession,
  CoordinationTaskRow,
  CoordinationTaskStatus,
  IndependentVideoSource,
} from '../types/coordinationCenter';
import {
  classifyGoogleAuthError,
  clearGoogleWorkspaceAccessToken,
  getGoogleWorkspaceAccessToken,
  initGoogleWorkspaceAuth,
  logoutGoogleWorkspace,
  signInGoogleWorkspace,
  type GoogleAuthErrorInfo,
} from '../lib/googleWorkspaceAuth';
import { AI_MUSIC_STYLE_OPTIONS } from './studio/studioConfig';

type CoordinationTab = 'hub' | 'meeting' | 'workspace';

interface CommandCenterPanelProps {
  onOpenSettings?: () => void;
  onOpenProductionMonitor?: () => void;
  isActiveTab?: boolean;
  liveState?: CommandCenterState | null;
  setLiveState?: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  liveLoading?: boolean;
  sseConnected?: boolean;
  onRefreshLive?: (forceHealth?: boolean) => Promise<CommandCenterState | null>;
  externalSubTabRequest?: { subTab: string; nonce: number } | null;
}

type WorkspaceConfirmAction =
  | {
      kind: 'init_workspace';
      title: string;
      description: string;
      details: string[];
      existingSpreadsheetId: string;
    }
  | {
      kind: 'sync_session';
      title: string;
      description: string;
      details: string[];
      sessionId: string;
    };

const INDEPENDENT_SOURCES: {
  id: IndependentVideoSource;
  name: string;
  tagline: string;
  rule: string;
}[] = [
  {
    id: 'gemini',
    name: 'Gemini AI',
    tagline: 'Ảnh Gemini + Video Omni Flash',
    rule: 'Chỉ dùng Gemini, không gọi Muse hay Qwen',
  },
  {
    id: 'qwen',
    name: 'AI Qwen (Alibaba)',
    tagline: 'Ảnh Qwen-Image + Video Wan',
    rule: 'Chỉ dùng Alibaba ModelStudio, không chồng lấn',
  },
  {
    id: 'muse',
    name: 'Muse AI (Muse2API)',
    tagline: 'Ảnh muse-image + Video muse-video',
    rule: 'Chỉ dùng Muse2API theo đúng bảng nhiệm vụ',
  },
  {
    id: 'google_flow',
    name: 'Google Flow (Veo)',
    tagline: 'Xuất prompt chuẩn + Nạp MP4 từng cảnh',
    rule: 'Tách biệt 100%, chờ bạn tải clip Flow lên',
  },
];

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

function fmtDateTime(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
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
        label: 'Chờ nhập Flow',
        cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
      };
    default:
      return {
        label: 'Chờ nhận',
        cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/30',
      };
  }
}

function readinessMeta(status: AiEngineReadinessItem['status']): {
  label: string;
  dot: string;
  badge: string;
} {
  switch (status) {
    case 'ready':
      return {
        label: 'Sẵn sàng',
        dot: 'bg-emerald-500',
        badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
      };
    case 'unconfigured':
      return {
        label: 'Chưa cấu hình',
        dot: 'bg-amber-500',
        badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
      };
    case 'error':
      return {
        label: 'Cảnh báo lỗi',
        dot: 'bg-rose-500',
        badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35',
      };
    default:
      return {
        label: 'Ngoại tuyến',
        dot: 'bg-slate-400',
        badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-400/30',
      };
  }
}

export const CommandCenterPanel: React.FC<CommandCenterPanelProps> = ({
  onOpenSettings,
  isActiveTab = true,
  externalSubTabRequest,
}) => {
  const [tab, setTab] = useState<CoordinationTab>('hub');
  const [state, setState] = useState<CoordinationCenterState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sseOnline, setSseOnline] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Google Workspace Auth state (in-memory token only)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(() => getGoogleWorkspaceAccessToken());
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [authErrorInfo, setAuthErrorInfo] = useState<GoogleAuthErrorInfo | null>(null);
  const [existingSheetInput, setExistingSheetInput] = useState('');
  const [confirmModal, setConfirmModal] = useState<WorkspaceConfirmAction | null>(null);
  const [liveSheetRows, setLiveSheetRows] = useState<{
    tasks: Record<string, string>[];
    references: Record<string, string>[];
  } | null>(null);

  // Quick manual session form
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [quickIdea, setQuickIdea] = useState('');
  const [quickSource, setQuickSource] = useState<IndependentVideoSource>('gemini');
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState('');

  // Meeting room state
  const [meetingScope, setMeetingScope] = useState<'active' | 'all'>('all');
  const [meetingInput, setMeetingInput] = useState('');
  const meetingEndRef = useRef<HTMLDivElement>(null);

  // Muse2API inline config state
  const [showMuseUrlEditor, setShowMuseUrlEditor] = useState(false);
  const [museUrlDraft, setMuseUrlDraft] = useState('');

  // Multi-script queue board filter & collapse state
  const [queueFilter, setQueueFilter] = useState<'all' | 'waiting' | 'done' | 'error'>('all');
  const [collapsedSessions, setCollapsedSessions] = useState<Record<string, boolean>>({});

  // Flow clip upload state (supports any session card directly)
  const flowUploadInputRef = useRef<HTMLInputElement>(null);
  const [flowUploadTarget, setFlowUploadTarget] = useState<{ sessionId: string; taskCode: string } | null>(null);
  const [copiedPromptCode, setCopiedPromptCode] = useState('');

  useEffect(() => {
    if (!externalSubTabRequest) return;
    if (externalSubTabRequest.subTab === 'chat') {
      setTab('meeting');
    } else if (externalSubTabRequest.subTab === 'workspace') {
      setTab('workspace');
    } else {
      setTab('hub');
    }
  }, [externalSubTabRequest]);

  // Listen to Firebase Google Auth state (token kept strictly in memory)
  useEffect(() => {
    const unsub = initGoogleWorkspaceAuth(
      (user, tok) => {
        setGoogleUser(user);
        setGoogleToken(tok);
        setAuthErrorInfo(null);
      },
      () => {
        setGoogleToken(null);
      }
    );
    return () => unsub();
  }, []);

  const refreshState = useCallback(async (forceHealth = false) => {
    try {
      const res = await fetch(`/api/coordination/state${forceHealth ? '?force=1' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CoordinationCenterState = await res.json();
      setState(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải dữ liệu Trung Tâm Điều Phối AI.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshState(false);
  }, [refreshState]);

  // Real-time SSE connection
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/coordination/events');
    es.onopen = () => setSseOnline(true);
    es.onerror = () => setSseOnline(false);
    es.addEventListener('state:sync', (ev) => {
      try {
        const next = JSON.parse((ev as MessageEvent).data) as CoordinationCenterState;
        setState(next);
        setLoading(false);
      } catch {
        // ignore malformed payload
      }
    });
    return () => {
      es.close();
      setSseOnline(false);
    };
  }, []);

  useEffect(() => {
    if (isActiveTab && !sseOnline) {
      void refreshState(false);
    }
  }, [isActiveTab, sseOnline, refreshState]);

  const activeSession: CoordinationSession | null = useMemo(() => {
    if (!state || state.sessions.length === 0) return null;
    return (
      state.sessions.find((s) => s.sessionId === state.activeSessionId) || state.sessions[0] || null
    );
  }, [state]);

  const visibleMessages = useMemo(() => {
    const all = state?.meetingMessages || [];
    if (meetingScope === 'all' || !activeSession) return all;
    return all.filter((m) => m.sessionId === activeSession.sessionId || m.sessionId === 'GLOBAL');
  }, [state?.meetingMessages, meetingScope, activeSession]);

  useEffect(() => {
    if (tab === 'meeting') {
      meetingEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tab, visibleMessages.length]);

  const apiCall = useCallback(
    async <T,>(url: string, init?: RequestInit, requireGoogleToken = false): Promise<T> => {
      const tok = googleToken || getGoogleWorkspaceAccessToken();
      if (requireGoogleToken && !tok) {
        throw new Error('Vui lòng đăng nhập bằng Google trước để thao tác với Google Sheets & Drive.');
      }
      const headers: Record<string, string> = {
        ...(init?.body && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Blob)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      };
      const res = await fetch(url, { ...init, headers });
      const data: any = await res.json().catch(() => ({}));
      if (res.status === 401 && requireGoogleToken) {
        clearGoogleWorkspaceAccessToken();
        setGoogleToken(null);
        throw new Error('Phiên Google đã hết hạn. Vui lòng bấm "Sign in with Google" để kết nối lại.');
      }
      if (!res.ok) {
        throw new Error(data?.error || `Thao tác thất bại (HTTP ${res.status})`);
      }
      if (data?.state) {
        setState(data.state);
      }
      return data as T;
    },
    [googleToken]
  );

  const handleGoogleSignIn = async () => {
    setIsGoogleSigningIn(true);
    setErrorMsg('');
    setAuthErrorInfo(null);
    try {
      const result = await signInGoogleWorkspace();
      if (result) {
        setGoogleUser(result.user);
        setGoogleToken(result.accessToken);
        setNotice(`Đã kết nối Google Workspace (${result.user.email || 'Google Account'}).`);
      }
    } catch (err: any) {
      const info = classifyGoogleAuthError(err);
      setAuthErrorInfo(info);
      setErrorMsg(info.message);
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await logoutGoogleWorkspace();
    setGoogleUser(null);
    setGoogleToken(null);
    setLiveSheetRows(null);
    setNotice('Đã đăng xuất khỏi Google Workspace.');
  };

  const handleCheckAllReadiness = async () => {
    setBusyAction('check_readiness');
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall('/api/coordination/readiness/check', { method: 'POST' });
      setNotice('Đã kiểm tra xong tình trạng sẵn sàng của toàn bộ các AI & FFmpeg.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể kiểm tra trạng thái AI.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    setErrorMsg('');
    try {
      const next = await apiCall<CoordinationCenterState>(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/select`,
        { method: 'POST' }
      );
      setState(next);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không chọn được phiên.');
    }
  };

  const handleSaveMuseUrl = async () => {
    setBusyAction('muse_config');
    setErrorMsg('');
    setNotice('');
    try {
      const res = await apiCall<{ status?: { ready?: boolean; reachable?: boolean; baseUrl?: string; error?: string } }>(
        '/api/muse2api/config',
        {
          method: 'POST',
          body: JSON.stringify({ baseUrl: museUrlDraft.trim() }),
        }
      );
      setShowMuseUrlEditor(false);
      if (res.status?.ready) {
        setNotice(`Đã kết nối thành công Muse AI (Muse2API) tại ${res.status.baseUrl}.`);
      } else if (res.status?.reachable) {
        setNotice(`Đã kết nối tới ${res.status.baseUrl} — cần thêm tài khoản Muse.ai trong Cài đặt AI.`);
      } else {
        setNotice(`Đã lưu địa chỉ Muse2API (${res.status?.baseUrl || museUrlDraft.trim()}) và kiểm tra lại kết nối.`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể lưu cấu hình Muse2API.');
    } finally {
      setBusyAction('');
    }
  };

  const handleStartLocalMuse2Api = async () => {
    setBusyAction('muse_start');
    setErrorMsg('');
    setNotice('');
    try {
      const res = await apiCall<{ ok?: boolean; message?: string }>('/api/muse2api/process/start', {
        method: 'POST',
      });
      setNotice(res.message || 'Đã kích hoạt dịch vụ Muse2API cục bộ và cập nhật trạng thái sẵn sàng.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tự khởi chạy Muse2API cục bộ.');
    } finally {
      setBusyAction('');
    }
  };

  const handleChangeSessionVideoSource = async (sessionId: string, videoSource: IndependentVideoSource) => {
    setBusyAction(`source_${sessionId}_${videoSource}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(sessionId)}/source`, {
        method: 'POST',
        body: JSON.stringify({ videoSource }),
      });
      setNotice(`Đã khóa nguồn sáng tạo video độc lập cho phiên ${sessionId}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể đổi nguồn video.');
    } finally {
      setBusyAction('');
    }
  };

  const handleChangeVideoSource = async (videoSource: IndependentVideoSource) => {
    if (!activeSession) return;
    await handleChangeSessionVideoSource(activeSession.sessionId, videoSource);
  };

  const handleQuickCreateSession = async () => {
    const cleanTitle = quickTitle.trim();
    const cleanIdea = quickIdea.trim();
    if (!cleanTitle && !cleanIdea) {
      setErrorMsg('Hãy nhập tên phiên hoặc mô tả kịch bản ngắn trước khi tạo.');
      return;
    }
    setBusyAction('quick_create');
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall('/api/coordination/sessions', {
        method: 'POST',
        body: JSON.stringify({
          title: cleanTitle || cleanIdea.slice(0, 60),
          ideaOrCommand: cleanIdea || cleanTitle,
          videoSource: quickSource,
          sourceAction: 'manual_order',
        }),
      });
      setQuickTitle('');
      setQuickIdea('');
      setShowQuickCreate(false);
      setNotice('Đã lập phiên mới với bảng nhiệm vụ tuần tự và khóa nguồn video độc lập.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạo phiên mới.');
    } finally {
      setBusyAction('');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setBusyAction(`del_${sessionId}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      setConfirmDeleteSessionId('');
      setNotice(`Đã xóa phiên ${sessionId} khỏi danh sách cục bộ.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể xóa phiên.');
    } finally {
      setBusyAction('');
    }
  };

  const handleStartSessionRun = async (sessionId: string, retryErrors = false) => {
    setBusyAction(retryErrors ? `retry_${sessionId}` : `run_${sessionId}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(sessionId)}/run`, {
        method: 'POST',
        body: JSON.stringify({ retryErrors }),
      });
      setNotice(
        retryErrors
          ? `Đang chạy lại các tác vụ lỗi của phiên ${sessionId} theo đúng thứ tự phụ thuộc.`
          : `Đã khởi động dây chuyền tuần tự cho phiên ${sessionId}.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chạy phiên.');
    } finally {
      setBusyAction('');
    }
  };

  const handleStartSequentialRun = async (retryErrors = false) => {
    if (!activeSession) return;
    await handleStartSessionRun(activeSession.sessionId, retryErrors);
  };

  const handleRunAllQueuedSessions = async () => {
    setBusyAction('run_all_queue');
    setErrorMsg('');
    setNotice('');
    try {
      const res = await apiCall<{ startedSessionIds?: string[]; queuedSessionIds?: string[] }>(
        '/api/coordination/queue/run-parallel',
        {
          method: 'POST',
          body: JSON.stringify({ retryErrors: false }),
        }
      );
      const count = res.startedSessionIds?.length || res.queuedSessionIds?.length || 0;
      setNotice(
        count > 0
          ? `Đã mở ${count} luồng chạy SONG SONG độc lập. Một phiên lỗi sẽ không làm dừng các phiên khác.`
          : 'Hiện không có kịch bản nào đang chờ chạy.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chạy song song hàng đợi kịch bản.');
    } finally {
      setBusyAction('');
    }
  };

  const handleAutoDistributeAndRun = async (includeErrorSessions = true) => {
    setBusyAction('distribute_run');
    setErrorMsg('');
    setNotice('');
    try {
      const res = await apiCall<{
        assignments?: Array<{ sessionId: string; videoSource: IndependentVideoSource }>;
        startedSessionIds?: string[];
        activeProviders?: IndependentVideoSource[];
      }>('/api/coordination/queue/distribute-run', {
        method: 'POST',
        body: JSON.stringify({ includeErrorSessions }),
      });
      const count = res.startedSessionIds?.length || res.assignments?.length || 0;
      const providersText = (res.activeProviders || []).join(', ');
      setNotice(
        count > 0
          ? `Đã tự động chia tải ${count} phiên sang các AI sẵn sàng (${providersText}) — giữ nguyên các Ảnh Bước 1 đã xong và kích hoạt chạy song song.`
          : 'Không có phiên chờ/lỗi nào cần chia tải lúc này.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chia tải đa luồng tự động.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRegenerateSceneImage = async (sessionId: string, sceneIndex: number) => {
    setBusyAction(`regen_${sessionId}_${sceneIndex}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/scenes/${sceneIndex}/regenerate-image`,
        {
          method: 'POST',
          body: JSON.stringify({ autoResumeVideo: true }),
        }
      );
      setNotice(
        `Đang tạo lại Ảnh Phân cảnh #${sceneIndex} (${sessionId}) và sẽ tự động tiếp tục bước Video → Ghép phim.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể tạo lại ảnh Phân cảnh #${sceneIndex}.`);
    } finally {
      setBusyAction('');
    }
  };

  const handleRetryTaskWithSource = async (
    sessionId: string,
    taskCode: string,
    overrideVideoSource: IndependentVideoSource
  ) => {
    setBusyAction(`retry_src_${sessionId}_${taskCode}_${overrideVideoSource}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskCode)}/retry`,
        {
          method: 'POST',
          body: JSON.stringify({
            overrideVideoSource,
            autoContinueSession: true,
          }),
        }
      );
      const srcName = INDEPENDENT_SOURCES.find((s) => s.id === overrideVideoSource)?.name || overrideVideoSource;
      setNotice(
        `Đã giữ nguyên Ảnh Bước 1, chuyển ${taskCode} (${sessionId}) sang ${srcName} và kích hoạt chạy lại ngay.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể đổi nguồn & chạy lại ${taskCode}.`);
    } finally {
      setBusyAction('');
    }
  };

  const handlePauseSession = async (sessionId: string) => {
    setBusyAction(`pause_${sessionId}`);
    setErrorMsg('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(sessionId)}/pause`, {
        method: 'POST',
      });
      setNotice(`Đã gửi lệnh tạm dừng phiên ${sessionId}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạm dừng.');
    } finally {
      setBusyAction('');
    }
  };

  const handlePauseRun = async () => {
    if (!activeSession) return;
    await handlePauseSession(activeSession.sessionId);
  };

  const handleRunSingleTaskForSession = async (sessionId: string, taskCode: string) => {
    setBusyAction(`task_${sessionId}_${taskCode}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskCode)}/run`,
        { method: 'POST' }
      );
      setNotice(`Đã thực thi xong tác vụ ${taskCode} (${sessionId}).`);
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể chạy tác vụ ${taskCode}.`);
    } finally {
      setBusyAction('');
    }
  };

  const handleTriggerFlowUpload = (sessionId: string, taskCode: string) => {
    setFlowUploadTarget({ sessionId, taskCode });
    flowUploadInputRef.current?.click();
  };

  const handleFlowFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !flowUploadTarget) return;
    const { sessionId, taskCode } = flowUploadTarget;
    setBusyAction(`flow_${sessionId}_${taskCode}`);
    setErrorMsg('');
    setNotice('');
    try {
      const buf = await file.arrayBuffer();
      await apiCall(
        `/api/coordination/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskCode)}/upload-flow`,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'video/mp4',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: buf,
        }
      );
      setNotice(`Đã nạp video Google Flow cho tác vụ ${taskCode} (${sessionId}).`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải video Google Flow lên.');
    } finally {
      setBusyAction('');
      setFlowUploadTarget(null);
    }
  };

  const handleCopyPrompt = async (code: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPromptCode(code);
      setTimeout(() => setCopiedPromptCode((c) => (c === code ? '' : c)), 2000);
    } catch {
      setErrorMsg('Không thể sao chép vào bộ nhớ tạm.');
    }
  };

  // Workspace mutating actions ALWAYS require explicit custom confirmation modal first
  const requestInitWorkspaceConfirm = () => {
    if (!googleToken) {
      setErrorMsg('Hãy đăng nhập bằng Google trước khi khởi tạo Google Sheets & Drive.');
      return;
    }
    const cleanInput = existingSheetInput.trim();
    setConfirmModal({
      kind: 'init_workspace',
      title: cleanInput
        ? 'Xác nhận liên kết Google Sheets hiện có?'
        : 'Xác nhận tạo mới Sổ Google Sheets & Thư mục Google Drive?',
      description: cleanInput
        ? 'Hệ thống sẽ kết nối tới tệp Google Sheets bạn cung cấp và bổ sung 4 trang tính điều phối (nếu chưa có) mà không xóa dữ liệu cũ.'
        : 'Hệ thống sẽ tạo thư mục gốc "Trung_Tam_Dieu_Phoi_AI" trên Google Drive và 1 tệp Google Sheets mới gồm 4 bảng chuẩn.',
      details: [
        'Tab 1: Phien_Lam_Viec (Thông tin phiên, nguồn AI độc lập, trạng thái)',
        'Tab 2: Du_Lieu_Tham_Chieu (Kịch bản, hồ sơ & link Drive ảnh nhân vật)',
        'Tab 3: Bang_Nhiem_Vu_AI (Thứ tự nhận việc, kết quả Drive, lý do lỗi)',
        'Tab 4: Phong_Hop_Tien_Do (Nhật ký báo cáo trực tiếp theo phiên)',
      ],
      existingSpreadsheetId: cleanInput,
    });
  };

  const requestSyncSessionConfirmFor = (targetSession: CoordinationSession | null) => {
    if (!targetSession) return;
    if (!googleToken) {
      setTab('workspace');
      setErrorMsg('Hãy bấm "Sign in with Google" trong tab Google Sheets & Drive để đồng bộ phiên này.');
      return;
    }
    setConfirmModal({
      kind: 'sync_session',
      title: `Xác nhận đồng bộ phiên ${targetSession.sessionId} lên Google Sheets & Drive?`,
      description: `Toàn bộ dữ liệu tham chiếu (${targetSession.references.length} mục), ${targetSession.tasks.length} tác vụ và tệp ảnh/video của phiên "${targetSession.title}" sẽ được tải lên Google Drive và cập nhật vào Sổ Google Sheets.`,
      details: [
        `Tạo/cập nhật thư mục phiên trên Drive: ${targetSession.sessionId} - ${targetSession.title}`,
        `Ghi đúng dòng theo khóa phiên ${targetSession.sessionId} — không ghi đè dữ liệu của các phiên khác`,
        'Cập nhật đầy đủ link Drive đầu vào/đầu ra và lý do lỗi (nếu có) để các AI đọc lại chính xác',
      ],
      sessionId: targetSession.sessionId,
    });
  };

  const requestSyncSessionConfirm = () => {
    requestSyncSessionConfirmFor(activeSession);
  };

  const executeConfirmedWorkspaceAction = async () => {
    const action = confirmModal;
    if (!action) return;
    setConfirmModal(null);
    setErrorMsg('');
    setNotice('');

    if (action.kind === 'init_workspace') {
      setBusyAction('init_workspace');
      try {
        await apiCall(
          '/api/coordination/workspace/init',
          {
            method: 'POST',
            body: JSON.stringify({
              existingSpreadsheetId: action.existingSpreadsheetId || undefined,
            }),
          },
          true
        );
        setExistingSheetInput('');
        setNotice('Đã khởi tạo & xác minh Sổ Google Sheets (4 bảng) cùng Thư mục Google Drive thành công.');
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể khởi tạo Google Sheets & Drive.');
      } finally {
        setBusyAction('');
      }
    } else if (action.kind === 'sync_session') {
      setBusyAction('sync_session');
      try {
        const res = await apiCall<{ uploadedFilesCount: number }>(
          `/api/coordination/sessions/${encodeURIComponent(action.sessionId)}/sync-workspace`,
          { method: 'POST' },
          true
        );
        setNotice(
          `Đã đồng bộ phiên ${action.sessionId} lên Google Sheets & tải ${res.uploadedFilesCount} tệp lên Google Drive.`
        );
      } catch (err: any) {
        setErrorMsg(err?.message || 'Đồng bộ Google Sheets & Drive thất bại.');
      } finally {
        setBusyAction('');
      }
    }
  };

  const handleLoadLiveSheets = async () => {
    if (!activeSession) return;
    setBusyAction('read_sheets');
    setErrorMsg('');
    try {
      const data = await apiCall<{
        tasks: Record<string, string>[];
        references: Record<string, string>[];
      }>(
        `/api/coordination/sessions/${encodeURIComponent(activeSession.sessionId)}/sheets-live`,
        { method: 'GET' },
        true
      );
      setLiveSheetRows(data);
      setNotice(`Đã đọc trực tiếp ${data.tasks.length} dòng tác vụ và ${data.references.length} mục tham chiếu từ Google Sheets.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể đọc dữ liệu từ Google Sheets.');
    } finally {
      setBusyAction('');
    }
  };

  const handleSendMeetingMessage = async (presetText?: string) => {
    const text = (presetText ?? meetingInput).trim();
    if (!text) return;
    const targetSessionId = meetingScope === 'active' && activeSession ? activeSession.sessionId : 'GLOBAL';
    setBusyAction('send_meeting');
    setErrorMsg('');
    try {
      await apiCall('/api/coordination/meeting', {
        method: 'POST',
        body: JSON.stringify({ sessionId: targetSessionId, content: text }),
      });
      if (!presetText) setMeetingInput('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể gửi tin nhắn trong Phòng họp.');
    } finally {
      setBusyAction('');
    }
  };

  const completedTasksCount = activeSession
    ? activeSession.tasks.filter((t) => t.status === 'HOAN_THANH').length
    : 0;
  const failedTasksCount = activeSession
    ? activeSession.tasks.filter((t) => t.status === 'LOI').length
    : 0;
  const totalTasksCount = activeSession ? activeSession.tasks.length : 0;
  const progressPct =
    totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;
  const isRunning = activeSession?.status === 'DANG_CHAY';

  const canTaskRunInSession = (session: CoordinationSession, task: CoordinationTaskRow): boolean => {
    if (task.status === 'DANG_LAM') return false;
    return task.dependsOnTaskCodes.every((depCode) => {
      const dep = session.tasks.find((t) => t.taskCode === depCode);
      return dep?.status === 'HOAN_THANH';
    });
  };

  const queuedSessionsCount = useMemo(() => {
    return (state?.sessions || []).filter((s) => s.status !== 'HOAN_THANH').length;
  }, [state?.sessions]);

  const filteredSessions = useMemo(() => {
    const all = state?.sessions || [];
    if (queueFilter === 'waiting') {
      return all.filter((s) => s.status === 'CHO_CHAY' || s.status === 'DANG_CHAY' || s.status === 'TAM_DUNG' || s.status === 'CHO_FLOW');
    }
    if (queueFilter === 'done') {
      return all.filter((s) => s.status === 'HOAN_THANH');
    }
    if (queueFilter === 'error') {
      return all.filter((s) => s.status === 'CO_LOI' || s.tasks.some((t) => t.status === 'LOI'));
    }
    return all;
  }, [state?.sessions, queueFilter]);

  return (
    <div className="space-y-4">
      <input
        ref={flowUploadInputRef}
        type="file"
        accept="video/*"
        onChange={handleFlowFileSelected}
        className="hidden"
      />

      {/* TOP HEADER BAR */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Trung Tâm Điều Phối AI
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-md border ${
                  sseOnline
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/25'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${sseOnline ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                <span>{sseOnline ? 'Trực tuyến' : 'Đang đồng bộ'}</span>
              </span>
              {state?.workspace?.spreadsheetUrl && (
                <a
                  href={state.workspace.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md hover:bg-emerald-500/20 transition"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  <span>Sổ Google Sheets</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Điều phối tuần tự theo phiên qua Google Sheets &amp; Google Drive · Nguồn sáng tạo video khóa độc lập, không chồng lấn nhiệm vụ.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {googleToken ? (
              <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span className="max-w-[160px] truncate font-medium">
                  {googleUser?.email || 'Đã kết nối Google'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleGoogleSignOut()}
                  title="Đăng xuất Google Workspace"
                  className="p-0.5 text-emerald-700/70 hover:text-rose-500 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isGoogleSigningIn}
                onClick={() => void handleGoogleSignIn()}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-white text-[#1f1f1f] border border-[#747775]/40 hover:bg-slate-50 shadow-sm text-xs font-semibold transition cursor-pointer disabled:opacity-60"
              >
                {isGoogleSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                ) : (
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
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
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                )}
                <span>Sign in with Google</span>
              </button>
            )}

            <button
              type="button"
              disabled={busyAction === 'check_readiness'}
              onClick={() => void handleCheckAllReadiness()}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'check_readiness' ? 'animate-spin' : ''}`} />
              <span>Kiểm tra toàn bộ AI</span>
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 transition cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Cài đặt AI</span>
              </button>
            )}
          </div>
        </div>

        {/* 3 Focused Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/80 dark:border-slate-400/15">
          {[
            { id: 'hub' as const, label: 'Trung tâm điều phối & Bảng nhiệm vụ', icon: Activity },
            {
              id: 'meeting' as const,
              label: `Phòng họp trực tiếp (${visibleMessages.length})`,
              icon: MessageSquare,
            },
            {
              id: 'workspace' as const,
              label: 'Sổ Google Sheets & Kho Drive',
              icon: FileSpreadsheet,
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  active
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {errorMsg && (
          <div className="flex items-start justify-between gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-200">
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div>{errorMsg}</div>
                {authErrorInfo?.code === 'unauthorized-domain' && (
                  <div className="text-[11px] opacity-90">
                    Thêm tên miền <code className="px-1 py-0.5 rounded bg-black/15">{authErrorInfo.currentHostname}</code> vào{' '}
                    <a
                      href={authErrorInfo.firebaseAuthSettingsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold"
                    >
                      Firebase Authorized Domains
                    </a>
                    .
                  </div>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setErrorMsg('')} className="p-0.5 cursor-pointer shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {notice && (
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{notice}</span>
            </span>
            <button type="button" onClick={() => setNotice('')} className="p-0.5 cursor-pointer shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {loading && !state ? (
        <div className="glass-card rounded-2xl p-10 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
          <span>Đang tải Trung Tâm Điều Phối AI...</span>
        </div>
      ) : null}

      {/* ======================================================== */}
      {/* TAB 1: TRUNG TÂM ĐIỀU PHỐI & BẢNG NHIỆM VỤ TUẦN TỰ       */}
      {/* ======================================================== */}
      {state && tab === 'hub' && (
        <div className="space-y-4">
          {/* 1. AI READINESS MATRIX */}
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Tình trạng sẵn sàng của các AI
                </h2>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Kiểm tra lần cuối: {fmtTime(state.readinessCheckedAt)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2.5">
              {state.readiness.map((item) => {
                const rm = readinessMeta(item.status);
                const isSelectedSource =
                  activeSession && item.independentSource && activeSession.videoSource === item.independentSource;
                const isMuseCard = item.id === 'muse';
                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition space-y-1.5 ${
                      isSelectedSource
                        ? 'border-cyan-500/60 bg-cyan-500/5 dark:bg-cyan-500/10'
                        : 'border-slate-200 dark:border-slate-400/20 bg-slate-50/80 dark:bg-[#0c1021]/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {item.name}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded border shrink-0 ${rm.badge}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${rm.dot}`} />
                        {rm.label}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{item.role}</div>
                    {item.accountSummary && (
                      <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300 truncate" title={item.accountSummary}>
                        {item.accountSummary}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {item.detail}
                    </p>

                    {isMuseCard && (
                      <div className="pt-1 border-t border-slate-200/70 dark:border-slate-400/15 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            disabled={busyAction === 'muse_start'}
                            onClick={() => void handleStartLocalMuse2Api()}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 cursor-pointer disabled:opacity-50"
                          >
                            {busyAction === 'muse_start' ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <Power className="w-2.5 h-2.5" />
                            )}
                            <span>Bật cục bộ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const urlMatch = (item.accountSummary || '').match(/https?:\/\/[^\s]+/);
                              if (!showMuseUrlEditor && urlMatch?.[0]) {
                                setMuseUrlDraft(urlMatch[0]);
                              }
                              setShowMuseUrlEditor((v) => !v);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-300/70 dark:hover:bg-white/15 cursor-pointer"
                          >
                            <Link2 className="w-2.5 h-2.5" />
                            <span>Đổi URL</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === 'check_readiness'}
                            onClick={() => void handleCheckAllReadiness()}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200/70 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-300/70 dark:hover:bg-white/15 cursor-pointer"
                          >
                            <RefreshCw className={`w-2.5 h-2.5 ${busyAction === 'check_readiness' ? 'animate-spin' : ''}`} />
                            <span>Kiểm tra</span>
                          </button>
                        </div>
                        {showMuseUrlEditor && (
                          <div className="space-y-1">
                            <input
                              type="url"
                              value={museUrlDraft}
                              onChange={(e) => setMuseUrlDraft(e.target.value)}
                              placeholder="http://127.0.0.1:18610"
                              className="w-full h-7 px-2 text-[10px] font-mono bg-white dark:bg-[#131a35] border border-slate-300 dark:border-slate-500/40 rounded text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                            />
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={busyAction === 'muse_config'}
                                onClick={() => void handleSaveMuseUrl()}
                                className="flex-1 h-6 rounded text-[10px] font-bold bg-cyan-600 text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                              >
                                {busyAction === 'muse_config' ? 'Đang kết nối...' : 'Lưu & kết nối'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowMuseUrlEditor(false)}
                                className="h-6 px-2 rounded text-[10px] bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 cursor-pointer"
                              >
                                Hủy
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. SESSION BAR + STRICT INDEPENDENT VIDEO SOURCE LOCK */}
          <div className="glass-card rounded-2xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Phiên làm việc ({state.sessions.length})
                </h2>
                {state.sessions.length > 0 && (
                  <select
                    value={activeSession?.sessionId || ''}
                    onChange={(e) => void handleSelectSession(e.target.value)}
                    aria-label="Chọn phiên làm việc"
                    className="h-8 px-2.5 text-xs font-semibold bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 max-w-[340px]"
                  >
                    {state.sessions.map((s) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {s.sessionId} · {s.title} ({s.scenes.length} cảnh)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickCreate((v) => !v)}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tạo phiên nhanh</span>
                </button>
                {activeSession &&
                  (confirmDeleteSessionId === activeSession.sessionId ? (
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDeleteSession(activeSession.sessionId)}
                        className="h-8 px-2.5 rounded-lg text-xs font-bold bg-rose-600 text-white cursor-pointer"
                      >
                        Xác nhận xóa
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSessionId('')}
                        className="h-8 px-2 rounded-lg text-xs bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => setConfirmDeleteSessionId(activeSession.sessionId)}
                      title="Xóa phiên khỏi bộ nhớ cục bộ"
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa phiên</span>
                    </button>
                  ))}
              </div>
            </div>

            {showQuickCreate && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0c1124] border border-cyan-500/30 space-y-2.5">
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  Lập phiên điều phối mới (hoặc đẩy kịch bản đầy đủ từ phòng Studio)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input
                    type="text"
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    placeholder="Tên phiên sản xuất..."
                    className="sm:col-span-4 h-9 px-2.5 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  />
                  <input
                    type="text"
                    value={quickIdea}
                    onChange={(e) => setQuickIdea(e.target.value)}
                    placeholder="Nội dung kịch bản / bối cảnh chính..."
                    className="sm:col-span-5 h-9 px-2.5 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  />
                  <select
                    value={quickSource}
                    onChange={(e) => setQuickSource(e.target.value as IndependentVideoSource)}
                    className="sm:col-span-3 h-9 px-2 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-lg text-slate-900 dark:text-white"
                  >
                    {INDEPENDENT_SOURCES.map((src) => (
                      <option key={src.id} value={src.id}>
                        Nguồn: {src.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAction === 'quick_create'}
                    onClick={() => void handleQuickCreateSession()}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold bg-cyan-600 text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                  >
                    {busyAction === 'quick_create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Tạo phiên</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(false)}
                    className="h-8 px-3 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-white/10 cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            )}

            {!activeSession ? (
              <div className="py-10 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
                <p className="font-semibold text-slate-700 dark:text-slate-200">
                  Chưa có phiên sản xuất nào được tiếp nhận.
                </p>
                <p>
                  Hãy vào <strong>Studio AI</strong>, tạo kịch bản và bấm <strong>Đẩy sang Trung tâm Điều phối AI</strong> — toàn bộ hồ sơ tham chiếu và bảng nhiệm vụ sẽ tự động lập phiên tại đây.
                </p>
              </div>
            ) : (
              <>
                {/* STRICT SINGLE-SOURCE SELECTOR */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                      <span>Nguồn sáng tạo video độc lập (chọn nguồn nào chỉ nguồn đó làm việc)</span>
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Phiên <strong className="font-mono text-slate-800 dark:text-slate-200">{activeSession.sessionId}</strong> · Tỷ lệ {activeSession.aspectRatio} · {activeSession.references.filter((r) => r.kind === 'character').length} nhân vật tham chiếu
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {INDEPENDENT_SOURCES.map((src) => {
                      const selected = activeSession.videoSource === src.id;
                      const engineStatus = state.readiness.find((r) => r.independentSource === src.id);
                      const rm = engineStatus ? readinessMeta(engineStatus.status) : null;
                      return (
                        <button
                          key={src.id}
                          type="button"
                          disabled={isRunning || busyAction.startsWith('source_')}
                          onClick={() => void handleChangeVideoSource(src.id)}
                          className={`text-left p-3 rounded-xl border transition cursor-pointer disabled:opacity-60 ${
                            selected
                              ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500/40'
                              : 'border-slate-200 dark:border-slate-400/20 bg-white/70 dark:bg-[#0d1327]/70 hover:border-cyan-400/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {src.name}
                            </span>
                            {selected ? (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-600 text-white rounded">
                                Đang khóa
                              </span>
                            ) : rm ? (
                              <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${rm.badge}`}>
                                {rm.label}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                            {src.tagline}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {src.rule}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* RUN CONTROL & GOOGLE SHEETS SYNC BAR */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-slate-400/15">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isRunning ? (
                      <button
                        type="button"
                        disabled={busyAction === 'start_run'}
                        onClick={() => void handleStartSequentialRun(false)}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-cyan-600 to-blue-600 hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                      >
                        {busyAction === 'start_run' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        <span>Chạy tuần tự theo Sổ Điều Phối</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyAction === 'pause_run'}
                        onClick={() => void handlePauseRun()}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-xs font-bold text-white bg-amber-600 hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                      >
                        <Pause className="w-4 h-4" />
                        <span>Tạm dừng an toàn</span>
                      </button>
                    )}

                    {failedTasksCount > 0 && !isRunning && (
                      <button
                        type="button"
                        disabled={busyAction === 'retry_run'}
                        onClick={() => void handleStartSequentialRun(true)}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-bold text-rose-700 dark:text-rose-200 bg-rose-500/15 border border-rose-500/35 hover:bg-rose-500/25 transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Chạy lại {failedTasksCount} tác vụ lỗi</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busyAction === 'sync_session'}
                      onClick={requestSyncSessionConfirm}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition cursor-pointer disabled:opacity-50"
                    >
                      {busyAction === 'sync_session' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CloudUpload className="w-3.5 h-3.5" />
                      )}
                      <span>Đồng bộ Google Sheets &amp; Drive</span>
                    </button>

                    {activeSession.driveFolderUrl && (
                      <a
                        href={activeSession.driveFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 h-9 px-3 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 transition"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                        <span>Thư mục Drive phiên</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>

                  {/* Progress summary */}
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="text-slate-600 dark:text-slate-300 font-semibold">
                      {completedTasksCount}/{totalTasksCount} tác vụ ({progressPct}%)
                    </span>
                    <div className="w-28 h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 3. MULTI-SCRIPT SEQUENTIAL TASK BOARD (ALL WAITING/ACTIVE/DONE SCRIPTS · GROUPED BY SCRIPT -> SCENE) */}
          {state.sessions.length > 0 && (
            <div className="glass-card rounded-2xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-400/15">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Bảng nhiệm vụ tuần tự · Tất cả kịch bản ({state.sessions.length})
                    </h2>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                      {queuedSessionsCount} đang chờ / chạy
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Chạy đa luồng SONG SONG giữa các phiên theo từng nguồn AI (Gemini / Qwen / Google Flow / Muse). Một phiên gặp sự cố không chặn các phiên khác.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[11px]">
                    {(
                      [
                        { id: 'all' as const, label: `Tất cả (${state.sessions.length})` },
                        { id: 'waiting' as const, label: `Chờ & Chạy (${queuedSessionsCount})` },
                        {
                          id: 'done' as const,
                          label: `Xong (${state.sessions.filter((s) => s.status === 'HOAN_THANH').length})`,
                        },
                        {
                          id: 'error' as const,
                          label: `Lỗi (${state.sessions.filter((s) => s.status === 'CO_LOI' || s.tasks.some((t) => t.status === 'LOI')).length})`,
                        },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setQueueFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                          queueFilter === f.id
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {queuedSessionsCount > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={busyAction === 'distribute_run'}
                        onClick={() => void handleAutoDistributeAndRun(true)}
                        title="Tự động phân bổ các phiên chờ/lỗi sang những nguồn AI đang sẵn sàng (giữ nguyên Ảnh Bước 1 đã hoàn thành) và chạy song song ngay"
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-cyan-600 text-white hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                      >
                        {busyAction === 'distribute_run' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Layers className="w-3.5 h-3.5" />
                        )}
                        <span>Chia tải AI &amp; Chạy song song</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyAction === 'run_all_queue'}
                        onClick={() => void handleRunAllQueuedSessions()}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-600 to-indigo-600 text-white hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                      >
                        {busyAction === 'run_all_queue' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        <span>Chạy song song ({queuedSessionsCount})</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {filteredSessions.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Không có kịch bản nào thuộc bộ lọc này.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredSessions.map((sess, sessIdx) => {
                    const isSelectedCard = activeSession?.sessionId === sess.sessionId;
                    const sessDone = sess.tasks.filter((t) => t.status === 'HOAN_THANH').length;
                    const sessErr = sess.tasks.filter((t) => t.status === 'LOI').length;
                    const sessRunning = sess.status === 'DANG_CHAY';
                    const sessPct =
                      sess.tasks.length > 0 ? Math.round((sessDone / sess.tasks.length) * 100) : 0;
                    const isCollapsed = Boolean(collapsedSessions[sess.sessionId]);
                    const statusBadge =
                      sess.status === 'HOAN_THANH'
                        ? { label: 'Hoàn thành', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35' }
                        : sess.status === 'DANG_CHAY'
                        ? { label: 'Đang chạy phiên', cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35' }
                        : sess.status === 'CO_LOI'
                        ? { label: `Có ${sessErr} lỗi`, cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35' }
                        : sess.status === 'CHO_FLOW'
                        ? { label: 'Chờ nạp Google Flow', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35' }
                        : sess.status === 'TAM_DUNG'
                        ? { label: 'Tạm dừng', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' }
                        : { label: 'Đang chờ đến phiên', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35' };

                    const finalTask = sess.tasks.find((t) => t.taskCode.endsWith('-FINAL'));
                    const sceneGroups = sess.scenes.map((sc) => {
                      const imgTask = sess.tasks.find(
                        (t) => t.taskCode.includes('-IMG-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
                      );
                      const vidTask = sess.tasks.find(
                        (t) => t.taskCode.includes('-VID-') && (t.sceneId === sc.sceneId || t.sceneIndex === sc.sceneIndex)
                      );
                      return { scene: sc, tasks: [imgTask, vidTask].filter(Boolean) as CoordinationTaskRow[] };
                    });
                    const mappedCodes = new Set(
                      [
                        ...sceneGroups.flatMap((g) => g.tasks.map((t) => t.taskCode)),
                        ...(finalTask ? [finalTask.taskCode] : []),
                      ]
                    );
                    const otherTasks = sess.tasks.filter((t) => !mappedCodes.has(t.taskCode));

                    const renderTaskTile = (task: CoordinationTaskRow) => {
                      const sm = taskStatusMeta(task.status);
                      const runnable = canTaskRunInSession(sess, task);
                      const isBusyThis =
                        busyAction === `task_${sess.sessionId}_${task.taskCode}` ||
                        busyAction === `flow_${sess.sessionId}_${task.taskCode}`;
                      const isImageOut =
                        task.localOutputUrl && /\.(png|jpe?g|webp)$/i.test(task.localOutputUrl);
                      const isVideoOut =
                        task.localOutputUrl && /\.(mp4|webm|mov)$/i.test(task.localOutputUrl);

                      return (
                        <div
                          key={task.taskCode}
                          className={`p-2.5 rounded-xl border transition space-y-2 ${
                            task.status === 'LOI'
                              ? 'border-rose-500/45 bg-rose-500/5'
                              : task.status === 'DANG_LAM'
                              ? 'border-cyan-500/55 bg-cyan-500/5'
                              : task.status === 'HOAN_THANH'
                              ? 'border-emerald-500/30 bg-emerald-500/5'
                              : 'border-slate-200 dark:border-slate-400/20 bg-white/80 dark:bg-[#0c1124]/90'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-900 dark:bg-white/10 text-white rounded">
                                  {task.taskCode}
                                </span>
                                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${sm.cls}`}>
                                  {task.status === 'DANG_LAM' && (
                                    <Loader2 className="w-2.5 h-2.5 inline mr-1 animate-spin" />
                                  )}
                                  {sm.label}
                                </span>
                                <span className="text-[11px] font-bold text-slate-900 dark:text-white">
                                  Bước {task.step}: {task.stepLabel}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-2.5 gap-y-0.5">
                                <span>
                                  AI: <strong className="text-slate-700 dark:text-slate-200">{task.assignedAiLabel}</strong>
                                </span>
                                {task.completedAt && <span>Xong {fmtTime(task.completedAt)}</span>}
                              </div>
                              {task.resultSummary && (
                                <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug">
                                  {task.resultSummary}
                                </p>
                              )}
                              {task.errorReason && (
                                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-700 dark:text-rose-200 space-y-2">
                                  <div>
                                    <strong>Lý do lỗi:</strong> {task.errorReason}
                                  </div>
                                  {task.taskCode.includes('-VID-') && !sessRunning && (
                                    <div className="pt-1.5 border-t border-rose-500/20 flex flex-wrap items-center gap-1.5">
                                      <span className="text-[10px] font-semibold text-rose-800 dark:text-rose-200">
                                        Đổi nguồn chạy lại Video (giữ ảnh B1):
                                      </span>
                                      {INDEPENDENT_SOURCES.map((src) => {
                                        const isSwitchBusy =
                                          busyAction === `retry_src_${sess.sessionId}_${task.taskCode}_${src.id}`;
                                        return (
                                          <button
                                            key={src.id}
                                            type="button"
                                            disabled={Boolean(busyAction)}
                                            onClick={() =>
                                              void handleRetryTaskWithSource(sess.sessionId, task.taskCode, src.id)
                                            }
                                            className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-[#131a35] border border-rose-400/45 text-slate-800 dark:text-slate-100 hover:border-cyan-500 hover:text-cyan-600 dark:hover:text-cyan-300 cursor-pointer disabled:opacity-50"
                                          >
                                            {isSwitchBusy ? '...' : src.name}
                                          </button>
                                        );
                                      })}
                                      {typeof task.sceneIndex === 'number' && task.sceneIndex >= 1 && (
                                        <button
                                          type="button"
                                          disabled={Boolean(busyAction)}
                                          onClick={() =>
                                            void handleRegenerateSceneImage(sess.sessionId, task.sceneIndex!)
                                          }
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-600 text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                                        >
                                          <ImageIcon className="w-3 h-3" />
                                          <span>Tạo lại ảnh phân cảnh</span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isImageOut && task.localOutputUrl && (
                                <a
                                  href={task.localOutputUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Xem ảnh kết quả"
                                  className="w-12 h-9 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-500/30 bg-black/20 shrink-0 block"
                                >
                                  <img src={task.localOutputUrl} alt={task.taskCode} className="w-full h-full object-cover" />
                                </a>
                              )}
                              {isVideoOut && task.localOutputUrl && (
                                <a
                                  href={task.localOutputUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                                >
                                  <Film className="w-3 h-3" />
                                  <span>Clip</span>
                                </a>
                              )}
                              {task.driveOutputUrl && (
                                <a
                                  href={task.driveOutputUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Drive</span>
                                </a>
                              )}
                              <button
                                type="button"
                                disabled={!runnable || isBusyThis || sessRunning}
                                onClick={() => void handleRunSingleTaskForSession(sess.sessionId, task.taskCode)}
                                title={
                                  runnable
                                    ? `Thực thi riêng ${task.taskCode}`
                                    : `Cần hoàn thành tiền đề: ${task.dependsOnTaskCodes.join(', ')}`
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-900 dark:bg-white/10 text-white hover:bg-cyan-600 transition cursor-pointer disabled:opacity-40"
                              >
                                {isBusyThis ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : task.status === 'LOI' || task.status === 'HOAN_THANH' ? (
                                  <RotateCcw className="w-3 h-3" />
                                ) : (
                                  <Play className="w-3 h-3" />
                                )}
                                <span>
                                  {task.status === 'LOI' ? 'Thử lại' : task.status === 'HOAN_THANH' ? 'Chạy lại' : 'Chạy'}
                                </span>
                              </button>
                            </div>
                          </div>

                          {task.status === 'CHO_NHAP_FLOW' && task.flowPrompt && (
                            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <span className="text-[10px] font-bold text-amber-800 dark:text-amber-200">
                                  Prompt Google Flow · {task.taskCode}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleCopyPrompt(`${sess.sessionId}:${task.taskCode}`, task.flowPrompt || '')}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-white dark:bg-[#131a35] border border-amber-500/40 text-amber-800 dark:text-amber-200 cursor-pointer"
                                  >
                                    {copiedPromptCode === `${sess.sessionId}:${task.taskCode}` ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-500" />
                                        <span>Đã chép</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Chép prompt</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusyThis}
                                    onClick={() => handleTriggerFlowUpload(sess.sessionId, task.taskCode)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-600 text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                                  >
                                    <Upload className="w-3 h-3" />
                                    <span>Tải MP4 Flow</span>
                                  </button>
                                </div>
                              </div>
                              <pre className="text-[10px] whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-200 max-h-28 overflow-y-auto bg-white/70 dark:bg-black/20 p-1.5 rounded">
                                {task.flowPrompt}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    };

                    return (
                      <div
                        key={sess.sessionId}
                        className={`rounded-2xl border overflow-hidden transition ${
                          isSelectedCard
                            ? 'border-cyan-500/60 bg-cyan-500/[0.03] dark:bg-cyan-500/[0.06]'
                            : 'border-slate-200 dark:border-slate-400/20 bg-slate-50/50 dark:bg-[#0b1022]/75'
                        }`}
                      >
                        {/* Script Header */}
                        <div className="p-3.5 bg-white/80 dark:bg-[#101731]/90 border-b border-slate-200/80 dark:border-slate-400/15 space-y-2.5">
                          <div className="flex flex-wrap items-start justify-between gap-2.5">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedSessions((prev) => ({
                                      ...prev,
                                      [sess.sessionId]: !prev[sess.sessionId],
                                    }))
                                  }
                                  className="p-1 rounded-lg hover:bg-slate-200/70 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 cursor-pointer"
                                  aria-label="Thu gọn / mở rộng kịch bản"
                                >
                                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </button>
                                <span className="px-2 py-0.5 text-[10px] font-mono font-extrabold bg-slate-900 dark:bg-cyan-500/20 text-white dark:text-cyan-200 rounded">
                                  Kịch bản #{sessIdx + 1} · {sess.sessionId}
                                </span>
                                <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${statusBadge.cls}`}>
                                  {sessRunning && <Loader2 className="w-2.5 h-2.5 inline mr-1 animate-spin" />}
                                  {statusBadge.label}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {sess.scenes.length} phân cảnh · {sess.aspectRatio} · {sessDone}/{sess.tasks.length} tác vụ ({sessPct}%)
                                </span>
                                {sess.musicConfig && sess.musicConfig.musicMode !== 'none' && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded border border-violet-400/35 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                                    <Music className="w-2.5 h-2.5" />
                                    {AI_MUSIC_STYLE_OPTIONS.find((o) => o.value === sess.musicConfig?.musicStyle)?.shortLabel || 'Nhạc nền AI'} · {Math.round((sess.musicConfig.musicVolume ?? 0.25) * 100)}%
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 pl-7">
                                <button
                                  type="button"
                                  onClick={() => void handleSelectSession(sess.sessionId)}
                                  className="text-left text-sm font-display font-bold text-slate-900 dark:text-white hover:text-cyan-600 dark:hover:text-cyan-300 cursor-pointer"
                                >
                                  {sess.title}
                                </button>
                                <span className="text-[11px] text-slate-400">· Tạo lúc {fmtDateTime(sess.createdAt)}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                              <select
                                value={sess.videoSource}
                                disabled={sessRunning}
                                onChange={(e) =>
                                  void handleChangeSessionVideoSource(
                                    sess.sessionId,
                                    e.target.value as IndependentVideoSource
                                  )
                                }
                                aria-label={`Nguồn video cho ${sess.sessionId}`}
                                className="h-8 px-2 text-[11px] font-semibold bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-lg text-slate-800 dark:text-slate-100 disabled:opacity-50"
                              >
                                {INDEPENDENT_SOURCES.map((src) => (
                                  <option key={src.id} value={src.id}>
                                    Nguồn: {src.name}
                                  </option>
                                ))}
                              </select>

                              {!sessRunning ? (
                                <button
                                  type="button"
                                  disabled={busyAction === `run_${sess.sessionId}`}
                                  onClick={() => void handleStartSessionRun(sess.sessionId, false)}
                                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold bg-cyan-600 text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                                >
                                  {busyAction === `run_${sess.sessionId}` ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Play className="w-3.5 h-3.5" />
                                  )}
                                  <span>Chạy kịch bản</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busyAction === `pause_${sess.sessionId}`}
                                  onClick={() => void handlePauseSession(sess.sessionId)}
                                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold bg-amber-600 text-white hover:brightness-110 cursor-pointer"
                                >
                                  <Pause className="w-3.5 h-3.5" />
                                  <span>Tạm dừng</span>
                                </button>
                              )}

                              {sessErr > 0 && !sessRunning && (
                                <button
                                  type="button"
                                  disabled={busyAction === `retry_${sess.sessionId}`}
                                  onClick={() => void handleStartSessionRun(sess.sessionId, true)}
                                  className="inline-flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-200 border border-rose-500/35 hover:bg-rose-500/25 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Thử lại ({sessErr})</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => requestSyncSessionConfirmFor(sess)}
                                title="Đồng bộ kịch bản này lên Google Sheets & Drive"
                                className="inline-flex items-center gap-1 h-8 px-2 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 cursor-pointer"
                              >
                                <CloudUpload className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Sheets</span>
                              </button>
                            </div>
                          </div>

                          {/* Script progress bar */}
                          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                sessErr > 0
                                  ? 'bg-gradient-to-r from-cyan-500 to-rose-500'
                                  : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
                              }`}
                              style={{ width: `${sessPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Grouped Scenes & Final Assembly */}
                        {!isCollapsed && (
                          <div className="p-3.5 space-y-3">
                            {otherTasks.length > 0 && (
                              <div className="space-y-1.5">
                                {otherTasks.map((t) => renderTaskTile(t))}
                              </div>
                            )}

                            {sceneGroups.map(({ scene, tasks }) => {
                              const sceneAllDone = tasks.length > 0 && tasks.every((t) => t.status === 'HOAN_THANH');
                              const sceneHasErr = tasks.some((t) => t.status === 'LOI');
                              const sceneRunning = tasks.some((t) => t.status === 'DANG_LAM');
                              return (
                                <div
                                  key={`${sess.sessionId}_${scene.sceneId}_${scene.sceneIndex}`}
                                  className={`rounded-xl border p-3 space-y-2.5 ${
                                    sceneHasErr
                                      ? 'border-rose-500/40 bg-rose-500/[0.04]'
                                      : sceneRunning
                                      ? 'border-cyan-500/45 bg-cyan-500/[0.04]'
                                      : sceneAllDone
                                      ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
                                      : 'border-slate-200/90 dark:border-slate-400/20 bg-white/60 dark:bg-[#0d1328]/70'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                                      <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-violet-600/15 text-violet-700 dark:text-violet-300 border border-violet-500/30">
                                        Phân cảnh #{scene.sceneIndex}
                                      </span>
                                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                        {scene.title}
                                      </span>
                                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                        ({scene.durationSec}s)
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {!sessRunning && tasks.some((t) => t.taskCode.includes('-IMG-')) && (
                                        <button
                                          type="button"
                                          disabled={busyAction === `regen_${sess.sessionId}_${scene.sceneIndex}`}
                                          onClick={() => void handleRegenerateSceneImage(sess.sessionId, scene.sceneIndex)}
                                          title="Tạo lại Ảnh phân cảnh Bước 1 (khi gặp mâu thuẫn khóa nhân vật / logic hành động) và tự động chạy tiếp Video → Ghép phim"
                                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer disabled:opacity-50 ${
                                            sceneHasErr
                                              ? 'bg-amber-600 text-white border-amber-500 hover:brightness-110'
                                              : 'bg-white dark:bg-[#131a35] text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-300'
                                          }`}
                                        >
                                          {busyAction === `regen_${sess.sessionId}_${scene.sceneIndex}` ? (
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                          ) : (
                                            <RefreshCw className="w-3 h-3" />
                                          )}
                                          <span>Tạo lại ảnh &amp; Chạy tiếp</span>
                                        </button>
                                      )}
                                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                        {sceneAllDone
                                          ? '✓ Hoàn thành phân cảnh'
                                          : sceneRunning
                                          ? 'Đang sản xuất phân cảnh...'
                                          : sceneHasErr
                                          ? 'Có lỗi trong phân cảnh'
                                          : 'Chờ đến lượt'}
                                      </span>
                                    </div>
                                  </div>

                                  {(scene.actionDetail || scene.dialogue) && (
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                                      {scene.actionDetail}
                                      {scene.dialogue ? ` · Thoại: "${scene.dialogue}"` : ''}
                                    </p>
                                  )}

                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                    {tasks.map((t) => renderTaskTile(t))}
                                  </div>
                                </div>
                              );
                            })}

                            {/* Final MP4 Assembly Row */}
                            {finalTask && (
                              <div className="pt-1 border-t border-dashed border-slate-300/70 dark:border-slate-600/40 space-y-2.5">
                                {renderTaskTile(finalTask)}
                                {sess.finalVideoLocalUrl && (
                                  <div className="p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/30 space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-emerald-800 dark:text-emerald-200 inline-flex items-center gap-1.5">
                                        <Film className="w-4 h-4" />
                                        <span>Phim MP4 hoàn chỉnh · {sess.title}</span>
                                      </span>
                                      <div className="flex items-center gap-2">
                                        <a
                                          href={sess.finalVideoLocalUrl}
                                          download={`${sess.sessionId}.mp4`}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white hover:brightness-110"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                          <span>Tải MP4</span>
                                        </a>
                                        {sess.finalVideoDriveUrl && (
                                          <a
                                            href={sess.finalVideoDriveUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                                          >
                                            <ExternalLink className="w-3 h-3" />
                                            <span>Google Drive</span>
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                    <video
                                      src={sess.finalVideoLocalUrl}
                                      controls
                                      className="w-full max-h-[340px] rounded-lg bg-black"
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: PHÒNG HỌP TRỰC TIẾP (LIVE WAR ROOM)               */}
      {/* ======================================================== */}
      {state && tab === 'meeting' && (
        <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-400/15">
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                <MessageSquare className="w-4 h-4 text-cyan-500" />
                <span>Phòng họp trực tiếp — Trao đổi &amp; Điều phối thực thi</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35">
                  AI có quyền thực thi trực tiếp
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Điều phối viên AI có toàn quyền thực thi trực tiếp trên Sổ Điều Phối: đổi nguồn AI, chia tải chạy đa luồng song song, chạy lại Video giữ Ảnh Bước 1, tạo lại ảnh phân cảnh và tạm dừng phiên.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setMeetingScope('active')}
                className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                  meetingScope === 'active'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
                }`}
              >
                Phiên hiện tại
              </button>
              <button
                type="button"
                onClick={() => setMeetingScope('all')}
                className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                  meetingScope === 'all'
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300'
                }`}
              >
                Tất cả phiên
              </button>
            </div>
          </div>

          {/* Quick executive commands for AI Coordinator */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busyAction === 'send_meeting'}
              onClick={() =>
                void handleSendMeetingMessage(
                  'Hãy tự động chia tải toàn bộ các phiên đang chờ và đang lỗi sang các nguồn AI đang sẵn sàng (Gemini, Qwen, Google Flow — giữ nguyên các Ảnh Bước 1 đã hoàn thành) rồi kích hoạt chạy SONG SONG đa luồng ngay lập tức.'
                )
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35 cursor-pointer disabled:opacity-50"
            >
              <Layers className="w-3 h-3" />
              <span>Lệnh AI: Chia tải &amp; Chạy song song ngay</span>
            </button>
            <button
              type="button"
              disabled={busyAction === 'send_meeting'}
              onClick={() =>
                void handleSendMeetingMessage(
                  'Kiểm tra tất cả phiên đang lỗi ở Bước 2 Video, giữ nguyên Ảnh Bước 1 đã hoàn thành, chuyển bước Video lỗi sang nguồn khỏe hơn (Gemini hoặc Google Flow) và chạy lại ngay.'
                )
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-200 border border-amber-500/35 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Lệnh AI: Cứu phiên lỗi Video (giữ ảnh B1)</span>
            </button>
            <button
              type="button"
              disabled={busyAction === 'send_meeting'}
              onClick={() =>
                void handleSendMeetingMessage(
                  'Báo cáo tổng quan tất cả kịch bản đang chờ/đang chạy, các luồng song song hiện tại và tình trạng kết nối Gemini, Qwen, Muse AI.'
                )
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-cyan-500/15 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3 text-cyan-500" />
              <span>Báo cáo tiến độ &amp; luồng AI</span>
            </button>
            {activeSession && failedTasksCount > 0 && !isRunning && (
              <button
                type="button"
                onClick={() => void handleStartSequentialRun(true)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border border-rose-500/30 cursor-pointer"
              >
                Thử lại {failedTasksCount} tác vụ lỗi
              </button>
            )}
          </div>

          {/* Messages feed */}
          <div className="h-[420px] overflow-y-auto space-y-2.5 p-3 rounded-xl bg-slate-50/90 dark:bg-[#090d1c] border border-slate-200 dark:border-slate-400/15">
            {visibleMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-xs text-slate-500 dark:text-slate-400 px-4">
                <Sparkles className="w-6 h-6 text-cyan-500 opacity-80" />
                <p className="font-semibold text-slate-700 dark:text-slate-200">
                  Điều phối viên AI đã sẵn sàng trao đổi trực tiếp!
                </p>
                <p className="max-w-md">
                  Bạn có thể nhắn tin hỏi tiến độ từng kịch bản/phân cảnh, phân tích nguyên nhân lỗi, hoặc thảo luận phương án điều phối ngay bên dưới.
                </p>
              </div>
            ) : (
              visibleMessages.map((msg) => {
                const isUser = msg.kind === 'user';
                const isErr = msg.kind === 'error';
                const isDone = msg.kind === 'completed' || msg.kind === 'sync';
                return (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-xl border text-xs space-y-1 ${
                      isUser
                        ? 'ml-8 bg-cyan-600/10 border-cyan-500/35'
                        : isErr
                        ? 'mr-4 bg-rose-500/10 border-rose-500/35'
                        : isDone
                        ? 'mr-4 bg-emerald-500/5 border-emerald-500/30'
                        : 'mr-4 bg-white dark:bg-[#111830] border-slate-200 dark:border-slate-400/20'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <strong className="text-slate-900 dark:text-white">{msg.senderName}</strong>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-200/80 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                          {msg.senderRole}
                        </span>
                        {msg.taskCode && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-900 dark:bg-cyan-500/20 text-white dark:text-cyan-200">
                            {msg.taskCode}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {msg.sessionId} · {fmtTime(msg.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-100 leading-relaxed">
                      {msg.content}
                    </p>
                    {msg.referenceLink && (
                      <a
                        href={msg.referenceLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-600 dark:text-cyan-300 hover:underline pt-0.5"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Mở liên kết kết quả / Sổ Sheets</span>
                      </a>
                    )}
                  </div>
                );
              })
            )}
            {busyAction === 'send_meeting' && (
              <div className="mr-4 p-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 text-xs flex items-center gap-2 text-cyan-700 dark:text-cyan-300">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Điều phối viên AI đang đọc sổ tiến độ và trả lời bạn...</span>
              </div>
            )}
            <div ref={meetingEndRef} />
          </div>

          {/* Chat Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendMeetingMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={meetingInput}
              onChange={(e) => setMeetingInput(e.target.value)}
              placeholder="Nhắn tin trao đổi trực tiếp với Điều phối viên AI (hỏi tiến độ, phân cảnh, lỗi AI, kịch bản...)..."
              className="flex-1 h-10 px-3 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={!meetingInput.trim() || busyAction === 'send_meeting'}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-xs font-bold bg-cyan-600 text-white hover:brightness-110 transition cursor-pointer disabled:opacity-50"
            >
              {busyAction === 'send_meeting' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>Gửi AI</span>
            </button>
          </form>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: SỔ GOOGLE SHEETS & KHO THAM CHIẾU GOOGLE DRIVE    */}
      {/* ======================================================== */}
      {state && tab === 'workspace' && (
        <div className="space-y-4">
          <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
                  <span>Kết nối Sổ Google Sheets &amp; Thư mục Google Drive</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mọi kịch bản, ảnh nhân vật tham chiếu, trạng thái tác vụ và video kết quả đều lưu tập trung trên Google Sheets &amp; Drive của bạn để các AI truy xuất đúng phiên.
                </p>
              </div>
            </div>

            {!googleToken ? (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#0c1124] border border-slate-200 dark:border-slate-400/20 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-slate-900 dark:text-white">
                    Chưa đăng nhập Google Workspace
                  </div>
                  <div className="text-slate-600 dark:text-slate-400">
                    Đăng nhập bằng tài khoản Google để tạo Sổ Điều Phối 4 bảng và lưu tệp tham chiếu/kết quả lên Google Drive.
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isGoogleSigningIn}
                  onClick={() => void handleGoogleSignIn()}
                  className="inline-flex items-center gap-2.5 h-10 px-4 rounded-xl bg-white text-[#1f1f1f] border border-[#747775]/45 hover:bg-slate-50 shadow-sm text-xs font-semibold transition cursor-pointer"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
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
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>Sign in with Google</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0c1124] border border-slate-200 dark:border-slate-400/20 space-y-1.5 text-xs">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Tệp Google Sheets Điều Phối (4 bảng chuẩn)
                    </div>
                    {state.workspace.spreadsheetUrl ? (
                      <a
                        href={state.workspace.spreadsheetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-300 hover:underline"
                      >
                        <FileSpreadsheet className="w-4 h-4 shrink-0" />
                        <span className="truncate">{state.workspace.spreadsheetTitle || state.workspace.spreadsheetId}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    ) : (
                      <div className="text-amber-600 dark:text-amber-300 font-medium">
                        Chưa khởi tạo tệp Google Sheets.
                      </div>
                    )}
                    <div className="text-[11px] text-slate-500">
                      Đồng bộ gần nhất: {fmtDateTime(state.workspace.lastSyncedAt)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#0c1124] border border-slate-200 dark:border-slate-400/20 space-y-1.5 text-xs">
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Thư mục Google Drive gốc
                    </div>
                    {state.workspace.rootFolderUrl ? (
                      <a
                        href={state.workspace.rootFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300 hover:underline"
                      >
                        <FolderOpen className="w-4 h-4 shrink-0" />
                        <span className="truncate">{state.workspace.rootFolderName || 'Trung_Tam_Dieu_Phoi_AI'}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    ) : (
                      <div className="text-slate-500">Sẽ tự động tạo khi khởi tạo Sổ Google Sheets.</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={existingSheetInput}
                    onChange={(e) => setExistingSheetInput(e.target.value)}
                    placeholder="Để trống để tạo Sheets mới, hoặc dán link/ID Google Sheets có sẵn..."
                    className="flex-1 min-w-[240px] h-9 px-3 text-xs bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={busyAction === 'init_workspace'}
                    onClick={requestInitWorkspaceConfirm}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                  >
                    {busyAction === 'init_workspace' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                    )}
                    <span>{existingSheetInput.trim() ? 'Kết nối Sheets này' : 'Tạo mới Sổ Sheets & Drive'}</span>
                  </button>
                  {activeSession && (
                    <>
                      <button
                        type="button"
                        disabled={busyAction === 'sync_session'}
                        onClick={requestSyncSessionConfirm}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold bg-cyan-600 text-white hover:brightness-110 transition cursor-pointer disabled:opacity-50"
                      >
                        <CloudUpload className="w-3.5 h-3.5" />
                        <span>Đồng bộ phiên hiện tại</span>
                      </button>
                      {state.workspace.spreadsheetId && (
                        <button
                          type="button"
                          disabled={busyAction === 'read_sheets'}
                          onClick={() => void handleLoadLiveSheets()}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'read_sheets' ? 'animate-spin' : ''}`} />
                          <span>Đọc trực tiếp từ Sheets</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ACTIVE SESSION REFERENCE REPOSITORY (Du_Lieu_Tham_Chieu) */}
          {activeSession && (
            <div className="glass-card rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-violet-500" />
                  <span>Kho dữ liệu tham chiếu · Phiên {activeSession.sessionId} ({activeSession.references.length} mục)</span>
                </h3>
                {activeSession.driveFolderUrl && (
                  <a
                    href={activeSession.driveFolderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-600 dark:text-cyan-300 hover:underline"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Mở thư mục Drive của phiên</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {activeSession.references.map((ref) => {
                  const isImg = ref.localUrl && /\.(png|jpe?g|webp)$/i.test(ref.localUrl);
                  return (
                    <div
                      key={ref.refId}
                      className="flex gap-2.5 p-2.5 rounded-xl border border-slate-200 dark:border-slate-400/20 bg-slate-50/80 dark:bg-[#0c1124]/80"
                    >
                      {isImg && ref.localUrl ? (
                        <img
                          src={ref.localUrl}
                          alt={ref.name}
                          className="w-14 h-14 rounded-lg object-cover bg-slate-200 dark:bg-slate-800 shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-violet-500/10 border border-violet-500/25 flex items-center justify-center shrink-0 text-[10px] font-mono font-bold text-violet-600 dark:text-violet-300">
                          {ref.kind === 'script' ? 'JSON' : 'BIBLE'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1 space-y-1 text-[11px]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-slate-900 dark:text-white truncate">{ref.name}</span>
                          <span className="font-mono text-[9px] px-1 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 shrink-0">
                            {ref.refId}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600 dark:text-slate-400 line-clamp-2">{ref.detail}</p>
                        <div className="flex items-center gap-2 pt-0.5">
                          {ref.driveUrl ? (
                            <a
                              href={ref.driveUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                              <ExternalLink className="w-2.5 h-2.5" />
                              <span>Đã lưu Drive</span>
                            </a>
                          ) : (
                            <span className="text-[10px] text-slate-400">Lưu cục bộ (chưa đồng bộ Drive)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LIVE GOOGLE SHEETS VERIFICATION TABLE */}
          {liveSheetRows && (
            <div className="glass-card rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Dữ liệu đọc trực tiếp từ Google Sheets ({liveSheetRows.tasks.length} dòng tác vụ)
                </h3>
                <button
                  type="button"
                  onClick={() => setLiveSheetRows(null)}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Đóng bảng xem
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-400/20 text-slate-500 dark:text-slate-400">
                      <th className="py-1.5 pr-3">Mã tác vụ</th>
                      <th className="py-1.5 pr-3">Nguồn khóa</th>
                      <th className="py-1.5 pr-3">Trạng thái</th>
                      <th className="py-1.5 pr-3">Kết quả / Drive</th>
                      <th className="py-1.5">Lý do lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveSheetRows.tasks.map((row, idx) => (
                      <tr key={idx} className="border-b border-slate-200/60 dark:border-slate-400/10">
                        <td className="py-1.5 pr-3 font-mono font-bold text-slate-900 dark:text-white">
                          {row.task_code}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-300">{row.nguon_ai_khoa}</td>
                        <td className="py-1.5 pr-3 font-semibold">{row.trang_thai}</td>
                        <td className="py-1.5 pr-3">
                          {row.drive_output_url ? (
                            <a
                              href={row.drive_output_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-600 dark:text-cyan-300 underline"
                            >
                              Mở Drive
                            </a>
                          ) : (
                            <span className="text-slate-400">{row.ket_qua_tom_tat?.slice(0, 60) || '—'}</span>
                          )}
                        </td>
                        <td className="py-1.5 text-rose-600 dark:text-rose-300">{row.ly_do_loi || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MANDATORY USER CONFIRMATION MODAL FOR GOOGLE SHEETS & DRIVE WRITES */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#111830] border border-slate-200 dark:border-slate-400/25 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {confirmModal.title}
              </h3>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                aria-label="Đóng hộp thoại"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {confirmModal.description}
            </p>
            <ul className="space-y-1.5 text-[11px] text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-black/25 p-3 rounded-xl border border-slate-200 dark:border-slate-400/15">
              {confirmModal.details.map((line, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="h-9 px-4 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/15 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void executeConfirmedWorkspaceAction()}
                className="h-9 px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:brightness-110 cursor-pointer"
              >
                Xác nhận thực hiện
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
