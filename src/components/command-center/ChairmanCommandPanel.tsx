import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Crown,
  Loader2,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import type {
  ChairmanActionType,
  ChairmanBriefing,
  ChairmanPlanOption,
  CommandCenterState,
  MuseAgentId,
} from '../../types/commandCenter';
import { AgentAvatar } from './AgentAvatar';

const ACTION_TYPE_LABELS: Record<ChairmanActionType, string> = {
  patch_and_retry: 'Vá chỉ thị & chạy lại',
  switch_engine_and_retry: 'Chuyển engine dự phòng & chạy lại',
  reassign_muse: 'Điều chuyển Muse AI khác',
  fix_scene_memory_and_regen: 'Sửa Project Memory & tạo lại cảnh',
  adjust_qa_and_approve: 'Phê duyệt thông chốt QA',
  reset_stuck_run: 'Gỡ kẹt toàn bộ phiên',
  direct_briefing: 'Phát chỉ thị trực tiếp',
};

const RISK_LABELS: Record<ChairmanPlanOption['riskLevel'], { text: string; className: string }> = {
  low: { text: 'Rủi ro thấp', className: 'text-emerald-600 dark:text-emerald-400' },
  medium: { text: 'Rủi ro trung bình', className: 'text-amber-600 dark:text-amber-400' },
  high: { text: 'Rủi ro cao', className: 'text-rose-600 dark:text-rose-400' },
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

interface ChairmanCommandPanelProps {
  state: CommandCenterState;
  busyAction: string;
  onRunAction: (
    key: string,
    fn: () => Promise<CommandCenterState | null | void>,
    okNotice?: string
  ) => Promise<void>;
  onOpenIncidentsTab: (incidentId?: string) => void;
  apiJson: <T = any>(url: string, init?: RequestInit) => Promise<T>;
}

export const ChairmanCommandPanel: React.FC<ChairmanCommandPanelProps> = ({
  state,
  busyAction,
  onRunAction,
  onOpenIncidentsTab,
  apiJson,
}) => {
  const config = state.chairmanConfig || {
    enabled: true,
    name: 'Gemini AI – Chủ tịch',
    title: 'Chủ tịch & Tổng chỉ huy toàn bộ hệ thống 5 Muse AI',
    autoInterveneOnIncident: true,
    autoExecuteRecommended: false,
    strictOversightMode: true,
  };
  const coordinationLog = state.projectMemory?.coordinationLog || [];
  const briefings = state.chairmanBriefings || [];
  const agents = state.agents || [];
  const openIncidents = useMemo(
    () => (state.incidents || []).filter((inc) => inc.status !== 'resolved'),
    [state.incidents]
  );

  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(briefings[0]?.id || null);
  const [targetIncidentId, setTargetIncidentId] = useState<string>('');
  const [orderText, setOrderText] = useState('');
  const [customNote, setCustomNote] = useState('');

  useEffect(() => {
    if (!selectedBriefingId && briefings[0]?.id) {
      setSelectedBriefingId(briefings[0].id);
    } else if (selectedBriefingId && !briefings.some((b) => b.id === selectedBriefingId)) {
      setSelectedBriefingId(briefings[0]?.id || null);
    }
  }, [briefings, selectedBriefingId]);

  const activeBriefing: ChairmanBriefing | undefined = useMemo(() => {
    if (selectedBriefingId) {
      const found = briefings.find((b) => b.id === selectedBriefingId);
      if (found) return found;
    }
    return briefings[0];
  }, [briefings, selectedBriefingId]);

  const findAgent = (id: MuseAgentId) => agents.find((a) => a.id === id);

  const handleToggleConfig = async (
    field: 'enabled' | 'autoInterveneOnIncident' | 'autoExecuteRecommended',
    nextVal: boolean
  ) => {
    await onRunAction(
      `chairman_cfg_${field}`,
      () =>
        apiJson<CommandCenterState>('/api/command-center/chairman/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: nextVal }),
        }),
      'Đã cập nhật quyền điều hành của Chủ tịch AI.'
    );
  };

  const handleRequestAnalysis = async (explicitRequest?: string, explicitIncidentId?: string) => {
    const reqText = (explicitRequest ?? orderText).trim();
    const incId = explicitIncidentId ?? targetIncidentId;
    await onRunAction(
      'chairman_analyze',
      async () => {
        const res = await apiJson<{ state: CommandCenterState; briefing: ChairmanBriefing }>(
          '/api/command-center/chairman/analyze',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              incidentId: incId || undefined,
              runId: state.selectedRunId || state.activeRun?.id || undefined,
              userRequest: reqText || undefined,
            }),
          }
        );
        if (res.briefing?.id) {
          setSelectedBriefingId(res.briefing.id);
        }
        if (!explicitRequest) setOrderText('');
        return res.state;
      },
      'Chủ tịch Điều hành AI đã hoàn tất chẩn đoán và lập 3 phương án hành động.'
    );
  };

  const handleExecuteOption = async (briefingId: string, option: ChairmanPlanOption) => {
    await onRunAction(
      `chairman_exec_${option.id}`,
      async () => {
        const res = await apiJson<{
          state: CommandCenterState;
          briefing: ChairmanBriefing;
          executedSummary: string;
        }>('/api/command-center/chairman/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            briefingId,
            optionId: option.id,
            customNote: customNote.trim() || undefined,
          }),
        });
        setCustomNote('');
        return res.state;
      },
      `Chủ tịch đã trực tiếp phát lệnh "${option.label}" xuống ${findAgent(option.targetAgentId)?.name || option.targetAgentId}.`
    );
  };

  return (
    <div className="space-y-5">
      {/* Executive Authority Header */}
      <section className="glass-card rounded-2xl p-5 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 dark:border-slate-700/45 pb-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5" />
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-amber-700 dark:text-amber-400">Chủ tịch &amp; Tổng chỉ huy</span>
                <span aria-hidden="true">·</span>
                <span>4 Muse sản xuất Ảnh/Video (01–04) + Muse 05 QA độc lập</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{openIncidents.length} sự cố đang mở</span>
              </div>
              <h2 className="text-lg sm:text-xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
                {config.name}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
                Bộ não điều hành trung tâm: tiếp nhận chỉ đạo người dùng, khóa Project Memory, phân công song song cho 4 Muse sản xuất (Muse Director 01, Muse 02, 03, 04), tiếp nhận báo cáo QA trực tiếp từ Muse 05 và chất vấn xử lý sự cố qua Chat Room.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busyAction === 'chairman_analyze'}
              onClick={() =>
                handleRequestAnalysis(
                  'Rà soát toàn bộ tình trạng hoạt động của 5 Muse AI, các sự cố đang mở, tác vụ lỗi/treo và đề xuất phương án xử lý tối ưu ngay.',
                  openIncidents[0]?.id || ''
                )
              }
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              {busyAction === 'chairman_analyze' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Rà soát toàn bộ 5 Muse AI</span>
            </button>
          </div>
        </div>

        {/* Governance Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5 cursor-pointer">
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-white">Quyền Tổng chỉ huy Gemini AI</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Gemini AI giữ quyền chỉ huy toàn bộ 5 Muse AI; Muse Director 01 tham gia sản xuất trực tiếp cùng Muse 02–04.
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={Boolean(busyAction)}
              onChange={(e) => handleToggleConfig('enabled', e.target.checked)}
              className="mt-1 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5 cursor-pointer">
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-white">Tự động can thiệp khi có sự cố QA</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Khi Muse AI 05 báo FAIL hoặc sự cố leo thang, Chủ tịch lập 3 phương án và chỉ đạo sửa ngay.
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.autoInterveneOnIncident}
              disabled={Boolean(busyAction) || !config.enabled}
              onChange={(e) => handleToggleConfig('autoInterveneOnIncident', e.target.checked)}
              className="mt-1 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/70 dark:bg-[#0c1021]/70 p-3.5 cursor-pointer">
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 dark:text-white">Tự thực thi phương án rủi ro thấp</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Tự chạy phương án khuyến nghị mức rủi ro thấp mà không cần chờ bạn bấm duyệt.
              </div>
            </div>
            <input
              type="checkbox"
              checked={config.autoExecuteRecommended}
              disabled={Boolean(busyAction) || !config.enabled}
              onChange={(e) => handleToggleConfig('autoExecuteRecommended', e.target.checked)}
              className="mt-1 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
          </label>
        </div>

        {/* Subordinate 5 Muse AI Oversight Row */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-200">
              Đội ngũ 5 Muse AI dưới quyền chỉ đạo trực tiếp
            </span>
            <span>Bấm vào bất kỳ Muse nào để tạo lệnh chỉ đạo riêng</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {agents.map((ag) => (
              <button
                key={ag.id}
                type="button"
                onClick={() =>
                  setOrderText(
                    `Kiểm tra ${ag.name} (${ag.roleTitle}): hiện có ${ag.stats.failed} lượt lỗi${
                      ag.lastError ? ` (${ag.lastError.slice(0, 70)})` : ''
                    }. Lập phương án chấn chỉnh và xử lý triệt để.`
                  )
                }
                className="text-left rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] hover:border-amber-400/70 p-3 transition cursor-pointer space-y-1.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AgentAvatar agent={ag} size="xs" showStatusDot />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {ag.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {ag.roleTitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/70">
                  <span>Xong {ag.stats.completed}</span>
                  <span className={ag.stats.failed > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}>
                    Lỗi {ag.stats.failed}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Direct Executive Order Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleRequestAnalysis();
          }}
          className="pt-3 border-t border-slate-200/80 dark:border-slate-700/45 flex flex-wrap items-center gap-2"
        >
          <select
            value={targetIncidentId}
            onChange={(e) => setTargetIncidentId(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-800 dark:text-slate-200 max-w-[240px]"
          >
            <option value="">Toàn bộ đội 5 Muse AI &amp; phiên hiện tại</option>
            {openIncidents.map((inc) => (
              <option key={inc.id} value={inc.id}>
                {inc.code}: {inc.categoryLabel}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={orderText}
            onChange={(e) => setOrderText(e.target.value)}
            placeholder="Nhập yêu cầu cho Chủ tịch chỉ đạo (vd: Muse 02 trả JSON lỗi liên tục, đổi phương án và chạy lại ngay)..."
            className="flex-1 min-w-[260px] h-10 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
          />

          <button
            type="submit"
            disabled={busyAction === 'chairman_analyze'}
            className="h-10 px-4 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            {busyAction === 'chairman_analyze' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>Lập phương án chỉ đạo</span>
          </button>
        </form>
      </section>

      {/* Briefings Master-Detail */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left: Briefing History */}
        <aside className="xl:col-span-4 glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-slate-700/45 pb-2.5">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              Hồ sơ chỉ đạo của Chủ tịch
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {briefings.length} phiên
            </span>
          </div>

          {briefings.length === 0 ? (
            <div className="py-10 text-center space-y-3 text-xs text-slate-500 dark:text-slate-400">
              <Crown className="w-7 h-7 mx-auto text-amber-500/60" />
              <div className="space-y-1">
                <div className="font-medium text-slate-700 dark:text-slate-200">
                  Chưa có bản chỉ đạo nào từ Chủ tịch AI
                </div>
                <p>
                  Bấm "Rà soát toàn bộ 5 Muse AI" hoặc nhập yêu cầu ở trên để Chủ tịch phân tích và lập 3 phương án thực thi.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {briefings.map((b) => {
                const isSelected = activeBriefing?.id === b.id;
                const hasExecuted = Boolean(b.selectedOptionId);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBriefingId(b.id)}
                    className={`w-full text-left rounded-xl border p-3 transition cursor-pointer space-y-1.5 ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/25'
                        : 'border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021] hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {b.incidentCode ? `Sự cố ${b.incidentCode}` : 'Rà soát điều hành'}
                      </span>
                      <span className={hasExecuted ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                        {hasExecuted ? 'Đã thực thi' : 'Chờ duyệt'}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-slate-900 dark:text-white line-clamp-2">
                      {b.executiveSummary}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400">
                      {fmtDateTime(b.createdAt)} · {b.options.length} phương án
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Right: Active Briefing Diagnosis & 3 Executable Options */}
        <section className="xl:col-span-8 glass-card rounded-2xl p-5 space-y-5">
          {!activeBriefing ? (
            <div className="py-16 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
              <ShieldCheck className="w-8 h-8 mx-auto opacity-50" />
              <div className="font-medium text-slate-700 dark:text-slate-200">
                Chọn một hồ sơ hoặc mời Chủ tịch AI đánh giá ngay
              </div>
              <p className="max-w-md mx-auto">
                Mọi phân tích nguyên nhân gốc, đánh giá sai sót của Muse AI 01–05 và các phương án thực thi trực tiếp sẽ hiển thị rõ ràng tại đây.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 dark:border-slate-700/45 pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-amber-700 dark:text-amber-400">
                      {activeBriefing.trigger === 'auto_takeover'
                        ? 'Tự động tiếp quản sự cố'
                        : activeBriefing.incidentCode
                        ? `Hội chẩn sự cố ${activeBriefing.incidentCode}`
                        : 'Chỉ đạo điều hành trực tiếp'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{fmtDateTime(activeBriefing.createdAt)}</span>
                  </div>
                  <h3 className="text-base font-display font-bold text-slate-900 dark:text-white">
                    {activeBriefing.executiveSummary}
                  </h3>
                  {activeBriefing.userRequest && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Yêu cầu của bạn: {activeBriefing.userRequest}
                    </div>
                  )}
                </div>

                {activeBriefing.incidentId && (
                  <button
                    type="button"
                    onClick={() => onOpenIncidentsTab(activeBriefing.incidentId)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Siren className="w-3.5 h-3.5 text-rose-500" />
                    <span>Xem hồ sơ sự cố</span>
                  </button>
                )}
              </div>

              {/* Root Cause + Team Critique */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    Chẩn đoán nguyên nhân gốc rễ
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {activeBriefing.rootCauseDiagnosis}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-900 dark:text-white">
                    Đánh giá điểm yếu của đội 5 Muse AI
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {activeBriefing.critiqueOfMuseTeam}
                  </p>
                </div>
              </div>

              {activeBriefing.executionLog && (
                <div className="rounded-xl border border-emerald-400/50 bg-emerald-50/70 dark:bg-emerald-950/25 px-4 py-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <span className="font-semibold">Kết quả thực thi gần nhất: </span>
                    {activeBriefing.executionLog}
                  </div>
                </div>
              )}

              {/* Optional note before executing */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Ghi chú chỉ đạo bổ sung trước khi phát lệnh (tùy chọn)
                </label>
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="Ví dụ: Giữ nguyên thoại cũ, chỉ sửa trang phục cảnh 04 và ép kiểm duyệt lại..."
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#0c1021] text-xs text-slate-900 dark:text-white"
                />
              </div>

              {/* 3 Actionable Options */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Các phương án giải quyết (chọn 1 phương án để Chủ tịch trực tiếp phát lệnh xuống Muse AI)
                </div>

                <div className="divide-y divide-slate-200/80 dark:divide-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-[#0c1021]">
                  {activeBriefing.options.map((opt, idx) => {
                    const targetAg = findAgent(opt.targetAgentId);
                    const risk = RISK_LABELS[opt.riskLevel] || RISK_LABELS.low;
                    const isExecBusy = busyAction === `chairman_exec_${opt.id}`;
                    const wasExecuted = Boolean(opt.executedAt || activeBriefing.selectedOptionId === opt.id);

                    return (
                      <div key={opt.id} className="p-4 space-y-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                0{idx + 1}
                              </span>
                              {opt.recommended && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                                    Khuyến nghị
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span className={`font-medium ${risk.className}`}>{risk.text}</span>
                              <span aria-hidden="true">·</span>
                              <span>{ACTION_TYPE_LABELS[opt.actionType]}</span>
                              <span aria-hidden="true">·</span>
                              <span>Giao {targetAg?.name || opt.targetAgentId}</span>
                            </div>

                            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                              {opt.label}
                            </h4>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                              {opt.summary}
                            </p>
                          </div>

                          <button
                            type="button"
                            disabled={Boolean(busyAction)}
                            onClick={() => handleExecuteOption(activeBriefing.id, opt)}
                            className={`px-3.5 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition ${
                              wasExecuted
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                : opt.recommended
                                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                                : 'border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                            }`}
                          >
                            {isExecBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : wasExecuted ? (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                            <span>{wasExecuted ? 'Thực thi lại' : 'Thực thi phương án'}</span>
                          </button>
                        </div>

                        <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1 pt-1">
                          <div>
                            <span className="font-medium text-slate-800 dark:text-slate-100">Lệnh gửi xuống Muse AI: </span>
                            {opt.executionCommand}
                          </div>
                          <div>
                            <span className="font-medium text-slate-800 dark:text-slate-100">Kết quả dự kiến: </span>
                            {opt.estimatedOutcome}
                          </div>
                          {opt.executedAt && (
                            <div className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                              Đã thực thi lúc {fmtDateTime(opt.executedAt)}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Persisted Coordination Log in Project Memory */}
      {coordinationLog.length > 0 && (
        <section className="glass-card rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-700/45 pb-2.5">
            <div>
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
                Nhật ký chỉ đạo &amp; phối hợp lưu trong Project Memory
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Mọi chỉ thị của Gemini AI – Chủ tịch, phản hồi từ 5 Muse AI và kết quả kiểm định QA đều được lưu vết lâu dài.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {coordinationLog.length} bản ghi
            </span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
            {coordinationLog.slice(0, 15).map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-slate-200 dark:border-slate-700/50 bg-white/80 dark:bg-[#0c1021]/80 p-2.5 space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {entry.actorName}
                    {entry.targetAgentIds && entry.targetAgentIds.length > 0
                      ? ` → ${entry.targetAgentIds.join(', ')}`
                      : ''}
                    {entry.sceneId ? ` · ${entry.sceneId}` : ''}
                    {entry.taskId ? ` · ${entry.taskId}` : ''}
                  </span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {entry.kind} · {fmtDateTime(entry.timestamp)}
                  </span>
                </div>
                <div className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap line-clamp-3">
                  {entry.summary}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
