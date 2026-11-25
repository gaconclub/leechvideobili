import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
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
  const [meetingScope, setMeetingScope] = useState<'active' | 'all'>('active');
  const [meetingInput, setMeetingInput] = useState('');
  const meetingEndRef = useRef<HTMLDivElement>(null);

  // Flow clip upload state
  const flowUploadInputRef = useRef<HTMLInputElement>(null);
  const [flowUploadTaskCode, setFlowUploadTaskCode] = useState('');
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
    return all.filter((m) => m.sessionId === activeSession.sessionId);
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

  const handleChangeVideoSource = async (videoSource: IndependentVideoSource) => {
    if (!activeSession) return;
    setBusyAction(`source_${videoSource}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(activeSession.sessionId)}/source`, {
        method: 'POST',
        body: JSON.stringify({ videoSource }),
      });
      setNotice(`Đã khóa nguồn sáng tạo video độc lập cho phiên ${activeSession.sessionId}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể đổi nguồn video.');
    } finally {
      setBusyAction('');
    }
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

  const handleStartSequentialRun = async (retryErrors = false) => {
    if (!activeSession) return;
    setBusyAction(retryErrors ? 'retry_run' : 'start_run');
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(activeSession.sessionId)}/run`, {
        method: 'POST',
        body: JSON.stringify({ retryErrors }),
      });
      setNotice(
        retryErrors
          ? `Đang chạy lại các tác vụ lỗi của phiên ${activeSession.sessionId} theo đúng thứ tự phụ thuộc.`
          : `Đã khởi động dây chuyền tuần tự cho phiên ${activeSession.sessionId}.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể chạy phiên.');
    } finally {
      setBusyAction('');
    }
  };

  const handlePauseRun = async () => {
    if (!activeSession) return;
    setBusyAction('pause_run');
    setErrorMsg('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(activeSession.sessionId)}/pause`, {
        method: 'POST',
      });
      setNotice(`Đã gửi lệnh tạm dừng phiên ${activeSession.sessionId}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạm dừng.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRunSingleTask = async (taskCode: string) => {
    if (!activeSession) return;
    setBusyAction(`task_${taskCode}`);
    setErrorMsg('');
    setNotice('');
    try {
      await apiCall(
        `/api/coordination/sessions/${encodeURIComponent(activeSession.sessionId)}/tasks/${encodeURIComponent(taskCode)}/run`,
        { method: 'POST' }
      );
      setNotice(`Đã thực thi xong tác vụ ${taskCode}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || `Không thể chạy tác vụ ${taskCode}.`);
    } finally {
      setBusyAction('');
    }
  };

  const handleTriggerFlowUpload = (taskCode: string) => {
    setFlowUploadTaskCode(taskCode);
    flowUploadInputRef.current?.click();
  };

  const handleFlowFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeSession || !flowUploadTaskCode) return;
    setBusyAction(`flow_${flowUploadTaskCode}`);
    setErrorMsg('');
    setNotice('');
    try {
      const buf = await file.arrayBuffer();
      await apiCall(
        `/api/coordination/sessions/${encodeURIComponent(activeSession.sessionId)}/tasks/${encodeURIComponent(flowUploadTaskCode)}/upload-flow`,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'video/mp4',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: buf,
        }
      );
      setNotice(`Đã nạp video Google Flow cho tác vụ ${flowUploadTaskCode}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải video Google Flow lên.');
    } finally {
      setBusyAction('');
      setFlowUploadTaskCode('');
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

  const requestSyncSessionConfirm = () => {
    if (!activeSession) return;
    if (!googleToken) {
      setTab('workspace');
      setErrorMsg('Hãy bấm "Sign in with Google" trong tab Google Sheets & Drive để đồng bộ phiên này.');
      return;
    }
    setConfirmModal({
      kind: 'sync_session',
      title: `Xác nhận đồng bộ phiên ${activeSession.sessionId} lên Google Sheets & Drive?`,
      description: `Toàn bộ dữ liệu tham chiếu (${activeSession.references.length} mục), ${activeSession.tasks.length} tác vụ và tệp ảnh/video của phiên "${activeSession.title}" sẽ được tải lên Google Drive và cập nhật vào Sổ Google Sheets.`,
      details: [
        `Tạo/cập nhật thư mục phiên trên Drive: ${activeSession.sessionId} - ${activeSession.title}`,
        `Ghi đúng dòng theo khóa phiên ${activeSession.sessionId} — không ghi đè dữ liệu của các phiên khác`,
        'Cập nhật đầy đủ link Drive đầu vào/đầu ra và lý do lỗi (nếu có) để các AI đọc lại chính xác',
      ],
      sessionId: activeSession.sessionId,
    });
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
    const targetSessionId = activeSession?.sessionId || 'GLOBAL';
    setBusyAction('send_meeting');
    setErrorMsg('');
    try {
      await apiCall(`/api/coordination/sessions/${encodeURIComponent(targetSessionId)}/meeting`, {
        method: 'POST',
        body: JSON.stringify({ content: text }),
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

  const canTaskRun = (task: CoordinationTaskRow): boolean => {
    if (!activeSession) return false;
    if (task.status === 'DANG_LAM') return false;
    return task.dependsOnTaskCodes.every((depCode) => {
      const dep = activeSession.tasks.find((t) => t.taskCode === depCode);
      return dep?.status === 'HOAN_THANH';
    });
  };

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
                      <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300 truncate">
                        {item.accountSummary}
                      </div>
                    )}
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                      {item.detail}
                    </p>
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

          {/* 3. SEQUENTIAL TASK LEDGER TABLE (Bang_Nhiem_Vu_AI) */}
          {activeSession && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    Bảng nhiệm vụ tuần tự · Phiên {activeSession.sessionId}
                  </h2>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mỗi tác vụ chỉ chạy khi tiền đề đã hoàn thành và đọc đúng dữ liệu tham chiếu của phiên này.
                </span>
              </div>

              <div className="space-y-2">
                {activeSession.tasks.map((task) => {
                  const sm = taskStatusMeta(task.status);
                  const runnable = canTaskRun(task);
                  const isBusyThis = busyAction === `task_${task.taskCode}` || busyAction === `flow_${task.taskCode}`;
                  const isImageOut =
                    task.localOutputUrl && /\.(png|jpe?g|webp)$/i.test(task.localOutputUrl);
                  const isVideoOut =
                    task.localOutputUrl && /\.(mp4|webm|mov)$/i.test(task.localOutputUrl);

                  return (
                    <div
                      key={task.taskCode}
                      className={`p-3 rounded-xl border transition space-y-2 ${
                        task.status === 'LOI'
                          ? 'border-rose-500/45 bg-rose-500/5'
                          : task.status === 'DANG_LAM'
                          ? 'border-cyan-500/55 bg-cyan-500/5'
                          : task.status === 'HOAN_THANH'
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-slate-200 dark:border-slate-400/20 bg-slate-50/70 dark:bg-[#0c1124]/80'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-900 dark:bg-white/10 text-white rounded">
                              {task.taskCode}
                            </span>
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${sm.cls}`}>
                              {task.status === 'DANG_LAM' && (
                                <Loader2 className="w-2.5 h-2.5 inline mr-1 animate-spin" />
                              )}
                              {sm.label}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {task.title}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>
                              AI đảm nhận: <strong className="text-slate-700 dark:text-slate-200">{task.assignedAiLabel}</strong>
                            </span>
                            <span>
                              Phụ thuộc:{' '}
                              <strong className="font-mono text-slate-700 dark:text-slate-200">
                                {task.dependsOnTaskCodes.length > 0 ? task.dependsOnTaskCodes.join(', ') : 'Không'}
                              </strong>
                            </span>
                            <span>
                              Tham chiếu: <strong className="font-mono">{task.inputRefIds.length} mục</strong>
                            </span>
                            {task.completedAt && <span>Xong lúc {fmtTime(task.completedAt)}</span>}
                          </div>

                          {task.resultSummary && (
                            <p className="text-xs text-slate-700 dark:text-slate-200">
                              {task.resultSummary}
                            </p>
                          )}

                          {task.errorReason && (
                            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-200">
                              <strong>Lý do lỗi (đã ghi Sổ Sheets):</strong> {task.errorReason}
                            </div>
                          )}

                          {/* Google Flow prompt & clip upload */}
                          {task.status === 'CHO_NHAP_FLOW' && task.flowPrompt && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-amber-800 dark:text-amber-200">
                                  Prompt chuẩn Google Flow cho {task.taskCode}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void handleCopyPrompt(task.taskCode, task.flowPrompt || '')}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-[#131a35] border border-amber-500/40 text-amber-800 dark:text-amber-200 cursor-pointer"
                                  >
                                    {copiedPromptCode === task.taskCode ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-500" />
                                        <span>Đã sao chép</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Sao chép prompt</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusyThis}
                                    onClick={() => handleTriggerFlowUpload(task.taskCode)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-amber-600 text-white hover:brightness-110 cursor-pointer disabled:opacity-50"
                                  >
                                    {isBusyThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                    <span>Tải clip MP4 Flow lên</span>
                                  </button>
                                </div>
                              </div>
                              <pre className="text-[11px] whitespace-pre-wrap font-sans text-slate-700 dark:text-slate-200 max-h-36 overflow-y-auto bg-white/70 dark:bg-black/20 p-2 rounded-md">
                                {task.flowPrompt}
                              </pre>
                            </div>
                          )}
                        </div>

                        {/* Output preview + Row action buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          {isImageOut && task.localOutputUrl && (
                            <a
                              href={task.localOutputUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Xem ảnh kết quả"
                              className="w-16 h-11 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-500/30 bg-black/20 shrink-0 block"
                            >
                              <img
                                src={task.localOutputUrl}
                                alt={task.taskCode}
                                className="w-full h-full object-cover"
                              />
                            </a>
                          )}

                          {isVideoOut && task.localOutputUrl && (
                            <a
                              href={task.localOutputUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                            >
                              <Film className="w-3.5 h-3.5" />
                              <span>Xem clip</span>
                            </a>
                          )}

                          {task.driveOutputUrl && (
                            <a
                              href={task.driveOutputUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Drive</span>
                            </a>
                          )}

                          <button
                            type="button"
                            disabled={!runnable || isBusyThis || isRunning}
                            onClick={() => void handleRunSingleTask(task.taskCode)}
                            title={
                              runnable
                                ? `Thực thi riêng ${task.taskCode}`
                                : `Cần hoàn thành tiền đề: ${task.dependsOnTaskCodes.join(', ')}`
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-900 dark:bg-white/10 text-white hover:bg-cyan-600 transition cursor-pointer disabled:opacity-40"
                          >
                            {isBusyThis ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : task.status === 'LOI' || task.status === 'HOAN_THANH' ? (
                              <RotateCcw className="w-3 h-3" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            <span>
                              {task.status === 'LOI'
                                ? 'Thử lại'
                                : task.status === 'HOAN_THANH'
                                ? 'Chạy lại'
                                : 'Chạy bước'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. FINAL ASSEMBLED FILM PLAYER */}
          {activeSession?.finalVideoLocalUrl && (
            <div className="glass-card rounded-2xl p-4 space-y-3 border border-emerald-500/35">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-emerald-500" />
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    Phim hoàn chỉnh · {activeSession.title} ({activeSession.sessionId})
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={activeSession.finalVideoLocalUrl}
                    download={`${activeSession.sessionId}.mp4`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:brightness-110"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Tải MP4 về máy</span>
                  </a>
                  {activeSession.finalVideoDriveUrl && (
                    <a
                      href={activeSession.finalVideoDriveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Mở trên Google Drive</span>
                    </a>
                  )}
                </div>
              </div>
              <video
                src={activeSession.finalVideoLocalUrl}
                controls
                className="w-full max-h-[420px] rounded-xl bg-black"
              />
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
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-cyan-500" />
                <span>Phòng họp trực tiếp — Trao đổi &amp; Báo cáo tiến độ</span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Mọi báo cáo nhận việc, kết quả Drive và lý do lỗi từ các AI đều tập trung tại đây và đồng bộ sang tab Phong_Hop_Tien_Do trên Google Sheets.
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

          {/* Quick report buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busyAction === 'send_meeting'}
              onClick={() => void handleSendMeetingMessage('Báo cáo tiến độ hiện tại và các tác vụ còn lại của phiên này.')}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-white/5 hover:bg-cyan-500/15 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10 cursor-pointer"
            >
              Yêu cầu báo cáo tiến độ
            </button>
            {activeSession && !isRunning && (
              <button
                type="button"
                onClick={() => void handleStartSequentialRun(false)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 cursor-pointer"
              >
                Chạy tiếp tác vụ chờ
              </button>
            )}
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
              <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                Chưa có báo cáo nào trong phiên này. Hãy bấm &quot;Yêu cầu báo cáo tiến độ&quot; hoặc bắt đầu chạy phiên.
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
              placeholder="Trao đổi trực tiếp hoặc yêu cầu báo cáo tiến độ phiên..."
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
              <span>Gửi</span>
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
