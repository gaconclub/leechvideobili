import React, { useState, useEffect } from 'react';
import {
  Eye,
  Heart,
  TrendingUp,
  Download,
  Plus,
  Star,
  ExternalLink,
  Check,
  Film,
  CheckSquare,
  Square,
  Sparkles,
} from 'lucide-react';
import { TrendingVideoItem } from '../types/bilibili';
import { formatCompactCount, formatDuration, formatRelativeAge } from '../utils/formatters';

function needsImageProxy(url: string): boolean {
  return (
    url.includes('hdslb.com') ||
    url.includes('bilibili.com') ||
    url.includes('douyinpic.com') ||
    url.includes('byteimg.com') ||
    url.includes('yximgs.com') ||
    url.includes('kwimgs.com') ||
    url.includes('sinaimg.cn') ||
    url.includes('xhscdn.com') ||
    url.includes('tiktokcdn') ||
    url.includes('tiktokv.com') ||
    url.includes('ttwstatic.com') ||
    url.includes('fbcdn.net') ||
    url.includes('fbsbx.com')
  );
}

export function getDiscoveryThumbUrl(url: string): string {
  if (!url) return '';
  if (needsImageProxy(url)) {
    return `/api/bilibili/proxy-image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export const ThumbnailImg: React.FC<{ src: string; alt: string; platformLabel: string }> = ({
  src,
  alt,
  platformLabel,
}) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#171d3b] to-[#0c1021] text-cyan-200/75 select-none p-3">
        <Film className="w-7 h-7 mb-1.5 opacity-75" />
        <span className="text-[11px] font-medium tracking-wide uppercase opacity-80">{platformLabel}</span>
      </div>
    );
  }

  return (
    <img
      src={getDiscoveryThumbUrl(src)}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
};

interface VideoDiscoveryCardProps {
  video: TrendingVideoItem;
  isSelected: boolean;
  isSaved: boolean;
  isQueued: boolean;
  translatedTitle?: string;
  onToggleSelect: (id: string) => void;
  onToggleBookmark: (video: TrendingVideoItem) => void;
  onAddSingle: (video: TrendingVideoItem, startImmediately: boolean) => void;
  onCreateDerivative?: (video: TrendingVideoItem) => void;
}

export const VideoDiscoveryCard: React.FC<VideoDiscoveryCardProps> = ({
  video,
  isSelected,
  isSaved,
  isQueued,
  translatedTitle,
  onToggleSelect,
  onToggleBookmark,
  onAddSingle,
  onCreateDerivative,
}) => {
  const translated = translatedTitle || video.translatedTitle;
  const displayTitle = translated || video.title;
  const ageText = formatRelativeAge(video.pubdate, video.publishedText);

  return (
    <article
      className={`group glass-card rounded-2xl p-3 flex flex-col justify-between gap-2.5 transition-all duration-150 ${
        isSelected
          ? 'border-cyan-500/80 dark:border-cyan-400/70 ring-2 ring-cyan-400/20'
          : 'hover:border-violet-400/45'
      }`}
    >
      <div className="space-y-2">
        <div className="relative rounded-xl overflow-hidden bg-slate-900 dark:bg-[#0c1021] aspect-video">
          <ThumbnailImg src={video.pic} alt={video.title} platformLabel={video.platformLabel} />

          <button
            type="button"
            onClick={() => onToggleSelect(video.id)}
            aria-label={`Chọn ${video.title}`}
            className="absolute top-2 left-2 w-6 h-6 rounded-md bg-slate-950/75 hover:bg-slate-950 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer transition-colors"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-cyan-400" />
            ) : (
              <Square className="w-4 h-4 text-white/85" />
            )}
          </button>

          <span
            title="Chỉ số xu hướng tổng hợp"
            className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[11px] font-extrabold font-mono tabular-nums shadow-xs"
          >
            {video.score}
          </span>

          <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-slate-950/85 text-cyan-300 text-[10px] font-semibold tracking-wide">
            {video.platformLabel}
          </span>

          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-slate-950/85 text-white text-[10px] font-semibold font-mono tabular-nums">
            {video.duration > 0
              ? formatDuration(video.duration)
              : video.orientation === 'vertical'
              ? 'Ngắn'
              : 'HD'}
          </span>
        </div>

        <div className="space-y-0.5">
          <h3
            title={displayTitle}
            className="text-xs font-semibold leading-snug text-slate-900 dark:text-white line-clamp-2"
          >
            {displayTitle}
          </h3>
          {translated && translated !== video.title && (
            <p
              title={video.title}
              className="text-[11px] text-cyan-700 dark:text-cyan-300 line-clamp-1"
            >
              {video.title}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1">
            <Eye className="w-3 h-3 text-slate-400" />
            {formatCompactCount(video.views)}
          </span>
          {video.likes && video.likes > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Heart className="w-3 h-3 text-rose-400" />
              {formatCompactCount(video.likes)}
            </span>
          ) : null}
        </div>

        {video.velocityPerHour && video.velocityPerHour > 0 ? (
          <div className="text-[10px] text-emerald-600 dark:text-emerald-300 font-medium inline-flex items-center gap-1 font-mono tabular-nums">
            <TrendingUp className="w-3 h-3 shrink-0" />
            <span>{formatCompactCount(video.velocityPerHour)}/giờ</span>
          </div>
        ) : null}

        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
          {video.categoryLabel} · {video.author} · {video.orientation === 'vertical' ? 'Dọc' : 'Ngang'}
          {ageText ? ` · ${ageText}` : ''}
        </p>
      </div>

      <div className="flex items-center gap-1.5 pt-1 text-xs">
        <button
          type="button"
          onClick={() => onAddSingle(video, true)}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl font-semibold transition whitespace-nowrap cursor-pointer ${
            isQueued
              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-400/35'
              : 'bg-slate-100 dark:bg-white/5 hover:bg-emerald-500 hover:text-slate-950 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-white'
          }`}
        >
          {isQueued ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Đã thêm</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5" />
              <span>Tải ngay</span>
            </>
          )}
        </button>

        {onCreateDerivative ? (
          <button
            type="button"
            onClick={() => onCreateDerivative(video)}
            title="Đưa vào Studio phái sinh"
            className="px-2.5 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/30 border border-violet-400/35 text-violet-700 dark:text-violet-200 font-bold transition cursor-pointer shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAddSingle(video, false)}
            title="Thêm vào hàng đợi"
            className="px-2.5 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/30 border border-violet-400/35 text-violet-700 dark:text-violet-200 font-bold transition cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => onToggleBookmark(video)}
          title={isSaved ? 'Bỏ lưu' : 'Lưu video này'}
          className={`px-2.5 py-1.5 rounded-xl border transition cursor-pointer shrink-0 ${
            isSaved
              ? 'bg-amber-400/25 text-amber-600 dark:text-amber-300 border-amber-400/40'
              : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:text-amber-500'
          }`}
        >
          <Star className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
        </button>

        <a
          href={video.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Mở video gốc"
          className="px-2 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-300 transition shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </article>
  );
};
