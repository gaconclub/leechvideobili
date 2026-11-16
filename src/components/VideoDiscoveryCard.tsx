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
    url.includes('ttwstatic.com')
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
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#002430] to-[#001018] text-teal-200/70 select-none p-3">
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
}) => {
  const translated = translatedTitle || video.translatedTitle;
  const displayTitle = translated || video.title;
  const ageText = formatRelativeAge(video.pubdate, video.publishedText);

  return (
    <article
      className={`group flex flex-col bg-white dark:bg-[#001722] border rounded-xl overflow-hidden transition-all duration-150 ${
        isSelected
          ? 'border-[#003B3E] dark:border-[#1BA8AD] ring-2 ring-[#003B3E]/25'
          : 'border-slate-200/85 dark:border-[#00464A] hover:border-[#003B3E]/60 dark:hover:border-[#1BA8AD]/60'
      }`}
    >
      <div className="relative aspect-video bg-slate-900 overflow-hidden">
        <ThumbnailImg src={video.pic} alt={video.title} platformLabel={video.platformLabel} />

        <button
          type="button"
          onClick={() => onToggleSelect(video.id)}
          aria-label={`Chọn ${video.title}`}
          className="absolute top-2 left-2 w-6 h-6 rounded-md bg-slate-950/65 hover:bg-slate-950/90 text-white flex items-center justify-center backdrop-blur-xs cursor-pointer transition-colors"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-[#1BA8AD]" />
          ) : (
            <Square className="w-4 h-4 text-white/80" />
          )}
        </button>

        <span
          title="Chỉ số xu hướng tổng hợp"
          className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[11px] font-bold font-mono tabular-nums shadow-xs"
        >
          {video.score}
        </span>

        <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-slate-950/75 text-white text-[10px] font-semibold tracking-wide backdrop-blur-xs">
          {video.platformLabel}
        </span>

        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-slate-950/80 text-white text-[11px] font-mono tabular-nums backdrop-blur-xs">
          {video.duration > 0
            ? formatDuration(video.duration)
            : video.orientation === 'vertical'
            ? 'Ngắn'
            : 'HD'}
        </span>
      </div>

      <div className="flex-1 flex flex-col p-3.5 gap-2">
        <div className="space-y-1">
          <h3
            title={displayTitle}
            className="text-[13px] font-semibold leading-snug text-slate-900 dark:text-white line-clamp-2"
          >
            {displayTitle}
          </h3>
          {translated && translated !== video.title && (
            <p
              title={video.title}
              className="text-[11px] text-[#003B3E] dark:text-[#1BA8AD] line-clamp-1"
            >
              {video.title}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono tabular-nums text-slate-600 dark:text-teal-100/85">
          <span className="inline-flex items-center gap-1">
            <Eye className="w-3 h-3 text-slate-400 dark:text-teal-200/60" />
            {formatCompactCount(video.views)}
          </span>
          {video.likes && video.likes > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Heart className="w-3 h-3 text-slate-400 dark:text-teal-200/60" />
              {formatCompactCount(video.likes)}
            </span>
          ) : null}
          {video.velocityPerHour && video.velocityPerHour > 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <TrendingUp className="w-3 h-3" />
              {formatCompactCount(video.velocityPerHour)}/giờ
            </span>
          ) : null}
        </div>

        <p className="text-[11px] text-slate-500 dark:text-teal-200/65 truncate mt-auto">
          {video.categoryLabel} · {video.author} ·{' '}
          {video.orientation === 'vertical' ? 'Dọc' : 'Ngang'}
          {ageText ? ` · ${ageText}` : ''}
        </p>

        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => onAddSingle(video, true)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              isQueued
                ? 'bg-[#003B3E]/15 dark:bg-[#003B3E]/60 text-[#003B3E] dark:text-[#1BA8AD] border border-[#003B3E]/30 dark:border-[#1BA8AD]/40'
                : 'bg-[#003B3E] hover:bg-[#002729] dark:hover:bg-[#004E52] text-white'
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

          <button
            type="button"
            onClick={() => onAddSingle(video, false)}
            title="Thêm vào hàng đợi (chưa tải ngay)"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-[#00464A] text-slate-600 dark:text-teal-100 hover:bg-slate-100 dark:hover:bg-[#000A10] hover:text-[#003B3E] dark:hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onToggleBookmark(video)}
            title={isSaved ? 'Bỏ lưu' : 'Lưu video này'}
            className={`w-8 h-8 inline-flex items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0 ${
              isSaved
                ? 'border-amber-400/60 bg-amber-400/10 text-amber-500'
                : 'border-slate-200 dark:border-[#00464A] text-slate-500 dark:text-teal-200/70 hover:text-amber-500'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
          </button>

          <a
            href={video.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Mở video gốc"
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-[#00464A] text-slate-500 dark:text-teal-200/70 hover:text-[#003B3E] dark:hover:text-white transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
};
