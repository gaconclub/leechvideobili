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
  | 'facebook'
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

export type StudioCreationMode = 'creative' | 'derivative';
export type StudioScriptMode = 'series' | 'independent_batch';
export type StudioVideoStyle =
  | 'professional'
  | 'cinematic'
  | 'anime'
  | 'stickman'
  | '3d_animation'
  | 'documentary'
  | 'comic'
  | 'vlog';

export type DerivativeVisualMode = 'remix' | 'storyboard_motion' | 'gemini_omni' | 'muse2api_video';
export type DerivativeStylePreset = 'none' | 'summary_fast' | 'storytelling_review' | 'top_list' | 'tips_tutorial';
export type DerivativeVoiceId = 'none' | 'Kore' | 'Puck' | 'Zephyr' | 'Charon' | 'Fenrir';
export type DerivativeVoiceMode = 'ai_online' | 'offline_system' | 'none';
export type DerivativeMusicMode = 'none' | 'ai_lyria' | 'public_free' | 'uploaded';
export type DerivativeAspectRatio = '9:16' | '16:9' | '1:1';
export type DerivativeOutputLanguage = 'vi' | 'en' | 'zh' | 'vi_en';

export type AiProviderId = 'gemini' | 'openai' | 'meta' | 'muse2api';
export type BrollSourceId = 'wikimedia' | 'auto' | 'pexels' | 'pixabay' | 'none';

export type CookieSiteId =
  | 'youtube'
  | 'tiktok'
  | 'bilibili'
  | 'douyin'
  | 'kuaishou'
  | 'xiaohongshu'
  | 'weibo'
  | 'xigua'
  | 'facebook'
  | 'muse'
  | 'other';

export type PerSiteCookies = Record<CookieSiteId, string>;

export interface OfflineTtsVoiceOption {
  id: string;
  description: string;
}

export interface StudioDefaultConfig {
  aiProvider: AiProviderId;
  brollSource: BrollSourceId;
  stylePreset: DerivativeStylePreset;
  aspectRatioMode: 'auto' | DerivativeAspectRatio;
  targetDurationSec: number; // 10 to 900 seconds (supports 10s up to 15 min)
  visualMode: DerivativeVisualMode;
  voice: DerivativeVoiceId;
  offlineVoice?: string;
  keepSourceAudio: boolean;
}

export interface StudioUploadedAsset {
  assetId: string;
  fileName: string;
  fileSize: number;
  durationSec: number;
  resolution: string;
  keyframes: string[]; // base64 data URLs of extracted frames
  previewUrl: string;
  hasAudio: boolean;
}

export interface StudioCharacterRef {
  id: string;
  name: string;
  dataUrl: string;
  description?: string;
  source: 'uploaded' | 'ai_generated';
}

export interface StudioMusicTrack {
  id: string;
  title: string;
  source: 'ai_lyria' | 'wikimedia' | 'uploaded';
  url?: string;
  assetId?: string;
  durationSec?: number;
  mimeType?: string;
  lyrics?: string;
}

export interface StudioProjectProfile {
  id: string;
  name: string;
  description?: string;
  videoStyle: StudioVideoStyle;
  characterBible: string;
  settingBible: string;
  visualStyleBible: string;
  costumeBible: string;
  continuityBible: string;
  characterRefs: StudioCharacterRef[];
  updatedAt: number;
}

export interface StudioLibraryVideoItem {
  id: string;
  kind: 'uploaded' | 'rendered';
  title: string;
  durationSec: number;
  resolution: string;
  previewUrl: string;
  localAssetId?: string;
  jobId?: string;
  keyframes?: string[];
  hasAudio?: boolean;
  createdAt: number;
}

export interface ServerCapabilitiesStatus {
  aiProviders: {
    gemini: { configured: boolean; model: string; ttsModel: string; source: 'env' | 'none' };
    openai: { configured: boolean; model: string; source: 'env' | 'none' };
    meta: { configured: boolean; model: string; baseUrl: string; source: 'env' | 'none' };
    muse2api: {
      configured: boolean;
      reachable: boolean;
      status: 'ready' | 'no_account' | 'auth_error' | 'offline';
      model: string;
      baseUrl: string;
      accountsCount: number;
      healthyAccounts: number;
      source: 'env' | 'local_dotenv' | 'none';
    };
  };
  paidModels: {
    omniVideoModel: string;
    muse2apiImageModel: string;
    muse2apiVideoModel: string;
    imageModel: string;
    imageProModel: string;
    musicClipModel: string;
    musicProModel: string;
    proScriptModel: string;
  };
  brollProviders: {
    wikimedia: { configured: boolean; freeNoKey: boolean };
    pexels: { configured: boolean };
    pixabay: { configured: boolean };
  };
  localTools: {
    ffmpeg: { available: boolean; version: string };
    ytDlp: { available: boolean; version: string };
    node: { available: boolean; version: string };
    offlineTts: {
      available: boolean;
      engine: string;
      engineId?: 'vieneu' | 'win_sapi' | 'macos_say' | 'espeak';
    };
  };
}

export interface ReferenceVideoAnalysis {
  mainTheme: string;
  plotProgression: string;
  characterTraits: string;
  settingAndSpace: string;
  visualStyle: string;
  cameraAndMovement: string;
  lightingAndColor: string;
  editingPacing: string;
  dialogueAndAudio: string;
}

export interface DerivativeScene {
  id: string;
  sceneIndex: number; // Scene 01, Scene 02...
  sceneTitle?: string; // Tên phân cảnh ngắn gọn
  sceneSummary?: string; // Mô tả nội dung / diễn biến chính
  durationSec: number;
  sourceVideoIndex: number;
  sourceStartPercent: number;
  onScreenText: string; // Chữ phụ đề trên khung hình
  charactersInScene?: string; // Nhân vật xuất hiện trong cảnh
  settingDetail?: string; // Bối cảnh: không gian, địa điểm, thời gian
  actionDetail?: string; // Hành động và diễn biến cụ thể
  cameraAngle?: string; // Góc máy: Cận cảnh, trung cảnh, toàn cảnh, góc thấp, góc cao...
  lighting?: string; // Ánh sáng: tự nhiên, điện ảnh, ngược sáng...
  costume?: string; // Trang phục cụ thể của nhân vật
  cameraMovement?: string; // Kiểu quay: Tracking shot, dolly, handheld, crane...
  shotStyle?: string; // Phong cách quay: Điện ảnh, tài liệu, anime, quảng cáo...
  dialogue?: string; // Lời thoại nhân vật nói
  narration: string; // Lồng tiếng / thuyết minh hoặc giọng dẫn (rỗng khi tắt lồng tiếng)
  imagePrompt?: string; // Prompt hình ảnh chi tiết đồng bộ
  videoPrompt?: string; // Prompt video chi tiết hành động & chuyển động đồng bộ
  continuityNote?: string; // Mạch liên kết từ trạng thái cuối cảnh trước
  sceneEndState?: string; // Trạng thái cuối cảnh này để nối tiếp sang cảnh sau
  visualNote?: string; // Alias tương thích ngược cho imagePrompt
  brollKeywordEn?: string;
  sceneImageDataUrl?: string;
  omniClipAssetId?: string;
  omniClipPreviewUrl?: string;
}

export interface DerivativeSourceInsight {
  index: number;
  title: string;
  platformLabel: string;
  author: string;
  hasDescription: boolean;
  hasCaptions: boolean;
  hasThumbnail: boolean;
  keyPoint: string;
}

export interface DerivativeBlueprint {
  mode?: StudioCreationMode;
  scriptMode?: StudioScriptMode;
  batchIndex?: number;
  batchTotal?: number;
  sharedSpiritNote?: string;
  targetDurationSec?: number;
  ideaPrompt?: string;
  videoStyle?: StudioVideoStyle;
  // 5-part Synchronization Bible (Section 2.6)
  characterBible?: string; // Character Reference
  settingBible?: string; // Environment Reference
  visualStyleBible?: string; // Visual Style Reference
  costumeBible?: string; // Costume Reference
  continuityBible?: string; // Story Continuity
  enableVoiceover?: boolean;
  referenceAnalysis?: ReferenceVideoAnalysis;
  learnedSummary: string;
  keyTakeaways: string[];
  hookFormula: string;
  derivativeTitle: string;
  derivativeHook: string;
  hashtags: string[];
  aspectRatio: DerivativeAspectRatio;
  sourcesAnalyzed: DerivativeSourceInsight[];
  scenes: DerivativeScene[];
  usedProvider?: AiProviderId;
  usedModel?: string;
}

export interface DerivativeJobState {
  jobId: string;
  status: 'queued' | 'learning' | 'downloading' | 'tts' | 'rendering' | 'completed' | 'error';
  progress: number;
  stepLabel: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  resolution?: string;
  error?: string;
  warnings?: string[];
}
