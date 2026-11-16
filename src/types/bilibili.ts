export type OutputFormat = 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a';

export type WatermarkMode =
  | 'auto'
  | 'none'
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export type LogoPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left'
  | 'center';

export interface CustomLogoConfig {
  enabled: boolean;
  dataUrl?: string; // base64 data url of logo image
  fileName?: string;
  position: LogoPosition;
  scalePercent: number; // 10, 15, 20, 25 % of video width
  opacity: number; // 0.2 to 1.0
  margin: number; // px from edge
}

export type MirrorMode = 'none' | 'horizontal' | 'vertical';

export interface VideoTransformConfig {
  speed: number; // 0.5 to 2.0 (1.0 = normal)
  mirror: MirrorMode;
  zoomPercent: number; // 50 to 150 (100 = normal)
}

export interface QualityOption {
  qn: number;
  label: string;
}

export type JobStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'error';

export type VideoPlatform =
  | 'bilibili'
  | 'youtube'
  | 'tiktok'
  | 'douyin'
  | 'kuaishou'
  | 'xiaohongshu'
  | 'weibo'
  | 'xigua'
  | 'dailymotion'
  | 'other';

export type TrendingPlatformId =
  | 'all'
  | 'youtube'
  | 'tiktok'
  | 'douyin'
  | 'bilibili'
  | 'kuaishou'
  | 'xiaohongshu'
  | 'weibo'
  | 'xigua'
  | 'dailymotion';

export type TrendingDurationFilter = 'all' | 'short' | 'medium' | 'long';
export type TrendingOrientationFilter = 'all' | 'vertical' | 'horizontal';
export type TrendingSortOption = 'best' | 'rising' | 'views' | 'engagement' | 'newest';
export type SearchSortOption = 'relevance' | 'views' | 'newest' | 'engagement';

export interface SearchApiResponse {
  query: string;
  videos: TrendingVideoItem[];
  platformStatuses: TrendingPlatformStatus[];
  updatedAt: number;
  fromCache?: boolean;
}

export interface TrendingVideoItem {
  id: string;
  platform: VideoPlatform;
  platformLabel: string;
  title: string;
  translatedTitle?: string;
  author: string;
  pic: string;
  sourceUrl: string;
  duration: number; // seconds
  views: number;
  likes?: number;
  comments?: number;
  pubdate?: number; // unix seconds
  publishedText?: string;
  score: number; // 0-99 composite trend score
  velocityPerHour?: number;
  category: string;
  categoryLabel: string;
  orientation: 'vertical' | 'horizontal' | 'unknown';
  rank?: number;
}

export interface TrendingTopicItem {
  id: string;
  platform: VideoPlatform;
  platformLabel: string;
  rank: number;
  title: string;
  translatedTitle?: string;
  hotValue: number;
  videoCount?: number;
  tag?: string;
  pic?: string;
  url: string;
  eventTime?: number;
}

export interface TrendingPlatformStatus {
  platform: TrendingPlatformId;
  label: string;
  status: 'ok' | 'partial' | 'cookie_required' | 'unavailable';
  count: number;
  message?: string;
  exploreUrl: string;
}

export interface TrendingApiResponse {
  videos: TrendingVideoItem[];
  topics: TrendingTopicItem[];
  platformStatuses: TrendingPlatformStatus[];
  updatedAt: number;
  fromCache?: boolean;
}

export const TRENDING_PLATFORMS: {
  id: TrendingPlatformId;
  label: string;
  exploreUrl: string;
}[] = [
  { id: 'all', label: 'Tất cả', exploreUrl: '' },
  { id: 'youtube', label: 'YouTube', exploreUrl: 'https://www.youtube.com' },
  { id: 'tiktok', label: 'TikTok', exploreUrl: 'https://www.tiktok.com/explore' },
  { id: 'douyin', label: 'Douyin', exploreUrl: 'https://www.douyin.com/hot' },
  { id: 'bilibili', label: 'Bilibili', exploreUrl: 'https://www.bilibili.com/v/popular/all' },
  { id: 'kuaishou', label: 'Kuaishou', exploreUrl: 'https://www.kuaishou.com/brilliant' },
  { id: 'xiaohongshu', label: 'Xiaohongshu', exploreUrl: 'https://www.xiaohongshu.com/explore' },
  { id: 'weibo', label: 'Weibo', exploreUrl: 'https://weibo.com/hot/search' },
  { id: 'xigua', label: 'Xigua', exploreUrl: 'https://www.ixigua.com' },
  { id: 'dailymotion', label: 'Dailymotion', exploreUrl: 'https://www.dailymotion.com' },
];

export const TRENDING_CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: 'Đang hot' },
  { id: 'knowledge', label: 'Kiến thức' },
  { id: 'shortfilm', label: 'Phim ngắn' },
  { id: 'food', label: 'Ẩm thực' },
  { id: 'pets', label: 'Thú cưng' },
  { id: 'rural', label: 'Nông thôn' },
  { id: 'travel', label: 'Du lịch' },
  { id: 'auto', label: 'Ô tô' },
  { id: 'tech', label: 'Công nghệ' },
  { id: 'ai', label: 'AI' },
  { id: 'entertainment', label: 'Giải trí' },
  { id: 'sports', label: 'Thể thao' },
  { id: 'diy', label: 'Thủ công' },
  { id: 'vlog', label: 'Vlog' },
  { id: 'gaming', label: 'Game' },
  { id: 'anime', label: 'Anime' },
  { id: 'music', label: 'Âm nhạc' },
  { id: 'comedy', label: 'Chế / Hài' },
  { id: 'dance', label: 'Nhảy' },
];

export interface QueueVideoItem {
  id: string;
  platform?: VideoPlatform;
  bvid: string;
  aid: number;
  cid: number;
  page: number;
  totalPages: number;
  title: string;
  partTitle: string;
  author: string;
  duration: number; // seconds
  views?: number;
  pubdate?: number; // unix seconds
  pic: string;
  sourceUrl: string;
  availableQualities: QualityOption[];
  selectedQn: number; // 0 = auto best
  selectedFormat: OutputFormat;
  selectedWatermark: WatermarkMode;
  selected: boolean;
  // Runtime job state
  jobId?: string;
  status: JobStatus;
  progress: number; // 0 - 100
  speedBytesPerSec?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  fileSize?: number;
  fileName?: string;
  savedToDisk?: boolean;
  saveError?: string;
  error?: string;
}

export interface InspectError {
  url: string;
  message: string;
}

export const WATERMARK_PRESETS: { value: WatermarkMode; label: string }[] = [
  { value: 'auto', label: 'Tự động phát hiện & xóa' },
  { value: 'none', label: 'Giữ nguyên gốc' },
  { value: 'top-right', label: 'Xóa góc trên phải' },
  { value: 'top-left', label: 'Xóa góc trên trái' },
  { value: 'bottom-right', label: 'Xóa góc dưới phải' },
  { value: 'bottom-left', label: 'Xóa góc dưới trái' },
];

export const RESOLUTION_PRESETS: QualityOption[] = [
  { qn: 0, label: 'Tốt nhất (Auto)' },
  { qn: 120, label: '4K (2160P)' },
  { qn: 116, label: '1080P60' },
  { qn: 112, label: '1080P+' },
  { qn: 80, label: '1080P' },
  { qn: 64, label: '720P' },
  { qn: 32, label: '480P' },
  { qn: 16, label: '360P' },
];

export const OUTPUT_FORMATS: { value: OutputFormat; label: string; desc: string }[] = [
  { value: 'mp4', label: 'MP4', desc: 'H.264 / AAC · Phổ biến nhất' },
  { value: 'mkv', label: 'MKV', desc: 'Matroska · Giữ nguyên chất lượng' },
  { value: 'webm', label: 'WEBM', desc: 'VP9 / Opus · Tối ưu web' },
  { value: 'mp3', label: 'MP3', desc: 'Chỉ âm thanh · 320 kbps' },
  { value: 'm4a', label: 'M4A', desc: 'Chỉ âm thanh · AAC gốc' },
];
