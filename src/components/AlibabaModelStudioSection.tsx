import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Film,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Loader2,
  Power,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type {
  AlibabaConnectionStatus,
  AlibabaModelStudioStatus,
  AlibabaRegionId,
} from '../types/bilibili';

interface AlibabaModelStudioSectionProps {
  isDefaultAiProvider: boolean;
  onSelectAsDefaultProvider: () => void;
  onConfigChanged?: () => void;
}

const STATUS_META: Record<
  AlibabaConnectionStatus,
  { label: string; textClass: string; dotClass: string }
> = {
  ready: {
    label: 'Sẵn sàng hoạt động',
    textClass: 'text-emerald-600 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  untested: {
    label: 'Đã có khóa · Chưa test',
    textClass: 'text-cyan-600 dark:text-cyan-400',
    dotClass: 'bg-cyan-500',
  },
  auth_error: {
    label: 'Sai khóa hoặc sai khu vực (401)',
    textClass: 'text-rose-600 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
  quota_exceeded: {
    label: 'Chạm hạn mức / Hết số dư (429)',
    textClass: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  error: {
    label: 'Lỗi kết nối',
    textClass: 'text-rose-600 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
  unconfigured: {
    label: 'Chưa đặt DASHSCOPE_API_KEY',
    textClass: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
};

const QWEN_PRESETS = [
  'qwen-plus',
  'qwen-max',
  'qwen-turbo',
  'qwen3-max',
  'qwen-vl-max',
  'qwen-vl-plus',
  'qwq-plus',
];

const QWEN_IMAGE_PRESETS = [
  'qwen-image-plus',
  'qwen-image',
  'qwen-image-2.0-pro',
  'qwen-image-max',
];

const QWEN_VIDEO_PRESETS = [
  'wan2.5-i2v-preview',
  'wan2.6-i2v',
  'wan2.2-i2v-plus',
  'wan2.5-t2v-preview',
];

export const AlibabaModelStudioSection: React.FC<AlibabaModelStudioSectionProps> = ({
  isDefaultAiProvider,
  onSelectAsDefaultProvider,
  onConfigChanged,
}) => {
  const [status, setStatus] = useState<AlibabaModelStudioStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [enabledDraft, setEnabledDraft] = useState(true);
  const [regionDraft, setRegionDraft] = useState<AlibabaRegionId>('intl');
  const [modelDraft, setModelDraft] = useState('qwen-plus');
  const [imageModelDraft, setImageModelDraft] = useState('qwen-image-plus');
  const [videoModelDraft, setVideoModelDraft] = useState('wan2.5-i2v-preview');
  const [timeoutDraft, setTimeoutDraft] = useState(60);

  const [modelSearch, setModelSearch] = useState('');
  const [testPrompt, setTestPrompt] = useState(
    'Chào Qwen, xác nhận bạn đã kết nối thành công từ Alibaba Cloud Model Studio trong 1 câu ngắn.'
  );
  const [chatResult, setChatResult] = useState<{
    reply: string;
    model: string;
    latencyMs: number;
    usage?: { totalTokens?: number };
  } | null>(null);

  const syncDrafts = useCallback((st: AlibabaModelStudioStatus) => {
    setEnabledDraft(st.enabled);
    setRegionDraft(st.region);
    setModelDraft(st.selectedModel || 'qwen-plus');
    setImageModelDraft(st.imageModel || 'qwen-image-plus');
    setVideoModelDraft(st.videoModel || 'wan2.5-i2v-preview');
    setTimeoutDraft(st.timeoutSec || 60);
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alibaba/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể tải trạng thái Alibaba Cloud Model Studio.');
      setStatus(data);
      syncDrafts(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi tải cấu hình Alibaba Cloud.');
    } finally {
      setLoading(false);
    }
  }, [syncDrafts]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSaveConfig = async (override?: {
    enabled?: boolean;
    region?: AlibabaRegionId;
    selectedModel?: string;
    imageModel?: string;
    videoModel?: string;
    timeoutSec?: number;
  }) => {
    setBusyAction('save');
    setNotice('');
    setErrorMsg('');
    try {
      const res = await fetch('/api/alibaba/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: override?.enabled ?? enabledDraft,
          region: override?.region ?? regionDraft,
          selectedModel: (override?.selectedModel ?? modelDraft).trim(),
          imageModel: (override?.imageModel ?? imageModelDraft).trim(),
          videoModel: (override?.videoModel ?? videoModelDraft).trim(),
          timeoutSec: override?.timeoutSec ?? timeoutDraft,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Không thể lưu cấu hình Alibaba Cloud.');
      }
      setStatus(data.status);
      syncDrafts(data.status);
      setNotice(
        `Đã lưu cấu hình Alibaba Cloud Model Studio (${data.status.selectedModel} · Ảnh: ${data.status.imageModel} · Video: ${data.status.videoModel}).`
      );
      onConfigChanged?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lưu cấu hình thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleFetchModels = async () => {
    setBusyAction('models');
    setNotice('');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/alibaba/models?region=${encodeURIComponent(regionDraft)}`);
      const data = await res.json();
      if (data?.status) setStatus(data.status);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Không thể tải danh sách model Qwen.');
      }
      setNotice(data.message || `Đã tải ${data.models?.length || 0} model.`);
      onConfigChanged?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi tải danh sách model.');
    } finally {
      setBusyAction('');
    }
  };

  const handleTestConnection = async () => {
    setBusyAction('test');
    setNotice('');
    setErrorMsg('');
    try {
      const res = await fetch('/api/alibaba/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelDraft.trim() || undefined,
          region: regionDraft,
        }),
      });
      const data = await res.json();
      if (data?.status) setStatus(data.status);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Kiểm tra kết nối Alibaba Cloud thất bại.');
      }
      setNotice(
        `${data.message}${data.reply ? ` · Phản hồi: "${String(data.reply).slice(0, 60)}"` : ''}`
      );
      onConfigChanged?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kiểm tra kết nối thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleQuickChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim()) return;
    setBusyAction('chat');
    setNotice('');
    setErrorMsg('');
    setChatResult(null);
    try {
      const res = await fetch('/api/alibaba/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: testPrompt.trim(),
          model: modelDraft.trim() || undefined,
          region: regionDraft,
          maxTokens: 320,
        }),
      });
      const data = await res.json();
      if (data?.status) setStatus(data.status);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Gọi thử model Qwen thất bại.');
      }
      setChatResult({
        reply: data.reply,
        model: data.model,
        latencyMs: data.latencyMs,
        usage: data.usage,
      });
      setNotice(`Nhận phản hồi từ ${data.model} trong ${data.latencyMs}ms.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gọi thử thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const statusMeta = STATUS_META[status?.status || 'unconfigured'] || STATUS_META.unconfigured;

  const filteredModels = useMemo(() => {
    const list = status?.models || [];
    const q = modelSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.id.toLowerCase().includes(q));
  }, [status?.models, modelSearch]);

  return (
    <div className="rounded-2xl bg-white dark:bg-[#0c1021]/95 border border-orange-500/35 dark:border-orange-400/30 p-4 space-y-3.5 text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 dark:border-slate-400/15 pb-3">
        <div className="flex items-start gap-2.5">
          <Cloud className="w-4 h-4 text-orange-500 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <div className="font-bold text-slate-900 dark:text-white text-sm flex flex-wrap items-center gap-2">
              <span>Cấu hình Alibaba Cloud Model Studio (Qwen / DashScope)</span>
              <span className="font-mono text-[11px] font-medium text-orange-600 dark:text-orange-300">
                modelstudio.console.alibabacloud.com
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Kết nối chuẩn OpenAI Compatible tới dòng mô hình <strong>Qwen</strong> (qwen-plus, qwen-max, qwen3-max, qwen-vl-max). Chọn đúng khu vực bạn đã tạo API Key trên Console.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={Boolean(busyAction) || !status?.hasKey}
            onClick={() => void handleFetchModels()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-800 dark:text-slate-100 hover:border-orange-400/60 transition cursor-pointer disabled:opacity-50"
          >
            {busyAction === 'models' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Layers className="w-3.5 h-3.5 text-orange-500" />
            )}
            <span>Tải Model</span>
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction) || !status?.hasKey}
            onClick={() => void handleTestConnection()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/35 text-orange-800 dark:text-orange-200 transition cursor-pointer disabled:opacity-50"
          >
            {busyAction === 'test' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            <span>Test kết nối Qwen</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchStatus()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* 3 Compact Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="rounded-xl bg-slate-50/90 dark:bg-[#131a35]/80 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Trạng thái &amp; Độ trễ</div>
          <div className={`flex items-center gap-1.5 font-bold ${statusMeta.textClass}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotClass}`} />
            <span className="truncate">{statusMeta.label}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {status?.lastLatencyMs ? `${status.lastLatencyMs}ms · ` : ''}
            {status?.successCount ?? 0} thành công / {status?.errorCount ?? 0} lỗi
          </div>
        </div>

        <div className="rounded-xl bg-slate-50/90 dark:bg-[#131a35]/80 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Khóa DASHSCOPE_API_KEY (Secrets / .env)</div>
          <div className="flex items-center gap-1.5 font-mono font-semibold text-violet-700 dark:text-violet-300 truncate">
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{status?.maskedKey || 'Chưa thiết lập'}</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {status?.hasKey ? 'Đã nạp an toàn từ máy chủ' : 'Lấy tại Model Studio → API-KEY'}
          </div>
        </div>

        <div className="rounded-xl bg-slate-50/90 dark:bg-[#131a35]/80 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Endpoint đang dùng</div>
          <div className="font-mono font-semibold text-slate-900 dark:text-white truncate">
            {status?.baseUrl || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Model: <span className="font-mono text-orange-600 dark:text-orange-300">{status?.selectedModel || modelDraft}</span>
          </div>
        </div>
      </div>

      {/* Env Setup Guide when key missing */}
      {!status?.hasKey && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-1.5 text-amber-900 dark:text-amber-200">
          <div className="font-bold flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Cách gắn khóa API tài khoản Alibaba Cloud Model Studio vừa đăng ký</span>
          </div>
          <ol className="list-decimal list-inside space-y-0.5 text-[11px] leading-relaxed">
            <li>
              Mở trang <strong>modelstudio.console.alibabacloud.com</strong> → chọn mục <strong>API-KEY</strong> ở góc phải hoặc thanh bên → tạo &amp; sao chép khóa bắt đầu bằng <code className="font-mono">sk-...</code>.
            </li>
            <li>
              Mở <strong>Settings &gt; Secrets</strong> của ứng dụng (hoặc tệp <code className="font-mono">.env</code> khi chạy máy cá nhân) và thêm biến <code className="font-mono font-bold">DASHSCOPE_API_KEY</code>.
            </li>
            <li>
              Chọn đúng <strong>Khu vực (Singapore Quốc tế / US / Bắc Kinh)</strong> trùng với khu vực tạo khóa rồi bấm <strong>Test kết nối Qwen</strong>.
            </li>
          </ol>
        </div>
      )}

      {/* Region + Model + Toggle Row */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <label className="md:col-span-4 space-y-1">
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            Khu vực máy chủ Alibaba Cloud
          </span>
          <select
            value={regionDraft}
            onChange={(e) => setRegionDraft(e.target.value as AlibabaRegionId)}
            className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-orange-400"
          >
            <option value="intl">Quốc tế / Singapore (dashscope-intl · Khuyên dùng)</option>
            <option value="us">Mỹ / US Virginia (dashscope-us)</option>
            <option value="cn">Trung Quốc / Bắc Kinh (dashscope)</option>
          </select>
        </label>

        <label className="md:col-span-4 space-y-1">
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            Mã Model Qwen mặc định
          </span>
          <input
            type="text"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            placeholder="VD: qwen-plus, qwen-max, qwen3-max"
            className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-orange-400"
          />
        </label>

        <div className="md:col-span-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={busyAction === 'save'}
            onClick={() => void handleSaveConfig()}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            {busyAction === 'save' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Lưu</span>
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => {
              const next = !enabledDraft;
              setEnabledDraft(next);
              void handleSaveConfig({ enabled: next });
            }}
            className={`inline-flex items-center gap-1 h-9 px-2.5 rounded-xl text-[11px] font-semibold border transition cursor-pointer ${
              enabledDraft
                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                : 'bg-slate-100 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-500'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{enabledDraft ? 'Đang bật' : 'Đã tắt'}</span>
          </button>

          <button
            type="button"
            onClick={onSelectAsDefaultProvider}
            disabled={isDefaultAiProvider}
            className={`inline-flex items-center gap-1 h-9 px-3 rounded-xl text-[11px] font-semibold border transition cursor-pointer whitespace-nowrap ${
              isDefaultAiProvider
                ? 'bg-violet-500/20 border-violet-500/45 text-violet-800 dark:text-violet-200 cursor-default'
                : 'bg-violet-600 hover:bg-violet-500 border-violet-600 text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isDefaultAiProvider ? 'Đang chọn mặc định' : 'Dùng làm AI mặc định'}</span>
          </button>
        </div>
      </div>

      {/* Quick Qwen Presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Model Qwen kịch bản:</span>
        {QWEN_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setModelDraft(preset)}
            className={`px-2 py-1 rounded-lg font-mono text-[11px] border transition cursor-pointer ${
              modelDraft === preset
                ? 'bg-orange-500/20 border-orange-500/45 text-orange-800 dark:text-orange-200 font-semibold'
                : 'bg-slate-50 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-orange-400/50'
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      {/* Qwen Image & Video Models */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 border-t border-slate-200/80 dark:border-slate-400/15">
        <div className="space-y-1.5">
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              <ImageIcon className="w-3.5 h-3.5 text-orange-500" />
              <span>Model AI Qwen tạo ảnh (Nhân vật &amp; Cảnh)</span>
            </span>
            <input
              type="text"
              value={imageModelDraft}
              onChange={(e) => setImageModelDraft(e.target.value)}
              placeholder="qwen-image-plus"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-orange-400"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {QWEN_IMAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setImageModelDraft(preset)}
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] border transition cursor-pointer ${
                  imageModelDraft === preset
                    ? 'bg-orange-500/20 border-orange-500/45 text-orange-800 dark:text-orange-200 font-semibold'
                    : 'bg-slate-50 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-orange-400/50'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
              <Film className="w-3.5 h-3.5 text-orange-500" />
              <span>Model AI Qwen / Wan tạo Video (I2V &amp; T2V)</span>
            </span>
            <input
              type="text"
              value={videoModelDraft}
              onChange={(e) => setVideoModelDraft(e.target.value)}
              placeholder="wan2.5-i2v-preview"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-orange-400"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {QWEN_VIDEO_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setVideoModelDraft(preset)}
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] border transition cursor-pointer ${
                  videoModelDraft === preset
                    ? 'bg-orange-500/20 border-orange-500/45 text-orange-800 dark:text-orange-200 font-semibold'
                    : 'bg-slate-50 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-orange-400/50'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Optional Discovered Models + Quick Prompt Tester */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
        {status && status.models.length > 0 && (
          <div className="lg:col-span-6 rounded-xl bg-slate-50/90 dark:bg-[#070913]/80 border border-slate-200 dark:border-slate-400/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900 dark:text-white">
                Model khả dụng ({status.models.length})
              </span>
              <div className="relative w-44">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Lọc tên model..."
                  className="w-full h-7 pl-8 pr-2 rounded-lg bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-orange-400"
                />
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto divide-y divide-slate-200/80 dark:divide-slate-400/15 rounded-lg border border-slate-200 dark:border-slate-400/20 bg-white dark:bg-[#0c1021]">
              {filteredModels.map((m) => {
                const active = status.selectedModel === m.id;
                return (
                  <div
                    key={m.id}
                    className={`px-2.5 py-1.5 flex items-center justify-between gap-2 ${
                      active ? 'bg-orange-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className="font-mono text-[11px] text-slate-800 dark:text-slate-100 truncate">
                      {m.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setModelDraft(m.id);
                        void handleSaveConfig({ selectedModel: m.id });
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer shrink-0 ${
                        active
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-100 dark:bg-[#131a35] text-slate-700 dark:text-slate-200 hover:bg-orange-500/15'
                      }`}
                    >
                      {active ? 'Đang dùng' : 'Chọn'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <form
          onSubmit={handleQuickChat}
          className={`${
            status && status.models.length > 0 ? 'lg:col-span-6' : 'lg:col-span-12'
          } rounded-xl bg-slate-50/90 dark:bg-[#070913]/80 border border-slate-200 dark:border-slate-400/20 p-3 space-y-2`}
        >
          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-orange-500" />
            <span>Thử gọi nhanh tới Alibaba Cloud Model Studio ({modelDraft})</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Nhập câu lệnh thử gửi tới Qwen..."
              className="flex-1 h-9 px-3 rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-orange-400"
            />
            <button
              type="submit"
              disabled={Boolean(busyAction) || !status?.hasKey || !testPrompt.trim()}
              className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-xl bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold text-xs transition cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              {busyAction === 'chat' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Gửi thử</span>
            </button>
          </div>
          {chatResult && (
            <div className="rounded-lg bg-white dark:bg-[#0c1021] border border-emerald-500/30 p-2.5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span>{chatResult.model}</span>
                <span className="tabular-nums">
                  {chatResult.latencyMs}ms
                  {chatResult.usage?.totalTokens ? ` · ${chatResult.usage.totalTokens} tokens` : ''}
                </span>
              </div>
              <p className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
                {chatResult.reply}
              </p>
            </div>
          )}
        </form>
      </div>

      {/* Status notices / errors */}
      {status?.lastError && !errorMsg && (
        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Lỗi gần nhất: {status.lastError}</span>
        </div>
      )}
      {notice && (
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
