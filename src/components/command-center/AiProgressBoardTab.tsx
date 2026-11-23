import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  Cpu,
  Crown,
  Film,
  Image as ImageIcon,
  Laptop,
  Loader2,
  Lock,
  PowerOff,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  AiWorkforceMode,
  CommandCenterState,
  CommandMemoryScene,
  ProductionRun,
} from '../../types/commandCenter';
import { AgentAvatar } from './AgentAvatar';

interface AiProgressBoardTabProps {
  state: CommandCenterState;
  setState: React.Dispatch<React.SetStateAction<CommandCenterState | null>>;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
}

const WORKFORCE_MODES: {
  id: AiWorkforceMode;
  badge: string;
  title: string;
  summary: string;
  detail: string;
}[] = [
  {
    id: 'gemini_only',
    badge: 'Chế độ 1',
    title: 'Chỉ Gemini làm việc',
    summary: 'Gemini Chủ tịch điều hành các Gemini được chọn. Muse không tham gia.',
    detail: 'Chạy hoàn toàn trên hạ tầng Gemini Cloud, có thể tắt máy tính cá nhân sau khi kích hoạt.',
  },
  {
    id: 'muse_only',
    badge: 'Chế độ 2',
    title: 'Chỉ Muse làm việc',
    summary: 'Các Muse thực hiện quy trình sản xuất độc lập theo cấu hình đã thiết lập.',
    detail: 'Sử dụng trực tiếp Muse2API Pool cục bộ, không gọi fallback Gemini.',
  },
  {
    id: 'hybrid_gemini_muse',
    badge: 'Chế độ 3',
    title: 'Gemini + Muse cùng làm việc',
    summary: 'Gemini Chủ tịch phân công, điều phối và giám sát. Muse thực hiện nhiệm vụ sản xuất.',
    detail: 'Các Gemini khác có thể nhận nhiệm vụ kiểm duyệt / dự phòng song song để tối ưu tốc độ.',
  },
];

const RUN_STATUS_TEXT: Record<ProductionRun['status'], string> = {
  idle: 'Chờ lệnh',
  planning: 'Đang lập kế hoạch',
  producing: 'Đang sản xuất',
  inspecting: 'Đang kiểm duyệt QA',
  assembling: 'Đang ghép phim',
  completed: 'Đã hoàn thành',
  paused: 'Đang tạm dừng',
  cancelled: 'Đã hủy phiên',
  failed: 'Gặp sự cố',
  needs_attention: 'Cần kiểm tra',
};

function computeSceneSteps(sc: CommandMemoryScene) {
  const hasScript = Boolean(sc.title || sc.actionDetail);
  const hasImage = Boolean(sc.keyframeImageUrl) && sc.imageValidated !== false;
  const imgQaPassed =
    sc.productionStage === 'waiting_video' ||
    sc.productionStage === 'creating_video' ||
    sc.productionStage === 'inspecting_qa' ||
    sc.productionStage === 'completed' ||
    Boolean(sc.videoUrl);
  const hasVideo = Boolean(sc.videoUrl);
  const finalQaPassed = sc.qaStatus === 'passed' || sc.productionStage === 'completed';

  return [
    { key: 'script', label: 'Kịch bản', done: hasScript, active: sc.productionStage === 'waiting_data' },
    { key: 'image', label: 'Ảnh cảnh', done: hasImage, active: sc.productionStage === 'creating_image' },
    { key: 'img_qa', label: 'QA Ảnh', done: imgQaPassed, active: sc.productionStage === 'image_ready' },
    { key: 'video', label: 'Video', done: hasVideo, active: sc.productionStage === 'creating_video' },
    {
      key: 'vid_qa',
      label: 'QA Video',
      done: finalQaPassed,
      active: sc.productionStage === 'inspecting_qa',
      failed: sc.qaStatus === 'rejected' || sc.qaStatus === 'escalated' || sc.productionStage === 'failed',
    },
  ];
}

export const AiProgressBoardTab: React.FC<AiProgressBoardTabProps> = ({
  state,
  setState,
  onOpenSettings,
  onRefresh,
}) => {
  const activeRun = state.activeRun;
  const geminiAccounts = state.geminiAccounts || [];
  const enabledGeminiAccounts = useMemo(() => geminiAccounts.filter((a) => a.enabled), [geminiAccounts]);

  const [draftMode, setDraftMode] = useState<AiWorkforceMode>(activeRun?.aiWorkforceMode || 'hybrid_gemini_muse');
  const [draftSelectedGeminiIds, setDraftSelectedGeminiIds] = useState<string[]>(
    activeRun?.selectedGeminiAccountIds || enabledGeminiAccounts.map((a) => a.id)
  );
  const [draftChairmanId, setDraftChairmanId] = useState<string>(
    activeRun?.chairmanGeminiAccountId || geminiAccounts.find((a) => a.isChairman)?.id || ''
  );

  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showHandoffConfirm, setShowHandoffConfirm] = useState(false);

  useEffect(() => {
    if (!activeRun) return;
    setDraftMode(activeRun.aiWorkforceMode || 'hybrid_gemini_muse');
    setDraftSelectedGeminiIds(
      activeRun.selectedGeminiAccountIds && activeRun.selectedGeminiAccountIds.length > 0
        ? activeRun.selectedGeminiAccountIds
        : enabledGeminiAccounts.map((a) => a.id)
    );
    setDraftChairmanId(
      activeRun.chairmanGeminiAccountId ||
        geminiAccounts.find((a) => a.isChairman)?.id ||
        enabledGeminiAccounts[0]?.id ||
        ''
    );
  }, [activeRun?.id, activeRun?.aiWorkforceMode, activeRun?.chairmanGeminiAccountId, activeRun?.selectedGeminiAccountIds?.join(',')]);

  const runTasks = useMemo(() => {
    if (!activeRun) return [];
    return state.tasks.filter((t) => t.runId === activeRun.id);
  }, [state.tasks, activeRun]);

  const scenes = state.projectMemory?.scenes || [];
  const completedImages = scenes.filter((s) => Boolean(s.keyframeImageUrl) && s.imageValidated !== false).length;
  const completedVideos = scenes.filter((s) => Boolean(s.videoUrl)).length;
  const passedQaScenes = scenes.filter((s) => s.qaStatus === 'passed').length;
  const runningTasksCount = runTasks.filter((t) => t.status === 'running').length;
  const queuedTasksCount = runTasks.filter((t) => t.status === 'queued' || t.status === 'blocked_by_deps').length;
  const failedTasksCount = runTasks.filter((t) => t.status === 'failed' || t.status === 'qa_rejected').length;
  const unfinishedCount = runningTasksCount + queuedTasksCount + failedTasksCount;

  const toggleGeminiSelection = (id: string) => {
    setDraftSelectedGeminiIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSaveWorkforce = async () => {
    if (!activeRun) return;
    setBusyAction('save_workforce');
    setNotice('');
    setErrorMsg('');
    try {
      const res = await fetch(
        `/api/command-center/productions/${encodeURIComponent(activeRun.id)}/workforce`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiWorkforceMode: draftMode,
            selectedGeminiAccountIds: draftSelectedGeminiIds,
            chairmanGeminiAccountId: draftChairmanId || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể lưu cấu hình lực lượng AI.');
      setState(data);
      setNotice('Đã lưu chế độ lực lượng AI riêng cho phiên làm việc này.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi cập nhật lực lượng AI.');
    } finally {
      setBusyAction('');
    }
  };

  const handleExecuteCloudHandoff = async () => {
    if (!activeRun) return;
    setBusyAction('handoff_cloud');
    setNotice('');
    setErrorMsg('');
    setShowHandoffConfirm(false);
    try {
      const res = await fetch(
        `/api/command-center/productions/${encodeURIComponent(activeRun.id)}/handoff-cloud`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedGeminiAccountIds: draftSelectedGeminiIds,
            chairmanGeminiAccountId: draftChairmanId || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Chuyển giao lên Đám mây thất bại.');
      if (data.state) setState(data.state);
      setNotice(
        'Đã hoàn tất chuyển giao 7/7 bước lên Gemini Cloud. AI Muse cục bộ đã ngắt kết nối an toàn — bạn có thể tắt máy tính cá nhân.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Chuyển giao lên Đám mây không thành công — AI Muse cục bộ vẫn được giữ nguyên.');
    } finally {
      setBusyAction('');
    }
  };

  if (!activeRun) {
    return (
      <div className="rounded-2xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-8 text-center space-y-2">
        <div className="font-bold text-slate-900 dark:text-white text-sm">
          Chưa có phiên sản xuất nào được chọn
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Hãy tạo hoặc bắt đầu một phiên sản xuất ở tab Tổng quan để chọn lực lượng AI, theo dõi tiến độ trực quan và chuyển giao lên Đám mây.
        </p>
      </div>
    );
  }

  const handoff = activeRun.cloudHandoff;
  const isCloudActive = handoff?.status === 'cloud_active' && handoff.safeToShutdownLocalPc;
  const isHandingOff = Boolean(handoff?.inProgress) || busyAction === 'handoff_cloud';
  const currentMode = activeRun.aiWorkforceMode || 'hybrid_gemini_muse';
  const overallPct = activeRun.overallProgressPct ?? 0;

  const localDeviceLabel =
    handoff?.localDeviceStatus === 'safe_to_shutdown'
      ? 'An toàn để tắt máy'
      : handoff?.localDeviceStatus === 'pausing'
      ? 'Đang khóa nhận việc mới'
      : 'Đang kết nối';

  const museConnLabel =
    currentMode === 'gemini_only' || handoff?.museConnectionStatus === 'disconnected'
      ? 'Đã ngắt kết nối an toàn'
      : handoff?.museConnectionStatus === 'draining'
      ? 'Đang bàn giao checkpoint'
      : state.integrationHealth.muse2ApiReady
      ? 'Đang hoạt động'
      : 'Ngoại tuyến';

  const cloudLabel =
    handoff?.cloudStatus === 'running'
      ? 'Đang thực thi trên Cloud'
      : handoff?.cloudStatus === 'syncing'
      ? 'Đang đồng bộ & xác thực'
      : enabledGeminiAccounts.length > 0
      ? 'Sẵn sàng tiếp nhận'
      : 'Chưa có Gemini API';

  return (
    <div className="space-y-5 text-xs">
      {/* Feedback Banners */}
      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/35 text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ================================================================= */}
      {/* SECTION 1: CHUYỂN GIAO PHIÊN LÊN ĐÁM MÂY (7-STEP ATOMIC HANDOFF)  */}
      {/* ================================================================= */}
      <section className="rounded-2xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 dark:border-slate-400/15 pb-3.5">
          <div>
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Phiên làm việc hiện tại · {RUN_STATUS_TEXT[activeRun.status] || activeRun.status}
            </div>
            <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white mt-0.5">
              {activeRun.title}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-white/10 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Cập nhật</span>
              </button>
            )}
          </div>
        </div>

        {/* 3 Live Status Nodes: Thiết bị cá nhân | AI Muse | Gemini Cloud */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-50/90 dark:bg-[#111731] border border-slate-200 dark:border-slate-400/20 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Laptop className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Thiết bị cá nhân</div>
                <div
                  className={`font-bold text-xs sm:text-sm truncate ${
                    handoff?.safeToShutdownLocalPc
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-900 dark:text-white'
                  }`}
                >
                  {localDeviceLabel}
                </div>
              </div>
            </div>
            {handoff?.safeToShutdownLocalPc && (
              <PowerOff className="w-4 h-4 text-emerald-500 shrink-0" />
            )}
          </div>

          <div className="rounded-xl bg-slate-50/90 dark:bg-[#111731] border border-slate-200 dark:border-slate-400/20 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Cpu className="w-4 h-4 text-cyan-600 dark:text-cyan-300 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">AI Muse cục bộ</div>
                <div
                  className={`font-bold text-xs sm:text-sm truncate ${
                    museConnLabel.includes('ngắt')
                      ? 'text-slate-500 dark:text-slate-400'
                      : state.integrationHealth.muse2ApiReady
                      ? 'text-cyan-700 dark:text-cyan-300'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {museConnLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/90 dark:bg-[#111731] border border-slate-200 dark:border-slate-400/20 p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Cloud className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Gemini Cloud</div>
                <div
                  className={`font-bold text-xs sm:text-sm truncate ${
                    enabledGeminiAccounts.length > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {cloudLabel}
                </div>
              </div>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {draftSelectedGeminiIds.length} API
            </span>
          </div>
        </div>

        {/* Cloud Handoff CTA Row */}
        <div className="rounded-xl bg-slate-50/90 dark:bg-[#111731] border border-slate-200 dark:border-slate-400/20 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-violet-600 dark:text-violet-300" />
              <span>Chuyển giao công việc lên Cloud</span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Lưu trạng thái phiên, khóa checkpoint ảnh/video đã xong (chống tạo trùng), bàn giao {unfinishedCount} tác vụ còn dang dở cho cụm Gemini Cloud, xác thực Cloud sẵn sàng rồi mới ngắt kết nối AI Muse trên máy cá nhân.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isCloudActive ? (
              <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold whitespace-nowrap">
                <ShieldCheck className="w-4 h-4" />
                <span>Đã lên Đám mây · An toàn tắt máy</span>
              </div>
            ) : (
              <button
                type="button"
                disabled={isHandingOff || enabledGeminiAccounts.length === 0}
                onClick={() => setShowHandoffConfirm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs tracking-wide transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {isHandingOff ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4" />
                )}
                <span>{isHandingOff ? 'Đang chuyển giao 7 bước...' : 'Chuyển giao lên Đám mây'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Inline Confirmation Panel (replaces window.confirm) */}
        {showHandoffConfirm && (
          <div className="rounded-xl bg-violet-500/10 border border-violet-500/35 p-4 space-y-3">
            <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm">
              Xác nhận thực hiện quy trình Chuyển giao lên Đám mây (7 bước nguyên tử)?
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Hệ thống sẽ tạm dừng nhận tác vụ mới trên máy cá nhân, khóa checkpoint {completedImages} ảnh + {completedVideos} video đã hoàn thành để tránh tạo trùng, đồng bộ dữ liệu lên Cloud, kiểm tra sống Gemini Cloud và chỉ ngắt kết nối AI Muse sau khi Cloud xác nhận thành công. Nếu bước xác thực thất bại, AI Muse cục bộ vẫn được giữ nguyên.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExecuteCloudHandoff()}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold cursor-pointer whitespace-nowrap"
              >
                Xác nhận chuyển giao ngay
              </button>
              <button
                type="button"
                onClick={() => setShowHandoffConfirm(false)}
                className="px-4 py-2 rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
              >
                Hủy bỏ
              </button>
            </div>
          </div>
        )}

        {/* 7-Step Atomic Checklist */}
        {handoff && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Quy trình chuyển giao 7 bước bắt buộc (không ngắt Muse trước Bước 6)
              </span>
              <span className="tabular-nums">
                Checkpoint bảo toàn: {handoff.preservedCompletedImages} ảnh · {handoff.preservedCompletedVideos} video
                {handoff.checkpointBackupId ? ` · Gói ${handoff.checkpointBackupId}` : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-2">
              {handoff.steps.map((step) => {
                const isDone = step.status === 'completed';
                const isRunning = step.status === 'running';
                const isFailed = step.status === 'failed';
                return (
                  <div
                    key={step.id}
                    className={`rounded-xl border p-2.5 space-y-1 transition-colors ${
                      isDone
                        ? 'bg-emerald-500/[0.06] border-emerald-500/35'
                        : isRunning
                        ? 'bg-violet-500/10 border-violet-500/45'
                        : isFailed
                        ? 'bg-rose-500/10 border-rose-500/40'
                        : 'bg-slate-50/70 dark:bg-[#111731]/70 border-slate-200/80 dark:border-slate-400/15'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                        Bước {step.order}
                      </span>
                      {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : isRunning ? (
                        <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin shrink-0" />
                      ) : isFailed ? (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      ) : (
                        <span className="text-[10px] text-slate-400">Chờ</span>
                      )}
                    </div>
                    <div className="font-semibold text-[11px] text-slate-900 dark:text-white leading-snug">
                      {step.title}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {step.error || step.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* SECTION 2: CHỌN LỰC LƯỢNG AI CHO PHIÊN (3 MODES + MULTI GEMINI)   */}
      {/* ================================================================= */}
      <section className="rounded-2xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-600 dark:text-violet-300" />
              <span>Chọn lực lượng AI cho phiên làm việc này</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Chế độ được lưu riêng cho phiên "{activeRun.title}", không ghi đè cấu hình mặc định toàn hệ thống.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                Quản lý API Gemini
              </button>
            )}
            <button
              type="button"
              disabled={busyAction === 'save_workforce'}
              onClick={() => void handleSaveWorkforce()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              {busyAction === 'save_workforce' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Lưu lực lượng phiên</span>
            </button>
          </div>
        </div>

        {/* 3 Mode Selection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {WORKFORCE_MODES.map((m) => {
            const active = draftMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setDraftMode(m.id)}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer space-y-1.5 ${
                  active
                    ? 'bg-violet-500/10 border-violet-500/60 dark:border-violet-400/60'
                    : 'bg-slate-50/80 dark:bg-[#111731] border-slate-200 dark:border-slate-400/20 hover:border-violet-400/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                    {m.badge}
                  </span>
                  {active && <CheckCircle2 className="w-4 h-4 text-violet-600 dark:text-violet-300 shrink-0" />}
                </div>
                <div className="font-bold text-sm text-slate-900 dark:text-white">{m.title}</div>
                <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">{m.summary}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{m.detail}</p>
              </button>
            );
          })}
        </div>

        {/* Participating Gemini Accounts + Chairman Selector (shown when mode != muse_only) */}
        {draftMode !== 'muse_only' && (
          <div className="rounded-xl bg-slate-50/90 dark:bg-[#111731] border border-slate-200 dark:border-slate-400/20 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                <span>Chọn các tài khoản Gemini API tham gia phiên ({draftSelectedGeminiIds.length}/{enabledGeminiAccounts.length})</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Chỉ huy trưởng phiên:
                </span>
                <select
                  value={draftChairmanId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setDraftChairmanId(id);
                    if (id && !draftSelectedGeminiIds.includes(id)) {
                      setDraftSelectedGeminiIds((prev) => [id, ...prev]);
                    }
                  }}
                  className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                >
                  {enabledGeminiAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label} {acc.isChairman ? '(Mặc định)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {enabledGeminiAccounts.length === 0 ? (
              <div className="text-rose-600 dark:text-rose-400 text-xs">
                Chưa có tài khoản Gemini API nào đang bật. Hãy mở Cài đặt → Kết nối API Gemini để thêm API Key.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {enabledGeminiAccounts.map((acc) => {
                  const checked = draftSelectedGeminiIds.includes(acc.id);
                  const isSessionChairman = draftChairmanId === acc.id;
                  return (
                    <label
                      key={acc.id}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition ${
                        checked
                          ? 'bg-white dark:bg-[#0c1021] border-violet-500/45'
                          : 'bg-transparent border-slate-200/80 dark:border-slate-700/60 opacity-75'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGeminiSelection(acc.id)}
                        className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-violet-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                          <span className="truncate">{acc.label}</span>
                          {isSessionChairman && <Crown className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                          {acc.maskedKey} · {acc.status === 'healthy' ? 'Khỏe' : acc.status === 'quota_exceeded' ? 'Hết quota' : acc.status === 'untested' ? 'Chưa test' : 'Lỗi'}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                Chỉ huy trưởng điều phối các Gemini &amp; Muse nhưng không được tự ý thay đổi quy trình sản xuất đã khóa.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* SECTION 3: THEO DÕI TIẾN ĐỘ LÀM VIỆC CỦA CÁC AI TRỰC QUAN         */}
      {/* ================================================================= */}
      <section className="rounded-2xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 sm:p-5 space-y-5">
        {/* Overall Progress Bar + Tabular Metrics */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Tiến độ làm việc trực quan của đội ngũ AI
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Theo dõi trực tiếp tiến độ từng Gemini API, 5 AI Muse và từng phân cảnh phim theo thời gian thực.
              </p>
            </div>
            <div className="text-right tabular-nums">
              <div className="text-2xl font-extrabold text-slate-900 dark:text-white leading-none">
                {overallPct}%
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {completedImages}/{scenes.length} ảnh · {completedVideos}/{scenes.length} video · {passedQaScenes}/{scenes.length} QA đạt
              </div>
            </div>
          </div>

          <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-violet-600 dark:bg-violet-500 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, overallPct))}%` }}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 tabular-nums">
            <div className="rounded-xl bg-slate-50 dark:bg-[#111731] border border-slate-200/80 dark:border-slate-400/15 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Đang chạy</div>
              <div className="text-lg font-bold text-cyan-600 dark:text-cyan-400 mt-0.5">{runningTasksCount}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#111731] border border-slate-200/80 dark:border-slate-400/15 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Trong hàng đợi</div>
              <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{queuedTasksCount}</div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#111731] border border-slate-200/80 dark:border-slate-400/15 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Ảnh đã xong</div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {completedImages}/{scenes.length}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#111731] border border-slate-200/80 dark:border-slate-400/15 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Video đã xong</div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {completedVideos}/{scenes.length}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-[#111731] border border-slate-200/80 dark:border-slate-400/15 p-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Cần xử lý / Lỗi</div>
              <div className={`text-lg font-bold mt-0.5 ${failedTasksCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>
                {failedTasksCount}
              </div>
            </div>
          </div>
        </div>

        {/* Gemini Cloud Workforce Live Cards */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-900 dark:text-white">
              Cụm Gemini Cloud ({(activeRun.perGeminiProgress || []).length} tài khoản)
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {currentMode === 'muse_only'
                ? 'Đang tạm nghỉ (Chế độ Chỉ Muse)'
                : isCloudActive
                ? 'Đang gánh toàn bộ dây chuyền trên Cloud'
                : 'Đang phối hợp điều phối & sản xuất'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(activeRun.perGeminiProgress || []).map((gp) => (
              <div
                key={gp.accountId}
                className={`rounded-xl border p-3.5 space-y-2.5 ${
                  gp.isChairman
                    ? 'bg-violet-500/[0.05] border-violet-500/35'
                    : 'bg-slate-50/80 dark:bg-[#111731] border-slate-200/80 dark:border-slate-400/15'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span className="truncate">{gp.label}</span>
                      {gp.isChairman && <Crown className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {gp.isChairman ? 'Chỉ huy trưởng (Gemini Chairman)' : 'Gemini Worker'} ·{' '}
                      {gp.runningTasks > 0
                        ? `Đang chạy ${gp.runningTasks} việc`
                        : gp.queuedTasks > 0
                        ? `Chờ ${gp.queuedTasks} việc`
                        : 'Sẵn sàng'}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-sm tabular-nums text-slate-900 dark:text-white">
                    {gp.progressPct}%
                  </span>
                </div>

                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      gp.failedTasks > 0 ? 'bg-amber-500' : 'bg-violet-500'
                    }`}
                    style={{ width: `${gp.progressPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  <span>Xong: {gp.completedTasks}/{gp.totalTasks}</span>
                  <span>Lỗi: {gp.failedTasks}</span>
                </div>

                <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                  {gp.currentTaskTitle ? `Tác vụ: ${gp.currentTaskTitle}` : 'Không có tác vụ đang chờ'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5 AI Muse Live Progress Cards */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-900 dark:text-white">
              Đội ngũ 5 AI Muse ({state.agents.length} nhân sự)
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {currentMode === 'gemini_only'
                ? 'Đã ngắt kết nối cục bộ (Gemini Cloud đảm nhiệm)'
                : 'Đang chạy song song từng phân cảnh'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {state.agents.map((ag) => {
              const mp = (activeRun.perMuseProgress || []).find((p) => p.agentId === ag.id);
              const pct = mp?.progressPct ?? 0;
              const bypassed = currentMode === 'gemini_only';

              return (
                <div
                  key={ag.id}
                  className={`rounded-xl border p-3 space-y-2 ${
                    bypassed
                      ? 'bg-slate-50/60 dark:bg-[#0e1328] border-slate-200/70 dark:border-slate-700/40 opacity-75'
                      : 'bg-slate-50/90 dark:bg-[#111731] border-slate-200/80 dark:border-slate-400/15'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentAvatar agent={ag} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 dark:text-white truncate">{ag.name}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {bypassed ? 'Đã bàn giao Cloud' : ag.roleTitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] tabular-nums">
                    <span
                      className={`font-semibold ${
                        bypassed
                          ? 'text-slate-400'
                          : mp && mp.runningTasks > 0
                          ? 'text-cyan-600 dark:text-cyan-400'
                          : mp && mp.failedTasks > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {bypassed
                        ? 'Đã ngắt kết nối'
                        : mp && mp.runningTasks > 0
                        ? `Đang làm (${mp.runningTasks})`
                        : mp && mp.completedTasks > 0 && mp.completedTasks === mp.totalTasks
                        ? 'Hoàn tất'
                        : 'Sẵn sàng'}
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{pct}%</span>
                  </div>

                  <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate tabular-nums">
                    {mp?.currentTaskTitle || `${mp?.completedTasks || 0}/${mp?.totalTasks || 0} tác vụ xong`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Visual Per-Scene Stage Pipeline */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-slate-900 dark:text-white">
              Bảng tiến độ trực quan theo từng phân cảnh ({scenes.length} cảnh)
            </div>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Kịch bản → Ảnh cảnh → QA Ảnh → Video → QA Video (khóa checkpoint chống tạo trùng)
            </span>
          </div>

          {scenes.length === 0 ? (
            <div className="rounded-xl bg-slate-50 dark:bg-[#111731] border border-slate-200 dark:border-slate-400/20 p-6 text-center text-slate-500 dark:text-slate-400">
              Chưa có phân cảnh nào trong phiên hiện tại.
            </div>
          ) : (
            <div className="divide-y divide-slate-200/80 dark:divide-slate-400/15 rounded-xl bg-slate-50/70 dark:bg-[#111731]/70 border border-slate-200 dark:border-slate-400/20 overflow-hidden">
              {scenes.map((sc) => {
                const steps = computeSceneSteps(sc);
                const sceneTasks = runTasks.filter((t) => t.sceneId === sc.sceneId);
                const activeTask = sceneTasks.find((t) => t.status === 'running');
                const latestGeminiLabel =
                  activeTask?.assignedGeminiAccountLabel ||
                  sceneTasks.find((t) => t.assignedGeminiAccountLabel)?.assignedGeminiAccountLabel;
                const isCheckpointed = sceneTasks.some((t) => t.checkpointed);

                return (
                  <div
                    key={sc.sceneId}
                    className="p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                  >
                    {/* Scene Identity + Thumbnail */}
                    <div className="flex items-center gap-3 min-w-0 lg:w-72 shrink-0">
                      <div className="w-16 h-10 rounded-lg bg-slate-200 dark:bg-slate-800 border border-slate-300/60 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                        {sc.keyframeImageUrl ? (
                          <img
                            src={sc.keyframeImageUrl}
                            alt={`Cảnh ${sc.index}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 dark:text-white truncate">
                          Cảnh {String(sc.index).padStart(2, '0')} · {sc.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {latestGeminiLabel
                            ? `Gemini: ${latestGeminiLabel}`
                            : sc.assignedProducerAgentId
                            ? `Phụ trách: ${sc.assignedProducerAgentId.toUpperCase()}`
                            : 'Chờ phân công'}
                          {isCheckpointed ? ' · Checkpoint khóa' : ''}
                        </div>
                      </div>
                    </div>

                    {/* 5 Visual Stage Progress Nodes */}
                    <div className="flex-1 grid grid-cols-5 gap-1.5">
                      {steps.map((st) => (
                        <div
                          key={st.key}
                          className={`px-2 py-1.5 rounded-lg border text-center text-[11px] font-medium transition-colors ${
                            st.failed
                              ? 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300'
                              : st.done
                              ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                              : st.active
                              ? 'bg-cyan-500/15 border-cyan-500/45 text-cyan-700 dark:text-cyan-300 font-bold'
                              : 'bg-white/70 dark:bg-[#0c1021]/70 border-slate-200/80 dark:border-slate-700/60 text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          <div className="truncate">{st.label}</div>
                          <div className="text-[10px] mt-0.5">
                            {st.failed ? 'Cần sửa' : st.done ? 'Xong' : st.active ? 'Đang chạy' : 'Chờ'}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Quick Media Status */}
                    <div className="flex items-center gap-3 text-[11px] shrink-0 tabular-nums lg:w-36 justify-end">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          sc.keyframeImageUrl ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'
                        }`}
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>{sc.keyframeImageUrl ? 'Ảnh' : '—'}</span>
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 ${
                          sc.videoUrl ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'
                        }`}
                      >
                        <Film className="w-3.5 h-3.5" />
                        <span>{sc.videoUrl ? 'Video' : '—'}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
