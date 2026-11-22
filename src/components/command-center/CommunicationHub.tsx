import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Clapperboard,
  Crown,
  Film,
  Hash,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Search,
  Send,
  ShieldCheck,
  Siren,
  Terminal,
  X,
} from 'lucide-react';
import type {
  CommandCenterState,
  CommunicationChannelId,
  MuseAgentId,
} from '../../types/commandCenter';
import { AgentAvatar } from './AgentAvatar';
import { commandCenterApiJson } from '../../hooks/useCommandCenterLive';

export const TEAM_CHANNELS: {
  id: Exclude<CommunicationChannelId, MuseAgentId | 'chairman'>;
  slug: string;
  label: string;
  purpose: string;
  defaultResponder: MuseAgentId | 'chairman';
  highPriority?: boolean;
}[] = [
  {
    id: 'commander',
    slug: '#tổng-chỉ-huy',
    label: 'Tổng chỉ huy',
    purpose: 'Người dùng giao lệnh trực tiếp cho Gemini AI – Chủ tịch để chỉ đạo cả 5 Muse AI',
    defaultResponder: 'chairman',
  },
  {
    id: 'incident',
    slug: '#incident-command',
    label: 'INCIDENT COMMAND',
    purpose: 'Trung tâm xử lý sự cố — Muse AI 05 báo lỗi trực tiếp về Gemini AI – Chủ tịch để chất vấn và ra lệnh sửa',
    defaultResponder: 'chairman',
    highPriority: true,
  },
  {
    id: 'production',
    slug: '#sản-xuất-phim',
    label: 'Sản xuất phim',
    purpose: 'Gemini AI – Chủ tịch điều phối tiến độ song song của 4 Muse sản xuất & Muse 05 QA',
    defaultResponder: 'chairman',
  },
  {
    id: 'script',
    slug: '#kịch-bản',
    label: 'Kịch bản & Khóa nhân vật',
    purpose: 'Gemini AI – Chủ tịch phân tích kịch bản, khóa cứng nhân vật tham chiếu và phân cảnh',
    defaultResponder: 'chairman',
  },
  {
    id: 'visual',
    slug: '#hình-ảnh',
    label: 'Hình ảnh',
    purpose: 'Nhóm sản xuất (Muse Director 01, Muse 02, 03, 04) trao đổi ảnh phân cảnh & khóa nhân vật',
    defaultResponder: 'muse-02',
  },
  {
    id: 'video',
    slug: '#video',
    label: 'Video',
    purpose: 'Nhóm sản xuất (Muse Director 01, Muse 02, 03, 04) trao đổi prompt chuyển động, góc quay & video',
    defaultResponder: 'muse-04',
  },
  {
    id: 'qa',
    slug: '#kiểm-duyệt',
    label: 'Kiểm duyệt (Muse 05)',
    purpose: 'Muse AI 05 kiểm định độc lập theo ngưỡng 5% (sau loại trừ phụ kiện được phép) & báo về Chủ tịch',
    defaultResponder: 'muse-05',
  },
  {
    id: 'ai_bus',
    slug: '#trao-đổi-ai',
    label: 'Trao đổi AI',
    purpose: 'Luồng chỉ thị trực tiếp giữa Gemini AI – Chủ tịch và 5 Muse AI qua Bus tốc độ cao',
    defaultResponder: 'chairman',
  },
];

function getRoleBadgeClass(badge: string): string {
  const b = badge.toLowerCase();
  if (b.includes('báo cáo lỗi') || b.includes('cần can thiệp') || b.includes('cần người dùng')) {
    return 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35';
  }
  if (b.includes('điều hành') || b.includes('chỉ đạo')) {
    return 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35';
  }
  if (b.includes('giải trình')) {
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35';
  }
  if (b.includes('phản hồi')) {
    return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35';
  }
  if (b.includes('kiểm duyệt') || b.includes('đóng sự cố')) {
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35';
  }
  return 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30';
}

interface CommunicationHubProps {
  state: CommandCenterState;
  setState: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  initialChannel?: CommunicationChannelId;
  onJumpToTask?: (taskId: string) => void;
  onJumpToScene?: (sceneId: string) => void;
  onJumpToIncident?: (incidentId?: string) => void;
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được tệp đã chọn.'));
    reader.readAsDataURL(file);
  });
}

export const CommunicationHub: React.FC<CommunicationHubProps> = ({
  state,
  setState,
  initialChannel = 'commander',
  onJumpToTask,
  onJumpToScene,
  onJumpToIncident,
}) => {
  const [activeChannel, setActiveChannel] = useState<CommunicationChannelId>(initialChannel);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [onlyCurrentSession, setOnlyCurrentSession] = useState(false);
  const [responderAgentId, setResponderAgentId] = useState<MuseAgentId | 'chairman'>('chairman');
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [composerText, setComposerText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<{ url: string; fileName: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [lastSeenByChannel, setLastSeenByChannel] = useState<Record<string, number>>(() => ({
    [initialChannel]: Date.now(),
  }));

  useEffect(() => {
    setActiveChannel(initialChannel);
    const meta = TEAM_CHANNELS.find((c) => c.id === initialChannel);
    setResponderAgentId(meta ? meta.defaultResponder : (initialChannel as MuseAgentId | 'chairman'));
    setLastSeenByChannel((prev) => ({ ...prev, [initialChannel]: Date.now() }));
  }, [initialChannel]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const agents = state.agents;
  const chairmanName = state.chairmanConfig?.name || 'Gemini AI – Chủ tịch';
  const chairmanTitle = state.chairmanConfig?.title || 'Chủ tịch & Tổng chỉ huy toàn bộ hệ thống 5 Muse AI';
  const activeRunId = state.selectedRunId || state.activeRun?.id || '';
  const activeChannelMeta = TEAM_CHANNELS.find((c) => c.id === activeChannel);
  const isChairmanDm = activeChannel === 'chairman';
  const dmAgent = agents.find((a) => a.id === activeChannel);
  const openIncidents = useMemo(
    () => (state.incidents || []).filter((i) => i.status !== 'resolved'),
    [state.incidents]
  );

  const handleSelectChannel = (ch: CommunicationChannelId) => {
    setActiveChannel(ch);
    setLastSeenByChannel((prev) => ({ ...prev, [ch]: Date.now() }));
    const meta = TEAM_CHANNELS.find((c) => c.id === ch);
    if (meta) {
      setResponderAgentId(meta.defaultResponder);
    } else {
      setResponderAgentId(ch as MuseAgentId | 'chairman');
    }
  };

  const unreadCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const msg of state.conversations) {
      const ch = msg.channel === ('group' as any) ? 'commander' : msg.channel;
      if (ch === activeChannel) continue;
      const seenAt = lastSeenByChannel[ch] || 0;
      if (msg.createdAt > seenAt) {
        map[ch] = (map[ch] || 0) + 1;
      }
    }
    return map;
  }, [state.conversations, activeChannel, lastSeenByChannel]);

  const visibleMessages = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return state.conversations.filter((m) => {
      const normalizedCh = m.channel === ('group' as any) ? 'commander' : m.channel;
      if (normalizedCh !== activeChannel) return false;
      if (onlyCurrentSession && activeRunId) {
        const msgSession = m.sessionId || m.runId;
        if (msgSession && msgSession !== activeRunId) return false;
      }
      if (q) {
        const hay = `${m.senderName} ${m.content} ${m.taskId || ''} ${m.sceneId || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [state.conversations, activeChannel, onlyCurrentSession, activeRunId, searchTerm]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (files.length === 0) return;
    setIsUploading(true);
    setChatError('');
    try {
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const uploaded = await commandCenterApiJson<{ url: string; fileName: string }>(
          '/api/command-center/attachments',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, filename: file.name }),
          }
        );
        setPendingAttachments((prev) => [...prev, uploaded].slice(0, 6));
      }
    } catch (err: any) {
      setChatError(err?.message || 'Không thể tải tệp đính kèm.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!composerText.trim() && pendingAttachments.length === 0) || isSending) return;
    setIsSending(true);
    setChatError('');
    try {
      const res = await commandCenterApiJson<{ state: CommandCenterState }>('/api/command-center/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeChannel,
          message: composerText.trim(),
          targetAgentId: isChairmanDm ? 'chairman' : dmAgent ? dmAgent.id : responderAgentId,
          attachments: pendingAttachments.map((a) => a.url),
          sceneId: selectedSceneId || undefined,
          sessionId: activeRunId || undefined,
        }),
      });
      setState(res.state);
      setComposerText('');
      setPendingAttachments([]);
      setLastSeenByChannel((prev) => ({ ...prev, [activeChannel]: Date.now() }));
    } catch (err: any) {
      setChatError(err?.message || 'Không thể gửi tin nhắn.');
    } finally {
      setIsSending(false);
    }
  };

  const drawerAgents = dmAgent
    ? [dmAgent]
    : activeChannel === 'visual' || activeChannel === 'video'
    ? agents.filter((a) => ['muse-01', 'muse-02', 'muse-03', 'muse-04'].includes(a.id))
    : activeChannel === 'qa'
    ? agents.filter((a) => a.id === 'muse-05')
    : agents;

  const activeSessionTasks = useMemo(() => {
    const list = activeRunId ? state.tasks.filter((t) => t.runId === activeRunId) : state.tasks;
    return list.slice(0, 8);
  }, [state.tasks, activeRunId]);

  return (
    <section className="glass-card rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700/50 flex flex-col lg:flex-row min-h-[620px]">
      {/* Collapsible Left Channel Sidebar */}
      {leftOpen && (
        <aside className="w-full lg:w-[250px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#090d1c]/80 p-3.5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700/40">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                AI MUSE HUB
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {state.metrics.connectedAgents}/5 AI trực tuyến
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLeftOpen(false)}
              title="Thu gọn danh sách kênh"
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10 cursor-pointer"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            <div className="px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">KÊNH</div>
            {TEAM_CHANNELS.map((ch) => {
              const unread = unreadCounts[ch.id] || 0;
              const isSelected = activeChannel === ch.id;
              const isIncidentCh = ch.id === 'incident';
              const incidentCount = isIncidentCh ? openIncidents.length : 0;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => handleSelectChannel(ch.id)}
                  className={`w-full px-2.5 py-2 rounded-xl text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                    isSelected
                      ? isIncidentCh
                        ? 'bg-rose-600 text-white font-semibold shadow-sm'
                        : 'bg-violet-600 text-white font-semibold shadow-sm'
                      : isIncidentCh && incidentCount > 0
                      ? 'text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/15 font-semibold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    {isIncidentCh ? (
                      <Siren className="w-3.5 h-3.5 shrink-0" />
                    ) : ch.id === 'ai_bus' ? (
                      <Terminal className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    ) : ch.id === 'qa' ? (
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    ) : ch.id === 'video' ? (
                      <Film className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    ) : ch.id === 'visual' ? (
                      <ImageIcon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    ) : ch.id === 'production' ? (
                      <Clapperboard className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    ) : (
                      <Hash className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    )}
                    <span className="truncate">{ch.label}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {isIncidentCh && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {incidentCount > 0 ? `${incidentCount} mở` : 'Ưu tiên'}
                      </span>
                    )}
                    {unread > 0 && (
                      <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-mono tabular-nums font-bold">
                        {unread}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1 pt-2 border-t border-slate-200/80 dark:border-slate-700/40">
            <div className="px-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              CHỈ HUY &amp; TIN NHẮN RIÊNG 1-1
            </div>
            <button
              type="button"
              onClick={() => handleSelectChannel('chairman')}
              className={`w-full px-2 py-2 rounded-xl text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                activeChannel === 'chairman'
                  ? 'bg-amber-600 text-white font-semibold shadow-sm'
                  : 'text-amber-800 dark:text-amber-200 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15 font-semibold'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <AgentAvatar fallbackId="chairman" avatarPreset="crown_star" accentColor="#D97706" size="xs" />
                <span className="truncate">{chairmanName}</span>
              </span>
              {(unreadCounts['chairman'] || 0) > 0 ? (
                <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-mono tabular-nums font-bold">
                  {unreadCounts['chairman']}
                </span>
              ) : (
                <span className={`text-[10px] truncate max-w-[70px] ${activeChannel === 'chairman' ? 'text-white/85' : 'text-amber-700 dark:text-amber-300'}`}>
                  Tổng chỉ huy
                </span>
              )}
            </button>
            {agents.map((ag) => {
              const unread = unreadCounts[ag.id] || 0;
              const isSelected = activeChannel === ag.id;
              return (
                <button
                  key={ag.id}
                  type="button"
                  onClick={() => handleSelectChannel(ag.id)}
                  className={`w-full px-2 py-2 rounded-xl text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                    isSelected
                      ? 'bg-violet-600 text-white font-semibold shadow-sm'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <AgentAvatar agent={ag} size="xs" showStatusDot />
                    <span className="truncate">{ag.name}</span>
                  </span>
                  {unread > 0 ? (
                    <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-mono tabular-nums font-bold">
                      {unread}
                    </span>
                  ) : (
                    <span className={`text-[10px] truncate max-w-[75px] ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                      {ag.roleTitle}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {/* Main Message Feed */}
      <div className="flex-1 flex flex-col min-w-0 bg-white/60 dark:bg-[#0c1021]/60">
        {/* Feed Top Header */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-700/45 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {!leftOpen && (
              <button
                type="button"
                onClick={() => setLeftOpen(true)}
                title="Mở danh sách kênh"
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            {isChairmanDm && (
              <AgentAvatar fallbackId="chairman" avatarPreset="crown_star" accentColor="#D97706" size="sm" />
            )}
            {dmAgent && <AgentAvatar agent={dmAgent} size="sm" showStatusDot />}
            <div className="min-w-0">
              <h2 className="text-sm font-display font-bold text-slate-900 dark:text-white truncate">
                {activeChannelMeta
                  ? `${activeChannelMeta.slug} — ${activeChannelMeta.label}`
                  : isChairmanDm
                  ? `Chỉ huy tối cao: ${chairmanName}`
                  : dmAgent
                  ? `DM: ${dmAgent.name} (${dmAgent.roleTitle})`
                  : activeChannel}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {activeChannelMeta?.purpose || (isChairmanDm ? chairmanTitle : dmAgent?.description)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Tìm trong kênh..."
                className="h-8 pl-8 pr-2.5 w-40 sm:w-48 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              />
            </div>

            {activeRunId && (
              <button
                type="button"
                onClick={() => setOnlyCurrentSession((v) => !v)}
                className={`h-8 px-2.5 rounded-lg border text-[11px] font-medium cursor-pointer whitespace-nowrap ${
                  onlyCurrentSession
                    ? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-300'
                    : 'border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-300'
                }`}
              >
                {onlyCurrentSession ? 'Đang lọc phiên này' : 'Tất cả phiên'}
              </button>
            )}

            {!dmAgent && !isChairmanDm && (
              <select
                value={responderAgentId}
                onChange={(e) => setResponderAgentId(e.target.value as MuseAgentId | 'chairman')}
                className="h-8 px-2 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-700 dark:text-slate-200"
              >
                <option value="chairman">Phản hồi: {chairmanName} (Tổng chỉ huy)</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    Phản hồi: {ag.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setRightOpen((v) => !v)}
              title="Bật/tắt bảng thông tin AI"
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              {rightOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Incident Command Strip */}
        {activeChannel === 'incident' && (
          <div className="px-3.5 py-2.5 border-b border-rose-500/25 bg-rose-50/70 dark:bg-rose-950/25 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 font-bold text-rose-700 dark:text-rose-300">
                <Siren className="w-3.5 h-3.5" />
                <span>ƯU TIÊN CAO</span>
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                {openIncidents.length > 0
                  ? `${openIncidents.length} sự cố đang được ${chairmanName} trực tiếp điều phối:`
                  : 'Chưa có sự cố đang mở. Mọi báo cáo từ Muse AI 05 hoặc lỗi tác vụ sẽ báo thẳng về Gemini AI – Chủ tịch.'}
              </span>
              {openIncidents.slice(0, 3).map((inc) => (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => onJumpToIncident?.(inc.id)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-mono border cursor-pointer ${
                    inc.status === 'escalated_to_user'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white/85 dark:bg-[#0c1021] text-slate-800 dark:text-slate-200 border-rose-300 dark:border-rose-700/50'
                  }`}
                >
                  {inc.code} · {inc.attemptCount}/{inc.maxAttempts}
                </button>
              ))}
            </div>
            {onJumpToIncident && (
              <button
                type="button"
                onClick={() => onJumpToIncident(openIncidents[0]?.id)}
                className="text-[11px] font-semibold text-rose-700 dark:text-rose-300 underline cursor-pointer shrink-0"
              >
                Mở Trung tâm sự cố →
              </button>
            )}
          </div>
        )}

        {/* Message List */}
        <div className="flex-1 overflow-y-auto max-h-[460px] p-4 space-y-3">
          {visibleMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-14 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <MessageSquare className="w-7 h-7 opacity-50" />
              <div>
                Chưa có tin nhắn phù hợp trong kênh{' '}
                <strong>{activeChannelMeta?.slug || (isChairmanDm ? chairmanName : dmAgent?.name)}</strong>.
              </div>
              <div className="text-[11px] max-w-sm">
                Bạn có thể nhắn lệnh trực tiếp, đính kèm ảnh tham chiếu hoặc chọn phân cảnh cần xử lý bên dưới.
              </div>
            </div>
          ) : (
            visibleMessages.map((msg) => {
              const senderAgent = agents.find((a) => a.id === msg.senderId);
              const isUser = msg.senderType === 'user';
              const isChairman = msg.senderId === 'chairman';
              const isBus = msg.messageKind === 'ai_bus';
              return (
                <div
                  key={msg.id}
                  className={`rounded-xl p-3 text-xs border space-y-1.5 ${
                    isUser
                      ? 'bg-violet-50/80 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800/50 ml-6'
                      : isChairman
                      ? 'bg-amber-50/75 dark:bg-amber-950/20 border-amber-400/50 mr-2'
                      : isBus
                      ? 'bg-slate-100/90 dark:bg-[#101730] border-cyan-500/35'
                      : 'bg-white dark:bg-[#0c1021] border-slate-200 dark:border-slate-700/50 mr-4'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {!isUser && (
                        <AgentAvatar
                          agent={senderAgent}
                          avatarUrl={msg.senderAvatarUrl}
                          avatarPreset={isChairman ? 'crown_star' : undefined}
                          fallbackName={isChairman ? 'Chủ tịch Điều hành AI' : undefined}
                          accentColor={msg.senderColor || (isChairman ? '#D97706' : undefined)}
                          size="xs"
                        />
                      )}
                      <span
                        className="font-bold text-slate-900 dark:text-white truncate"
                        style={!isUser && (senderAgent?.accentColor || msg.senderColor || (isChairman ? '#D97706' : undefined))
                          ? { color: senderAgent?.accentColor || msg.senderColor || (isChairman ? '#D97706' : undefined) }
                          : undefined}
                      >
                        {msg.senderName}
                      </span>
                      {senderAgent && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {senderAgent.roleTitle}
                        </span>
                      )}
                      {msg.roleBadge && (
                        <span
                          className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${getRoleBadgeClass(
                            msg.roleBadge
                          )}`}
                        >
                          {msg.roleBadge}
                        </span>
                      )}
                      {isBus && (
                        <span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-300">
                          [AI-BUS]
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {msg.incidentId && onJumpToIncident && (
                        <button
                          type="button"
                          onClick={() => onJumpToIncident(msg.incidentId)}
                          className="underline text-rose-600 dark:text-rose-300 cursor-pointer"
                        >
                          Hồ sơ sự cố
                        </button>
                      )}
                      {msg.sceneId && (
                        <button
                          type="button"
                          onClick={() => onJumpToScene?.(msg.sceneId!)}
                          className="underline text-violet-600 dark:text-violet-300 cursor-pointer"
                        >
                          {msg.sceneId}
                        </button>
                      )}
                      {msg.taskId && (
                        <button
                          type="button"
                          onClick={() => onJumpToTask?.(msg.taskId!)}
                          className="underline text-cyan-600 dark:text-cyan-300 cursor-pointer"
                        >
                          {msg.taskId}
                        </button>
                      )}
                      <span>{fmtDateTime(msg.createdAt)}</span>
                    </div>
                  </div>

                  <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed">
                    {msg.content}
                  </div>

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {msg.attachments.map((att, idx) =>
                        att.endsWith('.mp4') || att.endsWith('.webm') ? (
                          <video
                            key={idx}
                            src={att}
                            controls
                            className="h-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-black"
                          />
                        ) : (
                          <img
                            key={idx}
                            src={att}
                            alt="Đính kèm"
                            className="h-24 w-auto rounded-lg border border-slate-200 dark:border-slate-700 object-cover"
                          />
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <form onSubmit={handleSend} className="p-3.5 border-t border-slate-200 dark:border-slate-700/45 space-y-2.5 bg-white/80 dark:bg-[#0a0f1f]/90">
          {chatError && (
            <div className="text-[11px] text-rose-600 dark:text-rose-400">{chatError}</div>
          )}

          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {pendingAttachments.map((att, idx) => (
                <div
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0c1021] text-[11px] text-slate-700 dark:text-slate-200"
                >
                  <span className="truncate max-w-[140px]">{att.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/mp4,video/webm,.txt,.json"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              title="Đính kèm ảnh / video / kịch bản"
              className="h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
            >
              {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">Đính kèm</span>
            </button>

            <select
              value={selectedSceneId}
              onChange={(e) => setSelectedSceneId(e.target.value)}
              className="h-9 px-2 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-600 dark:text-slate-300 max-w-[150px]"
            >
              <option value="">Liên kết cảnh...</option>
              {state.projectMemory.scenes.map((sc) => (
                <option key={sc.sceneId} value={sc.sceneId}>
                  Cảnh {sc.index}: {sc.title}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              disabled={isSending}
              placeholder={`Nhắn vào ${activeChannelMeta?.slug || (isChairmanDm ? chairmanName : dmAgent?.name) || 'kênh'}...`}
              className="flex-1 min-w-[180px] h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-500"
            />

            <button
              type="submit"
              disabled={isSending || (!composerText.trim() && pendingAttachments.length === 0)}
              className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Gửi</span>
            </button>
          </div>
        </form>
      </div>

      {/* Collapsible Right Profile & Task Inspector Drawer */}
      {rightOpen && (
        <aside className="w-full lg:w-[270px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#090d1c]/80 p-3.5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700/40">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Hồ sơ &amp; Tác vụ liên kết
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {state.projectMemory.scenes.length} cảnh
            </span>
          </div>

          <div className="space-y-2">
            {(!dmAgent || isChairmanDm) && (
              <div className="rounded-xl border border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/25 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Crown className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{chairmanName}</div>
                    <div className="text-[10px] text-amber-700 dark:text-amber-300 truncate">Chủ tịch &amp; Tổng chỉ huy</div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                  Trực tiếp phân công 4 Muse sản xuất Ảnh/Video, tiếp nhận QA từ Muse 05 và chất vấn xử lý sự cố.
                </div>
              </div>
            )}
            {!isChairmanDm && drawerAgents.map((ag) => (
              <div
                key={ag.id}
                className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white/85 dark:bg-[#0c1021] p-2.5 space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <AgentAvatar agent={ag} size="sm" showStatusDot />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-white truncate">{ag.name}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{ag.roleTitle}</div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                  {ag.currentTaskSummary || ag.description}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200/80 dark:border-slate-700/40">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <Activity className="w-3.5 h-3.5" />
              <span>Tác vụ gần đây</span>
            </div>
            {activeSessionTasks.length === 0 ? (
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Chưa có tác vụ nào.</div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {activeSessionTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onJumpToTask?.(t.id)}
                    className="w-full text-left p-2 rounded-lg border border-slate-200/80 dark:border-slate-700/45 bg-white/70 dark:bg-[#0c1021]/70 hover:border-violet-400/50 cursor-pointer space-y-0.5"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span>{t.code}</span>
                      <span>{t.status}</span>
                    </div>
                    <div className="text-[11px] font-medium text-slate-800 dark:text-slate-200 truncate">
                      {t.title}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
    </section>
  );
};
