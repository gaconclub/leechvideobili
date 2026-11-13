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

export type VideoPlatform = 'bilibili' | 'youtube';

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
