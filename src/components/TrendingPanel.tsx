import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Flame,
  Download,
  Plus,
  ExternalLink,
  Languages,
  KeyRound,
  Compass,
  Clock,
  AlertCircle,
  Search,
  Sparkles,
} from 'lucide-react';
import {
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

interface TrendingPanelProps {
  sessdata: string;
  ytCookies: string;
  queuedSourceUrls: Set<string>;
  bookmarks: TrendingVideoItem[];
  bookmarkIds: Set<string>;
  onToggleBookmark: (video: TrendingVideoItem) => void;
  onAddVideosToQueue: (videos: TrendingVideoItem[], startImmediately: boolean) => void;
  onOpenCookieModal: () => void;
  onSearchTopic: (topic: string) => void;
  onOpenDerivativeStudio: (videos: TrendingVideoItem[], query?: string) => void;
}

type TrendingSubTab = 'videos' | 'topics' | 'bookmarks';
type TrendingRegion = 'VN' | 'GLOBAL' | 'CN';

export const TrendingPanel: React.FC<TrendingPanelProps> = ({
  sessdata,
  ytCookies,
  queuedSourceUrls,
  bookmarks,
  bookmarkIds,
  onToggleBookmark,
  onAddVideosToQueue,
  onOpenCookieModal,
  onSearchTopic,
  onOpenDerivativeStudio,
}) => {
  const [subTab, setSubTab] = useState<TrendingSubTab>('videos');
  const [platform, setPlatform] = useState<TrendingPlatformId>('all');
  const [category, setCategory] = useState<string>('all');
  const [duration, setDuration] = useState<TrendingDurationFilter>('all');
  const [orientation, setOrientation] = useState<TrendingOrientationFilter>('all');
  const [sort, setSort] = useState<TrendingSortOption>('best');
  const [region, setRegion] = useState<TrendingRegion>('VN');

  const [data, setData] = useState<TrendingApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());

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
            sort,
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
        setData(json);
        setSelectedIds(new Set());
      } catch (err: any) {
        setErrorMsg(err?.message || 'Không thể tải danh sách video thịnh hành');
      } finally {
        setIsLoading(false);
      }
    },
    [platform, category, duration, orientation, sort, region, sessdata, ytCookies]
  );

  useEffect(() => {
    fetchTrending(false);
  }, [fetchTrending]);

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

  const handleSelectPlatform = (nextPlatform: TrendingPlatformId) => {
    setPlatform(nextPlatform);
    if (nextPlatform === 'weibo') {
      setSubTab('topics');
    } else if (subTab === 'topics' && !['all', 'douyin', 'weibo'].includes(nextPlatform)) {
      setSubTab('videos');
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

  const displayedVideos = useMemo(() => {
    if (subTab === 'bookmarks') {
      return bookmarks;
    }
    return data?.videos || [];
  }, [subTab, bookmarks, data?.videos]);

  const displayedTopics: TrendingTopicItem[] = useMemo(() => {
    const raw = data?.topics || [];
    if (platform === 'douyin' || platform === 'weibo') {
      return raw.filter((t) => t.platform === platform);
    }
    return raw;
  }, [data?.topics, platform]);

  const activePlatformStatus = useMemo(() => {
    if (platform === 'all' || !data?.platformStatuses) return null;
    return data.platformStatuses.find((s) => s.platform === platform) || null;
  }, [platform, data?.platformStatuses]);

  const handleBulkAdd = (startImmediately: boolean) => {
    const chosen = displayedVideos.filter((v) => selectedIds.has(v.id));
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
    if (!data?.updatedAt) return '';
    const d = new Date(data.updatedAt);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `cập nhật lúc ${hh}:${mm}`;
  }, [data?.updatedAt]);

  return (
    <div className="space-y-4">
      {/* Trending Header & Filter Workspace */}
      <section className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#003B3E] dark:text-[#1BA8AD]">
              <Compass className="w-3.5 h-3.5" />
              <span>Bảng xếp hạng xu hướng toàn cầu</span>
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Video &amp; Đề tài đang thịnh hành
            </h1>
            <p className="text-sm text-slate-500 dark:text-teal-100/80">
              Theo dõi bảng xếp hạng video đang lên theo chủ đề và nền tảng — bấm một nút để đưa vào hàng đợi tải &amp; xử lý FFmpeg.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as TrendingRegion)}
              aria-label="Khu vực thịnh hành"
              className="h-9 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-teal-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
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
                if (next && displayedVideos.length > 0) {
                  handleTranslateVisible(displayedVideos);
                }
              }}
              disabled={isTranslating}
              title="Dịch tiêu đề sang tiếng Việt"
              className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoTranslate
                  ? 'bg-[#003B3E] text-white border-[#003B3E]'
                  : 'bg-[#F8FAFB] dark:bg-[#000A10] text-slate-700 dark:text-teal-100 border-slate-200/90 dark:border-[#00464A] hover:border-[#003B3E]'
              }`}
            >
              <Languages className={`w-3.5 h-3.5 ${isTranslating ? 'animate-pulse' : ''}`} />
              <span>{isTranslating ? 'Đang dịch...' : 'Dịch tiêu đề'}</span>
            </button>

            <button
              type="button"
              onClick={() => fetchTrending(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {/* Sub-tabs Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-200/70 dark:border-[#00464A]/70">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#000A10] border border-slate-200/80 dark:border-[#00464A]/80">
            <button
              type="button"
              onClick={() => setSubTab('videos')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                subTab === 'videos'
                  ? 'bg-[#003B3E] text-white shadow-xs'
                  : 'text-slate-600 dark:text-teal-100/80 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Video thịnh hành ({data?.videos?.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('topics')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                subTab === 'topics'
                  ? 'bg-[#003B3E] text-white shadow-xs'
                  : 'text-slate-600 dark:text-teal-100/80 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Đề tài hot ({displayedTopics.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('bookmarks')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                subTab === 'bookmarks'
                  ? 'bg-[#003B3E] text-white shadow-xs'
                  : 'text-slate-600 dark:text-teal-100/80 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Đã lưu ({bookmarks.length})
            </button>
          </div>
        </div>

        {/* Platform Switcher Row */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {TRENDING_PLATFORMS.map((p) => {
            const active = platform === p.id;
            const st = data?.platformStatuses?.find((s) => s.platform === p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPlatform(p.id)}
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

        {/* Category Filter Buttons */}
        {subTab === 'videos' && (
          <>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {TRENDING_CATEGORIES.map((c) => {
                const active = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#003B3E]/12 dark:bg-[#003B3E] text-[#003B3E] dark:text-white border-[#003B3E] dark:border-[#1BA8AD]'
                        : 'bg-transparent text-slate-600 dark:text-teal-100/75 border-slate-200/80 dark:border-[#00464A]/70 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-[#00686E]'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>

            {/* Secondary Filters + Sort + Count */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/70 dark:border-[#00464A]/70">
              <div className="flex flex-wrap items-center gap-2">
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

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as TrendingSortOption)}
                  aria-label="Sắp xếp video"
                  className="h-8 px-2.5 text-xs font-medium bg-[#F8FAFB] dark:bg-[#000A10] border border-slate-200/90 dark:border-[#00464A] rounded-lg text-slate-800 dark:text-teal-50 focus:outline-none focus:border-[#003B3E] cursor-pointer"
                >
                  <option value="best">Đáng tải nhất</option>
                  <option value="rising">Lên nhanh nhất</option>
                  <option value="views">Nhiều lượt xem</option>
                  <option value="engagement">Tương tác cao</option>
                  <option value="newest">Mới đăng</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500 dark:text-teal-200/75 tabular-nums">
                {selectedIds.size > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const chosen = displayedVideos.filter((v) => selectedIds.has(v.id));
                        if (chosen.length > 0) onOpenDerivativeStudio(chosen, '');
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
                      <span>Thêm {selectedIds.size} video vào hàng đợi</span>
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
                ) : displayedVideos.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => onOpenDerivativeStudio(displayedVideos.slice(0, 4), '')}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#000A10] border border-[#003B3E]/35 dark:border-[#1BA8AD]/40 rounded-md hover:bg-[#003B3E]/20 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI học Top {Math.min(4, displayedVideos.length)} video &amp; Tạo phái sinh</span>
                  </button>
                ) : null}
                <span>
                  {displayedVideos.length} video{updatedLabel ? ` · ${updatedLabel}` : ''}
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Error State */}
      {errorMsg && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-sm text-rose-700 dark:text-rose-200">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchTrending(true)}
            className="px-3 py-1 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 cursor-pointer shrink-0"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Platform Cookie/Notice Banner */}
      {subTab === 'videos' &&
        !isLoading &&
        activePlatformStatus &&
        activePlatformStatus.status === 'cookie_required' &&
        displayedVideos.length === 0 && (
          <div className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#003B3E]/10 dark:bg-[#003B3E]/60 text-[#003B3E] dark:text-[#1BA8AD] mx-auto flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {ytCookies.trim()
                ? `${activePlatformStatus.label} đang giới hạn phiên truy cập tự động`
                : `${activePlatformStatus.label} cần Cookie hoặc mở trang gốc`}
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
                  <span>Mở {activePlatformStatus.label} Explore</span>
                </a>
              )}
            </div>
          </div>
        )}

      {/* Videos or Bookmarks Grid */}
      {(subTab === 'videos' || subTab === 'bookmarks') && (
        <>
          {isLoading && subTab === 'videos' && displayedVideos.length === 0 ? (
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
          ) : displayedVideos.length === 0 ? (
            !activePlatformStatus || activePlatformStatus.status !== 'cookie_required' ? (
              <div className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl p-10 text-center space-y-2">
                <p className="text-sm font-medium text-slate-800 dark:text-white">
                  {subTab === 'bookmarks'
                    ? 'Chưa có video nào được lưu. Bấm biểu tượng ngôi sao trên thẻ video để lưu vào đây.'
                    : 'Không có video nào khớp bộ lọc hiện tại.'}
                </p>
                <p className="text-xs text-slate-500 dark:text-teal-200/70">
                  Hãy thử đổi danh mục, chọn nền tảng khác hoặc xóa bộ lọc độ dài / khung hình.
                </p>
              </div>
            ) : null
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {displayedVideos.map((video) => (
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
                  onCreateDerivative={(v) => onOpenDerivativeStudio([v], '')}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Hot Topics Tab */}
      {subTab === 'topics' && (
        <section className="bg-white dark:bg-[#001722] border border-slate-200/80 dark:border-[#00464A] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200/80 dark:border-[#00464A] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Bảng xếp hạng từ khóa &amp; đề tài hot (Douyin &amp; Weibo)
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-teal-200/70 tabular-nums">
              {displayedTopics.length} đề tài đang lên
            </span>
          </div>

          {displayedTopics.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-teal-200/70">
              {isLoading ? 'Đang tải bảng xếp hạng đề tài hot...' : 'Chưa có đề tài hot phù hợp.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-200/70 dark:divide-[#00464A]/70">
              {displayedTopics.map((topic) => (
                <div
                  key={topic.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-[#000A10]/60 transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <span
                      className={`w-7 text-center font-mono text-sm font-bold tabular-nums shrink-0 ${
                        topic.rank <= 3 ? 'text-amber-500' : 'text-slate-400 dark:text-teal-200/60'
                      }`}
                    >
                      #{topic.rank}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#003B3E] dark:text-[#1BA8AD] shrink-0">
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

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right font-mono tabular-nums text-xs text-slate-600 dark:text-teal-100/80">
                      <div className="inline-flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5 text-amber-500" />
                        <span>{formatCompactCount(topic.hotValue)}</span>
                      </div>
                      {topic.videoCount && topic.videoCount > 0 ? (
                        <div className="text-[11px] text-slate-400 dark:text-teal-200/60 inline-flex items-center gap-1 ml-3">
                          <Clock className="w-3 h-3" />
                          <span>{topic.videoCount} video</span>
                        </div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => onSearchTopic(topic.title)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#003B3E] dark:text-[#1BA8AD] bg-[#003B3E]/10 dark:bg-[#000A10] border border-[#003B3E]/25 dark:border-[#00464A] rounded-lg hover:bg-[#003B3E]/20 cursor-pointer whitespace-nowrap"
                    >
                      <Search className="w-3 h-3" />
                      <span>Tìm video</span>
                    </button>

                    <a
                      href={topic.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg border border-slate-200 dark:border-[#00464A] text-slate-500 dark:text-teal-200/70 hover:text-[#003B3E] dark:hover:text-white"
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
    </div>
  );
};
