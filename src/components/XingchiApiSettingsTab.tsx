import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  FileCode2,
  Globe,
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
  XingchiConnectionStatus,
  XingchiModelItem,
  XingchiProtocol,
  XingchiPublicStatus,
  XingchiWebSearchMode,
} from '../types/bilibili';

interface XingchiApiSettingsTabProps {
  isDefaultAiProvider: boolean;
  onSelectAsDefaultProvider: () => void;
  onConfigChanged?: () => void;
}

const STATUS_META: Record<
  XingchiConnectionStatus,
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
    label: 'Sai XINGCHI_API_KEY (401)',
    textClass: 'text-rose-600 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
  quota_exceeded: {
    label: 'Hết hạn mức / Số dư (429)',
    textClass: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  error: {
    label: 'Lỗi kết nối cổng',
    textClass: 'text-rose-600 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
  unconfigured: {
    label: 'Chưa đặt XINGCHI_API_KEY',
    textClass: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
};

const QUICK_MODEL_PRESETS = [
  'gpt-6.1-sol',
  'gpt-4o-mini',
  'gpt-4o',
  'claude-sonnet-4-5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
];

function getProtocolLabel(protocol: XingchiProtocol): string {
  if (protocol === 'responses') return '/v1/responses (Responses API)';
  if (protocol === 'anthropic') return '/v1/messages (Anthropic)';
  return '/v1/chat/completions (OpenAI)';
}

export const XingchiApiSettingsTab: React.FC<XingchiApiSettingsTabProps> = ({
  isDefaultAiProvider,
  onSelectAsDefaultProvider,
  onConfigChanged,
}) => {
  const [status, setStatus] = useState<XingchiPublicStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Editable non-secret config draft
  const [enabledDraft, setEnabledDraft] = useState(true);
  const [protocolDraft, setProtocolDraft] = useState<XingchiProtocol>('responses');
  const [modelDraft, setModelDraft] = useState('gpt-6.1-sol');
  const [reviewModelDraft, setReviewModelDraft] = useState('gpt-6.1-sol');
  const [webSearchDraft, setWebSearchDraft] = useState<XingchiWebSearchMode>('live');
  const [disableStorageDraft, setDisableStorageDraft] = useState(true);
  const [imageGenDraft, setImageGenDraft] = useState(true);
  const [actorAuthDraft, setActorAuthDraft] = useState('local-image-extension');
  const [timeoutDraft, setTimeoutDraft] = useState(75);

  // Collapsible TOML import drawer
  const [showTomlImport, setShowTomlImport] = useState(false);
  const [tomlDraft, setTomlDraft] = useState('');

  // Model explorer filters
  const [familyFilter, setFamilyFilter] = useState<'all' | XingchiModelItem['family']>('all');
  const [modelSearch, setModelSearch] = useState('');

  // Live sandbox prompt & image test
  const [testPrompt, setTestPrompt] = useState(
    'Giới thiệu ngắn trong 1 câu về trạng thái hoạt động của model hiện tại.'
  );
  const [chatResult, setChatResult] = useState<{
    reply: string;
    model: string;
    protocol: XingchiProtocol;
    latencyMs: number;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  } | null>(null);
  const [imageTestResult, setImageTestResult] = useState<{
    dataUrl: string;
    model: string;
    latencyMs: number;
  } | null>(null);

  const syncDraftsFromStatus = useCallback((st: XingchiPublicStatus) => {
    setEnabledDraft(st.enabled);
    setProtocolDraft(st.protocol || 'responses');
    setModelDraft(st.selectedModel || 'gpt-6.1-sol');
    setReviewModelDraft(st.reviewModel || st.selectedModel || 'gpt-6.1-sol');
    setWebSearchDraft(st.webSearch === 'off' ? 'off' : 'live');
    setDisableStorageDraft(st.disableResponseStorage !== false);
    setImageGenDraft(st.imageGeneration !== false);
    setActorAuthDraft(st.httpHeaders?.['x-openai-actor-authorization'] || '');
    setTimeoutDraft(st.timeoutSec || 75);
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/xingchi/status');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể tải trạng thái Xingchi API.');
      setStatus(data);
      syncDraftsFromStatus(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi tải cấu hình Xingchi API.');
    } finally {
      setLoading(false);
    }
  }, [syncDraftsFromStatus]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSaveConfig = async (override?: {
    enabled?: boolean;
    protocol?: XingchiProtocol;
    selectedModel?: string;
    reviewModel?: string;
    webSearch?: XingchiWebSearchMode;
    disableResponseStorage?: boolean;
    imageGeneration?: boolean;
    actorAuth?: string;
    timeoutSec?: number;
  }) => {
    setBusyAction('save');
    setNotice('');
    setErrorMsg('');
    try {
      const actorVal = (override?.actorAuth ?? actorAuthDraft).trim();
      const nextHeaders: Record<string, string> = { ...(status?.httpHeaders || {}) };
      if (actorVal) {
        nextHeaders['x-openai-actor-authorization'] = actorVal;
      } else {
        delete nextHeaders['x-openai-actor-authorization'];
      }
      const payload = {
        enabled: override?.enabled ?? enabledDraft,
        protocol: override?.protocol ?? protocolDraft,
        selectedModel: (override?.selectedModel ?? modelDraft).trim(),
        reviewModel: (override?.reviewModel ?? reviewModelDraft).trim(),
        webSearch: override?.webSearch ?? webSearchDraft,
        disableResponseStorage: override?.disableResponseStorage ?? disableStorageDraft,
        imageGeneration: override?.imageGeneration ?? imageGenDraft,
        httpHeaders: nextHeaders,
        timeoutSec: override?.timeoutSec ?? timeoutDraft,
      };
      const res = await fetch('/api/xingchi/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Không thể lưu cấu hình Xingchi API.');
      }
      setStatus(data.status);
      syncDraftsFromStatus(data.status);
      setNotice(
        `Đã lưu cấu hình Xingchi API (${data.status.selectedModel} · wire_api=${data.status.protocol}).`
      );
      onConfigChanged?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lưu cấu hình thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleImportToml = async () => {
    if (!tomlDraft.trim()) return;
    setBusyAction('toml');
    setNotice('');
    setErrorMsg('');
    try {
      const res = await fetch('/api/xingchi/import-toml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml: tomlDraft }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Không thể nạp cấu hình TOML.');
      }
      setStatus(data.status);
      syncDraftsFromStatus(data.status);
      setTomlDraft('');
      setShowTomlImport(false);
      const summary = Array.isArray(data.appliedFields) ? data.appliedFields.join(', ') : '';
      setNotice(
        `Đã nạp cấu hình TOML (${summary}).${data.warning ? ` Lưu ý: ${data.warning}` : ''}`
      );
      onConfigChanged?.();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Nạp cấu hình TOML thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleFetchModels = async () => {
    setBusyAction('models');
    setNotice('');
    setErrorMsg('');
    try {
      const res = await fetch('/api/xingchi/models');
      const data = await res.json();
      if (data?.status) {
        setStatus(data.status);
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Không thể tải danh sách model từ api.xingchiapi.com.');
      }
      setNotice(data.message || `Đã tải ${data.models?.length || 0} model từ Xingchi API.`);
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
      const res = await fetch('/api/xingchi/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelDraft.trim() || undefined,
          protocol: protocolDraft,
        }),
      });
      const data = await res.json();
      if (data?.status) {
        setStatus(data.status);
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Kiểm tra kết nối Xingchi API thất bại.');
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

  const handleRunQuickPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPrompt.trim()) return;
    setBusyAction('chat');
    setNotice('');
    setErrorMsg('');
    setChatResult(null);
    try {
      const res = await fetch('/api/xingchi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: testPrompt.trim(),
          model: modelDraft.trim() || undefined,
          protocol: protocolDraft,
          useWebSearch: webSearchDraft === 'live',
          maxTokens: 320,
        }),
      });
      const data = await res.json();
      if (data?.status) {
        setStatus(data.status);
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || 'Gọi thử Xingchi API thất bại.');
      }
      setChatResult({
        reply: data.reply,
        model: data.model,
        protocol: data.protocol,
        latencyMs: data.latencyMs,
        usage: data.usage,
      });
      setNotice(`Nhận phản hồi từ ${data.model} (${data.protocol}) sau ${data.latencyMs}ms.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gọi thử model thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const handleTestImageGen = async () => {
    setBusyAction('image');
    setNotice('');
    setErrorMsg('');
    setImageTestResult(null);
    try {
      const res = await fetch('/api/xingchi/image-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: testPrompt.trim() || 'Cinematic warm sunlit studio coffee cup on wooden table, ultra detailed',
          aspectRatio: '1:1',
          model: modelDraft.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data?.status) {
        setStatus(data.status);
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Thử tạo ảnh qua Xingchi API thất bại.');
      }
      setImageTestResult({
        dataUrl: data.dataUrl,
        model: data.model,
        latencyMs: data.latencyMs,
      });
      setNotice(`Tạo ảnh thử thành công bằng ${data.model} (${data.latencyMs}ms).`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Tạo ảnh thử thất bại.');
    } finally {
      setBusyAction('');
    }
  };

  const statusMeta = STATUS_META[status?.status || 'unconfigured'] || STATUS_META.unconfigured;

  const filteredModels = useMemo(() => {
    const list = status?.models || [];
    const q = modelSearch.trim().toLowerCase();
    return list.filter((m) => {
      if (familyFilter !== 'all' && m.family !== familyFilter) return false;
      if (q && !m.id.toLowerCase().includes(q) && !(m.ownedBy || '').toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [status?.models, familyFilter, modelSearch]);

  const familyCounts = useMemo(() => {
    const list = status?.models || [];
    return {
      all: list.length,
      claude: list.filter((m) => m.family === 'claude').length,
      gpt: list.filter((m) => m.family === 'gpt').length,
      gemini: list.filter((m) => m.family === 'gemini').length,
      other: list.filter((m) => m.family === 'other').length,
    };
  }, [status?.models]);

  return (
    <div className="p-4 sm:p-5 space-y-4 text-xs">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Globe className="w-4 h-4 text-cyan-600 dark:text-cyan-300 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
              <span>Kết nối cổng Xingchi API</span>
              <span className="font-mono text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                {status?.baseUrl || 'https://api.xingchiapi.com'}/v1
              </span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
              Hỗ trợ đầy đủ chuẩn <code className="font-mono">/v1/responses</code> (Responses API +{' '}
              <code className="font-mono">image_generation</code> + <code className="font-mono">web_search</code>),{' '}
              <code className="font-mono">/v1/chat/completions</code> &amp;{' '}
              <code className="font-mono">/v1/messages</code>. Khóa API luôn chạy trên máy chủ.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTomlImport((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-800 dark:text-slate-100 hover:border-violet-400/60 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileCode2 className="w-3.5 h-3.5 text-violet-500" />
            <span>Nhập TOML</span>
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction) || !status?.hasKey}
            onClick={() => void handleFetchModels()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-800 dark:text-slate-100 hover:border-cyan-400/60 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {busyAction === 'models' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Layers className="w-3.5 h-3.5 text-cyan-500" />
            )}
            <span>Tải danh sách Model</span>
          </button>

          <button
            type="button"
            disabled={Boolean(busyAction) || !status?.hasKey}
            onClick={() => void handleTestConnection()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-800 dark:text-cyan-200 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {busyAction === 'test' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" />
            )}
            <span>Test kết nối</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchStatus()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {/* Collapsible Safe TOML Importer */}
      {showTomlImport && (
        <div className="rounded-xl bg-violet-500/5 border border-violet-500/30 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-violet-500" />
              <span>Nạp nhanh cấu hình TOML Xingchi (tự động loại bỏ trường khóa bí mật)</span>
            </div>
          </div>
          <textarea
            rows={5}
            value={tomlDraft}
            onChange={(e) => setTomlDraft(e.target.value)}
            placeholder={`model = "gpt-6.1-sol"\nreview_model = "gpt-6.1-sol"\nwire_api = "responses"\nweb_search = "live"\ndisable_response_storage = true\nhttp_headers = { "x-openai-actor-authorization" = "local-image-extension" }\nimage_generation = true`}
            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 font-mono text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Hệ thống chỉ nạp tham số kỹ thuật (model, wire_api, headers, features). Khóa{' '}
              <code className="font-mono">XINGCHI_API_KEY</code> luôn đặt ở Settings &gt; Secrets hoặc tệp{' '}
              <code className="font-mono">.env</code>.
            </span>
            <button
              type="button"
              disabled={busyAction === 'toml' || !tomlDraft.trim()}
              onClick={() => void handleImportToml()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
            >
              {busyAction === 'toml' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Áp dụng cấu hình TOML</span>
            </button>
          </div>
        </div>
      )}

      {/* 4 Status Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Trạng thái kết nối</div>
          <div className={`flex items-center gap-1.5 font-bold ${statusMeta.textClass}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusMeta.dotClass}`} />
            <span className="truncate">{statusMeta.label}</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {status?.lastLatencyMs ? `Độ trễ: ${status.lastLatencyMs}ms` : 'Chưa đo độ trễ'}
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Địa chỉ cổng &amp; wire_api</div>
          <div className="font-mono text-slate-900 dark:text-white font-semibold truncate">
            {status?.baseUrl || 'https://api.xingchiapi.com'}/v1
          </div>
          <div className="text-[11px] font-mono text-cyan-700 dark:text-cyan-300 truncate">
            {getProtocolLabel(protocolDraft)}
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">XINGCHI_API_KEY (Secrets / .env)</div>
          <div className="flex items-center gap-1.5 font-mono text-violet-700 dark:text-violet-300 font-semibold truncate">
            <KeyRound className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{status?.maskedKey || 'Chưa thiết lập'}</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {status?.hasKey ? 'Đã nạp an toàn từ máy chủ' : 'Cần khai báo biến môi trường'}
          </div>
        </div>

        <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Model chính &amp; Lượt gọi</div>
          <div className="font-mono text-slate-900 dark:text-white font-semibold truncate">
            {status?.selectedModel || modelDraft}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {status?.requestsCount ?? 0} lượt ({status?.successCount ?? 0} thành công / {status?.errorCount ?? 0} lỗi)
          </div>
        </div>
      </div>

      {/* Secure Secret Setup Guide */}
      {!status?.hasKey && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 space-y-2 text-amber-900 dark:text-amber-200">
          <div className="font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Chưa phát hiện biến môi trường XINGCHI_API_KEY trên máy chủ</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Khóa API được giữ hoàn toàn trên máy chủ và không bao giờ lưu trên trình duyệt. Hãy mở{' '}
            <strong>Settings &gt; Secrets</strong> (hoặc tệp <code className="font-mono">.env</code> khi chạy trên máy cá nhân)
            và khai báo các biến sau, rồi bấm <strong>Làm mới</strong>:
          </p>
          <div className="rounded-lg bg-slate-900/90 text-emerald-300 font-mono text-[11px] p-2.5 overflow-x-auto space-y-0.5">
            <div>XINGCHI_API_KEY=&quot;sk-your-xingchi-api-key&quot;</div>
            <div>XINGCHI_BASE_URL=&quot;https://api.xingchiapi.com/v1&quot;</div>
            <div>XINGCHI_MODEL=&quot;gpt-6.1-sol&quot;</div>
            <div>XINGCHI_WIRE_API=&quot;responses&quot;</div>
          </div>
        </div>
      )}

      {/* Configuration Form + Default Provider Switch */}
      <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-600 dark:text-violet-300" />
            <span>Cấu hình định tuyến, Responses API &amp; Features</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => {
                const nextEnabled = !enabledDraft;
                setEnabledDraft(nextEnabled);
                void handleSaveConfig({ enabled: nextEnabled });
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition cursor-pointer ${
                enabledDraft
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-100 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-500 dark:text-slate-400'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{enabledDraft ? 'Đang bật cổng Xingchi' : 'Đang tạm tắt'}</span>
            </button>

            <button
              type="button"
              onClick={onSelectAsDefaultProvider}
              disabled={isDefaultAiProvider}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition cursor-pointer ${
                isDefaultAiProvider
                  ? 'bg-violet-500/20 border-violet-500/45 text-violet-800 dark:text-violet-200 cursor-default'
                  : 'bg-violet-600 hover:bg-violet-500 border-violet-600 text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isDefaultAiProvider
                  ? 'Đang là AI Kịch bản mặc định'
                  : 'Đặt làm AI Kịch bản mặc định'}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <label className="md:col-span-4 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Giao thức (wire_api)
            </span>
            <select
              value={protocolDraft}
              onChange={(e) => setProtocolDraft(e.target.value as XingchiProtocol)}
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-cyan-400"
            >
              <option value="responses">OpenAI Responses API (/v1/responses)</option>
              <option value="openai">OpenAI Chat Completions (/v1/chat/completions)</option>
              <option value="anthropic">Anthropic Messages (/v1/messages)</option>
            </select>
          </label>

          <label className="md:col-span-4 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Model chính (model)
            </span>
            <input
              type="text"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              placeholder="VD: gpt-6.1-sol"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
            />
          </label>

          <label className="md:col-span-4 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Model rà soát (review_model)
            </span>
            <input
              type="text"
              value={reviewModelDraft}
              onChange={(e) => setReviewModelDraft(e.target.value)}
              placeholder="VD: gpt-6.1-sol"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <label className="md:col-span-5 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Header <code className="font-mono">x-openai-actor-authorization</code>
            </span>
            <input
              type="text"
              value={actorAuthDraft}
              onChange={(e) => setActorAuthDraft(e.target.value)}
              placeholder="local-image-extension"
              className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
            />
          </label>

          <div className="md:col-span-4 flex flex-wrap items-center gap-3 h-9">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={webSearchDraft === 'live'}
                onChange={(e) => setWebSearchDraft(e.target.checked ? 'live' : 'off')}
                className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
              />
              <span>web_search: live</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={disableStorageDraft}
                onChange={(e) => setDisableStorageDraft(e.target.checked)}
                className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
              />
              <span>store: false</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={imageGenDraft}
                onChange={(e) => setImageGenDraft(e.target.checked)}
                className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500"
              />
              <span>image_generation</span>
            </label>
          </div>

          <label className="md:col-span-3 space-y-1">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400">
              Chờ tối đa (giây)
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={240}
                value={timeoutDraft}
                onChange={(e) => setTimeoutDraft(Math.max(10, Math.min(240, Number(e.target.value) || 75)))}
                className="w-full h-9 px-3 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-slate-900 dark:text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                disabled={busyAction === 'save'}
                onClick={() => void handleSaveConfig()}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                {busyAction === 'save' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Lưu</span>
              </button>
            </div>
          </label>
        </div>

        {/* Quick Model Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mr-1">Gợi ý nhanh:</span>
          {QUICK_MODEL_PRESETS.map((preset) => {
            const active = modelDraft === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setModelDraft(preset);
                  setReviewModelDraft(preset);
                }}
                className={`px-2 py-1 rounded-lg font-mono text-[11px] border transition cursor-pointer ${
                  active
                    ? 'bg-cyan-500/20 border-cyan-500/45 text-cyan-800 dark:text-cyan-200 font-semibold'
                    : 'bg-slate-50 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-cyan-400/50'
                }`}
              >
                {preset}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Model Discovery & Sandbox 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT (7 cols): Live Model Catalog */}
        <div className="lg:col-span-7 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
              <span>Danh sách Model trên api.xingchiapi.com ({status?.models.length ?? 0})</span>
            </div>
            {status?.modelsFetchedAt && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Đồng bộ lúc {new Date(status.modelsFetchedAt).toLocaleTimeString('vi-VN')}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {(
                [
                  ['all', `Tất cả (${familyCounts.all})`],
                  ['gpt', `GPT (${familyCounts.gpt})`],
                  ['claude', `Claude (${familyCounts.claude})`],
                  ['gemini', `Gemini (${familyCounts.gemini})`],
                  ['other', `Khác (${familyCounts.other})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFamilyFilter(key)}
                  className={`px-2.5 py-1 rounded-lg border transition cursor-pointer ${
                    familyFilter === key
                      ? 'bg-violet-500/20 border-violet-500/45 text-violet-800 dark:text-violet-200 font-semibold'
                      : 'bg-slate-50 dark:bg-[#131a35] border-slate-200 dark:border-slate-400/20 text-slate-600 dark:text-slate-300 hover:border-violet-400/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[160px] max-w-[230px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="Tìm mã model..."
                className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {filteredModels.length === 0 ? (
            <div className="rounded-xl bg-slate-50 dark:bg-[#070913]/70 border border-dashed border-slate-200 dark:border-slate-700/70 p-5 text-center text-slate-500 dark:text-slate-400 space-y-1.5">
              <div>
                {(status?.models.length ?? 0) === 0
                  ? 'Chưa đồng bộ danh sách model từ https://api.xingchiapi.com/v1/models.'
                  : 'Không tìm thấy model nào khớp từ khóa lọc.'}
              </div>
              {status?.hasKey && (status?.models.length ?? 0) === 0 && (
                <button
                  type="button"
                  disabled={busyAction === 'models'}
                  onClick={() => void handleFetchModels()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 mt-1 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 font-semibold cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Đồng bộ danh sách Model ngay</span>
                </button>
              )}
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-200/80 dark:divide-slate-400/15 rounded-xl border border-slate-200 dark:border-slate-400/20">
              {filteredModels.map((m) => {
                const isSelected = status?.selectedModel === m.id;
                return (
                  <div
                    key={m.id}
                    className={`px-3 py-2 flex items-center justify-between gap-2 transition ${
                      isSelected
                        ? 'bg-cyan-500/10 dark:bg-cyan-500/15'
                        : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-slate-900 dark:text-white truncate">
                        {m.id}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Nhóm: {m.family.toUpperCase()}
                        {m.ownedBy ? ` · ${m.ownedBy}` : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busyAction === 'save'}
                      onClick={() => {
                        setModelDraft(m.id);
                        void handleSaveConfig({ selectedModel: m.id });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35'
                          : 'bg-slate-100 dark:bg-[#131a35] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-400/20 hover:border-cyan-400/60'
                      }`}
                    >
                      {isSelected ? 'Đang dùng' : 'Chọn model'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT (5 cols): Quick Live Test Prompt & Image Test */}
        <form
          onSubmit={handleRunQuickPrompt}
          className="lg:col-span-5 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 flex flex-col justify-between gap-3"
        >
          <div className="space-y-2.5">
            <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-violet-600 dark:text-violet-300" />
              <span>Thử gọi trực tiếp qua Xingchi API</span>
            </div>

            <textarea
              rows={3}
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Nhập câu lệnh thử nghiệm hoặc mô tả ảnh gửi tới model đã chọn..."
              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-violet-400 resize-y"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="submit"
                disabled={Boolean(busyAction) || !status?.hasKey || !testPrompt.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 transition cursor-pointer disabled:opacity-50"
              >
                {busyAction === 'chat' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>Gửi text ({modelDraft || 'model'})</span>
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction) || !status?.hasKey || !imageGenDraft}
                onClick={() => void handleTestImageGen()}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-cyan-950 dark:text-cyan-100 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 transition cursor-pointer disabled:opacity-50"
              >
                {busyAction === 'image' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5" />
                )}
                <span>Thử tạo ảnh</span>
              </button>
            </div>

            {chatResult && (
              <div className="rounded-xl bg-slate-50 dark:bg-[#070913]/90 border border-emerald-500/30 p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-700 dark:text-emerald-300 font-mono">
                  <span className="truncate">
                    {chatResult.model} · {chatResult.protocol}
                  </span>
                  <span className="tabular-nums">
                    {chatResult.latencyMs}ms
                    {chatResult.usage?.totalTokens ? ` · ${chatResult.usage.totalTokens} tokens` : ''}
                  </span>
                </div>
                <div className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                  {chatResult.reply}
                </div>
              </div>
            )}

            {imageTestResult && (
              <div className="rounded-xl bg-slate-50 dark:bg-[#070913]/90 border border-cyan-500/30 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] text-cyan-700 dark:text-cyan-300 font-mono">
                  <span className="truncate">{imageTestResult.model}</span>
                  <span className="tabular-nums">{imageTestResult.latencyMs}ms</span>
                </div>
                <img
                  src={imageTestResult.dataUrl}
                  alt="Xingchi generated preview"
                  className="w-full max-h-44 object-contain rounded-lg border border-slate-200 dark:border-slate-700"
                />
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-200/80 dark:border-slate-400/15 pt-2.5">
            Đích kết nối được khóa cứng về tên miền <code className="font-mono">api.xingchiapi.com</code> qua HTTPS; khóa{' '}
            <code className="font-mono">XINGCHI_API_KEY</code> chỉ lưu và sử dụng trên máy chủ.
          </div>
        </form>
      </div>

      {/* Notices & Errors */}
      {status?.lastError && !errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Lỗi gần nhất: {status.lastError}</span>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
