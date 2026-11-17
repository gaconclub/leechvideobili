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

  useEffect(() => {
    setCookieDraft(perSiteCookies[selectedSite] || '');
    setCookieSavedNotice('');
  }, [selectedSite, perSiteCookies]);

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

  useEffect(() => {
    void fetchCapabilities();
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
      id: 'muse',
      title: 'Muse AI (Edison Bridge)',
      subtitle: 'Phân tích & tạo clip qua chat Edison (/api/edison/*), không dùng API key',
      envVar: 'Không cần API key',
      configured: true,
      modelName: capabilities?.aiProviders.muse?.model || 'Edison Bridge',
    },
  ];

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
                    {card.configured ? 'Đã sẵn sàng' : 'Chưa đặt biến'}
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
          Bảo mật khóa API: Các khóa (<code className="font-mono">GEMINI_API_KEY</code>, <code className="font-mono">OPENAI_API_KEY</code>, <code className="font-mono">META_API_KEY</code>) được ẩn và đọc an toàn phía máy chủ từ <strong>Settings &gt; Secrets</strong> hoặc tệp <code className="font-mono">.env</code> trên máy tính, không lộ trên trình duyệt. Riêng <strong>Muse AI (Edison)</strong> kết nối trực tiếp qua cầu nối <code className="font-mono">/api/edison/*</code> và không yêu cầu API key.
        </p>
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
              <option value="remix">Remix cắt ghép video nguồn + AI voice</option>
              <option value="storyboard_motion">Ảnh chuyển động Ken Burns (Nhanh)</option>
              <option value="gemini_omni">Gemini Omni Flash (gemini-omni-1.2-flash · Cần key trả phí)</option>
              <option value="muse_edison">Muse AI (Edison Bridge · qua Tunnel)</option>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
        </div>
      </section>
    </div>
  );
};
