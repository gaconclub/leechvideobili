import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  Languages,
  Download,
  Plus,
  KeyRound,
  ExternalLink,
  AlertCircle,
  History,
  X,
  Sparkles,
} from 'lucide-react';
import {
  SearchApiResponse,
  SearchSortOption,
  TRENDING_PLATFORMS,
  TrendingDurationFilter,
  TrendingOrientationFilter,
  TrendingPlatformId,
  TrendingVideoItem,
} from '../types/bilibili';
import { VideoDiscoveryCard } from './VideoDiscoveryCard';

interface SearchPanelProps {
  sessdata: string;
  ytCookies: string;
  externalQueryRequest?: { query: string; nonce: number } | null;
  queuedSourceUrls: Set<string>;
  bookmarkIds: Set<string>;
  onToggleBookmark: (video: TrendingVideoItem) => void;
  onAddVideosToQueue: (videos: TrendingVideoItem[], startImmediately: boolean) => void;
  onOpenCookieModal: () => void;
  onOpenDerivativeStudio: (videos: TrendingVideoItem[], query?: string) => void;
}

type SearchRegion = 'VN' | 'GLOBAL' | 'CN';

const SEARCH_HISTORY_KEY = 'gaconpro_search_history_v1';

const QUICK_SUGGESTIONS = [
  'Phim ngắn triệu view',
  'Ẩm thực đường phố',
  'Thủ công sáng tạo DIY',
  'Review công nghệ AI',
  'Thú cưng hài hước',
  'Nhạc remix thịnh hành',
];

export const SearchPanel: React.FC<SearchPanelProps> = ({
  sessdata,
  ytCookies,
  externalQueryRequest,
  queuedSourceUrls,
  bookmarkIds,
  onToggleBookmark,
  onAddVideosToQueue,
  onOpenCookieModal,
  onOpenDerivativeStudio,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [platform, setPlatform] = useState<TrendingPlatformId>('all');
  const [duration, setDuration] = useState<TrendingDurationFilter>('all');
  const [orientation, setOrientation] = useState<TrendingOrientationFilter>('all');
  const [sort, setSort] = useState<SearchSortOption>('relevance');
  const [region, setRegion] = useState<SearchRegion>('VN');

  const [data, setData] = useState<SearchApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());

  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  const recordHistory = useCallback((q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setHistory((prev) => [clean, ...prev.filter((item) => item !== clean)].slice(0, 10));
  }, []);

  const runSearch = useCallback(
    async (queryToRun: string, forceRefresh = false) => {
      const cleanQ = queryToRun.trim();
      if (!cleanQ) return;
      setIsLoading(true);
      setErrorMsg('');
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: cleanQ,
            platform,
            duration,
            orientation,
            sort,
            region,
            refresh: forceRefresh,
            sessdata,
            extraCookies: ytCookies,
          }),
        });
        const text = await res.text();
        const json = JSON.parse(text) as SearchApiResponse & { error?: string };
        if (!res.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        setData(json);
        setSelectedIds(new Set());
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể tìm kiếm video');
      } finally {
        setIsLoading(false);
      }
    },
    [platform, duration, orientation, sort, region, sessdata, ytCookies]
  );

  // Run whenever appliedQuery or filter dependencies change
  useEffect(() => {
    if (appliedQuery) {
      runSearch(appliedQuery, false);
    }
  }, [appliedQuery, runSearch]);

  // Trigger search when user clicks "Tìm video" from Trending Hot Topics
  useEffect(() => {
    if (externalQueryRequest?.query) {
      const q = externalQueryRequest.query.trim();
      if (q) {
        setSearchInput(q);
        setAppliedQuery(q);
        recordHistory(q);
      }
    }
  }, [externalQueryRequest, recordHistory]);

  const handleTranslateVisible = useCallback(
    async (videosToTranslate: TrendingVideoItem[]) => {
      const candidates = videosToTranslate
        .filter((v) => !translations[v.id] && /[^\u0000-\u007F\u00C0-\u1EF9]/.test(v.title))
        .slice(0, 15)
        .map((v) => ({ id: v.id, text: v.title }));

      if (candidates.length === 0) return;
      setIsTranslating(true);
      try {
        const res = await fetch('/api/trending/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titles: candidates }),
        });
        const json = (await res.json()) as { translations?: Record<string, string> };
        if (json?.translations && Object.keys(json.translations).length > 0) {
          setTranslations((prev) => ({ ...prev, ...json.translations }));
        }
      } catch {
        // ignore
      } finally {
        setIsTranslating(false);
      }
    },
    [translations]
  );

  useEffect(() => {
    if (autoTranslate && data?.videos?.length) {
      handleTranslateVisible(data.videos);
    }
  }, [autoTranslate, data?.videos, handleTranslateVisible]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchInput.trim();
    if (!clean) return;
    recordHistory(clean);
    if (clean === appliedQuery) {
      runSearch(clean, true);
    } else {
      setAppliedQuery(clean);
    }
  };

  const triggerKeyword = (kw: string) => {
    const clean = kw.trim();
    if (!clean) return;
    setSearchInput(clean);
    recordHistory(clean);
    setAppliedQuery(clean);
  };

  const toggleSelectCard = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddSingle = (video: TrendingVideoItem, startImmediately: boolean) => {
    onAddVideosToQueue([video], startImmediately);
    setJustAddedIds((prev) => {
      const next = new Set(prev);
      next.add(video.id);
      return next;
    });
  };

  const videos = data?.videos || [];

  const handleBulkAdd = (startImmediately: boolean) => {
    const chosen = videos.filter((v) => selectedIds.has(v.id));
    if (chosen.length === 0) return;
    onAddVideosToQueue(chosen, startImmediately);
    setJustAddedIds((prev) => {
      const next = new Set(prev);
      chosen.forEach((v) => next.add(v.id));
      return next;
    });
    setSelectedIds(new Set());
  };

  const activePlatformStatus = useMemo(() => {
    if (platform === 'all' || !data?.platformStatuses) return null;
    return data.platformStatuses.find((s) => s.platform === platform) || null;
  }, [platform, data?.platformStatuses]);

  const updatedLabel = useMemo(() => {
    if (!data?.updatedAt) return '';
    const d = new Date(data.updatedAt);
    return `lúc ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, [data?.updatedAt]);

  return (
    <div className="space-y-4">
      {/* Standalone Search Header */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#003B3E] dark:text-[#1BA8AD]">
              <Search className="w-3.5 h-3.5" />
              <span>Tìm kiếm video độc lập</span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Tìm kiếm video đa nền tảng
            </h1>
            <p className="text-sm text-slate-500 dark:text-teal-100/80">
              Tìm kiếm theo từ khóa, tên kênh hoặc chủ đề trên YouTube, Bilibili, Dailymotion, Kuaishou... độc lập hoàn toàn với bảng Xu hướng.
            </p>
          </div>
        </div>

        {/* Dedicated prominent search bar */}
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 dark:text-teal-200/55 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập từ khóa tìm video (tiếng Việt, tiếng Anh hoặc tiếng Trung)..."
              className="w-full h-10 pl-10 pr-9 text-sm bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-teal-200/45 focus:outline-none focus:border-[#003B3E] dark:focus:border-[#1BA8AD] focus:ring-2 focus:ring-[#003B3E]/15"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Xóa từ khóa"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as SearchRegion)}
              aria-label="Khu vực tìm kiếm"
              className="h-10 px-3 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-xl text-slate-800 dark:text-teal-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
            >
              <option value="VN">Khu vực: Việt Nam</option>
              <option value="CN">Khu vực: Trung Quốc</option>
              <option value="GLOBAL">Khu vực: Toàn cầu</option>
            </select>

            <button
              type="button"
              onClick={() => {
                const next = !autoTranslate;
                setAutoTranslate(next);
                if (next && videos.length > 0) {
                  handleTranslateVisible(videos);
                }
              }}
              disabled={isTranslating}
              className={`inline-flex items-center gap-1.5 h-10 px-3 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap cursor-pointer ${
                autoTranslate
                  ? 'bg-[#003B3E] text-white border-[#003B3E]'
                  : 'bg-[#F8FAFB] dark:bg-[#000A10] text-slate-700 dark:text-teal-100 border-slate-200/90 dark:border-[#00464A] hover:border-[#003B3E]'
              }`}
            >
              <Languages className={`w-3.5 h-3.5 ${isTranslating ? 'animate-pulse' : ''}`} />
              <span>{isTranslating ? 'Đang dịch...' : 'Dịch tiêu đề'}</span>
            </button>

            <button
              type="submit"
              disabled={!searchInput.trim() || isLoading}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-xl transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{isLoading ? 'Đang tìm...' : 'Tìm kiếm'}</span>
            </button>
          </div>
        </form>

        {/* Search history / Quick suggestions */}
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 text-slate-400 dark:text-teal-200/60 mr-1">
              <History className="w-3.5 h-3.5" />
              <span>Gần đây:</span>
            </span>
            {history.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => triggerKeyword(item)}
                className={`px-2.5 py-1 rounded-lg border text-xs transition-colors cursor-pointer ${
                  appliedQuery === item
                    ? 'bg-[#003B3E] text-white border-[#003B3E]'
                    : 'bg-[#F8FAFB] dark:bg-[#000A10] text-slate-600 dark:text-teal-100/80 border-slate-200/80 dark:border-[#00464A]/80 hover:border-[#003B3E]'
                }`}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-[11px] text-slate-400 hover:text-rose-500 ml-1 cursor-pointer"
            >
              Xóa lịch sử
            </button>
          </div>
        )}

        {/* Platform Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 border-t border-slate-200/70 dark:border-[#00464A]/70">
          {TRENDING_PLATFORMS.map((p) => {
            const active = platform === p.id;
            const st = data?.platformStatuses?.find((s) => s.platform === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlatform(p.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#003B3E] text-white border-[#003B3E] dark:border-[#1BA8AD]'
                    : 'bg-[#F8FAFB] dark:bg-[#000A10] text-slate-700 dark:text-teal-100/85 border-slate-200/90 dark:border-[#00464A] hover:border-[#003B3E] dark:hover:border-[#1BA8AD]'
                }`}
              >
                <span>{p.label}</span>
                {st && st.count > 0 && (
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      active ? 'text-teal-200' : 'text-slate-400 dark:text-teal-200/60'
                    }`}
                  >
                    {st.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search Filters & Bulk Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SearchSortOption)}
              aria-label="Sắp xếp kết quả tìm kiếm"
              className="h-8 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-teal-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
            >
              <option value="relevance">Liên quan nhất</option>
              <option value="views">Nhiều lượt xem</option>
              <option value="newest">Mới đăng nhất</option>
              <option value="engagement">Tương tác cao</option>
            </select>

            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as TrendingDurationFilter)}
              aria-label="Lọc độ dài video"
              className="h-8 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-teal-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
            >
              <option value="all">Mọi độ dài</option>
              <option value="short">Ngắn (≤ 1 phút)</option>
              <option value="medium">Trung bình (1 - 5 phút)</option>
              <option value="long">Dài (&gt; 5 phút)</option>
            </select>

            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as TrendingOrientationFilter)}
              aria-label="Lọc khung hình video"
              className="h-8 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-teal-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
            >
              <option value="all">Mọi khung hình</option>
              <option value="vertical">Video dọc (Shorts/Reels)</option>
              <option value="horizontal">Video ngang (16:9)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500 dark:text-teal-200/75 tabular-nums">
            {selectedIds.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const chosen = videos.filter((v) => selectedIds.has(v.id));
                    if (chosen.length > 0) onOpenDerivativeStudio(chosen, appliedQuery);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-white bg-gradient-to-r from-[#003B3E] to-[#005B60] hover:from-[#002729] hover:to-[#004A4F] rounded-md shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Học &amp; Tạo video phái sinh ({selectedIds.size})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAdd(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#000A10] border border-[#003B3E]/30 rounded-md hover:bg-[#003B3E]/20 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Thêm {selectedIds.size} video</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAdd(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#004E52] rounded-md cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Tải ngay {selectedIds.size} video</span>
                </button>
              </div>
            ) : videos.length > 0 ? (
              <button
                type="button"
                onClick={() => onOpenDerivativeStudio(videos.slice(0, 4), appliedQuery)}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#000A10] border border-[#003B3E]/35 dark:border-[#1BA8AD]/40 rounded-md hover:bg-[#003B3E]/20 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI học Top {Math.min(4, videos.length)} kết quả &amp; Tạo video phái sinh</span>
              </button>
            ) : null}
            {appliedQuery && (
              <span>
                {videos.length} kết quả{updatedLabel ? ` · ${updatedLabel}` : ''}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Error */}
      {errorMsg && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-sm text-rose-700 dark:text-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => runSearch(appliedQuery, true)}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 cursor-pointer shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Initial empty prompt before searching */}
      {!appliedQuery ? (
        <section className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-8 sm:p-10 text-center space-y-4">
          <div className="w-11 h-11 rounded-xl bg-[#003B3E]/10 dark:bg-[#003B3E]/60 text-[#003B3E] dark:text-[#1BA8AD] mx-auto flex items-center justify-center">
            <Search className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Nhập từ khóa để tìm kiếm video trực tiếp
            </h2>
            <p className="text-sm text-slate-500 dark:text-teal-100/75 max-w-lg mx-auto">
              Chọn gợi ý nhanh bên dưới hoặc nhập chủ đề bất kỳ để tìm và đưa video thẳng vào hàng đợi tải xuống.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {QUICK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => triggerKeyword(s)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] text-slate-700 dark:text-teal-100 hover:border-[#003B3E] dark:hover:border-[#1BA8AD] cursor-pointer transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      ) : activePlatformStatus &&
        activePlatformStatus.status === 'cookie_required' &&
        videos.length === 0 &&
        !isLoading ? (
        <div className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-6 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[#003B3E]/10 dark:bg-[#003B3E]/60 text-[#003B3E] dark:text-[#1BA8AD] mx-auto flex items-center justify-center">
            <KeyRound className="w-5 h-5" />
          </div>
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            {ytCookies.trim()
              ? `Tìm kiếm trực tiếp trên ${activePlatformStatus.label} đang bị giới hạn bảo mật`
              : `Tìm kiếm trên ${activePlatformStatus.label} cần Cookie hoặc mở trang gốc`}
          </h3>
          <p className="text-sm text-slate-600 dark:text-teal-100/80 max-w-xl mx-auto">
            {activePlatformStatus.message}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onOpenCookieModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Cấu hình Cookie</span>
            </button>
            {activePlatformStatus.exploreUrl && (
              <a
                href={activePlatformStatus.exploreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-teal-100 bg-slate-100 dark:bg-[#000A10] border border-slate-200 dark:border-[#00464A] hover:border-[#003B3E] rounded-lg"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Mở tìm kiếm {activePlatformStatus.label}</span>
              </a>
            )}
          </div>
        </div>
      ) : isLoading && videos.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-xl overflow-hidden animate-pulse"
            >
              <div className="aspect-video bg-slate-200 dark:bg-[#000A10]" />
              <div className="p-3.5 space-y-2.5">
                <div className="h-4 bg-slate-200 dark:bg-[#002836] rounded w-5/6" />
                <div className="h-3 bg-slate-200 dark:bg-[#002836] rounded w-2/3" />
                <div className="h-8 bg-slate-200 dark:bg-[#002836] rounded mt-2" />
              </div>
            </div>
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-800 dark:text-white">
            Không tìm thấy video nào cho từ khóa &ldquo;{appliedQuery}&rdquo; với bộ lọc hiện tại.
          </p>
          <p className="text-xs text-slate-500 dark:text-teal-200/70">
            Hãy thử từ khóa ngắn gọn hơn hoặc chuyển nền tảng về &ldquo;Tất cả&rdquo;.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {videos.map((video) => (
            <VideoDiscoveryCard
              key={video.id}
              video={video}
              isSelected={selectedIds.has(video.id)}
              isSaved={bookmarkIds.has(video.id)}
              isQueued={queuedSourceUrls.has(video.sourceUrl) || justAddedIds.has(video.id)}
              translatedTitle={translations[video.id]}
              onToggleSelect={toggleSelectCard}
              onToggleBookmark={onToggleBookmark}
              onAddSingle={handleAddSingle}
              onCreateDerivative={(v) => onOpenDerivativeStudio([v], appliedQuery)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
