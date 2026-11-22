import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageSquareWarning,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Shirt,
  Siren,
} from 'lucide-react';
import type {
  CommandCenterState,
  IncidentCategory,
  IncidentRecord,
  IncidentSeverity,
  IncidentStatus,
  MuseAgentId,
} from '../../types/commandCenter';
import { AgentAvatar } from './AgentAvatar';

const INCIDENT_CATEGORY_OPTIONS: { id: IncidentCategory; label: string }[] = [
  { id: 'wrong_dialogue', label: 'Sai lời thoại / nhầm thoại nhân vật' },
  { id: 'wrong_voice', label: 'Sai giọng đọc / nhầm giới tính' },
  { id: 'wrong_character', label: 'Sai gương mặt / nhân vật' },
  { id: 'wrong_costume', label: 'Sai trang phục / phụ kiện' },
  { id: 'wrong_setting', label: 'Sai bối cảnh / lỗi nối cảnh' },
  { id: 'motion_error', label: 'Sai chuyển động / sai góc quay' },
  { id: 'ai_output_format_error', label: 'Lỗi định dạng / JSON từ AI' },
  { id: 'video_technical_error', label: 'Lỗi kỹ thuật video / âm thanh' },
  { id: 'muse_disconnected', label: 'Muse AI mất kết nối / quá thời gian' },
  { id: 'recurring_error', label: 'Lỗi lặp lại nhiều lần' },
];

const STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: 'Mới báo cáo',
  investigating: 'Muse 01 đang điều tra',
  remediating: 'Đang sửa chữa',
  verifying: 'Muse 05 kiểm duyệt lại',
  resolved: 'Đã đóng (QA đạt)',
  escalated_to_user: 'Cần bạn can thiệp',
};

const STATUS_BADGE_CLASS: Record<IncidentStatus, string> = {
  reported: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35',
  investigating: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/35',
  remediating: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/35',
  verifying: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/35',
  resolved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35',
  escalated_to_user: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/45 font-bold',
};

const SEVERITY_BADGE_CLASS: Record<IncidentSeverity, string> = {
  low: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  high: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

const TURN_BADGE_CLASS: Record<string, string> = {
  report: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  question: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  explanation: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  directive: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  progress: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  qa_review: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  resolution: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  escalation: 'bg-rose-600/20 text-rose-700 dark:text-rose-200 border-rose-500/45',
};

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

interface IncidentCommandTabProps {
  state: CommandCenterState;
  initialSelectedIncidentId?: string | null;
  busyAction: string;
  onRunAction: (
    key: string,
    fn: () => Promise<CommandCenterState | null | void>,
    okNotice?: string
  ) => Promise<void>;
  onOpenIncidentChannel: () => void;
  apiJson: <T = any>(url: string, init?: RequestInit) => Promise<T>;
}

export const IncidentCommandTab: React.FC<IncidentCommandTabProps> = ({
  state,
  initialSelectedIncidentId,
  busyAction,
  onRunAction,
  onOpenIncidentChannel,
  apiJson,
}) => {
  const incidents = state.incidents || [];
  const agents = state.agents || [];
  const scenes = state.projectMemory?.scenes || [];

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'escalated' | 'resolved'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedIncidentId || incidents[0]?.id || null);
  const [showReportForm, setShowReportForm] = useState(false);

  // Manual incident report fields
  const [repReporter, setRepReporter] = useState<MuseAgentId>('muse-04');
  const [repResponsible, setRepResponsible] = useState<MuseAgentId>('muse-04');
  const [repCategory, setRepCategory] = useState<IncidentCategory>('wrong_dialogue');
  const [repSeverity, setRepSeverity] = useState<IncidentSeverity>('high');
  const [repSceneId, setRepSceneId] = useState('');
  const [repErrorDesc, setRepErrorDesc] = useState('');
  const [repRootCause, setRepRootCause] = useState('');
  const [repProposal, setRepProposal] = useState('');
  const [repRequireApproval, setRepRequireApproval] = useState(false);

  // Director command bar fields
  const [cmdText, setCmdText] = useState('');
  const [cmdTargetAgent, setCmdTargetAgent] = useState<MuseAgentId>('muse-04');

  useEffect(() => {
    if (initialSelectedIncidentId) {
      setSelectedId(initialSelectedIncidentId);
    }
  }, [initialSelectedIncidentId]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (statusFilter === 'active') return !['resolved', 'escalated_to_user'].includes(inc.status);
      if (statusFilter === 'escalated') return inc.status === 'escalated_to_user';
      if (statusFilter === 'resolved') return inc.status === 'resolved';
      return true;
    });
  }, [incidents, statusFilter]);

  const selectedIncident: IncidentRecord | undefined = useMemo(() => {
    if (selectedId) {
      const found = incidents.find((i) => i.id === selectedId);
      if (found) return found;
    }
    return filteredIncidents[0] || incidents[0];
  }, [incidents, filteredIncidents, selectedId]);

  useEffect(() => {
    if (selectedIncident) {
      setCmdTargetAgent(selectedIncident.assignedFixAgentId);
    }
  }, [selectedIncident?.id, selectedIncident?.assignedFixAgentId]);

  const counts = useMemo(() => {
    let active = 0;
    let escalated = 0;
    let resolved = 0;
    for (const i of incidents) {
      if (i.status === 'escalated_to_user') escalated += 1;
      else if (i.status === 'resolved') resolved += 1;
      else active += 1;
    }
    return { total: incidents.length, active, escalated, resolved };
  }, [incidents]);

  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repErrorDesc.trim()) return;
    await onRunAction(
      'report_incident',
      async () => {
        const res = await apiJson<{ state: CommandCenterState; incident: IncidentRecord }>(
          '/api/command-center/incidents',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId: state.selectedRunId || state.activeRun?.id,
              sceneId: repSceneId || undefined,
              reporterAgentId: repReporter,
              responsibleAgentId: repResponsible,
              category: repCategory,
              severity: repSeverity,
              errorDescription: repErrorDesc.trim(),
              suspectedRootCause: repRootCause.trim() || undefined,
              initialProposal: repProposal.trim() || undefined,
              requiresUserApproval: repRequireApproval,
            }),
          }
        );
        setSelectedId(res.incident.id);
        setShowReportForm(false);
        setRepErrorDesc('');
        setRepRootCause('');
        setRepProposal('');
        setRepRequireApproval(false);
        return res.state;
      },
      'Đã gửi báo cáo sự cố khẩn tới Muse AI 01 — Đạo diễn tổng.'
    );
  };

  const handleDirectorAction = async (
    action: 'directive' | 'reopen' | 'escalate' | 'resolve',
    explicitMsg?: string
  ) => {
    if (!selectedIncident) return;
    await onRunAction(
      `inc_${action}_${selectedIncident.id}`,
      async () => {
        const next = await apiJson<CommandCenterState>(
          `/api/command-center/incidents/${encodeURIComponent(selectedIncident.id)}/command`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              message: (explicitMsg ?? cmdText).trim() || undefined,
              targetAgentId: cmdTargetAgent,
            }),
          }
        );
        if (action === 'directive') setCmdText('');
        return next;
      },
      action === 'resolve'
        ? `Đã nghiệm thu và đóng sự cố ${selectedIncident.code}.`
        : action === 'escalate'
        ? `Đã chuyển sự cố ${selectedIncident.code} sang chế độ chờ bạn quyết định.`
        : `Muse AI 01 đã gửi chỉ đạo xử lý trực tiếp cho ${selectedIncident.code}.`
    );
  };

  const findAgent = (id: string) => agents.find((a) => a.id === id);

  return (
    <div className="space-y-5">
      {/* Header & KPI Bar */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <Siren className="w-3.5 h-3.5" />
              <span>AI Director Command &amp; Incident Response</span>
            </div>
            <h2 className="text-base sm:text-lg font-display font-bold text-slate-900 dark:text-white">
              Trung tâm chỉ huy xử lý sự cố tập trung (Muse AI 01)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
              Mọi lỗi từ Muse AI 02–05 đều báo cáo khẩn về Muse AI 01 (Đạo diễn tổng) để trực tiếp tra hỏi nguyên nhân, ra lệnh sửa đúng phân cảnh lỗi và yêu cầu Muse AI 05 kiểm duyệt lại.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenIncidentChannel}
              className="px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-700/60 bg-rose-50/80 dark:bg-rose-950/30 text-xs font-semibold text-rose-700 dark:text-rose-300 inline-flex items-center gap-1.5 cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-950/50"
            >
              <MessageSquareWarning className="w-3.5 h-3.5" />
              <span>Mở # INCIDENT COMMAND</span>
            </button>
            <button
              type="button"
              onClick={() => setShowReportForm((v) => !v)}
              className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showReportForm ? 'Đóng biểu mẫu' : 'Báo cáo sự cố tới Muse 01'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Tổng sự cố đã ghi nhận</div>
            <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {counts.total}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Muse 01 đang tự xử lý</div>
            <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
              {counts.active}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Cần bạn can thiệp</div>
            <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
              {counts.escalated}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700/40 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Đã sửa &amp; QA duyệt đóng</div>
            <div className="mt-1 text-xl font-display font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {counts.resolved}
            </div>
          </div>
        </div>
      </section>

      {/* Manual Report Form */}
      {showReportForm && (
        <form onSubmit={handleCreateReport} className="glass-card rounded-2xl p-5 space-y-4 border border-rose-400/40">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-display font-bold text-slate-900 dark:text-white">
              Gửi báo cáo sự cố khẩn tới Muse AI 01 — Đạo diễn tổng
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Giới hạn tự xử lý hiện tại: {state.cloudConfig.maxIncidentRetries ?? 3} vòng
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Muse phát hiện lỗi</label>
              <select
                value={repReporter}
                onChange={(e) => setRepReporter(e.target.value as MuseAgentId)}
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.roleTitle})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Muse phụ trách gây lỗi</label>
              <select
                value={repResponsible}
                onChange={(e) => setRepResponsible(e.target.value as MuseAgentId)}
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              >
                {agents.filter((a) => a.id !== 'muse-01').map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.roleTitle})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Loại sự cố</label>
              <select
                value={repCategory}
                onChange={(e) => setRepCategory(e.target.value as IncidentCategory)}
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              >
                {INCIDENT_CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Mức độ nghiêm trọng</label>
              <select
                value={repSeverity}
                onChange={(e) => setRepSeverity(e.target.value as IncidentSeverity)}
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              >
                <option value="critical">Nghiêm trọng (Critical)</option>
                <option value="high">Cao (High)</option>
                <option value="medium">Trung bình (Medium)</option>
                <option value="low">Thấp (Low)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Phân cảnh liên quan</label>
              <select
                value={repSceneId}
                onChange={(e) => setRepSceneId(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              >
                <option value="">Không gắn cảnh cụ thể</option>
                {scenes.map((sc) => (
                  <option key={sc.sceneId} value={sc.sceneId}>
                    Cảnh {sc.index}: {sc.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Mô tả lỗi cụ thể (bắt buộc)
              </label>
              <input
                type="text"
                value={repErrorDesc}
                onChange={(e) => setRepErrorDesc(e.target.value)}
                placeholder="Ví dụ: Cảnh 09 nhân vật nam phát sai lời thoại của nhân vật nữ ở mốc 03s-07s..."
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Nguyên nhân dự kiến (tùy chọn)
              </label>
              <input
                type="text"
                value={repRootCause}
                onChange={(e) => setRepRootCause(e.target.value)}
                placeholder="Nhầm prompt nhân vật / sai voiceId..."
                className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={repRequireApproval}
                onChange={(e) => setRepRequireApproval(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Ngoài phạm vi tự quyết của AI (yêu cầu báo người dùng duyệt trước)</span>
            </label>

            <button
              type="submit"
              disabled={busyAction === 'report_incident' || !repErrorDesc.trim()}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {busyAction === 'report_incident' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Siren className="w-3.5 h-3.5" />
              )}
              <span>Báo cáo khẩn tới Muse AI 01</span>
            </button>
          </div>
        </form>
      )}

      {/* Master-Detail Incident Dossier */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left List */}
        <aside className="xl:col-span-4 glass-card rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200/80 dark:border-slate-700/40 text-[11px]">
            {(
              [
                { id: 'all', label: `Tất cả (${counts.total})` },
                { id: 'active', label: `Đang xử lý (${counts.active})` },
                { id: 'escalated', label: `Cần duyệt (${counts.escalated})` },
                { id: 'resolved', label: `Đã đóng (${counts.resolved})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`flex-1 py-1.5 px-2 rounded-lg font-medium whitespace-nowrap cursor-pointer ${
                  statusFilter === f.id
                    ? 'bg-white dark:bg-[#1a2244] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredIncidents.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500 opacity-75" />
              <div>Không có sự cố nào trong nhóm lọc này.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
              {filteredIncidents.map((inc) => {
                const isSelected = selectedIncident?.id === inc.id;
                const resp = findAgent(inc.assignedFixAgentId);
                return (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => setSelectedId(inc.id)}
                    className={`w-full text-left rounded-xl border p-3 space-y-1.5 transition cursor-pointer ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50/70 dark:bg-violet-950/30 shadow-sm'
                        : 'border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-[#0c1021]/80 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">
                        {inc.code} {inc.sceneIndex ? `· Cảnh ${String(inc.sceneIndex).padStart(2, '0')}` : ''}
                      </span>
                      <span className={`px-2 py-0.5 rounded border text-[10px] ${STATUS_BADGE_CLASS[inc.status]}`}>
                        {STATUS_LABELS[inc.status]}
                      </span>
                    </div>

                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 line-clamp-1">
                      {inc.categoryLabel}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                      {inc.errorDescription}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 pt-1 font-mono tabular-nums">
                      <span>Phụ trách: {resp?.name || inc.assignedFixAgentId}</span>
                      <span>
                        Vòng {inc.attemptCount}/{inc.maxAttempts}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Right Detail Dossier */}
        <section className="xl:col-span-8 glass-card rounded-2xl p-5 space-y-4">
          {!selectedIncident ? (
            <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <ShieldAlert className="w-8 h-8 mx-auto opacity-50" />
              <div className="font-medium text-slate-700 dark:text-slate-200">
                Chưa có hồ sơ sự cố nào được chọn
              </div>
              <p className="max-w-md mx-auto">
                Khi Muse AI 05 trả về cảnh lỗi, tác vụ thất bại, mất kết nối hoặc bạn tạo báo cáo khẩn, toàn bộ cuộc trao đổi chỉ đạo của Muse AI 01 sẽ hiển thị tại đây.
              </p>
            </div>
          ) : (
            <>
              {/* Dossier Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700/45 pb-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {selectedIncident.code}
                    </span>
                    <span className={`px-2 py-0.5 rounded border text-[11px] ${STATUS_BADGE_CLASS[selectedIncident.status]}`}>
                      {STATUS_LABELS[selectedIncident.status]}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${SEVERITY_BADGE_CLASS[selectedIncident.severity]}`}>
                      {selectedIncident.severity}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      Vòng {selectedIncident.attemptCount}/{selectedIncident.maxAttempts}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      · {selectedIncident.withinAutonomyScope ? 'Trong quyền tự xử lý AI 01' : 'Cần xác nhận người dùng'}
                    </span>
                  </div>
                  <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                    {selectedIncident.categoryLabel}
                    {selectedIncident.sceneIndex ? ` — Cảnh ${String(selectedIncident.sceneIndex).padStart(2, '0')}` : ''}
                    {selectedIncident.timestampRange ? ` (${selectedIncident.timestampRange})` : ''}
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedIncident.status !== 'resolved' && (
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => handleDirectorAction('resolve')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Nghiệm thu &amp; Đóng</span>
                    </button>
                  )}
                  {(selectedIncident.status === 'resolved' || selectedIncident.status === 'escalated_to_user') && (
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => handleDirectorAction('reopen', 'Đạo diễn yêu cầu mở lại sự cố và thực hiện vòng sửa mới.')}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Mở lại &amp; sửa tiếp</span>
                    </button>
                  )}
                  {selectedIncident.status !== 'resolved' && selectedIncident.status !== 'escalated_to_user' && (
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => handleDirectorAction('escalate')}
                      className="px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700/60 text-rose-700 dark:text-rose-300 text-xs font-medium cursor-pointer"
                    >
                      Chuyển người dùng quyết định
                    </button>
                  )}
                </div>
              </div>

              {/* Escalation Alert Banner */}
              {selectedIncident.status === 'escalated_to_user' && selectedIncident.escalationReason && (
                <div className="rounded-xl border border-rose-400/60 bg-rose-50 dark:bg-rose-950/35 p-3.5 text-xs text-rose-900 dark:text-rose-200 flex items-start gap-2.5">
                  <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <div className="space-y-1">
                    <div className="font-bold">Sự cố vượt giới hạn tự xử lý / cần quyết định của bạn</div>
                    <div>{selectedIncident.escalationReason}</div>
                  </div>
                </div>
              )}

              {selectedIncident.status === 'resolved' && selectedIncident.resolutionSummary && (
                <div className="rounded-xl border border-emerald-400/50 bg-emerald-50/80 dark:bg-emerald-950/30 p-3.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <span className="font-bold">Kết quả nghiệm thu: </span>
                    {selectedIncident.resolutionSummary}
                  </div>
                </div>
              )}

              {/* Structured Metadata Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/75 p-3 space-y-1.5">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">Thông tin truy vết &amp; phân vai</div>
                  <div className="text-slate-600 dark:text-slate-300 space-y-1">
                    <div>
                      • Muse báo lỗi:{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {findAgent(selectedIncident.reporterAgentId)?.name || selectedIncident.reporterAgentId}
                      </strong>
                    </div>
                    <div>
                      • Muse phụ trách sửa:{' '}
                      <strong className="text-slate-900 dark:text-white">
                        {findAgent(selectedIncident.assignedFixAgentId)?.name || selectedIncident.assignedFixAgentId}
                      </strong>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      Project: {selectedIncident.projectId} · Session: {selectedIncident.sessionId} · Task:{' '}
                      {selectedIncident.taskId || 'N/A'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Tác vụ sửa đã tạo ({selectedIncident.remediationTaskIds.length}):{' '}
                      <span className="font-mono">
                        {selectedIncident.remediationTaskIds.slice(-3).join(', ') || 'Chưa tạo'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/70 dark:bg-[#0c1021]/75 p-3 space-y-1.5">
                  <div className="font-semibold text-slate-800 dark:text-slate-100">
                    Chẩn đoán gốc &amp; Chỉ đạo Muse AI 01
                  </div>
                  <div className="text-slate-600 dark:text-slate-300 space-y-1.5">
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-100">Lỗi cụ thể: </span>
                      {selectedIncident.errorDescription}
                    </div>
                    {selectedIncident.suspectedRootCause && (
                      <div>
                        <span className="font-medium text-slate-800 dark:text-slate-100">Nguyên nhân dự kiến: </span>
                        {selectedIncident.suspectedRootCause}
                      </div>
                    )}
                    {selectedIncident.technicalDiagnosis && (
                      <div className="rounded-lg border border-amber-300/60 dark:border-amber-700/50 bg-amber-50/60 dark:bg-amber-950/20 p-2 text-[11px] space-y-1">
                        <div className="font-semibold text-amber-800 dark:text-amber-300">
                          Chi tiết kỹ thuật: {selectedIncident.technicalDiagnosis.errorType}
                          {selectedIncident.technicalDiagnosis.taskCode ? ` (${selectedIncident.technicalDiagnosis.taskCode})` : ''}
                          {selectedIncident.technicalDiagnosis.provider ? ` · Engine: ${selectedIncident.technicalDiagnosis.provider}` : ''}
                        </div>
                        {selectedIncident.technicalDiagnosis.failedLocation && (
                          <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300">
                            Vị trí lỗi: {selectedIncident.technicalDiagnosis.failedLocation}
                          </div>
                        )}
                        {selectedIncident.technicalDiagnosis.excerpt && (
                          <div className="font-mono text-[10px] bg-white/80 dark:bg-black/30 rounded px-2 py-1 text-rose-700 dark:text-rose-300 break-all">
                            {selectedIncident.technicalDiagnosis.excerpt}
                          </div>
                        )}
                        <div className="text-slate-700 dark:text-slate-200">
                          <span className="font-semibold">Phương án khắc phục gợi ý: </span>
                          {selectedIncident.technicalDiagnosis.directorRemediationPlan}
                        </div>
                      </div>
                    )}
                    {selectedIncident.analyzedRootCause && (
                      <div>
                        <span className="font-medium text-slate-800 dark:text-slate-100">Phân tích Đạo diễn: </span>
                        {selectedIncident.analyzedRootCause}
                      </div>
                    )}
                    {selectedIncident.directorCommand && (
                      <div className="text-violet-700 dark:text-violet-300">
                        <span className="font-semibold">Lệnh sửa hiện tại: </span>
                        {selectedIncident.directorCommand}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Structured Costume Mismatch Dossier (when allowFreeCostumeChange is OFF) */}
              {selectedIncident.costumeMismatch && (
                <div className="rounded-xl border border-amber-400/55 bg-amber-50/75 dark:bg-amber-950/25 p-3.5 text-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-amber-900 dark:text-amber-200 inline-flex items-center gap-1.5">
                      <Shirt className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Hồ sơ sai lệch trang phục nhân vật (Khóa tham chiếu gốc)</span>
                    </div>
                    <span className="font-mono text-[11px] text-amber-800 dark:text-amber-300">
                      {selectedIncident.costumeMismatch.characterName} · ID: {selectedIncident.costumeMismatch.characterId} ·{' '}
                      {selectedIncident.costumeMismatch.targetMediaKind === 'scene_video'
                        ? 'Video phân cảnh'
                        : selectedIncident.costumeMismatch.targetMediaKind === 'scene_image'
                        ? 'Ảnh keyframe cảnh'
                        : 'Ảnh tham chiếu nhân vật'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                    <div className="rounded-lg border border-amber-300/60 dark:border-amber-800/60 bg-white/80 dark:bg-[#0c1021]/80 p-2.5 space-y-1">
                      <div className="font-semibold text-emerald-700 dark:text-emerald-300">Trang phục chuẩn gốc (Bắt buộc)</div>
                      <div className="text-slate-700 dark:text-slate-200">{selectedIncident.costumeMismatch.expectedCostume}</div>
                      <div className="text-slate-500 dark:text-slate-400 pt-1">
                        AI tạo lỗi:{' '}
                        <strong className="text-slate-800 dark:text-slate-100">
                          {findAgent(selectedIncident.costumeMismatch.responsibleAgentId)?.name ||
                            selectedIncident.costumeMismatch.responsibleAgentId}
                        </strong>
                      </div>
                    </div>

                    <div className="rounded-lg border border-rose-300/60 dark:border-rose-800/60 bg-white/80 dark:bg-[#0c1021]/80 p-2.5 space-y-1">
                      <div className="font-semibold text-rose-700 dark:text-rose-300">Điểm sai lệch được Muse AI 05 phát hiện</div>
                      <div className="text-slate-700 dark:text-slate-200">{selectedIncident.costumeMismatch.mismatchDetails}</div>
                      {selectedIncident.costumeMismatch.observedCostume && (
                        <div className="text-slate-500 dark:text-slate-400">
                          Thực tế xuất hiện: {selectedIncident.costumeMismatch.observedCostume}
                        </div>
                      )}
                    </div>
                  </div>

                  {(selectedIncident.costumeMismatch.referenceImageUrl || selectedIncident.costumeMismatch.faultyArtifactUrl) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-emerald-400/50 bg-white dark:bg-[#0c1021] p-2 space-y-1">
                        <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          Ảnh tham chiếu gốc (Không ghi đè)
                        </div>
                        {selectedIncident.costumeMismatch.referenceImageUrl ? (
                          <img
                            src={selectedIncident.costumeMismatch.referenceImageUrl}
                            alt="Ảnh tham chiếu trang phục chuẩn"
                            className="h-32 w-full object-contain rounded bg-slate-100 dark:bg-black/40"
                          />
                        ) : (
                          <div className="h-24 flex items-center justify-center text-[11px] text-slate-400">Theo hồ sơ chữ gốc</div>
                        )}
                      </div>
                      <div className="rounded-lg border border-rose-400/50 bg-white dark:bg-[#0c1021] p-2 space-y-1">
                        <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                          Ảnh / Khung hình bị sai trang phục
                        </div>
                        {selectedIncident.costumeMismatch.faultyArtifactUrl ? (
                          <img
                            src={selectedIncident.costumeMismatch.faultyArtifactUrl}
                            alt="Ảnh hoặc khung hình lỗi trang phục"
                            className="h-32 w-full object-contain rounded bg-slate-100 dark:bg-black/40"
                          />
                        ) : (
                          <div className="h-24 flex items-center justify-center text-[11px] text-slate-400">Chưa trích xuất ảnh lỗi</div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="text-[11px] text-amber-900 dark:text-amber-200">
                    <span className="font-semibold">Đề xuất khôi phục: </span>
                    {selectedIncident.costumeMismatch.restoreRecommendation}
                  </div>
                </div>
              )}

              {/* Before -> After Costume Restoration Version History */}
              {selectedIncident.versionHistory && selectedIncident.versionHistory.length > 0 && (
                <div className="rounded-xl border border-cyan-400/45 bg-cyan-50/60 dark:bg-cyan-950/20 p-3.5 text-xs space-y-2.5">
                  <div className="font-bold text-cyan-900 dark:text-cyan-200">
                    Lịch sử phiên bản trang phục Trước → Sau ({selectedIncident.versionHistory.length} lần sửa)
                  </div>
                  <div className="space-y-2">
                    {selectedIncident.versionHistory.map((snap) => (
                      <div
                        key={`${snap.version}_${snap.timestamp}`}
                        className="rounded-lg border border-cyan-200/70 dark:border-cyan-800/50 bg-white dark:bg-[#0c1021] p-2.5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <span className="font-mono font-bold text-cyan-700 dark:text-cyan-300">
                            Phiên bản v{snap.version} {snap.sceneIndex ? `· Cảnh ${snap.sceneIndex}` : ''}
                          </span>
                          <span className="font-mono text-slate-400">{fmtDateTime(snap.timestamp)}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-11 gap-2 items-center text-[11px]">
                          <div className="md:col-span-5 rounded border border-rose-200/70 dark:border-rose-800/50 p-2 bg-rose-50/40 dark:bg-rose-950/20 space-y-1">
                            <div className="font-semibold text-rose-700 dark:text-rose-300">Trước khi sửa</div>
                            <div className="text-slate-700 dark:text-slate-300 line-clamp-2">{snap.beforeCostume}</div>
                            {snap.beforeImageUrl && (
                              <img src={snap.beforeImageUrl} alt="Trước khi sửa" className="h-20 w-full object-contain rounded" />
                            )}
                          </div>
                          <div className="md:col-span-1 flex justify-center text-slate-400">
                            <ArrowRight className="w-4 h-4" />
                          </div>
                          <div className="md:col-span-5 rounded border border-emerald-200/70 dark:border-emerald-800/50 p-2 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1">
                            <div className="font-semibold text-emerald-700 dark:text-emerald-300">Sau khi khôi phục chuẩn</div>
                            <div className="text-slate-700 dark:text-slate-300 line-clamp-2">{snap.afterCostume}</div>
                            {snap.afterImageUrl && (
                              <img src={snap.afterImageUrl} alt="Sau khi sửa" className="h-20 w-full object-contain rounded" />
                            )}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{snap.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Project Memory Context + Artifacts */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700/45 bg-slate-50/60 dark:bg-[#0c1021]/60 p-3 text-[11px] text-slate-600 dark:text-slate-300 space-y-2">
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Dữ liệu Project Memory đối chiếu: </span>
                  {selectedIncident.referenceDataSummary}
                </div>
                {selectedIncident.artifactUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selectedIncident.artifactUrls.map((url, idx) =>
                      url.endsWith('.mp4') || url.endsWith('.webm') ? (
                        <video
                          key={idx}
                          src={url}
                          controls
                          className="h-28 rounded-lg border border-slate-200 dark:border-slate-700 bg-black"
                        />
                      ) : (
                        <img
                          key={idx}
                          src={url}
                          alt="Artifact lỗi"
                          className="h-24 w-auto rounded-lg border border-slate-200 dark:border-slate-700 object-cover"
                        />
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Chronological Director-Muse Investigation & Fix Thread */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-100">
                  <span>Diễn biến điều hành trực tiếp ({selectedIncident.history.length} bước)</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Cập nhật: {fmtDateTime(selectedIncident.updatedAt)}
                  </span>
                </div>

                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {selectedIncident.history.map((turn) => {
                    const ag = findAgent(turn.actorId);
                    return (
                      <div
                        key={turn.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] p-3 text-xs space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {ag && <AgentAvatar agent={ag} size="xs" />}
                            <span
                              className="font-bold text-slate-900 dark:text-white"
                              style={ag?.accentColor ? { color: ag.accentColor } : undefined}
                            >
                              {turn.actorName}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
                                TURN_BADGE_CLASS[turn.kind] || 'bg-slate-500/15 text-slate-700 border-slate-500/30'
                              }`}
                            >
                              {turn.roleBadge}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono tabular-nums text-slate-400">
                            {fmtDateTime(turn.timestamp)}
                          </span>
                        </div>

                        <div className="whitespace-pre-wrap text-slate-700 dark:text-slate-200 leading-relaxed">
                          {turn.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Direct Command Composer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700/45 flex flex-wrap items-center gap-2">
                <select
                  value={cmdTargetAgent}
                  onChange={(e) => setCmdTargetAgent(e.target.value as MuseAgentId)}
                  className="h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-800 dark:text-slate-200"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      Giao sửa: {a.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={cmdText}
                  onChange={(e) => setCmdText(e.target.value)}
                  placeholder="Nhập chỉ đạo bổ sung cho Muse AI 01 (vd: Khóa lại thoại nam ở giây thứ 4 và tạo lại cảnh)..."
                  className="flex-1 min-w-[220px] h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() => handleDirectorAction('directive')}
                  className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  {busyAction.startsWith('inc_directive_') ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Ra lệnh sửa qua Muse 01</span>
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};
