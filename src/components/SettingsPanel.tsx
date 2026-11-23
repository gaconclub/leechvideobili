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
  Bot,
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
import { VOICE_OPTIONS } from './studio/studioConfig';
import { GeminiApiSettingsTab } from './GeminiApiSettingsTab';

interface SettingsPanelProps {
  perSiteCookies: PerSiteCookies;
  studioDefaults: StudioDefaultConfig;
  onSaveSiteCookie: (siteId: CookieSiteId, value: string) => void;
  onSaveAllCookies: (next: PerSiteCookies) => void;
  onUpdateStudioDefaults: (next: StudioDefaultConfig) => void;
}

type SettingsUnifiedTab = 'cookies' | 'ai' | 'muse' | 'gemini';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  perSiteCookies,
  studioDefaults,
  onSaveSiteCookie,
  onUpdateStudioDefaults,
}) => {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsUnifiedTab>('cookies');
  const [selectedSite, setSelectedSite] = useState<CookieSiteId>('youtube');
  const [cookieDraft, setCookieDraft] = useState('');
  const [showSessdata, setShowSessdata] = useState(false);
  const [cookieSavedNotice, setCookieSavedNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const unifiedCardRef = useRef<HTMLDivElement>(null);

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
      title: 'Wikimedia Commons',
      desc: 'Kho video phạm vi công cộng CC0 / CC BY. Miễn phí 100%, không cần API key.',
      statusLabel: 'Ưu tiên · Không cần key',
      available: true,
    },
    {
      id: 'auto',
      title: 'Tự động kết hợp',
      desc: 'Ưu tiên video nguồn gốc → Wikimedia Commons → Pexels → Pixabay → Ken Burns.',
      statusLabel: 'Khuyên dùng',
      available: true,
    },
    {
      id: 'pexels',
      title: 'Pexels Video',
      desc: 'Kho video nền HD miễn phí dùng thương mại khi khai báo PEXELS_API_KEY.',
      statusLabel: capabilities?.brollProviders.pexels.configured ? 'Đã có key' : 'Chưa đặt key',
      available: Boolean(capabilities?.brollProviders.pexels.configured),
    },
    {
      id: 'pixabay',
      title: 'Pixabay Video',
      desc: 'Kho clip đa chủ đề miễn phí khi khai báo PIXABAY_API_KEY.',
      statusLabel: capabilities?.brollProviders.pixabay.configured ? 'Đã có key' : 'Chưa đặt key',
      available: Boolean(capabilities?.brollProviders.pixabay.configured),
    },
    {
      id: 'none',
      title: 'Chỉ dùng ảnh Ken Burns',
      desc: 'Không tải kho B-roll ngoài; chuyển trực tiếp sang hiệu ứng zoom ảnh phân cảnh.',
      statusLabel: 'Nhanh nhất',
      available: true,
    },
  ];

  const jumpToUnifiedTab = (tab: SettingsUnifiedTab) => {
    setActiveSettingsTab(tab);
    unifiedCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="glass-card rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Thiết lập &amp; Cấu hình
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Quản lý cookie riêng từng nền tảng, chọn công cụ AI, Muse2API Pool, B-roll và cài đặt mặc định cho mọi video phái sinh mới.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-semibold tabular-nums">
            Cookie đã lưu: {configuredSitesCount}/{COOKIE_SITES.length} nền tảng
          </span>
          <button
            type="button"
            onClick={() => jumpToUnifiedTab('cookies')}
            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition cursor-pointer"
          >
            1. Cookies
          </button>
          <button
            type="button"
            onClick={() => jumpToUnifiedTab('ai')}
            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition cursor-pointer"
          >
            2. Kết nối AI
          </button>
          <button
            type="button"
            onClick={() => jumpToUnifiedTab('muse')}
            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition cursor-pointer"
          >
            3. Muse2API
          </button>
          <button
            type="button"
            onClick={() => jumpToUnifiedTab('gemini')}
            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition cursor-pointer"
          >
            4. API Gemini
          </button>
          <a
            href="#cfg-broll-box"
            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition"
          >
            B-roll
          </a>
          <a
            href="#cfg-modules-box"
            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 text-slate-700 dark:text-slate-200 hover:border-violet-400/60 transition"
          >
            Mô-đun
          </a>
        </div>
      </div>

      {/* UNIFIED 4-TAB CARD (COOKIES | KẾT NỐI AI | MUSE2API | KẾT NỐI API GEMINI) */}
      <section ref={unifiedCardRef} id="cfg-unified-table-card" className="glass-card rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-400/15 pb-3.5">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-600 dark:text-cyan-300">
              BẢNG QUẢN LÝ HỢP NHẤT • 4 TAB CHỨC NĂNG
            </span>
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white mt-0.5">
              Trung tâm Xác thực, AI Kịch bản, Muse2API &amp; API Gemini Pool
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="4 tab cấu hình hợp nhất"
            className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-slate-100 dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-1 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === 'cookies'}
              onClick={() => setActiveSettingsTab('cookies')}
              className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                activeSettingsTab === 'cookies'
                  ? 'font-bold bg-violet-500/20 dark:bg-violet-500/25 text-violet-800 dark:text-violet-200 border border-violet-500/45 shadow-sm'
                  : 'font-medium text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>1. Cookies nền tảng</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === 'ai'}
              onClick={() => setActiveSettingsTab('ai')}
              className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                activeSettingsTab === 'ai'
                  ? 'font-bold bg-violet-500/20 dark:bg-violet-500/25 text-violet-800 dark:text-violet-200 border border-violet-500/45 shadow-sm'
                  : 'font-medium text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>2. Kết nối AI kịch bản</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === 'muse'}
              onClick={() => setActiveSettingsTab('muse')}
              className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                activeSettingsTab === 'muse'
                  ? 'font-bold bg-violet-500/20 dark:bg-violet-500/25 text-violet-800 dark:text-violet-200 border border-violet-500/45 shadow-sm'
                  : 'font-medium text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>3. Dịch vụ Muse2API &amp; Pool</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === 'gemini'}
              onClick={() => setActiveSettingsTab('gemini')}
              className={`px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                activeSettingsTab === 'gemini'
                  ? 'font-bold bg-violet-500/20 dark:bg-violet-500/25 text-violet-800 dark:text-violet-200 border border-violet-500/45 shadow-sm'
                  : 'font-medium text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>4. Kết nối API Gemini</span>
            </button>
          </div>
        </div>

        {/* Unified Content Box */}
        <div className="rounded-2xl bg-slate-50/90 dark:bg-[#070913]/85 border border-slate-200 dark:border-slate-400/20 overflow-hidden">
          {/* TAB 1: COOKIES */}
          {activeSettingsTab === 'cookies' && (
            <div className="p-4 sm:p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                  <span>Cookie đăng nhập riêng từng nền tảng</span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Lưu cục bộ trên trình duyệt · tự lọc đúng tên miền
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
                {/* Site List Sidebar */}
                <div className="lg:col-span-4 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 divide-y divide-slate-200/80 dark:divide-slate-400/15 overflow-hidden flex lg:flex-col overflow-x-auto lg:overflow-x-visible">
                  {COOKIE_SITES.map((site) => {
                    const hasVal = Boolean(perSiteCookies[site.id]?.trim());
                    const isSelected = selectedSite === site.id;
                    return (
                      <button
                        key={site.id}
                        type="button"
                        onClick={() => setSelectedSite(site.id)}
                        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isSelected
                            ? 'bg-violet-500/15 dark:bg-violet-500/20 text-violet-900 dark:text-white font-semibold'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              hasVal ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-slate-300 dark:bg-slate-600'
                            }`}
                          />
                          <span>{site.label}</span>
                        </span>
                        <span
                          className={`font-mono text-[11px] ${
                            hasVal
                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
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
                <div className="lg:col-span-8 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-4 space-y-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {currentSiteMeta.label}{' '}
                        {currentSiteMeta.domain && (
                          <span className="font-mono text-xs font-normal text-slate-500 dark:text-slate-400">
                            ({currentSiteMeta.domain})
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 rounded-xl transition cursor-pointer whitespace-nowrap"
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
                        className="w-full h-10 pl-3.5 pr-10 text-xs font-mono bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-xl text-slate-900 dark:text-emerald-200 focus:outline-none focus:border-emerald-400"
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
                      className="w-full px-3.5 py-2.5 text-xs font-mono bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/25 rounded-xl text-slate-900 dark:text-emerald-200 focus:outline-none focus:border-emerald-400 resize-y"
                    />
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="text-xs">
                      {cookieSavedNotice ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {cookieSavedNotice}
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">
                          Hỗ trợ Netscape cookies.txt, JSON từ Cookie-Editor hoặc chuỗi Cookie header (k=v; ...).
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {Boolean(perSiteCookies[selectedSite]?.trim() || cookieDraft.trim()) && (
                        <button
                          type="button"
                          onClick={handleClearCurrentCookie}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-xl transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa cookie trang này</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleSaveCurrentCookie}
                        className="px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-xl transition cursor-pointer whitespace-nowrap shadow-sm"
                      >
                        Lưu Cookie {currentSiteMeta.label}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI PROVIDERS */}
          {activeSettingsTab === 'ai' && (
            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Kết nối AI viết kịch bản &amp; học nội dung video
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Chọn nhà cung cấp AI mặc định cho Studio Video Phái Sinh (giọng đọc tiếng Việt sử dụng Gemini Flash Lite TTS).
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleTestAiConnection}
                  disabled={testingAi}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-cyan-700 dark:text-cyan-200 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 rounded-xl transition cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {testingAi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Kiểm tra kết nối AI đang chọn</span>
                </button>
              </div>

              {/* Compact Comparison Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-400/20 bg-white dark:bg-[#0c1021]/80">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100/90 dark:bg-[#131a35]/90 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-400/15">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Nhà cung cấp AI</th>
                      <th className="py-2.5 px-3 font-semibold">Chức năng chính</th>
                      <th className="py-2.5 px-3 font-semibold">Model / Endpoint</th>
                      <th className="py-2.5 px-3 font-semibold">Biến khóa / Cấu hình</th>
                      <th className="py-2.5 px-3 text-right font-semibold">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 dark:divide-slate-400/15 text-slate-700 dark:text-slate-200">
                    {aiCards.map((card) => {
                      const isActive = studioDefaults.aiProvider === card.id;
                      return (
                        <tr
                          key={card.id}
                          onClick={() => {
                            setAiTestResult(null);
                            onUpdateStudioDefaults({ ...studioDefaults, aiProvider: card.id });
                          }}
                          className={`cursor-pointer transition ${
                            isActive
                              ? 'bg-violet-500/10 dark:bg-violet-500/15'
                              : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {card.title}
                            {isActive && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-700 dark:text-violet-300 font-semibold">
                                Đang chọn
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{card.subtitle}</td>
                          <td className="py-2.5 px-3 font-mono text-cyan-700 dark:text-cyan-300 whitespace-nowrap">
                            {card.modelName}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {card.envVar}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                card.configured
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {card.configured ? 'Đã sẵn sàng' : 'Chưa sẵn sàng'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 4 Clickable AI Provider Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
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
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer space-y-2 ${
                        isActive
                          ? 'bg-white dark:bg-[#0c1021]/95 border-emerald-500/60 dark:border-emerald-400/50 shadow-md'
                          : 'bg-white/75 dark:bg-[#0c1021]/95 border-slate-200 dark:border-slate-400/20 hover:border-violet-400/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 font-bold text-slate-900 dark:text-white">
                        <span className="truncate">{card.title}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${
                            isActive
                              ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300'
                              : card.configured
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {isActive ? 'Đang dùng' : card.configured ? 'Sẵn sàng' : 'Chưa đặt key'}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-400 leading-snug">{card.subtitle}</p>
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1 gap-2">
                        <span className="text-cyan-700 dark:text-cyan-300 truncate">{card.modelName}</span>
                        <span className="shrink-0">{card.envVar}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {aiTestResult && (
                <div
                  className={`flex items-start gap-2 px-3.5 py-2.5 rounded-xl border text-xs ${
                    aiTestResult.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200'
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

              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Bảo mật khóa API: Các khóa (<code className="font-mono">GEMINI_API_KEY</code>,{' '}
                <code className="font-mono">OPENAI_API_KEY</code>, <code className="font-mono">META_API_KEY</code>,{' '}
                <code className="font-mono">MUSE2API_KEY</code>) được đọc an toàn phía máy chủ từ{' '}
                <strong>Settings &gt; Secrets</strong> hoặc tệp <code className="font-mono">.env</code> /{' '}
                <code className="font-mono">muse2api/.env</code>.
              </p>
            </div>
          )}

          {/* TAB 3: MUSE2API SERVICE & ACCOUNT POOL */}
          {activeSettingsTab === 'muse' && (
            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Server className="w-4 h-4 text-violet-600 dark:text-violet-300" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Dịch vụ Muse2API &amp; Quản lý Pool tài khoản muse.ai
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Biến tài khoản web <code className="font-mono">muse.ai</code> thành API OpenAI tương thích (
                      <code className="font-mono">muse-spark</code>, <code className="font-mono">muse-image</code>,{' '}
                      <code className="font-mono">muse-video</code>).
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {muse2Status?.localRuntime?.chromiumAvailable &&
                    muse2Status?.localRuntime?.uvicornInstalled &&
                    (muse2Status.localRuntime.processRunning ? (
                      <button
                        type="button"
                        disabled={busyMuse2Action === 'stop'}
                        onClick={() => void handleMuse2Process('stop')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 rounded-xl cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Dừng Muse2API nội bộ</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyMuse2Action === 'start'}
                        onClick={() => void handleMuse2Process('start')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-xl cursor-pointer"
                      >
                        {busyMuse2Action === 'start' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        <span>Khởi chạy Muse2API nội bộ</span>
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => void fetchMuse2Status()}
                    disabled={loadingMuse2}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 rounded-xl transition cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingMuse2 ? 'animate-spin' : ''}`} />
                    <span>Làm mới trạng thái</span>
                  </button>
                </div>
              </div>

              {/* 4 Status Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Trạng thái kết nối</div>
                  <div className="flex items-center gap-1.5 font-bold">
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

                <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Địa chỉ máy chủ đích</div>
                  <div className="font-mono text-slate-900 dark:text-white font-semibold truncate">
                    {muse2Status?.baseUrl || 'http://127.0.0.1:18610'}
                  </div>
                </div>

                <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Tài khoản muse.ai</div>
                  <div className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300 font-semibold">
                    {muse2Status?.healthyAccounts ?? 0}/{muse2Status?.accountsCount ?? 0} khỏe · {muse2Status?.mediaCount ?? 0} tệp media
                  </div>
                </div>

                <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3 space-y-1">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">MUSE2API_KEY (Secrets / .env)</div>
                  <div className="font-mono text-violet-700 dark:text-violet-300 font-semibold truncate">
                    {muse2Status?.hasKey
                      ? `${muse2Status.maskedKey} (${muse2Status.keySource === 'env' ? 'Secrets/.env' : 'muse2api/.env'})`
                      : 'Chưa đặt biến MUSE2API_KEY'}
                  </div>
                </div>
              </div>

              {/* Offline Guide */}
              {!muse2Status?.reachable && (
                <div className="p-3.5 rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 space-y-2 text-xs text-slate-700 dark:text-slate-300">
                  <div className="font-bold text-slate-900 dark:text-white">
                    Hướng dẫn bật dịch vụ Muse2API (mã nguồn đã tích hợp sẵn trong thư mục{' '}
                    <code className="font-mono">/muse2api</code>):
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-[11px] leading-relaxed">
                    <li>
                      <strong>Cách 1 · Docker (Khuyên dùng):</strong> Mở thư mục{' '}
                      <code className="font-mono">muse2api/</code> trên máy chủ hoặc PC và chạy{' '}
                      <code className="font-mono bg-slate-100 dark:bg-[#131a35] px-1.5 py-0.5 rounded">
                        docker compose up -d --build
                      </code>{' '}
                      (cổng mặc định <code className="font-mono">18610</code>).
                    </li>
                    <li>
                      <strong>Cách 2 · Python cục bộ:</strong>{' '}
                      <code className="font-mono bg-slate-100 dark:bg-[#131a35] px-1.5 py-0.5 rounded">
                        cd muse2api &amp;&amp; pip install -r requirements.txt &amp;&amp; python -m uvicorn app:app --host 127.0.0.1 --port 18610
                      </code>
                    </li>
                    <li>
                      <strong>Cách 3 · Kết nối từ xa qua Tunnel:</strong> Mở Cloudflare Tunnel / ngrok trỏ tới cổng{' '}
                      <code className="font-mono">18610</code> rồi đặt{' '}
                      <code className="font-mono">MUSE2API_BASE_URL</code> &amp;{' '}
                      <code className="font-mono">MUSE2API_KEY</code> trong Secrets.
                    </li>
                  </ul>
                </div>
              )}

              {/* Account Pool Management when Reachable */}
              {muse2Status?.reachable && muse2Status.status !== 'auth_error' && (
                <div className="rounded-xl bg-white dark:bg-[#0c1021]/95 border border-slate-200 dark:border-slate-400/20 p-3.5 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                      <UserPlus className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
                      <span>Nạp Cookie phiên đăng nhập muse.ai (hỗ trợ Header, Cookie-Editor JSON, Netscape .txt)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {Boolean(perSiteCookies.muse?.trim()) && (
                        <button
                          type="button"
                          disabled={busyMuse2Action === 'add'}
                          onClick={() => void handleAddMuse2Account(perSiteCookies.muse, 'Muse Cookie từ Settings')}
                          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-white bg-violet-600 hover:bg-violet-500 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Đẩy Cookie muse.ai ở Tab 1 sang Pool</span>
                        </button>
                      )}
                      {(muse2Status.accountsCount || 0) > 0 && (
                        <button
                          type="button"
                          disabled={busyMuse2Action === 'keepalive_all'}
                          onClick={() => void handleMuse2KeepaliveAll()}
                          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {busyMuse2Action === 'keepalive_all' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
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
                      className="lg:col-span-3 h-9 px-3 text-xs bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                    />
                    <input
                      type="text"
                      value={museAccCookie}
                      onChange={(e) => setMuseAccCookie(e.target.value)}
                      placeholder="Dán Cookie muse.ai (hatch_sess=...; hatch_gw=...; hatch_vml=...) hoặc JSON Cookie-Editor..."
                      className="lg:col-span-7 h-9 px-3 text-xs font-mono bg-slate-50 dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                    />
                    <button
                      type="button"
                      disabled={busyMuse2Action === 'add' || !museAccCookie.trim()}
                      onClick={() => void handleAddMuse2Account(museAccCookie, museAccLabel)}
                      className="lg:col-span-2 h-9 px-3 text-xs font-bold text-slate-950 bg-emerald-500 hover:bg-emerald-400 rounded-xl transition disabled:opacity-50 cursor-pointer"
                    >
                      {busyMuse2Action === 'add' ? 'Đang nạp...' : '+ Thêm tài khoản'}
                    </button>
                  </div>

                  {Array.isArray(muse2Status.accounts) && muse2Status.accounts.length > 0 && (
                    <div className="divide-y divide-slate-200 dark:divide-slate-400/15 border border-slate-200 dark:border-slate-400/20 rounded-xl overflow-hidden">
                      {muse2Status.accounts.map((acc: any) => {
                        const quota = acc.quota || null;
                        return (
                          <div
                            key={acc.id}
                            className="p-3 bg-slate-50/70 dark:bg-[#070913]/60 flex flex-wrap items-center justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {acc.label || acc.id}
                                </span>
                                <span
                                  className={`text-[11px] font-semibold ${
                                    !acc.enabled
                                      ? 'text-slate-400'
                                      : acc.ok === true
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : acc.ok === false
                                      ? 'text-rose-600 dark:text-rose-400'
                                      : 'text-amber-600 dark:text-amber-400'
                                  }`}
                                >
                                  {!acc.enabled
                                    ? 'Đang tắt'
                                    : acc.ok === true
                                    ? 'Hoạt động'
                                    : acc.ok === false
                                    ? 'Lỗi phiên'
                                    : 'Chưa kiểm tra'}
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                  {acc.cookie_count || 0} cookies
                                </span>
                              </div>
                              {acc.last_error && (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xl">
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
                                className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                              >
                                {busyMuse2Action === `test:${acc.id}` ? 'Đang thử...' : 'Test phiên'}
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(busyMuse2Action)}
                                onClick={() => void handleMuse2AccountAction(acc.id, 'keepalive')}
                                className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                              >
                                Gia hạn
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(busyMuse2Action)}
                                onClick={() => void handleMuse2AccountAction(acc.id, 'quota')}
                                className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                              >
                                Hạn mức
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(busyMuse2Action)}
                                onClick={() => void handleMuse2AccountAction(acc.id, 'toggle', acc.enabled !== false)}
                                title={acc.enabled !== false ? 'Tạm tắt tài khoản' : 'Bật tài khoản'}
                                className="p-1.5 bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                              >
                                <Power className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(busyMuse2Action)}
                                onClick={() => void handleMuse2AccountAction(acc.id, 'delete')}
                                title="Xóa tài khoản"
                                className="p-1.5 text-rose-600 dark:text-rose-400 bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
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
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
                  {muse2Notice}
                </div>
              )}
              {muse2Error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-700 dark:text-rose-300">
                  {muse2Error}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: KẾT NỐI API GEMINI */}
          {activeSettingsTab === 'gemini' && <GeminiApiSettingsTab />}
        </div>
      </section>

      {/* BOTTOM 2-COLUMN GRID: B-ROLL + STUDIO DEFAULTS (LEFT 6) | SERVER MODULES (RIGHT 6) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT COLUMN (6/12): B-roll + Studio Defaults */}
        <section id="cfg-broll-box" className="lg:col-span-6 glass-card rounded-2xl p-4 sm:p-5 space-y-4 text-xs">
          <div className="flex items-start gap-2.5">
            <Film className="w-4 h-4 text-cyan-600 dark:text-cyan-300 mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Kho Video nền B-roll miễn phí khi nguồn gốc bị hạn chế
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Khi video nguồn (ví dụ YouTube) bị chặn hoặc chưa trích xuất trực tiếp được, Studio sẽ tự lấy clip chuyển động từ kho bạn chọn thay vì chỉ dùng ảnh tĩnh.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {brollCards.map((card) => {
              const isActive = studioDefaults.brollSource === card.id;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => onUpdateStudioDefaults({ ...studioDefaults, brollSource: card.id })}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer space-y-1 ${
                    isActive
                      ? 'bg-white dark:bg-[#0c1021]/95 border-emerald-500/60 dark:border-emerald-400/50 shadow-sm'
                      : 'bg-slate-50/80 dark:bg-[#0c1021]/90 border-slate-200 dark:border-slate-400/20 hover:border-violet-400/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-bold text-slate-900 dark:text-white">
                    <span className="truncate">{card.title}</span>
                    <span
                      className={`text-[10px] font-semibold shrink-0 ${
                        card.available
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {card.statusLabel}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{card.desc}</p>
                </button>
              );
            })}
          </div>

          {/* Studio Defaults Nested Card */}
          <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-slate-200 dark:border-slate-400/20 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <SlidersHorizontal className="w-3.5 h-3.5 text-violet-600 dark:text-violet-300" />
                <span>Thiết lập mặc định Studio Video Phái Sinh</span>
              </div>
              <button
                type="button"
                onClick={() => onUpdateStudioDefaults(DEFAULT_STUDIO_CONFIG)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-white/10 rounded-lg transition cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Khôi phục mặc định</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="space-y-1">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Phong cách mặc định</span>
                <select
                  value={studioDefaults.stylePreset}
                  onChange={(e) =>
                    onUpdateStudioDefaults({
                      ...studioDefaults,
                      stylePreset: e.target.value as DerivativeStylePreset,
                    })
                  }
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                >
                  <option value="none">Tắt kiểu dẫn chuyện (AI tự do theo ý tưởng)</option>
                  <option value="summary_fast">Tóm tắt &amp; Điểm tin nhanh</option>
                  <option value="storytelling_review">Kể chuyện / Review cuốn hút</option>
                  <option value="top_list">Top điểm nổi bật / So sánh</option>
                  <option value="tips_tutorial">Mẹo hay &amp; Hướng dẫn ngắn</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Tỉ lệ khung hình</span>
                <select
                  value={studioDefaults.aspectRatioMode}
                  onChange={(e) =>
                    onUpdateStudioDefaults({
                      ...studioDefaults,
                      aspectRatioMode: e.target.value as 'auto' | DerivativeAspectRatio,
                    })
                  }
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                >
                  <option value="auto">Tự động theo video nguồn</option>
                  <option value="9:16">9:16 Dọc (Shorts / TikTok / Reels)</option>
                  <option value="16:9">16:9 Ngang (YouTube / Bilibili)</option>
                  <option value="1:1">1:1 Vuông (Feed / Social)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Chế độ dựng hình ảnh</span>
                <select
                  value={studioDefaults.visualMode}
                  onChange={(e) =>
                    onUpdateStudioDefaults({
                      ...studioDefaults,
                      visualMode: e.target.value as DerivativeVisualMode,
                    })
                  }
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                >
                  <option value="muse2api_video">Muse2API Video (muse-video · Ưu tiên · Tự host)</option>
                  <option value="gemini_omni">Gemini Omni Flash (gemini-omni-1.2-flash · Cần key trả phí)</option>
                  <option value="remix">Remix cắt ghép video nguồn + AI voice</option>
                  <option value="storyboard_motion">Ảnh chuyển động Ken Burns (Nhanh)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Giọng đọc Gemini (Khóa miền Bắc Việt Nam)</span>
                <select
                  value={studioDefaults.voice}
                  onChange={(e) =>
                    onUpdateStudioDefaults({
                      ...studioDefaults,
                      voice: e.target.value as DerivativeVoiceId,
                    })
                  }
                  className="w-full h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                  <option value="none">Không lồng tiếng (chỉ hình + chữ)</option>
                </select>
              </label>

              <div className="sm:col-span-2 space-y-1">
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Thời lượng dự kiến ({Math.floor(studioDefaults.targetDurationSec / 60)}p {studioDefaults.targetDurationSec % 60}s)
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={
                      [10, 20, 30, 40, 60, 120, 180, 300, 600].includes(studioDefaults.targetDurationSec)
                        ? String(studioDefaults.targetDurationSec)
                        : 'custom'
                    }
                    onChange={(e) => {
                      if (e.target.value !== 'custom') {
                        onUpdateStudioDefaults({
                          ...studioDefaults,
                          targetDurationSec: Number(e.target.value),
                        });
                      }
                    }}
                    className="flex-1 h-9 px-2.5 text-xs font-medium bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-400"
                  >
                    <option value="10">10s</option>
                    <option value="20">20s</option>
                    <option value="30">30s</option>
                    <option value="40">40s</option>
                    <option value="60">60s</option>
                    <option value="120">2 phút</option>
                    <option value="180">3 phút</option>
                    <option value="300">5 phút</option>
                    <option value="600">10 phút</option>
                    {![10, 20, 30, 40, 60, 120, 180, 300, 600].includes(studioDefaults.targetDurationSec) && (
                      <option value="custom">Tùy chỉnh ({studioDefaults.targetDurationSec}s)</option>
                    )}
                  </select>
                  <input
                    type="number"
                    min={10}
                    max={900}
                    step={5}
                    value={studioDefaults.targetDurationSec}
                    onChange={(e) =>
                      onUpdateStudioDefaults({
                        ...studioDefaults,
                        targetDurationSec: Math.max(10, Math.min(900, Number(e.target.value) || 30)),
                      })
                    }
                    aria-label="Số giây mục tiêu"
                    className="w-20 h-9 px-2 text-xs font-mono bg-white dark:bg-[#131a35] border border-slate-200 dark:border-slate-400/20 rounded-xl text-slate-900 dark:text-white text-center focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="sm:col-span-2 pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={studioDefaults.keepSourceAudio}
                    onChange={(e) =>
                      onUpdateStudioDefaults({ ...studioDefaults, keepSourceAudio: e.target.checked })
                    }
                    className="w-4 h-4 rounded accent-emerald-500"
                  />
                  <span>Giữ nhạc nền video gốc nhỏ (12%)</span>
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN (6/12): SERVER MODULES */}
        <section id="cfg-modules-box" className="lg:col-span-6 glass-card rounded-2xl p-4 sm:p-5 space-y-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <Cpu className="w-4 h-4 text-violet-600 dark:text-violet-300 mt-0.5 shrink-0" />
              <div>
                <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Mô-đun xử lý video chạy trên máy chủ
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Chạy ngoại tuyến ngay trên máy — không tốn phí API, không giới hạn lượt dựng video.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={fetchCapabilities}
              disabled={loadingCaps}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-200/70 dark:hover:bg-white/10 rounded-xl transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingCaps ? 'animate-spin' : ''}`} />
              <span>Kiểm tra lại</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-emerald-500/30 dark:border-emerald-400/35 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>FFmpeg + Libass</span>
                <span
                  className={`text-[11px] font-semibold ${
                    capabilities?.localTools.ffmpeg.available
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {capabilities?.localTools.ffmpeg.available ? 'Sẵn sàng' : 'Chưa tìm thấy'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Cắt ghép cảnh, làm mờ viền, khử logo và chèn phụ đề tiếng Việt ASS.
              </p>
              {capabilities?.localTools.ffmpeg.version && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  {capabilities.localTools.ffmpeg.version}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-emerald-500/30 dark:border-emerald-400/35 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>yt-dlp + Giải mã luồng</span>
                <span
                  className={`text-[11px] font-semibold ${
                    capabilities?.localTools.ytDlp.available
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {capabilities?.localTools.ytDlp.available ? 'Sẵn sàng' : 'Đang nạp'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Trích xuất video đa nền tảng (YouTube, TikTok, Douyin, Bilibili, Weibo...).
              </p>
              {capabilities?.localTools.ytDlp.version && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  Phiên bản {capabilities.localTools.ytDlp.version}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-emerald-500/30 dark:border-emerald-400/35 p-3.5 space-y-1.5">
              <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                <span>Node.js Runtime (EJS)</span>
                <span className="text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">Sẵn sàng</span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Giải thử thách JavaScript của YouTube khi tải và trích đoạn video.
              </p>
              {capabilities?.localTools.node.version && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {capabilities.localTools.node.version}
                </div>
              )}
            </div>

            <div className="rounded-xl bg-slate-50/90 dark:bg-[#0c1021]/90 border border-emerald-500/30 dark:border-emerald-400/35 p-3.5 space-y-2">
              <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                <span className="inline-flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-300" />
                  <span>VieNeu-TTS Offline</span>
                </span>
                <span
                  className={`text-[11px] font-semibold ${
                    capabilities?.localTools.offlineTts.engineId === 'vieneu'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {capabilities?.localTools.offlineTts.engineId === 'vieneu' ? 'Sẵn sàng' : 'Chưa cài VieNeu'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Đọc tiếng Việt tự nhiên ngoại tuyến (ONNX CPU), thay thế bộ đọc hệ thống.
              </p>
              {capabilities?.localTools.offlineTts.engine && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  {capabilities.localTools.offlineTts.engineId === 'vieneu'
                    ? capabilities.localTools.offlineTts.engine
                    : `Dự phòng tạm: ${capabilities.localTools.offlineTts.engine}`}
                </div>
              )}
              <button
                type="button"
                disabled={installingVieNeu}
                onClick={() => void handleInstallVieNeu()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-cyan-500 hover:brightness-110 rounded-lg transition cursor-pointer disabled:opacity-50"
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
    </div>
  );
};
