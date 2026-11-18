import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Upload,
  Trash2,
  Sparkles,
  Film,
  SlidersHorizontal,
  RefreshCw,
  Loader2,
  Cpu,
  RotateCcw,
  Eye,
  EyeOff,
  Server,
  Play,
  Square,
  Activity,
  UserPlus,
  Power,
  Mic,
} from 'lucide-react';
import {
  AiProviderId,
  BrollSourceId,
  CookieSiteId,
  DerivativeAspectRatio,
  DerivativeStylePreset,
  DerivativeVisualMode,
  DerivativeVoiceId,
  PerSiteCookies,
  ServerCapabilitiesStatus,
  StudioDefaultConfig,
} from '../types/bilibili';
import { COOKIE_SITES, DEFAULT_STUDIO_CONFIG } from '../utils/cookies';

interface SettingsPanelProps {
  perSiteCookies: PerSiteCookies;
  studioDefaults: StudioDefaultConfig;
  onSaveSiteCookie: (siteId: CookieSiteId, value: string) => void;
  onSaveAllCookies: (next: PerSiteCookies) => void;
  onUpdateStudioDefaults: (next: StudioDefaultConfig) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  perSiteCookies,
  studioDefaults,
  onSaveSiteCookie,
  onUpdateStudioDefaults,
}) => {
  const [selectedSite, setSelectedSite] = useState<CookieSiteId>('youtube');
  const [cookieDraft, setCookieDraft] = useState('');
  const [showSessdata, setShowSessdata] = useState(false);
  const [cookieSavedNotice, setCookieSavedNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [capabilities, setCapabilities] = useState<ServerCapabilitiesStatus | null>(null);
  const [loadingCaps, setLoadingCaps] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Muse2API Bridge & Account Pool state
  const [muse2Status, setMuse2Status] = useState<{
    reachable: boolean;
    ready: boolean;
    status: 'ready' | 'no_account' | 'auth_error' | 'offline';
    baseUrl: string;
    hasKey: boolean;
    maskedKey: string;
    keySource: 'env' | 'local_dotenv' | 'none';
    accountsCount: number;
    healthyAccounts: number;
    browserRunning: boolean;
    mediaCount: number;
    accounts?: any[];
    localRuntime?: {
      bundledDirExists: boolean;
      pythonAvailable: boolean;
      uvicornInstalled: boolean;
      chromiumAvailable: boolean;
      processRunning: boolean;
    };
    error?: string;
  } | null>(null);
  const [loadingMuse2, setLoadingMuse2] = useState(false);
  const [muse2Notice, setMuse2Notice] = useState('');
  const [muse2Error, setMuse2Error] = useState('');
  const [museAccLabel, setMuseAccLabel] = useState('Tài khoản Muse #1');
  const [museAccCookie, setMuseAccCookie] = useState('');
  const [busyMuse2Action, setBusyMuse2Action] = useState<string>('');
  const [installingVieNeu, setInstallingVieNeu] = useState(false);
  const [vieNeuNotice, setVieNeuNotice] = useState('');

  useEffect(() => {
    setCookieDraft(perSiteCookies[selectedSite] || '');
    setCookieSavedNotice('');
  }, [selectedSite, perSiteCookies]);

  const fetchMuse2Status = async () => {
    setLoadingMuse2(true);
    try {
      const res = await fetch('/api/muse2api/status');
      if (res.ok) {
        const data = await res.json();
        setMuse2Status(data);
      }
    } catch {
      // ignore network error
    } finally {
      setLoadingMuse2(false);
    }
  };

  const fetchCapabilities = async () => {
    setLoadingCaps(true);
    try {
      const res = await fetch('/api/config/capabilities');
      if (res.ok) {
        const data = (await res.json()) as ServerCapabilitiesStatus;
        setCapabilities(data);
      }
    } catch {
      // ignore network error
    } finally {
      setLoadingCaps(false);
    }
  };

  const handleInstallVieNeu = async () => {
    setInstallingVieNeu(true);
    setVieNeuNotice('');
    try {
      const res = await fetch('/api/tts/offline/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setVieNeuNotice(data.message || 'Đã sẵn sàng thư viện VieNeu-TTS Offline.');
      await fetchCapabilities();
    } catch (err: any) {
      setVieNeuNotice(err?.message || 'Lỗi cài đặt VieNeu-TTS Offline.');
    } finally {
      setInstallingVieNeu(false);
    }
  };

  useEffect(() => {
    void fetchCapabilities();
    void fetchMuse2Status();
  }, []);

  const currentSiteMeta = COOKIE_SITES.find((s) => s.id === selectedSite) || COOKIE_SITES[0];

  const handleUploadCookieFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCookieDraft(reader.result);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSaveCurrentCookie = () => {
    onSaveSiteCookie(selectedSite, cookieDraft.trim());
    setCookieSavedNotice(`Đã lưu cookie cho ${currentSiteMeta.label}.`);
    window.setTimeout(() => setCookieSavedNotice(''), 2500);
  };

  const handleClearCurrentCookie = () => {
    setCookieDraft('');
    onSaveSiteCookie(selectedSite, '');
    setCookieSavedNotice(`Đã xóa cookie của ${currentSiteMeta.label}.`);
    window.setTimeout(() => setCookieSavedNotice(''), 2500);
  };

  const handleTestAiConnection = async () => {
    setTestingAi(true);
    setAiTestResult(null);
    try {
      const res = await fetch('/api/config/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: studioDefaults.aiProvider }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      setAiTestResult({
        ok: Boolean(data.ok),
        message: data.message || (res.ok ? 'Kết nối thành công.' : 'Kiểm tra kết nối thất bại.'),
      });
    } catch (err: any) {
      setAiTestResult({
        ok: false,
        message: err?.message || 'Không thể kết nối tới máy chủ.',
      });
    } finally {
      setTestingAi(false);
    }
  };

  const configuredSitesCount = COOKIE_SITES.filter((s) => Boolean(perSiteCookies[s.id]?.trim())).length;

  const aiCards: {
    id: AiProviderId;
    title: string;
    subtitle: string;
    envVar: string;
    configured: boolean;
    modelName: string;
  }[] = [
    {
      id: 'gemini',
      title: 'Google Gemini',
      subtitle: 'Học đa phương tiện + Lồng tiếng AI tiếng Việt',
      envVar: 'GEMINI_API_KEY',
      configured: Boolean(capabilities?.aiProviders.gemini.configured),
      modelName: capabilities?.aiProviders.gemini.model || 'gemini-4-hydrogen',
    },
    {
      id: 'openai',
      title: 'OpenAI (ChatGPT)',
      subtitle: 'Phân tích kịch bản & viết lời bình sắc bén',
      envVar: 'OPENAI_API_KEY',
      configured: Boolean(capabilities?.aiProviders.openai.configured),
      modelName: capabilities?.aiProviders.openai.model || 'gpt-4o-mini',
    },
    {
      id: 'meta',
      title: 'Meta AI (Llama)',
      subtitle: 'Tóm tắt nhanh & tổng hợp nội dung đa nguồn',
      envVar: 'META_API_KEY',
      configured: Boolean(capabilities?.aiProviders.meta.configured),
      modelName: capabilities?.aiProviders.meta.model || 'Llama-4-Scout-17B',
    },
    {
      id: 'muse2api',
      title: 'Muse2API (Tự host / Tunnel)',
      subtitle: 'Gọi trực tiếp muse-spark, muse-image & muse-video qua tài khoản muse.ai',
      envVar: 'MUSE2API_BASE_URL + KEY',
      configured: Boolean(capabilities?.aiProviders.muse2api?.configured),
      modelName: capabilities?.aiProviders.muse2api?.model || 'muse-spark / image / video',
    },
  ];

  const handleMuse2Process = async (action: 'start' | 'stop') => {
    setBusyMuse2Action(action);
    setMuse2Error('');
    setMuse2Notice('');
    try {
      const res = await fetch(`/api/muse2api/process/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMuse2Error(data.message || `Không thể ${action === 'start' ? 'khởi chạy' : 'dừng'} Muse2API.`);
      } else {
        setMuse2Notice(data.message || 'Thành công.');
      }
      await fetchMuse2Status();
      await fetchCapabilities();
    } catch (err: any) {
      setMuse2Error(err?.message || 'Lỗi điều khiển tiến trình Muse2API.');
    } finally {
      setBusyMuse2Action('');
    }
  };

  const handleAddMuse2Account = async (rawCookieInput: string, labelInput?: string) => {
    const trimmed = rawCookieInput.trim();
    if (!trimmed) {
      setMuse2Error('Vui lòng dán Cookie muse.ai (hatch_sess, hatch_gw, hatch_vml) trước khi đẩy.');
      return;
    }
    setBusyMuse2Action('add');
    setMuse2Error('');
    setMuse2Notice('');
    try {
      const res = await fetch('/api/muse2api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: (labelInput || museAccLabel || 'Muse Account').trim(),
          cookieHeader: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMuseAccCookie('');
      setMuse2Notice(
        data.warning
          ? `Đã thêm tài khoản nhưng cần chú ý: ${data.warning}`
          : `Đã nạp ${data.count || 1} tài khoản muse.ai vào Muse2API thành công.`
      );
      await fetchMuse2Status();
      await fetchCapabilities();
    } catch (err: any) {
      setMuse2Error(err?.message || 'Không thể thêm cookie vào Muse2API.');
    } finally {
      setBusyMuse2Action('');
    }
  };

  const handleMuse2AccountAction = async (
    accountId: string,
    action: 'test' | 'keepalive' | 'quota' | 'toggle' | 'delete',
    currentEnabled?: boolean
  ) => {
    setBusyMuse2Action(`${action}:${accountId}`);
    setMuse2Error('');
    setMuse2Notice('');
    try {
      let res: Response;
      if (action === 'delete') {
        res = await fetch(`/api/muse2api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
      } else if (action === 'toggle') {
        res = await fetch(`/api/muse2api/accounts/${encodeURIComponent(accountId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !currentEnabled }),
        });
      } else {
        res = await fetch(`/api/muse2api/accounts/${encodeURIComponent(accountId)}/${action}`, { method: 'POST' });
      }
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.message || `Thao tác ${action} thất bại.`);
      }
      setMuse2Notice(data.message || `Đã thực hiện ${action} thành công.`);
      await fetchMuse2Status();
      await fetchCapabilities();
    } catch (err: any) {
      setMuse2Error(err?.message || 'Thao tác tài khoản Muse2API thất bại.');
    } finally {
      setBusyMuse2Action('');
    }
  };

  const handleMuse2KeepaliveAll = async () => {
    setBusyMuse2Action('keepalive_all');
    setMuse2Error('');
    setMuse2Notice('');
    try {
      const res = await fetch('/api/muse2api/accounts/keepalive', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMuse2Notice(`Đã gia hạn đồng loạt ${data.refreshed ?? data.total ?? ''} tài khoản Muse.ai.`);
      await fetchMuse2Status();
    } catch (err: any) {
      setMuse2Error(err?.message || 'Gia hạn đồng loạt thất bại.');
    } finally {
      setBusyMuse2Action('');
    }
  };

  const brollCards: {
    id: BrollSourceId;
    title: string;
    desc: string;
    statusLabel: string;
    available: boolean;
  }[] = [
    {
      id: 'wikimedia',
      title: 'Wikimedia Commons (Ưu tiên mặc định)',
      desc: 'Kho video phạm vi công cộng CC0 / CC BY. Studio ưu tiên tham khảo & lấy nhiều clip chuyển động thực tế từ Wikimedia cho từng cảnh, miễn phí 100%, không cần API key.',
      statusLabel: 'Ưu tiên · Không cần key',
      available: true,
    },
    {
      id: 'auto',
      title: 'Tự động kết hợp (Wikimedia trước)',
      desc: 'Ưu tiên video nguồn gốc -> Wikimedia Commons -> Pexels -> Pixabay -> cuối cùng mới dùng hiệu ứng Ken Burns.',
      statusLabel: 'Luôn bật',
      available: true,
    },
    {
      id: 'pexels',
      title: 'Pexels Video',
      desc: 'Kho video nền HD miễn phí dùng thương mại. Tự động kích hoạt khi khai báo PEXELS_API_KEY trong Secrets hoặc tệp .env.',
      statusLabel: capabilities?.brollProviders.pexels.configured ? 'Đã có key' : 'Chưa đặt key .env',
      available: Boolean(capabilities?.brollProviders.pexels.configured),
    },
    {
      id: 'pixabay',
      title: 'Pixabay Video',
      desc: 'Kho clip đa chủ đề miễn phí. Tự động kích hoạt khi khai báo PIXABAY_API_KEY trong Secrets hoặc tệp .env.',
      statusLabel: capabilities?.brollProviders.pixabay.configured ? 'Đã có key' : 'Chưa đặt key .env',
      available: Boolean(capabilities?.brollProviders.pixabay.configured),
    },
    {
      id: 'none',
      title: 'Chỉ dùng ảnh Ken Burns',
      desc: 'Không tải kho B-roll ngoài; nếu không trích xuất được video nguồn thì chuyển trực tiếp sang hiệu ứng zoom ảnh đại diện.',
      statusLabel: 'Nhanh nhất',
      available: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 dark:border-[#00464A]/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Thiết lập & Cấu hình
          </h1>
          <p className="text-sm text-slate-600 dark:text-teal-100/75 mt-1">
            Quản lý cookie riêng từng trang, chọn công cụ AI và cài đặt mặc định cho mọi video phái sinh mới.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-teal-200/75 font-mono tabular-nums">
          Cookie đã lưu: {configuredSitesCount}/{COOKIE_SITES.length} nền tảng
        </div>
      </div>

      {/* SECTION 1: Per-Site Cookies */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-[#00464A]/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Cookie đăng nhập riêng từng nền tảng
            </h2>
          </div>
          <span className="text-xs text-slate-500 dark:text-teal-200/70">
            Lưu cục bộ trên trình duyệt · tự lọc đúng tên miền
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Site list selector */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-[#00464A]/80 p-3 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-x-visible bg-slate-50/70 dark:bg-[#000A10]/60">
            {COOKIE_SITES.map((site) => {
              const hasVal = Boolean(perSiteCookies[site.id]?.trim());
              const isSelected = selectedSite === site.id;
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => setSelectedSite(site.id)}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-left text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-[#003B3E] text-white font-semibold'
                      : 'text-slate-700 dark:text-teal-100/85 hover:bg-slate-200/70 dark:hover:bg-[#002935]'
                  }`}
                >
                  <span>{site.label}</span>
                  <span
                    className={`font-mono text-[11px] ${
                      isSelected
                        ? hasVal
                          ? 'text-emerald-200'
                          : 'text-teal-100/75'
                        : hasVal
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {hasVal ? 'Đã nhập' : 'Trống'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected Site Cookie Editor */}
          <div className="lg:col-span-8 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {currentSiteMeta.label}{' '}
                  {currentSiteMeta.domain && (
                    <span className="font-mono text-xs font-normal text-slate-500 dark:text-teal-200/70">
                      ({currentSiteMeta.domain})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-600 dark:text-teal-100/75 mt-0.5">
                  {currentSiteMeta.description}
                </p>
              </div>

              {!currentSiteMeta.isSessdata && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.json,text/plain,application/json"
                    onChange={handleUploadCookieFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:bg-slate-200/70 dark:hover:bg-[#002935] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Chọn tệp .txt / .json</span>
                  </button>
                </div>
              )}
            </div>

            {currentSiteMeta.isSessdata ? (
              <div className="relative">
                <input
                  type={showSessdata ? 'text' : 'password'}
                  value={cookieDraft}
                  onChange={(e) => setCookieDraft(e.target.value)}
                  placeholder={currentSiteMeta.placeholder}
                  className="w-full h-10 pl-3.5 pr-10 text-xs font-mono bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] dark:focus:border-[#1BA8AD]"
                />
                <button
                  type="button"
                  onClick={() => setShowSessdata((s) => !s)}
                  aria-label={showSessdata ? 'Ẩn SESSDATA' : 'Hiện SESSDATA'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                >
                  {showSessdata ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <textarea
                rows={6}
                value={cookieDraft}
                onChange={(e) => setCookieDraft(e.target.value)}
                placeholder={currentSiteMeta.placeholder}
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E] dark:focus:border-[#1BA8AD] resize-y"
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs">
                {cookieSavedNotice ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {cookieSavedNotice}
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-teal-200/70">
                    Hỗ trợ Netscape cookies.txt, JSON từ Cookie-Editor hoặc chuỗi Cookie header (k=v; ...).
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                {Boolean(perSiteCookies[selectedSite]?.trim() || cookieDraft.trim()) && (
                  <button
                    type="button"
                    onClick={handleClearCurrentCookie}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xóa cookie trang này</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveCurrentCookie}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  Lưu Cookie {currentSiteMeta.label}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Kết nối AI học & viết kịch bản */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Kết nối AI viết kịch bản & học nội dung video
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70">
                Chọn nhà cung cấp AI mặc định cho Studio Video Phái Sinh (giọng đọc tiếng Việt sử dụng Gemini Flash Lite TTS).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleTestAiConnection}
            disabled={testingAi}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            {testingAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            <span>Kiểm tra kết nối AI đang chọn</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {aiCards.map((card) => {
            const isActive = studioDefaults.aiProvider === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  setAiTestResult(null);
                  onUpdateStudioDefaults({ ...studioDefaults, aiProvider: card.id });
                }}
                className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-2 ${
                  isActive
                    ? 'border-[#003B3E] dark:border-[#1BA8AD] bg-[#003B3E]/6 dark:bg-[#003B3E]/30'
                    : 'border-slate-200 dark:border-[#00464A] bg-slate-50/70 dark:bg-[#000A10]/60 hover:border-slate-300 dark:hover:border-[#006970]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{card.title}</span>
                  <span
                    className={`text-[11px] font-medium ${
                      card.configured
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {card.configured ? 'Đã sẵn sàng' : 'Chưa sẵn sàng'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-teal-100/75">{card.subtitle}</p>
                <div className="pt-1 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500 dark:text-teal-200/65">
                  <span className="truncate">{card.modelName}</span>
                  <span className="shrink-0">{card.envVar}</span>
                </div>
              </button>
            );
          })}
        </div>

        {aiTestResult && (
          <div
            className={`flex items-start gap-2 px-3.5 py-2.5 rounded-lg border text-xs ${
              aiTestResult.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200'
            }`}
          >
            {aiTestResult.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{aiTestResult.message}</span>
          </div>
        )}

        <p className="text-xs text-slate-500 dark:text-teal-200/70 leading-relaxed">
          Bảo mật khóa API: Các khóa (<code className="font-mono">GEMINI_API_KEY</code>, <code className="font-mono">OPENAI_API_KEY</code>, <code className="font-mono">META_API_KEY</code>, <code className="font-mono">MUSE2API_KEY</code>) được đọc an toàn phía máy chủ từ <strong>Settings &gt; Secrets</strong> hoặc tệp <code className="font-mono">.env</code> / <code className="font-mono">muse2api/.env</code>.
        </p>
      </section>

      {/* SECTION 2B: Muse2API Service & Account Pool */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Dịch vụ Muse2API & Quản lý Pool tài khoản muse.ai
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70">
                Biến tài khoản web <code className="font-mono">muse.ai</code> thành API OpenAI tương thích (<code className="font-mono">muse-spark</code>, <code className="font-mono">muse-image</code>, <code className="font-mono">muse-video</code>).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {muse2Status?.localRuntime?.chromiumAvailable && muse2Status?.localRuntime?.uvicornInstalled && (
              muse2Status.localRuntime.processRunning ? (
                <button
                  type="button"
                  disabled={busyMuse2Action === 'stop'}
                  onClick={() => void handleMuse2Process('stop')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 rounded-lg cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Dừng Muse2API nội bộ</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyMuse2Action === 'start'}
                  onClick={() => void handleMuse2Process('start')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg cursor-pointer"
                >
                  {busyMuse2Action === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>Khởi chạy Muse2API nội bộ</span>
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => void fetchMuse2Status()}
              disabled={loadingMuse2}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg hover:bg-slate-200/70 dark:hover:bg-[#002935] transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingMuse2 ? 'animate-spin' : ''}`} />
              <span>Làm mới trạng thái</span>
            </button>
          </div>
        </div>

        {/* Status Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1">
            <div className="text-[11px] text-slate-500 dark:text-teal-200/70">Trạng thái kết nối</div>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Activity
                className={`w-3.5 h-3.5 ${
                  muse2Status?.ready
                    ? 'text-emerald-500'
                    : muse2Status?.reachable
                    ? 'text-amber-500'
                    : 'text-slate-400'
                }`}
              />
              <span
                className={
                  muse2Status?.ready
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : muse2Status?.reachable
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-slate-600 dark:text-slate-300'
                }
              >
                {muse2Status?.status === 'ready'
                  ? 'Sẵn sàng hoạt động'
                  : muse2Status?.status === 'no_account'
                  ? 'Chưa có Cookie tài khoản'
                  : muse2Status?.status === 'auth_error'
                  ? 'Sai / Thiếu MUSE2API_KEY'
                  : 'Chưa kết nối tới dịch vụ'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1">
            <div className="text-[11px] text-slate-500 dark:text-teal-200/70">Địa chỉ máy chủ đích</div>
            <div className="text-xs font-mono text-slate-900 dark:text-white truncate">
              {muse2Status?.baseUrl || 'http://127.0.0.1:18610'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1">
            <div className="text-[11px] text-slate-500 dark:text-teal-200/70">Tài khoản muse.ai</div>
            <div className="text-xs font-mono tabular-nums text-slate-900 dark:text-white">
              {muse2Status?.healthyAccounts ?? 0}/{muse2Status?.accountsCount ?? 0} khỏe · {muse2Status?.mediaCount ?? 0} tệp media
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1">
            <div className="text-[11px] text-slate-500 dark:text-teal-200/70">MUSE2API_KEY (Secrets / .env)</div>
            <div className="text-xs font-mono text-slate-900 dark:text-white truncate">
              {muse2Status?.hasKey
                ? `${muse2Status.maskedKey} (${muse2Status.keySource === 'env' ? 'Secrets/.env' : 'muse2api/.env'})`
                : 'Chưa đặt biến MUSE2API_KEY'}
            </div>
          </div>
        </div>

        {/* Deployment Guide when Offline */}
        {!muse2Status?.reachable && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] space-y-2 text-xs text-slate-700 dark:text-teal-100/85">
            <div className="font-semibold text-slate-900 dark:text-white">
              Hướng dẫn bật dịch vụ Muse2API (mã nguồn đã tích hợp sẵn trong thư mục <code className="font-mono">/muse2api</code>):
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[11px] leading-relaxed">
              <li>
                <strong>Cách 1 · Docker (Khuyên dùng):</strong> Mở thư mục <code className="font-mono">muse2api/</code> trên máy chủ hoặc PC của bạn và chạy{' '}
                <code className="font-mono bg-slate-200/70 dark:bg-[#002935] px-1.5 py-0.5 rounded">docker compose up -d --build</code> (cổng mặc định <code className="font-mono">18610</code>, tự tạo key <code className="font-mono">m2a_...</code> trong <code className="font-mono">muse2api/.env</code>).
              </li>
              <li>
                <strong>Cách 2 · Python cục bộ (khi chạy GaConPro trên máy cá nhân có Chrome/Chromium):</strong>{' '}
                <code className="font-mono bg-slate-200/70 dark:bg-[#002935] px-1.5 py-0.5 rounded">cd muse2api && pip install -r requirements.txt && python -m uvicorn app:app --host 127.0.0.1 --port 18610</code>.
              </li>
              <li>
                <strong>Cách 3 · Kết nối từ xa qua Tunnel:</strong> Nếu chạy GaConPro trên đám mây, mở Cloudflare Tunnel / ngrok trỏ tới cổng <code className="font-mono">18610</code> rồi đặt <code className="font-mono">MUSE2API_BASE_URL</code> và <code className="font-mono">MUSE2API_KEY</code> trong <strong>Settings &gt; Secrets</strong>.
              </li>
            </ul>
          </div>
        )}

        {/* Quick Cookie Push & Add Account Form when Reachable */}
        {muse2Status?.reachable && muse2Status.status !== 'auth_error' && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                <UserPlus className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD]" />
                <span>Nạp Cookie phiên đăng nhập muse.ai (hỗ trợ Header, Cookie-Editor JSON, Netscape .txt)</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {Boolean(perSiteCookies.muse?.trim()) && (
                  <button
                    type="button"
                    disabled={busyMuse2Action === 'add'}
                    onClick={() => void handleAddMuse2Account(perSiteCookies.muse, 'Muse Cookie từ Settings')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Đẩy Cookie muse.ai ở Mục 1 sang Muse2API</span>
                  </button>
                )}
                {(muse2Status.accountsCount || 0) > 0 && (
                  <button
                    type="button"
                    disabled={busyMuse2Action === 'keepalive_all'}
                    onClick={() => void handleMuse2KeepaliveAll()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg hover:bg-slate-200/70 dark:hover:bg-[#002935] cursor-pointer disabled:opacity-50"
                  >
                    {busyMuse2Action === 'keepalive_all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    <span>Gia hạn tất cả</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
              <input
                type="text"
                value={museAccLabel}
                onChange={(e) => setMuseAccLabel(e.target.value)}
                placeholder="Nhãn tài khoản (VD: Acc chính)"
                className="lg:col-span-3 h-9 px-3 text-xs bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
              />
              <input
                type="text"
                value={museAccCookie}
                onChange={(e) => setMuseAccCookie(e.target.value)}
                placeholder="Dán Cookie muse.ai (hatch_sess=...; hatch_gw=...; hatch_vml=...) hoặc JSON Cookie-Editor..."
                className="lg:col-span-7 h-9 px-3 text-xs font-mono bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white focus:outline-none focus:border-[#003B3E]"
              />
              <button
                type="button"
                disabled={busyMuse2Action === 'add' || !museAccCookie.trim()}
                onClick={() => void handleAddMuse2Account(museAccCookie, museAccLabel)}
                className="lg:col-span-2 h-9 px-3 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                {busyMuse2Action === 'add' ? 'Đang nạp...' : '+ Thêm tài khoản'}
              </button>
            </div>

            {/* Account Pool List */}
            {Array.isArray(muse2Status.accounts) && muse2Status.accounts.length > 0 && (
              <div className="divide-y divide-slate-200 dark:divide-[#00464A]/80 border border-slate-200 dark:border-[#00464A] rounded-xl overflow-hidden">
                {muse2Status.accounts.map((acc: any) => {
                  const quota = acc.quota || null;
                  return (
                    <div
                      key={acc.id}
                      className="p-3 bg-slate-50/50 dark:bg-[#000A10]/40 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {acc.label || acc.id}
                          </span>
                          <span
                            className={`text-[11px] font-medium ${
                              !acc.enabled
                                ? 'text-slate-400'
                                : acc.ok === true
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : acc.ok === false
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {!acc.enabled ? 'Đang tắt' : acc.ok === true ? 'Hoạt động' : acc.ok === false ? 'Lỗi phiên' : 'Chưa kiểm tra'}
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-teal-200/65">
                            {acc.cookie_count || 0} cookies
                          </span>
                        </div>
                        {acc.last_error && (
                          <div className="text-[11px] text-slate-500 dark:text-teal-200/75 truncate max-w-xl">
                            {acc.last_error}
                          </div>
                        )}
                        {quota && (
                          <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                            Quota: {quota.summary || JSON.stringify(quota).slice(0, 120)}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(busyMuse2Action)}
                          onClick={() => void handleMuse2AccountAction(acc.id, 'test')}
                          className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded hover:bg-slate-100 dark:hover:bg-[#002935] cursor-pointer"
                        >
                          {busyMuse2Action === `test:${acc.id}` ? 'Đang thử...' : 'Test phiên'}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyMuse2Action)}
                          onClick={() => void handleMuse2AccountAction(acc.id, 'keepalive')}
                          className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded hover:bg-slate-100 dark:hover:bg-[#002935] cursor-pointer"
                        >
                          Gia hạn
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyMuse2Action)}
                          onClick={() => void handleMuse2AccountAction(acc.id, 'quota')}
                          className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded hover:bg-slate-100 dark:hover:bg-[#002935] cursor-pointer"
                        >
                          Hạn mức
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyMuse2Action)}
                          onClick={() => void handleMuse2AccountAction(acc.id, 'toggle', acc.enabled !== false)}
                          title={acc.enabled !== false ? 'Tạm tắt tài khoản' : 'Bật tài khoản'}
                          className="p-1.5 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded hover:bg-slate-100 dark:hover:bg-[#002935] cursor-pointer"
                        >
                          <Power className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyMuse2Action)}
                          onClick={() => void handleMuse2AccountAction(acc.id, 'delete')}
                          title="Xóa tài khoản"
                          className="p-1.5 text-rose-600 dark:text-rose-400 bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded hover:bg-rose-50 dark:hover:bg-rose-950/35 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {muse2Notice && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg border bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{muse2Notice}</span>
          </div>
        )}

        {(muse2Error || (muse2Status?.error && muse2Status.reachable)) && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg border bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{muse2Error || muse2Status?.error}</span>
          </div>
        )}
      </section>

      {/* SECTION 3: Kho Video nền miễn phí (B-roll) */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2.5">
          <Film className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Kho Video nền B-roll miễn phí khi nguồn gốc bị hạn chế
            </h2>
            <p className="text-xs text-slate-500 dark:text-teal-200/70">
              Khi video nguồn (ví dụ YouTube) bị chặn hoặc chưa trích xuất trực tiếp được, Studio sẽ tự lấy clip chuyển động từ kho bạn chọn thay vì chỉ dùng ảnh tĩnh.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {brollCards.map((card) => {
            const isActive = studioDefaults.brollSource === card.id;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onUpdateStudioDefaults({ ...studioDefaults, brollSource: card.id })}
                className={`p-4 rounded-xl border text-left transition-colors cursor-pointer space-y-1.5 ${
                  isActive
                    ? 'border-[#003B3E] dark:border-[#1BA8AD] bg-[#003B3E]/6 dark:bg-[#003B3E]/30'
                    : 'border-slate-200 dark:border-[#00464A] bg-slate-50/70 dark:bg-[#000A10]/60 hover:border-slate-300 dark:hover:border-[#006970]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">{card.title}</span>
                  <span
                    className={`text-[11px] font-medium ${
                      card.available
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {card.statusLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-teal-100/75 leading-relaxed">{card.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* SECTION 4: Cài đặt mặc định cho Studio Video Phái Sinh */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Thiết lập mặc định Studio Video Phái Sinh
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70">
                Áp dụng sẵn cho mọi video phái sinh mới. Từng video vẫn có thể chỉnh riêng khi mở Studio.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onUpdateStudioDefaults(DEFAULT_STUDIO_CONFIG)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-teal-100 hover:bg-slate-100 dark:hover:bg-[#002935] rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Khôi phục mặc định</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600 dark:text-teal-200/80">Phong cách mặc định</span>
            <select
              value={studioDefaults.stylePreset}
              onChange={(e) =>
                onUpdateStudioDefaults({
                  ...studioDefaults,
                  stylePreset: e.target.value as DerivativeStylePreset,
                })
              }
              className="w-full h-9 px-3 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="summary_fast">Tóm tắt & Điểm tin nhanh</option>
              <option value="storytelling_review">Kể chuyện / Review cuốn hút</option>
              <option value="top_list">Top điểm nổi bật / So sánh</option>
              <option value="tips_tutorial">Mẹo hay & Hướng dẫn ngắn</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600 dark:text-teal-200/80">Tỉ lệ khung hình</span>
            <select
              value={studioDefaults.aspectRatioMode}
              onChange={(e) =>
                onUpdateStudioDefaults({
                  ...studioDefaults,
                  aspectRatioMode: e.target.value as 'auto' | DerivativeAspectRatio,
                })
              }
              className="w-full h-9 px-3 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="auto">Tự động theo video nguồn</option>
              <option value="9:16">9:16 Dọc (Shorts / TikTok / Reels)</option>
              <option value="16:9">16:9 Ngang (YouTube / Bilibili)</option>
            </select>
          </label>

          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-600 dark:text-teal-200/80">
              Thời lượng dự kiến ({Math.floor(studioDefaults.targetDurationSec / 60)}p {studioDefaults.targetDurationSec % 60}s)
            </span>
            <div className="flex items-center gap-2">
              <select
                value={[30, 60, 180, 300, 360, 480, 600].includes(studioDefaults.targetDurationSec) ? String(studioDefaults.targetDurationSec) : 'custom'}
                onChange={(e) => {
                  if (e.target.value !== 'custom') {
                    onUpdateStudioDefaults({
                      ...studioDefaults,
                      targetDurationSec: Number(e.target.value),
                    });
                  }
                }}
                className="flex-1 h-9 px-2.5 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
              >
                <option value="30">30 giây (Ngắn · 4 cảnh)</option>
                <option value="60">1 phút (60s · 6 cảnh)</option>
                <option value="180">3 phút (180s · 10 cảnh)</option>
                <option value="300">5 phút (300s · 14 cảnh)</option>
                <option value="360">6 phút (360s · 16 cảnh)</option>
                <option value="480">8 phút (480s · 16 cảnh)</option>
                <option value="600">10 phút (600s · 20 cảnh)</option>
                {![30, 60, 180, 300, 360, 480, 600].includes(studioDefaults.targetDurationSec) && (
                  <option value="custom">Tùy chỉnh ({studioDefaults.targetDurationSec}s)</option>
                )}
              </select>
              <input
                type="number"
                min={20}
                max={900}
                step={15}
                value={studioDefaults.targetDurationSec}
                onChange={(e) =>
                  onUpdateStudioDefaults({
                    ...studioDefaults,
                    targetDurationSec: Math.max(20, Math.min(900, Number(e.target.value) || 30)),
                  })
                }
                aria-label="Số giây mục tiêu"
                title="Nhập tùy ý từ 20 đến 900 giây (15 phút)"
                className="w-20 h-9 px-2 text-xs font-mono bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-900 dark:text-white text-center focus:outline-none focus:border-[#003B3E]"
              />
            </div>
          </div>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600 dark:text-teal-200/80">Chế độ dựng hình ảnh</span>
            <select
              value={studioDefaults.visualMode}
              onChange={(e) =>
                onUpdateStudioDefaults({
                  ...studioDefaults,
                  visualMode: e.target.value as DerivativeVisualMode,
                })
              }
              className="w-full h-9 px-3 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="muse2api_video">Muse2API Video (muse-video · Ưu tiên · Tự host)</option>
              <option value="gemini_omni">Gemini Omni Flash (gemini-omni-1.2-flash · Cần key trả phí)</option>
              <option value="remix">Remix cắt ghép video nguồn + AI voice</option>
              <option value="storyboard_motion">Ảnh chuyển động Ken Burns (Nhanh)</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-600 dark:text-teal-200/80">Giọng đọc AI tiếng Việt</span>
            <select
              value={studioDefaults.voice}
              onChange={(e) =>
                onUpdateStudioDefaults({
                  ...studioDefaults,
                  voice: e.target.value as DerivativeVoiceId,
                })
              }
              className="w-full h-9 px-3 text-xs font-medium bg-slate-50 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-white focus:outline-none focus:border-[#003B3E]"
            >
              <option value="Kore">Kore · Nữ rõ ràng, truyền cảm</option>
              <option value="Puck">Puck · Nam năng động, nhịp nhanh</option>
              <option value="Zephyr">Zephyr · Tự nhiên, nhẹ nhàng</option>
              <option value="Charon">Charon · Nam trầm ấm, chuyên sâu</option>
              <option value="Fenrir">Fenrir · Mạnh mẽ, dứt khoát</option>
              <option value="none">Không lồng tiếng (chỉ hình + chữ)</option>
            </select>
          </label>

          <div className="flex items-end pb-1.5">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-teal-100/90 cursor-pointer">
              <input
                type="checkbox"
                checked={studioDefaults.keepSourceAudio}
                onChange={(e) =>
                  onUpdateStudioDefaults({ ...studioDefaults, keepSourceAudio: e.target.checked })
                }
                className="rounded border-slate-300 text-[#003B3E] focus:ring-[#003B3E]"
              />
              <span>Giữ nhạc nền video gốc nhỏ (12%)</span>
            </label>
          </div>
        </div>
      </section>

      {/* SECTION 5: Mô-đun xử lý nội bộ trên máy */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200 dark:border-[#00464A] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-[#003B3E] dark:text-[#1BA8AD]" />
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Mô-đun xử lý video chạy trên máy chủ
              </h2>
              <p className="text-xs text-slate-500 dark:text-teal-200/70">
                Chạy ngoại tuyến ngay trên máy — không tốn phí API, không giới hạn lượt dựng video.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchCapabilities}
            disabled={loadingCaps}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] rounded-lg hover:bg-slate-200/70 dark:hover:bg-[#002935] transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingCaps ? 'animate-spin' : ''}`} />
            <span>Kiểm tra lại</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-white">FFmpeg + Libass</span>
              <span
                className={
                  capabilities?.localTools.ffmpeg.available
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-rose-600 dark:text-rose-400 font-medium'
                }
              >
                {capabilities?.localTools.ffmpeg.available ? 'Sẵn sàng' : 'Chưa tìm thấy'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-teal-100/75">
              Cắt ghép cảnh, làm mờ viền, khử logo và chèn phụ đề tiếng Việt ASS.
            </p>
            {capabilities?.localTools.ffmpeg.version && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-teal-200/65 truncate">
                {capabilities.localTools.ffmpeg.version}
              </p>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-white">yt-dlp + Giải mã luồng</span>
              <span
                className={
                  capabilities?.localTools.ytDlp.available
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-amber-600 dark:text-amber-400 font-medium'
                }
              >
                {capabilities?.localTools.ytDlp.available ? 'Sẵn sàng' : 'Đang nạp'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-teal-100/75">
              Trích xuất video đa nền tảng (YouTube, TikTok, Douyin, Bilibili, Weibo...).
            </p>
            {capabilities?.localTools.ytDlp.version && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-teal-200/65 font-variant-numeric tabular-nums">
                Phiên bản {capabilities.localTools.ytDlp.version}
              </p>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900 dark:text-white">Node.js Runtime (EJS)</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Sẵn sàng</span>
            </div>
            <p className="text-xs text-slate-600 dark:text-teal-100/75">
              Giải thử thách JavaScript của YouTube khi tải và trích đoạn video.
            </p>
            {capabilities?.localTools.node.version && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-teal-200/65 tabular-nums">
                {capabilities.localTools.node.version}
              </p>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-[#000A10]/60 border border-slate-200 dark:border-[#00464A] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                <Mic className="w-3.5 h-3.5 text-[#003B3E] dark:text-[#1BA8AD]" />
                <span>VieNeu-TTS Offline</span>
              </span>
              <span
                className={
                  capabilities?.localTools.offlineTts.available
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-amber-600 dark:text-amber-400 font-medium'
                }
              >
                {capabilities?.localTools.offlineTts.available ? 'Sẵn sàng' : 'Chưa cài'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-teal-100/75">
              Đọc tiếng Việt tự nhiên ngoại tuyến (ONNX CPU), thay thế bộ đọc hệ thống.
            </p>
            {capabilities?.localTools.offlineTts.engine && (
              <p className="text-[11px] font-mono text-slate-500 dark:text-teal-200/65 truncate">
                {capabilities.localTools.offlineTts.engine}
              </p>
            )}
            <button
              type="button"
              disabled={installingVieNeu}
              onClick={() => void handleInstallVieNeu()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#003B3E] hover:bg-[#002729] rounded-md transition-colors cursor-pointer disabled:opacity-50"
            >
              {installingVieNeu ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              <span>
                {installingVieNeu
                  ? 'Đang tải & nạp...'
                  : capabilities?.localTools.offlineTts.engineId === 'vieneu'
                  ? 'Nạp lại model VieNeu'
                  : 'Tải & Cài VieNeu Offline'}
              </span>
            </button>
            {vieNeuNotice && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 leading-snug">{vieNeuNotice}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
