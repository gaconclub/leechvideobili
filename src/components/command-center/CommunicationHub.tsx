import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ChevronRight,
  Crown,
  ExternalLink,
  Film,
  Hash,
  Loader2,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Video,
  X,
  Zap,
} from 'lucide-react';
import type {
  CommandCenterState,
  CommunicationChannelId,
  ConversationMessage,
  GeminiAccountPublic,
  GeminiDmChannelId,
  MuseAgentConfig,
  MuseAgentId,
  VideoGenerationEngine,
} from '../../types/commandCenter';
import { AgentAvatar } from './AgentAvatar';
import { GoogleFlowModal } from './GoogleFlowModal';

type ChatResponderId = MuseAgentId | 'chairman' | 'gemini' | GeminiDmChannelId;

interface CommunicationHubProps {
  state: CommandCenterState;
  setState: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  initialChannel?: CommunicationChannelId;
  onJumpToTask?: (taskId: string) => void;
  onJumpToScene?: (sceneId: string) => void;
  onJumpToIncident?: (incidentId?: string) => void;
}

interface ChannelMeta {
  id: CommunicationChannelId;
  name: string;
  shortLabel: string;
  description: string;
  defaultResponder: ChatResponderId;
}

interface QuickCommand {
  label: string;
  prompt: string;
  target?: ChatResponderId;
}

const WORK_CHANNELS: ChannelMeta[] = [
  {
    id: 'gemini',
    name: '#ai-gemini-tiến-độ',
    shortLabel: 'AI Gemini · Tiến độ',
    description: 'Trao đổi trực tiếp với AI Gemini để báo cáo tiến độ, tạo video Gemini/Google Flow và gỡ treo đội AI',
    defaultResponder: 'gemini',
  },
  {
    id: 'commander',
    name: '#tổng-chỉ-huy',
    shortLabel: 'Tổng chỉ huy',
    description: 'Chỉ đạo trực tiếp Gemini AI – Chủ tịch điều phối toàn đội Gemini & 5 Muse AI',
    defaultResponder: 'chairman',
  },
  {
    id: 'incident',
    name: '#incident-command',
    shortLabel: 'Xử lý sự cố',
    description: 'Chẩn đoán lỗi, truy vết sai lệch nhân vật và tái phân công xử lý sự cố',
    defaultResponder: 'chairman',
  },
  {
    id: 'production',
    name: '#sản-xuất-phim',
    shortLabel: 'Sản xuất phim',
    description: 'Theo dõi luồng sản xuất ảnh & video song song của đội 4 Muse',
    defaultResponder: 'chairman',
  },
  {
    id: 'script',
    name: '#kịch-bản',
    shortLabel: 'Kịch bản & Khóa NV',
    description: 'Đồng bộ kịch bản phân cảnh, trang phục khóa cứng và lời thoại',
    defaultResponder: 'chairman',
  },
  {
    id: 'visual',
    name: '#hình-ảnh',
    shortLabel: 'Hình ảnh Keyframe',
    description: 'Tạo ảnh phân cảnh, khớp ngoại hình và trang phục nhân vật chuẩn',
    defaultResponder: 'muse-03',
  },
  {
    id: 'video',
    name: '#video',
    shortLabel: 'Video Phân cảnh',
    description: 'Dựng video I2V giữ nguyên khuôn mặt, vóc dáng và bối cảnh từ ảnh gốc',
    defaultResponder: 'muse-04',
  },
  {
    id: 'qa',
    name: '#kiểm-duyệt',
    shortLabel: 'Kiểm định QA',
    description: 'Muse AI 05 đối chiếu ảnh/video và báo cáo sai lệch về Chủ tịch',
    defaultResponder: 'muse-05',
  },
  {
    id: 'ai_bus',
    name: '#trao-đổi-ai',
    shortLabel: 'Phối hợp AI',
    description: 'Nhật ký trao đổi nội bộ giữa Chủ tịch Gemini AI và các AI sản xuất',
    defaultResponder: 'chairman',
  },
];

const AGENT_SHORT_LABEL: Record<MuseAgentId, string> = {
  'muse-01': 'Muse 01',
  'muse-02': 'Muse 02',
  'muse-03': 'Muse 03',
  'muse-04': 'Muse 04',
  'muse-05': 'Muse 05',
};

const AGENT_STATUS_LABEL: Record<MuseAgentConfig['status'], string> = {
  online: 'Sẵn sàng',
  working: 'Đang chạy',
  waiting: 'Đang chờ',
  supervising: 'Giám sát',
  paused: 'Tạm dừng',
  offline: 'Ngoại tuyến',
  error: 'Gặp lỗi',
};

const AGENT_STATUS_TEXT_CLASS: Record<MuseAgentConfig['status'], string> = {
  online: 'text-emerald-600 dark:text-emerald-400',
  working: 'text-cyan-600 dark:text-cyan-400',
  waiting: 'text-amber-600 dark:text-amber-400',
  supervising: 'text-violet-600 dark:text-violet-400',
  paused: 'text-slate-500 dark:text-slate-400',
  offline: 'text-slate-400 dark:text-slate-500',
  error: 'text-rose-600 dark:text-rose-400',
};

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatFullDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return '';
  }
}

function getQuickCommandsForChannel(channel: CommunicationChannelId): QuickCommand[] {
  if (channel === 'gemini' || channel.startsWith('gemini:')) {
    const target = channel as 'gemini' | GeminiDmChannelId;
    return [
      {
        label: 'Kiểm tra trạng thái & sẵn sàng',
        prompt: 'Báo cáo tình trạng sẵn sàng của bạn, số tác vụ bạn đang phụ trách và tiến độ chi tiết của phiên hiện tại.',
        target,
      },
      {
        label: 'Tạo video Gemini cho ảnh đã duyệt',
        prompt: 'Hãy tạo video ngay lập tức bằng AI Gemini cho toàn bộ các ảnh phân cảnh đã thông qua QA.',
        target,
      },
      {
        label: 'Xuất kịch bản sang Google Flow',
        prompt: 'Hãy chuyển và xuất toàn bộ kịch bản phân cảnh sang Google Flow để tôi render video.',
        target,
      },
      {
        label: 'Gỡ treo đội AI ngay',
        prompt: 'Kiểm tra và gỡ treo toàn bộ các tác vụ/AI đang bị kẹt để dây chuyền chạy tiếp ngay.',
        target,
      },
    ];
  }
  if (channel === 'commander' || channel === 'production' || channel === 'ai_bus') {
    return [
      {
        label: 'Báo cáo tiến độ phiên',
        prompt: 'Báo cáo ngắn gọn tiến độ phiên hiện tại: cảnh nào đã xong, cảnh nào đang chạy hoặc kẹt lỗi?',
        target: 'chairman',
      },
      {
        label: 'Kiểm tra & gỡ kẹt lỗi',
        prompt: 'Kiểm tra toàn bộ sự cố đang mở và điều phối xử lý dứt điểm các cảnh đang bị kẹt.',
        target: 'chairman',
      },
      {
        label: 'Phân công lại cảnh chờ',
        prompt: 'Rà soát các phân cảnh chưa xong và phân công lại đồng đều cho các AI đang rảnh.',
        target: 'chairman',
      },
      {
        label: 'Tóm tắt kết quả QA',
        prompt: 'Tổng hợp nhanh kết quả kiểm định của Muse 05 cho phiên này và đề xuất bước tiếp theo.',
        target: 'chairman',
      },
    ];
  }
  if (channel === 'incident') {
    return [
      {
        label: 'Phân tích lỗi đang mở',
        prompt: 'Phân tích nguyên nhân gốc của các sự cố đang mở và đưa ra phương án sửa nhanh nhất.',
        target: 'chairman',
      },
      {
        label: 'Tạo lại cảnh lỗi',
        prompt: 'Giao sản xuất tạo lại các phân cảnh bị lỗi và giữ chặt nhân vật tham chiếu.',
        target: 'chairman',
      },
      {
        label: 'Yêu cầu Muse 05 rà soát lại',
        prompt: 'Yêu cầu Muse AI 05 đối chiếu lại các cảnh vừa sửa xem đã đạt chuẩn chưa.',
        target: 'chairman',
      },
    ];
  }
  if (channel === 'qa' || channel === 'muse-05') {
    return [
      {
        label: 'Báo cáo lỗi QA gần nhất',
        prompt: 'Báo cáo ngắn gọn các cảnh gần đây không đạt QA và lý do cụ thể.',
        target: 'muse-05',
      },
      {
        label: 'Kiểm định lại ảnh/video',
        prompt: 'Đối chiếu lại ảnh và video mới nhất với ảnh nhân vật khóa cứng, linh hoạt chấp nhận sai lệch nhỏ.',
        target: 'muse-05',
      },
    ];
  }
  if (channel === 'visual' || channel === 'video') {
    return [
      {
        label: 'Báo cáo cảnh đang xử lý',
        prompt: 'Báo cáo trạng thái các phân cảnh bạn đang phụ trách và cảnh nào sắp hoàn thành.',
      },
      {
        label: 'Khớp lại nhân vật chuẩn',
        prompt: 'Rà soát lại khuôn mặt, trang phục khóa cứng và tạo lại khung hình chuẩn nhất.',
      },
    ];
  }
  if (channel.startsWith('muse-')) {
    return [
      {
        label: 'Báo cáo công việc hiện tại',
        prompt: 'Báo cáo ngắn gọn nhiệm vụ bạn đang làm và tiến độ hoàn thành.',
      },
      {
        label: 'Kiểm tra khóa nhân vật',
        prompt: 'Xác nhận bạn đã nắm đầy đủ nhân vật tham chiếu và trang phục khóa cứng của phiên hiện tại.',
      },
    ];
  }
  return [
    {
      label: 'Tóm tắt kịch bản & cảnh',
      prompt: 'Tóm tắt danh sách phân cảnh hiện có và kiểm tra xem có điểm mâu thuẫn nào về nhân vật không.',
      target: 'chairman',
    },
  ];
}

interface OptimisticMessage {
  tempId: string;
  channel: CommunicationChannelId;
  content: string;
  attachments: string[];
  sceneId?: string;
  createdAt: number;
}

export const CommunicationHub: React.FC<CommunicationHubProps> = ({
  state,
  setState,
  initialChannel,
  onJumpToTask,
  onJumpToScene,
  onJumpToIncident,
}) => {
  const [activeChannel, setActiveChannel] = useState<CommunicationChannelId>(initialChannel || 'commander');
  const [sidebarAiTab, setSidebarAiTab] = useState<'gemini' | 'muse'>('gemini');
  const [targetResponder, setTargetResponder] = useState<ChatResponderId>('chairman');
  const [testingGeminiId, setTestingGeminiId] = useState<string | null>(null);
  const [testingAllGemini, setTestingAllGemini] = useState(false);
  const [inputText, setInputText] = useState('');
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendElapsedMs, setSendElapsedMs] = useState(0);
  const [lastReplyMs, setLastReplyMs] = useState<number | null>(null);
  const [optimisticMsg, setOptimisticMsg] = useState<OptimisticMessage | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [triggeringSceneKey, setTriggeringSceneKey] = useState<string | null>(null);
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [flowFocusSceneId, setFlowFocusSceneId] = useState<string | null>(null);
  const [unsticking, setUnsticking] = useState(false);

  // Clean collapsible inspector & search states
  const [rightOpen, setRightOpen] = useState(false);
  const [showInChannelSearch, setShowInChannelSearch] = useState(false);
  const [channelFilterText, setChannelFilterText] = useState('');
  const [confirmClearChannel, setConfirmClearChannel] = useState(false);
  const [expandedPromptIds, setExpandedPromptIds] = useState<Record<string, boolean>>({});
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Archive search drawer/modal mode
  const [archiveMode, setArchiveMode] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [archiveAgentFilter, setArchiveAgentFilter] = useState('');
  const [archiveResults, setArchiveResults] = useState<ConversationMessage[] | null>(null);
  const [searchingArchive, setSearchingArchive] = useState(false);

  // Auto-scroll management
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const prevMsgCountRef = useRef(0);

  useEffect(() => {
    if (initialChannel) {
      setActiveChannel(initialChannel);
      setArchiveMode(false);
      if (initialChannel.startsWith('gemini:')) setSidebarAiTab('gemini');
      else if (initialChannel.startsWith('muse-')) setSidebarAiTab('muse');
    }
  }, [initialChannel]);

  const geminiAccounts = useMemo(() => state.geminiAccounts || [], [state.geminiAccounts]);
  const enabledGeminiAccounts = useMemo(
    () => geminiAccounts.filter((a) => a.enabled),
    [geminiAccounts]
  );

  const activeWorkMeta = useMemo(
    () => WORK_CHANNELS.find((c) => c.id === activeChannel) || null,
    [activeChannel]
  );

  const isMuseDmChannel = activeChannel.startsWith('muse-');
  const isGeminiDmChannel = activeChannel.startsWith('gemini:');
  const isDmChannel = isMuseDmChannel || isGeminiDmChannel;
  const activeDmAgent = useMemo(
    () => (isMuseDmChannel ? state.agents.find((a) => a.id === activeChannel) || null : null),
    [isMuseDmChannel, activeChannel, state.agents]
  );
  const activeDmGemini = useMemo(
    () =>
      isGeminiDmChannel
        ? geminiAccounts.find((a) => a.id === activeChannel.slice('gemini:'.length)) || null
        : null,
    [isGeminiDmChannel, activeChannel, geminiAccounts]
  );

  // Sync default responder cleanly when switching channels
  useEffect(() => {
    if (activeChannel.startsWith('muse-')) {
      setTargetResponder(activeChannel as MuseAgentId);
      setSidebarAiTab('muse');
    } else if (activeChannel.startsWith('gemini:')) {
      setTargetResponder(activeChannel as GeminiDmChannelId);
      setSidebarAiTab('gemini');
    } else {
      const meta = WORK_CHANNELS.find((c) => c.id === activeChannel);
      setTargetResponder(meta?.defaultResponder || 'chairman');
    }
    setConfirmClearChannel(false);
    setChannelFilterText('');
    setUnseenCount(0);
  }, [activeChannel]);

  // Live elapsed timer while AI is responding
  useEffect(() => {
    if (!sending) {
      setSendElapsedMs(0);
      return;
    }
    const start = Date.now();
    const timer = window.setInterval(() => {
      setSendElapsedMs(Date.now() - start);
    }, 100);
    return () => window.clearInterval(timer);
  }, [sending]);

  const activeRun = useMemo(() => {
    const id = state.selectedRunId || state.runs[0]?.id;
    return state.runs.find((r) => r.id === id) || state.runs[0] || null;
  }, [state.runs, state.selectedRunId]);

  const chairmanAccountLabel = useMemo(() => {
    const accounts = state.geminiAccounts || [];
    const acc =
      accounts.find((a) => a.id === activeRun?.chairmanGeminiAccountId) ||
      accounts.find((a) => a.isChairman);
    return acc ? acc.label : 'Gemini API mặc định';
  }, [state.geminiAccounts, activeRun?.chairmanGeminiAccountId]);

  const openIncidentsCount = useMemo(
    () => (state.incidents || []).filter((i) => i.status !== 'resolved').length,
    [state.incidents]
  );

  const messageCountByChannel = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of state.conversations) {
      map[m.channel] = (map[m.channel] || 0) + 1;
    }
    return map;
  }, [state.conversations]);

  const channelMessages = useMemo(() => {
    const base = state.conversations.filter((m) => m.channel === activeChannel);
    const q = channelFilterText.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        (m.roleBadge || '').toLowerCase().includes(q)
    );
  }, [state.conversations, activeChannel, channelFilterText]);

  const activeScenes = state.projectMemory?.scenes || [];
  const quickCommands = useMemo(() => getQuickCommandsForChannel(activeChannel), [activeChannel]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomSentinelRef.current?.scrollIntoView({ behavior, block: 'end' });
    setUnseenCount(0);
    setIsNearBottom(true);
  }, []);

  // Auto-scroll when switching channel
  useEffect(() => {
    prevMsgCountRef.current = channelMessages.length;
    const id = window.requestAnimationFrame(() => scrollToBottom('auto'));
    return () => window.cancelAnimationFrame(id);
  }, [activeChannel, archiveMode]);

  // Auto-scroll or show unread pill when new messages arrive
  useEffect(() => {
    const delta = channelMessages.length - prevMsgCountRef.current;
    prevMsgCountRef.current = channelMessages.length;
    if (delta > 0) {
      if (isNearBottom) {
        window.requestAnimationFrame(() => scrollToBottom('smooth'));
      } else {
        setUnseenCount((prev) => prev + delta);
      }
    }
  }, [channelMessages.length, isNearBottom, scrollToBottom]);

  // Auto-scroll when optimistic message appears
  useEffect(() => {
    if (optimisticMsg || sending) {
      window.requestAnimationFrame(() => scrollToBottom('smooth'));
    }
  }, [optimisticMsg, sending, scrollToBottom]);

  // Auto-resize composer textarea cleanly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [inputText]);

  const handleFeedScroll = () => {
    const el = feedScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < 90;
    setIsNearBottom(near);
    if (near && unseenCount > 0) setUnseenCount(0);
  };

  const handleAttachFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files)
      .slice(0, 4)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setAttachments((prev) => [...prev, reader.result as string].slice(0, 4));
          }
        };
        reader.readAsDataURL(file);
      });
  };

  const dispatchMessage = async (
    overrideText?: string,
    overrideTarget?: ChatResponderId
  ) => {
    const textToSend = (overrideText !== undefined ? overrideText : inputText).trim();
    const filesToSend = overrideText !== undefined ? [] : attachments;
    if ((!textToSend && filesToSend.length === 0) || sending) return;

    const effectiveTarget: ChatResponderId = isMuseDmChannel
      ? (activeChannel as MuseAgentId)
      : isGeminiDmChannel
      ? (activeChannel as GeminiDmChannelId)
      : overrideTarget || targetResponder;

    setErrorBanner(null);
    setLastReplyMs(null);
    setSending(true);
    setOptimisticMsg({
      tempId: `opt_${Date.now()}`,
      channel: activeChannel,
      content: textToSend || '(Đã gửi tệp đính kèm)',
      attachments: filesToSend,
      sceneId: selectedSceneId || undefined,
      createdAt: Date.now(),
    });

    if (overrideText === undefined) {
      setInputText('');
      setAttachments([]);
    }

    const startedAt = Date.now();
    try {
      const res = await fetch('/api/command-center/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeChannel,
          message: textToSend,
          targetAgentId: effectiveTarget,
          attachments: filesToSend,
          sceneId: selectedSceneId || undefined,
          sessionId: state.selectedRunId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể gửi tin nhắn.');
      if (data.state) setState(data.state);
      setLastReplyMs(Math.max(100, Date.now() - startedAt));
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi kết nối khi gửi tin nhắn.');
      if (overrideText === undefined && textToSend) {
        setInputText(textToSend);
      }
    } finally {
      setOptimisticMsg(null);
      setSending(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleClearChannel = async () => {
    try {
      const res = await fetch('/api/command-center/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: activeChannel }),
      });
      const data = await res.json();
      if (res.ok && data.state) {
        setState(data.state);
      }
    } finally {
      setConfirmClearChannel(false);
    }
  };

  const handleArchiveSearch = async () => {
    setSearchingArchive(true);
    try {
      const qs = new URLSearchParams();
      if (archiveQuery.trim()) qs.set('q', archiveQuery.trim());
      if (archiveAgentFilter) qs.set('agentId', archiveAgentFilter);
      const res = await fetch(`/api/command-center/archive/search?${qs.toString()}`);
      const data = await res.json();
      if (res.ok) setArchiveResults(data.messages || []);
    } finally {
      setSearchingArchive(false);
    }
  };

  const handleTriggerSceneVideoNow = async (sceneId: string, engine: VideoGenerationEngine) => {
    const busyKey = `${sceneId}:${engine}`;
    setTriggeringSceneKey(busyKey);
    setErrorBanner(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/command-center/scenes/${encodeURIComponent(sceneId)}/generate-video-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: activeRun?.id || state.selectedRunId || undefined,
          engine,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể kích hoạt tạo video ngay.');
      if (data.state) setState(data.state);
      if (engine === 'google_flow') {
        setFlowFocusSceneId(sceneId);
        setFlowModalOpen(true);
        setActionNotice('Đã xuất prompt chuẩn Google Flow cho phân cảnh.');
      } else {
        setActionNotice(
          `Đã phát lệnh tạo video NGAY bằng ${
            engine === 'qwen'
              ? 'AI Qwen (Alibaba Model Studio)'
              : engine === 'gemini'
              ? 'AI Gemini (Omni Flash)'
              : 'AI Muse'
          }!`
        );
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi khi kích hoạt tạo video ngay.');
    } finally {
      setTriggeringSceneKey(null);
    }
  };

  const handleUnstickTeam = async () => {
    setUnsticking(true);
    setErrorBanner(null);
    setActionNotice(null);
    try {
      const targetId = encodeURIComponent(activeRun?.id || state.selectedRunId || 'active');
      const res = await fetch(`/api/command-center/productions/${targetId}/unstick`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thể gỡ treo đội AI.');
      if (data.state) setState(data.state);
      setActionNotice(data.summary || 'Đã gỡ treo đội AI Muse và tiếp tục chạy.');
    } catch (err: any) {
      setErrorBanner(err?.message || 'Lỗi khi gỡ treo đội AI.');
    } finally {
      setUnsticking(false);
    }
  };

  const approvedImageScenes = useMemo(
    () =>
      activeScenes.filter(
        (s) => Boolean(s.keyframeImageUrl) && s.imageValidated !== false
      ),
    [activeScenes]
  );

  const getGeminiLiveMeta = useCallback(
    (acc: GeminiAccountPublic) => {
      const workerProg = (activeRun?.perGeminiProgress || []).find((p) => p.accountId === acc.id);
      const runTasksForAcc = state.tasks.filter(
        (t) =>
          (!activeRun || t.runId === activeRun.id) &&
          (t.assignedGeminiAccountId === acc.id || (acc.isChairman && t.assignedAgentId === 'chairman'))
      );
      const runningList = runTasksForAcc.filter((t) => t.status === 'running');
      const runningCount = Math.max(workerProg?.runningTasks || 0, runningList.length);
      const completedCount = Math.max(
        workerProg?.completedTasks || 0,
        runTasksForAcc.filter((t) => t.status === 'completed').length
      );
      const currentTaskTitle = workerProg?.currentTaskTitle || runningList[0]?.title;

      if (!acc.enabled) {
        return {
          label: 'Đã tắt',
          dotClass: 'bg-slate-400',
          textClass: 'text-slate-400 dark:text-slate-500',
          runningCount: 0,
          completedCount,
          currentTaskTitle: undefined,
          isReady: false,
        };
      }
      if (runningCount > 0) {
        return {
          label: `Đang làm việc (${runningCount})`,
          dotClass: 'bg-cyan-500 animate-pulse',
          textClass: 'text-cyan-600 dark:text-cyan-400',
          runningCount,
          completedCount,
          currentTaskTitle,
          isReady: true,
        };
      }
      if (acc.status === 'healthy') {
        return {
          label: acc.lastLatencyMs ? `Sẵn sàng · ${acc.lastLatencyMs}ms` : 'Sẵn sàng',
          dotClass: 'bg-emerald-500',
          textClass: 'text-emerald-600 dark:text-emerald-400',
          runningCount: 0,
          completedCount,
          currentTaskTitle: undefined,
          isReady: true,
        };
      }
      if (acc.status === 'quota_exceeded') {
        return {
          label: 'Hết hạn mức (429)',
          dotClass: 'bg-amber-500',
          textClass: 'text-amber-600 dark:text-amber-400',
          runningCount: 0,
          completedCount,
          currentTaskTitle: undefined,
          isReady: false,
        };
      }
      if (acc.status === 'error') {
        return {
          label: 'Gặp lỗi API',
          dotClass: 'bg-rose-500',
          textClass: 'text-rose-600 dark:text-rose-400',
          runningCount: 0,
          completedCount,
          currentTaskTitle: undefined,
          isReady: false,
        };
      }
      return {
        label: 'Sẵn sàng (chưa test)',
        dotClass: 'bg-sky-500',
        textClass: 'text-sky-600 dark:text-sky-400',
        runningCount: 0,
        completedCount,
        currentTaskTitle: undefined,
        isReady: true,
      };
    },
    [activeRun, state.tasks]
  );

  const handleTestGeminiAccount = async (accId: string) => {
    setTestingGeminiId(accId);
    setErrorBanner(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(accId)}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (Array.isArray(data.accounts)) {
        setState((prev) => (prev ? { ...prev, geminiAccounts: data.accounts } : prev));
      }
      if (!res.ok || data.ok === false) {
        setErrorBanner(`${data.account?.label || 'AI Gemini'}: ${data.message || data.error || 'Kiểm tra thất bại.'}`);
      } else {
        setActionNotice(`${data.account?.label || 'AI Gemini'}: ${data.message || 'Kết nối sẵn sàng.'}`);
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Không thể kiểm tra kết nối AI Gemini.');
    } finally {
      setTestingGeminiId(null);
    }
  };

  const handleTestAllGeminiAccounts = async () => {
    const targets = enabledGeminiAccounts;
    if (targets.length === 0) {
      setErrorBanner('Chưa có AI Gemini nào đang bật trong Cài đặt để kiểm tra.');
      return;
    }
    setTestingAllGemini(true);
    setErrorBanner(null);
    setActionNotice(null);
    let okCount = 0;
    let latestAccounts: GeminiAccountPublic[] | null = null;
    try {
      for (const acc of targets) {
        setTestingGeminiId(acc.id);
        try {
          const res = await fetch(`/api/gemini-accounts/${encodeURIComponent(acc.id)}/test`, {
            method: 'POST',
          });
          const data = await res.json();
          if (Array.isArray(data.accounts)) latestAccounts = data.accounts;
          if (res.ok && data.ok) okCount += 1;
        } catch {
          // continue checking remaining accounts
        }
      }
      if (latestAccounts) {
        setState((prev) => (prev ? { ...prev, geminiAccounts: latestAccounts! } : prev));
      }
      setActionNotice(`Đã kiểm tra ${targets.length} AI Gemini: ${okCount}/${targets.length} sẵn sàng hoạt động.`);
    } finally {
      setTestingGeminiId(null);
      setTestingAllGemini(false);
    }
  };

  const geminiReadyCount = useMemo(
    () => geminiAccounts.filter((a) => getGeminiLiveMeta(a).isReady).length,
    [geminiAccounts, getGeminiLiveMeta]
  );
  const geminiWorkingCount = useMemo(
    () => geminiAccounts.filter((a) => getGeminiLiveMeta(a).runningCount > 0).length,
    [geminiAccounts, getGeminiLiveMeta]
  );

  const responderLabel = useMemo(() => {
    if (isMuseDmChannel && activeDmAgent) return activeDmAgent.name;
    if (isGeminiDmChannel && activeDmGemini) return activeDmGemini.label;
    if (targetResponder === 'gemini') return 'AI Gemini · Tiến độ & Video';
    if (targetResponder === 'chairman') return 'Gemini AI – Chủ tịch';
    if (String(targetResponder).startsWith('gemini:')) {
      const id = String(targetResponder).slice('gemini:'.length);
      const foundGem = geminiAccounts.find((a) => a.id === id);
      return foundGem ? foundGem.label : 'AI Gemini';
    }
    const found = state.agents.find((a) => a.id === targetResponder);
    return found ? found.name : String(targetResponder).toUpperCase();
  }, [isMuseDmChannel, activeDmAgent, isGeminiDmChannel, activeDmGemini, targetResponder, geminiAccounts, state.agents]);

  const contextTasks = useMemo(() => {
    if (isMuseDmChannel && activeDmAgent) {
      return state.tasks.filter((t) => t.assignedAgentId === activeDmAgent.id).slice(0, 8);
    }
    if (isGeminiDmChannel && activeDmGemini) {
      return state.tasks
        .filter(
          (t) =>
            t.assignedGeminiAccountId === activeDmGemini.id ||
            (activeDmGemini.isChairman && t.assignedAgentId === 'chairman')
        )
        .slice(0, 8);
    }
    return state.tasks.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'failed').slice(0, 8);
  }, [isMuseDmChannel, activeDmAgent, isGeminiDmChannel, activeDmGemini, state.tasks]);

  const renderMessageItem = (msg: ConversationMessage) => {
    const isUser = msg.senderType === 'user';
    const isSystem = msg.senderType === 'system';
    const isChairman = msg.senderId === 'chairman';
    const isGeminiDirect = msg.senderId === 'gemini' || msg.senderId.startsWith('gemini:');
    const senderAgent =
      !isUser && !isSystem && !isChairman && !isGeminiDirect
        ? state.agents.find((a) => a.id === msg.senderId) || null
        : null;
    const linkedScene = msg.sceneId ? activeScenes.find((s) => s.sceneId === msg.sceneId) : null;
    const linkedTask = msg.taskId ? state.tasks.find((t) => t.id === msg.taskId) : null;
    const linkedIncident = msg.incidentId ? (state.incidents || []).find((i) => i.id === msg.incidentId) : null;
    const hasLinks = Boolean(linkedScene || linkedTask || linkedIncident);
    const showQaInstantVideoBar = Boolean(
      msg.channel === 'qa' &&
        linkedScene &&
        linkedScene.keyframeImageUrl &&
        (linkedScene.imageValidated !== false || /ĐẠT|PASS|thông qua/i.test(msg.content))
    );

    if (isSystem) {
      return (
        <div key={msg.id} className="flex justify-center py-1">
          <div className="max-w-2xl rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-3.5 py-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span>{msg.senderName}</span>
              {msg.roleBadge && (
                <>
                  <span>·</span>
                  <span className="text-amber-600 dark:text-amber-400">{msg.roleBadge}</span>
                </>
              )}
              <span>·</span>
              <span className="tabular-nums">{formatTime(msg.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
          </div>
        </div>
      );
    }

    if (isUser) {
      return (
        <div key={msg.id} className="flex justify-end">
          <div className="max-w-[78%] sm:max-w-[70%] space-y-1.5">
            <div className="flex items-center justify-end gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              <span>Bạn</span>
              <span>·</span>
              <span className="tabular-nums">{formatTime(msg.createdAt)}</span>
            </div>
            <div className="rounded-2xl rounded-tr-sm bg-slate-900 dark:bg-violet-600 text-white px-4 py-2.5 text-sm leading-relaxed shadow-xs">
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {msg.attachments.map((att, idx) =>
                    att.startsWith('data:video/') || att.endsWith('.mp4') ? (
                      <video
                        key={idx}
                        src={att}
                        controls
                        className="h-28 w-44 rounded-lg border border-white/20 object-cover bg-black"
                      />
                    ) : (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPreviewImageUrl(att)}
                        className="block overflow-hidden rounded-lg border border-white/20 hover:opacity-90 transition-opacity"
                      >
                        <img src={att} alt="Đính kèm" className="h-24 w-24 object-cover" />
                      </button>
                    )
                  )}
                </div>
              )}
              {linkedScene && (
                <button
                  type="button"
                  onClick={() => onJumpToScene?.(linkedScene.sceneId)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/80 hover:text-white underline underline-offset-2"
                >
                  <Film className="w-3 h-3" />
                  Cảnh {linkedScene.index}: {linkedScene.title}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          {isGeminiDirect ? (
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Sparkles className="w-4 h-4" />
            </div>
          ) : isChairman ? (
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Crown className="w-4 h-4" />
            </div>
          ) : senderAgent ? (
            <AgentAvatar agent={senderAgent} size="sm" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-300">
              AI
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 max-w-[85%] space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <span
              className={`font-semibold ${
                isGeminiDirect
                  ? 'text-blue-700 dark:text-blue-400'
                  : isChairman
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {msg.senderName}
            </span>
            {msg.roleBadge && (
              <>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span
                  className={`text-[11px] font-medium ${
                    isGeminiDirect
                      ? 'text-blue-600/90 dark:text-blue-300/80'
                      : isChairman
                      ? 'text-amber-600/90 dark:text-amber-300/80'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {msg.roleBadge}
                </span>
              </>
            )}
            <span className="text-slate-300 dark:text-slate-700">·</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">
              {formatTime(msg.createdAt)}
            </span>
          </div>

          <div
            className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed border ${
              isGeminiDirect
                ? 'bg-blue-50/60 dark:bg-blue-500/[0.08] border-blue-200/80 dark:border-blue-500/25 text-slate-900 dark:text-slate-100'
                : isChairman
                ? 'bg-amber-50/55 dark:bg-amber-500/[0.06] border-amber-200/80 dark:border-amber-500/20 text-slate-900 dark:text-slate-100'
                : 'bg-slate-50/90 dark:bg-[#141925] border-slate-200/80 dark:border-slate-800/90 text-slate-800 dark:text-slate-100'
            }`}
          >
            <p className="whitespace-pre-wrap break-words">{msg.content}</p>

            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {msg.attachments.map((att, idx) =>
                  att.startsWith('data:video/') || att.endsWith('.mp4') ? (
                    <video
                      key={idx}
                      src={att}
                      controls
                      className="h-32 w-52 rounded-lg border border-slate-200 dark:border-slate-700 object-cover bg-black"
                    />
                  ) : (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setPreviewImageUrl(att)}
                      className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 hover:opacity-90 transition-opacity"
                    >
                      <img src={att} alt="Đính kèm" className="h-28 w-28 object-cover" />
                    </button>
                  )
                )}
              </div>
            )}

            {/* Instant 1-Click Video Task Triggers right on QA-approved scene images in #kiểm-duyệt */}
            {showQaInstantVideoBar && linkedScene && (
              <div className="mt-3 p-2.5 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mr-1">
                  Ảnh Cảnh {linkedScene.index} đã duyệt — Tác vụ dựng video ngay:
                </span>
                <button
                  type="button"
                  disabled={triggeringSceneKey !== null}
                  onClick={() => void handleTriggerSceneVideoNow(linkedScene.sceneId, 'gemini')}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 transition"
                >
                  {triggeringSceneKey === `${linkedScene.sceneId}:gemini` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Tạo video ngay (AI Gemini)
                </button>
                <button
                  type="button"
                  disabled={triggeringSceneKey !== null}
                  onClick={() => void handleTriggerSceneVideoNow(linkedScene.sceneId, 'qwen')}
                  className="px-2.5 py-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 transition"
                >
                  {triggeringSceneKey === `${linkedScene.sceneId}:qwen` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  Tạo video (AI Qwen)
                </button>
                <button
                  type="button"
                  disabled={triggeringSceneKey !== null}
                  onClick={() => void handleTriggerSceneVideoNow(linkedScene.sceneId, 'google_flow')}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 transition"
                >
                  <ExternalLink className="w-3 h-3" />
                  Đẩy sang Google Flow
                </button>
                <button
                  type="button"
                  disabled={triggeringSceneKey !== null}
                  onClick={() => void handleTriggerSceneVideoNow(linkedScene.sceneId, 'muse')}
                  className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 text-slate-800 dark:text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 transition"
                >
                  {triggeringSceneKey === `${linkedScene.sceneId}:muse` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  Tạo video (AI Muse)
                </button>
              </div>
            )}

            {(hasLinks || msg.promptDelivered) && (
              <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800/70 flex flex-wrap items-center gap-3 text-[11px]">
                {linkedScene && (
                  <button
                    type="button"
                    onClick={() => onJumpToScene?.(linkedScene.sceneId)}
                    className="inline-flex items-center gap-1 font-medium text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    <Film className="w-3 h-3" />
                    Cảnh {linkedScene.index}
                  </button>
                )}
                {linkedTask && (
                  <button
                    type="button"
                    onClick={() => onJumpToTask?.(linkedTask.id)}
                    className="inline-flex items-center gap-1 font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    <Zap className="w-3 h-3" />
                    {linkedTask.code}
                  </button>
                )}
                {linkedIncident && (
                  <button
                    type="button"
                    onClick={() => onJumpToIncident?.(linkedIncident.id)}
                    className="inline-flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    Sự cố {linkedIncident.code}
                  </button>
                )}
                {msg.promptDelivered && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedPromptIds((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                    }
                    className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {expandedPromptIds[msg.id] ? 'Ẩn lệnh gốc' : 'Xem lệnh gốc'}
                  </button>
                )}
              </div>
            )}

            {expandedPromptIds[msg.id] && msg.promptDelivered && (
              <div className="mt-2 rounded-lg bg-slate-100/80 dark:bg-slate-900/80 px-3 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {msg.promptDelivered}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1119] overflow-hidden shadow-xs flex h-[calc(100vh-225px)] min-h-[640px] max-h-[880px]">
      {/* =====================================================
          LEFT SIDEBAR: CLEAN CHANNEL & DIRECT AI NAVIGATION
         ===================================================== */}
      <aside className="w-[268px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-[#111622] flex flex-col">
        {/* Top Chairman & Direct AI Gemini Fast Entries */}
        <div className="p-3 border-b border-slate-200/80 dark:border-slate-800/80 space-y-2">
          <button
            type="button"
            onClick={() => {
              setArchiveMode(false);
              setActiveChannel('gemini');
              setTargetResponder('gemini');
            }}
            className={`w-full text-left rounded-xl p-2.5 transition-colors border ${
              !archiveMode && activeChannel === 'gemini'
                ? 'bg-blue-600/12 border-blue-500/45 text-slate-900 dark:text-white'
                : 'bg-white dark:bg-[#151B29] border-slate-200/80 dark:border-slate-800 hover:border-blue-500/35 text-slate-800 dark:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">AI Gemini · Tiến độ</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {geminiReadyCount}/{geminiAccounts.length} sẵn sàng
                  {geminiWorkingCount > 0 ? ` · ${geminiWorkingCount} đang chạy` : ''}
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setArchiveMode(false);
              setActiveChannel('commander');
              setTargetResponder('chairman');
            }}
            className={`w-full text-left rounded-xl p-2.5 transition-colors border ${
              !archiveMode && activeChannel === 'commander'
                ? 'bg-amber-500/12 border-amber-500/35 text-slate-900 dark:text-white'
                : 'bg-white dark:bg-[#151B29] border-slate-200/80 dark:border-slate-800 hover:border-amber-500/30 text-slate-800 dark:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Crown className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">Gemini AI – Chủ tịch</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {chairmanAccountLabel}
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* Scrollable Nav Lists */}
        <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
          {/* Group 1: 2-Tab Switcher — AI Gemini (from Settings) | Chat riêng 5 Muse AI */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-[#0B0F1A] border border-slate-200/80 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSidebarAiTab('gemini')}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                  sidebarAiTab === 'gemini'
                    ? 'bg-white dark:bg-[#1A2236] text-blue-700 dark:text-blue-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sparkles className="w-3 h-3 shrink-0" />
                <span className="truncate">AI Gemini ({geminiAccounts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarAiTab('muse')}
                className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center gap-1 cursor-pointer ${
                  sidebarAiTab === 'muse'
                    ? 'bg-white dark:bg-[#1A2236] text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="truncate">5 Muse AI</span>
              </button>
            </div>

            {sidebarAiTab === 'gemini' ? (
              <div className="space-y-1.5">
                <div className="px-1.5 flex items-center justify-between gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Danh sách AI Gemini ({geminiReadyCount}/{geminiAccounts.length})
                  </span>
                  <button
                    type="button"
                    disabled={testingAllGemini || testingGeminiId !== null}
                    onClick={() => void handleTestAllGeminiAccounts()}
                    title="Kiểm tra tình trạng sẵn sàng của tất cả AI Gemini"
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${testingAllGemini ? 'animate-spin' : ''}`} />
                    <span>Kiểm tra</span>
                  </button>
                </div>

                {geminiAccounts.length === 0 ? (
                  <div className="px-2.5 py-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 text-center">
                    Chưa có AI Gemini nào trong Cài đặt.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {geminiAccounts.map((acc) => {
                      const chId = `gemini:${acc.id}` as GeminiDmChannelId;
                      const isSelected = !archiveMode && activeChannel === chId;
                      const count = messageCountByChannel[chId] || 0;
                      const meta = getGeminiLiveMeta(acc);
                      const isPinging = testingGeminiId === acc.id;
                      return (
                        <div
                          key={acc.id}
                          onClick={() => {
                            setArchiveMode(false);
                            setActiveChannel(chId);
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setArchiveMode(false);
                              setActiveChannel(chId);
                            }
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="relative shrink-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                                isSelected
                                  ? 'bg-white/20 text-white'
                                  : acc.isChairman
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                  : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                              }`}
                            >
                              {acc.isChairman ? (
                                <Crown className="w-3.5 h-3.5" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                                isSelected ? 'border-blue-600' : 'border-slate-50 dark:border-[#111622]'
                              } ${meta.dotClass}`}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium truncate">{acc.label}</span>
                            </div>
                            <div
                              className={`text-[10px] truncate ${
                                isSelected ? 'text-blue-100' : meta.textClass
                              }`}
                            >
                              {meta.label}
                              {acc.isChairman ? ' · Chủ tịch' : ''}
                            </div>
                            {meta.currentTaskTitle && (
                              <div
                                className={`text-[9px] truncate ${
                                  isSelected ? 'text-blue-100/90' : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {meta.currentTaskTitle}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {count > 0 && (
                              <span
                                className={`text-[10px] tabular-nums ${
                                  isSelected ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {count}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={isPinging || testingAllGemini}
                              title={`Kiểm tra kết nối ${acc.label}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleTestGeminiAccount(acc.id);
                              }}
                              className={`p-1 rounded-md transition-colors cursor-pointer ${
                                isSelected
                                  ? 'text-white/80 hover:text-white hover:bg-white/15'
                                  : 'text-slate-400 hover:text-blue-600 hover:bg-blue-500/10'
                              }`}
                            >
                              <RefreshCw className={`w-3 h-3 ${isPinging ? 'animate-spin' : ''}`} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div className="px-1.5 mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Chat riêng 5 Muse AI
                  </span>
                </div>
                <div className="space-y-0.5">
                  {state.agents.map((agent) => {
                    const isSelected = !archiveMode && activeChannel === agent.id;
                    const count = messageCountByChannel[agent.id] || 0;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          setArchiveMode(false);
                          setActiveChannel(agent.id);
                        }}
                        className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors ${
                          isSelected
                            ? 'bg-slate-900 text-white dark:bg-slate-800 dark:text-white'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <AgentAvatar agent={agent} size="xs" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{agent.name}</div>
                          <div
                            className={`text-[10px] truncate ${
                              isSelected ? 'text-slate-300' : AGENT_STATUS_TEXT_CLASS[agent.status]
                            }`}
                          >
                            {AGENT_STATUS_LABEL[agent.status]}
                            {agent.id === 'muse-05' ? ' · QA' : ''}
                          </div>
                        </div>
                        {count > 0 && (
                          <span
                            className={`text-[10px] tabular-nums ${
                              isSelected ? 'text-slate-300' : 'text-slate-400 dark:text-slate-500'
                            }`}
                          >
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Group 2: Work Channels */}
          <div>
            <div className="px-2 mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Kênh điều phối
              </span>
            </div>
            <div className="space-y-0.5">
              {WORK_CHANNELS.map((ch) => {
                const isSelected = !archiveMode && activeChannel === ch.id;
                const count = messageCountByChannel[ch.id] || 0;
                const isIncident = ch.id === 'incident';
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      setArchiveMode(false);
                      setActiveChannel(ch.id);
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-slate-900 text-white dark:bg-slate-800 dark:text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {isIncident ? (
                      <AlertTriangle
                        className={`w-3.5 h-3.5 shrink-0 ${
                          openIncidentsCount > 0
                            ? 'text-rose-500'
                            : isSelected
                            ? 'text-slate-300'
                            : 'text-slate-400'
                        }`}
                      />
                    ) : (
                      <Hash
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      />
                    )}
                    <span className="text-xs font-medium truncate flex-1">{ch.shortLabel}</span>
                    {isIncident && openIncidentsCount > 0 ? (
                      <span className="text-[11px] font-semibold tabular-nums text-rose-500">
                        {openIncidentsCount}
                      </span>
                    ) : count > 0 ? (
                      <span
                        className={`text-[10px] tabular-nums ${
                          isSelected ? 'text-slate-300' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Archive Search Button */}
        <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setArchiveMode((v) => !v)}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              archiveMode
                ? 'bg-violet-600 text-white'
                : 'bg-white dark:bg-[#151B29] border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>{archiveMode ? 'Quay lại phòng chat' : 'Tra cứu toàn bộ lịch sử'}</span>
          </button>
        </div>
      </aside>

      {/* =====================================================
          MAIN CHAT CANVAS (SPACIOUS, FAST, UNCLUTTERED)
         ===================================================== */}
      <div className="flex-1 min-w-0 flex flex-col bg-white dark:bg-[#0D1119]">
        {archiveMode ? (
          /* ARCHIVE SEARCH VIEW */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Kho tra cứu lịch sử trao đổi
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tìm nhanh lệnh chỉ đạo, báo cáo QA và phản hồi trên tất cả các kênh
                </p>
              </div>
              <button
                type="button"
                onClick={() => setArchiveMode(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                Đóng tra cứu
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={archiveQuery}
                  onChange={(e) => setArchiveQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleArchiveSearch();
                  }}
                  placeholder="Nhập từ khóa, mã cảnh, mã nhiệm vụ..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-violet-500"
                />
              </div>
              <select
                value={archiveAgentFilter}
                onChange={(e) => setArchiveAgentFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="">Tất cả người gửi</option>
                <option value="chairman">Gemini AI – Chủ tịch</option>
                <option value="gemini">AI Gemini · Tiến độ</option>
                {geminiAccounts.map((g) => (
                  <option key={g.id} value={`gemini:${g.id}`}>
                    AI Gemini: {g.label}
                  </option>
                ))}
                {state.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleArchiveSearch()}
                disabled={searchingArchive}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-violet-600 text-white hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {searchingArchive ? 'Đang tìm...' : 'Tìm kiếm'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {archiveResults === null ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                  <Search className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-xs">Nhập từ khóa và nhấn Tìm kiếm để tra cứu lịch sử toàn hệ thống.</p>
                </div>
              ) : archiveResults.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                  <p className="text-xs">Không tìm thấy tin nhắn nào khớp với bộ lọc hiện tại.</p>
                </div>
              ) : (
                archiveResults.map((msg) => (
                  <div
                    key={msg.id}
                    className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#131824] p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {msg.senderName}
                        </span>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveChannel(msg.channel);
                            setArchiveMode(false);
                          }}
                          className="text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap"
                        >
                          Mở kênh #{msg.channel}
                        </button>
                      </div>
                      <span className="tabular-nums shrink-0">{formatFullDateTime(msg.createdAt)}</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* ACTIVE CHAT VIEW */
          <>
            {/* Top Channel Header */}
            <header className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {isMuseDmChannel && activeDmAgent ? (
                  <AgentAvatar agent={activeDmAgent} size="sm" />
                ) : isGeminiDmChannel && activeDmGemini ? (
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      activeDmGemini.isChairman
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    }`}
                  >
                    {activeDmGemini.isChairman ? <Crown className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  </div>
                ) : activeChannel === 'gemini' ? (
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4" />
                  </div>
                ) : activeChannel === 'commander' ? (
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Crown className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                    <Hash className="w-4 h-4" />
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {isMuseDmChannel && activeDmAgent
                        ? activeDmAgent.name
                        : isGeminiDmChannel && activeDmGemini
                        ? activeDmGemini.label
                        : activeWorkMeta?.name || `#${activeChannel}`}
                    </h3>
                    {isMuseDmChannel && activeDmAgent && (
                      <span
                        className={`text-xs font-medium whitespace-nowrap ${AGENT_STATUS_TEXT_CLASS[activeDmAgent.status]}`}
                      >
                        · {AGENT_STATUS_LABEL[activeDmAgent.status]}
                      </span>
                    )}
                    {isGeminiDmChannel && activeDmGemini && (
                      <span
                        className={`text-xs font-medium whitespace-nowrap ${getGeminiLiveMeta(activeDmGemini).textClass}`}
                      >
                        · {getGeminiLiveMeta(activeDmGemini).label}
                      </span>
                    )}
                    {lastReplyMs !== null && !sending && (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                        · Phản hồi {(lastReplyMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {isMuseDmChannel && activeDmAgent
                      ? `${activeDmAgent.roleTitle} · ${activeDmAgent.currentTaskSummary || 'Đang sẵn sàng nhận lệnh'}`
                      : isGeminiDmChannel && activeDmGemini
                      ? `AI Gemini (${activeDmGemini.maskedKey}) · ${
                          getGeminiLiveMeta(activeDmGemini).currentTaskTitle ||
                          activeDmGemini.lastError ||
                          activeDmGemini.note ||
                          'Sẵn sàng trao đổi & thực thi lệnh trực tiếp'
                        }`
                      : activeWorkMeta?.description}
                  </p>
                </div>
              </div>

              {/* Clean Header Action Controls */}
              <div className="flex items-center gap-1.5 shrink-0">
                {isGeminiDmChannel && activeDmGemini && (
                  <button
                    type="button"
                    disabled={testingGeminiId === activeDmGemini.id}
                    onClick={() => void handleTestGeminiAccount(activeDmGemini.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${testingGeminiId === activeDmGemini.id ? 'animate-spin' : ''}`} />
                    <span>Kiểm tra kết nối</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowInChannelSearch((v) => !v);
                    if (showInChannelSearch) setChannelFilterText('');
                  }}
                  title="Lọc tin nhắn trong kênh này"
                  className={`p-2 rounded-lg text-xs transition-colors ${
                    showInChannelSearch
                      ? 'bg-slate-900 text-white dark:bg-slate-700'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  <Search className="w-4 h-4" />
                </button>

                {confirmClearChannel ? (
                  <div className="flex items-center gap-1 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg px-2 py-1">
                    <button
                      type="button"
                      onClick={() => void handleClearChannel()}
                      className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline whitespace-nowrap"
                    >
                      Xác nhận xóa
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={() => setConfirmClearChannel(false)}
                      className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap"
                    >
                      Hủy
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearChannel(true)}
                    disabled={channelMessages.length === 0}
                    title="Dọn lịch sử kênh này"
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 dark:text-slate-400 disabled:opacity-35 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setRightOpen((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    rightOpen
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-800 dark:border-slate-700'
                      : 'bg-white dark:bg-[#131824] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {rightOpen ? (
                    <PanelRightClose className="w-3.5 h-3.5" />
                  ) : (
                    <PanelRightOpen className="w-3.5 h-3.5" />
                  )}
                  <span>Hồ sơ & Tác vụ</span>
                </button>
              </div>
            </header>

            {/* Optional In-Channel Filter Bar */}
            {showInChannelSearch && (
              <div className="px-5 py-2 border-b border-slate-200/70 dark:border-slate-800/70 bg-slate-50/70 dark:bg-[#111622] flex items-center gap-2 shrink-0">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={channelFilterText}
                  onChange={(e) => setChannelFilterText(e.target.value)}
                  placeholder="Lọc nhanh tin nhắn trong kênh này..."
                  className="flex-1 bg-transparent text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
                />
                {channelFilterText && (
                  <button
                    type="button"
                    onClick={() => setChannelFilterText('')}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Action Notice / Error Toast Banner */}
            {actionNotice && (
              <div className="mx-5 mt-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-3.5 py-2 flex items-center justify-between gap-2 text-xs text-emerald-800 dark:text-emerald-300 shrink-0">
                <span className="truncate">{actionNotice}</span>
                <button
                  type="button"
                  onClick={() => setActionNotice(null)}
                  className="text-emerald-600 hover:text-emerald-800 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {errorBanner && (
              <div className="mx-5 mt-3 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-rose-700 dark:text-rose-300 shrink-0">
                <span className="truncate">{errorBanner}</span>
                <button
                  type="button"
                  onClick={() => setErrorBanner(null)}
                  className="text-rose-500 hover:text-rose-700 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Top Action Strip inside #kiểm-duyệt (QA) for ALL QA-approved images -> Create Video Immediately */}
            {activeChannel === 'qa' && approvedImageScenes.length > 0 && (
              <div className="mx-5 mt-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/25 p-3 shrink-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                    <Video className="w-4 h-4 text-emerald-600" />
                    <span>Ảnh đã thông qua QA ({approvedImageScenes.length}) — Kích hoạt tạo video ngay lập tức</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setFlowFocusSceneId(null);
                        setFlowModalOpen(true);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Gói Google Flow
                    </button>
                    <button
                      type="button"
                      disabled={unsticking}
                      onClick={() => void handleUnstickTeam()}
                      className="px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {unsticking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      Gỡ treo đội AI
                    </button>
                  </div>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {approvedImageScenes.map((sc) => (
                    <div
                      key={sc.sceneId}
                      className="shrink-0 w-64 rounded-lg border border-emerald-200/80 dark:border-emerald-800/50 bg-white dark:bg-[#141925] p-2 flex gap-2 items-center"
                    >
                      {sc.keyframeImageUrl && (
                        <button
                          type="button"
                          onClick={() => setPreviewImageUrl(sc.keyframeImageUrl!)}
                          className="shrink-0"
                        >
                          <img
                            src={sc.keyframeImageUrl}
                            alt={`Cảnh ${sc.index}`}
                            className="w-14 h-14 rounded-md object-cover border border-slate-200"
                          />
                        </button>
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                            Cảnh {sc.index}: {sc.title}
                          </span>
                          {sc.videoUrl && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 shrink-0">
                              Có video
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={triggeringSceneKey !== null}
                            onClick={() => void handleTriggerSceneVideoNow(sc.sceneId, 'gemini')}
                            className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold disabled:opacity-50"
                          >
                            {triggeringSceneKey === `${sc.sceneId}:gemini` ? '...' : 'Video Gemini'}
                          </button>
                          <button
                            type="button"
                            disabled={triggeringSceneKey !== null}
                            onClick={() => void handleTriggerSceneVideoNow(sc.sceneId, 'qwen')}
                            className="px-2 py-0.5 rounded bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-semibold disabled:opacity-50"
                          >
                            {triggeringSceneKey === `${sc.sceneId}:qwen` ? '...' : 'Video Qwen'}
                          </button>
                          <button
                            type="button"
                            disabled={triggeringSceneKey !== null}
                            onClick={() => void handleTriggerSceneVideoNow(sc.sceneId, 'google_flow')}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-semibold disabled:opacity-50"
                          >
                            Google Flow
                          </button>
                          <button
                            type="button"
                            disabled={triggeringSceneKey !== null}
                            onClick={() => void handleTriggerSceneVideoNow(sc.sceneId, 'muse')}
                            className="px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[10px] font-semibold disabled:opacity-50"
                          >
                            {triggeringSceneKey === `${sc.sceneId}:muse` ? '...' : 'Muse'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Message Feed */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={feedScrollRef}
                onScroll={handleFeedScroll}
                className="h-full overflow-y-auto px-5 py-5 space-y-4"
              >
                {channelMessages.length === 0 && !optimisticMsg ? (
                  <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto py-8">
                    <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-500 dark:text-slate-400 mb-3">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      Bắt đầu trao đổi tại{' '}
                      {isMuseDmChannel && activeDmAgent
                        ? activeDmAgent.name
                        : isGeminiDmChannel && activeDmGemini
                        ? activeDmGemini.label
                        : activeWorkMeta?.name || `#${activeChannel}`}
                    </h4>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {isGeminiDmChannel && activeDmGemini
                        ? `Nhắn trực tiếp cho ${activeDmGemini.label} để kiểm tra tình trạng sẵn sàng, xem tiến độ thực thi hoặc kích hoạt tạo video AI Gemini / Google Flow.`
                        : 'Nhập chỉ đạo bên dưới hoặc bấm vào các lệnh nhanh để AI Gemini, Chủ tịch và đội Muse AI phản hồi trực tiếp theo dữ liệu phiên hiện tại.'}
                    </p>
                  </div>
                ) : (
                  channelMessages.map(renderMessageItem)
                )}

                {/* Optimistic User Message (Instant Feedback) */}
                {optimisticMsg && optimisticMsg.channel === activeChannel && (
                  <div className="flex justify-end opacity-90">
                    <div className="max-w-[78%] sm:max-w-[70%] space-y-1">
                      <div className="flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
                        <span>Bạn</span>
                        <span>·</span>
                        <span>Đang gửi...</span>
                      </div>
                      <div className="rounded-2xl rounded-tr-sm bg-slate-900 dark:bg-violet-600 text-white px-4 py-2.5 text-sm leading-relaxed">
                        <p className="whitespace-pre-wrap break-words">{optimisticMsg.content}</p>
                        {optimisticMsg.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {optimisticMsg.attachments.map((att, i) => (
                              <img
                                key={i}
                                src={att}
                                alt="Đang tải"
                                className="h-20 w-20 rounded-lg object-cover border border-white/20"
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Live Responding Indicator with Real Stopwatch */}
                {sending && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#141925] px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2.5">
                      <span className="font-medium">{responderLabel} đang xử lý lệnh...</span>
                      <span className="text-slate-400 tabular-nums">
                        {(sendElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                )}

                <div ref={bottomSentinelRef} />
              </div>

              {/* Floating Jump-to-Latest Button */}
              {!isNearBottom && (
                <button
                  type="button"
                  onClick={() => scrollToBottom('smooth')}
                  className="absolute bottom-4 right-5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium shadow-md hover:opacity-95 transition-opacity"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>{unseenCount > 0 ? `${unseenCount} tin mới` : 'Xuống mới nhất'}</span>
                </button>
              )}
            </div>

            {/* =====================================================
                QUICK COMMANDS + COMPOSER DOCK
               ===================================================== */}
            <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-[#101521] px-4 pt-2.5 pb-3 space-y-2.5 shrink-0">
              {/* 1-Click Context Quick Commands */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0 mr-0.5" />
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    type="button"
                    disabled={sending}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setInputText(cmd.prompt);
                        if (cmd.target && !isDmChannel) setTargetResponder(cmd.target);
                        textareaRef.current?.focus();
                      } else {
                        if (cmd.target && !isDmChannel) setTargetResponder(cmd.target);
                        void dispatchMessage(cmd.prompt, cmd.target);
                      }
                    }}
                    title="Bấm để gửi ngay · Giữ Shift + bấm để chỉnh sửa trước"
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#161C2B] hover:border-slate-400 dark:hover:border-slate-500 text-[11px] font-medium text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {cmd.label}
                  </button>
                ))}
              </div>

              {/* Attachment Preview Strip */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {attachments.map((att, idx) => (
                    <div
                      key={idx}
                      className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                      {att.startsWith('data:video/') ? (
                        <div className="w-16 h-16 flex items-center justify-center text-[10px] text-slate-500">
                          <Film className="w-4 h-4" />
                        </div>
                      ) : (
                        <img src={att} alt="Đính kèm" className="w-16 h-16 object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Unified Input Card */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700/90 bg-white dark:bg-[#151B29] focus-within:border-slate-400 dark:focus-within:border-violet-500/70 transition-colors">
                {/* Inline Recipient + Scene Controls */}
                <div className="px-3 pt-2 pb-1.5 border-b border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                  {!isDmChannel ? (
                    <div className="flex items-center gap-1 overflow-x-auto">
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 mr-1 whitespace-nowrap">
                        Gửi tới:
                      </span>
                      <button
                        type="button"
                        onClick={() => setTargetResponder('gemini')}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          targetResponder === 'gemini'
                            ? 'bg-blue-600 text-white'
                            : 'text-blue-700 dark:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20'
                        }`}
                      >
                        AI Gemini (Chung)
                      </button>
                      {enabledGeminiAccounts.map((acc) => {
                        const tId = `gemini:${acc.id}` as GeminiDmChannelId;
                        const active = targetResponder === tId;
                        const gm = getGeminiLiveMeta(acc);
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => setTargetResponder(tId)}
                            title={`${acc.label} — ${gm.label}`}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1 cursor-pointer ${
                              active
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-blue-500/10 hover:text-blue-700 dark:hover:text-blue-300'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : gm.dotClass}`} />
                            <span>{acc.label}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setTargetResponder('chairman')}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          targetResponder === 'chairman'
                            ? 'bg-amber-500 text-white'
                            : 'text-amber-700 dark:text-amber-300 hover:bg-amber-500/15'
                        }`}
                      >
                        Chủ tịch Gemini
                      </button>
                      {state.agents.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setTargetResponder(a.id)}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            targetResponder === a.id
                              ? 'bg-slate-900 text-white dark:bg-violet-600 dark:text-white'
                              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {AGENT_SHORT_LABEL[a.id]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Trao đổi trực tiếp 1-1 với{' '}
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {isGeminiDmChannel && activeDmGemini ? activeDmGemini.label : activeDmAgent?.name}
                      </span>
                    </div>
                  )}

                  {activeScenes.length > 0 && (
                    <select
                      value={selectedSceneId}
                      onChange={(e) => setSelectedSceneId(e.target.value)}
                      className="text-[11px] rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-2 py-0.5 max-w-[190px]"
                    >
                      <option value="">Không gắn cảnh</option>
                      {activeScenes.map((s) => (
                        <option key={s.sceneId} value={s.sceneId}>
                          Cảnh {s.index}: {s.title.slice(0, 26)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Textarea & Action Row */}
                <div className="flex items-end gap-2 px-3 py-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleAttachFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Đính kèm ảnh hoặc video tham chiếu"
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void dispatchMessage();
                      }
                    }}
                    placeholder={`Nhắn cho ${responderLabel}... (Enter để gửi, Shift+Enter xuống dòng)`}
                    className="flex-1 resize-none bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none py-1.5 max-h-[140px]"
                  />

                  <button
                    type="button"
                    disabled={sending || (!inputText.trim() && attachments.length === 0)}
                    onClick={() => void dispatchMessage()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-violet-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity whitespace-nowrap shrink-0"
                  >
                    {sending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Gửi</span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* =====================================================
          COLLAPSIBLE RIGHT INSPECTOR (CLOSED BY DEFAULT)
         ===================================================== */}
      {rightOpen && (
        <aside className="w-[296px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-[#111622] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              {isMuseDmChannel && activeDmAgent
                ? `Hồ sơ ${activeDmAgent.name}`
                : isGeminiDmChannel && activeDmGemini
                ? `Hồ sơ ${activeDmGemini.label}`
                : 'Ngữ cảnh phiên hiện tại'}
            </span>
            <button
              type="button"
              onClick={() => setRightOpen(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Session Summary */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Phiên sản xuất
              </div>
              <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#151B29] p-3 space-y-1.5">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {state.projectMemory?.title || activeRun?.title || 'Chưa chọn dự án'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  Memory v{state.projectMemory?.version || 1} · {state.projectMemory?.characters.length || 0} nhân vật ·{' '}
                  {activeScenes.length} cảnh
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Chủ tịch: <span className="text-amber-600 dark:text-amber-400 font-medium">{chairmanAccountLabel}</span>
                </div>
              </div>
            </div>

            {/* Active DM Gemini Account Stats */}
            {isGeminiDmChannel && activeDmGemini && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Tình trạng AI Gemini này
                  </span>
                  <button
                    type="button"
                    disabled={testingGeminiId === activeDmGemini.id}
                    onClick={() => void handleTestGeminiAccount(activeDmGemini.id)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    {testingGeminiId === activeDmGemini.id ? 'Đang kiểm tra...' : 'Kiểm tra ngay'}
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#151B29] p-3 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Trạng thái</span>
                    <span className={`font-semibold ${getGeminiLiveMeta(activeDmGemini).textClass}`}>
                      {getGeminiLiveMeta(activeDmGemini).label}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {activeDmGemini.successCount}
                      </div>
                      <div className="text-[10px] text-slate-500">Thành công</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                        {activeDmGemini.errorCount}
                      </div>
                      <div className="text-[10px] text-slate-500">Lỗi</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                        {activeDmGemini.lastLatencyMs ? `${activeDmGemini.lastLatencyMs}ms` : '—'}
                      </div>
                      <div className="text-[10px] text-slate-500">Độ trễ</div>
                    </div>
                  </div>
                  {activeDmGemini.lastError && (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 rounded-lg p-2">
                      {activeDmGemini.lastError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Active DM Agent Stats */}
            {isMuseDmChannel && activeDmAgent && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Hiệu suất AI này
                </div>
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#151B29] p-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {activeDmAgent.stats.completed}
                    </div>
                    <div className="text-[10px] text-slate-500">Xong</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                      {activeDmAgent.stats.failed}
                    </div>
                    <div className="text-[10px] text-slate-500">Lỗi</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                      {activeDmAgent.avgResponseMs && activeDmAgent.avgResponseMs > 0
                        ? `${(activeDmAgent.avgResponseMs / 1000).toFixed(1)}s`
                        : '—'}
                    </div>
                    <div className="text-[10px] text-slate-500">Tốc độ</div>
                  </div>
                </div>
              </div>
            )}

            {/* Open Incidents */}
            {openIncidentsCount > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-500">
                    Sự cố đang mở ({openIncidentsCount})
                  </span>
                  <button
                    type="button"
                    onClick={() => onJumpToIncident?.()}
                    className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Xem tất cả
                  </button>
                </div>
                <div className="space-y-1.5">
                  {(state.incidents || [])
                    .filter((i) => i.status !== 'resolved')
                    .slice(0, 4)
                    .map((inc) => (
                      <button
                        key={inc.id}
                        type="button"
                        onClick={() => onJumpToIncident?.(inc.id)}
                        className="w-full text-left rounded-lg border border-rose-200/70 dark:border-rose-500/25 bg-white dark:bg-[#151B29] p-2.5 hover:border-rose-400 transition-colors"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-rose-600 dark:text-rose-400">{inc.code}</span>
                          <span className="text-slate-400 tabular-nums">
                            Vòng {inc.attemptCount}/{inc.maxAttempts}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                          {inc.categoryLabel}: {inc.errorDescription}
                        </p>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Relevant Tasks */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Nhiệm vụ liên quan ({contextTasks.length})
                </span>
                <button
                  type="button"
                  onClick={() => onJumpToTask?.('')}
                  className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline"
                >
                  Hàng đợi
                </button>
              </div>
              {contextTasks.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">Không có tác vụ đang chờ hoặc chạy.</p>
              ) : (
                <div className="space-y-1.5">
                  {contextTasks.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onJumpToTask?.(t.id)}
                      className="w-full text-left rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#151B29] p-2.5 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{t.code}</span>
                        <span className="text-slate-400 truncate">{t.assignedAgentId.toUpperCase()}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400 truncate">
                        {t.title}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Locked Scenes Quick Jump */}
            {activeScenes.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Phân cảnh phiên ({activeScenes.length})
                </span>
                <div className="space-y-1">
                  {activeScenes.slice(0, 8).map((sc) => (
                    <button
                      key={sc.sceneId}
                      type="button"
                      onClick={() => {
                        setSelectedSceneId(sc.sceneId);
                        textareaRef.current?.focus();
                      }}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-[11px] bg-white dark:bg-[#151B29] border border-slate-200/70 dark:border-slate-800 hover:border-violet-400 transition-colors"
                    >
                      <span className="truncate text-slate-700 dark:text-slate-200">
                        Cảnh {sc.index}: {sc.title}
                      </span>
                      <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Clean Image Lightbox */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-6"
        >
          <div className="relative max-w-4xl max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewImageUrl(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white inline-flex items-center gap-1 text-xs"
            >
              <X className="w-4 h-4" />
              Đóng
            </button>
            <img
              src={previewImageUrl}
              alt="Xem ảnh lớn"
              className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Google Flow Script & Keyframe Handoff Modal */}
      <GoogleFlowModal
        open={flowModalOpen}
        runId={activeRun?.id || state.selectedRunId || undefined}
        focusSceneId={flowFocusSceneId}
        onClose={() => {
          setFlowModalOpen(false);
          setFlowFocusSceneId(null);
        }}
        onStateUpdated={(next) => setState(next)}
      />
    </div>
  );
};
