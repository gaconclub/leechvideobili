import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Flame,
  Download,
  ExternalLink,
  Languages,
  KeyRound,
  Compass,
  Clock,
  AlertCircle,
  Search,
  Sparkles,
  History,
  X,
  Clapperboard,
} from 'lucide-react';
import {
  SearchApiResponse,
  SearchSortOption,
  TRENDING_CATEGORIES,
  TRENDING_PLATFORMS,
  TrendingApiResponse,
  TrendingDurationFilter,
  TrendingOrientationFilter,
  TrendingPlatformId,
  TrendingSortOption,
  TrendingTopicItem,
  TrendingVideoItem,
} from '../types/bilibili';
import { formatCompactCount } from '../utils/formatters';
import { VideoDiscoveryCard } from './VideoDiscoveryCard';

interface DiscoveryPanelProps {
  sessdata: string;
  ytCookies: string;
  externalQueryRequest?: { query: string; nonce: number } | null;
  queuedSourceUrls: Set<string>;
  bookmarks: TrendingVideoItem[];
  bookmarkIds: Set<string>;
  onToggleBookmark: (video: TrendingVideoItem) => void;
  onAddVideosToQueue: (videos: TrendingVideoItem[], startImmediately: boolean) => void;
  onOpenCookieModal: () => void;
  onOpenDerivativeStudio: (videos: TrendingVideoItem[], query?: string) => void;
  onTrendingCountChange?: (count: number) => void;
}

type DiscoverySubTab = 'videos' | 'topics' | 'bookmarks';
type DiscoveryRegion = 'VN' | 'GLOBAL' | 'CN';

const SEARCH_HISTORY_KEY = 'gaconpro_search_history_v1';

const QUICK_SUGGESTIONS = [
  'Phim ngắn triệu view',
  'Ẩm thực đường phố',
  'Thủ công sáng tạo DIY',
  'Review công nghệ AI',
  'Thú cưng hài hước',
  'Nhạc remix thịnh hành',
];

export const DiscoveryPanel: React.FC<DiscoveryPanelProps> = ({
  sessdata,
  ytCookies,
  externalQueryRequest,
  queuedSourceUrls,
  bookmarks,
  bookmarkIds,
  onToggleBookmark,
  onAddVideosToQueue,
  onOpenCookieModal,
  onOpenDerivativeStudio,
  onTrendingCountChange,
}) => {
  const [trendingModeActive, setTrendingModeActive] = useState<boolean>(true);
  const [subTab, setSubTab] = useState<DiscoverySubTab>('videos');

  // Shared filters
  const [platform, setPlatform] = useState<TrendingPlatformId>('all');
  const [category, setCategory] = useState<string>('all');
  const [duration, setDuration] = useState<TrendingDurationFilter>('all');
  const [orientation, setOrientation] = useState<TrendingOrientationFilter>('all');
  const [trendSort, setTrendSort] = useState<TrendingSortOption>('best');
  const [searchSort, setSearchSort] = useState<SearchSortOption>('relevance');
  const [region, setRegion] = useState<DiscoveryRegion>('VN');

  // Integrated Search Input
  const [searchInput, setSearchInput] = useState<string>('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState<string>('');

  // API Data
  const [trendData, setTrendData] = useState<TrendingApiResponse | null>(null);
  const [searchData, setSearchData] = useState<SearchApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Translation
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);

  // Selection & History
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

  // Fetch Trending API
  const fetchTrending = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      setErrorMsg('');
      try {
        const res = await fetch('/api/trending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform,
            category,
            duration,
            orientation,
            sort: trendSort,
            q: '',
            region,
            refresh: forceRefresh,
            sessdata,
            extraCookies: ytCookies,
          }),
        });
        const text = await res.text();
        const json = JSON.parse(text) as TrendingApiResponse & { error?: string };
        if (!res.ok) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        setTrendData(json);
        setSelectedIds(new Set());
        if (onTrendingCountChange && Array.isArray(json.videos)) {
          onTrendingCountChange(json.videos.length);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể tải danh sách video thịnh hành');
      } finally {
        setIsLoading(false);
      }
    },
    [platform, category, duration, orientation, trendSort, region, sessdata, ytCookies, onTrendingCountChange]
  );

  // Fetch Standalone Search API
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
            sort: searchSort,
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
        setSearchData(json);
        setSelectedIds(new Set());
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể tìm kiếm video');
      } finally {
        setIsLoading(false);
      }
    },
    [platform, duration, orientation, searchSort, region, sessdata, ytCookies]
  );

  useEffect(() => {
    if (trendingModeActive) {
      fetchTrending(false);
    }
  }, [trendingModeActive, fetchTrending]);

  useEffect(() => {
    if (!trendingModeActive && appliedSearchQuery) {
      runSearch(appliedSearchQuery, false);
    }
  }, [trendingModeActive, appliedSearchQuery, runSearch]);

  // External search request (from TopBar ⌘K or Hot Topic)
  useEffect(() => {
    if (externalQueryRequest?.query) {
      const q = externalQueryRequest.query.trim();
      if (q) {
        setTrendingModeActive(false);
        setSubTab('videos');
        setSearchInput(q);
        setAppliedSearchQuery(q);
        recordHistory(q);
      }
    }
  }, [externalQueryRequest, recordHistory]);

  const handleTriggerStandaloneSearch = (qRaw?: string) => {
    const q = (qRaw !== undefined ? qRaw : searchInput).trim();
    if (!q) {
      // Empty query switches back to Trending mode cleanly
      setTrendingModeActive(true);
      return;
    }
    setSearchInput(q);
    setTrendingModeActive(false);
    setSubTab('videos');
    setAppliedSearchQuery(q);
    recordHistory(q);
  };

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

  const rawVideos = useMemo(() => {
    if (subTab === 'bookmarks') return bookmarks;
    if (!trendingModeActive) {
      return searchData?.videos || [];
    }
    const list = trendData?.videos || [];
    const localFilter = searchInput.trim().toLowerCase();
    if (!localFilter) return list;
    return list.filter(
      (v) =>
        v.title.toLowerCase().includes(localFilter) ||
        (v.translatedTitle || '').toLowerCase().includes(localFilter) ||
        v.author.toLowerCase().includes(localFilter) ||
        v.platformLabel.toLowerCase().includes(localFilter)
    );
  }, [subTab, bookmarks, trendingModeActive, searchData?.videos, trendData?.videos, searchInput]);

  useEffect(() => {
    if (autoTranslate && rawVideos.length > 0) {
      handleTranslateVisible(rawVideos);
    }
  }, [autoTranslate, rawVideos, handleTranslateVisible]);

  const displayedTopics: TrendingTopicItem[] = useMemo(() => {
    const raw = trendData?.topics || [];
    if (platform === 'douyin' || platform === 'weibo') {
      return raw.filter((t) => t.platform === platform);
    }
    return raw;
  }, [trendData?.topics, platform]);

  const platformStatuses = trendingModeActive
    ? trendData?.platformStatuses
    : searchData?.platformStatuses;

  const activePlatformStatus = useMemo(() => {
    if (platform === 'all' || !platformStatuses) return null;
    return platformStatuses.find((s) => s.platform === platform) || null;
  }, [platform, platformStatuses]);

  const handleSelectPlatform = (nextPlatform: TrendingPlatformId) => {
    setPlatform(nextPlatform);
    if (trendingModeActive) {
      if (nextPlatform === 'weibo') {
        setSubTab('topics');
      } else if (subTab === 'topics' && !['all', 'douyin', 'weibo'].includes(nextPlatform)) {
        setSubTab('videos');
      }
    }
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

  const handleBulkAdd = (startImmediately: boolean) => {
    const chosen = rawVideos.filter((v) => selectedIds.has(v.id));
    if (chosen.length === 0) return;
    onAddVideosToQueue(chosen, startImmediately);
    setJustAddedIds((prev) => {
      const next = new Set(prev);
      chosen.forEach((v) => next.add(v.id));
      return next;
    });
    setSelectedIds(new Set());
  };

  const updatedLabel = useMemo(() => {
    const ts = trendingModeActive ? trendData?.updatedAt : searchData?.updatedAt;
    if (!ts) return '';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `cập nhật lúc ${hh}:${mm}`;
  }, [trendingModeActive, trendData?.updatedAt, searchData?.updatedAt]);

  return (
    <div className="space-y-4">
      {/* Main Unified Discovery Header */}
      <section className="glass-card rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-300">
              <Compass className="w-3.5 h-3.5" />
              <span>BẢNG XẾP HẠNG XU HƯỚNG TOÀN CẦU &amp; TÌM KIẾM ĐA NỀN TẢNG</span>
            </span>
            <h1 className="font-display text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white mt-0.5">
              {trendingModeActive
                ? 'Video & Đề tài đang thịnh hành'
                : 'Tìm kiếm video độc lập đa nền tảng'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {trendingModeActive ? (
                <>
                  Theo dõi bảng xếp hạng xu hướng và lọc theo chủ đề — gạt công tắc để{' '}
                  <strong className="text-slate-800 dark:text-slate-200">Tìm video độc lập (bỏ lọc xu hướng)</strong>.
                </>
              ) : (
                <>
                  Đang tìm kiếm trực tiếp không giới hạn bảng xếp hạng xu hướng — gạt công tắc để bật lại{' '}
                  <strong className="text-slate-800 dark:text-slate-200">Chế độ Xu hướng</strong>.
                </>
              )}
            </p>
          </div>

          {/* Right Controls: Trending Switch + Region + Translate + Refresh */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5">
              <label className="ios-switch" title="Chuyển giữa Chế độ Xu hướng và Tìm video độc lập">
                <input
                  type="checkbox"
                  checked={trendingModeActive}
                  onChange={(e) => {
                    const nextMode = e.target.checked;
                    setTrendingModeActive(nextMode);
                    if (!nextMode && !appliedSearchQuery && searchInput.trim()) {
                      setAppliedSearchQuery(searchInput.trim());
                    }
                  }}
                />
                <span className="ios-slider" />
              </label>
              <span
                className={`font-bold whitespace-nowrap ${
                  trendingModeActive
                    ? 'text-amber-600 dark:text-amber-300'
                    : 'text-cyan-700 dark:text-cyan-300'
                }`}
              >
                {trendingModeActive
                  ? 'Chế độ Xu hướng (Đang bật)'
                  : 'Tìm video độc lập (Đã bỏ lọc xu hướng)'}
              </span>
            </div>

            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as DiscoveryRegion)}
              aria-label="Khu vực"
              className="rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none"
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
                if (next && rawVideos.length > 0) {
                  handleTranslateVisible(rawVideos);
                }
              }}
              disabled={isTranslating}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-medium transition cursor-pointer whitespace-nowrap ${
                autoTranslate
                  ? 'bg-violet-600 text-white border-violet-500'
                  : 'bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200'
              }`}
            >
              <Languages className={`w-3.5 h-3.5 ${isTranslating ? 'animate-pulse' : ''}`} />
              <span>{isTranslating ? 'Đang dịch...' : 'Dịch tiêu đề'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (trendingModeActive) fetchTrending(true);
                else if (appliedSearchQuery) runSearch(appliedSearchQuery, true);
              }}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-semibold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {/* Integrated Search Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTriggerStandaloneSearch();
          }}
          className="flex flex-col sm:flex-row gap-2 text-xs"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={
                trendingModeActive
                  ? 'Nhập từ khóa để tìm video độc lập hoặc lọc nhanh danh sách xu hướng (Việt, Anh, Trung)...'
                  : 'Nhập từ khóa tìm kiếm trên YouTube, TikTok, Douyin, Bilibili...'
              }
              className="w-full rounded-xl bg-slate-50 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 focus:border-cyan-500 dark:focus:border-cyan-400 focus:outline-none px-3.5 py-2 pr-8 text-slate-900 dark:text-white"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  if (!trendingModeActive) setAppliedSearchQuery('');
                }}
                aria-label="Xóa từ khóa"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 hover:brightness-110 text-slate-950 font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Tìm kiếm</span>
          </button>
        </form>

        {/* Quick Suggestions & Search History */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 dark:text-slate-400 mr-1">Gợi ý nhanh:</span>
          {QUICK_SUGGESTIONS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleTriggerStandaloneSearch(chip)}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 hover:border-cyan-500/60 dark:hover:border-cyan-400/50 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              {chip}
            </button>
          ))}
          {history.length > 0 && (
            <>
              <span className="text-slate-400 mx-1 inline-flex items-center gap-1">
                <History className="w-3 h-3" />
                Gần đây:
              </span>
              {history.slice(0, 4).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleTriggerStandaloneSearch(h)}
                  className="px-2 py-0.5 rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-400/25 hover:bg-violet-500/20 cursor-pointer"
                >
                  {h}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Sub-tabs: Video thịnh hành / Đề tài hot / Đã lưu */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setSubTab('videos')}
            className={`px-3.5 py-1.5 rounded-xl font-bold border transition cursor-pointer tabular-nums ${
              subTab === 'videos'
                ? 'bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-400/45'
                : 'bg-slate-100 dark:bg-[#0c1021] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-200/70 dark:hover:bg-white/5'
            }`}
          >
            {trendingModeActive
              ? `Video thịnh hành (${trendData?.videos?.length ?? 0})`
              : `Kết quả tìm kiếm (${searchData?.videos?.length ?? 0})`}
          </button>

          {trendingModeActive && (
            <button
              type="button"
              onClick={() => setSubTab('topics')}
              className={`px-3.5 py-1.5 rounded-xl font-semibold border transition cursor-pointer tabular-nums ${
                subTab === 'topics'
                  ? 'bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-400/45'
                  : 'bg-slate-100 dark:bg-[#0c1021] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-200/70 dark:hover:bg-white/5'
              }`}
            >
              Đề tài hot ({displayedTopics.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => setSubTab('bookmarks')}
            className={`px-3.5 py-1.5 rounded-xl font-semibold border transition cursor-pointer tabular-nums ${
              subTab === 'bookmarks'
                ? 'bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-400/45'
                : 'bg-slate-100 dark:bg-[#0c1021] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-200/70 dark:hover:bg-white/5'
            }`}
          >
            Đã lưu ({bookmarks.length})
          </button>
        </div>

        {/* Platform Chips */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          {TRENDING_PLATFORMS.map((p) => {
            const active = platform === p.id;
            const st = platformStatuses?.find((s) => s.platform === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPlatform(p.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border transition cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-violet-500/25 text-violet-900 dark:text-violet-200 border-violet-400/50 font-bold'
                    : 'bg-slate-100 dark:bg-[#0c1021] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-200/70 dark:hover:bg-white/5'
                }`}
              >
                <span>{p.label}</span>
                {st && st.count > 0 && (
                  <span className="font-mono text-[10px] tabular-nums text-cyan-700 dark:text-cyan-300 font-semibold">
                    {st.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Category Chips (Active in Trending Mode) */}
        {subTab === 'videos' && (
          <div
            className={`flex flex-wrap gap-1.5 text-xs transition-opacity ${
              trendingModeActive ? 'opacity-100' : 'opacity-40 pointer-events-none'
            }`}
          >
            {TRENDING_CATEGORIES.map((c) => {
              const active = category === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`px-2.5 py-1 rounded-xl border transition cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-400/45 font-bold'
                      : 'bg-slate-100 dark:bg-[#0c1021] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-400/20 hover:bg-slate-200/70 dark:hover:bg-white/5'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Secondary Filters + AI Learn Top 4 */}
        {subTab === 'videos' && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-200/80 dark:border-slate-400/15 text-xs">
            <div className="flex flex-wrap gap-2">
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value as TrendingDurationFilter)}
                aria-label="Lọc độ dài video"
                className="rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none"
              >
                <option value="all">Mọi độ dài</option>
                <option value="short">Ngắn (≤ 60s)</option>
                <option value="medium">Trung bình (1 - 5 phút)</option>
                <option value="long">Dài (&gt; 5 phút)</option>
              </select>

              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as TrendingOrientationFilter)}
                aria-label="Lọc khung hình"
                className="rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none"
              >
                <option value="all">Mọi khung hình</option>
                <option value="vertical">Dọc (Shorts/Reels)</option>
                <option value="horizontal">Ngang (16:9)</option>
              </select>

              {trendingModeActive ? (
                <select
                  value={trendSort}
                  onChange={(e) => setTrendSort(e.target.value as TrendingSortOption)}
                  aria-label="Sắp xếp xu hướng"
                  className="rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none"
                >
                  <option value="best">Đáng tải nhất</option>
                  <option value="rising">Lên nhanh nhất</option>
                  <option value="views">Nhiều lượt xem</option>
                  <option value="engagement">Tương tác cao</option>
                  <option value="newest">Mới đăng</option>
                </select>
              ) : (
                <select
                  value={searchSort}
                  onChange={(e) => setSearchSort(e.target.value as SearchSortOption)}
                  aria-label="Sắp xếp tìm kiếm"
                  className="rounded-xl bg-slate-100 dark:bg-[#0c1021] border border-slate-200 dark:border-slate-400/20 px-3 py-1.5 text-slate-800 dark:text-slate-200 cursor-pointer focus:outline-none"
                >
                  <option value="relevance">Phù hợp nhất</option>
                  <option value="views">Nhiều lượt xem</option>
                  <option value="engagement">Tương tác cao</option>
                  <option value="newest">Mới đăng</option>
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {rawVideos.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenDerivativeStudio(
                      rawVideos.slice(0, 4),
                      trendingModeActive ? '' : appliedSearchQuery
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:brightness-110 text-white font-bold shadow cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    AI học Top {Math.min(4, rawVideos.length)} video &amp; Tạo phái sinh
                  </span>
                </button>
              )}

              <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {rawVideos.length} video{updatedLabel ? ` • ${updatedLabel}` : ''}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Error State */}
      {errorMsg && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-700 dark:text-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (trendingModeActive) fetchTrending(true);
              else if (appliedSearchQuery) runSearch(appliedSearchQuery, true);
            }}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 cursor-pointer shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Cookie Required Notice */}
      {subTab === 'videos' &&
        !isLoading &&
        activePlatformStatus &&
        activePlatformStatus.status === 'cookie_required' &&
        rawVideos.length === 0 && (
          <div className="glass-card rounded-2xl p-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300 mx-auto flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              {ytCookies.trim()
                ? `${activePlatformStatus.label} đang giới hạn phiên truy cập tự động`
                : `${activePlatformStatus.label} cần Cookie hoặc mở trang gốc`}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
              {activePlatformStatus.message}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onOpenCookieModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Cấu hình Cookie</span>
              </button>
              {activePlatformStatus.exploreUrl && (
                <a
                  href={activePlatformStatus.exploreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Mở {activePlatformStatus.label}</span>
                </a>
              )}
            </div>
          </div>
        )}

      {/* Videos Grid */}
      {(subTab === 'videos' || subTab === 'bookmarks') && (
        <>
          {isLoading && rawVideos.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div
                  key={idx}
                  className="glass-card rounded-2xl p-3 space-y-2.5 animate-pulse"
                >
                  <div className="aspect-video rounded-xl bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded w-5/6" />
                  <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-2/3" />
                  <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-xl" />
                </div>
              ))}
            </div>
          ) : rawVideos.length === 0 ? (
            !activePlatformStatus || activePlatformStatus.status !== 'cookie_required' ? (
              <div className="glass-card rounded-2xl p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {subTab === 'bookmarks'
                    ? 'Chưa có video nào được lưu. Bấm biểu tượng ngôi sao trên thẻ video để lưu vào đây.'
                    : !trendingModeActive && !appliedSearchQuery
                    ? 'Nhập từ khóa hoặc chọn gợi ý nhanh phía trên để tìm video độc lập đa nền tảng.'
                    : 'Không có video nào khớp bộ lọc hiện tại.'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hãy thử đổi từ khóa, chọn nền tảng khác hoặc xóa bộ lọc độ dài / khung hình.
                </p>
              </div>
            ) : null
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
              {rawVideos.map((video) => (
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
                  onCreateDerivative={(v) =>
                    onOpenDerivativeStudio([v], trendingModeActive ? '' : appliedSearchQuery)
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Hot Topics Tab */}
      {subTab === 'topics' && (
        <section className="glass-card rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-400/15 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Bảng xếp hạng từ khóa &amp; đề tài hot (Douyin &amp; Weibo)
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {displayedTopics.length} đề tài đang lên
            </span>
          </div>

          {displayedTopics.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {isLoading ? 'Đang tải bảng xếp hạng đề tài hot...' : 'Chưa có đề tài hot phù hợp.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-200/70 dark:divide-slate-400/15">
              {displayedTopics.map((topic) => (
                <div
                  key={topic.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <span
                      className={`w-7 text-center font-mono text-sm font-bold tabular-nums shrink-0 ${
                        topic.rank <= 3 ? 'text-amber-500' : 'text-slate-400'
                      }`}
                    >
                      #{topic.rank}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300 shrink-0">
                          {topic.platformLabel}
                        </span>
                        {topic.tag && (
                          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                            · {topic.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {topic.title}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300">
                      <div className="inline-flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5 text-amber-500" />
                        <span>{formatCompactCount(topic.hotValue)}</span>
                      </div>
                      {topic.videoCount && topic.videoCount > 0 ? (
                        <div className="text-[11px] text-slate-400 inline-flex items-center gap-1 ml-3">
                          <Clock className="w-3 h-3" />
                          <span>{topic.videoCount} video</span>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTriggerStandaloneSearch(topic.title)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-200 bg-cyan-500/15 border border-cyan-400/30 rounded-xl hover:bg-cyan-500/25 cursor-pointer whitespace-nowrap"
                    >
                      <Search className="w-3 h-3" />
                      <span>Tìm video</span>
                    </button>

                    <a
                      href={topic.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-300 hover:text-cyan-500"
                      title="Xem trên nền tảng gốc"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Floating Multi-Select Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 glass-card-accent rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-center gap-2.5 text-xs shadow-2xl">
          <span className="text-slate-900 dark:text-white font-semibold">
            Đã chọn <strong className="text-cyan-600 dark:text-cyan-300 font-mono tabular-nums">{selectedIds.size}</strong> video
          </span>
          <button
            type="button"
            onClick={() => handleBulkAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Đưa vào Tải hàng loạt</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const chosen = rawVideos.filter((v) => selectedIds.has(v.id));
              if (chosen.length > 0) {
                onOpenDerivativeStudio(chosen, trendingModeActive ? '' : appliedSearchQuery);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-800 dark:text-violet-200 font-bold transition cursor-pointer whitespace-nowrap"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span>Đưa sang Studio phái sinh</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="px-2.5 py-1.5 rounded-xl bg-slate-200/80 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            Bỏ chọn
          </button>
        </div>
      )}
    </div>
  );
};
