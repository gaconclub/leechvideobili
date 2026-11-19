import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { VideoPlatform } from './trending';
import {
  chatWithMuse2ApiSpark,
  generateImageViaMuse2Api,
  generateVideoBufferViaMuse2Api,
  getMuse2ApiStatus,
} from './muse2api';

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
  sceneIndex: number;
  sceneTitle?: string;
  sceneSummary?: string;
  durationSec: number;
  sourceVideoIndex: number;
  sourceStartPercent: number;
  onScreenText: string;
  charactersInScene?: string;
  settingDetail?: string;
  actionDetail?: string;
  cameraAngle?: string;
  lighting?: string;
  costume?: string;
  cameraMovement?: string;
  shotStyle?: string;
  dialogue?: string;
  narration: string;
  imagePrompt?: string;
  videoPrompt?: string;
  continuityNote?: string;
  sceneEndState?: string;
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
  mode?: StudioCreationMode;
  scriptMode?: StudioScriptMode;
  batchIndex?: number;
  batchTotal?: number;
  sharedSpiritNote?: string;
  targetDurationSec?: number;
  ideaPrompt?: string;
  videoStyle?: StudioVideoStyle;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
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
    raw.includes('timeout') ||
    raw.includes('aborted') ||
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
  if (rawUrl.includes('fbcdn.net') || rawUrl.includes('fbsbx.com') || rawUrl.includes('facebook.com')) {
    return 'https://www.facebook.com/';
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
  none: 'Tắt kiểu dẫn chuyện cố định (Sáng tạo tự do theo mạch câu chuyện/ý tưởng gốc)',
  summary_fast: 'Tóm tắt & Điểm tin nhanh gọn, nhịp cắt dứt khoát',
  storytelling_review: 'Kể chuyện / Review cuốn hút có mở bài - cao trào - kết luận',
  top_list: 'Tổng hợp Top điểm nổi bật / So sánh góc nhìn đa chiều',
  tips_tutorial: 'Chắt lọc mẹo hay & hướng dẫn thực hành dễ áp dụng',
};

function sanitizeJsonControlChars(input: string): string {
  const chunks: string[] = [];
  let spanStart = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (!inString) {
      if (code === 34) inString = true; // '"'
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (code === 92) {
      // '\\'
      escaped = true;
      continue;
    }
    if (code === 34) {
      inString = false;
      continue;
    }
    if (code < 32) {
      if (i > spanStart) chunks.push(input.slice(spanStart, i));
      if (code === 10) chunks.push('\\n');
      else if (code === 13) chunks.push('\\r');
      else if (code === 9) chunks.push('\\t');
      else chunks.push(' ');
      spanStart = i + 1;
    }
  }

  if (chunks.length === 0) return input;
  if (spanStart < input.length) chunks.push(input.slice(spanStart));
  return chunks.join('');
}

function closeContainerStack(stack: ('{' | '[')[]): string {
  let suffix = '';
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    suffix += stack[i] === '{' ? '}' : ']';
  }
  return suffix;
}

function trimTrailingBackslashes(str: string): string {
  let count = 0;
  for (let i = str.length - 1; i >= 0 && str[i] === '\\'; i -= 1) {
    count += 1;
  }
  return count % 2 === 1 ? str.slice(0, -1) : str;
}

export function parseAiBlueprintJsonSafe(rawText: string): any {
  const stripped = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const firstBrace = stripped.indexOf('{');
  const candidateBase = firstBrace >= 0 ? stripped.slice(firstBrace) : stripped;
  const sanitized = sanitizeJsonControlChars(candidateBase);

  try {
    return JSON.parse(sanitized);
  } catch (initialErr) {
    // Walk structure to track open containers, unclosed trailing string, and clean comma boundaries
    const stack: ('{' | '[')[] = [];
    const safeCommaCuts: { cutPos: number; stack: ('{' | '[')[] }[] = [];
    let inString = false;
    let escaped = false;
    let stringStart = -1;

    for (let i = 0; i < sanitized.length; i += 1) {
      const ch = sanitized[i];
      if (!inString) {
        if (ch === '"') {
          inString = true;
          stringStart = i;
        } else if (ch === '{' || ch === '[') {
          stack.push(ch);
        } else if (ch === '}' || ch === ']') {
          if (stack.length > 0) stack.pop();
        } else if (ch === ',') {
          safeCommaCuts.push({ cutPos: i, stack: [...stack] });
        }
        continue;
      }

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        stringStart = -1;
      }
    }

    // Strategy 1: If truncated mid-string (e.g. runaway repetition loop on one field), cap tail and close containers
    if (inString && stringStart >= 0 && stack.length > 0) {
      let head = sanitized;
      const tailLen = sanitized.length - stringStart - 1;
      if (tailLen > 750) {
        let cutAt = stringStart + 650;
        const spaceIdx = sanitized.lastIndexOf(' ', cutAt);
        if (spaceIdx > stringStart + 350) {
          cutAt = spaceIdx;
        }
        head = sanitized.slice(0, cutAt);
      }
      head = trimTrailingBackslashes(head);
      const closedCandidate = `${head}"${closeContainerStack(stack)}`;
      try {
        return JSON.parse(closedCandidate);
      } catch {
        // Fall through to Strategy 2
      }
    }

    // Strategy 2: Roll back to the most recent clean comma separator and close open containers
    for (let idx = safeCommaCuts.length - 1; idx >= 0 && idx >= safeCommaCuts.length - 25; idx -= 1) {
      const cut = safeCommaCuts[idx];
      const repaired = `${sanitized.slice(0, cut.cutPos)}${closeContainerStack(cut.stack)}`;
      try {
        return JSON.parse(repaired);
      } catch {
        // Keep backing up to an earlier valid cut boundary
      }
    }

    throw initialErr;
  }
}

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
  enableVoiceover: boolean;
  isDerivative: boolean;
}): Promise<any> {
  const cfg = resolveOpenAiCompatibleConfig(params.provider);
  if (!cfg.apiKey) {
    throw new Error(
      `Chưa phát hiện ${cfg.envName} trên máy chủ. Hãy thêm ${cfg.envName} trong Settings > Secrets (hoặc tệp .env trên máy).`
    );
  }

  const refBlock = params.isDerivative
    ? `
  "referenceAnalysis": {
    "mainTheme": "Nội dung & chủ đề chính của video tham chiếu",
    "plotProgression": "Cốt truyện & diễn biến nhịp chính",
    "characterTraits": "Nhân vật & đặc điểm nhận dạng trong video gốc",
    "settingAndSpace": "Bối cảnh & không gian video gốc",
    "visualStyle": "Phong cách hình ảnh video gốc",
    "cameraAndMovement": "Góc máy & chuyển động camera gốc",
    "lightingAndColor": "Ánh sáng & bảng màu gốc",
    "editingPacing": "Nhịp độ dựng phim",
    "dialogueAndAudio": "Lời thoại, âm thanh & giọng đọc gốc (nếu có)"
  },`
    : '';

  const schemaInstruction = `
TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON HỢP LỆ THEO CẤU TRÚC SAU (không markdown, không văn bản thừa):
{
  "learnedSummary": "Tóm tắt 2-3 câu ý tưởng cốt lõi / nội dung sáng tạo mới",
  "characterBible": "Character Reference: Mô tả cực chi tiết ngoại hình cố định từng nhân vật (tuổi, khuôn mặt, tóc, dáng, đặc điểm nhận diện)",
  "settingBible": "Environment Reference: Hồ sơ bối cảnh, địa điểm, kiến trúc, thời gian & môi trường xuyên suốt",
  "visualStyleBible": "Visual Style Reference: Phong cách hình ảnh, chất liệu, ống kính & bảng màu xuyên suốt",
  "costumeBible": "Costume Reference: Trang phục & phụ kiện chuẩn giữ nguyên giữa các cảnh",
  "continuityBible": "Story Continuity: Quy tắc mạch liên tục câu chuyện & trạng thái chuyển cảnh",${refBlock}
  "keyTakeaways": ["ý 1", "ý 2", "ý 3", "ý 4"],
  "hookFormula": "Công thức mở đầu & giữ chân",
  "sourceKeyPoints": ["1 câu điểm nhấn / bài học video #1"],
  "derivativeTitle": "Tiêu đề video mới hấp dẫn",
  "derivativeHook": "Câu hook tối đa 12 chữ hiện 3.5s đầu",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"],
  "scenes": [
    {
      "sceneIndex": 1,
      "sceneTitle": "Tên phân cảnh ngắn gọn",
      "sceneSummary": "Mô tả diễn biến chính của phân cảnh",
      "durationSec": ${params.avgSceneDur},
      "sourceVideoIndex": 0,
      "sourceStartPercent": 15,
      "charactersInScene": "Tên nhân vật xuất hiện trong cảnh",
      "settingDetail": "Không gian, địa điểm, thời gian cụ thể khớp Environment Reference",
      "actionDetail": "Hành vi và diễn biến cụ thể của nhân vật",
      "cameraAngle": "Cận cảnh / Trung cảnh / Toàn cảnh / Góc thấp / Góc cao...",
      "cameraMovement": "Tracking shot / Slow dolly-in / Handheld / Crane / Static...",
      "lighting": "Ánh sáng tự nhiên / Điện ảnh / Ngược sáng / Neon...",
      "costume": "Trang phục cụ thể khớp Costume Reference",
      "shotStyle": "Điện ảnh / Tài liệu / Anime / Quảng cáo...",
      "dialogue": "Lời thoại nhân vật nói trong cảnh (hoặc để trống nếu cảnh không thoại)",
      "narration": "${
        params.enableVoiceover
          ? `Nội dung lồng tiếng / thuyết minh tự nhiên (${params.wordsMin}-${params.wordsMax} chữ)`
          : ''
      }",
      "onScreenText": "Chữ phụ đề ngắn tối đa 12 chữ",
      "continuityNote": "Tiếp nối trực tiếp từ trạng thái cuối phân cảnh trước",
      "sceneEndState": "Trạng thái cuối cùng của nhân vật/vị trí/hành động khi kết thúc cảnh này",
      "imagePrompt": "Prompt hình ảnh CỰC KỲ CHI TIẾT mô tả đầy đủ nhân vật (ngoại hình + trang phục cố định), bối cảnh, hành động đóng khung, góc máy, ánh sáng, phong cách hình ảnh đồng nhất",
      "videoPrompt": "Prompt video CỰC KỲ CHI TIẾT mô tả hành động liên tục, chuyển động nhân vật, chuyển động camera (${'kiểu quay'}), ánh sáng, bối cảnh & trang phục đồng nhất với imagePrompt",
      "brollKeywordEn": "2-4 English keywords for Wikimedia Commons stock video lookup"
    }
  ]
}
BẮT BUỘC mảng "scenes" có ĐÚNG ${params.desiredScenes} phân cảnh đánh số sceneIndex lần lượt từ 1 đến ${params.desiredScenes} và nối tiếp liền mạch nhau.`;

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
  return parseAiBlueprintJsonSafe(rawContent);
}

export async function testAiProviderConnection(provider: AiProviderId): Promise<{ ok: boolean; message: string; model: string }> {
  if (provider === 'muse2api') {
    const st = await getMuse2ApiStatus();
    if (!st.reachable) {
      return {
        ok: false,
        model: 'muse-spark',
        message: st.error || `Không kết nối được tới dịch vụ Muse2API (${st.baseUrl}).`,
      };
    }
    if (st.status === 'auth_error') {
      return {
        ok: false,
        model: 'muse-spark',
        message: st.error || 'Sai MUSE2API_KEY hoặc chưa cấu hình trong Settings > Secrets / .env.',
      };
    }
    if (!st.ready) {
      return {
        ok: false,
        model: 'muse-spark',
        message: 'Muse2API đã kết nối nhưng chưa có tài khoản muse.ai hoạt động. Hãy thêm Cookie muse.ai ở mục Muse2API.',
      };
    }
    try {
      const reply = await chatWithMuse2ApiSpark([{ role: 'user', content: 'Trả lời đúng 1 cụm từ: Sẵn sàng' }], 45);
      return {
        ok: true,
        model: 'muse-spark',
        message: `Kết nối Muse2API (muse-spark · ${st.healthyAccounts || st.accountsCount} tài khoản) thành công: "${reply.slice(0, 40)}"`,
      };
    } catch (err: any) {
      return {
        ok: false,
        model: 'muse-spark',
        message: err?.message || 'Muse2API đã bật nhưng gọi muse-spark thất bại.',
      };
    }
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

const STUDIO_VIDEO_STYLE_META: Record<
  StudioVideoStyle,
  { labelVi: string; promptDirective: string; visualToneVi: string }
> = {
  professional: {
    labelVi: 'Chuyên nghiệp (Studio / Doanh nghiệp)',
    promptDirective:
      'Ultra-clean professional commercial studio photography & 4K broadcast production style, crisp sharp focus, balanced studio key lighting, refined corporate/editorial color grading, consistent real-world proportions',
    visualToneVi: 'Phong cách chuyên nghiệp, sắc nét chuẩn studio truyền hình, ánh sáng cân bằng hiện đại',
  },
  cinematic: {
    labelVi: 'Điện ảnh (Cinematic 35mm)',
    promptDirective:
      'Cinematic film production still, shot on 35mm anamorphic lens, shallow depth of field, rich filmic color grading, dramatic volumetric lighting and atmospheric rim light, high production value',
    visualToneVi: 'Phong cách điện ảnh 35mm, chiều sâu trường ảnh, ánh sáng kịch tính giàu cảm xúc',
  },
  anime: {
    labelVi: 'Anime (Hoạt hình Nhật Bản 2D)',
    promptDirective:
      'High-detail Japanese 2D anime animation art style, crisp clean linework, vibrant cel-shaded lighting, expressive anime eyes and proportions, Makoto Shinkai / Ufotable inspired atmospheric backgrounds, identical character sheet across every frame',
    visualToneVi: 'Phong cách Anime 2D Nhật Bản sắc nét, màu sắc sống động, đồng bộ tạo hình nhân vật',
  },
  stickman: {
    labelVi: 'Người que (Stickman / Minimalist Animation)',
    promptDirective:
      'Clean 2D stickman (stick-figure) explainer animation style: expressive minimalist black-ink stick-figure characters with clear round heads, distinct simple accessories/hair/outfit markers for character identity, clean crisp vector background with subtle soft color accents, high contrast, easy-to-read visual storytelling',
    visualToneVi: 'Hoạt hình người que (Stickman) nét vẽ tối giản rõ ràng, biểu cảm sinh động trên nền sạch',
  },
  '3d_animation': {
    labelVi: 'Hoạt hình 3D (Stylized CGI)',
    promptDirective:
      'High-end 3D stylized CGI animation (modern Pixar / Unreal Engine 5 look), soft global illumination, subsurface scattering skin textures, expressive 3D character rig with locked proportions and outfit',
    visualToneVi: 'Hoạt hình 3D CGI mượt mà, ánh sáng khối mềm mại chuẩn phim hoạt hình hiện đại',
  },
  documentary: {
    labelVi: 'Tài liệu / Phóng sự (Documentary)',
    promptDirective:
      'Authentic documentary cinematography, natural handheld realism, observational natural lighting, realistic environments and candid details, crisp journalistic clarity',
    visualToneVi: 'Phong cách phim tài liệu phóng sự chân thực, ánh sáng tự nhiên sắc nét',
  },
  comic: {
    labelVi: 'Truyện tranh / Minh họa (Comic Art)',
    promptDirective:
      'Graphic novel & modern digital comic illustration style, bold ink contours, dynamic framing, halftone & cel-shaded coloring, cohesive comic universe palette',
    visualToneVi: 'Phong cách truyện tranh minh họa nét mực đậm, bố cục khung hình năng động',
  },
  vlog: {
    labelVi: 'Vlog / Đời thực tự nhiên',
    promptDirective:
      'Natural lifestyle creator vlog aesthetic, warm daylight, candid eye-level camera framing, authentic cozy environment, realistic skin and textures',
    visualToneVi: 'Phong cách Vlog đời thực gần gũi, ánh sáng tự nhiên chân thật',
  },
};

export function compileConsistentScenePrompt(params: {
  scene: Partial<DerivativeScene>;
  videoStyle?: StudioVideoStyle;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  totalScenes?: number;
  mediaType?: 'image' | 'video';
}): string {
  const styleKey: StudioVideoStyle =
    params.videoStyle && params.videoStyle in STUDIO_VIDEO_STYLE_META ? params.videoStyle : 'cinematic';
  const styleMeta = STUDIO_VIDEO_STYLE_META[styleKey];
  const sc = params.scene;
  const mediaType = params.mediaType || 'image';
  const parts: string[] = [];

  parts.push(`Visual Style Reference: ${styleMeta.promptDirective}.`);
  if (params.visualStyleBible?.trim()) {
    parts.push(`Color & Aesthetic Lock: ${params.visualStyleBible.trim()}.`);
  }
  if (params.characterBible?.trim()) {
    parts.push(`Character Reference (MUST keep face, hair, age, body 100% identical): ${params.characterBible.trim()}.`);
  }
  if (params.costumeBible?.trim()) {
    parts.push(`Costume Reference: ${params.costumeBible.trim()}.`);
  }
  if (params.settingBible?.trim()) {
    parts.push(`Environment Reference: ${params.settingBible.trim()}.`);
  }
  if (params.continuityBible?.trim()) {
    parts.push(`Story Continuity Anchor: ${params.continuityBible.trim()}.`);
  }
  const sceneNumLabel = sc.sceneIndex
    ? `Scene ${String(sc.sceneIndex).padStart(2, '0')}${params.totalScenes ? `/${String(params.totalScenes).padStart(2, '0')}` : ''}`
    : 'Scene';
  if (sc.sceneTitle?.trim()) {
    parts.push(`${sceneNumLabel} Title: ${sc.sceneTitle.trim()}.`);
  }
  if (sc.charactersInScene?.trim()) {
    parts.push(`Characters Present: ${sc.charactersInScene.trim()}.`);
  }
  if (sc.continuityNote?.trim()) {
    parts.push(`Continuity From Previous Scene: ${sc.continuityNote.trim()}.`);
  }
  if (sc.costume?.trim()) {
    parts.push(`Costume in Scene: ${sc.costume.trim()}.`);
  }
  if (sc.settingDetail?.trim()) {
    parts.push(`Environment/Setting: ${sc.settingDetail.trim()}.`);
  }
  if (sc.actionDetail?.trim()) {
    parts.push(`Action: ${sc.actionDetail.trim()}.`);
  }
  if (sc.cameraAngle?.trim()) {
    parts.push(`Camera Angle: ${sc.cameraAngle.trim()}.`);
  }
  if (sc.cameraMovement?.trim()) {
    parts.push(`Camera Movement: ${sc.cameraMovement.trim()}.`);
  }
  if (sc.lighting?.trim()) {
    parts.push(`Lighting: ${sc.lighting.trim()}.`);
  }
  if (sc.shotStyle?.trim()) {
    parts.push(`Shot Style: ${sc.shotStyle.trim()}.`);
  }

  const primaryPrompt =
    mediaType === 'video'
      ? sc.videoPrompt?.trim() || sc.imagePrompt?.trim() || sc.visualNote?.trim()
      : sc.imagePrompt?.trim() || sc.visualNote?.trim() || sc.videoPrompt?.trim();

  if (primaryPrompt) {
    parts.push(`${mediaType === 'video' ? 'Detailed Video Prompt' : 'Detailed Image Prompt'}: ${primaryPrompt}.`);
  } else if (sc.sceneSummary?.trim() || sc.onScreenText?.trim()) {
    parts.push(`Core Subject: ${(sc.sceneSummary || sc.onScreenText || '').trim()}.`);
  }
  if (mediaType === 'video' && sc.sceneEndState?.trim()) {
    parts.push(`Ending State: ${sc.sceneEndState.trim()}.`);
  }
  return parts.join(' ');
}

export interface IndependentConceptOverride {
  title: string;
  premise: string;
  characterBible: string;
  settingBible: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  hookFormula?: string;
  derivativeHook?: string;
  sharedSpiritNote?: string;
  avoidTitles?: string[];
  batchIndex: number;
  batchTotal: number;
}

function resolveDesiredSceneCount(
  desiredTotalSec: number,
  explicitSceneCount?: number,
  scriptMode: StudioScriptMode = 'series'
): number {
  if (typeof explicitSceneCount === 'number' && Number.isFinite(explicitSceneCount) && explicitSceneCount >= 2) {
    return Math.max(2, Math.min(24, Math.round(explicitSceneCount)));
  }
  if (scriptMode === 'series') {
    return 10;
  }
  if (desiredTotalSec <= 15) return 3;
  if (desiredTotalSec <= 25) return 4;
  if (desiredTotalSec <= 35) return 5;
  if (desiredTotalSec <= 50) return 6;
  if (desiredTotalSec <= 90) return 8;
  if (desiredTotalSec <= 150) return 10;
  if (desiredTotalSec <= 240) return 12;
  if (desiredTotalSec <= 360) return 16;
  return 20;
}

export async function learnVideosAndCreateBlueprint(params: {
  mode?: StudioCreationMode;
  scriptMode?: StudioScriptMode;
  ideaPrompt?: string;
  query?: string;
  videos?: DerivativeSourceInput[];
  stylePreset?: DerivativeStylePreset;
  videoStyle?: StudioVideoStyle;
  aspectRatio: DerivativeAspectRatio;
  targetDurationSec?: number;
  targetDuration?: 'short' | 'medium';
  desiredSceneCount?: number;
  outputLanguage?: DerivativeOutputLanguage;
  useProModel?: boolean;
  characterSummary?: string;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  customInstruction?: string;
  enableVoiceover?: boolean;
  aiProvider?: AiProviderId;
  preGatheredContexts?: EnrichedVideoContext[];
  conceptOverride?: IndependentConceptOverride;
}): Promise<DerivativeBlueprint> {
  const studioMode: StudioCreationMode = params.mode === 'creative' ? 'creative' : 'derivative';
  const scriptMode: StudioScriptMode = params.scriptMode === 'independent_batch' ? 'independent_batch' : 'series';
  const videosList = Array.isArray(params.videos) ? params.videos : [];
  const ideaText = (params.ideaPrompt || params.query || '').trim();
  const activeStylePreset: DerivativeStylePreset =
    params.stylePreset && params.stylePreset in STYLE_LABELS ? params.stylePreset : 'none';

  if (!params.preGatheredContexts) {
    if (studioMode === 'creative') {
      if (!ideaText && !params.customInstruction?.trim()) {
        throw new Error('Vui lòng nhập ý tưởng hoặc mô tả chủ đề để Studio Sáng Tạo lên kịch bản.');
      }
    } else if (videosList.length === 0) {
      throw new Error('Vui lòng chọn hoặc tải lên ít nhất 1 video tham chiếu để AI học nội dung.');
    }
  }

  const provider: AiProviderId =
    params.aiProvider === 'openai' || params.aiProvider === 'meta' || params.aiProvider === 'muse2api'
      ? params.aiProvider
      : 'gemini';

  const videoStyle: StudioVideoStyle =
    params.videoStyle && params.videoStyle in STUDIO_VIDEO_STYLE_META ? params.videoStyle : 'cinematic';
  const videoStyleMeta = STUDIO_VIDEO_STYLE_META[videoStyle];

  const contexts = params.preGatheredContexts
    ? params.preGatheredContexts
    : videosList.length > 0
    ? await gatherSourceContexts(videosList)
    : [];

  const rawSec =
    typeof params.targetDurationSec === 'number' && Number.isFinite(params.targetDurationSec)
      ? params.targetDurationSec
      : params.targetDuration === 'medium'
      ? 45
      : 30;
  const desiredTotalSec = Math.max(10, Math.min(900, Math.round(rawSec)));

  const desiredScenes = resolveDesiredSceneCount(
    desiredTotalSec,
    params.desiredSceneCount,
    params.conceptOverride ? 'independent_batch' : scriptMode
  );

  const avgSceneDur = Math.max(2, Math.min(45, Math.round(desiredTotalSec / desiredScenes)));
  const wordsMin = Math.max(6, Math.min(90, Math.round(avgSceneDur * 1.9)));
  const wordsMax = Math.max(wordsMin + 5, Math.min(115, Math.round(avgSceneDur * 2.55)));
  const outputLang: DerivativeOutputLanguage = params.outputLanguage || 'vi';
  const enableVoiceover = params.enableVoiceover !== false;

  const parts: any[] = [];

  for (const ctx of contexts) {
    if (ctx.source.keyframes && ctx.source.keyframes.length > 0) {
      parts.push({
        text: `[Các khung hình trích xuất từ Video tham chiếu #${ctx.index + 1}: ${ctx.source.title}]`,
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
      `=== VIDEO THAM CHIẾU #${ctx.index + 1} (index=${ctx.index}) ===`,
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

  const modeHeader =
    studioMode === 'creative'
      ? `NGUỒN ĐẦU VÀO: STUDIO SÁNG TẠO TỪ Ý TƯỞNG VĂN BẢN.
Ý tưởng / Chủ đề người dùng nhập: "${ideaText}".`
      : `NGUỒN ĐẦU VÀO: TẠO VIDEO PHÁI SINH TỪ ${contexts.length} VIDEO THAM CHIẾU.
Định hướng mở rộng từ người dùng: "${ideaText || 'Phân tích chuyên sâu video tham chiếu để phát triển kịch bản sáng tạo mới'}".
NGUYÊN TẮC BẮT BUỘC VỚI VIDEO PHÁI SINH:
- Trước tiên phải phân tích chi tiết 9 chiều video tham chiếu vào object "referenceAnalysis" (nội dung & chủ đề chính, cốt truyện & diễn biến, nhân vật & đặc điểm nhận dạng, bối cảnh & không gian, phong cách hình ảnh, góc máy & chuyển động camera, ánh sáng & màu sắc, nhịp độ dựng phim, lời thoại/âm thanh).
- Video phái sinh PHẢI là nội dung SÁNG TẠO MỚI có giá trị riêng, tuyệt đối KHÔNG sao chép nguyên xi từng cảnh trong video gốc; chỉ kế thừa tinh thần, chủ đề hoặc phong cách đã chọn.`;

  const scriptModeDirective = params.conceptOverride
    ? `CHẾ ĐỘ KỊCH BẢN: VIDEO ĐỘC LẬP #${params.conceptOverride.batchIndex}/${params.conceptOverride.batchTotal} TRONG CÙNG CHỦ ĐỀ.
NGUYÊN TẮC BẮT BUỘC:
- Đây là MỘT VIDEO ĐỘC LẬP hoàn chỉnh (Mở đầu - Diễn biến - Kết thúc riêng biệt), KHÔNG phải phần cắt nhỏ hay tập nối tiếp của các video khác.
- Cốt truyện riêng phải triển khai cho Video #${params.conceptOverride.batchIndex}:
  + Tiêu đề định hướng: "${params.conceptOverride.title}"
  + Ý tưởng cốt truyện riêng: "${params.conceptOverride.premise}"
  + Nhân vật riêng của video này: "${params.conceptOverride.characterBible}"
  + Bối cảnh riêng của video này: "${params.conceptOverride.settingBible}"
- Tuyệt đối KHÔNG lặp lại tình tiết của các video khác trong lô: ${params.conceptOverride.avoidTitles?.join(' | ') || 'Không trùng lặp'}.
- Vẫn giữ tinh thần, cảm xúc và phong cách hình ảnh "${videoStyleMeta.labelVi}" đồng nhất với chủ đề gốc (${params.conceptOverride.sharedSpiritNote || ideaText}).`
    : `CHẾ ĐỘ KỊCH BẢN: SERIES PHIM / CÂU CHUYỆN XUYÊN SUỐT (${desiredScenes} PHÂN CẢNH LIÊN TIẾP).
NGUYÊN TẮC CỐT LÕI CHẾ ĐỘ SERIES:
- Người dùng đang muốn KỂ MỘT CÂU CHUYỆN XUYÊN SUỐT bằng chuỗi ${desiredScenes} phân cảnh liên tiếp gắn kết chặt chẽ với nhau.
- Diễn biến từng phân cảnh (Scene 01 → Scene ${String(desiredScenes).padStart(2, '0')}) phải tuân thủ tiến trình cốt truyện logic, hành động và trạng thái cuối cảnh trước phải nối tiếp trực tiếp sang cảnh sau.
- Nhân vật chính, ngoại hình, trang phục và đặc điểm nhận dạng PHẢI duy trì đồng nhất 100% xuyên suốt.`;

  const narrativeStyleDirective =
    activeStylePreset === 'none'
      ? 'Kiểu dẫn chuyện: TẮT (Không ép công thức dẫn chuyện mẫu — triển khai mạch truyện/ngôn ngữ tự nhiên bám sát ý tưởng và thể loại).'
      : `Kiểu dẫn chuyện: ${STYLE_LABELS[activeStylePreset]}.`;

  const lockedProjectAnchors = [
    params.conceptOverride?.characterBible || params.characterBible?.trim()
      ? `- Character Reference (Nhân vật chuẩn): ${params.conceptOverride?.characterBible || params.characterBible?.trim()}`
      : '',
    params.conceptOverride?.settingBible || params.settingBible?.trim()
      ? `- Environment Reference (Bối cảnh chuẩn): ${params.conceptOverride?.settingBible || params.settingBible?.trim()}`
      : '',
    params.conceptOverride?.visualStyleBible || params.visualStyleBible?.trim()
      ? `- Visual Style Reference (Phong cách & bảng màu chuẩn): ${params.conceptOverride?.visualStyleBible || params.visualStyleBible?.trim()}`
      : '',
    params.conceptOverride?.costumeBible || params.costumeBible?.trim()
      ? `- Costume Reference (Trang phục & phụ kiện chuẩn): ${params.conceptOverride?.costumeBible || params.costumeBible?.trim()}`
      : '',
    params.conceptOverride?.continuityBible || params.continuityBible?.trim()
      ? `- Story Continuity (Quy tắc liên tục): ${params.conceptOverride?.continuityBible || params.continuityBible?.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const promptText = `Bạn là Hệ thống Đạo diễn AI Thống Nhất — chuyên biên kịch & thiết kế hồ sơ sản xuất video hoàn chỉnh.
${modeHeader}
${scriptModeDirective}
${narrativeStyleDirective}
Phong cách hình ảnh & quay dựng BẮT BUỘC: ${videoStyleMeta.labelVi} (${videoStyleMeta.visualToneVi} | Prompt style: ${videoStyleMeta.promptDirective}).
Ngôn ngữ lời thoại & phụ đề BẮT BUỘC: ${OUTPUT_LANG_LABELS[outputLang]}.
Tỷ lệ khung hình mục tiêu: ${params.aspectRatio}.
Tùy chọn Lồng tiếng (Voiceover): ${
    enableVoiceover
      ? `BẬT LỒNG TIẾNG — Tạo nội dung "narration" tự nhiên (${wordsMin}-${wordsMax} chữ/cảnh) đồng bộ với "dialogue", nhân vật và ngôn ngữ.`
      : 'TẮT LỒNG TIẾNG — BẮT BUỘC đặt "narration": "" (chuỗi rỗng) cho TẤT CẢ mọi phân cảnh, KHÔNG tạo dữ liệu giọng thuyết minh thừa; tập trung diễn đạt qua hình ảnh, hành động, lời thoại nhân vật (nếu có) và phụ đề ngắn.'
  }
Tổng thời lượng mục tiêu BẮT BUỘC: khoảng ${targetMinutesLabel} chia thành ĐÚNG ${desiredScenes} phân cảnh đánh số lần lượt 1..${desiredScenes} (trung bình ~${avgSceneDur}s/cảnh).
${params.characterSummary?.trim() ? `Ảnh/Ghi chú nhân vật người dùng đính kèm: ${params.characterSummary.trim()}` : ''}
${lockedProjectAnchors ? `\nHỒ SƠ DỰ ÁN ĐÃ KHÓA (BẮT BUỘC GIỮ NGUYÊN ĐỒNG BỘ):\n${lockedProjectAnchors}` : ''}
${params.customInstruction?.trim() ? `Yêu cầu bổ sung từ đạo diễn: ${params.customInstruction.trim()}` : ''}

TIÊU CHUẨN CHẤT LƯỢNG BẮT BUỘC (KHÔNG ĐƯỢC VIẾT SƠ SÀI):
1. Xây dựng BỘ DỮ LIỆU ĐỒNG BỘ 5 THÀNH PHẦN (Mục 2.6):
   - \`characterBible\` (Character Reference): Mô tả cực chi tiết nhân dạng cố định từng nhân vật (độ tuổi, gương mặt, màu/kiểu tóc, vóc dáng, đặc điểm nhận diện).
   - \`settingBible\` (Environment Reference): Mô tả chi tiết không gian, kiến trúc, thời gian, bối cảnh chủ đạo.
   - \`visualStyleBible\` (Visual Style Reference): Phong cách hình ảnh, chất liệu kết xuất, bảng màu & ngôn ngữ ánh sáng xuyên suốt.
   - \`costumeBible\` (Costume Reference): Trang phục, màu sắc vải & phụ kiện cố định từng nhân vật.
   - \`continuityBible\` (Story Continuity): Mạch cốt truyện liên tục & quy tắc nối tiếp hành động giữa các cảnh.
2. Đánh số thứ tự ĐÚNG ${desiredScenes} phân cảnh (\`sceneIndex\`: 1..${desiredScenes}) với ĐẦY ĐỦ 15 TRƯỜNG DỮ LIỆU CHUYÊN SÂU:
   - \`sceneTitle\`: Tên phân cảnh ngắn gọn (3-8 chữ).
   - \`sceneSummary\`: Mô tả nội dung diễn biến chính của phân cảnh.
   - \`charactersInScene\`: Tên các nhân vật xuất hiện trong cảnh.
   - \`settingDetail\`: Không gian, địa điểm, thời gian cụ thể đồng bộ \`settingBible\`.
   - \`actionDetail\`: Hành vi và diễn biến cụ thể của nhân vật.
   - \`costume\`: Trang phục cụ thể đồng bộ \`costumeBible\`.
   - \`cameraAngle\`: Góc máy cụ thể (Cận cảnh, Trung cảnh, Toàn cảnh, Góc thấp, Góc cao, Qua vai...).
   - \`cameraMovement\`: Kiểu quay / chuyển động máy cụ thể (Tracking shot, Slow dolly-in, Handheld, Crane, Pan, Static...).
   - \`lighting\`: Ánh sáng cụ thể (Ánh sáng tự nhiên, Điện ảnh ngược sáng rim light, Studio key light, Neon...).
   - \`shotStyle\`: Phong cách quay (Điện ảnh 35mm, Tài liệu, Anime, Hoạt hình 3D, Quảng cáo, Người que...).
   - \`dialogue\`: Nội dung nhân vật trực tiếp nói (nếu có nhân vật đối thoại/độc thoại; để "" nếu cảnh câm).
   - \`narration\`: ${enableVoiceover ? `Nội dung thuyết minh / lồng tiếng giọng dẫn (${wordsMin}-${wordsMax} chữ)` : 'BẮT BUỘC để chuỗi rỗng "" vì đã tắt lồng tiếng'}.
   - \`onScreenText\`: Chữ phụ đề hiển thị ngắn gọn (<= 12 chữ).
   - \`continuityNote\`: Nối tiếp trực tiếp từ trạng thái cuối của phân cảnh trước (\`sceneEndState\` của Scene trước).
   - \`sceneEndState\`: Trạng thái cuối cùng khi kết thúc cảnh này (vị trí nhân vật, biểu cảm, đạo cụ, thời điểm) để Scene tiếp theo nối vào hợp lý.
   - \`imagePrompt\`: Prompt hình ảnh CỰC KỲ CHI TIẾT (tối thiểu 2-3 câu giàu dữ liệu thị giác: nêu rõ ngoại hình + trang phục cố định từ Character/Costume Reference, tư thế/hành động đóng khung, bối cảnh, vật thể xung quanh, góc máy, ánh sáng, chất liệu & phong cách hình ảnh) để AI tạo ảnh ra đúng một bộ phim thống nhất.
   - \`videoPrompt\`: Prompt video CỰC KỲ CHI TIẾT (tối thiểu 2-3 câu mô tả hành động chuyển động mượt mà của nhân vật, biểu cảm thay đổi, chuyển động vật lý xung quanh, kiểu quay/camera movement, góc máy, ánh sáng và trang phục ĐỒNG NHẤT 100% với \`imagePrompt\`).
   - \`brollKeywordEn\`: 2-4 từ khóa tiếng Anh tìm tư liệu minh họa.
${contexts.length > 0 ? `\nDỮ LIỆU CÁC VIDEO THAM CHIẾU:\n${dossierLines.join('\n\n')}` : ''}`;

  parts.push({ text: promptText });

  const geminiModel = params.useProModel ? 'gemini-4-argon' : 'gemini-4-hydrogen';

  try {
    let parsed: any = {};
    let usedModel = geminiModel;

    if (provider === 'muse2api') {
      const st = await getMuse2ApiStatus();
      if (!st.reachable || !st.ready) {
        throw new Error(
          st.error ||
            'Muse2API chưa sẵn sàng hoặc chưa có tài khoản muse.ai hợp lệ. Hãy kiểm tra phần Quản lý Muse2API trong Thiết lập.'
        );
      }
      usedModel = 'muse-spark (Muse2API)';
      const museRefBlock =
        studioMode === 'derivative'
          ? `
  "referenceAnalysis": {
    "mainTheme": "Chủ đề chính video gốc",
    "plotProgression": "Diễn biến cốt truyện gốc",
    "characterTraits": "Đặc điểm nhân vật gốc",
    "settingAndSpace": "Bối cảnh không gian gốc",
    "visualStyle": "Phong cách hình ảnh gốc",
    "cameraAndMovement": "Góc máy & chuyển động gốc",
    "lightingAndColor": "Ánh sáng & màu sắc gốc",
    "editingPacing": "Nhịp độ dựng gốc",
    "dialogueAndAudio": "Lời thoại & âm thanh gốc"
  },`
          : '';
      const museSchemaInstruction = `
TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON HỢP LỆ THEO CẤU TRÚC SAU (tuyệt đối không markdown ngoài JSON, không giải thích thừa):
{
  "learnedSummary": "Tóm tắt 2-3 câu ý tưởng cốt lõi",
  "characterBible": "Character Reference cố định xuyên suốt toàn bộ các phân cảnh",
  "settingBible": "Environment Reference cố định xuyên suốt",
  "visualStyleBible": "Visual Style Reference xuyên suốt",
  "costumeBible": "Costume Reference xuyên suốt",
  "continuityBible": "Story Continuity xuyên suốt",${museRefBlock}
  "keyTakeaways": ["ý 1", "ý 2", "ý 3", "ý 4"],
  "hookFormula": "Công thức mở đầu & giữ chân",
  "sourceKeyPoints": ["1 câu điểm nhấn #1"],
  "derivativeTitle": "Tiêu đề video mới",
  "derivativeHook": "Câu hook tối đa 12 chữ hiện 3.5s đầu",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"],
  "scenes": [
    {
      "sceneIndex": 1,
      "sceneTitle": "Tên phân cảnh",
      "sceneSummary": "Diễn biến chính phân cảnh",
      "durationSec": ${avgSceneDur},
      "sourceVideoIndex": 0,
      "sourceStartPercent": 15,
      "charactersInScene": "Nhân vật xuất hiện",
      "settingDetail": "Bối cảnh, địa điểm, thời gian",
      "actionDetail": "Hành vi và diễn biến cụ thể",
      "cameraAngle": "Góc máy cụ thể",
      "cameraMovement": "Kiểu quay cụ thể",
      "lighting": "Ánh sáng cụ thể",
      "costume": "Trang phục cụ thể đồng bộ",
      "shotStyle": "Phong cách quay",
      "dialogue": "Lời thoại nhân vật",
      "narration": "${enableVoiceover ? `Lồng tiếng ${wordsMin}-${wordsMax} chữ` : ''}",
      "onScreenText": "Chữ phụ đề ngắn <= 12 chữ",
      "continuityNote": "Liên kết từ trạng thái cuối cảnh trước",
      "sceneEndState": "Trạng thái cuối cảnh này",
      "imagePrompt": "Prompt hình ảnh cực chi tiết đồng bộ 100% nhân vật, trang phục, bối cảnh, ánh sáng, góc máy, phong cách",
      "videoPrompt": "Prompt video cực chi tiết hành động, chuyển động camera & đồng bộ với imagePrompt",
      "brollKeywordEn": "2-4 English keywords"
    }
  ]
}
BẮT BUỘC mảng "scenes" có ĐÚNG ${desiredScenes} phân cảnh đánh số sceneIndex từ 1 đến ${desiredScenes}.`;

      const rawMuseReply = await chatWithMuse2ApiSpark([
        {
          role: 'system',
          content:
            'Bạn là Đạo diễn sáng tạo nội dung video chuyên nghiệp. Luôn phản hồi DUY NHẤT 1 đối tượng JSON thuần túy hợp lệ đúng schema, không lặp chữ vô hạn, không viết giải thích bên ngoài JSON.',
        },
        {
          role: 'user',
          content: `${promptText}\n\n${museSchemaInstruction}`,
        },
      ]);
      parsed = parseAiBlueprintJsonSafe(rawMuseReply);
    } else if (provider === 'openai' || provider === 'meta') {
      usedModel = resolveOpenAiCompatibleConfig(provider).model;
      parsed = await generateBlueprintViaOpenAiCompatible({
        provider,
        contexts,
        promptText,
        desiredScenes,
        avgSceneDur,
        wordsMin,
        wordsMax,
        enableVoiceover,
        isDerivative: studioMode === 'derivative',
      });
    } else {
      const ai = getGeminiClient();
      const candidateModels = params.useProModel
        ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
        : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

      const compactParts = parts.filter((p, idx) => p.text || idx < 2);
      let parsedFromGemini: any = null;
      let lastGeminiErr: any = null;

      const geminiSchemaProperties: Record<string, any> = {
        learnedSummary: { type: Type.STRING },
        characterBible: { type: Type.STRING },
        settingBible: { type: Type.STRING },
        visualStyleBible: { type: Type.STRING },
        costumeBible: { type: Type.STRING },
        continuityBible: { type: Type.STRING },
        ...(studioMode === 'derivative'
          ? {
              referenceAnalysis: {
                type: Type.OBJECT,
                required: [
                  'mainTheme',
                  'plotProgression',
                  'characterTraits',
                  'settingAndSpace',
                  'visualStyle',
                  'cameraAndMovement',
                  'lightingAndColor',
                  'editingPacing',
                  'dialogueAndAudio',
                ],
                properties: {
                  mainTheme: { type: Type.STRING },
                  plotProgression: { type: Type.STRING },
                  characterTraits: { type: Type.STRING },
                  settingAndSpace: { type: Type.STRING },
                  visualStyle: { type: Type.STRING },
                  cameraAndMovement: { type: Type.STRING },
                  lightingAndColor: { type: Type.STRING },
                  editingPacing: { type: Type.STRING },
                  dialogueAndAudio: { type: Type.STRING },
                },
              },
            }
          : {}),
        keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
        hookFormula: { type: Type.STRING },
        sourceKeyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
        derivativeTitle: { type: Type.STRING },
        derivativeHook: { type: Type.STRING },
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        scenes: {
          type: Type.ARRAY,
          ...(desiredScenes <= 5
            ? {
                minItems: String(desiredScenes),
                maxItems: String(desiredScenes),
              }
            : {}),
          description: `BẮT BUỘC trả về ĐÚNG ${desiredScenes} phân cảnh tách biệt đánh số sceneIndex lần lượt từ 1 đến ${desiredScenes}.`,
          items: {
            type: Type.OBJECT,
            required: [
              'sceneIndex',
              'sceneTitle',
              'sceneSummary',
              'durationSec',
              'charactersInScene',
              'settingDetail',
              'actionDetail',
              'cameraAngle',
              'cameraMovement',
              'lighting',
              'costume',
              'shotStyle',
              'narration',
              'imagePrompt',
              'videoPrompt',
            ],
            properties: {
              sceneIndex: { type: Type.INTEGER },
              sceneTitle: { type: Type.STRING },
              sceneSummary: { type: Type.STRING },
              durationSec: { type: Type.NUMBER },
              sourceVideoIndex: { type: Type.INTEGER },
              sourceStartPercent: { type: Type.INTEGER },
              charactersInScene: { type: Type.STRING },
              settingDetail: { type: Type.STRING },
              actionDetail: { type: Type.STRING },
              cameraAngle: { type: Type.STRING },
              cameraMovement: { type: Type.STRING },
              lighting: { type: Type.STRING },
              costume: { type: Type.STRING },
              shotStyle: { type: Type.STRING },
              dialogue: { type: Type.STRING },
              narration: { type: Type.STRING },
              onScreenText: { type: Type.STRING },
              continuityNote: { type: Type.STRING },
              sceneEndState: { type: Type.STRING },
              imagePrompt: { type: Type.STRING },
              videoPrompt: { type: Type.STRING },
              brollKeywordEn: { type: Type.STRING },
            },
          },
        },
      };

      const callGeminiBlueprint = async (candidateModel: string, activeParts: any[], withSchema: boolean) => {
        return ai.models.generateContent({
          model: candidateModel,
          contents: { parts: activeParts },
          config: {
            httpOptions: { timeout: 55_000 },
            maxOutputTokens: 24576,
            ...(candidateModel.startsWith('gemini-4-')
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            systemInstruction:
              `Luôn phản hồi bằng JSON thuần túy đúng cấu trúc, giữ đầy đủ tất cả trường của từng phân cảnh (kể cả dialogue, onScreenText, continuityNote, sceneEndState, imagePrompt, videoPrompt), prompt hình ảnh và prompt video CỰC KỲ CHI TIẾT và đồng nhất, đúng ngôn ngữ yêu cầu. BẮT BUỘC xuất đủ ${desiredScenes} phân cảnh trong mảng scenes (sceneIndex từ 1 đến ${desiredScenes}), tuyệt đối KHÔNG xuất chỉ 1 phân cảnh mẫu.`,
            responseMimeType: 'application/json',
            ...(withSchema
              ? {
                  responseSchema: {
                    type: Type.OBJECT,
                    required: [
                      'learnedSummary',
                      'characterBible',
                      'settingBible',
                      'visualStyleBible',
                      'costumeBible',
                      'continuityBible',
                      'derivativeTitle',
                      'derivativeHook',
                      'scenes',
                    ],
                    properties: geminiSchemaProperties,
                  },
                }
              : {}),
          },
        });
      };

      for (const candidateModel of candidateModels) {
        const activeParts = candidateModel === 'gemini-3.1-flash-lite' ? compactParts : parts;
        const mStart = Date.now();
        console.log(`[Studio AI] Calling ${candidateModel} (scenes=${desiredScenes}, mode=${studioMode})...`);
        try {
          let response;
          try {
            response = await retryWithGeminiBackoff(
              () => callGeminiBlueprint(candidateModel, activeParts, true),
              [1200]
            );
          } catch (schemaErr: any) {
            const msg = String(schemaErr?.message || schemaErr || '').toLowerCase();
            if (msg.includes('too many states') || msg.includes('invalid_argument')) {
              console.warn(`[Studio AI] Schema constraint too large on ${candidateModel}, retrying JSON-only without responseSchema...`);
              response = await retryWithGeminiBackoff(
                () => callGeminiBlueprint(candidateModel, activeParts, false),
                [1200]
              );
            } else {
              throw schemaErr;
            }
          }
          console.log(`[Studio AI] ${candidateModel} succeeded in ${Date.now() - mStart}ms`);
          const rawText = (response?.text ?? '{}').trim();
          const candidateParsed = parseAiBlueprintJsonSafe(rawText);
          const candidateScenes = Array.isArray(candidateParsed?.scenes) ? candidateParsed.scenes : [];
          if (
            (candidateScenes.length === 0 || (desiredScenes >= 3 && candidateScenes.length <= 1)) &&
            candidateModel !== candidateModels[candidateModels.length - 1]
          ) {
            lastGeminiErr = new Error('AI trả về kịch bản chưa đủ số phân cảnh.');
            continue;
          }
          parsedFromGemini = candidateParsed;
          usedModel = candidateModel;
          break;
        } catch (err: any) {
          console.warn(`[Studio AI] ${candidateModel} failed after ${Date.now() - mStart}ms:`, err?.message || err);
          lastGeminiErr = err;
          if (!shouldFallbackGeminiModel(err) && !(err instanceof SyntaxError)) {
            throw err;
          }
        }
      }

      if (parsedFromGemini) {
        parsed = parsedFromGemini;
      } else {
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
            enableVoiceover,
            isDerivative: studioMode === 'derivative',
          });
        } else if (lastGeminiErr instanceof SyntaxError) {
          throw new Error(
            'AI gặp sự cố ngắt quãng dữ liệu JSON khi tạo kịch bản dài. Vui lòng bấm "Thử lại ngay" hoặc giảm nhẹ thời lượng mục tiêu.'
          );
        } else {
          throw lastGeminiErr;
        }
      }
    }

    const characterBible = String(
      parsed?.characterBible || params.characterBible || params.characterSummary || ''
    ).trim();
    const settingBible = String(parsed?.settingBible || params.settingBible || '').trim();
    const visualStyleBible = String(
      parsed?.visualStyleBible || params.visualStyleBible || videoStyleMeta.visualToneVi
    ).trim();
    const costumeBible = String(parsed?.costumeBible || params.costumeBible || '').trim();
    const continuityBible = String(parsed?.continuityBible || params.continuityBible || '').trim();

    const rawScenes: any[] = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
    const scenes: DerivativeScene[] = rawScenes.slice(0, 24).map((sc, i) => {
      const idx =
        contexts.length > 0
          ? Math.max(0, Math.min(contexts.length - 1, Math.round(Number(sc?.sourceVideoIndex ?? i % contexts.length))))
          : 0;
      const dur = Math.max(2, Math.min(45, Number(sc?.durationSec || avgSceneDur)));
      const startPct = Math.max(0, Math.min(80, Math.round(Number(sc?.sourceStartPercent ?? (i * 18) % 70))));
      const sceneTitle = String(sc?.sceneTitle || sc?.onScreenText || `Phân cảnh ${i + 1}`).trim();
      const sceneSummary = String(sc?.sceneSummary || sc?.actionDetail || '').trim();
      const charactersInScene = String(sc?.charactersInScene || '').trim();
      const actionDetail = String(sc?.actionDetail || '').trim();
      const settingDetail = String(sc?.settingDetail || '').trim();
      const cameraAngle = String(sc?.cameraAngle || '').trim();
      const cameraMovement = String(sc?.cameraMovement || '').trim();
      const lighting = String(sc?.lighting || '').trim();
      const costume = String(sc?.costume || '').trim();
      const shotStyle = String(sc?.shotStyle || videoStyleMeta.labelVi).trim();
      const dialogue = String(sc?.dialogue || '').trim();
      const continuityNote = String(sc?.continuityNote || '').trim();
      const sceneEndState = String(sc?.sceneEndState || '').trim();
      const fallbackCombined = [
        charactersInScene ? `Nhân vật: ${charactersInScene}` : '',
        costume ? `Trang phục: ${costume}` : '',
        actionDetail,
        settingDetail,
        cameraAngle,
        lighting,
        shotStyle,
      ]
        .filter(Boolean)
        .join('. ');
      const imagePrompt = String(sc?.imagePrompt || sc?.visualNote || fallbackCombined).trim();
      const videoPrompt = String(
        sc?.videoPrompt || [imagePrompt, cameraMovement ? `Kiểu quay: ${cameraMovement}` : '', actionDetail].filter(Boolean).join('. ')
      ).trim();

      return {
        id: `scene_${i + 1}_${crypto.randomBytes(2).toString('hex')}`,
        sceneIndex: i + 1,
        sceneTitle,
        sceneSummary,
        durationSec: dur,
        sourceVideoIndex: idx,
        sourceStartPercent: startPct,
        onScreenText: String(sc?.onScreenText || sceneTitle || `Scene ${String(i + 1).padStart(2, '0')}`).trim(),
        charactersInScene,
        settingDetail,
        actionDetail,
        cameraAngle,
        cameraMovement,
        lighting,
        costume,
        shotStyle,
        dialogue,
        narration: enableVoiceover ? String(sc?.narration || '').trim() : '',
        imagePrompt,
        videoPrompt,
        continuityNote,
        sceneEndState,
        visualNote: imagePrompt,
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

    const refRaw = parsed?.referenceAnalysis;
    const referenceAnalysis: ReferenceVideoAnalysis | undefined =
      studioMode === 'derivative' && refRaw && typeof refRaw === 'object'
        ? {
            mainTheme: String(refRaw.mainTheme || '').trim(),
            plotProgression: String(refRaw.plotProgression || '').trim(),
            characterTraits: String(refRaw.characterTraits || '').trim(),
            settingAndSpace: String(refRaw.settingAndSpace || '').trim(),
            visualStyle: String(refRaw.visualStyle || '').trim(),
            cameraAndMovement: String(refRaw.cameraAndMovement || '').trim(),
            lightingAndColor: String(refRaw.lightingAndColor || '').trim(),
            editingPacing: String(refRaw.editingPacing || '').trim(),
            dialogueAndAudio: String(refRaw.dialogueAndAudio || '').trim(),
          }
        : undefined;

    return {
      mode: studioMode,
      scriptMode: params.conceptOverride ? 'independent_batch' : scriptMode,
      batchIndex: params.conceptOverride?.batchIndex,
      batchTotal: params.conceptOverride?.batchTotal,
      sharedSpiritNote: params.conceptOverride?.sharedSpiritNote,
      targetDurationSec: desiredTotalSec,
      ideaPrompt: ideaText,
      videoStyle,
      characterBible,
      settingBible,
      visualStyleBible,
      costumeBible,
      continuityBible,
      enableVoiceover,
      referenceAnalysis,
      learnedSummary: String(
        parsed?.learnedSummary ||
          (params.conceptOverride
            ? `${params.conceptOverride.title}: ${params.conceptOverride.premise}`
            : studioMode === 'creative'
            ? `Kịch bản Series theo chủ đề "${ideaText}" phong cách ${videoStyleMeta.labelVi}.`
            : 'Đã phân tích video tham chiếu và phát triển kịch bản sáng tạo mới.')
      ),
      keyTakeaways: Array.isArray(parsed?.keyTakeaways) ? parsed.keyTakeaways.map(String).slice(0, 6) : [],
      hookFormula: String(
        parsed?.hookFormula ||
          params.conceptOverride?.hookFormula ||
          'Mở đầu trực diện vấn đề + phát triển mạch lạc + kết đọng giá trị.'
      ),
      derivativeTitle: String(
        parsed?.derivativeTitle ||
          params.conceptOverride?.title ||
          (ideaText ? ideaText.slice(0, 60) : 'Video sáng tạo mới')
      ),
      derivativeHook: String(
        parsed?.derivativeHook || params.conceptOverride?.derivativeHook || 'Đừng bỏ qua điểm mấu chốt này!'
      ),
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
                sceneTitle: 'Mở đầu câu chuyện',
                sceneSummary: 'Giới thiệu nhân vật và bối cảnh mở đầu.',
                durationSec: Math.max(3, avgSceneDur),
                sourceVideoIndex: 0,
                sourceStartPercent: 10,
                onScreenText: 'Scene 01',
                charactersInScene: 'Nhân vật chính',
                narration: enableVoiceover
                  ? 'Khởi đầu câu chuyện với góc nhìn sắc nét và cuốn hút ngay từ những giây đầu tiên.'
                  : '',
                dialogue: '',
                actionDetail: 'Nhân vật chính xuất hiện trực diện khung hình, cử chỉ tự tin mở đầu bối cảnh',
                settingDetail: settingBible || 'Không gian hiện đại đồng bộ ánh sáng chủ đạo',
                cameraAngle: 'Trung cảnh (Medium close-up)',
                cameraMovement: 'Slow dolly-in',
                lighting: 'Soft studio key light with subtle rim light',
                costume: costumeBible || 'Trang phục gọn gàng đồng bộ nhân vật',
                shotStyle: videoStyleMeta.labelVi,
                continuityNote: 'Khởi đầu mạch truyện',
                sceneEndState: 'Nhân vật nhìn thẳng khung hình chuẩn bị chuyển hành động',
                imagePrompt: 'Nhân vật chính giới thiệu mở đầu trong khung hình rõ nét, ánh sáng cân bằng',
                videoPrompt: 'Máy quay tiến chậm (Slow dolly-in) vào nhân vật chính đang xoay người mở đầu hành động',
                visualNote: 'Nhân vật chính giới thiệu mở đầu trong khung hình rõ nét',
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

interface PlannedIndependentConcept {
  title: string;
  premise: string;
  characterBible: string;
  settingBible: string;
  hookFormula?: string;
  derivativeHook?: string;
}

async function planIndependentVideoConcepts(params: {
  studioMode: StudioCreationMode;
  ideaText: string;
  contexts: EnrichedVideoContext[];
  videoCount: number;
  videoStyleMeta: { labelVi: string; promptDirective: string; visualToneVi: string };
  stylePreset: DerivativeStylePreset;
  outputLang: DerivativeOutputLanguage;
  provider: AiProviderId;
  useProModel?: boolean;
  customInstruction?: string;
  characterSummary?: string;
}): Promise<{ sharedSpiritNote: string; concepts: PlannedIndependentConcept[] }> {
  const dossierText = params.contexts
    .map(
      (ctx) =>
        `Video tham chiếu #${ctx.index + 1}: "${ctx.source.translatedTitle || ctx.source.title}" (${ctx.source.platformLabel})\n` +
        (ctx.description ? `Mô tả: ${ctx.description.slice(0, 350)}\n` : '') +
        (ctx.captionsText ? `Lời thoại trích xuất: ${ctx.captionsText.slice(0, 450)}` : '')
    )
    .join('\n\n');

  const planPrompt = `Bạn là Giám đốc Sáng tạo Nội dung AI.
NHIỆM VỤ: Từ nguồn cảm hứng dưới đây, hãy lên ý tưởng cho ĐÚNG ${params.videoCount} VIDEO ĐỘC LẬP HOÀN TOÀN KHÁC NHAU.

NGUYÊN TẮC TỐI QUAN TRỌNG (KHÔNG ĐƯỢC VI PHẠM):
- Người dùng KHÔNG muốn chia nhỏ một câu chuyện thành nhiều tập (KHÔNG phải Tập 1, Tập 2, Tập 3 hay Phần 1, Phần 2).
- Người dùng muốn tạo ${params.videoCount} CÂU CHUYỆN RIÊNG BIỆT ĐỘC LẬP:
  1. Mỗi video có 1 cốt truyện riêng biệt, không lặp lại ý tưởng hay tình huống của các video khác.
  2. Mỗi video có thể sử dụng NHÂN VẬT HOÀN TOÀN KHÁC NHAU (tên, ngoại hình, trang phục, tính cách riêng).
  3. Bối cảnh, không gian và diễn biến của từng video được sáng tạo độc lập.
  4. TẤT CẢ ${params.videoCount} video đều phải giữ chung **tinh thần, chủ đề, phong cách hình ảnh (${params.videoStyleMeta.labelVi}) và cảm xúc chủ đạo** của ý tưởng / video tham chiếu ban đầu.

ĐẦU VÀO:
- Nguồn: ${params.studioMode === 'creative' ? 'Ý tưởng sáng tạo gốc' : `${params.contexts.length} video tham chiếu`}
- Nội dung chủ đề / ý tưởng: "${params.ideaText || 'Khai thác tinh thần từ video tham chiếu'}"
- Phong cách nội dung: ${STYLE_LABELS[params.stylePreset]}
- Phong cách hình ảnh thống nhất: ${params.videoStyleMeta.labelVi} (${params.videoStyleMeta.visualToneVi})
- Ngôn ngữ đầu ra: ${OUTPUT_LANG_LABELS[params.outputLang]}
${params.characterSummary?.trim() ? `- Gợi ý nhân vật tham khảo: ${params.characterSummary.trim()}` : ''}
${params.customInstruction?.trim() ? `- Yêu cầu thêm: ${params.customInstruction.trim()}` : ''}
${dossierText ? `\nTƯ LIỆU THAM CHIẾU:\n${dossierText}` : ''}

TRẢ VỀ JSON HỢP LỆ VỚI ĐÚNG ${params.videoCount} PHẦN TỬ TRONG MẢNG "concepts":
{
  "sharedSpiritNote": "Mô tả ngắn gọn tinh thần, chủ đề và phong cách nghệ thuật chung gắn kết cả ${params.videoCount} video",
  "concepts": [
    {
      "title": "Tiêu đề riêng hấp dẫn cho Video #1 (không đánh số Tập 1)",
      "premise": "Tóm tắt cốt truyện độc lập có mở đầu - cao trào - kết thúc trọn vẹn (2-3 câu, khác biệt hoàn toàn các video còn lại)",
      "characterBible": "Ngoại hình & trang phục cụ thể của nhân vật riêng trong video này",
      "settingBible": "Bối cảnh không gian & tông màu ánh sáng riêng của video này",
      "hookFormula": "Cách mở đầu giữ chân khán giả cho video này",
      "derivativeHook": "Câu hook ngắn <= 12 chữ hiện 3.5s đầu"
    }
  ]
}`;

  let parsed: any = {};

  if (params.provider === 'muse2api') {
    const st = await getMuse2ApiStatus();
    if (!st.reachable || !st.ready) {
      throw new Error(
        st.error ||
          'Muse2API chưa sẵn sàng hoặc chưa có tài khoản muse.ai hợp lệ. Hãy kiểm tra phần Quản lý Muse2API trong Thiết lập.'
      );
    }
    const raw = await chatWithMuse2ApiSpark([
      {
        role: 'system',
        content: 'Chỉ trả về 1 đối tượng JSON thuần túy đúng schema, không giải thích bên ngoài JSON.',
      },
      { role: 'user', content: planPrompt },
    ]);
    parsed = parseAiBlueprintJsonSafe(raw);
  } else if (params.provider === 'openai' || params.provider === 'meta') {
    const cfg = resolveOpenAiCompatibleConfig(params.provider);
    if (!cfg.apiKey) {
      throw new Error(`Chưa cấu hình ${cfg.envName} trong Settings > Secrets hoặc tệp .env.`);
    }
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: 'Chỉ trả về JSON thuần túy hợp lệ đúng schema.' },
          { role: 'user', content: planPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.85,
      }),
      signal: AbortSignal.timeout(75_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`${cfg.label} lỗi HTTP ${res.status}: ${errBody.slice(0, 180) || res.statusText}`);
    }
    const data = (await res.json()) as any;
    parsed = parseAiBlueprintJsonSafe(String(data?.choices?.[0]?.message?.content || '{}'));
  } else {
    const ai = getGeminiClient();
    const parts: any[] = [];
    for (const ctx of params.contexts.slice(0, 2)) {
      if (ctx.thumbnail) {
        parts.push({
          inlineData: { mimeType: ctx.thumbnail.mimeType, data: ctx.thumbnail.buffer.toString('base64') },
        });
      }
    }
    parts.push({ text: planPrompt });

    const candidateModels = params.useProModel
      ? ['gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']
      : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

    let lastErr: any;
    for (const candidateModel of candidateModels) {
      try {
        const response = await retryWithGeminiBackoff(
          () =>
            ai.models.generateContent({
              model: candidateModel,
              contents: { parts },
              config: {
                maxOutputTokens: 12288,
                ...(candidateModel.startsWith('gemini-4-')
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                systemInstruction:
                  `Luôn trả về ĐÚNG ${params.videoCount} video độc lập được yêu cầu trong mảng concepts của JSON. Mỗi video phải là một câu chuyện tách biệt hoàn toàn với nhân vật và bối cảnh riêng, tuyệt đối không viết thành các tập nối tiếp.`,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  required: ['sharedSpiritNote', 'concepts'],
                  properties: {
                    sharedSpiritNote: { type: Type.STRING },
                    concepts: {
                      type: Type.ARRAY,
                      minItems: String(params.videoCount),
                      maxItems: String(params.videoCount),
                      items: {
                        type: Type.OBJECT,
                        required: ['title', 'premise', 'characterBible', 'settingBible'],
                        properties: {
                          title: { type: Type.STRING },
                          premise: { type: Type.STRING },
                          characterBible: { type: Type.STRING },
                          settingBible: { type: Type.STRING },
                          hookFormula: { type: Type.STRING },
                          derivativeHook: { type: Type.STRING },
                        },
                      },
                    },
                  },
                },
              },
            }),
          [1400, 3000]
        );
        const candidateConceptParsed = parseAiBlueprintJsonSafe((response?.text ?? '{}').trim());
        if (
          (!Array.isArray(candidateConceptParsed?.concepts) || candidateConceptParsed.concepts.length === 0) &&
          candidateModel !== candidateModels[candidateModels.length - 1]
        ) {
          lastErr = new Error('AI trả về danh sách ý tưởng rỗng.');
          continue;
        }
        parsed = candidateConceptParsed;
        break;
      } catch (err: any) {
        lastErr = err;
        if (!shouldFallbackGeminiModel(err) && !(err instanceof SyntaxError)) {
          throw err;
        }
      }
    }
    if (!Array.isArray(parsed?.concepts) && lastErr) {
      throw lastErr;
    }
  }

  const rawConcepts: any[] = Array.isArray(parsed?.concepts) ? parsed.concepts : [];
  const concepts: PlannedIndependentConcept[] = rawConcepts
    .filter((c) => c && (c.title || c.premise))
    .slice(0, params.videoCount)
    .map((c, idx) => ({
      title: String(c.title || `Ý tưởng độc lập #${idx + 1}`).trim(),
      premise: String(c.premise || c.title || '').trim(),
      characterBible: String(c.characterBible || '').trim(),
      settingBible: String(c.settingBible || '').trim(),
      hookFormula: String(c.hookFormula || '').trim(),
      derivativeHook: String(c.derivativeHook || '').trim(),
    }));

  if (concepts.length === 0) {
    throw new Error('AI chưa tạo được danh sách ý tưởng độc lập hợp lệ. Vui lòng thử lại.');
  }

  return {
    sharedSpiritNote: String(
      parsed?.sharedSpiritNote ||
        `Giữ tinh thần chủ đề "${params.ideaText || 'nguồn tham chiếu'}" · Phong cách ${params.videoStyleMeta.labelVi}`
    ).trim(),
    concepts,
  };
}

export async function learnAndCreateIndependentBatch(params: {
  mode?: StudioCreationMode;
  ideaPrompt?: string;
  query?: string;
  videos?: DerivativeSourceInput[];
  videoCount: number;
  perVideoDurations?: number[];
  targetDurationSec?: number;
  desiredSceneCount?: number;
  stylePreset?: DerivativeStylePreset;
  videoStyle?: StudioVideoStyle;
  aspectRatio: DerivativeAspectRatio;
  outputLanguage?: DerivativeOutputLanguage;
  useProModel?: boolean;
  characterSummary?: string;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  customInstruction?: string;
  enableVoiceover?: boolean;
  aiProvider?: AiProviderId;
}): Promise<{ sharedSpiritNote: string; blueprints: DerivativeBlueprint[] }> {
  const studioMode: StudioCreationMode = params.mode === 'creative' ? 'creative' : 'derivative';
  const videosList = Array.isArray(params.videos) ? params.videos : [];
  const ideaText = (params.ideaPrompt || params.query || '').trim();
  const activeStylePreset: DerivativeStylePreset =
    params.stylePreset && params.stylePreset in STYLE_LABELS ? params.stylePreset : 'none';

  if (studioMode === 'creative') {
    if (!ideaText && !params.customInstruction?.trim()) {
      throw new Error('Vui lòng nhập ý tưởng hoặc mô tả chủ đề để Studio Sáng Tạo lên danh sách video.');
    }
  } else if (videosList.length === 0) {
    throw new Error('Vui lòng chọn hoặc tải lên ít nhất 1 video tham chiếu để AI phân tích tinh thần & chủ đề.');
  }

  const provider: AiProviderId =
    params.aiProvider === 'openai' || params.aiProvider === 'meta' || params.aiProvider === 'muse2api'
      ? params.aiProvider
      : 'gemini';

  const videoStyle: StudioVideoStyle =
    params.videoStyle && params.videoStyle in STUDIO_VIDEO_STYLE_META ? params.videoStyle : 'cinematic';
  const videoStyleMeta = STUDIO_VIDEO_STYLE_META[videoStyle];
  const outputLang: DerivativeOutputLanguage = params.outputLanguage || 'vi';
  const count = Math.max(2, Math.min(15, Math.round(Number(params.videoCount || 3))));
  const defaultDur = Math.max(10, Math.min(900, Math.round(Number(params.targetDurationSec || 30))));

  const contexts = videosList.length > 0 ? await gatherSourceContexts(videosList) : [];

  const plan = await planIndependentVideoConcepts({
    studioMode,
    ideaText,
    contexts,
    videoCount: count,
    videoStyleMeta,
    stylePreset: activeStylePreset,
    outputLang,
    provider,
    useProModel: params.useProModel,
    customInstruction: params.customInstruction,
    characterSummary: params.characterSummary,
  });

  // Top up cleanly if the model returned slightly fewer concepts than requested
  while (plan.concepts.length < count) {
    const base = plan.concepts[plan.concepts.length % Math.max(1, plan.concepts.length)];
    const n = plan.concepts.length + 1;
    plan.concepts.push({
      title: `${base.title} (Biến thể góc nhìn #${n})`,
      premise: `Một câu chuyện hoàn toàn độc lập lấy cảm hứng từ tinh thần chung: ${plan.sharedSpiritNote}. Khai thác nhân vật và xung đột mới mẻ khác biệt với các video trước.`,
      characterBible: '',
      settingBible: '',
      hookFormula: base.hookFormula,
      derivativeHook: '',
    });
  }

  const selectedConcepts = plan.concepts.slice(0, count);
  const allTitles = selectedConcepts.map((c) => c.title);
  const blueprints: DerivativeBlueprint[] = new Array(selectedConcepts.length);
  const concurrency = provider === 'muse2api' ? 1 : 2;

  for (let start = 0; start < selectedConcepts.length; start += concurrency) {
    const chunkIndices = Array.from(
      { length: Math.min(concurrency, selectedConcepts.length - start) },
      (_, offset) => start + offset
    );
    await Promise.all(
      chunkIndices.map(async (idx) => {
        const concept = selectedConcepts[idx];
        const rawDur = Array.isArray(params.perVideoDurations) ? params.perVideoDurations[idx] : undefined;
        const vidDur =
          typeof rawDur === 'number' && Number.isFinite(rawDur)
            ? Math.max(10, Math.min(900, Math.round(rawDur)))
            : defaultDur;

        blueprints[idx] = await learnVideosAndCreateBlueprint({
          mode: studioMode,
          scriptMode: 'independent_batch',
          ideaPrompt: ideaText,
          query: params.query,
          videos: videosList,
          stylePreset: activeStylePreset,
          videoStyle,
          aspectRatio: params.aspectRatio,
          targetDurationSec: vidDur,
          desiredSceneCount: params.desiredSceneCount,
          outputLanguage: outputLang,
          useProModel: params.useProModel,
          characterSummary: params.characterSummary,
          characterBible: concept.characterBible || params.characterBible,
          settingBible: concept.settingBible || params.settingBible,
          visualStyleBible: params.visualStyleBible,
          costumeBible: params.costumeBible,
          continuityBible: params.continuityBible,
          customInstruction: params.customInstruction,
          enableVoiceover: params.enableVoiceover,
          aiProvider: provider,
          preGatheredContexts: contexts,
          conceptOverride: {
            title: concept.title,
            premise: concept.premise,
            characterBible: concept.characterBible,
            settingBible: concept.settingBible,
            visualStyleBible: params.visualStyleBible,
            costumeBible: params.costumeBible,
            continuityBible: params.continuityBible,
            hookFormula: concept.hookFormula,
            derivativeHook: concept.derivativeHook,
            sharedSpiritNote: plan.sharedSpiritNote,
            avoidTitles: allTitles.filter((_, j) => j !== idx),
            batchIndex: idx + 1,
            batchTotal: selectedConcepts.length,
          },
        });
      })
    );
  }

  return { sharedSpiritNote: plan.sharedSpiritNote, blueprints };
}

// ==========================================
// STUDIO SHARED PROJECT PROFILES & VIDEO LIBRARY
// ==========================================

export interface StudioProjectProfileRecord {
  id: string;
  name: string;
  description?: string;
  videoStyle: StudioVideoStyle;
  characterBible: string;
  settingBible: string;
  visualStyleBible: string;
  costumeBible: string;
  continuityBible: string;
  characterRefs: { id: string; name: string; dataUrl: string; description?: string; source: 'uploaded' | 'ai_generated' }[];
  updatedAt: number;
}

const STUDIO_PROJECTS_FILE = path.join(process.cwd(), 'data', 'studio_projects.json');

function ensureStudioProjectsFile(): void {
  const dir = path.dirname(STUDIO_PROJECTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(STUDIO_PROJECTS_FILE)) {
    fs.writeFileSync(STUDIO_PROJECTS_FILE, '[]', 'utf8');
  }
}

export function listStudioProjectProfiles(): StudioProjectProfileRecord[] {
  try {
    ensureStudioProjectsFile();
    const raw = fs.readFileSync(STUDIO_PROJECTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStudioProjectProfile(input: Partial<StudioProjectProfileRecord>): StudioProjectProfileRecord {
  const list = listStudioProjectProfiles();
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Vui lòng nhập tên Hồ sơ Dự án.');
  }
  const id = String(input.id || '').trim() || `proj_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
  const validStyle: StudioVideoStyle =
    input.videoStyle && input.videoStyle in STUDIO_VIDEO_STYLE_META ? input.videoStyle : 'cinematic';

  const record: StudioProjectProfileRecord = {
    id,
    name: name.slice(0, 80),
    description: String(input.description || '').trim().slice(0, 240),
    videoStyle: validStyle,
    characterBible: String(input.characterBible || '').trim(),
    settingBible: String(input.settingBible || '').trim(),
    visualStyleBible: String(input.visualStyleBible || '').trim(),
    costumeBible: String(input.costumeBible || '').trim(),
    continuityBible: String(input.continuityBible || '').trim(),
    characterRefs: Array.isArray(input.characterRefs) ? input.characterRefs.slice(0, 3) : [],
    updatedAt: Date.now(),
  };

  const existingIdx = list.findIndex((p) => p.id === id);
  if (existingIdx >= 0) {
    list[existingIdx] = record;
  } else {
    list.unshift(record);
  }
  ensureStudioProjectsFile();
  fs.writeFileSync(STUDIO_PROJECTS_FILE, JSON.stringify(list.slice(0, 40), null, 2), 'utf8');
  return record;
}

export function deleteStudioProjectProfile(id: string): boolean {
  const list = listStudioProjectProfiles();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  ensureStudioProjectsFile();
  fs.writeFileSync(STUDIO_PROJECTS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return true;
}

export function listStudioLibraryVideos() {
  const items: {
    id: string;
    kind: 'uploaded' | 'rendered';
    title: string;
    durationSec: number;
    resolution: string;
    previewUrl: string;
    localAssetId?: string;
    jobId?: string;
    hasAudio?: boolean;
    createdAt: number;
  }[] = [];

  for (const asset of studioAssets.values()) {
    if (!fs.existsSync(asset.filePath)) continue;
    if (!(asset.mimeType || '').startsWith('video/')) continue;
    items.push({
      id: `asset_${asset.assetId}`,
      kind: 'uploaded',
      title: asset.fileName.replace(/\.[^.]+$/, ''),
      durationSec: Math.round(asset.durationSec || 0),
      resolution: asset.resolution || 'HD',
      previewUrl: `/api/studio/assets/${asset.assetId}`,
      localAssetId: asset.assetId,
      hasAudio: asset.hasAudio,
      createdAt: asset.createdAt,
    });
  }

  for (const job of derivativeJobs.values()) {
    if (job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) continue;
    items.push({
      id: `job_${job.jobId}`,
      kind: 'rendered',
      title: (job.fileName || 'Studio Render').replace(/\.[^.]+$/, ''),
      durationSec: Math.round(job.durationSec || 0),
      resolution: job.resolution || '1080p',
      previewUrl: `/api/derivative/jobs/${job.jobId}/file`,
      jobId: job.jobId,
      hasAudio: true,
      createdAt: job.createdAt,
    });
  }

  return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
}

export async function importRenderedJobAsLibraryAsset(jobId: string) {
  const job = derivativeJobs.get(jobId);
  if (!job || job.status !== 'completed' || !job.outputPath || !fs.existsSync(job.outputPath)) {
    throw new Error('Video đã dựng trong thư viện không tồn tại hoặc đã hết hạn.');
  }
  return saveUploadedStudioVideoFromDisk(job.outputPath, job.fileName || `studio_${jobId}.mp4`);
}

// ==========================================
// STUDIO AI MEDIA (CHARACTER/SCENE IMAGE, OMNI FLASH VIDEO, LYRIA MUSIC, OFFLINE TTS)
// ==========================================

export async function generateStudioImage(params: {
  mode: 'character' | 'scene';
  prompt: string;
  aspectRatio?: '1:1' | '9:16' | '16:9';
  quality?: 'standard' | 'pro';
  engine?: 'gemini' | 'muse2api';
  videoStyle?: StudioVideoStyle;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  sceneIndex?: number;
  totalScenes?: number;
  characterRefs?: { dataUrl: string; name?: string }[];
}): Promise<{ dataUrl: string; model: string }> {
  const aspectRatio = params.aspectRatio || (params.mode === 'character' ? '1:1' : '16:9');
  const styleMeta =
    params.videoStyle && params.videoStyle in STUDIO_VIDEO_STYLE_META
      ? STUDIO_VIDEO_STYLE_META[params.videoStyle]
      : STUDIO_VIDEO_STYLE_META.cinematic;

  const consistencyBlock = [
    `Art & Video Style Directive (STRICTLY ENFORCE): ${styleMeta.promptDirective}.`,
    params.visualStyleBible?.trim() ? `Visual Style & Color Palette: ${params.visualStyleBible.trim()}.` : '',
    params.characterBible?.trim()
      ? `Locked Character Reference (MUST keep exact facial features, hair, proportions consistent): ${params.characterBible.trim()}.`
      : '',
    params.costumeBible?.trim() ? `Locked Costume Reference: ${params.costumeBible.trim()}.` : '',
    params.settingBible?.trim()
      ? `Locked Environment Reference: ${params.settingBible.trim()}.`
      : '',
    params.continuityBible?.trim() ? `Story Continuity Rule: ${params.continuityBible.trim()}.` : '',
    params.sceneIndex
      ? `Sequential Storyboard Frame: Scene ${String(params.sceneIndex).padStart(2, '0')}${params.totalScenes ? `/${String(params.totalScenes).padStart(2, '0')}` : ''}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const buildScenePrompt = (hasRefs: boolean) => {
    if (params.mode === 'character') {
      return `${consistencyBlock} Create a clean, consistent studio character turnaround / portrait reference sheet suitable for reusing identically across all video scenes. Character description: ${params.prompt}. Crisp framing, balanced lighting, no overlaid watermarks, subtitles, or UI text.`;
    }
    if (hasRefs) {
      const refNames = (params.characterRefs || [])
        .map((r) => r.name)
        .filter(Boolean)
        .join(', ');
      return `${consistencyBlock} Create a cohesive storyboard scene strictly preserving the exact character identity, face, hair, and outfit from the attached reference image(s)${refNames ? ` (${refNames})` : ''}. Scene prompt: ${params.prompt}. No overlaid subtitles, speech bubbles, or watermarks.`;
    }
    return `${consistencyBlock} Create a crisp, cohesive storyboard scene: ${params.prompt}. No overlaid subtitles, text, or watermarks.`;
  };

  if (params.engine === 'muse2api') {
    const finalMusePrompt = buildScenePrompt(Boolean(params.characterRefs && params.characterRefs.length > 0));
    const res = await generateImageViaMuse2Api({
      prompt: finalMusePrompt,
      aspectRatio,
      referenceImageDataUrl: params.characterRefs?.[0]?.dataUrl,
    });
    return { dataUrl: res.dataUrl, model: 'muse-image (Muse2API)' };
  }

  const ai = getGeminiClient();
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

  const finalPrompt = buildScenePrompt(Boolean(params.characterRefs && params.characterRefs.length > 0));
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
  engine?: 'gemini' | 'muse2api';
  videoStyle?: StudioVideoStyle;
  characterBible?: string;
  settingBible?: string;
  visualStyleBible?: string;
  costumeBible?: string;
  continuityBible?: string;
  sceneIndex?: number;
  totalScenes?: number;
  sceneImageDataUrl?: string;
  characterRefs?: { dataUrl: string; name?: string }[];
}): Promise<{ assetId: string; previewUrl: string; durationSec: number; model: string }> {
  const clampedDur = Math.max(3, Math.min(15, Math.round(params.durationSec || 8)));
  const styleMeta =
    params.videoStyle && params.videoStyle in STUDIO_VIDEO_STYLE_META
      ? STUDIO_VIDEO_STYLE_META[params.videoStyle]
      : STUDIO_VIDEO_STYLE_META.cinematic;

  const anchorLines = [
    `Visual Style: ${styleMeta.promptDirective}.`,
    params.visualStyleBible?.trim() ? `Visual Style Reference: ${params.visualStyleBible.trim()}.` : '',
    params.characterBible?.trim() ? `Character Reference: ${params.characterBible.trim()}.` : '',
    params.costumeBible?.trim() ? `Costume Reference: ${params.costumeBible.trim()}.` : '',
    params.settingBible?.trim() ? `Environment Reference: ${params.settingBible.trim()}.` : '',
    params.continuityBible?.trim() ? `Story Continuity: ${params.continuityBible.trim()}.` : '',
    params.sceneIndex
      ? `Scene ${String(params.sceneIndex).padStart(2, '0')}${params.totalScenes ? `/${String(params.totalScenes).padStart(2, '0')}` : ''}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const promptText = params.sceneImageDataUrl
    ? `${anchorLines} Animate this exact keyframe scene smoothly with natural camera motion, keeping character & setting identical: ${params.prompt}. No overlaid text or watermarks.`
    : `${anchorLines} High-definition cohesive video scene: ${params.prompt}. Smooth camera movement, cohesive lighting, no overlaid text or watermarks.`;

  if (params.engine === 'muse2api') {
    const refDataUrl = params.sceneImageDataUrl || params.characterRefs?.[0]?.dataUrl;
    const { buffer, mimeType, ext } = await generateVideoBufferViaMuse2Api({
      prompt: promptText,
      aspectRatio: params.aspectRatio === '9:16' ? '9:16' : '16:9',
      durationSec: Math.min(12, clampedDur),
      referenceImageDataUrl: refDataUrl,
    });

    const assetId = `musevid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const outPath = path.join(STUDIO_ASSETS_DIR, `${assetId}${ext}`);
    fs.writeFileSync(outPath, buffer);
    const probedDur = (await probeDurationSeconds(outPath, STUDIO_ASSETS_DIR)) || Math.min(12, clampedDur);

    studioAssets.set(assetId, {
      assetId,
      filePath: outPath,
      fileName: `${assetId}${ext}`,
      mimeType,
      durationSec: probedDur,
      createdAt: Date.now(),
    });

    return {
      assetId,
      previewUrl: `/api/studio/assets/${assetId}`,
      durationSec: Math.round(probedDur * 10) / 10,
      model: 'muse-video (Muse2API)',
    };
  }

  const ai = getGeminiClient();
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

  inputParts.push({ type: 'text', text: promptText });

  const omniAspect = params.aspectRatio === '9:16' ? '9:16' : '16:9';

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
              aspect_ratio: omniAspect,
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

export type OfflineTtsEngineId = 'vieneu' | 'win_sapi' | 'macos_say' | 'espeak';

export interface OfflineTtsEngineInfo {
  available: boolean;
  engine: string;
  engineId?: OfflineTtsEngineId;
}

export interface VieNeuVoiceItem {
  id: string;
  description: string;
}

let cachedOfflineTts: OfflineTtsEngineInfo | null = null;
let cachedVieNeuPythonCmd: string | null = null;
let cachedVieNeuVoices: { mode: string; sampleRate: number; voices: VieNeuVoiceItem[] } | null = null;

export function resetOfflineTtsCache(): void {
  cachedOfflineTts = null;
  cachedVieNeuPythonCmd = null;
  cachedVieNeuVoices = null;
}

function getVieNeuScriptPath(): string {
  return path.join(process.cwd(), 'scripts', 'vieneu_tts.py');
}

function parseLastJsonObject(raw: string): any | null {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith('{') && lines[i].endsWith('}')) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // try earlier line
      }
    }
  }
  return null;
}

let cachedVieNeuPythonArgsPrefix: string[] = [];

const VIENEU_RUNTIME_CHECK_CODE =
  'import vieneu, huggingface_hub, onnxruntime, soundfile, soxr, librosa, numpy, requests, tokenizers, yaml; print("OK")';

interface PythonEnvMeta {
  major: number;
  minor: number;
  micro: number;
  bits: number;
  machine: string;
  gilDisabled: boolean;
  raw: string;
}

async function inspectPythonEnvMeta(cmd: string, prefixArgs: string[]): Promise<PythonEnvMeta | null> {
  try {
    const res = await spawnPromise(
      cmd,
      [
        ...prefixArgs,
        '-c',
        "import sys, struct, platform, sysconfig; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}|{struct.calcsize(\"P\")*8}|{platform.machine()}|{sysconfig.get_config_var(\"Py_GIL_DISABLED\") or 0}')",
      ],
      process.cwd(),
      8000
    );
    if (res.code !== 0) return null;
    const line = res.stdout.trim().split(/\r?\n/).pop()?.trim() || '';
    const [verStr, bitsStr, machine = '', gilStr = '0'] = line.split('|');
    const [majS, minS, micS] = (verStr || '').split('.');
    const major = Number(majS);
    const minor = Number(minS);
    const micro = Number(micS || 0);
    const bits = Number(bitsStr);
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(bits)) return null;
    return {
      major,
      minor,
      micro,
      bits,
      machine: machine.trim(),
      gilDisabled: gilStr.trim() === '1',
      raw: `Python ${verStr} (${bits}-bit, ${machine || 'unknown'}${gilStr.trim() === '1' ? ', free-threaded' : ''})`,
    };
  } catch {
    return null;
  }
}

function isCompatibleVieNeuPython(meta: PythonEnvMeta | null): boolean {
  if (!meta) return false;
  if (meta.major !== 3 || meta.minor < 10 || meta.minor > 14) return false;
  if (meta.gilDisabled) return false;
  if (process.platform === 'win32' && meta.bits !== 64) return false;
  return true;
}

function getWindowsPythonCandidates(): { cmd: string; prefixArgs: string[] }[] {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const versions = ['312', '311', '313', '310', '314'];
  const explicitPaths: string[] = [];

  for (const v of versions) {
    if (localAppData) {
      explicitPaths.push(path.join(localAppData, 'Programs', 'Python', `Python${v}`, 'python.exe'));
      explicitPaths.push(path.join(localAppData, 'Programs', 'Python', `Python${v}-arm64`, 'python.exe'));
    }
    explicitPaths.push(path.join(programFiles, `Python${v}`, 'python.exe'));
    explicitPaths.push(`C:\\Python${v}\\python.exe`);
  }

  return [
    { cmd: 'py', prefixArgs: ['-3.12-64'] },
    { cmd: 'py', prefixArgs: ['-3.11-64'] },
    { cmd: 'py', prefixArgs: ['-3.13-64'] },
    { cmd: 'py', prefixArgs: ['-3.10-64'] },
    { cmd: 'py', prefixArgs: ['-3.14-64'] },
    { cmd: 'py', prefixArgs: ['-3.12'] },
    { cmd: 'py', prefixArgs: ['-3.11'] },
    { cmd: 'py', prefixArgs: ['-3.13'] },
    { cmd: 'py', prefixArgs: ['-3.10'] },
    { cmd: 'py', prefixArgs: ['-3.14'] },
    { cmd: 'py', prefixArgs: ['-3'] },
    ...explicitPaths.filter((p) => fs.existsSync(p)).map((cmd) => ({ cmd, prefixArgs: [] })),
    { cmd: 'python', prefixArgs: [] },
    { cmd: 'python3', prefixArgs: [] },
  ];
}

async function resolveVieNeuPythonCommand(): Promise<{ cmd: string; prefixArgs: string[] } | null> {
  if (cachedVieNeuPythonCmd && fs.existsSync(getVieNeuScriptPath())) {
    return { cmd: cachedVieNeuPythonCmd, prefixArgs: cachedVieNeuPythonArgsPrefix };
  }
  if (!fs.existsSync(getVieNeuScriptPath())) {
    return null;
  }

  const isWin = process.platform === 'win32';
  const relPy = isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python');
  const candidates: { cmd: string; prefixArgs: string[] }[] = [
    { cmd: path.join(process.cwd(), '.venv-vieneu', relPy), prefixArgs: [] },
    { cmd: path.join(process.cwd(), '.venv', relPy), prefixArgs: [] },
    ...(isWin
      ? getWindowsPythonCandidates()
      : [
          { cmd: 'python3', prefixArgs: [] },
          { cmd: 'python', prefixArgs: [] },
        ]),
  ];

  for (const cand of candidates) {
    if ((cand.cmd.includes('/') || cand.cmd.includes('\\')) && !fs.existsSync(cand.cmd)) {
      continue;
    }
    try {
      const check = await spawnPromise(
        cand.cmd,
        [...cand.prefixArgs, '-c', VIENEU_RUNTIME_CHECK_CODE],
        process.cwd(),
        12_000
      );
      if (check.code === 0 && check.stdout.includes('OK')) {
        cachedVieNeuPythonCmd = cand.cmd;
        cachedVieNeuPythonArgsPrefix = cand.prefixArgs;
        return cand;
      }
    } catch {
      // try next python candidate
    }
  }

  return null;
}

export async function detectOfflineTtsEngine(): Promise<OfflineTtsEngineInfo> {
  if (cachedOfflineTts) return cachedOfflineTts;
  const checkCmd = async (cmd: string, args: string[], label: string) => {
    try {
      const r = await spawnPromise(cmd, args, STUDIO_ASSETS_DIR, 4000);
      return r.code === 0 ? label : '';
    } catch {
      return '';
    }
  };

  const vieneuPy = await resolveVieNeuPythonCommand();
  if (vieneuPy) {
    cachedOfflineTts = {
      available: true,
      engine: 'VieNeu-TTS (Tiếng Việt Offline · ONNX)',
      engineId: 'vieneu',
    };
    return cachedOfflineTts;
  }

  if (process.platform === 'win32') {
    const winOk = await checkCmd(
      'powershell',
      ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; "OK"'],
      'Windows SAPI (Offline)'
    );
    if (winOk) {
      cachedOfflineTts = { available: true, engine: winOk, engineId: 'win_sapi' };
      return cachedOfflineTts;
    }
  } else if (process.platform === 'darwin') {
    const macOk = await checkCmd('which', ['say'], 'macOS say (Offline)');
    if (macOk) {
      cachedOfflineTts = { available: true, engine: macOk, engineId: 'macos_say' };
      return cachedOfflineTts;
    }
  }

  for (const bin of [
    { cmd: 'espeak-ng', args: ['--version'], label: 'eSpeak-NG (Offline)' },
    { cmd: 'espeak', args: ['--version'], label: 'eSpeak (Offline)' },
  ]) {
    const ok = await checkCmd(bin.cmd, bin.args, bin.label);
    if (ok) {
      cachedOfflineTts = { available: true, engine: ok, engineId: 'espeak' };
      return cachedOfflineTts;
    }
  }

  cachedOfflineTts = { available: false, engine: '' };
  return cachedOfflineTts;
}

export async function listVieNeuVoices(): Promise<{
  available: boolean;
  engine: string;
  engineId?: OfflineTtsEngineId;
  mode?: string;
  sampleRate?: number;
  voices: VieNeuVoiceItem[];
}> {
  const detected = await detectOfflineTtsEngine();
  if (detected.engineId !== 'vieneu') {
    return {
      available: detected.available,
      engine: detected.engine,
      engineId: detected.engineId,
      voices: [],
    };
  }

  if (cachedVieNeuVoices) {
    return {
      available: true,
      engine: detected.engine,
      engineId: 'vieneu',
      mode: cachedVieNeuVoices.mode,
      sampleRate: cachedVieNeuVoices.sampleRate,
      voices: cachedVieNeuVoices.voices,
    };
  }

  const pySpec = await resolveVieNeuPythonCommand();
  if (!pySpec) {
    return { available: false, engine: '', voices: [] };
  }

  const res = await spawnPromise(
    pySpec.cmd,
    [...pySpec.prefixArgs, getVieNeuScriptPath(), '--mode', 'v3nano', '--list-voices'],
    process.cwd(),
    90_000
  );
  const parsed = parseLastJsonObject(res.stdout);
  if (res.code === 0 && parsed?.ok && Array.isArray(parsed.voices)) {
    const voices: VieNeuVoiceItem[] = parsed.voices
      .map((v: any) => ({
        id: String(v?.id || '').trim(),
        description: String(v?.description || v?.id || '').trim(),
      }))
      .filter((v: VieNeuVoiceItem) => Boolean(v.id));

    cachedVieNeuVoices = {
      mode: String(parsed.mode || 'v3nano'),
      sampleRate: Number(parsed.sampleRate || 24000),
      voices,
    };

    return {
      available: true,
      engine: detected.engine,
      engineId: 'vieneu',
      mode: cachedVieNeuVoices.mode,
      sampleRate: cachedVieNeuVoices.sampleRate,
      voices,
    };
  }

  return {
    available: true,
    engine: detected.engine,
    engineId: 'vieneu',
    voices: [],
  };
}

async function synthesizeOfflineVoiceBatchVieNeu(
  items: { index: number; text: string; out: string; voice?: string }[],
  defaultVoice?: string
): Promise<Map<number, boolean>> {
  const statusMap = new Map<number, boolean>();
  if (items.length === 0) return statusMap;

  const pySpec = await resolveVieNeuPythonCommand();
  if (!pySpec) return statusMap;

  const batchPath = path.join(path.dirname(items[0].out), `vieneu_batch_${Date.now()}.json`);
  try {
    fs.writeFileSync(
      batchPath,
      JSON.stringify(
        items.map((it) => ({
          text: it.text.replace(/[\r\n]+/g, ' ').trim(),
          out: it.out,
          voice: it.voice || defaultVoice || '',
        })),
        null,
        2
      ),
      'utf8'
    );

    const args = [...pySpec.prefixArgs, getVieNeuScriptPath(), '--mode', 'v3nano', '--batch-json', batchPath];
    if (defaultVoice?.trim()) {
      args.push('--voice', defaultVoice.trim());
    }

    const res = await spawnPromise(pySpec.cmd, args, process.cwd(), Math.max(120_000, items.length * 35_000));
    const parsed = parseLastJsonObject(res.stdout);
    const results = Array.isArray(parsed?.results) ? parsed.results : [];

    for (let i = 0; i < items.length; i += 1) {
      const target = items[i];
      const itemRes = results.find((r: any) => Number(r?.index) === i);
      const exists = fs.existsSync(target.out) && fs.statSync(target.out).size > 1000;
      statusMap.set(target.index, Boolean((itemRes?.ok ?? true) && exists));
    }
  } finally {
    try {
      if (fs.existsSync(batchPath)) fs.unlinkSync(batchPath);
    } catch {
      // ignore
    }
  }

  return statusMap;
}

async function synthesizeOfflineVoiceWav(
  text: string,
  outWavPath: string,
  preferredVoice?: string
): Promise<boolean> {
  const cleanText = text.replace(/[\r\n]+/g, ' ').trim();
  if (!cleanText) return false;
  const detected = await detectOfflineTtsEngine();
  if (!detected.available) {
    throw new Error(
      'Chưa phát hiện thư viện giọng đọc tiếng Việt Offline (VieNeu-TTS). Hãy bấm "Tải & Cài VieNeu-TTS Offline" trong Studio hoặc Cài đặt.'
    );
  }

  if (detected.engineId === 'vieneu') {
    const pySpec = await resolveVieNeuPythonCommand();
    if (pySpec) {
      const txtPath = `${outWavPath}.txt`;
      try {
        fs.writeFileSync(txtPath, cleanText, 'utf8');
        const args = [
          ...pySpec.prefixArgs,
          getVieNeuScriptPath(),
          '--mode',
          'v3nano',
          '--text-file',
          txtPath,
          '--out',
          outWavPath,
        ];
        if (preferredVoice?.trim()) {
          args.push('--voice', preferredVoice.trim());
        }
        const r = await spawnPromise(pySpec.cmd, args, process.cwd(), 120_000);
        if (r.code === 0 && fs.existsSync(outWavPath) && fs.statSync(outWavPath).size > 1000) {
          return true;
        }
      } finally {
        try {
          if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
        } catch {
          // ignore
        }
      }
    }
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

export async function synthesizeOfflineVoicePreview(text: string, voice?: string): Promise<Buffer> {
  const cleanText = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 600);
  if (!cleanText) {
    throw new Error('Vui lòng nhập lời thoại cần đọc thử.');
  }
  const tmpWav = path.join(STUDIO_ASSETS_DIR, `offline_preview_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.wav`);
  try {
    const ok = await synthesizeOfflineVoiceWav(cleanText, tmpWav, voice);
    if (!ok || !fs.existsSync(tmpWav)) {
      throw new Error('Không thể tổng hợp giọng đọc thử nghiệm.');
    }
    return fs.readFileSync(tmpWav);
  } finally {
    try {
      if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
    } catch {
      // ignore
    }
  }
}

export async function installAndWarmupVieNeu(): Promise<{
  ok: boolean;
  engine: string;
  voicesCount: number;
  message: string;
}> {
  const scriptPath = getVieNeuScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Thiếu tệp scripts/vieneu_tts.py trong dự án.');
  }

  resetOfflineTtsCache();
  let pySpec = await resolveVieNeuPythonCommand();
  const isWin = process.platform === 'win32';
  const venvDir = path.join(process.cwd(), '.venv-vieneu');
  const venvPy = path.join(venvDir, isWin ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'));
  const baseDeps = [
    'onnxruntime>=1.20.0',
    'sea-g2p>=0.10.0',
    'huggingface_hub>=0.25.0',
    'tokenizers>=0.20.0',
    'PyYAML>=6.0',
    'soundfile>=0.12.1',
    'soxr>=0.4.0',
    'librosa>=0.10.2',
    'kaldi-native-fbank>=1.20.0',
    'numpy>=1.26.0',
    'requests>=2.31.0',
  ];

  const findCompatibleBasePython = async (): Promise<{
    selected: { cmd: string; prefixArgs: string[]; meta: PythonEnvMeta } | null;
    foundIncompatible: string[];
  }> => {
    const pyCandidates: { cmd: string; prefixArgs: string[] }[] = isWin
      ? getWindowsPythonCandidates()
      : [
          { cmd: 'python3', prefixArgs: [] },
          { cmd: 'python', prefixArgs: [] },
        ];

    const foundIncompatible: string[] = [];
    for (const cand of pyCandidates) {
      const meta = await inspectPythonEnvMeta(cand.cmd, cand.prefixArgs);
      if (!meta) continue;
      if (isCompatibleVieNeuPython(meta)) {
        return { selected: { ...cand, meta }, foundIncompatible };
      }
      if (!foundIncompatible.includes(meta.raw)) {
        foundIncompatible.push(meta.raw);
      }
    }
    return { selected: null, foundIncompatible };
  };

  const ensureVenvWithAllPackages = async (): Promise<{ cmd: string; prefixArgs: string[] }> => {
    if (fs.existsSync(venvPy)) {
      const existingMeta = await inspectPythonEnvMeta(venvPy, []);
      if (!isCompatibleVieNeuPython(existingMeta)) {
        try {
          fs.rmSync(venvDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    if (!fs.existsSync(venvPy)) {
      let { selected: basePy, foundIncompatible } = await findCompatibleBasePython();

      if (!basePy && isWin) {
        try {
          await spawnPromise(
            'winget',
            [
              'install',
              '--id',
              'Python.Python.3.12',
              '--architecture',
              'x64',
              '--scope',
              'user',
              '--exact',
              '--silent',
              '--accept-package-agreements',
              '--accept-source-agreements',
            ],
            process.cwd(),
            240_000
          );
          const retryProbe = await findCompatibleBasePython();
          basePy = retryProbe.selected;
          if (retryProbe.foundIncompatible.length > 0) {
            foundIncompatible = retryProbe.foundIncompatible;
          }
        } catch {
          // winget unavailable or blocked
        }
      }

      if (!basePy) {
        const detectedNote =
          foundIncompatible.length > 0
            ? ` (Hiện máy đang dùng: ${foundIncompatible.join(', ')} — không có gói wheel onnxruntime/soxr tương thích).`
            : '';
        throw new Error(
          isWin
            ? `VieNeu-TTS ONNX yêu cầu Python 64-bit bản 3.10–3.14${detectedNote} Hãy chạy lệnh: winget install Python.Python.3.12 --architecture x64 --source winget (hoặc tải bản Windows installer 64-bit tại https://www.python.org/downloads/), mở lại app và bấm "Nạp lại model VieNeu".`
            : 'Không tìm thấy Python 3.10–3.14 trên máy chủ để cài VieNeu-TTS Offline.'
        );
      }

      let venvRes = await spawnPromise(basePy.cmd, [...basePy.prefixArgs, '-m', 'venv', venvDir], process.cwd(), 120_000);
      if (venvRes.code !== 0) {
        venvRes = await spawnPromise(
          basePy.cmd,
          [...basePy.prefixArgs, '-m', 'venv', '--without-pip', venvDir],
          process.cwd(),
          120_000
        );
        if (venvRes.code !== 0 || !fs.existsSync(venvPy)) {
          throw new Error(`Không tạo được môi trường Python VieNeu: ${venvRes.stderr || venvRes.stdout}`);
        }
      }
    }

    const pipCheck = await spawnPromise(venvPy, ['-m', 'pip', '--version'], process.cwd(), 15_000);
    if (pipCheck.code !== 0) {
      const getPipPath = path.join(os.tmpdir(), 'get-pip-vieneu.py');
      const dl = await fetch('https://bootstrap.pypa.io/get-pip.py', { signal: AbortSignal.timeout(45_000) });
      if (!dl.ok) {
        throw new Error(`Không thể tải get-pip.py để cài VieNeu-TTS (HTTP ${dl.status}).`);
      }
      fs.writeFileSync(getPipPath, Buffer.from(await dl.arrayBuffer()));
      const gpRes = await spawnPromise(venvPy, [getPipPath], process.cwd(), 120_000);
      try { fs.unlinkSync(getPipPath); } catch { /* ignore */ }
      if (gpRes.code !== 0) {
        throw new Error(`Không cài được pip cho .venv-vieneu: ${gpRes.stderr || gpRes.stdout}`);
      }
    }

    await spawnPromise(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], process.cwd(), 90_000).catch(() => {});

    const installPkg = await spawnPromise(venvPy, ['-m', 'pip', 'install', '--no-deps', 'vieneu>=3.8.0'], process.cwd(), 300_000);
    if (installPkg.code !== 0) {
      throw new Error(`Lỗi cài đặt gói vieneu: ${installPkg.stderr || installPkg.stdout}`);
    }
    let installDeps = await spawnPromise(venvPy, ['-m', 'pip', 'install', ...baseDeps], process.cwd(), 420_000);
    if (installDeps.code !== 0) {
      installDeps = await spawnPromise(
        venvPy,
        ['-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple', ...baseDeps],
        process.cwd(),
        420_000
      );
    }
    if (installDeps.code !== 0) {
      const venvMeta = await inspectPythonEnvMeta(venvPy, []);
      const metaLabel = venvMeta ? ` [${venvMeta.raw}]` : '';
      throw new Error(`Lỗi cài đặt thư viện ONNX cho VieNeu${metaLabel}: ${installDeps.stderr || installDeps.stdout}`);
    }
    return { cmd: venvPy, prefixArgs: [] };
  };

  if (!pySpec) {
    pySpec = await ensureVenvWithAllPackages();
  }

  let warmRes = await spawnPromise(
    pySpec.cmd,
    [...pySpec.prefixArgs, scriptPath, '--mode', 'v3nano', '--warmup'],
    process.cwd(),
    360_000
  );
  let parsed = parseLastJsonObject(warmRes.stdout);

  // If warmup still failed due to any missing Python module, auto-repair via .venv-vieneu or pip
  if (warmRes.code !== 0 || !parsed?.ok) {
    const errText = String(parsed?.error || warmRes.stderr || '');
    const missingModMatch = errText.match(/No module named ['"]([A-Za-z0-9_.-]+)['"]/i);
    if (missingModMatch) {
      const missingPkg = missingModMatch[1];
      if (pySpec.cmd === venvPy) {
        await spawnPromise(venvPy, ['-m', 'pip', 'install', ...baseDeps, missingPkg], process.cwd(), 300_000);
      } else {
        pySpec = await ensureVenvWithAllPackages();
        await spawnPromise(pySpec.cmd, ['-m', 'pip', 'install', missingPkg], process.cwd(), 180_000).catch(() => {});
      }
      warmRes = await spawnPromise(
        pySpec.cmd,
        [...pySpec.prefixArgs, scriptPath, '--mode', 'v3nano', '--warmup'],
        process.cwd(),
        360_000
      );
      parsed = parseLastJsonObject(warmRes.stdout);
    }
  }

  if (warmRes.code !== 0 || !parsed?.ok) {
    throw new Error(parsed?.error || warmRes.stderr || 'Không thể tải model VieNeu-TTS offline.');
  }

  resetOfflineTtsCache();
  await detectOfflineTtsEngine();
  const voiceData = await listVieNeuVoices();

  return {
    ok: true,
    engine: voiceData.engine || 'VieNeu-TTS (Tiếng Việt Offline · ONNX)',
    voicesCount: voiceData.voices.length || Number(parsed.voicesCount || 0),
    message: `Đã cài đặt và nạp sẵn VieNeu-TTS (${voiceData.voices.length || parsed.voicesCount || 11} giọng tiếng Việt Offline).`,
  };
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

  const cleanHook = escapeAssText(String(hookText || '').trim());
  if (cleanHook) {
    lines.push(`Dialogue: 1,0:00:00.00,${formatAssTime(Math.min(3.8, timeline[timeline.length - 1]?.end || 3.8))},Hook,,0,0,0,,${cleanHook}`);
  }

  for (const seg of timeline) {
    const cleanCap = escapeAssText(String(seg?.caption || '').trim());
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
  offlineVoice?: string;
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
  const { blueprint, visualMode, voice, keepSourceAudio, downloadSourceVideo } = params;
  const sources = Array.isArray(params.sources) ? params.sources : [];
  const scenes = blueprint.scenes.slice(0, 24);
  if (scenes.length === 0) {
    throw new Error('Kịch bản không có phân cảnh nào để dựng video.');
  }

  const isVertical = blueprint.aspectRatio === '9:16';
  const isSquare = blueprint.aspectRatio === '1:1';
  const targetW = isSquare ? 1080 : isVertical ? 1080 : 1920;
  const targetH = isSquare ? 1080 : isVertical ? 1920 : 1080;
  job.resolution = `${targetW}x${targetH}`;

  const effectiveVoiceMode: DerivativeVoiceMode =
    blueprint.enableVoiceover === false
      ? 'none'
      : params.voiceMode || (voice === 'none' ? 'none' : 'ai_online');

  // 1. Voiceover generation (Online AI TTS or Offline System TTS)
  const sceneAudioPaths: (string | null)[] = new Array(scenes.length).fill(null);
  const sceneTargetDurations: number[] = scenes.map((s) => Math.max(2.0, Number(s.durationSec || 6)));
  const totalPlannedSec = sceneTargetDurations.reduce((a, b) => a + b, 0);

  if (effectiveVoiceMode === 'offline_system') {
    job.status = 'tts';
    job.progress = 10;
    const offlineEngine = await detectOfflineTtsEngine();
    job.stepLabel =
      offlineEngine.engineId === 'vieneu'
        ? `Đang tổng hợp giọng tiếng Việt VieNeu-TTS (0/${scenes.length} cảnh)...`
        : `Đang tổng hợp giọng đọc Offline (0/${scenes.length} cảnh)...`;

    if (offlineEngine.engineId === 'vieneu') {
      const batchItems = scenes
        .map((sc, idx) => ({
          index: idx,
          text: sc.narration.trim(),
          out: path.join(job.workDir, `voice_${idx}.wav`),
          voice: params.offlineVoice,
        }))
        .filter((it) => it.text.length > 0);

      job.stepLabel = `Đang nạp mô hình VieNeu-TTS và đọc ${batchItems.length} phân cảnh...`;
      job.progress = 16;

      let batchResults = new Map<number, boolean>();
      try {
        batchResults = await synthesizeOfflineVoiceBatchVieNeu(batchItems, params.offlineVoice);
      } catch (batchErr: any) {
        job.warnings.push(`VieNeu batch cảnh báo (${batchErr?.message || 'lỗi'}), thử đọc từng cảnh...`);
      }

      for (let i = 0; i < scenes.length; i += 1) {
        const sc = scenes[i];
        const wavPath = path.join(job.workDir, `voice_${i}.wav`);
        let ok = Boolean(batchResults.get(i));
        if (!ok && sc.narration.trim()) {
          ok = await synthesizeOfflineVoiceWav(sc.narration, wavPath, params.offlineVoice);
        }
        if (ok && fs.existsSync(wavPath)) {
          sceneAudioPaths[i] = wavPath;
          const audioDur = await probeDurationSeconds(wavPath, job.workDir);
          if (audioDur > 0.5) {
            sceneTargetDurations[i] = Math.max(3.0, audioDur + 0.45);
          }
        } else if (sc.narration.trim()) {
          job.warnings.push(`Cảnh ${i + 1}: VieNeu-TTS không tạo được lời thoại, giữ nhạc/nền cho cảnh này.`);
        }
        job.stepLabel = `Đã xử lý giọng đọc VieNeu-TTS (${i + 1}/${scenes.length})...`;
        job.progress = 16 + Math.round(((i + 1) / scenes.length) * 18);
      }
    } else {
      for (let i = 0; i < scenes.length; i += 1) {
        const sc = scenes[i];
        const wavPath = path.join(job.workDir, `voice_${i}.wav`);
        if (sc.narration.trim()) {
          const ok = await synthesizeOfflineVoiceWav(sc.narration, wavPath, params.offlineVoice);
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
            ok = await synthesizeOfflineVoiceWav(sc.narration, wavPath, params.offlineVoice || voice);
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

  // Generate missing AI video clips if visualMode === 'gemini_omni' or 'muse2api_video'
  if (visualMode === 'gemini_omni' || visualMode === 'muse2api_video') {
    const useMuseVideo = visualMode === 'muse2api_video';
    const hasMissingScenes = scenes.some((_, idx) => !sceneOmniVideos.has(idx));
    let canGenerateWithMuse = true;

    if (useMuseVideo && hasMissingScenes) {
      const museStatus = await getMuse2ApiStatus().catch(() => null);
      if (!museStatus?.ready) {
        canGenerateWithMuse = false;
        const reason =
          museStatus?.error ||
          (!museStatus?.reachable
            ? 'Muse2API chưa bật hoặc không kết nối được tới dịch vụ'
            : 'Muse2API chưa có tài khoản muse.ai hợp lệ');
        job.warnings.push(
          `Chế độ ưu tiên Muse2API chưa sẵn sàng (${reason}). Hệ thống tự động dùng tư liệu video/ảnh dự phòng; hãy bật Muse2API trong Cài đặt để sinh clip muse-video.`
        );
      }
    }

    if (!useMuseVideo || canGenerateWithMuse) {
      for (let i = 0; i < scenes.length; i += 1) {
        if (sceneOmniVideos.has(i)) continue;
        const sc = scenes[i];
        job.stepLabel = `Đang tạo video cảnh ${i + 1}/${scenes.length} bằng ${
          useMuseVideo ? 'Muse2API (muse-video)' : 'Gemini Omni Flash'
        }...`;
        job.progress = 36 + Math.round(((i + 1) / scenes.length) * 20);
        try {
          const consistentPrompt = compileConsistentScenePrompt({
            scene: sc,
            videoStyle: blueprint.videoStyle,
            characterBible: blueprint.characterBible,
            settingBible: blueprint.settingBible,
            visualStyleBible: blueprint.visualStyleBible,
            costumeBible: blueprint.costumeBible,
            continuityBible: blueprint.continuityBible,
            totalScenes: scenes.length,
            mediaType: 'video',
          });
          const clipRes = await generateSceneVideoWithOmniFlash({
            engine: useMuseVideo ? 'muse2api' : 'gemini',
            prompt: `${consistentPrompt} ${effectiveVoiceMode !== 'none' && sc.narration ? `Narration mood: ${sc.narration.slice(0, 120)}` : ''}`.trim(),
            aspectRatio: blueprint.aspectRatio,
            durationSec: Math.min(useMuseVideo ? 12 : 15, Math.max(4, Math.round(sceneTargetDurations[i]))),
            videoStyle: blueprint.videoStyle,
            characterBible: blueprint.characterBible,
            settingBible: blueprint.settingBible,
            visualStyleBible: blueprint.visualStyleBible,
            costumeBible: blueprint.costumeBible,
            continuityBible: blueprint.continuityBible,
            sceneIndex: sc.sceneIndex || i + 1,
            totalScenes: scenes.length,
            sceneImageDataUrl: sc.sceneImageDataUrl,
            characterRefs: params.characterRefs,
          });
          const asset = getStudioAsset(clipRes.assetId);
          if (asset) {
            sceneOmniVideos.set(i, { path: asset.filePath, duration: asset.durationSec || 8 });
          }
        } catch (clipErr: any) {
          if (i === 0 && scenes.length === 1) {
            throw clipErr;
          }
          job.warnings.push(
            `Cảnh ${i + 1}: Không tạo được clip AI (${clipErr?.message || 'Lỗi'}), tự động chuyển sang tư liệu dự phòng.`
          );
        }
      }
    }
  }

  const referencedIndices =
    sources.length > 0
      ? Array.from(
          new Set(scenes.map((s) => Math.max(0, Math.min(sources.length - 1, s.sourceVideoIndex))))
        )
      : [];

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

  const hasUncoveredScenes = scenes.some(
    (_, idx) => !sceneOmniVideos.has(idx) && !sceneCustomImages.has(idx)
  );
  const shouldFetchSourceOrBroll =
    visualMode === 'remix' ||
    ((visualMode === 'muse2api_video' || visualMode === 'gemini_omni') && hasUncoveredScenes);

  if (shouldFetchSourceOrBroll) {
    if (downloadSourceVideo && referencedIndices.length > 0) {
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
    }

    // Fetch distinct per-scene Wikimedia Commons / B-roll clips whenever a scene has no AI clip, custom image, or source video
    const scenesNeedingBroll = scenes.filter((sc, idx) => {
      if (sceneOmniVideos.has(idx) || sceneCustomImages.has(idx)) return false;
      if (sources.length === 0) return true;
      const srcIdx = Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex));
      return !downloadedSourceVideos.has(srcIdx);
    });

    if (scenesNeedingBroll.length > 0 && brollPreference !== 'none') {
      const brollLabelUsed = new Set<string>();
      for (let bIdx = 0; bIdx < scenes.length; bIdx += 1) {
        if (sceneOmniVideos.has(bIdx) || sceneCustomImages.has(bIdx)) continue;
        const sc = scenes[bIdx];
        const srcIdx = sources.length > 0 ? Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex)) : -1;
        if (srcIdx >= 0 && downloadedSourceVideos.has(srcIdx)) continue;

        job.stepLabel = `Đang tìm video mẫu từ ${brollPreference === 'wikimedia' ? 'Wikimedia Commons' : 'kho B-roll'} cho cảnh ${bIdx + 1}/${scenes.length}...`;
        job.progress = 52 + Math.round(((bIdx + 1) / scenes.length) * 10);

        const src = srcIdx >= 0 ? sources[srcIdx] : undefined;
        const brollPath = path.join(job.workDir, `scene_broll_${bIdx}.mp4`);
        const queries = [
          sc.brollKeywordEn || '',
          sc.settingDetail || '',
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
            sources.length > 0 &&
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
    const srcIdx = sources.length > 0 ? Math.max(0, Math.min(sources.length - 1, sc.sourceVideoIndex)) : -1;
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
      : visualMode === 'storyboard_motion' || srcIdx < 0
      ? undefined
      : downloadedSourceVideos.get(srcIdx);
    const thumbFile = customImg || (srcIdx >= 0 ? thumbnailPaths.get(srcIdx) : undefined);

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
      caption: sc.onScreenText || '',
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
