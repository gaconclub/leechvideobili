import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { VideoPlatform } from './trending';

export type DerivativeVisualMode = 'remix' | 'storyboard_motion' | 'gemini_omni';
export type DerivativeStylePreset = 'summary_fast' | 'storytelling_review' | 'top_list' | 'tips_tutorial';
export type DerivativeVoiceId = 'none' | 'Kore' | 'Puck' | 'Zephyr' | 'Charon' | 'Fenrir';
export type DerivativeVoiceMode = 'ai_online' | 'offline_system' | 'none';
export type DerivativeMusicMode = 'none' | 'ai_lyria' | 'public_free' | 'uploaded';
export type DerivativeAspectRatio = '9:16' | '16:9';
export type DerivativeOutputLanguage = 'vi' | 'en' | 'zh' | 'vi_en';
export type AiProviderId = 'gemini' | 'openai' | 'meta' | 'muse';
export type BrollSourceId = 'wikimedia' | 'auto' | 'pexels' | 'pixabay' | 'none';

export interface DerivativeSourceInput {
  id: string;
  platform: VideoPlatform;
  platformLabel: string;
  title: string;
  translatedTitle?: string;
  author: string;
  pic: string;
  sourceUrl: string;
  duration: number;
  views: number;
  likes?: number;
  categoryLabel?: string;
  localAssetId?: string;
  keyframes?: string[];
  hasAudio?: boolean;
}

export interface DerivativeScene {
  id: string;
  sceneIndex: number;
  durationSec: number;
  sourceVideoIndex: number;
  sourceStartPercent: number;
  onScreenText: string;
  narration: string;
  visualNote?: string;
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

export interface DerivativeJobRecord {
  jobId: string;
  status: 'queued' | 'learning' | 'downloading' | 'tts' | 'rendering' | 'completed' | 'error';
  progress: number;
  stepLabel: string;
  workDir: string;
  outputPath?: string;
  fileName?: string;
  fileSize?: number;
  durationSec?: number;
  resolution?: string;
  error?: string;
  warnings: string[];
  createdAt: number;
}

export interface StudioAssetRecord {
  assetId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  durationSec: number;
  resolution?: string;
  hasAudio?: boolean;
  createdAt: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DERIVATIVE_BASE_DIR = path.join(os.tmpdir(), 'bili-downloads', 'derivative_jobs');
const STUDIO_ASSETS_DIR = path.join(os.tmpdir(), 'bili-downloads', 'studio_assets');
if (!fs.existsSync(DERIVATIVE_BASE_DIR)) {
  fs.mkdirSync(DERIVATIVE_BASE_DIR, { recursive: true });
}
if (!fs.existsSync(STUDIO_ASSETS_DIR)) {
  fs.mkdirSync(STUDIO_ASSETS_DIR, { recursive: true });
}

export const derivativeJobs = new Map<string, DerivativeJobRecord>();
export const studioAssets = new Map<string, StudioAssetRecord>();

// Periodic cleanup of expired derivative job folders & temporary studio assets (> 2 hours old)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of derivativeJobs.entries()) {
    if (job.createdAt < cutoff && job.status !== 'downloading' && job.status !== 'rendering' && job.status !== 'tts') {
      try {
        fs.rmSync(job.workDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      derivativeJobs.delete(id);
    }
  }
  const assetCutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [assetId, rec] of studioAssets.entries()) {
    if (rec.createdAt < assetCutoff) {
      try {
        if (fs.existsSync(rec.filePath)) fs.unlinkSync(rec.filePath);
      } catch {
        // ignore
      }
      studioAssets.delete(assetId);
    }
  }
}, 15 * 60 * 1000).unref();

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Chưa phát hiện GEMINI_API_KEY trên máy chủ. Hãy thêm GEMINI_API_KEY trong bảng Settings > Secrets (hoặc tệp .env trên máy) để dùng tính năng AI học & tạo video phái sinh.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientGemini503Error(err: any): boolean {
  const raw = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status ?? err?.code ?? 0);
  if (status === 503 || status === 502 || status === 504) return true;
  return (
    raw.includes('503') ||
    raw.includes('unavailable') ||
    raw.includes('high demand') ||
    raw.includes('overloaded') ||
    raw.includes('502') ||
    raw.includes('504') ||
    raw.includes('econnreset') ||
    raw.includes('etimedout') ||
    raw.includes('fetch failed')
  );
}

function isGeminiRateLimit429Error(err: any): boolean {
  const raw = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status ?? err?.code ?? 0);
  return status === 429 || raw.includes('429') || raw.includes('resource_exhausted');
}

function shouldFallbackGeminiModel(err: any): boolean {
  return isTransientGemini503Error(err) || isGeminiRateLimit429Error(err);
}

async function retryWithGeminiBackoff<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [1500, 3200, 5500]
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt < delaysMs.length && isTransientGemini503Error(err)) {
        const jitter = Math.floor(Math.random() * 450);
        await new Promise((r) => setTimeout(r, delaysMs[attempt] + jitter));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function formatGeminiError(err: any): string {
  const raw = String(err?.message || err || 'Lỗi kết nối Gemini AI');
  if (raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID') || raw.includes('403') || raw.includes('API key not valid')) {
    return 'API Key Gemini không hợp lệ hoặc mô hình này yêu cầu API Key trả phí (có thanh toán). Vui lòng kiểm tra khóa trong Settings > Secrets hoặc tệp .env.';
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'Đã chạm giới hạn tần suất / hạn mức gói miễn phí Gemini API (429). Nếu dùng mô hình nâng cao (Omni Flash, Lyria, tạo ảnh), hãy dùng API Key có bật thanh toán trong Settings > Secrets hoặc thử lại sau.';
  }
  if (isTransientGemini503Error(err) || raw.includes('truy cập cao tạm thời')) {
    return 'Máy chủ Gemini đang có lượng truy cập cao tạm thời (503) trên cả mô hình chính và dự phòng. Hệ thống đã tự thử lại nhưng chưa thành công — bạn vui lòng đợi vài giây rồi bấm thử lại hoặc chuyển sang Muse AI / nhà cung cấp khác.';
  }
  if (raw.includes('NOT_FOUND') || raw.includes('404')) {
    return `Mô hình AI tạm không khả dụng (${raw}). Vui lòng thử lại.`;
  }
  return raw;
}

export function getStudioAsset(assetId: string): StudioAssetRecord | undefined {
  const rec = studioAssets.get(assetId);
  if (!rec || !fs.existsSync(rec.filePath)) return undefined;
  return rec;
}

interface StudioChunkSession {
  uploadId: string;
  assetId: string;
  kind: 'video' | 'audio';
  originalName: string;
  filePath: string;
  receivedBytes: number;
  createdAt: number;
}

const studioUploadSessions = new Map<string, StudioChunkSession>();

function cleanupExpiredStudioUploadSessions(): void {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, sess] of studioUploadSessions.entries()) {
    if (sess.createdAt < cutoff) {
      studioUploadSessions.delete(id);
      try {
        if (fs.existsSync(sess.filePath)) fs.unlinkSync(sess.filePath);
      } catch {
        // ignore
      }
    }
  }
}

function extWhitelist(ext: string): string {
  return ext.replace(/[^a-z0-9.]/gi, '');
}

function normalizeVideoExt(originalName: string): string {
  const safeExt = path.extname(originalName || '').toLowerCase() || '.mp4';
  return ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'].includes(extWhitelist(safeExt))
    ? extWhitelist(safeExt)
    : '.mp4';
}

function normalizeAudioExt(originalName: string): string {
  const rawExt = path.extname(originalName || '').toLowerCase();
  return ['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac'].includes(rawExt) ? rawExt : '.mp3';
}

async function finalizeUploadedStudioVideoFile(
  filePath: string,
  originalName: string,
  assetId: string,
  fileSize?: number
) {
  const ext = normalizeVideoExt(originalName);
  const actualSize = typeof fileSize === 'number' ? fileSize : fs.statSync(filePath).size;

  const durationSec = Math.max(0, await probeDurationSeconds(filePath, STUDIO_ASSETS_DIR));
  const dimsRes = await spawnPromise(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', filePath],
    STUDIO_ASSETS_DIR,
    10_000
  ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  const resolution = dimsRes.code === 0 && dimsRes.stdout.trim() ? dimsRes.stdout.trim() : 'unknown';

  const audioCheck = await spawnPromise(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
    STUDIO_ASSETS_DIR,
    10_000
  ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
  const hasAudio = audioCheck.code === 0 && audioCheck.stdout.trim().length > 0;

  // Extract up to 3 keyframes across the uploaded video
  const keyframes: string[] = [];
  const sampleFractions = durationSec >= 6 ? [0.15, 0.5, 0.82] : [0.2, 0.65];
  for (let i = 0; i < sampleFractions.length; i += 1) {
    const seekSec = Math.max(0.1, durationSec * sampleFractions[i]);
    const frameOut = path.join(STUDIO_ASSETS_DIR, `${assetId}_kf_${i}.jpg`);
    const frameRes = await spawnPromise(
      'ffmpeg',
      ['-y', '-ss', seekSec.toFixed(2), '-i', filePath, '-vframes', '1', '-vf', 'scale=640:-2', '-q:v', '4', frameOut],
      STUDIO_ASSETS_DIR,
      15_000
    ).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    if (frameRes.code === 0 && fs.existsSync(frameOut)) {
      const jpgBuf = fs.readFileSync(frameOut);
      if (jpgBuf.byteLength > 500) {
        keyframes.push(`data:image/jpeg;base64,${jpgBuf.toString('base64')}`);
      }
      try {
        fs.unlinkSync(frameOut);
      } catch {
        // ignore
      }
    }
  }

  const record: StudioAssetRecord = {
    assetId,
    filePath,
    fileName: originalName || `uploaded_${assetId}${ext}`,
    mimeType: ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4',
    durationSec: Math.round(durationSec * 10) / 10,
    resolution,
    hasAudio,
    createdAt: Date.now(),
  };
  studioAssets.set(assetId, record);

  return {
    assetId,
    fileName: record.fileName,
    fileSize: actualSize,
    durationSec: record.durationSec,
    resolution,
    keyframes,
    previewUrl: `/api/studio/assets/${assetId}`,
    hasAudio,
  };
}

async function finalizeUploadedStudioAudioFile(filePath: string, originalName: string, assetId: string) {
  const ext = normalizeAudioExt(originalName);
  const durationSec = Math.max(0, await probeDurationSeconds(filePath, STUDIO_ASSETS_DIR));
  const mimeMap: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
  };
  const record: StudioAssetRecord = {
    assetId,
    filePath,
    fileName: originalName || `audio_${assetId}${ext}`,
    mimeType: mimeMap[ext] || 'audio/mpeg',
    durationSec: Math.round(durationSec * 10) / 10,
    createdAt: Date.now(),
  };
  studioAssets.set(assetId, record);

  return {
    assetId,
    fileName: record.fileName,
    durationSec: record.durationSec,
    mimeType: record.mimeType,
    previewUrl: `/api/studio/assets/${assetId}`,
  };
}

export function initStudioChunkedUpload(kind: 'video' | 'audio', originalName: string) {
  cleanupExpiredStudioUploadSessions();
  const uploadId = `up_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const assetId = `${kind === 'video' ? 'vid' : 'aud'}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const ext = kind === 'video' ? normalizeVideoExt(originalName) : normalizeAudioExt(originalName);
  const filePath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
  fs.writeFileSync(filePath, Buffer.alloc(0));

  studioUploadSessions.set(uploadId, {
    uploadId,
    assetId,
    kind,
    originalName: originalName || (kind === 'video' ? `uploaded_${assetId}${ext}` : `audio_${assetId}${ext}`),
    filePath,
    receivedBytes: 0,
    createdAt: Date.now(),
  });

  return { uploadId, assetId };
}

export function appendStudioUploadChunk(uploadId: string, chunk: Buffer) {
  const sess = studioUploadSessions.get(uploadId);
  if (!sess) {
    throw new Error('Phiên tải lên không tồn tại hoặc đã hết hạn. Vui lòng thử tải lại.');
  }
  if (sess.receivedBytes + chunk.byteLength > 210 * 1024 * 1024) {
    studioUploadSessions.delete(uploadId);
    try {
      if (fs.existsSync(sess.filePath)) fs.unlinkSync(sess.filePath);
    } catch {
      // ignore
    }
    throw new Error('Dung lượng tệp vượt quá giới hạn 200MB.');
  }
  fs.appendFileSync(sess.filePath, chunk);
  sess.receivedBytes += chunk.byteLength;
  return { receivedBytes: sess.receivedBytes };
}

export async function completeStudioChunkedUpload(uploadId: string) {
  const sess = studioUploadSessions.get(uploadId);
  if (!sess) {
    throw new Error('Phiên tải lên không tồn tại hoặc đã hết hạn.');
  }
  studioUploadSessions.delete(uploadId);
  if (!fs.existsSync(sess.filePath) || sess.receivedBytes < 512) {
    try {
      if (fs.existsSync(sess.filePath)) fs.unlinkSync(sess.filePath);
    } catch {
      // ignore
    }
    throw new Error('Dữ liệu tệp tải lên bị rỗng hoặc chưa hoàn chỉnh.');
  }
  if (sess.kind === 'video') {
    return finalizeUploadedStudioVideoFile(sess.filePath, sess.originalName, sess.assetId, sess.receivedBytes);
  }
  return finalizeUploadedStudioAudioFile(sess.filePath, sess.originalName, sess.assetId);
}

export async function saveUploadedStudioVideo(buffer: Buffer, originalName: string) {
  const assetId = `vid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const ext = normalizeVideoExt(originalName);
  const filePath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return finalizeUploadedStudioVideoFile(filePath, originalName, assetId, buffer.byteLength);
}

export async function saveUploadedStudioAudio(buffer: Buffer, originalName: string) {
  const assetId = `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const ext = normalizeAudioExt(originalName);
  const filePath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return finalizeUploadedStudioAudioFile(filePath, originalName, assetId);
}

export async function saveUploadedStudioVideoFromDisk(sourceFilePath: string, originalName?: string) {
  const baseName = originalName || path.basename(sourceFilePath);
  const assetId = `vid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const ext = normalizeVideoExt(baseName);
  const destPath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
  fs.copyFileSync(sourceFilePath, destPath);
  return finalizeUploadedStudioVideoFile(destPath, baseName, assetId);
}

function getRefererForUrl(rawUrl: string): string {
  if (rawUrl.includes('hdslb.com') || rawUrl.includes('bilibili.com')) return 'https://www.bilibili.com/';
  if (rawUrl.includes('douyinpic.com') || rawUrl.includes('douyin.com') || rawUrl.includes('byteimg.com')) return 'https://www.douyin.com/';
  if (rawUrl.includes('yximgs.com') || rawUrl.includes('kwimgs.com') || rawUrl.includes('kuaishou.com')) return 'https://www.kuaishou.com/';
  if (rawUrl.includes('sinaimg.cn') || rawUrl.includes('weibo.com')) return 'https://weibo.com/';
  if (rawUrl.includes('xhscdn.com') || rawUrl.includes('xiaohongshu.com')) return 'https://www.xiaohongshu.com/';
  if (rawUrl.includes('tiktokcdn') || rawUrl.includes('tiktokv.com') || rawUrl.includes('ttwstatic.com') || rawUrl.includes('tiktok.com')) {
    return 'https://www.tiktok.com/';
  }
  return '';
}

async function fetchImageBuffer(picUrl: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!picUrl || !picUrl.startsWith('http')) return null;
  try {
    const referer = getRefererForUrl(picUrl);
    const res = await fetch(picUrl, {
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: referer } : {}),
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const arr = await res.arrayBuffer();
    if (arr.byteLength < 500) return null;
    return { buffer: Buffer.from(arr), mimeType: contentType };
  } catch {
    return null;
  }
}

interface EnrichedVideoContext {
  index: number;
  source: DerivativeSourceInput;
  description: string;
  tags: string[];
  captionsText: string;
  thumbnail: { buffer: Buffer; mimeType: string } | null;
}

function extractYouTubeId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function fetchYouTubeContext(
  urlStr: string
): Promise<{ description: string; tags: string[]; captionsText: string }> {
  const vid = extractYouTubeId(urlStr);
  if (!vid) return { description: '', tags: [], captionsText: '' };

  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${vid}&hl=vi`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(7000),
    });
    const html = await res.text();
    const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var\s|<\/script>)/s);
    if (!match) return { description: '', tags: [], captionsText: '' };

    const player = JSON.parse(match[1]);
    const description = String(player?.videoDetails?.shortDescription || '').slice(0, 750);
    const tags: string[] = Array.isArray(player?.videoDetails?.keywords)
      ? player.videoDetails.keywords.slice(0, 12).map(String)
      : [];

    let captionsText = '';
    const tracks: any[] = Array.isArray(player?.captions?.playerCaptionsTracklistRenderer?.captionTracks)
      ? player.captions.playerCaptionsTracklistRenderer.captionTracks
      : [];
    const chosenTrack =
      tracks.find((t) => String(t.languageCode || '').startsWith('vi')) ||
      tracks.find((t) => String(t.languageCode || '').startsWith('en')) ||
      tracks[0];

    if (chosenTrack?.baseUrl) {
      try {
        const capUrl = `${chosenTrack.baseUrl}&fmt=json3`;
        const capRes = await fetch(capUrl, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(5000),
        });
        if (capRes.ok) {
          const capJson = (await capRes.json().catch(() => null)) as any;
          const events: any[] = Array.isArray(capJson?.events) ? capJson.events : [];
          const segments: string[] = [];
          for (const ev of events) {
            if (!Array.isArray(ev?.segs)) continue;
            const line = ev.segs.map((s: any) => String(s?.utf8 || '')).join('').replace(/\s+/g, ' ').trim();
            if (line) segments.push(line);
          }
          captionsText = segments.join(' ').slice(0, 1400);
        }
      } catch {
        // ignore caption fetch error
      }
    }

    return { description, tags, captionsText };
  } catch {
    return { description: '', tags: [], captionsText: '' };
  }
}

async function fetchBilibiliContext(
  sourceUrl: string,
  id: string
): Promise<{ description: string; tags: string[]; captionsText: string }> {
  const bvidMatch = sourceUrl.match(/(BV[0-9A-Za-z]+)/) || id.match(/(BV[0-9A-Za-z]+)/);
  if (!bvidMatch) return { description: '', tags: [], captionsText: '' };
  try {
    const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvidMatch[1]}`, {
      headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json()) as any;
    const data = json?.data;
    if (!data) return { description: '', tags: [], captionsText: '' };
    const description = String(data.desc || data.dynamic || '').slice(0, 750);
    const tags = data.tname ? [String(data.tname)] : [];
    return { description, tags, captionsText: '' };
  } catch {
    return { description: '', tags: [], captionsText: '' };
  }
}

async function fetchDailymotionContext(
  sourceUrl: string
): Promise<{ description: string; tags: string[]; captionsText: string }> {
  const m = sourceUrl.match(/\/video\/([A-Za-z0-9]+)/);
  if (!m) return { description: '', tags: [], captionsText: '' };
  try {
    const res = await fetch(`https://api.dailymotion.com/video/${m[1]}?fields=description,tags`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as any;
    return {
      description: String(json?.description || '').replace(/<[^>]+>/g, ' ').slice(0, 750),
      tags: Array.isArray(json?.tags) ? json.tags.slice(0, 10).map(String) : [],
      captionsText: '',
    };
  } catch {
    return { description: '', tags: [], captionsText: '' };
  }
}

async function transcribeLocalVideoAudio(asset: StudioAssetRecord): Promise<string> {
  if (!asset.hasAudio || !process.env.GEMINI_API_KEY?.trim()) return '';
  const tmpMp3 = path.join(STUDIO_ASSETS_DIR, `${asset.assetId}_speech.mp3`);
  try {
    const extractRes = await spawnPromise(
      'ffmpeg',
      ['-y', '-i', asset.filePath, '-vn', '-t', '180', '-ar', '16000', '-ac', '1', '-b:a', '48k', tmpMp3],
      STUDIO_ASSETS_DIR,
      30_000
    );
    if (extractRes.code !== 0 || !fs.existsSync(tmpMp3)) return '';
    const mp3Buf = fs.readFileSync(tmpMp3);
    if (mp3Buf.byteLength < 1500 || mp3Buf.byteLength > 12_000_000) return '';

    const ai = getGeminiClient();
    const res = await retryWithGeminiBackoff(
      () =>
        ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/mp3',
                  data: mp3Buf.toString('base64'),
                },
              },
              { text: 'Transcribe all spoken dialogue clearly, keeping original language.' },
            ],
          },
        }),
      [1200, 2600]
    );
    return String(res.text || '').trim().slice(0, 1800);
  } catch {
    return '';
  } finally {
    if (fs.existsSync(tmpMp3)) {
      fs.unlink(tmpMp3, () => {});
    }
  }
}

function parseDataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  try {
    return { mimeType: m[1].trim(), buffer: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

async function gatherSourceContexts(sources: DerivativeSourceInput[]): Promise<EnrichedVideoContext[]> {
  const limited = sources.slice(0, 8);
  return Promise.all(
    limited.map(async (src, idx) => {
      // Check if source is an uploaded local video asset
      if (src.localAssetId) {
        const asset = getStudioAsset(src.localAssetId);
        const kfThumb =
          src.keyframes && src.keyframes.length > 0 ? parseDataUrlToBuffer(src.keyframes[0]) : null;
        const speechTranscript = asset ? await transcribeLocalVideoAudio(asset) : '';
        return {
          index: idx,
          source: src,
          description: `Video tải lên từ máy (${asset?.resolution || 'HD'}, ${src.duration}s).`,
          tags: ['local_upload'],
          captionsText: speechTranscript,
          thumbnail: kfThumb || (await fetchImageBuffer(src.pic)),
        };
      }

      const [meta, thumb] = await Promise.all([
        src.platform === 'youtube'
          ? fetchYouTubeContext(src.sourceUrl)
          : src.platform === 'bilibili'
          ? fetchBilibiliContext(src.sourceUrl, src.id)
          : src.platform === 'dailymotion'
          ? fetchDailymotionContext(src.sourceUrl)
          : Promise.resolve({ description: '', tags: [], captionsText: '' }),
        fetchImageBuffer(src.pic),
      ]);

      return {
        index: idx,
        source: src,
        description: meta.description,
        tags: meta.tags,
        captionsText: meta.captionsText,
        thumbnail: thumb,
      };
    })
  );
}

const STYLE_LABELS: Record<DerivativeStylePreset, string> = {
  summary_fast: 'Tóm tắt & Điểm tin nhanh gọn, nhịp cắt dứt khoát',
  storytelling_review: 'Kể chuyện / Review cuốn hút có mở bài - cao trào - kết luận',
  top_list: 'Tổng hợp Top điểm nổi bật / So sánh góc nhìn đa chiều',
  tips_tutorial: 'Chắt lọc mẹo hay & hướng dẫn thực hành dễ áp dụng',
};

function resolveOpenAiCompatibleConfig(provider: 'openai' | 'meta') {
  if (provider === 'openai') {
    return {
      label: 'OpenAI ChatGPT',
      envName: 'OPENAI_API_KEY',
      apiKey: process.env.OPENAI_API_KEY?.trim() || '',
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
    };
  }
  return {
    label: 'Meta AI (Llama)',
    envName: 'META_API_KEY',
    apiKey: process.env.META_API_KEY?.trim() || '',
    baseUrl: (process.env.META_BASE_URL || 'https://api.llama.com/compat/v1').replace(/\/+$/, ''),
    model: (process.env.META_MODEL || 'Llama-4-Scout-17B-16E-Instruct-FP8').trim(),
  };
}

async function generateBlueprintViaOpenAiCompatible(params: {
  provider: 'openai' | 'meta';
  contexts: EnrichedVideoContext[];
  promptText: string;
  desiredScenes: number;
  avgSceneDur: number;
  wordsMin: number;
  wordsMax: number;
}): Promise<any> {
  const cfg = resolveOpenAiCompatibleConfig(params.provider);
  if (!cfg.apiKey) {
    throw new Error(
      `Chưa phát hiện ${cfg.envName} trên máy chủ. Hãy thêm ${cfg.envName} trong Settings > Secrets (hoặc tệp .env trên máy).`
    );
  }

  const schemaInstruction = `
TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON HỢP LỆ THEO CẤU TRÚC SAU (không markdown, không văn bản thừa):
{
  "learnedSummary": "Tóm tắt 2-3 câu nội dung cốt lõi học được",
  "keyTakeaways": ["ý 1", "ý 2", "ý 3", "ý 4"],
  "hookFormula": "Công thức mở đầu & giữ chân",
  "sourceKeyPoints": ["1 câu bài học video #1", ...],
  "derivativeTitle": "Tiêu đề video phái sinh mới",
  "derivativeHook": "Câu hook tối đa 12 chữ hiện 3.5s đầu",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"],
  "scenes": [
    {
      "sceneIndex": 1,
      "durationSec": ${params.avgSceneDur},
      "sourceVideoIndex": 0,
      "sourceStartPercent": 15,
      "onScreenText": "Chữ phụ đề ngắn tối đa 12 chữ",
      "narration": "Lời đọc thuyết minh tiếng Việt tự nhiên từ ${params.wordsMin} đến ${params.wordsMax} chữ khớp với ${params.avgSceneDur} giây",
      "visualNote": "Ghi chú bối cảnh hình ảnh tiếng Việt",
      "brollKeywordEn": "2-4 English keywords for Wikimedia Commons stock video lookup"
    }
  ]
}
BẮT BUỘC mảng "scenes" có ĐÚNG ${params.desiredScenes} phân cảnh tách biệt.`;

  const userContent: any[] = [{ type: 'text', text: `${params.promptText}\n\n${schemaInstruction}` }];
  for (const ctx of params.contexts.slice(0, 4)) {
    if (ctx.thumbnail && ctx.thumbnail.buffer.byteLength < 600_000) {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:${ctx.thumbnail.mimeType};base64,${ctx.thumbnail.buffer.toString('base64')}`,
        },
      });
    }
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        {
          role: 'system',
          content:
            'Bạn là Đạo diễn sáng tạo nội dung video chuyên nghiệp. Luôn phản hồi duy nhất JSON thuần túy tiếng Việt đúng schema được yêu cầu.',
        },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(75_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `${cfg.label} lỗi HTTP ${res.status}: ${errBody.slice(0, 180) || res.statusText}`
    );
  }
  const data = (await res.json()) as any;
  const rawContent = String(data?.choices?.[0]?.message?.content || '{}').trim();
  const cleanJson = rawContent.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleanJson);
}

export async function testAiProviderConnection(provider: AiProviderId): Promise<{ ok: boolean; message: string; model: string }> {
  if (provider === 'muse') {
    return {
      ok: true,
      model: 'Edison Bridge',
      message: 'Muse AI (Edison Bridge) hoạt động qua /api/edison/* và không cần API key.',
    };
  }

  if (provider === 'gemini') {
    const models = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
    let lastErr: any;
    for (const model of models) {
      try {
        const ai = getGeminiClient();
        const res = await retryWithGeminiBackoff(
          () =>
            ai.models.generateContent({
              model,
              contents: 'Trả lời đúng 1 cụm từ: Sẵn sàng',
            }),
          [1200, 2500]
        );
        const text = (res.text || '').trim();
        const note =
          model === 'gemini-4-hydrogen'
            ? `Kết nối Gemini (${model}) thành công: "${text.slice(0, 40) || 'OK'}"`
            : `Gemini 4 đang quá tải tạm thời, đã chuyển tự động sang ${model} thành công: "${text.slice(0, 40) || 'OK'}"`;
        return { ok: true, model, message: note };
      } catch (err: any) {
        lastErr = err;
        if (!shouldFallbackGeminiModel(err)) {
          return { ok: false, model, message: formatGeminiError(err) };
        }
      }
    }
    return { ok: false, model: models[0], message: formatGeminiError(lastErr) };
  }

  const cfg = resolveOpenAiCompatibleConfig(provider === 'openai' ? 'openai' : 'meta');
  if (!cfg.apiKey) {
    return {
      ok: false,
      model: cfg.model,
      message: `Chưa cấu hình ${cfg.envName} trong Settings > Secrets hoặc tệp .env trên máy.`,
    };
  }

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'Reply with OK' }],
        max_tokens: 12,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, model: cfg.model, message: `HTTP ${res.status}: ${errBody.slice(0, 140) || res.statusText}` };
    }
    return { ok: true, model: cfg.model, message: `Kết nối ${cfg.label} (${cfg.model}) thành công.` };
  } catch (err: any) {
    return { ok: false, model: cfg.model, message: err?.message || `Không thể kết nối tới ${cfg.label}.` };
  }
}

const OUTPUT_LANG_LABELS: Record<DerivativeOutputLanguage, string> = {
  vi: 'Tiếng Việt hoàn toàn tự nhiên, hấp dẫn',
  en: 'English (clear, conversational, high-retention narration)',
  zh: '中文 (自然流畅的短视频解说口播)',
  vi_en: 'Song ngữ Việt - Anh (mở câu Tiếng Việt chính xác, nhấn thuật ngữ Tiếng Anh tự nhiên)',
};

export async function learnVideosAndCreateBlueprint(params: {
  query?: string;
  videos: DerivativeSourceInput[];
  stylePreset: DerivativeStylePreset;
  aspectRatio: DerivativeAspectRatio;
  targetDurationSec?: number;
  targetDuration?: 'short' | 'medium';
  outputLanguage?: DerivativeOutputLanguage;
  useProModel?: boolean;
  characterSummary?: string;
  customInstruction?: string;
  aiProvider?: AiProviderId;
}): Promise<DerivativeBlueprint> {
  if (!params.videos || params.videos.length === 0) {
    throw new Error('Vui lòng chọn hoặc tải lên ít nhất 1 video nguồn để AI học nội dung.');
  }

  const provider: AiProviderId =
    params.aiProvider === 'openai' || params.aiProvider === 'meta'
      ? params.aiProvider
      : 'gemini';

  const contexts = await gatherSourceContexts(params.videos);

  const rawSec =
    typeof params.targetDurationSec === 'number' && Number.isFinite(params.targetDurationSec)
      ? params.targetDurationSec
      : params.targetDuration === 'medium'
      ? 45
      : 30;
  const desiredTotalSec = Math.max(20, Math.min(900, Math.round(rawSec)));

  let desiredScenes = 4;
  if (desiredTotalSec <= 45) desiredScenes = 4;
  else if (desiredTotalSec <= 90) desiredScenes = 6;
  else if (desiredTotalSec <= 180) desiredScenes = 10;
  else if (desiredTotalSec <= 300) desiredScenes = 14;
  else if (desiredTotalSec <= 480) desiredScenes = 16;
  else desiredScenes = 20;

  const avgSceneDur = Math.max(5, Math.min(42, Math.round(desiredTotalSec / desiredScenes)));
  const wordsMin = Math.max(15, Math.min(90, Math.round(avgSceneDur * 2.0)));
  const wordsMax = Math.max(wordsMin + 8, Math.min(115, Math.round(avgSceneDur * 2.55)));
  const outputLang: DerivativeOutputLanguage = params.outputLanguage || 'vi';

  const parts: any[] = [];

  for (const ctx of contexts) {
    if (ctx.source.keyframes && ctx.source.keyframes.length > 0) {
      parts.push({
        text: `[Các khung hình trích xuất từ Video tải lên #${ctx.index + 1}: ${ctx.source.title}]`,
      });
      for (const kf of ctx.source.keyframes.slice(0, 3)) {
        const parsed = parseDataUrlToBuffer(kf);
        if (parsed) {
          parts.push({
            inlineData: {
              mimeType: parsed.mimeType,
              data: parsed.buffer.toString('base64'),
            },
          });
        }
      }
    } else if (ctx.thumbnail) {
      parts.push({
        text: `[Ảnh đại diện Video #${ctx.index + 1} (${ctx.source.platformLabel}): ${ctx.source.translatedTitle || ctx.source.title}]`,
      });
      parts.push({
        inlineData: {
          mimeType: ctx.thumbnail.mimeType,
          data: ctx.thumbnail.buffer.toString('base64'),
        },
      });
    }
  }

  const dossierLines = contexts.map((ctx) => {
    const s = ctx.source;
    return [
      `=== VIDEO NGUỒN #${ctx.index + 1} (index=${ctx.index}) ===`,
      `- Nền tảng / Nguồn: ${s.localAssetId ? 'Video người dùng tải lên' : s.platformLabel}`,
      `- Tiêu đề: ${s.translatedTitle ? `${s.translatedTitle} (Gốc: ${s.title})` : s.title}`,
      `- Kênh/Tác giả: ${s.author}`,
      `- Thời lượng gốc: ${s.duration > 0 ? `${s.duration} giây` : 'Chưa rõ'} | Lượt xem: ${s.views.toLocaleString('en-US')}`,
      ctx.tags.length > 0 ? `- Từ khóa/Tags: ${ctx.tags.join(', ')}` : '',
      ctx.description ? `- Mô tả nội dung:\n${ctx.description}` : '',
      ctx.captionsText ? `- Lời thoại/Phụ đề trích xuất:\n${ctx.captionsText}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });

  const targetMinutesLabel =
    desiredTotalSec >= 60
      ? `${desiredTotalSec} giây (~${(desiredTotalSec / 60).toFixed(1)} phút)`
      : `${desiredTotalSec} giây`;

  const promptText = `Bạn là Đạo diễn & Biên tập viên sáng tạo nội dung video chuyên sâu.
Từ khóa/Chủ đề người dùng đang tìm kiếm: "${params.query?.trim() || 'Chủ đề tổng hợp từ các video đã chọn'}".
Phong cách video phái sinh mong muốn: ${STYLE_LABELS[params.stylePreset]}.
Ngôn ngữ lời thoại & phụ đề BẮT BUỘC cho kịch bản mới: ${OUTPUT_LANG_LABELS[outputLang]}.
Tỉ lệ khung hình mục tiêu: ${params.aspectRatio}.
Tổng thời lượng mục tiêu BẮT BUỘC: khoảng ${targetMinutesLabel} chia thành đúng ${desiredScenes} phân cảnh (scenes), trung bình mỗi cảnh dài ${avgSceneDur} giây để tổng cộng đạt khoảng ${desiredTotalSec} giây.
${params.characterSummary?.trim() ? `Nhân vật tham chiếu xuyên suốt video: ${params.characterSummary.trim()}` : ''}
${params.customInstruction?.trim() ? `Yêu cầu bổ sung từ người dùng: ${params.customInstruction.trim()}` : ''}

NHIỆM VỤ CỦA BẠN:
1. HỌC SÂU nội dung từ ${contexts.length} video nguồn dưới đây (dựa vào tiêu đề, mô tả, lời thoại/phụ đề thực tế và các khung hình đi kèm):
   - Phân tích ngôn ngữ gốc, luận điểm giá trị nhất, cách đặt hook thu hút, công thức giữ chân người xem.
   - Không dịch máy móc hay sao chép nguyên xi 1 video, mà TỔNG HỢP, PHÂN TÍCH MỞ RỘNG & TÁI SÁNG TẠO thành kịch bản video phái sinh có chiều sâu, mạch lạc, tự nhiên, hấp dẫn theo đúng ngôn ngữ lời thoại đầu ra đã chọn.
2. Với mỗi phân cảnh (sceneIndex 1..${desiredScenes}):
   - Chọn \`sourceVideoIndex\` (0 đến ${contexts.length - 1}) phù hợp nhất.
   - Chọn \`sourceStartPercent\` (số nguyên 5..75) gợi ý điểm cắt tiêu biểu trong video gốc đó.
   - \`durationSec\`: thời lượng của cảnh (khoảng ${Math.max(4, avgSceneDur - 3)} đến ${Math.min(45, avgSceneDur + 4)} giây, sao cho tổng các cảnh xấp xỉ ${desiredTotalSec} giây).
   - \`onScreenText\`: dòng chữ tiêu đề/ý chính hiển thị trên khung hình (ngắn gọn, tối đa 12 chữ).
   - \`narration\`: lời thuyết minh tự nhiên cho lồng tiếng đúng ngôn ngữ đầu ra — PHẢI ĐỦ DÀI từ ${wordsMin} đến ${wordsMax} chữ mỗi cảnh để giọng đọc kéo dài tương ứng ${avgSceneDur} giây, viết thành văn nói cuốn hút, không dùng ký tự đặc biệt thừa hay hashtag.
   - \`visualNote\`: mô tả chi tiết bối cảnh hình ảnh/hành động (kết hợp nhân vật tham chiếu nếu có) dùng để vẽ ảnh phân cảnh AI hoặc tạo video bằng Gemini Omni Flash.
   - \`brollKeywordEn\`: 2 đến 4 từ khóa TIẾNG ANH ngắn gọn, phổ biến mô tả hình ảnh cảnh này để tìm video mẫu miễn phí trên Wikimedia Commons (VD: "city night timelapse", "robot technology lab", "chef cooking kitchen", "ocean waves nature").

DỮ LIỆU CÁC VIDEO NGUỒN:
${dossierLines.join('\n\n')}`;

  parts.push({ text: promptText });

  const geminiModel = params.useProModel ? 'gemini-4-argon' : 'gemini-4-hydrogen';

  try {
    let parsed: any = {};
    let usedModel = geminiModel;

    if (provider === 'openai' || provider === 'meta') {
      usedModel = resolveOpenAiCompatibleConfig(provider).model;
      parsed = await generateBlueprintViaOpenAiCompatible({
        provider,
        contexts,
        promptText,
        desiredScenes,
        avgSceneDur,
        wordsMin,
        wordsMax,
      });
    } else {
      const ai = getGeminiClient();
      const candidateModels = params.useProModel
        ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

      const compactParts = parts.filter((p, idx) => p.text || idx < 2);
      let response: any = null;
      let lastGeminiErr: any = null;

      for (const candidateModel of candidateModels) {
        const activeParts = candidateModel === 'gemini-3.1-flash-lite' ? compactParts : parts;
        try {
          response = await retryWithGeminiBackoff(
            () =>
              ai.models.generateContent({
                model: candidateModel,
                contents: { parts: activeParts },
                config: {
                  systemInstruction:
                    'Luôn phản hồi bằng JSON thuần túy đúng schema, nội dung sắc bén, giàu giá trị thông tin, đúng ngôn ngữ yêu cầu, đủ độ dài và có mô tả hình ảnh + từ khóa tiếng Anh chuẩn.',
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      learnedSummary: {
                        type: Type.STRING,
                        description: 'Tóm tắt ngắn 2-3 câu về những nội dung cốt lõi AI học được từ các video nguồn.',
                      },
                      keyTakeaways: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '3 đến 6 gạch đầu dòng các kiến thức/ý tưởng đắt giá rút ra được.',
                      },
                      hookFormula: {
                        type: Type.STRING,
                        description: 'Công thức mở đầu & giữ chân người xem rút ra từ các video nguồn.',
                      },
                      sourceKeyPoints: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Đúng bằng số lượng video nguồn: tóm tắt 1 câu bài học/điểm hay của từng video tương ứng theo thứ tự.',
                      },
                      derivativeTitle: {
                        type: Type.STRING,
                        description: 'Tiêu đề hấp dẫn cho video phái sinh mới.',
                      },
                      derivativeHook: {
                        type: Type.STRING,
                        description: 'Câu hook chữ nổi bật hiện 3.5 giây đầu video (tối đa 12 chữ).',
                      },
                      hashtags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: '4 đến 6 hashtag phù hợp.',
                      },
                      scenes: {
                        type: Type.ARRAY,
                        description: `BẮT BUỘC phải trả về ĐÚNG ${desiredScenes} phân cảnh tách biệt (sceneIndex từ 1 đến ${desiredScenes}), mỗi cảnh dài khoảng ${avgSceneDur} giây để tổng thời lượng đạt ${desiredTotalSec} giây.`,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            sceneIndex: { type: Type.INTEGER },
                            durationSec: { type: Type.NUMBER },
                            sourceVideoIndex: { type: Type.INTEGER },
                            sourceStartPercent: { type: Type.INTEGER },
                            onScreenText: { type: Type.STRING },
                            narration: { type: Type.STRING },
                            visualNote: { type: Type.STRING },
                            brollKeywordEn: { type: Type.STRING },
                          },
                        },
                      },
                    },
                  },
                },
              }),
            [1400, 3000]
          );
          usedModel = candidateModel;
          break;
        } catch (err: any) {
          lastGeminiErr = err;
          if (!shouldFallbackGeminiModel(err)) {
            throw err;
          }
        }
      }

      if (response) {
        const rawText = (response?.text ?? '{}').trim();
        parsed = JSON.parse(rawText);
      } else {
        // Automatic failover to configured OpenAI or Meta if all Gemini models are 503 unavailable
        const altProvider: 'openai' | 'meta' | null = process.env.OPENAI_API_KEY?.trim()
          ? 'openai'
          : process.env.META_API_KEY?.trim()
          ? 'meta'
          : null;
        if (altProvider) {
          usedModel = `${resolveOpenAiCompatibleConfig(altProvider).model} (auto-fallback)`;
          parsed = await generateBlueprintViaOpenAiCompatible({
            provider: altProvider,
            contexts,
            promptText,
            desiredScenes,
            avgSceneDur,
            wordsMin,
            wordsMax,
          });
        } else {
          throw lastGeminiErr;
        }
      }
    }

    const rawScenes: any[] = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    const scenes: DerivativeScene[] = rawScenes.slice(0, 24).map((sc, i) => {
      const idx = Math.max(0, Math.min(contexts.length - 1, Math.round(Number(sc?.sourceVideoIndex ?? i % contexts.length))));
      const dur = Math.max(4, Math.min(45, Number(sc?.durationSec || avgSceneDur)));
      const startPct = Math.max(0, Math.min(80, Math.round(Number(sc?.sourceStartPercent ?? (i * 18) % 70))));
      return {
        id: `scene_${i + 1}_${crypto.randomBytes(2).toString('hex')}`,
        sceneIndex: i + 1,
        durationSec: dur,
        sourceVideoIndex: idx,
        sourceStartPercent: startPct,
        onScreenText: String(sc?.onScreenText || `Phần ${i + 1}`).trim(),
        narration: String(sc?.narration || '').trim(),
        visualNote: String(sc?.visualNote || '').trim(),
        brollKeywordEn: String(sc?.brollKeywordEn || '').trim(),
      };
    });

    const sourceKeyPoints: string[] = Array.isArray(parsed?.sourceKeyPoints) ? parsed.sourceKeyPoints : [];
    const sourcesAnalyzed: DerivativeSourceInsight[] = contexts.map((ctx, i) => ({
      index: i,
      title: ctx.source.translatedTitle || ctx.source.title,
      platformLabel: ctx.source.localAssetId ? 'Video tải lên' : ctx.source.platformLabel,
      author: ctx.source.author,
      hasDescription: Boolean(ctx.description),
      hasCaptions: Boolean(ctx.captionsText),
      hasThumbnail: Boolean(ctx.thumbnail) || Boolean(ctx.source.keyframes?.length),
      keyPoint: String(sourceKeyPoints[i] || ctx.description.slice(0, 120) || ctx.source.title),
    }));

    return {
      learnedSummary: String(parsed?.learnedSummary || 'Đã tổng hợp nội dung nổi bật từ các video đã chọn.'),
      keyTakeaways: Array.isArray(parsed?.keyTakeaways) ? parsed.keyTakeaways.map(String).slice(0, 6) : [],
      hookFormula: String(parsed?.hookFormula || 'Mở đầu trực diện vấn đề + phân tích chiều sâu + kết luận thực tế.'),
      derivativeTitle: String(parsed?.derivativeTitle || 'Video tổng hợp kiến thức mới'),
      derivativeHook: String(parsed?.derivativeHook || 'Đừng bỏ qua điểm mấu chốt này!'),
      hashtags: Array.isArray(parsed?.hashtags) ? parsed.hashtags.map(String).slice(0, 8) : [],
      aspectRatio: params.aspectRatio,
      sourcesAnalyzed,
      usedProvider: provider,
      usedModel,
      scenes:
        scenes.length > 0
          ? scenes
          : [
              {
                id: 'scene_1',
                sceneIndex: 1,
                durationSec: 7,
                sourceVideoIndex: 0,
                sourceStartPercent: 10,
                onScreenText: 'Tổng hợp nội dung nổi bật',
                narration: 'Dưới đây là những điểm quan trọng nhất được rút ra từ các video nổi bật về chủ đề này.',
                visualNote: 'Giới thiệu mở đầu',
                brollKeywordEn: 'digital studio presentation',
              },
            ],
    };
  } catch (err: any) {
    if (provider === 'gemini') {
      throw new Error(formatGeminiError(err));
    }
    throw new Error(String(err?.message || err || 'Lỗi kết nối nhà cung cấp AI'));
  }
}

// ==========================================
// STUDIO AI MEDIA (CHARACTER/SCENE IMAGE, OMNI FLASH VIDEO, LYRIA MUSIC, OFFLINE TTS)
// ==========================================

export async function generateStudioImage(params: {
  mode: 'character' | 'scene';
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  quality?: 'standard' | 'pro';
  characterRefs?: { dataUrl: string; name?: string }[];
}): Promise<{ dataUrl: string; model: string }> {
  const ai = getGeminiClient();
  const model = params.quality === 'pro' ? 'gemini-nano-banana-2.1' : 'gemini-3.1-flash-lite-image';
  const aspectRatio = params.aspectRatio || (params.mode === 'character' ? '1:1' : '16:9');

  const parts: any[] = [];
  if (Array.isArray(params.characterRefs)) {
    for (const ref of params.characterRefs.slice(0, 3)) {
      const parsed = parseDataUrlToBuffer(ref.dataUrl);
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.buffer.toString('base64'),
          },
        });
      }
    }
  }

  const finalPrompt =
    params.mode === 'character'
      ? `Create a clean, consistent studio character portrait sheet suitable for reusing across video scenes: ${params.prompt}. High clarity, balanced lighting, no overlaid watermarks or UI text.`
      : params.characterRefs && params.characterRefs.length > 0
      ? `Create a cinematic storyboard scene keeping the exact character appearance from the attached reference image(s). Scene description: ${params.prompt}. No overlaid subtitles or watermarks.`
      : `Create a crisp, cinematic storyboard visual scene: ${params.prompt}. High aesthetic composition, no overlaid subtitles or watermarks.`;

  parts.push({ text: finalPrompt });

  const candidateModels =
    params.quality === 'pro'
      ? ['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image']
      : ['gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1'];

  let lastErr: any;
  for (const model of candidateModels) {
    try {
      const response = await retryWithGeminiBackoff(
        () =>
          ai.models.generateContent({
            model,
            contents: { parts },
            config: {
              imageConfig: {
                aspectRatio,
                ...(model === 'gemini-nano-banana-2.1' ? { imageSize: '1K' } : {}),
              },
            },
          }),
        [1500, 3200]
      );

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          return { dataUrl: `data:${mime};base64,${part.inlineData.data}`, model };
        }
      }
      throw new Error('Mô hình AI không trả về dữ liệu hình ảnh. Hãy thử mô tả cụ thể hơn.');
    } catch (err: any) {
      lastErr = err;
      if (!shouldFallbackGeminiModel(err)) {
        throw new Error(formatGeminiError(err));
      }
    }
  }
  throw new Error(formatGeminiError(lastErr));
}

export async function generateSceneVideoWithOmniFlash(params: {
  prompt: string;
  aspectRatio: DerivativeAspectRatio;
  durationSec?: number;
  sceneImageDataUrl?: string;
  characterRefs?: { dataUrl: string; name?: string }[];
}): Promise<{ assetId: string; previewUrl: string; durationSec: number; model: string }> {
  const ai = getGeminiClient();
  const clampedDur = Math.max(3, Math.min(15, Math.round(params.durationSec || 8)));
  const inputParts: any[] = [];

  if (params.sceneImageDataUrl) {
    const parsed = parseDataUrlToBuffer(params.sceneImageDataUrl);
    if (parsed) {
      inputParts.push({
        type: 'image',
        mime_type: parsed.mimeType,
        data: parsed.buffer.toString('base64'),
      });
    }
  } else if (Array.isArray(params.characterRefs)) {
    for (const ref of params.characterRefs.slice(0, 2)) {
      const parsed = parseDataUrlToBuffer(ref.dataUrl);
      if (parsed) {
        inputParts.push({
          type: 'image',
          mime_type: parsed.mimeType,
          data: parsed.buffer.toString('base64'),
        });
      }
    }
  }

  const promptText = params.sceneImageDataUrl
    ? `Animate this scene smoothly with natural camera motion matching the visual narrative: ${params.prompt}`
    : `Cinematic high-definition video scene: ${params.prompt}. Smooth camera movement, cohesive lighting, no overlaid text or watermarks.`;

  inputParts.push({ type: 'text', text: promptText });

  try {
    const interaction = await retryWithGeminiBackoff(
      () =>
        ai.interactions.create(
          {
            model: 'gemini-omni-1.2-flash',
            input: inputParts,
            background: false,
            store: false,
            stream: false,
            response_format: {
              type: 'video',
              aspect_ratio: params.aspectRatio,
              duration: `${clampedDur}s` as any,
              resolution: '720p',
            },
          },
          { timeout: 300_000 }
        ),
      [2500, 5000]
    );

    const videoPart = interaction.output_video;
    if (!videoPart) {
      throw new Error('Gemini Omni Flash không trả về luồng video.');
    }

    let videoBuffer: Buffer | null = null;
    if (videoPart.data) {
      videoBuffer = Buffer.from(videoPart.data, 'base64');
    } else if (videoPart.uri) {
      const dl = await fetch(videoPart.uri, {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY?.trim() || '' },
        signal: AbortSignal.timeout(60_000),
      });
      if (dl.ok) {
        videoBuffer = Buffer.from(await dl.arrayBuffer());
      }
    }

    if (!videoBuffer || videoBuffer.byteLength < 5000) {
      throw new Error('Không tải được dữ liệu clip video từ Gemini Omni Flash.');
    }

    const assetId = `omni_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const outPath = path.join(STUDIO_ASSETS_DIR, `${assetId}.mp4`);
    fs.writeFileSync(outPath, videoBuffer);
    const probedDur = (await probeDurationSeconds(outPath, STUDIO_ASSETS_DIR)) || clampedDur;

    studioAssets.set(assetId, {
      assetId,
      filePath: outPath,
      fileName: `${assetId}.mp4`,
      mimeType: 'video/mp4',
      durationSec: probedDur,
      createdAt: Date.now(),
    });

    return {
      assetId,
      previewUrl: `/api/studio/assets/${assetId}`,
      durationSec: Math.round(probedDur * 10) / 10,
      model: 'gemini-omni-1.2-flash',
    };
  } catch (err: any) {
    throw new Error(formatGeminiError(err));
  }
}

export async function generateStudioMusicWithLyria(params: {
  prompt: string;
  mode?: 'clip' | 'pro';
}): Promise<{ assetId: string; previewUrl: string; mimeType: string; lyrics: string; durationSec: number; model: string }> {
  const ai = getGeminiClient();
  const musicModels =
    params.mode === 'pro' ? ['lyria-3-pro-preview', 'lyria-3-clip-preview'] : ['lyria-3-clip-preview'];
  const musicPrompt =
    params.prompt.trim() ||
    'Generate an instrumental uplifting modern cinematic background music track suitable for storytelling video narration.';

  let lastErr: any;
  for (const model of musicModels) {
    try {
      const { audioChunks, lyrics, mimeType } = await retryWithGeminiBackoff(async () => {
        const response = await ai.models.generateContentStream({
          model,
          contents: musicPrompt,
        });

        const chunks: Buffer[] = [];
        let lyr = '';
        let mType = 'audio/mpeg';

        for await (const chunk of response) {
          const parts = chunk.candidates?.[0]?.content?.parts;
          if (!parts) continue;
          for (const part of parts) {
            if (part.inlineData?.data) {
              if (chunks.length === 0 && part.inlineData.mimeType) {
                mType = part.inlineData.mimeType;
              }
              chunks.push(Buffer.from(part.inlineData.data, 'base64'));
            }
            if (part.text) {
              lyr += part.text;
            }
          }
        }
        return { audioChunks: chunks, lyrics: lyr, mimeType: mType };
      }, [2000, 4200]);

      if (audioChunks.length === 0) {
        throw new Error('Lyria AI không trả về dữ liệu âm thanh.');
      }

      const audioBuf = Buffer.concat(audioChunks);
      const ext = mimeType.includes('wav') ? '.wav' : '.mp3';
      const assetId = `lyria_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const outPath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
      fs.writeFileSync(outPath, audioBuf);
      const durationSec = (await probeDurationSeconds(outPath, STUDIO_ASSETS_DIR)) || 30;

      studioAssets.set(assetId, {
        assetId,
        filePath: outPath,
        fileName: `AI_Music_${assetId}${ext}`,
        mimeType,
        durationSec,
        createdAt: Date.now(),
      });

      return {
        assetId,
        previewUrl: `/api/studio/assets/${assetId}`,
        mimeType,
        lyrics: lyrics.trim(),
        durationSec: Math.round(durationSec * 10) / 10,
        model,
      };
    } catch (err: any) {
      lastErr = err;
      if (!isTransientGemini503Error(err)) {
        throw new Error(formatGeminiError(err));
      }
    }
  }
  throw new Error(formatGeminiError(lastErr));
}

export async function searchPublicFreeMusicFromWikimedia(query: string) {
  const cleanQ = sanitizeStockQuery(query || 'ambient instrumental music') || 'ambient music';
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6` +
    `&gsrsearch=${encodeURIComponent(`${cleanQ} filetype:audio`)}&gsrlimit=18&prop=videoinfo&viprop=url|mime|size&format=json`;

  const res = await fetch(api, {
    headers: { 'User-Agent': WIKIMEDIA_UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    throw new Error(`Không tra cứu được nhạc Wikimedia Commons (HTTP ${res.status})`);
  }
  const json = (await res.json()) as any;
  const pages = Object.values(json?.query?.pages || {}) as any[];
  const tracks: { id: string; title: string; url: string; mimeType: string; sizeBytes: number }[] = [];

  for (const p of pages) {
    const vi = p?.videoinfo?.[0];
    const url = String(vi?.url || '');
    const mime = String(vi?.mime || '').toLowerCase();
    const size = Number(vi?.size || 0);
    if (
      url &&
      size > 40_000 &&
      size < 20_000_000 &&
      (mime.includes('audio') || mime.includes('ogg') || mime.includes('mpeg') || mime.includes('wav') || mime.includes('flac'))
    ) {
      const rawTitle = String(p?.title || 'Public Domain Track')
        .replace(/^File:/i, '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/_/g, ' ');
      tracks.push({
        id: `wiki_aud_${p.pageid || tracks.length}`,
        title: rawTitle.slice(0, 80),
        url,
        mimeType: mime,
        sizeBytes: size,
      });
    }
  }

  return tracks.slice(0, 10);
}

let cachedOfflineTts: { available: boolean; engine: string } | null = null;

export async function detectOfflineTtsEngine(): Promise<{ available: boolean; engine: string }> {
  if (cachedOfflineTts) return cachedOfflineTts;
  const checkCmd = async (cmd: string, args: string[], label: string) => {
    try {
      const r = await spawnPromise(cmd, args, STUDIO_ASSETS_DIR, 4000);
      return r.code === 0 ? label : '';
    } catch {
      return '';
    }
  };

  if (process.platform === 'win32') {
    const winOk = await checkCmd('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; "OK"'], 'Windows SAPI (Offline)');
    if (winOk) {
      cachedOfflineTts = { available: true, engine: winOk };
      return cachedOfflineTts;
    }
  } else if (process.platform === 'darwin') {
    const macOk = await checkCmd('which', ['say'], 'macOS say (Offline)');
    if (macOk) {
      cachedOfflineTts = { available: true, engine: macOk };
      return cachedOfflineTts;
    }
  }

  for (const bin of [
    { cmd: 'espeak-ng', args: ['--version'], label: 'eSpeak-NG (Offline)' },
    { cmd: 'espeak', args: ['--version'], label: 'eSpeak (Offline)' },
  ]) {
    const ok = await checkCmd(bin.cmd, bin.args, bin.label);
    if (ok) {
      cachedOfflineTts = { available: true, engine: ok };
      return cachedOfflineTts;
    }
  }

  cachedOfflineTts = { available: false, engine: '' };
  return cachedOfflineTts;
}

async function synthesizeOfflineVoiceWav(text: string, outWavPath: string): Promise<boolean> {
  const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
  if (!cleanText) return false;
  const detected = await detectOfflineTtsEngine();
  if (!detected.available) {
    throw new Error(
      'Máy chủ Linux hiện chưa cài công cụ đọc offline (espeak-ng / espeak). Hãy chuyển sang "Giọng đọc Online AI" hoặc chạy bản trên Windows/macOS để dùng giọng đọc hệ thống offline.'
    );
  }

  if (process.platform === 'win32') {
    const escapedText = cleanText.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${outWavPath.replace(/'/g, "''")}'); $s.Speak('${escapedText}'); $s.Dispose();`;
    const r = await spawnPromise('powershell', ['-NoProfile', '-Command', psScript], path.dirname(outWavPath), 45_000);
    return r.code === 0 && fs.existsSync(outWavPath);
  }

  if (process.platform === 'darwin') {
    const aiffPath = `${outWavPath}.aiff`;
    const r = await spawnPromise('say', ['-o', aiffPath, cleanText], path.dirname(outWavPath), 45_000);
    if (r.code === 0 && fs.existsSync(aiffPath)) {
      const conv = await spawnPromise('ffmpeg', ['-y', '-i', aiffPath, outWavPath], path.dirname(outWavPath), 20_000);
      try { fs.unlinkSync(aiffPath); } catch { /* ignore */ }
      return conv.code === 0 && fs.existsSync(outWavPath);
    }
    return false;
  }

  const bin = detected.engine.toLowerCase().includes('espeak-ng') ? 'espeak-ng' : 'espeak';
  const r = await spawnPromise(bin, ['-v', 'vi', '-w', outWavPath, cleanText], path.dirname(outWavPath), 30_000);
  if (r.code !== 0) {
    const fallback = await spawnPromise(bin, ['-w', outWavPath, cleanText], path.dirname(outWavPath), 30_000);
    return fallback.code === 0 && fs.existsSync(outWavPath);
  }
  return fs.existsSync(outWavPath);
}

// ==========================================
// DERIVATIVE VIDEO RENDERING (TTS + FFMPEG)
// ==========================================

function spawnPromise(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} quá thời gian chờ (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function probeDurationSeconds(filePath: string, cwd: string): Promise<number> {
  try {
    const res = await spawnPromise(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      cwd,
      15_000
    );
    const val = parseFloat(res.stdout.trim());
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

async function synthesizeSceneVoiceWav(
  ai: GoogleGenAI,
  text: string,
  voice: Exclude<DerivativeVoiceId, 'none'>,
  stylePrompt: string,
  outWavPath: string
): Promise<boolean> {
  const cleanText = text.trim();
  if (!cleanText) return false;

  const ttsModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  for (const ttsModel of ttsModels) {
    try {
      const interaction = await retryWithGeminiBackoff(
        () =>
          ai.interactions.create({
            model: ttsModel,
            input: [
              {
                type: 'text',
                text: cleanText,
                annotations: [
                  {
                    type: 'speech_metadata',
                    style: stylePrompt,
                  },
                ],
              },
            ],
            response_format: { type: 'audio' },
            generation_config: {
              speech_config: [{ voice }],
            },
          }),
        [1200, 2600]
      );

      const audio = interaction.output_audio;
      if (audio?.data) {
        fs.writeFileSync(outWavPath, Buffer.from(audio.data, 'base64'));
        return true;
      }
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID') || msg.includes('403')) {
        throw new Error(formatGeminiError(err));
      }
      if (!isTransientGemini503Error(err)) {
        return false;
      }
    }
  }
  return false;
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.min(99, Math.floor((s - Math.floor(s)) * 100));
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(t: string): string {
  return t.replace(/[\r\n]+/g, '\\N').replace(/\{/g, '(').replace(/\}/g, ')');
}

function buildAssSubtitlesFile(
  width: number,
  height: number,
  hookText: string,
  timeline: { start: number; end: number; caption: string }[]
): string {
  const isVertical = height > width;
  const hookFontSize = isVertical ? 54 : 48;
  const capFontSize = isVertical ? 48 : 42;
  const hookMarginV = isVertical ? 140 : 60;
  const capMarginV = isVertical ? 230 : 80;

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 1',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Hook,DejaVu Sans,${hookFontSize},&H00FFFFFF,&H000000FF,&H00003B3E,&HCC003B3E,-1,0,0,0,100,100,0,0,3,18,0,8,56,56,${hookMarginV},1`,
    `Style: Caption,DejaVu Sans,${capFontSize},&H00FFFFFF,&H000000FF,&H00000000,&HAA000A10,-1,0,0,0,100,100,0,0,3,14,0,2,56,56,${capMarginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const cleanHook = escapeAssText(hookText.trim());
  if (cleanHook) {
    lines.push(`Dialogue: 1,0:00:00.00,${formatAssTime(Math.min(3.8, timeline[timeline.length - 1]?.end || 3.8))},Hook,,0,0,0,,${cleanHook}`);
  }

  for (const seg of timeline) {
    const cleanCap = escapeAssText(seg.caption.trim());
    if (!cleanCap) continue;
    lines.push(`Dialogue: 0,${formatAssTime(seg.start)},${formatAssTime(seg.end)},Caption,,0,0,0,,${cleanCap}`);
  }

  return lines.join('\n') + '\n';
}

export interface DownloadSourceClipResult {
  ok: boolean;
  reason?: string;
}

export type DownloadSourceClipFn = (
  source: DerivativeSourceInput,
  outPath: string
) => Promise<boolean | DownloadSourceClipResult>;

export interface StartDerivativeJobParams {
  blueprint: DerivativeBlueprint;
  sources: DerivativeSourceInput[];
  visualMode: DerivativeVisualMode;
  voice: DerivativeVoiceId;
  voiceMode?: DerivativeVoiceMode;
  voiceStyle?: string;
  keepSourceAudio: boolean;
  brollSource?: BrollSourceId;
  musicMode?: DerivativeMusicMode;
  musicAssetId?: string;
  publicMusicUrl?: string;
  musicPrompt?: string;
  musicVolume?: number;
  characterRefs?: { dataUrl: string; name?: string }[];
  downloadSourceVideo?: DownloadSourceClipFn;
}

const WIKIMEDIA_SAFE_FALLBACK_QUERIES = [
  'nature landscape aerial',
  'city street timelapse',
  'technology computer work',
  'ocean forest clouds',
  'earth space universe',
];

function sanitizeStockQuery(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 55);
}

const WIKIMEDIA_UA = 'GaConPro/1.0 (https://commons.wikimedia.org; bot@gaconpro.local)';

async function fetchBrollVideoUrlFromWikimedia(
  queries: string[],
  excludeUrls?: Set<string>
): Promise<string | null> {
  const candidates = Array.from(
    new Set(
      [...queries, ...WIKIMEDIA_SAFE_FALLBACK_QUERIES]
        .map(sanitizeStockQuery)
        .filter((q) => q.length >= 3)
    )
  ).slice(0, 5);

  for (const cleanQ of candidates) {
    try {
      const api =
        `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6` +
        `&gsrsearch=${encodeURIComponent(`${cleanQ} filetype:video`)}&gsrlimit=20&prop=videoinfo&viprop=url|mime|size&format=json`;
      const res = await fetch(api, {
        headers: { 'User-Agent': WIKIMEDIA_UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as any;
      const pages = Object.values(json?.query?.pages || {}) as any[];
      const eligible: { url: string; size: number }[] = [];
      for (const p of pages) {
        const vi = p?.videoinfo?.[0];
        const mime = String(vi?.mime || '').toLowerCase();
        const url = String(vi?.url || '');
        const size = Number(vi?.size || 0);
        const dur = Number(vi?.duration || 0);
        if (
          url &&
          (!excludeUrls || !excludeUrls.has(url)) &&
          (mime.includes('webm') || mime.includes('mp4') || mime.includes('ogg')) &&
          size > 80_000 &&
          size < 25_000_000 &&
          (dur === 0 || dur >= 3)
        ) {
          eligible.push({ url, size });
        }
      }
      if (eligible.length > 0) {
        eligible.sort((a, b) => a.size - b.size);
        const picked = eligible[0].url;
        excludeUrls?.add(picked);
        return picked;
      }
    } catch {
      // try next keyword candidate
    }
  }
  return null;
}

async function fetchBrollVideoUrlFromPexels(query: string, excludeUrls?: Set<string>): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) return null;
  const cleanQ = sanitizeStockQuery(query) || 'abstract background';
  try {
    const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(cleanQ)}&per_page=8`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const videos: any[] = Array.isArray(json?.videos) ? json.videos : [];
    for (const v of videos) {
      const files: any[] = Array.isArray(v?.video_files) ? v.video_files : [];
      const picked =
        files.find((f) => f.file_type === 'video/mp4' && (f.width === 1280 || f.width === 720)) ||
        files.find((f) => f.file_type === 'video/mp4') ||
        files[0];
      if (picked?.link && (!excludeUrls || !excludeUrls.has(picked.link))) {
        excludeUrls?.add(picked.link);
        return picked.link;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchBrollVideoUrlFromPixabay(query: string, excludeUrls?: Set<string>): Promise<string | null> {
  const apiKey = process.env.PIXABAY_API_KEY?.trim();
  if (!apiKey) return null;
  const cleanQ = sanitizeStockQuery(query) || 'background';
  try {
    const res = await fetch(
      `https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(cleanQ)}&per_page=8`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const hits: any[] = Array.isArray(json?.hits) ? json.hits : [];
    for (const hit of hits) {
      const url = hit?.videos?.medium?.url || hit?.videos?.small?.url || '';
      if (url && (!excludeUrls || !excludeUrls.has(url))) {
        excludeUrls?.add(url);
        return url;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function tryDownloadBrollStockClip(
  brollSource: BrollSourceId,
  queries: string[],
  outPath: string,
  excludeUrls?: Set<string>
): Promise<{ ok: boolean; label?: string }> {
  if (brollSource === 'none') return { ok: false };

  // Prioritize Wikimedia Commons first when 'wikimedia' or 'auto' is selected
  const order: ('wikimedia' | 'pexels' | 'pixabay')[] =
    brollSource === 'pexels'
      ? ['pexels', 'wikimedia']
      : brollSource === 'pixabay'
      ? ['pixabay', 'wikimedia']
      : brollSource === 'wikimedia'
      ? ['wikimedia']
      : ['wikimedia', 'pexels', 'pixabay'];

  const primaryQuery = queries.find((q) => sanitizeStockQuery(q).length >= 3) || 'nature city technology';

  for (const src of order) {
    const clipUrl =
      src === 'wikimedia'
        ? await fetchBrollVideoUrlFromWikimedia(queries, excludeUrls)
        : src === 'pexels'
        ? await fetchBrollVideoUrlFromPexels(primaryQuery, excludeUrls)
        : await fetchBrollVideoUrlFromPixabay(primaryQuery, excludeUrls);

    if (!clipUrl) continue;
    try {
      const dl = await fetch(clipUrl, {
        headers: { 'User-Agent': src === 'wikimedia' ? WIKIMEDIA_UA : UA },
        signal: AbortSignal.timeout(35_000),
      });
      if (!dl.ok) continue;
      const arr = await dl.arrayBuffer();
      if (arr.byteLength > 30_000) {
        fs.writeFileSync(outPath, Buffer.from(arr));
        const label =
          src === 'wikimedia' ? 'Wikimedia Commons (CC0/CC-BY)' : src === 'pexels' ? 'Pexels' : 'Pixabay';
        return { ok: true, label };
      }
    } catch {
      // try next provider
    }
  }
  return { ok: false };
}

export function startDerivativeVideoJob(params: StartDerivativeJobParams): DerivativeJobRecord {
  const jobId = `drv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const workDir = path.join(DERIVATIVE_BASE_DIR, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const rawTitle = String(
    params.blueprint.derivativeTitle ||
      (params.blueprint as unknown as { title?: string }).title ||
      'GaConPro_Derivative'
  );
  const safeTitle = rawTitle
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'GaConPro_Derivative';
  const fileName = `${safeTitle}_PhaiSinh.mp4`;

  const job: DerivativeJobRecord = {
    jobId,
    status: 'queued',
    progress: 5,
    stepLabel: 'Đang khởi tạo tiến trình tạo video phái sinh...',
    workDir,
    fileName,
    warnings: [],
    createdAt: Date.now(),
  };
  derivativeJobs.set(jobId, job);

  void runDerivativePipeline(job, params).catch((err: any) => {
    job.status = 'error';
    job.error = formatGeminiError(err);
    job.stepLabel = 'Tạo video thất bại';
  });

  return job;
}

async function runDerivativePipeline(job: DerivativeJobRecord, params: StartDerivativeJobParams): Promise<void> {
  const { blueprint, sources, visualMode, voice, keepSourceAudio, downloadSourceVideo } = params;
  const scenes = blueprint.scenes.slice(0, 24);
  if (scenes.length === 0) {
    throw new Error('Kịch bản không có phân cảnh nào để dựng video.');
  }

  const isVertical = blueprint.aspectRatio === '9:16';
  const targetW = isVertical ? 1080 : 1920;
  const targetH = isVertical ? 1920 : 1080;
  job.resolution = `${targetW}x${targetH}`;

  const effectiveVoiceMode: DerivativeVoiceMode =
    params.voiceMode || (voice === 'none' ? 'none' : 'ai_online');

  // 1. Voiceover generation (Online AI TTS or Offline System TTS)
  const sceneAudioPaths: (string | null)[] = new Array(scenes.length).fill(null);
  const sceneTargetDurations: number[] = scenes.map((s) => Math.max(3.5, Number(s.durationSec || 6)));
  const totalPlannedSec = sceneTargetDurations.reduce((a, b) => a + b, 0);

  if (effectiveVoiceMode === 'offline_system') {
    job.status = 'tts';
    job.progress = 10;
    job.stepLabel = `Đang tổng hợp giọng đọc Offline (0/${scenes.length} cảnh)...`;
    for (let i = 0; i < scenes.length; i += 1) {
      const sc = scenes[i];
      const wavPath = path.join(job.workDir, `voice_${i}.wav`);
      if (sc.narration.trim()) {
        const ok = await synthesizeOfflineVoiceWav(sc.narration, wavPath);
        if (ok) {
          sceneAudioPaths[i] = wavPath;
          const audioDur = await probeDurationSeconds(wavPath, job.workDir);
          if (audioDur > 0.5) {
            sceneTargetDurations[i] = Math.max(3.0, audioDur + 0.45);
          }
        }
      }
      job.stepLabel = `Đang tổng hợp giọng đọc Offline (${i + 1}/${scenes.length})...`;
      job.progress = 10 + Math.round(((i + 1) / scenes.length) * 24);
    }
  } else if (effectiveVoiceMode === 'ai_online' && voice !== 'none') {
    job.status = 'tts';
    job.progress = 10;
    job.stepLabel = `Đang tạo giọng đọc AI trực tuyến (0/${scenes.length} cảnh)...`;
    const ai = getGeminiClient();
    const stylePrompt =
      params.voiceStyle?.trim() || 'Clear, engaging video narrator with natural pacing';

    let nextIdx = 0;
    let completedTts = 0;
    const workers = Array.from({ length: Math.min(2, scenes.length) }, async () => {
      while (nextIdx < scenes.length) {
        const i = nextIdx++;
        const sc = scenes[i];
        const wavPath = path.join(job.workDir, `voice_${i}.wav`);
        let ok = await synthesizeSceneVoiceWav(ai, sc.narration, voice, stylePrompt, wavPath);
        if (!ok && sc.narration.trim()) {
          const offlineEngine = await detectOfflineTtsEngine();
          if (offlineEngine.available) {
            ok = await synthesizeOfflineVoiceWav(sc.narration, wavPath);
            if (ok) {
              job.warnings.push(`Cảnh ${i + 1}: Gemini TTS tạm bận (503), đã tự chuyển sang giọng đọc Offline (${offlineEngine.engine}).`);
            }
          }
        }
        if (ok) {
          sceneAudioPaths[i] = wavPath;
          const audioDur = await probeDurationSeconds(wavPath, job.workDir);
          if (audioDur > 0.5) {
            sceneTargetDurations[i] = Math.max(3.0, audioDur + 0.45);
          }
        } else if (sc.narration.trim()) {
          job.warnings.push(`Cảnh ${i + 1}: Không tạo được giọng đọc AI, giữ nhạc/nền tĩnh cho cảnh này.`);
        }
        completedTts += 1;
        job.stepLabel = `Đang tổng hợp giọng đọc AI (${completedTts}/${scenes.length})...`;
        job.progress = 10 + Math.round((completedTts / scenes.length) * 24);
      }
    });
    await Promise.all(workers);
  } else {
    job.progress = 32;
  }

  // 2. Gather visual assets (Omni clips, scene images, uploaded local videos, remote source videos, Wikimedia Commons, thumbnails)
  const downloadedSourceVideos = new Map<number, { path: string; duration: number; isBroll?: boolean }>();
  const sceneOmniVideos = new Map<number, { path: string; duration: number }>();
  const sceneCustomImages = new Map<number, string>();
  const sceneBrollVideos = new Map<number, { path: string; duration: number }>();
  const thumbnailPaths = new Map<number, string>();
  const usedBrollUrls = new Set<string>();
  const failedSourceReasons = new Map<number, string>();

  job.status = 'downloading';
  job.stepLabel = 'Đang chuẩn bị tư liệu hình ảnh & âm thanh...';

  // Save per-scene custom/AI images onto disk if present
  for (let i = 0; i < scenes.length; i += 1) {
    const sc = scenes[i];
    if (sc.sceneImageDataUrl) {
      const parsedImg = parseDataUrlToBuffer(sc.sceneImageDataUrl);
      if (parsedImg) {
        const ext = parsedImg.mimeType.includes('png') ? 'png' : 'jpg';
        const imgPath = path.join(job.workDir, `scene_img_${i}.${ext}`);
        fs.writeFileSync(imgPath, parsedImg.buffer);
        sceneCustomImages.set(i, imgPath);
      }
    }
    if (sc.omniClipAssetId) {
      const asset = getStudioAsset(sc.omniClipAssetId);
      if (asset) {
        sceneOmniVideos.set(i, { path: asset.filePath, duration: asset.durationSec || 8 });
      }
    }
  }

  // Generate missing Omni Flash clips if visualMode === 'gemini_omni'
  if (visualMode === 'gemini_omni') {
    for (let i = 0; i < scenes.length; i += 1) {
      if (sceneOmniVideos.has(i)) continue;
      const sc = scenes[i];
      job.stepLabel = `Đang tạo video cảnh ${i + 1}/${scenes.length} bằng Gemini Omni Flash...`;
      job.progress = 36 + Math.round(((i + 1) / scenes.length) * 20);
      const clipRes = await generateSceneVideoWithOmniFlash({
        prompt: `${sc.visualNote || sc.onScreenText}. ${sc.narration.slice(0, 140)}`,
        aspectRatio: blueprint.aspectRatio,
        durationSec: Math.min(15, Math.max(4, Math.round(sceneTargetDurations[i]))),
        sceneImageDataUrl: sc.sceneImageDataUrl,
        characterRefs: params.characterRefs,
      });
      const asset = getStudioAsset(clipRes.assetId);
      if (asset) {
        sceneOmniVideos.set(i, { path: asset.filePath, duration: asset.durationSec || 8 });
      }
    }
  }

  const referencedIndices = Array.from(
    new Set(scenes.map((s) => Math.max(0, Math.min(sources.length - 1, s.sourceVideoIndex))))
  );

  // Register uploaded local videos and fetch thumbnails for remote sources
  await Promise.all(
    referencedIndices.map(async (srcIdx) => {
      const src = sources[srcIdx];
      if (!src) return;
      if (src.localAssetId) {
        const asset = getStudioAsset(src.localAssetId);
        if (asset) {
          downloadedSourceVideos.set(srcIdx, {
            path: asset.filePath,
            duration: asset.durationSec > 0 ? asset.durationSec : 30,
          });
          return;
        }
      }
      const img = await fetchImageBuffer(src.pic);
      if (img) {
        const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('webp') ? 'webp' : 'jpg';
        const imgPath = path.join(job.workDir, `thumb_${srcIdx}.${ext}`);
        fs.writeFileSync(imgPath, img.buffer);
        thumbnailPaths.set(srcIdx, imgPath);
      }
    })
  );

  const brollPreference: BrollSourceId = params.brollSource || 'wikimedia';

  if (visualMode === 'remix' && downloadSourceVideo) {
    for (let k = 0; k < referencedIndices.length; k += 1) {
      const srcIdx = referencedIndices[k];
      if (downloadedSourceVideos.has(srcIdx)) continue; // already registered local uploaded video
      const src = sources[srcIdx];
      if (!src) continue;
      job.stepLabel = `Đang tải video nguồn #${srcIdx + 1} (${src.platformLabel}) để trích đoạn...`;
      job.progress = 38 + Math.round(((k + 1) / Math.max(1, referencedIndices.length)) * 14);
      const vidOutPath = path.join(job.workDir, `src_video_${srcIdx}.mp4`);
      let fallbackReason = '';
      try {
        const dlRes = await downloadSourceVideo(src, vidOutPath);
        const ok = typeof dlRes === 'boolean' ? dlRes : Boolean(dlRes?.ok);
        fallbackReason = typeof dlRes === 'object' && dlRes?.reason ? dlRes.reason : '';
        if (ok && fs.existsSync(vidOutPath) && fs.statSync(vidOutPath).size > 20_000) {
          const dur = await probeDurationSeconds(vidOutPath, job.workDir);
          downloadedSourceVideos.set(srcIdx, { path: vidOutPath, duration: dur > 0 ? dur : 30 });
          continue;
        }
      } catch (dlErr: any) {
        fallbackReason = String(dlErr?.message || '').trim();
      }
      failedSourceReasons.set(srcIdx, fallbackReason);
    }

    // Fetch distinct per-scene Wikimedia Commons / B-roll clips whenever a referenced source video is unavailable
    const scenesNeedingBroll = scenes.filter((sc, idx) => {
      if (sceneOmniVideos.has(idx) || sceneCustomImages.has(idx)) return false;
      const srcIdx = Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex));
      return !downloadedSourceVideos.has(srcIdx);
    });

    if (scenesNeedingBroll.length > 0 && brollPreference !== 'none') {
      const brollLabelUsed = new Set<string>();
      for (let bIdx = 0; bIdx < scenes.length; bIdx += 1) {
        if (sceneOmniVideos.has(bIdx) || sceneCustomImages.has(bIdx)) continue;
        const sc = scenes[bIdx];
        const srcIdx = Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex));
        if (downloadedSourceVideos.has(srcIdx)) continue;

        job.stepLabel = `Đang tìm video mẫu từ ${brollPreference === 'wikimedia' ? 'Wikimedia Commons' : 'kho B-roll'} cho cảnh ${bIdx + 1}/${scenes.length}...`;
        job.progress = 52 + Math.round(((bIdx + 1) / scenes.length) * 10);

        const src = sources[srcIdx];
        const brollPath = path.join(job.workDir, `scene_broll_${bIdx}.mp4`);
        const queries = [
          sc.brollKeywordEn || '',
          sc.visualNote || '',
          src?.translatedTitle || src?.title || '',
          blueprint.derivativeTitle || '',
        ].filter(Boolean);

        const brollRes = await tryDownloadBrollStockClip(brollPreference, queries, brollPath, usedBrollUrls);
        if (brollRes.ok && fs.existsSync(brollPath)) {
          const dur = await probeDurationSeconds(brollPath, job.workDir);
          sceneBrollVideos.set(bIdx, { path: brollPath, duration: dur > 0 ? dur : 12 });
          if (brollRes.label) brollLabelUsed.add(brollRes.label);
        }
      }

      for (const srcIdx of failedSourceReasons.keys()) {
        const src = sources[srcIdx];
        const reason = failedSourceReasons.get(srcIdx) || '';
        const hasAnySceneClip = scenes.some(
          (sc, idx) =>
            Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex)) === srcIdx &&
            sceneBrollVideos.has(idx)
        );
        if (hasAnySceneClip) {
          const labels = Array.from(brollLabelUsed).join(', ') || 'Wikimedia Commons';
          job.warnings.push(
            reason
              ? `Video nguồn #${srcIdx + 1} (${src?.platformLabel || ''}): ${reason} — đã tự động chèn các clip mẫu từ ${labels}.`
              : `Video nguồn #${srcIdx + 1} (${src?.platformLabel || ''}) chưa trích xuất được — đã tự động chèn các clip mẫu từ ${labels}.`
          );
        } else {
          job.warnings.push(
            reason
              ? `Video nguồn #${srcIdx + 1} (${src?.platformLabel || ''}): ${reason} — tự động chuyển sang ảnh chuyển động Ken Burns.`
              : `Video nguồn #${srcIdx + 1} (${src?.platformLabel || ''}) chưa trích xuất trực tiếp được — tự động chuyển sang ảnh chuyển động Ken Burns.`
          );
        }
      }
    } else if (failedSourceReasons.size > 0) {
      for (const [srcIdx, reason] of failedSourceReasons.entries()) {
        const src = sources[srcIdx];
        job.warnings.push(
          reason
            ? `Video nguồn #${srcIdx + 1} (${src?.platformLabel || ''}): ${reason} — tự động chuyển sang ảnh chuyển động Ken Burns.`
            : `Video nguồn #${srcIdx + 1} (${src?.platformLabel || ''}) chưa trích xuất trực tiếp được — tự động chuyển sang ảnh chuyển động Ken Burns.`
        );
      }
    }
  } else {
    job.progress = 56;
  }

  // Prepare background music track if requested
  let bgmLocalPath: string | null = null;
  const musicMode: DerivativeMusicMode = params.musicMode || 'none';
  if (musicMode !== 'none') {
    if (params.musicAssetId) {
      const rec = getStudioAsset(params.musicAssetId);
      if (rec) bgmLocalPath = rec.filePath;
    } else if (musicMode === 'ai_lyria') {
      job.stepLabel = 'Đang sáng tác nhạc nền AI bằng Lyria...';
      const track = await generateStudioMusicWithLyria({
        prompt: params.musicPrompt || `Cinematic instrumental soundtrack for: ${blueprint.derivativeTitle}`,
        mode: totalPlannedSec > 45 ? 'pro' : 'clip',
      });
      const rec = getStudioAsset(track.assetId);
      if (rec) bgmLocalPath = rec.filePath;
    } else if (musicMode === 'public_free' && params.publicMusicUrl) {
      job.stepLabel = 'Đang tải nhạc nền công cộng từ Wikimedia Commons...';
      try {
        const dl = await fetch(params.publicMusicUrl, {
          headers: { 'User-Agent': WIKIMEDIA_UA },
          signal: AbortSignal.timeout(30_000),
        });
        if (dl.ok) {
          const buf = Buffer.from(await dl.arrayBuffer());
          if (buf.byteLength > 10_000) {
            const bgmOut = path.join(job.workDir, 'public_bgm.audio');
            fs.writeFileSync(bgmOut, buf);
            bgmLocalPath = bgmOut;
          }
        }
      } catch {
        job.warnings.push('Không tải được nhạc nền công cộng đã chọn — giữ nguyên âm thanh thoại.');
      }
    }
  }

  // 3. Render each normalized scene clip (matching exact width, height, fps, audio)
  job.status = 'rendering';
  const sceneVideoFiles: string[] = [];
  const subtitleTimeline: { start: number; end: number; caption: string }[] = [];
  let cursorSec = 0;
  const encodePreset = totalPlannedSec >= 120 ? 'ultrafast' : 'veryfast';

  for (let i = 0; i < scenes.length; i += 1) {
    const sc = scenes[i];
    const srcIdx = Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex));
    const sceneDur = Number(sceneTargetDurations[i].toFixed(2));
    job.stepLabel = `Đang dựng phân cảnh ${i + 1}/${scenes.length} bằng FFmpeg...`;
    job.progress = 62 + Math.round(((i + 1) / scenes.length) * 26);

    const outScenePath = path.join(job.workDir, `scene_${i}.mp4`);
    const audioWav = sceneAudioPaths[i];
    const omniClip = sceneOmniVideos.get(i);
    const brollClip = sceneBrollVideos.get(i);
    const customImg = sceneCustomImages.get(i);
    const srcVideo = omniClip
      ? { path: omniClip.path, duration: omniClip.duration, isBroll: true }
      : customImg
      ? undefined
      : brollClip
      ? { path: brollClip.path, duration: brollClip.duration, isBroll: true }
      : visualMode === 'storyboard_motion'
      ? undefined
      : downloadedSourceVideos.get(srcIdx);
    const thumbFile = customImg || thumbnailPaths.get(srcIdx);

    const canvasFilter =
      `[0:v]split[bg][fg];` +
      `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=18:2,setsar=1[bgblur];` +
      `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fgfit];` +
      `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[vout]`;

    let args: string[] = [];

    if (srcVideo) {
      const needsLoop = srcVideo.duration <= sceneDur + 1;
      const startSec = needsLoop
        ? 0
        : Math.max(0, Math.min(srcVideo.duration - sceneDur - 0.5, (sc.sourceStartPercent / 100) * srcVideo.duration));
      const inputArgs = needsLoop
        ? ['-stream_loop', '-1', '-i', srcVideo.path]
        : ['-ss', startSec.toFixed(2), '-t', sceneDur.toFixed(2), '-i', srcVideo.path];

      if (audioWav && keepSourceAudio && !srcVideo.isBroll) {
        args = [
          '-y',
          ...inputArgs,
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${canvasFilter};[0:a]aresample=44100,volume=0.12[abg];[1:a]aresample=44100,volume=1.35[avoice];[abg][avoice]amix=inputs=2:duration=longest:dropout_transition=0.2[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-b:a',
          '160k',
          path.basename(outScenePath),
        ];
      } else if (audioWav) {
        args = [
          '-y',
          ...inputArgs,
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${canvasFilter};[1:a]aresample=44100,apad,volume=1.35[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-b:a',
          '160k',
          path.basename(outScenePath),
        ];
      } else {
        args = [
          '-y',
          ...inputArgs,
          '-f',
          'lavfi',
          '-t',
          sceneDur.toFixed(2),
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-filter_complex',
          canvasFilter,
          '-map',
          '[vout]',
          '-map',
          keepSourceAudio && !srcVideo.isBroll ? '0:a?' : '1:a',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      }
    } else if (thumbFile) {
      const frames = Math.max(90, Math.round(sceneDur * 30));
      const zoomExpr =
        i % 2 === 0
          ? `zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${targetW}x${targetH}:fps=30`
          : `zoompan=z='if(lte(zoom,1.0),1.18,max(1.0,zoom-0.0012))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${targetW}x${targetH}:fps=30`;

      const thumbFilter =
        `[0:v]split[bg][fg];` +
        `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=20:2,setsar=1[bgblur];` +
        `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[fgfit];` +
        `[bgblur][fgfit]overlay=(W-w)/2:(H-h)/2,${zoomExpr},format=yuv420p[vout]`;

      if (audioWav) {
        args = [
          '-y',
          '-loop',
          '1',
          '-i',
          path.basename(thumbFile),
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${thumbFilter};[1:a]aresample=44100,apad,volume=1.35[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          '-b:a',
          '160k',
          path.basename(outScenePath),
        ];
      } else {
        args = [
          '-y',
          '-loop',
          '1',
          '-i',
          path.basename(thumbFile),
          '-f',
          'lavfi',
          '-t',
          sceneDur.toFixed(2),
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-filter_complex',
          thumbFilter,
          '-map',
          '[vout]',
          '-map',
          '1:a',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-crf',
          '22',
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      }
    } else {
      const solidFilter = `color=c=#001722:s=${targetW}x${targetH}:d=${sceneDur.toFixed(2)}:r=30,format=yuv420p[vout]`;
      if (audioWav) {
        args = [
          '-y',
          '-i',
          path.basename(audioWav),
          '-filter_complex',
          `${solidFilter};[0:a]aresample=44100,apad,volume=1.35[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      } else {
        args = [
          '-y',
          '-f',
          'lavfi',
          '-t',
          sceneDur.toFixed(2),
          '-i',
          'anullsrc=r=44100:cl=stereo',
          '-filter_complex',
          solidFilter,
          '-map',
          '[vout]',
          '-map',
          '0:a',
          '-t',
          sceneDur.toFixed(2),
          '-c:v',
          'libx264',
          '-preset',
          encodePreset,
          '-c:a',
          'aac',
          '-ar',
          '44100',
          '-ac',
          '2',
          path.basename(outScenePath),
        ];
      }
    }

    let renderRes = await spawnPromise('ffmpeg', args, job.workDir, 300_000);
    if (renderRes.code !== 0 && srcVideo) {
      const noAudioFallbackArgs = [
        '-y',
        '-stream_loop',
        '-1',
        '-i',
        srcVideo.path,
        ...(audioWav
          ? ['-i', path.basename(audioWav)]
          : ['-f', 'lavfi', '-t', sceneDur.toFixed(2), '-i', 'anullsrc=r=44100:cl=stereo']),
        '-filter_complex',
        `${canvasFilter};[1:a]aresample=44100,apad[aout]`,
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-t',
        sceneDur.toFixed(2),
        '-c:v',
        'libx264',
        '-preset',
        encodePreset,
        '-crf',
        '22',
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-ac',
        '2',
        path.basename(outScenePath),
      ];
      renderRes = await spawnPromise('ffmpeg', noAudioFallbackArgs, job.workDir, 300_000);
    }

    if (renderRes.code !== 0 || !fs.existsSync(outScenePath)) {
      throw new Error(`FFmpeg lỗi khi dựng cảnh ${i + 1}: ${renderRes.stderr.slice(-260)}`);
    }

    const actualDur = (await probeDurationSeconds(outScenePath, job.workDir)) || sceneDur;
    subtitleTimeline.push({
      start: cursorSec,
      end: cursorSec + actualDur,
      caption: sc.onScreenText,
    });
    cursorSec += actualDur;
    sceneVideoFiles.push(path.basename(outScenePath));
  }

  // 4. Concatenate all scenes + burn ASS subtitles + mix optional background music + faststart
  job.stepLabel = bgmLocalPath
    ? 'Đang ghép video hoàn chỉnh, trộn nhạc nền & chèn phụ đề...'
    : 'Đang ghép hoàn thiện video phái sinh & chèn phụ đề...';
  job.progress = 91;

  const concatTxtPath = path.join(job.workDir, 'concat.txt');
  fs.writeFileSync(
    concatTxtPath,
    sceneVideoFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    'utf8'
  );

  const assContent = buildAssSubtitlesFile(targetW, targetH, blueprint.derivativeHook || '', subtitleTimeline);
  fs.writeFileSync(path.join(job.workDir, 'subtitles.ass'), assContent, 'utf8');

  const finalOutPath = path.join(job.workDir, 'final_derivative.mp4');
  const musicVol = Math.max(0.05, Math.min(0.6, Number(params.musicVolume ?? 0.18)));

  let finalArgs: string[] = [];
  if (bgmLocalPath && fs.existsSync(bgmLocalPath)) {
    finalArgs = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-stream_loop',
      '-1',
      '-i',
      bgmLocalPath,
      '-filter_complex',
      `[0:a]aresample=44100[avoice];[1:a]aresample=44100,volume=${musicVol.toFixed(2)}[abgm];[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=0.3[aout]`,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-vf',
      'ass=subtitles.ass',
      '-c:v',
      'libx264',
      '-preset',
      encodePreset,
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      'final_derivative.mp4',
    ];
  } else {
    finalArgs = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'concat.txt',
      '-vf',
      'ass=subtitles.ass',
      '-c:v',
      'libx264',
      '-preset',
      encodePreset,
      '-crf',
      '21',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      'final_derivative.mp4',
    ];
  }

  let finalRes = await spawnPromise('ffmpeg', finalArgs, job.workDir, 600_000);

  // Fallback without libass if libass fails
  if (finalRes.code !== 0 || !fs.existsSync(finalOutPath)) {
    job.warnings.push('FFmpeg không áp dụng được phụ đề libass, đã xuất video kèm đầy đủ âm thanh/nhạc nền.');
    const noAssArgs = bgmLocalPath && fs.existsSync(bgmLocalPath)
      ? [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          'concat.txt',
          '-stream_loop',
          '-1',
          '-i',
          bgmLocalPath,
          '-filter_complex',
          `[0:a]aresample=44100[avoice];[1:a]aresample=44100,volume=${musicVol.toFixed(2)}[abgm];[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=0.3[aout]`,
          '-map',
          '0:v',
          '-map',
          '[aout]',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          'final_derivative.mp4',
        ]
      : [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          'concat.txt',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          'final_derivative.mp4',
        ];
    finalRes = await spawnPromise('ffmpeg', noAssArgs, job.workDir, 240_000);
  }

  if (finalRes.code !== 0 || !fs.existsSync(finalOutPath)) {
    throw new Error(`Không thể xuất tệp video phái sinh: ${finalRes.stderr.slice(-260)}`);
  }

  const stat = fs.statSync(finalOutPath);
  const totalDuration = (await probeDurationSeconds(finalOutPath, job.workDir)) || cursorSec;

  job.outputPath = finalOutPath;
  job.fileSize = stat.size;
  job.durationSec = Math.round(totalDuration * 10) / 10;
  job.status = 'completed';
  job.progress = 100;
  job.stepLabel = 'Hoàn tất video phái sinh!';
}
